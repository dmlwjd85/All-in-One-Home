/** 평일·휴일 구분. 토·일, 법정 공휴일, 학사일정 휴업(일정 종류 휴일·휴업·방학). */
import { fromYmd, isValidYmd } from './date.js';
import { holidayCaption } from './holidays.js';
import { academicOffEvents } from './academic.js';

export function isWeekendYmd(ymd) {
    if (!isValidYmd(ymd)) return false;
    const day = fromYmd(ymd).getDay();
    return day === 0 || day === 6;
}

/** 수업이 없는 학사 일정인지. 방학식·제출 안내는 휴업이 아닙니다. */
export function isSchoolOffTitle(title, kind) {
    if (kind === '휴일') return true;
    const text = String(title || '');
    if (/휴업|휴교/.test(text)) return true;
    if (/방학/.test(text) && !/방학식|개학|계획|제출|신청|운영|돌봄/.test(text)) return true;
    return false;
}

export function schoolOffEvent(ymd, events) {
    if (!isValidYmd(ymd)) return null;
    for (const row of events || []) {
        if (!row?.date || !isValidYmd(row.date)) continue;
        const end = row.end && row.end >= row.date ? row.end : row.date;
        if (row.date <= ymd && ymd <= end && isSchoolOffTitle(row.title, row.kind)) return row;
    }
    return null;
}

/** 끝 글자에 받침이 없으면 ‘라’, 있으면 ‘이라’. 크리스마스는 ‘라’입니다. */
export function iraParticle(word) {
    const last = [...String(word || '')].pop() || '';
    const code = last.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return '이라';
    return (code - 0xac00) % 28 === 0 ? '라' : '이라';
}

export function restInfo(ymd, events) {
    const weekend = isWeekendYmd(ymd);
    const holiday = holidayCaption(ymd);
    const school = schoolOffEvent(ymd, [...(events || []), ...academicOffEvents()]);
    const publicOff = Boolean(holiday?.isHoliday);
    const off = weekend || publicOff || Boolean(school);
    if (!off) return { off: false, label: '', title: '', weekend: false };
    const label = (publicOff && holiday.primary?.name) || school?.title || '휴일';
    return {
        off: true,
        label,
        title: holiday?.title || label,
        weekend,
        holiday: publicOff,
        school: Boolean(school),
    };
}
