/** 화면 꾸미기(스킨). 값은 이 기기 키 ssug-gyomu-skin 에만 둡니다. 기록·클라우드에는 넣지 않습니다.
    기본(basic)은 지금 화면 그대로라 html 속성을 두지 않습니다. 교실 코르크만 data-skin="cork" 입니다. */

export const SKIN_KEY = 'ssug-gyomu-skin';
export const DEFAULT_SKIN = 'basic';

export const SKIN_CHOICES = [
    { id: 'basic', label: '기본', hint: '지금 화면' },
    { id: 'cork', label: '교실 코르크', hint: '게시판 느낌' },
];

export function normalizeSkin(id) {
    return SKIN_CHOICES.some((item) => item.id === id) ? id : DEFAULT_SKIN;
}

function liveStorage() {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

export function skinId(storage) {
    try {
        return normalizeSkin((storage || liveStorage())?.getItem?.(SKIN_KEY));
    } catch {
        return DEFAULT_SKIN;
    }
}

function setRootSkin(id) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (id === DEFAULT_SKIN) root.removeAttribute('data-skin');
    else root.setAttribute('data-skin', id);
}

export function applySkin(id) {
    const skin = normalizeSkin(id);
    setRootSkin(skin);
    return skin;
}

export function applyStoredSkin(storage) {
    return applySkin(skinId(storage));
}

/** 고른 꾸미기를 이 기기에만 저장하고 바로 바꿉니다. 밝기·키보드 테마는 건드리지 않습니다. */
export function setSkin(id, storage) {
    const skin = normalizeSkin(id);
    try {
        (storage || liveStorage())?.setItem?.(SKIN_KEY, skin);
    } catch {
        /* 저장이 막혀도 이번 화면은 고른 꾸미기로 보입니다. */
    }
    return applySkin(skin);
}
