/**
 * PR #66 전수 점검: 이번 PR에서 새로 생긴 자료(보관함 keptLegacy, 일정·회의록·출결·시간표 줄의 editAt·editD)가
 * ① 내보내기·가져오기(합치기·바꾸기) ② 계정별 저장(ACCOUNT_PARTS) ③ 로그아웃·계정 바꾸기·모두 지우기 ④ 클라우드 다시 받기
 * 경로에서 빠지거나 다른 계정으로 새지 않는지 봅니다. 보관함 이름표 '…'도 봅니다.
 */
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, getDocs } from 'firebase/firestore';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-ssug-rules', firestore: { host, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const A = 'teacher-kept-a';
const B = 'teacher-kept-b';
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const root = new URL('../', import.meta.url);
rmSync(new URL('.keptpaths/', root), { recursive: true, force: true });
cpSync(new URL('src/', root), new URL('.keptpaths/src/', root), { recursive: true });
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), get length() { return store.size; }, key: (i) => [...store.keys()][i] ?? null };
const plain = () => { const map = new Map(); return { map, get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };

const fb = await import(new URL('.keptpaths/src/firebase.js', root));
const cloud = await import(new URL('.keptpaths/src/lib/cloud.js', root));
const db = await import(new URL('.keptpaths/src/lib/db.js', root));
const backup = await import(new URL('.keptpaths/src/lib/backup.js', root));
const label = await import(new URL('.keptpaths/src/lib/keptLabel.js', root));
/* 두 계정 모두 쓸 수 있게 계정이 바뀌면 그 계정의 Firestore로 바꿉니다. */
const fsOf = (uid) => env.authenticatedContext(uid).firestore();
const useFs = (uid) => fb.useFirebaseForTest({ config: { apiKey: 'demo', projectId: 'demo-ssug-rules', authDomain: 'demo.local' }, bundle: { app: null, auth: null, db: fsOf(uid), memoryOnly: false } });
useFs(A);
const vaults = [plain(), plain(), plain()];
const MAIN = vaults[0];
db.useVaultsForTest(...vaults);
db.useSignOutForTest(async () => {});
db.useCloudForTest({ available: () => true, push: cloud.pushUserData, pull: cloud.pullUserData, remove: cloud.deleteUserDoc, peek: cloud.peekTodos, clock: cloud.measureServerClock, sweep: cloud.sweepTombs, watch: () => () => {} });
await env.clearFirestore();
await db.boot('');
check(Array.isArray(db.snapshot().keptLegacy) && db.snapshot().keptLegacy.length === 0, '빈 상태에 보관함(keptLegacy: [])이 없습니다.');
await db.setAuth({ uid: A });
await wait(100);

const kl = () => db.snapshot().keptLegacy || [];
const entry = (id, at, extra = {}) => ({ kind: 'timetable', id, at, row: { p1: `K${at}`, ...extra } });
const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const setKept = (list) => db.update((d) => { d.keptLegacy = structuredClone(list); return d; });

/* 새 줄 칸(editAt): 일정 한 줄을 고친 시각과 함께 둡니다. */
await db.update((d) => { d.events.push({ id: 'kp-e1', date: TODAY, title: '전수점검 일정', kind: 'class', source: 'app' }); return d; });
await db.flushCloud();
const e1 = () => (db.snapshot().events || []).find((r) => r.id === 'kp-e1');
check(Number(e1()?.editAt) > 0 || Number.isFinite(e1()?.editD), '일정 줄에 고친 시각(editAt/editD)이 없습니다.');

/* ① 내보내기 */
await setKept([entry('mon', 1), { kind: 'events', id: 'kp-e1', at: 2, row: { id: 'kp-e1', title: '옛 제목' }, copy: 'kp-copy' }]);
const exported = backup.buildExport(db.snapshot(), { at: new Date().toISOString() });
check(Array.isArray(exported.keptLegacy) && exported.keptLegacy.length === 2, `① 내보내기에 보관함이 없습니다: ${JSON.stringify(exported.keptLegacy)}`);
check(exported.keptLegacy?.[1]?.copy === 'kp-copy', '① 내보내기에서 보관함 사본 표시(copy)가 빠졌습니다.');
const exRow = (exported.events || []).find((r) => r.id === 'kp-e1');
check(exRow && (Number(exRow.editAt) > 0 || Number.isFinite(exRow.editD)), '① 내보내기에서 일정 줄의 고친 시각이 빠졌습니다.');
const file = JSON.stringify(exported);

/* ① 가져오기 · 합치기: 지운 뒤 가져오면 되살아나고, 두 번 가져와도 겹치지 않으며, 이 기기에만 있던 것도 남습니다. */
await setKept([entry('tue', 5)]);
let res = await db.importText(file, 'merge');
check(res.ok, `① 합치기 가져오기 실패: ${JSON.stringify(res.errors)}`);
const keys = () => kl().map((k) => `${k.kind}:${k.id}:${k.at}`).sort().join(',');
check(keys() === 'events:kp-e1:2,timetable:mon:1,timetable:tue:5', `① 합치기 뒤 보관함이 다릅니다: ${keys()}`);
await db.importText(file, 'merge');
check(kl().length === 3, `① 같은 파일을 두 번 합치면 보관함이 겹칩니다: ${kl().length}`);
check(kl().find((k) => k.id === 'kp-e1')?.copy === 'kp-copy', '① 가져오기에서 보관함 사본 표시(copy)가 빠졌습니다.');
/* 최근 200개만 */
const big = { ...exported, keptLegacy: Array.from({ length: 250 }, (_, i) => entry('wed', 1000 + i)) };
await setKept([]);
await db.importText(JSON.stringify(big), 'merge');
check(kl().length === 200 && kl()[0].at === 1050 && kl().at(-1).at === 1249, `① 합치기는 최근 200개만 남겨야 합니다: ${kl().length} ${kl()[0]?.at}~${kl().at(-1)?.at}`);
/* 모양이 틀린 보관 값은 받지 않습니다. */
await setKept([]);
await db.importText(JSON.stringify({ ...exported, keptLegacy: [{ kind: 'evil', id: 'x', row: {} }, { kind: 'events', id: 'ok', at: 3, row: { title: 't' } }, 'str', null] }), 'merge');
check(keys() === 'events:ok:3', `① 모양이 틀린 보관 값을 받았습니다: ${keys()}`);
/* 옛 백업(보관함 칸 없음)을 합치면 이 기기 보관함은 그대로 */
await setKept([entry('thu', 7)]);
const oldFile = { ...exported }; delete oldFile.keptLegacy;
res = await db.importText(JSON.stringify(oldFile), 'merge');
check(res.ok && keys() === 'timetable:thu:7', `① 옛 백업 합치기가 보관함을 건드렸습니다: ${res.ok} ${keys()}`);

/* ① 가져오기 · 바꾸기: 파일 값으로 통째로 */
await setKept([entry('fri', 9)]);
res = await db.importText(file, 'replace');
check(res.ok && keys() === 'events:kp-e1:2,timetable:mon:1', `① 바꾸기 뒤 보관함이 파일 값과 다릅니다: ${res.ok} ${keys()}`);
const rpRow = e1();
check(rpRow && (Number(rpRow.editAt) > 0 || Number.isFinite(rpRow.editD)), '① 바꾸기 가져오기에서 일정 줄의 고친 시각이 빠졌습니다.');

/* ② 계정별 저장 · ③ 계정 바꾸기: A 보관함이 B에 보이지 않고, 돌아오면 A 것이 되살아납니다. */
await setKept([entry('mon', 11)]);
useFs(B);
await db.setAuth({ uid: B });
await wait(300);
check(kl().length === 0, `②③ 계정을 바꿨는데 앞 계정 보관함이 보입니다: ${keys()}`);
check(!(db.snapshot().events || []).some((r) => r.id === 'kp-e1'), '②③ 계정을 바꿨는데 앞 계정 일정이 보입니다.');
await setKept([entry('tue', 22)]);
useFs(A);
await db.setAuth({ uid: A });
await wait(300);
check(keys() === 'timetable:mon:11', `②③ 앞 계정으로 돌아왔는데 보관함이 다릅니다: ${keys()}`);
const backRow = e1();
check(backRow && (Number(backRow.editAt) > 0 || Number.isFinite(backRow.editD)), '②③ 계정을 오가며 일정 줄의 고친 시각이 빠졌습니다.');
useFs(B);
await db.setAuth({ uid: B });
await wait(300);
check(keys() === 'timetable:tue:22', `② B 계정 보관함이 따로 저장되지 않았습니다: ${keys()}`);
useFs(A);
await db.setAuth({ uid: A });
await wait(300);

/* ③ 로그아웃: 이 기기 기록은 남깁니다(다른 자료와 같음). 같은 계정 다시 로그인해도 그대로. */
await db.setAuth(null);
check(keys() === 'timetable:mon:11', `③ 로그아웃하면서 보관함이 바뀌었습니다: ${keys()}`);
await db.setAuth({ uid: A });
await wait(300);
check(keys() === 'timetable:mon:11', `③ 같은 계정 다시 로그인 뒤 보관함이 다릅니다: ${keys()}`);

/* ④ 클라우드 다시 받기: 보관함은 그대로, 다시 받기 전 보관본에도 들어가며, 클라우드에는 올라가지 않습니다. */
res = await db.pullFromCloudNow();
check(res.ok !== false, `④ 다시 받기 실패: ${JSON.stringify(res)}`);
check(keys() === 'timetable:mon:11', `④ 다시 받은 뒤 보관함이 다릅니다: ${keys()}`);
const before = await db.readBeforePull();
check(Array.isArray(before?.data?.keptLegacy) && before.data.keptLegacy.length === 1, '④ 다시 받기 전 보관본에 보관함이 없습니다.');
const pulledRow = e1();
check(pulledRow && Number(pulledRow.editAt) > 0, `④ 다시 받은 일정 줄에 고친 시각이 없습니다: ${JSON.stringify(pulledRow)}`);
const names = ['settings', 'keptLegacy', 'kept'];
for (const name of names.slice(1)) {
    const snap = await getDocs(collection(fsOf(A), 'users', A, name)).catch(() => ({ size: 0 }));
    check(!snap.size, `④ 보관함이 클라우드(${name})에 올라갔습니다.`);
}
/* 저장(vault)에도 남는지 */
await wait(50);
const saved = await MAIN.get('state');
check(Array.isArray(saved?.keptLegacy) && saved.keptLegacy.length === 1, '보관함이 이 기기 저장소(state)에 남지 않습니다.');

/* ③ 모두 지우기: 보관함도 비웁니다. */
await db.clearAll();
check(Array.isArray(db.snapshot().keptLegacy) && db.snapshot().keptLegacy.length === 0, `③ 모두 지우기 뒤 보관함이 남았습니다: ${keys()}`);

/* 이름표: 40자가 넘으면 '…' */
check(label.keptLabel({ kind: 'notes', id: 'n', row: { text: '가'.repeat(41) } }).endsWith('…'), '이름표가 잘릴 때 …이 없습니다.');
check(!label.keptLabel({ kind: 'notes', id: 'n', row: { text: '가'.repeat(40) } }).endsWith('…'), '이름표가 잘리지 않았는데 …이 붙습니다.');
check(label.keptLabel({ kind: 'events', id: 'e', row: { title: '나'.repeat(60) } }).endsWith('…'), '일정 이름표가 잘릴 때 …이 없습니다.');

/* 되돌리기: 확인하는 사이 목록이 바뀌었으면 엉뚱한 줄을 되돌리지 않습니다. */
await setKept([entry('mon', 31), entry('tue', 32)]);
const r1 = await db.restoreKeptLegacy(0, { kind: 'timetable', id: 'tue', at: 32 });
check(r1.ok === false && kl().length === 2, '되돌리기가 확인한 줄과 다른 줄을 되돌렸습니다.');
const r2 = await db.restoreKeptLegacy(1, { kind: 'timetable', id: 'tue', at: 32 });
check(r2.ok && db.snapshot().timetable?.tue?.p1 === 'K32' && keys() === 'timetable:mon:31', `되돌리기 결과가 다릅니다: ${r2.ok} ${db.snapshot().timetable?.tue?.p1} ${keys()}`);
await wait(300);

await env.cleanup();
rmSync(new URL('.keptpaths/', root), { recursive: true, force: true });
if (failures.length) {
    console.error(`보관함·새 칸 전수 점검 실패 ${failures.length}건`);
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
}
console.log('보관함·새 칸 전수 점검 통과(내보내기·합치기·바꾸기·계정별·계정 바꾸기·로그아웃·모두 지우기·다시 받기·이름표·되돌리기 확인)');
process.exit(0);
