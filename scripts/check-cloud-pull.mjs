/**
 * 기기마다 자료가 다르게 보이던 원인 재현과 '클라우드에서 다시 받기' 검사(에뮬레이터).
 * 다른 기기(A)는 에뮬레이터에 바로 쓰고, 이 기기(B)는 db.js로 받고 올립니다.
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
import { rowMark, serverIds } from '../src/lib/cloud.js';
import { fromCloudRow, toCloudRow } from '../src/lib/cloudShape.js';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: "demo-ssug-rules", firestore: { host, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const fsFor = (uid) => env.authenticatedContext(uid).firestore();
const UID = 'u1';
let offline = false;
/* 올리기는 실제 pushUserData처럼 줄마다 해시가 같으면 건너뜁니다. */
const cloud = {
    available: () => true,
    async push(uid, state, { hashes = {} } = {}) {
        if (offline) return { ok: false, pending: 1, hashes, rejected: [] };
        const next = { ...hashes };
        for (const r of state.todos || []) {
            const shaped = toCloudRow('todos', r);
            const m = rowMark('todos', r);
            if (!shaped || next[m.key] === m.mark) continue;
            await setDoc(doc(fsFor(uid), 'users', uid, 'todos', shaped.id), { ...shaped.body, updatedAt: Timestamp.now() }, { merge: true });
            next[m.key] = m.mark;
        }
        return { ok: true, pending: 0, hashes: next, rejected: [] };
    },
    async pull(uid) {
        const snap = await getDocs(collection(fsFor(uid), 'users', uid, 'todos'));
        return { profile: { className: '검사반' }, todos: snap.docs.map((d) => fromCloudRow('todos', d.id, d.data())).filter(Boolean), ids: { todos: serverIds(snap) } };
    },
};
const otherDevice = (id, title) => setDoc(doc(fsFor(UID), 'users', UID, 'todos', id), { title, done: false, source: 'app', updatedAt: Timestamp.now() });
const cloudTitle = async (id) => { const d = await getDoc(doc(fsFor(UID), 'users', UID, 'todos', id)); return d.exists() ? d.data().title : '∅'; };
const plain = () => { const map = new Map(); return { map, get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const db = await import('../src/lib/db.js');
db.useVaultsForTest(plain(), plain(), plain());
db.useCloudForTest(cloud);
await env.clearFirestore();
await otherDevice('t1', '보고서 v1');
await otherDevice('t2', '지울 일');
await db.boot('?at=08:42');
await db.setAuth({ uid: UID });
const title = (id) => db.snapshot().todos.find((t) => t.id === id)?.title || '∅';
check(title('t1') === '보고서 v1', `처음 받기 실패: ${title('t1')}`);
check(db.lastSyncAt() > 0, '마지막 동기화 시각이 남지 않았습니다');

/* 1) 다른 기기가 고친 할 일: 자동 받기에서 받아야 하고, 이 기기의 옛 값을 다시 올려 덮으면 안 됩니다. */
await otherDevice('t1', '보고서 v2');
await db.refreshFromCloud({ force: true });
check(title('t1') === '보고서 v2', `다른 기기에서 고친 할 일을 받지 않았습니다(원인 1): ${title('t1')}`);
await db.flushCloud();
check(await cloudTitle('t1') === '보고서 v2', `이 기기 옛 값이 클라우드를 덮었습니다: ${await cloudTitle('t1')}`);

/* 2) 안 올린 변경은 다시 받기 전에 올라가고 그대로 남습니다. 못 올리면 아무것도 바꾸지 않습니다. */
await db.update((d) => { d.todos.push({ id: 't3', title: '이 기기에서 새로', done: false, source: 'app' }); return d; });
offline = true;
await deleteDoc(doc(fsFor(UID), 'users', UID, 'todos', 't2'));
const stop = await db.pullFromCloudNow();
check(!stop.ok && stop.reason === 'push' && title('t3') !== '∅' && title('t2') !== '∅', `못 올렸는데 다시 받기를 진행했습니다: ${JSON.stringify(stop)}`);
offline = false;
const done = await db.pullFromCloudNow();
check(done.ok && done.dropped === 1, `다시 받기 결과가 다릅니다: ${JSON.stringify(done)}`);
check(title('t3') === '이 기기에서 새로' && await cloudTitle('t3') === '이 기기에서 새로', '안 올린 변경이 사라졌습니다');
check(title('t2') === '∅', '다른 기기에서 지운 할 일이 남았습니다');
const kept = await db.readBeforePull();
check(kept?.data?.todos?.some((t) => t.id === 't2'), '다시 받기 전 자료를 보관하지 않았습니다');
/* 3) 한 번도 클라우드에 닿지 않은 줄은 다시 받기로 지우지 않습니다. */
offline = true;
await db.update((d) => { d.todos.push({ id: 't4', title: '아직 못 올림', done: false, source: 'app' }); return d; });
await db.flushCloud();
offline = false;
cloud.push = ((orig) => async (uid, state, opts) => { const r = await orig(uid, { ...state, todos: state.todos.filter((t) => t.id !== 't4') }, opts); return r; })(cloud.push);
db.useCloudForTest(cloud);
const third = await db.pullFromCloudNow();
check(third.ok && title('t4') === '아직 못 올림', `클라우드에 없던 줄을 지웠습니다: ${JSON.stringify(third)} ${title('t4')}`);

await env.cleanup();
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('check:cloudpull ok');
process.exit(0);
