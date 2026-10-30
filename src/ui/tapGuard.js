/** 스크롤하다 손가락이 처음 닿은 칸이 바로 바뀌지 않게 하는 탭 판정.
    누를 때는 소리·눌림만 내고, 손을 뗄 때 TAP_SLOP(10px) 안에서 멈췄고 화면이 굴러가지 않았으면 그때 고릅니다. */
export const TAP_SLOP = 10;

/** 순수 판정. 검사 스크립트가 같은 함수를 씁니다. */
export function isTap(start, end, { scrolled = false, cancelled = false, slop = TAP_SLOP } = {}) {
    if (!start || !end || scrolled || cancelled) return false;
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    return Math.hypot(dx, dy) < slop;
}

/** 버튼에 붙이는 포인터 처리. onDown은 누르자마자(소리), onTap은 탭으로 인정될 때만 부릅니다. */
export function tapHandlers({ onDown, onTap, slop = TAP_SLOP } = {}) {
    let press = null;
    const onScroll = () => { if (press) press.scrolled = true; };
    const stop = () => {
        if (typeof window !== 'undefined') window.removeEventListener('scroll', onScroll, true);
    };
    return {
        onPointerDown(event) {
            if (event.button !== 0) return;
            press = { x: event.clientX, y: event.clientY, scrolled: false, cancelled: false };
            if (typeof window !== 'undefined') window.addEventListener('scroll', onScroll, true);
            onDown?.(event);
        },
        onPointerMove(event) {
            if (!press) return;
            if (!isTap(press, { x: event.clientX, y: event.clientY }, { slop })) press.cancelled = true;
        },
        onPointerCancel() {
            press = null;
            stop();
        },
        onPointerUp(event) {
            const start = press;
            press = null;
            stop();
            if (!start) return;
            if (isTap(start, { x: event.clientX, y: event.clientY }, { scrolled: start.scrolled, cancelled: start.cancelled, slop })) onTap?.(event);
        },
    };
}
