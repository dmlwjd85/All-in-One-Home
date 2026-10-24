/** 파싱, 옮기기, 대비, 공휴일, 글꼴, 화면 문구를 확인합니다. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { parseNote } from '../src/lib/parse.js';
import { isSensitiveText, rulesSafeTextBody } from '../src/lib/sensitive.js';
import { planMigration, storageFromMap } from '../src/lib/migrate.js';
import { readLegacyStorage } from '../src/lib/migrate.js';
import { periodStatus, DEFAULT_PERIODS } from '../src/lib/period.js';
import { resolveHash } from '../src/lib/routes.js';
import { dueLabel } from '../src/lib/date.js';
import { restInfo } from '../src/lib/daymark.js';
import { isPublicHoliday } from '../src/lib/holidays.js';
import { parseRoster } from '../src/lib/roster.js';
import { buildExport, validateBackupText } from '../src/lib/backup.js';
import { boot, clearAll, exportFile, finishSetup, importText, saveQuick, setTimetable, snapshot, subscribeStorageIssue, update, useVaultsForTest } from '../src/lib/db.js';
import { keySoundEnabled, keySoundNoticePending, rememberKeySoundNotice } from '../src/ui/keyfeel.js';
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
check(dueLabel('2026-10-28', '2026-10-25') === '10/28(수), D-3', `마감 표시가 다릅니다. ${dueLabel('2026-10-28', '2026-10-25')}`);
check(dueLabel('2026-10-25', '2026-10-25') === '10/25(일), D-day', '오늘 마감 표시가 다릅니다.');
check(restInfo('2026-10-23', []).off === false, '평일 금요일을 휴일로 봤습니다.');
check(restInfo('2026-10-24', []).off && restInfo('2026-10-25', []).off, '토·일을 휴일로 보지 않습니다.');
check(restInfo('2026-10-09', []).off && restInfo('2026-10-09', []).label.includes('한글'), '한글날을 휴일로 보지 않습니다.');
check(restInfo('2026-11-16', [{ date: '2026-11-16', title: '재량휴업일', kind: '휴일' }]).off, '재량휴업일을 휴일로 보지 않습니다.');
check(restInfo('2026-12-23', [{ date: '2026-12-23', title: '방학식', kind: '학급' }]).off === false, '방학식을 휴업으로 봤습니다.');
check(restInfo('2026-12-28', [{ date: '2026-12-28', end: '2027-01-03', title: '겨울 방학', kind: '학급' }]).off, '방학 기간을 휴업으로 보지 않습니다.');

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
    '작년 학예회는 11/10 강당에서 했습니다.',
]) {
    const drafts = captureDrafts(line, { now: held });
    check(drafts.length > 0 && drafts.every((item) => item.include === false), `빼 둔 문장이 저장 대상입니다. ${line}`);
}
const keptRecord = captureDrafts('12번 이하은 발표를 끝까지 했어요', { now: held, students: [{ id: 's12', no: 12, name: '이하은' }] });
check(keptRecord.length === 1 && keptRecord[0].include !== false && keptRecord[0].kind === '학생기록', '학생 기록이 빠졌습니다.');

const pairs = [
    ['본문', '#2E2A2B', '#E8E4DE'],
    ['보조', '#5E5658', '#E8E4DE'],
    ['버튼', '#FFFFFF', '#A73D74'],
    ['히어로 글자', '#2E2A2B', '#E8E4DE'],
    ['히어로 버튼', '#FFFFFF', '#A73D74'],
    ['히어로 알약', '#2E2A2B', '#E8E4DE'],
    ['노란 카드', '#2E2A2B', '#F2E6C4'],
    ['보조 노란', '#5E5658', '#F2E6C4'],
    ['지각', '#915200', '#E8E4DE'],
    ['지각 칸', '#915200', '#F3E8D6'],
    ['결석', '#BA253D', '#E8E4DE'],
    ['결석 칸', '#BA253D', '#F4E4E7'],
    ['출석', '#15714E', '#E8E4DE'],
    ['조퇴', '#245EBE', '#E8E4DE'],
    ['조퇴 칸', '#245EBE', '#E4EAF6'],
    ['결과', '#5B4B9A', '#E8E4DE'],
    ['결과 칸', '#5B4B9A', '#EBE6F4'],
    ['다크 본문', '#F6F2EE', '#2A2627'],
    ['다크 보조', '#C9C1BF', '#2A2627'],
    ['다크 버튼', '#FFFFFF', '#A73D74'],
    ['다크 히어로', '#F6F2EE', '#2A2627'],
    ['다크 알약', '#F6F2EE', '#2A2627'],
    ['다크 노란 카드', '#F6F2EE', '#3C3424'],
    ['다크 지각', '#F0C08A', '#2A2627'],
    ['다크 지각 칸', '#F0C08A', '#3A2E28'],
    ['다크 결석', '#FF8B96', '#2A2627'],
    ['다크 결석 칸', '#FF8B96', '#3D2424'],
    ['다크 출석', '#8EDEBE', '#2A2627'],
    ['다크 조퇴', '#9EC0FF', '#1C2A44'],
    ['다크 결과', '#D4B6FF', '#2C2140'],
    ['강조', '#A73D74', '#E8E4DE'],
    ['강조 카드', '#A73D74', '#E8E4DE'],
    ['강조 노란', '#A73D74', '#F2E6C4'],
    ['다크 강조', '#E08B9A', '#2A2627'],
    ['다크 강조 카드', '#E08B9A', '#2A2627'],
    ['토스트', '#F6F2EE', '#2E2A2B'],
    ['토스트 동작', '#F0A8BA', '#2E2A2B'],
    ['다크 토스트', '#2E2A2B', '#F6F2EE'],
    ['다크 토스트 동작', '#A73D74', '#F6F2EE'],
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
    const uncommented = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\bhref=(["'])[\s\S]*?\1/g, '');
    if (/Gowun|Pretendard|Noto Serif|Noto Sans/.test(uncommented)) failures.push(`${rel}: 글꼴 이름이 토큰 밖에 있습니다.`);
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

const memoryStore = {
    map: new Map(),
    getItem(key) { return this.map.has(key) ? this.map.get(key) : null; },
    setItem(key, value) { this.map.set(key, String(value)); },
};
check(keySoundEnabled(memoryStore), '콕 소리 기본값이 켜져 있지 않습니다.');
check(keySoundNoticePending(memoryStore), '처음 소리 안내가 준비되지 않습니다.');
rememberKeySoundNotice(memoryStore);
check(!keySoundNoticePending(memoryStore), '소리 안내를 한 번 본 뒤에도 다시 뜹니다.');
memoryStore.setItem('ssug-gyomu-key-sound', '0');
memoryStore.map.delete('ssug-gyomu-key-sound-notice');
check(!keySoundNoticePending(memoryStore), '소리가 꺼져 있는데 안내가 뜹니다.');

const bits = readFileSync(`${root}/src/ui/bits.jsx`, 'utf8');
const ledgerPath = 'M1466 0H186V206H1214L1212 326L136 350L168 558L1198 514C1191 581 1179 654 1162 734L1414 750C1466 518 1466 340 1466 170ZM1652 826H874V622H618V826H0V1028H1652ZM1454 1166H168V1366H1200V1774H1454Z';
check(bits.includes('viewBox="0 0 1652 1774"'), '콕 글자 틀이 가계부와 다릅니다.');
check(bits.includes(ledgerPath), '콕 글자 윤곽이 가계부와 다릅니다.');
const appText = readFileSync(`${root}/src/App.jsx`, 'utf8');
check(appText.includes('콕, 누를 때 소리가 나요') && appText.includes('>끄기<'), '소리 안내 문구가 없습니다.');
check(!appText.includes('setKeySoundAnnouncer') && !appText.includes("showToast('콕, 누를 때 소리가 나요'"), '소리 안내가 나타났다 사라지는 토스트이면 안 됩니다.');

const sw = readFileSync(`${root}/public/sw.js`, 'utf8');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v14'"), '캐시 판이 올라가지 않았습니다.');
const helperStart = sw.indexOf('function assetSuffix');
const helperEnd = sw.indexOf('/* stale-assets-end */');
const helper = helperStart >= 0 && helperEnd > helperStart ? sw.slice(helperStart, helperEnd) : '';
    const sandbox = { URL };
    if (!helper) failures.push('옛 assets 를 가리는 함수가 없습니다.');
    else {
        vm.runInNewContext(`${helper}\nthis.staleAssetUrls = staleAssetUrls;`, sandbox);
    const scope = 'https://teacher.github.io/All-in-One-Home/sw.js';
    const drop = sandbox.staleAssetUrls([
        'https://teacher.github.io/All-in-One-Home/assets/old-abc.js',
        'https://teacher.github.io/All-in-One-Home/assets/new-def.js',
        'https://teacher.github.io/All-in-One-Home/assets/new-def.css',
        'https://teacher.github.io/All-in-One-Home/index.html',
    ], ['./assets/new-def.js', './index.html', './assets/new-def.css'], scope);
    check(drop.length === 1 && drop[0].endsWith('/assets/old-abc.js'), `매니페스트에 없는 assets 만 지워야 합니다: ${drop.join(', ')}`);
}

const cycledTodos = [{ id: 'todo-1', title: '동의서 걷기', done: false, due: '2026-10-23' }];
const cycledLocal = { records: [{ id: 'r1', text: '알레르기 간식' }], notes: [], events: [], todos: [], notices: [], contacts: [], pages: [], backup: null };
const cycled = {
    profile: { className: '6학년 3반', schoolYear: 2026, classSize: 1, periodStarts: ['09:00'] },
    students: [{ id: 's1', no: 1, name: '김하늘' }],
    attendance: [],
    records: [],
    events: [],
    todos: cycledTodos,
    notes: [],
    notices: [],
    timetable: { mon: { p1: '국어' } },
    legacyPages: [],
    local: cycledLocal,
};
const firstExport = buildExport(cycled, { includeLocal: true, at: '2026-10-23T00:00:00.000Z' });
cycledLocal.backup = { exportedAt: firstExport.exportedAt, payload: firstExport };
firstExport.local = cycledLocal;
let cycledText = '';
try {
    cycledText = JSON.stringify(buildExport(cycled, { includeLocal: true, at: '2026-10-23T01:00:00.000Z' }));
} catch (error) {
    failures.push(`순환 참조를 끊지 못했습니다: ${error.message}`);
}
if (cycledText) {
    const parsedCycle = JSON.parse(cycledText);
    check(parsedCycle.todos?.[0]?.title === '동의서 걷기', '순환 참조 때문에 할 일이 빠집니다.');
    check(parsedCycle.local?.records?.[0]?.text === '알레르기 간식', '순환 참조 때문에 이 기기 기록이 빠집니다.');
    check(parsedCycle.local?.backup?.payload === undefined, '내보낼 때 안쪽 백업 본문을 빼지 않습니다.');
}

function fingerprint(current) {
    return JSON.stringify({
        className: current.profile.className,
        schoolYear: current.profile.schoolYear,
        classSize: current.profile.classSize,
        periodStarts: current.profile.periodStarts,
        students: current.students,
        attendance: current.attendance,
        records: current.records,
        events: current.events,
        todos: current.todos,
        notes: current.notes,
        notices: current.notices,
        timetable: current.timetable,
        legacyPages: current.legacyPages,
        localRecords: current.local.records,
        localNotes: current.local.notes,
        localEvents: current.local.events,
        localTodos: current.local.todos,
        localNotices: current.local.notices,
        localContacts: current.local.contacts,
        localPages: current.local.pages,
    });
}

await (async () => {
    await boot('');
    await clearAll();
    await finishSetup({ className: '6학년 3반', rosterText: '1 김하늘\n2 이하은' });
    await saveQuick({ text: '동의서 걷기', kind: '할 일' });
    await saveQuick({ text: '발표를 끝까지 했어요', kind: '관찰', no: 1 });
    await saveQuick({ text: '알레르기 간식', kind: '관찰', no: 2 });
    await saveQuick({ text: '현장학습', kind: '일정', date: '2026-10-23' });
    await setTimetable('mon', 1, '국어');
    const original = fingerprint(snapshot());
    check(snapshot().todos.some((row) => row.title.includes('동의서')), '할 일을 만들지 못했습니다.');
    check(snapshot().local.records.some((row) => String(row.text).includes('알레르기')), '민감 기록이 이 기기에 없습니다.');
    const file = JSON.stringify(exportFile(true));
    await saveQuick({ text: '사라질 할 일', kind: '할 일' });
    check(snapshot().todos.some((row) => row.title.includes('사라질')), '교체 전에 기록을 더하지 못했습니다.');
    const replaced = await importText(file, 'replace');
    check(replaced.ok, `교체 불러오기가 실패했습니다: ${(replaced.errors || []).join(' ')}`);
    check(fingerprint(snapshot()) === original, '교체 뒤 기록이 백업과 다릅니다.');
    const again = JSON.stringify(exportFile(true));
    const reloaded = await importText(again, 'replace');
    check(reloaded.ok, `다시 불러오기가 실패했습니다: ${(reloaded.errors || []).join(' ')}`);
    check(fingerprint(snapshot()) === original, '교체 뒤 다시 내보내고 불러오자 기록이 바뀌었습니다.');
    check(snapshot().todos.some((row) => row.title.includes('동의서')) && !snapshot().todos.some((row) => row.title.includes('사라질')), '할 일 목록이 비었습니다.');

    const beforeFail = fingerprint(snapshot());
    const failed = await importText(file, 'replace', {
        async onPhase(phase, draft) {
            if (phase === 'ready') draft.todos = [];
            if (phase === 'applied') throw new Error('중간에 실패');
        },
    });
    check(!failed.ok, '중간에 실패한 교체가 성공으로 끝났습니다.');
    check(fingerprint(snapshot()) === beforeFail, '실패한 교체 뒤에 원래 기록으로 돌아오지 않았습니다.');
    const recovered = exportFile(true);
    check(JSON.stringify(recovered) && recovered.todos.some((row) => row.title.includes('동의서')), '복구 뒤 내보내기가 할 일을 잃었습니다.');

    const sizes = [];
    for (let round = 0; round < 6; round += 1) {
        const text = JSON.stringify(exportFile(true));
        const parsed = JSON.parse(text);
        check(parsed.local?.backup?.payload === undefined, '교체를 반복해도 안쪽 백업이 파일에 남습니다.');
        sizes.push(text.length);
        const brought = await importText(text, 'replace');
        check(brought.ok, `크기를 재는 교체가 실패했습니다: ${(brought.errors || []).join(' ')}`);
    }
    check(sizes.length === 6 && sizes.every((size) => size === sizes[0]), `교체를 반복하면 파일 크기가 커집니다: ${sizes.join(', ')}`);
    check(snapshot().local.backup?.payload?.local?.backup?.payload === undefined, '기기에 남긴 백업 안에 이전 백업 본문이 겹칩니다.');

    function quotaError() {
        const error = new Error('QuotaExceededError');
        error.name = 'QuotaExceededError';
        return error;
    }
    function blockedError() {
        const error = new Error('blocked');
        error.name = 'AbortError';
        return error;
    }
    function makeVault() {
        const bag = new Map();
        let mode = 'ok';
        return {
            failOnce() { mode = 'once'; },
            failAlways() { mode = 'quota'; },
            heal() { mode = 'ok'; },
            async get(key) {
                return bag.has(key) ? structuredClone(bag.get(key)) : undefined;
            },
            async set(key, value) {
                if (mode === 'quota') throw quotaError();
                if (mode === 'once') {
                    mode = 'ok';
                    throw blockedError();
                }
                bag.set(key, structuredClone(value));
            },
            async remove(key) {
                bag.delete(key);
            },
            dump() {
                return bag.has('state') ? structuredClone(bag.get('state')) : undefined;
            },
        };
    }

    const mainStore = makeVault();
    const localStore = makeVault();
    useVaultsForTest(mainStore, localStore);
    await update((draft) => draft);
    await saveQuick({ text: '섞이면 안 되는 할 일', kind: '할 일' });
    const kept = fingerprint(snapshot());
    const mainBefore = JSON.stringify(mainStore.dump());
    const localBefore = JSON.stringify(localStore.dump());
    check(mainBefore.includes('섞이면 안 되는 할 일'), '메인 저장소에 새 할 일이 없습니다.');
    localStore.failOnce();
    const oneSide = await importText(file, 'replace');
    check(!oneSide.ok, '한쪽 저장소가 실패했는데 가져오기가 성공했습니다.');
    check((oneSide.errors || []).some((item) => item.includes('이 기기에 기록을 남기지 못해서')), `한쪽 실패 안내가 없습니다: ${(oneSide.errors || []).join(' ')}`);
    check(fingerprint(snapshot()) === kept, '한쪽 저장소만 실패한 뒤 메모리 기록이 섞였습니다.');
    check(JSON.stringify(mainStore.dump()) === mainBefore, '한쪽이 실패한 뒤 메인 저장소가 새 기록으로 남았습니다.');
    check(JSON.stringify(localStore.dump()) === localBefore, '한쪽이 실패한 뒤 로컬 저장소가 예전과 다르게 남았습니다.');

    mainStore.failAlways();
    localStore.failAlways();
    const full = await importText(file, 'replace');
    check(!full.ok, '저장 공간이 가득 찼는데 가져오기가 성공했습니다.');
    check((full.errors || []).join(' ').includes('저장 공간이 가득 차서'), `공간 부족 안내가 없습니다: ${(full.errors || []).join(' ')}`);
    check(fingerprint(snapshot()) === kept, '공간이 가득 찬 뒤 메모리 기록이 바뀌었습니다.');
    check(JSON.stringify(mainStore.dump()) === mainBefore && JSON.stringify(localStore.dump()) === localBefore, '공간이 가득 찬 뒤 저장소가 바뀌었습니다.');

    const heard = [];
    const stopListen = subscribeStorageIssue((message) => heard.push(message));
    const leaks = [];
    const onLeak = (reason) => leaks.push(reason);
    process.on('unhandledRejection', onLeak);
    const ordinary = await saveQuick({ text: '남지 않을 할 일', kind: '할 일' });
    saveQuick({ text: '처리되지 않을 할 일', kind: '할 일' }).then(() => undefined);
    await new Promise((resolve) => { setTimeout(resolve, 20); });
    process.off('unhandledRejection', onLeak);
    stopListen();
    check(ordinary?.storageFailed && ordinary.ok === false, '일반 저장이 저장 실패를 조용히 넘겼습니다.');
    check(leaks.length === 0, `저장 실패가 처리되지 않은 오류로 남습니다: ${leaks.map((item) => item?.message).join(' / ')}`);
    check(heard.some((message) => message.includes('저장 공간이 가득 차서')), `일반 저장 실패를 알리지 않았습니다: ${heard.join(' / ')}`);
    check(fingerprint(snapshot()) === kept, '일반 저장에 실패했는데 화면에 새 기록이 남았습니다.');
    check(!JSON.stringify(mainStore.dump()).includes('남지 않을 할 일'), '실패한 일반 저장이 메인 저장소에 남았습니다.');
    check(JSON.stringify(localStore.dump()) === localBefore, '실패한 일반 저장이 로컬 저장소를 바꿨습니다.');
})().catch((error) => {
    failures.push(error?.message || String(error));
});

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('품질 검사를 통과했습니다.');
