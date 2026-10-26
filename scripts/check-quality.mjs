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
import { boot, clearAll, exportFile, finishSetup, importText, saveQuick, saveTextItem, setTimetable, snapshot, subscribeStorageIssue, update, useVaultsForTest } from '../src/lib/db.js';
import { keySoundEnabled, keySoundNoticePending, rememberKeySoundNotice } from '../src/ui/keyfeel.js';
import { acceptTypeInput, isSensitiveControl, isTextControl, noteCompositionEnd, noteCompositionStart, noteCompositionUpdate, noteTypeInput, setTypeSound, shouldTypeSound, typeSoundEnabled, typeVoiceId } from '../src/ui/typesound.js';
import { assignHotkey, defaultHotkeys, hotkeyFootnote, hotkeyFromEvent, hotkeyPhoneNote, isStoredHotkey, kokHotkeyHint, loadHotkeys, matchHotkey, passesThroughCapture, resetHotkeys, saveHotkeys, shortcutBlocked } from '../src/ui/hotkeys.js';
import { menuSelected, menuTarget, tabSelected } from '../src/ui/menu.js';
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
check(!typeSoundEnabled(memoryStore) && typeVoiceId(memoryStore) === 'red', '글자 소리 기본이 꺼짐·적축이 아닙니다.');
check(setTypeSound(true, memoryStore) && typeSoundEnabled(memoryStore), '글자 소리 켜기가 저장되지 않습니다.');
setTypeSound(false, memoryStore);
check(!typeSoundEnabled(memoryStore), '글자 소리 끄기가 저장되지 않습니다.');

function fakeControl(tag, attrs = {}) {
    return {
        tagName: tag,
        isContentEditable: Boolean(attrs.contentEditable),
        getAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null; },
        hasAttribute(name) { return Object.prototype.hasOwnProperty.call(attrs, name); },
    };
}
check(isTextControl(fakeControl('TEXTAREA')) && isTextControl(fakeControl('INPUT', { type: 'search' })), '글자 칸을 소리 대상으로 보지 않습니다.');
check(!isTextControl(fakeControl('INPUT', { type: 'checkbox' })), '체크 칸에서도 글자 소리를 내려 합니다.');
check(isSensitiveControl(fakeControl('INPUT', { type: 'password' })) && isSensitiveControl(fakeControl('INPUT', { type: 'text', 'aria-label': '비밀번호' })), '비밀번호 칸을 민감하게 보지 않습니다.');
check(isSensitiveControl(fakeControl('INPUT', { type: 'text', autocomplete: 'one-time-code' })) && isSensitiveControl(fakeControl('INPUT', { type: 'text', name: 'otp' })) && isSensitiveControl(fakeControl('INPUT', { type: 'text', placeholder: '인증 번호' })), '인증 번호 칸을 조용히 하지 않습니다.');
check(!isSensitiveControl(fakeControl('INPUT', { type: 'text', 'aria-label': '학급 이름' })), '학급 이름 칸을 비밀번호로 봅니다.');
check(!shouldTypeSound({ inputType: 'insertText', target: fakeControl('INPUT', { type: 'text', autocomplete: 'one-time-code' }) }), '인증 번호 칸에서 글자 소리가 납니다.');
const composing = fakeControl('INPUT', { type: 'text' });
const soundStore = {
    map: new Map(),
    getItem(key) { return this.map.has(key) ? this.map.get(key) : null; },
    setItem(key, value) { this.map.set(key, String(value)); },
    removeItem(key) { this.map.delete(key); },
};
soundStore.setItem('ssug-gyomu-type-sound', '1');
const previousStorage = globalThis.localStorage;
globalThis.localStorage = soundStore;

/** Chromium 로그와 같은 순서. 확정은 input → 마이크로태스크 → compositionend.
    받침이 넘어갈 때는 insertText와 새 조합이 한 키의 12ms 안에 함께 옵니다.
    noteTypeInput이 참이면(문자열 'later' 포함) 그 자리에서 소리로 셉니다. */
let strokeAt = 1000;
async function replayIme(steps) {
    let sounds = 0;
    for (const step of steps) {
        const kind = step[0];
        if (kind === 'gap') {
            strokeAt += 80;
            continue;
        }
        if (kind === 'micro') {
            await Promise.resolve();
            continue;
        }
        if (kind === 'start') {
            noteCompositionStart();
            continue;
        }
        if (kind === 'end') {
            noteCompositionEnd();
            continue;
        }
        if (kind === 'update') {
            noteCompositionUpdate(step[1]);
            continue;
        }
        if (kind === 'input') {
            strokeAt += 0.3;
            const decision = noteTypeInput({
                inputType: step[1],
                data: step[2],
                isComposing: step[3],
                target: composing,
            }, strokeAt);
            if (decision) sounds += 1;
        }
    }
    return sounds;
}
function syllable(data) {
    return [
        ['update', data],
        ['input', 'insertCompositionText', data, true],
    ];
}
function confirm(data) {
    return [
        ['gap'],
        ['update', data],
        ['input', 'insertCompositionText', data, true],
        ['micro'],
        ['end'],
    ];
}
/** 한 키에서 받침이 빠지고 다음 글자가 같은 순간에 시작됩니다. */
function splitBatchim(kept, next, { commitText = false } = {}) {
    const steps = [
        ['gap'],
        ['update', kept],
        ['input', 'insertCompositionText', kept, true],
        ['end'],
    ];
    if (commitText) steps.push(['input', 'insertText', kept, false]);
    steps.push(['start'], ['update', next], ['input', 'insertCompositionText', next, true]);
    return steps;
}
/** 받침이 이미 있는 글자를 확정하고 새 첫소리를 같은 키에서 시작합니다. */
function commitAndStart(committed, next) {
    return [
        ['gap'],
        ['end'],
        ['input', 'insertText', committed, false],
        ['start'],
        ['update', next],
        ['input', 'insertCompositionText', next, true],
    ];
}
const words = [
    {
        name: '아아',
        keys: 4,
        steps: [
            ['start'],
            ...syllable('ㅇ'),
            ['gap'], ...syllable('아'),
            ['gap'], ...syllable('앙'),
            ...splitBatchim('아', '아'),
            ...confirm('아'),
        ],
    },
    {
        name: '나라',
        keys: 4,
        steps: [
            ['gap'], ['start'],
            ...syllable('ㄴ'),
            ['gap'], ...syllable('나'),
            ['gap'], ...syllable('날'),
            ...splitBatchim('나', '라', { commitText: true }),
            ...confirm('라'),
        ],
    },
    {
        name: '하하하',
        keys: 6,
        steps: [
            ['gap'], ['start'],
            ...syllable('ㅎ'),
            ['gap'], ...syllable('하'),
            ['gap'], ...syllable('핳'),
            ...splitBatchim('하', '하', { commitText: true }),
            ['gap'], ...syllable('핳'),
            ...splitBatchim('하', '하', { commitText: true }),
            ...confirm('하'),
        ],
    },
    {
        name: '사랑해',
        keys: 7,
        steps: [
            ['gap'], ['start'],
            ...syllable('ㅅ'),
            ['gap'], ...syllable('사'),
            ['gap'], ...syllable('살'),
            ...splitBatchim('사', '라', { commitText: true }),
            ['gap'], ...syllable('랑'),
            ...commitAndStart('랑', 'ㅎ'),
            ['gap'], ...syllable('해'),
            ...confirm('해'),
        ],
    },
    {
        name: '한글',
        keys: 6,
        steps: [
            ['gap'], ['start'],
            ...syllable('ㅎ'),
            ['gap'], ...syllable('하'),
            ['gap'], ...syllable('한'),
            ...commitAndStart('한', 'ㄱ'),
            ['gap'], ...syllable('그'),
            ['gap'], ...syllable('글'),
            ...confirm('글'),
        ],
    },
    {
        name: '안녕',
        keys: 6,
        steps: [
            ['gap'], ['start'],
            ...syllable('ㅇ'),
            ['gap'], ...syllable('아'),
            ['gap'], ...syllable('안'),
            ...commitAndStart('안', 'ㄴ'),
            ['gap'], ...syllable('녀'),
            ['gap'], ...syllable('녕'),
            ...confirm('녕'),
        ],
    },
    {
        name: 'ㅋㅋㅋ',
        keys: 3,
        steps: [
            ['gap'], ['start'],
            ...syllable('ㅋ'),
            ...commitAndStart('ㅋ', 'ㅋ'),
            ...commitAndStart('ㅋ', 'ㅋ'),
            ...confirm('ㅋ'),
        ],
    },
    {
        name: '학교에서',
        keys: 9,
        steps: [
            ['gap'], ['start'],
            ...syllable('ㅎ'),
            ['gap'], ...syllable('하'),
            ['gap'], ...syllable('학'),
            ...commitAndStart('학', 'ㄱ'),
            ['gap'], ...syllable('교'),
            ['gap'], ...syllable('굥'),
            ...splitBatchim('교', '에', { commitText: true }),
            ['gap'], ...syllable('엣'),
            ...splitBatchim('에', '서', { commitText: true }),
            ...confirm('서'),
        ],
    },
];
for (const word of words) {
    const sounds = await replayIme(word.steps);
    check(sounds === word.keys, `${word.name}는 ${word.keys}타인데 소리가 ${sounds}번입니다.`);
}
const safariHangul = await replayIme([
    ['gap'], ['start'],
    ...syllable('ㅎ'),
    ['gap'], ...syllable('하'),
    ['gap'], ...syllable('한'),
    ['gap'], ...syllable('한ㄱ'),
    ['gap'], ...syllable('한그'),
    ['gap'], ...syllable('한글'),
    ['gap'], ['end'],
    ['input', 'insertCompositionText', '한글', false],
]);
check(safariHangul === 6, `Safari에서 한글 6타에 소리가 ${safariHangul}번입니다.`);
noteCompositionStart();
let bareSafari = 0;
let bareAt = strokeAt + 80;
for (let i = 0; i < 6; i += 1) {
    bareAt += 80;
    if (acceptTypeInput({ inputType: 'insertCompositionText', isComposing: true, target: composing }, bareAt)) bareSafari += 1;
}
noteCompositionEnd();
bareAt += 80;
if (acceptTypeInput({ inputType: 'insertCompositionText', isComposing: false, target: composing }, bareAt)) bareSafari += 1;
check(bareSafari === 6, `Safari 조합 종료 알림에 소리가 ${bareSafari}번입니다.`);
const repeatAt = bareAt + 80;
check(noteTypeInput({ inputType: 'insertText', data: 'a', target: composing }, repeatAt) === true, '일반 글자에서 소리가 나지 않습니다.');
check(noteTypeInput({ inputType: 'insertText', data: 'b', target: composing }, repeatAt + 1) === false, '12ms 안의 같은 타를 두 번 울립니다.');
check(noteTypeInput({ inputType: 'insertText', data: 'c', target: composing }, repeatAt + 40) === true, '다음 글자 소리를 12ms 거름이 삼킵니다.');
noteCompositionStart();
check(shouldTypeSound({ inputType: 'insertCompositionText', data: 'ㄱ', target: fakeControl('INPUT', { type: 'text' }) }), '한글 조합 중에 글자 소리를 건너뜁니다.');
check(!shouldTypeSound({ inputType: 'insertFromComposition', target: fakeControl('INPUT', { type: 'text' }) }), '조합이 끝날 때 소리가 한 번 더 납니다.');
check(!shouldTypeSound({ inputType: 'insertText', target: fakeControl('INPUT', { type: 'password' }) }), '비밀번호 칸에서 글자 소리를 냅니다.');
check(!shouldTypeSound({ inputType: 'insertFromPaste', target: fakeControl('TEXTAREA') }), '붙여넣기에도 글자마다 소리를 내려 합니다.');
if (previousStorage === undefined) delete globalThis.localStorage;
else globalThis.localStorage = previousStorage;

const attendTarget = menuTarget('#/attend', '2026-10-26');
const attendRoute = resolveHash(attendTarget, '2026-10-26');
check(attendTarget === '#/attend/2026-10-26' && attendRoute.name === 'attend' && attendRoute.replace === '', '출결 메뉴가 날짜 주소로 바로 열리지 않습니다.');
check(menuSelected('attend', '#/attend') && !menuSelected('today', '#/attend'), '출결 화면에서 출결 메뉴가 켜지지 않습니다.');
check(menuSelected('student', '#/students') && menuSelected('legacy', '#/settings') && menuSelected('schedule', '#/schedule'), '다른 화면의 메뉴 선택이 꺼집니다.');
check(resolveHash('#/day/2026-10-26', '2026-10-19').name === 'day' && resolveHash('#/day/2026-10-26', '2026-10-19').params.date === '2026-10-26', '날짜 일지 주소가 열리지 않습니다.');
check(resolveHash('#/day', '2026-10-26').name === 'day' && resolveHash('#/day', '2026-10-26').params.date === '2026-10-26' && !resolveHash('#/day', '2026-10-26').notice, '날짜 없는 일지가 오늘로 이어지지 않습니다.');
const missingDay = resolveHash('#/day/2026-02-30', '2026-10-26');
check(missingDay.name === 'schedule' && missingDay.notice.includes('달력에 없어요'), '없는 날짜가 안내 없이 일정으로 갑니다.');
check(resolveHash('#/day/2026-10-26', '2026-10-19').notice === '', '있는 날짜 일지에 안내를 붙입니다.');
check(menuSelected('day', '#/schedule') && tabSelected('일정', 'day') && !menuSelected('day', '#/today'), '날짜 일지에서 일정 메뉴가 켜지지 않습니다.');
check(resolveHash('#/settings/roster', '2026-10-26').name === 'roster' && menuSelected('roster', '#/settings'), '명단 화면이 설정 메뉴에 속하지 않습니다.');

const hotStore = {
    map: new Map(),
    getItem(key) { return this.map.has(key) ? this.map.get(key) : null; },
    setItem(key, value) { this.map.set(key, String(value)); },
    removeItem(key) { this.map.delete(key); },
};
check(defaultHotkeys().plus === '/' && defaultHotkeys().help === '?' && defaultHotkeys().attend === '', '단축키 기본이 / 와 물음표가 아닙니다.');
check(loadHotkeys(hotStore).plus === '/', '저장된 값이 없어도 콕이 / 가 아닙니다.');
const moved = assignHotkey(loadHotkeys(hotStore), 'attend', '/');
check(moved.movedFrom === '콕 열기' && moved.map.attend === '/' && moved.map.plus === '', '겹치는 키를 콕에 그대로 둡니다.');
check(hotkeyFromEvent({ key: 'A' }) === 'a' && hotkeyFromEvent({ key: 'k', ctrlKey: true }) === '', 'Ctrl 조합이나 대문자를 그대로 받습니다.');
check(hotkeyFromEvent({ key: 'F3' }) === '' && hotkeyFromEvent({ key: 'F6' }) === '' && hotkeyFromEvent({ key: 'F5' }) === '' && hotkeyFromEvent({ key: 'F12' }) === '', '브라우저 기능키를 단축키로 받습니다.');
check(hotkeyFromEvent({ key: 'F8' }) === 'F8' && isStoredHotkey('F8') && !isStoredHotkey('F3') && !isStoredHotkey('F6'), '브라우저가 쓰지 않는 기능키까지 막거나, 막은 키를 저장합니다.');
check(passesThroughCapture({ key: 'Tab' }) && passesThroughCapture({ key: 'Tab', shiftKey: true }) && passesThroughCapture({ key: 'Shift' }) && passesThroughCapture({ key: 'Control' }) && passesThroughCapture({ key: 'Alt' }) && passesThroughCapture({ key: 'Meta' }) && !passesThroughCapture({ key: 'a' }), 'Shift+Tab이나 수정 키가 단축키 칸에 갇힙니다.');
check(shortcutBlocked({ key: 'a', target: fakeControl('INPUT', { type: 'text' }) }), '글자 칸에서 단축키가 먹습니다.');
check(shortcutBlocked({ key: 'Process', isComposing: true, target: { tagName: 'BODY' } }), '한글 조합 중에 단축키가 먹습니다.');
check(matchHotkey({ key: '/', target: { tagName: 'BODY' } }, defaultHotkeys()) === 'plus', '/ 키가 콕을 열지 않습니다.');
check(matchHotkey({ key: '/', target: fakeControl('TEXTAREA') }, defaultHotkeys()) === '', '글자 칸의 / 가 콕을 엽니다.');
saveHotkeys(moved.map, hotStore);
check(loadHotkeys(hotStore).attend === '/' && loadHotkeys(hotStore).plus === '', '옮긴 단축키가 저장되지 않습니다.');
resetHotkeys(hotStore);
check(loadHotkeys(hotStore).plus === '/' && loadHotkeys(hotStore).attend === '', '기본값으로 되돌리기가 남지 않습니다.');
hotStore.setItem('ssug-gyomu-hotkeys', JSON.stringify({ plus: 'F6', attend: '/' }));
const legacyKeys = loadHotkeys(hotStore);
const legacyValues = Object.values(legacyKeys).filter(Boolean);
check(legacyKeys.attend === '/' && legacyKeys.plus === '' && legacyKeys.help === '?' && new Set(legacyValues).size === legacyValues.length, '예전 F6 저장이 콕과 출결을 같은 / 로 겹치게 합니다.');
check(matchHotkey({ key: '/', target: { tagName: 'BODY' } }, legacyKeys) === 'attend', '겹친 / 가 콕을 엽니다.');
const freshDefaults = resetHotkeys(hotStore);
const freshValues = Object.values(freshDefaults).filter(Boolean);
check(freshDefaults.plus === '/' && freshDefaults.attend === '' && freshDefaults.help === '?' && new Set(freshValues).size === freshValues.length, '기본으로 되돌리면 같은 키가 두 동작에 걸립니다.');
check(kokHotkeyHint(defaultHotkeys()) === '기본으로 / 키를 누르면 콕이 열려요. 설정에서 바꿀 수 있어요.', '기본 콕 안내가 달라졌습니다.');
check(kokHotkeyHint(legacyKeys) === '콕 여는 키는 아직 없어요. 설정에서 정해 주시면 돼요.' && !kokHotkeyHint(legacyKeys).includes('/'), '콕 키가 없는데 사이드바가 빗금을 말합니다.');
check(kokHotkeyHint({ ...defaultHotkeys(), plus: 'a' }) === 'A 키를 누르면 콕이 열려요. 설정에서 바꿀 수 있어요.', '바꾼 콕 키를 사이드바가 따라가지 않습니다.');
check(hotkeyFootnote(legacyKeys).includes('아직 없어요') && !hotkeyFootnote(legacyKeys).includes('/ 키'), '콕 키가 없는데 단축키 안내가 빗금을 말합니다.');
check(hotkeyFootnote(defaultHotkeys()).includes('?') && hotkeyFootnote(defaultHotkeys()).includes('/'), '기본 단축키 안내가 빠졌습니다.');
check(hotkeyPhoneNote(legacyKeys).includes('아직 없어요') && !hotkeyPhoneNote(legacyKeys).includes('/'), '콕 키가 없는데 휴대폰 안내가 빗금을 말합니다.');

const bits = readFileSync(`${root}/src/ui/bits.jsx`, 'utf8');
const ledgerPath = 'M1466 0H186V206H1214L1212 326L136 350L168 558L1198 514C1191 581 1179 654 1162 734L1414 750C1466 518 1466 340 1466 170ZM1652 826H874V622H618V826H0V1028H1652ZM1454 1166H168V1366H1200V1774H1454Z';
check(bits.includes('viewBox="0 0 1652 1774"'), '콕 글자 틀이 가계부와 다릅니다.');
check(bits.includes(ledgerPath), '콕 글자 윤곽이 가계부와 다릅니다.');
const appText = readFileSync(`${root}/src/App.jsx`, 'utf8');
check(appText.includes('콕, 누를 때 소리가 나요') && appText.includes('>끄기<'), '소리 안내 문구가 없습니다.');
check(/const onKey = \(event\) => \{\n\s+if \(locked\) return;/.test(appText), '잠금 중에 단축키가 먹습니다.');
check(appText.includes('compositionupdate') && appText.includes('noteCompositionUpdate(event?.data)'), '조합이 바뀌는 글자를 기록하지 않습니다.');
check(appText.includes('if (noteTypeInput(event)) playTypeSound();'), '글자 소리를 조합이 끝난 뒤에 미루면 마이크로태스크가 먼저 울립니다.');
check(!appText.includes('finishTypeSoundTurn') && !appText.includes('queueMicrotask'), '동작하지 않는 소리 미루기가 남아 있습니다.');
check(!appText.includes('기본으로 / 키를 누르면 콕이 열려요'), '사이드바 콕 안내가 저장된 키를 따라가지 않습니다.');
check(appText.includes('kokHotkeyHint(hotkeys)'), '사이드바가 콕 키 안내를 그리지 않습니다.');
const typeText = readFileSync(`${root}/src/ui/typesound.js`, 'utf8');
check(typeText.includes('function noteCompositionUpdate') && !typeText.includes('dropHeld') && !typeText.includes('finishTypeSoundTurn') && !typeText.includes('heldStroke'), '받침이 넘어갈 때 소리를 미루는 옛 경로가 남아 있습니다.');
const formText = readFileSync(`${root}/src/ui/HotkeyForm.jsx`, 'utf8');
check(formText.includes('hotkeyFootnote(map)') && formText.includes('hotkeyPhoneNote(map)'), '단축키 안내가 저장된 키를 따라가지 않습니다.');
check(!formText.includes('기본으로는 / 키가 콕을 엽니다.') && !formText.includes('휴대폰에서는 기본으로 / 키가 콕을 엽니다.'), '단축키 화면에 빗금 안내가 고정되어 있습니다.');
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

    mainStore.heal();
    localStore.heal();
    const blank = await saveTextItem('notes', { id: 'day-blank', text: '   ', date: '2026-11-03', source: 'app' });
    check(blank?.ok === false && !snapshot().notes.some((row) => row.id === 'day-blank') && !snapshot().local.notes.some((row) => row.id === 'day-blank'), '빈 메모가 기록으로 남습니다.');

    async function expectOneSide(bucket, id, where) {
        const cloud = (snapshot()[bucket] || []).filter((row) => row.id === id);
        const local = (snapshot().local[bucket] || []).filter((row) => row.id === id);
        check(where === 'cloud' ? cloud.length === 1 && local.length === 0 : cloud.length === 0 && local.length === 1, `${bucket} ${id} 가 ${where} 한쪽에만 있지 않습니다. 클라우드 ${cloud.length}, 기기 ${local.length}`);
        return where === 'cloud' ? cloud[0] : local[0];
    }
    await saveTextItem('notes', { id: 'day-qa', text: '일반 메모', date: '2026-11-03', pinned: false, source: 'app' });
    await expectOneSide('notes', 'day-qa', 'cloud');
    await saveTextItem('notes', { id: 'day-qa', text: '학폭 관련 민원 상담', date: '2026-11-03', pinned: false, source: 'app' });
    const hiddenNote = await expectOneSide('notes', 'day-qa', 'local');
    check(hiddenNote?.text === '학폭 관련 민원 상담' && toCloudRow('notes', hiddenNote) === null, '민감 메모를 클라우드 모양으로 올립니다.');
    await saveTextItem('notes', { id: 'day-qa', text: '다시 일반', date: '2026-11-03', pinned: false, source: 'app' });
    const restoredNote = await expectOneSide('notes', 'day-qa', 'cloud');
    check(restoredNote?.text === '다시 일반' && toCloudRow('notes', restoredNote) !== null, '일반 메모로 되돌리면 기기 사본이 남거나 클라우드로 가지 않습니다.');

    await saveTextItem('todos', { id: 'todo-qa', title: '준비물 걷기', done: false, due: '2026-11-04', source: 'app' });
    await expectOneSide('todos', 'todo-qa', 'cloud');
    await saveTextItem('todos', { id: 'todo-qa', title: '학폭 관련 민원 상담', done: false, due: '2026-11-04', source: 'app' });
    const hiddenTodo = await expectOneSide('todos', 'todo-qa', 'local');
    check(toCloudRow('todos', hiddenTodo) === null, '민감 할 일을 클라우드로 보냅니다.');
    await saveTextItem('todos', { id: 'todo-qa', title: '준비물 다시 걷기', done: false, due: '2026-11-04', source: 'app' });
    await expectOneSide('todos', 'todo-qa', 'cloud');

    await saveTextItem('records', { id: 'rec-qa', date: '2026-11-04', kind: '상담', text: '이야기를 들었어요', tags: ['교우'], source: 'app' });
    await expectOneSide('records', 'rec-qa', 'cloud');
    await saveTextItem('records', { id: 'rec-qa', date: '2026-11-04', kind: '상담', text: '학폭 관련 민원 상담', tags: ['교우'], source: 'app' });
    const hiddenRecord = await expectOneSide('records', 'rec-qa', 'local');
    check(toCloudRow('records', hiddenRecord) === null, '민감 상담을 클라우드로 보냅니다.');
    await saveTextItem('records', { id: 'rec-qa', date: '2026-11-04', kind: '상담', text: '다시 이야기를 들었어요', tags: ['교우'], source: 'app' });
    await expectOneSide('records', 'rec-qa', 'cloud');

    await saveQuick({ text: '준비물 가위', kind: '알림장', date: '2026-11-09' });
    await expectOneSide('notices', '2026-11-09', 'cloud');
    await saveQuick({ text: '학폭 관련 민원 상담', kind: '알림장', date: '2026-11-09' });
    const hiddenNotice = await expectOneSide('notices', '2026-11-09', 'local');
    check(String(hiddenNotice?.text || '').includes('준비물 가위') && String(hiddenNotice?.text || '').includes('학폭') && toCloudRow('notices', hiddenNotice) === null, '민감 알림장이 클라우드에 남거나 이전 글을 잃습니다.');
    await saveTextItem('notices', { id: '2026-11-09', date: '2026-11-09', text: '내일은 소풍', source: 'app' });
    await expectOneSide('notices', '2026-11-09', 'cloud');

    const counsel = await saveQuick({ text: '학폭 관련 민원 상담', kind: '상담', no: 1, date: '2026-11-10' });
    check(counsel.ok && !snapshot().records.some((row) => String(row.text).includes('학폭')) && snapshot().local.records.some((row) => String(row.text).includes('학폭')), '상담 저장이 민감 기록을 이 기기로 보내지 않습니다.');
    const counselRow = snapshot().local.records.find((row) => String(row.text).includes('학폭'));
    check(toCloudRow('records', counselRow) === null, '기기 상담을 클라우드 기록으로 바꿉니다.');
})().catch((error) => {
    failures.push(error?.message || String(error));
});

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('품질 검사를 통과했습니다.');
