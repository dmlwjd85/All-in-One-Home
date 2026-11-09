/**
 * 할 일 완료 효과(PR C · 삼봉 님이 고른 추천 조합).
 *  - 기본: 쨈 방울 폭죽(로즈 #C2577A) + 체크 칸이 키캡처럼 눌리는 딸깍. 중요도가 높을수록 방울이 많고 멀리 튑니다.
 *  - 오늘 할 일을 다 끝내면 더 큰 버스트와 '참 잘했어요' 원형 도장.
 *  - 방울 모양·각도·도장 문구는 매번 조금씩 바뀝니다.
 *  - 설정: 켜기(on) · 줄이기(low) · 끄기(off). 기기마다 ssug-gyomu-done-fx 키에 둡니다.
 *  - 기기 '동작 줄이기'(prefers-reduced-motion)면 방울은 띄우지 않고, 도장만 움직임 없이 잠깐 보입니다.
 *  - 소리는 기존 '누를 때 소리' 설정을 따릅니다(꺼져 있으면 소리 없음).
 * 사용자가 직접 체크해서 저장에 성공한 때만 부릅니다. 다른 기기에서 받은 체크·처음 불러오기·되돌리기에는 부르지 않습니다.
 */
import { toggleTodo } from '../lib/db.js';
import { keySoundEnabled, withKeyAudio } from './keyfeel.js';

export const FX_KEY = 'ssug-gyomu-done-fx';
export const FX_LEVELS = [
    { id: 'on', label: '켜기', hint: '방울 톡' },
    { id: 'low', label: '줄이기', hint: '작게' },
    { id: 'off', label: '끄기', hint: '체크만' },
];
export const STAMP_WORDS = ['참 잘했어요', '오늘도 해냈어요', '다 했어요', '최고예요', '수고했어요'];
export const STAMP_MS = 1500;
const KINDS = ['', 'seed', 'deep', 'round', 'glint'];
const MAX_LIVE = 80;

function store() {
    try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; }
}

export function normalizeFx(v) { return v === 'low' || v === 'off' ? v : 'on'; }
export function fxLevel(storage) {
    try { return normalizeFx((storage || store())?.getItem?.(FX_KEY)); } catch { return 'on'; }
}
export function setFxLevel(v, storage) {
    const next = normalizeFx(v);
    try { (storage || store())?.setItem?.(FX_KEY, next); } catch { /* 저장이 막혀도 이번 화면은 바뀝니다. */ }
    return next;
}

export function reducedMotion() {
    try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

/** 방울 개수·거리(브라우저 없이 검사). */
export function burstPlan({ pri = 2, allDone = false, level = 'on' } = {}) {
    if (level === 'off') return { count: 0, reach: 0 };
    const p = pri === 1 || pri === 3 ? pri : 2;
    if (level === 'low') return { count: 4 + p * 2, reach: 40 + p * 12 };
    return { count: 8 + p * 6 + (allDone ? 18 : 0), reach: 60 + p * 30 + (allDone ? 60 : 0) };
}

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

function centerOf(rect) {
    if (rect && rect.width + rect.height > 0) return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    return { x: (window.innerWidth || 360) / 2, y: (window.innerHeight || 640) / 2 };
}

function keycap(button) {
    if (!button || !button.classList) return;
    button.classList.remove('done-click');
    void button.offsetWidth;
    button.classList.add('done-click');
    setTimeout(() => button.classList.remove('done-click'), 260);
}

function popSound(pri, big) {
    if (!keySoundEnabled()) return;
    withKeyAudio((audio) => {
        const t = audio.currentTime || 0;
        const notes = big ? [660, 880, 1175] : [560 + pri * 90];
        notes.forEach((f, i) => {
            const o = audio.createOscillator();
            const g = audio.createGain();
            o.type = 'triangle';
            o.frequency.setValueAtTime(f, t + i * 0.07);
            o.frequency.exponentialRampToValueAtTime(f * 1.6, t + i * 0.07 + 0.05);
            g.gain.setValueAtTime(0.0001, t + i * 0.07);
            g.gain.exponentialRampToValueAtTime(0.05, t + i * 0.07 + 0.006);
            g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.07 + 0.09);
            o.connect(g);
            g.connect(audio.destination);
            o.start(t + i * 0.07);
            o.stop(t + i * 0.07 + 0.1);
        });
    });
}

function burst(origin, plan, pri) {
    const root = layer();
    if (root.childElementCount > MAX_LIVE) return;
    const ring = document.createElement('i');
    ring.className = 'done-ring';
    ring.style.left = `${origin.x}px`;
    ring.style.top = `${origin.y}px`;
    root.appendChild(ring);
    const ra = ring.animate?.([
        { opacity: 0.7, transform: 'translate(-50%,-50%) scale(.3)' },
        { opacity: 0, transform: `translate(-50%,-50%) scale(${1.3 + pri * 0.3})` },
    ], { duration: 420, easing: 'cubic-bezier(.2,.8,.2,1)' });
    if (ra) ra.onfinish = () => ring.remove(); else setTimeout(() => ring.remove(), 450);
    const spin = Math.random() * Math.PI * 2;
    for (let i = 0; i < plan.count; i += 1) {
        const d = document.createElement('i');
        const kind = KINDS[Math.floor(Math.random() * KINDS.length)];
        d.className = kind ? `done-drop ${kind}` : 'done-drop';
        const size = 5 + Math.random() * (5 + pri * 2);
        const ang = spin + (Math.PI * 2 * i) / plan.count + (Math.random() - 0.5) * 0.7;
        const dist = plan.reach * (0.45 + Math.random() * 0.7);
        const dx = Math.cos(ang) * dist;
        const dy = Math.sin(ang) * dist - 18 - Math.random() * 26;
        const rot = Math.random() * 200 - 100;
        d.style.width = `${size}px`;
        d.style.height = `${size * (kind === 'round' ? 1 : 1.18)}px`;
        d.style.left = `${origin.x}px`;
        d.style.top = `${origin.y}px`;
        root.appendChild(d);
        const a = d.animate?.([
            { transform: 'translate(-50%,-50%) scale(.4) rotate(0deg)', opacity: 1 },
            { transform: `translate(calc(-50% + ${dx * 0.55}px), calc(-50% + ${dy * 0.4}px)) scale(1.1) rotate(${rot / 2}deg)`, opacity: 1, offset: 0.35 },
            { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy + 30}px)) scale(.8) rotate(${rot}deg)`, opacity: 0 },
        ], { duration: 600 + Math.random() * 300, delay: Math.random() * 40, easing: 'cubic-bezier(.15,.7,.2,1)' });
        if (a) a.onfinish = () => d.remove(); else setTimeout(() => d.remove(), 950);
    }
}

let lastWord = '';
function stamp(still) {
    const root = layer();
    root.querySelector('.done-stamp')?.remove();
    const word = pickWord(Math.random, lastWord);
    lastWord = word;
    const el = document.createElement('div');
    el.className = 'done-stamp';
    el.setAttribute('role', 'status');
    const rot = -24 + Math.random() * 16;
    el.innerHTML = '<span class="done-stamp-ring"></span><b></b><small>오늘 할 일 끝</small>';
    el.querySelector('b').textContent = word;
    root.appendChild(el);
    if (still || !el.animate) {
        el.style.opacity = '0.95';
        el.style.transform = `translate(-50%,-50%) rotate(${rot}deg)`;
        setTimeout(() => el.remove(), STAMP_MS);
        return word;
    }
    el.animate([
        { opacity: 0, transform: `translate(-50%,-50%) scale(1.75) rotate(${rot - 8}deg)` },
        { opacity: 0.95, transform: `translate(-50%,-50%) scale(.92) rotate(${rot + 2}deg)`, offset: 0.2 },
        { opacity: 0.95, transform: `translate(-50%,-50%) scale(1) rotate(${rot}deg)`, offset: 0.3 },
        { opacity: 0.95, transform: `translate(-50%,-50%) scale(1) rotate(${rot}deg)`, offset: 0.82 },
        { opacity: 0, transform: `translate(-50%,-50%) scale(1) rotate(${rot}deg)` },
    ], { duration: STAMP_MS, easing: 'cubic-bezier(.2,1.2,.3,1)', fill: 'forwards' }).onfinish = () => el.remove();
    return word;
}

/** 체크를 끝냈을 때 효과. info: toggleTodo 결과. rect: 누른 단추 위치(누른 순간 잰 값). */
export function celebrateDone(info, { rect = null, button = null, level = fxLevel() } = {}) {
    if (!info?.done || info.storageFailed || typeof document === 'undefined') return null;
    if (level === 'off') return null;
    const pri = info.pri === 1 || info.pri === 3 ? info.pri : 2;
    const big = Boolean(info.allDone);
    keycap(button);
    popSound(pri, big && level === 'on');
    const still = reducedMotion();
    if (!still) burst(centerOf(rect), burstPlan({ pri, allDone: big, level }), pri);
    if (big) return stamp(still || level === 'low');
    return null;
}

/**
 * 화면의 체크 단추가 부르는 한 길: 누른 위치를 먼저 재고(시트가 닫혀도), 저장한 뒤 효과를 띄우고, 목표 달성은 알림으로 알립니다.
 */
export async function toggleTodoFx(id, event, { showToast } = {}) {
    const button = event?.currentTarget || null;
    const rect = button?.getBoundingClientRect ? button.getBoundingClientRect() : null;
    const info = await toggleTodo(id);
    if (!info || info.storageFailed) return info;
    celebrateDone(info, { rect, button });
    if (typeof showToast === 'function') {
        if (info.goalHit) showToast('오늘 목표를 채웠어요. 캘린더에 달성 표시를 남겼어요.', true);
        else if (info.goalCleared) showToast('목표 아래로 내려가서 그날 달성 표시를 지웠어요.', true);
    }
    return info;
}
