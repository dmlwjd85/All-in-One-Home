/** 가계부 PR #31의 쨈 컵 고침을 이 수첩에 옮깁니다(공유 자료 jjaem-button-D/fabPop.js).
    1) 빠른 입력은 누르는 즉시 열립니다. 컵 복사본 재기·붙이기는 막대가 그려진 다음 프레임 뒤로 미룹니다.
    2) 열린 막대가 컵 자리를 덮으면(휴대폰 아래 탭 바, PC 1280 가운데 아래) 막대 위에 컵 복사본을 겹쳐
       제자리에서 0.15초 만에 터뜨리고, 쨈 방울(10~16px)·은박 조각(14×9px)이 0.38초 동안 위로 튀었다 사라집니다.
       복사본과 조각은 모두 누름을 통과시키고(pointer-events: none) 소리를 내지 않습니다. 소리는 진짜 컵의 '톡' 하나뿐입니다.
    3) 움직임 줄이기: 터짐과 조각 없이 컵 자리에 0.16초 색 변화만.
    4) 연타 보호(createTapBurst): 컵을 연달아 누른 손가락이 막 열린 막대에 떨어지면 무시합니다. */

export const BURST_QUIET_MS = 400; // 저장 단추(칩)·막대 바탕
export const BURST_KEY_MS = 200; // 입력칸·마이크 등 나머지, 그리고 키보드 Enter·Space
export const BURST_RADIUS_PX = 25;
export const GHOST_MS = 420;
export const FLASH_MS = 160;

export const afterFrame = (fn) => (typeof requestAnimationFrame === 'function'
    ? requestAnimationFrame(() => setTimeout(fn, 0))
    : setTimeout(fn, 0));

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

const BITS = [[-120, -330, 16, 0], [-55, -400, 12, 10], [10, -370, 15, 0], [75, -410, 11, 20], [130, -320, 14, 10], [-160, -270, 11, 20], [160, -280, 13, 10], [-25, -300, 10, 20]];
const FOIL = [[-95, -300, 200], [45, -420, -160], [115, -350, 260], [-140, -360, -220]];

function clearGhosts() {
    document.querySelectorAll('.fab-ghost, .cup-burst').forEach((el) => el.remove());
}

export function sprayBits(r) {
    const box = document.createElement('div');
    const cy = r.top + r.height / 2;
    const k = Math.max(1, (cy - 330) / 300); // 컵이 낮을수록 높이 튀겨 조각이 입력칸 위까지 올라가게
    box.className = 'cup-burst';
    box.setAttribute('aria-hidden', 'true');
    box.style.cssText = `left:${r.left + r.width / 2}px;top:${cy}px`;
    box.innerHTML = BITS.map(([x, y, s, d]) => `<i class="cup-bit" style="--dx:${x}px;--dy:${Math.round(y * k)}px;--s:${s}px;--d:${d}ms"></i>`).join('')
        + FOIL.map(([x, y, a], i) => `<i class="cup-bit cup-foil" style="--dx:${x}px;--dy:${Math.round(y * k)}px;--a:${a}deg;--d:${i * 5}ms"></i>`).join('');
    document.body.append(box);
    return box;
}

/** 빠른 입력을 연 다음에 부릅니다. 재기는 다음 프레임 뒤에만 합니다. */
export function playCupGhost(button) {
    const cup = button?.closest?.('.foil-fab');
    if (!cup) return;
    const reduced = reduceMotion();
    afterFrame(() => {
        const bar = document.querySelector('.quick-bar.is-open');
        const disc = cup.querySelector('.fab-disc');
        if (!bar || !disc || !cup.isConnected) return;
        const r = disc.getBoundingClientRect();
        /* 팝업이 컵을 덮지 않아도(아래 탭 바는 그대로) 컵 자리에서 쨈이 튑니다(가계부와 같은 느낌). */
        if (!r.width) return;
        clearGhosts();
        const g = document.createElement('span');
        g.className = `foil-fab fab-ghost ${reduced ? 'is-flash' : 'is-burst'}`;
        g.setAttribute('aria-hidden', 'true');
        g.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px`;
        const copy = disc.cloneNode(true);
        copy.querySelectorAll('[id]').forEach((el) => el.removeAttribute('id'));
        g.append(copy);
        document.body.append(g);
        const bits = reduced ? null : sprayBits(r);
        setTimeout(() => { g.remove(); bits?.remove(); }, reduced ? FLASH_MS : GHOST_MS);
    });
}

/** 구글 'clickbuster'와 같은 방식: 바로 앞 누름과 같은 자리(25px)에 정해진 간격 안에 다시 떨어진 누름만 무시하고,
    무시할 때마다 자리·시각을 이어 갑니다. 자리 없이 쓰면 키보드 연타 묶음이 됩니다. */
export function createTapBurst(quiet = BURST_QUIET_MS, radius = BURST_RADIUS_PX) {
    let last = -Infinity;
    let at = null;
    const reset = () => { last = -Infinity; at = null; };
    return {
        fromButton(t, x, y) { last = t; at = x == null ? null : { x, y }; },
        swallow(t, x, y, gap = quiet) {
            if (t - last < gap && (!at || Math.hypot(x - at.x, y - at.y) <= radius)) {
                last = t;
                if (at) at = { x, y };
                return true;
            }
            reset();
            return false;
        },
        reset,
    };
}

/** 창 전체에 한 번 붙입니다. 끄는 함수를 돌려줍니다. */
export function guardCupBurst(win = window) {
    const taps = createTapBurst(BURST_QUIET_MS);
    const keys = createTapBurst(BURST_KEY_MS);
    let eatClickUntil = -Infinity;
    const stop = (e) => { e.preventDefault(); e.stopPropagation(); };
    const onPointerDown = (e) => {
        const el = e.target instanceof Element ? e.target : null;
        if (el?.closest('.foil-fab')) { taps.fromButton(e.timeStamp, e.clientX, e.clientY); return; }
        if (!el?.closest('.quick-bar.is-open')) { taps.reset(); return; }
        const gap = el.closest('.quick-chip') || !el.closest('button, input, textarea, [role="button"]') ? BURST_QUIET_MS : BURST_KEY_MS;
        if (taps.swallow(e.timeStamp, e.clientX, e.clientY, gap)) {
            eatClickUntil = e.timeStamp + 800;
            stop(e);
        }
    };
    const onClick = (e) => {
        if (e.timeStamp > eatClickUntil) return;
        eatClickUntil = -Infinity;
        stop(e);
    };
    const onKeyDown = (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') { keys.reset(); return; }
        const el = e.target instanceof Element ? e.target : null;
        if (el?.closest('.foil-fab')) { keys.fromButton(e.timeStamp); return; }
        if (keys.swallow(e.timeStamp, 0, 0, BURST_KEY_MS)) stop(e);
    };
    win.addEventListener('pointerdown', onPointerDown, true);
    win.addEventListener('click', onClick, true);
    win.addEventListener('keydown', onKeyDown, true);
    return () => {
        win.removeEventListener('pointerdown', onPointerDown, true);
        win.removeEventListener('click', onClick, true);
        win.removeEventListener('keydown', onKeyDown, true);
    };
}

let bloomTimer = 0;
/** 가계부 fabPop.bloomSheet 처럼 팝업이 컵 자리에서 원으로 0.3초 펼쳐지게 합니다(mask라 누름은 막지 않음). */
export function bloomQuickBar(button, bar = document.querySelector('.quick-bar')) {
    const cup = button?.closest?.('.foil-fab')?.querySelector('.fab-disc') || button;
    if (!bar || !cup?.getBoundingClientRect || reduceMotion()) return;
    const r = cup.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    if (!r.width || !b.width) return;
    bar.style.setProperty('--bloom-x', `${Math.round(r.left + r.width / 2 - b.left)}px`);
    bar.style.setProperty('--bloom-y', `${Math.round(r.top + r.height / 2 - b.top)}px`);
    bar.classList.remove('is-bloom');
    bar.classList.add('is-bloom');
    clearTimeout(bloomTimer);
    bloomTimer = setTimeout(() => bar.classList.remove('is-bloom'), 340);
}

/** 쨈 팝업을 닫은 뒤: 열 때 붙인 것(열림 표시·펼침·컵 복사본·키보드 높이)을 모두 걷어 화면을 처음처럼 둡니다. */
export function resetQuickLayer() {
    const bar = document.querySelector('.quick-bar');
    if (bar) {
        bar.classList.remove('is-open', 'is-bloom', 'is-invite');
        bar.setAttribute('aria-hidden', 'true');
    }
    clearTimeout(bloomTimer);
    clearGhosts();
    document.querySelectorAll('.foil-fab.is-popping, .foil-fab.is-pressed').forEach((el) => el.classList.remove('is-popping', 'is-pressed'));
}
