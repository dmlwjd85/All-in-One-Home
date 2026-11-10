/**
 * 문장 역할 나누기(항목 10). 기존 parse·jjaemPaste·msgParse는 그대로 두고, 그 위에 덧붙이는 작은 도우미입니다.
 *  - 시간구: '퇴근 전까지', '오늘 안에', '점심 전', '내일 아침', '수업 끝나고', '3교시에' 같은 말
 *  - 행동 어간: 제출·회신·출력·챙기 … (무엇을 하는지)
 *  - 어미: 요청·완료·부정·취소·변경·계획 (그 일이 앞으로 할 일인지, 이미 끝났는지, 없어졌는지)
 * 시간구의 실제 시각은 설정된 출근·퇴근, 오늘 조퇴, 교시 시각으로 정합니다. 설정이 비어 있으면 정하지 않고
 * missing으로 돌려 노란 카드(확인)로 넘깁니다. 클라우드에 새 칸을 만들지 않고, 기존 todo/event의 time·date만 채웁니다.
 */

/** 마감('~전까지', '~안에')은 경계 시각보다 이만큼 먼저 알립니다. */
export const BEFORE_LEAD_MIN = 10;
/** 출퇴근이 비어 있을 때 보여 주는 추천값. 저장된 값이 아니므로 확인 없이 쓰지 않습니다. */
export const SUGGEST_WORK = { workStart: '08:30', workEnd: '16:30' };

const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const isHm = (v) => HM_RE.test(String(v || ''));
const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const toHm = (min) => {
    const m = Math.max(0, Math.min(23 * 60 + 59, Math.round(min)));
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

function addDays(ymd, n) {
    const [y, m, d] = String(ymd).split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + n));
    return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}

/* ───────── 어미 ───────── */

/** 어미 갈래. 앞에 있는 갈래가 먼저 이깁니다(취소가 변경보다, 변경이 요청보다 셉니다). */
const END = '(?=\\s*[.!?~ㅠㅜ]*\\s*$)';
const ENDINGS = [
    ['cancel', new RegExp(`(?:취소(?:됐|되었|됩니다|되어|돼|합니다|해요|했|함|요|\\s*공지)|취소${END}|없던\\s*(?:일|걸)|안\\s*하기로|하지\\s*않기로|열리지\\s*않|진행하지\\s*않|미실시|폐지(?:됐|됩니다|돼|함))`)],
    ['change', new RegExp(`(?:변경(?:됐|되었|됩니다|돼|합니다|해요|했|함|요|\\s*공지)|변경${END}|바뀌|바뀝|바꿨|바꿔\\s*(?:요|주|드|놨|두)|옮겨(?:졌|집니다|요|서)|옮깁|연기(?:됐|되었|됩니다|돼|합니다|해요|함)|미뤄(?:졌|집니다|요|서)|미룹|당겨(?:졌|집니다|요|서)|앞당겨|늦춰(?:졌|집니다|요)|조정(?:됐|되었|됩니다|돼|함))`)],
    ['negate', /(?:안\s*해도|하지\s*않아도|않으셔도|안\s*하셔도|필요\s*없|없어도\s*(?:돼|됩)|안\s*(?:내도|보내도|가져와도)|(?<!잊)지\s*마(?:세요|십시오|시고|요)|말아\s*주)/],
    ['done', new RegExp(`(?:했(?:어요|음|다|습니다|지요)|함${END}|완료(?:했|함|됨)|완료${END}|끝냈|끝났|끝남|마쳤|마침${END}|냈(?:어요|음|다|습니다)|보냈(?:어요|음|다|습니다)|제출(?:했|함)|다\\s*했|처리(?:했|함))`)],
    ['request', new RegExp(`(?:해\\s*주(?:세요|십시오|시기|시면|실)|주세요|주십시오|바랍니다|바라요|부탁(?:드립|드려|해요|합니다)?|할\\s*것|(?:하|내|보내|쓰|챙기|걷)기${END}|해야\\s*(?:해|함|합|돼|됨|된)|하세요|하십시오|챙겨|잊지\\s*마|필수)`)],
    ['plan', /(?:할게요|할\s*게요|하겠습니다|하려고|할\s*예정|예정(?:입니다|이에요|임)|하기로\s*(?:했|함))/],
];

/** 끝맺음은 마지막 마디(쉼표·마침표 뒤)에서 봅니다. 앞마디의 '취소 신청서'처럼 이름 속 낱말은 어미가 아닙니다. */
function lastClause(text) {
    const parts = String(text || '').split(/[,，\n]|[.!?](?=\s|$)/).map((part) => part.trim()).filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
}

/** 어미(끝맺음) 갈래를 하나 고릅니다. 없으면 ''. */
export function classifyEnding(text) {
    const src = lastClause(text);
    if (!src) return '';
    for (const [id, re] of ENDINGS) if (re.test(src)) return id;
    return '';
}

/* ───────── 행동 어간 ───────── */

/** 학교 업무에서 자주 쓰는 행동 어간. [어간, 대표 이름]. 길이가 긴 것부터 맞춥니다. */
const STEMS = [
    ['나눠주', '배부'], ['나눠 주', '배부'], ['배부', '배부'], ['보내', '보내기'], ['발송', '보내기'], ['회신', '회신'],
    ['제출', '제출'], ['내기', '제출'], ['확인', '확인'], ['점검', '확인'], ['검토', '확인'], ['출력', '출력'], ['인쇄', '출력'],
    ['복사', '출력'], ['작성', '작성'], ['쓰기', '작성'], ['입력', '입력'], ['기안', '기안'], ['결재', '결재'], ['준비', '준비'],
    ['챙기', '챙기기'], ['챙겨', '챙기기'], ['전달', '전달'], ['안내', '전달'], ['공지', '전달'], ['연락', '연락'], ['전화', '연락'],
    ['문자', '연락'], ['수합', '수합'], ['걷기', '수합'], ['걷어', '수합'], ['신청', '신청'], ['등록', '등록'], ['접수', '신청'],
    ['정리', '정리'], ['업로드', '올리기'], ['올리', '올리기'], ['올려', '올리기'], ['예약', '예약'], ['주문', '주문'], ['구입', '주문'],
    ['구매', '주문'], ['반납', '반납'], ['채점', '채점'], ['상담', '상담'], ['회의', '회의'], ['청소', '정리'], ['게시', '올리기'],
];

/** 행동 어간을 찾습니다. { stem: 찾은 말, act: 대표 이름 } 또는 null. */
export function actionStem(text) {
    const src = String(text || '');
    const hits = [];
    for (const [stem, act] of STEMS) {
        let at = src.indexOf(stem);
        while (at >= 0) {
            hits.push({ stem, act, index: at, end: at + stem.length });
            at = src.indexOf(stem, at + 1);
        }
    }
    /* 겹치면 먼저 시작한(같으면 긴) 말이 이깁니다. '보내기' 속 '내기'는 따로 세지 않습니다. 남은 것 중 마지막이 행동입니다. */
    hits.sort((a, b) => a.index - b.index || b.stem.length - a.stem.length);
    const kept = [];
    for (const hit of hits) {
        if (kept.some((k) => hit.index < k.end && k.index < hit.end)) continue;
        kept.push(hit);
    }
    const best = kept[kept.length - 1];
    return best ? { stem: best.stem, act: best.act } : null;
}

/* ───────── 시간구 ───────── */

const BEFORE = '(?:\\s*(?:하기\\s*)?(?:전\\s*까지|전에|전으로|전(?![가-힣])|직전|까지|안에|안으로|내로|내에|중에|중으로))';
const AFTER = '(?:\\s*(?:이\\s*)?(?:끝나고|끝난\\s*(?:뒤|후)에?|마치고|마친\\s*(?:뒤|후)에?|후에?|뒤에?|하고\\s*나서))';

/** 시간구 규칙. edge: before(마감, 경계보다 먼저 알림) · at(그 시각) · after(끝난 시각). */
const PHRASES = [
    { kind: 'workEnd', edge: 'before', re: new RegExp(`퇴근${BEFORE}`) },
    { kind: 'workEnd', edge: 'at', re: /퇴근\s*(?:무렵|때|시간에|시각에|시간|하면서)/ },
    { kind: 'workEnd', edge: 'after', re: /퇴근\s*(?:하고|후에?|뒤에?|길에)/ },
    { kind: 'dayEnd', edge: 'before', re: /오늘\s*(?:안에|안으로|내로|내에|중에|중으로|까지)/ },
    { kind: 'workStart', edge: 'at', re: /출근\s*(?:하자마자|하면|하고\s*바로|직후|해서)|출근\s*길에/ },
    { kind: 'workStart', edge: 'before', re: new RegExp(`출근${BEFORE}`) },
    { kind: 'morning', edge: 'at', dayShift: 1, re: /내일\s*아침(?:에|부터|까지)?/ },
    { kind: 'morning', edge: 'at', dayShift: 2, re: /모레\s*아침(?:에|부터|까지)?/ },
    { kind: 'morning', edge: 'at', re: /(?<![가-힣])(?:아침\s*(?:에|일찍|조회\s*전)|오늘\s*아침에?)/ },
    { kind: 'evening', edge: 'at', dayShift: 1, re: /내일\s*저녁(?:에|때|쯤)?(?!\s*(?:밥|식사|메뉴))/ },
    { kind: 'evening', edge: 'at', dayShift: 2, re: /모레\s*저녁(?:에|때|쯤)?(?!\s*(?:밥|식사|메뉴))/ },
    { kind: 'evening', edge: 'at', re: /(?<![가-힣])(?:오늘\s*저녁(?:에|때|쯤)?(?!\s*(?:밥|식사|메뉴))|저녁\s*(?:에|때|쯤)(?![가-힣]))/ },
    { kind: 'lunch', edge: 'before', re: new RegExp(`점심(?:\\s*시간)?${BEFORE}`) },
    { kind: 'lunch', edge: 'after', re: new RegExp(`점심(?:\\s*시간)?(?:\\s*먹고|${AFTER})`) },
    { kind: 'lunch', edge: 'at', re: /(?<![가-힣])점심\s*(?:시간|때)(?:에|에는|쯤)?/ },
    { kind: 'classEnd', edge: 'after', re: new RegExp(`(?:수업|하교)${AFTER}|하교\\s*(?:하면|시간에|때)|수업\\s*다\\s*(?:끝나고|마치고)`) },
    { kind: 'period', edge: 'at', re: /(?<!\d)(10|[1-9])\s*[~～\-–—]\s*(?:10|[1-9])\s*교시(?:\s*(?:에|때|동안))?/ },
    { kind: 'period', edge: 'after', re: new RegExp(`(?<![\\d~～\\-–—]\\s*)(10|[1-9])\\s*교시${AFTER}`) },
    { kind: 'period', edge: 'before', re: new RegExp(`(?<![\\d~～\\-–—]\\s*)(10|[1-9])\\s*교시(?:\\s*시작)?${BEFORE}`) },
    { kind: 'period', edge: 'at', re: /(?<![\d~～\-–—]\s*)(10|[1-9])\s*교시(?:\s*(?:에|때|시작|시간에|쉬는\s*시간에?))?(?!\s*[~～\-–—,·]\s*\d)/ },
];

/** 본문에서 시간구를 찾습니다. 겹치면 먼저 찾은(위쪽 규칙) 것을 씁니다. */
export function findTimePhrases(text) {
    const src = String(text || '');
    const out = [];
    for (const rule of PHRASES) {
        const re = new RegExp(rule.re.source, 'g');
        for (const m of src.matchAll(re)) {
            const span = { index: m.index, length: m[0].length, word: m[0].trim(), kind: rule.kind, edge: rule.edge, dayShift: rule.dayShift || 0 };
            if (rule.kind === 'period') span.n = Number(m[1]);
            if (out.some((o) => span.index < o.index + o.length && o.index < span.index + span.length)) continue;
            out.push(span);
        }
    }
    return out.sort((a, b) => a.index - b.index);
}

/** 「저녁」 추천 시각. */
const EVENING_SUGGEST = '18:00';

/** 학교급과 상관없이 점심은 4교시 끝부터 5교시 시작까지로 봅니다. */
const LUNCH_AFTER_PERIOD = 4;

function periodEnd(ctx, n) {
    const start = ctx.starts?.[n - 1];
    if (!isHm(start)) return '';
    const len = Number(ctx.lengths?.[n - 1]) || 40;
    return toHm(toMin(start) + len);
}

/**
 * 시간구 하나의 경계 시각을 정합니다.
 * ctx: { today, hm, workStart, workEnd, leave(오늘 조퇴), starts[교시 시작], lengths[교시 길이], lastPeriod }
 * 돌려줌: { boundary, basis, missing, suggest } — missing이면 boundary는 '', suggest는 추천값 기준 경계입니다.
 */
function boundaryOf(span, date, ctx) {
    const today = date === ctx.today;
    const endOfWork = (label) => {
        if (today && isHm(ctx.leave)) return { boundary: ctx.leave, basis: `오늘 조퇴 ${ctx.leave}` };
        if (isHm(ctx.workEnd)) return { boundary: ctx.workEnd, basis: `${label} ${ctx.workEnd}` };
        return { boundary: '', basis: '', missing: 'workEnd', suggest: SUGGEST_WORK.workEnd };
    };
    switch (span.kind) {
        case 'workEnd':
        case 'dayEnd':
            return endOfWork('퇴근');
        case 'workStart':
        case 'morning':
            if (isHm(ctx.workStart)) return { boundary: ctx.workStart, basis: `출근 ${ctx.workStart}` };
            return { boundary: '', basis: '', missing: 'workStart', suggest: SUGGEST_WORK.workStart };
        case 'evening':
            /* 「저녁」은 사람마다 시각이 달라 정하지 않고, 18:00을 추천값으로 노란 카드에서 묻습니다. */
            return { boundary: '', basis: '', missing: 'vague', suggest: EVENING_SUGGEST };
        case 'lunch': {
            const at = span.edge === 'after' ? ctx.starts?.[LUNCH_AFTER_PERIOD] : periodEnd(ctx, LUNCH_AFTER_PERIOD);
            if (!isHm(at)) return { boundary: '', basis: '', missing: 'timetable', suggest: span.edge === 'after' ? '13:10' : '12:20' };
            return { boundary: at, basis: span.edge === 'after' ? `점심 끝 ${at}` : `점심 시작 ${at}` };
        }
        case 'classEnd': {
            const last = Number(ctx.lastPeriod) || 0;
            const at = last ? periodEnd(ctx, last) : '';
            if (!isHm(at)) return { boundary: '', basis: '', missing: 'timetable', suggest: '14:40' };
            return { boundary: at, basis: `${last}교시 끝 ${at}` };
        }
        case 'period': {
            const start = ctx.starts?.[span.n - 1];
            if (!isHm(start)) return { boundary: '', basis: '', missing: 'timetable', suggest: '' };
            if (span.edge === 'after') {
                const end = periodEnd(ctx, span.n);
                return { boundary: end, basis: `${span.n}교시 끝 ${end}` };
            }
            return { boundary: start, basis: `${span.n}교시 시작 ${start}` };
        }
        default:
            return { boundary: '', basis: '', missing: 'unknown', suggest: '' };
    }
}

function alarmFrom(boundary, edge) {
    if (!isHm(boundary)) return '';
    return edge === 'before' ? toHm(toMin(boundary) - BEFORE_LEAD_MIN) : boundary;
}

/**
 * 한 줄에서 첫 시간구를 찾아 날짜·시각을 정합니다. 시간구가 없으면 null.
 * opts.date: 글에서 이미 읽은 날짜(없으면 오늘). '내일 아침'은 하루 뒤로 옮깁니다.
 * 돌려줌: { word, kind, edge, date, time, basis, missing, suggestTime, late, index, length }
 *  - missing: 'workEnd' | 'workStart' | 'timetable' — 설정이 없어 정하지 못함(노란 카드로 확인)
 *  - late: 오늘인데 정한 시각이 이미 지남(노란 카드로 확인)
 */
export function resolveTimePhrase(text, ctx = {}, opts = {}) {
    const span = findTimePhrases(text)[0];
    if (!span) return null;
    const base = opts.date || ctx.today;
    const date = span.dayShift ? addDays(ctx.today, span.dayShift) : base;
    const b = boundaryOf(span, date, ctx);
    const time = alarmFrom(b.boundary, span.edge);
    const suggestTime = b.missing ? alarmFrom(b.suggest, span.edge) : '';
    const late = Boolean(time && date === ctx.today && isHm(ctx.hm) && time <= ctx.hm);
    return {
        word: span.word,
        kind: span.kind,
        edge: span.edge,
        index: span.index,
        length: span.length,
        date,
        time,
        basis: b.basis || '',
        missing: b.missing || '',
        suggestTime,
        late,
    };
}

/**
 * 한 줄 전체의 역할 나누기. 화면은 이 결과로 추천 분류와 확인 카드를 정합니다.
 * { ending, stem, phrase } — phrase는 resolveTimePhrase 결과(없으면 null).
 */
export function analyzeLine(text, ctx = {}, opts = {}) {
    return {
        ending: classifyEnding(text),
        stem: actionStem(text),
        phrase: resolveTimePhrase(text, ctx, opts),
    };
}

/** 노란 카드 문구. 무엇이 비었는지, 무엇으로 넣을지 한 줄로 말합니다. */
export function phraseAskText(res) {
    if (!res) return '';
    if (res.missing === 'workEnd') return `‘${res.word}’를 정하려면 퇴근 시각이 필요해요. 설정에 아직 없어요.`;
    if (res.missing === 'workStart') return `‘${res.word}’를 정하려면 출근 시각이 필요해요. 설정에 아직 없어요.`;
    if (res.missing === 'vague') return `‘${String(res.word).replace(/\s*(?:에|때|쯤)$/, '')}’은 몇 시인지 정해지지 않았어요.`;
    if (res.missing === 'timetable') return `‘${res.word}’를 정할 교시 시각이 없어요.`;
    if (res.late) return `‘${res.word}’(${res.basis})는 오늘 이미 지났어요.`;
    return '';
}

/**
 * 메시지 붙여넣기 카드(parseSchoolMessages 결과)에 시간구 시각을 채웁니다. parseSchoolMessages 자체는 바꾸지 않습니다.
 * 이미 시각이 있는 카드는 그대로 둡니다. 설정이 비어 정하지 못하면 노란 카드(low, include:false)로 돌립니다.
 */
export function applyTimePhrases(items, ctx = {}) {
    return (items || []).map((item) => {
        if (!item || item.time || !(item.kind === '할 일' || item.kind === '일정')) return item;
        const src = String(item.raw || item.title || '');
        const res = resolveTimePhrase(src, ctx, { date: item.date || ctx.today });
        if (!res || res.kind === 'period') return item; /* 'n교시'는 msgParse가 이미 교시 시각을 읽습니다. */
        if (res.missing) {
            return {
                ...item,
                low: true,
                include: false,
                warning: [item.warning, `${phraseAskText(res)} 시각을 골라 주세요.`].filter(Boolean).join(' '),
            };
        }
        const next = { ...item, time: res.time };
        if (!item.date && res.date) next.date = res.date;
        return next;
    });
}
