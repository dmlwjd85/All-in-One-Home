/**
 * 할 일 성취(PR C) 두 기기 동기화(에뮬레이터 + 실제 규칙 + 진짜 cloud.js).
 * 중요도·끝낸 날·하루 목표·달성 배지가 기존 할 일 방식대로(늦게 고친 쪽, 한쪽에만 있는 것은 합침) 맞춰지는지 봅니다.
 */
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, terminate } from 'firebase/firestore';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
{
    const workflow = readFileSync(new URL('../.github/workflows/deploy-pages.yml', import.meta.url), 'utf8');
    check(workflow.indexOf('npm run check:goalsync') > workflow.indexOf('npm run check:rules'), 'CI에서 check:goalsync가 에뮬레이터 검사 묶음에 없습니다.');
}
const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-ssug-rules', firestore: { host, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const UID = 'teacher-goalsync';
const admin = () => env.authenticatedContext(UID).firestore();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3600 * 1000;
const GAP = 1500;

const root = new URL('../', import.meta.url);
rmSync(new URL('.goalsyncdev/', root), { recursive: true, force: true });
for (const d of ['a', 'b']) cpSync(new URL('src/', root), new URL(`.goalsyncdev/${d}/src/`, root), { recursive: true });

const stores = { A: new Map(), B: new Map() };
let cur = 'A';
globalThis.localStorage = {
    getItem: (k) => (stores[cur].has(k) ? stores[cur].get(k) : null),
    setItem: (k, v) => stores[cur].set(k, String(v)),
    removeItem: (k) => stores[cur].delete(k),
};
const plain = () => { const map = new Map(); return { get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };
const offline = { A: false, B: false };
const config = { apiKey: 'demo', projectId: 'demo-ssug-rules', authDomain: 'demo.local' };
const devices = {};
for (const [name, dir] of [['A', 'a'], ['B', 'b']]) {
    cur = name;
    const fb = await import(new URL(`.goalsyncdev/${dir}/src/firebase.js`, root));
    const cloud = await import(new URL(`.goalsyncdev/${dir}/src/lib/cloud.js`, root));
    const db = await import(new URL(`.goalsyncdev/${dir}/src/lib/db.js`, root));
    const ach = await import(new URL(`.goalsyncdev/${dir}/src/lib/todoAchieve.js`, root));
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
        clock: gate(cloud.measureServerClock, () => null),
        sweep: gate(cloud.sweepTombs, () => 0),
        watch: () => () => {},
    });
    await db.boot('');
    devices[name] = { db, cloud, fb, fs, ach };
}
const on = async (dev, fn) => { cur = dev; const out = await fn(devices[dev].db, devices[dev]); await wait(5); return out; };
const sync = (dev) => on(dev, (db) => db.refreshFromCloud({ force: true }));
const todo = (dev, id) => { cur = dev; return devices[dev].db.snapshot().todos.find((r) => r.id === id); };
const goals = (dev) => { cur = dev; return devices[dev].ach.normalizeGoals(devices[dev].db.snapshot().goals); };
const cloudGoal = async () => { const s = await getDoc(doc(admin(), 'users', UID, 'settings', 'goal')); return s.exists() ? s.data() : null; };
const cloudTodo = async (id) => { const s = await getDoc(doc(admin(), 'users', UID, 'todos', id)); return s.exists() ? s.data() : null; };

await env.clearFirestore();
await on('A', (db) => db.useDeviceClockForTest(() => Date.now() - HOUR));
await on('B', (db) => db.useDeviceClockForTest(() => Date.now() + HOUR));
await on('A', (db) => db.setAuth({ uid: UID }));
await on('B', (db) => db.setAuth({ uid: UID }));
await wait(50);

/* G1: 폰에서 중요도 높음으로 적고 셋을 끝내면, 클라우드와 PC에 중요도·끝낸 날·달성 배지가 갑니다. */
for (const [id, pri] of [['gs1', 3], ['gs2', 1], ['gs3', 2]]) await on('A', (db) => db.saveTextItem('todos', { id, title: `할 일 ${id}`, done: false, due: '', pri, source: 'app' }));
await wait(GAP);
for (const id of ['gs1', 'gs2', 'gs3']) await on('A', (db) => db.toggleTodo(id));
const day = todo('A', 'gs1')?.doneOn;
await on('A', (db) => db.flushCloud());
const c1 = await cloudTodo('gs1');
check(c1?.pri === 3 && c1?.doneOn === day && /^\d\d:\d\d$/.test(c1?.doneHm || ''), `G1: 중요도·끝낸 날이 클라우드에 없습니다: ${JSON.stringify(c1)}`);
const g1 = await cloudGoal();
check(g1 && g1.n === 3 && String(g1.days).startsWith(`${day}~3~3~`), `G1: 달성 기록이 클라우드에 없습니다: ${JSON.stringify(g1)}`);
await sync('B');
check(todo('B', 'gs1')?.pri === 3 && todo('B', 'gs2')?.pri === 1 && todo('B', 'gs1')?.doneOn === day, `G1: PC가 중요도·끝낸 날을 받지 못했습니다: ${JSON.stringify(todo('B', 'gs1'))}`);
check(devices.B.ach.badgeOn(goals('B').days[day]), `G1: PC 달력에 달성 배지가 없습니다: ${JSON.stringify(goals('B'))}`);

/* G2: 둘 다 오프라인. 폰이 먼저 목표를 5개로, PC가 나중에 gs2 체크를 풀어 배지를 지움. 다시 이어지면 둘 다: 목표 5, 배지 없음, gs2 안 끝냄. */
offline.A = true; offline.B = true;
await wait(GAP);
await on('A', (db) => db.setTodoGoal(5));
await wait(GAP);
const unc = await on('B', (db) => db.toggleTodo('gs2'));
check(unc.goalCleared, 'G2: PC에서 체크를 풀었는데 배지를 지우지 않았습니다.');
offline.A = false; await sync('A');
offline.B = false; await sync('B');
await sync('A');
for (const dev of ['A', 'B']) {
    const g = goals(dev);
    check(g.n === 5, `G2: ${dev} 목표가 나중에 고친 5개가 아닙니다: ${g.n}`);
    check(!devices[dev].ach.badgeOn(g.days[day]), `G2: ${dev}에 나중에 지운 배지가 되살았습니다: ${JSON.stringify(g.days[day])}`);
    check(todo(dev, 'gs2')?.done === false && !todo(dev, 'gs2')?.doneOn, `G2: ${dev}의 gs2가 풀리지 않았습니다: ${JSON.stringify(todo(dev, 'gs2'))}`);
}
const c2 = await cloudTodo('gs2');
check(c2 && c2.done === false && !('doneOn' in c2) && !('doneHm' in c2), `G2: 클라우드 gs2의 끝낸 날이 지워지지 않았습니다: ${JSON.stringify(c2)}`);

/* G3: 중요도도 할 일처럼 나중에 고친 쪽이 이깁니다(폰 먼저 낮음, PC 나중 높음). */
offline.A = true; offline.B = true;
await wait(GAP);
await on('A', (db) => db.setTodoPri('gs3', 1));
await wait(GAP);
await on('B', (db) => db.setTodoPri('gs3', 3));
offline.A = false; await sync('A');
offline.B = false; await sync('B');
await sync('A');
check(todo('A', 'gs3')?.pri === 3 && todo('B', 'gs3')?.pri === 3 && (await cloudTodo('gs3'))?.pri === 3, `G3: 나중에 고친 중요도가 이기지 않았습니다: 폰 ${todo('A', 'gs3')?.pri} / PC ${todo('B', 'gs3')?.pri}`);

/* G4: 한쪽에만 있는 할 일은 합칩니다(폰 오프라인에서 적은 할 일 + PC에서 적은 할 일). */
offline.A = true;
await on('A', (db) => db.saveTextItem('todos', { id: 'gsA', title: '폰에서만', done: false, pri: 3, source: 'app' }));
await on('B', (db) => db.saveTextItem('todos', { id: 'gsB', title: 'PC에서만', done: false, pri: 1, source: 'app' }));
await on('B', (db) => db.flushCloud());
offline.A = false; await sync('A');
await sync('B');
for (const dev of ['A', 'B']) check(todo(dev, 'gsA')?.pri === 3 && todo(dev, 'gsB')?.pri === 1, `G4: ${dev}에 한쪽 할 일이 합쳐지지 않았습니다.`);

/* G5: 옛 판(중요도 모름)이 merge로 제목만 고쳐도 중요도 칸은 남습니다. */
{
    const { setDoc, serverTimestamp } = await import('firebase/firestore');
    await setDoc(doc(admin(), 'users', UID, 'todos', 'gsA'), { title: '옛 판이 고친 제목', done: false, source: 'app', updatedAt: serverTimestamp() }, { merge: true }).catch(() => {});
    const c = await cloudTodo('gsA');
    check(c?.pri === 3, `G5: 옛 판 merge 쓰기에 중요도가 사라졌습니다: ${JSON.stringify(c)}`);
}

for (const d of Object.values(devices)) { try { await terminate(d.fs); } catch { /* 이미 닫힘 */ } }
await env.cleanup();
rmSync(new URL('.goalsyncdev/', root), { recursive: true, force: true });
if (failures.length) { console.error(failures.map((f) => `- ${f}`).join('\n')); process.exit(1); }
console.log('할 일 성취 두 기기 동기화 검사 통과(진짜 cloud.js·규칙, 시계 ±1시간: 중요도·끝낸 날·목표·배지, 나중에 고친 쪽, 한쪽 항목 합치기)');
process.exit(0);
