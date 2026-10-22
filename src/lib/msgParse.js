// 학교 문자를 기기 안에서 일정·할 일로 나눕니다. 바깥 AI는 쓰지 않습니다.
import { isValidYmd, seoulYmd } from './date.js';
import { findDates, WEEK_MARK, WEEK_TAIL } from './parse.js';
import { isSensitiveText } from './sensitive.js';
import { DEFAULT_PERIODS } from './period.js';

export const EVENT_KINDS = ['학급', '학교', '휴일', '내 일정'];
export const MEET_KINDS = ['학년회의', '교직원회의', '교과협의회', '학부모회의', '연수'];

const TODO_RE = /제출|회신|작성|입력|업로드|탑재|확인\s*바랍니다|기한|마감/;
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

const CLOCK_PART = '(?:(오전|오후)\\s*)?(\\d{1,2})\\s*(?:시(?!간)(?:\\s*(\\d{1,2})\\s*분|\\s*(반))?|:(\\d{2}))';
const CLOCK_RANGE_RE = new RegExp(`${CLOCK_PART}\\s*(?:[~～–—-]|부터)\\s*${CLOCK_PART}(?:\\s*까지)?`);

function clockSide(marker, hourRaw, minuteRaw, half, colonMin, inherited) {
    const colon = colonMin != null && colonMin !== '';
    let hour = Number(hourRaw);
    const minute = colon ? Number(colonMin) : (minuteRaw != null && minuteRaw !== '' ? Number(minuteRaw) : half ? 30 : 0);
    const mark = marker || inherited || '';
    let assumed = false;
    if (mark === '오후' && hour < 12) hour += 12;
    else if (mark === '오전' && hour === 12) hour = 0;
    else if (!colon && !mark && hour >= 1 && hour <= 6) {
        hour += 12;
        assumed = true;
    }
    return { hm: padTime(hour, minute), assumed };
}

/** 물결·줄표·부터까지로 이어진 시작과 끝은 시각 하나입니다. 끝만 적힌 시는 시작의 오전·오후를 따릅니다. */
function clockSpan(text) {
    const matched = String(text || '').match(CLOCK_RANGE_RE);
    if (!matched) return null;
    const start = clockSide(matched[1], matched[2], matched[3], matched[4], matched[5], '');
    const end = clockSide(matched[6], matched[7], matched[8], matched[9], matched[10], matched[6] ? '' : (matched[1] || ''));
    if (!start.hm || !end.hm) return null;
    return { hm: start.hm, hmEnd: end.hm, assumedPm: Boolean(start.assumed || end.assumed) };
}

function pickClock(text) {
    const range = clockSpan(text);
    if (range) return range;
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
    const dayPart = text.match(/(오전|오후)\s*까지/);
    if (dayPart) return { hm: dayPart[1] === '오전' ? '12:00' : '18:00', assumedPm: false };
    const hourOnly = text.match(/(?<!\d)(\d{1,2})\s*시(?!간)(?:\s*(\d{1,2})\s*분|\s*반)?/);
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
    const out = { hm: '', hmEnd: '', period: 0, periodEnd: 0, assumedPm: false, label: '' };
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
        out.hmEnd = clock.hmEnd || '';
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

function hasDeadline(text) {
    const src = String(text || '').replace(CLOCK_RANGE_RE, ' ');
    const until = '(?:(?:오전|오후)\\s*)?(?:\\d{1,2}\\s*시(?!간)(?:\\s*\\d{1,2}\\s*분|\\s*반)?)?';
    if (new RegExp(`(?:\\d|일|요일|교시|시|분|오늘|내일|모레|글피|${WEEK_MARK}|주말)(?:\\s*[.(（]\\s*[월화수목금토일]\\s*[)）])?\\s*까지`).test(src)) return true;
    if (new RegExp(`[월화수목금토일]요일\\s*${until}\\s*(?:까지|마감)`).test(src)) return true;
    if (new RegExp(`[(（]\\s*[월화수목금토일]\\s*(?:요일)?\\s*[)）]\\s*${until}\\s*까지`).test(src)) return true;
    if (/(?:오전|오후)\s*까지/.test(src)) return true;
    if (/(?:이번\s*달|이번달|이달|금월|다음\s*달|다음달|내달)\s*(?:초|말일|말|중순)\s*까지/.test(src)) return true;
    if (/\d{1,2}\s*월\s*(?:초|중순|말일|말)\s*까지/.test(src)) return true;
    if (/(?:이번\s*달|이번달|이달|금월|다음\s*달|다음달|내달)\s*중으로/.test(src)) return true;
    if (/마지막\s*날\s*까지/.test(src)) return true;
    return /(?<![가-힣\d])월(?:초|말일|말|중순)\s*까지/.test(src);
}

function hasTodo(text) {
    return TODO_RE.test(text) || hasDeadline(text);
}

/** 계획서·서류 제출의 목적어 안에 들어 있는 운영·실시는 일정이 아닙니다. */
function documentSubmission(text) {
    const src = String(text || '');
    if (!/(제출|회신|작성|입력|업로드)/.test(src)) return false;
    return /(?:운영|실시|휴강|교체|돌봄|행사|연수|상담|회의)\s*(?:에\s*관한\s*|관련\s*)?(?:계획서|서류)/.test(src);
}

/** 읽는 사람에게 제출·회신·부탁처럼 무엇을 하라고 시킨 문장입니다. */
function isRequest(text) {
    const src = String(text || '');
    if (TODO_RE.test(src)) return true;
    if (/부탁드려요|부탁\s*드려|해\s*주(?:세|시|십)|주세요/.test(src)) return true;
    if (/부탁드립니다/.test(src) && !/(?:보결|출장|\d\s*교시)/.test(src)) return true;
    return false;
}

/** 어떤 날에 무엇이 있거나 바뀐다는 알림입니다. 운영위원회처럼 단어 안의 운영은 알림이 아닙니다. */
function isAnnouncement(text) {
    const src = String(text || '');
    if (documentSubmission(src)) return false;
    if (/(?<![가-힣])실시(?:합니다|해요|함|됩니다)?(?![가-힣])/.test(src)) return true;
    if (/(?<![가-힣])휴강/.test(src)) return true;
    if (/(?<![가-힣])교체(?:됩니다|합니다|해요|함)?(?![가-힣])/.test(src)) return true;
    if (/(?<![가-힣])운영(?:합니다|해요|함|입니다)?(?![가-힣])/.test(src)) return true;
    if (/(?:재량\s*)?휴업일/.test(src)) return true;
    if (/(?<![가-힣])체육대회/.test(src)) return true;
    if (!/(제출|회신|작성|입력|업로드)/.test(src) && /(?:개강|개학|휴무|휴업)|(?<![가-힣])(?:종업식|졸업식|입학식|방학식|개학식|시업식|수료식)/.test(src)) return true;
    if (!isRequest(src) && /(?<![가-힣])미운행/.test(src)) return true;
    if (/(?<![가-힣])변경(?:됩니다|합니다|했어요|공지)?(?![가-힣])/.test(src)) return true;
    if (/바뀝니다|바뀌었습니다|바뀌어요|당겨집니다|당겨졌어요/.test(src)) return true;
    if (/있습니다|없습니다/.test(src) && !isRequest(src)) return true;
    return false;
}

function hasTrip(text) {
    return /수학여행|소풍|수련회|운동회/.test(text);
}

function hasScheduledExam(text) {
    if (!/(?:단원|수행|지필|듣기|실험)\s*평가|중간\s*고사|기말\s*고사|고사|시험|(?<![가-힣])평가/.test(text)) return false;
    if (/(제출|입력|작성|업로드|회신|채점|탑재)/.test(text)) return false;
    return findDates(text).length > 0 || /\d\s*교시/.test(text);
}

/** 신청·접수를 언제까지 받는다는 말은 상담이 있는 날이 아니라 마감입니다. */
function isApplicationDeadline(text) {
    return hasDeadline(text) && /신청|접수/.test(text) && /받/.test(text);
}

function hasCounseling(text) {
    if (isRequest(text) || isApplicationDeadline(text)) return false;
    if (!/상담/.test(text)) return false;
    if (/상담\s*(?:기록|일지|내용|노트|희망)/.test(text)) return false;
    if (!/상담/.test(String(text).replace(/상담실/g, ''))) return false;
    return findDates(text).length > 0;
}

/** 날짜가 있는 검사는 일정입니다. 부탁이거나 마감이면 할 일입니다. 검사일은 칸 이름입니다. */
function hasInspection(text) {
    if (!/(?<![가-힣])검사(?!일)/.test(text)) return false;
    if (isRequest(text) || isDeadlineSubmission(text)) return false;
    return findDates(text).length > 0;
}

function hasEvent(text) {
    if (/(?<![가-힣])(?:학예회|설명회|박람회)|상담\s*주간/.test(text)) return true;
    if (EVENT_WORD.test(text)) return true;
    if (hasTrip(text) && findDates(text).length) return true;
    if (hasScheduledExam(text)) return true;
    if (hasInspection(text)) return true;
    if (/(?<![가-힣])(?:촬영|공사)/.test(text)) return true;
    if (hasCounseling(text)) return true;
    if (/(?:대회|축제|(?<![가-힣])(?:현장체험학습|현장학습|체험학습))/.test(text) && !isRequest(text) && !isDeadlineSubmission(text)) return true;
    if (/장소\s*변경/.test(text) && !isRequest(text)) return true;
    if (isAnnouncement(text)) return true;
    if (/\d\s*[~～\-]\s*\d\s*교시/.test(text)) return true;
    if (/\d\s*교시/.test(text) && !/까지/.test(text)) return true;
    return false;
}

function guessEventKind(text) {
    if (/휴업|휴일|공휴일|휴무/.test(text)) return '휴일';
    if (/교직원|교무\s*회의|교무회의|전교|연수|출장|협의회|직원\s*회의/.test(text)) return '학교';
    return '학급';
}

const AFTER_SCHOOL_EVENT = /^(?:학부모|상담|회의|연수|행사|돌봄)$/;

/** 방과후는 '방과후에', '방과후 시간', 상담·회의 앞의 때 표현일 때만 시각입니다. 바로 뒤 명사가 과목·강사·서류면 제목에 남깁니다. */
function afterSchoolIsClock(text) {
    const src = String(text || '');
    if (!/방과\s*후/.test(src)) return false;
    if (/방과\s*후(?:에|까지)|방과\s*후\s*시간/.test(src)) return true;
    const next = src.match(/방과\s*후\s*([가-힣]{1,12})/);
    if (!next) return false;
    const word = next[1].replace(/(?:은|는|이|가|을|를|도|만|님)$/, '');
    return AFTER_SCHOOL_EVENT.test(word);
}

function stripBoilerplate(text) {
    let t = String(text || '');
    t = t.replace(/\[[가-힣]{1,12}\]/g, ' ');
    t = t.replace(/\((?:필독|공지|안내|중요|재공지)\)/g, ' ');
    t = t.replace(/안녕하세요|안녕하십니까/g, ' ');
    t = t.replace(/안녕\s*선생님들?/g, ' ');
    t = t.replace(/(?:이번\s*달|이번달|이달|금월|다음\s*달|다음달|내달)\s*중으로/g, ' ');
    t = t.replace(/(?:이번\s*달|이번달|이달|금월|다음\s*달|다음달|내달)\s*중순/g, ' ');
    t = t.replace(/월중순/g, ' ');
    t = t.replace(/(?:오늘|내일|모레|글피|금일)\s*중(?:으로)?/g, ' ');
    t = t.replace(new RegExp(`(?:${WEEK_MARK})\\s*안(?:으로|에)?`, 'g'), ' ');
    t = t.replace(/중으로/g, ' ');
    t = t.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, ' ');
    t = t.replace(/께(?=\s|$)/g, ' ');
    return t;
}

/** 제목에 남는 조사·연도·대략 조각. 취소되었다는 말 자체는 제목에 둡니다. */
function stripTitleNoise(text) {
    let s = String(text || '');
    s = s.replace(/(?:재작년|작년|지난해|지난\s*해)(?:에는|에도|엔|도의|도|에|는|은|의|처럼|보다|과\s*달리|와\s*달리)?/g, ' ');
    s = s.replace(/(?:올해|이번에)(?:는|은)?/g, ' ');
    s = s.replace(/이었(?:는데|고|습니다|어요|음)?/g, ' ');
    s = s.replace(/(?:^|\s)이니(?=\s|$)/g, ' ');
    s = s.replace(/예정이에요/g, ' ');
    s = s.replace(/\d{1,2}\s*월\s*(?:초|중순|말)\s*인/g, ' ');
    s = s.replace(/(?:이번\s*달|이번달|다음\s*달|다음달|내달)\s*(?:초|중순|말)\s*인/g, ' ');
    s = s.replace(/기간\s*내\s*응답|(?:^|\s)내\s*응답(?=\s|$)/g, ' ');
    s = s.replace(/(?:결석|취소)\s*없이/g, ' ');
    s = s.replace(/잊지\s*않으셨(?:죠|지요)\s*[?？]?/g, ' ');
    s = s.replace(/(?:^|\s)(?:꼭|독려|예정대로|우천\s*시에도)(?=\s|$)/g, ' ');
    s = s.replace(/하지\s*않고/g, ' ');
    s = s.replace(/빠지지\s*말고/g, ' ');
    s = s.replace(/(?:^|\s)기간(?:은|는|이|가)?(?=\s|$)/g, ' ');
    s = s.replace(/강당에서/g, ' ');
    s = s.replace(/(?:제가|저는|저도|저)\s*(?:안내\s*(?:드린|한)|올린|공유한|알려\s*(?:드린|준))\s*/g, ' ');
    s = s.replace(/잊지\s*마세요/g, ' ');
    s = s.replace(/마감일/g, '마감');
    return s;
}

export function tidyTitle(text) {
    let t = stripBoilerplate(text);
    t = t.replace(/(?:^|\s)오는(?=\s|$)/g, ' ');
    t = t.replace(/오는(?=[월화수목금토일]요일)/g, '');
    t = t.replace(/장소\s*[:：]\s*[^\n,]+/g, ' ');
    t = t.replace(/[가-힣A-Za-z0-9]{1,12}(?:교실|실|관|장|터|홀|운동장)\s*에서/g, ' ');
    t = t.replace(/\d{4}\s*학년도/g, ' ');
    t = t.replace(new RegExp(`\\d{4}\\s*[.\\-/]\\s*\\d{1,2}\\s*[.\\-/]\\s*\\d{1,2}${WEEK_TAIL}`, 'g'), ' ');
    t = t.replace(new RegExp(`(?<!\\d)\\d{2}\\s*[./]\\s*\\d{1,2}\\s*[./]\\s*\\d{1,2}\\s*\\.?${WEEK_TAIL}`, 'g'), ' ');
    t = t.replace(new RegExp(`\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일${WEEK_TAIL}`, 'g'), ' ');
    t = t.replace(new RegExp(`(?<!\\d)(\\d{1,2})\\s*[./]\\s*(\\d{1,2})\\s*\\.?${WEEK_TAIL}`, 'g'), ' ');
    t = t.replace(new RegExp(`(?:${WEEK_MARK})\\s*[월화수목금토일]요일(?:에(?!서))?`, 'g'), ' ');
    t = t.replace(/(?:지난|저번)\s*[월화수목금토일]요일(?:에(?!서))?/g, ' ');
    t = t.replace(/\d+\s*박\s*\d+\s*일/g, ' ');
    t = t.replace(/글피|모레|내일|오늘/g, ' ');
    t = t.replace(new RegExp(`(?<![가-힣])(?:이번\\s*달|이번달|이달|금월|다음\\s*달|다음달|내달)\\s*\\d{1,2}\\s*일${WEEK_TAIL}`, 'g'), ' ');
    t = t.replace(/(?<![가-힣])(?:이번\s*달|이번달|이달|금월|다음\s*달|다음달|내달)\s*마지막\s*날/g, ' ');
    t = t.replace(/(?<![가-힣])(?:이번\s*달|이번달|이달|금월|다음\s*달|다음달|내달)\s*(?:초|말일|말|중순)/g, ' ');
    t = t.replace(/(?<![가-힣\d])월(?:초|말일|말|중순)/g, ' ');
    t = t.replace(/\d{1,2}\s*월\s*(?:초|중순|말)\s*인/g, ' ');
    t = t.replace(/\d{1,2}\s*월\s*(?:초|중순|말일|말)(?=\s*까지|(?![가-힣]))/g, ' ');
    t = t.replace(/(?<![가-힣])중순(?![가-힣])/g, ' ');
    t = t.replace(/(?<![\d./월])(?<!박\s*)\d{1,2}\s*[~～\-–—]\s*\d{1,2}\s*일/g, ' ');
    t = t.replace(new RegExp(`(?<![\\d./월])(?<!박\\s*)\\d{1,2}\\s*일${WEEK_TAIL}`, 'g'), ' ');
    t = t.replace(/(?:이|가)?\s*(?:오전|오후)\s*\d{1,2}\s*시(?!간)(?:\s*\d{1,2}\s*분|\s*반)?\s*(?:으로|로|에|까지)?/g, ' ');
    t = t.replace(/(?:오전|오후)\s*까지/g, ' ');
    t = t.replace(/(?:^|\s)(?:오전|오후)(?=\s|$)/g, ' ');
    t = t.replace(/(?<!\d)\d{1,2}\s*:\s*\d{2}/g, ' ');
    t = t.replace(/(?:이|가)?\s*(?<!\d)\d{1,2}\s*시(?!간)(?:\s*\d{1,2}\s*분|\s*반)?\s*(?:으로|로|에|까지)?/g, ' ');
    t = t.replace(/(?:^|\s)[~～\-–—]+(?=\s|$)/g, ' ');
    t = t.replace(/ㅎㅎ|ㅋㅋ|ㅠㅠ|ㅜㅜ|ㅋ{2,}|ㅎ{2,}/g, ' ');
    t = t.replace(/(?<![\d~～])[~～]+(?![\d~～])/g, ' ');
    t = t.replace(/점심\s*시간|점심/g, ' ');
    if (afterSchoolIsClock(t)) t = t.replace(/방과\s*후(?:\s*에|\s*까지)?(?:\s*시간)?(?:에|까지)?/g, ' ');
    t = t.replace(/\d\s*[~～\-–—]\s*\d\s*교시/g, ' ');
    t = t.replace(/\d(?:\s*[,·]\s*\d)+\s*교시/g, ' ');
    t = t.replace(/\d\s*교시(?:\s*까지)?/g, ' ');
    t = t.replace(/(?:^|\s)\d{1,2}[.)](?=\s)/g, ' ');
    t = t.replace(/(?:을|를)\s*(제출|회신|작성|입력|업로드|탑재)/g, ' $1');
    t = t.replace(/알려\s*주(?:세요|십시요|시기\s*바랍니다)?/g, '회신');
    t = t.replace(/(?:해\s*)?주(?:시기|세요|시길|십시오)/g, ' ');
    t = t.replace(/부탁드려요|부탁\s*드려요|부탁드립니다|확인\s*바랍니다|바랍니다|요망|드립니다|해주세요/g, ' ');
    t = t.replace(/(?:이|가)?\s*있습니다/g, ' ');
    t = t.replace(/(?:선생님들?\s*)?(?:항상\s*)?수고\s*많(?:으셨습니다|으십니다|습니다)/g, ' ');
    t = t.replace(/(?:^|\s)(?:수고|많으)(?=\s|$)/g, ' ');
    t = t.replace(/감사(?:합니다|드립니다|해요)/g, ' ');
    t = t.replace(/(?:이|가)?\s*(?:없습니다|바뀝니다|바뀌었습니다|바뀌어요|당겨집니다|당겨졌어요)/g, ' ');
    t = t.replace(/(?:요청|부탁)(?:이|가|은|는|을|를)?\s*들어\s*왔(?:어요|습니다|다)/g, ' ');
    t = t.replace(/가능한/g, '가능');
    t = t.replace(/받습니다|받아요/g, ' ');
    t = t.replace(/(?:제가|저는|저도|저)\s*참석(?:하는|합니다|해요)/g, ' ');
    t = t.replace(/없어요|있어요|예정입니다|예정이에요|합니다|했어요|했습니다|하세요|입니다|엽니다/g, ' ');
    t = t.replace(/앞당겨(?:졌습니다|졌어요|집니다|요)?/g, ' ');
    t = t.replace(/연기(?:됩니다|합니다|해요|됐(?:어요|습니다)|음|됨)?/g, ' ');
    t = t.replace(/미뤄(?:졌습니다|졌어요|집니다|요|짐)?/g, ' ');
    t = t.replace(/[월화수목금토일]요일(?:으로|로)?/g, ' ');
    t = stripTitleNoise(t);
    t = t.replace(/(?:^|\s)(?:재작년|지난해|지난\s*해|작년|지난번|지난\s*달|지난달)(?=\s|$)/g, ' ');
    t = t.replace(/(?:^|\s)지난(?=\s|$)/g, ' ');
    t = t.replace(/(?:이었|였)던/g, ' ');
    t = t.replace(/마지막\s*날/g, ' ');
    t = t.replace(/쯤/g, ' ');
    t = t.replace(/(?:^|\s)경(?=\s|$)/g, ' ');
    t = t.replace(/\d{4}\s*년/g, ' ');
    t = t.replace(/까지/g, ' ');
    t = t.replace(/(?:^|\s)(?:예요|에요|이에요)(?=\s|$)/g, ' ');
    t = t.replace(/부터/g, ' ');
    t = t.replace(/에서/g, ' ');
    t = t.replace(/(?:^|\s)(?:그대로|아니라|정정|대체)(?=\s|$)/g, ' ');
    t = t.replace(/연장(?:됩니다|합니다|되었(?:습니다|어요)|됐어요|됨)?/g, ' ');
    t = t.replace(/[()（）[\]{}·,.!~:：]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.replace(/(?:이|가)\s+(?:으로|로)(?=\s|$)/g, ' ');
    t = t.replace(/(?:^|\s)(?:으로|로)(?=\s|$)/g, ' ');
    t = t.replace(/(?:은|는|을|를)\s+(제출|회신|작성|입력|업로드|마감|회수|실시|운영|휴강|교체|탑재)(?=\s|$)/g, ' $1');
    const polite = t.replace(/하실래요|드세요|먹을까요|갈까요/g, ' ').replace(/\s+/g, ' ').trim();
    if (polite.replace(/\s+/g, '').length >= 4) t = polite;
    let guard = 0;
    while (guard < 4 && /^(?:일시|기간|일정|검진일|검사일|실시일|시간|날짜|장소|위치|대상|내용|참고|에|은|는|이|가|을|를|와|과|의|로|으로)\s+/.test(t)) {
        t = t.replace(/^(?:일시|기간|일정|검진일|검사일|실시일|시간|날짜|장소|위치|대상|내용|참고|에|은|는|이|가|을|를|와|과|의|로|으로)\s+/, '');
        guard += 1;
    }
    t = t.replace(/(?:^|\s)(?:일시|기간|일정|검진일|검사일|실시일)(?=\s|$)/g, ' ');
    t = t.replace(/(?:^|\s)(?:[월화수목금토일]|에)(?=\s|$)/g, ' ');
    t = t.replace(/(?:^|\s)부터(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    let tailGuard = 0;
    while (tailGuard < 3) {
        const next = t.replace(/(?:^|\s)(?:그대로|은|는|이|가|을|를|과|와|의|으로|로|에)$/g, '').replace(/(?<=[가-힣])(?:을|를|은|는|에)$/g, '').trim();
        if (next === t) break;
        t = next;
        tailGuard += 1;
    }
    if (t.length > 40) {
        const cut = t.slice(0, 40);
        const space = cut.lastIndexOf(' ');
        t = (space >= 8 ? cut.slice(0, space) : cut).trim();
    }
    return t;
}

const TITLE_STOP = /^(?:일시|기간|일정|시간|날짜|장소|위치|대상|내용|참고|안내|선생님들?|항상|수고|많으|확인|바랍니다)$/;

function clippedWord(title, source) {
    const parts = String(title || '').split(/\s+/).filter((part) => part.length >= 2);
    const words = String(source || '').match(/[가-힣]{2,}/g) || [];
    return parts.some((part) => words.some((word) => word.length > part.length && word.endsWith(part)));
}

function salvageTitle(text) {
    let t = stripBoilerplate(text);
    t = t.replace(/(?:^|\s)오는(?=\s|$)/g, ' ');
    t = t.replace(/오는(?=[월화수목금토일]요일)/g, '');
    t = t.replace(/장소\s*[:：]\s*[^\n,]+/g, ' ');
    t = t.replace(/\d+\s*박\s*\d+\s*일/g, ' ');
    t = t.replace(/\d{4}\s*학년도/g, ' ');
    t = t.replace(new RegExp(`\\d{4}\\s*[.\\-/]\\s*\\d{1,2}\\s*[.\\-/]\\s*\\d{1,2}${WEEK_TAIL}`, 'g'), ' ');
    t = t.replace(new RegExp(`(?<!\\d)\\d{2}\\s*[./]\\s*\\d{1,2}\\s*[./]\\s*\\d{1,2}\\s*\\.?${WEEK_TAIL}`, 'g'), ' ');
    t = t.replace(new RegExp(`\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일${WEEK_TAIL}`, 'g'), ' ');
    t = t.replace(new RegExp(`(?<!\\d)\\d{1,2}\\s*[./]\\s*\\d{1,2}\\s*\\.?${WEEK_TAIL}`, 'g'), ' ');
    t = t.replace(new RegExp(`(?:${WEEK_MARK})\\s*[월화수목금토일]요일(?:에(?!서))?`, 'g'), ' ');
    t = t.replace(/(?:지난|저번)\s*[월화수목금토일]요일(?:에(?!서))?/g, ' ');
    t = t.replace(/(?:오전|오후)\s*까지/g, ' ');
    t = t.replace(/글피|모레|내일|오늘|까지/g, ' ');
    t = t.replace(new RegExp(`(?<![가-힣])(?:이번\\s*달|이번달|이달|금월|다음\\s*달|다음달|내달)\\s*\\d{1,2}\\s*일${WEEK_TAIL}`, 'g'), ' ');
    t = t.replace(/(?<![가-힣])(?:이번\s*달|이번달|이달|금월|다음\s*달|다음달|내달)\s*마지막\s*날/g, ' ');
    t = t.replace(/(?<![가-힣])(?:이번\s*달|이번달|이달|금월|다음\s*달|다음달|내달)\s*(?:초|말일|말|중순)/g, ' ');
    t = t.replace(/(?<![가-힣\d])월(?:초|말일|말|중순)/g, ' ');
    t = t.replace(/\d{1,2}\s*월\s*(?:초|중순|말)\s*인/g, ' ');
    t = t.replace(/\d{1,2}\s*월\s*(?:초|중순|말일|말)(?=\s*까지|(?![가-힣]))/g, ' ');
    t = t.replace(/(?<![가-힣])중순(?![가-힣])/g, ' ');
    t = t.replace(/(?<![\d./월])(?<!박\s*)\d{1,2}\s*[~～\-–—]\s*\d{1,2}\s*일/g, ' ');
    t = t.replace(new RegExp(`(?<![\\d./월])(?<!박\\s*)\\d{1,2}\\s*일${WEEK_TAIL}`, 'g'), ' ');
    t = t.replace(/(?:오전|오후)\s*\d{1,2}\s*시(?!간)(?:\s*\d{1,2}\s*분|\s*반)?/g, ' ');
    t = t.replace(/(?:오전|오후)\s*까지/g, ' ');
    t = t.replace(/(?:^|\s)(?:오전|오후)(?=\s|$)/g, ' ');
    t = t.replace(/(?<!\d)\d{1,2}\s*:\s*\d{2}/g, ' ');
    t = t.replace(/(?<!\d)\d{1,2}\s*시(?!간)(?:\s*\d{1,2}\s*분|\s*반)?/g, ' ');
    t = t.replace(/(?:^|\s)[~～\-–—]+(?=\s|$)/g, ' ');
    t = t.replace(/점심\s*시간|\d\s*교시/g, ' ');
    t = t.replace(/(?:선생님들?\s*)?(?:항상\s*)?수고\s*많(?:으셨습니다|으십니다|습니다|으)/g, ' ');
    t = t.replace(/앞당겨(?:졌습니다|졌어요|집니다|요)?/g, ' ');
    t = t.replace(/연기(?:됩니다|합니다|해요|됐(?:어요|습니다)|음|됨)?/g, ' ');
    t = t.replace(/미뤄(?:졌습니다|졌어요|집니다|요|짐)?/g, ' ');
    t = t.replace(/[월화수목금토일]요일(?:으로|로)?/g, ' ');
    t = stripTitleNoise(t);
    t = t.replace(/(?:^|\s)(?:재작년|지난해|지난\s*해|작년|지난번|지난\s*달|지난달)(?=\s|$)/g, ' ');
    t = t.replace(/(?:^|\s)지난(?=\s|$)/g, ' ');
    t = t.replace(/(?:이었|였)던/g, ' ');
    t = t.replace(/마지막\s*날/g, ' ');
    t = t.replace(/쯤/g, ' ');
    t = t.replace(/(?:^|\s)경(?=\s|$)/g, ' ');
    t = t.replace(/부터/g, ' ');
    t = t.replace(/에서/g, ' ');
    t = t.replace(/(?:^|\s)(?:그대로|아니라|정정|대체)(?=\s|$)/g, ' ');
    t = t.replace(/연장(?:됩니다|합니다|되었(?:습니다|어요)|됐어요|됨)?/g, ' ');
    t = t.replace(/기한(?:이|은|을|를)?/g, ' ');
    t = t.replace(/(?:입니다|됩니다|합니다|했습니다)/g, ' ');
    const words = t.match(/[가-힣A-Za-z0-9]{2,}/g) || [];
    return words.filter((word) => !TITLE_STOP.test(word) && !WEAK_TITLE.test(word)).slice(0, 6).join(' ');
}

const FIELD_ONLY = /^(?:일정|일시|기간|검진일|검사일|실시일|시간|날짜|장소|위치|안내|할일)$/;

function pickTitle(body, source) {
    const blob = String(source || body || '');
    const fair = blob.match(/([가-힣]{1,8})\s*박람회/);
    const applying = /(?:참가|참여|신청|접수)/.test(blob) && /까지|마감/.test(blob);
    if (fair && !applying) return `${fair[1]} 박람회`;
    let title = tidyTitle(body);
    if (badTitle(title, source)) {
        const again = salvageTitle(source);
        if (again && !badTitle(again, source)) title = again;
    }
    if (!badTitle(title, source)) return title;
    const verb = tidyTitle(body).replace(/\s+/g, '');
    if (/^(?:제출|회신|작성|입력|업로드|마감|회수)$/.test(verb)) {
        const words = salvageTitle(source).split(/\s+/).filter((word) => word && word !== verb);
        if (!words.length) return verb;
    }
    return '';
}

/** 제목을 고칠 때는 이 구절까지 보고, 같은 글을 두 번 붙이지 않습니다. 뒤 문장은 따로 둡니다. */
function titleSource(segment, fullText) {
    const body = String(segment || '');
    const full = String(fullText || '');
    const trimmed = body.trim();
    if (!full || !trimmed || full === body) return body;
    const at = full.indexOf(trimmed);
    if (at < 0) return body;
    return full.slice(0, at + trimmed.length);
}

function finishTitle(title, segment, fullText) {
    const compact = String(title || '').replace(/\s+/g, '');
    const source = titleSource(segment, fullText);
    if (compact === '상담') {
        const richer = salvageTitle(source).split(/\s+/).filter((word) => word && word !== '상담' && !FIELD_ONLY.test(word) && !WEAK_TITLE.test(word));
        if (richer.length) return [...richer, '상담'].slice(0, 6).join(' ');
    }
    if (/^(?:변경|연기|미뤄|미루|\d{1,2}차)$/.test(compact)) {
        const richer = salvageTitle(source).split(/\s+/).filter((word) => word && !/^(?:변경|연기|미뤄|미루|\d{1,2}차)$/.test(word) && !FIELD_ONLY.test(word) && !WEAK_TITLE.test(word));
        if (richer.length) return (/^\d{1,2}차$/.test(compact) ? [...richer, compact] : richer).slice(0, 6).join(' ');
    }
    if (title && !FIELD_ONLY.test(compact)) return title;
    const words = salvageTitle(source).split(/\s+/).filter((word) => word && !FIELD_ONLY.test(word) && !WEAK_TITLE.test(word));
    if (words.length) return words.slice(0, 6).join(' ');
    if (/^(?:제출|회신|작성|입력|업로드|마감|회수)$/.test(compact)) return compact;
    return title || '';
}

const WEAK_TITLE = /^(?:일시|기간|일정|검진일|검사일|실시일|시간|날짜|장소|위치|대상|내용|참고|안내|제출|회신|작성|입력|업로드|마감|회수|그대로|아니라|정정|대체|연장|입니다|됩니다|합니다|오전|오후|수|월|화|목|금|토|일|에|은|는|이|가|을|를|와|과|의|로|으로|많으|경|쯤|중순|부터|였던|이었던|마지막|\d*박\d*일)$/;

function weakTitle(title) {
    const text = String(title || '').replace(/\s+/g, '');
    if (text.length < 2) return true;
    return WEAK_TITLE.test(text);
}

function badTitle(title, source) {
    if (weakTitle(title) || clippedWord(title, source)) return true;
    const raw = String(title || '').trim();
    if (/^(?:[월화수목금토일])(?:\s|$)/.test(raw)) return true;
    if (/(?:^|\s)[월화수목금토일]$/.test(raw)) return true;
    return false;
}

function placeMemo(text) {
    const trimmed = String(text || '').trim().replace(/^\d+\s*박\s*\d+\s*일\s*/, '');
    const labeled = trimmed.match(/^(?:장소|위치|집합(?:\s*장소)?|도착지|행선지)\s*[:：]?\s*(.+)$/);
    if (labeled && !findDates(labeled[1]).length) return labeled[1].trim();
    if (/일대$|일원$|지역$/.test(trimmed) && trimmed.length <= 24 && !findDates(trimmed).length && !hasTodo(trimmed)) return trimmed.trim();
    return '';
}

function takePlace(text) {
    const places = [];
    let next = String(text || '');
    const labeled = next.match(/장소\s*[:：]\s*([^\n,]+)/);
    if (labeled) {
        places.push(labeled[1].trim());
        next = next.replace(labeled[0], ' ');
    }
    const paren = next.match(/[（(]\s*([가-힣A-Za-z0-9]{1,12}(?:교실|운동장|실|관|당|장|터|홀))\s*[)）]/);
    if (paren) {
        places.push(paren[1]);
        next = next.replace(paren[0], ' ');
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
    return /^\s*[~～\-–—]\s*$/.test(between) || /^\s*부터\s*$/.test(between);
}

function splitSentences(text) {
    const src = String(text || '').trim();
    if (!src) return [];
    const parts = [];
    let start = 0;
    for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        if (!/[.!?。！？]/.test(ch)) continue;
        if ((ch === '.' || ch === '。') && /\d/.test(src[i - 1] || '')) continue;
        const chunk = src.slice(start, i + 1).trim();
        if (chunk) parts.push(chunk);
        start = i + 1;
    }
    const tail = src.slice(start).trim();
    if (tail) parts.push(tail);
    return parts.length ? parts : [src];
}

function splitNoticeRequest(sentence, now) {
    const matched = String(sentence || '').match(/^(.*?)(?:있으니|하니까|니까)\s+(.+)$/);
    if (!matched) return null;
    const left = matched[1].trim();
    const right = matched[2].trim();
    if (!left || !right || !isRequest(right)) return null;
    if (!hasEvent(left) && !isAnnouncement(left) && !/\d\s*교시/.test(left)) return null;
    const prefix = (left.match(new RegExp(`글피|모레|내일|오늘|(?:${WEEK_MARK})\\s*[월화수목금토일]요일|\\d{1,2}\\s*월\\s*\\d{1,2}\\s*일|(?<!\\d)\\d{1,2}\\s*[./]\\s*\\d{1,2}`)) || [])[0] || '';
    const rightText = findDates(right, now).length ? right : `${prefix} ${right}`.trim();
    return [left, rightText];
}

function splitClauses(sentence, now) {
    const src = String(sentence || '').trim();
    if (!src) return [];
    const cuts = [];
    const mark = /하고|하며|는데|지만/g;
    let match = mark.exec(src);
    while (match) {
        cuts.push(match.index);
        match = mark.exec(src);
    }
    for (let i = 0; i < cuts.length; i += 1) {
        const cut = cuts[i];
        const left = src.slice(0, cut).trim();
        const right = src.slice(cut).replace(/^(?:하고|하며|는데|지만)\s*/, '').trim();
        const leftDays = new Set(findDates(left, now).map((item) => item.ymd));
        const rightDays = new Set(findDates(right, now).map((item) => item.ymd));
        if (!leftDays.size || !rightDays.size) continue;
        const same = leftDays.size === rightDays.size && [...leftDays].every((day) => rightDays.has(day));
        if (same) continue;
        return [...splitClauses(left, now), ...splitClauses(right, now)];
    }
    return [src];
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
        let cut = next.index;
        const between = text.slice(prev.index + prev.length, next.index);
        const subject = between.match(/([가-힣A-Za-z0-9]{1,24}(?:은|는|이|가))\s*$/);
        if (subject && subject.index != null) cut = prev.index + prev.length + subject.index;
        const chunk = text.slice(start, cut).trim();
        if (chunk) parts.push(chunk);
        start = cut;
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

const MOVE_ARROW = /→|➡|⇨|->/;
const MOVE_VERB = /연기|미뤄|미루|미룹|앞당|순연|연장|변경|바뀌|바꿉|바꿔|바뀝|옮겨|옮긴/;
const TIME_BIT = '(?:(?:오전|오후)\\s*)?\\d{1,2}\\s*(?:시(?:\\s*\\d{1,2}\\s*분|\\s*반)?|:\\s*\\d{2})';
const TIME_SHIFT_RE = new RegExp(`(${TIME_BIT})\\s*에서\\s*(${TIME_BIT})\\s*(?:으로|로)`);

function isRangePair(text, spans) {
    return spans.length === 2 && rangeJoin(text, spans[0], spans[1]);
}

/** 시각만 '에서…로'로 바뀌면 나중 시각만 남깁니다. */
function applyTimeShift(text) {
    const matched = String(text || '').match(TIME_SHIFT_RE);
    if (!matched) return null;
    const next = String(text).replace(TIME_SHIFT_RE, matched[2])
        .replace(/(?:으로|로)?\s*(?:변경|바뀌|바꿉|바꿔|바뀝|연기|앞당(?:겨(?:졌습니다|졌어요|집니다|요)?|김)|순연|연장)(?:되었(?:습니다|어요)|됐습니다|됩니다|합니다|했어요|요)?/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return next && next !== String(text).trim() ? next : null;
}

function roAfter(text, end) {
    return new RegExp(`^\\s*(?:${TIME_BIT}\\s*)?(?:으로|로)(?![가-힣])`).test(String(text).slice(end));
}

/** 이동어가 두 날짜 사이를 직접 이을 때만 옮긴 것으로 봅니다. */
function directBridge(text, left, right) {
    const between = text.slice(left.end, right.spans[0].index);
    const after = text.slice(right.end, right.end + 32);
    if (MOVE_ARROW.test(between)) return true;
    if (/에서/.test(between) && roAfter(text, right.end)) return true;
    if (/(?:이|가)\s*아니라/.test(between)) return true;
    const particle = /(?:은|는|을|를)\s*$/.test(between.trim());
    return particle && roAfter(text, right.end) && MOVE_VERB.test(`${between}${after}`);
}

/** 붙어 있는 시작·끝은 기간 하나이고, 그 밖의 날짜는 각각 하나입니다. */
function temporalUnits(text, spans) {
    const units = [];
    for (let i = 0; i < spans.length; i += 1) {
        const next = spans[i + 1];
        if (next && rangeJoin(text, spans[i], next)) {
            units.push({ spans: [spans[i], next], end: next.index + next.length });
            i += 1;
        } else {
            units.push({ spans: [spans[i]], end: spans[i].index + spans[i].length });
        }
    }
    return units;
}

function moveCue(text, units) {
    if (units.length < 2) return false;
    if (new Set(units.flatMap((unit) => unit.spans.map((span) => span.ymd))).size < 2) return false;
    for (let i = 1; i < units.length; i += 1) {
        if (!directBridge(text, units[i - 1], units[i])) return false;
    }
    return true;
}

function isReschedule(text, spans) {
    return moveCue(text, temporalUnits(text, spans));
}

/** 옮기는 말인데 요일을 날짜로 못 묶으면 짐작하지 않습니다. */
function danglingMove(text, now) {
    const spans = findDates(text, now);
    if (temporalUnits(text, spans).length >= 2) return false;
    const fromTo = /에서/.test(text) && /(?:으로|로)/.test(text);
    const shift = MOVE_ARROW.test(text) || /연기|미뤄|미루|앞당/.test(text);
    if (!fromTo && !shift) return false;
    const weekdays = text.match(/[월화수목금토일]요일/g) || [];
    const covered = spans.reduce((sum, span) => sum + (text.slice(span.index, span.index + span.length).match(/[월화수목금토일]요일/g) || []).length, 0);
    return weekdays.length > covered;
}

function sliceOutSpans(text, spans) {
    let next = text;
    [...spans].sort((a, b) => b.index - a.index).forEach((span) => {
        next = `${next.slice(0, span.index)} ${next.slice(span.index + span.length)}`;
    });
    return next;
}

function moveSubject(text, spans) {
    let t = sliceOutSpans(text, spans);
    t = t.replace(MOVE_ARROW, ' ');
    t = t.replace(/(?:오전|오후)\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?/g, ' ');
    t = t.replace(/(?<!\d)\d{1,2}\s*:\s*\d{2}/g, ' ');
    t = t.replace(/연기(?:됩니다|합니다|해요|함|됐어요|되었어요|되었음|됨)?/g, ' ');
    t = t.replace(/미뤄(?:졌습니다|졌어요|집니다|요|짐)?|미루(?:어\s*요|어집니다|었습니다|어\s*짐|ㅂ니다)?/g, ' ');
    t = t.replace(/앞당(?:겨(?:졌습니다|졌어요|집니다|요|짐)?|김|긴)?/g, ' ');
    t = t.replace(/옮겨(?:졌습니다|졌어요|집니다|요)?|옮긴/g, ' ');
    t = t.replace(/(?:으로|로)\s*(?:변경|바뀌|바꿉|바꿔)(?:됩니다|합니다|했어요|어요|었습니다|니다|요)?/g, ' ');
    t = t.replace(/(?:변경|바뀌|바꿉|바꿔)(?:됩니다|합니다|했어요|어요|었습니다|니다)/g, ' ');
    t = t.replace(/기한(?:이|은|을|를)?/g, ' ');
    t = t.replace(/연장(?:됩니다|합니다|되었(?:습니다|어요)|됐어요|됨)?/g, ' ');
    t = t.replace(/(?:이|가)?\s*아니라/g, ' ');
    t = t.replace(/(?:^|\s)(?:정정|대체|그대로)(?=\s|$)/g, ' ');
    t = t.replace(/순연(?:됩니다|합니다|되었(?:습니다|어요))?/g, ' ');
    return tidyTitle(t);
}

function clockAfter(text, index) {
    const found = text.slice(index).match(/(?:오전|오후)\s*\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?|(?<!\d)\d{1,2}\s*:\s*\d{2}/);
    return found ? found[0] : '';
}

function ymdToken(span) {
    const month = Number(span.ymd.slice(5, 7));
    const day = Number(span.ymd.slice(8, 10));
    return `${month}/${day}${span.weekday ? `(${span.weekday})` : ''}`;
}

function unitToken(unit) {
    if (unit.spans.length > 1) return `${ymdToken(unit.spans[0])}~${ymdToken(unit.spans[1])}`;
    return ymdToken(unit.spans[0]);
}

/** 날짜를 옮기는 문장은 마지막 날짜·기간만 남기고, 예전 것은 빼 둡니다. */
function rescheduleChunks(text, now) {
    const spans = findDates(text, now);
    const units = temporalUnits(text, spans);
    if (!moveCue(text, units)) return null;
    const dest = units[units.length - 1];
    const subject = moveSubject(text, spans);
    const when = clockAfter(text, dest.end);
    const fresh = `\u0003${subject} ${unitToken(dest)} ${when}`.replace(/\s+/g, ' ').trim();
    const old = units.slice(0, -1).map((unit) => `\u0002${subject} ${unitToken(unit)}`.replace(/\s+/g, ' ').trim());
    return [fresh, ...old];
}

/** '1차, 2차'처럼 같은 대상을 여러 날에 적으면 제목에 대상과 차례를 같이 붙입니다. */
function ordinalChunks(text, now) {
    const spans = findDates(text, now);
    if (spans.length < 2 || isReschedule(text, spans) || isRangePair(text, spans)) return null;
    if (isRequest(text) || isDeadlineSubmission(text)) return null;
    const ordinals = [...String(text).matchAll(/(?<!\d)(\d{1,2})\s*차/g)];
    if (ordinals.length < 2) return null;
    const last = Math.max(
        spans[spans.length - 1].index + spans[spans.length - 1].length,
        ordinals[ordinals.length - 1].index + ordinals[ordinals.length - 1][0].length,
    );
    let noun = tidyTitle(text.slice(last)).replace(/(?<!\d)\d{1,2}\s*차/g, ' ').replace(/\s+/g, ' ').trim();
    if (!noun) {
        const headAt = Math.min(spans[0].index, ordinals[0].index);
        noun = tidyTitle(text.slice(0, headAt)).replace(/(?<!\d)\d{1,2}\s*차/g, ' ').replace(/\s+/g, ' ').trim();
    }
    if (!noun) return null;
    const count = Math.min(spans.length, ordinals.length);
    return Array.from({ length: count }, (_, i) => {
        const mark = ordinals[i][0].replace(/\s+/g, '');
        const bit = text.slice(spans[i].index, spans[i].index + spans[i].length);
        return `${noun} ${mark} ${bit}`.replace(/\s+/g, ' ').trim();
    });
}

function clockMatches(text) {
    return [...String(text).matchAll(new RegExp(TIME_BIT, 'g'))];
}

const APPLY_PHRASE = /참가\s*접수|참여\s*접수|참가\s*신청|참여\s*신청|접수\s*마감|신청\s*마감|신청|접수/;

function dueSpanOf(text, spans) {
    const byTail = spans.find((span) => /^\s*(?:까지|마감)/.test(text.slice(span.index + span.length)));
    if (byTail) return byTail;
    return spans.find((span) => /(?:마감|까지)\s*(?:은|는|이|가)?\s*$/.test(text.slice(0, span.index))) || null;
}

/** 쉼표 없이 행사 날짜와 참가 신청·접수 마감이 이어지면 일정과 할 일을 나눕니다. */
function gluedApplicationChunks(text, now, spans) {
    if (spans.length !== 2 || isRangePair(text, spans) || isReschedule(text, spans)) return null;
    const due = dueSpanOf(text, spans);
    if (!due) return null;
    const event = spans.find((span) => span !== due);
    if (!event || event.ymd === due.ymd) return null;
    const earlier = event.index < due.index ? event : due;
    const later = earlier === event ? due : event;
    const middle = text.slice(earlier.index + earlier.length, later.index);
    const middleApply = middle.match(APPLY_PHRASE);
    const tailApply = text.slice(due.index + due.length).match(/^\s*까지\s*(접수|신청)/);
    if (!middleApply && !tailApply) return null;
    const phrase = (middleApply ? middleApply[0] : tailApply[1]).replace(/\s*마감$/, '').replace(/\s+/g, ' ').trim();
    if (!phrase) return null;
    const aroundEvent = middleApply
        ? (event.index < due.index ? middle.slice(0, middleApply.index) : middle.slice(middleApply.index + middleApply[0].length))
        : middle;
    const fair = aroundEvent.match(/([가-힣]{1,8})\s*박람회/);
    const name = fair ? `${fair[1]} 박람회` : tidyTitle(aroundEvent);
    if (!name || weakTitle(name)) return null;
    const eventBlob = `${name} ${aroundEvent}`;
    if (!hasEvent(eventBlob) && !hasTrip(eventBlob) && !/(?:축제|대회|설명회|박람회|연수|체험|수련|경시)/.test(eventBlob)) return null;
    const eventToken = text.slice(event.index, event.index + event.length);
    const dueToken = text.slice(due.index, due.index + due.length);
    return [
        `\u0007${name} ${eventToken}`.replace(/\s+/g, ' ').trim(),
        `${name} ${phrase} ${dueToken}까지`.replace(/\s+/g, ' ').trim(),
    ];
}

function inclusiveDays(from, to) {
    const start = Date.UTC(Number(String(from).slice(0, 4)), Number(String(from).slice(5, 7)) - 1, Number(String(from).slice(8, 10)));
    const end = Date.UTC(Number(String(to).slice(0, 4)), Number(String(to).slice(5, 7)) - 1, Number(String(to).slice(8, 10)));
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
    return Math.round((end - start) / 86400000) + 1;
}

function toldDayCount(text) {
    if (/이틀(?:\s*간|\s*동안)?|양일(?:\s*간|\s*동안)?/.test(text)) return 2;
    if (/사흘(?:\s*간|\s*동안)?/.test(text)) return 3;
    if (/나흘(?:\s*간|\s*동안)?/.test(text)) return 4;
    const num = String(text || '').match(/(\d+)\s*일\s*(?:간|동안)/);
    return num ? Number(num[1]) : 0;
}

/** '11/2과 11/3 이틀간'처럼 과·와로 이은 날짜가 며칠과 맞으면 기간 일정 하나입니다. */
function joinedDaySpan(text, now) {
    const spans = findDates(text, now);
    if (spans.length !== 2 || isRangePair(text, spans) || isReschedule(text, spans)) return null;
    const between = text.slice(spans[0].index + spans[0].length, spans[1].index);
    if (!/^\s*[과와]\s*$/.test(between)) return null;
    const told = toldDayCount(text);
    if (!told || told !== inclusiveDays(spans[0].ymd, spans[1].ymd)) return null;
    const tail = text.slice(spans[1].index + spans[1].length)
        .replace(/(?:이틀|사흘|나흘|양일|\d+\s*일)\s*(?:간|동안)?/g, ' ')
        .replace(/(?:을|를)?\s*(?:진행합니다|확인합니다|합니다|해요|갑니다|엽니다|봅니다)\s*$/g, ' ');
    const name = tidyTitle(tail);
    if (!name || weakTitle(name)) return null;
    const startTok = text.slice(spans[0].index, spans[0].index + spans[0].length);
    const endTok = text.slice(spans[1].index, spans[1].index + spans[1].length);
    return [`\u0007${name} ${startTok}~${endTok}`.replace(/\s+/g, ' ').trim()];
}

/** 행사 날짜와 신청 마감이 나뉘면 일정과 할 일을 각각 만듭니다. */
function applicationDeadlineChunks(text, now) {
    const spans = findDates(text, now);
    if (spans.length < 2) return null;
    if (!/[,，]/.test(text)) return gluedApplicationChunks(text, now, spans);
    const parts = text.split(/\s*[,，]\s*/).map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return null;
    const dueIndex = parts.findIndex((part) => /(?:신청|접수)/.test(part) && /까지/.test(part) && findDates(part, now).length === 1);
    if (dueIndex < 0) return null;
    const eventPart = parts.find((part, index) => index !== dueIndex && findDates(part, now).length && (hasEvent(part) || EVENT_WORD.test(part) || hasTrip(part)));
    if (!eventPart) return null;
    const name = tidyTitle(eventPart);
    if (!name || weakTitle(name)) return null;
    const due = parts[dueIndex];
    const dueSpan = findDates(due, now)[0];
    const token = due.slice(dueSpan.index, dueSpan.index + dueSpan.length);
    return parts.map((part) => {
        if (part === due) return `${name} 신청 ${token}까지`;
        if (part === eventPart) return `\u0007${part}`;
        return findDates(part, now).length ? `\u0007${part}` : '';
    }).filter(Boolean);
}

/** 쉼표, 오전/오후, 예선/본선으로 나뉜 문장은 항목을 따로 둡니다. */
function listChunks(text, now) {
    const spans = findDates(text, now);
    if (isReschedule(text, spans) || (isRangePair(text, spans) && !/,/.test(text))) return null;
    const commaBetween = spans.length >= 2 && spans.some((span, index) => index > 0 && /,/.test(text.slice(spans[index - 1].index + spans[index - 1].length, span.index)));
    const ampm = /오전/.test(text) && /오후/.test(text);
    const heat = /예선/.test(text) && /본선/.test(text);
    if (!commaBetween && !ampm && !heat) return null;
    if (!/,/.test(text) && ampm && clockSpan(text)) return null;
    let parts;
    if (/,/.test(text) && (commaBetween || ampm || heat)) parts = text.split(/\s*,\s*/).map((part) => part.trim()).filter(Boolean);
    else {
        const at = text.search(ampm ? /오후/ : /본선/);
        if (at <= 0) return null;
        parts = [text.slice(0, at).trim(), text.slice(at).trim()];
    }
    if (parts.length < 2) return null;
    if (parts.every((part) => /제출|회신|까지/.test(part))) return null;
    const host = parts.find((part) => findDates(part, now).length);
    const hostSpan = host ? findDates(host, now)[0] : null;
    const token = hostSpan ? host.slice(hostSpan.index, hostSpan.index + hostSpan.length) : '';
    return parts.map((part) => {
        const body = findDates(part, now).length || !token ? part : `${token} ${part}`;
        return `\u0007${body}`;
    });
}

/** 취소된 행사는 빼 두고, 대체 행사만 일정으로 남깁니다. */
function replaceChunks(text) {
    if (!/취소/.test(text) || !/대체/.test(text)) return null;
    const matched = String(text).match(/^([\s\S]*?)취소되고\s*([\s\S]*)$/);
    if (!matched) return null;
    const cancelled = `${matched[1]}취소`.replace(/\s+/g, ' ').trim();
    const next = matched[2]
        .replace(/(?:으로|로)\s*대체(?:됩니다|합니다|되었(?:습니다|어요)|됐어요|됨|해요)?/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!next) return null;
    return [cancelled, `\u0005${next}`];
}

/** 이동·나열·대체가 아니면 날짜와 시각 후보를 모두 빼 둡니다. */
function unsureChunks(text, now) {
    const units = temporalUnits(text, findDates(text, now));
    const days = new Set(units.flatMap((unit) => unit.spans.map((span) => span.ymd)));
    if (units.length >= 2 && days.size >= 2) {
        return units.map((unit, index) => {
            const from = index === 0 ? 0 : units[index - 1].end;
            return `\u0001${text.slice(from, unit.end).trim()}`;
        });
    }
    const clocks = clockMatches(text);
    if (clocks.length < 2) return null;
    if (clocks.length === 2 && clockSpan(text)) return null;
    const bare = text.replace(new RegExp(TIME_BIT, 'g'), ' ');
    return clocks.map((match) => `\u0001${bare} ${match[0]}`.replace(/\s+/g, ' ').trim());
}

/** 부정 문장 뒤에 날짜만 있으면 그 일정의 날짜로 붙입니다. */
function bindTrailingDates(parts, now) {
    const out = [];
    for (let i = 0; i < parts.length; i += 1) {
        const cur = parts[i];
        const next = parts[i + 1];
        const nextTitle = next ? tidyTitle(next) : '';
        if (next && negatedClause(cur) && !findDates(cur, now).length && findDates(next, now).length && (!nextTitle || weakTitle(nextTitle))) {
            out.push(`${cur.replace(/[.。]\s*$/, '')} ${next}`.replace(/\s+/g, ' ').trim());
            i += 1;
            continue;
        }
        out.push(cur);
    }
    return out;
}

function clauseNoun(text, now) {
    const spans = findDates(text, now);
    if (!spans.length) return '';
    const head = tidyTitle(text.slice(0, spans[0].index));
    if (head && !weakTitle(head)) return head;
    const whole = tidyTitle(text);
    if (whole && !weakTitle(whole)) return whole;
    return '';
}

/** 작년 뒤에 올해·이번이 다시 나오면 그 구절은 따로 둡니다. 이름은 날짜가 있는 쪽에서 가져옵니다. */
function yearRestartChunks(text, now) {
    const clean = String(text || '').replace(/^[\u0001\u0007]/, '');
    const comparable = clean.replace(/작년처럼|지난해처럼|작년과\s*달리|지난해와\s*달리|작년와\s*달리|지난해과\s*달리/g, ' ');
    if (!/(?:작년|지난해|지난\s*해|재작년)/.test(comparable)) return null;
    const at = clean.search(/올해|이번에/);
    if (at <= 0) return null;
    const left = clean.slice(0, at).replace(/[,，]\s*$/, '').trim();
    const rightRest = clean.slice(at).trim();
    if (!findDates(left, now).length || !findDates(rightRest, now).length) return null;
    const rightCore = rightRest.replace(/^(?:올해|이번에)(?:는|은|의|에)?\s*/, '').trim();
    const leftNoun = clauseNoun(left, now);
    const rightNoun = clauseNoun(rightCore, now);
    const leftText = leftNoun ? left : (rightNoun ? `${rightNoun} ${left}` : left);
    const rightText = rightNoun ? rightCore : (leftNoun ? `${leftNoun} ${rightCore}` : rightCore);
    return [`\u0006${leftText.replace(/\s+/g, ' ').trim()}`, `\u0007${rightText.replace(/\s+/g, ' ').trim()}`];
}

/** 기간 뒤의 '이니'가 제출·회신을 시키면 기간 일정과 마지막 날 할 일을 같이 만듭니다. */
function untilIniChunks(text, now) {
    const spans = findDates(text, now);
    const range = temporalUnits(text, spans).find((unit) => unit.spans.length > 1);
    if (!range) return null;
    const start = range.spans[0];
    const end = range.spans[range.spans.length - 1];
    const after = text.slice(end.index + end.length);
    if (!/(?:까지\s*)?이니/.test(after)) return null;
    const when = text.slice(start.index, end.index + end.length);
    const head = tidyTitle(text.slice(0, start.index));
    const tailRaw = after.replace(/(?:까지\s*)?이니/g, ' ');
    const tail = tidyTitle(tailRaw);
    const name = head || tail;
    if (!name) return null;
    const handed = tailRaw.match(/([가-힣]{1,12})\s*(?:을|를)?\s*내\s*(?:주세요|주세|세요)/);
    const verbSubmit = /제출|회신|작성|입력|업로드|마감/.test(tail);
    if (!handed && !verbSubmit && !/까지\s*이니/.test(text)) return null;
    const dueName = handed
        ? `${handed[1]} 제출`
        : (verbSubmit
            ? [String(head || '').replace(/(?:^|\s)공모(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim(), tail].filter(Boolean).join(' ')
            : name);
    const endToken = text.slice(end.index, end.index + end.length);
    return [
        `\u0007${name} ${when}`.replace(/\s+/g, ' ').trim(),
        `${dueName} ${endToken}까지`.replace(/\s+/g, ' ').trim(),
    ];
}

/** 기간의 끝이 마감이면 날짜를 나눠 노란 카드로 만들지 않습니다. */
function periodEndDeadline(text, now) {
    if (!/(제출|회신|작성|입력|업로드|마감)/.test(text)) return false;
    if (!/까지|마지막\s*날/.test(text)) return false;
    const units = temporalUnits(text, findDates(text, now));
    const range = units.find((unit) => unit.spans.length > 1);
    if (!range) return false;
    const startYmd = range.spans[0].ymd;
    const endYmd = range.spans[range.spans.length - 1].ymd;
    return units.every((unit) => unit.spans.every((span) => span.ymd === startYmd || span.ymd === endYmd));
}

function segmentsOf(text, now) {
    const lines = String(text || '').replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n').split('\n');
    const chunks = [];
    lines.forEach((line) => {
        const trimmed = cleanLine(line);
        if (noise(trimmed)) return;
        explodeLine(trimmed).forEach((part) => {
                bindTrailingDates(toldDeadline(splitSentences(part), now), now).forEach((sentence) => {
                const trimmedSentence = sentence.trim();
                if (noise(trimmedSentence)) return;
                const noticed = splitNoticeRequest(trimmedSentence, now);
                if (noticed) {
                    chunks.push(noticed[0]);
                    chunks.push(`\u0001${noticed[1]}`);
                    return;
                }
                const restartedEarly = yearRestartChunks(trimmedSentence, now);
                if (restartedEarly) {
                    restartedEarly.forEach((piece) => chunks.push(piece));
                    return;
                }
                splitClauses(trimmedSentence, now).forEach((clause) => chunks.push(clause));
            });
        });
    });
    return chunks.flatMap((chunk) => {
        if (String(chunk).startsWith('\u0001')) return splitByDate(chunk, now);
        const prepared = applyTimeShift(chunk) || chunk;
        const replaced = replaceChunks(prepared);
        if (replaced) return replaced;
        const moved = rescheduleChunks(prepared, now);
        if (moved) return moved;
        if (danglingMove(prepared, now)) return [`\u0001${prepared}`];
        const restarted = yearRestartChunks(prepared, now);
        if (restarted) return restarted;
        const ini = untilIniChunks(prepared, now);
        if (ini) return ini;
        if (periodEndDeadline(prepared, now)) return [prepared];
        const applied = applicationDeadlineChunks(prepared, now);
        if (applied) return applied;
        const joined = joinedDaySpan(prepared, now);
        if (joined) return joined;
        const listed = ordinalChunks(prepared, now) || listChunks(prepared, now);
        if (listed) return listed;
        const plain = String(prepared).replace(/[\u0001\u0002\u0003\u0005\u0007]/g, '');
        if (personalAside(plain)) return [plain];
        const unsure = unsureChunks(prepared, now);
        if (unsure) return unsure;
        return splitByDate(prepared, now);
    });
}

function isDeadlineSubmission(text) {
    if (!hasDeadline(text)) return false;
    if (!/(제출|회신|작성|입력|업로드|마감|회수|탑재)/.test(text)) return false;
    if (/\d\s*[~～\-–—,·]\s*\d\s*교시(?!\s*까지)/.test(text)) return false;
    if (/(?<![,\d])\d\s*교시(?!\s*까지)/.test(text)) return false;
    return true;
}

const CASUAL_RE = /맛있|챙기|화이팅|우산|미세먼지|날씨|예쁘|기대|드세|한잔|커피|쉬어|하늘|비\s*온|산책|목도리|맑/;
const EMOTICON_RE = /ㅎㅎ|ㅋㅋ|ㅠㅠ|ㅜㅜ|ㅋ{2,}|ㅎ{2,}|(?<![\d~～])[~～](?![\d~～])|[~～]\s*$/;
const SOCIAL_RE = /생신|생일|축하|결혼|청첩장|결혼식|🎂|🎉|🎁|💐|😊|❤️|❤|🙏|👏/;

function hasWorkCue(text) {
    const src = String(text || '');
    if (hasTodo(src) || isRequest(src) || hasEvent(src) || /\d\s*교시/.test(src)) return true;
    if (findDates(src).length >= 2) return true;
    const when = detectWhen(src);
    return Boolean(when.hmEnd && findDates(src).length);
}

/** 저·제가 자기 휴가·연가·출장을 라서·이어서·입니다로 이으면 그 날짜는 업무 일정이 아닙니다. */
function personalAside(text) {
    const src = String(text || '');
    const speaker = /(?<![가-힣])(?:제가|저(?:는|도|만)?)(?![가-힣])/.test(src);
    if (!speaker) return false;
    const own = src.replace(/수학여행|현장체험학습|체험학습/g, ' ');
    const ownAbsence = /(?<![가-힣])(?:연차|연가|병가|조퇴|휴가|외출|공가|여행|출장)(?!\s*(?:신청|접수|마감|연수|교육|복명|결재|대체|계획|사용|명단|자료|양식))\s*(?:이라서요|라서요|이니까|니까|이라서|이어서|라서|여서|이라|라|입니다|이에요|예요|에요|에는|쓰는|인(?![가-힣])|하고|고(?![가-힣])|니(?![가-힣])|가요|갈게요|갑니다|갈\s*거|쓸게요|씁니다|합니다|해요)/.test(own);
    if (ownAbsence) return true;
    if (hasTodo(src) || isRequest(src) || hasEvent(src) || /\d\s*교시/.test(src)) return false;
    return /(?:가요|갈게요|올게요|사올|다녀올)/.test(src);
}

function casualTalk(text) {
    const src = String(text || '');
    if (personalAside(src)) return true;
    if (hasWorkCue(src)) return false;
    if (SOCIAL_RE.test(src)) return true;
    return EMOTICON_RE.test(src) || CASUAL_RE.test(src);
}

function actionable(text) {
    if (casualTalk(text)) return false;
    if (hasTodo(text) || hasEvent(text)) return true;
    const when = detectWhen(text);
    if (when.period || when.hmEnd) return true;
    if (findDates(text).length) return true;
    return false;
}

function sideNote(chunk) {
    const text = String(chunk || '').trim();
    if (!text || hasTodo(text) || hasScheduledExam(text)) return '';
    if (hasTrip(text) && findDates(text).length) return '';
    if (/^\d+\s*박\s*\d+\s*일$/.test(text)) return text.replace(/\s+/g, ' ');
    const duration = text.match(/^(\d+\s*박\s*\d+\s*일)\s+(.+)$/);
    if (duration) {
        const place = placeMemo(duration[2]);
        if (place) return `${duration[1].replace(/\s+/g, ' ')} · ${place}`;
    }
    const place = placeMemo(text);
    if (place && !findDates(text).length) return place;
    return '';
}

function bareVerb(chunk) {
    return /^(?:제출|회신|작성|입력|업로드|마감|회수)$/.test(tidyTitle(chunk).replace(/\s+/g, ''));
}

function dateCarrier(chunk) {
    if (!findDates(chunk).length) return false;
    const stripped = String(chunk).replace(/^(?:일시|기간|일정|시간|날짜|검진일|검사일|실시일)\s*[:：]\s*/, '');
    return weakTitle(tidyTitle(stripped));
}

/** 날짜 없는 앞 문장이 누구의 상담인지 말할 때, 뒤의 회신 요청 제목에 그 이름을 남깁니다. */
function isPersonContext(text) {
    const src = String(text || '').trim();
    if (!src || findDates(src).length || detectWhen(src).hm || detectWhen(src).period) return false;
    if (hasTodo(src) || isRequest(src) || hasEvent(src)) return false;
    return /[가-힣]{2,4}(?:이|가)\s/.test(src) && /상담|면담/.test(src);
}

function attachContext(chunks) {
    const out = [];
    for (let i = 0; i < chunks.length; i += 1) {
        const next = chunks[i + 1];
        if (next && isPersonContext(chunks[i]) && isRequest(next) && findDates(next).length) {
            out.push(`${String(chunks[i]).replace(/[.。]\s*$/, '')} ${next}`);
            i += 1;
            continue;
        }
        out.push(chunks[i]);
    }
    return out;
}

function foldChunks(chunks) {
    const blocks = [];
    chunks.forEach((chunk) => {
        const note = sideNote(chunk);
        if (note && blocks.length) {
            blocks[blocks.length - 1].notes.push(note);
            return;
        }
        if (dateCarrier(chunk) && blocks.length && !findDates(blocks[blocks.length - 1].text).length && !hasTodo(blocks[blocks.length - 1].text)) {
            blocks[blocks.length - 1].text = `${blocks[blocks.length - 1].text}\n${chunk}`;
            return;
        }
        const heading = tidyTitle(chunk);
        if (blocks.length && dateCarrier(blocks[blocks.length - 1].text) && heading && !weakTitle(heading) && !findDates(chunk).length && !hasTodo(chunk)) {
            blocks[blocks.length - 1].text = `${chunk}\n${blocks[blocks.length - 1].text}`;
            return;
        }
        if (bareVerb(chunk) && blocks.length && !bareVerb(blocks[blocks.length - 1].text)) {
            const prevHasDate = findDates(blocks[blocks.length - 1].text).length > 0;
            const chunkHasDate = findDates(chunk).length > 0;
            if (!(prevHasDate && chunkHasDate)) {
                blocks[blocks.length - 1].text = `${blocks[blocks.length - 1].text}\n${chunk}`;
                return;
            }
        }
        blocks.push({ text: chunk, notes: [] });
    });
    return blocks;
}

/** 이 구절이 전체 글의 어디에 있는지, 날짜 앞의 글을 돌려줍니다. */
function textBeforeSpan(fullText, source, span) {
    const body = String(source || '');
    const local = body.slice(0, span.index);
    const full = String(fullText || '');
    const trimmed = body.trim();
    if (!full || !trimmed || full === body) return local;
    const lead = body.indexOf(trimmed);
    const at = full.indexOf(trimmed);
    if (at < 0) return local;
    return full.slice(0, Math.max(0, at - lead + span.index));
}

/** 공유했다는 지난 말은 빼고, 뒤의 마감에는 서류 이름만 붙입니다. */
function toldDeadline(parts, now) {
    const out = [];
    for (let i = 0; i < parts.length; i += 1) {
        const cur = String(parts[i] || '');
        const next = parts[i + 1];
        const told = /공유\s*드렸|공유했(?:습니다|어요)?/.test(cur);
        if (told && next && hasDeadline(next) && /제출|회신|작성|입력|업로드/.test(next) && findDates(cur, now).length) {
            const named = cur.match(/((?:[가-힣]{2,8}\s+)?)복명서/);
            const noun = named ? named[0].replace(/\s+/g, ' ').trim() : tidyTitle(cur.replace(/공유[\s\S]*$/, ' '));
            out.push(`${noun} ${next}`.replace(/\s+/g, ' ').trim());
            i += 1;
            continue;
        }
        out.push(cur);
    }
    return out;
}

/** 절의 끝 서술어가 과거이면 지난 행사입니다. 못 간처럼 꾸미는 과거는 서술어가 아닙니다. */
function pastPredicate(text) {
    const end = String(text || '').replace(/[\s.。!！?？~～]+$/g, '');
    return /(?:했(?:습니다|어요|다|죠)|하였(?:습니다|어요)|열(?:었|렸)(?:습니다|어요|다)|진행(?:됐|되었|했)(?:어요|습니다|다)?|였(?:습니다|어요|죠|다)|(?:이|있)?었(?:습니다|어요|죠|다)|다녀왔(?:습니다|어요)|갔(?:습니다|어요|다)|됐(?:어요|습니다)|되었(?:습니다|어요|다)|했었(?:죠|습니다|어요)?)$/.test(end);
}

/** 날짜 바로 뒤의 자료·사진·영상·결과는 과거 행사를 가리킵니다. */
function materialAfterDate(text) {
    return findDates(text).some((span) => /^\s*(?:자료|사진|영상|결과)(?:은|는|이|가|을|를|도|만)?(?![가-힣])/.test(String(text).slice(span.index + span.length)));
}

/** 작년·지난해 절은 서술어가 과거나, 날짜 뒤가 자료·사진이거나, 올해와 대비될 때만 지난 행사입니다. */
function pastEventYears(segment, contrastPast = false) {
    const src = String(segment || '').replace(/\u0006/g, '');
    const comparable = src.replace(/(?:재작년|작년|지난해|지난\s*해)(?:보다|처럼|과\s*달리|와\s*달리)/g, ' ');
    const found = comparable.match(/재작년|작년|지난해|지난\s*해/);
    if (!found) return 0;
    if (!pastPredicate(src) && !materialAfterDate(src) && !contrastPast) return 0;
    return found[0] === '재작년' ? 2 : 1;
}

/** 작년·지난해·재작년 바로 다음이 날짜일 때만 해를 바꿉니다. 조사만 허용하고, 그 사이 말은 올해로 둡니다. */
function lastYearShift(before) {
    const comparable = String(before || '');
    const cut = Math.max(comparable.lastIndexOf('올해'), comparable.lastIndexOf('이번에'));
    const scope = cut >= 0 ? comparable.slice(cut).replace(/^(?:올해|이번에)/, '') : comparable;
    const word = /재작년|작년|지난해|지난\s*해/g;
    let last = null;
    let found = word.exec(scope);
    while (found) {
        last = found;
        found = word.exec(scope);
    }
    if (!last) return null;
    const rest = scope.slice(last.index + last[0].length);
    if (!/^(?:에는|에도|엔|에|는|은|의)?\s*$/.test(rest)) return null;
    return last[0] === '재작년' ? 2 : 1;
}

/** 날짜에 바로 붙은 지난번·지난. 요일 표현의 지난주는 주 계산이 맡습니다. */
function adjacentYear(before) {
    if (/재작년\s*$/.test(before)) return 2;
    if (/(?:작년|지난해|지난\s*해)\s*$/.test(before)) return 1;
    if (/지난번\s*$/.test(before)) return 0;
    if (/지난\s*$/.test(before)) return -1;
    return null;
}

function yearCue(source, span, fullText = '') {
    const token = source.slice(span.index, span.index + span.length);
    const local = source.slice(0, span.index);
    const wide = textBeforeSpan(fullText, source, span);
    const shifted = lastYearShift(wide || local);
    if (/요일/.test(token) && !/\d/.test(token)) return shifted;
    if (shifted != null) return shifted;
    return adjacentYear(local);
}

/** 문장 끝이 질문이면 넣지 않습니다. 확인을 구하는 '죠?' 뒤에 마감·지시가 있으면 넣습니다. */
function asksQuestion(text) {
    const src = String(text || '').trim();
    const rhetorical = /(?:죠|지요)\s*[?？]/.test(src);
    const directed = rhetorical && hasDeadline(src) && /제출|회신|작성|입력|업로드|마감|내\s*주|내\s*세/.test(src);
    if (directed) return false;
    if (/[?？][\s"'')」』]*$/.test(src)) return true;
    return /(?:나요|가요|까요)[\s?？.。!！]*$/.test(src);
}

/** 새 날짜 없이 행사를 미루기만 하면 그 날은 열리지 않습니다. '연기하지 않고'와 날짜 이동은 그대로 둡니다. */
function postponedWithoutDestination(text) {
    const src = String(text || '');
    if (/연기(?:하지\s*않|\s*없이)/.test(src)) return false;
    if (!/(?<![가-힣])연기(?:되었|됐습니다|됩니다|합니다|했어요|함|됨|됐어요|되었어요)/.test(src)) return false;
    const spans = findDates(src);
    return !(spans.length >= 2 && isReschedule(src, spans));
}

/** 행사를 없앤다는 취소만 해당합니다. '취소하지 않습니다'와 '취소 없이'는 그대로 둡니다. */
function eventCancelled(text) {
    const src = String(text || '');
    if (/취소(?:하지|\s*않|\s*없이)/.test(src)) return false;
    return /(?<![가-힣])취소/.test(src);
}

/** 행사 명사·동사에 붙은 무산·못함·어려움·취소만 빼 둡니다. 잊지 못하게, 빠지지 말고, 못 오시는 회신은 그대로 둡니다. */
function negatedClause(text) {
    const src = String(text || '');
    if (/미실시|미개최/.test(src)) return true;
    if (/(?<![가-힣])무산/.test(src)) return true;
    if (/(?:진행|실시|개최|열리|운영)(?:이|가|은|는)?\s*어렵/.test(src)) return true;
    if (/(?:열리|개최되|진행되|실시되|개최하|진행하|실시하|(?<![가-힣])하)지\s*못(?:하|합|해|함)/.test(src)) return true;
    if (/열리지\s*않/.test(src)) return true;
    if (eventCancelled(src)) return true;
    if (postponedWithoutDestination(src)) return true;
    if (/(?<![가-힣])안\s*(?:합니다|해요|함)(?![가-힣])/.test(src)) return true;
    const verb = '(?:진행하|실시하|개최하|(?<![가-힣])열|(?<![가-힣])하)';
    if (new RegExp(`${verb}지\\s*않(?:습니다|아요|는다|기로)`).test(src)) return true;
    if (new RegExp(`${verb}지\\s*않고`).test(src)) return false;
    if (/(?:없어요|없습니다)/.test(src) && !/운행|조회|스쿨버스|통학|급식/.test(src)) return true;
    return false;
}

/** 까지가 없는 초·중순·말과 경·쯤은 정확한 날이 아닙니다. 말일까지와 중으로, 경주는 그대로 둡니다. */
function approximateWhen(text) {
    const src = String(text || '');
    const edge = '(?:초|중순|말일|말(?!일))';
    if (new RegExp(`(?:이번\\s*달|이번달|이달|금월|다음\\s*달|다음달|내달)\\s*${edge}(?!\\s*까지)`).test(src)) return true;
    if (new RegExp(`(?<![가-힣\\d])월${edge}(?!\\s*까지)`).test(src)) return true;
    if (new RegExp(`\\d{1,2}\\s*월\\s*${edge}(?!\\s*까지)(?!\\s*인)(?![가-힣])`).test(src)) return true;
    if (/(?:일|\d|[)）]|요일)\s*경(?![가-힣])/.test(src)) return true;
    if (/쯤/.test(src)) return true;
    return false;
}

function buildItem(source, kind, now, periods, seq, extraNotes = [], fullText = '') {
    const contrastPast = String(source).includes('\u0006');
    source = String(source).replace(/\u0006/g, '');
    const placed = takePlace(source);
    const span = dateSpan(placed.text, now);
    let date = span.date;
    if (kind === '할 일' && span.range && /까지/.test(source)) date = span.end;
    const end = kind === '일정' && span.range ? span.end : null;
    const when = detectWhen(source, periods);
    const keepWords = isDeadlineSubmission(source) || (hasDeadline(source) && !span.range);
    const body = kind === '일정' || (hasEvent(source) && hasTodo(source) && keepWords)
        ? (kind === '일정' ? stripTodoClause(placed.text) : placed.text)
        : (kind === '할 일' && hasEvent(source) ? stripEventClause(placed.text) : placed.text);
    const title = finishTitle(pickTitle(body, source), source, fullText);
    const memoBits = [];
    if (placed.memo) memoBits.push(placed.memo);
    const duration = String(source).match(/\d+\s*박\s*\d+\s*일/);
    if (duration) memoBits.push(duration[0].replace(/\s+/g, ' '));
    extraNotes.forEach((note) => {
        const clean = String(note || '').trim();
        if (clean && !memoBits.includes(clean)) memoBits.push(clean);
    });
    if (when.period) memoBits.push(when.periodEnd ? `${when.period}~${when.periodEnd}교시` : `${when.period}교시`);
    const blob = `${title} ${placed.memo} ${extraNotes.join(' ')} ${source}`;
    const warning = [date?.warning, end?.warning].filter(Boolean).join(' ');
    const chatter = !actionable(source);
    const todayYmd = seoulYmd(now);
    const spans = findDates(source, now);
    const cueFor = (ymd) => spans
        .map((span) => ({ span, years: yearCue(source, span, fullText) }))
        .find((row) => row.years != null && row.span.ymd === ymd);
    const shiftYear = (ymd, cue) => {
        if (!ymd || !cue) return { ymd: ymd || '', remembered: false };
        let years = cue.years;
        const token = source.slice(cue.span.index, cue.span.index + cue.span.length);
        if (years < 0) years = ymd >= todayYmd ? 1 : 0;
        if (/\d{4}/.test(token)) years = 0;
        if (years > 0) {
            const shifted = `${Number(ymd.slice(0, 4)) - years}${ymd.slice(4)}`;
            if (isValidYmd(shifted)) return { ymd: shifted, remembered: true };
        }
        return { ymd, remembered: true };
    };
    const startShift = shiftYear(date?.ymd || '', cueFor(date?.ymd || ''));
    const endShift = end?.ymd ? shiftYear(end.ymd, cueFor(end.ymd)) : { ymd: '', remembered: false };
    const taleYears = (startShift.remembered || endShift.remembered) ? 0 : pastEventYears(source, contrastPast);
    const pushYear = (ymd) => {
        if (!ymd || !taleYears) return ymd;
        const shifted = `${Number(ymd.slice(0, 4)) - taleYears}${ymd.slice(4)}`;
        return isValidYmd(shifted) ? shifted : ymd;
    };
    const dateYmd = pushYear(startShift.ymd);
    const endYmd = pushYear(endShift.ymd);
    const toldPast = /공유\s*드렸|공유했(?:습니다|어요)?/.test(source) && !hasDeadline(source);
    const remembered = startShift.remembered || endShift.remembered || taleYears > 0 || toldPast;
    const lastDay = endYmd || dateYmd || '';
    const past = Boolean(lastDay && lastDay < todayYmd);
    const reference = /참고만/.test(source) || (/공유합니다/.test(source) && !/(?:회의|협의회)에서\s*공유합니다/.test(source));
    const asked = asksQuestion(source);
    const closed = negatedClause(source);
    const approx = approximateWhen(source);
    const assumed = when.assumedPm ? '오전·오후가 없어 오후로 봤어요.' : '';
    const missing = date || chatter ? '' : '날짜가 없어요. 달력에서 골라 주세요.';
    const aside = chatter ? '업무로 볼 말이 없어 빼 두었어요.' : '';
    const stale = past ? '지난 날짜라 빼 두었어요.' : '';
    const shared = reference ? '참고용이라 빼 두었어요.' : '';
    const cancelled = eventCancelled(source);
    const dropped = cancelled ? '취소된 내용이라 빼 두었어요.' : '';
    const recalled = remembered ? '지난 이야기라 빼 두었어요.' : '';
    const askedNote = asked ? '질문이라 빼 두었어요.' : '';
    const closedNote = closed && !cancelled ? '열리지 않는 내용이라 빼 두었어요.' : '';
    const approxNote = approx ? '날짜가 대략적이라 빼 두었어요.' : '';
    const notes = [warning, assumed, missing, aside, stale, shared, dropped, recalled, askedNote, closedNote, approxNote].filter(Boolean);
    let score = 0.45;
    if (date?.explicit) score += 0.25;
    else if (date) score += 0.15;
    else score -= 0.2;
    if (when.hm && !when.assumedPm) score += 0.15;
    if (when.assumedPm) score -= 0.15;
    if ((kind === '할 일' && (hasTodo(source) || isRequest(source))) || (kind === '일정' && hasEvent(source)) || (kind === '일정' && span.range)) score += 0.2;
    if (warning || chatter) score -= 0.25;
    const low = chatter || score < 0.7 || Boolean(warning) || when.assumedPm || !date || past || reference || cancelled || remembered || asked || closed || approx;
    let cleanTitle = title || (kind === '일정' ? '일정' : '할 일');
    if (FIELD_ONLY.test(String(cleanTitle).replace(/\s+/g, ''))) {
        const rescued = finishTitle('', source, fullText);
        if (rescued && !FIELD_ONLY.test(rescued.replace(/\s+/g, ''))) cleanTitle = rescued;
    }
    const clockKey = when.hmEnd ? `${when.hm}-${when.hmEnd}` : (when.hm || '');
    const key = `${kind}|${date?.ymd || ''}|${end?.ymd || ''}|${clockKey}|${cleanTitle}|${source.replace(/\s+/g, '')}|${seq}`;
    return {
        id: `msg${fnv1a32(key)}`,
        kind,
        eventKind: kind === '일정' ? guessEventKind(source) : '',
        title: cleanTitle,
        date: dateYmd,
        end: endYmd || '',
        time: when.hm || '',
        endTime: when.hmEnd || '',
        period: when.period || 0,
        periodEnd: when.periodEnd || 0,
        memo: memoBits.join(' · '),
        include: !low,
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
    const src = String(text || '');
    if (/(?:신청|접수)/.test(src)) return src;
    return src
        .replace(/교직원\s*회의|회의(?!록)|연수|공개수업|협의회|행사|출장/g, ' ')
        .replace(/장소\s*[:：]\s*[^\n,]+/g, ' ')
        .replace(/\d(?:\s*[,·~～\-–—]\s*\d)+\s*교시/g, ' ')
        .replace(/\d\s*교시/g, ' ');
}

function titlesOverlap(left, right) {
    const a = String(left?.title || '').replace(/\s+/g, '');
    const b = String(right?.title || '').replace(/\s+/g, '');
    if (!a || !b || (left?.date || '') !== (right?.date || '')) return false;
    if (a === b) return true;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    return shorter.length >= 4 && longer.includes(shorter);
}

function markUnsure(item, note) {
    return {
        ...item,
        low: true,
        include: false,
        warning: [item.warning, note].filter(Boolean).join(' '),
    };
}

function collapsePair(items, segment) {
    if (items.length < 2) return items;
    const [first, second] = items;
    if (!titlesOverlap(first, second)) return [first, markUnsure(second, '같은 문장에서 나눈 내용이라 빼 두었어요.')];
    const deliverable = /제출|회신|작성|입력|업로드|마감|탑재/.test(segment);
    const kept = deliverable ? (second.kind === '할 일' ? second : first) : (first.kind === '일정' ? first : second);
    const other = kept === first ? second : first;
    return [{
        ...kept,
        time: kept.time || other.time,
        endTime: kept.endTime || other.endTime,
        period: kept.period || other.period,
        periodEnd: kept.periodEnd || other.periodEnd,
        date: kept.date || other.date,
        end: kept.end || other.end,
    }];
}

function classifySegment(segment, now, periods, notes = [], fullText = '') {
    const rawSegment = String(segment || '');
    const unsure = rawSegment.includes('\u0001');
    const oldDate = rawSegment.includes('\u0002');
    const moved = rawSegment.includes('\u0003');
    const replacement = rawSegment.includes('\u0005');
    const listed = rawSegment.includes('\u0007');
    segment = rawSegment.replace(/[\u0001\u0002\u0003\u0005\u0007]/g, '');
    const todo = hasTodo(segment) || isRequest(segment);
    const event = hasEvent(segment) && !documentSubmission(segment);
    const when = detectWhen(segment, periods);
    const span = dateSpan(segment, now);
    const scope = (unsure || listed) ? segment : fullText;
    const make = (kind, seq) => buildItem(segment, kind, now, periods, seq, notes, scope);
    const made = (() => {
        if (replacement) return [make('일정', 0)];
        if (listed && !isDeadlineSubmission(segment) && !hasDeadline(segment)) return [make('일정', 0)];
        if ((moved || oldDate) && !isDeadlineSubmission(segment)) {
            if (/제출|회신|작성|입력|업로드|마감|회수|탑재|기한/.test(segment)) return [make('할 일', 0)];
            return [make('일정', 0)];
        }
        if (documentSubmission(segment) || isApplicationDeadline(segment)) return [make('할 일', 0)];
        if (hasDeadline(segment) && /(?:참가|참여|신청|접수)/.test(segment) && !span.range) return [make('할 일', 0)];
        if (/(?:학예회|설명회|상담\s*주간)/.test(segment) && !isDeadlineSubmission(segment)) return [make('일정', 0)];
        if (span.range && !isDeadlineSubmission(segment)) return [make('일정', 0)];
        if (isDeadlineSubmission(segment) || (hasDeadline(segment) && !span.range)) return [make('할 일', 0)];
        if (todo && event && !isDeadlineSubmission(segment) && /참석|참여/.test(segment) && !/(?:제출|회신|작성|입력|업로드|마감|회수|탑재)/.test(segment)) return [make('일정', 0)];
        if (todo && event) return collapsePair([make('일정', 0), make('할 일', 1)], segment);
        if (event || (when.hm && !todo)) return [make('일정', 0)];
        if (todo) return [make('할 일', 0)];
        if (!pickTitle(segment, segment)) return [];
        return [make('할 일', 0)];
    })();
    const distinctDates = new Set(findDates(segment, now).map((item) => item.ymd));
    const ambiguous = distinctDates.size > 1 && !span.range && !moved && !oldDate;
    const named = hasTodo(segment) || hasTrip(segment) || EVENT_WORD.test(segment) || /\d\s*교시/.test(segment) || /(?:대회|(?<![가-힣])(?:현장체험학습|현장학습|촬영|공사|상담|검사|평가|시험|소풍|발표))/.test(segment);
    const vague = made.map((item) => {
        const title = String(item.title || '').trim();
        const generic = /^(?:일정|할 일)$/.test(title) && !moved && !listed && !replacement && !oldDate && !span.range && !named;
        const leftover = /^(?:그대로|아니라|정정|졌습니다|됐습니다)$/.test(title.replace(/\s+/g, ''));
        if (!generic && !leftover) return item;
        if (item.low) return item;
        return markUnsure(item, '무엇의 일정인지 빼 두었어요.');
    });
    if (oldDate) return vague.map((item) => markUnsure(item, '예전 날짜라 빼 두었어요.'));
    if (ambiguous) return vague.map((item) => markUnsure(item, '날짜가 여러 개라 빼 두었어요.'));
    if (!unsure) return vague;
    return vague.map((item) => markUnsure(item, '같은 문장에서 나눈 내용이라 빼 두었어요.'));
}

/** @returns {{ items: object[] }} */
export function parseSchoolMessages(text, { now = new Date(), periods = DEFAULT_PERIODS } = {}) {
    const raw = String(text || '').trim();
    if (!raw) return { items: [] };
    const items = [];
    const seen = new Map();
    foldChunks(attachContext(segmentsOf(raw, now))).forEach((block) => {
        classifySegment(block.text, now, periods, block.notes, raw).forEach((item) => {
            if (!item.title) return;
            const n = (seen.get(item.id) || 0) + 1;
            seen.set(item.id, n);
            items.push(n === 1 ? item : { ...item, id: `msg${fnv1a32(`${item.id}#${n}`)}` });
        });
    });
    if (!items.some((item) => item.date)) return { items };
    return { items: items.filter((item) => item.date || item.time || /취소/.test(item.warning)) };
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
