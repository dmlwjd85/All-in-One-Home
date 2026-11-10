/**
 * 구버전(v73: serverTimestamp·hlc 없음) ↔ 신판(v74+: editAt·hlc) 혼용 검사(M1~M6).
 * 새 규칙이 게시된 뒤에도 구버전이 신판의 나중 수정·묘비를 덮지 않아야 합니다.
 */
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc, Timestamp } from 'firebase/firestore';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-ssug-rules', firestore: { host, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const UID = 'teacher-mix';
const admin = () => env.authenticatedContext(UID).firestore();
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GAP = 1500;

const root = new URL('../', import.meta.url);
rmSync(new URL('.lwwmix/', root), { recursive: true, force: true });
cpSync(new URL('src/', root), new URL('.lwwmix/new/src/', root), { recursive: true });
cpSync(new URL('src/', root), new URL('.lwwmix/up/src/', root), { recursive: true });

const stores = { NEW: new Map(), UP: new Map() };
let cur = 'NEW';
globalThis.localStorage = {
    getItem: (k) => (stores[cur].has(k) ? stores[cur].get(k) : null),
    setItem: (k, v) => stores[cur].set(k, String(v)),
    removeItem: (k) => stores[cur].delete(k),
};
const plain = (seed = null) => { const map = new Map(seed || []); return { map, get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };

const fb = await import(new URL('.lwwmix/new/src/firebase.js', root));
const cloud = await import(new URL('.lwwmix/new/src/lib/cloud.js', root));
const db = await import(new URL('.lwwmix/new/src/lib/db.js', root));
const fs = env.authenticatedContext(UID).firestore();
fb.useFirebaseForTest({ config: { apiKey: 'demo', projectId: 'demo-ssug-rules', authDomain: 'demo.local' }, bundle: { app: null, auth: null, db: fs, memoryOnly: false } });
const vaults = [plain(), plain(), plain()];
db.useVaultsForTest(...vaults);
db.useCloudForTest({
    available: () => true,
    push: cloud.pushUserData,
    pull: cloud.pullUserData,
    remove: cloud.deleteUserDoc,
    peek: cloud.peekTodos,
    clock: cloud.measureServerClock,
    sweep: cloud.sweepTombs,
    watch: () => () => {},
});
await db.boot('');
await db.setAuth({ uid: UID });
await wait(80);

const TODAY = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const row = (id) => (db.snapshot().events || []).find((r) => String(r.id) === String(id));
const flush = () => db.flushCloud();
const sync = () => db.refreshFromCloud({ force: true });

/** 구버전 쓰기: hlc 없이 serverTimestamp만 (v73 stamp 흉내). */
const oldWrite = (id, body) => setDoc(doc(admin(), 'users', UID, 'events', id), { date: TODAY, kind: 'class', source: 'app', ...body, updatedAt: serverTimestamp() }, { merge: true }).then(() => true, (e) => { oldWrite.lastError = e; return false; });

await env.clearFirestore();

/* M1: 구버전이 만든 일정을 신판이 받음 */
check(await oldWrite('m1', { title: '구버전일정' }), 'M1: 구버전 일정 생성을 거절했습니다.');
await sync();
check(row('m1')?.title === '구버전일정', `M1: 구버전 일정을 신판이 받지 않았습니다: ${JSON.stringify(row('m1'))}`);

/* M2: 신판이 나중에 고친 뒤, 구버전이 먼저 고친 값을 나중에 올림 → 신판 값 유지 */
await db.update((d) => { const r = d.events.find((x) => x.id === 'm1'); r.title = '신판나중'; return d; });
await flush();
await wait(GAP);
const before = (await getDoc(doc(admin(), 'users', UID, 'events', 'm1'))).data();
check(before?.hlc, 'M2: 신판 일정에 hlc가 없습니다.');
check(!(await oldWrite('m1', { title: '구버전먼저' })), 'M2: 구버전이 신판의 나중 수정을 덮었습니다.');
await sync();
check(row('m1')?.title === '신판나중', `M2: 신판 값이 구버전에 덮였습니다: ${row('m1')?.title}`);
const after = (await getDoc(doc(admin(), 'users', UID, 'events', 'm1'))).data();
check(after?.title === '신판나중', `M2: 클라우드 제목이 바뀌었습니다: ${after?.title}`);

/* M3: 신판이 지운 뒤 구버전이 오프라인 수정본을 serverTimestamp로 다시 만들면 거절 → 지운 채 */
await db.update((d) => {
    if (!d.events.some((x) => x.id === 'm3')) d.events.push({ id: 'm3', date: TODAY, title: '지울일정', kind: 'class', source: 'app' });
    return d;
});
await flush();
await db.removeItem('events', 'm3');
await flush();
const tomb = await getDoc(doc(admin(), 'users', UID, 'tombs', 'events-m3'));
check(tomb.exists(), 'M3: 묘비가 없습니다.');
check(!(await oldWrite('m3', { title: '되살림' })), 'M3: 구버전이 묘비 뒤 일정을 되살렸습니다.');
await sync();
check(!row('m3'), `M3: 지운 일정이 되살아났습니다: ${JSON.stringify(row('m3'))}`);
/* 신판이 묘비보다 늦게 다시 만들면 허용 */
await wait(GAP);
await db.update((d) => { d.events.push({ id: 'm3', date: TODAY, title: '신판복구', kind: 'class', source: 'app' }); return d; });
await flush();
await sync();
check(row('m3')?.title === '신판복구', `M3: 신판 복구가 실패했습니다: ${JSON.stringify(row('m3'))}`);

/* M4: 구버전 거절이 반복되어도 rejected 폭증·로컬 유실 없음(신판 기기가 구버전 거절을 흉내) */
{
    const localTitle = row('m1')?.title;
    let rejectedTotal = 0;
    for (let i = 0; i < 3; i += 1) {
        check(!(await oldWrite('m1', { title: `거절재시도${i}` })), `M4: ${i}번째 구버전 덮어쓰기가 통과했습니다.`);
        const result = await flush();
        rejectedTotal += (result?.rejected || []).length;
    }
    check(row('m1')?.title === localTitle, `M4: 로컬 일정이 지워지거나 바뀌었습니다: ${row('m1')?.title}`);
    check(rejectedTotal < 20, `M4: rejected가 폭증했습니다: ${rejectedTotal}`);
}

/*
 * M5: 업데이트 전에 고친 내용(PR #66 r3 P1). 신판이 쓴 일정(hlc)·지운 일정(묘비)·시간표를, 구버전 기기가 오프라인에서 고치고 못 올린 채 신판으로 업데이트.
 * 로컬 줄에 editAt·editD가 없어 예전에는 매번 거절(rejected)되고 lost도 아니어서 영영 갈라졌습니다. 로컬 수정을 지키고 올라가야 합니다.
 */
{
    await db.update((d) => {
        d.events.push({ id: 'a5', date: TODAY, title: '신판a5', kind: 'class', source: 'app' });
        d.events.push({ id: 't5', date: TODAY, title: '신판t5', kind: 'class', source: 'app' });
        d.timetable.wed = { ...(d.timetable.wed || {}), p1: '신판수학' };
        return d;
    });
    await flush();
    await wait(50);
    /* 구버전 기기(UP)가 이 시점 자료를 받아 둔 상태: 같은 저장소 사본 */
    const upMain = plain(vaults[0].map);
    const upLocal = plain(vaults[1].map);
    const upInbox = plain(vaults[2].map);
    const before = structuredClone(upMain.map.get('state'));
    /* 신판이 t5를 지움(묘비) */
    await db.removeItem('events', 't5');
    await flush();
    check((await getDoc(doc(admin(), 'users', UID, 'tombs', 'events-t5'))).exists(), 'M5: t5 묘비가 없습니다.');
    check((await getDoc(doc(admin(), 'users', UID, 'events', 'a5'))).data()?.hlc, 'M5: a5에 hlc가 없습니다.');
    /* 구버전에서 고친 줄: editAt·editD 없음(v73은 고친 시각을 남기지 않음), cloudHashes는 그대로(못 올림) */
    const strip = (r) => { const { editAt, editD, ...rest } = r; return rest; };
    before.events = (before.events || []).map((r) => (r.id === 'a5' ? strip({ ...r, title: '구버전a5' }) : r.id === 't5' ? strip({ ...r, title: '구버전t5' }) : r));
    before.timetable = { ...before.timetable, wed: strip({ ...before.timetable.wed, p1: '구버전과학' }) };
    upMain.map.set('state', before);
    for (const [k, v] of stores.NEW) stores.UP.set(k, v);
    cur = 'UP';
    const up = await import(new URL('.lwwmix/up/src/lib/db.js', root));
    const upFb = await import(new URL('.lwwmix/up/src/firebase.js', root));
    const upCloud = await import(new URL('.lwwmix/up/src/lib/cloud.js', root));
    upFb.useFirebaseForTest({ config: { apiKey: 'demo', projectId: 'demo-ssug-rules', authDomain: 'demo.local' }, bundle: { app: null, auth: null, db: env.authenticatedContext(UID).firestore(), memoryOnly: false } });
    up.useVaultsForTest(upMain, upLocal, upInbox);
    up.useCloudForTest({ available: () => true, push: upCloud.pushUserData, pull: upCloud.pullUserData, remove: upCloud.deleteUserDoc, peek: upCloud.peekTodos, clock: upCloud.measureServerClock, sweep: upCloud.sweepTombs, watch: () => () => {} });
    const told = [];
    up.subscribeStorageIssue?.((m) => { if (m) told.push(m); });
    await up.boot('');
    const upRow = (id) => (up.snapshot().events || []).find((r) => String(r.id) === String(id));
    check(upRow('a5')?.title === '구버전a5' && !(upRow('a5')?.editAt > 0), `M5: 준비 실패(업데이트 전 줄): ${JSON.stringify(upRow('a5'))}`);
    await up.setAuth({ uid: UID });
    await wait(150);
    let rejected = [];
    for (let i = 0; i < 2; i += 1) { cur = 'UP'; const r = await up.flushCloud(); rejected = rejected.concat(r?.rejected || []); }
    cur = 'UP'; await up.refreshFromCloud({ force: true });
    const cloudOf = async (name, id) => (await getDoc(doc(admin(), 'users', UID, name, id))).data();
    check(!rejected.length, `M5: 업데이트 전 고친 줄이 계속 거절됩니다: ${JSON.stringify(rejected)}`);
    check((await cloudOf('events', 'a5'))?.title === '구버전a5' && (await cloudOf('events', 'a5'))?.hlc, `M5: a5(hlc 문서) 수정이 올라가지 않았습니다: ${JSON.stringify(await cloudOf('events', 'a5'))}`);
    check((await cloudOf('events', 't5'))?.title === '구버전t5', `M5: 묘비 뒤 t5 수정(로컬)이 올라가지 않았습니다: ${JSON.stringify(await cloudOf('events', 't5'))}`);
    check((await cloudOf('timetable', 'wed'))?.p1 === '구버전과학', `M5: 시간표 수정이 올라가지 않았습니다: ${JSON.stringify(await cloudOf('timetable', 'wed'))}`);
    check(upRow('a5')?.title === '구버전a5' && upRow('t5')?.title === '구버전t5' && up.snapshot().timetable?.wed?.p1 === '구버전과학', `M5: 업데이트한 기기의 로컬 수정이 사라졌습니다: ${JSON.stringify([upRow('a5'), upRow('t5'), up.snapshot().timetable?.wed])}`);
    check(!told.some((m) => /받지 않았어요/.test(m)), `M5: 거절 안내가 떴습니다: ${told.join(' / ')}`);
    /* 신판 기기도 같은 값으로 맞춰짐(갈라지지 않음) */
    cur = 'NEW'; await sync();
    check(row('a5')?.title === '구버전a5' && row('t5')?.title === '구버전t5' && db.snapshot().timetable?.wed?.p1 === '구버전과학', `M5: 두 기기가 갈라졌습니다: ${JSON.stringify([row('a5'), row('t5'), db.snapshot().timetable?.wed])}`);
    cur = 'NEW';
}

/*
 * M6(PR #66 r4 A7): 구버전에서 오프라인으로 고침(T1) → 다른 기기 신판이 같은 항목을 더 나중에 고침(T2, hlc) → 업데이트.
 * 업데이트 전 수정은 고친 시각을 모르므로 '지금'으로 덮으면 안 됩니다. 일정·회의록은 클라우드 값을 받고 이 기기 수정은 '(충돌 사본)'으로 따로 올리고,
 * 사본을 만들 수 없는 출결·시간표는 클라우드 값을 받고 이 기기 값을 보관함(state.keptLegacy, 백업에도 들어감)에 남기고, 설정에서 되돌릴 수 있습니다. 어느 쪽 수정도 사라지지 않아야 합니다.
 */
{
    cur = 'NEW';
    const MAIN = vaults[0];
    const told6 = []; const off6 = db.subscribeStorageIssue((m) => { if (m) told6.push(String(m)); });
    await db.update((d) => {
        d.events.push({ id: 'a7', date: TODAY, title: '처음7', kind: 'class', source: 'app' });
        d.notes.push({ id: 'meet-a7n', text: '처음회의', title: '회의7', date: TODAY, source: 'app' });
        d.timetable.thu = { ...(d.timetable.thu || {}), p1: '처음국어' };
        return d;
    });
    await db.setAttendance(TODAY, 'a7s', '결석');
    await flush(); await wait(GAP);
    const attId = `${TODAY}_a7s`;
    /* T1: 구버전 수정(editAt·editD 없음, 못 올림) */
    const st = await MAIN.get('state');
    const strip = (r) => { delete r.editAt; delete r.editD; return r; };
    strip(Object.assign(st.events.find((x) => x.id === 'a7'), { title: 'A구버전먼저' }));
    strip(Object.assign(st.notes.find((x) => x.id === 'meet-a7n'), { text: 'A구버전회의' }));
    strip(Object.assign(st.attendance.find((x) => x.id === attId), { status: '조퇴' }));
    st.timetable.thu = strip({ ...st.timetable.thu, p1: 'A구버전과학' });
    await MAIN.set('state', st);
    await wait(GAP);
    /* T2: 다른 기기 신판의 더 나중 수정(hlc) */
    const tB = Timestamp.fromMillis(Date.now() - 300);
    await setDoc(doc(admin(), 'users', UID, 'events', 'a7'), { title: 'B신판나중', hlc: tB, updatedAt: tB }, { merge: true });
    await setDoc(doc(admin(), 'users', UID, 'notes', 'meet-a7n'), { text: 'B신판회의', hlc: tB, updatedAt: tB }, { merge: true });
    await setDoc(doc(admin(), 'users', UID, 'attendance', attId), { status: 'late', hlc: tB, updatedAt: tB }, { merge: true });
    await setDoc(doc(admin(), 'users', UID, 'timetable', 'thu'), { p1: 'B신판수학', hlc: tB, updatedAt: tB }, { merge: true });
    await wait(GAP);
    /* 업데이트(다시 켬) */
    await db.boot(''); await db.setAuth({ uid: UID }); await wait(200);
    const r6 = await flush(); await sync(); const r6b = await flush();
    const cloud6 = async (name, id) => (await getDoc(doc(admin(), 'users', UID, name, id))).data();
    check((await cloud6('events', 'a7'))?.title === 'B신판나중' && row('a7')?.title === 'B신판나중', `M6: 업데이트 전 수정이 다른 기기의 나중 일정 수정을 덮었습니다: 클라우드 ${(await cloud6('events', 'a7'))?.title}, 로컬 ${row('a7')?.title}`);
    const ev = (db.snapshot().events || []).find((r) => r.title === '(충돌 사본) A구버전먼저');
    check(ev && (await cloud6('events', ev.id))?.title === '(충돌 사본) A구버전먼저', `M6: 일정 충돌 사본이 로컬·클라우드에 없습니다: ${JSON.stringify(ev)}`);
    const note = (db.snapshot().notes || []).find((r) => r.id === 'meet-a7n');
    check(note?.text === 'B신판회의' && (await cloud6('notes', 'meet-a7n'))?.text === 'B신판회의', `M6: 회의록 나중 수정이 덮였습니다: ${note?.text}`);
    const noteCopy = (db.snapshot().notes || []).find((r) => r.text === 'A구버전회의' && r.id !== 'meet-a7n');
    check(noteCopy && String(noteCopy.id).startsWith('meet-') && String(noteCopy.title).startsWith('(충돌 사본) ') && (await cloud6('notes', noteCopy.id))?.text === 'A구버전회의', `M6: 회의록 충돌 사본이 없습니다: ${JSON.stringify(noteCopy)}`);
    check((await cloud6('attendance', attId))?.status === 'late' && (db.snapshot().attendance || []).find((r) => r.id === attId)?.status === '지각', `M6: 출결 나중 수정이 덮였습니다: ${JSON.stringify((db.snapshot().attendance || []).find((r) => r.id === attId))}`);
    check((await cloud6('timetable', 'thu'))?.p1 === 'B신판수학' && db.snapshot().timetable?.thu?.p1 === 'B신판수학', `M6: 시간표 나중 수정이 덮였습니다: ${db.snapshot().timetable?.thu?.p1}`);
    const keptList = db.keptLegacyList();
    check(JSON.stringify((await MAIN.get('state'))?.keptLegacy || []).includes('A구버전과학'), 'M6: 보관함이 기기 저장소에 남지 않았습니다.');
    check(keptList.some((k) => k.kind === 'attendance' && k.row?.status === '조퇴') && keptList.some((k) => k.kind === 'timetable' && k.row?.p1 === 'A구버전과학'), `M6: 사본을 못 만드는 출결·시간표의 이 기기 값이 보관되지 않았습니다: ${JSON.stringify(keptList)}`);
    check(keptList.some((k) => k.kind === 'events' && k.row?.title === 'A구버전먼저'), 'M6: 일정 원래 줄이 보관함에 없습니다.');
    check(told6.some((m) => /충돌 사본/.test(m)) && told6.some((m) => /보관함에 남겨/.test(m)), `M6: 사본·보관 안내가 없습니다: ${told6.join(' / ')}`);
    check(!(r6?.rejected || []).length && !(r6b?.rejected || []).length, `M6: 거절이 남았습니다: ${JSON.stringify([r6?.rejected, r6b?.rejected])}`);
    /* 보관함에서 되돌리기: 이 기기 값이 지금 고친 것으로 올라감 */
    {
        const backup = await import(new URL('.lwwmix/new/src/lib/backup.js', root));
        const exp = backup.buildExport(db.snapshot(), { at: 'x' });
        check(JSON.stringify(exp.keptLegacy || []).includes('A구버전과학') && JSON.stringify(exp.keptLegacy || []).includes('조퇴'), 'M6: 백업 파일에 보관함이 없습니다.');
        const ia = db.keptLegacyList().findIndex((k) => k.kind === 'attendance');
        check((await db.restoreKeptLegacy(ia)).ok, 'M6: 출결 되돌리기 실패');
        const it = db.keptLegacyList().findIndex((k) => k.kind === 'timetable');
        check((await db.restoreKeptLegacy(it)).ok, 'M6: 시간표 되돌리기 실패');
        await flush(); await wait(100); await sync();
        check((await cloud6('attendance', attId))?.status === 'early' && (db.snapshot().attendance || []).find((r) => r.id === attId)?.status === '조퇴', `M6: 출결 되돌리기가 올라가지 않았습니다: ${JSON.stringify(await cloud6('attendance', attId))}`);
        check((await cloud6('timetable', 'thu'))?.p1 === 'A구버전과학' && db.snapshot().timetable?.thu?.p1 === 'A구버전과학', `M6: 시간표 되돌리기가 올라가지 않았습니다: ${JSON.stringify(await cloud6('timetable', 'thu'))}`);
        check(!db.keptLegacyList().some((k) => k.kind === 'attendance' || k.kind === 'timetable'), 'M6: 되돌린 항목이 보관함에 남았습니다.');
    }
    /* 두 번째 실행에서 사본을 또 만들지 않음 */
    await db.boot(''); await db.setAuth({ uid: UID }); await wait(200); await flush();
    check((db.snapshot().events || []).filter((r) => r.title === '(충돌 사본) A구버전먼저').length === 1, 'M6: 다시 켜니 충돌 사본이 또 생겼습니다.');
    off6();
}

await env.cleanup();
rmSync(new URL('.lwwmix/', root), { recursive: true, force: true });
if (failures.length) {
    console.error(`구버전 혼용 검사 실패 ${failures.length}건\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('구버전 혼용 검사 통과(M1~M6, 새 규칙)');
