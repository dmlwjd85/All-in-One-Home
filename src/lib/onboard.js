/** 자료 저장·보호 안내 카드(G1, 시안 B)와 5분 시작 가이드 진행 상태.
    이 기기 키 ssug-gyomu-onboard 에만 둡니다. 클라우드에는 올리지 않습니다(규칙 변경 없음).
    공용 컴퓨터 모드에서는 메모리에만 두어, 새로 열 때마다 안내가 다시 펼쳐집니다. */

export const ONBOARD_KEY = 'ssug-gyomu-onboard';
const SHARED_KEY = 'ssug-gyomu-shared';

/** 5분 시작 가이드 단계. 순서가 곧 화면 순서입니다. */
export const GUIDE_STEPS = [
    { id: 'storage', title: '저장 방식 알아 두기', text: '어디에 남고 무엇이 이 기기에만 있는지 계정·백업 화면에서 봐요.', go: 'settings', label: '계정·백업 열기' },
    { id: 'attend', title: '출결 한 번 해 보기', text: '오늘 출결을 열어 결석·지각·조퇴한 친구만 눌러요. 누르지 않은 친구는 출석이에요.', go: 'attend', label: '출결 열기' },
    { id: 'jjaem', title: '쨈에 한 줄 발라 보기', text: '쨈 버튼을 눌러 “내일 3교시 과학실” 같은 한 줄을 적어요. 일정·할 일·기록으로 나눠 드려요.', go: 'jjaem', label: '쨈 열기' },
    { id: 'neis', title: '나이스 모아 보기', text: '학생마다 쌓인 기록을 모아 복사하고, 옮긴 것은 표시해 둬요.', go: 'neis', label: '나이스 모아 보기 열기' },
];

let memory = null;
const listeners = new Set();

function storage() {
    try {
        if (typeof localStorage === 'undefined') return null;
        if (localStorage.getItem(SHARED_KEY) === '1') return null;
        return localStorage;
    } catch {
        return null;
    }
}

export function emptyOnboard() {
    return { notice: 'open', auto: true, day: '', steps: {} };
}

const YMD = /^20\d\d-\d\d-\d\d$/;

/** notice: 'open'(펼침) | 'folded'(접힘) | 'hidden'(숨김). 처음엔 펼침입니다.
    auto: 처음 저절로 펼친 상태인지. 처음 본 날(day)이 지나면 저절로 접어 오늘 시간표가 첫 화면에 다시 올라오게 합니다.
    선생님이 직접 펼친 경우(auto=false)는 그대로 둡니다. */
export function normalizeOnboard(saved) {
    const base = emptyOnboard();
    if (!saved || typeof saved !== 'object') return base;
    const notice = ['open', 'folded', 'hidden'].includes(saved.notice) ? saved.notice : base.notice;
    const steps = {};
    for (const step of GUIDE_STEPS) if (saved.steps && saved.steps[step.id] === true) steps[step.id] = true;
    return { notice, auto: saved.auto !== false && notice === 'open', day: YMD.test(saved.day || '') ? saved.day : '', steps };
}

/** 오늘 보일 상태. 저절로 펼친 안내는 처음 본 날에만 펼칩니다. */
export function noticeFor(onboard, ymd, returning = false) {
    if (!onboard.day && onboard.auto && onboard.notice === 'open' && returning) return 'folded';
    if (onboard.notice === 'open' && onboard.auto && onboard.day && onboard.day !== ymd) return 'folded';
    return onboard.notice;
}

export function readOnboard(store = storage()) {
    try {
        const raw = store ? store.getItem(ONBOARD_KEY) : memory;
        return normalizeOnboard(raw ? JSON.parse(raw) : null);
    } catch {
        return emptyOnboard();
    }
}

function write(next, store = storage()) {
    const clean = normalizeOnboard(next);
    const raw = JSON.stringify(clean);
    try {
        if (store) store.setItem(ONBOARD_KEY, raw);
        else memory = raw;
    } catch {
        memory = raw;
    }
    listeners.forEach((fn) => fn(clean));
    return clean;
}

export function subscribeOnboard(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

/** 선생님이 직접 바꾼 상태입니다(저절로 접지 않습니다). */
export function setNotice(notice, store) {
    return write({ ...readOnboard(store), notice, auto: false }, store);
}

/** 이미 자료가 있던 선생님: 업데이트 첫날부터 접힌 채로 둡니다(한 번만 적습니다). */
export function foldForReturning(ymd, store) {
    const prev = readOnboard(store);
    if (prev.day || !YMD.test(ymd || '')) return prev;
    return write({ ...prev, notice: 'folded', auto: false, day: ymd }, store);
}

/** 처음 펼친 날을 적어 둡니다. 이미 적었으면 그대로입니다. */
export function markNoticeSeen(ymd, store) {
    const prev = readOnboard(store);
    if (prev.day || !YMD.test(ymd || '')) return prev;
    return write({ ...prev, day: ymd }, store);
}

export function setStep(id, done, store) {
    const prev = readOnboard(store);
    return write({ ...prev, steps: { ...prev.steps, [id]: Boolean(done) } }, store);
}

export function guideDone(onboard) {
    return GUIDE_STEPS.filter((step) => onboard.steps[step.id]).length;
}

/** 검사용: 메모리 값을 비웁니다. */
export function resetOnboardMemory() {
    memory = null;
}

/** 오늘 전에 적은 자료가 있으면(예시 학급 제외) 이미 쓰던 선생님으로 봅니다. */
export function isReturning(data, ymd) {
    if (!data || data.profile?.demo) return false;
    const buckets = ['attendance', 'records', 'events', 'todos', 'notes', 'notices'];
    const rows = buckets.flatMap((name) => [...(data[name] || []), ...(data.local?.[name] || [])]);
    return rows.some((row) => {
        const day = String(row?.date || row?.at || '').slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(day) && day < ymd;
    }) || Boolean(data.profile?.migratedAt);
}
