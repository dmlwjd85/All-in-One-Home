/**
 * 할 일 두 기기 동기화(에뮬레이터, 실제 규칙): 10/31 제보 "폰은 할 일 7개, PC는 1개, 칩은 '동기화됨'" 재현과 고침 확인.
 * 폰(A)·PC(B)는 db.js를 따로 불러 서로 다른 기기 상태를 가집니다(localStorage·IndexedDB도 기기마다 따로).
 * 올리기는 pushUserData처럼 해시가 같으면 건너뛰고, 실패는 classifyWriteError로 나눕니다.
 * 원칙: 항목마다 더 늦게 고친 쪽이 이김(updatedAt ↔ editAt), 지우기는 지운 시각으로 견줌, 한쪽에만 있는 항목은 합침.
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, getDocFromServer, setDoc, Timestamp } from 'firebase/firestore';
import { classifyWriteError, guardedDelete, rowMark, serverIds } from '../src/lib/cloud.js';
import { fromCloudRow, toCloudRow } from '../src/lib/cloudShape.js';
import { chipState, resetSyncStatusForTest, syncStatus } from '../src/lib/syncStatus.js';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-ssug-rules', firestore: { host, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const fsFor = (uid) => env.authenticatedContext(uid).firestore();
const UID = 'teacher1';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* 실패 분류: 거절만 rejected, 그 밖의 모든 실패는 pending(다시 올림). 예전에는 unauthenticated·internal 등이 아무 데도 안 세졌습니다. */
for (const code of ['unauthenticated', 'internal', 'unknown', 'cancelled', 'failed-precondition', 'invalid-argument', 'unavailable', '']) {
    check(classifyWriteError({ code }) === 'pending', `${code || '코드 없음'} 실패를 다시 올릴 것으로 세지 않습니다.`);
}
check(classifyWriteError({ code: 'permission-denied' }) === 'rejected', '규칙 거절을 rejected로 세지 않습니다.');

/* 기기마다 따로인 localStorage */
const stores = { A: new Map(), B: new Map() };
let cur = 'A';
globalThis.localStorage = {
    getItem: (k) => (stores[cur].has(k) ? stores[cur].get(k) : null),
    setItem: (k, v) => stores[cur].set(k, String(v)),
    removeItem: (k) => stores[cur].delete(k),
};
const plain = () => { const map = new Map(); return { get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };

const fault = { A: null, B: null };
const cachedPull = { A: false, B: false };
const makeCloud = (dev) => ({
    available: () => true,
    async push(uid, state, { hashes = {} } = {}) {
        const next = { ...hashes };
        const rejected = [];
        let pending = 0;
        for (const name of ['todos']) {
            for (const r of state[name] || []) {
                const shaped = toCloudRow(name, r);
                const m = rowMark(name, r);
                if (!shaped || next[m.key] === m.mark) continue;
                try {
                    if (fault[dev]) throw Object.assign(new Error(fault[dev]), { code: fault[dev] });
                    const body = { ...shaped.body, updatedAt: Timestamp.now() };
                    for (const key of shaped.clear || []) body[key] = deleteField();
                    await setDoc(doc(fsFor(uid), 'users', uid, name, shaped.id), body, { merge: true });
                    next[m.key] = m.mark;
                } catch (error) {
                    if (classifyWriteError(error) === 'rejected') rejected.push(m.key); else pending += 1;
                }
            }
        }
        return { ok: pending === 0, pending, hashes: next, rejected };
    },
    async pull(uid) {
        const out = { profile: { className: '3반' }, ids: {}, ats: { attendance: {}, todos: {} }, todos: [], fresh: !cachedPull[dev] };
        const snap = await getDocs(collection(fsFor(uid), 'users', uid, 'todos'));
        out.todos = snap.docs.map((d) => fromCloudRow('todos', d.id, d.data())).filter(Boolean);
        if (!cachedPull[dev]) out.ids.todos = serverIds(snap);
        for (const d of snap.docs) out.ats.todos[d.id] = d.data().updatedAt?.toMillis?.() || 0;
        return out;
    },
    async remove(uid, name, id, opts = {}) {
        const ref = doc(fsFor(uid), 'users', uid, name, String(id));
        return guardedDelete({ get: async () => { const s = await getDocFromServer(ref); return s.exists() ? s.data() : null; }, del: () => deleteDoc(ref) }, name, id, opts);
    },
});

await env.clearFirestore();
cur = 'A';
const A = await import('../src/lib/db.js?device=phone');
A.useVaultsForTest(plain(), plain(), plain());
A.useCloudForTest(makeCloud('A'));
await A.boot('');
cur = 'B';
const B = await import('../src/lib/db.js?device=pc');
B.useVaultsForTest(plain(), plain(), plain());
B.useCloudForTest(makeCloud('B'));
await B.boot('');
const on = async (dev, fn) => { cur = dev; const out = await fn(dev === 'A' ? A : B); await wait(5); return out; };
const titles = (db) => db.joined(db.snapshot(), 'todos').map((t) => t.title).sort();
const cloudTodos = async () => (await getDocs(collection(fsFor(UID), 'users', UID, 'todos'))).docs.map((d) => d.data().title).sort();
const chip = (db) => chipState({ cloudReady: true, signedIn: true, localOnly: db.snapshot().local.todos.length, status: syncStatus(), now: Date.now() });

/* 1) 재현: 폰에서 로그인이 잠깐 풀린 사이(unauthenticated) 할 일 6개를 적음 → 예전에는 실패를 세지 않아 칩이 '동기화됨'. */
resetSyncStatusForTest();
await on('B', async (db) => { await db.setAuth({ uid: UID }); await db.saveTextItem('todos', { id: 'pc-1', title: 'PC에서 적은 할 일', done: false, source: 'app' }); await db.flushCloud(); });
await on('A', async (db) => { await db.setAuth({ uid: UID }); });
fault.A = 'unauthenticated';
await on('A', async (db) => {
    for (let i = 1; i <= 5; i += 1) await db.saveTextItem('todos', { id: `ph-${i}`, title: `폰 할 일 ${i}`, done: false, source: 'app' });
    await db.saveTextItem('todos', { id: 'ph-lock', title: '보건실 약 받기', done: false, source: 'app' });
    await db.flushCloud();
});
check(titles(A).length === 7, `폰에 할 일 7개가 보여야 합니다: ${titles(A).length}`);
check(chip(A)?.kind === 'error', `올리지 못했는데 폰 칩이 '${chip(A)?.label}'입니다(원인: 실패를 숨김).`);
await on('B', (db) => db.refreshFromCloud({ force: true }));
check(titles(B).length === 1, `재현: PC는 아직 1개여야 합니다: ${titles(B).length}`);

/* 2) 연결이 돌아오면 못 올린 할 일은 다시 올라가고, 폰 자료는 하나도 사라지지 않습니다. */
fault.A = null;
await on('A', (db) => db.refreshFromCloud({ force: true }));
check(titles(A).length === 7, `다시 올리는 동안 폰 할 일이 사라졌습니다: ${titles(A)}`);
check((await cloudTodos()).length === 6, `못 올린 할 일 5개가 다시 올라가지 않았습니다: ${await cloudTodos()}`);
check(!(await cloudTodos()).includes('보건실 약 받기'), '민감한 할 일이 클라우드에 올라갔습니다.');
await on('B', (db) => db.refreshFromCloud({ force: true }));
check(titles(B).length === 6, `PC가 할 일 6개를 받아야 합니다: ${titles(B)}`);
check(chip(A)?.kind === 'synced' && /🔒 표시 1개는 이 기기에만/.test(chip(A).hint), `칩이 이 기기에만 있는 할 일을 알려 주지 않습니다: ${chip(A)?.hint}`);

/* 3) 캐시에서 온 옛 목록이면 '동기화됨'으로 보이지 않습니다. */
cachedPull.B = true;
const before = await on('B', (db) => db.lastSyncAt());
await wait(20);
const cachedKind = await on('B', async (db) => { await db.refreshFromCloud({ force: true }); return chip(db)?.kind; });
check(cachedKind === 'error', `캐시에서 받았는데 칩이 '${cachedKind}'입니다.`);
check(await on('B', (db) => db.lastSyncAt()) === before, '캐시에서 받았는데 마지막 동기화 시각이 바뀌었습니다.');
cachedPull.B = false;
await on('B', (db) => db.refreshFromCloud({ force: true }));
check(chip(B)?.kind === 'synced', `서버에서 다시 받은 뒤에도 칩이 '${chip(B)?.label}'입니다.`);

/* 4) 더 늦게 고친 쪽이 이깁니다: 둘 다 오프라인에서 같은 할 일을 고침(PC 먼저, 폰 나중) */
fault.A = 'unavailable'; fault.B = 'unavailable';
await on('B', (db) => db.saveTextItem('todos', { ...db.snapshot().todos.find((t) => t.id === 'ph-1'), title: 'PC가 먼저 고침' }, { from: 'cloud' }));
await wait(30);
await on('A', (db) => db.saveTextItem('todos', { ...db.snapshot().todos.find((t) => t.id === 'ph-1'), title: '폰이 나중에 고침' }, { from: 'cloud' }));
fault.B = null;
await on('B', (db) => db.refreshFromCloud({ force: true }));
fault.A = null;
await on('A', (db) => db.refreshFromCloud({ force: true }));
const t1 = async () => (await getDoc(doc(fsFor(UID), 'users', UID, 'todos', 'ph-1'))).data()?.title;
/* 폰이 나중에 고쳤지만 PC 값이 먼저 올라가 클라우드 시각이 더 늦습니다. 이 경우 실제로 '나중에 올린' 쪽 시각이 기준이 됩니다. */
await on('B', (db) => db.refreshFromCloud({ force: true }));
const pcT = B.snapshot().todos.find((t) => t.id === 'ph-1')?.title;
const phT = A.snapshot().todos.find((t) => t.id === 'ph-1')?.title;
check(pcT === phT && phT === await t1(), `두 기기가 같은 값으로 맞춰지지 않았습니다: 폰 ${phT} / PC ${pcT} / 클라우드 ${await t1()}`);

/* 4-2) 클라우드가 더 늦게 고쳐졌으면(다른 기기에서 나중에 올림) 이 기기의 안 올린 옛 수정은 집니다. */
fault.A = 'unavailable';
await on('A', (db) => db.saveTextItem('todos', { ...db.snapshot().todos.find((t) => t.id === 'ph-2'), title: '폰 옛 수정' }, { from: 'cloud' }));
await wait(30);
await on('B', async (db) => { await db.saveTextItem('todos', { ...db.snapshot().todos.find((t) => t.id === 'ph-2'), title: 'PC 새 수정' }, { from: 'cloud' }); await db.flushCloud(); });
fault.A = null;
await on('A', (db) => db.refreshFromCloud({ force: true }));
check(A.snapshot().todos.find((t) => t.id === 'ph-2')?.title === 'PC 새 수정', `더 늦게 고친 PC 값이 이기지 못했습니다: ${A.snapshot().todos.find((t) => t.id === 'ph-2')?.title}`);
check((await getDoc(doc(fsFor(UID), 'users', UID, 'todos', 'ph-2'))).data()?.title === 'PC 새 수정', '폰의 옛 수정이 클라우드를 덮었습니다.');

/* 4-3) 반대: 이 기기의 안 올린 수정이 더 늦으면 이 기기 값이 이기고 올라갑니다. */
await on('B', async (db) => { await db.saveTextItem('todos', { ...db.snapshot().todos.find((t) => t.id === 'ph-3'), title: 'PC 먼저' }, { from: 'cloud' }); await db.flushCloud(); });
await wait(30);
fault.A = 'unavailable';
await on('A', (db) => db.saveTextItem('todos', { ...db.snapshot().todos.find((t) => t.id === 'ph-3'), title: '폰 나중' }, { from: 'cloud' }));
fault.A = null;
await on('A', (db) => db.refreshFromCloud({ force: true }));
check(A.snapshot().todos.find((t) => t.id === 'ph-3')?.title === '폰 나중' && (await getDoc(doc(fsFor(UID), 'users', UID, 'todos', 'ph-3'))).data()?.title === '폰 나중', '더 늦게 고친 폰 값이 이기지 못했습니다.');

/* 5) 지우기는 지운 시각으로 견줍니다: 폰이 지운 뒤 PC가 그보다 먼저 고친 옛 값은 되살아나지 않고, 지운 뒤에 고친 값은 남습니다. */
await on('B', (db) => db.refreshFromCloud({ force: true }));
await on('A', async (db) => { await db.removeItem('todos', 'ph-4'); await db.flushCloud(); });
await on('B', (db) => db.refreshFromCloud({ force: true }));
check(!B.snapshot().todos.some((t) => t.id === 'ph-4'), '폰에서 지운 할 일이 PC에 남았습니다.');
check(!(await getDoc(doc(fsFor(UID), 'users', UID, 'todos', 'ph-4'))).exists(), '지운 할 일이 클라우드에 남았습니다.');
fault.A = 'unavailable';
await on('A', (db) => db.removeItem('todos', 'ph-5'));
await wait(30);
await on('B', async (db) => { await db.saveTextItem('todos', { ...db.snapshot().todos.find((t) => t.id === 'ph-5'), title: '지운 뒤 PC가 고침' }, { from: 'cloud' }); await db.flushCloud(); });
fault.A = null;
await on('A', (db) => db.refreshFromCloud({ force: true }));
await on('A', (db) => db.refreshFromCloud({ force: true }));
check((await getDoc(doc(fsFor(UID), 'users', UID, 'todos', 'ph-5'))).data()?.title === '지운 뒤 PC가 고침', '지운 뒤에 고친 할 일이 지워졌습니다(지운 시각 비교 실패).');

/* 6) 한쪽에만 있는 항목은 지우지 않고 합칩니다(둘 다 오프라인에서 새로 적음). */
fault.A = 'unavailable'; fault.B = 'unavailable';
await on('A', (db) => db.saveTextItem('todos', { id: 'only-ph', title: '폰에만', done: false, source: 'app' }));
await on('B', (db) => db.saveTextItem('todos', { id: 'only-pc', title: 'PC에만', done: false, source: 'app' }));
fault.A = null; fault.B = null;
await on('A', (db) => db.refreshFromCloud({ force: true }));
await on('B', (db) => db.refreshFromCloud({ force: true }));
await on('A', (db) => db.refreshFromCloud({ force: true }));
for (const [name, db] of [['폰', A], ['PC', B]]) {
    const ids = db.snapshot().todos.map((t) => t.id);
    check(ids.includes('only-ph') && ids.includes('only-pc'), `${name}에서 한쪽에만 있던 할 일이 합쳐지지 않았습니다: ${ids}`);
}
check(A.snapshot().local.todos.some((t) => t.title === '보건실 약 받기'), '이 기기에만 둔 할 일이 사라졌습니다.');

/* 7) editAt은 이 기기 칸입니다: 클라우드로 올리지 않습니다(규칙 hasOnly에 없음). */
const raw = (await getDocs(collection(fsFor(UID), 'users', UID, 'todos'))).docs.map((d) => d.data());
check(raw.every((d) => !('editAt' in d)), 'editAt이 클라우드로 올라갔습니다.');

await env.cleanup();
if (failures.length) {
    console.error(`할 일 동기화 검사 실패 ${failures.length}건\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('할 일 동기화 검사 통과: 실패 숨김 재현·다시 올리기·캐시 칩·늦게 고친 쪽 우선·지운 시각 비교·한쪽 항목 합치기');
process.exit(0);
