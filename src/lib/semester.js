/** 기본 시간표를 1학기·2학기·1년 수업일에 채우는 계산. 화면과 저장 없이 검사할 수 있게 순수 함수로 둡니다. */
import { addDaysYmd, dayKeyFromYmd, isValidYmd } from './date.js';
import { restInfo } from './daymark.js';

export const TERM_CHOICES = [
    { id: 'first', label: '1학기' },
    { id: 'second', label: '2학기' },
    { id: 'year', label: '1년' },
];

const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const MAX_PERIOD = 8;

/** 학년도 기본값. 학사일정에 개학·방학 일정이 있으면 그 날짜를 먼저 씁니다.
    1학기 3/2~7/24, 2학기 8/17~다음 해 2/12(겨울방학 일정이 있으면 그 전날까지). */
export function termRange(id, schoolYear = 2026, events = []) {
    const y = Number(schoolYear) || 2026;
    const found = findTermMarks(y, events);
    const first = { from: found.firstStart || `${y}-03-02`, to: found.firstEnd || `${y}-07-24` };
    const second = { from: found.secondStart || `${y}-08-17`, to: found.secondEnd || `${y + 1}-02-12` };
    const source = found.any ? '학사일정' : '기본값';
    if (id === 'first') return { ...first, source };
    if (id === 'second') return { ...second, source };
    return { from: first.from, to: second.to, source };
}

function findTermMarks(y, events) {
    const out = { any: false };
    for (const row of events || []) {
        const date = row?.date;
        if (!isValidYmd(date)) continue;
        const title = String(row.title || '');
        const month = Number(date.slice(5, 7));
        const year = Number(date.slice(0, 4));
        if (year === y && month === 3 && /개학|입학식|시업식/.test(title) && !out.firstStart) out.firstStart = date;
        if (year === y && (month === 7 || month === 8) && /여름\s*방학/.test(title) && !/방학식/.test(title) && !out.firstEnd) out.firstEnd = addDaysYmd(date, -1);
        if (year === y && (month === 7 || month === 8) && /방학식/.test(title) && !out.firstEnd) out.firstEnd = date;
        if (year === y && (month === 8 || month === 9) && /개학/.test(title) && !out.secondStart) out.secondStart = date;
        if (((year === y && month === 12) || (year === y + 1 && month <= 2)) && /겨울\s*방학|종업식|수료식/.test(title) && !out.secondEnd) {
            out.secondEnd = /종업식|수료식|방학식/.test(title) ? date : addDaysYmd(date, -1);
        }
    }
    out.any = Boolean(out.firstStart || out.firstEnd || out.secondStart || out.secondEnd);
    return out;
}

/** 범위 안 수업일. 토·일, 공휴일, 학사일정 휴업일(휴일·방학)은 뺍니다. */
export function schoolDays(from, to, events = []) {
    if (!isValidYmd(from) || !isValidYmd(to) || from > to) return [];
    const out = [];
    for (let day = from, guard = 0; day <= to && guard < 400; day = addDaysYmd(day, 1), guard += 1) {
        if (!WEEKDAYS.includes(dayKeyFromYmd(day))) continue;
        if (restInfo(day, events).off) continue;
        out.push(day);
    }
    return out;
}

function pickPeriods(row = {}) {
    const out = {};
    for (let n = 1; n <= MAX_PERIOD; n += 1) {
        if (row[`p${n}`]) out[`p${n}`] = row[`p${n}`];
        if (row[`s${n}`]) out[`s${n}`] = row[`s${n}`];
    }
    return out;
}

/** 채울 계획. 그날 고친 날(edited)은 keepEdited가 참이면 그대로 둡니다. */
export function planTermFill(timetable = {}, days = [], { edited = [], keepEdited = true } = {}) {
    const kept = [];
    const rows = {};
    for (const day of days) {
        if (keepEdited && edited.includes(day)) { kept.push(day); continue; }
        rows[day] = pickPeriods(timetable[dayKeyFromYmd(day)]);
    }
    return { rows, kept, filled: Object.keys(rows).length };
}

/** 그날 시간표. 날짜 줄이 있으면 그 줄, 없으면 요일 기본 시간표입니다. */
export function tableForDate(data, ymd) {
    const table = data?.timetable || {};
    const own = table[ymd];
    const edited = data?.profile?.ttEdited || [];
    if (own && (Object.keys(own).length || edited.includes(ymd))) return own;
    return table[dayKeyFromYmd(ymd)] || {};
}

/** 한 날짜에 기본 시간표가 들어가 있는지(날짜 줄이 있는지). */
export function hasDateRow(data, ymd) {
    return Boolean(data?.timetable?.[ymd]);
}

/** 그날 시간표 + 이 기기의 7~10교시(periodLocal.extra). 그날 따로 고친 칸이 이깁니다. */
export function tableForDateWithLocal(data, ymd, local) {
    const extra = local?.extra?.[dayKeyFromYmd(ymd)] || {};
    const own = data?.timetable?.[ymd];
    const edited = data?.profile?.ttEdited || [];
    if (own && (Object.keys(own).length || edited.includes(ymd))) return { ...extra, ...own };
    return { ...(data?.timetable?.[dayKeyFromYmd(ymd)] || {}), ...extra };
}
