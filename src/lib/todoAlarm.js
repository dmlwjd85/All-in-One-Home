/**
 * 할 일 알림(PR #60). 마감 날짜와 시각이 있는 할 일이 그 시각이 되면 앱 안 팝업·소리·(허락했다면) 브라우저 알림을 띄웁니다.
 * 앱(탭)이 열려 있을 때만 울립니다. 닫혀 있을 때의 한계는 docs/todo-alarm.md 에 적어 두었습니다.
 */
import { addDaysYmd, isValidYmd } from './date.js';

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FIRED_KEY = 'ssug-gyomu-todo-alarm-fired';

export function isTodoTime(v) {
    return TIME_RE.test(String(v || ''));
}

/** 같은 할 일이라도 날짜·시각을 고치면 다시 울리도록 날짜·시각까지 묶어 기억합니다. */
export function alarmKey(row) {
    return `${row.id}|${row.due}|${row.time}`;
}

/** 지금(ymd, hm) 울려야 할 할 일. 끝낸 일·이미 울린 일·오늘이 아닌 일은 뺍니다. */
export function dueAlarms(todos = [], ymd = '', hm = '', fired = {}) {
    if (!isValidYmd(ymd) || !isTodoTime(hm)) return [];
    return (todos || []).filter((row) => row && row.id && !row.done
        && row.due === ymd && isTodoTime(row.time) && row.time <= hm
        && !fired[alarmKey(row)]);
}

/** 시각이 몇 분 지났는지(같은 날). */
function lateMinutes(time, hm) {
    const m = (v) => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5));
    return m(hm) - m(time);
}

/** 이보다 늦게 알아챈 알림은 소리 없이 '놓친 알림'으로만 보여 줍니다. */
export const RING_WINDOW_MIN = 15;

/**
 * 울릴 것과 놓친 것을 나눕니다(PR #62 검수 6번).
 * 앱을 막 열었을 때(first) 이미 1분 넘게 지난 알림, 또는 15분 넘게 지난 알림은 한꺼번에 울리지 않고 놓친 알림으로 둡니다.
 */
export function splitAlarms(rows = [], hm = '', { first = false } = {}) {
    const ring = [];
    const missed = [];
    for (const row of rows) {
        const late = lateMinutes(row.time, hm);
        if (late <= (first ? 1 : RING_WINDOW_MIN)) ring.push(row);
        else missed.push(row);
    }
    return { ring, missed };
}

export function readFired(store = globalThis.localStorage) {
    try {
        const v = JSON.parse(store?.getItem(FIRED_KEY) || '{}');
        return v && typeof v === 'object' ? v : {};
    } catch {
        return {};
    }
}

/** 울린 표시를 남깁니다. 이틀 지난 표시는 지워 저장소가 커지지 않게 합니다. */
export function markFired(rows, ymd, store = globalThis.localStorage) {
    const fired = readFired(store);
    const keep = addDaysYmd(ymd, -2);
    for (const key of Object.keys(fired)) if (!(String(fired[key]) >= keep)) delete fired[key];
    for (const row of rows) fired[alarmKey(row)] = ymd;
    try { store?.setItem(FIRED_KEY, JSON.stringify(fired)); } catch { /* 저장소가 꽉 차도 알림은 띄웁니다. */ }
    return fired;
}

/** 고치기 화면의 날짜 칩. 드롭다운·스크롤 피커 대신 누르는 칸만 씁니다. */
export function dueChoices(today) {
    const day = new Date(`${today}T00:00:00Z`).getUTCDay();
    const toFri = (5 - day + 7) % 7;
    const toMon = ((1 - day + 7) % 7) || 7;
    const list = [
        ['오늘', today],
        ['내일', addDaysYmd(today, 1)],
        ['모레', addDaysYmd(today, 2)],
    ];
    if (toFri > 2) list.push(['이번 주 금', addDaysYmd(today, toFri)]);
    list.push(['다음 주 월', addDaysYmd(today, toMon)]);
    return list;
}

export const TIME_CHOICES = ['08:30', '09:00', '10:00', '12:30', '13:00', '14:30', '15:30', '16:00'];

/** 시각을 분 단위로 옮깁니다(하루 안에서만). */
export function shiftTime(hm, minutes) {
    const base = isTodoTime(hm) ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)) : 9 * 60;
    const next = Math.min(23 * 60 + 55, Math.max(0, base + minutes));
    return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}`;
}
