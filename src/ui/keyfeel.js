/** 누르는 손맛. 짧은 틱은 이 자리에서 합성하고, 소리 파일은 받지 않습니다.
    연달은 누름은 이전 틱을 끊고 다시 시작해 겹치거나 밀리지 않습니다. */

const SOUND_KEY = 'ssug-gyomu-key-sound';
const VIBE_KEY = 'ssug-gyomu-key-vibrate';

let ctx = null;
let buffer = null;
let playing = null;
let token = 0;
let muted = false;

export function setKeyMuted(on) {
    muted = Boolean(on);
}

function readOn(key) {
    try {
        return localStorage.getItem(key) !== '0';
    } catch {
        return true;
    }
}

export function keySoundEnabled() {
    return readOn(SOUND_KEY);
}

export function keyVibeEnabled() {
    return readOn(VIBE_KEY);
}

export function setKeySound(on) {
    try {
        localStorage.setItem(SOUND_KEY, on ? '1' : '0');
    } catch {
        /* 저장이 막혀도 이번 화면의 소리는 그대로입니다. */
    }
}

export function setKeyVibe(on) {
    try {
        localStorage.setItem(VIBE_KEY, on ? '1' : '0');
    } catch {
        /* 저장이 막혀도 이번 화면의 진동은 그대로입니다. */
    }
}

function fillBuffer(audio) {
    const rate = audio.sampleRate;
    const duration = 0.024;
    const length = Math.floor(rate * duration);
    const buf = audio.createBuffer(1, length, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
        const t = i / rate;
        const env = Math.exp(-t * 240) * (1 - t / duration);
        const noise = (Math.random() * 2 - 1) * 0.4;
        const tick = Math.sin(2 * Math.PI * 1960 * t) * 0.32;
        const body = Math.sin(2 * Math.PI * 150 * t) * 0.5;
        data[i] = (noise + tick + body) * env;
    }
    return buf;
}

function startNow(audio) {
    if (playing) {
        try { playing.stop(); } catch { /* 이미 끝난 틱입니다. */ }
        playing = null;
    }
    if (!buffer || buffer.sampleRate !== audio.sampleRate) buffer = fillBuffer(audio);
    const src = audio.createBufferSource();
    const gain = audio.createGain();
    gain.gain.value = 0.05;
    src.buffer = buffer;
    src.connect(gain);
    gain.connect(audio.destination);
    src.start();
    playing = src;
    src.onended = () => {
        if (playing === src) playing = null;
    };
}

export function playKey() {
    if (muted) return;
    const sound = keySoundEnabled();
    const vibe = keyVibeEnabled();
    if (!sound && !vibe) return;
    if (vibe && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(8); } catch { /* 진동이 없어도 누르기는 됩니다. */ }
    }
    if (!sound) return;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const mine = ++token;
    try {
        if (!ctx) ctx = new AudioCtx();
        const run = () => {
            if (mine !== token || muted || !keySoundEnabled()) return;
            startNow(ctx);
        };
        if (ctx.state === 'running') run();
        else ctx.resume().then(run).catch(() => {});
    } catch {
        /* 소리를 못 내도 누른 일은 진행됩니다. */
    }
}
