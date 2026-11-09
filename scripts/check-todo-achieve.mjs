/** 할 일 성취(PR C): 중요도·정렬·끝낸 날·하루 목표·달성 배지·두 기기 합치기·완료 효과 계획을 브라우저 없이 확인합니다. */
import { readFileSync } from 'node:fs';
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
const A = await import('../src/lib/todoAchieve.js');
const { toCloudRow, fromCloudRow, todoBodyWithoutTime } = await import('../src/lib/cloudShape.js');
const db = await import('../src/lib/db.js');
const fx = await import('../src/ui/doneFx.js');

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const vault = () => { const map = new Map(); return { get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v); }, remove: async (k) => { map.delete(k); } }; };

/* 1. 중요도 */
check(A.priOf({}) === 2 && A.priOf({ pri: 3 }) === 3 && A.priOf({ pri: 9 }) === 2 && A.priOf({ pri: '3' }) === 2, '중요도 해석이 틀립니다(없으면 보통, 모르는 값은 보통).');

/* 2. 정렬: 남은 것 먼저, D-day순·중요도순, 같은 값은 순서 고정 */
const rows = [
    { id: 'a', title: 'a', due: '2026-11-12', pri: 1 },
    { id: 'b', title: 'b', due: '2026-11-10', pri: 2 },
    { id: 'c', title: 'c', pri: 3 },
    { id: 'd', title: 'd', due: '2026-11-10', pri: 3 },
    { id: 'e', title: 'e', due: '2026-11-09', pri: 3, done: true },
    { id: 'f', title: 'f', due: '2026-11-12', pri: 1 },
];
const dday = A.sortTodos(rows, 'dday').map((r) => r.id).join('');
const pri = A.sortTodos(rows, 'pri').map((r) => r.id).join('');
check(dday === 'dbafce', `D-day순이 틀립니다: ${dday}`);
check(pri === 'dcbafe', `중요도순이 틀립니다: ${pri}`);
check(A.sortTodos([...rows].reverse(), 'dday').map((r) => r.id).join('') === dday, '같은 값의 순서가 입력 순서에 흔들립니다.');
check(A.normalizeSort('x') === 'dday' && A.normalizeSort('pri') === 'pri', '정렬 기억 값 검사가 틀립니다.');

/* 3. 클라우드 모양: 옛 줄의 지문은 그대로, 새 칸은 있을 때만, 풀면 지움 */
const old = toCloudRow('todos', { id: 'o1', title: '옛 할 일', done: false, source: 'app' });
check(!('pri' in old.body) && !('doneOn' in old.body) && !old.clear.includes('doneOn'), '옛 할 일에 새 칸이 붙어 한꺼번에 다시 올라갑니다.');
const done = toCloudRow('todos', { id: 'o2', title: '끝낸 일', done: true, doneOn: '2026-11-09', doneHm: '08:41', pri: 3, source: 'app' });
check(done.body.pri === 3 && done.body.doneOn === '2026-11-09' && done.body.doneHm === '08:41', '중요도·끝낸 날이 클라우드 모양에 없습니다.');
const undone = toCloudRow('todos', { id: 'o2', title: '끝낸 일', done: false, doneOn: '', doneHm: '', pri: 3, source: 'app' });
check(!('doneOn' in undone.body) && undone.clear.includes('doneOn') && undone.clear.includes('doneHm'), '체크를 풀어도 클라우드의 끝낸 날을 지우지 않습니다.');
const staleUndone = toCloudRow('todos', { id: 'o3', title: '옛 판이 푼 일', done: false, doneOn: '2026-11-08', source: 'app' });
check(!('doneOn' in staleUndone.body), '끝내지 않은 할 일에 끝낸 날을 올립니다.');
const back = fromCloudRow('todos', 'o2', { title: '끝낸 일', done: true, doneOn: '2026-11-09', doneHm: '08:41', pri: 3, source: 'app' });
check(back.pri === 3 && back.doneOn === '2026-11-09' && back.doneHm === '08:41', '받아 올 때 중요도·끝낸 날을 잃습니다.');
const junk = fromCloudRow('todos', 'o4', { title: 'x', done: true, doneOn: '오늘', pri: 7 });
check(!('pri' in junk) && !('doneOn' in junk), '모르는 중요도·날짜를 받아들입니다.');
const strip = todoBodyWithoutTime(done.body);
check(strip && !('pri' in strip) && !('doneOn' in strip) && strip.title === '끝낸 일', '예전 규칙 거절 때 새 칸을 빼고 다시 올리지 못합니다.');

/* 4. 목표 기록·합치기 */
const g0 = A.normalizeGoals(undefined);
check(g0.n === 3 && g0.nAt === 0 && !Object.keys(g0.days).length, '기본 하루 목표가 3개가 아닙니다.');
const today = '2026-11-09';
const t = (id, on = today) => ({ id, title: id, done: true, doneOn: on });
let r = A.settleGoalDay(g0, [t('x'), t('y')], today, 100);
check(!r.hit && !r.goals.days[today], '목표 전에 배지를 남깁니다.');
check(A.doneCount([t('x'), t('y'), t('y')], today) === 2, '같은 할 일을 두 번 셉니다.');
r = A.settleGoalDay(g0, [t('x'), t('y'), t('y')], today, 100);
check(!r.hit, '같은 할 일을 두 번 세어 목표를 채웠습니다.');
r = A.settleGoalDay(g0, [t('x'), t('y'), { ...t('w'), done: false }, t('v', '2026-11-08'), { id: 'old', done: true }], today, 100);
check(!r.hit, '다른 날·풀린 할 일을 오늘 개수에 셉니다.');
r = A.settleGoalDay(g0, [t('x'), t('y'), t('z')], today, 100);
check(r.hit && A.badgeOn(r.goals.days[today]) && r.goals.days[today].g === 3, '목표를 채워도 배지를 남기지 않습니다.');
const after = A.settleGoalDay(r.goals, [t('x'), t('y'), t('z'), t('q')], today, 200);
check(!after.hit && after.goals.days[today].at === 100, '이미 달성한 날을 다시 기록합니다.');
const pulled = A.settleGoalDay(r.goals, [t('x'), t('y')], today, 300);
check(A.badgeOn(pulled.goals.days[today]), '받아 온 목록이 줄었다고 배지를 지웁니다(체크 풀기만 지워야 함).');
const cleared = A.settleGoalDay(r.goals, [t('x'), t('y')], today, 300, { unchecked: true });
check(cleared.cleared && !A.badgeOn(cleared.goals.days[today]) && cleared.goals.days[today].at === 300, '체크를 풀어 목표 아래로 내려가도 배지를 지우지 않습니다.');
const off = A.settleGoalDay({ ...g0, n: 0 }, [t('x'), t('y'), t('z')], today, 100);
check(!off.hit, '목표를 끄면 배지를 남기면 안 됩니다.');

/* 두 기기: 날짜마다 늦게 고친 쪽, 한쪽에만 있는 날짜는 합침, 목표 개수는 늦게 고친 쪽 */
const phone = { n: 5, nAt: 2000, days: { '2026-11-08': { c: 3, g: 3, at: 10 }, [today]: { c: 3, g: 3, at: 100 } } };
const pc = { n: 3, nAt: 1000, days: { '2026-11-07': { c: 4, g: 4, at: 5 }, [today]: { c: 2, g: 3, at: 300 } } };
const m1 = A.mergeGoals(phone, pc);
const m2 = A.mergeGoals(pc, phone);
check(A.encodeGoals(m1) === A.encodeGoals(m2) && m1.n === 5 && m2.n === 5, '두 기기를 어느 쪽에서 합쳐도 결과가 같아야 합니다.');
check(m1.days['2026-11-07'] && m1.days['2026-11-08'], '한 기기에만 있는 날짜를 잃습니다.');
check(!A.badgeOn(m1.days[today]), '나중에 지운 배지가 되살아납니다.');
/* 글자 왕복 */
const docShape = A.toGoalDoc(m1);
const re = A.fromGoalDoc({ ...docShape, updatedAt: {} });
check(A.encodeGoals(re) === A.encodeGoals(m1) && re.n === m1.n && re.nAt === m1.nAt, '목표 문서 왕복에서 값이 바뀝니다.');
check(A.toGoalDoc(g0) === null, '한 번도 고치지 않은 목표를 올립니다.');
const rulesText = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const rx = /g\.days\.matches\('([^']+)'\)/.exec(rulesText)?.[1];
check(rx && new RegExp(rx).test(docShape.days), '앱이 만든 날짜 기록을 규칙 정규식이 받지 않습니다.');
const big = {};
for (let i = 0; i < 450; i += 1) big[new Date(Date.UTC(2025, 0, 1) + i * 86400000).toISOString().slice(0, 10)] = { c: 99, g: 20, at: 1793000000000 + i };
const bigDoc = A.toGoalDoc({ n: 3, nAt: 1, days: big });
check(bigDoc.days.split('|').length === 400 && bigDoc.days.length <= 12400 && new RegExp(rx).test(bigDoc.days), '오래된 날짜를 400개로 자르지 않거나 규칙 크기를 넘습니다.');

/* 5. 저장소: 체크 → 끝낸 날 기록 → 목표 달성 → 풀기 → 배지 지움 (실제 db.js 길) */
db.useVaultsForTest(vault(), vault(), vault());
const T = Date.parse('2026-11-09T09:00:00+09:00');
db.useDeviceClockForTest(() => T);
db.resetClockForTest({ measured: true });
await db.absorbCloudForTest({ todos: [
    { id: 'g1', title: '하나', done: false, source: 'app', pri: 3 },
    { id: 'g2', title: '둘', done: false, source: 'app' },
    { id: 'g3', title: '셋', done: false, source: 'app', due: '2026-11-09' },
    { id: 'g4', title: '나중', done: false, source: 'app', due: '2026-12-01' },
] }, {});
let info = await db.toggleTodo('g1');
let row = db.snapshot().todos.find((x) => x.id === 'g1');
check(info.done && info.pri === 3 && row.doneOn === '2026-11-09' && row.doneHm === '09:00' && row.editAt > 0, `체크할 때 끝낸 날·시각·고친 시각을 적지 않습니다: ${JSON.stringify(row)}`);
check(!info.allDone && !info.goalHit, '하나만 끝냈는데 다 끝냈다고 합니다.');
await db.toggleTodo('g2');
info = await db.toggleTodo('g3');
check(info.goalHit && info.allDone, `목표 3개·오늘 할 일을 다 끝냈는데 알리지 않습니다: ${JSON.stringify(info)}`);
check(A.badgeOn(db.snapshot().goals.days['2026-11-09']), '목표를 채웠는데 그날 배지가 없습니다.');
info = await db.toggleTodo('g2');
row = db.snapshot().todos.find((x) => x.id === 'g2');
check(!info.done && row.doneOn === '' && row.doneHm === '' && info.goalCleared, `체크를 풀 때 끝낸 날·배지를 지우지 않습니다: ${JSON.stringify(info)}`);
check(!A.badgeOn(db.snapshot().goals.days['2026-11-09']), '목표 아래인데 배지가 남았습니다.');
/* 다른 기기에서 그 할 일을 다시 끝낸 것을 받으면 배지가 다시 붙습니다(지우지는 않음). */
await db.absorbCloudForTest({ todos: [{ id: 'g2', title: '둘', done: true, doneOn: '2026-11-09', doneHm: '09:30', source: 'app' }], ats: { todos: { g2: T + 60000 } } }, {});
check(A.badgeOn(db.snapshot().goals.days['2026-11-09']), '다른 기기에서 끝낸 할 일로 목표를 채워도 배지가 붙지 않습니다.');
/* 클라우드 목표 문서 합치기: 다른 기기 목표 개수를 더 늦게 고쳤으면 받습니다. */
await db.absorbCloudForTest({ goal: { n: 5, nAt: T + 5000, days: { '2026-11-01': { c: 4, g: 4, at: T - 86400000 } } } }, {});
const goalsNow = db.snapshot().goals;
check(goalsNow.n === 5 && A.badgeOn(goalsNow.days['2026-11-01']) && A.badgeOn(goalsNow.days['2026-11-09']), `다른 기기 목표 문서를 합치지 못합니다: ${JSON.stringify(goalsNow)}`);
await db.setTodoGoal(2);
check(db.snapshot().goals.n === 2 && db.snapshot().goals.nAt > T + 5000 - 1, '목표 개수를 바꾸지 못합니다.');
/* 중요도 고치기는 고친 시각을 새로 찍어 다른 기기와 '나중 수정'으로 맞춥니다. */
const beforeAt = db.snapshot().todos.find((x) => x.id === 'g4').editAt || 0;
db.useDeviceClockForTest(() => T + 120000);
await db.setTodoPri('g4', 1);
const g4 = db.snapshot().todos.find((x) => x.id === 'g4');
check(g4.pri === 1 && g4.editAt > beforeAt, '중요도를 바꿔도 고친 시각이 그대로입니다.');
/* 계정 몫: goals가 계정마다 따로 보관됩니다. */
const src = readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8');
check(/const ACCOUNT_PARTS = \[[^\]]*'goals'/.test(src), '목표가 계정 전환 때 계정 몫으로 보관되지 않습니다.');

/* 6. 완료 효과 계획 */
check(fx.burstPlan({ pri: 3 }).count > fx.burstPlan({ pri: 1 }).count, '중요도가 높아도 방울이 늘지 않습니다.');
check(fx.burstPlan({ pri: 2, allDone: true }).count > fx.burstPlan({ pri: 2 }).count && fx.burstPlan({ pri: 2, allDone: true }).reach > fx.burstPlan({ pri: 2 }).reach, '다 끝냈을 때 버스트가 커지지 않습니다.');
check(fx.burstPlan({ pri: 3, level: 'low' }).count < fx.burstPlan({ pri: 3 }).count && fx.burstPlan({ level: 'off' }).count === 0, '줄이기·끄기가 방울 수에 반영되지 않습니다.');
check(fx.normalizeFx('x') === 'on' && fx.normalizeFx('off') === 'off', '효과 설정 기본값이 켜기가 아닙니다.');
let seq = 0;
const words = new Set(Array.from({ length: 20 }, () => fx.pickWord(() => ((seq += 0.37) % 1))));
check(words.size >= 3 && [...words].every((w) => fx.STAMP_WORDS.includes(w)), '도장 문구가 바뀌지 않습니다.');
check(fx.pickWord(() => 0, '참 잘했어요') !== '참 잘했어요', '같은 도장 문구가 연달아 나옵니다.');
check(fx.celebrateDone({ done: false }) === null && fx.celebrateDone({ done: true, storageFailed: true }) === null, '풀기·저장 실패에도 효과를 띄웁니다.');
const fxSrc = readFileSync(new URL('../src/ui/doneFx.js', import.meta.url), 'utf8');
check(fxSrc.includes('prefers-reduced-motion') && fxSrc.includes('keySoundEnabled()'), '동작 줄이기·누를 때 소리 설정을 따르지 않습니다.');
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
check(/@media \(prefers-reduced-motion: reduce\) \{\s*\.done-drop, \.done-ring \{ display: none !important; \}/.test(css), '동작 줄이기에서 방울을 숨기지 않습니다.');
/* 원격 수신·처음 불러오기에서는 효과를 부르지 않습니다: 효과는 toggleTodoFx(사용자 누름) 한 곳에서만. */
for (const file of ['Tasks.jsx', 'Home.jsx', 'Day.jsx', 'TodoAlarm.jsx']) {
    const s = readFileSync(new URL(`../src/ui/${file}`, import.meta.url), 'utf8');
    check(!/[^x]toggleTodo\(/.test(s.replace(/toggleTodoFx\(/g, 'x(')), `${file}이 효과 없이 바로 toggleTodo를 부릅니다.`);
}
const ui = readFileSync(new URL('../src/ui/todoUi.jsx', import.meta.url), 'utf8') + readFileSync(new URL('../src/ui/TodoSettings.jsx', import.meta.url), 'utf8');
check(!/<select|<option|type="range"/.test(ui), '드롭다운·스크롤 피커를 썼습니다.');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('할 일 성취: 중요도·정렬·끝낸 날·목표 배지·두 기기 합치기·효과 계획 검사를 통과했어요.');
