/** 미리보기에서 고친 날짜·시각을 저장 전에 확인합니다. 이상한 날은 넣지 않습니다. */
import { isValidYmd, seoulYmd } from './date.js';
import { ymdFrom } from './monthGrid.js';

export function canonDate(value, today = '2026-11-15') {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return isValidYmd(text) ? text : '';
    const full = text.match(/^(\d{4})\s*[./]\s*(\d{1,2})\s*[./]\s*(\d{1,2})$/);
    if (full) return ymdFrom(Number(full[1]), Number(full[2]), Number(full[3]));
    const md = text.match(/^(\d{1,2})\s*[./]\s*(\d{1,2})$/);
    if (!md) return '';
    const month = Number(md[1]);
    const day = Number(md[2]);
    const year = Number(String(today).slice(0, 4));
    const ymd = ymdFrom(year, month, day);
    if (!ymd) return '';
    if (ymd < today) return ymdFrom(year + 1, month, day) || ymd;
    return ymd;
}

/** 빈 칸은 ''. 읽히면 'HH:MM'. 못 읽으면 null이라 원래 시각을 지우지 않습니다. */
export function canonClock(value) {
    const text = String(value || '').trim();
    if (!text) return '';
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return text;
    let ap = '';
    let rest = text;
    const lead = rest.match(/^(오전|오후|AM|PM)\s*/i);
    if (lead) {
        ap = lead[1];
        rest = rest.slice(lead[0].length);
    }
    const trail = rest.match(/\s*(AM|PM)$/i);
    if (trail) {
        ap = ap || trail[1];
        rest = rest.slice(0, trail.index);
    }
    rest = rest.replace(/\s+/g, '');
    const hm = rest.match(/^(\d{1,2})시(?:(\d{1,2})분|반)?$/) || rest.match(/^(\d{1,2})(?::([0-5]\d))?$/);
    if (!hm) return null;
    let hour = Number(hm[1]);
    let min = hm[2] ? Number(hm[2]) : (/반/.test(text) ? 30 : 0);
    const mark = ap.toUpperCase();
    if ((mark === '오후' || mark === 'PM') && hour < 12) hour += 12;
    else if ((mark === '오전' || mark === 'AM') && hour === 12) hour = 0;
    else if (!mark && hour >= 1 && hour <= 6 && /시/.test(text)) hour += 12;
    if (hour > 23 || min > 59 || hour < 0) return null;
    return `${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function normalizeCalendarItem(item, now = new Date()) {
    const today = seoulYmd(now);
    const dateText = String(item?.date || '').trim();
    const timeText = String(item?.time || '').trim();
    const endText = String(item?.endTime || '').trim();
    const date = canonDate(dateText, today);
    const end = canonDate(String(item?.end || '').trim(), today);
    const time = canonClock(timeText);
    const endTime = canonClock(endText);
    const errors = [];
    if (dateText && !date) errors.push('날짜를 읽지 못했어요');
    if (timeText && time == null) errors.push('시각을 읽지 못했어요');
    if (endText && endTime == null) errors.push('끝나는 시각을 읽지 못했어요');
    return {
        date: date || '',
        end: end && date && end > date ? end : '',
        time: time || '',
        endTime: endTime && time && endTime > time ? endTime : '',
        error: errors.join(' · '),
        ok: !errors.length && Boolean(date),
    };
}
