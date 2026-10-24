/** 글꼴 고르기. 값은 이 기기 키 ssug-gyomu-font 에만 둡니다. 기록 키는 건드리지 않습니다. */

const FONT_KEY = 'ssug-gyomu-font';

export const FONT_CHOICES = [
    { id: 'soft', label: '부드러운', hint: '둥근 고딕' },
    { id: 'plain', label: '기본', hint: '지금 쓰는 고딕' },
    { id: 'neat', label: '단정한', hint: '가지런한 고딕' },
];

export function normalizeFont(id) {
    return FONT_CHOICES.some((item) => item.id === id) ? id : 'plain';
}

function liveStorage() {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

export function fontId(storage) {
    try {
        const store = storage || liveStorage();
        return normalizeFont(store?.getItem?.(FONT_KEY));
    } catch {
        return 'plain';
    }
}

export function applyFont(id) {
    if (typeof document === 'undefined') return normalizeFont(id);
    const font = normalizeFont(id);
    const root = document.documentElement;
    if (font === 'plain') root.removeAttribute('data-font');
    else root.setAttribute('data-font', font);
    return font;
}

export function applyStoredFont(storage) {
    return applyFont(fontId(storage));
}

export function setFont(id, storage) {
    const font = normalizeFont(id);
    try {
        (storage || liveStorage())?.setItem?.(FONT_KEY, font);
    } catch {
        /* 저장이 막혀도 이번 화면의 글꼴은 바꿉니다. */
    }
    return applyFont(font);
}
