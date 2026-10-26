/** 하단 용기. 트리거는 누르기, 규칙은 한 번 터지고 돌아오기, 피드백은 변형과 투명도만.
    연타는 진행 중인 동작을 끊고 같은 요소에서 다시 시작합니다. */

export const BURST_MS = 420;
export const SPLAT_COUNT = 6;
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

export function playSealBurst(root) {
    if (!root) return;
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
