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
    const seen = new Set();
    for (const rawLine of String(text || '').split('\n')) {
        const line = cleanLine(rawLine);
        if (!line) continue;
        if (TODO_HEAD.test(line)) { inTodo = true; continue; }
        if (OTHER_HEAD.test(line)) { inTodo = false; continue; }
        if (line.length < 3) continue;
        let parsed;
        try { parsed = parseSchoolMessages(line, { now, periods }); } catch { continue; }
        const items = parsed?.items || [];
        items.forEach((item, n) => {
            if (!String(item.title || '').trim()) return;
            const when = Boolean(item.date || item.time || item.period);
            const cue = inTodo || TODO_CUE.test(line);
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
