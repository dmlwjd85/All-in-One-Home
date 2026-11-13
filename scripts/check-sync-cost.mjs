/**
 * 동기화 비용 검사(패키지 없이): 가짜 클라우드로 받기 횟수와 컬렉션별 읽은 문서 수를 셉니다.
 * 1,000명 검수에서 교무실 PC를 하루 종일 켜 두면 5분마다 전체 받기로 교사 1명이 하루 약 15만 읽기를 쓴다는 지적을 막습니다.
 *  - 책상 PC 8시간(감시 살아 있음, 숨김 없이 창 focus 30번): 창 focus 로는 받지 않고, 시작 1번 + 2시간 안전망만 받습니다.
 *  - 같은 8시간에 페이지를 숨겼다가 다시 보기 30번: 30분 제한 안의 돌아옴만 받습니다.
 *  - 감시가 없으면(옛 규칙·가짜 클라우드) 15분마다 받기로 돌아가고, 감시가 죽으면(오류) 다시 주기 받기로 돌아갑니다.
 *  - 날짜가 바뀌면 한 번 받고, 오프라인에서 돌아오면 30분 안이라도 받습니다.
 *  - 감시 알림이 연달아 와도 받기가 묶이고, 바뀐 컬렉션만 받습니다. 이 기기가 아는 값(해시 같음)이면 받지 않습니다.
 *  - 일부 컬렉션만 받을 때 읽지 않은 컬렉션의 줄은 지워지지 않습니다(전체 받기에서만 지운 줄을 지움).
 *  - 서버 시각은 접속마다 한 번만 잽니다.
 */
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const cloud = await import('../src/lib/cloud.js');
const shape = await import('../src/lib/cloudShape.js');
const db = await import('../src/lib/db.js');
const { CLOUD_COLLECTIONS, LWW_NAMES, blankPull, pullScope, rowMark, watchChange } = cloud;

/* ── 가짜 클라우드: 교사 1명 문서 1,500개 ── */
const SIZES = { students: 30, attendance: 400, records: 300, events: 200, todos: 200, notes: 100, notices: 150, legacy: 20, inbox: 10, timetable: 20, tombs: 70 };
const pad = (n) => String(n).padStart(2, '0');
const dayOf = (i) => new Date(Date.UTC(2026, 2, 1) + i * 86400000).toISOString().slice(0, 10);
function seedRow(name, i) {
    if (name === 'students') return { id: `s${i}`, no: i + 1, name: `학생${i}`, active: true, source: 'app' };
    if (name === 'attendance') return { id: `${dayOf(i % 20)}_s${Math.floor(i / 20)}`, date: dayOf(i % 20), sid: `s${Math.floor(i / 20)}`, status: '결석', reason: '질병', period: '', paper: false, note: '', source: 'app' };
    if (name === 'records') return { id: `r${i}`, date: '2026-10-01', kind: '관찰', text: `발표를 잘했어요 ${i}`, tags: [], source: 'app' };
    if (name === 'events') return { id: `e${i}`, date: '2026-11-20', title: `학급 일정 ${i}`, kind: '학급', source: 'app' };
    if (name === 'todos') return { id: `t${i}`, title: `할 일 ${i}`, done: false, source: 'app' };
    if (name === 'notes') return { id: `n${i}`, text: `메모 ${i}`, tags: [], source: 'app' };
    if (name === 'notices') return { id: dayOf(i), date: dayOf(i), text: `알림장 ${i}`, source: 'app' };
    if (name === 'legacy') return { id: `p${i}`, kind: 'page', title: `옛 쪽 ${i}`, raw: { a: i }, source: 'legacy' };
    if (name === 'inbox') return { id: `i${i}`, kind: '할 일', title: `정리 ${i}`, source: 'app' };
    return null;
}
/* 클라우드에 둔 모양 그대로(올리고 다시 읽은 줄) */
const asCloud = (name, row) => { const s = shape.toCloudRow(name, row); return shape.fromCloudRow(name, s.id, s.body); };
const store = {};
const ats = {};
function seedStore() {
    for (const [, name] of CLOUD_COLLECTIONS) {
        store[name] = new Map();
        ats[name] = new Map();
        for (let i = 0; i < SIZES[name]; i += 1) {
            const row = asCloud(name, seedRow(name, i));
            store[name].set(String(shape.toCloudRow(name, row).id), row);
            ats[name].set(String(shape.toCloudRow(name, row).id), 1000);
        }
    }
    store.timetable = new Map();
    ats.timetable = new Map();
    const days = ['mon', 'tue', 'wed', 'thu', 'fri', ...Array.from({ length: SIZES.timetable - 5 }, (_, i) => dayOf(100 + i))];
    for (const id of days) { store.timetable.set(id, { p1: '국어', p2: `수학${id.length}` }); ats.timetable.set(id, 1000); }
    store.tombs = new Map();
    for (let i = 0; i < SIZES.tombs; i += 1) store.tombs.set(`todos-gone${i}`, { name: 'todos', id: `gone${i}`, at: 1000 });
}

let reads = 0;
const readsBy = {};
let pulls = { full: 0, part: 0, scopes: [] };
let clockCalls = 0;
let watchCalls = 0;
let watchMode = 'live';
let feed = null;
const count = (name, n) => { const k = Math.max(1, n); reads += k; readsBy[name] = (readsBy[name] || 0) + k; };
function resetCounts() { reads = 0; for (const k of Object.keys(readsBy)) delete readsBy[k]; pulls = { full: 0, part: 0, scopes: [] }; clockCalls = 0; }

const fake = {
    available: () => true,
    async push(uid, state, { hashes = {} } = {}) {
        const next = { ...hashes };
        for (const [localName, cloudName] of CLOUD_COLLECTIONS) {
            for (const row of state[localName] || []) {
                const m = rowMark(cloudName, row);
                if (!m || next[m.key] === m.mark) continue;
                const id = m.key.slice(cloudName.length + 1);
                store[cloudName].set(id, asCloud(cloudName, row));
                ats[cloudName].set(id, Number(row.editAt) > 0 ? Number(row.editAt) : 1000);
                next[m.key] = m.mark;
            }
        }
        return { ok: true, pending: 0, hashes: next, rejected: [], lost: [] };
    },
    async pull(uid, { only = null } = {}) {
        const scope = pullScope(only);
        const out = blankPull(scope);
        if (only) { pulls.part += 1; pulls.scopes.push([...scope].sort().join(',')); } else pulls.full += 1;
        if (scope.has('profile')) { count('profile', 1); out.profile = { className: '3반' }; }
        if (scope.has('settings')) count('settings', 4);
        for (const [localName, cloudName] of CLOUD_COLLECTIONS) {
            if (!scope.has(cloudName)) continue;
            count(cloudName, store[cloudName].size);
            out[localName] = [...store[cloudName].values()].map((row) => structuredClone(row));
            out.ids[cloudName] = [...store[cloudName].keys()];
            if (LWW_NAMES.includes(cloudName)) out.ats[cloudName] = Object.fromEntries(ats[cloudName]);
        }
        if (scope.has('tombs')) {
            count('tombs', store.tombs.size);
            for (const t of store.tombs.values()) out.tombs[t.name][t.id] = t.at;
        }
        if (scope.has('timetable')) {
            count('timetable', store.timetable.size);
            for (const [id, value] of store.timetable) { out.timetable[id] = { ...value }; out.ats.timetable[id] = ats.timetable.get(id); }
        }
        return out;
    },
    async remove(uid, name, id) { store[name]?.delete(String(id)); return { ok: true }; },
    peek: null,
    async clock() { clockCalls += 1; return 0; },
    sweep: null,
    async watch(uid, onChange, opts = {}) {
        watchCalls += 1;
        feed = { onChange, opts };
        if (watchMode === 'live') opts.onStatus?.({ live: true, error: '', at: 0 });
        if (watchMode === 'error') opts.onStatus?.({ live: false, error: 'permission-denied', at: 0 });
        const me = feed;
        return () => { if (feed === me) feed = null; };
    },
};

const plain = () => { const map = new Map(); return { get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };
db.useVaultsForTest(plain(), plain(), plain());
db.useCloudForTest(fake);
await db.boot('');

let T = Date.parse('2026-11-13T08:00:00+09:00');
db.useSyncClockForTest(() => T);
db.useDeviceClockForTest(() => T);
const UID = 'cost1';
const MIN = 60 * 1000;
const settle = async () => { for (let i = 0; i < 5; i += 1) await wait(0); };

async function login(at, mode) {
    await db.setAuth(null);
    watchMode = mode;
    T = at;
    resetCounts();
    await db.setAuth({ uid: UID });
    await settle();
}

/* ── 0) 받을지 정하는 순수 함수 ── */
{
    const { fullPullDue: due, PULL_RULES: R } = db;
    const base = { now: 10 * 3600 * 1000, lastFull: 10 * 3600 * 1000 - 5 * MIN, lastTry: 10 * 3600 * 1000 - 5 * MIN, today: '2026-11-13', lastFullDay: '2026-11-13' };
    check(R.staleMs === 30 * MIN && R.fallbackMs === 15 * MIN && R.minGapMs === MIN && R.safetyMs === 120 * MIN, `받기 간격 상수가 다릅니다: ${JSON.stringify(R)}`);
    check(due('start', base) && due('force', base) && due('lost', base), '시작·직접 누르기·진 줄에서 전체 받기를 하지 않습니다.');
    check(!due('timer', { ...base, watchLive: true, now: base.lastFull + 119 * MIN }), '감시가 살아 있는데 2시간 안에 타이머로 전체 받기를 합니다.');
    check(due('timer', { ...base, watchLive: true, now: base.lastFull + 120 * MIN }) && due('return', { ...base, watchLive: true, now: base.lastFull + 120 * MIN }), '감시가 살아 있어도 2시간 안전망으로 받아야 합니다.');
    check(!due('focus', { ...base, watchLive: true, now: base.lastFull + 90 * MIN }), '감시가 살아 있는데 창 focus 만으로 전체 받기를 합니다.');
    check(due('focus', { ...base, now: base.lastFull + 15 * MIN }), '감시가 없을 때 창 focus 를 세지 않습니다.');
    check(due('return', { ...base, watchLive: true, hiddenMs: 31 * MIN }), '30분 넘게 숨었다가 돌아왔는데 받지 않습니다.');
    check(!due('return', { ...base, watchLive: true }), '감시가 살아 있는데 5분 만에 돌아와도 전체 받기를 합니다.');
    check(due('return', { ...base, watchLive: true, now: base.lastFull + 31 * MIN }), '감시가 살아 있어도 30분 넘게 지나 돌아오면 받아야 합니다.');
    check(due('timer', { ...base, now: base.lastFull + 15 * MIN }) && !due('timer', { ...base, now: base.lastFull + 14 * MIN }), '감시가 없을 때 15분마다 받지 않습니다.');
    check(due('online', { ...base, watchLive: true, now: base.lastFull + 2 * MIN }), '오프라인에서 돌아오면 30분 안이라도 받아야 합니다.');
    check(!due('online', { ...base, watchLive: true, now: base.lastTry + 30 * 1000 }), '1분 안에 다시 전체 받기를 합니다.');
    check(due('timer', { ...base, watchLive: true, today: '2026-11-14' }), '날짜가 바뀌었는데 받지 않습니다.');
    check(due('return', { ...base, watchLive: true, lastFull: 0 }), '한 번도 다 받지 않았는데 받지 않습니다.');
    check(due('return', { ...base, watchLive: true, now: base.lastFull - 3 * 3600 * 1000, lastTry: 0 }), '기기 시계가 뒤로 가면 받아야 합니다(오래된 것으로 봄).');
}

seedStore();

/* ── 1) 책상 PC 8시간, 감시 살아 있음, 창 다시 보기 30번 ── */
const T0 = Date.parse('2026-11-13T08:00:00+09:00');
async function desk(mode, { breakAt = 0, back = 'focus' } = {}) {
    await login(T0, mode);
    for (let m = 1; m <= 480; m += 1) {
        T = T0 + m * MIN;
        if (breakAt && m === breakAt) { watchMode = 'error'; feed?.opts?.onStatus?.({ live: false, error: 'permission-denied', at: T }); }
        if (m % 5 === 0) await db.refreshFromCloud({ reason: 'timer' });
        if (m % 16 === 0) await db.refreshFromCloud(back === 'focus' ? { reason: 'focus' } : { reason: 'return', hiddenMs: 2 * MIN });
    }
    await settle();
    return { full: pulls.full, part: pulls.part, reads, by: { ...readsBy }, clock: clockCalls };
}
const live = await desk('live');
check(db.watchStateForTest().alive, '가짜 감시가 살아 있다고 알렸는데 db가 모릅니다.');
/* 시작 1번 + 2시간 안전망(2·4·6·8시간) 4번 */
check(live.full === 5, `감시가 살아 있는 책상 PC 8시간(창 focus 만) 전체 받기 수가 다릅니다(시작 1 + 2시간 안전망 4): ${live.full}`);
check(live.reads < 8000, `감시가 살아 있는 책상 PC 8시간 읽기가 많습니다: ${live.reads}`);
check(live.clock === 1, `서버 시각을 접속마다 한 번만 재지 않습니다: ${live.clock}번`);
/* ── 1b) 같은 8시간, 페이지를 숨겼다가(2분) 다시 보기 30번: 30분 제한 안의 돌아옴만 받습니다 ── */
const hidden = await desk('live', { back: 'return' });
check(hidden.full >= 14 && hidden.full <= 17, `숨었다가 돌아옴 30번의 전체 받기 수가 다릅니다(시작 1 + 30분 제한 돌아옴): ${hidden.full}`);

/* ── 2) 감시 없음(옛 규칙·끊김): 15분마다 받기로 돌아갑니다 ── */
const dead = await desk('dead');
/* 감시가 없으면 창 focus 도 셉니다(타이머와 함께 15분마다). */
check(dead.full >= 30 && dead.full <= 34, `감시가 없을 때 15분마다 받기로 돌아가지 않습니다: ${dead.full}`);

/* ── 3) 감시가 중간에 죽으면(오류) 다시 주기 받기, 감시도 다시 켜 봅니다 ── */
const callsBefore = watchCalls;
const broken = await desk('live', { breakAt: 240 });
/* 앞 4시간은 살아 있을 때와 같고(2시간 안전망), 뒤 4시간은 15분마다입니다(약 2번 → 16번). */
check(broken.full >= live.full + 12, `감시가 죽은 뒤 주기 받기로 돌아가지 않습니다: 살아 있을 때 ${live.full} / 죽은 뒤 ${broken.full}`);
const restarts = watchCalls - callsBefore - 1;
check(restarts >= 1 && restarts <= 6, `죽은 감시를 다시 켜 보는 횟수가 다릅니다(늘려 가며 다시 켬): ${restarts}`);

/* ── 4) 날짜가 바뀌면 한 번 받습니다 ── */
{
    await login(Date.parse('2026-11-13T23:40:00+09:00'), 'live');
    T = Date.parse('2026-11-13T23:55:00+09:00');
    await db.refreshFromCloud({ reason: 'timer' });
    const before = pulls.full;
    T = Date.parse('2026-11-14T00:05:00+09:00');
    await db.refreshFromCloud({ reason: 'timer' });
    const after = pulls.full;
    T = Date.parse('2026-11-14T00:10:00+09:00');
    await db.refreshFromCloud({ reason: 'timer' });
    check(before === 1 && after === 2 && pulls.full === 2, `날짜가 바뀔 때 한 번만 받지 않습니다: ${before} → ${after} → ${pulls.full}`);
}

/* ── 5) 오프라인에서 돌아오면 30분 안이라도 받습니다(1분 간격 안에서는 한 번) ── */
{
    await login(T0, 'live');
    T = T0 + 5 * MIN;
    await db.refreshFromCloud({ reason: 'online' });
    T = T0 + 5 * MIN + 20 * 1000;
    await db.refreshFromCloud({ reason: 'online' });
    check(pulls.full === 2, `오프라인에서 돌아올 때 받기가 다릅니다(시작 1 + 돌아옴 1): ${pulls.full}`);
}

/* ── 6) 감시 알림: 이 기기가 아는 값은 받지 않고, 연달아 와도 묶고, 바뀐 컬렉션만 받습니다 ── */
db.useWatchTimingForTest({ first: 5, gap: 40, burstGap: 400, burst: 3, burstWindow: 5000 });
{
    await login(T0, 'live');
    const mine = db.snapshot().todos.find((r) => r.id === 't1');
    const echo = rowMark('todos', mine);
    feed.onChange([
        { name: 'todos', id: 't1', mark: echo.mark },
        { name: 'records', id: 'r-none', removed: true },
        { name: 'tombs', id: 'todos-zz9', of: 'todos', rowId: 'zz9' },
    ]);
    await wait(120);
    check(pulls.part === 0 && pulls.full === 1, `이 기기가 아는 값(올린 해시와 같음)·없는 줄 알림에 받았습니다: ${JSON.stringify(pulls)}`);
    check(JSON.stringify(watchChange('todos', 't1', shape.toCloudRow('todos', mine).body)) === JSON.stringify({ name: 'todos', id: 't1', mark: echo.mark }), '감시 알림 줄의 표시가 올리기 해시와 다릅니다(되돌아온 알림을 거르지 못함).');
    for (let i = 0; i < 12; i += 1) { feed.onChange([{ name: 'todos', id: `t${i}`, mark: `x${i}` }]); await wait(10); }
    await wait(700);
    check(pulls.full === 1, `감시 알림으로 전체 받기를 했습니다: ${pulls.full}`);
    check(pulls.part >= 1 && pulls.part <= 5, `연달아 온 알림 12개가 묶이지 않았습니다: 일부 받기 ${pulls.part}번`);
    check(pulls.scopes.every((s) => s === 'todos,tombs'), `바뀐 컬렉션만 받지 않았습니다: ${pulls.scopes.join(' / ')}`);
    check(readsBy.records === SIZES.records && readsBy.todos === SIZES.todos * (1 + pulls.part), `일부 받기가 다른 컬렉션을 읽었습니다: ${JSON.stringify(readsBy)}`);
    /* 설정 문서 알림은 설정 문서만 받습니다. */
    const partBefore = pulls.part;
    feed.onChange([{ name: 'settings', id: 'device', mark: null }]);
    await wait(500);
    check(pulls.part === partBefore + 1 && pulls.scopes.at(-1) === 'settings', `설정 알림이 설정만 받지 않았습니다: ${pulls.scopes.at(-1)}`);
}

/* ── 7) 일부 받기는 읽지 않은 컬렉션의 줄을 지우지 않습니다 ── */
{
    await login(T0, 'live');
    db.useWatchTimingForTest({ first: 5, gap: 5, burstGap: 5, burst: 99, burstWindow: 5000 });
    const has = (name, id) => db.snapshot()[name].some((r) => String(r.id) === id);
    check(has('records', 'r5') && has('todos', 't5') && has('todos', 't6') && has('notices', dayOf(3)), '처음 받기에서 줄이 오지 않았습니다(검사 준비 틀림).');
    /* 다른 기기: 기록 r5·알림장 하나를 지우고, 할 일 t5를 지우고(묘비), t6을 고침 */
    store.records.delete('r5');
    store.notices.delete(dayOf(3));
    store.todos.delete('t5');
    store.tombs.set('todos-t5', { name: 'todos', id: 't5', at: 5000 });
    const t6 = asCloud('todos', { ...seedRow('todos', 6), title: '다른 기기에서 고친 할 일' });
    store.todos.set('t6', t6);
    ats.todos.set('t6', 5000);
    feed.onChange([watchChange('todos', 't6', shape.toCloudRow('todos', t6).body), { name: 'tombs', id: 'todos-t5', of: 'todos', rowId: 't5' }]);
    await wait(150);
    check(pulls.scopes.at(-1) === 'todos,tombs', `할 일 알림이 할 일만 받지 않았습니다: ${pulls.scopes.join(' / ')}`);
    check(db.snapshot().todos.find((r) => r.id === 't6')?.title === '다른 기기에서 고친 할 일', '일부 받기로 고친 할 일을 받지 못했습니다.');
    check(!has('todos', 't5'), '일부 받기에서 다른 기기가 지운 할 일(묘비)을 지우지 않았습니다.');
    check(has('records', 'r5') && has('notices', dayOf(3)), '일부 받기(할 일)가 읽지 않은 기록·알림장 줄을 지웠습니다.');
    check(db.snapshot().records.length === SIZES.records && db.snapshot().students.length === SIZES.students && db.snapshot().events.length === SIZES.events, '일부 받기가 읽지 않은 컬렉션의 줄 수를 바꿨습니다.');
    /* 기록이 지워진 알림(이 기기가 클라우드에 있다고 아는 줄)은 기록만 받아 지웁니다. */
    feed.onChange([{ name: 'records', id: 'r5', removed: true }]);
    await wait(150);
    check(pulls.scopes.at(-1) === 'records' && !has('records', 'r5') && has('notices', dayOf(3)), `지운 기록 알림이 기록만 받아 지우지 않았습니다: ${pulls.scopes.at(-1)} r5=${has('records', 'r5')}`);
    /* 전체 받기에서는 알림이 없던 알림장 삭제도 지웁니다. */
    await db.refreshFromCloud({ force: true });
    check(!has('notices', dayOf(3)), '전체 받기가 다른 기기에서 지운 알림장을 지우지 않았습니다.');
    /* 다음 검사를 위해 되돌립니다. */
    seedStore();
}

/* ── 8) 옛 모양 알림(인자 없음)은 전체 받기로 ── */
{
    await login(T0, 'live');
    db.useWatchTimingForTest({ first: 5, gap: 5 });
    feed.onChange();
    await wait(100);
    check(pulls.full === 2 && pulls.part === 0, `무엇이 바뀌었는지 모르는 알림을 전체 받기로 하지 않았습니다: ${JSON.stringify(pulls)}`);
}
db.useWatchTimingForTest();

await db.setAuth(null);
const fmt = (r) => `전체 ${r.full}번 + 일부 ${r.part}번, 읽기 ${r.reads.toLocaleString('en-US')}`;
console.log(`책상 PC 8시간(감시 살아 있음, 창 focus 30번): ${fmt(live)}`);
console.log(`책상 PC 8시간(감시 살아 있음, 숨김 뒤 돌아옴 30번): ${fmt(hidden)}`);
console.log(`책상 PC 8시간(감시 없음): ${fmt(dead)}`);
console.log(`책상 PC 8시간(4시간 뒤 감시 죽음): ${fmt(broken)}`);
if (failures.length) {
    console.error(`동기화 비용 검사 실패 ${failures.length}건\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log('check:sync-cost 통과');
