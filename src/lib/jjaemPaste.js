/**
 * 시안 A: 쨈 발라두기/빠른 입력에서 날짜·시각 낱말을 칩·알람으로 옮깁니다.
 * 날짜 말은 파란 둥근 칩으로, 시각은 할 일·일정 알림으로 둡니다. 본문에서는 그 낱말을 뺍니다.
 * 기존 detectDate·findDates·dateChips 시각 규칙을 그대로 씁니다.
 */
import { findDates } from './parse.js';
import { addDaysYmd, isValidYmd, seoulYmd } from './date.js';

/* 날짜·시각 낱말 바로 뒤에 붙는 조사. 뒤에 한글이 이어지면(예: 「오늘도서관」) 조사로 보지 않습니다. */
const PARTICLE = '(?:(?:에는|에도|에서|에|엔|부터|까지는|까지|은|는|이|가|도|의|으로|로)(?![가-힣]))?';
/* 「N일」만 적힌 말은 뒤에 이 조사나 요일이 올 때만 날짜로 봅니다(「3일 동안」「2일째」는 날짜가 아님). */
const BARE_DAY_OK = /^(?:\s*(?:에는|에도|에서|에|엔|부터|까지는|까지|은|는|도|날|자)(?![가-힣])|\s*[(（.]?\s*[월화수목금토일]요일)/;
/* 날짜 뒤에 오면 기간·횟수라서 날짜가 아닌 말. */
const NOT_DATE_TAIL = /^\s*(?:동안|째|간|만에|만|전|후|뒤|씩|정도|가량|이상|이내|내내|넘게|남짓|치|짜리)/;
/* 할 일·일정에서 연도 없이 쓴 달·일이 이만큼보다 더 지났으면 내년으로 봅니다. 기록·메모는 지난 일을 적으므로 그대로 둡니다. */
const PAST_ROLL_DAYS = 60;
const WEEKDAYS = '일월화수목금토';

function pad(n) {
    return String(n).padStart(2, '0');
}

function particleLen(text, end) {
    const m = new RegExp(`^${PARTICLE}`).exec(String(text || '').slice(end));
    return m ? m[0].length : 0;
}

/** 알람 시각 글자. 「15:20」→「오후 3시 20분」, 「00:00」→「오전 12시」. */
export function alarmTimeLabel(hm) {
    const m = /^(\d{2}):(\d{2})$/.exec(String(hm || ''));
    if (!m) return '';
    const hour = Number(m[1]);
    const min = Number(m[2]);
    const ap = hour < 12 ? '오전' : '오후';
    const h12 = hour % 12 || 12;
    return min ? `${ap} ${h12}시 ${min}분` : `${ap} ${h12}시`;
}

/** 파란 둥근 칩 글자. 예: 「오늘 · 11월 5일」 */
export function jjaemDateChip(ymd, today = seoulYmd()) {
    if (!isValidYmd(ymd)) return null;
    const month = Number(ymd.slice(5, 7));
    const day = Number(ymd.slice(8, 10));
    const abs = `${month}월 ${day}일`;
    let rel = abs;
    if (ymd === today) rel = '오늘';
    else if (ymd === addDaysYmd(today, 1)) rel = '내일';
    else if (ymd === addDaysYmd(today, 2)) rel = '모레';
    else if (ymd === addDaysYmd(today, -1)) rel = '어제';
    return {
        ymd,
        day,
        month,
        abs,
        rel,
        label: rel === abs ? abs : `${rel} · ${abs}`,
    };
}

/* 한글로 쓴 시(「세 시」「열두시」). 긴 말부터 맞춥니다. */
const KO_HOURS = { 열한: 11, 열두: 12, 다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 한: 1, 두: 2, 세: 3, 네: 4, 열: 10 };
const KO_HOUR_RE = '열한|열두|다섯|여섯|일곱|여덟|아홉|한|두|세|네|열';
const AMPM = '(오전|오후|아침|저녁|밤|새벽|낮)';

/** 오전·오후 같은 앞말과 학교 습관(앞말 없는 1~6시는 오후)으로 24시간 시각을 정합니다. zeroLed: 「03:00」처럼 0을 앞에 쓴 시각은 그대로 둡니다. */
function clockHour(ap, hour, { zeroLed = false } = {}) {
    let h = hour;
    if ((ap === '저녁' || ap === '밤') && h === 12) h = 0;
    else if ((ap === '오후' || ap === '저녁' || ap === '밤') && h < 12) h += 12;
    else if (ap === '낮' && h >= 1 && h <= 6) h += 12;
    else if ((ap === '오전' || ap === '새벽') && h === 12) h = 0;
    if (!ap && !zeroLed && h >= 1 && h <= 6) h += 12;
    if (h === 24) h = 0;
    return h;
}

/*
 * 「점수 10:30」「3:2 비율」「12:10으로 이김」「요한 3:16 낭독」처럼 콜론이 점수·비율·성경 구절을 뜻하는 말은 시각이 아닙니다.
 * 낱말 경계를 지켜 「학급비 16:00」「성적 17:00까지」「경기 15:00 시작」「15:30 승진 심사」「14:00 점호」「14:00으로 지정」은 시각으로 둡니다.
 */
const SCORE_BEFORE = /(?<![가-힣])(?:점수|스코어|비율|배율|비|득점)(?:는|은|가|이|도|를|을)?\s*$/;
const SCORE_AFTER = /^\s*(?:(?:비율|배율|스코어)(?:로|으로|이|은|는|을|의|가)?(?=$|[^가-힣\s])|승(?![가-힣])|패(?![가-힣])|점으로|점\s*차|(?:으로|로)\s*(?:이기|이겼|이김|졌|짐|지고|승리|패배|비기|비겼|비김|나누|나눠|나눔|맞추|맞춰|섞))/;
/*
 * 성경 책 이름 바로 뒤의 「장:절」(「요한복음 3:16 읽기」「시편 23:1」)은 시각이 아닙니다. 실제 책 이름만 맞추고(「일기」「청소기」는 아님),
 * 사람 이름으로도 흔한 책(다니엘·요나·여호수아·사무엘 등)은 NAME_BOOKS로 따로 두고, 바로 뒤에 낭독·봉독·성경·말씀·절이 「한 낱말로」 올 때만 거릅니다(BIBLE_AFTER).
 * 그래서 「다니엘 3:30 상담」「여호수아 3:30 상담」「15:30 낭독회 리허설」「14:00 성경공부」「16:00 절 방문」은 시각입니다.
 */
const BIBLE_BOOKS = [
    '창세기', '출애굽기', '레위기', '민수기', '신명기', '사사기', '룻기', '사무엘상', '사무엘하', '열왕기상', '열왕기하',
    '역대상', '역대하', '욥기', '시편', '잠언', '전도서', '예레미야애가',
    '하박국', '말라기', '마태복음', '마가복음', '누가복음', '요한복음', '사도행전', '로마서', '고린도전서',
    '고린도후서', '갈라디아서', '에베소서', '빌립보서', '골로새서', '데살로니가전서', '데살로니가후서', '디모데전서', '디모데후서',
    '디도서', '빌레몬서', '히브리서', '야고보서', '베드로전서', '베드로후서', '요한일서', '요한이서', '요한삼서', '유다서', '요한계시록',
];
const BIBLE_BEFORE = new RegExp(`(?<![가-힣])(?:${BIBLE_BOOKS.join('|')})\\s*$`);
/* 사람 이름으로도 쓰는 책 이름(줄임 포함). 이 이름 + 장:절 + 낭독·봉독·성경·말씀·절 일 때만 성경 구절로 봅니다. */
const NAME_BOOKS = ['여호수아', '사무엘', '느헤미야', '이사야', '예레미야', '에스겔', '오바댜', '스바냐', '스가랴', '다니엘', '요나', '미가', '요엘', '에스더', '에스라', '아가', '나훔', '아모스', '호세아', '학개', '룻', '욥', '요한', '마태', '마가', '누가', '유다'];
const NAME_BOOK_BEFORE = new RegExp(`(?<![가-힣])(?:${NAME_BOOKS.join('|')})\\s*$`);
const BIBLE_CUE_AFTER = /^\s*(?:낭독|봉독|성경|말씀|절)(?![가-힣])/;
/*
 * 평점관 r4 P1: 책 이름 줄임(「마 5:13」「롬 8:28」「요 3:16」)도 장:절입니다. 낱말로도 흔한 말(수·전·아·사·나·학·말·스·느·에·단·신·시·출·민·미·약·대상 등)은 뺍니다.
 * 줄임 + 분이 00·30이 아닌 콜론, 사람 이름으로도 쓰는 책(요한·마태 등) + 5분 단위가 아닌 콜론(「요한 3:16 묵상」)은 시각이 아닙니다.
 * 「요한 3:30 상담」「요한 3:15 상담」처럼 5분 단위는 시각으로 둡니다. 「까지·부터·전·시작」이 뒤에 오면 언제나 시각입니다(TIME_CUE_AFTER).
 */
const ABBR_BOOKS = [
    '창', '레', '삿', '룻', '삼상', '삼하', '왕상', '왕하', '대하', '욥', '잠', '렘', '애', '겔', '호', '욜', '암', '옵', '욘',
    '합', '습', '슥', '마', '막', '눅', '요', '행', '롬', '고후', '갈', '엡', '빌', '골', '살전', '살후', '딤전', '딤후', '딛', '몬',
    '히', '벧전', '벧후', '요일', '요이', '요삼', '유', '계',
];
const ABBR_BOOK_BEFORE = new RegExp(`(?<![가-힣0-9])(?:${ABBR_BOOKS.join('|')})\\s*$`);
function bibleAfter(before, after) {
    return NAME_BOOK_BEFORE.test(before) && BIBLE_CUE_AFTER.test(after);
}
function bibleShort(before, minute) {
    const m = Number(minute);
    if (!minute || minute === '00') return false;
    if (ABBR_BOOK_BEFORE.test(before) && minute !== '30') return true;
    return NAME_BOOK_BEFORE.test(before) && m % 5 !== 0;
}
/* 콜론 시각 뒤에 마감·시작 말(까지·부터·전·이전·이후·에·시작·마감)이 오면 점수·성경 거르기보다 먼저 시각으로 봅니다(「점수 15:00까지 입력」). */
const TIME_CUE_AFTER = /^\s*(?:까지|부터|이전|이후|전(?![가-힣])|전에|전까지|에(?![가-힣])|시작|마감)/;
/* 「세트 3:15 남음」처럼 세트 뒤 남은 시간은 시각이 아닙니다. 정각·반(「무대 세트 16:00 정리」)은 시각으로 둡니다. */
const SET_BEFORE = /(?<![가-힣])세트(?:는|가)?\s*$/;
function notClockColon(text, start, end) {
    const before = text.slice(Math.max(0, start - 12), start);
    const after = text.slice(end);
    if (TIME_CUE_AFTER.test(after)) return false;
    const minute = /:(\d{2})/.exec(text.slice(start, end))?.[1] || '';
    /* 분이 00이면(「시편 15:00 낭송」) 성경 장:절로 보지 않습니다. */
    const bible = minute !== '00' && (BIBLE_BEFORE.test(before) || bibleAfter(before, after) || bibleShort(before, minute));
    const setLeft = SET_BEFORE.test(before) && minute !== '00' && minute !== '30';
    return SCORE_BEFORE.test(before.slice(-8)) || bible || setLeft || SCORE_AFTER.test(after);
}

/* 「13:00시」「12:30분」처럼 콜론 시각 뒤에 덧붙인 시·분은 시각과 함께 뺍니다. */
const COLON_UNIT = '(?:\\s*(?:시|분)(?=$|[^가-힣]|에|까지|부터|엔|전|쯤))?';
/* 「오전 12시」는 낮 12시로 쓰는 사람과 밤 12시로 쓰는 사람이 갈려, 00:00으로 읽되 ask로 노란 카드에서 다시 묻습니다. */
const am12 = (ap, hour) => (ap === '오전' && hour === 12 ? { ask: 'am12' } : {});

/* 범위 이음표: 10:30~11:20, 2시-3시 */
const DASH = '\\s*[~～\\-–—]\\s*';

/**
 * 본문에서 시계 시각을 찾습니다. 학교 습관으로 앞말 없는 1~6시는 오후로 둡니다.
 * 읽는 꼴: 「3시」「3시 반」「3시 20분」「15시」「세 시」「오후 세시」「15:30」「오전 10:30」「오후 3:05」「정오」「자정」.
 * 「저녁·밤 12시」와 「24시」는 자정(00:00)입니다. 「오후 12시」는 낮 12시입니다. 「3시 방향」은 시각이 아닙니다.
 * 「자정까지·자정 전」은 그날 끝(23:59)으로 봅니다. 「2:1」처럼 분이 두 자리가 아니면 시각이 아닙니다.
 */
export function findTimeSpans(raw) {
    /* 전각 콜론(15：30)은 같은 길이의 반각으로 바꿔 읽습니다(자리 번호는 그대로). */
    const text = String(raw || '').replace(/：/g, ':');
    const spans = [];
    const push = (index, word, hour, min, extra = {}) => {
        if (spans.some((o) => index < o.index + o.length && o.index < index + word.length)) return;
        const length = word.length + particleLen(text, index + word.length);
        spans.push({ index, length, time: `${pad(hour)}:${pad(min)}`, word: word.trim(), ...extra });
    };
    /* 끝 시각: 앞말이 없으면 시작의 앞말을 이어 쓰고, 그래도 시작보다 이르면 12시간 뒤로 봅니다(「1:30~3:00」→13:30~15:00). */
    const endHour = (ap, hour, startHour, zeroLed) => {
        let h = clockHour(ap, hour, { zeroLed });
        if (h < startHour && h + 12 < 24 && !zeroLed) h += 12;
        return h;
    };
    /* 0) 범위: 10:30~11:20, 오후 2시~3시, 2시 30분-4시 (한 덩어리로 빼고 time·endTime으로 돌려줍니다) */
    const CLOCK = '(\\d{1,2}):([0-5]\\d)';
    for (const m of text.matchAll(new RegExp(`(?<![\\d:가-힣])(?:${AMPM}\\s*)?${CLOCK}${COLON_UNIT}${DASH}(?:${AMPM}\\s*)?${CLOCK}(?![\\d:])${COLON_UNIT}`, 'g'))) {
        const [h1, m1, h2, m2] = [Number(m[2]), Number(m[3]), Number(m[5]), Number(m[6])];
        if (h1 > 23 || h2 > 24 || (m[1] && h1 > 12)) continue;
        if (notClockColon(text, m.index, m.index + m[0].length)) continue;
        const z1 = (m[2].length === 2 && m[2][0] === '0') || h1 > 12;
        const start = clockHour(m[1], h1, { zeroLed: z1 });
        const end = endHour(m[4] || m[1], h2, start, (m[5].length === 2 && m[5][0] === '0') || h2 > 12);
        /* 밤을 넘기거나 거꾸로 적은 범위(「23:00~01:00」)는 묶지 않고 글을 제목에 그대로 둡니다. 알림은 시작 시각만 씁니다. */
        if ((end % 24) * 60 + m2 <= start * 60 + m1) { push(m.index, m[0], start, m1, { keep: true }); continue; }
        push(m.index, m[0], start, m1, { endTime: `${pad(end % 24)}:${pad(m2)}` });
    }
    const HOUR_RANGE_NOT = '(?!간|험|작|키|\\s*방향|\\s*쪽)';
    for (const m of text.matchAll(new RegExp(`(?<![\\d가-힣])(?:${AMPM}\\s*)?(\\d{1,2})\\s*시(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?${DASH}(?:${AMPM}\\s*)?(\\d{1,2})\\s*시${HOUR_RANGE_NOT}(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?`, 'g'))) {
        const h1 = Number(m[2]);
        const h2 = Number(m[6]);
        const min1 = m[4] ? 30 : Number(m[3] || 0);
        const min2 = m[8] ? 30 : Number(m[7] || 0);
        if (h1 > 24 || h2 > 24 || min1 > 59 || min2 > 59) continue;
        const start = clockHour(m[1], h1);
        const end = endHour(m[5] || m[1], h2, start, false);
        if ((end % 24) * 60 + min2 <= start * 60 + min1) { push(m.index, m[0], start, min1, { keep: true }); continue; }
        push(m.index, m[0], start, min1, { endTime: `${pad(end % 24)}:${pad(min2)}` });
    }
    /* 1) 콜론 시각: 15:30, 오전 10:30, 오후 3:05, 13:00시 */
    for (const m of text.matchAll(new RegExp(`(?<![\\d:가-힣])(?:${AMPM}\\s*)?(\\d{1,2}):([0-5]\\d)(?![\\d:])${COLON_UNIT}`, 'g'))) {
        const hour = Number(m[2]);
        const min = Number(m[3]);
        if (hour > 24 || (hour === 24 && min)) continue;
        if (m[1] && hour > 12) continue; /* 「오후 15:30」은 섞어 쓴 말이라 그대로 두지 않고 24시간 값을 씁니다. */
        if (!m[1] && notClockColon(text, m.index, m.index + m[0].length)) continue;
        push(m.index, m[0], clockHour(m[1], hour, { zeroLed: m[2].length === 2 && m[2][0] === '0' || hour > 12 }), min, am12(m[1], hour));
    }
    for (const m of text.matchAll(new RegExp(`(?<![\\d:가-힣])${AMPM}\\s*(1[3-9]|2[0-3]):([0-5]\\d)(?![\\d:])${COLON_UNIT}`, 'g'))) {
        push(m.index, m[0], Number(m[2]), Number(m[3]));
    }
    /* 2) 숫자 시: 3시, 3시 반, 3시 20분, 15시 / 한글 시: 세 시, 오후 세시, 열두 시 반 (「한시적」「세시 풍속」「시청」 같은 말은 빼요) */
    const forms = [
        ['\\d{1,2}', '(?!간|험|작|키|\\s*방향|\\s*쪽)'],
        [KO_HOUR_RE, '(?!간|험|작|키|청|장|절|대|적|풍|\\s*방향|\\s*쪽|\\s*풍속)'],
    ];
    for (const [hourWord, notAfter] of forms) {
        for (const m of text.matchAll(new RegExp(`(?<![\\d가-힣])(?:${AMPM}\\s*)?(${hourWord})\\s*시${notAfter}(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?`, 'g'))) {
            const hour = KO_HOURS[m[2]] || Number(m[2]);
            const min = m[4] ? 30 : Number(m[3] || 0);
            if (hour > 24 || min > 59) continue;
            push(m.index, m[0], clockHour(m[1], hour), min, am12(m[1], hour));
        }
    }
    /* 3) 정오·자정 */
    for (const m of text.matchAll(/(?<![가-힣])(정오|자정)(?=\s*(?:까지|전|에|부터|무렵|쯤|$|[^가-힣]))/g)) {
        const tail = text.slice(m.index + m[0].length);
        const about = /^\s*(?:쯤|무렵|경)(?![가-힣])/.exec(tail);
        if (about) { push(m.index, m[0] + about[0], m[1] === '정오' ? 12 : 0, 0); continue; }
        if (m[1] === '정오') push(m.index, m[0], 12, 0);
        else if (/^\s*(?:까지|전)/.test(tail)) {
            const before = /^\s*전(?:\s*까지|에|으로)?(?![가-힣])/.exec(tail);
            push(m.index, before ? m[0] + before[0] : m[0], 23, 59);
        }
        else push(m.index, m[0], 0, 0);
    }
    return spans.sort((a, b) => a.index - b.index);
}

function stripSpans(raw, spans) {
    const ordered = [...spans].sort((a, b) => a.index - b.index);
    let out = '';
    let at = 0;
    for (const span of ordered) {
        if (span.index < at) continue;
        out += raw.slice(at, span.index);
        at = span.index + span.length;
    }
    out += raw.slice(at);
    return out.replace(/\s+/g, ' ').replace(/^[\s,·.:\-]+|[\s,·:\-]+$/g, '').trim();
}

function weekdayIndex(ymd) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** findDates가 안 읽는 「어제·그제」와 요일만 적은 말(「토요일」)을 더합니다. future면 다가오는 요일, 아니면 지난 요일입니다. */
function extraDates(raw, today, future) {
    const out = [];
    for (const m of raw.matchAll(/(?<![가-힣])(그저께|그제|어제)/g)) {
        out.push({ index: m.index, length: m[0].length, ymd: addDaysYmd(today, m[1] === '어제' ? -1 : -2), explicit: false });
    }
    for (const m of raw.matchAll(/(?<![가-힣])(?<!매주\s*)(?<!격주\s*)([월화수목금토일])요일(?!마다)/g)) {
        const want = WEEKDAYS.indexOf(m[1]);
        const have = weekdayIndex(today);
        const shift = future ? (want - have + 7) % 7 : -((have - want + 7) % 7);
        out.push({ index: m.index, length: m[0].length, ymd: addDaysYmd(today, shift), explicit: false, weekdayOnly: true });
    }
    return out;
}

/** 「3일 동안」「2일째」「11월 3일 동안」처럼 기간·횟수 꼬리는 날짜가 아닙니다. */
export function isDurationDayTail(raw, span) {
    const word = String(raw || '').substr(span.index, span.length);
    const tail = String(raw || '').slice(span.index + span.length);
    return /일$/.test(word) && NOT_DATE_TAIL.test(tail);
}

/** 「3일 동안」「2일째」처럼 날짜가 아닌 「N일」을 걸러 냅니다. */
function realDate(raw, span) {
    if (isDurationDayTail(raw, span)) return false;
    const tail = raw.slice(span.index + span.length);
    if (span.bare && !BARE_DAY_OK.test(tail) && !span.weekday) return false;
    return true;
}

/** 연도 없이 쓴 「3월 2일」·「3/2」가 할 일·일정에서 한참 지났으면 내년 그날로 옮깁니다. */
function rollPast(raw, span, today) {
    const word = raw.substr(span.index, span.length);
    if (!/^\d{1,2}\s*(?:월|[./])\s*\d{1,2}/.test(word)) return span.ymd;
    if (span.ymd >= addDaysYmd(today, -PAST_ROLL_DAYS)) return span.ymd;
    const next = `${Number(span.ymd.slice(0, 4)) + 1}${span.ymd.slice(4)}`;
    return isValidYmd(next) && next >= today ? next : span.ymd;
}

/**
 * 실시간 날짜 칩이 저장과 같은 날짜를 보이도록, readJjaemPaste와 같은 규칙으로 날짜 낱말을 돌려줍니다.
 * 「3일 동안」 같은 기간은 빼고, future면 요일만 적은 말(다가오는 요일)과 한참 지난 달·일(내년)을 저장과 같게 맞춥니다.
 * 돌려줌: [{ index, length, ymd, explicit, warning }] (글 순서). primary는 저장에 쓰는 날짜입니다.
 */
export function readDateSpans(text, { now = new Date(), future = false } = {}) {
    const raw = String(text || '');
    const today = seoulYmd(now);
    let dates = [];
    try { dates = findDates(raw, now); } catch { dates = []; }
    dates = dates.filter((span) => realDate(raw, span));
    if (future) {
        for (const extra of extraDates(raw, today, true)) {
            if (!dates.some((span) => extra.index < span.index + span.length && span.index < extra.index + extra.length)) dates.push(extra);
        }
    }
    dates.sort((a, b) => a.index - b.index);
    const spans = dates.map((span) => ({ ...span, ymd: future ? rollPast(raw, span, today) : span.ymd }));
    const primary = spans.find((item) => item.explicit) || spans[0] || null;
    return { spans, primary };
}

/**
 * 쨈 한 줄에서 날짜·시각을 읽고 본문에서 그 낱말을 뺍니다.
 * date: detectDate와 같이 숫자 날짜를 말보다 먼저 둡니다.
 * stripDate: true면 날짜 낱말을 어디서든 빼고(할 일·일정 제목), 'lead'면 맨 앞에 있을 때만 뺍니다(기록·메모 본문 보존).
 * future: 할 일·일정처럼 앞일을 적는 줄. 요일은 다가오는 날, 한참 지난 달·일은 내년으로 봅니다.
 */
export function readJjaemPaste(text, { now = new Date(), stripTime = true, stripDate = true, future = false, ampmFlip = [] } = {}) {
    const raw = String(text || '').trim();
    const today = seoulYmd(now);
    let dates = [];
    try { dates = findDates(raw, now); } catch { dates = []; }
    dates = dates.filter((span) => realDate(raw, span));
    for (const extra of extraDates(raw, today, future)) {
        if (!dates.some((span) => extra.index < span.index + span.length && span.index < extra.index + extra.length)) dates.push(extra);
    }
    dates.sort((a, b) => a.index - b.index);
    const primary = dates.find((item) => item.explicit) || dates[0] || null;
    const date = primary ? (future ? rollPast(raw, primary, today) : primary.ymd) : '';
    const dropDate = primary && (stripDate === true || (stripDate === 'lead' && primary.index === 0));
    const dateSpans = dropDate
        ? [{ index: primary.index, length: primary.length + particleLen(raw, primary.index + primary.length), ymd: date }]
        : [];
    const flipSet = new Set(ampmFlip);
    const timeSpans = findTimeSpans(raw).map((span) => {
        const id = `t${span.index}`;
        if (!flipSet.has(id)) return span;
        const [h, mi] = span.time.split(':').map(Number);
        return { ...span, time: `${pad((h + 12) % 24)}:${pad(mi)}` };
    });
    const time = timeSpans[0]?.time || '';
    const endTime = timeSpans[0]?.endTime || '';
    const ask = timeSpans[0]?.ask || '';
    const remove = [
        ...dateSpans,
        ...(stripTime ? timeSpans.filter((span) => !span.keep) : []),
    ];
    const body = remove.length ? (stripSpans(raw, remove) || raw) : raw;
    return {
        raw,
        body,
        date,
        time,
        endTime,
        ask,
        timeWord: timeSpans[0]?.word || '',
        chip: date ? jjaemDateChip(date, today) : null,
        changed: Boolean(date || time),
        dateWord: primary ? raw.substr(primary.index, primary.length) : '',
    };
}
