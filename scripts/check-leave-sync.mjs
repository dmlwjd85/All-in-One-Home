/**
 * 오늘 조퇴 시각 두 기기 동기화(에뮬레이터 + 실제 규칙 + 진짜 cloud.js). 고치기 전에는 조퇴 시각이 이 기기에만 남아 L1이 실패했습니다.
 */
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { execSync } from 'node:child_process';
import { collection, doc, getDoc, getDocs, disableNetwork, enableNetwork, serverTimestamp, setDoc, Timestamp, terminate } from 'firebase/firestore';

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

/* L7: 기기 시계 자체(Date.now)가 1시간 빠른 PC. 고친 시각은 서버 시각으로 보정한 값이어야 합니다(기기 시계를 그대로 쓰면 규칙이 거절하거나 늘 이깁니다). */
{
    const realNow = Date.now;
    const skew = HOUR;
    Date.now = () => realNow() + skew;
    try {
        await on('B', (db) => db.useDeviceClockForTest(() => Date.now()));
        await sync('B');
        await setL('B', '09:50');
        cur = 'B';
        const at = pl.B.leaveState().at;
        check(Math.abs(at - realNow()) < 5 * 60 * 1000, `L7: 조퇴 고친 시각이 서버 시각이 아니라 기기 시계입니다(차이 ${Math.round((at - realNow()) / 60000)}분)`);
        await on('B', (db) => db.flushCloud());
    } finally { Date.now = realNow; }
    check((await cloudSettings())?.t === '09:50', `L7: 시계가 빠른 기기의 조퇴가 올라가지 않았습니다: ${JSON.stringify(await cloudSettings())}`);
    await on('B', (db) => db.useDeviceClockForTest(() => Date.now() + HOUR));
}

/* L8: 예전 모양({오늘:'13:00'}, at 없음) 로컬 값. 클라우드에 조퇴 문서가 없으면 첫 동기화에 올리고, 있으면 덮지 않습니다. */
await env.withSecurityRulesDisabled(async (c) => { const { deleteDoc } = await import('firebase/firestore'); await deleteDoc(doc(c.firestore(), 'users', UID, 'settings', 'leave')); });
await on('A', () => { stores.A.set(pl.A.LEAVE_KEY, JSON.stringify({ [TODAY]: '13:00' })); });
await on('A', (db) => db.flushCloud());
check((await cloudSettings())?.t === '13:00', `L8: 예전 모양 조퇴 값이 첫 동기화에 올라가지 않았습니다: ${JSON.stringify(await cloudSettings())}`);
cur = 'A';
check(pl.A.leaveState().at > 0, 'L8: 올린 뒤 예전 모양 값에 고친 시각이 남지 않았습니다.');
await wait(GAP);
await setL('B', '15:20');
await on('B', (db) => db.flushCloud());
await on('A', () => { stores.A.set(pl.A.LEAVE_KEY, JSON.stringify({ [TODAY]: '08:00' })); });
await sync('A');
check((await cloudSettings())?.t === '15:20' && leaveOf('A') === '15:20', `L8: 예전 모양 값이 더 최근 클라우드 값을 덮었습니다: 클라우드 ${JSON.stringify(await cloudSettings())} / 폰 '${leaveOf('A')}'`);

/* L9: 실시간 감시. 열려 있는 PC가 새로 받지 않아도 폰에서 바꾼 조퇴가 옵니다. */
{
    const off = await on('B', (_db, d) => d.cloud.watchTodos(UID, () => on('B', (db) => db.refreshFromCloud({ force: true }))));
    await wait(300);
    await wait(GAP);
    await setL('A', '14:45');
    await on('A', (db) => db.flushCloud());
    let ok = false;
    for (let i = 0; i < 40 && !ok; i += 1) { await wait(100); ok = leaveOf('B') === '14:45'; }
    check(ok, `L9: 실시간 감시로 조퇴가 오지 않았습니다: PC '${leaveOf('B')}'`);
    off();
}

/* L11: 2일 넘게 오프라인이던 기기. 규칙은 오래된 at을 영구히 거절하므로,
   오늘 조퇴면 지금 시각으로 다시 찍어 보내고, 오늘이 아니면 보내지 않고 지웁니다. */
{
    cur = 'A';
    const stale = Date.now() - 3 * 24 * HOUR;
    await on('A', () => { stores.A.set(pl.A.LEAVE_KEY, JSON.stringify({ [TODAY]: '11:10', date: TODAY, at: stale })); });
    const r = await on('A', (db) => db.flushCloud());
    check((await cloudSettings())?.t === '11:10', `L11: 오래된 at의 오늘 조퇴가 다시 찍혀 올라가지 않았습니다: ${JSON.stringify(await cloudSettings())} ${JSON.stringify(r)}`);
    cur = 'A';
    check(pl.A.leaveState().at > stale + 24 * HOUR, 'L11: 다시 보낸 조퇴의 로컬 at이 새로 찍히지 않았습니다.');
    const yday = new Date(Date.parse(`${TODAY}T12:00:00Z`) - 24 * HOUR).toISOString().slice(0, 10);
    await on('A', () => { stores.A.set(pl.A.LEAVE_KEY, JSON.stringify({ [yday]: '10:00', date: yday, at: stale })); });
    const r2 = await on('A', (db) => db.flushCloud());
    check((await cloudSettings())?.t === '11:10' && !(r2?.rejected || []).includes('settings/leave'), `L11: 지난날 조퇴를 올리려 했습니다: ${JSON.stringify(await cloudSettings())} ${JSON.stringify(r2)}`);
    cur = 'A';
    check(!pl.A.leaveState().date, `L11: 지난날 조퇴가 로컬에서 정리되지 않았습니다: ${JSON.stringify(pl.A.leaveState())}`);
}

/* 규칙: 모양이 틀린 조퇴 칸은 거절, 맞는 칸은 받습니다. */
const tryLeave = (leave) => setDoc(doc(admin(), 'users', UID, 'settings', 'leave'), { updatedAt: serverTimestamp(), ...leave }).then(() => true, () => false);
check(!(await setDoc(doc(admin(), 'users', UID, 'settings', 'other'), { d: TODAY, t: '', at: 1 }).then(() => true, () => false)), '규칙: settings 아래 낯선 문서를 받아들였습니다.');
check(await tryLeave({ d: TODAY, t: '14:00', at: Date.now() }), '규칙: 맞는 조퇴 칸을 거절했습니다.');
check(await tryLeave({ d: '2028-02-29', t: '', at: Date.now() }), '규칙: 윤년 2월 29일을 거절했습니다.');
check(!(await tryLeave({ d: TODAY, t: '25:00', at: Date.now() })), '규칙: 틀린 조퇴 시각(25:00)을 받아들였습니다.');
check(!(await tryLeave({ d: '어제', t: '14:00', at: Date.now() })), '규칙: 틀린 날짜를 받아들였습니다.');
for (const bad of ['2026-02-31', '2026-04-31', '2027-02-29', '2026-13-01', '2026-00-10']) check(!(await tryLeave({ d: bad, t: '14:00', at: Date.now() })), `규칙: 없는 날짜(${bad})를 받아들였습니다.`);
check(!(await tryLeave({ d: TODAY, t: '14:00', at: Date.now(), x: 1 })), '규칙: 조퇴 칸의 낯선 키를 받아들였습니다.');
check(!(await tryLeave({ d: TODAY, t: '14:00' })), '규칙: 시각(at) 없는 조퇴 칸을 받아들였습니다.');
for (const [bad, why] of [[String(Date.now()), '문자열'], [0, '0'], [Date.now() + 0.5, '소수'], [Date.now() + HOUR, '1시간 뒤'], [4102444800000, '2100년'], [Date.now() - 3 * 24 * HOUR, '3일 전']]) check(!(await tryLeave({ d: TODAY, t: '14:00', at: bad })), `규칙: 틀린 at(${why})을 받아들였습니다.`);
check(!(await tryLeave({ d: TODAY, t: '14:00', at: Date.now(), updatedAt: Timestamp.fromMillis(Date.now() - 60000) })), '규칙: 서버 시각이 아닌 updatedAt을 받아들였습니다.');
check(!(await setDoc(doc(admin(), 'users', UID, 'settings', 'leave'), { d: TODAY, t: '14:00', at: Date.now() }).then(() => true, () => false)), '규칙: updatedAt 없는 조퇴 칸을 받아들였습니다.');

/* L10: 옛 규칙(main, 조퇴 문서 모름)이 게시된 상태. 거절은 조용히 ok가 아니라 rejected로 알리고, 다시 올리기는 점점 늦춥니다. */
{
    let oldRules = '';
    try { oldRules = execSync('git show origin/main:firestore.rules', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); } catch { oldRules = ''; }
    if (!oldRules.includes("key == 'device' && settingsOk") || oldRules.includes('leaveOk')) oldRules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8').replace("((key == 'device' && settingsOk(request.resource.data)) || (key == 'leave' && leaveOk(request.resource.data)))", "key == 'device' && settingsOk(request.resource.data)");
    check(!oldRules.includes("key == 'leave'"), 'L10: 옛 규칙을 만들지 못했습니다.');
    const old = await initializeTestEnvironment({ projectId: 'demo-ssug-oldrules', firestore: { host, port: Number(port), rules: oldRules } });
    /* 이 기기의 배경 올리기가 끼어들지 않게 막고, 진짜 pushUserData만 직접 부릅니다. */
    offline.A = true;
    await wait(300);
    cur = 'A';
    const cloud = devices.A.cloud;
    devices.A.fb.useFirebaseForTest({ config: { ...config, projectId: 'demo-ssug-oldrules' }, bundle: { app: null, auth: null, db: old.authenticatedContext(UID).firestore(), memoryOnly: false } });
    cloud.resetLeaveBackoffForTest();
    pl.A.setLeave(TODAY, '13:30');
    const state = { profile: {}, settings: {}, students: [], attendance: [], records: [], inbox: [], todos: [], events: [], notes: [], notices: [], timetable: {} };
    const r1 = await cloud.pushUserData(UID, state, { hashes: {} });
    check((r1.rejected || []).includes('settings/leave'), `L10: 옛 규칙의 조퇴 거절이 조용히 넘어갔습니다: ${JSON.stringify({ ok: r1.ok, pending: r1.pending, rejected: r1.rejected })}`);
    const b1 = cloud.leaveBackoffForTest();
    const r2 = await cloud.pushUserData(UID, state, { hashes: r1.hashes || {} });
    check(!(r2.rejected || []).includes('settings/leave') && b1.wait >= 5 * 60 * 1000, `L10: 거절 직후 곧바로 다시 올렸습니다(쉬는 시간 ${b1.wait}ms)`);
    const realNow = Date.now;
    Date.now = () => realNow() + b1.wait + 1000;
    let r3;
    try { r3 = await cloud.pushUserData(UID, state, { hashes: r1.hashes || {} }); } finally { Date.now = realNow; }
    const b2 = cloud.leaveBackoffForTest();
    check((r3.rejected || []).includes('settings/leave') && b2.wait === b1.wait * 2, `L10: 쉬는 시간이 늘지 않았습니다: ${b1.wait} → ${b2.wait}`);
    /* 늦추기 상태는 로컬에 남아 새로 고쳐도 이어집니다. */
    check(JSON.parse(stores.A.get('ssug-gyomu-leave-backoff') || '{}').wait === b2.wait, `L10: 늦추기 상태가 로컬에 남지 않았습니다: ${stores.A.get('ssug-gyomu-leave-backoff')}`);
    /* L12: 거절이 이어져도 쉬는 시간은 6시간을 넘지 않습니다. */
    let last = b2;
    const waits = [];
    /* 날짜가 넘어가 조퇴가 지워지지 않게 조퇴 시계는 실제 시각에 묶어 둡니다. */
    const skew = devices.A.db.serverNow() - realNow();
    pl.A.useLeaveClock(() => realNow() + skew);
    for (let i = 0; i < 9; i += 1) {
        const base = Date.now;
        const shift = last.until - realNow() + 1000;
        Date.now = () => base() + shift;
        try { await cloud.pushUserData(UID, state, { hashes: r1.hashes || {} }); } finally { Date.now = base; }
        last = cloud.leaveBackoffForTest();
        waits.push(last.wait);
    }
    pl.A.useLeaveClock(() => devices.A.db.serverNow());
    check(waits.every((w) => w <= 6 * HOUR) && waits.at(-1) === 6 * HOUR, `L12: 쉬는 시간 상한(6시간)이 지켜지지 않았습니다: ${waits.map((w) => Math.round(w / 60000)).join(', ')}분`);
    devices.A.fb.useFirebaseForTest({ config, bundle: { app: null, auth: null, db: devices.A.fs, memoryOnly: false } });
    cloud.resetLeaveBackoffForTest();
    offline.A = false;
    await old.cleanup();
}

await env.cleanup();
rmSync(new URL('.leavedev/', root), { recursive: true, force: true });
if (failures.length) {
    console.error(`조퇴 시각 두 기기 검사 실패 ${failures.length}건\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('조퇴 시각 두 기기 동기화 검사 통과(진짜 cloud.js·규칙, 시계 ±1시간)');
process.exit(0);
