/**
 * 회의록 자동 등록 두 기기 검사(에뮬레이터 + 실제 규칙 + 진짜 cloud.js): PR #64 r2 검수 1~4번.
 * 폰(A)·PC(B)는 src 를 따로 복사해 불러 서로 다른 모듈·Firestore 클라이언트를 씁니다.
 * 오프라인은 클라우드 함수 앞에서 'unavailable'로 막아 흉내 냅니다(조회는 null = '모름').
 * 변이 D1·D2·E1 은 사본의 cloud.js 를 고쳐 같은 시나리오를 돌려 잡히는지 봅니다(소스 맞추기 아님).
 */
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc, serverTimestamp, terminate } from 'firebase/firestore';

const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-ssug-rules', firestore: { host, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const HOUR = 3600 * 1000;
const root = new URL('../', import.meta.url);
const WORK = `.mintwodev-${process.pid}/`;
const config = { apiKey: 'demo', projectId: 'demo-ssug-rules', authDomain: 'demo.local' };
const stores = { A: new Map(), B: new Map(), C: new Map() };
let cur = 'A';
globalThis.localStorage = {
    getItem: (k) => (stores[cur].has(k) ? stores[cur].get(k) : null),
    setItem: (k, v) => stores[cur].set(k, String(v)),
    removeItem: (k) => stores[cur].delete(k),
};
const plain = () => { const map = new Map(); return { get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };

/** 한 판: 두 기기를 새로 열고 고른 시나리오를 돌립니다. 실패 목록. */
async function run(tag, mutate, only) {
    const failures = [];
    const check = (ok, msg) => { if (!ok) failures.push(msg); };
    const UID = `minutes-${tag}`;
    const admin = () => env.authenticatedContext(UID).firestore();
    stores.A = new Map(); stores.B = new Map(); stores.C = new Map();
    const offline = { A: false, B: false, C: false };
    const devices = {};
    /* C는 나중에 처음 로그인하는 새 기기(이 기기 기억 없음). X2에서만 엽니다. */
    for (const name of (!only || only.includes('X2')) ? ['A', 'B', 'C'] : ['A', 'B']) {
        const dir = new URL(`${WORK}${tag}/${name}/`, root);
        cpSync(new URL('src/', root), new URL('src/', dir), { recursive: true });
        /* more: 함께 바꿀 곳(보조 안전장치를 따로 확인할 때 주 장치도 같이 끕니다). */
        for (const m of mutate ? [mutate, ...(mutate.more || [])] : []) {
            const file = new URL(`src/lib/${m.file}`, dir);
            const text = readFileSync(file, 'utf8');
            if (!text.includes(m.from)) return [`변이 ${tag}: 바꿀 코드를 찾지 못했습니다.`];
            writeFileSync(file, text.replace(m.from, m.to));
        }
        cur = name;
        const fb = await import(new URL('src/firebase.js', dir));
        const cloud = await import(new URL('src/lib/cloud.js', dir));
        const db = await import(new URL('src/lib/db.js', dir));
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
            tomb: gate(cloud.writeTombs, () => []),
            minutesPeek: gate(cloud.peekMinutes, () => null),
            untomb: gate(cloud.clearTombs, () => []),
        });
        await db.boot('');
        devices[name] = { db, cloud, fs };
    }
    const on = async (dev, fn) => { cur = dev; const out = await fn(devices[dev].db, devices[dev]); await wait(5); return out; };
    const sync = (dev) => on(dev, (db) => db.refreshFromCloud({ force: true }));
    const flush = (dev) => on(dev, (db) => db.flushCloud());
    const ids = (dev, b = 'todos') => devices[dev].db.snapshot()[b].map((t) => t.id).filter((i) => i.startsWith('mt-'));
    const cloudIds = async (b = 'todos') => (await getDocs(collection(admin(), 'users', UID, b))).docs.map((d) => d.id).filter((i) => i.startsWith('mt-'));
    const tombIds = async () => (await getDocs(collection(admin(), 'users', UID, 'tombs'))).docs.map((d) => d.id);
    /* Minutes.jsx 저장 흐름: registerMinutes(저장) → 노란 카드에서 빼기면 finishMinutesAsk. */
    const save = (dev, mid, text, { decline = false, prev = undefined } = {}) => on(dev, async (db) => {
        const r = await db.registerMinutes({ id: mid, title: '검사회의', date: '2026-11-20', text, prev: prev === undefined ? { text, date: '2026-11-20' } : prev });
        let declined = 0;
        if (decline && r.ask?.length) declined = await (await db.finishMinutesAsk(mid, r.ask, [])).declined;
        return { ...r, declined };
    });
    await on('A', (db) => db.setAuth({ uid: UID }));
    await on('B', (db) => db.setAuth({ uid: UID }));
    if (devices.C) await on('C', (db) => db.setAuth({ uid: UID }));
    await wait(50);
    const want = (k) => !only || only.includes(k);

    if (want('D1')) {
        /* D1: A 등록 → B 받음 → A 지움 → B 같은 회의록 다시 저장 → 되살아나지 않음 */
        const T = '할 일\n- 11/25까지 출결 서류 제출';
        const r = await save('A', 'meet-1000000000001', T, { prev: null });
        const id = r.ask?.length ? null : (await on('A', (db) => db.snapshot().todos.find((t) => t.title === '출결 서류 제출')))?.id;
        await flush('A'); await wait(1200); await sync('B');
        check(id && ids('B').includes(id), `D1 준비: B가 받지 못했습니다 ${id}`);
        await on('A', (db) => db.removeItem('todos', id)); await flush('A'); await wait(1200);
        await save('B', 'meet-1000000000001', T, { prev: null });
        await flush('B'); await wait(1200); await sync('A'); await sync('B');
        check(!(await cloudIds()).includes(id) && !ids('A').includes(id) && !ids('B').includes(id), 'D1 다른 기기에서 지운 할 일이 되살아납니다.');
    }
    if (want('OFF')) {
        /* OFF(r2 1번): A가 지운 뒤 B가 받기 전 오프라인으로 다시 저장 → 확인 못 하면 미룸 → 연결되면 확인 후 등록 안 함 */
        const T = '할 일\n- 11/30까지 방과후 명단 확인';
        const B2 = '할 일\n- 11/30까지 방과후 명단 확인\n- 12/1까지 급식 설문 회수';
        await save('A', 'meet-1000000000004', T, { prev: null }); await flush('A'); await wait(1200);
        const id = ids('A')[ids('A').length - 1];
        await on('A', (db) => db.removeItem('todos', id)); await flush('A'); await wait(1200);
        check(!ids('B').includes(id), 'OFF 준비: B가 이미 받았습니다.');
        offline.B = true;
        const r = await save('B', 'meet-1000000000004', B2, { prev: null });
        check(r.count === 0 && r.deferred === 2 && !ids('B').includes(id), `OFF 오프라인 저장이 확인 없이 등록합니다 ${JSON.stringify({ count: r.count, deferred: r.deferred })}`);
        offline.B = false;
        await sync('B'); await flush('B'); await wait(1200); await sync('A'); await sync('B');
        const fresh = devices.B.db.snapshot().todos.filter((t) => t.title === '급식 설문 회수').length;
        check(!ids('B').includes(id) && !ids('A').includes(id) && !(await cloudIds()).includes(id), 'OFF 오프라인에서 다시 저장하자 지운 할 일이 되살아납니다.');
        check(fresh === 1, `OFF 연결된 뒤 새 할 일을 등록하지 않습니다(${fresh}).`);
    }
    if (want('DECL')) {
        /* DECL: A 노란 카드 빼기 → 묘비 → B 다시 묻지 않음 */
        const T = '할 일\n- 보고서 정리';
        const a = await save('A', 'meet-1000000000005', T, { decline: true, prev: null });
        const b = await save('B', 'meet-1000000000005', T, { prev: null });
        check(a.ask.length === 1 && b.ask.length === 0, `DECL B가 다시 묻습니다 ${JSON.stringify([a.ask.length, b.ask.length])}`);
    }
    if (want('DECLOFF')) {
        /* DECL-OFF(r2 3번): A가 오프라인에서 빼기 → 대기열 → 연결되면 묘비 → B 다시 묻지 않음 */
        const T = '할 일\n- 협의록 공유';
        offline.A = true;
        const a = await save('A', 'meet-1000000000006', T, { decline: true, prev: null });
        check(a.ask.length === 1 && a.declined === 0, 'DECL-OFF 준비: 오프라인인데 묘비가 써졌습니다.');
        offline.A = false;
        await sync('A'); await wait(300);
        check((await tombIds()).some((t) => t === `todos-${a.ask[0]?.id}`), 'DECL-OFF 연결된 뒤 뺀 결정 묘비를 다시 쓰지 않습니다.');
        const b = await save('B', 'meet-1000000000006', T, { prev: null });
        check(b.ask.length === 0, 'DECL-OFF B가 다시 묻습니다.');
    }
    if (want('EV')) {
        /* EV(r2 2번): 일정 지움 → 묘비 → 다른 기기 다시 저장해도 되살아나지 않음 */
        const T = '- 11/24(화) 3교시 공개수업';
        await save('A', 'meet-1000000000007', T, { prev: null }); await flush('A'); await wait(1200); await sync('B');
        const e = ids('A', 'events')[0];
        check(e && ids('B', 'events').includes(e), 'EV 준비: 일정이 없습니다.');
        await on('A', (db) => db.removeItem('events', e)); await flush('A'); await wait(1200);
        check((await tombIds()).includes(`events-${e}`), 'EV 지운 일정의 묘비가 없습니다.');
        await save('B', 'meet-1000000000007', T, { prev: null }); await flush('B'); await wait(1200); await sync('A'); await sync('B');
        check(!ids('A', 'events').includes(e) && !ids('B', 'events').includes(e) && !(await cloudIds('events')).includes(e), 'EV 지운 일정이 되살아납니다.');
    }
    if (want('EVPRE')) {
        /* EVPRE(r3 F2): B가 받기 전에 A가 일정을 지움 → B는 로컬 기억이 없으니 클라우드 일정 묘비만으로 막아야 합니다. */
        const T = '- 11/26(목) 5교시 학년 협의회';
        await save('A', 'meet-1000000000009', T, { prev: null }); await flush('A'); await wait(1200);
        const e = ids('A', 'events').find((i) => i.includes('1000000000009')) || ids('A', 'events').slice(-1)[0];
        check(e && !ids('B', 'events').includes(e), 'EVPRE 준비: B가 이미 일정을 받았습니다.');
        await on('A', (db) => db.removeItem('events', e)); await flush('A'); await wait(1200);
        const b = await save('B', 'meet-1000000000009', T, { prev: null }); await flush('B'); await wait(1200); await sync('A'); await sync('B');
        check(b.count === 0 && !ids('B', 'events').includes(e) && !ids('A', 'events').includes(e) && !(await cloudIds('events')).includes(e), `EVPRE B가 받기 전에 지운 일정이 되살아납니다 (count=${b.count})`);
    }
    if (want('REV')) {
        /* REV(r3 F1): 12/10 → 12/11로 고쳤다가 다시 12/10으로 되돌리면 두 기기 모두 할 일이 남아야 합니다. */
        const v1 = '할 일\n- 12/10까지 학급문고 정리';
        const v2 = '할 일\n- 12/11까지 학급문고 정리';
        const list = (dev) => devices[dev].db.snapshot().todos.filter((t) => t.title === '학급문고 정리').map((t) => t.due);
        await save('A', 'meet-1000000000010', v1, { prev: null }); await flush('A'); await wait(1200); await sync('B');
        const first = devices.A.db.snapshot().todos.find((t) => t.title === '학급문고 정리')?.id;
        await save('A', 'meet-1000000000010', v2, { prev: { text: v1, date: '2026-11-20' } }); await flush('A'); await wait(1200); await sync('B');
        check(first && (await tombIds()).includes(`todos-${first}`), 'REV 준비: 고친 줄 정리 묘비가 없습니다.');
        const r = await save('A', 'meet-1000000000010', v1, { prev: { text: v2, date: '2026-11-20' } }); await flush('A'); await wait(1200);
        await sync('B'); await sync('A'); await flush('B'); await wait(600); await sync('A'); await sync('B');
        check(r.count === 1 && JSON.stringify(list('A')) === '["2026-12-10"]' && JSON.stringify(list('B')) === '["2026-12-10"]' && (await cloudIds()).includes(first),
            `REV 되돌린 할 일이 사라집니다 count=${r.count} A=${JSON.stringify(list('A'))} B=${JSON.stringify(list('B'))}`);
        check(!(await tombIds()).includes(`todos-${first}`), 'REV 되돌린 뒤에도 정리 묘비가 남아 있습니다.');
        /* 되돌린 뒤 사용자가 직접 지우면 다시는 살아나지 않습니다. */
        await on('A', (db) => db.removeItem('todos', first)); await flush('A'); await wait(1200); await sync('B');
        const again = await save('B', 'meet-1000000000010', v1, { prev: null });
        check(again.count === 0 && !ids('B').includes(first), 'REV 사용자가 지운 뒤 다른 기기 저장으로 되살아납니다.');
    }
    if (want('EDIT')) {
        /* EDIT(r2 4번): 줄을 고쳐 다시 저장 → 중복 없음(다른 기기 저장에서도), 사용자가 고친 항목은 남김 */
        const v1 = '할 일\n- 12/3까지 생활기록부 점검';
        const v2 = '할 일\n- 12/4까지 생활기록부 점검';
        await save('A', 'meet-1000000000008', v1, { prev: null }); await flush('A'); await wait(1200); await sync('B');
        await save('B', 'meet-1000000000008', v2, { prev: { text: v1, date: '2026-11-20' } }); await flush('B'); await wait(1200); await sync('A');
        const list = (dev) => devices[dev].db.snapshot().todos.filter((t) => t.title === '생활기록부 점검').map((t) => t.due);
        check(JSON.stringify(list('A')) === '["2026-12-04"]' && JSON.stringify(list('B')) === '["2026-12-04"]', `EDIT 고친 줄이 중복됩니다 A=${JSON.stringify(list('A'))} B=${JSON.stringify(list('B'))}`);
        const row = devices.A.db.snapshot().todos.find((t) => t.title === '생활기록부 점검');
        await on('A', (db) => db.saveTextItem('todos', { ...row, title: '생활기록부 점검(담임)' }));
        const v3 = '할 일\n- 12/5까지 생활기록부 점검';
        await save('A', 'meet-1000000000008', v3, { prev: { text: v2, date: '2026-11-20' } });
        check(devices.A.db.snapshot().todos.some((t) => t.title === '생활기록부 점검(담임)'), 'EDIT 사용자가 고친 할 일을 지웠습니다.');
    }
    if (want('RULES')) {
        /* 규칙: 일정 묘비(events-mt-)는 쓰고, 다른 이름·종류는 막습니다. */
        const me = env.authenticatedContext(UID).firestore();
        await assertSucceeds(setDoc(doc(me, 'users', UID, 'tombs', 'events-mt-abc-123'), { k: 'events', at: serverTimestamp() })).catch(() => check(false, '규칙: 일정 묘비를 쓰지 못합니다.'));
        /* #66(항목마다 나중에 고친 쪽이 이김) 뒤로는 모든 일정이 지운 기록을 남깁니다. 회의록 일정만의 규칙은 따로 없습니다. */
        await assertSucceeds(setDoc(doc(me, 'users', UID, 'tombs', 'events-e123'), { k: 'events', at: serverTimestamp() })).catch(() => check(false, '규칙: #66 일정 묘비(events-…)를 쓰지 못합니다.'));
        await assertFails(setDoc(doc(me, 'users', UID, 'tombs', 'meet-mt-abc'), { k: 'events', at: serverTimestamp() })).catch(() => check(false, '규칙: 이름이 틀린 묘비가 써집니다.'));
        await assertFails(setDoc(doc(me, 'users', UID, 'tombs', 'events-mt-abc'), { k: 'todos', at: serverTimestamp() })).catch(() => check(false, '규칙: 종류가 틀린 묘비가 써집니다.'));
        await assertFails(setDoc(doc(me, 'users', UID, 'tombs', 'events-mt-abc'), { k: 'events', at: serverTimestamp(), x: 1 })).catch(() => check(false, '규칙: 다른 칸이 든 묘비가 써집니다.'));
    }
    if (want('EXP')) {
        /* EXP: 묘비가 30일 뒤 정리돼도, 지운 걸 본 기기는 기억해 되살리지 않습니다. */
        await on('A', (db, d) => d.cloud.sweepTombs(UID, Date.now() + 31 * 24 * HOUR));
        const b = await save('B', 'meet-1000000000001', '할 일\n- 11/25까지 출결 서류 제출', { prev: null });
        check(b.count === 0, 'EXP 묘비 정리 뒤 B가 지운 할 일을 되살립니다.');
    }
    if (want('X2')) {
        /* X2(평점관 r4 P2-3): A가 회의록 할 일을 지움 → 31일 뒤 묘비 정리 → 새 기기 C가 같은 회의록을 다시 저장해도 되살아나지 않습니다.
           회의록 묘비(todos-mt-·events-mt-)는 정리에서 남기고, 보통 묘비는 그대로 정리합니다. */
        const T = '할 일\n- 11/28까지 수행평가 채점 입력';
        const ev = '- 11/27(금) 4교시 학년 공개수업';
        await save('A', 'meet-2000000000002', `${T}\n${ev}`, { prev: null }); await flush('A'); await wait(1200);
        const id = devices.A.db.snapshot().todos.find((t) => t.title === '수행평가 채점 입력')?.id;
        const e = ids('A', 'events').find((i) => i.includes('2000000000002'));
        await on('A', (db) => db.saveTextItem('todos', { id: 'todo-plain-x2', title: '보통 할 일', done: false, due: '', source: 'app' })); await flush('A'); await wait(800);
        await on('A', (db) => db.removeItem('todos', id));
        await on('A', (db) => db.removeItem('events', e));
        await on('A', (db) => db.removeItem('todos', 'todo-plain-x2')); await flush('A'); await wait(1200);
        check(id && e && (await tombIds()).includes(`todos-${id}`) && (await tombIds()).includes('todos-todo-plain-x2'), `X2 준비: 묘비가 없습니다 ${JSON.stringify(await tombIds())}`);
        const swept = await on('A', (db, d) => d.cloud.sweepTombs(UID, Date.now() + 31 * 24 * HOUR));
        const left = await tombIds();
        check(left.includes(`todos-${id}`) && left.includes(`events-${e}`), `X2 31일 정리가 회의록 묘비를 지웠습니다 ${JSON.stringify(left)}`);
        check(!left.includes('todos-todo-plain-x2') && swept >= 1, `X2 보통 묘비는 30일 뒤 정리돼야 합니다(swept=${swept}) ${JSON.stringify(left)}`);
        await sync('C');
        const c = await save('C', 'meet-2000000000002', `${T}\n${ev}`, { prev: null });
        await flush('C'); await wait(1200); await sync('A');
        const cloudT = await cloudIds();
        const cloudE = await cloudIds('events');
        check(c.count === 0 && !cloudT.includes(id) && !cloudE.includes(e) && !ids('C').includes(id) && !ids('A').includes(id),
            `X2 묘비 정리(31일) 뒤 새 기기 C가 회의록을 다시 저장하면 지운 할 일·일정이 되살아납니다 count=${c.count} cloud=${JSON.stringify([cloudT, cloudE])}`);
    }
    for (const d of Object.values(devices)) { try { await terminate(d.fs); } catch { /* 이미 닫힘 */ } }
    return failures;
}

const failures = [];
try {
    await env.clearFirestore();
    failures.push(...await run('base', null, null));
    const MUT = [
        ['D1', { file: 'cloud.js', from: 'out[id] = snaps.some((snap) => snap.exists());', to: 'out[id] = snaps.slice(0, 2).some((snap) => snap.exists());' }, ['D1', 'OFF']],
        ['D2', { file: 'cloud.js', from: "await timeout(setDoc(doc(ready.db, 'users', uid, 'tombs', tombId('todos', id)), { k: 'todos', at: serverTimestamp() }), 5000);", to: '' }, ['DECL']],
        ['E1', { file: 'cloud.js', from: 'const tomb = LWW_NAMES.includes(name) ?', to: "const tomb = (LWW_NAMES.includes(name) && name !== 'events') ?" }, ['EV']],
        ['O1', { file: 'db.js', from: "if (!out || typeof out !== 'object') return { known: new Set(), sure: false };", to: "if (!out || typeof out !== 'object') return { known: new Set(), sure: true };" }, ['OFF']],
        ['Q1', { file: 'db.js', from: '    queueMinutesTombs(ids);\n    return flushMinutesTombs();', to: '    return Promise.resolve(cloudApi.tomb(state.auth.uid, ids)).then((d) => d.length).catch(() => 0);' }, ['DECLOFF']],
        /* G1: 이 기기의 지움 기억(보조)을 끄고, 회의록 묘비 보존(주 장치, X1)도 끈 상태에서 EXP가 되살아나는지 봅니다. */
        ['G1', { file: 'syncMerge.js', from: "            if (localName === 'todos' || localName === 'events') noteMinutesGone([String(shaped.id)]);\n", to: '', more: [{ file: 'cloud.js', from: '                if (durableTomb(item.id)) continue;\n', to: '' }] }, ['D1', 'EXP']],
        ['E2', { file: 'cloud.js', from: ", ['tombs', tombId('events', id)]];", to: '];' }, ['EVPRE']],
        ['R1', { file: 'db.js', from: '    for (const item of items) if (mine.has(item.id)) check.known.delete(item.id);', to: '' }, ['REV']],
        ['R3', { file: 'db.js', from: "unnoteMinutesGone([item.id]);\n        if (!failed?.storageFailed) { n += 1; noteMinutesTidied([item.id]); }", to: "unnoteMinutesGone([item.id]);\n        if (!failed?.storageFailed) n += 1;" }, ['REV']],
        ['R4', { file: 'db.js', from: '    return ids.filter((id) => !mine.has(id));', to: '    return ids;' }, ['REV']],
        ['X1', { file: 'cloud.js', from: '                if (durableTomb(item.id)) continue;\n', to: '' }, ['X2']],
        ['X3', { file: 'cloud.js', from: 'export const DURABLE_TOMB = /^(?:todos|events)-mt-/;', to: 'export const DURABLE_TOMB = /^(?:todos|events)-/;' }, ['X2']],
        ['T1', { file: 'db.js', from: 'const tidied = await tidyEditedMinutes(id, prev, { text, date }, opts);', to: 'const tidied = 0;' }, ['EDIT']],
    ];
    let caught = 0;
    for (const [name, mutate, only] of MUT) {
        const got = await run(name, mutate, only);
        if (got.some((m) => m.includes('바꿀 코드를 찾지 못했습니다'))) failures.push(...got);
        else if (got.length) caught += 1;
        else failures.push(`변이 ${name} 이(가) 살아남았습니다.`);
    }
    if (!failures.length) console.log(`회의록 두 기기 검사 통과 · 변이 ${caught}/${MUT.length} 검출`);
} finally {
    await env.cleanup();
    rmSync(new URL(WORK, root), { recursive: true, force: true });
}
if (failures.length) {
    console.error(`회의록 두 기기 검사 실패 ${failures.length}건:\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
process.exit(0);
