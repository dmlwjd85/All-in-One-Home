/**
 * 할 일 완료 효과(PR C · 삼봉 님이 고른 추천 조합, 평점관 9.3 뒤 세기 조절).
 *  - 평소 완료: 체크 칸 딸깍 + 쨈 방울 6~10개, 0.6초 안쪽으로 작고 짧게.
 *  - 크게 터지는 때: 중요도 3(높음)이거나 그날 마지막 할 일(오늘 목록을 다 끝냄)일 때만. 방울은 많아도 20개(설정 ‘크게’여도 20개까지).
 *    마지막 할 일이면 '참 잘했어요' 원형 도장도 찍습니다.
 *  - 짧은 시간(1.6초)에 여러 개를 연달아 체크하면 방울을 더 줄이고, 큰 버스트도 평소 크기로 낮춥니다.
 *  - 설정: 크게(big) · 보통(mid, 기본) · 작게(low) · 끄기(off). 기기마다 ssug-gyomu-done-fx 키에 둡니다(예전 'on'은 보통).
 *  - 기기 '동작 줄이기'면 방울은 띄우지 않고, 도장만 움직임 없이 잠깐 보입니다.
 *  - 소리는 따로 켜지 않습니다. 기존 '누를 때 소리'가 켜져 있을 때만, 그 크기·리미터 길로 냅니다.
 *  - 성능: 방울은 transform·opacity만 움직이고(Web Animations, 합성 단계), 한 번에 붙인 뒤 끝나면 모두 지웁니다.
 *  - 접근성: 효과 층은 aria-hidden, 완료·목표는 따로 둔 aria-live 영역에 글로 알립니다. 누른 단추의 포커스는 유지합니다.
 * 사용자가 직접 체크해서 저장에 성공한 때만 부릅니다. 다른 기기에서 받은 체크·처음 불러오기·되돌리기에는 부르지 않습니다.
 */
import { toggleTodo } from '../lib/db.js';
import { keyAudioBus, keySoundEnabled, keyVolumeGain, keyVolumeId, withKeyAudio } from './keyfeel.js';

export const FX_KEY = 'ssug-gyomu-done-fx';
export const FX_DEFAULT = 'mid';
export const FX_LEVELS = [
    { id: 'big', label: '크게', hint: '팡 터지게' },
    { id: 'mid', label: '보통', hint: '톡, 짧게' },
    { id: 'low', label: '작게', hint: '조금만' },
    { id: 'off', label: '끄기', hint: '체크만' },
];
export const STAMP_WORDS = ['참 잘했어요', '오늘도 해냈어요', '다 했어요', '최고예요', '수고했어요'];
export const STAMP_MS = 1400;
/** 평소 완료 효과가 끝나는 시간(지연 포함 최대). */
export const SMALL_MS = 560;
export const BIG_MS = 900;
export const RAPID_MS = 1600;
export const MAX_DROPS = 20; // 크게·마지막 할 일이어도 방울은 20개까지(평점관 P1).
const KINDS = ['', 'seed', 'deep', 'round', 'glint'];
const MAX_LIVE = 48;

function store() {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function normalizeFx(v) {
    if (v === 'big' || v === 'low' || v === 'off') return v;
    return FX_DEFAULT;
}
export function fxLevel(storage) {
    try { return normalizeFx((storage || store())?.getItem?.(FX_KEY)); } catch { return FX_DEFAULT; }
}
export function setFxLevel(v, storage) {
    const next = normalizeFx(v);
    try { (storage || store())?.setItem?.(FX_KEY, next); } catch { /* 저장이 막혀도 이번 화면은 바뀝니다. */ }
    return next;
}

/** 예전 저장값('on' 등 지금 없는 값)을 첫 실행 때 'mid'(보통)로 다시 적어 통일합니다(QA 권장). 고친 값을 돌려줍니다. */
export function migrateFxLevel(storage) {
    try {
        const box = storage || store();
        const raw = box?.getItem?.(FX_KEY);
        if (raw == null || FX_LEVELS.some((item) => item.id === raw)) return null;
        box.setItem(FX_KEY, FX_DEFAULT);
        return FX_DEFAULT;
    } catch { return null; }
}

export function reducedMotion() {
    try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** 크게 터뜨릴 때인지: 중요도 3이거나 그날 마지막 할 일. */
export function isBigMoment({ pri = 2, allDone = false } = {}) {
    return pri === 3 || Boolean(allDone);
}

/**
 * 방울 계획(브라우저 없이 검사). streak = 직전 RAPID_MS 안에 이어서 체크한 수(0이면 혼자).
 * 돌려주는 값: { count, reach, ms, big, ring }.
 */
export function burstPlan({ pri = 2, allDone = false, level = FX_DEFAULT, streak = 0 } = {}) {
    const lv = normalizeFx(level);
    if (lv === 'off') return { count: 0, reach: 0, ms: 0, big: false, ring: false };
    const p = pri === 1 || pri === 3 ? pri : 2;
    const s = Math.max(0, Math.min(5, Math.floor(Number(streak) || 0)));
    // 연달아 체크하면 큰 버스트는 평소 크기로 낮춥니다(마지막 할 일은 그래도 크게).
    let big = isBigMoment({ pri: p, allDone }) && (s === 0 || allDone);
    let count;
    let reach;
    if (lv === 'low') {
        count = big ? 8 : 4;
        reach = big ? 70 : 44;
        big = false;
    } else if (big) {
        count = (lv === 'big' ? 22 : 18) + (allDone ? 2 : 0);
        reach = (lv === 'big' ? 150 : 120) + (allDone ? 20 : 0);
    } else {
        count = (lv === 'big' ? 9 : 6) + (p - 1) * 2; // 보통: 6·8·10, 크게: 9·11·13
        reach = (lv === 'big' ? 80 : 60) + p * 8;
    }
    if (s > 0) {
        count = Math.max(3, Math.round(count / (1 + s)));
        reach = Math.round(reach * (s >= 2 ? 0.6 : 0.8));
    }
    count = Math.min(MAX_DROPS, count);
    const ms = big ? BIG_MS : SMALL_MS;
    return { count, reach, ms, big, ring: s < 2 };
}

let recent = [];
/** 이번 체크 앞에 RAPID_MS 안에서 몇 번 연달아 체크했는지 세고, 이번 체크를 적습니다. */
export function noteCheck(now = Date.now()) {
    recent = recent.filter((t) => now - t < RAPID_MS);
    const streak = recent.length;
    recent.push(now);
    if (recent.length > 8) recent = recent.slice(-8);
    return streak;
}
export function resetChecks() { recent = []; }

export function pickWord(random = Math.random, last = '') {
    const pool = STAMP_WORDS.filter((w) => w !== last);
    return pool[Math.floor(random() * pool.length) % pool.length];
}

function layer() {
    let el = document.querySelector('.done-fx-layer');
    if (!el) {
        el = document.createElement('div');
        el.className = 'done-fx-layer';
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
    }
    return el;
}

/** 화면 읽기용 알림 영역(보이지 않음, polite). 효과 층과 따로 둡니다. */
function liveRegion() {
    let el = document.querySelector('.done-fx-live');
    if (!el) {
        el = document.createElement('div');
        el.className = 'done-fx-live sr-only';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-live', 'polite');
        el.setAttribute('aria-atomic', 'true');
        document.body.appendChild(el);
    }
    return el;
}

let liveTimer = 0;
export function announce(text) {
    if (typeof document === 'undefined' || !text) return '';
    const el = liveRegion();
    el.textContent = '';
    clearTimeout(liveTimer);
    // 같은 문장도 다시 읽히게 한 박자 뒤에 넣습니다.
    liveTimer = setTimeout(() => { el.textContent = text; }, 60);
    return text;
}

/** 완료·풀기를 글로 알립니다(화면 읽기). */
export function doneMessage(info) {
    if (!info) return '';
    const title = String(info.title || '').trim();
    const head = title ? `‘${title.length > 40 ? `${title.slice(0, 40)}…` : title}’ ` : '';
    if (!info.done) {
        if (info.goalCleared) return `${head}다시 남겼어요. 목표 아래로 내려가 오늘 달성 표시를 지웠어요.`;
        return `${head}다시 남겼어요.`;
    }
    const parts = [`${head}끝냈어요.`];
    if (info.allDone) parts.push('오늘 할 일을 모두 끝냈어요.');
    if (info.goal > 0) parts.push(info.goalHit ? `오늘 목표 ${info.goal}개를 채웠어요.` : `오늘 목표 ${info.goal}개 중 ${Math.min(info.count || 0, 99)}개.`);
    return parts.join(' ');
}

function centerOf(rect) {
    if (rect && rect.width + rect.height > 0) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return { x: (window.innerWidth || 360) / 2, y: (window.innerHeight || 640) / 2 };
}

function keycap(button) {
    if (!button || !button.classList) return;
    button.classList.remove('done-click');
    // 다음 프레임에 다시 붙여 강제 리플로 없이 애니메이션을 새로 시작합니다.
    requestAnimationFrame(() => {
        button.classList.add('done-click');
        setTimeout(() => button.classList.remove('done-click'), 260);
    });
}

function popSound(pri, big) {
    if (!keySoundEnabled()) return false;
    withKeyAudio((audio) => {
        const t = audio.currentTime || 0;
        const out = keyAudioBus(audio);
        const level = Math.min(1, Math.max(0.2, keyVolumeGain(keyVolumeId()) || 0.5));
        const notes = big ? [660, 880, 1175] : [560 + pri * 90];
        notes.forEach((f, i) => {
            const o = audio.createOscillator();
            const g = audio.createGain();
            const at = t + i * 0.07;
            o.type = 'triangle';
            o.frequency.setValueAtTime(f, at);
            o.frequency.exponentialRampToValueAtTime(f * 1.6, at + 0.05);
            g.gain.setValueAtTime(0.0001, at);
            g.gain.exponentialRampToValueAtTime(0.05 * level, at + 0.006);
            g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
            o.connect(g);
            g.connect(out);
            o.start(at);
            o.stop(at + 0.1);
            o.onended = () => { try { o.disconnect(); g.disconnect(); } catch { /* 이미 끊김 */ } };
        });
    });
    return true;
}

let sweepTimer = 0;
/** 늦게라도 남은 조각을 치웁니다(탭이 숨어 onfinish가 밀려도 DOM이 쌓이지 않게). */
function sweepLater(ms) {
    clearTimeout(sweepTimer);
    sweepTimer = setTimeout(() => {
        const root = document.querySelector('.done-fx-layer');
        if (!root) return;
        root.querySelectorAll('.done-drop, .done-ring').forEach((el) => el.remove());
        if (!root.childElementCount) root.remove();
    }, ms + 400);
}

function dropDone(el) {
    const root = el.parentNode;
    el.remove();
    if (root && !root.childElementCount) root.remove();
}

function burst(origin, plan, pri) {
    if (!plan.count) return 0;
    const root = layer();
    if (root.childElementCount > MAX_LIVE) return 0;
    const frag = document.createDocumentFragment();
    const items = [];
    const at = `translate3d(${origin.x}px, ${origin.y}px, 0) translate(-50%, -50%)`;
    if (plan.ring) {
        const ring = document.createElement('i');
        ring.className = 'done-ring';
        ring.style.transform = `${at} scale(.3)`;
        frag.appendChild(ring);
        items.push([ring, [
            { opacity: 0.7, transform: `${at} scale(.3)` },
            { opacity: 0, transform: `${at} scale(${plan.big ? 2.4 : 1.4})` },
        ], { duration: Math.min(plan.ms, plan.big ? 480 : 360), easing: 'cubic-bezier(.2,.8,.2,1)' }]);
    }
    const spin = Math.random() * Math.PI * 2;
    const delayMax = 30;
    for (let i = 0; i < plan.count; i += 1) {
        const d = document.createElement('i');
        const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
        d.className = kind ? `done-drop ${kind}` : 'done-drop';
        const size = 5 + Math.random() * (plan.big ? 7 : 3 + pri);
        const ang = spin + (Math.PI * 2 * i) / plan.count + (Math.random() - 0.5) * 0.7;
        const dist = plan.reach * (0.45 + Math.random() * 0.6);
        const dx = Math.cos(ang) * dist;
        const dy = Math.sin(ang) * dist - 14 - Math.random() * 20;
        const rot = Math.random() * 200 - 100;
        d.style.width = `${size.toFixed(1)}px`;
        d.style.height = `${(size * (kind === 'round' ? 1 : 1.18)).toFixed(1)}px`;
        d.style.transform = `${at} scale(.4)`;
        frag.appendChild(d);
        const ms = plan.ms - delayMax - Math.random() * (plan.big ? 220 : 120);
        items.push([d, [
            { transform: `${at} scale(.4) rotate(0deg)`, opacity: 1 },
            { transform: `${at} translate(${(dx * 0.55).toFixed(1)}px, ${(dy * 0.4).toFixed(1)}px) scale(1.1) rotate(${(rot / 2).toFixed(0)}deg)`, opacity: 1, offset: 0.35 },
            { transform: `${at} translate(${dx.toFixed(1)}px, ${(dy + (plan.big ? 30 : 16)).toFixed(1)}px) scale(.8) rotate(${rot.toFixed(0)}deg)`, opacity: 0 },
        ], { duration: Math.max(240, ms), delay: Math.random() * delayMax, easing: 'cubic-bezier(.15,.7,.2,1)', fill: 'forwards' }]);
    }
    root.appendChild(frag);
    for (const [el, frames, opts] of items) {
        const a = el.animate?.(frames, opts);
        if (a) a.onfinish = () => dropDone(el);
        else setTimeout(() => dropDone(el), (opts.duration || 0) + (opts.delay || 0));
    }
    sweepLater(plan.ms);
    return items.length;
}

let lastWord = '';
function stamp(still) {
    const root = layer();
    root.querySelector('.done-stamp')?.remove();
    const word = pickWord(Math.random, lastWord);
    lastWord = word;
    const el = document.createElement('div');
    el.className = 'done-stamp';
    const rot = -24 + Math.random() * 16;
    el.innerHTML = '<span class="done-stamp-ring"></span><b></b><small>오늘 할 일 끝</small>';
    el.querySelector('b').textContent = word;
    root.appendChild(el);
    const end = () => dropDone(el);
    if (still || !el.animate) {
        el.style.opacity = '0.95';
        el.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`;
        setTimeout(end, STAMP_MS);
        return word;
    }
    el.animate([
        { opacity: 0, transform: `translate(-50%,-50%) scale(1.6) rotate(${rot - 8}deg)` },
        { opacity: 0.95, transform: `translate(-50%,-50%) scale(.94) rotate(${rot + 2}deg)`, offset: 0.18 },
        { opacity: 0.95, transform: `translate(-50%,-50%) scale(1) rotate(${rot}deg)`, offset: 0.28 },
        { opacity: 0.95, transform: `translate(-50%,-50%) scale(1) rotate(${rot}deg)`, offset: 0.8 },
        { opacity: 0, transform: `translate(-50%,-50%) scale(1) rotate(${rot}deg)` },
    ], { duration: STAMP_MS, easing: 'cubic-bezier(.2,1.2,.3,1)', fill: 'forwards' }).onfinish = end;
    return word;
}

/**
 * 체크를 끝냈을 때 효과. info: toggleTodo 결과. rect: 누른 단추 위치(누른 순간 잰 값).
 * 돌려주는 값(검사용): { plan, word, sound } 또는 null.
 */
export function celebrateDone(info, { rect = null, button = null, level = fxLevel(), streak = null } = {}) {
    if (!info?.done || info.storageFailed || typeof document === 'undefined') return null;
    const lv = normalizeFx(level);
    if (lv === 'off') return null;
    const pri = info.pri === 1 || info.pri === 3 ? info.pri : 2;
    const s = streak == null ? noteCheck() : streak;
    const plan = burstPlan({ pri, allDone: Boolean(info.allDone), level: lv, streak: s });
    keycap(button);
    const sound = s < 3 ? popSound(pri, plan.big && lv !== 'low') : false;
    const still = reducedMotion();
    if (!still) burst(centerOf(rect), plan, pri);
    const word = info.allDone ? stamp(still || lv === 'low') : null;
    return { plan, word, sound };
}

/** 체크 뒤 목록이 다시 그려져도(정렬로 줄이 옮겨져도) 누른 단추에 포커스를 돌려 둡니다. */
function keepFocus(button, id) {
    if (typeof document === 'undefined' || !button) return;
    const back = () => {
        if (button.isConnected) {
            if (document.activeElement !== button) button.focus?.({ preventScroll: true });
            return;
        }
        const same = id != null ? document.querySelector(`[data-todo-check="${CSS.escape(String(id))}"]`) : null;
        same?.focus?.({ preventScroll: true });
    };
    requestAnimationFrame(() => requestAnimationFrame(back));
}

/**
 * 화면의 체크 단추가 부르는 한 길: 누른 위치를 먼저 재고(시트가 닫혀도), 저장한 뒤 효과를 띄우고,
 * 완료·목표를 화면 읽기에 알리고, 목표 달성은 알림으로도 보여 줍니다.
 */
export async function toggleTodoFx(id, event, { showToast } = {}) {
    const button = event?.currentTarget || null;
    const rect = button?.getBoundingClientRect ? button.getBoundingClientRect() : null;
    const hadFocus = typeof document !== 'undefined' && button && document.activeElement === button;
    const info = await toggleTodo(id);
    if (!info || info.storageFailed) return info;
    celebrateDone(info, { rect, button });
    if (hadFocus) keepFocus(button, id);
    let toast = '';
    if (info.goalHit) toast = '오늘 목표를 채웠어요. 캘린더에 달성 표시를 남겼어요.';
    else if (info.goalCleared) toast = '목표 아래로 내려가서 그날 달성 표시를 지웠어요.';
    if (toast && typeof showToast === 'function') showToast(toast, true);
    else announce(doneMessage(info));
    return info;
}
