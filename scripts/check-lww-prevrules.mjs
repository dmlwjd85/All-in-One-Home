/**
 * 새 규칙을 게시하기 전(옛 규칙)에도 일정·회의록 동기화가 망가지지 않는지 보는 두 기기 검사(PR #66 남은 변이 2개).
 */
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, disableNetwork, enableNetwork, serverTimestamp, setDoc, terminate, Timestamp } from 'firebase/firestore';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-ssug-rules', firestore: { host, port: Number(port), rules: readFileSync(new URL('./fixtures/firestore.rules.prev', import.meta.url), 'utf8') } });
const UID = 'teacher3';
const admin = () => env.authenticatedContext(UID).firestore();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3600 * 1000;
/* 서버 시각 보정 오차는 왕복 시간의 절반 정도입니다. 두 기기 수정 사이를 1.5초로 둡니다(사람이 두 기기에서 고치는 간격보다 짧음). */
const GAP = 1500;

/* 기기마다 src 복사본(모듈 따로) */
const root = new URL('../', import.meta.url);
rmSync(new URL('.lwwold/', root), { recursive: true, force: true });
for (const d of ['a', 'b']) cpSync(new URL('src/', root), new URL(`.lwwold/${d}/src/`, root), { recursive: true });

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
    const fb = await import(new URL(`.lwwold/${dir}/src/firebase.js`, root));
    const cloud = await import(new URL(`.lwwold/${dir}/src/lib/cloud.js`, root));
    const db = await import(new URL(`.lwwold/${dir}/src/lib/db.js`, root));
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


const TODAY = new Date(Date.now() + 9 * HOUR).toISOString().slice(0, 10);
const rowOf = (dev, list, id) => { cur = dev; return (devices[dev].db.snapshot()[list] || []).find((r) => String(r.id) === String(id)); };
const edit = (dev, list, id, patch) => on(dev, (db) => db.update((d) => { const r = d[list].find((x) => String(x.id) === String(id)); Object.assign(r, patch); return d; }));
const add = (dev, list, row) => on(dev, (db) => db.update((d) => { d[list].push(row); return d; }));
const flush = (dev) => on(dev, (db) => db.flushCloud());
const both = async () => { await sync('A'); await sync('B'); await sync('A'); await sync('B'); };
/* 양쪽 다 오프라인에서 first가 먼저, second가 나중에 고침. 올리는 순서는 upFirst가 먼저(나중에 고친 쪽이 먼저 올려도 진 쪽이 덮지 않아야 함). */
async function conflict(list, id, first, second, field, v1, v2, upFirst) {
    offline.A = true; offline.B = true;
    await edit(first, list, id, { [field]: v1 });
    await wait(GAP);
    await edit(second, list, id, { [field]: v2 });
    const other = upFirst === 'A' ? 'B' : 'A';
    offline[upFirst] = false; await flush(upFirst); await sync(upFirst);
    offline[other] = false; await flush(other); await sync(other);
    await both();
}

await env.clearFirestore();
await on('A', (db) => db.useDeviceClockForTest(() => Date.now() - HOUR));
await on('B', (db) => db.useDeviceClockForTest(() => Date.now() + HOUR));
await on('A', (db) => db.setAuth({ uid: UID }));
await on('B', (db) => db.setAuth({ uid: UID }));
await wait(50);
const getState = (dev) => { cur = dev; return devices[dev].db.snapshot(); };


/* 새 규칙(lwwOk·일정 묘비)을 게시하기 전, 지금 실제 프로젝트에 올라 있는 규칙(scripts/fixtures/firestore.rules.prev = main)으로 돌립니다.
   P1: 일정 묘비 쓰기가 거절돼도 지우기는 클라우드와 다른 기기까지 갑니다(묘비 실패가 지우기를 막으면 실패).
   P2: 규칙이 이른 고친 시각의 덮어쓰기를 막아 주지 않아도, 나중에 올린 쪽이 먼저 고친 값이면 클라우드가 더 나중 값으로 모입니다(기기 쪽 비교가 빠지면 실패). */
await add('A', 'events', { id: 'pv1', date: TODAY, title: '옛 규칙 일정', kind: 'class', source: 'app' });
await add('A', 'notes', { id: 'pn1', text: '옛 규칙 회의', title: '회의', source: 'app', tags: ['회의'] });
await flush('A'); await sync('B');
check(rowOf('B', 'events', 'pv1') && rowOf('B', 'notes', 'pn1'), 'P0: 옛 규칙에서 일정·회의록이 다른 기기로 가지 않았습니다.');
await on('A', (db) => db.removeItem('events', 'pv1'));
await on('A', (db) => db.removeItem('notes', 'pn1'));
await flush('A');
const cloudEv = await getDoc(doc(admin(), 'users', UID, 'events', 'pv1'));
const cloudNt = await getDoc(doc(admin(), 'users', UID, 'notes', 'pn1'));
check(!cloudEv.exists() && !cloudNt.exists(), `P1: 옛 규칙에서 묘비가 거절되자 클라우드 문서가 지워지지 않았습니다: 일정 ${cloudEv.exists()} / 회의록 ${cloudNt.exists()}`);
await both();
check(!rowOf('A', 'events', 'pv1') && !rowOf('B', 'events', 'pv1') && !rowOf('B', 'notes', 'pn1'), `P1: 옛 규칙에서 지운 일정·회의록이 남거나 되살아났습니다: ${JSON.stringify(rowOf('B', 'events', 'pv1') || rowOf('B', 'notes', 'pn1') || rowOf('A', 'events', 'pv1'))}`);

await add('A', 'events', { id: 'pv2', date: TODAY, title: '처음', kind: 'class', source: 'app' });
await flush('A'); await sync('B');
await conflict('events', 'pv2', 'B', 'A', 'title', 'PC 먼저', '폰 나중', 'A');
const ev2 = await getDoc(doc(admin(), 'users', UID, 'events', 'pv2'));
check(rowOf('A', 'events', 'pv2')?.title === '폰 나중' && rowOf('B', 'events', 'pv2')?.title === '폰 나중' && ev2.data()?.title === '폰 나중', `P2: 옛 규칙에서 먼저 고친 일정이 나중 값을 덮었습니다: 폰 ${rowOf('A', 'events', 'pv2')?.title} / PC ${rowOf('B', 'events', 'pv2')?.title} / 클라우드 ${ev2.data()?.title}`);

await env.cleanup();
rmSync(new URL('.lwwold/', root), { recursive: true, force: true });
if (failures.length) {
    console.error(`옛 규칙 두 기기 검사 실패 ${failures.length}건\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('새 규칙 게시 전(옛 규칙) 일정·회의록 두 기기 검사 통과');
