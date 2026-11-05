/**
 * 하단 탭바 배치 두 기기 동기화(에뮬레이터 + 실제 규칙 + 진짜 cloud.js). 나중에 고친 쪽이 이기고, 오프라인·로그인 전에는 이 기기에만 남습니다.
 */
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { execSync } from 'node:child_process';
import { collection, doc, getDoc, getDocs, disableNetwork, enableNetwork, serverTimestamp, setDoc, Timestamp, terminate } from 'firebase/firestore';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-ssug-rules', firestore: { host, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const UID = 'teacher-tabsync';
const admin = () => env.authenticatedContext(UID).firestore();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3600 * 1000;
/* 서버 시각 보정 오차는 왕복 시간의 절반 정도입니다. 두 기기 수정 사이를 1.5초로 둡니다(사람이 두 기기에서 고치는 간격보다 짧음). */
const GAP = 1500;

/* 기기마다 src 복사본(모듈 따로) */
const root = new URL('../', import.meta.url);
rmSync(new URL('.tabsyncdev/', root), { recursive: true, force: true });
for (const d of ['a', 'b']) cpSync(new URL('src/', root), new URL(`.tabsyncdev/${d}/src/`, root), { recursive: true });

const stores = { A: new Map(), B: new Map() };
let cur = 'A';
globalThis.localStorage = {
    getItem: (k) => (stores[cur].has(k) ? stores[cur].get(k) : null),
    setItem: (k, v) => stores[cur].set(k, String(v)),
    removeItem: (k) => stores[cur].delete(k),
};
const plain = () => { const map = new Map(); return { get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };

const offline = { A: false, B: false };
/* 서버 시각 재기만 실패하는 기기(PR #57 검수 NOCLOCK) */
const noclock = { A: false, B: false };
const config = { apiKey: 'demo', projectId: 'demo-ssug-rules', authDomain: 'demo.local' };
const devices = {};
const watching = { A: false, B: false };
for (const [name, dir] of [['A', 'a'], ['B', 'b']]) {
    cur = name;
    const fb = await import(new URL(`.tabsyncdev/${dir}/src/firebase.js`, root));
    const cloud = await import(new URL(`.tabsyncdev/${dir}/src/lib/cloud.js`, root));
    const db = await import(new URL(`.tabsyncdev/${dir}/src/lib/db.js`, root));
    const fs = env.authenticatedContext(UID).firestore();
    fb.useFirebaseForTest({ config, bundle: { app: null, auth: null, db: fs, memoryOnly: false } });
    const gate = (fn, fallback) => async (...args) => { if (offline[name]) { if (fallback) return fallback(...args); throw Object.assign(new Error('offline'), { code: 'unavailable' }); } return fn(...args); };
    db.useVaultsForTest(plain(), plain(), plain());
    db.useCloudForTest({
        available: () => true,
        push: gate(cloud.pushUserData, (uid, state, { hashes = {} } = {}) => ({ ok: false, pending: 1, hashes, rejected: [] })),
        pull: gate(cloud.pullUserData),
        remove: gate(cloud.deleteUserDoc),
        peek: gate(cloud.peekTodos, () => null),
        clock: async (...a) => (noclock[name] ? null : gate(cloud.measureServerClock, () => null)(...a)),
        sweep: gate(cloud.sweepTombs, () => 0),
        watch: (...a) => (watching[name] ? cloud.watchTodos(...a) : () => {}),
    });
    await db.boot('');
    devices[name] = { db, cloud, fb, fs };
}
const A = devices.A.db;
const B = devices.B.db;
const on = async (dev, fn) => { cur = dev; const out = await fn(devices[dev].db, devices[dev]); await wait(5); return out; };
const sync = (dev) => on(dev, (db) => db.refreshFromCloud({ force: true }));

const ts = {};
for (const [name, dir] of [['A', 'a'], ['B', 'b']]) ts[name] = await import(new URL(`.tabsyncdev/${dir}/src/ui/tabSlots.js`, root));
const orderOf = (dev) => { cur = dev; return ts[dev].loadTabOrder().join(); };
const setT = (dev, order) => on(dev, () => ts[dev].saveTabOrder(order));
const cloudTab = async () => { const s = await getDoc(doc(admin(), 'users', UID, 'settings', 'tabbar')); return s.exists() ? s.data() : null; };
const O1 = ['minutes', 'todo', 'attend', 'schedule', 'students', 'more'];
const O2 = ['notice', 'today', 'todo', 'attend', 'schedule', 'more'];
const O3 = ['neis', 'settings', 'today', 'todo', 'more', 'attend'];
const O4 = ['schedule', 'attend', 'todo', 'today', 'students', 'more'];

await env.clearFirestore();
/* 폰(A) 시계는 1시간 늦고 PC(B)는 1시간 빠릅니다. */
await on('A', (db) => db.useDeviceClockForTest(() => Date.now() - HOUR));
await on('B', (db) => db.useDeviceClockForTest(() => Date.now() + HOUR));

/* T0: 로그인 전에는 이 기기에만 둡니다(클라우드 문서 없음). */
await setT('A', O4);
await wait(50);
check(orderOf('A') === O4.join() && !(await cloudTab()), `T0: 로그인 전 배치가 로컬에 남지 않았거나 클라우드에 올라갔습니다: ${JSON.stringify(await cloudTab())}`);

await on('A', (db) => db.setAuth({ uid: UID }));
await on('B', (db) => db.setAuth({ uid: UID }));
await wait(50);

/* T1: 폰에서 바꾼 배치가 PC에도 옵니다. */
await wait(GAP);
await setT('A', O1);
await on('A', (db) => db.flushCloud());
check((await cloudTab())?.order?.join() === O1.join(), `T1: 폰 배치가 클라우드에 올라가지 않았습니다: ${JSON.stringify(await cloudTab())}`);
await sync('B');
check(orderOf('B') === O1.join(), `T1: PC가 폰 배치를 받지 못했습니다: ${orderOf('B')}`);

/* T2: 둘 다 오프라인. PC(시계 +1h)가 먼저, 폰(시계 -1h)이 나중에 고침. 올리는 순서와 상관없이 나중에 고친 폰 값이 이깁니다. */
offline.A = true; offline.B = true;
await setT('B', O2);
await wait(GAP);
await setT('A', O3);
check(orderOf('A') === O3.join() && orderOf('B') === O2.join(), 'T2: 오프라인에서 이 기기 배치가 바로 바뀌지 않았습니다.');
offline.A = false; await sync('A');
offline.B = false; await sync('B');
await sync('A');
check((await cloudTab())?.order?.join() === O3.join(), `T2: 먼저 고친 PC 값이 이겼습니다: ${JSON.stringify(await cloudTab())}`);
check(orderOf('A') === O3.join() && orderOf('B') === O3.join(), `T2: 두 기기가 나중 값으로 맞춰지지 않았습니다: 폰 ${orderOf('A')} / PC ${orderOf('B')}`);

/* T3: 거울. 폰이 먼저, PC가 나중에 고치고 폰이 나중에 올려도 PC 값. */
offline.A = true; offline.B = true;
await setT('A', O1);
await wait(GAP);
await setT('B', O4);
offline.B = false; await sync('B');
offline.A = false; await sync('A');
await sync('B');
check(orderOf('A') === O4.join() && orderOf('B') === O4.join(), `T3: 나중에 고친 PC 값이 지켜지지 않았습니다: 폰 ${orderOf('A')} / PC ${orderOf('B')}`);

/* T4: 받은 값의 저장 모양은 #70과 같은 { order, at } 입니다. */
cur = 'A';
const raw = JSON.parse(globalThis.localStorage.getItem('ssug-gyomu-tabbar'));
check(Object.keys(raw).sort().join() === 'at,order' && Number.isInteger(raw.at), `T4: 저장 모양이 달라졌습니다: ${JSON.stringify(raw)}`);

/* T5: 망가진 클라우드 값은 받지 않습니다. */
check(!ts.A.absorbTabbar({ order: ['hack'], at: Date.now() + 9 * HOUR }) && orderOf('A') === O4.join(), 'T5: 망가진 클라우드 배치를 받았습니다.');

for (const d of Object.values(devices)) { try { await terminate(d.fs); } catch { /* 이미 닫힘 */ } }
await env.cleanup();
rmSync(new URL('.tabsyncdev/', root), { recursive: true, force: true });
if (failures.length) { console.error(failures.map((f) => `- ${f}`).join('\n')); process.exit(1); }
console.log('탭바 배치 두 기기 동기화 검사 통과(진짜 cloud.js·규칙, 시계 ±1시간, 나중에 고친 쪽이 이김)');
process.exit(0);
