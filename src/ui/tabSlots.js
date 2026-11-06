/** 하단 탭바(시안 A 말랑젤리) 칸 배치. 가운데 쨈 칸은 고정이고, 왼쪽 3칸·오른쪽 3칸만 바꿉니다.
    값은 이 기기 키 ssug-gyomu-tabbar 에 { order: [아이디 6개], at: 고친 시각(ms) } 로 둡니다(단축키·글꼴 키와 같은 규칙).
    클라우드 설정 문서는 firestore.rules 가 칸을 정해 두어 이번에는 올리지 않습니다. at 은 나중에 칸별 '늦게 고친 쪽' 합치기에 씁니다. */

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

/** 모르는 아이디·겹친 아이디를 빼고, 모자란 칸은 기본 배치에서 채웁니다.
    '더'(메뉴) 칸도 선생님이 다른 탭으로 바꿀 수 있어요. 빼더라도 맨 위 ≡ 메뉴 단추로 설정까지 모든 메뉴에 갈 수 있습니다. */
export function normalizeOrder(order) {
    const out = [];
    for (const id of Array.isArray(order) ? order : []) {
        if (byId.has(id) && !out.includes(id) && out.length < SIDE_COUNT) out.push(id);
    }
    for (const id of DEFAULT_ORDER) if (out.length < SIDE_COUNT && !out.includes(id)) out.push(id);
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

export function saveTabOrder(order, storage, now = Date.now()) {
    const clean = normalizeOrder(order);
    try {
        (storage || liveStorage())?.setItem?.(TAB_KEY, JSON.stringify({ order: clean, at: now }));
    } catch { /* 저장이 막힌 브라우저에서는 이번 화면에서만 바뀝니다. */ }
    try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(TAB_EVENT));
    } catch { /* 창 없는 시험 */ }
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
