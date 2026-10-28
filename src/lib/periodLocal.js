/** 시간표 설정입니다. 로그인하면 users/{uid}/settings/device 로 다른 기기와 같이 씁니다(오늘 조퇴 시각은 빼고).
    9·10교시 과목, 교시 수, 수업 길이, 잠금, 출퇴근 시각, 오늘 조퇴 시각을 담습니다.
    공용 PC 모드에서는 메모리에만 둡니다. */
import { DEFAULT_PERIODS, EXTRA_PERIODS, LEVEL_LENGTH, MAX_PERIODS, isHm } from './period.js';

export const PERIOD_LOCAL_KEY = 'ssug-gyomu-period-local';
export const LEAVE_KEY = 'ssug-gyomu-leave-early';
const SHARED_KEY = 'ssug-gyomu-shared';

const listeners = new Set();
let memory = {};

function storage() {
    try {
        if (typeof localStorage === 'undefined') return null;
        if (localStorage.getItem(SHARED_KEY) === '1') return null;
        return localStorage;
    } catch {
        return null;
    }
}

function readJson(key) {
    const store = storage();
    try {
        const raw = store ? store.getItem(key) : memory[key];
        const value = raw ? JSON.parse(raw) : null;
        return value && typeof value === 'object' ? value : null;
    } catch {
        return null;
    }
}

function writeJson(key, value) {
    const raw = JSON.stringify(value);
    const store = storage();
    try {
        if (store) store.setItem(key, raw);
        else memory[key] = raw;
    } catch {
        memory[key] = raw;
    }
    listeners.forEach((fn) => fn());
}

export function subscribePeriodLocal(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function defaultPeriodLocal() {
    return { level: '초', count: 6, lengths: [], extraStarts: [...EXTRA_PERIODS], locks: [], cellLocks: [], workStart: '', workEnd: '', extra: {} };
}

export function readPeriodLocal() {
    const saved = readJson(PERIOD_LOCAL_KEY) || {};
    const base = defaultPeriodLocal();
    const count = Number(saved.count);
    return {
        ...base,
        ...saved,
        level: LEVEL_LENGTH[saved.level] ? saved.level : base.level,
        count: Number.isInteger(count) && count >= 1 && count <= MAX_PERIODS ? count : base.count,
        lengths: Array.isArray(saved.lengths) ? saved.lengths : [],
        extraStarts: Array.isArray(saved.extraStarts) ? saved.extraStarts : base.extraStarts,
        locks: Array.isArray(saved.locks) ? saved.locks : [],
        cellLocks: Array.isArray(saved.cellLocks) ? saved.cellLocks : [],
        workStart: isHm(saved.workStart) ? saved.workStart : '',
        workEnd: isHm(saved.workEnd) ? saved.workEnd : '',
        extra: saved.extra && typeof saved.extra === 'object' ? saved.extra : {},
    };
}

export function patchPeriodLocal(patch, { fromCloud = false } = {}) {
    /* syncAt: 다른 기기와 비교할 마지막 고친 시각. 클라우드에서 받은 값은 그 시각을 그대로 둡니다. */
    const next = { ...readPeriodLocal(), ...patch };
    if (!fromCloud) next.syncAt = Date.now();
    writeJson(PERIOD_LOCAL_KEY, next);
    return next;
}

/** 1~10교시 시작 시각. 8교시까지는 기존 profile.periodStarts 를 씁니다. */
export function allStarts(profileStarts, local = readPeriodLocal()) {
    const head = profileStarts?.length ? profileStarts : DEFAULT_PERIODS;
    const out = [];
    for (let i = 0; i < MAX_PERIODS; i += 1) {
        const value = i < 8 ? head[i] : local.extraStarts[i - 8];
        out.push(isHm(value) ? value : (i < 8 ? DEFAULT_PERIODS[i] : EXTRA_PERIODS[i - 8]));
    }
    return out;
}

/** 교시별 수업 길이(분). 고치지 않은 교시는 학교급 기본값입니다. */
export function allLengths(local = readPeriodLocal()) {
    const base = LEVEL_LENGTH[local.level] || 40;
    return Array.from({ length: MAX_PERIODS }, (_, i) => {
        const value = Number(local.lengths[i]);
        return value >= 10 && value <= 120 ? value : base;
    });
}

/** 9·10교시 과목을 더한 한 요일 줄. 1~8교시는 기존 시간표 그대로입니다. */
export function tableRow(timetable, day, local = readPeriodLocal()) {
    return { ...(timetable?.[day] || {}), ...(local.extra?.[day] || {}) };
}

export function setExtraPeriod(day, period, subject, specialist) {
    const local = readPeriodLocal();
    const row = { ...(local.extra[day] || {}) };
    if (subject != null) row[`p${period}`] = subject;
    if (specialist != null) row[`s${period}`] = specialist;
    return patchPeriodLocal({ extra: { ...local.extra, [day]: row } });
}

export function isLocked(local, day, period) {
    return local.locks.includes(period) || local.cellLocks.includes(`${day}-${period}`);
}

export function togglePeriodLock(period) {
    const local = readPeriodLocal();
    const locks = local.locks.includes(period) ? local.locks.filter((n) => n !== period) : [...local.locks, period].sort((a, b) => a - b);
    return patchPeriodLocal({ locks });
}

export function toggleCellLock(day, period) {
    const local = readPeriodLocal();
    const key = `${day}-${period}`;
    const cellLocks = local.cellLocks.includes(key) ? local.cellLocks.filter((item) => item !== key) : [...local.cellLocks, key];
    return patchPeriodLocal({ cellLocks });
}

/** 쓰는 교시 수. 교시 수를 적게 정했어도 과목이 들어 있는 교시까지는 숨기지 않습니다. */
export function usedCount(timetable, local = readPeriodLocal()) {
    let used = local.count;
    const days = new Set([...Object.keys(timetable || {}), ...Object.keys(local.extra || {})]);
    for (const day of days) {
        const row = tableRow(timetable, day, local);
        for (let n = used + 1; n <= MAX_PERIODS; n += 1) {
            if (row[`p${n}`]) used = n;
        }
    }
    return used;
}

/** 교시 수를 쓰는 교시 수로 올린 설정. 저장값은 바꾸지 않습니다. */
export function withUsedCount(timetable, local = readPeriodLocal()) {
    const count = usedCount(timetable, local);
    return count === local.count ? local : { ...local, count };
}

/** 오늘 수업이 있는 마지막 교시. 과목이 하나도 없으면 교시 수를 씁니다. */
export function lastPeriod(row, local, day) {
    let last = 0;
    for (let n = 1; n <= local.count; n += 1) {
        if (row[`p${n}`] && !isLocked(local, day, n)) last = n;
    }
    return last || local.count;
}

/** 시간 안내에서 건너뛸 교시. 잠긴 교시와, 과목이 하나라도 있는 날의 빈 교시입니다. */
export function skipPeriods(row, local, day) {
    const periods = Array.from({ length: local.count }, (_, i) => i + 1);
    const filled = periods.some((n) => row[`p${n}`]);
    return periods.filter((n) => isLocked(local, day, n) || (filled && !row[`p${n}`]));
}

/** 오늘만 쓰는 조퇴 시각. 날짜가 바뀌면 저절로 원래 퇴근 시각으로 돌아갑니다. */
export function leaveFor(ymd) {
    const saved = readJson(LEAVE_KEY) || {};
    return isHm(saved[ymd]) ? saved[ymd] : '';
}

export function setLeave(ymd, hm) {
    const next = {};
    if (isHm(hm)) next[ymd] = hm;
    writeJson(LEAVE_KEY, next);
}

export function clearPeriodLocal() {
    const store = storage();
    try {
        store?.removeItem(PERIOD_LOCAL_KEY);
        store?.removeItem(LEAVE_KEY);
    } catch {
        /* 지우지 못해도 화면은 동작합니다. */
    }
    memory = {};
    listeners.forEach((fn) => fn());
}
