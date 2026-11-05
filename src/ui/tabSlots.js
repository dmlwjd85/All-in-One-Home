/** 하단 탭바(시안 A 말랑젤리) 칸 배치. 가운데 쨈 칸은 고정이고, 왼쪽 3칸·오른쪽 3칸만 바꿉니다.
    값은 이 기기 키 ssug-gyomu-tabbar 에 { order: [아이디 6개], at: 고친 시각(ms) } 로 둡니다(단축키·글꼴 키와 같은 규칙).
    로그인하면 users/{uid}/settings/tabbar 문서로 다른 기기와 같이 씁니다. at 이 더 늦은 쪽(나중에 고친 쪽)이 이깁니다.
    오프라인이거나 로그인하지 않았으면 이 기기에만 둡니다. */

export const TAB_KEY = 'ssug-gyomu-tabbar';
export const TAB_EVENT = 'ssug-gyomu-tabbar-changed';
export const SIDE_COUNT = 6;

/** [아이디, 라벨, 주소(비면 메뉴 열기)] */
export const TAB_POOL = [
    { id: 'today', label: '오늘', href: '#/today' },
    { id: 'todo', label: '할 일', href: '#/todo' },
    { id: 'attend', label: '출결', href: '#/attend' },
    { id: 'schedule', label: '일정', href: '#/schedule' },
    { id: 'students', label: '기록', href: '#/students' },
    { id: 'more', label: '더', href: '' },
    { id: 'minutes', label: '회의록', href: '#/minutes' },
    { id: 'notice', label: '알림장', href: '#/notice' },
    { id: 'neis', label: '나이스', href: '#/students/neis' },
    { id: 'settings', label: '설정', href: '#/settings' },
];

export const DEFAULT_ORDER = ['today', 'todo', 'attend', 'schedule', 'students', 'more'];

const byId = new Map(TAB_POOL.map((tab) => [tab.id, tab]));
export const tabById = (id) => byId.get(id) || null;

/** 모르는 아이디·겹친 아이디를 빼고, 모자란 칸은 기본 배치에서 채웁니다. '더'(메뉴)는 늘 한 칸 남깁니다. */
export function normalizeOrder(order) {
    const out = [];
    for (const id of Array.isArray(order) ? order : []) {
        if (byId.has(id) && !out.includes(id) && out.length < SIDE_COUNT) out.push(id);
    }
    for (const id of DEFAULT_ORDER) if (out.length < SIDE_COUNT && !out.includes(id)) out.push(id);
    if (!out.includes('more')) out[SIDE_COUNT - 1] = 'more';
    return out;
}

function liveStorage() {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

export function loadTabOrder(storage) {
    try {
        const raw = (storage || liveStorage())?.getItem?.(TAB_KEY);
        if (!raw) return [...DEFAULT_ORDER];
        return normalizeOrder(JSON.parse(raw)?.order);
    } catch {
        return [...DEFAULT_ORDER];
    }
}

/* 고친 시각은 서버 기준 시계로 찍습니다(db.js 가 serverNow 로 바꿔 끼웁니다). 기기 시계가 어긋나도 나중에 고친 쪽이 이기게. */
let tabClock = () => Date.now();
export function useTabClock(fn) { tabClock = typeof fn === 'function' ? fn : () => Date.now(); }

const listeners = new Set();
/** 이 기기에서 배치를 고치면 알립니다(클라우드 올리기용). 클라우드에서 받아 바꾼 것은 알리지 않습니다. */
export function subscribeTabOrder(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** 저장된 { order, at }. 저장값이 없거나 망가졌으면 at 0(한 번도 고치지 않음). */
export function tabState(storage) {
    try {
        const raw = (storage || liveStorage())?.getItem?.(TAB_KEY);
        const saved = raw ? JSON.parse(raw) : null;
        const at = Number(saved?.at);
        return { order: normalizeOrder(saved?.order), at: Number.isFinite(at) && at > 0 ? Math.round(at) : 0 };
    } catch {
        return { order: [...DEFAULT_ORDER], at: 0 };
    }
}

/** 클라우드 문서 모양 검사. 맞지 않으면 null. */
export function cleanTabbar(value) {
    if (!value || typeof value !== 'object' || !Array.isArray(value.order)) return null;
    const at = Number(value.at);
    if (!Number.isInteger(at) || at <= 0) return null;
    const order = normalizeOrder(value.order);
    return order.join() === value.order.join() ? { order, at } : null;
}

/** 클라우드 값이 이 기기 값보다 늦게 고친 것이면 받습니다. 받았으면 true. */
export function absorbTabbar(remote, storage) {
    const theirs = cleanTabbar(remote);
    if (!theirs || theirs.at <= tabState(storage).at) return false;
    saveTabOrder(theirs.order, storage, theirs.at, { fromCloud: true });
    return true;
}

export function saveTabOrder(order, storage, now, { fromCloud = false } = {}) {
    const clean = normalizeOrder(order);
    /* 같은 기기에서 연달아 고치면 시각이 거꾸로 가지 않게 직전보다 1ms 이상 늦게 찍습니다. */
    const at = now ?? Math.max(Math.round(tabClock()), tabState(storage).at + 1);
    try {
        (storage || liveStorage())?.setItem?.(TAB_KEY, JSON.stringify({ order: clean, at }));
    } catch { /* 저장이 막힌 브라우저에서는 이번 화면에서만 바뀝니다. */ }
    try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(TAB_EVENT));
    } catch { /* 창 없는 시험 */ }
    if (!fromCloud) for (const fn of listeners) { try { fn(); } catch { /* 듣는 쪽 오류는 저장을 막지 않습니다. */ } }
    return clean;
}

/** 칸 하나를 다른 탭으로 바꿉니다. 이미 다른 칸에 있던 탭이면 두 칸을 맞바꿉니다. */
export function pickTab(order, slot, id) {
    const next = normalizeOrder(order);
    if (!byId.has(id) || slot < 0 || slot >= SIDE_COUNT) return next;
    const from = next.indexOf(id);
    if (from >= 0) next[from] = next[slot];
    next[slot] = id;
    return normalizeOrder(next);
}

/** 칸을 옆으로 옮깁니다(dir: -1 왼쪽, 1 오른쪽). */
export function moveTab(order, slot, dir) {
    const next = normalizeOrder(order);
    const to = slot + dir;
    if (to < 0 || to >= SIDE_COUNT) return next;
    [next[slot], next[to]] = [next[to], next[slot]];
    return next;
}
