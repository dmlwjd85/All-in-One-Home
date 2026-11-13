/**
 * 실제 cloud.js 의 감시(watchTodos)·일부 받기(pullUserData only)·지우기(deleteUserDoc)를 가짜 Firestore 로 돌립니다(패키지 없이).
 * 'firebase/firestore' 는 scripts/harness/fake-firestore.mjs 로 바꿔 끼웁니다(fake-firestore-hooks.mjs).
 *  - 일부 받기는 고른 컬렉션(+묘비)만 읽고, 읽지 않은 컬렉션은 목록·ids 칸을 두지 않습니다.
 *  - 감시: 리스너 수·시작점·칸, 계정 문서는 보지 않음, 캐시 결과는 알리지 않되 끊긴 동안의 변경은 모아 두었다가 알림,
 *    이 기기 쓰기 건너뛰기, 지움·묘비 알림, 설정 문서는 내용이 바뀔 때만, 살아 있음·끊김·오류 상태.
 *  - 지우기: 묘비 쓰기와 문서 지우기를 batch 하나로(규칙이 거절하면 예전처럼 따로).
 */
import { register } from 'node:module';

register('./harness/fake-firestore-hooks.mjs', import.meta.url);
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
const S = globalThis.__fakeFs = { docs: new Map(), listeners: [], gets: [], batches: [], denyBatch: false };
const fb = await import('../src/firebase.js');
fb.useFirebaseForTest({ config: { apiKey: 'x', projectId: 'demo', authDomain: 'x' }, bundle: { app: null, auth: null, db: {}, memoryOnly: false } });
const cloud = await import('../src/lib/cloud.js');
const shape = await import('../src/lib/cloudShape.js');
const { Timestamp } = await import('./harness/fake-firestore.mjs');

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const U = 'users/u1';
const put = (name, row, at = 5000) => { const s = shape.toCloudRow(name, row); S.docs.set(`${U}/${name}/${s.id}`, { ...s.body, updatedAt: Timestamp.fromMillis(at) }); return s.id; };
put('todos', { id: 't1', title: '할 일', done: false, source: 'app' });
put('records', { id: 'r1', date: '2026-10-01', kind: '관찰', text: '발표', source: 'app' });
S.docs.set(`${U}/tombs/todos-t9`, { k: 'todos', at: Timestamp.fromMillis(7000) });
S.docs.set(U, { className: '3반' });

/* ── 일부 받기 ── */
S.gets = [];
const part = await cloud.pullUserData('u1', { only: ['todos'] });
check(JSON.stringify([...S.gets].sort()) === JSON.stringify([`${U}/todos`, `${U}/tombs`].sort()), `할 일만 받기가 다른 것을 읽었습니다: ${S.gets}`);
check(!('records' in part) && !('records' in part.ids) && part.todos.length === 1 && part.ids.todos[0] === 't1' && part.tombs.todos.t9 === 7000, `일부 받기 모양이 다릅니다: ${JSON.stringify(part)}`);
check(part.profile === null && !('timetable' in part) && JSON.stringify(part.partial) === JSON.stringify(['todos', 'tombs']), `일부 받기에 읽지 않은 칸이 있습니다: ${JSON.stringify(part.partial)}`);
S.gets = [];
await cloud.pullUserData('u1', { only: ['records'] });
check(JSON.stringify(S.gets) === JSON.stringify([`${U}/records`]), `기록만 받기가 묘비까지 읽었습니다: ${S.gets}`);
S.gets = [];
const full = await cloud.pullUserData('u1');
check(S.gets.length === 1 + 4 + 9 + 1 + 1, `전체 받기 읽기 수가 다릅니다: ${S.gets.length}`);
check(full.records.length === 1 && Array.isArray(full.ids.records) && full.profile?.className === '3반' && !full.partial && typeof full.timetable === 'object', '전체 받기 모양이 다릅니다.');

/* ── 감시 ── */
const got = [];
const statuses = [];
const stop = await cloud.watchTodos('u1', (c) => got.push(c), { since: 100000, lateSince: 50000, initial: true, onStatus: (s) => statuses.push(s) });
const queries = S.listeners.filter((l) => l.target.kind === 'query');
const docs = S.listeners.filter((l) => l.target.kind === 'doc');
check(queries.length === 11 && docs.length === 4, `리스너 수가 다릅니다: 질의 ${queries.length} / 문서 ${docs.length}`);
check(!S.listeners.some((l) => l.target.path === U), '계정 문서를 감시합니다(서버 시각 재기와 서로 깨우는 고리).');
check(S.listeners.every((l) => l.opts?.includeMetadataChanges === true), '연결 상태(메타데이터)를 받지 않습니다.');
const q = (name) => queries.find((l) => l.target.path === `${U}/${name}`);
check(['records', 'notices', 'students', 'inbox', 'legacy', 'todos'].every((n) => q(n)), '감시하지 않는 컬렉션이 있습니다.');
check(q('todos').target.w.value.toMillis() === 50000 && q('records').target.w.value.toMillis() === 100000 && q('legacy').target.w.field === 'at' && q('tombs').target.w.value.toMillis() === 50000, '감시 시작점·칸이 다릅니다.');
check(statuses.at(-1)?.live === false, '서버 결과 전에 살아 있다고 봅니다.');
const qsnap = (fromCache, changes) => ({ metadata: { fromCache, hasPendingWrites: false }, docChanges: () => changes });
const dsnap = (fromCache, data, pending = false) => ({ metadata: { fromCache, hasPendingWrites: pending }, exists: () => data != null, data: () => data });
const ch = (type, id, data, pending = false) => ({ type, doc: { id, data: () => data, metadata: { hasPendingWrites: pending } } });
const t1 = S.docs.get(`${U}/todos/t1`);
/* 첫 결과 전 캐시(저장소의 옛 목록)는 알리지 않음 */
for (const l of S.listeners) l.next(l.target.kind === 'query' ? qsnap(true, l === q('todos') ? [ch('added', 't1', t1)] : []) : dsnap(true, null));
check(got.length === 0 && statuses.at(-1).live === false, '첫 결과 전 캐시 결과를 알렸거나 살아 있다고 봅니다.');
/* 첫 서버 결과: initial 이면 알림. 설정 문서 첫 결과가 이 기기 쓰기(hasPendingWrites)여도 기준으로 삼습니다. */
const lv = docs.find((l) => l.target.path.endsWith('settings/leave'));
for (const l of S.listeners) {
    if (l.target.kind === 'query') l.next(qsnap(false, l === q('todos') ? [ch('added', 't1', t1)] : []));
    else if (l === lv) l.next(dsnap(false, { d: '2026-11-13', t: '13:00', at: 8000, updatedAt: null }, true));
    else l.next(dsnap(false, null));
}
check(statuses.at(-1).live === true, '모든 리스너가 서버 결과를 받았는데 살아 있지 않다고 봅니다.');
const mark = cloud.rowMark('todos', shape.fromCloudRow('todos', 't1', t1)).mark;
check(got.length === 1 && got[0][0].name === 'todos' && got[0][0].mark === mark, `첫 서버 결과 알림이 다릅니다: ${JSON.stringify(got)}`);
got.length = 0;
lv.next(dsnap(false, { d: '2026-11-13', t: '13:00', at: 8000, updatedAt: null }, true));
check(got.length === 0, '설정 문서 첫 결과(이 기기 쓰기)와 같은 결과를 다시 알렸습니다.');
/* 쓰기가 서버 시각을 달고 되돌아옴: 알리되, 표시(mark)가 올린 값과 같아 db가 거릅니다. */
lv.next(dsnap(false, { d: '2026-11-13', t: '13:00', at: 8000, updatedAt: Timestamp.fromMillis(8000) }));
check(got[0]?.[0]?.mark === cloud.fingerprint({ d: '2026-11-13', t: '13:00', at: 8000 }), `되돌아온 설정 표시가 올린 값과 다릅니다: ${JSON.stringify(got)}`);
got.length = 0;
/* 이 기기 쓰기(hasPendingWrites)는 건너뛰고, 지운 것은 removed 로 */
q('records').next(qsnap(false, [ch('modified', 'r1', {}, true), ch('removed', 'r2', {})]));
check(got.length === 1 && got[0].length === 1 && got[0][0].removed === true && got[0][0].id === 'r2', `이 기기 쓰기 건너뛰기·지움 알림이 다릅니다: ${JSON.stringify(got)}`);
got.length = 0;
q('tombs').next(qsnap(false, [ch('added', 'todos-t9', { k: 'todos', at: Timestamp.fromMillis(7000) })]));
check(got[0]?.[0]?.of === 'todos' && got[0][0].rowId === 't9' && got[0][0].at === 7000, `묘비 알림이 다릅니다: ${JSON.stringify(got)}`);
/* 끊김: 살아 있지 않음. 끊긴 동안(캐시 결과)에 실린 변경은 모아 두었다가 서버 결과로 돌아올 때 알림 */
got.length = 0;
q('notes').next(qsnap(true, [ch('modified', 'n1', { text: '끊긴 동안', source: 'app' })]));
check(statuses.at(-1).live === false && got.length === 0, '끊겼는데 살아 있다고 보거나 캐시 결과를 바로 알렸습니다.');
q('notes').next(qsnap(false, []));
check(statuses.at(-1).live === true && got.length === 1 && got[0][0].id === 'n1', `끊긴 동안의 변경을 서버 결과로 돌아올 때 알리지 않았습니다: ${JSON.stringify(got)}`);
/* 설정 device: 내용이 같으면(연결만 바뀜) 알리지 않고, 표시는 칸 순서·updatedAt 과 상관없음 */
got.length = 0;
const dev = docs.find((l) => l.target.path.endsWith('settings/device'));
dev.next(dsnap(false, null));
check(got.length === 0, '같은 설정 문서를 다시 알렸습니다.');
check(cloud.settingsMark('device', { b: 1, a: { y: 2, x: 1 }, updatedAt: Timestamp.fromMillis(1) }) === cloud.canonicalMark({ a: { x: 1, y: 2 }, b: 1 }), '설정 device 표시가 칸 순서·updatedAt 에 흔들립니다.');
/* 오류 */
q('legacy').error({ code: 'permission-denied' });
check(statuses.at(-1).live === false && statuses.at(-1).error === 'permission-denied', '리스너 오류를 알리지 않았습니다.');
stop();
check(S.listeners.every((l) => !l.on), '끄지 않은 리스너가 있습니다.');
/* 옛 호출(옵션 없음): 첫 결과는 알리지 않음 */
S.listeners = [];
const got2 = [];
await cloud.watchTodos('u1', (c) => got2.push(c));
const tq = S.listeners.find((l) => l.target.path === `${U}/todos`);
tq.next(qsnap(false, [ch('added', 't1', t1)]));
check(got2.length === 0, '옵션 없는 감시가 첫 결과를 알렸습니다.');
tq.next(qsnap(false, [ch('modified', 't1', t1)]));
check(got2.length === 1, '옵션 없는 감시가 변경을 알리지 않았습니다.');

/* ── 지우기: 묘비와 문서 지우기를 batch 하나로 ── */
put('todos', { id: 't2', title: '지울 일', done: false, source: 'app' });
const del = await cloud.deleteUserDoc('u1', 'todos', 't2', { notAfter: 9000 });
check(del.ok && S.batches.length === 1 && S.batches[0].join() === `set:${U}/tombs/todos-t2,delete:${U}/todos/t2`, `묘비·지우기가 한 batch 가 아닙니다: ${JSON.stringify(S.batches)}`);
check(!S.docs.has(`${U}/todos/t2`) && S.docs.get(`${U}/tombs/todos-t2`)?.at?.toMillis() === 9000, 'batch 뒤 문서·묘비가 맞지 않습니다.');
/* 옛 규칙이 batch 를 거절하면 예전처럼 따로(묘비 시도 뒤 지우기) */
put('todos', { id: 't3', title: '옛 규칙', done: false, source: 'app' });
S.denyBatch = true;
const old = await cloud.deleteUserDoc('u1', 'todos', 't3', { notAfter: 9000 });
S.denyBatch = false;
check(old.ok && !S.docs.has(`${U}/todos/t3`), 'batch 가 거절된 뒤 예전처럼 지우지 않았습니다.');
/* 묘비가 없는 컬렉션(기록)은 batch 없이 지우기만 */
const before = S.batches.length;
await cloud.deleteUserDoc('u1', 'records', 'r1');
check(S.batches.length === before && !S.docs.has(`${U}/records/r1`), '기록 지우기가 다릅니다.');

if (failures.length) {
    console.error(`감시·일부 받기 검사 실패 ${failures.length}건\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('check:sync-watch 통과');
