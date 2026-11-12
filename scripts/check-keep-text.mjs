/**
 * 글·자료 유실 방지 검사(패키지 없이 node로 돕니다).
 * 1. 알림장·하루 메모 쓰던 글 임시본(textDraft.js, db.js 감싸기): 남기기·되살리기·계정 가르기·공용 컴퓨터·모두 지우기.
 * 2. 백업: 이 기기 전용 할 일·일정·메모·알림장·연락처·쪽, 학사일정·고친 날·마감한 날·목표·교시 설정이
 *    내보내기에 들어가고 바꾸기·합치기로 되살아나는지. 예전 판 백업도 받고, 이 기기 자료를 지우지 않는지.
 * 3. 화면 코드(JSX는 실행할 수 없어 글로 봅니다): 알림장 ‹ › 가 글을 비우지 않음, 한글 Enter 막기, 되돌리기 알림.
 */
import { readFileSync } from 'node:fs';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

const store = new Map();
globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    get length() { return store.size; },
    key: (i) => [...store.keys()][i] ?? null,
};

const draft = await import('../src/lib/textDraft.js');
const backup = await import('../src/lib/backup.js');
const db = await import('../src/lib/db.js');
const { PERIOD_LOCAL_KEY, readPeriodLocal } = await import('../src/lib/periodLocal.js');

/* ---------- 1. 임시본 (순수 함수) ---------- */
{
    const box = draft.memoryStore();
    const opt = { store: box, owner: 'A' };
    const key = draft.textDraftKey('notice', '2026-11-13');
    check(key === 'notice:2026-11-13', '임시본 칸 이름이 다릅니다.');
    check(draft.textDraftKey('notice', '../x') === '' && !draft.writeTextDraft('', { text: 'x' }, opt), '이상한 날짜로 임시본을 남깁니다.');
    check(draft.writeTextDraft(key, { text: '준비물: 색연필', base: '' }, opt) === true, '쓰던 글을 남기지 못했습니다.');
    check(draft.readTextDraft(key, opt)?.text === '준비물: 색연필', '남긴 글을 다시 읽지 못했습니다.');
    check(draft.readTextDraft(key, { store: box, owner: 'B' }) === null, '다른 계정이 남긴 글이 보입니다.');
    check(draft.readTextDraft(key, { store: box, owner: 'B' }) === null && draft.readTextDraft(key, opt) !== null, '다른 계정으로 읽을 때 임시본이 지워졌습니다.');
    const same = draft.writeTextDraft(key, { text: '저장된 글', base: '저장된 글' }, opt);
    check(same === false && draft.readTextDraft(key, opt) === null, '저장한 글과 같아졌는데 임시본이 남습니다.');
    draft.writeTextDraft(key, { text: '다시 씀', base: '' }, opt);
    draft.writeTextDraft(key, { text: '   ', base: '' }, opt);
    check(draft.readTextDraft(key, opt) === null, '빈 칸을 임시본으로 남깁니다.');
    const start1 = draft.startText({ text: '쓰던 글' }, '저장된 글');
    const start2 = draft.startText({ text: '저장된 글' }, '저장된 글');
    const start3 = draft.startText(null, '저장된 글');
    check(start1.restored && start1.text === '쓰던 글', '쓰던 글을 되살리지 않습니다.');
    check(!start2.restored && start2.text === '저장된 글' && !start3.restored && start3.text === '저장된 글', '되살릴 것이 없는데 되살립니다.');
    for (let i = 1; i <= draft.TEXT_DRAFT_MAX + 5; i += 1) {
        draft.writeTextDraft(draft.textDraftKey('day', `2026-01-${String((i % 28) + 1).padStart(2, '0')}`), { text: `메모 ${i}` }, { ...opt, now: i });
        draft.writeTextDraft(draft.textDraftKey('notice', `2026-02-${String((i % 28) + 1).padStart(2, '0')}`), { text: `알림 ${i}` }, { ...opt, now: 1000 + i });
    }
    const all = JSON.parse(box.getItem(draft.TEXT_DRAFT_KEY));
    check(Object.keys(all).length === draft.TEXT_DRAFT_MAX, `임시본이 ${draft.TEXT_DRAFT_MAX}개를 넘게 쌓입니다(${Object.keys(all).length}).`);
    /* 알림장 28칸이 더 나중이므로 모두 남고, 하루 메모는 가장 최근 2칸만 남아야 합니다. */
    const dayKeys = Object.keys(all).filter((k) => k.startsWith('day:'));
    check(Object.keys(all).filter((k) => k.startsWith('notice:')).length === 28 && dayKeys.length === 2 && dayKeys.every((k) => Number(all[k].at) >= draft.TEXT_DRAFT_MAX + 4), `가장 오래된 임시본부터 버리지 않습니다: ${dayKeys.join(',')}`);
    draft.clearAllTextDrafts({ store: box });
    check(box.getItem(draft.TEXT_DRAFT_KEY) === null, '모든 임시본 지우기가 안 됩니다.');
    const broken = draft.memoryStore();
    broken.setItem(draft.TEXT_DRAFT_KEY, '{망가진');
    check(draft.readTextDraft(key, { store: broken }) === null && draft.writeTextDraft(key, { text: 'a' }, { store: broken }) === true, '망가진 임시본 때문에 새 글을 못 남깁니다.');
    const full = { getItem: () => null, setItem: () => { throw new Error('QuotaExceededError'); }, removeItem: () => {} };
    check(draft.writeTextDraft(key, { text: 'a' }, { store: full }) === false, '저장 공간이 가득 찼을 때 오류가 밖으로 나옵니다.');
}

/* ---------- 2. 백업 ---------- */
const plainVault = () => { const map = new Map(); return { map, get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };
db.useVaultsForTest(plainVault(), plainVault(), plainVault());
db.useCloudForTest({ available: () => false, push: async () => ({}), pull: async () => null, remove: async () => {} });
await db.boot('');

/* db.js 감싸기: 손님(계정 없음)으로 남긴 글은 손님일 때만 보입니다. */
{
    const key = draft.textDraftKey('day', '2026-11-12');
    db.keepTextDraft(key, '나이스 전에 확인', '');
    check(db.takeTextDraft(key)?.text === '나이스 전에 확인', 'db.js 임시본 감싸기가 글을 되살리지 못합니다.');
    check(store.has(draft.TEXT_DRAFT_KEY), '평소에는 임시본을 localStorage에 동기로 남겨야 합니다.');
    db.dropTextDraft(key);
    check(db.takeTextDraft(key) === null, 'db.js 임시본 지우기가 안 됩니다.');
    db.keepTextDraft(key, '지울 글', '');
    await db.clearAll();
    check(!store.has(draft.TEXT_DRAFT_KEY) && db.takeTextDraft(key) === null, '모두 지우기 뒤에도 쓰던 글 임시본이 남습니다.');
}

const LOCAL = {
    records: [{ id: 'lr1', date: '2026-11-10', kind: '상담', sid: 's1', text: '알레르기 상담', tags: ['교우'] }],
    todos: [{ id: 'lt1', title: '보건실 투약 확인', done: false, due: '2026-11-13' }],
    events: [{ id: 'le1', date: '2026-11-14', title: '보건 상담', kind: '학급' }],
    notes: [{ id: 'ln1', text: '민원 전화 메모', date: '', pinned: true }],
    notices: [{ id: '2026-11-13', date: '2026-11-13', text: '투약 의뢰서 내기' }],
    contacts: [{ id: 'lc1', sid: 's1', label: '보호자', value: '010-0000-0000' }],
    pages: [{ id: 'lp1', page: 3, text: '예전 쪽' }],
};
await db.finishSetup({ className: '6학년 3반', rosterText: '1 김하늘\n2 이하은' });
await db.update((d) => {
    d.local = { ...d.local, ...structuredClone(LOCAL) };
    d.todos.push({ id: 't1', title: '동의서 걷기', done: false, due: '2026-11-13' });
    d.profile.schoolYear = 2026;
    d.profile.academic = { 2026: { firstStart: '2026-03-02', firstEnd: '2026-07-24', offDays: ['2026-05-04'] } };
    d.profile.ttEdited = ['2026-11-10'];
    d.profile.checkedDates = ['2026-11-11', '2026-11-12'];
    d.goals = { n: 5, nAt: 1700000000000, days: { '2026-11-11': { c: 5, g: 5, at: 1700000000001 } } };
    return d;
});
const academicBefore = JSON.stringify(db.snapshot().profile.academic);
check(academicBefore.includes('2026-07-24'), `학사일정을 준비하지 못했습니다: ${academicBefore}`);
store.set(PERIOD_LOCAL_KEY, JSON.stringify({ level: '중', count: 7, lengths: [45, 45], extraStarts: ['16:40', '17:30'], locks: [7], cellLocks: ['mon-6'], workStart: '08:30', workEnd: '16:40', extra: { mon: { p9: '방과후' } }, syncAt: 5, syncAts: { period: 5, extra: 5, work: 5 } }));

const fullFile = db.exportFile(true);
check(fullFile.profile?.academic?.['2026']?.firstEnd === '2026-07-24', '내보내기에 학사일정이 없습니다.');
check(JSON.stringify(fullFile.profile?.ttEdited) === '["2026-11-10"]', '내보내기에 고친 시간표 날(ttEdited)이 없습니다.');
check(JSON.stringify(fullFile.profile?.checkedDates) === '["2026-11-11","2026-11-12"]', '내보내기에 출결 마감한 날(checkedDates)이 없습니다.');
check(fullFile.goals?.n === 5 && fullFile.goals?.days?.['2026-11-11']?.c === 5, '내보내기에 목표가 없습니다.');
check(fullFile.periodLocal?.count === 7 && fullFile.periodLocal?.extra?.mon?.p9 === '방과후' && fullFile.periodLocal?.workStart === '08:30', '내보내기에 교시 설정(periodLocal)이 없습니다.');
check(fullFile.periodLocal && !('syncAt' in fullFile.periodLocal) && !('syncAts' in fullFile.periodLocal), '교시 설정의 고친 시각까지 내보냅니다.');
check(fullFile.version === 1, '백업 판 번호가 바뀌어 예전 앱이 새 파일을 못 읽습니다.');
for (const key of Object.keys(LOCAL)) check(fullFile.local?.[key]?.length === 1, `내보내기에 이 기기 전용 ${key}가 없습니다.`);
const outsideFile = db.exportFile(false);
check(!outsideFile.local, '이 기기 자료를 빼고 내보내기에 이 기기 자료가 들어갑니다.');
const fullText = JSON.stringify(fullFile);

/* 바꾸기: 모두 지운 뒤 되살립니다. */
await db.clearAll();
store.delete(PERIOD_LOCAL_KEY);
let result = await db.importText(fullText, 'replace');
check(result.ok, `바꾸기가 실패했습니다: ${(result.errors || []).join(' ')}`);
let now = db.snapshot();
for (const [key, rows] of Object.entries(LOCAL)) check(now.local[key]?.some((row) => row.id === rows[0].id), `바꾸기 뒤 이 기기 전용 ${key}가 되살아나지 않았습니다.`);
check(now.todos.some((row) => row.id === 't1'), '바꾸기 뒤 할 일이 없습니다.');
check(now.profile.academic?.['2026']?.firstEnd === '2026-07-24', '바꾸기 뒤 학사일정이 없습니다.');
check(JSON.stringify(now.profile.ttEdited) === '["2026-11-10"]' && JSON.stringify(now.profile.checkedDates) === '["2026-11-11","2026-11-12"]', '바꾸기 뒤 고친 날·마감한 날이 없습니다.');
check(now.goals?.n === 5 && now.goals?.days?.['2026-11-11']?.c === 5, '바꾸기 뒤 목표가 없습니다.');
check(Number(now.profile.settingsAts?.academic) > 0 && Number(now.profile.settingsAts?.ttEdited) > 0, '바꾸기로 되살린 학사일정·고친 날의 고친 시각을 찍지 않아 클라우드 옛 값에 밀릴 수 있습니다.');
let period = readPeriodLocal();
check(period.count === 7 && period.level === '중' && period.extra?.mon?.p9 === '방과후' && period.workEnd === '16:40' && period.locks.includes(7) && period.cellLocks.includes('mon-6'), `바꾸기 뒤 교시 설정이 되살아나지 않았습니다: ${JSON.stringify(period)}`);
check(Number(period.syncAt) > 5, '되살린 교시 설정의 고친 시각을 새로 찍지 않았습니다.');
check(db.snapshot().local.records.length === 1, '이 기기 기록이 겹쳐 들어갔습니다.');

/* 예전 판 백업(새 칸·이 기기 자료 없음)으로 바꾸기: 받기는 하고, 이 기기 전용 자료·새 칸은 지우지 않습니다. */
const oldFile = JSON.parse(fullText);
delete oldFile.local;
delete oldFile.goals;
delete oldFile.periodLocal;
oldFile.profile = { className: '6학년 3반', schoolYear: 2026, classSize: 2, periodStarts: oldFile.profile.periodStarts };
oldFile.todos = [{ id: 't-old', title: '예전 할 일', done: false, due: '' }];
result = await db.importText(JSON.stringify(oldFile), 'replace');
check(result.ok, `예전 판 백업을 받지 않습니다: ${(result.errors || []).join(' ')}`);
now = db.snapshot();
check(now.todos.length === 1 && now.todos[0].id === 't-old', '예전 판 백업으로 바꾸기가 할 일을 바꾸지 않았습니다.');
for (const [key, rows] of Object.entries(LOCAL)) check(now.local[key]?.some((row) => row.id === rows[0].id), `이 기기 자료가 없는 백업으로 바꾸기에서 이 기기 전용 ${key}가 지워졌습니다.`);
check(now.profile.academic?.['2026']?.firstEnd === '2026-07-24' && now.goals?.n === 5 && now.profile.checkedDates.length === 2, '예전 판 백업이 학사일정·목표·마감한 날을 지웠습니다.');

/* 합치기: 파일의 이 기기 자료를 더하고, 날짜 목록은 합칩니다. */
await db.update((d) => {
    d.local.todos = [{ id: 'lt2', title: '지금 기기의 할 일', done: false, due: '' }];
    d.profile.checkedDates = ['2026-11-01'];
    d.goals = { n: 3, nAt: 1800000000000, days: {} };
    return d;
});
result = await db.importText(fullText, 'merge');
check(result.ok, `합치기가 실패했습니다: ${(result.errors || []).join(' ')}`);
now = db.snapshot();
check(now.local.todos.some((r) => r.id === 'lt1') && now.local.todos.some((r) => r.id === 'lt2'), '합치기가 이 기기 전용 할 일을 합치지 않았습니다.');
check(JSON.stringify(now.profile.checkedDates) === '["2026-11-01","2026-11-11","2026-11-12"]', `합치기가 마감한 날을 합치지 않았습니다: ${JSON.stringify(now.profile.checkedDates)}`);
check(now.goals.n === 3 && now.goals.days['2026-11-11']?.c === 5, '합치기가 목표를 늦게 고친 쪽 기준으로 합치지 않았습니다.');

/* 바꾸기 전 안전 백업에는 교시 설정도 들어갑니다. */
check(now.local.backup?.payload?.periodLocal?.count === 7 && now.local.backup?.payload?.periodLocal?.extra?.mon?.p9 === '방과후', `바꾸기 전 안전 백업에 교시 설정이 없습니다: ${JSON.stringify(now.local.backup?.payload?.periodLocal)}`);

/* 합치기는 학년도·교시 설정을 덮지 않고, 비어 있을 때만 넣습니다. 바꾸기는 파일 값으로 바꿉니다. */
{
    const other = JSON.parse(fullText);
    other.profile.schoolYear = 2025;
    other.profile.className = '5학년 1반';
    other.periodLocal = { level: '초', count: 5, lengths: [40], extraStarts: ['16:00', '16:50'], locks: [], cellLocks: [], workStart: '08:10', workEnd: '16:30', extra: { mon: { p9: '다른 과목', p10: '보충' } } };
    await db.update((d) => { d.profile.schoolYear = 2026; d.profile.className = '6학년 3반'; return d; });
    result = await db.importText(JSON.stringify(other), 'merge');
    check(result.ok, '합치기(설정 다른 파일)가 실패했습니다.');
    const p1 = readPeriodLocal();
    check(db.snapshot().profile.schoolYear === 2026, `합치기가 학년도를 바꿨습니다: ${db.snapshot().profile.schoolYear}`);
    check(db.snapshot().profile.className === '6학년 3반', `합치기가 학급 이름을 바꿨습니다: ${db.snapshot().profile.className}`);
    check(p1.count === 7 && p1.level === '중' && p1.workStart === '08:30' && p1.extra.mon.p9 === '방과후' && JSON.stringify(p1.lengths) === '[45,45]', `합치기가 교시 설정을 덮었습니다: ${JSON.stringify(p1)}`);
    check(p1.extra.mon.p10 === '보충', `합치기가 비어 있던 10교시 과목을 넣지 않았습니다: ${JSON.stringify(p1.extra)}`);
    /* 이 기기 교시 설정이 비어 있으면 합치기도 넣습니다. */
    store.delete(PERIOD_LOCAL_KEY);
    result = await db.importText(JSON.stringify(other), 'merge');
    const p2 = readPeriodLocal();
    check(p2.count === 5 && p2.workStart === '08:10' && p2.extra.mon.p9 === '다른 과목' && JSON.stringify(p2.lengths) === '[40]', `비어 있던 교시 설정을 합치기가 넣지 않았습니다: ${JSON.stringify(p2)}`);
    check(backup.fillPeriodLocal({ count: 6, level: '초', syncAt: 9, syncAts: { period: 9 } }, { count: 5 }) === null, '이 기기에서 고친 교시 수(기본값과 같아도)를 합치기가 덮습니다.');
    /* 바꾸기는 파일 값으로 */
    store.set(PERIOD_LOCAL_KEY, JSON.stringify({ level: '중', count: 7, workStart: '08:30', syncAt: 5, syncAts: { period: 5, extra: 5, work: 5 } }));
    result = await db.importText(JSON.stringify(other), 'replace');
    const p3 = readPeriodLocal();
    check(result.ok && db.snapshot().profile.schoolYear === 2025 && p3.count === 5 && p3.workStart === '08:10', `바꾸기가 파일 설정으로 바꾸지 않았습니다: ${db.snapshot().profile.schoolYear} ${JSON.stringify(p3)}`);
    check(db.snapshot().local.backup?.payload?.periodLocal?.count === 7, '바꾸기 전 안전 백업에 바꾸기 전 교시 설정이 없습니다.');
    check(backup.incomingSettings({ profile: { schoolYear: 2026 } }, { profile: { schoolYear: 2025 } }, 'merge').profile.schoolYear === 2026, '합치기 학년도(순수 함수)');
    check(backup.incomingSettings({ profile: {} }, { profile: { schoolYear: 2025 } }, 'merge').profile.schoolYear === 2025, '비어 있던 학년도를 합치기가 넣지 않습니다.');
}

/* 합치기: 학생은 이 기기의 active 값을 지키고, 같은 번호 지금 반 학생이 겹치면 뒤에 들어온 쪽을 지난 명단으로 둡니다. */
{
    await db.update((d) => {
        d.students = [
            { id: 's1', no: 1, name: '김하늘', active: true },
            { id: 's2', no: 2, name: '이하은', active: false },
            { id: 's2-new', no: 2, name: '박새봄', active: true },
        ];
        d.profile.classSize = 2;
        return d;
    });
    const file = JSON.parse(fullText);
    file.students = [
        { id: 's1', no: 1, name: '김하늘', active: true },
        { id: 's2', no: 2, name: '이하은', active: true, memo: '파일 메모' },
        { id: 's3', no: 3, name: '정다온', active: true },
        { id: 's9', no: 1, name: '최겹침', active: true },
    ];
    result = await db.importText(JSON.stringify(file), 'merge');
    const list = db.snapshot().students;
    const by = Object.fromEntries(list.map((r) => [r.id, r]));
    check(by.s2?.active === false && by.s2?.memo === '파일 메모', `합치기가 지난 명단 학생을 다시 지금 반으로 만들었습니다: ${JSON.stringify(by.s2)}`);
    check(by['s2-new']?.active === true && by.s3?.active === true && by.s1?.active === true, `지금 반 학생이 빠졌습니다: ${JSON.stringify(list)}`);
    check(by.s9?.active === false && result.parked === 1 && /지난 명단/.test(result.message || ''), `같은 번호 지금 반 학생이 둘입니다: ${JSON.stringify(by.s9)} ${result.message}`);
    const activeNos = list.filter((r) => r.active !== false).map((r) => r.no);
    check(new Set(activeNos).size === activeNos.length, `같은 번호 지금 반 학생이 남았습니다: ${activeNos}`);
    check(db.snapshot().profile.classSize === 3, `반 인원이 지난 명단 학생까지 셉니다: ${db.snapshot().profile.classSize}`);
}

/* 아주 예전 교무수첩 백업(notebookFields)도 그대로 받습니다. */
const legacy = backup.validateBackupText(JSON.stringify({ exportedAt: '2024-03-01', notebookFields: { 3: { a: 'b' } } }));
check(legacy.ok && legacy.kind === 'legacy', '예전 교무수첩 백업 형식을 더는 받지 않습니다.');

/* 모양이 이상한 새 칸은 막습니다. */
const bad = JSON.parse(fullText);
bad.local.todos = { id: 'x' };
check(!backup.validateBackupText(JSON.stringify(bad)).ok, '이 기기 전용 목록이 배열이 아닌데 받습니다.');
const bad2 = JSON.parse(fullText);
bad2.profile.checkedDates = 'all';
check(!backup.validateBackupText(JSON.stringify(bad2)).ok, '마감한 날 목록이 이상한데 받습니다.');
check(backup.cleanPeriodLocal({ count: 99, level: '대', extraStarts: ['25:00'], extra: { mon: { p9: '가', x: 'y' }, evil: { p9: 'z' } } })?.count === undefined, '교시 수 범위를 보지 않습니다.');
const cleaned = backup.cleanPeriodLocal({ extraStarts: ['25:00', '17:00'], extra: { mon: { p9: '가', x: 'y' }, evil: { p9: 'z' } } });
check(cleaned.extraStarts[0] === '' && cleaned.extraStarts[1] === '17:00' && JSON.stringify(cleaned.extra) === '{"mon":{"p9":"가"}}', `교시 설정 모양 걸러내기가 다릅니다: ${JSON.stringify(cleaned)}`);

/* 공용 컴퓨터 모드에서는 쓰던 글을 이 기기(localStorage)에 남기지 않습니다. */
{
    await db.patchProfile({ sharedPc: true }, { wipe: true });
    store.delete(draft.TEXT_DRAFT_KEY);
    const key = draft.textDraftKey('notice', '2026-11-20');
    db.keepTextDraft(key, '공용 컴퓨터에서 쓰는 글', '');
    check(db.takeTextDraft(key)?.text === '공용 컴퓨터에서 쓰는 글', '공용 컴퓨터 모드에서 화면을 오가면 쓰던 글이 사라집니다.');
    check(!store.has(draft.TEXT_DRAFT_KEY), '공용 컴퓨터 모드인데 쓰던 글을 localStorage에 남깁니다.');
    await db.patchProfile({ sharedPc: false });
}

/* ---------- 3. 화면 코드 ---------- */
const read = (file) => readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8');
const tasks = read('Tasks.jsx');
const day = read('Day.jsx');
const students = read('Students.jsx');
check(!/setText\(''\);\s*go\(/.test(tasks), '알림장 ‹ › 가 아직 쓰던 글을 비우고 옮깁니다.');
check(/aria-label="이전 날" onClick=\{\(\) => moveTo\(/.test(tasks) && /aria-label="다음 날" onClick=\{\(\) => moveTo\(/.test(tasks), '알림장 ‹ › 가 임시본을 남기고 옮기지 않습니다.');
check(tasks.includes("takeTextDraft(draftKey)") && tasks.includes("addEventListener('pagehide', keepDraft, true)") && tasks.includes('setTimeout(keepDraft, 300)'), '알림장에 0.3초 임시 저장·앱 숨길 때 저장·되살리기가 없습니다.');
check(day.includes("textDraftKey('day', date)") && day.includes('takeTextDraft(draftKey)') && /visibilitychange', onHide, true/.test(day) && day.includes('setTimeout(() => keepMemo(), 300)'), '하루 메모에 임시 저장·되살리기가 없습니다.');
check(/aria-label="이전 날" onClick=\{\(\) => moveDay\(-1\)\}/.test(day) && /aria-label="다음 날" onClick=\{\(\) => moveDay\(1\)\}/.test(day), '하루 메모 화면 ‹ › 가 임시본을 남기고 옮기지 않습니다.');
check(/removeItem\('todos', row\.id\);\s*if \(!failed\?\.storageFailed\) showToast\('할 일을 지웠어요\.', true\)/.test(day), '하루 화면 할 일 지우기에 되돌리기가 없습니다.');
check(/removeItem\('notes', row\.id\);\s*if \(!failed\?\.storageFailed\) showToast\('메모를 지웠어요\.', true\)/.test(tasks), '메모 지우기에 되돌리기 알림이 없습니다.');
const lineInput = students.slice(students.indexOf('aria-label="이 학생 기록"'), students.indexOf('aria-label="이 학생 기록"') + 600);
check(/isComposing/.test(lineInput) && /keyCode === 229/.test(lineInput), '학생 한 줄 기록이 한글 조합 중 Enter를 막지 않습니다.');
check(/if \(lineBusy\.current\) return;/.test(students) && /finally \{\s*lineBusy\.current = false;/.test(students), '학생 한 줄 기록이 저장 중 연타를 막지 않습니다.');
check(/catch \{\s*showToast\('기록을 남기지 못했어요\. 쓰던 글은 그대로 있어요\.'\);/.test(students) && students.includes("result?.message || '기록을 남기지 못했어요."), '학생 한 줄 기록 저장 실패 안내가 없습니다.');

if (failures.length) {
    console.error(`글·자료 유실 방지 검사 실패 ${failures.length}건`);
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
}
console.log('글·자료 유실 방지 검사 통과');
process.exit(0);
