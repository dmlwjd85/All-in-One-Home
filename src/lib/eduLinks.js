/** 교육 사이트 바로가기(G1, 시안 C). 링크 이름과 주소만 이 브라우저 키 ssug-gyomu-bookmarks 에 둡니다.
    아이디·비밀번호·계정은 받지도, 저장하지도 않습니다. Firestore 에도 올리지 않습니다(규칙 변경 없음).
    링크는 이름과 주소만이라 공용 컴퓨터 모드에서도 이 브라우저에 남습니다. */

export const EDU_LINKS_KEY = 'ssug-gyomu-bookmarks';
export const MAX_LINKS = 12;
export const MAX_TITLE = 20;
export const MAX_URL = 300;

/* 기본 여섯 곳. 2026-11-10 curl 로 200 응답을 확인한 공개 첫 화면 주소입니다. 로고는 쓰지 않고 이름 글자만 씁니다. */
export const DEFAULT_LINKS = [
    { id: 'neis', title: '나이스', url: 'https://www.neis.go.kr/', builtIn: true },
    { id: 'edunet', title: '에듀넷', url: 'https://www.edunet.net/', builtIn: true },
    { id: 'indischool', title: '인디스쿨', url: 'https://indischool.com/', builtIn: true },
    { id: 'iscream', title: '아이스크림', url: 'https://www.i-scream.co.kr/', builtIn: true },
    { id: 'hiclass', title: '하이클래스', url: 'https://www.hiclass.net/', builtIn: true },
    { id: 'teacherville', title: '티처빌', url: 'https://www.teacherville.co.kr/', builtIn: true },
];

const listeners = new Set();
let memory = null;

function liveStorage() {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

/** 적은 주소를 http(s) 주소로 고칩니다. 안 되는 주소면 '' 입니다(javascript:, data:, 파일 등은 거절). */
export function cleanUrl(input) {
    let text = String(input || '').trim();
    if (!text || text.length > MAX_URL || /\s/.test(text)) return '';
    if (!/^[a-z][a-z0-9+.-]*:/i.test(text)) {
        if (!/^[^/?#@:]+\.[^/?#@:]+/.test(text)) return '';
        text = `https://${text}`;
    }
    let url;
    try {
        url = new URL(text);
    } catch {
        return '';
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return '';
    /* 주소 안에 아이디·비밀번호를 넣는 꼴(https://id:pw@...)은 받지 않습니다. */
    if (url.username || url.password) return '';
    if (!url.hostname || !url.hostname.includes('.')) return '';
    return url.href;
}

export function cleanTitle(input) {
    return String(input || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
}

function cleanItem(row) {
    if (!row || typeof row !== 'object') return null;
    const url = cleanUrl(row.url);
    const title = cleanTitle(row.title);
    const id = String(row.id || '').slice(0, 40);
    if (!url || !title || !id) return null;
    const item = { id, title, url };
    if (row.builtIn === true) item.builtIn = true;
    return item;
}

/** 저장값을 읽어 고칩니다. 키가 없으면(처음) 기본 여섯 곳입니다. 비운 목록([])은 비운 그대로 둡니다. */
export function normalizeLinks(saved) {
    if (!saved || typeof saved !== 'object' || !Array.isArray(saved.items)) return DEFAULT_LINKS.map((row) => ({ ...row }));
    const seen = new Set();
    const out = [];
    for (const row of saved.items) {
        const item = cleanItem(row);
        if (!item || seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
        if (out.length >= MAX_LINKS) break;
    }
    return out;
}

export function readLinks(storage = liveStorage()) {
    let raw = null;
    try {
        raw = storage ? storage.getItem(EDU_LINKS_KEY) : memory;
    } catch {
        raw = memory;
    }
    if (!raw) return normalizeLinks(null);
    try {
        return normalizeLinks(JSON.parse(raw));
    } catch {
        return normalizeLinks(null);
    }
}

export function writeLinks(items, storage = liveStorage()) {
    const clean = normalizeLinks({ items });
    const raw = JSON.stringify({ v: 1, items: clean });
    try {
        if (storage) storage.setItem(EDU_LINKS_KEY, raw);
        else memory = raw;
    } catch {
        memory = raw;
    }
    listeners.forEach((fn) => fn(clean));
    return clean;
}

export function subscribeLinks(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function newId() {
    return `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 더하기. 결과 { ok, items, message } */
export function addLink(items, { title, url }, storage) {
    const cleanT = cleanTitle(title);
    const cleanU = cleanUrl(url);
    if (!cleanT) return { ok: false, items, message: '이름을 적어 주세요.' };
    if (!cleanU) return { ok: false, items, message: 'https:// 로 시작하는 사이트 주소만 넣을 수 있어요.' };
    if (items.length >= MAX_LINKS) return { ok: false, items, message: `바로가기는 ${MAX_LINKS}개까지예요.` };
    return { ok: true, items: writeLinks([...items, { id: newId(), title: cleanT, url: cleanU }], storage) };
}

export function updateLink(items, id, { title, url }, storage) {
    const cleanT = cleanTitle(title);
    const cleanU = cleanUrl(url);
    if (!cleanT) return { ok: false, items, message: '이름을 적어 주세요.' };
    if (!cleanU) return { ok: false, items, message: 'https:// 로 시작하는 사이트 주소만 넣을 수 있어요.' };
    return { ok: true, items: writeLinks(items.map((row) => (row.id === id ? { ...row, title: cleanT, url: cleanU } : row)), storage) };
}

export function removeLink(items, id, storage) {
    return writeLinks(items.filter((row) => row.id !== id), storage);
}

export function moveLink(items, id, step, storage) {
    const at = items.findIndex((row) => row.id === id);
    const to = at + step;
    if (at < 0 || to < 0 || to >= items.length) return items;
    const next = [...items];
    [next[at], next[to]] = [next[to], next[at]];
    return writeLinks(next, storage);
}

/** 지운 기본 사이트만 다시 넣습니다. 직접 더한 사이트는 그대로 둡니다. */
export function restoreDefaults(items, storage) {
    const have = new Set(items.map((row) => row.id));
    const missing = DEFAULT_LINKS.filter((row) => !have.has(row.id)).map((row) => ({ ...row }));
    return writeLinks([...items, ...missing].slice(0, MAX_LINKS), storage);
}

export function linkHost(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, '');
    } catch {
        return '';
    }
}
