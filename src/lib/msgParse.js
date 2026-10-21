// 학교 문자를 기기 안에서 일정·할 일로 나눕니다. 바깥 AI는 쓰지 않습니다.
import { findDates } from './parse.js';
import { isSensitiveText } from './sensitive.js';
import { DEFAULT_PERIODS } from './period.js';

export const EVENT_KINDS = ['학급', '학교', '휴일', '내 일정'];
export const MEET_KINDS = ['학년회의', '교직원회의', '교과협의회', '학부모회의', '연수'];

const TODO_RE = /까지|제출|회신|작성|입력|업로드|확인\s*바랍니다|기한|마감/;
const EVENT_WORD = /회의(?!록)|연수|공개수업|협의회|행사|출장/;

const NOISE = [
    /^(?:안녕하세요|안녕하십니까)[\s!.~]*$/,
    /^선생님(?:께)?[,!]?\s*(?:안내(?:드립니다|입니다))?[\s!.~]*$/,
    /^안내(?:드립니다|입니다)[\s!.~]*$/,
    /^수고(?:많으셨습니다|하셨습니다|하세요)[\s!.~]*$/,
    /^(?:감사합니다|감사드립니다|반갑습니다)[\s!.~]*$/,
    /^좋은\s*(?:아침|하루)(?:입니다|되세요)?[\s!.~]*$/,
    /^(?:아래\s*)?(?:참고|확인)(?:해\s*주세요|바랍니다)?[\s!.~]*$/,
    /(?:드림|올림|배상)\s*$/,
    /^(?:보낸\s*사람|발신)\s*[:：].*$/,
    /^\[Web발신\]$/,
    /^[-–—=]{3,}$/,
];

export function readClipboard(nav = globalThis.navigator) {
    return Promise.resolve().then(async () => {
        try {
            if (typeof nav?.clipboard?.readText !== 'function') return { ok: false, reason: 'unavailable' };
            const text = await nav.clipboard.readText();
            if (!String(text ?? '').trim()) return { ok: false, reason: 'empty' };
            return { ok: true, text: String(text) };
        } catch {
            return { ok: false, reason: 'denied' };
        }
    });
}

export function clipboardHint(reason) {
    if (reason === 'empty') return '클립보드가 비어 있어요. 메시지를 아래에 붙여 넣으세요.';
    return '클립보드를 읽지 못했어요. 메시지를 아래에 붙여 넣으세요.';
}

function fnv1a32(str) {
    let h = 0x811c9dc5;
    const text = String(str);
    for (let i = 0; i < text.length; i += 1) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, '0');
}

function padTime(hour, minute) {
    if (hour > 23 || minute > 59 || hour < 0 || minute < 0) return '';
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function pickClock(text) {
    const ampm = text.match(/(오전|오후)\s*(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*반)?/);
    if (ampm) {
        let hour = Number(ampm[2]);
        const minute = ampm[3] ? Number(ampm[3]) : /반/.test(ampm[0]) ? 30 : 0;
        if (ampm[1] === '오후' && hour < 12) hour += 12;
        if (ampm[1] === '오전' && hour === 12) hour = 0;
        return { hm: padTime(hour, minute), assumedPm: false };
    }
    const colon = text.match(/(?<!\d)(\d{1,2})\s*:\s*(\d{2})(?!\d)/);
    if (colon) return { hm: padTime(Number(colon[1]), Number(colon[2])), assumedPm: false };
    const hourOnly = text.match(/(?<!\d)(\d{1,2})\s*시(?:\s*(\d{1,2})\s*분|\s*반)?/);
    if (!hourOnly) return null;
    let hour = Number(hourOnly[1]);
    const minute = hourOnly[2] ? Number(hourOnly[2]) : /반/.test(hourOnly[0]) ? 30 : 0;
    let assumedPm = false;
    if (hour >= 1 && hour <= 6) {
        hour += 12;
        assumedPm = true;
    }
    return { hm: padTime(hour, minute), assumedPm };
}

export function detectWhen(text, periods = DEFAULT_PERIODS) {
    const src = String(text || '');
    const starts = (periods && periods.length ? periods : DEFAULT_PERIODS);
    const out = { hm: '', period: 0, periodEnd: 0, assumedPm: false, label: '' };
    const range = src.match(/(\d)\s*[~～\-–—]\s*(\d)\s*교시/) || src.match(/(\d)\s*[,·]\s*(\d)\s*교시/);
    const one = src.match(/(\d)\s*교시/);
    if (range) {
        out.period = Number(range[1]);
        out.periodEnd = Number(range[2]);
        out.hm = starts[out.period - 1] || '';
        out.label = `${out.period}~${out.periodEnd}교시`;
    } else if (one && Number(one[1]) >= 1 && Number(one[1]) <= 7) {
        out.period = Number(one[1]);
        out.hm = starts[out.period - 1] || '';
        out.label = `${out.period}교시`;
    }
    const clock = pickClock(src);
    if (clock?.hm) {
        out.hm = clock.hm;
        out.assumedPm = clock.assumedPm;
    } else if (afterSchoolIsClock(src)) {
        out.hm = '16:00';
        out.label = out.label || '방과후';
    } else if (/점심\s*시간|점심/.test(src) && !out.period) {
        out.hm = '12:10';
        out.label = '점심시간';
    }
    return out;
}

function hasTodo(text) {
    return TODO_RE.test(text);
}

function hasEvent(text) {
    if (EVENT_WORD.test(text)) return true;
    if (/\d\s*[~～\-]\s*\d\s*교시/.test(text)) return true;
    if (/\d\s*교시/.test(text) && !/까지/.test(text)) return true;
    return false;
}

function guessEventKind(text) {
    if (/교직원|교무\s*회의|교무회의|전교|연수|출장|협의회|직원\s*회의/.test(text)) return '학교';
    return '학급';
}

/** 방과후가 시각이면 참, 신청서·학교처럼 명사에 붙으면 거짓입니다. */
function afterSchoolIsClock(text) {
    return /방과\s*후(?!\s*(?:신청서|서류|양식|안내문|가정통신문|프로그램|학교|부|강사|교육|수업안|지도안|부서))/.test(String(text || ''));
}

export function tidyTitle(text) {
    let t = String(text || '');
    t = t.replace(/장소\s*[:：]\s*[^\n,]+/g, ' ');
    t = t.replace(/[가-힣A-Za-z0-9]{1,12}(?:교실|실|관|장|터|홀|운동장)\s*에서/g, ' ');
    const weekTail = '(?:\\s*[.(（]?\\s*[월화수목금토일]\\s*(?:요일)?\\s*[)）]?)?';
    t = t.replace(new RegExp(`\\d{4}\\s*[.\\-/]\\s*\\d{1,2}\\s*[.\\-/]\\s*\\d{1,2}${weekTail}`, 'g'), ' ');
    t = t.replace(new RegExp(`\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일${weekTail}`, 'g'), ' ');
    t = t.replace(new RegExp(`(?<!\\d)(\\d{1,2})\\s*[./]\\s*(\\d{1,2})\\s*\\.?${weekTail}`, 'g'), ' ');
    t = t.replace(/(?:이번\s*주|다음\s*주|이번주|다음주|금주|차주)\s*[월화수목금토일]요일/g, ' ');
    t = t.replace(/글피|모레|내일|오늘/g, ' ');
    t = t.replace(new RegExp(`(?<![\\d./월])\\d{1,2}\\s*일${weekTail}`, 'g'), ' ');
    t = t.replace(/(?:오전|오후)\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?(?:\s*(?:에|까지))?/g, ' ');
    t = t.replace(/(?<!\d)\d{1,2}\s*:\s*\d{2}/g, ' ');
    t = t.replace(/(?<!\d)\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?(?:\s*(?:에|까지))?/g, ' ');
    t = t.replace(/점심\s*시간|점심/g, ' ');
    if (afterSchoolIsClock(t)) t = t.replace(/방과\s*후/g, ' ');
    t = t.replace(/\d\s*[~～\-–—]\s*\d\s*교시/g, ' ');
    t = t.replace(/\d(?:\s*[,·]\s*\d)+\s*교시/g, ' ');
    t = t.replace(/\d\s*교시(?:\s*까지)?/g, ' ');
    t = t.replace(/(?:^|\s)\d{1,2}[.)](?=\s)/g, ' ');
    t = t.replace(/(?:을|를)\s*(제출|회신|작성|입력|업로드)/g, ' $1');
    t = t.replace(/(?:해\s*)?주(?:시기|세요|시길|십시오)/g, ' ');
    t = t.replace(/부탁드립니다|확인\s*바랍니다|바랍니다|요망|드립니다|해주세요/g, ' ');
    t = t.replace(/(?:이|가)?\s*있습니다/g, ' ');
    t = t.replace(/없습니다|있어요|예정입니다|합니다|했어요|하세요|입니다|십니다/g, ' ');
    t = t.replace(/까지/g, ' ');
    t = t.replace(/에서/g, ' ');
    t = t.replace(/\[(?:안내|공지|알림|필독|공지사항)\]/g, ' ');
    t = t.replace(/[()（）[\]{}·,.!~:：]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.replace(/(?<=[가-힣])(?:을|를|은|는)$/g, '').trim();
    if (t.length > 40) t = t.slice(0, 40).trim();
    return t;
}

function takePlace(text) {
    const places = [];
    let next = String(text || '');
    const labeled = next.match(/장소\s*[:：]\s*([^\n,]+)/);
    if (labeled) {
        places.push(labeled[1].trim());
        next = next.replace(labeled[0], ' ');
    }
    const at = next.match(/([가-힣A-Za-z0-9]{1,12}(?:교실|실|관|장|터|홀|운동장))\s*에서/);
    if (at) {
        places.push(at[1]);
        next = next.replace(at[0], ' ');
    }
    return { text: next, memo: places.join(', ') };
}

function noise(line) {
    const text = String(line || '').trim();
    if (!text) return true;
    if (/^(?:\[(?:안내|공지|알림|필독|공지사항)\]|가정통신문|알림장|공지사항)$/.test(text)) return true;
    return NOISE.some((re) => re.test(text));
}

function cleanLine(line) {
    return String(line || '').trim().replace(/^(?:\[(?:안내|공지|알림|필독|공지사항)\]\s*)+/, '').trim();
}

function stripBullet(line) {
    return String(line || '').replace(/^(?:\d{1,2}[.)](?!\d)\s+|[①-⑳]\s*|[-–—•·▪○●◦※＊*]\s+)/, '').trim();
}

function explodeLine(line) {
    const stripped = stripBullet(line);
    const parts = stripped.split(/(?=[①-⑳○●※])/).map((part) => part.replace(/^(?:[①-⑳]|[○●※])\s*/, '').trim()).filter(Boolean);
    return parts.length ? parts : [];
}

function rangeJoin(text, prev, next) {
    if (!prev || !next || next.ymd <= prev.ymd) return false;
    const between = text.slice(prev.index + prev.length, next.index);
    return /^\s*[~～\-–—]\s*$/.test(between);
}

function splitByDate(text, now) {
    const spans = findDates(text, now);
    if (spans.length < 2) return [text];
    const parts = [];
    let start = 0;
    for (let i = 1; i < spans.length; i += 1) {
        const prev = spans[i - 1];
        const next = spans[i];
        if (next.ymd === prev.ymd || rangeJoin(text, prev, next)) continue;
        const chunk = text.slice(start, next.index).trim();
        if (chunk) parts.push(chunk);
        start = next.index;
    }
    const tail = text.slice(start).trim();
    if (tail) parts.push(tail);
    return parts.length ? parts : [text];
}

function dateSpan(text, now) {
    const found = findDates(text, now);
    let range = null;
    for (let i = 0; i < found.length - 1; i += 1) {
        if (rangeJoin(text, found[i], found[i + 1])) {
            range = { start: found[i], end: found[i + 1] };
            break;
        }
    }
    const date = range?.start || found.find((item) => item.explicit) || found[0] || null;
    return { date, end: range?.end || null, range: Boolean(range) };
}

function segmentsOf(text, now) {
    const lines = String(text || '').replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n').split('\n');
    const chunks = [];
    lines.forEach((line) => {
        const trimmed = cleanLine(line);
        if (noise(trimmed)) return;
        explodeLine(trimmed).forEach((part) => chunks.push(part));
    });
    return chunks.flatMap((chunk) => splitByDate(chunk, now));
}

function isDeadlineSubmission(text) {
    if (!/까지/.test(text)) return false;
    if (!/(제출|회신|작성|입력|업로드|마감|회수)/.test(text)) return false;
    if (/\d\s*[~～\-–—,·]\s*\d\s*교시(?!\s*까지)/.test(text)) return false;
    if (/(?<![,\d])\d\s*교시(?!\s*까지)/.test(text)) return false;
    return true;
}

function actionable(text) {
    if (hasTodo(text) || hasEvent(text)) return true;
    const when = detectWhen(text);
    if (when.hm || when.period) return true;
    if (findDates(text).length) return true;
    return false;
}

function buildItem(source, kind, now, periods, seq) {
    const placed = takePlace(source);
    const span = dateSpan(placed.text, now);
    let date = span.date;
    if (kind === '할 일' && span.range && /까지/.test(source)) date = span.end;
    const end = kind === '일정' && span.range ? span.end : null;
    const when = detectWhen(source, periods);
    const body = kind === '일정' || (hasEvent(source) && hasTodo(source) && isDeadlineSubmission(source))
        ? (kind === '일정' ? stripTodoClause(placed.text) : placed.text)
        : (kind === '할 일' && hasEvent(source) ? stripEventClause(placed.text) : placed.text);
    const title = tidyTitle(body);
    const memoBits = [];
    if (placed.memo) memoBits.push(placed.memo);
    if (when.period) memoBits.push(when.periodEnd ? `${when.period}~${when.periodEnd}교시` : `${when.period}교시`);
    const blob = `${title} ${placed.memo} ${source}`;
    const warning = [date?.warning, end?.warning].filter(Boolean).join(' ');
    const chatter = !actionable(source);
    const assumed = when.assumedPm ? '오전·오후가 없어 오후로 봤어요.' : '';
    const missing = date || chatter ? '' : '날짜가 없어요. 달력에서 골라 주세요.';
    const aside = chatter ? '부탁이나 날짜가 없어 빼 두었어요.' : '';
    const notes = [warning, assumed, missing, aside].filter(Boolean);
    let score = 0.45;
    if (date?.explicit) score += 0.25;
    else if (date) score += 0.15;
    else score -= 0.2;
    if (when.hm && !when.assumedPm) score += 0.15;
    if (when.assumedPm) score -= 0.15;
    if ((kind === '할 일' && hasTodo(source)) || (kind === '일정' && hasEvent(source)) || (kind === '일정' && span.range)) score += 0.2;
    if (warning || chatter) score -= 0.25;
    const low = chatter || score < 0.7 || Boolean(warning) || when.assumedPm || !date;
    const cleanTitle = title || (kind === '일정' ? '일정' : '할 일');
    const key = `${kind}|${date?.ymd || ''}|${end?.ymd || ''}|${when.hm}|${cleanTitle}|${source.replace(/\s+/g, '')}|${seq}`;
    return {
        id: `msg${fnv1a32(key)}`,
        kind,
        eventKind: kind === '일정' ? guessEventKind(source) : '',
        title: cleanTitle,
        date: date?.ymd || '',
        end: end?.ymd || '',
        time: when.hm || '',
        period: when.period || 0,
        periodEnd: when.periodEnd || 0,
        memo: memoBits.join(' · '),
        include: !chatter,
        low,
        warning: notes.join(' '),
        sensitive: isSensitiveText(blob),
        confidence: Math.max(0, Math.min(1, score)),
        assumedPm: when.assumedPm,
        raw: source,
    };
}

function stripTodoClause(text) {
    return String(text || '')
        .replace(/[가-힣A-Za-z0-9]{0,16}\s*(?:을|를|은|는|이|가)?\s*(?:제출|회신|작성|입력|업로드|마감)(?:\s*해\s*주(?:시기|세요|시길|십시오)|\s*바랍니다|\s*해주세요|\s*합니다)?/g, ' ')
        .replace(/확인\s*바랍니다/g, ' ');
}

function stripEventClause(text) {
    return String(text || '')
        .replace(/교직원\s*회의|회의(?!록)|연수|공개수업|협의회|행사|출장/g, ' ')
        .replace(/장소\s*[:：]\s*[^\n,]+/g, ' ')
        .replace(/\d(?:\s*[,·~～\-–—]\s*\d)+\s*교시/g, ' ')
        .replace(/\d\s*교시/g, ' ');
}

function classifySegment(segment, now, periods) {
    const todo = hasTodo(segment);
    const event = hasEvent(segment);
    const when = detectWhen(segment, periods);
    const span = dateSpan(segment, now);
    if (span.range && !isDeadlineSubmission(segment)) return [buildItem(segment, '일정', now, periods, 0)];
    if (isDeadlineSubmission(segment)) return [buildItem(segment, '할 일', now, periods, 0)];
    if (todo && event) {
        return [
            buildItem(segment, '일정', now, periods, 0),
            buildItem(segment, '할 일', now, periods, 1),
        ];
    }
    if (event || (when.hm && !todo)) return [buildItem(segment, '일정', now, periods, 0)];
    if (todo) return [buildItem(segment, '할 일', now, periods, 0)];
    if (!tidyTitle(segment)) return [];
    return [buildItem(segment, '할 일', now, periods, 0)];
}

/** @returns {{ items: object[] }} */
export function parseSchoolMessages(text, { now = new Date(), periods = DEFAULT_PERIODS } = {}) {
    const raw = String(text || '').trim();
    if (!raw) return { items: [] };
    const items = [];
    const seen = new Map();
    segmentsOf(raw, now).forEach((segment) => {
        classifySegment(segment, now, periods).forEach((item) => {
            if (!item.title) return;
            const n = (seen.get(item.id) || 0) + 1;
            seen.set(item.id, n);
            items.push(n === 1 ? item : { ...item, id: `msg${fnv1a32(`${item.id}#${n}`)}` });
        });
    });
    return { items };
}

export function gradeMessages(samples, now = new Date()) {
    const tally = { n: 0, kind: 0, date: 0, time: 0, title: 0, misses: [] };
    samples.forEach((sample, sampleIndex) => {
        const got = parseSchoolMessages(sample.text, { now, periods: sample.periods }).items;
        const expected = sample.items;
        const len = Math.max(got.length, expected.length);
        for (let i = 0; i < len; i += 1) {
            tally.n += 1;
            const left = got[i];
            const right = expected[i];
            const kindOk = left?.kind === right?.kind;
            const dateOk = (left?.date || '') === (right?.date || '');
            const timeOk = (left?.time || '') === (right?.time || '');
            const titleOk = String(left?.title || '').replace(/\s+/g, '') === String(right?.title || '').replace(/\s+/g, '');
            if (kindOk) tally.kind += 1;
            if (dateOk) tally.date += 1;
            if (timeOk) tally.time += 1;
            if (titleOk) tally.title += 1;
            const extra = [];
            if (right?.memo != null && (left?.memo || '') !== right.memo) extra.push(`memo ${left?.memo || ''} != ${right.memo}`);
            if (right?.sensitive != null && Boolean(left?.sensitive) !== right.sensitive) extra.push('sensitive');
            if (right?.eventKind != null && (left?.eventKind || '') !== right.eventKind) extra.push(`eventKind ${left?.eventKind}`);
            if (right?.low != null && Boolean(left?.low) !== right.low) extra.push('low');
            if (right?.end != null && (left?.end || '') !== right.end) extra.push(`end ${left?.end || ''}`);
            if (right?.include != null && Boolean(left?.include) !== Boolean(right.include)) extra.push(`include ${left?.include}`);
            if (!kindOk || !dateOk || !timeOk || !titleOk || extra.length) {
                tally.misses.push({
                    sample: sampleIndex + 1,
                    text: sample.text.slice(0, 40),
                    i,
                    got: left ? { kind: left.kind, date: left.date, time: left.time, title: left.title, memo: left.memo, eventKind: left.eventKind, low: left.low, warning: left.warning } : null,
                    expected: right || null,
                    extra,
                });
            }
        }
    });
    const pct = (n) => (tally.n ? Math.round((n / tally.n) * 1000) / 10 : 0);
    return {
        total: tally.n,
        kind: pct(tally.kind),
        date: pct(tally.date),
        time: pct(tally.time),
        title: pct(tally.title),
        misses: tally.misses,
    };
}
