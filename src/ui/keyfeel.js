/** 누르는 손맛. 소리는 이 자리에서 합성하고, 파일을 받지 않습니다.
    가져온 녹음이 없어서 따로 받을 라이선스는 없습니다.
    누름과 뗌은 다른 파형이고, 높이는 조금 흔들립니다.
    오디오 컨텍스트는 하나만 쓰고, 하드웨어 샘플레이트를 그대로 둡니다.
    연달은 누름은 이전 소리를 10ms 동안 줄인 뒤 끊습니다. 8ms보다 짧은 겹침은 바로 끊습니다. */

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

/** 시작·끝이 0이 아니면 버퍼를 붙이거나 끊을 때 클릭이 납니다. */
function fadeEdges(data, sampleRate) {
    const attack = Math.min(data.length, Math.max(2, Math.round(sampleRate * 0.00045)));
    const release = Math.min(data.length, Math.max(2, Math.round(sampleRate * 0.005)));
    for (let i = 0; i < attack; i += 1) data[i] *= i / attack;
    for (let i = 0; i < release; i += 1) data[data.length - 1 - i] *= i / release;
    data[0] = 0;
    data[data.length - 1] = 0;
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
    fadeEdges(down, rate);
    fadeEdges(up, rate);
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

let busCtx = null;
let busIn = null;

/** 목소리는 리미터로만 모읍니다. 목소리마다 게인을 더하지 않아 기본 크기는 그대로입니다. */
function masterBus(audio) {
    if (busCtx === audio && busIn) return busIn;
    busCtx = audio;
    busIn = audio.destination;
    if (typeof audio.createDynamicsCompressor !== 'function') return busIn;
    try {
        const comp = audio.createDynamicsCompressor();
        comp.threshold.value = -1.5;
        comp.knee.value = 0;
        comp.ratio.value = 20;
        comp.attack.value = 0.002;
        comp.release.value = 0.06;
        comp.connect(audio.destination);
        busIn = comp;
    } catch {
        busIn = audio.destination;
    }
    return busIn;
}

function releaseVoice(entry, audio, fadeSec) {
    const now = audio?.currentTime || 0;
    const param = entry.gain?.gain;
    const canRamp = fadeSec > 0 && param && typeof param.cancelScheduledValues === 'function' && typeof param.setValueAtTime === 'function' && typeof param.linearRampToValueAtTime === 'function';
    if (canRamp) {
        const current = Number.isFinite(param.value) ? param.value : 0;
        try {
            param.cancelScheduledValues(now);
            param.setValueAtTime(current, now);
            param.linearRampToValueAtTime(0, now + fadeSec);
        } catch {
            /* 램프가 없어도 아래에서 끊습니다. */
        }
        try { entry.src.stop(now + fadeSec + 0.004); } catch { /* 이미 끝난 소리입니다. */ }
    } else {
        try { if (param) param.value = 0; } catch { /* 무시 */ }
        try { entry.src.stop(); } catch { /* 이미 끝난 소리입니다. */ }
    }
    entry.fading = true;
}

function stopActive() {
    const audio = ctx;
    const voices = active;
    active = [];
    for (const entry of voices) releaseVoice(entry, audio, 0);
}

function launch(audio, voice, volume, events) {
    const now = audio.currentTime || 0;
    for (const entry of active) {
        if (entry.fading) continue;
        const age = now - (entry.startedAt || 0);
        releaseVoice(entry, audio, age < 0.008 ? 0 : 0.01);
    }
    const fading = active.filter((entry) => entry.fading && !entry.dropped);
    if (fading.length > 2) {
        for (const entry of fading.slice(0, fading.length - 2)) {
            try { entry.src.stop(); } catch { /* 이미 끝난 소리입니다. */ }
            entry.dropped = true;
        }
    }
    const buffers = buffersFor(audio, voice);
    const gainValue = keyVolumeGain(volume);
    const dest = masterBus(audio);
    const created = events.map((event) => {
        const src = audio.createBufferSource();
        const gain = audio.createGain();
        src.buffer = buffers[event.part] || buffers.down;
        src.playbackRate.value = event.rate;
        gain.gain.value = gainValue;
        src.connect(gain);
        gain.connect(dest);
        const at = now + event.at;
        src.start(at);
        return { src, gain, startedAt: at, fading: false, dropped: false };
    });
    active = [...active.filter((entry) => entry.fading && !entry.dropped), ...created].slice(-6);
}

function sharedContext() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    if (ctx && ctx.state === 'closed') {
        ctx = null;
        busCtx = null;
        busIn = null;
        pairCache.clear();
    }
    if (!ctx) {
        try { ctx = new AudioCtx({ latencyHint: 'interactive' }); }
        catch { ctx = new AudioCtx(); }
    }
    return ctx;
}

function withAudio(fn) {
    const audio = sharedContext();
    if (!audio) return;
    const mine = ++token;
    const run = () => {
        if (mine !== token || muted || audio.state !== 'running') return;
        fn(audio);
    };
    try {
        if (audio.state === 'running') run();
        else audio.resume().then(run).catch(() => {});
    } catch {
        /* 소리를 못 내도 누른 일은 진행됩니다. */
    }
}

/** 아이폰은 첫 터치·첫 키 안에 컨텍스트를 만들어야 이후 글자 소리가 납니다. */
export function unlockKeyAudio() {
    const audio = sharedContext();
    if (!audio) return null;
    if (audio.state !== 'running') {
        try {
            const pending = audio.resume();
            if (pending && typeof pending.catch === 'function') pending.catch(() => {});
        } catch {
            /* 아직 잠겨 있으면 다음 누름에서 다시 엽니다. */
        }
    }
    return audio;
}

/** 글자 소리는 버튼 소리의 토큰에 끊기지 않게 따로 켭니다. 받아쓰기 중 음소거는 같이 봅니다. */
export function withKeyAudio(fn) {
    const audio = sharedContext();
    if (!audio || muted) return;
    const run = () => {
        if (muted || audio.state !== 'running') return;
        try { fn(audio); } catch { /* 소리 없이 지나갑니다. */ }
    };
    try {
        if (audio.state === 'running') run();
        else {
            const pending = audio.resume();
            if (pending && typeof pending.then === 'function') pending.then(run).catch(() => {});
        }
    } catch {
        /* 소리를 못 내도 글은 적힙니다. */
    }
}

/** 연타를 샘플로 섞어 피크를 잽니다. 직전 소리만 페이드하고 그 앞은 끊습니다. */
export function mixKeyBurst({ voice = 'click', volume = 'loud', count = 8, gapMs = 15, fadeMs = 10, sampleRate = 48000 } = {}) {
    const pair = renderKeyPair(voice, sampleRate);
    const gain = keyVolumeGain(volume);
    const gap = Math.max(0, Math.round((sampleRate * gapMs) / 1000));
    const fade = Math.max(1, Math.round((sampleRate * fadeMs) / 1000));
    const tail = pair.down.length + fade + 8;
    const length = Math.max(tail, gap * Math.max(0, count - 1) + tail);
    const mix = new Float32Array(length);
    for (let n = 0; n < count; n += 1) {
        const start = n * gap;
        for (let i = 0; i < pair.down.length; i += 1) {
            const at = start + i;
            if (at >= length) break;
            let env = 1;
            const newer = n + 1;
            if (newer < count) {
                const cut = newer * gap;
                if (at >= cut) {
                    const into = at - cut;
                    const nextCut = newer + 1 < count ? (newer + 1) * gap : length;
                    if (nextCut - cut < Math.round(sampleRate * 0.008)) env = 0;
                    else env = into >= fade ? 0 : 1 - into / fade;
                }
            }
            mix[at] += pair.down[i] * gain * env;
        }
    }
    let peak = 0;
    for (let i = 0; i < mix.length; i += 1) peak = Math.max(peak, Math.abs(mix[i]));
    return { peak, voices: count, gapMs, fadeMs, sampleRate, voice, volume };
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
