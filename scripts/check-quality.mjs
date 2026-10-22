/** 파싱, 옮기기, 대비, 공휴일, 글꼴, 화면 문구를 확인합니다. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseNote } from '../src/lib/parse.js';
import { isSensitiveText, rulesSafeTextBody } from '../src/lib/sensitive.js';
import { planMigration, storageFromMap } from '../src/lib/migrate.js';
import { readLegacyStorage } from '../src/lib/migrate.js';
import { periodStatus, DEFAULT_PERIODS } from '../src/lib/period.js';
import { resolveHash } from '../src/lib/routes.js';
import { isPublicHoliday } from '../src/lib/holidays.js';
import { parseRoster } from '../src/lib/roster.js';
import { validateBackupText } from '../src/lib/backup.js';
import { fromCloudRow, toCloudProfile, toCloudRow } from '../src/lib/cloudShape.js';
import { captureDrafts } from '../src/ui/capture.js';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const failures = [];
function check(ok, message) {
    if (!ok) failures.push(message);
}

const now = new Date('2026-10-19T08:42:00+09:00');
const parsed = parseNote('@12 #학습 내일 발표를 맡았어요', now);
check(parsed.studentNo === 12, '@12 번호를 못 읽었습니다.');
check(parsed.tags.includes('학습'), '#학습 태그를 못 읽었습니다.');
check(parsed.detectedDate === '2026-10-20', '내일이 다음 날이 아닙니다.');
check(parseNote('2026-10-22에 가요', now).detectedDate === '2026-10-22', '날짜를 숫자보다 말로 먼저 읽습니다.');
check(isSensitiveText('알레르기 없는 간식'), '민감 낱말을 놓쳤습니다.');
check(isSensitiveText('건강 특이') && isSensitiveText('보건실 메모'), '건강·보건을 민감으로 보지 않습니다.');
check(!isSensitiveText('발표를 끝까지 했어요'), '평범한 기록을 민감으로 봤습니다.');
const rulesText = readFileSync(`${root}/firestore.rules`, 'utf8');
const safeLine = `function safeText(v) { return !v.matches('${rulesSafeTextBody()}'); }`;
check(rulesText.includes(safeLine), '규칙의 safeText가 앱 민감 낱말과 다릅니다.');

const period = periodStatus('08:42', DEFAULT_PERIODS, ['국어', '수학']);
check(period.minutes === 18 && period.text.includes('국어') && period.text.includes('18분'), `1교시까지 18분이 아닙니다: ${period.text}`);

const roster = parseRoster('12 이하은\n황보람');
check(roster.students.some((row) => row.no === 12 && row.name === '이하은'), '명단 붙여넣기를 못 읽었습니다.');
check(roster.students.some((row) => row.name === '황보람'), '성 두 글자를 못 읽었습니다.');

check(resolveHash('#p154', '2026-10-19').name === 'students', '명렬표 쪽이 학생 화면이 아닙니다.');
check(resolveHash('#/cards/3', '2026-10-19').params.no === 3, '카드 주소가 학생으로 이어지지 않습니다.');
check(!isPublicHoliday('2026-10-19'), '10월 19일을 공휴일로 봤습니다.');
check(isPublicHoliday('2026-03-01'), '삼일절이 빠졌습니다.');
check(isPublicHoliday('2026-02-17'), '설날이 빠졌습니다.');
check(isPublicHoliday('2026-05-05') && isPublicHoliday('2026-10-03') && isPublicHoliday('2026-12-25'), '공휴일이 빠졌습니다.');

const bag = {
    pages: {
        154: { name1: '김하늘', sex1: '남', note1: '알레르기 주의' },
        160: { d0: '2026-10-01', a0: '학습', t0: '발표를 끝까지 했어요', n0: '1' },
        19: { memo: '보건 일지' },
        232: { s1_1: '결석' },
        141: { t1_0: '국어', t4_0: '체육 전담' },
        34: { d3: '학부모 상담' },
    },
    lists: {
        teacherContacts: [{ id: 'c1', name: '보호자', phone: '010' }],
        teacherTodos: [{ id: 't1', title: '알림장 올리기', done: false }],
    },
    sensitive: [{ id: 's1', text: '투약 기록' }],
    praise: {},
    extra: {},
};
const plan = planMigration(bag, { now, titles: { 19: '보건' } });
const sum = plan.counts.moved + plan.counts.archived + plan.counts.localOnly;
check(sum === plan.counts.original, `옮기기 개수 ${plan.counts.original} / ${sum}`);
const cloudText = [...plan.records, ...plan.notes, ...plan.events, ...plan.todos].map((row) => `${row.text || ''} ${row.title || ''}`).join('\n');
check(!isSensitiveText(cloudText), '민감 기록이 클라우드로 갈 자리에 있습니다.');
check(plan.local.records.some((row) => String(row.text).includes('알레르기')), '알레르기 기록이 이 기기에 남지 않았습니다.');
check(plan.local.notes.some((row) => String(row.text).includes('투약')), '투약 기록이 이 기기에 남지 않았습니다.');
check(plan.timetable.mon?.p1 === '국어' && plan.timetable.mon?.s4 === '전담', '시간표를 못 옮겼습니다.');
check(plan.attendance.length === 0, '주간 출결을 하루 출결로 바꿨습니다.');
check(plan.students.some((row) => row.name === '김하늘'), '명단을 못 옮겼습니다.');

const fake = storageFromMap({
    homenote_v2_classRoster: JSON.stringify([{ id: '1', name: '김하늘' }]),
    homenote_guest: '1',
});
const before = fake.getItem('homenote_v2_classRoster');
readLegacyStorage(fake);
check(fake.getItem('homenote_v2_classRoster') === before, '원본 키를 고쳤습니다.');

const badBackup = validateBackupText('{"__proto__":{"x":1},"format":"ssug-gyomu"}');
check(!badBackup.ok, '위험한 백업 키를 받았습니다.');

const absent = toCloudRow('attendance', { date: '2026-10-19', sid: 's3', status: '결석', reason: '질병', note: '감기', paper: false, source: 'app' });
check(absent?.body.status === 'absent' && absent.body.reason === 'sick' && !('source' in absent.body), '출결이 규칙 형식이 아닙니다.');
check(fromCloudRow('attendance', absent.id, absent.body)?.status === '결석', '출결이 한국어로 돌아오지 않습니다.');
check(toCloudRow('records', { id: 'rec-1', date: '2026-10-19', kind: '관찰', text: '알레르기 있음', source: 'app' }) === null, '민감 기록이 클라우드로 나갑니다.');
const sensitiveStudent = toCloudRow('students', { id: 's3', no: 3, name: '박서준', memo: '건강 특이', source: 'app' });
check(sensitiveStudent?.body?.name === '박서준' && sensitiveStudent.body.no === 3 && !('memo' in sensitiveStudent.body) && sensitiveStudent.clear?.includes('memo'), '민감한 학생 메모가 학생 전체를 빼거나 메모를 올립니다.');
const plainStudent = toCloudRow('students', { id: 's4', no: 4, name: '윤채원', memo: '반장', source: 'app' });
check(plainStudent?.body?.memo === '반장' && !plainStudent.clear?.length, '평범한 학생 메모를 빼 둡니다.');
check(toCloudRow('students', { id: 's5', no: 5, name: '강민우', memo: '보건', source: 'app' })?.body?.name === '강민우', '보건 메모 때문에 학생이 빠집니다.');
check(toCloudRow('records', { id: 'demo-1', date: '2026-10-19', kind: '관찰', text: '발표를 했어요', source: 'demo' }) === null, '예시 학급이 클라우드로 나갑니다.');
const cloudRecord = toCloudRow('records', { id: 'rec-1', date: '2026-10-19', kind: '상담', sid: 's12', text: '이야기를 들었어요', tags: ['교우'], neis: true, neisMoved: true, source: 'app' });
check(cloudRecord?.body.kind === 'counsel' && !('neisMoved' in cloudRecord.body), '기록 칸이 규칙과 다릅니다.');
const cloudTodo = toCloudRow('todos', { id: 'todo-1', title: '동의서 걷기', done: false, got: 22, of: 27, pendingNos: [25], source: 'app' });
check(cloudTodo && !('pendingNos' in cloudTodo.body), '걷기 번호가 규칙 밖 칸으로 나갑니다.');
const cloudProfile = toCloudProfile({ profile: { className: '6학년 3반', schoolYear: 2026, classSize: 27, theme: 'light', periodStarts: ['09:00', '09:40'] }, auth: { name: '선생님' }, students: [] });
check(!('periodStart' in cloudProfile.body), '교시 목록이 규칙이 받지 않는 칸으로 나갑니다.');
const legacy = toCloudRow('legacy', { id: 'praiseBoard', kind: 'record', title: '칭찬', raw: { sticker: 1 } });
check(legacy?.id === 'board-praise' && typeof legacy.body.raw === 'string', '보관함 형식이 규칙과 다릅니다.');

function lum(hex) {
    const n = Number.parseInt(hex.slice(1), 16);
    const parts = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((value) => {
        const c = value / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
}
function contrast(a, b) {
    const left = lum(a);
    const right = lum(b);
    const [hi, lo] = left > right ? [left, right] : [right, left];
    return (hi + 0.05) / (lo + 0.05);
}
const held = new Date('2026-10-23T09:00:00+09:00');
for (const line of [
    '네 감사합니다!',
    '10/21(수) 현장체험학습 사진 올리기',
    '작년 6학년 담당 선생님은 11/10(화)까지 가정통신문 회신 부탁드려요',
]) {
    const drafts = captureDrafts(line, { now: held });
    check(drafts.length > 0 && drafts.every((item) => item.include === false), `빼 둔 문장이 저장 대상입니다. ${line}`);
}
const keptRecord = captureDrafts('12번 이하은 발표를 끝까지 했어요', { now: held, students: [{ id: 's12', no: 12, name: '이하은' }] });
check(keptRecord.length === 1 && keptRecord[0].include !== false && keptRecord[0].kind === '학생기록', '학생 기록이 빠졌습니다.');

const pairs = [
    ['본문', '#2B3350', '#EEF6FD'],
    ['보조', '#3E4868', '#FFF8E7'],
    ['버튼', '#FFFFFF', '#5B5BD6'],
    ['히어로 글자', '#2B3350', '#FFF8E7'],
    ['히어로 버튼', '#FFFFFF', '#5B5BD6'],
    ['히어로 알약', '#2B3350', '#E7DFF8'],
    ['노란 카드', '#2B3350', '#FFF6D8'],
    ['지각', '#9A5B00', '#FFF8E7'],
    ['다크 본문', '#F4F7FB', '#1A2333'],
    ['다크 보조', '#C5D0E0', '#243044'],
    ['다크 버튼', '#FFFFFF', '#5B5BD6'],
    ['다크 히어로', '#F4F7FB', '#243044'],
    ['다크 알약', '#F4F7FB', '#322C4A'],
    ['다크 노란 카드', '#F4F7FB', '#3A3424'],
    ['다크 지각', '#F0B89A', '#243044'],
    ['다크 결석', '#FF7D6E', '#243044'],
    ['강조', '#5B5BD6', '#EEF6FD'],
    ['강조 카드', '#5B5BD6', '#FFF8E7'],
    ['다크 강조', '#A994FF', '#1A2333'],
    ['다크 강조 카드', '#A994FF', '#243044'],
];
for (const [label, fg, bg] of pairs) {
    const ratio = contrast(fg, bg);
    check(ratio >= 4.5, `${label} 대비 ${ratio.toFixed(2)} 가 4.5보다 낮습니다.`);
}

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else out.push(path);
    }
    return out;
}
const fontAllow = new Set(['src/styles/tokens.css', 'public/fonts/fonts.css']);
for (const file of walk(root)) {
    const rel = file.slice(root.length + 1);
    if (!/\.(css|js|jsx|html)$/.test(rel) || fontAllow.has(rel)) continue;
    const text = readFileSync(file, 'utf8');
    if (/Gowun|Pretendard|Noto Serif|Noto Sans/.test(text)) failures.push(`${rel}: 글꼴 이름이 토큰 밖에 있습니다.`);
    for (const match of text.matchAll(/font-family\s*:\s*([^;}{]+)/g)) {
        const value = match[1];
        if (!/var\(--font-|inherit/.test(value)) failures.push(`${rel}: 글꼴을 변수 밖에서 지정했습니다.`);
    }
    if (rel.endsWith('.jsx')) {
        for (const match of text.matchAll(/>([^<{]+)</g)) {
            const value = match[1].trim();
            if (/^[A-Za-z][A-Za-z\s]{2,}$/.test(value)) failures.push(`${rel}: 영어 화면 문구 “${value}”`);
        }
        for (const word of ['Save', 'Cancel', 'Delete', 'Settings', 'Loading', 'Submit', 'Login', 'Logout']) {
            if (new RegExp(`['"\`]${word}['"\`]`).test(text)) failures.push(`${rel}: 영어 낱말 ${word}`);
        }
    }
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('품질 검사를 통과했습니다.');
