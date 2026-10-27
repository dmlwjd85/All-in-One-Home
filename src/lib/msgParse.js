// 학교 문자를 기기 안에서 일정·할 일로 나눕니다. 바깥 AI는 쓰지 않습니다.
import { isValidYmd, seoulYmd } from './date.js';
import { findDates, WEEK_MARK, WEEK_TAIL } from './parse.js';
import { isSensitiveText } from './sensitive.js';
import { DEFAULT_PERIODS } from './period.js';

export const EVENT_KINDS = ['학급', '학교', '휴일', '내 일정'];
export const MEET_KINDS = ['학년회의', '교직원회의', '교과협의회', '학부모회의', '연수'];

const TODO_RE = /제출|회신|작성|입력|업로드|탑재|확인\s*바랍니다|기한|마감/;
const EVENT_WORD = /회의(?!록)|연수|공개수업|협의회|(?<![가-힣])협의(?!서)|행사|출장/;
const EVENT_NOUN = '(?:복명\\s*회의|보고회|발표회|리허설|설명회|학예회|협의회|공개수업|체육대회|운동회|현장학습|체험학습|전시회|박람회|수련회|축제|대회|연수|행사|상담|강연|회의(?!록))';
const MAGAM_EVENT_TAIL = `(?:(?:시간|안내|[가-힣]{1,8})\\s+){0,3}${EVENT_NOUN}`;

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
    const tilde = src.match(/(?<!\d)(10|\d)\s*[~～\-–—]\s*(10|\d)\s*교시/);
    const comma = src.match(/(?<!\d)(10|\d)\s*[,·]\s*(10|\d)\s*교시/);
    const range = tilde || (comma && Math.abs(Number(comma[1]) - Number(comma[2])) === 1 ? comma : null);
    const one = src.match(/(?<!\d)(10|\d)\s*교시/);
    if (range) {
        out.period = Number(range[1]);
        out.periodEnd = Number(range[2]);
        out.hm = starts[out.period - 1] || '';
        out.label = `${out.period}~${out.periodEnd}교시`;
    } else if (one && Number(one[1]) >= 1 && Number(one[1]) <= 10 && starts[Number(one[1]) - 1]) {
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
    if (/(?<![가-힣])(?:학예회|설명회|박람회|리허설|전시회|보고회|총회|공유회)|결과물\s*발표회|상담\s*주간/.test(text)) return true;
    if (/(?<![가-힣])발표회/.test(text) && /(?:합니다|해요|엽니다|있습니다)/.test(text) && !isRequest(text) && !isDeadlineSubmission(text)) return true;
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

/** 작년 영상·자료를 삭제하라는 할 일만 해 표시를 제목에 남깁니다. */
function keepsPastMaterialYear(text) {
    return /(?:재작년|작년|지난해|지난\s*해).{0,40}(?:녹화본|녹화|결과물|자료집|사진첩|자료|사진|영상).{0,24}삭제/.test(String(text || ''));
}

/** 제목에 남는 조사·연도·대략 조각. 취소되었다는 말 자체는 제목에 둡니다. */
function stripTitleNoise(text) {
    let s = String(text || '');
    if (!keepsPastMaterialYear(s)) {
        s = s.replace(/(?:재작년|작년|지난해|지난\s*해)(?:에는|에도|엔|도의|도|에|는|은|의|처럼|보다|과\s*달리|와\s*달리)?/g, ' ');
    }
    s = s.replace(/(?:올해|이번에)(?:는|은)?/g, ' ');
    s = s.replace(/(?<![가-힣])(?:내년|다음\s*해)(?:도|에는|에도|엔|에|는|은|의)?/g, ' ');
    s = s.replace(/예정이었던/g, ' ');
    s = s.replace(/(?:^|\s)(?:이었|였)던(?=\s|$)/g, ' ');
    s = s.replace(/기존\s*일정대로|기존대로/g, ' ');
    s = s.replace(/이었(?!던)(?:는데|고|습니다|어요|음)?/g, ' ');
    s = s.replace(/(?:^|\s)던(?=\s|$)/g, ' ');
    s = s.replace(/(?:^|\s)이니(?=\s|$)/g, ' ');
    s = s.replace(/예정이에요/g, ' ');
    s = s.replace(/\d{1,2}\s*월\s*(?:초|중순|말)\s*인/g, ' ');
    s = s.replace(/(?:이번\s*달|이번달|다음\s*달|다음달|내달)\s*(?:초|중순|말)\s*인/g, ' ');
    s = s.replace(/기간\s*내\s*응답|(?:^|\s)내\s*응답(?=\s|$)/g, ' ');
    s = s.replace(/(?:결석|취소)\s*없이/g, ' ');
    s = s.replace(/잊지\s*않으셨(?:죠|지요)\s*[?？]?/g, ' ');
    s = s.replace(/(?:^|\s)(?:꼭|독려|예정대로|원래대로|일정대로|우천\s*시에도)(?=\s|$)/g, ' ');
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
    t = t.replace(/(?:(?<![가-힣])제\s*)?(?:10|\d)\s*[~～\-–—]\s*(?:10|\d)\s*교시/g, ' ');
    t = t.replace(/(?:^|\s)[~～\-–—]+(?=\s|$)/g, ' ');
    t = t.replace(/ㅎㅎ|ㅋㅋ|ㅠㅠ|ㅜㅜ|ㅋ{2,}|ㅎ{2,}/g, ' ');
    t = t.replace(/(?<![\d~～])[~～]+(?![\d~～])/g, ' ');
    t = t.replace(/점심\s*시간|점심/g, ' ');
    if (afterSchoolIsClock(t)) t = t.replace(/방과\s*후(?:\s*에|\s*까지)?(?:\s*시간)?(?:에|까지)?/g, ' ');
    t = t.replace(/(?:(?<![가-힣])제\s*)?(?:10|\d)(?:\s*[,·]\s*(?:10|\d))+\s*교시/g, ' ');
    t = t.replace(/(?:(?<![가-힣])제\s*)?\d{1,2}\s*교시(?!\s*보결)(?:\s*까지)?/g, ' ');
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
    t = t.replace(/(?:이|가)?\s*임박(?:했습니다|했어요|합니다|해요|이에요|입니다)?/g, ' ');
    t = t.replace(/(?:이|가)?\s*다가\s*(?:옴|옵니다|와요|왔습니다)/g, ' ');
    t = t.replace(/마감\s*(?:되었(?:습니다|어요)?|됐습니다|됐어요|됨)|마감됐(?:어요|습니다)?/g, ' ');
    t = t.replace(/앞당겨(?:졌습니다|졌어요|집니다|요)?/g, ' ');
    t = t.replace(/연기된|연기한|미뤄진|미루어진/g, ' ');
    t = t.replace(/연기(?:됩니다|합니다|해요|됐(?:어요|습니다)|음|됨)?/g, ' ');
    t = t.replace(/미뤄(?:졌습니다|졌어요|집니다|요|짐|습니다)?/g, ' ');
    t = t.replace(/미룹니다|미뤄집니다|미루었습니다|미뤘(?:습니다|어요)?|미룸|미루겠(?:습니다|어요)?/g, ' ');
    t = t.replace(/(?:으로|로)?\s*(?:바꿉니다|바꿔요|바뀝니다|옮겨요|옮깁니다)/g, ' ');
    t = t.replace(/(?:에\s*)?오(?:세요|십시오|십시요)/g, ' ');
    t = t.replace(/[가-힣]{1,8}\s*선생님(?:이|께서)?\s*진행하는/g, ' ');
    t = t.replace(/(?:을|를)?\s*직접(?=\s|$)/g, ' ');
    t = t.replace(/(?:을|를)?\s*진행하(?:십니다|세요)/g, ' ');
    t = t.replace(/다음\s*으로/g, ' ');
    t = t.replace(/다음에\s*(?:하겠(?:습니다)?|합니다|해요|할게요|하자)?/g, ' ');
    t = t.replace(/(?<![가-힣])추후(?:로|에)?(?:\s*공지(?:로)?)?/g, ' ');
    t = t.replace(/하겠(?:습니다)?/g, ' ');
    t = t.replace(/(?:^|\s)날짜(?:은|는|이|가)?(?=\s|$)/g, ' ');
    t = t.replace(/[가-힣]{2,12}(?:선생님|님)께서/g, ' ');
    t = t.replace(/참석하(?:십니다|세요)/g, ' ');
    t = t.replace(/참석해\s*주(?:세요|십시요)/g, ' ');
    t = t.replace(/(?:^|\s)모두(?=\s|$)/g, ' ');
    t = t.replace(/[월화수목금토일]요일(?:으로|로)?/g, ' ');
    t = stripTitleNoise(t);
    t = t.replace(/(?:자료|사진|영상)\s*(?:는|은|이|가|을|를)?\s*(?:양식|서식|형식)(?:을|를|으로|로)?\s*(?:씁니다|써요|사용(?:합니다|해요)?|준비(?:합니다|해요)?)/g, ' ');
    t = t.replace(/(?:양식|서식|형식)(?:을|를|으로|로)?\s*(?:씁니다|써요|사용(?:합니다|해요)?|준비(?:합니다|해요)?)/g, ' ');
    if (!keepsPastMaterialYear(t)) t = t.replace(/(?:^|\s)(?:재작년|지난해|지난\s*해|작년|지난번|지난\s*달|지난달|내년|다음\s*해)(?=\s|$)/g, ' ');
    else t = t.replace(/(?:^|\s)(?:지난번|지난\s*달|지난달)(?=\s|$)/g, ' ');
    t = t.replace(/마감(?:은|는)(?![가-힣])/g, '마감');
    t = t.replace(/(?:^|\s)지난(?=\s|$)/g, ' ');
    t = t.replace(/(?:^|\s)(?:이었|였)던(?=\s|$)/g, ' ');
    t = t.replace(/마지막\s*날/g, ' ');
    t = t.replace(/쯤/g, ' ');
    t = t.replace(/(?:^|\s)경(?=\s|$)/g, ' ');
    t = t.replace(/\d{4}\s*년/g, ' ');
    t = t.replace(/까지/g, ' ');
    t = t.replace(/(?:^|\s)(?:예요|에요|이에요)(?=\s|$)/g, ' ');
    t = t.replace(/부터/g, ' ');
    t = t.replace(/에서/g, ' ');
    t = t.replace(/(?:^|\s)(?:그대로|아니라|정정)(?=\s|$)/g, ' ');
    t = t.replace(/(?:^|\s)대체(?!\s*업무)(?=\s|$)/g, ' ');
    t = t.replace(/연장(?:됩니다|합니다|되었(?:습니다|어요)|됐어요|됨)?/g, ' ');
    t = t.replace(/[()（）[\]{}·,.!~:：]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.replace(/(?:에\s*)?참석$/g, '').trim();
    t = t.replace(/(?:이|가)\s+(?:으로|로)(?=\s|$)/g, ' ');
    t = t.replace(/(?:^|\s)(?:으로|로)(?=\s|$)/g, ' ');
    t = t.replace(/(?:은|는|을|를)\s+(제출|회신|작성|입력|업로드|마감|회수|실시|운영|휴강|교체|탑재|삭제)(?=\s|$)/g, ' $1');
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
    t = t.replace(/점심\s*시간|(?:(?<![가-힣])제\s*)?\d{1,2}\s*교시(?!\s*보결)/g, ' ');
    t = t.replace(/(?:선생님들?\s*)?(?:항상\s*)?수고\s*많(?:으셨습니다|으십니다|습니다|으)/g, ' ');
    t = t.replace(/앞당겨(?:졌습니다|졌어요|집니다|요)?/g, ' ');
    t = t.replace(/연기된|연기한|미뤄진|미루어진/g, ' ');
    t = t.replace(/연기(?:됩니다|합니다|해요|됐(?:어요|습니다)|음|됨)?/g, ' ');
    t = t.replace(/미뤄(?:졌습니다|졌어요|집니다|요|짐|습니다)?/g, ' ');
    t = t.replace(/미룹니다|미뤄집니다|미루었습니다|미뤘(?:습니다|어요)?|미룸|미루겠(?:습니다|어요)?/g, ' ');
    t = t.replace(/(?:으로|로)?\s*(?:바꿉니다|바꿔요|바뀝니다|옮겨요|옮깁니다)/g, ' ');
    t = t.replace(/(?:에\s*)?오(?:세요|십시오|십시요)/g, ' ');
    t = t.replace(/[가-힣]{1,8}\s*선생님(?:이|께서)?\s*진행하는/g, ' ');
    t = t.replace(/(?:을|를)?\s*직접(?=\s|$)/g, ' ');
    t = t.replace(/(?:을|를)?\s*진행하(?:십니다|세요)/g, ' ');
    t = t.replace(/다음\s*으로/g, ' ');
    t = t.replace(/다음에\s*(?:하겠(?:습니다)?|합니다|해요|할게요|하자)?/g, ' ');
    t = t.replace(/(?<![가-힣])추후(?:로|에)?(?:\s*공지(?:로)?)?/g, ' ');
    t = t.replace(/하겠(?:습니다)?/g, ' ');
    t = t.replace(/(?:^|\s)날짜(?:은|는|이|가)?(?=\s|$)/g, ' ');
    t = t.replace(/[가-힣]{2,12}(?:선생님|님)께서/g, ' ');
    t = t.replace(/참석하(?:십니다|세요)/g, ' ');
    t = t.replace(/참석해\s*주(?:세요|십시요)/g, ' ');
    t = t.replace(/(?:^|\s)모두(?=\s|$)/g, ' ');
    t = t.replace(/[월화수목금토일]요일(?:으로|로)?/g, ' ');
    t = stripTitleNoise(t);
    if (!keepsPastMaterialYear(t)) t = t.replace(/(?:^|\s)(?:재작년|지난해|지난\s*해|작년|지난번|지난\s*달|지난달|내년|다음\s*해)(?=\s|$)/g, ' ');
    else t = t.replace(/(?:^|\s)(?:지난번|지난\s*달|지난달)(?=\s|$)/g, ' ');
    t = t.replace(/마감(?:은|는)(?![가-힣])/g, '마감');
    t = t.replace(/(?:^|\s)지난(?=\s|$)/g, ' ');
    t = t.replace(/(?:^|\s)(?:이었|였)던(?=\s|$)/g, ' ');
    t = t.replace(/마지막\s*날/g, ' ');
    t = t.replace(/쯤/g, ' ');
    t = t.replace(/(?:^|\s)경(?=\s|$)/g, ' ');
    t = t.replace(/부터/g, ' ');
    t = t.replace(/에서/g, ' ');
    t = t.replace(/(?:^|\s)(?:그대로|아니라|정정)(?=\s|$)/g, ' ');
    t = t.replace(/(?:^|\s)대체(?!\s*업무)(?=\s|$)/g, ' ');
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
    const head = full.slice(0, at);
    const breaks = [...head.matchAll(/[,，]|(?:이라서|라서|이니까|니까|이니|이고|이라)(?![가-힣])/g)];
    const from = breaks.length ? breaks[breaks.length - 1].index + breaks[breaks.length - 1][0].length : 0;
    return full.slice(from, at + trimmed.length).trim();
}

function finishTitle(title, segment, fullText) {
    const compact = String(title || '').replace(/\s+/g, '');
    const source = titleSource(segment, fullText);
    if (compact === '상담') {
        const richer = salvageTitle(source).split(/\s+/).map((word) => word.replace(/(?:은|는|이|가)$/, '')).filter((word) => word && word !== '상담' && !FIELD_ONLY.test(word) && !WEAK_TITLE.test(word));
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
const MOVE_VERB = /연기|미뤄|미루|미룹|미룬|앞당|순연|연장|변경|바뀌|바뀐|바꿉|바꿔|바뀝|옮겨|옮긴|옮깁/;
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

const PERIOD_VERB = '(?:변경|바뀌|바뀐|바꿉|바꿔|바뀝|옮깁|옮겨|옮긴|연기|미룹|미뤄|미룬)';
const PERIOD_VERB_TAIL = '(?:되었(?:습니다|어요)?|됐습니다|됩니다|합니다|했어요|니다|요|습니다)?';

/** 붙어 있는 교시만 범위로 묶습니다. 떨어진 교시는 그대로 두어 카드로 나눕니다. */
function listPeriodTokens(text) {
    return String(text || '').replace(/(?<!\d)(10|\d)\s*교시\s*(?:와|과|,|，)\s*(10|\d)\s*교시(?!\s*(?:에서|으로|로))/g, (all, left, right) => (
        Math.abs(Number(left) - Number(right)) === 1 ? `${left},${right}교시` : all
    ));
}

/** 2교시와 5교시, 2,5교시처럼 사이가 벌어진 교시는 교시마다 문장으로 나눕니다. */
function splitListedPeriods(text) {
    const src = String(text || '');
    const re = /(?<!\d)(10|\d)\s*교시\s*(?:와|과|,|，)\s*(10|\d)\s*교시(?!\s*(?:에서|으로|로))|(?<!\d)(10|\d)\s*[,·，]\s*(10|\d)\s*교시(?!\s*(?:에서|으로|로))/g;
    let found = null;
    let match = re.exec(src);
    while (match) {
        const left = match[1] || match[3];
        const right = match[2] || match[4];
        if (Math.abs(Number(left) - Number(right)) > 1) {
            found = { match, left, right };
            break;
        }
        match = re.exec(src);
    }
    if (!found) return [src];
    const head = src.slice(0, found.match.index);
    const tail = src.slice(found.match.index + found.match[0].length);
    return [
        ...splitListedPeriods(`${head}${found.left}교시${tail}`),
        ...splitListedPeriods(`${head}${found.right}교시${tail}`),
    ];
}

/** 날짜는 그대로 두고 교시만 바뀌면 뒤 교시가 시각입니다. 날짜가 둘이면 날짜 이동이 교시를 가집니다. */
function applyPeriodShift(text, now) {
    const src = String(text || '');
    if (findDates(src, now).length >= 2) return '';
    const pair = src.match(new RegExp(`(\\d)\\s*교시\\s*에서\\s*(\\d)\\s*교시\\s*(?:으로|로)`));
    let next = src;
    if (pair) {
        next = src.replace(pair[0], `${pair[2]}교시`);
    } else {
        const dest = src.match(new RegExp(`(\\d)\\s*교시\\s*(?:으로|로)\\s*${PERIOD_VERB}`));
        if (!dest) return '';
        const earlier = [...src.matchAll(/(\d)\s*교시/g)].filter((item) => item.index < dest.index && item[1] !== dest[1]);
        if (!earlier.length) return '';
        next = src;
        [...earlier].reverse().forEach((item) => {
            next = `${next.slice(0, item.index)} ${next.slice(item.index + item[0].length)}`;
        });
    }
    next = next.replace(new RegExp(`(?:으로|로)?\\s*${PERIOD_VERB}${PERIOD_VERB_TAIL}`, 'g'), ' ');
    next = next.replace(/\s+/g, ' ').trim();
    return next && next !== src.trim() ? next : '';
}

function roAfter(text, end) {
    return new RegExp(`^\\s*(?:${TIME_BIT}\\s*)?(?:으로|로)(?![가-힣])`).test(String(text).slice(end));
}

/** '(날짜)로 연기·미룸·변경·옮김' 앞의 날짜가 새 날짜입니다. 문장에서 앞뒤는 보지 않습니다. */
function roleDestination(text, units) {
    const src = String(text || '');
    if (!units.length || rainHold(src)) return -1;
    const head = new RegExp(`^\\s*(?:${TIME_BIT}\\s*)?(?:\\d\\s*교시\\s*)?(?:으로|로)(?![가-힣])`);
    let found = -1;
    for (let i = 0; i < units.length; i += 1) {
        const unit = units[i];
        const next = units[i + 1];
        const limit = next ? next.spans[0].index : Math.min(src.length, unit.end + 40);
        const after = src.slice(unit.end, limit);
        if (head.test(after) && MOVE_VERB.test(after)) found = i;
    }
    return found;
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
    const units = temporalUnits(text, spans);
    if (units.length >= 2 && roleDestination(text, units) >= 0) return true;
    return moveCue(text, units);
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
    t = t.replace(/미뤄(?:졌습니다|졌어요|집니다|요|짐)?|미루(?:어\s*요|어집니다|었습니다|어\s*짐|ㅂ니다)?|미룹니다/g, ' ');
    t = t.replace(/앞당(?:겨(?:졌습니다|졌어요|집니다|요|짐)?|김|긴)?/g, ' ');
    t = t.replace(/옮겨(?:졌습니다|졌어요|집니다|요)?|옮긴|옮깁니다/g, ' ');
    t = t.replace(/(?:으로|로)\s*(?:변경|바뀌|바꿉|바꿔)(?:되었(?:습니다|어요)?|됐습니다|됩니다|합니다|했어요|어요|었습니다|니다|요)?/g, ' ');
    t = t.replace(/(?:변경|바뀌|바꿉|바꿔)(?:되었(?:습니다|어요)?|됐습니다|됩니다|합니다|했어요|어요|었습니다|니다)/g, ' ');
    t = t.replace(/(?:되었|됐|이었|였)(?:습니다|어요)/g, ' ');
    t = t.replace(/예정이었던/g, ' ');
    t = t.replace(/(?:^|\s)(?:이었|였)던(?=\s|$)/g, ' ');
    t = t.replace(/(?:^|\s)바뀐(?=\s|$)/g, ' ');
    t = t.replace(/[()（）]/g, ' ');
    t = t.replace(/기존\s*일정대로|기존대로|원래대로|일정대로|예정대로/g, ' ');
    t = t.replace(/(?:^|\s)대로(?=\s|$)/g, ' ');
    t = t.replace(/진행(?:합니다|해요)(?![가-힣])/g, ' ');
    t = t.replace(/(?:^|\s)(?:갑니다|가요)(?=\s|$)/g, ' ');
    t = t.replace(/(?:이었습니다|였습니다|입니다|예요|이에요)/g, ' ');
    t = t.replace(/(?:^|\s)일정(?:은|는|이|가|을|를)?(?=\s|$)/g, ' ');
    t = t.replace(/변경\s*후\s*[:：]?/g, ' ');
    if (dateModifyingMarker(text)) {
        t = t.replace(/변경\s*전\s*[:：]?/g, ' ');
        t = t.replace(/(?:^|\s)(?:원래|당초|기존)(?:는|은|의)?(?=\s|$)/g, ' ');
    }
    t = t.replace(/(?:^|\s)던(?=\s|$)/g, ' ');
    t = t.replace(/[/／]/g, ' ');
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

function markBeside(text, unit, units) {
    const next = units.find((item) => item.spans[0].index > unit.end);
    const slice = text.slice(unit.end, next ? next.spans[0].index : Math.min(text.length, unit.end + 24));
    const period = (slice.match(/^\s*(\d)\s*교시/) || [])[1] || '';
    const clock = slice.match(new RegExp(TIME_BIT));
    return { period, clock: clock ? clock[0] : '' };
}

const OLD_VALUE = /(?:원래|당초|기존|변경\s*전|예정이었던)/;
const NEW_VALUE = /변경\s*후/;
const AS_PLANNED = /기존\s*일정대로|기존대로|원래대로|일정대로|예정대로/g;
const DO_VERB = /에\s*(?:합니다|해요|엽니다|갑니다|가요)/;
const STATE_VERB = /(?:입니다|예요|이에요)/;

function withoutAsPlanned(text) {
    return String(text || '').replace(AS_PLANNED, ' ');
}

/** 원래·당초·기존·변경 전은 바로 뒤가 날짜일 때만 날짜를 꾸밉니다. */
function dateModifyingMarker(text) {
    return /(?:원래|당초|기존|변경\s*전)(?:는|은|의)?\s*[:：]?\s*(?:\(\s*)?(?:\d{1,2}\s*[./]\s*\d{1,2}|\d{1,2}\s*월)/.test(withoutAsPlanned(text));
}

/** 원래·당초·기존·변경 전은 바로 뒤가 날짜이거나, 날짜가 둘 이상일 때만 예전 값입니다. */
function discourseOld(window, multi) {
    const bare = withoutAsPlanned(window);
    if (!/(?:원래|당초|기존|변경\s*전)/.test(bare)) return false;
    if (multi) return true;
    return /(?:원래|당초|기존|변경\s*전)\s*[:：]?\s*(?:\(\s*)?(?:\d{1,2}\s*[./]\s*\d{1,2}|\d{1,2}\s*월)/.test(bare);
}

function dropsOldLabel(text) {
    return discourseOld(text, findDates(withoutAsPlanned(text)).length >= 2);
}

function leeParticle(word) {
    const token = String(word || '');
    if (!/(?<=[가-힣])이$/.test(token) || /(?:어린이|종이|놀이|이야기|송이|거미|나들이)$/.test(token)) return false;
    const prev = token.charCodeAt(token.length - 2);
    if (prev < 0xAC00 || prev > 0xD7A3) return false;
    return (prev - 0xAC00) % 28 !== 0;
}

/** 꼬리를 자른 뒤 어간·조사로 끝나면 그 자르기는 되돌립니다. */
function endsWithStemOrParticle(title) {
    const t = String(title || '').replace(/\s+/g, ' ').trim();
    if (!t) return true;
    if (/계신\s*[?？]\s*$/.test(t)) return true;
    const last = t.split(' ').pop() || '';
    if (/(?:은|는|이|가|을|를|과|와|의|에|로|으로)$/.test(last)) return true;
    if (/(?:아도|어도|여도|와도|으면|지만|니까)$/.test(last)) return true;
    if (/^(?:들어|계신)$/.test(last)) return true;
    return false;
}

function bareSlashAt(text) {
    let at = -1;
    const src = String(text || '');
    for (let i = 0; i < src.length; i += 1) {
        if (src[i] !== '/' && src[i] !== '／') continue;
        if (/\d/.test(src[i - 1] || '') || /\d/.test(src[i + 1] || '')) continue;
        at = i;
    }
    return at;
}

/** 날짜를 둘러싼 말만 봅니다. 앞 날짜의 '원래'가 뒤 날짜까지 물들이지 않습니다. */
function valueWindow(text, unit, units) {
    const start = unit.spans[0].index;
    const prev = [...units].reverse().find((item) => item.end <= start);
    const before = text.slice(prev ? prev.end : 0, start);
    const cut = Math.max(before.lastIndexOf('('), before.lastIndexOf('（'), before.lastIndexOf('.'), before.lastIndexOf('。'), bareSlashAt(before));
    const head = before.slice(cut + 1);
    const next = units.find((item) => item.spans[0].index > unit.end);
    const after = text.slice(unit.end, next ? next.spans[0].index : Math.min(text.length, unit.end + 28));
    const stop = [after.indexOf(')'), after.indexOf('）'), after.search(/[.。]/), bareSlashAt(after)].filter((item) => item >= 0);
    const tail = after.slice(0, stop.length ? Math.min(...stop) : after.length);
    return { head, tail };
}

/** 이었던·예정이었던은 예전 값입니다. 원래·당초·기존·변경 전은 범위를 좁혀 보고, 에 합니다·갑니다는 새 날짜입니다. */
function dateRole(text, unit, units) {
    const { head, tail } = valueWindow(text, unit, units);
    const bareHead = withoutAsPlanned(head);
    if (/^\s*예정이었던/.test(tail) || /^\s*(?:은|는|이|가|을|를)?\s*(?:이었|였)던/.test(tail)) return 'old';
    if (NEW_VALUE.test(bareHead) && !/(?:원래|당초|기존|변경\s*전)/.test(bareHead)) return 'new';
    if (/(?:예정이었던|(?:은|는|이|가|을|를)?\s*(?:이었|였)던)\s*$/.test(bareHead)) return 'old';
    if (discourseOld(bareHead, units.length >= 2)) return 'old';
    if (new RegExp(`^\\s*${DO_VERB.source}`).test(tail)) return 'new';
    if (/^\s*(?:입니다|예요|이에요)/.test(tail)) return 'new';
    return '';
}

function yearLead(text, unit) {
    const before = String(text || '').slice(0, unit.spans[0].index);
    const found = before.match(/(?:재작년|작년|지난해|지난\s*해|올해|이번에)(?:에는|에도|엔|도의|도|에|는|은|의)?\s*$/);
    return found ? found[0].trim() : '';
}

function datedToken(text, unit) {
    const lead = yearLead(text, unit);
    const token = unitToken(unit);
    return lead ? `${lead} ${token}` : token;
}

function changeSubject(text, spans) {
    const subject = moveSubject(text, spans).replace(/\s+/g, ' ').trim();
    if (!subject || /^(?:날짜|일정|입니다|였습니다|이었습니다|던)(?:은|는|이|가)?$/.test(subject)) {
        const named = namedEvent(text);
        return named || '날짜만 있음';
    }
    return subject;
}

/** 날짜를 옮기는 문장은 새 날짜만 넣고, 예전 값으로 표시된 날짜는 빼 둡니다. */
function rescheduleChunks(text, now) {
    const spans = findDates(text, now);
    const units = temporalUnits(text, spans);
    if (units.length < 2) return null;
    let roles = units.map((unit) => dateRole(text, unit, units));
    const destAt = roleDestination(text, units);
    if (destAt >= 0) roles[destAt] = 'new';
    if (!roles.includes('old')) roles = roles.map((role, index) => (role === 'new' && index !== destAt ? '' : role));
    const newAt = roles.reduce((found, role, index) => (role === 'new' ? index : found), -1);
    const moved = newAt >= 0 || destAt >= 0 || moveCue(text, units);
    if (!moved) return null;
    const dest = newAt >= 0 ? units[newAt] : (destAt >= 0 ? units[destAt] : units[units.length - 1]);
    const subject = changeSubject(text, spans);
    const beside = markBeside(text, dest, units);
    const fresh = `\u0003${subject} ${datedToken(text, dest)} ${beside.period ? `${beside.period}교시` : ''} ${beside.clock}`.replace(/\s+/g, ' ').trim();
    const old = units.filter((unit) => unit !== dest).map((unit) => {
        const was = markBeside(text, unit, units);
        return `\u0002${subject} ${datedToken(text, unit)} ${was.period ? `${was.period}교시` : ''}`.replace(/\s+/g, ' ').trim();
    });
    return [fresh, ...old];
}

/** 새 날짜 없이 원래·당초·변경 전·이었던만 있으면 그 날짜는 예전 값입니다. */
function oldValueChunks(text, now) {
    const spans = findDates(text, now);
    const units = temporalUnits(text, spans);
    if (!units.length || roleDestination(text, units) >= 0 || moveCue(text, units)) return null;
    const roles = units.map((unit) => dateRole(text, unit, units));
    if (!roles.length || roles.some((role) => role !== 'old')) return null;
    const subject = changeSubject(text, spans);
    return units.map((unit) => `\u0002${subject} ${datedToken(text, unit)}`.replace(/\s+/g, ' ').trim());
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

function realDateSpans(text, now) {
    return findDates(text, now).filter((span) => {
        const token = text.slice(span.index, span.index + span.length).replace(/\s+/g, '');
        const after = text.slice(span.index + span.length, span.index + span.length + 3);
        return !(/^\d{1,2}일$/.test(token) && /^\s*(?:간|동안)/.test(after));
    });
}

function eventNameBeside(text, spans) {
    const tail = text.slice(spans[spans.length - 1].index + spans[spans.length - 1].length);
    const head = text.slice(0, spans[0].index);
    const cleaned = (blob) => tidyTitle(String(blob)
        .replace(/(?:이틀|사흘|나흘|양일|\d+\s*일)\s*(?:간|동안)?/g, ' ')
        .replace(/(?:두|세|네|다섯|\d+)\s*차례|각각/g, ' ')
        .replace(/(?:을|를)?\s*(?:진행합니다|확인합니다|안내합니다|합니다|해요|갑니다|엽니다|봅니다|봐요)[.。]?\s*$/g, ' '));
    const name = cleaned(tail) || cleaned(head);
    if (!name || weakTitle(name) || /일정/.test(name)) return '';
    return name;
}

/** '11/2과 11/3', '11/5·11/6', '11/9, 11/10'처럼 이은 날짜가 며칠과 맞으면 기간 일정 하나입니다. */
function joinedDaySpan(text, now) {
    const spans = realDateSpans(text, now);
    if (spans.length !== 2 || isRangePair(text, spans) || isReschedule(text, spans)) return null;
    const between = text.slice(spans[0].index + spans[0].length, spans[1].index);
    if (!/^\s*(?:[·ㆍ‧,，]|과|와)\s*$/.test(between)) return null;
    const told = toldDayCount(text);
    if (!told || told !== inclusiveDays(spans[0].ymd, spans[1].ymd)) return null;
    const name = eventNameBeside(text, spans);
    if (!name) return null;
    const startTok = text.slice(spans[0].index, spans[0].index + spans[0].length);
    const endTok = text.slice(spans[1].index, spans[1].index + spans[1].length);
    return [`\u0007${name} ${startTok}~${endTok}`.replace(/\s+/g, ' ').trim()];
}

/** '두 차례'·'N차례'·'각각'이면 날짜마다 같은 행사명으로 나눕니다. */
function repeatedEventChunks(text, now) {
    const spans = realDateSpans(text, now);
    if (spans.length < 2 || isRangePair(text, spans) || isReschedule(text, spans)) return null;
    if ([...String(text).matchAll(/(?<!\d)\d{1,2}\s*차(?!례)/g)].length >= 2) return null;
    if (!/(?:두|세|네|다섯|\d+)\s*차례|각각/.test(text)) return null;
    const name = eventNameBeside(text, spans);
    if (!name) return null;
    return spans.map((span) => `\u0007${name} ${text.slice(span.index, span.index + span.length)}`.replace(/\s+/g, ' ').trim());
}

function deadlinePhrase(half) {
    const named = String(half || '').match(/([가-힣]{1,12})\s*마감/);
    if (named && !/^(?:은|는|이|가|인)$/.test(named[1])) return `${named[1]} 마감`;
    if (/회신/.test(half)) return '회신 마감';
    if (/제출/.test(half)) return '제출 마감';
    if (/접수/.test(half)) return '접수';
    if (/신청/.test(half)) return '신청 마감';
    return '마감';
}

function roleNear(text, span) {
    const after = text.slice(span.index + span.length, span.index + span.length + 24);
    const before = text.slice(Math.max(0, span.index - 18), span.index);
    const clock = '(?:(?:오전|오후)\\s*)?(?:\\d{1,2}\\s*시(?:\\s*\\d{1,2}\\s*분|\\s*반)?\\s*)?';
    const namedMagam = new RegExp(`^\\s*${clock}마감(?!되었|됐)\\s+${MAGAM_EVENT_TAIL}`).test(after);
    if (!namedMagam && (new RegExp(`^\\s*${clock}(?:까지|마감(?!되었|됐))`).test(after) || /(?:마감(?!되었|됐)|까지)\s*(?:은|는|이|가|인)?\s*$/.test(before))) return 'due';
    if (/^\s*(?:에\s*)?안내/.test(after) || /안내(?:하는|는|은)?\s*$/.test(before)) return 'notice';
    const afterWord = (after.match(/^\s*([가-힣]+)/) || [])[1] || '';
    const sameClause = after.split(/[,，]/)[0];
    if (/^(?:연차|연가|병가|조퇴|휴가|외출|공가|출장|부재)/.test(afterWord) && !new RegExp(EVENT_NOUN).test(sameClause)) return 'absence';
    if (/(?:연차|연가|병가|조퇴|휴가|외출|공가|출장|부재)\s*(?:이고|이라|라서|이니|인)?\s*$/.test(before)) return 'absence';
    return '';
}

function noticeNoun(text) {
    const shaped = String(text || '').match(/마감인\s*([가-힣]{2,12})/);
    if (shaped) return shaped[1].replace(/(?:은|는|이|가)$/, '');
    const topic = [...String(text || '').matchAll(/([가-힣]{2,12})(?:은|는)/g)]
        .map((match) => match[1])
        .find((word) => !/안내|마감|신청|접수|회신|제출|선생님/.test(word));
    return topic || '';
}

/** 마감과 안내, 또는 남의 부재와 마감이 날짜 둘에 나뉘면 마감은 할 일로 남깁니다. */
function pairedRoleChunks(text, now) {
    const spans = findDates(text, now);
    if (spans.length !== 2 || isRangePair(text, spans) || isReschedule(text, spans)) return null;
    const tagged = spans.map((span) => ({ span, role: roleNear(text, span) }));
    const due = tagged.find((row) => row.role === 'due');
    const notice = tagged.find((row) => row.role === 'notice');
    const absence = tagged.find((row) => row.role === 'absence');
    const token = (span) => text.slice(span.index, span.index + span.length);
    if (due && notice) {
        const noun = noticeNoun(text);
        if (!noun) return null;
        return [
            `${noun} 마감 ${token(due.span)}`.replace(/\s+/g, ' ').trim(),
            `\u0007${noun} 안내 ${token(notice.span)}`.replace(/\s+/g, ' ').trim(),
        ];
    }
    const self = /(?<![가-힣])(?:제가|저는|저)(?![가-힣])/.test(text);
    if (due && absence && !self) {
        const aroundDue = text.slice(Math.max(0, due.span.index - 24), due.span.index + due.span.length + 12);
        const phrase = deadlinePhrase(aroundDue);
        return [`${phrase} ${token(due.span)}`.replace(/\s+/g, ' ').trim()];
    }
    return null;
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
        if (part === due) {
        const own = tidyTitle(due);
        if (/참가\s*신청|참여\s*신청/.test(own)) return `${own} ${token}까지`;
        return `${name} 신청 ${token}까지`;
    }
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

/** 날짜 바로 뒤의 '까지·마감'은 그 날짜의 마감입니다. 다음 날짜 앞은 넘지 않습니다. */
function deadlineTailEnd(text, unit, next) {
    const limit = next ? next.spans[0].index : text.length;
    const after = text.slice(unit.end, limit);
    const tail = after.match(/^\s*(?:(?:오전|오후)\s*)?(?:\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?\s*)?까지/);
    return unit.end + (tail ? tail[0].length : 0);
}

/** 이동·나열·대체가 아니면 날짜와 시각 후보를 모두 빼 둡니다. */
function unsureChunks(text, now) {
    const units = temporalUnits(text, findDates(text, now));
    const days = new Set(units.flatMap((unit) => unit.spans.map((span) => span.ymd)));
    if (units.length >= 2 && days.size >= 2) {
        return units.map((unit, index) => {
            const prev = units[index - 1];
            const from = index === 0 ? 0 : deadlineTailEnd(text, prev, unit);
            const end = deadlineTailEnd(text, unit, units[index + 1]);
            return `\u0001${text.slice(from, end).trim()}`;
        });
    }
    const clocks = clockMatches(text);
    if (clocks.length < 2) return null;
    if (clocks.length === 2 && clockSpan(text)) return null;
    const bare = text.replace(new RegExp(TIME_BIT, 'g'), ' ');
    return clocks.map((match) => `\u0001${bare} ${match[0]}`.replace(/\s+/g, ' ').trim());
}

/** 부정 문장 뒤에 날짜만 있으면 그 일정의 날짜로 붙입니다. */
function oldValueSentence(text, now) {
    const src = withoutAsPlanned(text);
    if (/변경\s*후/.test(src) && findDates(src, now).length) return false;
    if (MOVE_VERB.test(src) && /(?:\d|[)）])\s*(?:\d\s*교시\s*)?(?:으로|로)/.test(src)) return false;
    return /(?:원래|당초|기존|변경\s*전|예정이었던|(?:이었|였)던)/.test(src) && (findDates(src, now).length || /\d\s*교시/.test(src));
}

function changeSentence(text, now) {
    const src = String(text || '');
    if (/(?:\d|[)）])\s*(?:\d\s*교시\s*)?(?:으로|로)/.test(src) && MOVE_VERB.test(src)) return true;
    if (/변경\s*후/.test(src) && findDates(src, now).length) return true;
    return findDates(src, now).length === 1 && (DO_VERB.test(src) || STATE_VERB.test(src)) && !oldValueSentence(src, now);
}

const BACKUP_MARK = /비가\s*오면|비\s*오면|우천\s*시|(?<![가-힣])예비일(?:은|는|이|가|을|를|의)?(?![가-힣])|(?<![가-힣])순연(?!됩니다|합니다|되었)/;

/** 우천 시·비 오면·예비일·순연은 조건입니다. '우천으로'는 사유이고, 이미 옮긴 날은 조건이 아닙니다. */
export function isBackupDay(text) {
    const src = String(text || '');
    if (!src) return false;
    if (/우천\s*시에도/.test(src)) return false;
    if (/연기(?:하지\s*않|\s*없이)|미루지\s*않/.test(src)) return false;
    if (/(?:으로|로)\s*인해|인하여|때문에/.test(src)) return false;
    if (/에서/.test(src) && /순연(?:됩니다|합니다|되었)/.test(src)) return false;
    return BACKUP_MARK.test(src);
}

function backupMarkerAt(text) {
    const found = String(text || '').match(BACKUP_MARK);
    return found ? found.index : -1;
}

/**
 * 대체일 표지 바로 뒤의 날짜나 기간만 떼어 노란 카드로 둡니다.
 * 앞의 마감·기간·행사는 그 표지가 없을 때와 같은 분석으로 남습니다.
 */
function cutBackup(text, now) {
    const src = String(text || '').replace(/[\u0001-\u0008\u000e]/g, '');
    if (!isBackupDay(src) || rainHold(src)) return null;
    const at = backupMarkerAt(src);
    if (at < 0) return null;
    const after = findDates(src, now).filter((span) => span.index >= at);
    if (!after.length) return null;
    let endSpan = after[0];
    if (after[1] && rangeJoin(src, after[0], after[1])) endSpan = after[1];
    let start = at;
    let end = endSpan.index + endSpan.length;
    const head = src.slice(0, at);
    const paren = head.match(/[（(]\s*$/);
    if (paren) {
        start = at - paren[0].length;
        const close = src.slice(end).match(/^\s*[)）]/);
        if (close) end += close[0].length;
    } else {
        const comma = head.match(/[,，]\s*$/);
        if (comma) start = at - comma[0].length;
    }
    let rest = `${src.slice(0, start)}${src.slice(end)}`;
    rest = rest.replace(/\s+/g, ' ').replace(/\s+([.。,，])/g, '$1').trim();
    rest = rest.replace(/^[,，]\s*/, '').replace(/[,，]\s*$/, '').trim();
    const phrase = src.slice(at, endSpan.index + endSpan.length).replace(/\s+/g, ' ').trim();
    if (!phrase) return null;
    return { rest, yellow: `\u0001${phrase}` };
}

/** 원래·당초·기존·변경 전 문장은 옮긴 문장과 한 덩어리입니다. 앞뒤는 가리지 않습니다. */
function bindOriginalDate(parts, now) {
    const out = [];
    for (let i = 0; i < parts.length; i += 1) {
        const cur = String(parts[i] || '');
        const next = String(parts[i + 1] || '');
        const pair = (changeSentence(cur, now) && oldValueSentence(next, now)) || (oldValueSentence(cur, now) && changeSentence(next, now));
        if (pair) {
            out.push(`${cur.replace(/[.。]\s*$/, '')} ${next}`.replace(/\s+/g, ' ').trim());
            i += 1;
            continue;
        }
        out.push(cur);
    }
    return out;
}

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

function deadlineClosed(text) {
    return /마감\s*(?:되었|됐습니다|됐어요|되었어요|됨)|마감됐/.test(String(text || ''));
}

const OTHER_PERSON = '(?:부장님|부장\\s*님|교감(?:\\s*선생님)?|담임(?:\\s*선생님)?|[가-힣]{1,4}\\s*선생님|[가-힣]{0,6}\\s*교사님|[가-힣]{2,10}님)';
const OTHER_ABSENCE = '(?<![가-힣])(?:출장(?!\\s*연수)|연가|연차|휴가|조퇴|부재|병가|외출|연수)';
const LEAVE_WORD = '출장|연가|연차|휴가|조퇴|부재|병가|외출|연수';

function linkedClauses(text) {
    const src = String(text || '');
    const parts = [];
    let start = 0;
    const mark = new RegExp(`[,，]|(?:(?<!않)이라서|(?<!아니)라서|(?<!않)이니까|니까|(?<!않)이시니|(?<!않)이셔서|(?<!않)이시라서|(?<!않)이신데|(?<!않)이니|(?<!않)이고|(?<!않)이라|(?<!휴)가시는데|내시는데|하시는데|오시는데|(?<!휴)가시니|(?<!휴)가셔서|하셔서|하시니)요?(?![가-힣])|(?:셔서|시므로|시기에|시니|는데)요?(?![가-힣])|(?<=(?:${LEAVE_WORD}))(?:라|니|으로|인데)(?![가-힣])|(?<=[가-힣])(?<!니)(?<!거)(?<!더)라(?![가-힣])|(?<=[가-힣])(?<!이)(?<!으)니(?![가-힣])`, 'g');
    let found = mark.exec(src);
    while (found) {
        const chunk = src.slice(start, found.index).trim();
        if (chunk) parts.push({ text: chunk, linked: !/^[,，]/.test(found[0]) });
        start = found.index + found[0].length;
        found = mark.exec(src);
    }
    const tail = src.slice(start).trim();
    if (tail) parts.push({ text: tail, linked: false });
    return parts.length ? parts : [{ text: src.trim(), linked: false }];
}

function looseClauses(text) {
    return linkedClauses(text).map((part) => part.text);
}

/** '못하시는 선생님'처럼 직함이 아닌 일반 주어는 다른 사람이 아닙니다. */
function withoutGenericTeacher(text) {
    return String(text || '').replace(/(?:[가-힣]{0,12}?(?:하시|되시|시)는)\s*선생님/g, ' ');
}

/** 연수 뒤에 공유회·보고회처럼 행사 명사가 있으면 그 연수는 부재가 아닙니다. */
function trainingEventName(text) {
    const src = String(text || '');
    if (/(?<![가-힣])공유회/.test(src)) return true;
    return /연수\s*(?:결과\s*)?(?:공유회|보고회|발표회|회의|협의회|설명회|리허설|전시회|행사)/.test(src);
}

/** 부재·연수 단어 뒤에 전달·공유·회의·진행·참석 요청이 오면 그 절은 일정입니다. */
function eventAfterLeave(text) {
    const src = String(text || '');
    const speech = '전달|공유회|내용\\s*공유|공유\\s*회의|회의|보고회|진행|개최|엽니다|참석해\\s*주';
    return looseClauses(src).some((clause) => new RegExp(`(?:${LEAVE_WORD}).{0,24}(?:${speech})`).test(clause));
}

/** '연기된 회의를 엽니다'처럼 수식어 뒤의 행사는 열립니다. 미뤘습니다·연기되었습니다는 아닙니다. */
function heldAfterModifier(text) {
    const src = String(text || '');
    if (!/(?:연기된|연기한|미뤄진|미루어진)/.test(src)) return false;
    if (/(?:미룹니다|미뤘(?:습니다|어요|다)?|미루었|미뤄졌(?:습니다|어요)|연기(?:합니다|됩니다|되었|됐어요|했어요|함|됨))/.test(src)) return false;
    return /(?:엽니다|합니다|해요|있습니다|진행하|개최)/.test(src);
}

/** 직함 바로 뒤의 연수만 다른 사람의 부재입니다. '출장 연수'와 행사 이름은 일정입니다. */
function barePersonTraining(text) {
    const src = withoutGenericTeacher(text);
    if (/출장\s*연수/.test(src) || trainingEventName(src)) return false;
    if (!new RegExp(OTHER_PERSON).test(src) || !/(?<![가-힣])연수/.test(src)) return false;
    const stripped = src
        .replace(new RegExp(OTHER_PERSON, 'g'), ' ')
        .replace(/께서/g, ' ')
        .replace(/\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}/g, ' ')
        .replace(/\d{1,2}\s*\/\s*\d{1,2}(?:\s*[.(（][월화수목금토일][)）])?/g, ' ')
        .replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, ' ');
    return !/[가-힣]{2,}\s*연수/.test(stripped);
}

/** 부재 단어 뒤에 남은 말이 어미·조동사뿐이면 행사 이름이 아닙니다. */
function grammarTail(tail) {
    let left = String(tail || '');
    if (!left) return true;
    const step = /^(?:입니다|이십니다|중이십니다|중입니다|내셨습니다|다녀오십니다|다녀오세요|다녀옵니다|가십니다|가세요|받으십니다|듣습니다|들습니다|합니다|하세요|있습니다|있어요|습니다|세요|십시오|이에요|예요|에요|요|다|십니다|ㅂ니다|ㄴ다|중이|중|다녀오|다녀|내셨|내시|냈|받으시|받으|가시|들으시|들으|듣|들|하시|오시|이시|시|가세|가|내|하|이|오|으|셨|았|었)/;
    for (let i = 0; i < 8 && left; i += 1) {
        const next = left.replace(step, '');
        if (next === left) return false;
        left = next;
    }
    return left === '';
}

/** 사람·날짜·조사를 뺀 뒤에 부재어와 어미만 남으면 그 절은 남의 부재입니다. */
function predicateAbsence(rest) {
    const body = String(rest || '').replace(/\s+/g, '').replace(/오전|오후/g, '');
    if (!body) return false;
    if (/^(?:부재중(?:입니다)?|안계십니다)$/.test(body) || /^안계(?:십|세)/.test(body)) return true;
    const matched = body.match(/^(?:직무|원격|온라인|집합)?(?:연수)?(?:출장|연가|연차|휴가|조퇴|부재|병가|외출|연수)(.*)$/);
    if (!matched) return false;
    if (/출장연수/.test(body)) return false;
    return grammarTail(matched[1]);
}

const CLAUSE_EVENT = /(?:회의|협의(?!서)|보고회|공유회|총회|연수회|발표회|설명회|리허설|전시회|행사)/;

/** 직함과 날짜·이유 조사를 빼면 그 절에 남은 말입니다. */
function peelAbsence(text) {
    let rest = String(text || '').replace(/\d+\s*학년/g, ' ').replace(/\d+\s*반/g, ' ').replace(/부터/g, ' ');
    rest = rest.replace(new RegExp(`(?:[가-힣]{1,8}\\s+)?(?:${OTHER_PERSON})`, 'g'), ' ').replace(/께서/g, ' ');
    rest = rest.replace(/(?:^|\s)(?:이|가|은|는|을|를)(?=\s|$)/g, ' ');
    rest = rest.replace(/\d{4}\s*[./-]\s*\d{1,2}\s*[./-]\s*\d{1,2}/g, ' ');
    rest = rest.replace(/\d{1,2}\s*\/\s*\d{1,2}(?:\s*[.(（][월화수목금토일][)）])?/g, ' ');
    rest = rest.replace(/\d{1,2}\s*월\s*\d{1,2}\s*일(?:\s*[.(（][월화수목금토일][)）])?/g, ' ');
    rest = rest.replace(/[().。,，~～\-–—]/g, ' ');
    rest = rest.replace(/\d+\s*학년/g, ' ');
    rest = rest.replace(/(?:오전|오후)/g, ' ');
    rest = rest.replace(/(?:[가-힣]{2,12}\s*)+(?:으로|로)(?=\s|$)/g, ' ');
    rest = rest.replace(/(?:^|\s)(?:이|가|은|는|을|를)(?=\s|$)/g, ' ');
    return rest.replace(/\s+/g, ' ').trim();
}

/** 존칭 서술로 끝나면 가운데 단어가 목록에 없어도 남의 부재입니다. */
function honorificPredicate(rest) {
    let body = String(rest || '').replace(/\s+/g, '').replace(/부터/g, '');
    if (!body) return false;
    if (/^(?:안계(?:십|세)[가-힣]*|부재중(?:입니다)?)$/.test(body)) return true;
    if (!/(?:쓰십니다|이십니다|하십니다|가십니다|가세요|세요|안계십|계십)/.test(body)) return false;
    const ending = /(?:쓰십니다|이십니다|하십니다|가십니다|가세요|안계십니다|계십니다|세요)$/;
    for (let i = 0; i < 4 && ending.test(body); i += 1) body = body.replace(ending, '');
    if (/[0-9A-Za-z]/.test(body) || CLAUSE_EVENT.test(body)) return false;
    if (/(?:진행|전달|참석|개최|결재|품의|제출|신청|마감|정리|관련)/.test(body)) return false;
    return /^[가-힣]{0,16}$/.test(body);
}

/** 남의 절은 단어 목록이 아니라 사람 주어·행사 없음·존칭이나 연결어미로 버립니다. */
function pureAbsenceClause(text, linked = false) {
    const src = withoutGenericTeacher(String(text || '')).replace(/[.。]\s*$/g, '').trim();
    if (!src || /(?<![가-힣])(?:제가|저는|저도|저만|저|나는|내가|나도|나)(?![가-힣])/.test(src)) return false;
    if (/출장\s*연수/.test(src)) return false;
    if (eventAfterLeave(src) || trainingEventName(src) || heldAfterModifier(src)) return false;
    if (/까지|마감|제출|회신|주세요|바랍니다|받으세요|해\s*주|참석|진행|전달|신청|결재|정리|관련/.test(src)) return false;
    if (CLAUSE_EVENT.test(src)) return false;
    if (!new RegExp(OTHER_PERSON).test(src)) return false;
    const rest = peelAbsence(src);
    if (predicateAbsence(rest) || honorificPredicate(rest)) return true;
    if (!linked) return false;
    const compact = rest.replace(/\s+/g, '');
    return /^[가-힣]{1,20}$/.test(compact) && !CLAUSE_EVENT.test(compact);
}

/** 문장 전체가 직함의 부재·연수 서술로만 끝날 때만 카드 0장입니다. */
export function pureTitledAbsence(text) {
    const src = String(text || '').trim();
    if (!src) return false;
    if (eventAfterLeave(src) || trainingEventName(src) || heldAfterModifier(src)) return false;
    if (hasDeadline(src) || /까지|마감|제출|회신|주세요|바랍니다|받으세요|신청|결재|참석|진행|전달/.test(src)) return false;
    if (CLAUSE_EVENT.test(src)) return false;
    if (/(?<![가-힣])(?:제가|저는|저도|저만|저|나는|내가|나도|나)(?![가-힣])/.test(src)) return false;
    if (!new RegExp(OTHER_PERSON).test(withoutGenericTeacher(src))) return false;
    const parts = linkedClauses(src);
    return parts.length > 0 && parts.every((part) => pureAbsenceClause(part.text, part.linked) || absenceRestatement(part.text));
}

function absenceClause(text) {
    if (trainingEventName(text) || eventAfterLeave(text) || heldAfterModifier(text)) return false;
    return pureAbsenceClause(text);
}

/** '안 계십니다'·'부재중입니다'처럼 날짜 없는 부재의 뒷말은 할 일이 아닙니다. */
function absenceRestatement(text) {
    const src = String(text || '').trim();
    if (!src || findDates(src).length) return false;
    if (/까지|마감|제출|회신|주세요|바랍니다|결재|서류|회의|협의회|계획|보고|신청/.test(src)) return false;
    return /안\s*계(?:십|세)|자리를?\s*비|나오시지\s*않|못\s*나오|부재중/.test(src);
}

function normalizeRequest(text, now) {
    const src = String(text || '').replace(/[.。]\s*$/, '').trim();
    const spans = findDates(src, now);
    if (spans.length !== 1 || deadlineClosed(src)) return src;
    const token = src.slice(spans[0].index, spans[0].index + spans[0].length);
    const before = src.slice(0, spans[0].index);
    const after = src.slice(spans[0].index + spans[0].length);
    if (/마감/.test(src)) {
        const glued = src.match(/((?:참가|참여)\s*(?:신청|접수)|신청|접수|회신|제출|결재|설문|[가-힣]{2,12})\s*마감/);
        let head = glued ? glued[1].replace(/\s+/g, ' ').trim() : '';
        if (/^(?:은|는|이|가|인|마감)$/.test(head)) head = '';
        const clock = (after.match(/^\s*((?:오전|오후)\s*)?\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?\s*마감/) || [])[0] || '';
        const clockBit = clock.replace(/마감/, '').trim();
        return `${head ? `${head} 마감` : '마감'} ${token}${clockBit ? ` ${clockBit}` : ''}`.replace(/\s+/g, ' ').trim();
    }
    const verb = (src.match(/제출|회신|작성|입력|업로드/) || [])[0] || '';
    const noun = ((before.match(/((?:[가-힣]{2,12}\s+){0,2}[가-힣]{2,12})\s*(?:은|는|을|를|이|가)\s*$/) || before.match(/([가-힣]{2,12})\s*$/) || [])[1] || '').replace(/\s+/g, ' ').trim();
    if (verb) {
        const name = noun && noun !== verb ? `${noun} ${verb}` : verb;
        return `${name} ${token}까지`.replace(/\s+/g, ' ').trim();
    }
    if (/주세요|바랍니다|받으세요/.test(src) && noun) {
        if (/^(?:제출|회신|작성|입력|업로드)$/.test(noun) || /(?:신청|접수|마감)$/.test(noun)) return `${noun} ${token}까지`;
        return `${noun} 제출 ${token}까지`;
    }
    return src;
}

const SILENT_ABSENCE = '\u0008';
const YELLOW_ONLY = '\u000e';

function clauseCarriesEvent(clause) {
    if (trainingEventName(clause) || eventAfterLeave(clause) || heldAfterModifier(clause)) return true;
    if (pureAbsenceClause(clause) || barePersonTraining(clause)) return false;
    return new RegExp(EVENT_NOUN).test(String(clause || ''));
}

/** 날짜 바로 뒤의 '로 미룹니다'만 옮긴 날입니다. '다음으로'·'추후로'는 날이 없습니다. */
function realMove(text) {
    return /(?:\d|[)）])\s*(?:\d\s*교시\s*)?(?:으로|로)\s*(?:[가-힣]{1,12}\s*(?:은|는|을|를)\s*)?(?:미룹|미뤄|미루|미룸|미뤘|미루었|미룬|연기|변경|바뀐|바뀌|옮깁|옮겨)/.test(String(text || ''));
}

function destinationDate(text) {
    const src = String(text || '');
    if (heldAfterModifier(src)) return false;
    if (realMove(src) && findDates(src).length === 1) return true;
    if (/(?:날짜|일정)\s*(?:은|는)/.test(src) && /미룹|미뤄|미루|미룸|미뤘|미루었|연기|다음에|추후/.test(src)) {
        const after = src.split(/날짜|일정/).slice(1).join(' ');
        if (findDates(after).length >= 1) return true;
    }
    if (/추후\s*(?:에\s*)?\d/.test(src) && findDates(src).length >= 1) return true;
    return false;
}

/** '우천 시'처럼 조건이면 원래 날짜의 행사입니다. '으로 인해'로 이미 옮긴 날은 아닙니다. */
function rainHold(text) {
    const src = String(text || '');
    if (/연기(?:하지\s*않|\s*없이)|미루지\s*않/.test(src)) return false;
    if (/(?:으로|로)\s*인해|인하여|때문에/.test(src)) return false;
    return /우천\s*시/.test(src) && /(?:로|으로)\s*(?:미룹|미뤄|미루|미뤘|미루었|연기)/.test(src);
}

/** 다음에·추후·연기처럼 새 날이 없으면 그 행사는 열리지 않습니다. '연기된'은 수식어입니다. */
function postponedOpen(text) {
    const src = String(text || '');
    if (rainHold(src) || heldAfterModifier(src)) return false;
    if (/미루지\s*않|연기(?:하지\s*않|\s*없이)/.test(src) || src.includes('\u0003')) return false;
    if (destinationDate(src)) return false;
    if (/다음에\s*(?:하겠|합니|해요|하십|할게|하자)/.test(src)) return true;
    if (/다음\s*으로\s*(?:미룹|미뤄|미루|미룸|미뤘|미루었)/.test(src)) return true;
    if (/(?<![가-힣])추후/.test(src)) return true;
    if (/(?<![가-힣])미룸/.test(src)) return true;
    if (/(?<![가-힣])(?:미룹|미뤄|미루|미뤘|미루었)/.test(src) && !realMove(src)) return true;
    if (/(?<![가-힣])연기(?!된|한)/.test(src)) {
        const spans = findDates(src);
        if (spans.length >= 2 && isReschedule(src, spans)) return false;
        return true;
    }
    return false;
}

/** 미룬다·참석 못 한다·취소는 그 행사를 열지 않습니다. 회신 요청과 '취소하지 않습니다'는 그대로 둡니다. */
function eventCalledOff(text) {
    const src = String(text || '');
    if (/취소(?:하지|\s*않|\s*없이)/.test(src) || /미루지\s*않/.test(src)) return false;
    if (/(?:잊지|빠지지)\s*못/.test(src)) return false;
    if (/참석(?:을|를)?\s*못|참석하지\s*못|참석하지\s*않/.test(src) && !/회신|제출|연락|알려/.test(src)) return true;
    if (heldAfterModifier(src)) return false;
    if (postponedOpen(src)) return true;
    if (/(?<![가-힣])(?:미룹|미뤄|미루|미룸|미뤘|미루었)/.test(src)) {
        if (destinationDate(src) || heldAfterModifier(src)) return false;
        const spans = findDates(src);
        if (spans.length >= 2 && isReschedule(src, spans)) return false;
        return true;
    }
    if (/(?<![가-힣])취소/.test(src)) return true;
    return negatedClause(src);
}

/** 새 날이 없는 미룸·미뤘·다음에·추후·다음으로 미룸은 카드를 만들지 않습니다. '연기된'과 '연기되었습니다'는 그대로 둡니다. */
export function silentPostponement(text, now = new Date()) {
    const src = String(text || '');
    if (!src || hasDeadline(src) || src.includes('\u0003')) return false;
    if (/미루지\s*않|연기(?:하지\s*않|\s*없이)/.test(src)) return false;
    if (heldAfterModifier(src)) return false;
    const spans = findDates(src, now);
    if (spans.length >= 2 && isReschedule(src, spans)) return false;
    if (destinationDate(src)) return false;
    if (/(?<![가-힣])미룸/.test(src)) return true;
    if (/다음에\s*(?:하겠|합니|해요|하십|할게|하자)/.test(src)) return true;
    if (/다음\s*으로\s*(?:미룹|미뤄|미루|미룸|미뤘|미루었)/.test(src)) return true;
    if (/(?<![가-힣])추후/.test(src) && !/추후\s*(?:에\s*)?\d/.test(src)) return true;
    if (spans.length <= 1 && /(?<![가-힣])(?:미룹|미뤄|미루|미룸|미뤘|미루었)/.test(src) && !realMove(src)) return true;
    return false;
}

/** 제가 검진·조퇴를 이유로 달고 보결을 부탁하면 그 보결만 일정입니다. */
function speakerCover(text, now) {
    const src = String(text || '').trim();
    if (!/(?<![가-힣])(?:제가|저는|저도|저만|저)(?![가-힣])/.test(src) || !/보결/.test(src)) return null;
    const parts = linkedClauses(src);
    if (parts.length < 2 || !parts[0].linked) return null;
    const spans = findDates(parts[0].text, now);
    if (!spans.length) return null;
    const work = parts.slice(1).map((part) => part.text).join(' ');
    if (!/보결/.test(work) || findDates(work, now).length) return null;
    const token = parts[0].text.slice(spans[0].index, spans[0].index + spans[0].length);
    return `${work} ${token}`.replace(/\s+/g, ' ').trim();
}

/** 직함이 행사를 지도·진행하고 뒤에 참석 요청이 있으면 그 행사는 일정입니다. */
function hostedAttendance(text, now) {
    const src = String(text || '').trim();
    if (!/(?:지도|진행)/.test(src) || !/참석/.test(src)) return null;
    if (!new RegExp(OTHER_PERSON).test(withoutGenericTeacher(src))) return null;
    const parts = linkedClauses(src);
    if (parts.length < 2) return null;
    const hostAt = parts.findIndex((part) => /지도|진행/.test(part.text));
    if (hostAt < 0) return null;
    const event = parts.slice(hostAt + 1).find((part) => /참석/.test(part.text) && /(?:공개수업|수업|연수|회의|협의|행사|보고회|설명회|발표회|총회|공유회)/.test(part.text));
    if (!event) return null;
    const dated = findDates(event.text, now)[0] ? event : parts[hostAt];
    const span = findDates(dated.text, now)[0];
    if (!span) return null;
    const token = dated.text.slice(span.index, span.index + span.length);
    const name = tidyTitle(event.text);
    if (!name || /^(?:참석|요청|일정)$/.test(name.replace(/\s+/g, ''))) return null;
    return `\u0007${name} ${token}`.replace(/\s+/g, ' ').trim();
}

/** 내가 조퇴·공가처럼 이유를 달고 뒤 절에 마감이 있으면 그 마감만 할 일입니다. */
function speakerWorkAfterLeave(text, now) {
    const src = String(text || '').trim();
    if (!/(?<![가-힣])(?:제가|저는|저도|저만|저)(?![가-힣])/.test(src)) return null;
    const parts = linkedClauses(src);
    if (parts.length < 2 || !parts[0].linked) return null;
    if (!/(?<![가-힣])(?:조퇴|휴가|외출|공가|연차|육아시간|반차|경조사)(?![가-힣])/.test(parts[0].text)) return null;
    const rest = parts.slice(1).map((part) => part.text).filter((clause) => /까지|마감|주세요|바랍니다|바꿔/.test(clause));
    if (!rest.length || !findDates(rest.join(' '), now).length) return null;
    return rest.map((clause) => (/까지|마감|주세요|바랍니다/.test(clause) ? normalizeRequest(clause, now) : clause));
}

/** 행사명 뒤의 '로 바꿉니다'·'로 옮겨요'는 그 날짜의 일정입니다. */
function placedSchedule(text) {
    const src = String(text || '');
    if (hasDeadline(src) || /마감|제출|회신|결재|품의|신청/.test(src)) return false;
    return /(?:으로|로)\s*(?:바꿉|바꿔|옮겨|옮깁|옮긴)/.test(src);
}

/** 다른 사람의 부재·연수는 그 절이 사람 주어와 존칭·연결어미로 끝날 때만 뺍니다. 마감·요청·행사 말은 남깁니다. */
function othersAbsenceRequest(text, now) {
    const src = String(text || '').trim();
    if (!src || /출장\s*연수/.test(src)) return null;
    if (/(?<![가-힣])(?:제가|저는|저)(?![가-힣])/.test(src)) return null;
    if (pureTitledAbsence(src)) return SILENT_ABSENCE;
    const personText = withoutGenericTeacher(src);
    const parts = linkedClauses(src);
    const structural = parts.some((part) => pureAbsenceClause(part.text, part.linked));
    const tied = new RegExp(`${OTHER_PERSON}.{0,48}${OTHER_ABSENCE}|${OTHER_ABSENCE}.{0,24}${OTHER_PERSON}`);
    if (!structural && !tied.test(personText) && !barePersonTraining(personText)) return null;
    const kept = parts.filter((part) => !pureAbsenceClause(part.text, part.linked) && !absenceRestatement(part.text)).map((part) => part.text);
    if (!kept.length) return SILENT_ABSENCE;
    const body = kept.join(', ').trim();
    if (!findDates(body, now).length) {
        if (/주세요|정리|제출|바랍니다|받으세요|해\s*주/.test(body)) return YELLOW_ONLY;
        return null;
    }
    return kept.map((clause) => {
        if (eventCalledOff(clause) || trainingEventName(clause) || eventAfterLeave(clause) || heldAfterModifier(clause)) return clause;
        if (/참석해\s*주/.test(clause)) return clause;
        if (/(?:까지|마감|주세요|바랍니다|제출|회신|받으세요)/.test(clause)) return normalizeRequest(clause, now);
        return clause;
    }).join(', ');
}

/** 직함이 아닌 사람이 참석하지 못하면 그 행사 날짜는 빼고 사유서·회신 마감만 남깁니다. */
function missedAttendanceRequest(text, now) {
    const src = String(text || '').trim();
    if (!/참석(?:을|를)?\s*못|참석하지\s*못/.test(src)) return null;
    if (/(?<![가-힣])(?:제가|저는|저)(?![가-힣])/.test(src)) return null;
    const personText = withoutGenericTeacher(src);
    if (new RegExp(OTHER_PERSON).test(personText) && new RegExp(OTHER_ABSENCE).test(personText)) return null;
    const cut = src.search(/사유서|회신|제출/);
    if (cut < 0) return null;
    const tail = src.slice(cut).trim();
    if (!findDates(tail, now).length || !/까지|내\s*주|주세요|바랍니다/.test(src)) return null;
    return normalizeRequest(tail, now);
}

/** 직함 주어가 부재·연수 어미로만 끝나는 문장만 카드 0장입니다. 그 밖의 빈 결과는 노란 카드로 남깁니다. */
export function silentOtherAbsence(text, now = new Date()) {
    return pureTitledAbsence(text, now);
}

/** 연결어미로 떨어진 남의 부재 날짜가 넣는 카드에 있으면 그 날짜입니다. */
export function leakedAbsenceDates(text, now = new Date()) {
    const clauses = linkedClauses(text);
    if (clauses.length < 2) return [];
    const absenceDates = new Set();
    let otherWork = false;
    clauses.forEach((part) => {
        const clause = part.text;
        if (pureAbsenceClause(clause, part.linked)) findDates(clause, now).forEach((span) => absenceDates.add(span.ymd));
        else if (/(?:회의|협의|보고회|설명회|총회|공유회|발표회|행사|위원회|수업|마감|까지|제출|주세요|바꿉|옮겨)/.test(clause) && findDates(clause, now).length) otherWork = true;
    });
    if (!otherWork) return [];
    return [...absenceDates];
}

function magamIsDeadline(text) {
    const src = String(text || '');
    if (deadlineClosed(src) || !/(?<![가-힣])마감(?!되었|됐)/.test(src)) return false;
    const stripped = src.replace(new RegExp(`(?<![가-힣])마감\\s+${MAGAM_EVENT_TAIL}`, 'g'), ' ');
    return /(?<![가-힣])마감(?!되었|됐)/.test(stripped);
}

function magamDate(text, span) {
    if (!span || deadlineClosed(text)) return false;
    const after = text.slice(span.index + span.length, span.index + span.length + 36);
    const before = text.slice(Math.max(0, span.index - 18), span.index);
    const clock = '(?:(?:오전|오후)\\s*)?(?:\\d{1,2}\\s*시(?:\\s*\\d{1,2}\\s*분|\\s*반)?\\s*)?';
    if (new RegExp(`^\\s*${clock}마감(?!되었|됐)\\s+${MAGAM_EVENT_TAIL}`).test(after)) return false;
    if (new RegExp(`^\\s*${clock}마감(?!되었|됐)`).test(after)) return true;
    return /마감(?:은|는|이|가|인)?\s*$/.test(before);
}

function clauseAt(text, span) {
    const parts = String(text).split(/[,，]/);
    let cursor = 0;
    for (let i = 0; i < parts.length; i += 1) {
        const start = text.indexOf(parts[i], cursor);
        const from = start < 0 ? cursor : start;
        const end = from + parts[i].length;
        if (span.index >= from && span.index < end) return parts[i].trim();
        cursor = end + 1;
    }
    return String(text);
}

function clauseEventName(clause, now) {
    const spans = findDates(clause, now);
    const span = spans[0];
    const blob = span ? `${clause.slice(0, span.index)} ${clause.slice(span.index + span.length)}` : clause;
    const name = tidyTitle(blob);
    if (!name || weakTitle(name) || /^(?:마감|신청|또는|일정|할 일)$/.test(name)) return '';
    return name;
}

function magamDueTitle(clause, eventName) {
    const src = String(clause || '');
    const glued = src.match(/((?:참가|참여)\s*(?:신청|접수)|신청|접수|회신|제출|결재|설문)\s*마감/);
    let title = '마감';
    if (glued) title = `${glued[1].replace(/\s+/g, ' ')} 마감`;
    else {
        const head = src.match(/([가-힣]{2,12}(?:\s+[가-힣]{1,8}){0,2})\s*마감(?!되었|됐)/);
        if (head) {
            const name = head[1].replace(/\s+/g, ' ').trim();
            const endsWithEvent = new RegExp(`(?:${EVENT_NOUN})$`).test(name);
            if (name && !/^(?:마감|은|는|이|가)$/.test(name) && !endsWithEvent) title = `${name} 마감`;
        }
        if (title === '마감') {
            const subject = src.match(/((?:[가-힣]{2,12}\s+){0,2}[가-힣]{2,12})\s*(?:은|는)\s+/);
            const name = subject ? subject[1].replace(/\s+/g, ' ').trim() : '';
            if (name && !/^(?:마감|신청|결과|발표|일정)$/.test(name) && !new RegExp(`(?:${EVENT_NOUN})$`).test(name)) title = `${name} 마감`;
        }
    }
    if (eventName && /^(?:(?:참가|참여)\s*)?신청\s*마감$|^(?:참가|참여)\s*접수\s*마감$/.test(title)) title = `${eventName} ${title}`;
    return title;
}

/** 마감이 붙은 날짜는 할 일이고, 나머지 날짜는 행사명 일정입니다. */
function magamPairChunks(text, now) {
    if (deadlineClosed(text) || /출장\s*연수/.test(text)) return null;
    const spans = findDates(text, now);
    if (spans.length !== 2 || isRangePair(text, spans) || isReschedule(text, spans)) return null;
    const dueRows = spans.filter((span) => magamDate(text, span));
    if (dueRows.length !== 1) return null;
    const due = dueRows[0];
    const event = spans.find((span) => span !== due);
    if (!event) return null;
    const dueClause = clauseAt(text, due);
    let eventName = clauseEventName(clauseAt(text, event), now);
    if (!eventName) return null;
    if (/^(?:개강|개학|종강|수료)$/.test(eventName)) {
        const subject = dueClause.match(/((?:[가-힣]{2,12}\s+){0,2}[가-힣]{2,12})\s*(?:은|는)/);
        const head = subject
            ? subject[1].replace(/\s+/g, ' ').trim().split(/\s+/).filter((word) => !/^(?:신청|접수|마감)$/.test(word)).join(' ')
            : '';
        if (head) eventName = `${head} ${eventName}`;
    }
    const dueTitle = magamDueTitle(dueClause, eventName);
    const eventToken = text.slice(event.index, event.index + event.length);
    const dueToken = text.slice(due.index, due.index + due.length);
    const clock = (text.slice(due.index + due.length).match(/^\s*((?:(?:오전|오후)\s*)?\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?)\s*마감/) || [])[1] || '';
    return [
        `\u0007${eventName} ${eventToken}`.replace(/\s+/g, ' ').trim(),
        `${dueTitle} ${dueToken}${clock ? ` ${clock.trim()}` : ''}`.replace(/\s+/g, ' ').trim(),
    ];
}

/** '또는 … 중 하루', '둘 중 하나'는 어느 날인지 모르므로 날짜마다 노란 카드입니다. */
function alternativeDayChunks(text, now) {
    const oneOf = /둘\s*중\s*(?:하루|하나)/.test(text);
    if ((!/또는/.test(text) || !/중\s*(?:하루|하나)/.test(text)) && !oneOf) return null;
    const spans = realDateSpans(text, now);
    if (spans.length < 2 || isRangePair(text, spans) || isReschedule(text, spans)) return null;
    const tail = text.slice(spans[spans.length - 1].index + spans[spans.length - 1].length).replace(/둘\s*중\s*(?:하루|하나)/g, ' ').replace(/중\s*(?:하루|하나)/g, ' ');
    const head = text.slice(0, spans[0].index).replace(/둘\s*중\s*(?:하루|하나)/g, ' ').replace(/중\s*(?:하루|하나)/g, ' ');
    const name = tidyTitle(tail.replace(/(?:을|를)?\s*(?:갑니다|가요|입니다)[.。]?\s*$/g, ' ')) || tidyTitle(head) || '일정';
    return spans.map((span) => `\u0001${name} ${text.slice(span.index, span.index + span.length)}`.replace(/\s+/g, ' ').trim());
}

/** 이음말만 있는 여러 날짜는 문장 끝의 행사명을 같이 씁니다. */
function sharedNameChunks(text, now) {
    const spans = realDateSpans(text, now);
    if (spans.length < 2 || isRangePair(text, spans) || isReschedule(text, spans)) return null;
    if (/마감|까지/.test(text) || toldDayCount(text)) return null;
    if ([...String(text).matchAll(/(?<!\d)\d{1,2}\s*차(?!례)/g)].length >= 2) return null;
    for (let i = 1; i < spans.length; i += 1) {
        const between = text.slice(spans[i - 1].index + spans[i - 1].length, spans[i].index);
        if (!/^\s*(?:[,，·ㆍ‧]|또는|그리고|과|와)\s*$/.test(between)) return null;
    }
    const name = eventNameBeside(text, spans);
    if (!name) return null;
    return spans.map((span) => `\u0007${name} ${text.slice(span.index, span.index + span.length)}`.replace(/\s+/g, ' ').trim());
}

/** 내 연가·출장과 마감·회의가 한 문장이면 절마다 나눕니다. 내 부재는 일정, 마감은 할 일입니다. */
function ownDatedAbsence(text, now) {
    const src = String(text || '').trim();
    if (!src || /출장\s*연수/.test(src)) return null;
    if (!/(?<![가-힣])(?:제가|저는|저도|저만|저)(?![가-힣])/.test(src)) return null;
    const leaveRe = /(?<![가-힣])(출장|병가|연가)(?!\s*(?:연수|신청|접수|마감|교육|복명|결재|대체|계획|사용|명단|자료|양식))/;
    if (!leaveRe.test(src)) return null;
    const clauses = looseClauses(src);
    if (clauses.length < 2) return null;
    const mine = [];
    const rest = [];
    clauses.forEach((clause) => {
        const leave = clause.match(leaveRe);
        const withoutLeave = clause.replace(leaveRe, ' ');
        const ownOnly = leave && findDates(clause, now).length && !hasDeadline(clause) && !/마감|주세요|바랍니다|제출|회신/.test(clause) && !new RegExp(EVENT_NOUN).test(withoutLeave);
        if (ownOnly) mine.push(clause);
        else rest.push(clause);
    });
    if (!mine.length || !rest.length) return null;
    const restText = rest.join(', ');
    const work = rest.some((clause) => hasDeadline(clause) || /마감|까지/.test(clause) || new RegExp(EVENT_NOUN).test(clause) || isRequest(clause));
    if (!work || !findDates(restText, now).length) return null;
    const restChunks = rest.map((clause) => (
        eventCalledOff(clause) ? clause
            : (/(?:까지|마감|주세요|바랍니다|제출|회신)/.test(clause) ? normalizeRequest(clause, now) : clause)
    ));
    return [...mine, ...restChunks];
}

function plusOneDay(ymd) {
    const [year, month, day] = String(ymd || '').split('-').map(Number);
    if (!year || !month || !day) return '';
    const date = new Date(Date.UTC(year, month - 1, day));
    date.setUTCDate(date.getUTCDate() + 1);
    const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
    const nextDay = String(date.getUTCDate()).padStart(2, '0');
    return `${date.getUTCFullYear()}-${nextMonth}-${nextDay}`;
}

/** 관형절 '보낸 날짜 … 양식'의 날짜는 양식을 꾸미는 말이라 카드를 만들지 않습니다. */
function peelFormModifier(text, now) {
    const src = String(text || '');
    if (!/양식/.test(src) || /[\u0001-\u0008\u000e]/.test(src)) return '';
    const formAt = src.search(/양식/);
    const spans = findDates(src, now);
    if (spans.length < 2 || formAt < 0) return '';
    const drop = spans.filter((span) => span.index < formAt && /(?:보낸|올린|공유한|안내한)\s*$/.test(src.slice(0, span.index)));
    if (!drop.length || drop.length === spans.length) return '';
    let next = src;
    [...drop].sort((a, b) => b.index - a.index).forEach((span) => {
        next = `${next.slice(0, span.index)} ${next.slice(span.index + span.length)}`;
    });
    next = next.replace(/(?:제가|저는|저도|저만|저)\s*(?:보낸|올린|공유한|안내한)\s*/g, ' ');
    next = next.replace(/(?:^|\s)(?:보낸|올린|공유한|안내한)\s+/g, ' ');
    next = next.replace(/\s+/g, ' ').trim();
    if (!next || findDates(next, now).length >= spans.length) return '';
    return next;
}

function weekdayChar(ymd) {
    const [year, month, day] = String(ymd || '').split('-').map(Number);
    if (!year) return '';
    return '일월화수목금토'[new Date(Date.UTC(year, month - 1, day)).getUTCDay()] || '';
}

/** '다음 날로 미룹니다'는 적힌 날의 다음 날을 일정으로 둡니다. */
function nextDayChunk(text, now) {
    const src = String(text || '');
    if (!/다음\s*날\s*(?:으로|로)\s*(?:미룹|미뤄|미루|미뤘|미루었)/.test(src)) return '';
    const spans = findDates(src, now);
    if (spans.length !== 1 || !spans[0].ymd) return '';
    const next = plusOneDay(spans[0].ymd);
    if (!next) return '';
    const month = Number(next.slice(5, 7));
    const day = Number(next.slice(8, 10));
    const week = weekdayChar(next);
    const name = (src.match(/([가-힣]{2,12}(?:\s+[가-힣]{1,8})?)\s*(?:은|는)\s*다음\s*날/) || [])[1] || '회의';
    return `\u0003${name.replace(/\s+/g, ' ').trim()} ${month}/${day}${week ? `(${week})` : ''}`;
}

/** '우천 시'로 미루면 적힌 첫 날짜의 행사를 일정으로 둡니다. */
function rainSchedule(text, now) {
    const src = String(text || '');
    if (!rainHold(src)) return '';
    const spans = findDates(src, now);
    if (!spans.length) return '';
    const first = spans[0];
    const name = namedEvent(src) || tidyTitle(src) || '행사';
    const token = src.slice(first.index, first.index + first.length);
    return `\u0007${name} ${token}`.replace(/\s+/g, ' ').trim();
}

function segmentsOf(text, now) {
    const lines = String(text || '').replace(/\u00a0/g, ' ').replace(/\r\n/g, '\n').split('\n');
    const chunks = [];
    lines.forEach((line) => {
        const trimmed = cleanLine(line);
        if (noise(trimmed)) return;
        explodeLine(trimmed).forEach((part) => {
                bindOriginalDate(bindTrailingDates(toldDeadline(splitSentences(part), now), now), now).forEach((sentence) => {
                const trimmedSentence = sentence.trim();
                if (noise(trimmedSentence)) return;
                const movedNext = nextDayChunk(trimmedSentence, now);
                if (movedNext) {
                    chunks.push(movedNext);
                    return;
                }
                const covered = speakerCover(trimmedSentence, now);
                if (covered) {
                    chunks.push(covered);
                    return;
                }
                const hosted = hostedAttendance(trimmedSentence, now);
                if (hosted) {
                    chunks.push(hosted);
                    return;
                }
                const speakerWork = speakerWorkAfterLeave(trimmedSentence, now);
                if (speakerWork) {
                    speakerWork.forEach((piece) => chunks.push(piece));
                    return;
                }
                const absenceKept = othersAbsenceRequest(trimmedSentence, now);
                if (absenceKept === SILENT_ABSENCE) return;
                if (absenceKept === YELLOW_ONLY) {
                    const span = findDates(trimmedSentence, now)[0];
                    const token = span ? trimmedSentence.slice(span.index, span.index + span.length) : '';
                    const noun = /품의/.test(trimmedSentence) ? '품의' : (/결재/.test(trimmedSentence) ? '결재' : '요청');
                    chunks.push(`\u0001${noun} ${token}`.trim());
                    return;
                }
                if (absenceKept) {
                    chunks.push(absenceKept);
                    return;
                }
                const missed = missedAttendanceRequest(trimmedSentence, now);
                if (missed) {
                    chunks.push(missed);
                    return;
                }
                const ownPieces = ownDatedAbsence(trimmedSentence, now);
                if (ownPieces) {
                    ownPieces.forEach((piece) => chunks.push(piece));
                    return;
                }
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
        const peeled = peelFormModifier(String(chunk), now);
        const base = listPeriodTokens(peeled || chunk);
        return splitListedPeriods(base).flatMap((piece) => {
        const timed = applyTimeShift(piece) || piece;
        const prepared = applyPeriodShift(timed, now) || timed;
        const barePrepared = String(prepared).replace(/[\u0001\u0002\u0003\u0005\u0007\u0008\u000e]/g, '');
        const rain = rainSchedule(barePrepared, now);
        if (rain) return [rain];
        const cut = cutBackup(barePrepared, now);
        const source = cut ? cut.rest : prepared;
        const yellow = cut ? [cut.yellow] : [];
        if (cut && !findDates(source, now).length) return yellow;
        return [...pieceChunks(source, now), ...yellow];
        });
    });
}

function pieceChunks(prepared, now) {
    const replaced = replaceChunks(prepared);
        if (replaced) return replaced;
        const moved = rescheduleChunks(prepared, now);
        if (moved) return moved;
        const oldOnly = oldValueChunks(prepared, now);
        if (oldOnly) return oldOnly;
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
        const repeated = repeatedEventChunks(prepared, now);
        if (repeated) return repeated;
        const paired = pairedRoleChunks(prepared, now);
        if (paired) return paired;
        const magam = magamPairChunks(prepared, now);
        if (magam) return magam;
        const choice = alternativeDayChunks(prepared, now);
        if (choice) return choice;
        const shared = sharedNameChunks(prepared, now);
        if (shared) return shared;
        const listed = ordinalChunks(prepared, now) || listChunks(prepared, now);
        if (listed) return listed;
        const plain = String(prepared).replace(/[\u0001\u0002\u0003\u0005\u0007]/g, '');
        if (personalAside(plain)) return [plain];
    const unsure = unsureChunks(prepared, now);
    if (unsure) return unsure;
    return splitByDate(prepared, now);
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

const LEAVE_REASON = /(?:출장|병가|연가|연차|휴가|조퇴|외출|공가|여행)(?:이라서요|라서요|이니까|니까|이라서|이어서|라서|여서|이라|이니|라)(?![가-힣])/;

/** 저·제가 말하거나 주어가 없는 출장·병가·연가 알림은 일정 이름입니다. 이유 접속과 행사명은 여기서 다루지 않습니다. */
function ownLeaveWord(text) {
    const src = String(text || '');
    if (new RegExp(OTHER_PERSON).test(src) || LEAVE_REASON.test(src)) return '';
    if (new RegExp(EVENT_NOUN).test(src) || isRequest(src) || hasDeadline(src)) return '';
    const found = src.match(/(?<![가-힣])(출장|병가|연가|재택근무)(?!\s*(?:연수|신청|접수|마감|교육|복명|결재|대체|계획|사용|명단|자료|양식))/);
    if (!found) return '';
    const speaker = /(?<![가-힣])(?:제가|저(?:는|도|만)?)(?![가-힣])/.test(src);
    const ahead = src.slice(0, found.index).match(/([가-힣]{2,})\s*$/);
    const timeWord = /^(?:내일|모레|오늘|글피|다음주|이번주|차주|금주|오전|오후|아침|저녁|제가|저는|저도|저만|저)$/;
    if (!speaker && ahead && !timeWord.test(ahead[1])) return '';
    return found[1];
}

/** 저·제가 자기 휴가·연가·출장을 라서·이어서·입니다로 이으면 그 날짜는 업무 일정이 아닙니다. */
function personalAside(text) {
    const src = String(text || '');
    if (ownLeaveWord(src)) return false;
    const speaker = /(?<![가-힣])(?:제가|저(?:는|도|만)?)(?![가-힣])/.test(src);
    if (!speaker) return false;
    const own = src.replace(/수학여행|현장체험학습|체험학습/g, ' ');
    const ownAbsence = /(?<![가-힣])(?:연차|연가|병가|조퇴|휴가|외출|공가|여행|출장)(?!\s*(?:신청|접수|마감|연수|교육|복명|결재|대체|계획|사용|명단|자료|양식))\s*(?:이라서요|라서요|이니까|니까|이라서|이어서|라서|여서|이라|라|입니다|이에요|예요|에요|에는|쓰는|인(?![가-힣])|하고|고(?![가-힣])|니(?![가-힣])|가요|갈게요|갑니다|갈\s*거|쓸게요|씁니다|합니다|해요)/.test(own);
    if (ownAbsence) {
        const ownTrip = /(?<![가-힣])출장(?!\s*연수)\s*(?:갑니다|가요)/.test(own) && !/(?:이라|라서|이니|니까)/.test(own);
        if (!ownTrip) return true;
    }
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

/** 절 끝에 서술어가 있으면 명사로 끝난 짧은 문장이 아닙니다. */
function hasPredicate(text) {
    const end = String(text || '').replace(/[\s.。!！?？~～]+$/g, '');
    if (pastPredicate(end)) return true;
    return /(?:니다|세요|십시오|주세요|바랍니다|할게요|네요|예요|에요|해요|[요다])$/.test(end);
}

/** 교시·시각·장소가 있으면 짧은 행사명도 올해 일정으로 둡니다. */
function scheduleAnchor(text) {
    const src = String(text || '');
    if (/\d\s*교시/.test(src)) return true;
    if (/(?:오전|오후)\s*\d{1,2}\s*시(?!간)|(?<!\d)\d{1,2}\s*:\s*\d{2}/.test(src)) return true;
    if (/(?:강당|운동장|체육관|도서관|교실|시청각실|회의실|과학실|음악실|미술실)/.test(src)) return true;
    return Boolean(takePlace(src).memo);
}

/** 날짜 뒤의 녹화본·자료·사진·영상은 과거 행사입니다. 사이에 다른 말이 있어도 됩니다. 까지·요청은 올해 할 일입니다. */
function materialAfterDate(text) {
    const src = String(text || '');
    if (hasDeadline(src) || isRequest(src)) return false;
    if (/(?:회의|협의회|연수|설명회|학예회|상담)\s*자료/.test(src) && /(?:씁니다|써요|사용|준비)/.test(src)) return false;
    if (/(?:재작년|작년|지난해|지난\s*해)\s*(?:양식|서식|형식)/.test(src) && /(?:씁니다|써요|사용|준비)/.test(src)) return false;
    const word = '(?:녹화본|결과물|자료집|사진첩|녹화|자료|사진|영상|링크|첨부|파일)';
    const tail = '(?:은|는|이|가|을|를|도|만)?(?:입니다|이에요|예요|에요|합니다|해요)?(?![가-힣])';
    const dates = findDates(src);
    return dates.some((span, index) => {
        const after = src.slice(span.index + span.length);
        const nextAt = dates[index + 1] ? dates[index + 1].index - (span.index + span.length) : after.length;
        const window = after.slice(0, Math.min(nextAt, 48)).replace(/결과물\s*(?:전시회|발표회)/g, '발표회');
        if (new RegExp(`^\\s*[)）]?\\s*${word}${tail}`).test(window)) return true;
        if (/^\s*[)）]?\s*결과(?!물|발표)(?:은|는|이|가|을|를|도|만)?(?:입니다|이에요|예요|에요|합니다|해요)?(?![가-힣])/.test(window)) return true;
        return new RegExp(`${word}${tail}`).test(window);
    });
}

/** 작년 자료어가 괄호 날짜 바로 앞에 있으면 그 날짜도 지난 행사입니다. */
function materialAtParenDate(text) {
    const src = String(text || '');
    if (hasDeadline(src) || isRequest(src)) return false;
    if (!/(?:재작년|작년|지난해|지난\s*해)/.test(src)) return false;
    const word = '(?:녹화본|결과물|자료집|사진첩|녹화|자료|사진|영상|링크|첨부|파일)';
    return findDates(src).some((span) => {
        const before = src.slice(Math.max(0, span.index - 16), span.index);
        return new RegExp(`${word}\\s*[(（]\\s*$`).test(before);
    });
}

/** 작년이 있고 서술어·교시·시각·장소·마감이 없는 짧은 문장은 올해인지 지난 행사인지 모릅니다. */
function bareYearNoun(text) {
    const src = String(text || '');
    if (!/(?:재작년|작년|지난해|지난\s*해)/.test(src)) return false;
    if (hasPredicate(src) || scheduleAnchor(src) || hasDeadline(src) || isRequest(src) || materialAfterDate(src)) return false;
    return true;
}

/** 작년 절은 과거 서술, 날짜 뒤 자료, 올해와 대비, 또는 비교 뒤의 과거형일 때만 지난 행사입니다. */
function pastEventYears(segment, contrastPast = false) {
    const src = String(segment || '').replace(/\u0006/g, '');
    const comparativeRe = /(?:재작년|작년|지난해|지난\s*해)(?:보다|처럼|과\s*달리|와\s*달리)/;
    const bare = src.replace(comparativeRe, ' ').replace(/(?:재작년|작년|지난해|지난\s*해)(?:의|은|는)?\s*(?:양식|서식|형식)/g, ' ');
    const found = bare.match(/재작년|작년|지난해|지난\s*해/);
    if (found) {
        if (!pastPredicate(src) && !materialAfterDate(src) && !materialAtParenDate(src) && !contrastPast) return 0;
        return found[0] === '재작년' ? 2 : 1;
    }
    if (comparativeRe.test(src) && pastPredicate(src)) return /재작년(?:보다|처럼|과\s*달리|와\s*달리)/.test(src) ? 2 : 1;
    return 0;
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

/** 날짜 바로 앞의 내년·다음 해. -2는 달력상 다음 해로 옮긴다는 표시입니다. */
function nextYearLead(before) {
    return /(?:내년|다음\s*해)(?:도|에는|에도|엔|에|는|은|의)?\s*$/.test(String(before || ''));
}

function yearCue(source, span, fullText = '') {
    const token = source.slice(span.index, span.index + span.length);
    const local = source.slice(0, span.index);
    const wide = textBeforeSpan(fullText, source, span);
    if (nextYearLead(local) || nextYearLead(wide || '')) return -2;
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
    if (roleDestination(src, temporalUnits(src, spans)) >= 0) return false;
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
    if (/(?:은|는)\s*쉽니다/.test(src)) return true;
    if (eventCancelled(src)) return true;
    if (heldAfterModifier(src)) return false;
    if (postponedOpen(src)) return true;
    if (postponedWithoutDestination(src)) return true;
    if (!heldAfterModifier(src) && !src.includes('\u0003') && !/미루지\s*않/.test(src) && /(?<![가-힣])(?:미룹|미뤄|미루|미룸|미뤘|미루었)/.test(src)) {
        if (destinationDate(src)) return false;
        return true;
    }
    if (/참석(?:을|를)?\s*못|참석하지\s*못|참석하지\s*않/.test(src) && !/회신|제출|연락|알려/.test(src)) return true;
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
    const body = deadlineClosed(source)
        ? placed.text
        : ((kind === '일정' || (hasEvent(source) && hasTodo(source) && keepWords))
            ? (kind === '일정' ? stripTodoClause(placed.text) : placed.text)
            : (kind === '할 일' && hasEvent(source) ? stripEventClause(placed.text) : placed.text));
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
        if (years === -2) {
            const target = `${Number(todayYmd.slice(0, 4)) + 1}${ymd.slice(4)}`;
            return { ymd: isValidYmd(target) ? target : ymd, remembered: false };
        }
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
    const reference = /참고만/.test(source) || (/공유합니다/.test(source) && !/(?:회의|협의회)에서\s*공유합니다/.test(source) && !thisYearRecording(source));
    const asked = asksQuestion(source);
    const closed = negatedClause(source);
    const approx = approximateWhen(source);
    const assumed = when.assumedPm ? '오전·오후가 없어 오후로 봤어요.' : '';
    const missing = date || chatter ? '' : '날짜가 없어요. 달력에서 골라 주세요.';
    const aside = chatter ? '업무로 볼 말이 없어 저장하면 정리함에 들어가요.' : '';
    const stale = past ? '지난 날짜라 저장하면 정리함에 들어가요.' : '';
    const shared = reference ? '참고용이라 저장하면 정리함에 들어가요.' : '';
    const cancelled = eventCancelled(source);
    const dropped = cancelled ? '취소된 내용이라 저장하면 정리함에 들어가요.' : '';
    const recalled = remembered ? '지난 이야기라 저장하면 정리함에 들어가요.' : '';
    const askedNote = asked ? '질문이라 저장하면 정리함에 들어가요.' : '';
    const closedNote = closed && !cancelled ? '열리지 않는 내용이라 저장하면 정리함에 들어가요.' : '';
    const approxNote = approx ? '날짜가 대략적이라 저장하면 정리함에 들어가요.' : '';
    const bareNote = bareYearNoun(source) ? '서술 없이 짧아 저장하면 정리함에 들어가요.' : '';
    const notes = [warning, assumed, missing, aside, stale, shared, dropped, recalled, askedNote, closedNote, approxNote, bareNote].filter(Boolean);
    let score = 0.45;
    if (date?.explicit) score += 0.25;
    else if (date) score += 0.15;
    else score -= 0.2;
    if (when.hm && !when.assumedPm) score += 0.15;
    if (when.assumedPm) score -= 0.15;
    if ((kind === '할 일' && (hasTodo(source) || isRequest(source))) || (kind === '일정' && hasEvent(source)) || (kind === '일정' && span.range)) score += 0.2;
    if (warning || chatter) score -= 0.25;
    const low = chatter || score < 0.7 || Boolean(warning) || when.assumedPm || !date || past || reference || cancelled || remembered || asked || closed || approx || Boolean(bareNote);
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

function thisYearRecording(text) {
    const src = String(text || '');
    return /(?:녹화본|녹화)/.test(src) && /공유/.test(src) && !/(?:재작년|작년|지난해|지난\s*해)/.test(src);
}

function stripTodoClause(text) {
    return String(text || '')
        .replace(new RegExp(`[가-힣A-Za-z0-9]{0,16}\\s*(?:을|를|은|는|이|가)?\\s*(?:제출|회신|작성|입력|업로드|마감(?!\\s+${MAGAM_EVENT_TAIL}))(?:\\s*해\\s*주(?:시기|세요|시길|십시오)|\\s*바랍니다|\\s*해주세요|\\s*합니다)?`, 'g'), ' ')
        .replace(/확인\s*바랍니다/g, ' ');
}

function stripEventClause(text) {
    const src = String(text || '');
    if (/(?:신청|접수)/.test(src)) return src;
    return src
        .replace(/교직원\s*회의|회의(?!록)|연수|공개수업|협의회|행사|출장/g, ' ')
        .replace(/장소\s*[:：]\s*[^\n,]+/g, ' ')
        .replace(/(?:10|\d)(?:\s*[,·~～\-–—]\s*(?:10|\d))+\s*교시/g, ' ')
        .replace(/(?:10|\d)\s*교시/g, ' ');
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

function bareTimeTitle(title) {
    const compact = String(title || '').replace(/\s+/g, '');
    const stripped = compact.replace(/(?:입니다|해요|합니다|했어요|했습니다|하였습니다|이에요|예요|에요|하는)$/g, '');
    return /^(?:올해|작년|이번|다음|이번주|다음주|다다음주)(?:는|은)?$/.test(stripped);
}

function scrubTimeTitle(item) {
    if (!item || !bareTimeTitle(item.title)) return item;
    return markUnsure({ ...item, title: '날짜만 있음' }, '행사명이 없어 저장하면 정리함에 들어가요.');
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
    if (!titlesOverlap(first, second)) return [first, markUnsure(second, '같은 문장에서 나눈 내용이라 저장하면 정리함에 들어가요.')];
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

function namedEvent(text) {
    const src = String(text || '');
    const match = src.match(/((?:[가-힣A-Za-z0-9]{1,12}\s+){0,4}(?:체험학습|현장학습|체육대회|공개수업|설명회|발표회|보고회|학예회|박람회|운동회|수련회|협의회|리허설|전시회|연수|대회|축제|강연|회의|발표|상담\s*주간))/);
    if (!match) return '';
    const name = tidyTitle(match[1]);
    if (!name || weakTitle(name) || /^(?:일정|또는|신청|마감은|할 일|마감|있습니다|합니다)$/.test(name)) return '';
    return name;
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
        if (postponedOpen(segment)) return [make('일정', 0)];
        if (placedSchedule(segment)) return [make('일정', 0)];
        if (/출장\s*관련/.test(segment) && /정리|제출|준비|주세요|바랍니다/.test(segment)) return [make('할 일', 0)];
        const leave = ownLeaveWord(segment);
        if (leave) {
            const item = make('일정', 0);
            const titled = { ...item, title: leave };
            const today = seoulYmd(now);
            if (titled.date && titled.date >= today && titled.include === false && !/취소|열리지|질문|대략|마감된/.test(titled.warning || '')) {
                return [{ ...titled, include: true, low: false, warning: '' }];
            }
            return [titled];
        }
        if (!heldAfterModifier(segment) && new RegExp(EVENT_NOUN).test(segment) && !hasDeadline(segment) && !isDeadlineSubmission(segment) && /미룸|미룹|미뤄|미루|미뤘|미루었|다음에|추후|(?<![가-힣])연기(?!된|한)/.test(segment)) return [make('일정', 0)];
        if (/엽니다|개최합니다|개최해요/.test(segment) && !hasDeadline(segment) && !isDeadlineSubmission(segment) && !negatedClause(segment)) {
            const openedName = tidyTitle(segment).replace(/\s+/g, '');
            if (openedName && !/^(?:일정|할일|합니다|해요|엽니다)$/.test(openedName) && !bareTimeTitle(openedName)) return [make('일정', 0)];
        }
        if (replacement) return [make('일정', 0)];
        if (deadlineClosed(segment)) return [markUnsure(make('할 일', 0), '이미 마감된 내용이라 저장하면 정리함에 들어가요.')];
        if (magamIsDeadline(segment) && !span.range) return [make('할 일', 0)];
        if (thisYearRecording(segment)) return [make('할 일', 0)];
        const namedMagamLeft = String(segment).replace(new RegExp(`(?<![가-힣])마감\\s+${MAGAM_EVENT_TAIL}`, 'g'), ' ');
        if (/(?<![가-힣])마감(?!되었|됐)/.test(segment) && !magamIsDeadline(segment) && hasEvent(segment) && !hasDeadline(segment) && !isRequest(namedMagamLeft) && !/제출|회신|작성|입력|업로드|탑재/.test(namedMagamLeft)) return [make('일정', 0)];
        if (listed && !isDeadlineSubmission(segment) && !hasDeadline(segment)) {
            const thisYearSide = /(?:작년|지난해|재작년|지난\s*해)/.test(fullText) && /올해|이번에/.test(fullText) && /(?:합니다|해요)[.。]?\s*$/.test(segment) && !pastPredicate(segment) && !new RegExp(EVENT_NOUN).test(segment);
            if (thisYearSide) {
                const item = make('일정', 0);
                const compact = String(item.title || '').replace(/\s+/g, '');
                const nameless = !compact || /^(?:올해|작년|이번|다음|일정|할일|합니다|해요|했습니다|했어요)$/.test(compact);
                if (!nameless) return [{ ...item, include: true, low: false, warning: '' }];
                return [make('할 일', 0)];
            }
            const bareName = tidyTitle(segment).replace(/\s+/g, '');
            const bareVerb = !bareName || /^(?:합니다|해요|했습니다|했어요|하였습니다|입니다|예요|에요)$/.test(bareName);
            if (bareVerb && !span.range && !hasEvent(segment) && !new RegExp(EVENT_NOUN).test(segment) && !EVENT_WORD.test(segment)) return [make('할 일', 0)];
            return [make('일정', 0)];
        }
        if ((moved || oldDate) && !isDeadlineSubmission(segment)) {
            if (/제출|회신|작성|입력|업로드|마감|회수|탑재|기한/.test(segment)) return [make('할 일', 0)];
            return [make('일정', 0)];
        }
        if (documentSubmission(segment) || isApplicationDeadline(segment)) return [make('할 일', 0)];
        if (hasDeadline(segment) && /(?:참가|참여|신청|접수)/.test(segment) && !span.range) return [make('할 일', 0)];
        if (/(?:학예회|설명회|상담\s*주간)/.test(segment) && !isDeadlineSubmission(segment) && !hasDeadline(segment) && !isRequest(segment)) return [make('일정', 0)];
        if (span.range && !isDeadlineSubmission(segment)) return [make('일정', 0)];
        if (isDeadlineSubmission(segment) || (hasDeadline(segment) && !span.range)) return [make('할 일', 0)];
        if (todo && event && !isDeadlineSubmission(segment) && /참석|참여/.test(segment) && !/(?:제출|회신|작성|입력|업로드|마감|회수|탑재)/.test(segment)) return [make('일정', 0)];
        if (todo && event) return collapsePair([make('일정', 0), make('할 일', 1)], segment);
        if (event || (when.hm && !todo)) return [make('일정', 0)];
        if (todo) return [make('할 일', 0)];
        const picked = String(pickTitle(segment, segment) || '').replace(/\s+/g, '');
        const onlyVerb = /^(?:했어요|했습니다|하였습니다|합니다|해요|입니다|예요|에요)$/.test(picked);
        if (!picked || onlyVerb) {
            const compared = /(?:재작년|작년|지난해|지난\s*해)(?:보다|처럼)/.test(segment);
            if (compared && findDates(segment, now).length && (pastPredicate(segment) || hasPredicate(segment))) {
                const place = (String(segment).match(/(강당|운동장|체육관|도서관|교실|시청각실)\s*에서/) || [])[1] || '';
                const item = make('일정', 0);
                const titled = place ? { ...item, title: place } : item;
                if (pastPredicate(segment) || titled.include === false) return [titled];
                return [{ ...titled, include: true, low: false, warning: '' }];
            }
            if (!picked) return [];
        }
        return [make('할 일', 0)];
    })();
    const distinctDates = new Set(findDates(segment, now).map((item) => item.ymd));
    const ambiguous = distinctDates.size > 1 && !span.range && !moved && !oldDate;
    const named = hasTodo(segment) || hasTrip(segment) || EVENT_WORD.test(segment) || /\d\s*교시/.test(segment) || /(?:대회|(?<![가-힣])(?:현장체험학습|현장학습|촬영|공사|상담|검사|평가|시험|소풍|발표))/.test(segment);
    const vague = made.map((item) => {
        let next = item;
        const compact0 = String(next.title || '').replace(/\s+/g, '');
        const thinVerb = /^(?:있습니다|합니다|해요|갑니다|엽니다|봅니다|봐요|드립니다|주세요|했어요|했습니다|입니다)$/;
        if (/^(?:일정|또는|신청|마감은)$/.test(compact0) || thinVerb.test(compact0) || (compact0 === '할일' && next.kind === '일정')) {
            const rescued = namedEvent(segment) || namedEvent(fullText);
            if (rescued) next = { ...next, title: compact0 === '신청' ? `${rescued} 신청` : rescued };
        }
        if (String(next.title || '').replace(/\s+/g, '') === '마감') {
            const rescued = namedEvent(segment);
            if (rescued && !/마감/.test(rescued)) next = { ...next, title: `${rescued} 마감` };
            else {
                const clock = String(segment).match(/((?:오전|오후)\s*)?\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?/);
                if (clock) next = { ...next, title: `${clock[0].replace(/\s+/g, ' ').trim()} 마감` };
            }
        }
        const title = String(next.title || '').trim();
        const compact = title.replace(/\s+/g, '');
        if (bareTimeTitle(compact) || bareTimeTitle(next.title)) {
            next = markUnsure({ ...next, title: '날짜만 있음' }, '행사명이 없어 저장하면 정리함에 들어가요.');
        }
        const titled = String(next.title || '').trim();
        const compactTitle = titled.replace(/\s+/g, '');
        const bare = /^(?:일정|또는|신청|마감은|할 일)$/.test(compactTitle);
        const namedInText = /연수|대회|학예회|설명회|박람회|축제|체험학습|현장학습|수련회|협의회|공개수업|체육대회|운동회|발표회|강연|발표/.test(`${segment}\n${fullText}`);
        if (bare && next.include !== false && !span.range && !moved && !replacement && !oldDate && namedInText) return markUnsure(next, '무엇의 일정인지 저장하면 정리함에 들어가요.');
        const stillThin = /^(?:신청|있습니다|합니다|해요|갑니다|엽니다|봅니다|봐요|드립니다|주세요|했어요|했습니다)$/.test(compactTitle);
        const absenceApplication = compactTitle === '신청' && /까지/.test(segment) && new RegExp(OTHER_PERSON).test(fullText) && new RegExp(OTHER_ABSENCE).test(fullText) && !/(?<![가-힣])(?:제가|저는|저)(?![가-힣])/.test(fullText);
        if (stillThin && !absenceApplication && next.include !== false && !span.range && !moved && !replacement && !oldDate) return markUnsure(next, '무엇의 일정인지 저장하면 정리함에 들어가요.');
        const genericSchedule = title === '일정' && !moved && !replacement && !oldDate && !span.range && !when.period;
        const genericTodo = title === '할 일' && !moved && !replacement && !oldDate && !span.range && !named;
        const generic = genericSchedule || genericTodo;
        const leftover = /^(?:그대로|아니라|정정|졌습니다|됐습니다)$/.test(compact);
        if (!generic && !leftover) return next;
        if (next.low) return next;
        return markUnsure(next, '무엇의 일정인지 저장하면 정리함에 들어가요.');
    });
    if (oldDate) return vague.map((item) => markUnsure(item, '예전 날짜라 저장하면 정리함에 들어가요.'));
    if (ambiguous) return vague.map((item) => markUnsure(item, '날짜가 여러 개라 저장하면 정리함에 들어가요.'));
    const dueSpans = findDates(segment, now);
    const due = dueSpanOf(segment, dueSpans);
    const dueTail = due ? segment.slice(due.index + due.length) : '';
    if (due && dueSpans.length === 1 && /^\s*(?:(?:오전|오후)\s*)?(?:\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?\s*)?까지/.test(dueTail)) {
        return vague.map((item) => ({ ...item, kind: '할 일', date: item.date || due.ymd }));
    }
    if (!unsure) return vague;
    return vague.map((item) => markUnsure(item, '같은 문장에서 나눈 내용이라 저장하면 정리함에 들어가요.'));
}

/** 출장 연수의 괄호·내용·주제가 있으면 그 이름이 제목입니다. */
function trainingContent(text) {
    const src = String(text || '');
    const paren = src.match(/연수\s*[（(]\s*([^)）]{2,30})\s*[)）]/);
    if (paren) {
        const name = tidyTitle(paren[1]).replace(/(?:입니다|해요|합니다)$/g, '').trim();
        if (name && !/^(?:출장\s*연수|연수|출장)$/.test(name)) return name;
    }
    const matched = src.match(/(?:연수\s*)?(?:내용|주제|연수명)(?:은|는|이|가|:)\s*([가-힣A-Za-z0-9]{2,24}(?:\s+[가-힣A-Za-z0-9]{2,16}){0,3})/);
    if (!matched) return '';
    const name = tidyTitle(matched[1]).replace(/(?:입니다|해요|합니다)$/g, '').trim();
    if (!name || /^(?:출장\s*연수|연수|출장)$/.test(name)) return '';
    return name;
}

function renameTripTraining(item) {
    if (!/출장\s*연수/.test(String(item.title || ''))) return item;
    let title = String(item.title).replace(/출장\s*연수/g, '연수').replace(/\s+/g, ' ').trim();
    if (item.kind === '할 일') {
        title = title.replace(/신청(?!서)/g, '신청서');
        if (/신청서/.test(title) && !/제출|마감/.test(title)) title = `${title} 제출`.replace(/\s+/g, ' ').trim();
    }
    return { ...item, title };
}

/** 결재·품의 카드가 다른 말로 붙으면 그 이름으로 되돌립니다. 마감·제출이 붙은 제목은 둡니다. */
function approvalTitle(item) {
    const raw = String(item?.raw || '');
    const title = String(item?.title || '');
    if (item?.kind !== '할 일') return item;
    const want = /품의/.test(`${raw} ${title}`) ? '품의' : (/결재/.test(`${raw} ${title}`) ? '결재' : '');
    if (!want || title.includes(want) && /마감|제출/.test(title)) return item;
    const compact = title.replace(/\s+/g, '');
    const noisy = compact === '마감' || /이번주|다음주|지도하시므로|공개수업/.test(compact) || (title.includes(want) && compact !== want);
    if (!noisy && compact !== '마감') return item;
    return { ...item, title: want };
}

function sameTargetCard(left, right) {
    if ((left?.date || '') !== (right?.date || '') || (left?.end || '') !== (right?.end || '')) return false;
    if ((left?.time || '') !== (right?.time || '') || (left?.period || 0) !== (right?.period || 0)) return false;
    const a = String(left?.title || '').replace(/\s+/g, '');
    const b = String(right?.title || '').replace(/\s+/g, '');
    if (!a || !b) return false;
    if (a === b) return true;
    const shorter = a.length <= b.length ? a : b;
    const longer = a.length <= b.length ? b : a;
    return shorter.length >= 2 && longer.includes(shorter);
}

function dedupeTargets(items) {
    const out = [];
    items.forEach((item) => {
        const at = out.findIndex((prev) => sameTargetCard(prev, item));
        if (at < 0) {
            out.push(item);
            return;
        }
        const prev = out[at];
        const bareLeave = /^(?:출장|연가|연차|휴가|조퇴|부재|병가|외출|연수)$/;
        const prevBare = bareLeave.test(String(prev.title || '').replace(/\s+/g, ''));
        const itemBare = bareLeave.test(String(item.title || '').replace(/\s+/g, ''));
        if (prevBare && !itemBare) out[at] = item;
        else if (!prev.include && item.include) out[at] = item;
    });
    return out;
}

const PERSON_ONLY_TITLE = /^(?:부장님|부장\s*님|교감(?:\s*선생님)?|담임(?:\s*선생님)?|교무부장님|행정실장님|학년부장님|연구부장님|[가-힣]{1,4}\s*선생님|[가-힣]{2,10}님)$/;

const REASON_TAIL = /(?:출장|연수|병가|연가|휴가|공가|외출|반차)(?:으로|로)/;

/** 제목 끝의 조사·요청어를 떼고, 문장 끝의 내·보내 주세요만 제출로 둡니다. */
function polishTitle(title, segment = '', full = '') {
    let t = String(title || '').replace(/\s+/g, ' ').trim();
    if (!t) return t;
    const hadCooperate = /협조/.test(t);
    const seg = String(segment || '');
    const wide = `${seg}\n${full || ''}`;
    t = t.replace(/기존\s*일정대로|기존대로|원래대로|일정대로|예정대로/g, ' ');
    t = t.replace(/(?:^|\s)대로(?=\s|$)/g, ' ');
    t = t.replace(/^(?:제가|저는|저도|저만)\s+/, '');
    t = t.replace(/(?:^|\s)[가-힣]{1,16}(?:이신데|이라서|이라)(?=\s|$)/g, ' ');
    t = t.replace(/\s*보내\s*드려요$/g, '').trim();
    if (/(?:보내|내)\s*(?:주세요|주세|주시기|주십시오)/.test(seg)) {
        t = t.replace(/([가-힣]{2,})(?:은|는|을|를)\s+(?:보내|내)(?=\s|$)/g, '$1 제출');
        t = t.replace(/(?:^|\s)(?:보내|내)(?=\s|$)/g, ' 제출');
    }
    if (/양식/.test(seg) && /제출/.test(wide)) {
        t = t.replace(/^(?:보낸|올린|공유한|안내한)\s+/, '');
        t = t.replace(/\s*양식(?:으로|로)(?=\s*제출(?:\s|$))/g, '');
        if (/(?:^|\s)양식(?:으로|로|으)?$/.test(t)) t = t.replace(/(?:^|\s)양식(?:으로|로|으)?$/, ' 제출');
        t = t.replace(/\s+/g, ' ').trim();
    }
    if (/바뀌|바꿉|변경/.test(seg)) {
        t = t.replace(/([가-힣]{2,})(?:이|가)\s+((?:\d+\s*층)|[가-힣]{1,12})으로$/g, '$1 $2');
        t = t.replace(/([가-힣]{2,})(?:이|가)\s+((?:\d+\s*층)|[가-힣]{1,12})(?<!으)로$/g, '$1 $2');
    }
    t = t.replace(/\s+/g, ' ').trim();
    let guard = 0;
    while (guard < 6) {
        const next = t
            .replace(/(?:^|\s)(?:협조|오시기|보내|내|주|부탁)$/g, '')
            .replace(/([가-힣]{2,})으로$/g, '$1')
            .replace(/([가-힣]{2,})(?<!으)로$/g, '$1')
            .replace(/([가-힣]{2,})(?:에|를|을)$/g, '$1')
            .replace(/\s+/g, ' ')
            .trim();
        if (!next || next === t) break;
        t = next;
        guard += 1;
    }
    if (hadCooperate) t = t.replace(/(?:^|\s)운영$/g, '').replace(/\s+/g, ' ').trim();
    if (REASON_TAIL.test(t)) {
        t = t.replace(/(?:^|\s)[가-힣]{0,12}\s*(?:출장|연수|병가|연가|휴가|공가|외출|반차)(?:으로|로)(?=\s|$)/g, ' ').replace(/\s+/g, ' ').trim();
    }
    const nameBecause = (chunk, at) => {
        const matched = String(chunk).slice(at).match(/^\s*([가-힣]{1,8})(?:는|ㄴ)\s+[가-힣]/);
        return Boolean(matched) && /(?:하|되|지|리|기|오|우|뀌|끼|켜|내|치|주|보|쓰|르|키|시|니|워)$/.test(matched[1]);
    };
    const keepName = (all, offset) => (nameBecause(t, offset + all.length) ? all : '');
    const keepNameSpace = (all, offset) => (nameBecause(t, offset + all.length) ? all : ' ');
    t = t.replace(/^(?:[가-힣]{1,12}\s+)??[가-힣]{1,12}(?:으로|로)\s*인해(?:서)?\s+/, keepName);
    t = t.replace(/^(?:[가-힣]{1,12}\s+)??[가-힣]{1,12}(?:으로|로)\s*인하여\s+/, keepName);
    t = t.replace(/^(?:[가-힣]{1,12}\s+)??[가-힣]{1,12}\s*때문에\s+/, keepName);
    t = t.replace(/(?:^|\s)[가-힣]{1,12}(?:으로|로)\s*인해(?:서)?(?=\s|$)/g, keepNameSpace);
    t = t.replace(/(?:^|\s)[가-힣]{1,12}(?:으로|로)\s*인하여(?=\s|$)/g, keepNameSpace);
    t = t.replace(/(?:^|\s)[가-힣]{1,12}\s*때문에(?=\s|$)/g, keepNameSpace);
    t = t.replace(/^(?:[가-힣]{1,12}\s+){1,3}관계로\s+/, '');
    t = t.replace(/(?:^|\s)[가-힣]{1,12}\s+관계로(?=\s|$)/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    if (/(?:은|는)\s*쉽니다/.test(seg)) t = t.replace(/(?:은|는)\s*쉽니다$/g, '').replace(/\s+/g, ' ').trim();
    if (/보결|보강/.test(seg) && !/교시/.test(t) && /^(?:보결|보강)$/.test(t)) {
        const comma = seg.match(/(\d)\s*[,·]\s*(\d)\s*교시/);
        const tilde = seg.match(/(\d)\s*[~～\-–—]\s*(\d)\s*교시/);
        const one = seg.match(/(\d)\s*교시/);
        const bit = comma ? `${comma[1]},${comma[2]}교시` : (tilde ? `${tilde[1]}~${tilde[2]}교시` : (one ? `${one[1]}교시` : ''));
        if (bit) t = `${bit} ${t}`.replace(/\s+/g, ' ').trim();
    }
    if (/\d+\s*층\s*에서/.test(seg) && !/바뀌|바꿉|변경/.test(seg)) {
        t = t.replace(/(?:^|\s)\d+\s*층(?=\s|$)/g, ' ');
    }
    t = t.replace(/([가-힣]{2,})(?:은|는)\s+(제출|회신|작성|입력|업로드)(?=\s|$)/g, '$1 $2');
    t = t.replace(/(?:되었|됐)(?:습니다|어요)$/g, '');
    t = t.replace(/예정이었던/g, ' ');
    t = t.replace(/(?:^|\s)(?:이었|였)던(?=\s|$)/g, ' ');
    t = t.replace(/(?:이었|였)(?:습니다|어요)$/g, '');
    if (dateModifyingMarker(seg) || dateModifyingMarker(full)) {
        t = t.replace(/변경\s*전/g, ' ');
        t = t.replace(/(?:^|\s)(?:원래|당초|기존)(?:는|은|의)?(?=\s|$)/g, ' ');
    }
    t = t.replace(/변경\s*후/g, ' ');
    t = t.replace(/^하던\s+/, '');
    t = t.replace(/(?:^|\s)던(?=\s|$)/g, ' ');
    if (/수업\s*후\s*전/.test(wide)) t = t.replace(/수업\s*후\s*전/g, ' ').replace(/(?:^|\s)후\s*전(?=\s|$)/g, ' ');
    if (/진행(?:합니다|해요)\s*[.。!！]?\s*$/.test(String(seg || full || '').trim()) && !/진행해\s*주/.test(wide)) {
        const cut = t.replace(/(?:^|\s)진행$/, '').replace(/(?<=[가-힣])(?:은|는|을|를)$/g, '').replace(/\s+/g, ' ').trim();
        if (cut && !endsWithStemOrParticle(cut)) t = cut;
    }
    t = t.replace(/(?:^|\s)(?:갑니다|가요)(?=\s|$)/g, ' ');
    t = t.replace(/(?:^|\s)바뀐(?=\s|$)/g, ' ');
    t = t.replace(/[/／]/g, ' ');
    t = t.replace(/\s+/g, ' ').trim();
    t = t.replace(/(?<=[가-힣])(?:은|는|을|를)$/g, '');
    t = t.replace(/\s+/g, ' ').trim();
    const lastWord = t.split(/\s+/).pop() || '';
    if (leeParticle(lastWord)) t = t.replace(/이$/, '').trim();
    if (/(?<=[가-힣]{2,})가$/.test(lastWord) && !/(?:평가|휴가|연가|병가|공가|추가|결과|참가|출가)$/.test(lastWord)) t = t.replace(/가$/, '').trim();
    if (/제출하지\s*못한/.test(t) && /다시\s*올려/.test(t)) t = '다시 올리기';
    return t;
}

/** 기한 할 일의 제목이 연수만 남으면 신청서 제출로 붙입니다. 일정 제목은 그대로 둡니다. */
function shapeTitle(title, segment, full, kind) {
    const t = polishTitle(title, segment, full);
    if (kind === '할 일' && /신청서/.test(full) && /까지/.test(full) && /^(?:출장\s*)?연수$/.test(t)) return '연수 신청서 제출';
    return t;
}

/** 취소 없이·연기하지 않고처럼 부정된 말은 변경 표현으로 세지 않습니다. */
function textWithoutSafeChange(text) {
    return String(text || '')
        .replace(/취소(?:하지|\s*않|\s*없이)/g, ' ')
        .replace(/연기(?:하지\s*않|\s*없이)/g, ' ')
        .replace(/미루지\s*않/g, ' ')
        .replace(/변경\s*없이/g, ' ')
        .replace(/잊지\s*못하게/g, ' ')
        .replace(/빠지지\s*못/g, ' ');
}

/**
 * 날짜 뒤에 붙은 원래·기존·당초는 행사 이름입니다.
 * 그 말 바로 뒤가 날짜이거나 '날짜·일정'이면 이름을 꾸미는 말이 아닙니다.
 */
function oldWordsAreEventNames(text, now) {
    const bare = String(text || '');
    const spans = findDates(bare, now);
    const re = /원래|당초|기존|변경\s*전|변경\s*후/g;
    let match;
    let saw = false;
    while ((match = re.exec(bare))) {
        saw = true;
        const after = bare.slice(match.index + match[0].length, match.index + match[0].length + 24);
        if (/^\s*(?:는|은|의)?\s*[:：]?\s*(?:\(\s*)?(?:\d{1,2}\s*[./]\s*\d{1,2}|\d{1,2}\s*월)/.test(after)) return false;
        if (/^\s*(?:는|은|의)?\s*(?:날짜|일정)/.test(after)) return false;
        if (!spans.some((span) => span.index + span.length <= match.index)) return false;
    }
    return saw;
}

/**
 * 연기·변경·취소·옮김·미룸·앞당김은 확인이 필요합니다.
 * 원래·기존·당초·변경 전/후는 바로 뒤에 날짜가 오거나, 날짜·일정이 그 말을 받거나, 날짜가 둘 이상일 때만입니다.
 * 날짜 뒤에서 행사 이름으로 쓰인 원래·기존·당초는 날짜가 둘이라도 변경이 아닙니다.
 * 원래대로·기존대로는 예정이었던 대로와 같이 변경이 아닙니다. 바꿉·바꿔·바뀝도 새 날짜가 있거나 날짜가 둘일 때만입니다.
 */
export function hasChangeCue(text, now) {
    const src = withoutAsPlanned(textWithoutSafeChange(text));
    const bare = withoutAsPlanned(textWithoutSafeChange(text));
    const oldWord = /(?:원래|당초|기존|변경\s*전|변경\s*후)/.test(bare);
    const oldStatement = /(?:원래|당초|기존|변경\s*전)\s*(?:는|은|의)?\s*(?:날짜|일정)/.test(bare) && findDates(bare, now).length >= 1;
    const nameOnly = oldWord && dateGroupCount(bare, now) >= 2 && oldWordsAreEventNames(bare, now);
    const oldCue = oldWord && !nameOnly && (dateGroupCount(bare, now) >= 2 || dateModifyingMarker(bare) || oldStatement);
    const swapCue = /(?<![가-힣])(?:바꿉|바꿔|바뀝)/.test(src) && (dateGroupCount(src, now) >= 2 || Boolean(destinationYmd(src, now)));
    const moveCue = /(?:(?<![가-힣])연기(?!된|한)|(?<![가-힣])변경(?!\s*전|\s*후)|(?<![가-힣])취소|(?<![가-힣])옮|(?<![가-힣])미루(?!지)|(?<![가-힣])미룹|(?<![가-힣])미뤄|(?<![가-힣])앞당)/.test(src);
    return oldCue || swapCue || moveCue;
}

/** 물결·부터·N일간으로 이어진 날은 한 기간입니다. 같은 날을 두 번 적어도 하나입니다. */
export function dateGroupCount(text, now) {
    const spans = findDates(text, now);
    const groups = [];
    for (let i = 0; i < spans.length; i += 1) {
        const next = spans[i + 1];
        if (next && spans[i].ymd === next.ymd) continue;
        const around = next ? text.slice(spans[i].index, next.index + next.length + 8) : '';
        if (next && (rangeJoin(text, spans[i], next) || /이틀간|사흘간|나흘간|양일간|\d+\s*일간/.test(around))) {
            groups.push(`${spans[i].ymd}~${next.ymd}`);
            i += 1;
            continue;
        }
        groups.push(spans[i].ymd);
    }
    return new Set(groups).size;
}

function needsConfirm(text, now) {
    return hasChangeCue(text, now);
}

const DEST_AFTER = /^\s*(?:(?:오전|오후)\s*)?(?:\d{1,2}\s*시(?:\s*\d{1,2}\s*분|\s*반)?|\d{1,2}\s*:\s*\d{2})?\s*(?:으로|로)\s*(?:연기|변경|옮|미루|미뤄|미룹|바꿉|바꿔|바뀝|앞당)/;

/** '(날짜)로 연기/변경/옮깁니다'의 그 날짜입니다. 시각이 끼어 있어도 봅니다. */
function destinationYmd(text, now) {
    let found = '';
    findDates(text, now).forEach((span) => {
        const after = text.slice(span.index + span.length, span.index + span.length + 48);
        if (DEST_AFTER.test(after)) found = span.ymd;
    });
    return found;
}

function confirmPieces(text) {
    const pieces = [];
    String(text || '').split('\n').forEach((line) => {
        splitSentences(line).forEach((sentence) => {
            const trimmed = sentence.trim();
            if (trimmed) pieces.push(trimmed);
        });
    });
    return pieces;
}

/**
 * 변경·예전 값이면 넣지 않고 원문 노란 카드로 둡니다. 날짜만 여럿인 마감과 행사는 그대로 둡니다.
 * 새 날짜가 '(날짜)로 연기/변경/옮깁니다'로 분명하면 그 날짜를 기본값으로 채웁니다.
 * 우천처럼 조건이 있으면 원래 날짜는 포함으로 남기고, 미룬 날짜만 노란 카드로 더합니다.
 */
function confirmUncertain(text, items, now) {
    const note = '확인이 필요해 저장하면 정리함에 들어가요.';
    let next = items.map((item) => ({ ...item }));
    const paint = (index, title) => {
        const item = next[index];
        const warning = String(item.warning || '').includes(note) ? item.warning : [item.warning, note].filter(Boolean).join(' ');
        next[index] = { ...item, title, include: false, low: true, warning };
    };
    confirmPieces(text).forEach((sentence) => {
        if (!needsConfirm(sentence, now)) return;
        const title = sentence.replace(/\s+/g, ' ').trim();
        const spans = findDates(sentence, now);
        const ymds = new Set(spans.map((span) => span.ymd));
        const dest = destinationYmd(sentence, now);
        if (rainHold(sentence)) {
            if (dest && !next.some((item) => item.date === dest || item.end === dest)) {
                next.push({
                    id: `msg${fnv1a32(`rain|${dest}|${title}`)}`,
                    kind: '일정',
                    eventKind: '',
                    title,
                    date: dest,
                    end: '',
                    time: '',
                    endTime: '',
                    period: 0,
                    periodEnd: 0,
                    memo: '',
                    include: false,
                    low: true,
                    warning: note,
                    sensitive: false,
                    confidence: 0.4,
                    assumedPm: false,
                    raw: title,
                });
            }
            return;
        }
        const onlyPiece = confirmPieces(text).length === 1;
        const related = [];
        next.forEach((item, index) => {
            if (onlyPiece || ymds.has(item.date) || (item.end && ymds.has(item.end))) related.push(index);
        });
        if (!related.length) {
            const compact = title.replace(/\s+/g, '');
            next.forEach((item, index) => {
                if (item.date) return;
                const raw = String(item.raw || '').replace(/\s+/g, '');
                if (raw && (compact.includes(raw) || raw.includes(compact))) related.push(index);
            });
            related.forEach((index) => paint(index, title));
            return;
        }
        const hasDest = dest && related.some((index) => next[index].date === dest || next[index].end === dest);
        if (dest && !hasDest && related.length === 1) {
            const index = related[0];
            const item = next[index];
            const kept = [item.date, item.end].filter(Boolean);
            next[index] = { ...item, date: dest, end: item.end && ymds.has(item.end) ? item.end : '' };
            paint(index, title);
            kept.forEach((ymd) => {
                if (ymd === dest) return;
                const monthDay = ymd.slice(4);
                if (next.some((row) => row.date === ymd || row.end === ymd || String(row.date || '').slice(4) === monthDay)) return;
                next.push({
                    id: `msg${fnv1a32(`confirm|${ymd}|${title}`)}`,
                    kind: item.kind || '일정',
                    eventKind: item.eventKind || '',
                    title,
                    date: ymd,
                    end: '',
                    time: '',
                    endTime: '',
                    period: 0,
                    periodEnd: 0,
                    memo: '',
                    include: false,
                    low: true,
                    warning: note,
                    sensitive: false,
                    confidence: 0.4,
                    assumedPm: false,
                    raw: title,
                });
            });
            return;
        }
        related.forEach((index) => paint(index, title));
        if (!dest) {
            ymds.forEach((ymd) => {
                const monthDay = ymd.slice(4);
                if (next.some((item) => item.date === ymd || item.end === ymd || String(item.date || '').slice(4) === monthDay)) return;
                const seed = related.length ? next[related[0]] : null;
                next.push({
                    id: `msg${fnv1a32(`confirm|${ymd}|${title}`)}`,
                    kind: seed?.kind || '일정',
                    eventKind: '',
                    title,
                    date: ymd,
                    end: '',
                    time: '',
                    endTime: '',
                    period: 0,
                    periodEnd: 0,
                    memo: '',
                    include: false,
                    low: true,
                    warning: note,
                    sensitive: false,
                    confidence: 0.4,
                    assumedPm: false,
                    raw: title,
                });
            });
        }
    });
    return next.map((item) => {
        if (item.include === false) return item;
        const last = String(item.title || '').trim().split(/\s+/).pop() || '';
        if (last === '들어' || /^계신(?:\s*[?？])?$/.test(last)) return markUnsure(item, '제목이 어간으로 끝나 저장하면 정리함에 들어가요.');
        return item;
    });
}

/** 확인이 필요한 문장이 원문 노란 카드로 남았는지 봅니다. 확실한 문장은 false입니다. */
export function confirmShapeOk(text, items, now = new Date()) {
    const pieces = confirmPieces(text);
    const unsure = pieces.filter((piece) => needsConfirm(piece, now));
    if (!unsure.length) return false;
    if (!items.length || items.some((item) => item.include !== false)) return false;
    const titles = new Set(pieces.map((piece) => piece.replace(/\s+/g, ' ').trim()));
    titles.add(String(text || '').replace(/\s+/g, ' ').trim());
    if (!items.every((item) => titles.has(String(item.title || '').replace(/\s+/g, ' ').trim()))) return false;
    return unsure.every((piece) => {
        const dest = destinationYmd(piece, now);
        if (!dest) return true;
        return items.some((item) => item.date === dest || item.end === dest);
    });
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
    const content = trainingContent(raw);
    const titled = items.map((item) => {
        let next = item;
        if (content && /출장\s*연수|연수/.test(String(item.title || ''))) {
            if (item.kind === '일정') next = { ...item, title: content };
            else {
                const tail = (String(item.title).match(/신청|접수|제출|마감/) || [])[0] || '';
                next = { ...item, title: tail ? `${content} ${tail}` : content };
            }
        } else next = approvalTitle(renameTripTraining(item));
        return { ...next, title: shapeTitle(next.title, next.raw, raw, next.kind) };
    });
    const visible = confirmUncertain(raw, dedupeTargets(titled.map(scrubTimeTitle)), now).filter((item) => !(item.include === false && PERSON_ONLY_TITLE.test(String(item.title || '').trim())));
    if (!visible.length && findDates(raw, now).length && !silentOtherAbsence(raw, now)) {
        const card = scrubTimeTitle(markUnsure(buildItem(raw, '할 일', now, periods, 0, [], raw), '날짜는 있는데 내용을 못 나눠 저장하면 정리함에 들어가요.'));
        if (card.date && !PERSON_ONLY_TITLE.test(String(card.title || '').trim())) return { items: [{ ...card, title: shapeTitle(card.title, card.raw, raw, card.kind) || '할 일' }] };
    }
    if (!visible.some((item) => item.date)) return { items: visible };
    return { items: visible.filter((item) => item.date || item.time || /취소/.test(item.warning)) };
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
