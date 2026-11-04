/** 회의록 본문에서 일정·할 일을 찾아 등록 후보로 만듭니다.
    분류는 ＋ 입력과 같은 parseSchoolMessages 를 줄마다 그대로 씁니다.
    - 날짜·시각·교시가 분명한 줄은 바로 등록(auto)
    - 할 일 신호가 있거나 '할 일' 아래에 있는데 해석이 흐린 줄은 노란 확인 카드(ask)
    - 그 밖의 줄(안건, 논의 내용)은 등록하지 않습니다.
    등록 id 는 'mt-<회의록 열쇠>-<줄 해시>' 라서 같은 회의록을 다시 저장해도 같은 id 가 나와 겹쳐 들어가지 않습니다. */
import { parseSchoolMessages } from './msgParse.js';
import { DEFAULT_PERIODS } from './period.js';
import { MINUTES_DRAFT_KEY } from './minutes.js';

export const MINUTES_LINK_PREFIX = 'mt-';
const LINKS_SLOT = '__links';
const TODO_CUE = /제출|회신|마감|기한|까지|작성|준비|확인|공유|보고|부탁|해\s*주세요|해\s*주시기|하기$|할\s*것|담당|맡/;
const TODO_HEAD = /^(?:#+\s*)?(?:할\s*일|해야\s*할\s*일|후속\s*조치|담당|to-?do|todo|액션)\s*[:：]?\s*$/i;
const OTHER_HEAD = /^(?:#+\s*)?(?:안건|논의|논의\s*내용|결정|결정한\s*것|결정\s*사항|협의\s*내용|참석|기타|메모)\s*[:：]?\s*$/;
const MAX_ITEMS = 30;
const GENERIC_TITLE = /^(?:할\s*일|일정)$/;
/** 줄에서 날짜·시각 낱말을 걷어 제목으로 씁니다. */
export function titleFromLine(line) {
    return String(line || '')
        .replace(/\d{4}[-./]\s*\d{1,2}[-./]\s*\d{1,2}\.?/g, ' ')
        .replace(/\d{1,2}\s*[/.월]\s*\d{1,2}\s*일?(?:\s*\([월화수목금토일]\))?/g, ' ')
        .replace(/(?:오늘|내일|모레|글피|다음\s*주|이번\s*주)\s*(?:[월화수목금토일]요일)?/g, ' ')
        .replace(/\d{1,2}\s*:\s*\d{2}|\d{1,2}\s*교시/g, ' ')
        .replace(/^\s*까지\s*|\s까지\s/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
}

/** '내일'·'다음 주' 같은 상대 날짜의 기준: 회의록 날짜(서울 오전 9시). 날짜가 없거나 이상하면 지금. */
export function minutesNow(ymd, fallback = new Date()) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return fallback;
    const at = new Date(`${ymd}T09:00:00+09:00`);
    return Number.isFinite(at.getTime()) ? at : fallback;
}

function hash(text) {
    let h = 2166136261;
    for (const ch of String(text)) {
        h ^= ch.codePointAt(0);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h.toString(36).padStart(7, '0').slice(0, 7);
}

/** 회의록 id 에서 등록 id 에 넣을 짧은 열쇠. 'meet-1761600000000' → '1761600000000'. */
export function minutesKey(minutesId) {
    const id = String(minutesId || '');
    const bare = id.replace(/^meet-/, '');
    return /^[A-Za-z0-9_]{1,16}$/.test(bare) ? bare : `h${hash(id)}`;
}

export function linkedId(minutesId, line, n = 0) {
    return `${MINUTES_LINK_PREFIX}${minutesKey(minutesId)}-${hash(`${line.replace(/\s+/g, ' ').trim()}#${n}`)}`;
}

/** 등록된 일정·할 일 id 로 원래 회의록을 찾습니다. 없으면 null. */
export function minutesOf(itemId, minutesRows) {
    const id = String(itemId || '');
    if (!id.startsWith(MINUTES_LINK_PREFIX)) return null;
    const key = id.slice(MINUTES_LINK_PREFIX.length).replace(/-[^-]*$/, '');
    return (minutesRows || []).find((row) => minutesKey(row.id) === key) || null;
}

function cleanLine(line) {
    return String(line || '').replace(/^\s*(?:[-*•·▪◦]|\d{1,2}[.)]|[①-⑳])\s*/, '').trim();
}

/**
 * @returns {{ auto: object[], ask: object[] }} auto 는 바로 등록, ask 는 노란 카드로 확인.
 */
export function minutesCandidates(text, minutesId, { now = new Date(), periods = DEFAULT_PERIODS, title = '' } = {}) {
    const auto = [];
    const ask = [];
    let inTodo = false;
    let inOther = false;
    const seen = new Set();
    for (const rawLine of String(text || '').split('\n')) {
        const line = cleanLine(rawLine);
        if (!line) continue;
        if (TODO_HEAD.test(line)) { inTodo = true; inOther = false; continue; }
        if (OTHER_HEAD.test(line)) { inTodo = false; inOther = true; continue; }
        if (line.length < 3) continue;
        let parsed;
        try { parsed = parseSchoolMessages(line, { now, periods }); } catch { continue; }
        const items = parsed?.items || [];
        /* 한 줄에 '내일까지'와 절대 날짜가 함께 있으면 해석기가 제목 없는 '할 일' 항목을 하나 더 만듭니다.
           같은 줄에 제목이 있는 항목이 있으면 그 빈 항목은 버리고, 하나뿐이면 줄에서 제목을 되살립니다(PR #64 r2 6번). */
        const named = items.some((item) => !GENERIC_TITLE.test(String(item.title || '').trim()));
        const dropped = named && items.some((item) => GENERIC_TITLE.test(String(item.title || '').trim()));
        items.forEach((item, n) => {
            if (!String(item.title || '').trim()) return;
            if (GENERIC_TITLE.test(String(item.title).trim())) {
                if (named) return;
                const back = titleFromLine(line);
                if (!back) return;
                item = { ...item, title: back };
            }
            const when = Boolean(item.date || item.time || item.period);
            /* 안건·결정 칸의 줄은 날짜·시간이 있을 때만 잡습니다(논의거리를 할 일로 묻지 않게). */
            const cue = inTodo || (!inOther && TODO_CUE.test(line));
            if (!when && !cue) return;
            const id = linkedId(minutesId, line, n);
            if (seen.has(id)) return;
            seen.add(id);
            const kind = item.kind === '일정' ? '일정' : '할 일';
            const draft = {
                id,
                kind: !when && inTodo ? '할 일' : kind,
                title: item.title,
                date: item.date || '',
                end: item.end || '',
                time: item.time || '',
                endTime: item.endTime || '',
                period: item.period || 0,
                periodEnd: item.periodEnd || 0,
                eventKind: item.eventKind || '학급',
                memo: title ? `회의록: ${title}`.slice(0, 80) : '회의록에서',
                studentNo: 0,
                status: '',
                recordKind: '관찰',
                raw: line,
                include: true,
                low: Boolean(item.low) || !when,
                warning: item.warning || (when ? '' : '날짜가 없어요. 맞으면 그대로, 아니면 빼 주세요.'),
            };
            if (dropped && /같은 문장에서 나눈/.test(draft.warning)) {
                draft.warning = draft.warning.replace(/\s*같은 문장에서 나눈 내용이라 저장하면 정리함에 들어가요\.?/, '').trim()
                    || `날짜가 둘이라 ${draft.date || '한쪽'} 날짜로 잡았어요. 맞는지 확인해 주세요.`;
                draft.low = true;
            }
            if (draft.low) ask.push(draft);
            else auto.push(draft);
        });
        if (auto.length + ask.length >= MAX_ITEMS) break;
    }
    return { auto: auto.slice(0, MAX_ITEMS), ask: ask.slice(0, Math.max(0, MAX_ITEMS - auto.length)) };
}

/* 한 번 등록했거나 노란 카드에서 뺀 id 는 이 기기에 기억해 두고, 다시 저장해도 되살리지 않습니다(지운 할 일이 돌아오지 않게).
   임시 저장과 같은 열쇠(ssug-gyomu-minutes-draft) 안에 두어 계정을 바꿀 때 함께 옮겨집니다. */
export function readMinutesLinks(minutesId, store = globalThis.localStorage) {
    try {
        const all = JSON.parse(store?.getItem(MINUTES_DRAFT_KEY) || '{}');
        const list = all?.[LINKS_SLOT]?.[minutesId];
        return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
    } catch { return []; }
}

export function rememberMinutesLinks(minutesId, ids, store = globalThis.localStorage) {
    if (!ids?.length) return;
    try {
        const all = JSON.parse(store?.getItem(MINUTES_DRAFT_KEY) || '{}') || {};
        const links = all[LINKS_SLOT] && typeof all[LINKS_SLOT] === 'object' ? all[LINKS_SLOT] : {};
        links[minutesId] = [...new Set([...(links[minutesId] || []), ...ids])].slice(-200);
        all[LINKS_SLOT] = links;
        store?.setItem(MINUTES_DRAFT_KEY, JSON.stringify(all));
    } catch { /* 저장 공간이 없으면 기억만 건너뜁니다. */ }
}

export function forgetMinutesLinks(minutesId, store = globalThis.localStorage) {
    try {
        const all = JSON.parse(store?.getItem(MINUTES_DRAFT_KEY) || '{}') || {};
        if (!all[LINKS_SLOT]?.[minutesId]) return;
        delete all[LINKS_SLOT][minutesId];
        if (!Object.keys(all[LINKS_SLOT]).length) delete all[LINKS_SLOT];
        if (Object.keys(all).length) store?.setItem(MINUTES_DRAFT_KEY, JSON.stringify(all));
        else store?.removeItem(MINUTES_DRAFT_KEY);
    } catch { /* 넘어갑니다. */ }
}

/** 이미 등록됐거나 기억된 id 를 빼고 새로 넣을 것만 남깁니다. */
export function freshCandidates(found, { registered = [], remembered = [] } = {}) {
    const skip = new Set([...registered, ...remembered]);
    return { auto: found.auto.filter((item) => !skip.has(item.id)), ask: found.ask.filter((item) => !skip.has(item.id)) };
}

/* ── 오프라인 저장·뺀 결정 대기열(PR #64 r2 1·3번) ──
   클라우드를 확인하지 못하면(오프라인) 바로 등록할 항목을 '미룸'에 두고, 연결되면 다시 확인한 뒤 등록합니다.
   노란 카드에서 뺀 결정을 클라우드에 못 남기면 '묘비 대기열'에 두고 다시 씁니다. 같은 열쇠(ssug-gyomu-minutes-draft) 안에 둡니다. */
const PENDING_SLOT = '__pending';
const TOMBQ_SLOT = '__tombq';
function readAll(store) {
    try { const all = JSON.parse(store?.getItem(MINUTES_DRAFT_KEY) || '{}'); return all && typeof all === 'object' ? all : {}; } catch { return null; }
}
function writeAll(all, store) {
    try {
        if (Object.keys(all).length) store?.setItem(MINUTES_DRAFT_KEY, JSON.stringify(all));
        else store?.removeItem(MINUTES_DRAFT_KEY);
        return true;
    } catch { return false; }
}
/** { [회의록 id]: 항목[] } */
export function readMinutesPending(store = globalThis.localStorage) {
    const all = readAll(store);
    const p = all?.[PENDING_SLOT];
    return p && typeof p === 'object' ? p : {};
}
export function setMinutesPending(minutesId, items, store = globalThis.localStorage) {
    const all = readAll(store);
    if (!all) return false;
    const p = all[PENDING_SLOT] && typeof all[PENDING_SLOT] === 'object' ? all[PENDING_SLOT] : {};
    if (items?.length) p[minutesId] = items.slice(0, MAX_ITEMS);
    else delete p[minutesId];
    if (Object.keys(p).length) all[PENDING_SLOT] = p;
    else delete all[PENDING_SLOT];
    return writeAll(all, store);
}
export function readMinutesTombQueue(store = globalThis.localStorage) {
    const q = readAll(store)?.[TOMBQ_SLOT];
    return Array.isArray(q) ? q.filter((id) => typeof id === 'string') : [];
}
export function queueMinutesTombs(ids, store = globalThis.localStorage) {
    if (!ids?.length) return;
    const all = readAll(store);
    if (!all) return;
    all[TOMBQ_SLOT] = [...new Set([...readMinutesTombQueue(store), ...ids])].slice(-500);
    writeAll(all, store);
}
export function dropMinutesTombs(ids, store = globalThis.localStorage) {
    if (!ids?.length) return;
    const all = readAll(store);
    if (!all) return;
    const gone = new Set(ids);
    const rest = readMinutesTombQueue(store).filter((id) => !gone.has(id));
    if (rest.length) all[TOMBQ_SLOT] = rest;
    else delete all[TOMBQ_SLOT];
    writeAll(all, store);
}

/* 지운(또는 다른 기기가 지운 걸 받은) 회의록 항목 id. 클라우드 묘비가 30일 뒤 정리돼도 이 기기는 되살리지 않습니다. */
const GONE_SLOT = '__gone';
export function readMinutesGone(store = globalThis.localStorage) {
    const q = readAll(store)?.[GONE_SLOT];
    return Array.isArray(q) ? q.filter((id) => typeof id === 'string') : [];
}
export function noteMinutesGone(ids, store = globalThis.localStorage) {
    const list = (ids || []).filter((id) => typeof id === 'string' && id.startsWith(MINUTES_LINK_PREFIX));
    if (!list.length) return;
    const all = readAll(store);
    if (!all) return;
    all[GONE_SLOT] = [...new Set([...readMinutesGone(store), ...list])].slice(-1000);
    writeAll(all, store);
}
/* 고친 줄 정리로 이 기기가 지운 회의록 항목 id(PR #64 r3 F1). 줄을 되돌리면 클라우드 묘비를 풀고 다시 등록합니다. */
const TIDIED_SLOT = '__tidied';
export function readMinutesTidied(store = globalThis.localStorage) {
    const q = readAll(store)?.[TIDIED_SLOT];
    return Array.isArray(q) ? q.filter((id) => typeof id === 'string') : [];
}
export function noteMinutesTidied(ids, store = globalThis.localStorage) {
    const list = (ids || []).filter((id) => typeof id === 'string' && id.startsWith(MINUTES_LINK_PREFIX));
    if (!list.length) return;
    const all = readAll(store);
    if (!all) return;
    all[TIDIED_SLOT] = [...new Set([...readMinutesTidied(store), ...list])].slice(-300);
    writeAll(all, store);
}
export function unnoteMinutesTidied(ids, store = globalThis.localStorage) {
    if (!ids?.length) return;
    const all = readAll(store);
    if (!all) return;
    const drop = new Set(ids);
    const rest = readMinutesTidied(store).filter((id) => !drop.has(id));
    if (rest.length) all[TIDIED_SLOT] = rest;
    else delete all[TIDIED_SLOT];
    writeAll(all, store);
}
export function unnoteMinutesGone(ids, store = globalThis.localStorage) {
    if (!ids?.length) return;
    const all = readAll(store);
    if (!all) return;
    const drop = new Set(ids);
    const rest = readMinutesGone(store).filter((id) => !drop.has(id));
    if (rest.length) all[GONE_SLOT] = rest;
    else delete all[GONE_SLOT];
    writeAll(all, store);
}

/**
 * 회의록 줄을 고쳐 다시 저장할 때(PR #64 r2 4번): 예전 본문에서 나왔는데 새 본문에서는 사라진 등록 id.
 * 고친 줄은 새 id 로 다시 나오므로, 옛 항목은 사용자가 손대지 않았을 때만 정리합니다.
 */
export function vanishedCandidates(prev, next, minutesId, opts = {}) {
    if (!prev || String(prev.text || '') === String(next.text || '')) return [];
    const old = minutesCandidates(prev.text, minutesId, { ...opts, now: minutesNow(prev.date, opts.now) });
    const fresh = minutesCandidates(next.text, minutesId, { ...opts, now: minutesNow(next.date, opts.now) });
    const keep = new Set([...fresh.auto, ...fresh.ask].map((item) => item.id));
    return [...old.auto, ...old.ask].filter((item) => !keep.has(item.id));
}

/** 등록된 줄(row)이 회의록이 만든 그대로인가(사용자가 제목·날짜·시각을 고치거나 완료하지 않았나). */
export function untouchedSince(item, row, bucket) {
    if (!item || !row) return false;
    if (bucket === 'todos') {
        const title = item.time && !String(item.title).includes(item.time) ? `${item.time} ${item.title}`.trim().slice(0, 100) : String(item.title).trim().slice(0, 100);
        return row.title === title && !row.done && String(row.due || '') === String(item.date || '') && !row.time;
    }
    if (row.title !== String(item.title).trim().slice(0, 60)) return false;
    if (item.date && row.date !== item.date) return false;
    if (String(row.time || '') !== String(item.time || '')) return false;
    return true;
}
