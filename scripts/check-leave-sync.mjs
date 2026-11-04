/**
 * 오늘 조퇴 시각 두 기기 동기화(에뮬레이터 + 실제 규칙 + 진짜 cloud.js). 고치기 전에는 조퇴 시각이 이 기기에만 남아 L1이 실패했습니다.
 */
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, disableNetwork, enableNetwork, setDoc, terminate } from 'firebase/firestore';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-ssug-rules', firestore: { host, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const UID = 'teacher2';
const admin = () => env.authenticatedContext(UID).firestore();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3600 * 1000;
/* 서버 시각 보정 오차는 왕복 시간의 절반 정도입니다. 두 기기 수정 사이를 1.5초로 둡니다(사람이 두 기기에서 고치는 간격보다 짧음). */
const GAP = 1500;

/* 기기마다 src 복사본(모듈 따로) */
const root = new URL('../', import.meta.url);
rmSync(new URL('.leavedev/', root), { recursive: true, force: true });
for (const d of ['a', 'b']) cpSync(new URL('src/', root), new URL(`.leavedev/${d}/src/`, root), { recursive: true });

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
    const fb = await import(new URL(`.leavedev/${dir}/src/firebase.js`, root));
    const cloud = await import(new URL(`.leavedev/${dir}/src/lib/cloud.js`, root));
    const db = await import(new URL(`.leavedev/${dir}/src/lib/db.js`, root));
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

const pl = {};
for (const [name, dir] of [['A', 'a'], ['B', 'b']]) pl[name] = await import(new URL(`.leavedev/${dir}/src/lib/periodLocal.js`, root));
const leaveOf = (dev) => { cur = dev; return pl[dev].leaveFor(TODAY); };
const setL = (dev, hm) => on(dev, () => pl[dev].setLeave(TODAY, hm));
const cloudSettings = async () => { const s = await getDoc(doc(admin(), 'users', UID, 'settings', 'leave')); return s.exists() ? s.data() : null; };
const TODAY = new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 10);

await env.clearFirestore();
/* 폰(A) 시계는 1시간 늦고 PC(B)는 1시간 빠릅니다. */
await on('A', (db) => db.useDeviceClockForTest(() => Date.now() - HOUR));
await on('B', (db) => db.useDeviceClockForTest(() => Date.now() + HOUR));
await on('A', (db) => db.setAuth({ uid: UID }));
await on('B', (db) => db.setAuth({ uid: UID }));
await wait(50);

/* L1: 폰에서 조퇴 시각을 정하면 PC에도 옵니다(제보: '조퇴 시간을 넣었는데 동기화가 안 돼요'). 설정을 한 번도 고치지 않은 계정이어도 올라가야 합니다. */
await setL('A', '14:30');
await on('A', (db) => db.flushCloud());
check((await cloudSettings())?.t === '14:30', `L1: 폰에서 정한 조퇴 시각이 클라우드에 올라가지 않았습니다: ${JSON.stringify(await cloudSettings())}`);
await sync('B');
check(leaveOf('B') === '14:30', `L1: PC가 폰에서 정한 조퇴 시각을 받지 못했습니다: '${leaveOf('B')}'`);

/* L2: PC에서 조퇴를 취소하면 폰에서도 취소됩니다(취소도 동기화). */
await wait(GAP);
await setL('B', '');
await on('B', (db) => db.flushCloud());
await sync('A');
check(leaveOf('A') === '', `L2: PC에서 취소한 조퇴가 폰에 남았습니다: '${leaveOf('A')}'`);

/* L3: 둘 다 오프라인. PC(시계 +1h)가 먼저, 폰(시계 -1h)이 나중에 고침. PC가 나중에 올려도 나중에 고친 폰 값이 이깁니다. */
offline.A = true; offline.B = true;
await setL('B', '15:00');
await wait(GAP);
await setL('A', '13:10');
offline.A = false; await sync('A');
offline.B = false; await sync('B');
await sync('A');
check((await cloudSettings())?.t === '13:10', `L3: 먼저 고친 PC 값이 이겼습니다: ${JSON.stringify(await cloudSettings())}`);
check(leaveOf('A') === '13:10' && leaveOf('B') === '13:10', `L3: 두 기기가 나중 값으로 맞춰지지 않았습니다: 폰 '${leaveOf('A')}' / PC '${leaveOf('B')}'`);

/* L4: 거울. 폰이 먼저, PC가 나중에 고치고 폰이 나중에 올려도 PC 값. */
offline.A = true; offline.B = true;
await setL('A', '12:00');
await wait(GAP);
await setL('B', '16:00');
offline.B = false; await sync('B');
offline.A = false; await sync('A');
await sync('B');
check(leaveOf('A') === '16:00' && leaveOf('B') === '16:00', `L4: 나중에 고친 PC 값이 지켜지지 않았습니다: 폰 '${leaveOf('A')}' / PC '${leaveOf('B')}'`);

/* L5: 조퇴를 고쳐도 다른 설정(출퇴근 시각)은 그대로 갑니다. */
await on('A', () => pl.A.patchPeriodLocal({ workStart: '08:30', workEnd: '16:40' }));
await on('A', (db) => db.flushCloud());
await sync('B');
cur = 'B';
check(pl.B.readPeriodLocal().workEnd === '16:40' && leaveOf('B') === '16:00', `L5: 출퇴근 시각과 조퇴가 함께 맞지 않습니다: ${pl.B.readPeriodLocal().workEnd} / '${leaveOf('B')}'`);

/* L6: 받기에서 클라우드의 더 오래된 조퇴 값은 이 기기의 더 늦은 값을 덮지 않고, 더 늦은 값은 덮습니다. */
await wait(GAP);
await setL('A', '11:40');
await on('A', (db) => db.absorbCloudForTest({ leave: { d: TODAY, t: '10:00', at: 1000 } }));
check(leaveOf('A') === '11:40', `L6: 더 오래된 클라우드 조퇴 값이 이 기기의 나중 값을 덮었습니다: '${leaveOf('A')}'`);
await on('A', (db) => db.absorbCloudForTest({ leave: { d: TODAY, t: '10:20', at: Date.now() + 9 * HOUR } }));
check(leaveOf('A') === '10:20', `L6: 더 늦은 클라우드 조퇴 값을 받지 않았습니다: '${leaveOf('A')}'`);

/* 규칙: 모양이 틀린 조퇴 칸은 거절, 맞는 칸은 받습니다. */
const tryLeave = (leave) => setDoc(doc(admin(), 'users', UID, 'settings', 'leave'), leave).then(() => true, () => false);
check(!(await setDoc(doc(admin(), 'users', UID, 'settings', 'other'), { d: TODAY, t: '', at: 1 }).then(() => true, () => false)), '규칙: settings 아래 낯선 문서를 받아들였습니다.');
check(await tryLeave({ d: TODAY, t: '14:00', at: Date.now() }), '규칙: 맞는 조퇴 칸을 거절했습니다.');
check(!(await tryLeave({ d: TODAY, t: '25:00', at: Date.now() })), '규칙: 틀린 조퇴 시각(25:00)을 받아들였습니다.');
check(!(await tryLeave({ d: '어제', t: '14:00', at: Date.now() })), '규칙: 틀린 날짜를 받아들였습니다.');
check(!(await tryLeave({ d: TODAY, t: '14:00', at: Date.now(), x: 1 })), '규칙: 조퇴 칸의 낯선 키를 받아들였습니다.');
check(!(await tryLeave({ d: TODAY, t: '14:00' })), '규칙: 시각(at) 없는 조퇴 칸을 받아들였습니다.');

await env.cleanup();
rmSync(new URL('.leavedev/', root), { recursive: true, force: true });
if (failures.length) {
    console.error(`조퇴 시각 두 기기 검사 실패 ${failures.length}건\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('조퇴 시각 두 기기 동기화 검사 통과(진짜 cloud.js·규칙, 시계 ±1시간)');
process.exit(0);
