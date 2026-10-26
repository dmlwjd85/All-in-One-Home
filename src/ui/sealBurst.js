/** 하단 용기. 껍질이 벗겨지는 시간은 완성본과 같이 0.52초이고, 톡은 0.09초에 납니다.
    빠른 입력은 이 시간을 기다리지 않습니다. 레이아웃은 다시 읽지 않습니다. */

import { jamFeelEnabled, playJam } from './pressFeel.js';

export const BURST_MS = 420;
export const FOIL_POP_MS = 520;
export const BURST_AT_MS = 90;
export const SPLAT_COUNT = 6;
export const DROP_COUNT = 8;
export const MAX_ANIMATIONS = 8;

const SPLATS = [
    { x: 18, y: -16 },
    { x: -20, y: -12 },
    { x: 16, y: 12 },
    { x: -14, y: 16 },
    { x: 6, y: -22 },
    { x: -8, y: 20 },
];

function reduceMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function cancelBurst(root) {
    const running = root.getAnimations?.({ subtree: true }) || [];
    running.forEach((anim) => anim.cancel());
}

function foilButton(node) {
    if (!node) return null;
    if (node.classList?.contains('foil-fab')) return node;
    return node.closest?.('.foil-fab') || null;
}

function clearFoilTimer(button) {
    if (!button) return;
    clearTimeout(button._foilTok);
    clearTimeout(button._foilEnd);
    button._foilTok = null;
    button._foilEnd = null;
}

/** 완성본 껍질. 클래스를 같은 턴에 뺐다 넣으면 다시 시작하지 않아서, 그 사이에 동작 목록을 읽습니다. */
export function playFoilPop(node) {
    const button = foilButton(node);
    if (!button) return;
    clearFoilTimer(button);
    const gen = (Number(button.dataset.popGen) || 0) + 1;
    button.dataset.popGen = String(gen);
    if (reduceMotion()) {
        button.classList.remove('is-popping');
        button.classList.remove('is-flash');
        button.getAnimations?.({ subtree: true });
        button.classList.add('is-flash');
        if (jamFeelEnabled()) playJam('tok');
        button._foilEnd = setTimeout(() => {
            if (button.dataset.popGen !== String(gen)) return;
            button.classList.remove('is-flash');
        }, 160);
        return;
    }
    if (button.classList.contains('is-popping')) {
        button.classList.remove('is-popping');
        button.getAnimations?.({ subtree: true });
    }
    button.classList.add('is-popping');
    button._foilTok = setTimeout(() => {
        if (button.dataset.popGen !== String(gen)) return;
        if (jamFeelEnabled()) playJam('tok');
    }, BURST_AT_MS);
    button._foilEnd = setTimeout(() => {
        if (button.dataset.popGen !== String(gen)) return;
        button.classList.remove('is-popping');
    }, FOIL_POP_MS);
}

/** 열 때는 예전 필름만 조금 부풀립니다. D안 컵은 누르는 동안 껍질을 벗기지 않습니다. */
export function playSealLift(root) {
    if (!root) return;
    if (foilButton(root) && !reduceMotion()) return;
    cancelBurst(root);
    if (reduceMotion()) {
        root.animate(
            [{ opacity: 1 }, { opacity: 0.62 }, { opacity: 1 }],
            { duration: 160, easing: 'ease-out' },
        );
        return;
    }
    const foil = root.querySelector('.seal-foil');
    foil?.animate([
        { transform: 'translateY(0px) scale(1, 1)', offset: 0 },
        { transform: 'translateY(-2px) scale(1.06, 1.14)', offset: 1 },
    ], { duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'forwards' });
}

export function playSealBurst(root) {
    if (!root) return;
    if (foilButton(root)) {
        if (reduceMotion()) {
            cancelBurst(root);
            root.animate(
                [{ opacity: 1 }, { opacity: 0.62 }, { opacity: 1 }],
                { duration: 160, easing: 'ease-out' },
            );
            return;
        }
        playFoilPop(root);
        return;
    }
    cancelBurst(root);
    if (reduceMotion()) {
        root.animate(
            [{ opacity: 1 }, { opacity: 0.62 }, { opacity: 1 }],
            { duration: 160, easing: 'ease-out' },
        );
        return;
    }
    const body = root.querySelector('.seal-body');
    const foil = root.querySelector('.seal-foil');
    const splats = root.querySelectorAll('.seal-splat');
    body?.animate([
        { transform: 'scale(1, 1)', offset: 0 },
        { transform: 'scale(1.08, 0.86)', offset: 0.16 },
        { transform: 'scale(0.94, 1.12)', offset: 0.4 },
        { transform: 'scale(1.03, 0.98)', offset: 0.72 },
        { transform: 'scale(1, 1)', offset: 1 },
    ], { duration: BURST_MS, easing: 'linear' });
    foil?.animate([
        { transform: 'translateY(0px) scale(1, 1)', opacity: 1, offset: 0 },
        { transform: 'translateY(1px) scale(1.04, 0.9)', opacity: 1, offset: 0.14 },
        { transform: 'translateY(-7px) scale(1.18, 0.32)', opacity: 0, offset: 0.4 },
        { transform: 'translateY(-7px) scale(1.18, 0.32)', opacity: 0, offset: 0.62 },
        { transform: 'translateY(0px) scale(1, 1)', opacity: 1, offset: 1 },
    ], { duration: BURST_MS, easing: 'linear' });
    splats.forEach((el, index) => {
        const spot = SPLATS[index] || SPLATS[0];
        const { x, y } = spot;
        el.animate([
            { transform: 'translate(0px, 0px) scale(0.2)', opacity: 0, offset: 0 },
            { transform: `translate(${x * 0.35}px, ${y * 0.35}px) scale(0.55)`, opacity: 0.95, offset: 0.24 },
            { transform: `translate(${x}px, ${y}px) scale(1)`, opacity: 0.82, offset: 0.52 },
            { transform: `translate(${x * 1.12}px, ${y * 1.12}px) scale(1.04)`, opacity: 0, offset: 0.84 },
            { transform: 'translate(0px, 0px) scale(0.2)', opacity: 0, offset: 1 },
        ], { duration: BURST_MS, delay: index * 8, easing: 'linear' });
    });
}
