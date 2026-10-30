/** 할 일 고친 시각 시계(HLC)와 받아 올 때 합치기: 시계를 클라우드 없이 확인합니다(PR #57 검수 3번 살아남은 변이 H1·H3·H4·T2·N11b). */
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => { store.set(k, String(v)); }, removeItem: (k) => { store.delete(k); } };
const { editClock, resetClockForTest, useDeviceClockForTest, clockForTest, absorbCloudForTest, snapshot, pruneDeletedElsewhere, useVaultsForTest, planTodoConflict, CONFLICT_PREFIX, reconcileForTest, useCloudForTest, useAuthForTest } = await import('../src/lib/db.js');

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

/* 충돌 사본 판단(PR #57 r2 검수 2·3·5번) */
const mk = (id, title, extra = {}) => ({ id, title, done: false, source: 'app', ...extra });
check(planTodoConflict(mk('p', '옛판 수정'), { remote: mk('p', '다른 값') }) === 'takeCopy', 'legacy 수정 + 바뀐 클라우드가 takeCopy가 아닙니다.');
check(planTodoConflict(mk('p', '옛판 수정'), { gone: T }) === 'dropCopy', 'legacy 수정 + 묘비가 dropCopy가 아닙니다.');
check(planTodoConflict(mk('p', '잰 수정', { editAt: T + 9e6 }), { remote: mk('p', '못 잰 기기'), soft: true }) === 'keepCopy', '잰 수정 + 불확실한 클라우드가 keepCopy가 아닙니다(3번).');
check(planTodoConflict(mk('p', '잰 수정', { editAt: T }), { remote: mk('p', '다른 값') }) === null, '확실한 두 시각은 시각으로 견줘야 합니다.');
check(planTodoConflict(mk('p', '잰 수정', { editAt: T }), { remote: mk('p', '다른 값'), stale: true }) === 'takeCopy', '31일 넘은 기기 + 바뀐 클라우드가 takeCopy가 아닙니다(5번).');
check(planTodoConflict(mk('p', '잰 수정', { editAt: T }), { stale: true, base: 'x' }) === 'dropCopy', '31일 넘은 기기 + 사라진 문서가 dropCopy가 아닙니다(5번).');
check(planTodoConflict(mk('p', '같은 값'), { remote: mk('p', '같은 값') }) === null, '같은 값인데 사본을 만듭니다.');

const copies = () => snapshot().todos.filter((r) => String(r.title).startsWith(CONFLICT_PREFIX));
/* 받아 올 때: legacy 줄 + 바뀐 클라우드 → 클라우드 값, 내 값은 사본. 두 번 받아도 사본은 하나. */
await absorbCloudForTest({ todos: [mk('g1', '옛판에서 고침')] }, {});
const pullG1 = { todos: [mk('g1', '다른 기기 값')], ids: { todos: ['g1'] }, ats: { todos: { g1: T } }, soft: { todos: { g1: true } } };
await absorbCloudForTest(pullG1, {});
await absorbCloudForTest(pullG1, null);
check(snapshot().todos.find((r) => r.id === 'g1')?.title === '다른 기기 값', `legacy: 클라우드 값을 받지 않았습니다: ${snapshot().todos.find((r) => r.id === 'g1')?.title}`);
check(copies().filter((r) => r.title.includes('옛판에서 고침')).length === 1, `legacy: 내 수정 사본이 하나가 아닙니다: ${copies().length}`);
/* legacy 줄 + 묘비 → 지우고 사본 */
await absorbCloudForTest({ todos: [mk('g2', '옛판 수정 뒤 지워짐')] }, null);
await absorbCloudForTest({ todos: [], ids: { todos: [] }, tombs: { todos: { g2: T } } }, {});
check(!snapshot().todos.some((r) => r.id === 'g2') && copies().some((r) => r.title.includes('옛판 수정 뒤 지워짐')), 'legacy+묘비: 지우고 사본을 남기지 않았습니다.');
/* 잰 수정 + 불확실한 클라우드 → 내 값 지키고 클라우드 값 사본, 다시 받아도 사본 하나 */
await absorbCloudForTest({ todos: [mk('g3', 'A 나중(잰 시각)', { editAt: T + 9e6 })] }, null);
const pullG3 = { todos: [mk('g3', 'B 먼저(못 잰)')], ids: { todos: ['g3'] }, ats: { todos: { g3: T + 9.5e6 } }, soft: { todos: { g3: true } } };
await absorbCloudForTest(pullG3, {});
await absorbCloudForTest(pullG3, null);
check(snapshot().todos.find((r) => r.id === 'g3')?.title === 'A 나중(잰 시각)', 'keepCopy: 잰 수정이 늦게 올린 불확실한 값에 졌습니다(3번).');
check(copies().filter((r) => r.title.includes('B 먼저(못 잰)')).length === 1, `keepCopy: 다른 기기 값 사본이 하나가 아닙니다: ${copies().map((r) => r.title)}`);

/* T3: 올리기 전 견주기에서 더 늦은 묘비면 고친 할 일을 지웁니다(더 이른 묘비면 지킵니다). */
useAuthForTest('u-hlc');
await absorbCloudForTest({ todos: [mk('t3a', '고침', { editAt: T + 1000 }), mk('t3b', '고침', { editAt: T + 1000 })] }, null);
await absorbCloudForTest({ todos: [] }, {});
useCloudForTest({ peek: async () => ({ t3a: { row: null, gone: T + 5000 }, t3b: { row: null, gone: T + 500 } }) });
await reconcileForTest('u-hlc');
check(!snapshot().todos.some((r) => r.id === 't3a'), '올리기 전: 더 늦게 지운 할 일을 지우지 않았습니다(T3).');
check(snapshot().todos.some((r) => r.id === 't3b'), '올리기 전: 지운 뒤 고친 할 일을 지웠습니다.');
useCloudForTest(null);

/* R5·R10·R11(PR #57 r3 검수): 31일 넘게 받아 오지 않은 기기가 올리기 전 견주기를 하면
   - 클라우드가 바뀐 할 일: 클라우드 값을 받고 내 수정은 사본(takeCopy)
   - 그 사이 사라진 할 일(묘비도 쓸려 감): 지우되 내 수정은 사본(dropCopy)
   - 클라우드에 처음 올리는 새 할 일은 그대로 둡니다. 실제 마지막 받은 시각(ssug-gyomu-last-sync)으로 판정합니다. */
await absorbCloudForTest({ todos: [mk('st1', '오래 오프 수정1', { editAt: T + 100 }), mk('st2', '오래 오프 수정2', { editAt: T + 100 }), mk('st3', '오래 오프 새것', { editAt: T + 100 })] }, {});
await absorbCloudForTest({ todos: [] }, { 'todos/st1': 'old', 'todos/st2': 'old' });
store.set('ssug-gyomu-last-sync', JSON.stringify({ 'u-hlc': T - 32 * 86400000 }));
useCloudForTest({ peek: async () => ({ st1: { row: mk('st1', '다른 기기 수정1'), at: T + 50, soft: false }, st2: { gone: null } }) });
await reconcileForTest('u-hlc');
const stRow = (id) => snapshot().todos.find((r) => r.id === id);
check(stRow('st1')?.title === '다른 기기 수정1', `31일: 서버 값을 받지 않았습니다: ${stRow('st1')?.title}`);
check(copies().filter((r) => r.title.includes('오래 오프 수정1')).length === 1, `31일 takeCopy: 내 수정 사본이 없습니다(R10/R5): ${copies().map((r) => r.title)}`);
check(!stRow('st2') && copies().filter((r) => r.title.includes('오래 오프 수정2')).length === 1, `31일 dropCopy: 사라진 할 일을 지우고 사본을 남기지 않았습니다(R11/R5): ${!!stRow('st2')} ${copies().map((r) => r.title)}`);
check(stRow('st3')?.title === '오래 오프 새것', '31일: 새 할 일이 사라졌습니다.');
/* 31일이 안 됐으면 사본을 만들지 않고 시각으로 견줍니다(내 수정이 더 늦으면 지킵니다). */
await absorbCloudForTest({ todos: [mk('st4', '최근 기기 수정', { editAt: T + 100 })] }, null);
await absorbCloudForTest({ todos: [] }, { 'todos/st4': 'old' });
store.set('ssug-gyomu-last-sync', JSON.stringify({ 'u-hlc': T - 86400000 }));
const before4 = copies().length;
useCloudForTest({ peek: async () => ({ st4: { row: mk('st4', '더 이른 다른 값'), at: T + 50, soft: false } }) });
await reconcileForTest('u-hlc');
check(stRow('st4')?.title === '최근 기기 수정' && copies().length === before4, `31일 전: 사본을 만들거나 내 수정이 졌습니다: ${stRow('st4')?.title} ${copies().length - before4}`);
store.delete('ssug-gyomu-last-sync');
useCloudForTest(null);

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('check:hlc 통과');
