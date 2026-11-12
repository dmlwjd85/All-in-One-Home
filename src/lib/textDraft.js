/*
 * 쓰던 글 임시본: 알림장·하루 메모처럼 '저장'을 눌러야 남는 칸의 글을, 저장 전에도 이 기기에 잠깐 둡니다.
 * 출결 사유 시트(writeAttendDraft)와 같은 원칙입니다. 입력하면 0.3초 뒤, 앱을 숨기거나 화면을 떠날 때 바로(동기로) 남기고,
 * 같은 날짜 화면을 다시 열면 되살립니다. 저장하거나 저장한 글과 같아지면 지웁니다.
 *
 * 모양: { [칸 이름]: { u: 계정, at: 남긴 시각, text: 쓰던 글, base: 쓰기 시작할 때 저장돼 있던 글 } }
 * 칸 이름은 'notice:2026-11-12', 'day:2026-11-12' 처럼 화면과 날짜를 붙입니다.
 * 이 파일은 저장소(store)를 받아서 쓰므로 브라우저 없이도 검사할 수 있습니다.
 */

export const TEXT_DRAFT_KEY = 'ssug-gyomu-text-drafts';
/* 오래 쌓이지 않게 가장 최근 것만 남깁니다. */
export const TEXT_DRAFT_MAX = 30;
/* 한 칸 글자 수 한도(알림장·메모 칸보다 넉넉하게). */
export const TEXT_DRAFT_CHARS = 20000;

const KEY_RE = /^[a-z]+:\d{4}-\d{2}-\d{2}$/;

/** 칸 이름을 만듭니다. 이상한 날짜면 빈 글자를 돌려주고, 그때는 아무것도 남기지 않습니다. */
export function textDraftKey(kind, ymd) {
    const key = `${kind}:${ymd}`;
    return KEY_RE.test(key) ? key : '';
}

function readAll(store) {
    try {
        const all = JSON.parse(store?.getItem(TEXT_DRAFT_KEY) || '{}');
        return all && typeof all === 'object' && !Array.isArray(all) ? all : {};
    } catch {
        return {};
    }
}

function writeAll(store, all) {
    try {
        const keys = Object.keys(all);
        if (!keys.length) { store?.removeItem(TEXT_DRAFT_KEY); return true; }
        store?.setItem(TEXT_DRAFT_KEY, JSON.stringify(all));
        return true;
    } catch {
        /* 저장 공간이 없으면 임시본만 건너뜁니다. 화면의 글은 그대로입니다. */
        return false;
    }
}

function cleanRow(row) {
    if (!row || typeof row !== 'object' || typeof row.text !== 'string') return null;
    return {
        u: typeof row.u === 'string' ? row.u : '',
        at: Number(row.at) || 0,
        text: row.text,
        base: typeof row.base === 'string' ? row.base : '',
    };
}

/** 남은 임시본 하나. 다른 계정이 남긴 것은 보여 주지 않습니다(지우지도 않습니다). */
export function readTextDraft(key, { store, owner = '' } = {}) {
    if (!KEY_RE.test(String(key || ''))) return null;
    const row = cleanRow(readAll(store)[key]);
    if (!row || row.u !== owner) return null;
    return row;
}

/**
 * 쓰던 글을 남깁니다. 글이 저장된 글(base)과 같으면 남길 것이 없으므로 지웁니다.
 * 남겼으면 true, 지웠거나 못 남겼으면 false 입니다.
 */
export function writeTextDraft(key, { text, base = '' }, { store, owner = '', now = Date.now() } = {}) {
    if (!KEY_RE.test(String(key || ''))) return false;
    const value = String(text ?? '');
    const all = readAll(store);
    if (value === String(base ?? '') || !value.trim()) {
        /* 비운 칸도 '지웠다'는 뜻일 수 있지만, 저장 버튼을 눌러야 지워지므로 임시본으로는 남기지 않습니다. */
        if (key in all) { delete all[key]; writeAll(store, all); }
        return false;
    }
    all[key] = { u: owner, at: now, text: value.slice(0, TEXT_DRAFT_CHARS), base: String(base ?? '').slice(0, TEXT_DRAFT_CHARS) };
    const keys = Object.keys(all);
    if (keys.length > TEXT_DRAFT_MAX) {
        keys.sort((a, b) => (Number(all[a]?.at) || 0) - (Number(all[b]?.at) || 0));
        for (const old of keys.slice(0, keys.length - TEXT_DRAFT_MAX)) delete all[old];
    }
    return writeAll(store, all);
}

export function clearTextDraft(key, { store } = {}) {
    const all = readAll(store);
    if (!(key in all)) return;
    delete all[key];
    writeAll(store, all);
}

/** 모든 임시본을 지웁니다(모두 지우기·공용 컴퓨터 지우기). */
export function clearAllTextDrafts({ store } = {}) {
    try { store?.removeItem(TEXT_DRAFT_KEY); } catch { /* 없어도 됩니다. */ }
}

/**
 * 화면을 열 때 입력칸에 넣을 글. 되살릴 임시본이 있으면 { text, restored: true }, 없으면 저장된 글입니다.
 * 임시본이 지금 저장된 글과 같으면 되살릴 것이 없습니다.
 */
export function startText(draft, saved) {
    const dbText = String(saved ?? '');
    if (draft && typeof draft.text === 'string' && draft.text.trim() && draft.text !== dbText) {
        return { text: draft.text, restored: true };
    }
    return { text: dbText, restored: false };
}

/** 저장소처럼 쓰는 메모리 상자(공용 컴퓨터 모드에서는 이 기기에 글을 남기지 않습니다). */
export function memoryStore() {
    const map = new Map();
    return {
        getItem: (k) => (map.has(k) ? map.get(k) : null),
        setItem: (k, v) => { map.set(k, String(v)); },
        removeItem: (k) => { map.delete(k); },
    };
}
