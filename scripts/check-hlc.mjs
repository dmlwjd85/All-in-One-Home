/** 할 일 고친 시각 시계(HLC)와 받아 올 때 합치기: 시계를 클라우드 없이 확인합니다(PR #57 검수 3번 살아남은 변이 H1·H3·H4·T2·N11b). */
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
const { editClock, resetClockForTest, useDeviceClockForTest, clockForTest, absorbCloudForTest, snapshot, pruneDeletedElsewhere, useVaultsForTest } = await import('../src/lib/db.js');

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const vault = () => { const map = new Map(); return { get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v); }, remove: async (k) => { map.delete(k); } }; };
useVaultsForTest(vault(), vault(), vault());

const T = 1793000000000;
useDeviceClockForTest(() => T);
store.clear();
resetClockForTest({ measured: true });

/* H1: 같은 밀리초에 두 번 고쳐도 시각은 늘 앞으로 갑니다(l+1). */
const a = editClock();
const b = editClock();
check(a >= T && b > a, `같은 순간 두 번 고친 시각이 늘지 않습니다: ${a} → ${b}`);

/* H4: 다른 기기가 찍은 조금 늦은 시각(10분 안)을 보면 그보다 늦게 찍습니다. */
const seen = T + 5000;
await absorbCloudForTest({ todos: [{ id: 'h4', title: '다른 기기', done: false, source: 'app' }], ats: { todos: { h4: seen } } }, {});
check(clockForTest().l >= seen, `본 시각을 시계에 적지 않습니다: l=${clockForTest().l}`);
check(editClock() > seen, '다른 기기가 찍은 시각보다 이르게 고친 시각을 찍습니다.');

/* H3: 10분 넘게 앞선 시각(시계가 틀린 옛 기기)은 따르지 않습니다. */
const before = clockForTest().l;
await absorbCloudForTest({ todos: [{ id: 'h3', title: '미래 기기', done: false, source: 'app' }], ats: { todos: { h3: T + 86400000 } } }, {});
check(clockForTest().l === before, `하루 앞선 시각을 시계에 적었습니다: l=${clockForTest().l}`);
check(editClock() < T + 10 * 60 * 1000, '하루 앞선 시각을 따라 고친 시각이 미래로 갑니다.');

/* N11b: 이 기기에서 고치고 못 올린 할 일이라도, 다른 기기가 더 늦게 고쳤으면 그 값을 받습니다. 더 이르면 지킵니다. */
await absorbCloudForTest({ todos: [{ id: 'n1', title: '내 것', done: false, source: 'app', editAt: T + 1000 }, { id: 'n2', title: '내 것', done: false, source: 'app', editAt: T + 1000 }] }, {});
await absorbCloudForTest({ todos: [{ id: 'n1', title: '나중 값', done: false, source: 'app' }, { id: 'n2', title: '옛 값', done: false, source: 'app' }], ats: { todos: { n1: T + 2000, n2: T + 500 } } }, {});
const rows = snapshot().todos;
check(rows.find((r) => r.id === 'n1')?.title === '나중 값', `더 늦게 고친 다른 기기 값을 받지 않습니다: ${rows.find((r) => r.id === 'n1')?.title}`);
check(rows.find((r) => r.id === 'n2')?.title === '내 것', '더 이른 다른 기기 값이 이 기기 수정을 덮었습니다.');

/* T2: 받아 올 때(밀기 전) 더 늦게 지운 묘비가 있으면 고친 할 일도 실제로 지웁니다. 더 이른 묘비면 지킵니다. */
const draft = { todos: [{ id: 't5', title: '고침', done: false, source: 'app', editAt: T + 1000 }, { id: 't6', title: '고침', done: false, source: 'app', editAt: T + 1000 }] };
pruneDeletedElsewhere(draft, { ids: { todos: [] }, tombs: { todos: { t5: T + 2000, t6: T + 500 } } }, {});
check(!draft.todos.some((r) => r.id === 't5'), '더 늦게 지운 할 일이 받아 올 때 남아 있습니다.');
check(draft.todos.some((r) => r.id === 't6'), '지운 뒤에 고친 할 일이 받아 올 때 사라졌습니다.');

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('check:hlc 통과');
