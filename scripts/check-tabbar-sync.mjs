/**
 * 하단 탭바 배치 두 기기 동기화(에뮬레이터 + 실제 규칙 + 진짜 cloud.js). 나중에 고친 쪽이 이기고, 오프라인·로그인 전에는 이 기기에만 남습니다.
 * T7 park/adopt·flush 리스너 0회, T8 손님→가방 없는 첫 로그인 승계 정책, T9 flush 중 계정 전환 격리.
 */
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { execSync } from 'node:child_process';
import { collection, doc, getDoc, getDocs, deleteDoc, disableNetwork, enableNetwork, serverTimestamp, setDoc, Timestamp, terminate } from 'firebase/firestore';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
{
    const workflow = readFileSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
    const syncAt = workflow.indexOf('npm run check:tabbarsync');
    const rulesAt = workflow.indexOf('npm run check:rules');
    check(syncAt > rulesAt && rulesAt >= 0, 'CI에서 check:tabbarsync가 check:rules 근처(에뮬레이터 검사)에 없습니다.');
}
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

const cloudTabOf = async (uid) => {
    const s = await getDoc(doc(env.authenticatedContext(uid).firestore(), 'users', uid, 'settings', 'tabbar'));
    return s.exists() ? s.data() : null;
};
const bindFs = (dev, uid) => {
    const fs = env.authenticatedContext(uid).firestore();
    devices[dev].fb.useFirebaseForTest({ config, bundle: { app: null, auth: null, db: fs, memoryOnly: false } });
    devices[dev].fs = fs;
};

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

/* T6: 같은 기기에서 계정 전환 — A 배치가 B로 새지 않고, 다시 A로 오면 되살아납니다. */
const UID2 = 'teacher-tabsync-b';
await wait(GAP);
await setT('A', O1);
await on('A', (db) => db.flushCloud());
const cloudBefore = await cloudTab();
check(cloudBefore?.order?.join() === O1.join(), `T6: 전환 전 A 클라우드 준비가 안 됐습니다: ${JSON.stringify(cloudBefore)}`);
await on('A', (db) => db.setAuth({ uid: UID2 }));
await wait(50);
cur = 'A';
const afterSwitch = ts.A.tabState();
check(afterSwitch.at === 0 && afterSwitch.order.join() === ts.A.DEFAULT_ORDER.join(), `T6: B로 바꾼 뒤 로컬이 비지 않았습니다: ${JSON.stringify(afterSwitch)}`);
await on('A', (db) => db.flushCloud());
const cloudAfter = await cloudTab();
check(cloudAfter?.order?.join() === O1.join() && cloudAfter?.at === cloudBefore.at, `T6: 계정 전환 뒤 A 클라우드가 덮였습니다: ${JSON.stringify(cloudAfter)}`);
await on('A', (db) => db.setAuth({ uid: UID }));
await wait(50);
check(orderOf('A') === O1.join() && ts.A.tabState().at > 0, `T6: A로 돌아왔을 때 배치가 되살아나지 않았습니다: ${orderOf('A')} / ${JSON.stringify(ts.A.tabState())}`);


/* T7: parkTabAccount → at 0·가방 보관, adoptTabAccount 복원, 그동안 subscribeTabOrder(flush 트리거) 0회 */
{
    cur = 'A';
    const parkedOrder = O3;
    await setT('A', parkedOrder);
    const before = ts.A.tabState();
    check(before.at > 0 && before.order.join() === parkedOrder.join(), `T7: park 전 로컬 준비가 안 됐습니다: ${JSON.stringify(before)}`);
    let flushListeners = 0;
    const stopListen = ts.A.subscribeTabOrder(() => { flushListeners += 1; });
    ts.A.parkTabAccount('A');
    const parked = ts.A.tabState();
    check(parked.at === 0 && parked.order.join() === ts.A.DEFAULT_ORDER.join(), `T7: park 뒤 at=0·기본 배치가 아닙니다: ${JSON.stringify(parked)}`);
    const bagRaw = globalThis.localStorage.getItem(ts.A.TAB_ACCOUNTS_KEY);
    const bag = bagRaw ? JSON.parse(bagRaw) : {};
    check(bag.A && bag.A.at === before.at && bag.A.order.join() === before.order.join(), `T7: park 뒤 가방에 A가 없습니다: ${bagRaw}`);
    const adopted = ts.A.adoptTabAccount('A');
    check(adopted === true, 'T7: adoptTabAccount가 false를 돌려줬습니다.');
    const after = ts.A.tabState();
    check(after.at === before.at && after.order.join() === before.order.join(), `T7: adopt 뒤 복원이 안 됐습니다: ${JSON.stringify(after)}`);
    stopListen();
    check(flushListeners === 0, `T7: park/adopt 동안 flush 리스너가 ${flushListeners}회 불렸습니다(0이어야 함).`);
}

/* T8: 손님 배치(at>0) 뒤 가방 없는 B 첫 로그인 — 승계 정책: 로컬 손님 배치가 B 클라우드로 올라감(명시) */
{
    const UID2 = 'teacher-tabsync-b';
    const OGUEST = ['notice', 'minutes', 'todo', 'attend', 'schedule', 'more'];
    await on('B', (db) => db.setAuth(null));
    await wait(30);
    cur = 'B';
    /* 진짜 손님(이전에 로그인 흔적 없음): lastCloudUid 비움 → setAuth가 전환이 아니라 첫 로그인(adopt) 경로 */
    globalThis.localStorage.removeItem('ssug-gyomu-cloud-forget');
    devices.B.db.reloadCloudForgetForTest();
    globalThis.localStorage.removeItem(ts.B.TAB_ACCOUNTS_KEY);
    globalThis.localStorage.removeItem(ts.B.TAB_KEY);
    await setT('B', OGUEST);
    const guest = ts.B.tabState();
    check(guest.at > 0 && guest.order.join() === OGUEST.join(), `T8: 손님 배치 준비가 안 됐습니다: ${JSON.stringify(guest)}`);
    check(!(await cloudTabOf(UID2)), `T8: 로그인 전 B 클라우드에 이미 문서가 있습니다: ${JSON.stringify(await cloudTabOf(UID2))}`);
    const bagBefore = globalThis.localStorage.getItem(ts.B.TAB_ACCOUNTS_KEY);
    check(!bagBefore || !JSON.parse(bagBefore || '{}')[UID2], `T8: B 가방이 비어 있어야 합니다: ${bagBefore}`);
    bindFs('B', UID2);
    await on('B', (db) => db.setAuth({ uid: UID2 }));
    await wait(50);
    /* adopt 실패(가방 없음) → 손님 배치 유지가 정책 */
    check(orderOf('B') === OGUEST.join() && ts.B.tabState().at > 0, `T8: 첫 로그인 뒤 손님 배치가 유지되지 않았습니다: ${JSON.stringify(ts.B.tabState())}`);
    await on('B', (db) => db.flushCloud());
    const bCloud = await cloudTabOf(UID2);
    check(bCloud?.order?.join() === OGUEST.join(), `T8: 승계 정책 — 가방 없는 첫 로그인 후 B 클라우드에 손님 배치가 올라가야 합니다: ${JSON.stringify(bCloud)}`);
    /* 손님 승계는 B(UID2)에만 적용되고 A(UID) 클라우드 문서를 손님 배치로 덮지 않습니다. */
    const aStill = await cloudTabOf(UID);
    check(aStill?.order?.join() !== OGUEST.join(), `T8: A 클라우드에 손님 배치가 새어 들어갔습니다: ${JSON.stringify(aStill)}`);
}

/* T9: A flush 진행 중 B로 전환 — A cloud 배치 보존, B cloud에 A order 미기록 */
{
    const UID2 = 'teacher-tabsync-b';
    bindFs('A', UID);
    await on('A', (db) => db.setAuth({ uid: UID }));
    await wait(GAP);
    await setT('A', O1);
    await on('A', (db) => db.flushCloud());
    const before = await cloudTabOf(UID);
    check(before?.order?.join() === O1.join(), `T9: 전환 전 A 클라우드 준비 실패: ${JSON.stringify(before)}`);
    /* B 클라우드를 비워 둔 뒤(이전 T8 문서 삭제) 경합을 봅니다. */
    try {
        await deleteDoc(doc(env.authenticatedContext(UID2).firestore(), 'users', UID2, 'settings', 'tabbar'));
    } catch { /* 없으면 무시 */ }
    await wait(GAP);
    /* 올릴 거리가 있게 한 번 더 고친 뒤, flush를 기다리기 전에 B로 바꿉니다. */
    await setT('A', O1);
    cur = 'A';
    const pending = devices.A.db.flushCloud();
    await on('A', (db) => db.setAuth({ uid: UID2 }));
    /* 전환 뒤 B 토큰으로 바인딩해, 새면 B 경로에 실제로 쓰이게 합니다(미기록 검증). */
    bindFs('A', UID2);
    await pending.catch(() => {});
    await wait(120);
    await on('A', (db) => db.flushCloud()).catch(() => {});
    const aAfter = await cloudTabOf(UID);
    check(aAfter?.order?.join() === O1.join(), `T9: flush 중 전환 뒤 A 클라우드가 덮였습니다: ${JSON.stringify(aAfter)} / before ${JSON.stringify(before)}`);
    check(Number(aAfter?.at) >= Number(before.at), `T9: A 클라우드 at이 줄었습니다: ${JSON.stringify(aAfter)} / before ${JSON.stringify(before)}`);
    const bAfter = await cloudTabOf(UID2);
    check(!bAfter || bAfter.order.join() !== O1.join(), `T9: B 클라우드에 A 배치(O1)가 기록됐습니다: ${JSON.stringify(bAfter)}`);
}


for (const d of Object.values(devices)) { try { await terminate(d.fs); } catch { /* 이미 닫힘 */ } }
await env.cleanup();
rmSync(new URL('.tabsyncdev/', root), { recursive: true, force: true });
if (failures.length) { console.error(failures.map((f) => `- ${f}`).join('\n')); process.exit(1); }
console.log('탭바 배치 두 기기 동기화 검사 통과(진짜 cloud.js·규칙, 시계 ±1시간, 나중에 고친 쪽이 이김, 계정 전환 격리)');
process.exit(0);
