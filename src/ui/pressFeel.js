/** 하단 버튼 손맛. 눌림 크기는 완성본 컵 CSS(가로 1.1, 세로 0.86, 되튐 0.46초)를 따릅니다.
    소리 곡선은 완성본의 뽁·톡이고, 재생은 글자 소리와 같은 오디오 컨텍스트·리미터를 씁니다.
    기본은 꺼져 있고, 소리를 끄면 진동도 같이 꺼집니다. */

import { withKeyAudio } from './keyfeel.js';

export const JAM_KEY = 'ssug-gyomu-press-feel';
export const PRESS_VIBE_MS = 12;
export const PRESS_HOLD = { x: 1.1, y: 0.86 };
export const PRESS_IN_MS = 70;
export const PRESS_OUT_MS = 460;

const JAM_GAIN = 0.04;
const JAM_MAX = 4;
const JAM_FADE = 0.012;
const VOICES = {
    pop: { f0: 560, f1: 210, dur: 0.075, gain: 1, attack: 0.003, h2: 0.3 },
    tok: { f0: 880, f1: 1560, dur: 0.055, gain: 1, attack: 0.002, h2: 0.2, click: 2600 },
};

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

function fabOf(target) {
    if (!target || typeof target.closest !== 'function') return null;
    if (target.classList?.contains('foil-fab')) return target;
    return target.closest('.foil-fab');
}

function stopWatch(root) {
    const stop = root?._pressStop;
    if (typeof stop === 'function') stop();
    if (root) root._pressStop = null;
}

export function pressDown(target, options = {}) {
    const button = fabOf(target);
    if (!button) return;
    stopWatch(button);
    button.classList.add('is-pressed');
    button.dataset.press = 'down';
    const onUp = () => {
        stopWatch(button);
        pressUp(button, options);
    };
    button._pressStop = () => {
        window.removeEventListener('pointerup', onUp, true);
        window.removeEventListener('pointercancel', onUp, true);
        button._pressStop = null;
    };
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    if (options.silent || !jamFeelEnabled()) return;
    playJam('pop');
    vibratePress();
}

export function pressUp(target) {
    const button = fabOf(target);
    if (!button || button.dataset.press !== 'down') return;
    stopWatch(button);
    button.classList.remove('is-pressed');
    button.dataset.press = 'rest';
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

function voiceSamples(v, sampleRate) {
    const parts = [
        ['sine', v.f0, v.f1, v.dur, v.gain, v.attack],
        ['triangle', v.f0 * 2, v.f1 * 2, v.dur * 0.6, v.gain * v.h2, v.attack],
    ];
    if (v.click) parts.push(['sine', v.click, v.click * 0.7, 0.012, v.gain * 0.5, 0.001]);
    const n = Math.ceil((v.dur + 0.03) * sampleRate);
    const out = new Float32Array(n);
    for (const [type, f0, f1, dur, peak, att] of parts) {
        let phase = 0;
        for (let i = 0; i < n; i += 1) {
            const t = i / sampleRate;
            if (t > dur + 0.02) break;
            const f = t < dur * 0.7 ? f0 * (f1 / f0) ** (t / (dur * 0.7)) : f1;
            phase += (2 * Math.PI * f) / sampleRate;
            const env = t < att ? peak * (t / att) : t < dur ? peak * (0.0003 / peak) ** ((t - att) / (dur - att)) : 0;
            const wave = type === 'sine' ? Math.sin(phase) : (2 / Math.PI) * Math.asin(Math.sin(phase));
            out[i] += env * wave;
        }
    }
    return out;
}

/** 뽁은 내려가는 사인, 톡은 올라가는 사인에 짧은 딸깍. 재생 전에 크기를 맞춰 끝을 0으로 둡니다. */
export function renderJamStroke(part = 'pop', sampleRate = 48000) {
    const name = part === 'tok' ? 'tok' : 'pop';
    return { part: name, samples: finish(voiceSamples(VOICES[name], sampleRate), sampleRate) };
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
const lastJamWall = {};

function launchJam(audio, part, when) {
    const name = part === 'tok' ? 'tok' : 'pop';
    const wall = typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
    if (wall - (lastJamWall[name] ?? -Infinity) < 45) return;
    lastJamWall[name] = wall;
    dropJam(audio);
    const now = Number.isFinite(when) ? when : (audio.currentTime || 0);
    while (jamLive.length >= JAM_MAX) {
        fadeJam(jamLive[0], now);
        jamLive = jamLive.slice(1);
    }
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
    try { src.playbackRate.value = 1 + (Math.random() - 0.5) * 0.1; } catch { /* 속도 조절이 없어도 소리는 납니다. */ }
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
