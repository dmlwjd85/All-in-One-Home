import { addDaysYmd, fromYmd, isValidYmd, seoulYmd, startOfWeekMon, weekdayKo } from './date.js';
import { isSensitiveText } from './sensitive.js';

function pad(n) {
    return String(n).padStart(2, '0');
}

const WEEKDAY = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };
/** 다다음주가 다음주보다 앞에 있어야 '다다음주'를 한 주로 자르지 않습니다. 지난주·저번주도 다음주보다 앞에 둡니다. */
export const WEEK_MARK = '다다음\\s*주|다다음주|지난\\s*주|지난주|저번\\s*주|저번주|이번\\s*주|다음\\s*주|이번주|다음주|금주|차주';
const WEEKDAY_CLOCK = '(?:(?:오전|오후)\\s*)?(?:\\d{1,2}\\s*시(?!간)(?:\\s*\\d{1,2}\\s*분|\\s*반)?)?';

/** 날짜 뒤의 요일. 괄호나 '요일'이 있을 때만 붙입니다. '수학'의 '수'는 요일이 아닙니다. */
export const WEEK_TAIL = '(?:\\s*\\.?\\s*(?:[.(（]\\s*[월화수목금토일]\\s*(?:요일)?\\s*[)）]|[월화수목금토일]요일))?';
const WEEK_TAIL_CAP = '(?:\\s*\\.?\\s*(?:[.(（]\\s*([월화수목금토일])\\s*(?:요일)?\\s*[)）]|([월화수목금토일])요일))?';

function eachMatch(re, text, fn) {
    const copy = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
    let match = copy.exec(text);
    while (match) {
        fn(match);
        if (match.index === copy.lastIndex) copy.lastIndex += 1;
        match = copy.exec(text);
    }
}

function fixSchoolYear(month, day, today) {
    const year = Number(today.slice(0, 4));
    const thisMonth = Number(today.slice(5, 7));
    let y = year;
    if (thisMonth >= 3) y = month >= 3 ? year : year + 1;
    else y = month >= 3 ? year - 1 : year;
    return `${y}-${pad(month)}-${pad(day)}`;
}

function ymdOf(year, month, day) {
    const ymd = `${year}-${pad(month)}-${pad(day)}`;
    return isValidYmd(ymd) ? ymd : '';
}

/** 70 이상은 1900년대, 그 아래는 2000년대입니다. 27은 2027년입니다. */
function expandShortYear(yy) {
    const year = Number(yy);
    if (year >= 100) return year;
    return year >= 70 ? 1900 + year : 2000 + year;
}

function namedSchoolYear(raw, index) {
    const before = [...String(raw).slice(0, index).matchAll(/(\d{4})\s*학년도/g)];
    if (before.length) return Number(before[before.length - 1][1]);
    const after = String(raw).slice(index).match(/(\d{4})\s*학년도/);
    return after ? Number(after[1]) : 0;
}

/** 학년도는 3~12월이 그 해, 1~2월이 다음 해입니다. 요일이 적혀 있으면 요일이 맞는 해를 고릅니다. */
function schoolYearYmd(namedYear, month, day, weekday) {
    const primaryYear = month >= 3 ? namedYear : namedYear + 1;
    const primary = ymdOf(primaryYear, month, day);
    if (!weekday || !primary || weekdayKo(primary) === weekday) return primary;
    for (const year of [namedYear - 1, namedYear, namedYear + 1]) {
        if (year === primaryYear) continue;
        const ymd = ymdOf(year, month, day);
        if (ymd && weekdayKo(ymd) === weekday) return ymd;
    }
    return primary;
}

function addMonths(year, month, delta) {
    const total = year * 12 + (month - 1) + delta;
    return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

function monthShift(which) {
    return /다음|내달/.test(which) ? 1 : 0;
}

/** '11월 말', '3월 초', '11월 중순'을 그 달의 하루로 바꿉니다. */
function numberedMonthEdge(month, edge, today) {
    const probe = fixSchoolYear(month, 1, today);
    if (!probe) return '';
    const year = Number(probe.slice(0, 4));
    const last = new Date(year, month, 0).getDate();
    const day = edge === '초' ? 1 : edge === '중순' ? Math.min(15, last) : last;
    return ymdOf(year, month, day);
}

/** '이번 달 말', '다음 달 초', '중순', '월말'을 그 달의 하루로 바꿉니다. 중순은 15일입니다. */
function monthEdgeYmd(which, edge, today) {
    const shifted = addMonths(Number(today.slice(0, 4)), Number(today.slice(5, 7)), monthShift(which));
    const last = new Date(shifted.year, shifted.month, 0).getDate();
    const day = edge === '초' ? 1 : edge === '중순' ? Math.min(15, last) : last;
    return ymdOf(shifted.year, shifted.month, day);
}

function monthDayYmd(which, day, today) {
    const shifted = addMonths(Number(today.slice(0, 4)), Number(today.slice(5, 7)), monthShift(which));
    return ymdOf(shifted.year, shifted.month, day);
}

function prevMonthDayYmd(day, today) {
    const shifted = addMonths(Number(today.slice(0, 4)), Number(today.slice(5, 7)), -1);
    return ymdOf(shifted.year, shifted.month, day);
}

/** 일만 있으면 아직 안 지난 날이면 이번 달, 지났으면 다음 달입니다. */
function dayOnlyYmd(day, today) {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const todayDay = Number(today.slice(8, 10));
    let y = year;
    let m = month;
    if (day < todayDay) {
        m += 1;
        if (m > 12) {
            m = 1;
            y += 1;
        }
    }
    return ymdOf(y, m, day);
}

function weekYmd(which, weekdayName, today) {
    const target = WEEKDAY[weekdayName];
    if (target == null) return '';
    const offset = target === 0 ? 6 : target - 1;
    let ymd = addDaysYmd(startOfWeekMon(today), offset);
    if (/다다음/.test(which)) ymd = addDaysYmd(ymd, 14);
    else if (/지난|저번/.test(which)) ymd = addDaysYmd(ymd, -7);
    else if (/다음|차주/.test(which)) ymd = addDaysYmd(ymd, 7);
    return ymd;
}

/** '금요일까지'처럼 주 표시가 없는 요일은 오늘을 포함한 가장 가까운 그 요일입니다. */
function nearestWeekdayYmd(weekdayName, today) {
    const target = WEEKDAY[weekdayName];
    if (target == null) return '';
    const delta = (target - fromYmd(today).getDay() + 7) % 7;
    return addDaysYmd(today, delta);
}

function pushSpan(spans, match, ymd, { explicit, weekday = '', bare = false }) {
    if (!ymd) return;
    const index = match.index;
    spans.push({
        index,
        length: match[0].length,
        ymd,
        explicit,
        weekday,
        bare,
        warning: weekdayWarning(ymd, weekday),
    });
}

/** '12월 8일~10일'처럼 끝의 월이 빠지면 시작 달의 그 날입니다. 시작 날보다 앞이면 다음 달입니다. */
function inheritRangeMonth(spans, raw) {
    for (let i = 1; i < spans.length; i += 1) {
        const prev = spans[i - 1];
        const next = spans[i];
        if (!next.bare || !prev.ymd) continue;
        const between = raw.slice(prev.index + prev.length, next.index);
        if (!/^\s*[~～\-–—]\s*$/.test(between) && !/^\s*부터\s*$/.test(between)) continue;
        const day = Number(next.ymd.slice(8, 10));
        let year = Number(prev.ymd.slice(0, 4));
        let month = Number(prev.ymd.slice(5, 7));
        const startDay = Number(prev.ymd.slice(8, 10));
        if (day < startDay) {
            month += 1;
            if (month > 12) {
                month = 1;
                year += 1;
            }
        }
        const ymd = ymdOf(year, month, day);
        if (!ymd) continue;
        next.ymd = ymd;
        next.warning = weekdayWarning(ymd, next.weekday);
        next.bare = false;
    }
}

function pushRaw(spans, index, length, ymd, weekday = '') {
    if (!ymd || length <= 0) return;
    spans.push({
        index,
        length,
        ymd,
        explicit: true,
        weekday,
        bare: false,
        warning: weekdayWarning(ymd, weekday),
    });
}

/** '25~27일'은 이번 달의 두 날입니다. 끝 날이 더 앞이면 다음 달입니다. */
function sameMonthRangeYmd(startDay, endDay, today) {
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const start = ymdOf(year, month, startDay);
    let endMonth = month;
    let endYear = year;
    if (endDay < startDay) {
        endMonth += 1;
        if (endMonth > 12) {
            endMonth = 1;
            endYear += 1;
        }
    }
    return { start, end: ymdOf(endYear, endMonth, endDay) };
}

export function weekdayWarning(ymd, weekday) {
    if (!ymd || !weekday) return '';
    const actual = weekdayKo(ymd);
    if (actual === weekday) return '';
    const month = Number(ymd.slice(5, 7));
    const day = Number(ymd.slice(8, 10));
    return `${month}월 ${day}일은 ${actual}요일이에요. 글에는 ${weekday}요일이라고 적혀 있어요.`;
}

/** 글 안의 날짜를 나온 순서대로 모두 찾습니다. 겹치면 더 긴 표현을 남깁니다. */
export function findDates(text, now = new Date()) {
    const raw = String(text || '');
    const today = seoulYmd(now);
    const spans = [];
    eachMatch(new RegExp(`(\\d{4})\\s*[.\\-/]\\s*(\\d{1,2})\\s*[.\\-/]\\s*(\\d{1,2})${WEEK_TAIL_CAP}`, 'g'), raw, (match) => {
        pushSpan(spans, match, ymdOf(Number(match[1]), Number(match[2]), Number(match[3])), { explicit: true, weekday: match[4] || match[5] || '' });
    });
    eachMatch(new RegExp(`(?:(\\d{4})\\s*년\\s*)?(\\d{1,2})\\s*월\\s*(\\d{1,2})\\s*일${WEEK_TAIL_CAP}`, 'g'), raw, (match) => {
        const writtenYear = match[1] ? Number(match[1]) : 0;
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (month < 1 || month > 12 || day < 1 || day > 31) return;
        const inferred = fixSchoolYear(month, day, today);
        const weekday = match[4] || match[5] || '';
        const schoolNamed = writtenYear ? 0 : namedSchoolYear(raw, match.index);
        const school = schoolNamed ? schoolYearYmd(schoolNamed, month, day, weekday) : '';
        const ymd = writtenYear ? ymdOf(writtenYear, month, day) : (school || (isValidYmd(inferred) ? inferred : ''));
        pushSpan(spans, match, ymd, { explicit: true, weekday });
    });
    eachMatch(new RegExp(`(?<!\\d)(\\d{2})\\s*[./]\\s*(\\d{1,2})\\s*[./]\\s*(\\d{1,2})\\s*\\.?${WEEK_TAIL_CAP}(?!\\d)`, 'g'), raw, (match) => {
        const month = Number(match[2]);
        const day = Number(match[3]);
        if (month < 1 || month > 12 || day < 1 || day > 31) return;
        pushSpan(spans, match, ymdOf(expandShortYear(match[1]), month, day), { explicit: true, weekday: match[4] || match[5] || '' });
    });
    eachMatch(new RegExp(`(?<!\\d)(\\d{1,2})\\s*([./])\\s*(\\d{1,2})\\s*\\.?(?!\\s*월)(?!\\s*[./]\\s*\\d)${WEEK_TAIL_CAP}(?!\\d)`, 'g'), raw, (match) => {
        const month = Number(match[1]);
        const day = Number(match[3]);
        if (month < 1 || month > 12 || day < 1 || day > 31) return;
        const ymd = fixSchoolYear(month, day, today);
        pushSpan(spans, match, isValidYmd(ymd) ? ymd : '', { explicit: true, weekday: match[4] || match[5] || '' });
    });
    eachMatch(new RegExp(`(?<![가-힣])(이번\\s*달|이번달|이달|금월|다음\\s*달|다음달|내달)\\s*(\\d{1,2})\\s*일${WEEK_TAIL_CAP}`, 'g'), raw, (match) => {
        const day = Number(match[2]);
        if (day < 1 || day > 31) return;
        pushSpan(spans, match, monthDayYmd(match[1], day, today), { explicit: true, weekday: match[3] || match[4] || '' });
    });
    eachMatch(/(?<![가-힣])(이번\s*달|이번달|이달|금월|다음\s*달|다음달|내달)\s*(초|말일|말)/g, raw, (match) => {
        pushSpan(spans, match, monthEdgeYmd(match[1], match[2] === '말일' ? '말' : match[2], today), { explicit: true });
    });
    eachMatch(/(?<![가-힣])(이번\s*달|이번달|이달|금월|다음\s*달|다음달|내달)\s*마지막\s*날/g, raw, (match) => {
        pushSpan(spans, match, monthEdgeYmd(match[1], '말', today), { explicit: true });
    });
    eachMatch(/(?<![가-힣])(이번\s*달|이번달|이달|금월|다음\s*달|다음달|내달)\s*중으로/g, raw, (match) => {
        pushSpan(spans, match, monthEdgeYmd(match[1], '말', today), { explicit: true });
    });
    eachMatch(/(?<![가-힣])(이번\s*달|이번달|이달|금월|다음\s*달|다음달|내달)\s*중순/g, raw, (match) => {
        pushSpan(spans, match, monthEdgeYmd(match[1], '중순', today), { explicit: true });
    });
    eachMatch(/(?<![가-힣\d])월중순/g, raw, (match) => {
        pushSpan(spans, match, monthEdgeYmd('이번달', '중순', today), { explicit: true });
    });
    eachMatch(/(?<![가-힣\d])월(초|말일|말)/g, raw, (match) => {
        pushSpan(spans, match, monthEdgeYmd('이번달', match[1] === '말일' ? '말' : match[1], today), { explicit: true });
    });
    eachMatch(/(\d{1,2})\s*월\s*(초|중순|말일|말)(?!인)(?=\s*까지|(?![가-힣]))/g, raw, (match) => {
        const month = Number(match[1]);
        if (month < 1 || month > 12) return;
        const edge = match[2] === '말일' ? '말' : match[2];
        pushSpan(spans, match, numberedMonthEdge(month, edge, today), { explicit: true });
    });
    eachMatch(new RegExp(`(?<![\\d./월])(?<!박\\s*)(\\d{1,2})\\s*[~～\\-–—]\\s*(\\d{1,2})\\s*일${WEEK_TAIL_CAP}`, 'g'), raw, (match) => {
        const startDay = Number(match[1]);
        const endDay = Number(match[2]);
        if (startDay < 1 || startDay > 31 || endDay < 1 || endDay > 31) return;
        const range = sameMonthRangeYmd(startDay, endDay, today);
        const tilde = match[0].search(/[~～\-–—]/);
        const endAt = match.index + tilde + match[0].slice(tilde).search(/\d/);
        pushRaw(spans, match.index, match[1].length, range.start, '');
        pushRaw(spans, endAt, match.index + match[0].length - endAt, range.end, match[3] || match[4] || '');
    });
    eachMatch(new RegExp(`(${WEEK_MARK})\\s*([월화수목금토일])요일에서\\s*([월화수목금토일])요일`, 'g'), raw, (match) => {
        const second = `${match[3]}요일`;
        const at = match.index + match[0].lastIndexOf(second);
        pushRaw(spans, at, second.length, weekYmd(match[1], match[3], today), match[3]);
    });
    eachMatch(new RegExp(`(?<![\\d./월])(?<!박\\s*)(\\d{1,2})\\s*일${WEEK_TAIL_CAP}`, 'g'), raw, (match) => {
        const day = Number(match[1]);
        if (day < 1 || day > 31) return;
        pushSpan(spans, match, dayOnlyYmd(day, today), { explicit: true, weekday: match[2] || match[3] || '', bare: true });
    });
    eachMatch(/(?<![가-힣])지난\s*달\s*(\d{1,2})\s*일/g, raw, (match) => {
        const day = Number(match[1]);
        if (day < 1 || day > 31) return;
        pushSpan(spans, match, prevMonthDayYmd(day, today), { explicit: true });
    });
    eachMatch(new RegExp(`(${WEEK_MARK})\\s*([월화수목금토일])요일`, 'g'), raw, (match) => {
        pushSpan(spans, match, weekYmd(match[1], match[2], today), { explicit: true, weekday: match[2] });
    });
    eachMatch(/(?<![가-힣])(?:지난|저번)(?!\s*주)\s*([월화수목금토일])요일/g, raw, (match) => {
        pushSpan(spans, match, weekYmd('지난주', match[1], today), { explicit: true, weekday: match[1] });
    });
    eachMatch(new RegExp(`(?<![가-힣])([월화수목금토일])요일(?=\\s*${WEEKDAY_CLOCK}\\s*(?:까지|마감))`, 'g'), raw, (match) => {
        pushSpan(spans, match, nearestWeekdayYmd(match[1], today), { explicit: true, weekday: match[1] });
    });
    eachMatch(new RegExp(`(?<![가-힣])([월화수목금토일])요일(?=\\s*(?:에\\s*)?(?:오전|오후|\\d{1,2}\\s*시(?!간)))`, 'g'), raw, (match) => {
        pushSpan(spans, match, nearestWeekdayYmd(match[1], today), { explicit: true, weekday: match[1] });
    });
    eachMatch(/(?<!매주\s*)(?<!격주\s*)(?<![가-힣])([월화수목금토일])요일(?=\s*(?:에\s*)?\d\s*교시)/g, raw, (match) => {
        pushSpan(spans, match, nearestWeekdayYmd(match[1], today), { explicit: true, weekday: match[1] });
    });
    eachMatch(new RegExp(`(?<![가-힣\\d./])[(（]\\s*([월화수목금토일])\\s*(?:요일)?\\s*[)）](?=\\s*${WEEKDAY_CLOCK}\\s*까지)`, 'g'), raw, (match) => {
        pushSpan(spans, match, nearestWeekdayYmd(match[1], today), { explicit: true, weekday: match[1] });
    });
    eachMatch(new RegExp(`(${WEEK_MARK})\\s*안(?:으로|에)?`, 'g'), raw, (match) => {
        pushSpan(spans, match, weekYmd(match[1], '금', today), { explicit: true, weekday: '금' });
    });
    eachMatch(/글피|모레|내일|오늘/g, raw, (match) => {
        const add = match[0] === '글피' ? 3 : match[0] === '모레' ? 2 : match[0] === '내일' ? 1 : 0;
        pushSpan(spans, match, addDaysYmd(today, add), { explicit: false });
    });

    spans.sort((a, b) => a.index - b.index || b.length - a.length);
    const kept = [];
    for (const span of spans) {
        const prev = kept[kept.length - 1];
        if (prev && span.index < prev.index + prev.length) continue;
        kept.push(span);
    }
    inheritRangeMonth(kept, raw);
    return kept;
}

/** 본문에서 날짜를 하나 고릅니다. 숫자로 적힌 날을 말보다 먼저 둡니다. */
export function detectDate(text, now = new Date()) {
    const found = findDates(text, now);
    const explicit = found.find((item) => item.explicit);
    return (explicit || found[0])?.ymd || null;
}

function nextYearDate(raw, span, ymd, today) {
    const before = String(raw || '').slice(0, span?.index || 0);
    if (!/(?:내년|다음\s*해)(?:도|에는|에도|엔|에|는|은|의)?\s*$/.test(before)) return ymd;
    const target = `${Number(String(today).slice(0, 4)) + 1}${String(ymd).slice(4)}`;
    return isValidYmd(target) ? target : ymd;
}

/** '까지' 바로 앞의 날을 마감으로 둡니다. 내년·다음 해는 달력의 다음 해입니다. */
export function deadlineYmd(text, now = new Date()) {
    const raw = String(text || '');
    const today = seoulYmd(now);
    const found = findDates(raw, now);
    let span = null;
    for (const item of found) {
        if (/^\s*까지/.test(raw.slice(item.index + item.length))) span = item;
    }
    if (!span) return '';
    return nextYearDate(raw, span, span.ymd, today);
}

/** 할 일 한 줄. 마감이 있으면 그 날을 두고, 제목에서는 날짜와 내년을 뺍니다. */
export function readTodoLine(text, now = new Date(), fallbackDue = '') {
    const dueFound = deadlineYmd(text, now);
    const due = dueFound || fallbackDue;
    let title = String(text || '').trim();
    if (dueFound) {
        title = title
            .replace(/(?<![가-힣])(?:내년|다음\s*해)(?:도|에는|에도|엔|에|는|은|의)?\s*/g, ' ')
            .replace(/(?:\d{4}\s*년\s*)?\d{1,2}\s*월\s*\d{1,2}\s*일(?:\s*[.(（][^)）]{0,12}[)）])?\s*까지/g, ' ')
            .replace(/(?<!\d)\d{1,2}\s*[./]\s*\d{1,2}\s*까지/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();
    }
    return { title: (title || String(text || '').trim()).slice(0, 100), due };
}

export function parseNote(text, now = new Date()) {
    const raw = String(text || '');
    const tags = [...raw.matchAll(/#([0-9A-Za-z가-힣_]{1,12})/g)].map((m) => m[1]).slice(0, 10);
    const at = raw.match(/@(\d{1,2})/);
    const studentNo = at ? Number(at[1]) : null;
    const safeNo = studentNo >= 1 && studentNo <= 50 ? studentNo : null;
    return {
        tags,
        studentNo: safeNo,
        detectedDate: detectDate(raw, now),
        sensitive: isSensitiveText(raw, tags),
    };
}

export function stripTokens(text) {
    return String(text || '')
        .replace(/@[0-9]{1,2}/g, '')
        .replace(/#([0-9A-Za-z가-힣_]+)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
