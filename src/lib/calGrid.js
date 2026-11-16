/**
 * 학교 월간 행사 달력(엑셀·팀즈 표)을 일정으로 나눕니다.
 * 한 칸의 '*' 항목은 각각 일정이고, '-->' 줄은 앞 항목의 보충입니다.
 * 원문자(①~⑳, ㉑~㉓)는 날짜로 보지 않고 글에 남깁니다.
 */
import { DEFAULT_PERIODS } from './period.js';
import { applyMonth, groupWeeks, inferYearMonth, keepTableEdges, parseTable, titledMonth, weekSlots, weekStartOf, ymdFrom } from './monthGrid.js';

const PLACE_RE = /(?:교실|운동장|체육관|강당|분교|교육|연수원|[실관원청장소초대집])$/;
const ROLE = /^(?:학교장|교감|교장|부장|학년부장)$/;
const AUDIENCE = /^(?:전교생|전교|학생|학부모)$/;

function pad(n) {
    return String(n).padStart(2, '0');
}

function hm(hour, min) {
    if (hour > 23 || min > 59 || hour < 0 || min < 0) return '';
    return `${pad(hour)}:${pad(min)}`;
}

function addMin(value, mins) {
    if (!value) return '';
    const total = Number(value.slice(0, 2)) * 60 + Number(value.slice(3, 5)) + mins;
    return hm(Math.floor(total / 60), total % 60);
}

function clockHour(hour, ap, { colon = false, zeroLed = false } = {}) {
    const mark = String(ap || '').toUpperCase();
    const pm = mark === '오후' || mark === 'PM';
    const am = mark === '오전' || mark === 'AM';
    let h = hour;
    if (pm && h < 12) h += 12;
    else if (am && h === 12) h = 0;
    else if (!am && !pm && !colon && !zeroLed && h >= 1 && h <= 6) h += 12;
    else if (!am && !pm && colon && !zeroLed && h >= 1 && h <= 6) h += 12;
    return h;
}

export function periodClock(from, to, periods = DEFAULT_PERIODS, lengths = []) {
    const startN = Math.min(from, to);
    const endN = Math.max(from, to);
    const a = periodBounds(startN, periods, lengths);
    const b = periodBounds(endN, periods, lengths);
    return { time: a.start, endTime: b.end && b.end > a.start ? b.end : '' };
}

function periodBounds(n, periods, lengths) {
    const start = periods[n - 1] || '';
    if (!start) return { start: '', end: '' };
    const len = Number(lengths?.[n - 1]) > 0 ? Number(lengths[n - 1]) : 40;
    return { start, end: addMin(start, len) };
}

/** '1~2교시', '2교시~3교시', '3교시' 를 찾습니다. 먼저 긴 꼴을 걷어 겹치지 않게 합니다. */
export function findPeriods(text) {
    const src = String(text || '');
    const found = [];
    const taken = (at, len) => found.some((row) => at < row.index + row.length && row.index < at + len);
    const patterns = [
        /(\d{1,2})\s*교시\s*[~～\-–—]\s*(\d{1,2})\s*교시/g,
        /(\d{1,2})\s*[~～\-–—]\s*(\d{1,2})\s*교시/g,
        /(?<!\d)(\d{1,2})\s*교시/g,
    ];
    for (const re of patterns) {
        for (const match of src.matchAll(re)) {
            if (taken(match.index, match[0].length)) continue;
            const a = Number(match[1]);
            const b = match[2] ? Number(match[2]) : a;
            if (a < 1 || a > 10 || b < 1 || b > 10) continue;
            found.push({ index: match.index, length: match[0].length, from: Math.min(a, b), to: Math.max(a, b) });
        }
    }
    return found.sort((a, b) => a.index - b.index);
}

const CLOCK = '(?:(오전|오후|AM|PM|am|pm)\\s*)?(\\d{1,2})\\s*(?::\\s*([0-5]\\d)|시(?:\\s*([0-5]?\\d)\\s*분|\\s*반)?)';

function side(ap, hourRaw, colonMin, minuteRaw, halfWord) {
    const colon = colonMin != null && colonMin !== '';
    const hour = Number(hourRaw);
    const min = colon ? Number(colonMin) : (halfWord ? 30 : (minuteRaw ? Number(minuteRaw) : 0));
    const zeroLed = colon && String(hourRaw).length === 2 && String(hourRaw)[0] === '0';
    return hm(clockHour(hour, ap, { colon, zeroLed }), min);
}

function withTrail(src, index, length, start, end) {
    const trail = /^\s*(AM|PM)\b/i.exec(src.slice(index + length));
    if (!trail) return { length, start, end };
    const pm = trail[1].toUpperCase() === 'PM';
    const fix = (hm) => {
        if (!hm) return hm;
        let hour = Number(hm.slice(0, 2));
        const min = hm.slice(3);
        if (pm && hour < 12) hour += 12;
        if (!pm && hour >= 12) hour -= 12;
        return `${String(hour).padStart(2, '0')}:${min}`;
    };
    return { length: length + trail[0].length, start: fix(start), end: fix(end) };
}

/** 시각·시각 범위·'11시 45경'·끝이 열린 '14:00~'. 원문자는 숫자가 아니라 여기 안 옵니다. */
export function findClocks(text) {
    const src = String(text || '');
    const found = [];
    const taken = (at, len) => found.some((row) => at < row.index + row.length && row.index < at + len);
    const enHour = (hourRaw, minuteRaw, ap) => {
        let hour = Number(hourRaw);
        const mark = String(ap || '').toUpperCase();
        if (mark === 'PM' && hour < 12) hour += 12;
        if (mark === 'AM' && hour === 12) hour = 0;
        return hm(hour, Number(minuteRaw));
    };
    for (const match of src.matchAll(/(\d{1,2}):([0-5]\d)\s*(AM|PM)\s*[-~～–—]\s*(\d{1,2}):([0-5]\d)\s*(AM|PM)/gi)) {
        const start = enHour(match[1], match[2], match[3]);
        const end = enHour(match[4], match[5], match[6]);
        if (!start) continue;
        found.push({ index: match.index, length: match[0].length, start, end: end && end > start ? end : '', approx: false, open: false });
    }
    const rangeRe = new RegExp(`${CLOCK}\\s*[~～\\-–—]\\s*${CLOCK}`, 'gi');
    for (const match of src.matchAll(rangeRe)) {
        const start = side(match[1], match[2], match[3], match[4], /반/.test(match[0].slice(0, match[0].search(/[~～\-–—]/))));
        const endSlice = match[0].slice(match[0].search(/[~～\-–—]/));
        const end = side(match[5], match[6], match[7], match[8], /반/.test(endSlice));
        if (!start) continue;
        const span = withTrail(src, match.index, match[0].length, start, end);
        found.push({ index: match.index, length: span.length, start: span.start, end: span.end, approx: false, open: false });
    }
    const openRe = new RegExp(`${CLOCK}\\s*[~～](?!\\s*(?:오전|오후|AM|PM|am|pm|\\d))`, 'gi');
    for (const match of src.matchAll(openRe)) {
        if (taken(match.index, match[0].length)) continue;
        const start = side(match[1], match[2], match[3], match[4], /반/.test(match[0]));
        if (!start) continue;
        const span = withTrail(src, match.index, match[0].length, start, '');
        found.push({ index: match.index, length: span.length, start: span.start, end: '', approx: false, open: true });
    }
    const aboutRe = /(?:(오전|오후|AM|PM|am|pm)\s*)?(\d{1,2})\s*시\s*(\d{1,2})\s*(?:분\s*)?경/gi;
    for (const match of src.matchAll(aboutRe)) {
        if (taken(match.index, match[0].length)) continue;
        const start = hm(clockHour(Number(match[2]), match[1], { colon: false }), Number(match[3]));
        if (!start) continue;
        found.push({ index: match.index, length: match[0].length, start, end: '', approx: true, open: false });
    }
    const oneRe = new RegExp(`(?<![\\d~～])${CLOCK}(?!\\s*[~～\\-–—])`, 'gi');
    for (const match of src.matchAll(oneRe)) {
        if (taken(match.index, match[0].length)) continue;
        const start = side(match[1], match[2], match[3], match[4], /반/.test(match[0]));
        if (!start) continue;
        const span = withTrail(src, match.index, match[0].length, start, '');
        found.push({ index: match.index, length: span.length, start: span.start, end: '', approx: false, open: false });
    }
    return found.sort((a, b) => a.index - b.index || b.length - a.length);
}

function isPlace(text) {
    const t = String(text || '').trim();
    if (!t || ROLE.test(t) || AUDIENCE.test(t)) return false;
    if (PLACE_RE.test(t)) return true;
    if (/[실관원청]/.test(t) && t.length <= 24) return true;
    return false;
}

function isPerson(text) {
    const t = String(text || '').trim();
    if (ROLE.test(t)) return true;
    if (AUDIENCE.test(t) || isPlace(t)) return false;
    return /^[가-힣]{2,5}$/.test(t);
}

function splitMeta(inner) {
    return String(inner || '').split(/\s*(?:\/\s+|[,，])\s*/).map((part) => part.trim()).filter(Boolean);
}

/** '교(원)장'처럼 낱말 안 짧은 괄호는 장소가 아닙니다. */
function tinyWordParen(inner) {
    return /^[가-힣A-Za-z]{1,2}$/.test(String(inner || '').trim());
}

function endDay(text) {
    const match = String(text || '').match(/~\s*(\d{1,2})\s*일/);
    if (!match) return 0;
    const day = Number(match[1]);
    return day >= 1 && day <= 31 ? day : 0;
}

function cutSpans(text, spans) {
    const ordered = [...spans].sort((a, b) => a.index - b.index);
    let out = '';
    let at = 0;
    for (const span of ordered) {
        if (span.index < at) continue;
        out += text.slice(at, span.index);
        at = span.index + span.length;
    }
    return (out + text.slice(at)).replace(/\s+/g, ' ').trim();
}

function hashKey(text) {
    let h = 0x811c9dc5;
    const src = String(text);
    for (let i = 0; i < src.length; i += 1) {
        h ^= src.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

export function eventId(date, title) {
    return `cal${hashKey(`${date}|${String(title || '').replace(/\s+/g, '')}`)}`.slice(0, 40);
}

export function sameEvent(a, b) {
    return String(a?.date || '') === String(b?.date || '') && String(a?.title || '').replace(/\s+/g, '') === String(b?.title || '').replace(/\s+/g, '');
}

/**
 * 칸 한 줄을 일정 하나로 읽습니다.
 * periods: 교시 시작 시각. lengths: 교시 길이(분). 없으면 40분.
 */
export function readSlot(body, { date = '', periods = DEFAULT_PERIODS, lengths = [] } = {}) {
    let src = String(body || '').replace(/^\*\s*/, '').trim();
    if (!src || /^메모\s*[:：]?$/.test(src)) return null;
    const noteBits = [];
    const people = [];
    const places = [];
    let endDayNum = endDay(src);
    const mealNotes = [];

    const brackets = [...src.matchAll(/\[([^[\]]{1,40})\]/g)];
    for (const bracket of brackets) noteBits.push(bracket[1].trim());
    const parens = [...src.matchAll(/[（(]([^()（）]{1,80})[)）]/g)];
    for (const paren of parens) {
        if (tinyWordParen(paren[1])) continue;
        const parts = splitMeta(paren[1]);
        const localClocks = [];
        for (const part of parts) {
            const dash = part.match(/^(.+?)\s*[-–—]\s*((?:오전|오후)?\s*\d{1,2}\s*(?:시|:)[\s\S]*)$/);
            const piece = dash || null;
            const placeSide = piece ? piece[1].trim() : '';
            const timeSide = piece ? piece[2] : part;
            if (placeSide && isPlace(placeSide)) places.push(placeSide);
            if (/^급식\s*[:：]/.test(part)) {
                const clocks = findClocks(part);
                if (clocks[0]) mealNotes.push(clocks[0].approx ? `급식 ${clocks[0].start}경` : `급식 ${clocks[0].start}`);
                continue;
            }
            if (endDay(part)) continue;
            const clocks = findClocks(timeSide);
            if (clocks.length) { localClocks.push(...clocks); continue; }
            if (isPerson(part)) people.push(part);
            else if (isPlace(part)) places.push(part);
            else if (AUDIENCE.test(part) || /학년|동행|전학/.test(part)) noteBits.push(part);
            else if (part && !/교시/.test(part)) noteBits.push(part);
        }
        if (!localClocks.length && !parts.some((part) => isPerson(part) || isPlace(part) || findClocks(part).length || endDay(part))) {
            noteBits.push(paren[1].trim());
        }
    }

    const clocks = findClocks(src).filter((row) => !/급식\s*[:：][^]{0,12}$/.test(src.slice(Math.max(0, row.index - 8), row.index)));
    const main = clocks.find((row) => !row.approx) || clocks[0] || null;
    const periodsFound = findPeriods(src);
    let time = main?.start || '';
    let endTime = main?.end || '';
    let period = 0;
    let periodEnd = 0;
    if (periodsFound.length) {
        period = Math.min(...periodsFound.map((row) => row.from));
        periodEnd = Math.max(...periodsFound.map((row) => row.to));
        if (!time) {
            const from = periodBounds(period, periods, lengths);
            const to = periodBounds(periodEnd, periods, lengths);
            time = from.start;
            endTime = to.end;
        }
    }
    if (period === periodEnd) periodEnd = 0;

    let title = src;
    let detail = '';
    const lead = title.match(/^([가-힣A-Za-z0-9·]{1,24})\)\s*(?=\d)/);
    if (lead) {
        detail = title.slice(lead[0].length).trim();
        title = lead[1];
    } else {
        const periodLead = title.match(/^(?:\d{1,2}\s*(?:[~～\-–—]\s*\d{1,2}\s*)?교시\s*[:：]\s*)+(.+)$/);
        if (periodLead) title = periodLead[1];
    }
    title = title.replace(/[（(]([가-힣A-Za-z]{1,2})[)）]/g, '⟨$1⟩');
    title = title.replace(/\[([^[\]]{1,40})\]/g, ' ');
    title = title.replace(/[（(][^()（）]*[)）]/g, ' ');
    title = cutSpans(title, [...findClocks(title), ...findPeriods(title)]);
    title = title.replace(/~\s*\d{1,2}\s*일/g, ' ');
    title = title.replace(/종일/g, ' ');
    title = title.replace(/[)）]/g, ' ');
    title = title.replace(/⟨([^⟩]+)⟩/g, '($1)');
    title = title.replace(/^[\s:*：\-–—./]+|[\s:*：\-–—./]+$/g, '').replace(/\s+/g, ' ').trim();
    if (!title) title = src.replace(/^\*\s*/, '').slice(0, 40);

    const assumedPm = Boolean(main && !/(오전|오후|AM|PM)/i.test(src.slice(main.index, main.index + main.length)) && Number(main.start.slice(0, 2)) >= 12 && Number(src.match(/(\d{1,2})\s*(?:시|:)/)?.[1] || 99) <= 6);
    if (detail) noteBits.unshift(detail.replace(/\[([^[\]]+)\]/g, '$1').replace(/\s+/g, ' ').trim());
    const bits = [...people.map((name) => `담당 ${name}`), ...places.map((name) => `장소 ${name}`), ...noteBits, ...mealNotes].map((bit) => String(bit || '').trim()).filter(Boolean);
    const memo = [...new Set(bits)].filter((bit, index, all) => !all.some((other, otherIndex) => otherIndex !== index && other.includes(bit) && other.length > bit.length)).join(' · ');
    let end = '';
    if (endDayNum && date) {
        const startDay = Number(date.slice(8, 10));
        const offset = endDayNum < startDay ? 1 : 0;
        end = ymdFrom(Number(date.slice(0, 4)), Number(date.slice(5, 7)), endDayNum, offset);
        if (end && end <= date) end = '';
    }
    return {
        title: title.slice(0, 60),
        date,
        end,
        time,
        endTime: endTime && endTime > time ? endTime : '',
        place: places[0] || '',
        person: people[0] || '',
        memo,
        period,
        periodEnd,
        allDay: Boolean(date) && !time,
        assumedPm,
        approx: Boolean(main?.approx),
        ask: false,
        warning: main?.approx ? '시각에 ‘경’이 있어 대략으로 봤어요.' : (assumedPm ? '오전·오후가 없어 오후로 봤어요.' : ''),
        include: true,
        eventKind: '학교',
        clipped: false,
    };
}

function cellItems(cell) {
    const lines = String(cell || '').split(/\n/).map((line) => line.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
        if (/^-->/.test(line) || /^—>/.test(line)) {
            const extra = line.replace(/^(?:-->|—>)\s*/, '').trim();
            if (extra && items.length) items[items.length - 1].extra = `${items[items.length - 1].extra ? `${items[items.length - 1].extra} · ` : ''}${extra}`;
            continue;
        }
        const onlyParen = line.replace(/^\*\s*/, '').trim();
        if (/^[（(]/.test(onlyParen) && items.length && !/\*/.test(line)) {
            items[items.length - 1].body = `${items[items.length - 1].body} ${onlyParen}`;
            continue;
        }
        items.push({ body: line.replace(/^\*\s*/, '').trim(), extra: '' });
    }
    return items.filter((item) => item.body);
}

export function looksLikeCalGrid(text) {
    const rows = parseTable(text);
    const weeks = groupWeeks(rows);
    if (weeks.length < 2) return false;
    const blob = String(text || '');
    const stars = (blob.match(/\*/g) || []).length;
    const meals = (blob.match(/\d(?:\.\d+){2,}/g) || []).length;
    if (meals > stars && meals >= 3) return false;
    return stars >= 1 || weeks.some((week) => (week.body || []).some((cell) => findClocks(cell).length || findPeriods(cell).length));
}

/**
 * @returns {{ year, month, score, events }}
 * events 의 day·offset 은 해·달을 바꿀 때 날짜를 다시 매기는 칸 정보입니다.
 */
export function parseCalGrid(text, { today = '2026-11-15', year = 0, month = 0, periods = DEFAULT_PERIODS, lengths = [] } = {}) {
    const src = keepTableEdges(text);
    const rows = parseTable(src);
    const weeks = groupWeeks(rows);
    const hint = titledMonth(src);
    const inferred = inferYearMonth(weeks, today, { weekStart: weekStartOf(rows), monthHint: month || hint.month, yearHint: year || hint.year });
    const y = year || inferred?.year || hint.year || Number(String(today).slice(0, 4));
    const m = month || inferred?.month || hint.month || Number(String(today).slice(5, 7));
    const events = [];
    for (const week of weeks) {
        const slots = applyMonth(weekSlots(week.header, { firstWeek: Boolean(week.firstWeek) }), y, m);
        for (const slot of slots) {
            if (!slot.date) continue;
            const cell = week.body?.[slot.col] || '';
            for (const item of cellItems(cell)) {
                const row = readSlot(item.body, { date: slot.date, periods, lengths });
                if (!row) continue;
                if (item.extra) row.memo = [row.memo, item.extra].filter(Boolean).join(' · ');
                row.day = slot.day;
                row.offset = slot.offset;
                row.id = eventId(row.date, row.title);
                row.raw = item.body;
                events.push(row);
            }
        }
    }
    return { year: y, month: m, score: inferred?.score || 0, events };
}

/** 미리보기에서 해·달을 바꾸면 날짜·끝나는 날·아이디만 다시 매깁니다. */
export function shiftCalEvents(events, year, month) {
    return (events || []).map((row) => {
        const date = row.day ? ymdFrom(year, month, row.day, row.offset || 0) : row.date;
        let end = '';
        if (row.end && row.date && date) {
            const span = Math.round((Date.parse(`${row.end}T00:00:00Z`) - Date.parse(`${row.date}T00:00:00Z`)) / 86400000);
            if (span > 0) end = ymdFrom(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)) + span, 0);
        }
        const next = { ...row, date, end };
        next.id = eventId(next.date, next.title);
        return next;
    });
}
