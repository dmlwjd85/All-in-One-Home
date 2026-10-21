import { addDaysYmd, isValidYmd, seoulYmd, startOfWeekMon, weekdayKo } from './date.js';
import { isSensitiveText } from './sensitive.js';

function pad(n) {
    return String(n).padStart(2, '0');
}

const WEEKDAY = { 일: 0, 월: 1, 화: 2, 수: 3, 목: 4, 금: 5, 토: 6 };

/** 날짜 뒤의 요일. 괄호나 '요일'이 있을 때만 붙입니다. '수학'의 '수'는 요일이 아닙니다. */
export const WEEK_TAIL = '(?:\\s*(?:[.(（]\\s*[월화수목금토일]\\s*(?:요일)?\\s*[)）]|[월화수목금토일]요일))?';
const WEEK_TAIL_CAP = '(?:\\s*(?:[.(（]\\s*([월화수목금토일])\\s*(?:요일)?\\s*[)）]|([월화수목금토일])요일))?';

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
    if (/다음|차주/.test(which)) ymd = addDaysYmd(ymd, 7);
    return ymd;
}

function pushSpan(spans, match, ymd, { explicit, weekday = '' }) {
    if (!ymd) return;
    const index = match.index;
    spans.push({
        index,
        length: match[0].length,
        ymd,
        explicit,
        weekday,
        warning: weekdayWarning(ymd, weekday),
    });
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
        const ymd = writtenYear ? ymdOf(writtenYear, month, day) : (isValidYmd(inferred) ? inferred : '');
        pushSpan(spans, match, ymd, { explicit: true, weekday: match[4] || match[5] || '' });
    });
    eachMatch(new RegExp(`(?<!\\d)(\\d{1,2})\\s*([./])\\s*(\\d{1,2})\\s*\\.?(?!\\s*월)${WEEK_TAIL_CAP}(?!\\d)`, 'g'), raw, (match) => {
        const month = Number(match[1]);
        const day = Number(match[3]);
        if (month < 1 || month > 12 || day < 1 || day > 31) return;
        const ymd = fixSchoolYear(month, day, today);
        pushSpan(spans, match, isValidYmd(ymd) ? ymd : '', { explicit: true, weekday: match[4] || match[5] || '' });
    });
    eachMatch(new RegExp(`(?<![\\d./월])(?<!박\\s*)(\\d{1,2})\\s*일${WEEK_TAIL_CAP}`, 'g'), raw, (match) => {
        const day = Number(match[1]);
        if (day < 1 || day > 31) return;
        pushSpan(spans, match, dayOnlyYmd(day, today), { explicit: true, weekday: match[2] || match[3] || '' });
    });
    eachMatch(/(이번\s*주|다음\s*주|이번주|다음주|금주|차주)\s*([월화수목금토일])요일/g, raw, (match) => {
        pushSpan(spans, match, weekYmd(match[1], match[2], today), { explicit: true, weekday: match[2] });
    });
    eachMatch(/(이번\s*주|다음\s*주|이번주|다음주|금주|차주)\s*안(?:으로|에)?/g, raw, (match) => {
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
    return kept;
}

/** 본문에서 날짜를 하나 고릅니다. 숫자로 적힌 날을 말보다 먼저 둡니다. */
export function detectDate(text, now = new Date()) {
    const found = findDates(text, now);
    const explicit = found.find((item) => item.explicit);
    return (explicit || found[0])?.ymd || null;
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
