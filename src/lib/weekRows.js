import { addDaysYmd, eventClock } from './date.js';
import { restInfo } from './daymark.js';

const DOW = ['월', '화', '수', '목', '금', '토', '일'];

export function eventEnd(row) {
    return row.end && row.end >= row.date ? row.end : row.date;
}

export function onDay(row, date) {
    return row.date <= date && date <= eventEnd(row);
}

/** 한 주를 요일 줄로 만듭니다. 토·일 둘 다 일정이 없으면 '주말' 한 줄로 접습니다. */
export function weekRows(weekStart, classEvents, week) {
    const rows = DOW.map((dow, index) => {
        const date = addDaysYmd(weekStart, index);
        const events = week.filter((row) => onDay(row, date)).sort((a, b) => String(eventClock(a) || '99').localeCompare(String(eventClock(b) || '99')));
        return { date, dow, short: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`, rest: restInfo(date, classEvents), events };
    });
    const [sat, sun] = rows.slice(5);
    if (sat.events.length || sun.events.length) return rows;
    const named = [sat.rest, sun.rest].map((rest) => (rest.label && rest.label !== '휴일' ? rest.label : '')).filter(Boolean);
    return [...rows.slice(0, 5), { fold: true, days: [sat, sun], label: `${sat.short}–${sun.short}`, restLabel: named.length ? `${[...new Set(named)].join('·')} · 일정 없음` : '' }];
}
