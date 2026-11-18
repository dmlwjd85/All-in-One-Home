/** 화면 꾸미기(스킨). 값은 이 기기 키 ssug-gyomu-skin 에만 둡니다. 기록·클라우드에는 넣지 않습니다.
    심플(basic)은 꾸밈 없는 화면이라 html 속성을 두지 않습니다.
    클래식 교실풍경의 저장값·html 속성은 호환을 위해 cork 입니다. classic 은 cork 로 읽습니다.
    고른 적이 없으면 교실풍경(cork)으로 엽니다. 심플을 고른 기기는 저장값 basic 이 남아 그대로입니다.
    자동 화면 검사는 빌드할 때 VITE_DEFAULT_SKIN=basic 을 주어 예전 기본 화면으로 돌립니다. */

export const SKIN_KEY = 'ssug-gyomu-skin';
export const BASIC_SKIN = 'basic';

function builtDefault() {
    try {
        return import.meta.env?.VITE_DEFAULT_SKIN === BASIC_SKIN ? BASIC_SKIN : 'cork';
    } catch {
        return 'cork';
    }
}
export const DEFAULT_SKIN = builtDefault();

export const SKIN_CHOICES = [
    { id: 'basic', label: '심플', hint: '꾸밈 없는 화면' },
    { id: 'cork', label: '클래식 교실풍경', hint: '어두운 화면은 밤 교실' },
];

export function normalizeSkin(id) {
    if (id === 'classic') return 'cork';
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
    if (id === BASIC_SKIN) root.removeAttribute('data-skin');
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

/** 벽시계 바늘 각도(도). 시침은 분에, 분침은 초에 맞춰 조금씩 움직입니다. */
export function clockAngles(date = new Date()) {
    const h = date.getHours() % 12;
    const m = date.getMinutes();
    const sec = date.getSeconds();
    return { hour: (h + m / 60 + sec / 3600) * 30, minute: (m + sec / 60) * 6, second: sec * 6 };
}

/** 교실 앞벽 급훈. 이 기기 키 ssug-gyomu-skin-motto 에만 둡니다(기록·클라우드에 넣지 않음). */
export const MOTTO_KEY = 'ssug-gyomu-skin-motto';
export const DEFAULT_MOTTO = '서로 돕고 함께 자라는 우리 반';
export const MOTTO_MAX = 24;
export const MOTTO_EVENT = 'ssug-skin-motto';

/** 줄바꿈·겹친 빈칸을 지우고 MOTTO_MAX 글자까지만. 비면 기본 급훈. */
export function cleanMotto(text) {
    const one = String(text ?? '').replace(/\s+/g, ' ').trim();
    return Array.from(one).slice(0, MOTTO_MAX).join('') || DEFAULT_MOTTO;
}

export function skinMotto(storage) {
    try {
        const saved = (storage || liveStorage())?.getItem?.(MOTTO_KEY);
        return saved ? cleanMotto(saved) : DEFAULT_MOTTO;
    } catch {
        return DEFAULT_MOTTO;
    }
}

/** 급훈을 이 기기에 저장하고 열려 있는 화면에 바로 알립니다. 비우면 기본 급훈으로 돌아갑니다. */
export function setSkinMotto(text, storage) {
    const motto = cleanMotto(text);
    try {
        const store = storage || liveStorage();
        if (motto === DEFAULT_MOTTO) store?.removeItem?.(MOTTO_KEY);
        else store?.setItem?.(MOTTO_KEY, motto);
    } catch {
        /* 저장이 막혀도 이번 화면에는 보입니다. */
    }
    try {
        if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(MOTTO_EVENT, { detail: motto }));
    } catch {
        /* 알림이 안 되면 다음에 열 때 반영됩니다. */
    }
    return motto;
}
