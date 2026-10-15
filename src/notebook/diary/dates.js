import { seoulYmd } from '../../lib/utils.js';
import { holidayCaption } from '../../lib/holidays.js';
import { monthPage } from '../nav.js';
import { weekPageForYmd } from '../routes.js';

export const DOW = ['일', '월', '화', '수', '목', '금', '토'];

export const today = () => seoulYmd();

export function parts(ymd) {
    const [y, m, d] = String(ymd).split('-').map(Number);
    return { y, m, d };
}

export function toYmd(y, m, d) {
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.toISOString().slice(0, 10);
}

export function addDays(ymd, n) {
    const { y, m, d } = parts(ymd);
    return toYmd(y, m, d + n);
}

export function dow(ymd) {
    const { y, m, d } = parts(ymd);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** 월요일부터 일요일까지 7일 */
export function weekOf(ymd) {
    const start = addDays(ymd, -((dow(ymd) + 6) % 7));
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

/** 달력 칸: 월요일 시작, 6주 */
export function monthGrid(y, m) {
    const first = toYmd(y, m, 1);
    const start = addDays(first, -((dow(first) + 6) % 7));
    return Array.from({ length: 42 }, (_, i) => addDays(start, i));
}

export function shiftYm(y, m, delta) {
    const t = y * 12 + (m - 1) + delta;
    return { y: Math.floor(t / 12), m: (t % 12) + 1 };
}

/** 수첩에 있는 달(2026.3 ~ 2027.2)만 쪽이 있습니다. */
export function hasMonthPage(y, m) {
    return (y === 2026 && m >= 3) || (y === 2027 && m <= 2);
}

export function monthPageFor(y, m) {
    return hasMonthPage(y, m) ? monthPage(m, y) : null;
}

export function weekPageFor(ymd, pages) {
    return weekPageForYmd(ymd, pages);
}

export function holidayName(ymd) {
    const cap = holidayCaption(ymd);
    return cap?.primary?.kind === 'holiday' ? cap.primary.name : '';
}

export function noteDay(note) {
    if (note?.detectedDate) return note.detectedDate;
    const c = note?.createdAt;
    if (typeof c === 'string') return seoulYmd(new Date(c));
    if (c?.seconds) return seoulYmd(new Date(c.seconds * 1000));
    return '';
}

export function ymLabel(y, m) {
    return `${y}. ${m}`;
}
