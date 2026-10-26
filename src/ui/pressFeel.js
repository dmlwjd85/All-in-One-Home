/** 하단 버튼의 바깥 틀. 컵 그림이 바뀌어도 누름, 소리, 진동은 이 자리를 그대로 씁니다.
    호일이 벗겨지는 그림은 여기에 없습니다. 그 그림은 완성본이 오면 버튼 안에만 넣습니다.
    스프링은 감쇠 조화 진동이고, 소리는 버튼 소리와 같은 오디오 컨텍스트 하나를 씁니다. */

import { withKeyAudio } from './keyfeel.js';

export const JAM_KEY = 'ssug-gyomu-press-feel';
export const PRESS_VIBE_MS = 14;
export const PRESS_SQUASH_MS = 90;
export const PRESS_SPRING_MS = 340;
export const PRESS_HOLD = { x: 1.12, y: 0.78 };
export const PRESS_HOLD_REDUCED = { x: 1.035, y: 0.96 };

const JAM_GAIN = 0.04;
const JAM_MAX = 4;
const JAM_FADE = 0.012;
const POP_MS = 58;
const TOK_MS = 36;

let jamLive = [];
let jamBusCtx = null;
let jamBusIn = null;

function readStore(storage) {
    if (storage) return storage;
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

export function jamFeelEnabled(storage) {
    try {
        return readStore(storage)?.getItem?.(JAM_KEY) === '1';
    } catch {
        return false;
    }
}

export function setJamFeel(on, storage) {
    try {
        readStore(storage)?.setItem?.(JAM_KEY, on ? '1' : '0');
    } catch {
        /* 저장이 막혀도 이번 화면의 선택은 유지합니다. */
    }
    return Boolean(on);
}

export function motionReduced() {
    try {
        return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
        return false;
    }
}

/** ζ<1 이면 제자리를 살짝 넘깁니다. 움직임 줄이기는 ζ를 1 가까이 두어 넘김을 없앱니다. */
export function springPose(from, timeSec, reduced) {
    const omega = reduced ? 34 : 18;
    const zeta = reduced ? 0.95 : 0.38;
    const t = Math.max(0, timeSec);
    const under = Math.max(0.04, 1 - zeta * zeta);
    const wd = omega * Math.sqrt(under);
    const decay = Math.exp(-zeta * omega * t);
    const osc = decay * Math.cos(wd * t);
    return {
        x: 1 + (from.x - 1) * osc,
        y: 1 + (from.y - 1) * osc,
    };
}

export function springFrames(from, reduced) {
    const duration = reduced ? 160 : PRESS_SPRING_MS;
    const steps = reduced ? 6 : 16;
    const frames = [];
    let peakY = from.y;
    for (let i = 0; i <= steps; i += 1) {
        const pose = springPose(from, (i / steps) * (duration / 1000), reduced);
        peakY = Math.max(peakY, pose.y);
        frames.push({
            transform: `scale(${pose.x.toFixed(4)}, ${pose.y.toFixed(4)})`,
            offset: i / steps,
        });
    }
    frames[frames.length - 1] = { transform: 'scale(1, 1)', offset: 1 };
    return { frames, duration, peakY };
}

function holdOf(reduced) {
    return reduced ? PRESS_HOLD_REDUCED : PRESS_HOLD;
}

function feelOf(target) {
    if (!target || typeof target.querySelector !== 'function') return null;
    if (target.classList?.contains('press-feel')) return target;
    return target.querySelector('.press-feel');
}

function stopWatch(root) {
    const stop = root?._pressStop;
    if (typeof stop === 'function') stop();
    if (root) root._pressStop = null;
}

export function pressDown(target, options = {}) {
    const root = feelOf(target);
    if (!root?.animate) return;
    stopWatch(root);
    const running = root.getAnimations?.() || [];
    running.forEach((anim) => anim.cancel());
    const reduced = options.reduced ?? motionReduced();
    const hold = holdOf(reduced);
    root.dataset.press = 'down';
    const anim = root.animate([
        { transform: 'scale(1, 1)', offset: 0 },
        { transform: `scale(${hold.x}, ${hold.y})`, offset: 1 },
    ], {
        duration: reduced ? 70 : PRESS_SQUASH_MS,
        easing: 'cubic-bezier(0.22, 0.9, 0.3, 1)',
        fill: 'forwards',
    });
    anim.pressKind = 'squash';
    const onUp = () => {
        stopWatch(root);
        pressUp(root, options);
    };
    root._pressStop = () => {
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
        root._pressStop = null;
    };
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    if (options.silent) return;
    if (!jamFeelEnabled()) return;
    playJam('pop');
    vibratePress();
}

export function pressUp(target, options = {}) {
    const root = feelOf(target);
    if (!root?.animate) return;
    if (root.dataset.press !== 'down') return;
    stopWatch(root);
    const reduced = options.reduced ?? motionReduced();
    const hold = holdOf(reduced);
    const running = root.getAnimations?.() || [];
    running.forEach((anim) => anim.cancel());
    root.dataset.press = 'spring';
    const { frames, duration } = springFrames(hold, reduced);
    const anim = root.animate(frames, { duration, easing: 'linear', fill: 'forwards' });
    anim.pressKind = 'spring';
    anim.onfinish = () => {
        if (root.dataset.press === 'spring') root.dataset.press = 'rest';
    };
    if (options.silent || !jamFeelEnabled()) return;
    playJam('tok');
}

function noiseAt(i, salt) {
    let x = Math.imul(i + salt * 997 + 1, 1103515245) + 12345;
    x = Math.imul(x ^ (x >>> 16), 2246822519);
    x = (x ^ (x >>> 13)) >>> 0;
    return (x / 4294967296) * 2 - 1;
}

function finish(data, sampleRate) {
    const attack = Math.min(data.length, Math.max(2, Math.round(sampleRate * 0.0012)));
    const release = Math.min(data.length, Math.max(2, Math.round(sampleRate * 0.008)));
    for (let i = 0; i < attack; i += 1) data[i] *= i / attack;
    for (let i = 0; i < release; i += 1) data[data.length - 1 - i] *= i / release;
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    const scale = peak > 0.00001 ? 0.9 / peak : 1;
    for (let i = 0; i < data.length; i += 1) data[i] *= scale;
    data[0] = 0;
    data[data.length - 1] = 0;
    return data;
}

/** 뽁은 말랑한 공기 주머니, 톡은 짧은 뚜껑 튕김. 둘 다 감쇠 사인파와 아주 짧은 잡음입니다. */
export function renderJamStroke(part = 'pop', sampleRate = 48000) {
    const pop = part !== 'tok';
    const ms = pop ? POP_MS : TOK_MS;
    const n = Math.max(8, Math.round((sampleRate * ms) / 1000));
    const data = new Float32Array(n);
    let phase = 0;
    let low = 0;
    const salt = pop ? 17 : 41;
    for (let i = 0; i < n; i += 1) {
        const t = i / sampleRate;
        const u = n === 1 ? 0 : i / (n - 1);
        const white = noiseAt(i, salt);
        low += (pop ? 0.22 : 0.08) * (white - low);
        const freq = pop ? (640 - 360 * u) : (1480 * Math.exp(-t / 0.012) + 420);
        phase += (2 * Math.PI * freq) / sampleRate;
        const body = Math.exp(-t / (pop ? 0.018 : 0.008)) * Math.sin(phase);
        const puff = t < (pop ? 0.01 : 0.0035) ? (white * 0.35 + low) * Math.sin(Math.PI * Math.min(1, t / (pop ? 0.01 : 0.0035))) : 0;
        data[i] = body * (pop ? 0.85 : 1) + puff * (pop ? 0.55 : 0.28);
    }
    return { part: pop ? 'pop' : 'tok', samples: finish(data, sampleRate) };
}

function jamLimit(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return Math.tanh(n);
}

function jamBus(audio) {
    if (jamBusCtx === audio && jamBusIn) return jamBusIn;
    jamBusCtx = audio;
    jamBusIn = audio.destination;
    if (typeof audio.createWaveShaper !== 'function') return jamBusIn;
    try {
        const size = 2049;
        const curve = new Float32Array(size);
        for (let i = 0; i < size; i += 1) {
            const x = (i / (size - 1)) * 2 - 1;
            curve[i] = jamLimit(x);
        }
        const shaper = audio.createWaveShaper();
        shaper.curve = curve;
        shaper.oversample = '2x';
        shaper.connect(audio.destination);
        jamBusIn = shaper;
    } catch {
        jamBusIn = audio.destination;
    }
    return jamBusIn;
}

function dropJam(audio) {
    const now = audio.currentTime || 0;
    const keep = [];
    for (const entry of jamLive) {
        if (entry.done || now >= (entry.until || 0) + 0.04) {
            try { entry.src?.disconnect?.(); } catch { /* 이미 끊긴 소리입니다. */ }
            try { entry.gain?.disconnect?.(); } catch { /* 이미 끊긴 소리입니다. */ }
            entry.done = true;
        } else keep.push(entry);
    }
    jamLive = keep;
}

function fadeJam(oldest, now) {
    const param = oldest?.gain?.gain;
    const level = Number.isFinite(oldest?.level) ? oldest.level : JAM_GAIN;
    if (param && typeof param.setValueAtTime === 'function' && typeof param.linearRampToValueAtTime === 'function') {
        try {
            if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(now);
            param.setValueAtTime(Math.max(0, level), now);
            param.linearRampToValueAtTime(0, now + JAM_FADE);
        } catch {
            /* 램프가 없어도 아래에서 끊습니다. */
        }
        try { oldest?.src?.stop?.(now + JAM_FADE + 0.004); } catch { /* 이미 끝난 소리입니다. */ }
    } else {
        try { oldest?.src?.stop?.(); } catch { /* 이미 끝난 소리입니다. */ }
    }
    if (oldest) oldest.done = true;
}

const jamCache = new Map();

function launchJam(audio, part, when) {
    dropJam(audio);
    const now = Number.isFinite(when) ? when : (audio.currentTime || 0);
    while (jamLive.length >= JAM_MAX) {
        fadeJam(jamLive[0], now);
        jamLive = jamLive.slice(1);
    }
    const name = part === 'tok' ? 'tok' : 'pop';
    const key = `${name}:${audio.sampleRate}`;
    let buffer = jamCache.get(key);
    if (!buffer) {
        const rendered = renderJamStroke(name, audio.sampleRate);
        buffer = audio.createBuffer(1, rendered.samples.length, audio.sampleRate);
        buffer.getChannelData(0).set(rendered.samples);
        jamCache.set(key, buffer);
    }
    const src = audio.createBufferSource();
    const gain = audio.createGain();
    src.buffer = buffer;
    const level = name === 'tok' ? JAM_GAIN * 0.72 : JAM_GAIN;
    const param = gain.gain;
    param.value = level;
    if (typeof param.setValueAtTime === 'function' && typeof param.linearRampToValueAtTime === 'function') {
        try {
            param.setValueAtTime(0, now);
            param.linearRampToValueAtTime(level, now + 0.0015);
        } catch {
            param.value = level;
        }
    }
    src.connect(gain);
    gain.connect(jamBus(audio));
    src.start(now);
    const entry = { src, gain, level, until: now + (buffer.duration || 0.05), done: false };
    src.onended = () => {
        entry.done = true;
        try { src.disconnect(); } catch { /* 이미 끊긴 소리입니다. */ }
        try { gain.disconnect(); } catch { /* 이미 끊긴 소리입니다. */ }
    };
    jamLive.push(entry);
}

export function playJam(part = 'pop') {
    if (!jamFeelEnabled()) return;
    withKeyAudio((audio) => launchJam(audio, part));
}

export function previewJam() {
    withKeyAudio((audio) => {
        launchJam(audio, 'pop', audio.currentTime || 0);
        launchJam(audio, 'tok', (audio.currentTime || 0) + 0.09);
    });
}

export function vibratePress() {
    if (!jamFeelEnabled()) return false;
    const vibrate = typeof navigator !== 'undefined' ? navigator.vibrate : undefined;
    if (typeof vibrate !== 'function') return false;
    try {
        return vibrate.call(navigator, PRESS_VIBE_MS) !== false;
    } catch {
        return false;
    }
}

export function mixJamBurst({ part = 'pop', count = 20, gapMs = 20, fadeMs = 12, sampleRate = 48000 } = {}) {
    const rendered = renderJamStroke(part, sampleRate);
    const samples = rendered.samples;
    const gap = Math.max(0, Math.round((sampleRate * gapMs) / 1000));
    const fade = Math.max(1, Math.round((sampleRate * fadeMs) / 1000));
    const length = Math.max(samples.length + 8, gap * Math.max(0, count - 1) + samples.length + 8);
    const mix = new Float32Array(length);
    const gain = part === 'tok' ? JAM_GAIN * 0.72 : JAM_GAIN;
    for (let n = 0; n < count; n += 1) {
        const start = n * gap;
        for (let i = 0; i < samples.length; i += 1) {
            const at = start + i;
            if (at >= length) break;
            let env = 1;
            const killer = n + JAM_MAX;
            if (killer < count) {
                const cut = killer * gap;
                if (at >= cut) {
                    const into = at - cut;
                    env = into >= fade ? 0 : 1 - into / fade;
                }
            }
            const attack = Math.min(1, i / Math.max(2, Math.round(sampleRate * 0.0015)));
            mix[at] += samples[i] * gain * env * attack;
        }
    }
    let peak = 0;
    let maxJump = 0;
    let clipped = 0;
    let prev = 0;
    for (let i = 0; i < mix.length; i += 1) {
        const limited = jamLimit(mix[i]);
        mix[i] = limited;
        const abs = Math.abs(limited);
        if (abs >= 0.999) clipped += 1;
        peak = Math.max(peak, abs);
        maxJump = Math.max(maxJump, Math.abs(limited - prev));
        prev = limited;
    }
    return { peak, maxJump, clipped, voices: count, gapMs, sampleRate, part };
}

export function resetJamGraphForTest() {
    jamLive = [];
    jamBusCtx = null;
    jamBusIn = null;
    jamCache.clear();
}
