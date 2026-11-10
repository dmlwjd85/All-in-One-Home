/**
 * 일정·회의록·출결 '항목마다 나중에 고친 쪽이 이긴다' 두 기기 검사(에뮬레이터 + 실제 규칙 + 진짜 cloud.js). 고치기 전에는 나중에 올린 쪽이 이겨 W2·W3·N1·T1·D1이 실패했습니다.
 */
import { cpSync, readFileSync, rmSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, disableNetwork, enableNetwork, serverTimestamp, setDoc, terminate, Timestamp } from 'firebase/firestore';

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
rmSync(new URL('.lwwdev/', root), { recursive: true, force: true });
for (const d of ['a', 'b']) cpSync(new URL('src/', root), new URL(`.lwwdev/${d}/src/`, root), { recursive: true });

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
    const fb = await import(new URL(`.lwwdev/${dir}/src/firebase.js`, root));
    const cloud = await import(new URL(`.lwwdev/${dir}/src/lib/cloud.js`, root));
    const db = await import(new URL(`.lwwdev/${dir}/src/lib/db.js`, root));
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

/* W1: 한쪽에서 만든 일정이 다른 기기로 갑니다. */
await add('A', 'events', { id: 'ev1', date: TODAY, title: '학부모 상담', kind: 'class', source: 'app' });
await flush('A'); await sync('B');
check(rowOf('B', 'events', 'ev1')?.title === '학부모 상담', `W1: 일정이 다른 기기로 가지 않았습니다: ${JSON.stringify(rowOf('B', 'events', 'ev1'))}`);

/* W2: PC(B, 시계 +1h)가 먼저, 폰(A, -1h)이 나중에 고침. PC가 나중에 올려도 폰 값. */
await conflict('events', 'ev1', 'B', 'A', 'title', 'PC 제목', '폰 제목', 'A');
check(rowOf('A', 'events', 'ev1')?.title === '폰 제목' && rowOf('B', 'events', 'ev1')?.title === '폰 제목', `W2: 나중에 고친 일정이 이기지 않았습니다: 폰 ${rowOf('A', 'events', 'ev1')?.title} / PC ${rowOf('B', 'events', 'ev1')?.title}`);
/* W3: 거울. 폰이 먼저, PC가 나중. 폰이 나중에 올려도 PC 값. */
await conflict('events', 'ev1', 'A', 'B', 'title', '폰 제목2', 'PC 제목2', 'B');
check(rowOf('A', 'events', 'ev1')?.title === 'PC 제목2' && rowOf('B', 'events', 'ev1')?.title === 'PC 제목2', `W3: 나중에 고친 일정이 이기지 않았습니다: 폰 ${rowOf('A', 'events', 'ev1')?.title} / PC ${rowOf('B', 'events', 'ev1')?.title}`);

/* N1: 회의록. 폰이 먼저, PC가 나중. 폰이 나중에 올려도 PC 본문. */
await add('A', 'notes', { id: 'nt1', text: '첫 회의', title: '학년 회의', source: 'app', tags: ['회의'] });
await flush('A'); await sync('B');
await conflict('notes', 'nt1', 'A', 'B', 'text', '폰 본문', 'PC 본문', 'B');
check(rowOf('A', 'notes', 'nt1')?.text === 'PC 본문' && rowOf('B', 'notes', 'nt1')?.text === 'PC 본문', `N1: 나중에 고친 회의록이 이기지 않았습니다: 폰 ${rowOf('A', 'notes', 'nt1')?.text} / PC ${rowOf('B', 'notes', 'nt1')?.text}`);

/* T1: 출결. PC가 먼저 '결석', 폰이 나중 '지각'. PC가 나중에 올려도 지각. */
await on('A', (db) => db.setAttendance(TODAY, 's1', '결석'));
await flush('A'); await sync('B');
const att = (dev) => (getState(dev).attendance || []).find((r) => r.sid === 's1' && r.date === TODAY);
const attId = att('A')?.id;
offline.A = true; offline.B = true;
await on('B', (db) => db.setAttendance(TODAY, 's1', '조퇴'));
await wait(GAP);
await on('A', (db) => db.setAttendance(TODAY, 's1', '지각'));
offline.A = false; await flush('A'); await sync('A');
offline.B = false; await flush('B'); await sync('B');
await both();
check(att('A')?.status === '지각' && att('B')?.status === '지각', `T1: 나중에 고친 출결이 이기지 않았습니다: 폰 ${att('A')?.status} / PC ${att('B')?.status} (${attId})`);

/* U1: 한쪽에만 있는 항목은 합칩니다(오프라인에서 각자 만든 일정). */
offline.A = true; offline.B = true;
await add('A', 'events', { id: 'evA', date: TODAY, title: '폰에서 만든 일정', kind: 'class', source: 'app' });
await add('B', 'events', { id: 'evB', date: TODAY, title: 'PC에서 만든 일정', kind: 'class', source: 'app' });
offline.A = false; offline.B = false;
await flush('A'); await flush('B'); await both();
check(['A', 'B'].every((d) => rowOf(d, 'events', 'evA') && rowOf(d, 'events', 'evB') && rowOf(d, 'events', 'ev1')), 'U1: 한쪽에만 있던 일정이 합쳐지지 않았습니다.');

/* D1: 폰이 오프라인에서 먼저 고치고, PC가 나중에 지움. 폰이 나중에 올려도 지운 채로. */
offline.A = true;
await edit('A', 'events', 'evA', { title: '먼저 고친 제목' });
await wait(GAP);
await on('B', (db) => db.removeItem('events', 'evA'));
await flush('B');
offline.A = false; await sync('A'); await flush('A'); await both();
check(!rowOf('A', 'events', 'evA') && !rowOf('B', 'events', 'evA'), `D1: 나중에 지운 일정이 먼저 고친 기기에서 되살아났습니다: ${JSON.stringify(rowOf('A', 'events', 'evA') || rowOf('B', 'events', 'evA'))}`);

/* D2: 반대로 PC가 먼저 지우고 폰이 나중에 고치면 고친 값이 남습니다(나중이 이김, 자료를 잃지 않음). */
offline.A = true;
await on('B', (db) => db.removeItem('events', 'evB'));
await flush('B');
await wait(GAP);
await edit('A', 'events', 'evB', { title: '나중에 고친 제목' });
offline.A = false; await sync('A'); await flush('A'); await both();
check(rowOf('A', 'events', 'evB')?.title === '나중에 고친 제목' && rowOf('B', 'events', 'evB')?.title === '나중에 고친 제목', `D2: 지운 뒤 나중에 고친 일정이 사라졌습니다: 폰 ${JSON.stringify(rowOf('A', 'events', 'evB'))} / PC ${JSON.stringify(rowOf('B', 'events', 'evB'))}`);

/* S1~S3: 시간표는 요일마다 고친 시각으로 견줍니다. 폰이 월요일, PC가 화요일을 오프라인에서 고치면 둘 다 남고,
   수요일은 둘 다 고쳤을 때 나중에 고친 쪽(PC가 먼저, 폰이 나중)이 PC가 나중에 올려도 이깁니다. */
const tt = (dev, day) => { cur = dev; return devices[dev].db.snapshot().timetable?.[day] || {}; };
await on('A', (db) => db.setTimetable('mon', 1, '국어'));
await on('A', (db) => db.setTimetable('tue', 1, '수학'));
await on('A', (db) => db.setTimetable('wed', 1, '과학'));
await flush('A'); await sync('B');
check(tt('B', 'mon').p1 === '국어' && tt('B', 'wed').p1 === '과학', `S0: 시간표가 다른 기기로 가지 않았습니다: ${JSON.stringify(tt('B', 'mon'))}`);
offline.A = true; offline.B = true;
await on('A', (db) => db.setTimetable('mon', 1, '폰국어'));
await on('B', (db) => db.setTimetable('tue', 1, 'PC수학'));
await on('B', (db) => db.setTimetable('wed', 1, 'PC과학'));
await wait(GAP);
await on('A', (db) => db.setTimetable('wed', 1, '폰과학'));
offline.A = false; await flush('A'); await sync('A');
offline.B = false; await flush('B'); await sync('B');
await both();
check(['A', 'B'].every((d) => tt(d, 'mon').p1 === '폰국어'), `S1: 폰에서 고친 월요일이 남지 않았습니다: 폰 ${tt('A', 'mon').p1} / PC ${tt('B', 'mon').p1}`);
check(['A', 'B'].every((d) => tt(d, 'tue').p1 === 'PC수학'), `S2: PC에서 고친 화요일이 남지 않았습니다: 폰 ${tt('A', 'tue').p1} / PC ${tt('B', 'tue').p1}`);
check(['A', 'B'].every((d) => tt(d, 'wed').p1 === '폰과학'), `S3: 나중에 고친 수요일이 이기지 않았습니다: 폰 ${tt('A', 'wed').p1} / PC ${tt('B', 'wed').p1}`);
/* S4: 거울. PC가 나중에 고치고 폰이 나중에 올려도 PC 값. */
offline.A = true; offline.B = true;
await on('A', (db) => db.setTimetable('thu', 2, '폰음악'));
await wait(GAP);
await on('B', (db) => db.setTimetable('thu', 2, 'PC음악'));
offline.B = false; await flush('B'); await sync('B');
offline.A = false; await flush('A'); await sync('A');
await both();
check(['A', 'B'].every((d) => tt(d, 'thu').p2 === 'PC음악'), `S4: 나중에 고친 목요일이 이기지 않았습니다: 폰 ${tt('A', 'thu').p2} / PC ${tt('B', 'thu').p2}`);
/* S5: 고친 시각을 모르는 옛 클라우드 문서(serverTimestamp)가 있어도 이 기기에서 고친 적 없는 요일은 받아 옵니다. */
await setDoc(doc(admin(), 'users', UID, 'timetable', 'fri'), { p3: '옛체육', updatedAt: serverTimestamp() });
await sync('A');
check(tt('A', 'fri').p3 === '옛체육', `S5: 옛 판이 올린 금요일을 받지 않았습니다: ${JSON.stringify(tt('A', 'fri'))}`);

/* S6: PC가 오프라인에서 먼저 고쳐 두고 올리기 전에, 폰이 나중에 고친 같은 요일을 받으면 폰 값을 받습니다(PC의 더 이른 값은 규칙이 거절). */
offline.B = true;
await on('B', (db) => db.setTimetable('fri', 5, 'PC옛값'));
await wait(GAP);
await on('A', (db) => db.setTimetable('fri', 5, '폰새값')); await flush('A');
offline.B = false;
await on('B', (db) => db.pullFromCloudNow());
await both();
check(['A', 'B'].every((d) => tt(d, 'fri').p5 === '폰새값'), `S6: 금요일이 나중 값으로 모이지 않았습니다: 폰 ${tt('A', 'fri').p5} / PC ${tt('B', 'fri').p5}`);

/* R1: 실시간 감시. 열려 있는 PC가 따로 받지 않아도 폰에서 고친 일정·출결·회의록·시간표·지움이 옵니다. */
{
    const stop = await on('B', (_db, d) => d.cloud.watchTodos(UID, () => { cur = 'B'; return devices.B.db.refreshFromCloud({ force: true }); }));
    await wait(500);
    const until = async (fn) => { for (let i = 0; i < 60; i += 1) { await wait(100); cur = 'B'; if (fn()) return true; } return false; };
    await wait(GAP);
    await edit('A', 'events', 'ev1', { title: '실시간 제목' }); await flush('A');
    check(await until(() => rowOf('B', 'events', 'ev1')?.title === '실시간 제목'), `R1: 일정이 실시간으로 오지 않았습니다: ${rowOf('B', 'events', 'ev1')?.title}`);
    await wait(GAP);
    await on('A', (db) => db.setAttendance(TODAY, 's1', '결석')); await flush('A');
    check(await until(() => att('B')?.status === '결석'), `R1: 출결이 실시간으로 오지 않았습니다: ${att('B')?.status}`);
    await wait(GAP);
    await edit('A', 'notes', 'nt1', { text: '실시간 본문' }); await flush('A');
    check(await until(() => rowOf('B', 'notes', 'nt1')?.text === '실시간 본문'), `R1: 회의록이 실시간으로 오지 않았습니다: ${rowOf('B', 'notes', 'nt1')?.text}`);
    await wait(GAP);
    await on('A', (db) => db.setTimetable('mon', 4, '실시간미술')); await flush('A');
    check(await until(() => tt('B', 'mon').p4 === '실시간미술'), `R1: 시간표가 실시간으로 오지 않았습니다: ${JSON.stringify(tt('B', 'mon'))}`);
    await wait(GAP);
    await on('A', (db) => db.removeItem('events', 'ev1')); await flush('A');
    check(await until(() => !rowOf('B', 'events', 'ev1')), 'R1: 지운 일정이 실시간으로 지워지지 않았습니다.');
    /* 설정: 다른 기기가 교시 시작 시각을 고치면 열린 PC로 옵니다. */
    await wait(GAP);
    const { toCloudSettings } = await import('../src/lib/cloudShape.js');
    const nowAt = Date.now();
    const { body } = toCloudSettings({ profile: { periodStarts: ['08:51'], settingsAt: nowAt, settingsAts: { periodStarts: nowAt } } }, {});
    await setDoc(doc(admin(), 'users', UID, 'settings', 'device'), { ...body, updatedAt: serverTimestamp() });
    check(await until(() => devices.B.db.snapshot().profile?.periodStarts?.[0] === '08:51'), `R1: 설정이 실시간으로 오지 않았습니다: ${devices.B.db.snapshot().profile?.periodStarts}`);
    stop();
}

/* X12: 다른 기기가 더 나중에 고쳐 이 기기 쓰기가 lost가 되면, 곧바로 refreshFromCloud로 클라우드 값을 받습니다. */
{
    await add('A', 'events', { id: 'evX12', date: TODAY, title: 'X12시작', kind: 'class', source: 'app' });
    await flush('A'); await sync('B');
    offline.A = true;
    await edit('A', 'events', 'evX12', { title: 'X12먼저' });
    await wait(GAP);
    await edit('B', 'events', 'evX12', { title: 'X12나중' });
    await flush('B');
    offline.A = false;
    const lostFlush = await flush('A');
    check((lostFlush?.lost || []).includes('events/evX12') || rowOf('A', 'events', 'evX12')?.title === 'X12나중', `X12: lost 표시가 없습니다: ${JSON.stringify(lostFlush)}`);
    for (let i = 0; i < 40 && rowOf('A', 'events', 'evX12')?.title !== 'X12나중'; i += 1) await wait(50);
    check(rowOf('A', 'events', 'evX12')?.title === 'X12나중', `X12: lost 뒤 클라우드 값을 바로 받지 않았습니다: ${rowOf('A', 'events', 'evX12')?.title}`);
}

/* DAY1: 서버 시각을 다시 재기 전(시계 +1일 기기)에 고친 일정. 올린 시각(serverTimestamp)으로 견주면 +1일 기기가 늘 이겨 버렸습니다.
   재기 전 쓰기는 hlc 없이 올라가 새 판 문서를 덮지 못하고(로컬은 그대로), 재기 뒤 editD+차이로 고친 시각을 다시 찍어 바르게 판정합니다. */
{
    const DAY = 24 * HOUR;
    await add('A', 'events', { id: 'evDayA', date: TODAY, title: 'D시작', kind: 'class', source: 'app' });
    await add('A', 'events', { id: 'evDayB', date: TODAY, title: 'D시작', kind: 'class', source: 'app' });
    await add('A', 'events', { id: 'evDayDel', date: TODAY, title: 'D지울', kind: 'class', source: 'app' });
    await flush('A'); await sync('B');
    const toldB = [];
    cur = 'B'; const unsub = devices.B.db.subscribeStorageIssue?.((m) => { if (m) toldB.push(String(m)); });
    noclock.B = true;
    await on('B', (db) => { db.useDeviceClockForTest(() => Date.now() + DAY); db.resetClockForTest({ measured: false }); });
    offline.B = true;
    /* evDayA: B(+1일, 재기 전)가 먼저, A가 나중 → A 승리 */
    await edit('B', 'events', 'evDayA', { title: 'B먼저' });
    check(!(rowOf('B', 'events', 'evDayA')?.editAt > 0) && Number.isFinite(rowOf('B', 'events', 'evDayA')?.editD), `DAY1: 재기 전 고친 시각이 '모름'이 아닙니다: ${JSON.stringify(rowOf('B', 'events', 'evDayA'))}`);
    await wait(GAP);
    await edit('A', 'events', 'evDayA', { title: 'A나중' });
    /* evDayB: A가 먼저, B(+1일, 재기 전)가 나중 → B 승리 */
    await edit('A', 'events', 'evDayB', { title: 'A먼저' });
    await wait(GAP);
    await edit('B', 'events', 'evDayB', { title: 'B나중' });
    /* P2-3: 재기 전(+1일) 기기가 지운 일정. 기기 시각 묘비는 notAhead에 걸리고 그 뒤 고친 문서까지 지울 수 있어, 재기 뒤에 지웁니다. */
    await on('B', (db) => db.removeItem('events', 'evDayDel'));
    await flush('A');
    offline.B = false;
    await flush('B');
    check(!toldB.some((m) => /받지 않았어요/.test(m)), `DAY1: 시각 정착 전 거절인데 거절 안내가 떴습니다: ${toldB.join(' / ')}`);
    check((await getDoc(doc(admin(), 'users', UID, 'events', 'evDayDel'))).exists(), 'DAY1: 재기 전 삭제를 기기 시각(+1일)으로 바로 보냈습니다.');
    await sync('B');
    check(!rowOf('B', 'events', 'evDayDel'), 'DAY1: 재기 전에 지운 일정이 받아오기로 되살아났습니다.');
    const cloudTitle = async (id) => (await getDoc(doc(admin(), 'users', UID, 'events', id))).data()?.title;
    check(await cloudTitle('evDayA') === 'A나중', `DAY1: 재기 전 +1일 기기가 더 나중 수정을 덮었습니다: ${await cloudTitle('evDayA')}`);
    check(rowOf('B', 'events', 'evDayA')?.title === 'B먼저' || rowOf('B', 'events', 'evDayA')?.title === 'A나중', 'DAY1: 재기 전 B 로컬 일정이 사라졌습니다.');
    check(rowOf('B', 'events', 'evDayB')?.title === 'B나중', `DAY1: 재기 전 B의 나중 수정이 로컬에서 사라졌습니다: ${rowOf('B', 'events', 'evDayB')?.title}`);
    /* 서버 시각 재기 성공 → 고친 시각 정착 → 다시 올리기 */
    noclock.B = false;
    await on('B', (db) => db.retryServerClockForTest());
    check(rowOf('B', 'events', 'evDayB')?.editAt > 0 && Math.abs(rowOf('B', 'events', 'evDayB').editAt - Date.now()) < DAY / 2, `DAY1: 재기 뒤 고친 시각이 서버 기준으로 정착하지 않았습니다: ${JSON.stringify(rowOf('B', 'events', 'evDayB'))}`);
    await flush('B'); await wait(200);
    await both();
    const delTomb = await getDoc(doc(admin(), 'users', UID, 'tombs', 'events-evDayDel'));
    check(!(await getDoc(doc(admin(), 'users', UID, 'events', 'evDayDel'))).exists() && delTomb.exists() && Math.abs(delTomb.data().at.toMillis() - Date.now()) < DAY / 2, `DAY1: 재기 뒤 지우기·묘비(서버 기준 시각)가 되지 않았습니다: ${JSON.stringify(delTomb.data())}`);
    check(!rowOf('A', 'events', 'evDayDel') && !rowOf('B', 'events', 'evDayDel'), 'DAY1: 지운 일정이 남아 있습니다.');
    check(!toldB.some((m) => /받지 않았어요/.test(m)), `DAY1: 거절 안내가 떴습니다: ${toldB.join(' / ')}`);
    unsub?.();
    check(await cloudTitle('evDayA') === 'A나중' && rowOf('A', 'events', 'evDayA')?.title === 'A나중' && rowOf('B', 'events', 'evDayA')?.title === 'A나중', `DAY1: A 나중 수정이 이기지 않았습니다: 클라우드 ${await cloudTitle('evDayA')}, A ${rowOf('A', 'events', 'evDayA')?.title}, B ${rowOf('B', 'events', 'evDayA')?.title}`);
    check(await cloudTitle('evDayB') === 'B나중' && rowOf('A', 'events', 'evDayB')?.title === 'B나중' && rowOf('B', 'events', 'evDayB')?.title === 'B나중', `DAY1: B 나중 수정(재기 전)이 이기지 않았습니다: 클라우드 ${await cloudTitle('evDayB')}, A ${rowOf('A', 'events', 'evDayB')?.title}, B ${rowOf('B', 'events', 'evDayB')?.title}`);
    await on('B', (db) => db.useDeviceClockForTest(() => Date.now() + HOUR));
    await on('B', (db) => db.retryServerClockForTest());
}

/* SETDAY(PR #66 r5 P1): 시계가 +1일인 기기(B)의 설정·교시(출퇴근) 수정. 고친 시각이 기기 시각이면 하루 동안 늘 이겨 A의 더 나중 수정을 조용히 덮었습니다.
   서버 보정 시각으로 찍어 나중에 고친 쪽(A)이 이깁니다. */
{
    const DAY = 24 * HOUR;
    await on('B', (db) => db.useDeviceClockForTest(() => Date.now() + DAY));
    await on('B', (db) => db.retryServerClockForTest());
    await both();
    const pl = {};
    for (const [name, dir] of [['A', 'a'], ['B', 'b']]) pl[name] = await import(new URL(`.lwwdev/${dir}/src/lib/periodLocal.js`, root));
    await on('B', (db) => db.update((d) => { d.profile.periodStarts = ['08:41']; return d; }));
    await on('B', () => pl.B.patchPeriodLocal({ workStart: '07:41' }));
    await flush('B');
    await wait(GAP);
    await on('A', (db) => db.update((d) => { d.profile.periodStarts = ['08:52']; return d; }));
    await on('A', () => pl.A.patchPeriodLocal({ workStart: '07:52' }));
    await flush('A');
    await both(); await flush('B'); await both();
    const ps = (dev) => getState(dev).profile?.periodStarts?.[0];
    const ws = (dev) => { cur = dev; return pl[dev].readPeriodLocal().workStart; };
    check(ps('A') === '08:52' && ps('B') === '08:52', `SETDAY: +1일 기기의 설정이 나중 수정을 덮었습니다: A ${ps('A')}, B ${ps('B')}`);
    check(ws('A') === '07:52' && ws('B') === '07:52', `SETDAY: +1일 기기의 출퇴근(교시) 설정이 나중 수정을 덮었습니다: A ${ws('A')}, B ${ws('B')}`);
    const bAt = getState('B').profile?.settingsAts?.periodStarts;
    check(!(Number(bAt) > Date.now() + 60_000), `SETDAY: 설정 고친 시각이 미래(기기 시각)입니다: ${bAt}`);
    await on('B', (db) => db.useDeviceClockForTest(() => Date.now() + HOUR));
    await on('B', (db) => db.retryServerClockForTest());
}

/* TEN(PR #66 r4 2번): 재기가 10분 넘게 실패한 +1일 기기의 삭제. 기기 시각(notAfter)으로 견주면 다른 기기의 나중 수정까지 지웠습니다.
   지문(expect)이 맞을 때만 지우고(다른 기기가 고쳤으면 남김), 묘비는 서버 시각입니다. */
{
    const DAY = 24 * HOUR;
    await add('A', 'events', { id: 'evTen', date: TODAY, title: 'T시작', kind: 'class', source: 'app' });
    await add('A', 'events', { id: 'evTen2', date: TODAY, title: 'T그대로', kind: 'class', source: 'app' });
    await flush('A'); await sync('B');
    noclock.B = true;
    let skew = DAY;
    await on('B', (db) => { db.useDeviceClockForTest(() => Date.now() + skew); db.resetClockForTest({ measured: false }); });
    await on('B', (db) => db.removeItem('events', 'evTen'));
    await on('B', (db) => db.removeItem('events', 'evTen2'));
    await flush('B');
    check((await getDoc(doc(admin(), 'users', UID, 'events', 'evTen'))).exists(), 'TEN: 10분 전에 지웠습니다.');
    await wait(GAP);
    await edit('A', 'events', 'evTen', { title: 'A10분안에수정' });
    await flush('A');
    skew = DAY + 11 * 60 * 1000;
    await flush('B'); await wait(100);
    const ten = await getDoc(doc(admin(), 'users', UID, 'events', 'evTen'));
    check(ten.exists() && ten.data().title === 'A10분안에수정', `TEN: 10분 뒤 기기 시각으로 다른 기기의 나중 수정을 지웠습니다: ${JSON.stringify(ten.data())}`);
    check(!(await getDoc(doc(admin(), 'users', UID, 'events', 'evTen2'))).exists(), 'TEN: 그대로인 일정을 10분 뒤에도 지우지 못했습니다.');
    const tomb2 = await getDoc(doc(admin(), 'users', UID, 'tombs', 'events-evTen2'));
    check(tomb2.exists() && Math.abs(tomb2.data().at.toMillis() - Date.now()) < 60_000, `TEN: 묘비가 서버 시각이 아닙니다: ${JSON.stringify(tomb2.data())}`);
    await sync('B');
    check(rowOf('B', 'events', 'evTen')?.title === 'A10분안에수정', `TEN: 남긴 나중 수정이 B로 돌아오지 않았습니다: ${JSON.stringify(rowOf('B', 'events', 'evTen'))}`);
    noclock.B = false;
    await on('B', (db) => db.useDeviceClockForTest(() => Date.now() + HOUR));
    await on('B', (db) => db.retryServerClockForTest());
}

/* SETTLE(PR #66 r4 전수 점검): 재기 전(+1일)에 고친 뒤 기기 시계를 바로잡고 재면, editD+차이가 지금보다 늦어 '지금'으로 잘려
   다른 기기의 더 나중 수정을 이겼습니다. 이제 '모름'으로 두고 클라우드 판과 다르면 충돌 사본으로 양쪽을 남깁니다. */
{
    const DAY = 24 * HOUR;
    await add('A', 'events', { id: 'evSet', date: TODAY, title: 'S시작', kind: 'class', source: 'app' });
    await flush('A'); await sync('B');
    noclock.B = true;
    await on('B', (db) => { db.useDeviceClockForTest(() => Date.now() + DAY); db.resetClockForTest({ measured: false }); });
    offline.B = true;
    await edit('B', 'events', 'evSet', { title: 'B먼저S' });
    await on('B', (db) => db.useDeviceClockForTest(() => Date.now() + HOUR));
    await wait(GAP);
    await edit('A', 'events', 'evSet', { title: 'A나중S' });
    await flush('A');
    offline.B = false; noclock.B = false;
    await on('B', (db) => db.retryServerClockForTest());
    check(!(rowOf('B', 'events', 'evSet')?.editAt > 0), `SETTLE: 믿을 수 없는 고친 시각을 정착했습니다: ${JSON.stringify(rowOf('B', 'events', 'evSet'))}`);
    await flush('B'); await sync('B'); await flush('B'); await both();
    const cs = await getDoc(doc(admin(), 'users', UID, 'events', 'evSet'));
    check(cs.data()?.title === 'A나중S' && rowOf('A', 'events', 'evSet')?.title === 'A나중S' && rowOf('B', 'events', 'evSet')?.title === 'A나중S', `SETTLE: 시계를 바꾼 기기가 나중 수정을 덮었습니다: 클라우드 ${cs.data()?.title}, B ${rowOf('B', 'events', 'evSet')?.title}`);
    const copyB = (getState('B').events || []).find((r) => r.title === '(충돌 사본) B먼저S');
    const copyA = (getState('A').events || []).find((r) => r.title === '(충돌 사본) B먼저S');
    check(copyB && copyA, `SETTLE: B 수정의 충돌 사본이 양쪽에 없습니다: ${JSON.stringify([copyB, copyA])}`);
}

/* 규칙: 더 이른 고친 시각·미래 시각 거절. hlc 있는 문서는 옛 판(serverTimestamp·hlc 없음)이 덮지 못함. */
const evAt = (ms) => Timestamp.fromMillis(ms);
const evNew = (at) => ({ date: TODAY, title: '규칙', kind: 'class', source: 'app', updatedAt: at, hlc: at });
const evOld = (at) => ({ date: TODAY, title: '옛판', kind: 'class', source: 'app', updatedAt: at });
const tryEv = (id, body) => setDoc(doc(admin(), 'users', UID, 'events', id), body, { merge: true }).then(() => true, () => false);
const t0 = Date.now() - 1000;
check(await tryEv('rule1', evNew(evAt(t0))), '규칙: 새 판 일정을 거절했습니다.');
check(!(await tryEv('rule1', evNew(evAt(t0 - 60000)))), '규칙: 더 이른 고친 시각의 일정 덮어쓰기를 받아들였습니다.');
check(!(await tryEv('rule1', evNew(evAt(Date.now() + HOUR)))), '규칙: 1시간 뒤(미래) 고친 시각을 받아들였습니다.');
check(!(await tryEv('rule1', evOld(serverTimestamp()))), '규칙: hlc 있는 문서를 옛 판 serverTimestamp로 덮는 것을 받아들였습니다.');
check(!(await tryEv('rule1', evOld(evAt(Date.now())))), '규칙: hlc 있는 문서를 hlc 없는 쓰기로 덮는 것을 받아들였습니다.');
check(await tryEv('rule1', evNew(evAt(Date.now() - 500))), '규칙: 더 늦은 새 판 일정 덮어쓰기를 거절했습니다.');
/* hlc 없는 옛 문서에는 옛 판 serverTimestamp를 허용(구버전만 쓰는 동안). */
check(await tryEv('ruleOld', evOld(serverTimestamp())), '규칙: hlc 없는 문서의 옛 판 쓰기를 거절했습니다.');
const tryTomb = (key, k) => setDoc(doc(admin(), 'users', UID, 'tombs', key), { k, at: serverTimestamp() }).then(() => true, () => false);
check(await tryTomb('events-x1', 'events') && await tryTomb(`attendance-${TODAY}_s1`, 'attendance'), '규칙: 일정·출결 묘비를 거절했습니다.');
/* 묘비 시각을 고정해 두고(서버 시각보다 이르게), 그보다 늦은 새 판만 되살리게 합니다. */
await setDoc(doc(admin(), 'users', UID, 'tombs', 'events-x1'), { k: 'events', at: Timestamp.fromMillis(Date.now() - 60_000) });
check(!(await tryEv('x1', evOld(serverTimestamp()))), '규칙: 묘비보다 늦은 옛 판 되살리기를 받아들였습니다.');
check(await tryEv('x1', evNew(evAt(Date.now() - 1_000))), '규칙: 묘비보다 늦은 새 판 되살리기를 거절했습니다.');
const tryTt = (body) => setDoc(doc(admin(), 'users', UID, 'timetable', 'tue'), body).then(() => true, () => false);
const ttNew = (at) => ({ p1: '규칙', updatedAt: at, hlc: at });
check(await tryTt(ttNew(evAt(Date.now() - 1000))), '규칙: 맞는 시간표 쓰기를 거절했습니다.');
check(!(await tryTt(ttNew(evAt(Date.now() - 60000)))), '규칙: 더 이른 고친 시각의 시간표 덮어쓰기를 받아들였습니다.');
check(!(await tryTt(ttNew(evAt(Date.now() + HOUR)))), '규칙: 미래 시각의 시간표를 받아들였습니다.');
check(!(await tryTt({ p1: '옛', updatedAt: serverTimestamp() })), '규칙: hlc 있는 시간표를 옛 판이 덮는 것을 받아들였습니다.');
check(!(await tryTomb('events-x2', 'notes')) && !(await tryTomb('records-x', 'records')), '규칙: 이름이 맞지 않는 묘비를 받아들였습니다.');

await env.cleanup();
rmSync(new URL('.lwwdev/', root), { recursive: true, force: true });
if (failures.length) {
    console.error(`항목별 나중 수정 두 기기 검사 실패 ${failures.length}건\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('일정·회의록·출결 두 기기 검사 통과(진짜 cloud.js·규칙, 시계 ±1시간·재기 전 +1일·10분 뒤·정착 모름·X12)');
