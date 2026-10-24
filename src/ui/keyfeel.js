/** 누르는 손맛. 소리는 이 자리에서 합성하고, 파일을 받지 않습니다.
    가져온 녹음이 없어서 따로 받을 라이선스는 없습니다.
    누름과 뗌은 다른 파형이고, 높이는 조금 흔들립니다.
    연달은 누름은 이전 소리를 끊고 바로 시작해 겹치거나 밀리지 않습니다. */

const SOUND_KEY = 'ssug-gyomu-key-sound';
const VIBE_KEY = 'ssug-gyomu-key-vibrate';
const VOICE_KEY = 'ssug-gyomu-key-voice';
const VOLUME_KEY = 'ssug-gyomu-key-volume';
const NOTICE_KEY = 'ssug-gyomu-key-sound-notice';

export const KEY_VOICES = [
    { id: 'munggeul', label: '몽글', hint: '저소음' },
    { id: 'mongdol', label: '몽돌', hint: '도각' },
    { id: 'linear', label: '적축', hint: '리니어' },
    { id: 'tactile', label: '갈축', hint: '택타일' },
    { id: 'click', label: '청축', hint: '클릭' },
    { id: 'scrape', label: '끌기', hint: '스윽' },
];

export const KEY_VOLUMES = [
    { id: 'small', label: '작게', gain: 0.045 },
    { id: 'mid', label: '보통', gain: 0.09 },
    { id: 'loud', label: '크게', gain: 0.16 },
];

export const KEY_VOICE_MS = {
    munggeul: { down: 20, up: 13 },
    mongdol: { down: 36, up: 22 },
    linear: { down: 24, up: 12 },
    tactile: { down: 34, up: 16 },
    click: { down: 32, up: 18 },
    scrape: { down: 56, up: 24 },
};

const DEFAULT_VOICE = 'munggeul';
const DEFAULT_VOLUME = 'small';

let ctx = null;
let token = 0;
let muted = false;
let armed = false;
const prefListeners = new Set();
const pairCache = new Map();
let active = [];

export function setKeyMuted(on) {
    muted = Boolean(on);
    if (muted) stopActive();
}

function liveStorage() {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

function readStore(storage) {
    return storage || liveStorage();
}

function readOn(key, storage) {
    try {
        const store = readStore(storage);
        if (!store) return true;
        return store.getItem(key) !== '0';
    } catch {
        return true;
    }
}


export function subscribeKeyPrefs(fn) {
    prefListeners.add(fn);
    return () => prefListeners.delete(fn);
}

function emitPrefs() {
    prefListeners.forEach((fn) => {
        try { fn(); } catch { /* 구독은 화면만 고칩니다. */ }
    });
}

export function keySoundNoticePending(storage) {
    if (!readOn(SOUND_KEY, storage)) return false;
    try {
        const store = readStore(storage);
        if (!store) return true;
        return store.getItem(NOTICE_KEY) !== '1';
    } catch {
        return false;
    }
}

export function rememberKeySoundNotice(storage) {
    try {
        const store = readStore(storage);
        store?.setItem?.(NOTICE_KEY, '1');
        return true;
    } catch {
        return false;
    }
}

export function keySoundEnabled(storage) {
    return readOn(SOUND_KEY, storage);
}

export function keyVibeEnabled(storage) {
    return readOn(VIBE_KEY, storage);
}

export function setKeySound(on, storage) {
    try {
        readStore(storage)?.setItem?.(SOUND_KEY, on ? '1' : '0');
    } catch {
        /* 저장이 막혀도 이번 화면의 소리는 그대로입니다. */
    }
    emitPrefs();
}

export function setKeyVibe(on, storage) {
    try {
        readStore(storage)?.setItem?.(VIBE_KEY, on ? '1' : '0');
    } catch {
        /* 저장이 막혀도 이번 화면의 진동은 그대로입니다. */
    }
    emitPrefs();
}

export function normalizeKeyVoice(id) {
    return KEY_VOICES.some((item) => item.id === id) ? id : DEFAULT_VOICE;
}

export function normalizeKeyVolume(id) {
    return KEY_VOLUMES.some((item) => item.id === id) ? id : DEFAULT_VOLUME;
}

export function keyVoiceId(storage) {
    try {
        const value = readStore(storage)?.getItem?.(VOICE_KEY);
        return normalizeKeyVoice(value);
    } catch {
        return DEFAULT_VOICE;
    }
}

export function keyVolumeId(storage) {
    try {
        const value = readStore(storage)?.getItem?.(VOLUME_KEY);
        return normalizeKeyVolume(value);
    } catch {
        return DEFAULT_VOLUME;
    }
}

export function setKeyVoice(id, storage) {
    const voice = normalizeKeyVoice(id);
    try {
        readStore(storage)?.setItem?.(VOICE_KEY, voice);
    } catch {
        /* 저장이 막혀도 이번 누름의 소리는 고른 값으로 납니다. */
    }
    emitPrefs();
    return voice;
}

export function setKeyVolume(id, storage) {
    const volume = normalizeKeyVolume(id);
    try {
        readStore(storage)?.setItem?.(VOLUME_KEY, volume);
    } catch {
        /* 저장이 막혀도 이번 누름의 크기는 고른 값으로 납니다. */
    }
    emitPrefs();
    return volume;
}

export function keyVolumeGain(id) {
    return KEY_VOLUMES.find((item) => item.id === normalizeKeyVolume(id)).gain;
}

/** 0.94–1.06. 매 누름이 같은 높이면 기계음처럼 들립니다. */
export function keyPitchRate(random = Math.random) {
    const roll = Number(random());
    const unit = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0.5;
    return 0.94 + unit * 0.12;
}

function frameCount(ms, sampleRate) {
    return Math.max(8, Math.round((sampleRate * ms) / 1000));
}

function noiseAt(i, salt) {
    let x = Math.imul(i + salt * 997 + 1, 1103515245) + 12345;
    x = Math.imul(x ^ (x >>> 16), 2246822519);
    x = (x ^ (x >>> 13)) >>> 0;
    return (x / 4294967296) * 2 - 1;
}

function fadeTail(data, sampleRate) {
    const n = Math.min(data.length, Math.max(2, Math.floor(sampleRate * 0.0015)));
    for (let i = 0; i < n; i += 1) {
        data[data.length - 1 - i] *= i / n;
    }
}

function synth(id, part, sampleRate) {
    const ms = KEY_VOICE_MS[id][part];
    const n = frameCount(ms, sampleRate);
    const data = new Float32Array(n);
    const salt = (KEY_VOICES.findIndex((item) => item.id === id) + 1) * 17 + (part === 'up' ? 3 : 1);
    let low = 0;
    let bright = 0;
    let phase = 0;
    let phaseB = 0;
    let phaseC = 0;
    for (let i = 0; i < n; i += 1) {
        const t = i / sampleRate;
        const u = n === 1 ? 0 : i / (n - 1);
        const white = noiseAt(i, salt);
        low += 0.08 * (white - low);
        bright += 0.58 * (white - bright);
        let sample = 0;
        if (id === 'munggeul') {
            const freq = part === 'down' ? 178 : 132;
            phase += (2 * Math.PI * freq) / sampleRate;
            const env = Math.exp(-t * (part === 'down' ? 88 : 120));
            const attack = Math.min(1, t / 0.0022);
            const pop = Math.exp(-t * 240) * low * (part === 'down' ? 0.42 : 0.2);
            sample = attack * env * (Math.sin(phase) * 0.7 + low * 0.12) + pop;
        } else if (id === 'mongdol') {
            const freq = part === 'down' ? 104 : 82;
            phase += (2 * Math.PI * freq) / sampleRate;
            phaseB += (2 * Math.PI * freq * 2.02) / sampleRate;
            const env = Math.exp(-t * (part === 'down' ? 36 : 48));
            const attack = Math.min(1, t / 0.0014);
            const knock = Math.exp(-t * 170) * Math.sin(2 * Math.PI * (part === 'down' ? 390 : 250) * t);
            sample = attack * env * (Math.sin(phase) * 0.78 + Math.sin(phaseB) * 0.12 + knock * (part === 'down' ? 0.7 : 0.28));
        } else if (id === 'linear') {
            const attack = Math.min(1, t / 0.0024);
            const env = attack * Math.exp(-t * (part === 'down' ? 125 : 180));
            phase += (2 * Math.PI * (part === 'down' ? 236 : 280)) / sampleRate;
            phaseB += (2 * Math.PI * (part === 'down' ? 2140 : 2680)) / sampleRate;
            const tick = Math.exp(-t * 380) * Math.sin(phaseB) * (part === 'down' ? 0.22 : 0.34);
            sample = env * (bright * 0.3 + Math.sin(phase) * 0.24) + tick * attack;
        } else if (id === 'tactile') {
            phase += (2 * Math.PI * (part === 'down' ? 168 : 190)) / sampleRate;
            const body = Math.sin(phase) * 0.28 * Math.exp(-t * 32);
            const air = low * 0.12 * Math.exp(-t * 70);
            let bump = 0;
            if (part === 'down') {
                const center = 0.009;
                const width = 0.00215;
                const gate = Math.exp(-((t - center) ** 2) / (2 * width * width));
                phaseB += (2 * Math.PI * 940) / sampleRate;
                bump = gate * (Math.sin(phaseB) * 0.72 + white * 0.4);
            } else {
                bump = Math.exp(-t * 210) * white * 0.18;
            }
            sample = body + air + bump;
        } else if (id === 'click') {
            const freq = part === 'down' ? 3680 : 2860;
            phase += (2 * Math.PI * freq) / sampleRate;
            const click = Math.exp(-t * (part === 'down' ? 620 : 740)) * (Math.sin(phase) * 0.82 + white * 0.5);
            phaseB += (2 * Math.PI * 210) / sampleRate;
            const body = Math.sin(phaseB) * 0.16 * Math.exp(-t * 48);
            let tick = 0;
            if (part === 'down' && t > 0.006) {
                phaseC += (2 * Math.PI * 2480) / sampleRate;
                tick = Math.exp(-(t - 0.006) * 780) * Math.sin(phaseC) * 0.26;
            }
            sample = click + body + tick;
        } else {
            const start = part === 'down' ? 1720 : 980;
            const drop = part === 'down' ? 1180 : 620;
            const freq = start - drop * u;
            phase += (2 * Math.PI * freq) / sampleRate;
            const env = Math.sin(Math.PI * Math.min(1, Math.max(0, u))) ** 1.05;
            sample = env * (Math.sin(phase) * 0.36 + bright * 0.28);
        }
        data[i] = sample;
    }
    return data;
}

/** 누름을 기준으로 크기를 맞추고, 뗌은 그보다 작게 둡니다. */
export function renderKeyPair(voice, sampleRate = 48000) {
    const id = normalizeKeyVoice(voice);
    const rate = sampleRate > 0 ? sampleRate : 48000;
    const down = synth(id, 'down', rate);
    const up = synth(id, 'up', rate);
    for (let i = 0; i < up.length; i += 1) up[i] *= 0.62;
    fadeTail(down, rate);
    fadeTail(up, rate);
    let peak = 0;
    for (let i = 0; i < down.length; i += 1) peak = Math.max(peak, Math.abs(down[i]));
    const scale = peak > 0.00001 ? 0.9 / peak : 1;
    for (let i = 0; i < down.length; i += 1) down[i] *= scale;
    for (let i = 0; i < up.length; i += 1) up[i] *= scale;
    return { id, down, up };
}

function buffersFor(audio, voice) {
    const key = `${voice}:${audio.sampleRate}`;
    let hit = pairCache.get(key);
    if (!hit) {
        const pair = renderKeyPair(voice, audio.sampleRate);
        const pack = (samples) => {
            const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
            buffer.getChannelData(0).set(samples);
            return buffer;
        };
        hit = { down: pack(pair.down), up: pack(pair.up) };
        pairCache.set(key, hit);
    }
    return hit;
}

function stopActive() {
    const sources = active;
    active = [];
    for (const src of sources) {
        try { src.stop(); } catch { /* 이미 끝난 소리입니다. */ }
    }
}

function launch(audio, voice, volume, events) {
    stopActive();
    const buffers = buffersFor(audio, voice);
    const now = audio.currentTime || 0;
    const gainValue = keyVolumeGain(volume);
    active = events.map((event) => {
        const src = audio.createBufferSource();
        const gain = audio.createGain();
        src.buffer = buffers[event.part] || buffers.down;
        src.playbackRate.value = event.rate;
        gain.gain.value = gainValue;
        src.connect(gain);
        gain.connect(audio.destination);
        src.start(now + event.at);
        return src;
    });
}

function withAudio(fn) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;
    const mine = ++token;
    try {
        if (!ctx) ctx = new AudioCtx();
        const run = () => {
            if (mine !== token || muted) return;
            fn(ctx);
        };
        if (ctx.state === 'running') run();
        else ctx.resume().then(run).catch(() => {});
    } catch {
        /* 소리를 못 내도 누른 일은 진행됩니다. */
    }
}

export function previewKeyVoice(id) {
    if (muted) return;
    armed = false;
    const voice = normalizeKeyVoice(id || keyVoiceId());
    const volume = keyVolumeId();
    withAudio((audio) => {
        launch(audio, voice, volume, [
            { part: 'down', at: 0, rate: keyPitchRate() },
            { part: 'up', at: 0.07, rate: keyPitchRate() },
        ]);
    });
}

export function playKey(part = 'down') {
    if (muted) return;
    const phase = part === 'up' ? 'up' : 'down';
    if (phase === 'up') {
        if (!armed) return;
        armed = false;
        if (!keySoundEnabled()) return;
        const voice = keyVoiceId();
        const volume = keyVolumeId();
        withAudio((audio) => {
            launch(audio, voice, volume, [{ part: 'up', at: 0, rate: keyPitchRate() }]);
        });
        return;
    }
    const sound = keySoundEnabled();
    const vibe = keyVibeEnabled();
    if (!sound && !vibe) {
        armed = false;
        return;
    }
    if (vibe && typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        try { navigator.vibrate(8); } catch { /* 진동이 없어도 누르기는 됩니다. */ }
    }
    if (!sound) {
        armed = false;
        return;
    }
    armed = true;
    const voice = keyVoiceId();
    const volume = keyVolumeId();
    withAudio((audio) => {
        launch(audio, voice, volume, [{ part: 'down', at: 0, rate: keyPitchRate() }]);
    });
}
