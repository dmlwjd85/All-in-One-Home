/** 회의록. 따로 버킷을 만들지 않고 기존 'notes'(메모)에 '회의' 태그로 둡니다.
    #38 쨈 흐름(FlowSheet)이 남긴 'meet-…' 메모도 그대로 회의록으로 보입니다(옮기기·지우기 없음). */
import { isSensitiveText } from './sensitive.js';

export const MINUTES_TAG = '회의';
export const MINUTES_TITLE_MAX = 60;
export const MINUTES_ATTENDEES_MAX = 200;
export const MINUTES_TEXT_MAX = 20000;
export const MINUTES_DRAFT_KEY = 'ssug-gyomu-minutes-draft';

export function isMinutes(row) {
    if (!row) return false;
    return (Array.isArray(row.tags) && row.tags.includes(MINUTES_TAG)) || /^meet-/.test(String(row.id || ''));
}

/** 제목이 없는 옛 회의록은 회의 종류 태그나 본문 첫 줄을 제목으로 보여 줍니다. */
export function minutesTitle(row) {
    const own = String(row?.title || '').trim();
    if (own) return own;
    const kind = (row?.tags || []).find((tag) => tag && tag !== MINUTES_TAG);
    if (kind) return kind;
    const first = String(row?.text || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
    return first.slice(0, 30) || '제목 없는 회의록';
}

export function minutesList(rows) {
    return (rows || []).filter(isMinutes).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(b.id).localeCompare(String(a.id)));
}

/** 저장할 메모 한 줄. 옛 회의록을 고치면 id·태그(회의 종류)는 그대로 둡니다. */
export function minutesRow({ id, title, date, attendees, text, tags }, now = Date.now()) {
    const kept = (tags || []).filter((tag) => tag && tag !== MINUTES_TAG);
    return {
        id: id || `meet-${now}`,
        title: String(title || '').trim().slice(0, MINUTES_TITLE_MAX),
        attendees: String(attendees || '').trim().slice(0, MINUTES_ATTENDEES_MAX),
        text: String(text || '').replace(/\r\n?/g, '\n').replace(/\s+$/, '').slice(0, MINUTES_TEXT_MAX),
        date,
        tags: [MINUTES_TAG, ...kept].slice(0, 10),
        pinned: false,
        source: 'app',
    };
}

export function minutesProblem(draft) {
    if (!String(draft.title || '').trim()) return '회의 제목을 적어 주세요.';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.date || '')) return '날짜를 골라 주세요.';
    if (!String(draft.text || '').trim()) return '본문을 한 줄 이상 적어 주세요.';
    if (String(draft.text).length > MINUTES_TEXT_MAX) return `본문은 ${MINUTES_TEXT_MAX.toLocaleString()}자까지예요.`;
    return '';
}

export function minutesSensitive(draft) {
    return isSensitiveText(draft.text, draft.tags) || isSensitiveText(draft.title) || isSensitiveText(draft.attendees);
}

/* 임시 저장: 쓰는 도중 이 기기에만 둡니다(저장 버튼을 눌러야 회의록이 됩니다). key 는 'new' 또는 고치는 회의록 id. */
export function readMinutesDraft(key, store = globalThis.localStorage) {
    try {
        const all = JSON.parse(store?.getItem(MINUTES_DRAFT_KEY) || '{}');
        const row = all && typeof all === 'object' ? all[key] : null;
        return row && typeof row === 'object' ? row : null;
    } catch { return null; }
}

export function writeMinutesDraft(key, draft, store = globalThis.localStorage) {
    try {
        const all = JSON.parse(store?.getItem(MINUTES_DRAFT_KEY) || '{}') || {};
        if (draft) all[key] = { ...draft, savedAt: Date.now() };
        else delete all[key];
        if (Object.keys(all).length) store?.setItem(MINUTES_DRAFT_KEY, JSON.stringify(all));
        else store?.removeItem(MINUTES_DRAFT_KEY);
    } catch { /* 저장 공간이 없으면 임시 저장만 건너뜁니다. */ }
}
