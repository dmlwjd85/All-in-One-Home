/** 키보드 테마(모양). 값은 이 기기 키 ssug-gyomu-kb-theme 에만 둡니다. 기록·클라우드에는 넣지 않습니다.
    MX 미니(기본)는 지금 키캡 그대로라 따로 스타일을 받지 않습니다. 다른 테마를 고르거나 설정을 열 때만 kbtheme.css 를 받습니다. */
import { DEFAULT_KB_THEME, KB_VOICE_PREFIX, normalizeKbTheme } from './kbvoices.js';
import { isKbVoice, keyVoiceId, setKeyVoice } from './keyfeel.js';

export const KB_THEME_KEY = 'ssug-gyomu-kb-theme';

function liveStorage() {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

export function kbThemeId(storage) {
    try {
        return normalizeKbTheme((storage || liveStorage())?.getItem?.(KB_THEME_KEY));
    } catch {
        return DEFAULT_KB_THEME;
    }
}

let cssReady = null;
/** 테마 스타일은 따로 나뉜 파일입니다. 처음 부를 때 한 번만 받습니다. */
export function loadKbThemeCss() {
    if (!cssReady) cssReady = import('./kbtheme.css').then(() => true, () => { cssReady = null; return false; });
    return cssReady;
}

function setRootTheme(id) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (id === DEFAULT_KB_THEME) root.removeAttribute('data-kb');
    else root.setAttribute('data-kb', id);
}

/** 스타일이 다 온 뒤에 바꿔서, 반쯤 바뀐 화면이 보이지 않게 합니다. */
export async function applyKbTheme(id) {
    const theme = normalizeKbTheme(id);
    if (theme !== DEFAULT_KB_THEME) await loadKbThemeCss();
    setRootTheme(theme);
    return theme;
}

export function applyStoredKbTheme(storage) {
    return applyKbTheme(kbThemeId(storage));
}

function reducedMotion() {
    try {
        return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

/** 고른 테마를 저장하고 바꿉니다. 지금 소리가 테마 소리면 새 테마 소리로 같이 옮기고, 다른 소리를 골라 두었으면 그대로 둡니다.
    바꿀 때는 누른 곳에서 원이 퍼지며 새 모양이 드러납니다. 움직임 줄이기를 켠 기기는 바로 바꿉니다. */
export async function setKbTheme(id, { storage, x, y, loadCss = loadKbThemeCss } = {}) {
    const theme = normalizeKbTheme(id);
    try {
        (storage || liveStorage())?.setItem?.(KB_THEME_KEY, theme);
    } catch {
        /* 저장이 막혀도 이번 화면은 고른 테마로 보입니다. */
    }
    if (isKbVoice(keyVoiceId(storage))) setKeyVoice(`${KB_VOICE_PREFIX}${theme}`, storage);
    if (typeof document === 'undefined') return theme;
    if (theme !== DEFAULT_KB_THEME && !(await loadCss())) return theme;
    const root = document.documentElement;
    const current = root.getAttribute('data-kb') || DEFAULT_KB_THEME;
    if (current === theme) return theme;
    if (reducedMotion() || typeof document.startViewTransition !== 'function') {
        setRootTheme(theme);
        return theme;
    }
    const cx = Number.isFinite(x) ? x : innerWidth / 2;
    const cy = Number.isFinite(y) ? y : innerHeight / 2;
    const radius = Math.hypot(Math.max(cx, innerWidth - cx), Math.max(cy, innerHeight - cy));
    root.classList.add('kb-reveal');
    try {
        const shift = document.startViewTransition(() => setRootTheme(theme));
        await shift.ready;
        root.animate(
            { clipPath: [`circle(0px at ${cx}px ${cy}px)`, `circle(${radius}px at ${cx}px ${cy}px)`] },
            { duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)', pseudoElement: '::view-transition-new(root)' },
        );
        await shift.finished;
    } catch {
        setRootTheme(theme);
    } finally {
        root.classList.remove('kb-reveal');
    }
    return theme;
}
