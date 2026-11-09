/**
 * 할 일 성취(PR C): 중요도 3단계·정렬·하루 목표·달성 배지.
 * 화면과 저장소가 같이 쓰는 순수 함수만 둡니다(브라우저 없이 검사).
 *
 * 저장 모양
 *  - 할 일 줄: pri(1 낮음 · 2 보통 · 3 높음, 없으면 보통), doneOn('YYYY-MM-DD' 끝낸 날), doneHm('HH:MM' 끝낸 시각).
 *    체크를 풀면 doneOn·doneHm을 ''로 두어 클라우드 칸도 지웁니다. 옛 줄은 그대로 두고 한꺼번에 다시 쓰지 않습니다.
 *  - 목표: state.goals = { n: 하루 목표 개수(0은 끔), nAt: 목표를 고친 시각(ms), days: { [날짜]: { c, g, at } } }.
 *    c = 그때 끝낸 개수, g = 그때 목표. c >= g 이면 그 날 달성 배지가 보입니다. at = 고친 시각(ms).
 *    기기끼리는 날짜마다 at이 늦은 쪽이 이기고, 한쪽에만 있는 날짜는 합칩니다.
 */

export const PRIORITIES = [
    { id: 3, label: '높음', short: '높음' },
    { id: 2, label: '보통', short: '보통' },
    { id: 1, label: '낮음', short: '낮음' },
];
export const DEFAULT_GOAL = 3;
export const GOAL_CHOICES = [0, 1, 2, 3, 4, 5, 7, 10];
export const GOAL_MAX = 20;
export const DAYS_KEEP = 400;
export const SORT_KEY = 'ssug-gyomu-todo-sort';
export const SORTS = [
    { id: 'dday', label: 'D-day순' },
    { id: 'pri', label: '중요도순' },
];

const YMD = /^20[2-9]\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const HM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isYmd(v) { return typeof v === 'string' && YMD.test(v); }
export function isHm(v) { return typeof v === 'string' && HM.test(v); }

/** 1·2·3만 받습니다. 없거나 모르는 값은 보통(2). */
export function priOf(row) {
    const p = row?.pri;
    return p === 1 || p === 2 || p === 3 ? p : 2;
}
export function priLabel(p) {
    return (PRIORITIES.find((item) => item.id === p) || PRIORITIES[1]).label;
}
export function isPri(v) { return v === 1 || v === 2 || v === 3; }

/** 끝낸 날: 끝냄 상태이고 날짜가 맞을 때만. 옛 줄(끝낸 날 모름)은 ''. */
export function doneDayOf(row) {
    return row?.done && isYmd(row?.doneOn) ? row.doneOn : '';
}

/** 그 날 끝낸 서로 다른 할 일 개수. 같은 id가 두 목록(클라우드·이 기기)에 있으면 한 번만 셉니다. */
export function doneCount(rows, day) {
    const ids = new Set();
    for (const row of rows || []) if (row?.id != null && doneDayOf(row) === day) ids.add(String(row.id));
    return ids.size;
}

/** 오늘 목록(마감 없음·오늘·지난 마감)이 모두 끝났는지. 하나도 없으면 false. */
export function allDoneToday(rows, today) {
    const list = (rows || []).filter((row) => !row?.due || row.due <= today);
    return list.length > 0 && list.every((row) => row.done);
}

function dueKey(row) { return isYmd(row?.due) ? row.due : '9999-12-31'; }
function stable(a, b) {
    const oa = Number.isFinite(Number(a?.order)) ? Number(a.order) : Infinity;
    const ob = Number.isFinite(Number(b?.order)) ? Number(b.order) : Infinity;
    if (oa !== ob) return oa < ob ? -1 : 1;
    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}

/**
 * 정렬: 남은 할 일이 먼저, 끝낸 것은 뒤. 'dday'는 마감 빠른 순(마감 없음은 뒤) → 중요도 → 원래 순서.
 * 'pri'는 중요도 높은 순 → 마감 빠른 순 → 원래 순서. 같은 값은 순서가 흔들리지 않게 order·id로 정합니다.
 */
export function sortTodos(rows, mode = 'dday') {
    const list = [...(rows || [])];
    return list.sort((a, b) => {
        if (Boolean(a.done) !== Boolean(b.done)) return a.done ? 1 : -1;
        if (mode === 'pri') {
            const p = priOf(b) - priOf(a);
            if (p) return p;
            const d = dueKey(a).localeCompare(dueKey(b));
            if (d) return d;
        } else {
            const d = dueKey(a).localeCompare(dueKey(b));
            if (d) return d;
            const p = priOf(b) - priOf(a);
            if (p) return p;
        }
        return stable(a, b);
    });
}

export function normalizeSort(v) { return v === 'pri' ? 'pri' : 'dday'; }

/* ── 목표 ── */

export function cleanGoalN(v) {
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= GOAL_MAX ? n : DEFAULT_GOAL;
}

function cleanEntry(e) {
    if (!e || typeof e !== 'object') return null;
    const c = Number(e.c);
    const g = Number(e.g);
    const at = Number(e.at);
    if (!Number.isInteger(c) || c < 0 || c > 99) return null;
    if (!Number.isInteger(g) || g < 1 || g > GOAL_MAX) return null;
    if (!Number.isInteger(at) || at < 0 || at > 9999999999999) return null;
    return { c, g, at };
}

/** 저장된 목표 모양을 고칩니다. 망가진 날짜는 버리고, 오래된 날짜는 DAYS_KEEP개만 남깁니다. */
export function normalizeGoals(raw) {
    const n = raw && Object.prototype.hasOwnProperty.call(raw, 'n') ? cleanGoalN(raw.n) : DEFAULT_GOAL;
    const nAt = Number.isInteger(Number(raw?.nAt)) && Number(raw.nAt) > 0 ? Number(raw.nAt) : 0;
    const days = {};
    const src = raw?.days && typeof raw.days === 'object' ? raw.days : {};
    const keys = Object.keys(src).filter(isYmd).sort().slice(-DAYS_KEEP);
    for (const day of keys) {
        const e = cleanEntry(src[day]);
        if (e) days[day] = e;
    }
    return { n, nAt, days };
}

export function badgeOn(entry) {
    return Boolean(entry && entry.g > 0 && entry.c >= entry.g);
}

/** 두 기기의 목표를 합칩니다: 목표 개수는 늦게 고친 쪽, 날짜는 날짜마다 늦게 고친 쪽(같으면 달성 쪽), 한쪽에만 있으면 그대로. */
export function mergeGoals(mineRaw, theirsRaw) {
    const mine = normalizeGoals(mineRaw);
    if (!theirsRaw) return mine;
    const theirs = normalizeGoals(theirsRaw);
    const out = { n: mine.n, nAt: mine.nAt, days: { ...mine.days } };
    if (theirs.nAt > mine.nAt) { out.n = theirs.n; out.nAt = theirs.nAt; }
    for (const [day, e] of Object.entries(theirs.days)) {
        const cur = out.days[day];
        if (!cur || e.at > cur.at || (e.at === cur.at && badgeOn(e) && !badgeOn(cur))) out.days[day] = e;
    }
    return normalizeGoals(out);
}

export function sameGoals(a, b) {
    return encodeGoals(a) === encodeGoals(b) && normalizeGoals(a).n === normalizeGoals(b).n && normalizeGoals(a).nAt === normalizeGoals(b).nAt;
}

/** 날짜 기록을 글자 하나로: 'YYYY-MM-DD~c~g~at|…'. 규칙이 정규식 한 번으로 검사합니다. */
export function encodeGoals(raw) {
    const { days } = normalizeGoals(raw);
    return Object.keys(days).sort().map((day) => `${day}~${days[day].c}~${days[day].g}~${days[day].at}`).join('|');
}

export function decodeGoalDays(text) {
    const days = {};
    if (typeof text !== 'string' || !text) return days;
    for (const part of text.split('|')) {
        const m = /^(\d{4}-\d{2}-\d{2})~(\d{1,2})~(\d{1,2})~(\d{1,13})$/.exec(part);
        if (!m || !isYmd(m[1])) continue;
        const e = cleanEntry({ c: Number(m[2]), g: Number(m[3]), at: Number(m[4]) });
        if (e) days[m[1]] = e;
    }
    return days;
}

/** 클라우드 문서(settings/goal) 모양. 아무것도 고친 적 없으면 null(올리지 않음). */
export function toGoalDoc(raw) {
    const g = normalizeGoals(raw);
    if (!(g.nAt > 0) && !Object.keys(g.days).length) return null;
    return { n: g.n, nAt: g.nAt, days: encodeGoals(g) };
}

export function fromGoalDoc(data) {
    if (!data || typeof data !== 'object') return null;
    const n = Number(data.n);
    if (!Number.isInteger(n) || n < 0 || n > GOAL_MAX) return null;
    return normalizeGoals({ n, nAt: Number(data.nAt) || 0, days: decodeGoalDays(data.days) });
}

/**
 * 체크(또는 풀기) 뒤 그 날 기록을 맞춥니다.
 *  - 끝낸 개수가 목표에 닿았고 아직 배지가 없으면 기록합니다.
 *  - 체크를 풀어(unchecked=true) 목표 아래로 내려가면 배지를 지웁니다(c를 낮춘 기록으로 덮어 다른 기기에도 전해집니다).
 *  - 다른 기기에서 받아 온 할 일로 개수가 오른 경우에도(unchecked=false) 배지를 더하기만 합니다.
 * 바뀌었으면 { hit: 새로 달성, cleared: 배지 지움 } 을 돌려줍니다.
 */
export function settleGoalDay(goalsRaw, rows, day, at, { unchecked = false } = {}) {
    const goals = normalizeGoals(goalsRaw);
    if (!isYmd(day)) return { goals, hit: false, cleared: false };
    const c = Math.min(99, doneCount(rows, day));
    const cur = goals.days[day];
    if (badgeOn(cur)) {
        if (unchecked && c < cur.g) {
            goals.days[day] = { c, g: cur.g, at: Math.max(at, cur.at + 1) };
            return { goals, hit: false, cleared: true };
        }
        return { goals, hit: false, cleared: false };
    }
    if (goals.n > 0 && c >= goals.n) {
        goals.days[day] = { c, g: goals.n, at: Math.max(at, (cur?.at || 0) + 1) };
        return { goals: normalizeGoals(goals), hit: true, cleared: false };
    }
    return { goals, hit: false, cleared: false };
}
