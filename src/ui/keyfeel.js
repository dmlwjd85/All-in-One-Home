/** 누르는 손맛. 소리는 이 자리에서 합성하고, 파일을 받지 않습니다.
    가져온 녹음이 없어서 따로 받을 라이선스는 없습니다.
    누름과 뗌은 다른 파형이고, 높이는 조금 흔들립니다.
    오디오 컨텍스트는 하나만 쓰고, 하드웨어 샘플레이트를 그대로 둡니다.
    연달은 누름은 이전 소리를 4ms 동안 줄인 뒤 끊습니다. 바로 끊지 않아 지지직 소리가 나지 않습니다.
    글자 소리에서 옮겨 온 소리(뽁·띵·물방울·방귀 등)는 typesound의 합성을 그대로 쓰고, 한 가지 소리라 누를 때만 냅니다. */

import { TYPE_FADE_IN_SEC, TYPE_VOICES, isSensitiveControl, isTextControl, normalizeTypeVoice, renderTypeStroke, typeOutput, typePitchRate, typeStrokeGain } from './typesound.js';
/* 키보드 테마 소리(kb-…)는 파일이라 kbsound.js가 받고 고릅니다. 여기서는 아래 몇 줄로만 이어 붙입니다. */
import { KB_VOICE_GAIN, isKbVoice, kbBuffers, kbVoiceLoaded, loadKbVoice } from './kbsound.js';

export { KB_VOICES, KB_VOICE_GAIN, isKbVoice, kbVoiceLoaded, loadKbVoice, pickVariant } from './kbsound.js';

const SOUND_KEY = 'ssug-gyomu-key-sound';
const VIBE_KEY = 'ssug-gyomu-key-vibrate';
const VOICE_KEY = 'ssug-gyomu-key-voice';
const VOLUME_KEY = 'ssug-gyomu-key-volume';
const NOTICE_KEY = 'ssug-gyomu-key-sound-notice';
/** 글자 소리 종류. 누를 때 소리 종류가 아직 없을 때 처음 값으로 한 번만 가져옵니다. 원래 값은 그대로 둡니다. */
const TYPE_VOICE_KEY = 'ssug-gyomu-type-voice';
const TYPE_SOUND_KEY = 'ssug-gyomu-type-sound';
/** 글자 소리를 누를 때 소리로 옮긴 기기에만 남는 값. 옮긴 소리 id를 적고, 안내를 닫으면 'closed'가 됩니다. */
const MOVED_KEY = 'ssug-gyomu-key-voice-moved';
const MOVED_CLOSED = 'closed';

/** 버튼·탭·토글·체크 칸·고르기 칸·펼치기와 하단 키캡 버튼. 글 입력칸은 넣지 않습니다. */
export const PRESS_SELECTOR = 'button, a, label.chip, [role="button"], [role="tab"], [role="switch"], [role="menuitem"], input[type="checkbox"], input[type="radio"], select, summary, .fab, .desk-fab';
/** 동시에 나는 소리는 여섯 개까지입니다. 새 소리가 오면 앞 소리를 이만큼 줄이며 끊습니다. */
export const MAX_KEY_VOICES = 6;
export const KEY_FADE_SEC = 0.004;

export const KEY_VOICES = [
    { id: 'munggeul', label: '몽글', hint: '말랑' },
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

/** 글자 소리에서 옮겨 온 소리인지. 목록은 부를 때 읽어 서로 가져오는 순서에 기대지 않습니다. */
export function isTypePressVoice(id) {
    return TYPE_VOICES.some((item) => item.id === id);
}

export function normalizeKeyVoice(id) {
    return KEY_VOICES.some((item) => item.id === id) || isTypePressVoice(id) || isKbVoice(id) ? id : DEFAULT_VOICE;
}

/** 누를 때 소리를 낼 요소. 꺼진 버튼, 민감한 칸, 글 입력칸은 소리 없이 지나갑니다. */
const FIELD_TAGS = ['INPUT', 'SELECT', 'TEXTAREA'];
/** 비밀번호·인증번호 같은 칸. 버튼 이름에 '인증'이 들어가도 버튼은 그대로 소리를 냅니다. data-sensitive 는 pressOff 가 자기·바깥까지 봅니다. */
function sensitiveField(el) {
    return FIELD_TAGS.includes(String(el?.tagName || '').toUpperCase()) && isSensitiveControl(el);
}

/** fieldset의 첫 legend. 자식 목록을 못 읽으면 undefined(첫 legend로 봅니다)입니다. */
function firstLegend(fieldset) {
    try {
        if (!fieldset.children) return undefined;
        return [...fieldset.children].find((kid) => String(kid.tagName).toUpperCase() === 'LEGEND') || null;
    } catch {
        return undefined;
    }
}

/** 꺼진 fieldset 안인지. HTML 규칙처럼 그 fieldset의 첫 legend 안은 켜져 있습니다. */
function offByFieldset(el) {
    let child = el;
    for (let node = el.parentElement; node; child = node, node = node.parentElement) {
        if (String(node.tagName).toUpperCase() !== 'FIELDSET' || !node.hasAttribute('disabled')) continue;
        const legend = firstLegend(node);
        const inLegend = String(child.tagName).toUpperCase() === 'LEGEND' && (legend === undefined || legend === child);
        if (!inLegend) return true;
    }
    return false;
}

/** 꺼진 칸(:disabled), 꺼진 fieldset 안(첫 legend 안은 빼고), aria-disabled, data-sensitive 안쪽은 조용합니다. */
function pressOff(el) {
    let off = false;
    try {
        off = Boolean(el.matches?.(':disabled'));
    } catch {
        off = false;
    }
    return off || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true'
        || offByFieldset(el) || Boolean(el.closest('[aria-disabled="true"]') || el.closest('[data-sensitive]'));
}

export function pressTarget(target) {
    if (!target || typeof target.closest !== 'function') return null;
    if (isTextControl(target) || sensitiveField(target) || target.closest('[data-sensitive]')) return null;
    const label = target.closest('label');
    const control = label && !label.matches(PRESS_SELECTOR) ? label.control : null;
    const el = target.closest(PRESS_SELECTOR) || (control?.matches?.(PRESS_SELECTOR) ? control : null);
    if (!el || pressOff(el)) return null;
    if (isTextControl(el) || sensitiveField(el)) return null;
    return el;
}

export function normalizeKeyVolume(id) {
    return KEY_VOLUMES.some((item) => item.id === id) ? id : DEFAULT_VOLUME;
}

export function keyVoiceId(storage) {
    try {
        const store = readStore(storage);
        let value = store?.getItem?.(VOICE_KEY);
        if (value == null && store?.getItem?.(TYPE_SOUND_KEY) === '1') {
            /* main은 종류를 고르지 않았거나 모르는 값이면 뽁을 냈습니다. 그때 듣던 소리를 그대로 옮깁니다. */
            const heard = normalizeTypeVoice(store.getItem(TYPE_VOICE_KEY));
            if (isTypePressVoice(heard)) {
                store.setItem(VOICE_KEY, heard);
                store.setItem(MOVED_KEY, heard);
                value = heard;
            }
        }
        return normalizeKeyVoice(value);
    } catch {
        return DEFAULT_VOICE;
    }
}

/** 글자 소리에서 옮겨 온 소리 id. 실제로 옮긴 기기에서 안내를 닫기 전까지만 돌려주고, 아니면 null 입니다. */
export function keyVoiceMoved(storage) {
    try {
        const store = readStore(storage);
        if (store?.getItem?.(VOICE_KEY) == null) keyVoiceId(store);
        const moved = store?.getItem?.(MOVED_KEY);
        return moved && moved !== MOVED_CLOSED && isTypePressVoice(moved) ? moved : null;
    } catch {
        return null;
    }
}

/** 옮김 안내를 닫습니다. 다시 열어도 나오지 않습니다. */
export function closeKeyVoiceMoved(storage) {
    try {
        const store = readStore(storage);
        if (store?.getItem?.(MOVED_KEY) == null) return false;
        store.setItem(MOVED_KEY, MOVED_CLOSED);
        return true;
    } catch {
        return false;
    } finally {
        emitPrefs();
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

/** 글자 소리에서 옮겨 온 소리의 크기 배수. 작게는 예전 글자 소리와 같고, 크게는 다른 소리(약 3.6배)보다 조금 덜 키웁니다. */
export const TYPE_PRESS_STEPS = { small: 1, mid: 2, loud: 3 };

/** 소리마다 실제로 곱하는 크기. 옮겨 온 소리는 예전 글자 소리 크기(typeStrokeGain)를 기준으로 합니다. */
export function keyPressGain(voice, volume) {
    const id = normalizeKeyVoice(voice);
    if (isKbVoice(id)) return KB_VOICE_GAIN * TYPE_PRESS_STEPS[normalizeKeyVolume(volume)];
    if (!isTypePressVoice(id)) return keyVolumeGain(volume);
    return typeStrokeGain(id) * TYPE_PRESS_STEPS[normalizeKeyVolume(volume)];
}

/** 누름마다 음높이. 옮겨 온 소리는 main 글자 소리와 같은 흔들림(예전 네 소리 0.97–1.03, 나머지 0.96–1.08)을 씁니다. */
export function pressRate(voice, random = Math.random) {
    const id = normalizeKeyVoice(voice);
    return isTypePressVoice(id) ? typePitchRate(id, random()) : keyPitchRate(random);
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
    if (isTypePressVoice(id)) return { id, down: renderTypeStroke(id, 'tap', rate).samples, up: null };
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
    if (isKbVoice(voice)) return kbBuffers(voice, audio);
    const key = `${voice}:${audio.sampleRate}`;
    let hit = pairCache.get(key);
    if (!hit) {
        const pair = renderKeyPair(voice, audio.sampleRate);
        const pack = (samples) => {
            const buffer = audio.createBuffer(1, samples.length, audio.sampleRate);
            buffer.getChannelData(0).set(samples);
            return buffer;
        };
        hit = { down: pack(pair.down), up: pair.up ? pack(pair.up) : null };
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
        entry.endsAt = now + fadeSec;
    } else {
        try { if (param) param.value = 0; } catch { /* 무시 */ }
        try { entry.src.stop(); } catch { /* 이미 끝난 소리입니다. */ }
        entry.endsAt = now;
    }
    entry.fading = true;
}

function stopActive() {
    const audio = ctx;
    const voices = active;
    active = [];
    for (const entry of voices) releaseVoice(entry, audio, 0);
}

/** 새 누름이 올 때 앞 소리를 어떻게 줄일지 정합니다. 실제 재생과 연타 측정이 같은 규칙을 씁니다.
    앞 소리는 모두 4ms로 줄이고, 들리는 소리가 여섯 개를 넘으려 하면 가장 오래된 소리를 2ms로 줄입니다.
    2ms로 줄던 소리가 또 밀려나면(4ms 안에 여섯 번 넘게 누를 때) 그때만 바로 멈춥니다. */
export function planKeyPress(entries, now, count) {
    const fade = entries.filter((entry) => !entry.fading);
    const ends = (entry) => Math.min(entry.fading ? (entry.endsAt ?? 0) : now + KEY_FADE_SEC, entry.until ?? Infinity);
    const live = entries.filter((entry) => now < ends(entry));
    const tails = live.filter((entry) => entry.dropped);
    const rest = live.filter((entry) => !entry.dropped);
    const room = Math.max(0, MAX_KEY_VOICES - 1 - count);
    if (rest.length <= room) return { fade, drop: [], stop: [], keep: live };
    const over = rest.slice(0, rest.length - room);
    return { fade, drop: over.slice(-1), stop: [...tails, ...over.slice(0, -1)], keep: [...over.slice(-1), ...rest.slice(rest.length - room)] };
}

/** 옮겨 온 소리는 main 글자 소리처럼 2ms 동안 키우며 시작하고, 글자 소리와 같은 리미터(웨이브셰이퍼)를 거칩니다.
    다른 소리는 지금처럼 압축기 버스를 씁니다. */
function launch(audio, voice, volume, events, when) {
    const buffers = buffersFor(audio, voice);
    const parts = events.filter((event) => buffers[event.part]);
    if (!parts.length) return;
    const now = Number.isFinite(when) ? when : (audio.currentTime || 0);
    /* 키보드 테마 소리도 파일 소리라 옮겨 온 소리와 같은 2ms 시작·리미터를 씁니다. */
    const moved = isTypePressVoice(voice) || isKbVoice(voice);
    const plan = planKeyPress(active, now, parts.length);
    for (const entry of plan.fade) releaseVoice(entry, audio, KEY_FADE_SEC);
    for (const entry of plan.drop) {
        releaseVoice(entry, audio, 0.002);
        entry.dropped = true;
    }
    for (const entry of plan.stop) releaseVoice(entry, audio, 0);
    const gainValue = keyPressGain(voice, volume);
    const dest = moved ? typeOutput(audio) : masterBus(audio);
    const created = parts.map((event) => {
        const src = audio.createBufferSource();
        const gain = audio.createGain();
        src.buffer = buffers[event.part];
        src.playbackRate.value = event.rate;
        const at = now + event.at;
        const param = gain.gain;
        param.value = gainValue;
        if (moved && typeof param.setValueAtTime === 'function' && typeof param.linearRampToValueAtTime === 'function') {
            try {
                param.setValueAtTime(0, at);
                param.linearRampToValueAtTime(gainValue, at + TYPE_FADE_IN_SEC);
            } catch {
                param.value = gainValue;
            }
        }
        src.connect(gain);
        gain.connect(dest);
        src.start(at);
        const seconds = src.buffer?.length && src.buffer?.sampleRate ? src.buffer.length / src.buffer.sampleRate / (event.rate || 1) : Infinity;
        return { src, gain, startedAt: at, until: at + seconds, fading: false, dropped: false };
    });
    active = [...plan.keep, ...created];
}

/** 검사와 실측이 실제 재생과 같은 launch로 한 번 누름을 그립니다. OfflineAudioContext에도 씁니다. */
export function scheduleKeyPress(audio, { voice = 'munggeul', volume = 'small', part = 'down', when = 0 } = {}) {
    const id = normalizeKeyVoice(voice);
    launch(audio, id, normalizeKeyVolume(volume), [{ part: part === 'up' ? 'up' : 'down', at: 0, rate: pressRate(id) }], when);
}

export function resetKeyGraphForTest() {
    active = [];
    busCtx = null;
    busIn = null;
    pairCache.clear();
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
    try { if (navigator.audioSession) navigator.audioSession.type = 'ambient'; } catch { /* 무음 스위치를 그대로 둡니다. */ }
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

/** 연타를 샘플로 섞어 피크와 샘플 간 점프를 잽니다. 실제 재생과 같은 planKeyPress 규칙으로 앞 소리를 줄입니다. */
export function mixKeyBurst({ voice = 'click', volume = 'loud', count = 8, gapMs = 15, fadeMs = KEY_FADE_SEC * 1000, sampleRate = 48000, down = null } = {}) {
    const pair = down ? { down } : renderKeyPair(voice, sampleRate);
    const gain = keyPressGain(voice, volume);
    const gap = Math.max(0, Math.round((sampleRate * gapMs) / 1000));
    const fade = Math.max(1, Math.round((sampleRate * fadeMs) / 1000));
    const short = Math.max(1, Math.round(sampleRate * 0.002));
    const tail = pair.down.length + fade + 8;
    const length = Math.max(tail, gap * Math.max(0, count - 1) + tail);
    const valueAt = (entry, at) => {
        let value = 1;
        for (const ramp of entry.ramps) {
            if (at < ramp.from) break;
            value = ramp.to <= ramp.from ? 0 : Math.max(0, ramp.value * (1 - (at - ramp.from) / (ramp.to - ramp.from)));
        }
        return value;
    };
    const ramp = (entry, at, span) => {
        entry.ramps.push({ from: at, to: at + span, value: valueAt(entry, at) });
        entry.fading = true;
        entry.endsAt = (at + span) / sampleRate;
    };
    const voices = [];
    let live = [];
    for (let n = 0; n < count; n += 1) {
        const at = n * gap;
        const plan = planKeyPress(live, at / sampleRate, 1);
        for (const entry of plan.fade) ramp(entry, at, fade);
        for (const entry of plan.drop) {
            ramp(entry, at, short);
            entry.dropped = true;
        }
        for (const entry of plan.stop) ramp(entry, at, 0);
        const entry = { start: at, until: (at + pair.down.length) / sampleRate, ramps: [], fading: false, dropped: false };
        voices.push(entry);
        live = [...plan.keep, entry];
    }
    const mix = new Float32Array(length);
    const heard = new Uint8Array(length);
    let soloJump = 0;
    for (let i = 1; i < pair.down.length; i += 1) soloJump = Math.max(soloJump, Math.abs(pair.down[i] - pair.down[i - 1]) * gain);
    for (const entry of voices) {
        for (let i = 0; i < pair.down.length; i += 1) {
            const at = entry.start + i;
            if (at >= length) break;
            const env = valueAt(entry, at);
            if (env > 0) heard[at] += 1;
            mix[at] += pair.down[i] * gain * env;
        }
    }
    let peak = 0;
    let maxJump = 0;
    let maxVoices = 0;
    for (let i = 0; i < mix.length; i += 1) {
        peak = Math.max(peak, Math.abs(mix[i]));
        if (i > 0) maxJump = Math.max(maxJump, Math.abs(mix[i] - mix[i - 1]));
        maxVoices = Math.max(maxVoices, heard[i]);
    }
    return { peak, maxJump, soloJump, maxVoices, voices: count, gapMs, fadeMs, sampleRate, voice, volume };
}

export function previewKeyVoice(id) {
    if (muted) return;
    armed = false;
    const voice = normalizeKeyVoice(id || keyVoiceId());
    const volume = keyVolumeId();
    if (isKbVoice(voice) && !kbVoiceLoaded(voice)) {
        unlockKeyAudio();
        loadKbVoice(voice, ctx).then((ok) => { if (ok && !muted) previewKeyVoice(voice); });
        return;
    }
    withAudio((audio) => {
        launch(audio, voice, volume, [
            { part: 'down', at: 0, rate: pressRate(voice) },
            { part: 'up', at: 0.07, rate: pressRate(voice) },
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
            launch(audio, voice, volume, [{ part: 'up', at: 0, rate: pressRate(voice) }]);
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
    /* 테마 소리를 아직 받지 않았으면 이번 누름은 조용히 지나가고(뗌 소리도 없음) 받기만 시작합니다. */
    if (isKbVoice(voice) && !kbVoiceLoaded(voice)) { armed = false; loadKbVoice(voice, ctx); return; }
    withAudio((audio) => {
        launch(audio, voice, volume, [{ part: 'down', at: 0, rate: pressRate(voice) }]);
    });
}
