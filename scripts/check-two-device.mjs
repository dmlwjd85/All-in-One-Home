/**
 * 두 기기 할 일 동기화(에뮬레이터 + 실제 규칙 + 진짜 cloud.js): PR #56 검수(7.5점) 시나리오 S1·S3·S3r·S4·S5·S8과 살아남은 변이 N3·N10~N15.
 * 폰(A)·PC(B)는 src를 따로 복사해 불러 서로 다른 모듈(db.js·cloud.js·firebase.js)과 서로 다른 Firestore 클라이언트를 씁니다.
 * 올리기·받기·지우기·서버 시각 재기는 진짜 pushUserData·pullUserData·deleteUserDoc·peekTodos·measureServerClock(serverTimestamp 포함)입니다.
 * 오프라인은 그 함수들 앞에서 'unavailable'로 막아 흉내 냅니다(실제 앱도 오프라인이면 올리기가 실패해 다음에 다시 올립니다).
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
rmSync(new URL('.twodev/', root), { recursive: true, force: true });
for (const d of ['a', 'b']) cpSync(new URL('src/', root), new URL(`.twodev/${d}/src/`, root), { recursive: true });

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
for (const [name, dir] of [['A', 'a'], ['B', 'b']]) {
    cur = name;
    const fb = await import(new URL(`.twodev/${dir}/src/firebase.js`, root));
    const cloud = await import(new URL(`.twodev/${dir}/src/lib/cloud.js`, root));
    const db = await import(new URL(`.twodev/${dir}/src/lib/db.js`, root));
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
    });
    await db.boot('');
    devices[name] = { db, cloud, fb, fs };
}
const A = devices.A.db;
const B = devices.B.db;
const on = async (dev, fn) => { cur = dev; const out = await fn(devices[dev].db, devices[dev]); await wait(5); return out; };
const todo = (db, id) => db.snapshot().todos.find((t) => t.id === id);
const cloudDoc = async (id) => { const s = await getDoc(doc(admin(), 'users', UID, 'todos', id)); return s.exists() ? s.data() : null; };
const sync = (dev) => on(dev, (db) => db.refreshFromCloud({ force: true }));
const edit = (dev, id, title) => on(dev, (db) => db.saveTextItem('todos', { ...todo(db, id), title }, { from: 'cloud' }));

/* 시계: 폰은 1시간 늦고 PC는 1시간 빠릅니다(S4·S5). */
await env.clearFirestore();
await on('A', (db) => db.useDeviceClockForTest(() => Date.now() - HOUR));
await on('B', (db) => db.useDeviceClockForTest(() => Date.now() + HOUR));
await on('A', (db) => db.setAuth({ uid: UID }));
await on('B', (db) => db.setAuth({ uid: UID }));
await wait(50);
for (const [dev, skew] of [['A', HOUR], ['B', -HOUR]]) {
    const o = await on(dev, (db) => db.clockForTest().o);
    check(Math.abs(o - skew) < 5000, `${dev} 서버 시각 차이를 재지 못했습니다: ${o}(기대 ${skew})`);
}

/* 준비: 할 일 여러 개를 폰에서 적어 올리고 PC가 받습니다. */
await on('A', async (db) => {
    for (const id of ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 't8']) await db.saveTextItem('todos', { id, title: `할 일 ${id}`, done: false, source: 'app' });
    await db.flushCloud();
});
await sync('B');
check(B.snapshot().todos.length === 8, `PC가 할 일 8개를 받지 못했습니다: ${B.snapshot().todos.length}`);

/* 클라우드 updatedAt은 '고친 시각'(서버 기준)입니다. 폰 시계가 1시간 늦어도 서버 시각에 가깝습니다(S4). */
const t1at = (await cloudDoc('t1'))?.updatedAt?.toMillis?.();
check(Math.abs(t1at - Date.now()) < 60 * 1000, `올린 할 일 시각이 서버 시각과 어긋납니다: ${t1at - Date.now()}ms`);
/* N10·N15: 받은 할 일의 editAt = 클라우드 고친 시각 */
check(todo(B, 't1')?.editAt === t1at, `PC가 받은 할 일의 editAt이 클라우드 시각이 아닙니다: ${todo(B, 't1')?.editAt} / ${t1at}`);

/* S1·S5: 둘 다 오프라인에서 같은 할 일을 고침(PC 먼저, 폰 나중). 폰이 먼저 올리고 PC가 나중에 올려도 '나중에 고친' 폰 값이 이깁니다.
   PC 시계는 1시간 빨라서 보정하지 않으면 PC가 이깁니다. */
offline.A = true; offline.B = true;
await edit('B', 't1', 'PC가 먼저 고침');
await wait(GAP);
await edit('A', 't1', '폰이 나중에 고침');
offline.A = false;
await sync('A');
offline.B = false;
await sync('B');
await sync('A');
check((await cloudDoc('t1'))?.title === '폰이 나중에 고침', `S1/S5: 나중에 올린 PC의 옛 수정이 이겼습니다: ${(await cloudDoc('t1'))?.title}`);
check(todo(A, 't1')?.title === '폰이 나중에 고침' && todo(B, 't1')?.title === '폰이 나중에 고침', `S1: 두 기기가 나중 수정으로 맞춰지지 않았습니다: 폰 ${todo(A, 't1')?.title} / PC ${todo(B, 't1')?.title}`);

/* S1 반대·S4: 폰(1시간 늦은 시계)이 먼저 고치고 PC가 나중에 고침, 폰이 나중에 올림 → PC 값 */
offline.A = true; offline.B = true;
await edit('A', 't2', '폰 먼저');
await wait(GAP);
await edit('B', 't2', 'PC 나중');
offline.B = false;
await sync('B');
offline.A = false;
await sync('A');
await sync('B');
check((await cloudDoc('t2'))?.title === 'PC 나중' && todo(A, 't2')?.title === 'PC 나중' && todo(B, 't2')?.title === 'PC 나중', `S4: 나중에 고친 PC 값이 지켜지지 않았습니다: 클라우드 ${(await cloudDoc('t2'))?.title} / 폰 ${todo(A, 't2')?.title}`);

/* S1 거울: 폰이 먼저, PC가 나중에 고침(둘 다 오프라인). 폰이 먼저 올리고 PC가 나중에 올림 → PC 값('올린 시각'이 아니라 '고친 시각'). */
offline.A = true; offline.B = true;
await edit('A', 't8', '폰 먼저 고침');
await wait(GAP);
await edit('B', 't8', 'PC 나중에 고침');
offline.A = false;
await sync('A');
await wait(GAP);
offline.B = false;
await sync('B');
await sync('A');
check((await cloudDoc('t8'))?.title === 'PC 나중에 고침' && todo(A, 't8')?.title === 'PC 나중에 고침', `S1: 먼저 올렸다는 이유로 먼저 고친 폰 값이 이겼습니다: ${(await cloudDoc('t8'))?.title}`);

/* 이 기기가 정말 더 늦게 고쳤으면 이 기기 값이 이기고 올라갑니다(한쪽만 오프라인). */
await edit('B', 't3', 'PC 온라인 수정');
await on('B', (db) => db.flushCloud());
await wait(GAP);
offline.A = true;
await edit('A', 't3', '폰 오프라인 나중 수정');
offline.A = false;
await sync('A');
check((await cloudDoc('t3'))?.title === '폰 오프라인 나중 수정', `오프라인에서 나중에 고친 값이 올라가지 않았습니다: ${(await cloudDoc('t3'))?.title}`);
/* N15: 올린 그대로인 줄이 클라우드 값을 받을 때 editAt도 클라우드 고친 시각으로 바뀝니다. */
await sync('B');
check(todo(B, 't3')?.title === '폰 오프라인 나중 수정' && todo(B, 't3')?.editAt === (await cloudDoc('t3'))?.updatedAt?.toMillis?.(), `N15: PC 할 일의 editAt이 클라우드 시각으로 바뀌지 않았습니다: ${todo(B, 't3')?.editAt} / ${(await cloudDoc('t3'))?.updatedAt?.toMillis?.()}`);

/* S3: PC가 오프라인에서 고친 뒤, 폰이 그보다 나중에 지움 → PC가 돌아와도 되살아나지 않습니다(묘비). */
await sync('B');
offline.B = true;
await edit('B', 't4', 'PC 오프라인 수정');
await wait(GAP);
await on('A', async (db) => { await db.removeItem('todos', 't4'); await db.flushCloud(); });
check(!(await cloudDoc('t4')), 'S3: 폰에서 지운 할 일이 클라우드에 남았습니다.');
check((await getDoc(doc(admin(), 'users', UID, 'tombs', 'todos-t4'))).exists(), 'S3: 지운 시각(묘비)이 남지 않았습니다.');
offline.B = false;
await sync('B');
await sync('A');
check(!(await cloudDoc('t4')), 'S3: 지운 할 일이 PC에서 되살아나 클라우드로 올라갔습니다.');
check(!todo(B, 't4') && !todo(A, 't4'), `S3: 지운 할 일이 기기에 남았습니다: 폰 ${!!todo(A, 't4')} / PC ${!!todo(B, 't4')}`);

/* S3 (받기 경로): 묘비가 있는 상태로 받기만 해도 지워집니다(pruneDeletedElsewhere). */
offline.B = true;
await edit('B', 't5', 'PC 오프라인 수정 2');
await wait(GAP);
await on('A', async (db) => { await db.removeItem('todos', 't5'); await db.flushCloud(); });
offline.B = false;
await on('B', async (db, dev) => {
    const remote = await dev.cloud.pullUserData(UID);
    check(Number.isFinite(remote.tombs?.todos?.t5), 'S3: 받기에서 묘비를 읽지 못했습니다.');
});

/* S3r: 폰이 오프라인에서 지운 뒤 PC가 그보다 나중에 고쳤으면, 폰이 돌아와도 PC 수정은 남습니다. */
await sync('B');
offline.A = true;
await on('A', (db) => db.removeItem('todos', 't6'));
await wait(GAP);
await edit('B', 't6', '지운 뒤 PC가 고침');
await on('B', (db) => db.flushCloud());
offline.A = false;
await sync('A');
await sync('A');
check((await cloudDoc('t6'))?.title === '지운 뒤 PC가 고침', `S3r: 지운 뒤 고친 할 일이 지워졌습니다: ${(await cloudDoc('t6'))?.title}`);

/* S8: 이미 올린 할 일을 민감한 낱말로 고치면 클라우드 사본(옛 문구)이 지워지고, 이 기기에는 남습니다. */
await edit('A', 't7', '보건실 약 받기');
await on('A', (db) => db.flushCloud());
await sync('A');
check(!(await cloudDoc('t7')), `S8: 민감하게 고친 할 일의 클라우드 사본이 남았습니다: ${(await cloudDoc('t7'))?.title}`);
check(A.snapshot().local.todos.some((t) => t.title === '보건실 약 받기'), 'S8: 민감한 할 일이 이 기기에서 사라졌습니다.');
const raw = (await getDocs(collection(admin(), 'users', UID, 'todos'))).docs.map((d) => d.data());
check(raw.every((d) => !('editAt' in d) && !String(d.title).includes('보건실')), '클라우드에 editAt 또는 민감한 문구가 있습니다.');

/* ── PR #57 검수 치명 1번: 서버 시각을 못 잰 기기 + 틀린 기기 시계 ──
   못 잰 동안은 기기 시각을 쓰지 않습니다(고친 시각 0 → serverTimestamp). 다른 기기가 그 사이 손댄 할 일은 보류했다가, 재면 견줍니다. */
const DAY = 24 * HOUR;
const unsure = async (dev, skew) => on(dev, (db) => { db.useDeviceClockForTest(() => Date.now() + skew); db.resetClockForTest({ measured: false }); noclock[dev] = true; });
const measured = async (dev) => { noclock[dev] = false; return on(dev, (db) => db.retryServerClockForTest()); };
await on('A', async (db) => {
    for (const id of ['u1', 'u1b', 'u2', 'u3', 'u3r']) await db.saveTextItem('todos', { id, title: `확인 ${id}`, done: false, source: 'app' });
    await db.flushCloud();
});
await sync('B');
check(B.CLOCK_RETRY_MS === 60000, `측정 실패 시 다시 재는 간격이 1분이 아닙니다: ${B.CLOCK_RETRY_MS}`);

/* NOCLOCK_B + B 시계 +1일 */
await unsure('B', DAY);
check(!B.clockMeasured(), 'NOCLOCK: 재지 못했는데 잰 것으로 봅니다.');
/* S1: 둘 다 오프라인, B 먼저 · A 나중에 고침. B가 나중에 올려도 A 값이 남고, B 수정은 지우지 않고 보류합니다. */
offline.A = true; offline.B = true;
await edit('B', 'u1', 'B 먼저(시계 +1일)');
check(todo(B, 'u1')?.editAt === 0 && Number.isFinite(todo(B, 'u1')?.editD), `NOCLOCK: 재기 전 고친 시각이 기기 시각으로 찍혔습니다: ${todo(B, 'u1')?.editAt}`);
await wait(GAP);
await edit('A', 'u1', 'A 나중');
offline.A = false; await sync('A');
offline.B = false; await sync('B');
check((await cloudDoc('u1'))?.title === 'A 나중', `S1(NOCLOCK): 나중에 고친 A 값이 졌습니다: ${(await cloudDoc('u1'))?.title}`);
check(todo(B, 'u1')?.title === 'B 먼저(시계 +1일)' && B.heldTodosForTest().includes('u1'), `S1(NOCLOCK): B 수정을 보류하지 않았습니다: ${todo(B, 'u1')?.title} / ${B.heldTodosForTest()}`);
/* S1b: B가 온라인에서 고쳐 바로 올리고(올린 시각), A가 그 뒤에 고침 → A 값이 이기고 B도 A 값을 받습니다. */
await edit('B', 'u1b', 'B 온라인 수정(시계 +1일)');
await on('B', (db) => db.flushCloud());
const u1bAt = (await cloudDoc('u1b'))?.updatedAt?.toMillis?.();
check(Math.abs(u1bAt - Date.now()) < 60 * 1000, `S1b: 재기 전 올린 시각이 서버 시각이 아닙니다(미래 시각): ${u1bAt - Date.now()}ms`);
await sync('A');
await wait(GAP);
await edit('A', 'u1b', 'A 그 뒤 수정');
await on('A', (db) => db.flushCloud());
await sync('B');
check((await cloudDoc('u1b'))?.title === 'A 그 뒤 수정' && todo(B, 'u1b')?.title === 'A 그 뒤 수정', `S1b(NOCLOCK): 나중 A 수정이 유실됐습니다: 클라우드 ${(await cloudDoc('u1b'))?.title} / B ${todo(B, 'u1b')?.title}`);
/* S3: B가 오프라인에서 고친 뒤 A가 나중에 지움 → B가 돌아와도 되살리지 않습니다(보류). */
offline.B = true;
await edit('B', 'u3', 'B 오프라인 수정(시계 +1일)');
await wait(GAP);
await on('A', async (db) => { await db.removeItem('todos', 'u3'); await db.flushCloud(); });
offline.B = false; await sync('B');
check(!(await cloudDoc('u3')), 'S3(NOCLOCK): 지운 할 일이 되살아났습니다.');
/* 재면: 보류한 수정의 시각을 서버 기준으로 바꿔 견줍니다 → u1은 A 값, u3은 지워짐. */
check(await measured('B'), 'NOCLOCK: 다시 재기에 실패했습니다.');
check(Math.abs(todo(B, 'u1')?.editAt - Date.now()) < 60 * 1000 || todo(B, 'u1')?.title === 'A 나중', `재기 뒤 고친 시각을 서버 기준으로 바꾸지 않았습니다: ${todo(B, 'u1')?.editAt}`);
await sync('B'); await sync('A');
check((await cloudDoc('u1'))?.title === 'A 나중' && todo(B, 'u1')?.title === 'A 나중', `S1(재측정 뒤): 두 기기가 나중 수정으로 맞춰지지 않았습니다: ${todo(B, 'u1')?.title}`);
check(!(await cloudDoc('u3')) && !todo(B, 'u3'), `S3(재측정 뒤): 지운 할 일이 남았습니다: ${!!todo(B, 'u3')}`);

/* NOCLOCK_A + A 시계 +1시간 */
await unsure('A', HOUR);
/* S2: A가 지우고(묘비 = 서버가 받은 시각), B가 그 뒤 오프라인에서 고쳐 올림 → B 수정이 남습니다. */
await on('A', async (db) => { await db.removeItem('todos', 'u2'); await db.flushCloud(); });
const tombU2 = (await getDoc(doc(admin(), 'users', UID, 'tombs', 'todos-u2'))).data()?.at?.toMillis?.();
check(Number.isFinite(tombU2) && Math.abs(tombU2 - Date.now()) < 60 * 1000, `S2: 재기 전 지운 묘비가 서버 시각이 아닙니다: ${tombU2 - Date.now()}`);
offline.B = true;
await wait(GAP);
await edit('B', 'u2', 'B 지운 뒤 수정');
offline.B = false; await sync('B');
check((await cloudDoc('u2'))?.title === 'B 지운 뒤 수정', `S2(NOCLOCK): 지운 뒤 다른 기기 수정이 유실됐습니다: ${(await cloudDoc('u2'))?.title}`);
/* S3r: A가 오프라인에서 지우고 B가 그 뒤 고쳐 올림 → A가 돌아와도 B 수정은 남습니다. */
offline.A = true;
await on('A', (db) => db.removeItem('todos', 'u3r'));
await wait(GAP);
await edit('B', 'u3r', 'B 나중 수정');
await on('B', (db) => db.flushCloud());
offline.A = false; await sync('A'); await sync('A');
check((await cloudDoc('u3r'))?.title === 'B 나중 수정', `S3r(NOCLOCK): 지운 뒤 고친 할 일이 지워졌습니다: ${(await cloudDoc('u3r'))?.title}`);
check(todo(A, 'u3r')?.title === 'B 나중 수정', `S3r(NOCLOCK): A가 B 수정을 받지 못했습니다: ${todo(A, 'u3r')?.title}`);
check(await measured('A'), 'NOCLOCK_A: 다시 재기에 실패했습니다.');

/* 34자 넘는 id(40자)도 묘비가 남습니다. */
const longId = 'L'.repeat(40);
await on('A', async (db) => { await db.saveTextItem('todos', { id: longId, title: '긴 id', done: false, source: 'app' }); await db.flushCloud(); });
check(!!(await cloudDoc(longId)), '40자 id 할 일이 올라가지 않았습니다.');
await on('A', async (db) => { await db.removeItem('todos', longId); await db.flushCloud(); });
check(!(await cloudDoc(longId)) && (await getDoc(doc(admin(), 'users', UID, 'tombs', `todos-${longId}`))).exists(), '40자 id 할 일의 묘비가 남지 않았습니다.');

/* 규칙: 시각이 서버보다 5분 넘게 앞서면 거절, v46(serverTimestamp)은 통과 */
const { Timestamp, serverTimestamp } = await import('firebase/firestore');
const put = (path, body) => setDoc(doc(admin(), ...path), body).then(() => true, () => false);
check(!(await put(['users', UID, 'todos', 'f1'], { title: '미래', done: false, updatedAt: Timestamp.fromMillis(Date.now() + DAY) })), '규칙: 하루 앞선 updatedAt을 받아들였습니다.');
check(await put(['users', UID, 'todos', 'f2'], { title: '조금 앞섬', done: false, updatedAt: Timestamp.fromMillis(Date.now() + 60 * 1000) }), '규칙: 1분 앞선 updatedAt(여유 안)을 거절했습니다.');
check(await put(['users', UID, 'todos', 'f3'], { title: 'v46', done: false, updatedAt: serverTimestamp() }), '규칙: v46 serverTimestamp 쓰기를 거절했습니다.');
check(!(await put(['users', UID, 'tombs', 'todos-f4'], { k: 'todos', at: Timestamp.fromMillis(Date.now() + HOUR) })), '규칙: 한 시간 앞선 묘비를 받아들였습니다.');
check(await put(['users', UID, 'tombs', 'todos-f5'], { k: 'todos', at: serverTimestamp() }), '규칙: serverTimestamp 묘비를 거절했습니다.');
check(!(await put(['users', UID, 'tombs', `todos-${'L'.repeat(41)}`], { k: 'todos', at: serverTimestamp() })), '규칙: 41자 id 묘비를 받아들였습니다.');

/* 검수 2번(v46·v47 섞임): 더 이른 updatedAt으로 덮기 거절, 묘비 있는 id에 쓰기 거절(v46 되살리기), v47 같은 id 다시 만들기는 통과 */
check(await put(['users', UID, 'todos', 'o1'], { title: '나중', done: false, updatedAt: Timestamp.fromMillis(Date.now()) }), '규칙: 새 할 일 쓰기를 거절했습니다.');
check(!(await put(['users', UID, 'todos', 'o1'], { title: '옛 값', done: false, updatedAt: Timestamp.fromMillis(Date.now() - HOUR) })), '규칙: 더 이른 updatedAt으로 덮기를 받아들였습니다.');
check((await getDoc(doc(admin(), 'users', UID, 'todos', 'o1'))).data()?.title === '나중', '규칙: 옛 값이 나중 값을 덮었습니다.');
check(await put(['users', UID, 'todos', 'o1'], { title: 'v46 고침', done: false, updatedAt: serverTimestamp() }), '규칙: v46 serverTimestamp 고침을 거절했습니다.');
check(!(await put(['users', UID, 'todos', longId], { title: 'v46 되살림', done: false, updatedAt: serverTimestamp() })), '규칙: 묘비가 있는 할 일을 v46이 되살렸습니다.');
check(!(await cloudDoc(longId)), '규칙: 지운 할 일이 클라우드에 다시 생겼습니다.');
await on('A', async (db) => { await db.saveTextItem('todos', { id: longId, title: '다시 만듦', done: false, source: 'app' }); await db.flushCloud(); });
check((await cloudDoc(longId))?.title === '다시 만듦', 'v47: 지운 뒤 같은 id로 다시 만든 할 일이 올라가지 않았습니다(묘비 정리 실패).');
check(!(await getDoc(doc(admin(), 'users', UID, 'tombs', `todos-${longId}`))).exists(), 'v47: 다시 만든 할 일의 옛 묘비가 남았습니다.');

/* 묘비 정리: 30일 넘은 묘비만 지웁니다. */
check(await put(['users', UID, 'tombs', 'todos-old1'], { k: 'todos', at: Timestamp.fromMillis(Date.now() - 40 * DAY) }), '옛 묘비를 쓰지 못했습니다.');
const swept = await on('A', (db, dev) => dev.cloud.sweepTombs(UID, Date.now()));
check(swept >= 1 && !(await getDoc(doc(admin(), 'users', UID, 'tombs', 'todos-old1'))).exists(), `묘비 정리: 30일 넘은 묘비를 지우지 않았습니다(${swept})`);
check((await getDoc(doc(admin(), 'users', UID, 'tombs', 'todos-u3'))).exists(), '묘비 정리: 최근 묘비까지 지웠습니다.');

/* 받은 뒤 이어지는 올리기(올리기 전 확인 reconcileDirtyTodos)가 아니라 pullFromCloudNow 자체가 받는지 보려고, 확인 전까지 올리기·확인을 막아 둡니다. */
let hold = false;
/* N14: 받기 직전에 이 기기가 고쳤는데 다른 기기가 그보다 나중에 고쳐 올렸으면, pullFromCloudNow가 나중 값을 받습니다. */
await sync('B');
await on('A', (db, dev) => {
    const realPull = dev.cloud.pullUserData;
    db.useCloudForTest({
        available: () => true, push: (uid, state, opts = {}) => (hold ? { ok: false, pending: 1, hashes: opts.hashes || {}, rejected: [] } : dev.cloud.pushUserData(uid, state, opts)), remove: dev.cloud.deleteUserDoc, peek: (...a) => (hold ? null : dev.cloud.peekTodos(...a)), clock: dev.cloud.measureServerClock,
        pull: async (...args) => {
            hold = true;
            await A.saveTextItem('todos', { ...todo(A, 't3'), title: '폰 받기 직전 수정' }, { from: 'cloud' });
            await wait(GAP);
            await on('B', async (b) => { await b.saveTextItem('todos', { ...todo(b, 't3'), title: 'PC 더 나중 수정' }, { from: 'cloud' }); await b.flushCloud(); });
            cur = 'A';
            return realPull(...args);
        },
    });
});
const now14 = await on('A', (db) => db.pullFromCloudNow());
check(now14?.ok && todo(A, 't3')?.title === 'PC 더 나중 수정', `N14: 받기에서 더 늦은 클라우드 수정을 받지 못했습니다: ${todo(A, 't3')?.title}`);
hold = false;

/* N3: 서버에 못 닿아 캐시에서 받은 목록은 fresh=false, 지우기 판단용 ids도 없습니다. */
await on('B', async (db, dev) => {
    await disableNetwork(dev.fs);
    const remote = await dev.cloud.pullUserData(UID).catch(() => null);
    check(remote && remote.fresh === false && !Array.isArray(remote.ids?.todos), `N3: 캐시에서 받았는데 fresh=${remote?.fresh}`);
    await enableNetwork(dev.fs);
    const fresh = await dev.cloud.pullUserData(UID);
    check(fresh.fresh === true, 'N3: 서버에서 받았는데 fresh가 true가 아닙니다.');
});

/* N13: 거절이 아닌 실패는 pending으로 셉니다(진짜 pushUserData). */
await on('B', async (db, dev) => {
    const dead = env.authenticatedContext(UID).firestore();
    await (dead.terminate ? dead.terminate() : terminate(dead));
    dev.fb.useFirebaseForTest({ config, bundle: { app: null, auth: null, db: dead, memoryOnly: false } });
    const out = await dev.cloud.pushUserData(UID, { todos: [{ id: 'n13a', title: 'a', done: false }, { id: 'n13b', title: 'b', done: false }] }, { hashes: {} });
    check(out.pending >= 2 && out.ok === false, `N13: 올리지 못한 2개를 pending으로 세지 않았습니다: ${JSON.stringify({ pending: out.pending, ok: out.ok })}`);
    const other = env.authenticatedContext('someone-else').firestore();
    dev.fb.useFirebaseForTest({ config, bundle: { app: null, auth: null, db: other, memoryOnly: false } });
    const denied = await dev.cloud.pushUserData(UID, { todos: [{ id: 'n13c', title: 'c', done: false }] }, { hashes: {} });
    check((denied.rejected || []).length === 1 && !denied.pending, `N13: 규칙 거절을 rejected로 세지 않았습니다: ${JSON.stringify(denied)}`);
    dev.fb.useFirebaseForTest({ config, bundle: { app: null, auth: null, db: dev.fs, memoryOnly: false } });
});

/* 묘비 규칙: 남의 묘비는 쓸 수 없고 모양이 틀린 묘비는 거절됩니다. */
const bad = await setDoc(doc(env.authenticatedContext(UID).firestore(), 'users', UID, 'tombs', 'todos-x'), { k: 'todos', at: 1 }).then(() => true, () => false);
check(!bad, '묘비 규칙: 시각이 timestamp가 아닌데 받아들였습니다.');
const other = await getDoc(doc(env.authenticatedContext('someone-else').firestore(), 'users', UID, 'tombs', 'todos-t4')).then(() => true, () => false);
check(!other, '묘비 규칙: 남의 묘비를 읽을 수 있습니다.');

await env.cleanup();
rmSync(new URL('.twodev/', root), { recursive: true, force: true });
if (failures.length) {
    console.error(`두 기기 동기화 검사 실패 ${failures.length}건\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('두 기기 동기화 검사 통과(진짜 cloud.js·serverTimestamp·규칙, 시계 ±1시간)');
process.exit(0);
