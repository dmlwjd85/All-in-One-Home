/** 글자를 적을 때 나는 짧은 소리. 네 가지 모두 이 자리에서 합성합니다.
    녹음 파일을 받지 않았고, 따로 받을 라이선스도 없습니다.
    출처는 docs/type-sounds.md 에 적어 두었습니다.
    크기는 교실에 맞게 작게 고정합니다. 연타는 앞 소리를 끊지 않고 바로 겹칩니다. */

import { unlockKeyAudio, withKeyAudio } from './keyfeel.js';

const SOUND_KEY = 'ssug-gyomu-type-sound';
const VOICE_KEY = 'ssug-gyomu-type-voice';

export const TYPE_VOICES = [
    { id: 'ppok', label: '뽁', hint: '통통' },
    { id: 'ting', label: '띵', hint: '실로폰' },
    { id: 'drop', label: '물방울', hint: '또록' },
    { id: 'bang', label: '방귀', hint: '뿌우', playful: true },
];

/** 목록 순서를 바꿔도 소리 결이 달라지지 않게, 처음 만들 때의 잡음 씨앗을 고정합니다. */
const TYPE_NOISE = { bang: 57, ppok: 76, ting: 95, drop: 114 };

export const TYPE_VOICE_MS = {
    bang: 110,
    ppok: 46,
    ting: 92,
    drop: 156,
};

/** 버튼 소리의 '작게'보다 낮게 둡니다. 겹쳐도 과하지 않게. */
export const TYPE_GAIN = 0.032;

const DEFAULT_VOICE = 'ppok';
const SAME_TURN_MS = 12;
const MAX_LIVE = 10;

let lastInputAt = -1000;
const cache = new Map();
let live = [];

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

export function normalizeTypeVoice(id) {
    return TYPE_VOICES.some((item) => item.id === id) ? id : DEFAULT_VOICE;
}

export function typeSoundEnabled(storage) {
    try {
        return readStore(storage)?.getItem?.(SOUND_KEY) === '1';
    } catch {
        return false;
    }
}

export function typeVoiceId(storage) {
    try {
        return normalizeTypeVoice(readStore(storage)?.getItem?.(VOICE_KEY));
    } catch {
        return DEFAULT_VOICE;
    }
}

export function setTypeSound(on, storage) {
    try {
        readStore(storage)?.setItem?.(SOUND_KEY, on ? '1' : '0');
    } catch {
        /* 저장이 막혀도 이번 화면의 선택은 유지합니다. */
    }
    return Boolean(on);
}

export function setTypeVoice(id, storage) {
    const voice = normalizeTypeVoice(id);
    try {
        readStore(storage)?.setItem?.(VOICE_KEY, voice);
    } catch {
        /* 저장이 막혀도 미리듣기는 고른 소리로 납니다. */
    }
    return voice;
}

function attr(el, name) {
    if (!el) return '';
    try {
        if (typeof el.getAttribute === 'function') return el.getAttribute(name) || '';
    } catch {
        /* 가짜 요소는 속성 가방만 봅니다. */
    }
    const value = el[name];
    return value == null ? '' : String(value);
}

function hasAttr(el, name) {
    if (!el) return false;
    if (typeof el.hasAttribute === 'function') return el.hasAttribute(name);
    return Object.prototype.hasOwnProperty.call(el, name);
}

export function isTextControl(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable) return true;
    const tag = String(el.tagName).toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    const type = attr(el, 'type').toLowerCase();
    return ['', 'text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(type);
}

/** 비밀번호와 카드 번호처럼 소리로 길이가 드러나면 곤란한 칸. */
export function isSensitiveControl(el) {
    if (!el || !el.tagName) return false;
    const tag = String(el.tagName).toUpperCase();
    if (tag === 'INPUT') {
        const type = attr(el, 'type').toLowerCase();
        if (type === 'password' || type === 'hidden') return true;
    }
    if (hasAttr(el, 'data-sensitive')) return true;
    const blob = [
        attr(el, 'autocomplete'),
        attr(el, 'aria-label'),
        attr(el, 'name'),
        attr(el, 'placeholder'),
        attr(el, 'id'),
    ].join(' ');
    return /password|cc-number|cc-csc|current-password|new-password|one-time-code|\botp\b|비밀번호|암호|패스워드|인증/i.test(blob);
}

/** 조합이 끝날 때 브라우저가 같은 글자를 한 번 더 알려 줍니다. 타수로 치지 않습니다.
    Chromium은 compositionend보다 먼저 insertCompositionText(isComposing true)를 보냅니다.
    같은 문자열이면 바로 버리고, 이번 턴에 조합이 끝나면 소리를 미뤄 뒀다가 내지 않습니다.
    Safari는 compositionend 다음에 isComposing이 false인 input을 보냅니다. */
let lastCompositionData = null;
let skipCompositionEcho = false;
let heldStroke = false;
let dropHeld = false;

export function noteCompositionStart() {
    lastCompositionData = null;
    skipCompositionEcho = false;
    heldStroke = false;
    dropHeld = false;
}

export function noteCompositionEnd() {
    skipCompositionEcho = true;
    if (heldStroke) dropHeld = true;
}

function compositionEcho(event) {
    const inputType = String(event?.inputType || '');
    if (inputType === 'insertFromComposition') {
        skipCompositionEcho = false;
        return true;
    }
    if (inputType === 'insertCompositionText' && typeof event?.data === 'string') {
        if (event.data === lastCompositionData) {
            skipCompositionEcho = false;
            return true;
        }
        if (event.isComposing !== false) lastCompositionData = event.data;
    }
    if (!skipCompositionEcho) return false;
    skipCompositionEcho = false;
    if (inputType === 'insertText' || event?.isComposing === true) return false;
    return true;
}

const SKIP_INPUT = new Set([
    'insertFromPaste',
    'insertFromDrop',
    'insertFromYank',
    'insertReplacementText',
    'insertFromPasteAsQuotation',
]);

export function shouldTypeSound(event) {
    const el = event?.target;
    if (!isTextControl(el) || isSensitiveControl(el)) return false;
    const inputType = String(event?.inputType || '');
    if (inputType.startsWith('delete') || inputType.startsWith('format') || inputType.startsWith('history')) return false;
    if (SKIP_INPUT.has(inputType)) return false;
    if (inputType && inputType !== 'insertText' && inputType !== 'insertCompositionText' && inputType !== 'insertFromComposition') return false;
    if (compositionEcho(event)) return false;
    return true;
}

/** 조합 중 입력은 턴이 끝난 뒤에 소리를 정합니다. compositionend가 먼저 오면 그 입력은 타가 아닙니다. */
export function planTypeSound(event) {
    if (!shouldTypeSound(event)) return 'no';
    const inputType = String(event?.inputType || '');
    if (inputType === 'insertCompositionText' && event?.isComposing !== false) {
        heldStroke = true;
        dropHeld = false;
        return 'later';
    }
    return 'now';
}

export function finishTypeSoundTurn() {
    if (!heldStroke) return false;
    heldStroke = false;
    const drop = dropHeld;
    dropHeld = false;
    return !drop;
}

/** 같은 순간 두 번 오는 조합 이벤트만 건너뜁니다. 다음 글자는 바로 울립니다. */
export function noteTypeInput(event, now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    if (!typeSoundEnabled()) return false;
    if (now - lastInputAt < SAME_TURN_MS) return false;
    const plan = planTypeSound(event);
    if (plan === 'no') return false;
    lastInputAt = now;
    return plan === 'later' ? 'later' : true;
}

function noiseAt(i, salt) {
    let x = Math.imul(i + salt * 997 + 1, 1103515245) + 12345;
    x = Math.imul(x ^ (x >>> 16), 2246822519);
    x = (x ^ (x >>> 13)) >>> 0;
    return (x / 4294967296) * 2 - 1;
}

function fadeEdges(data, sampleRate) {
    const attack = Math.min(data.length, Math.max(2, Math.round(sampleRate * 0.0012)));
    const release = Math.min(data.length, Math.max(2, Math.round(sampleRate * 0.01)));
    for (let i = 0; i < attack; i += 1) data[i] *= i / attack;
    for (let i = 0; i < release; i += 1) data[data.length - 1 - i] *= i / release;
    data[0] = 0;
    data[data.length - 1] = 0;
}

function finish(data, sampleRate) {
    fadeEdges(data, sampleRate);
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    const scale = peak > 0.00001 ? 0.9 / peak : 1;
    for (let i = 0; i < data.length; i += 1) data[i] *= scale;
    data[0] = 0;
    data[data.length - 1] = 0;
    return data;
}

function synth(id, sampleRate) {
    const ms = TYPE_VOICE_MS[id] || TYPE_VOICE_MS[DEFAULT_VOICE];
    const n = Math.max(8, Math.round((sampleRate * ms) / 1000));
    const data = new Float32Array(n);
    const salt = TYPE_NOISE[id] || 57;
    let low = 0;
    let phase = 0;
    let phaseB = 0;
    let phaseC = 0;
    let flutter = 0;
    for (let i = 0; i < n; i += 1) {
        const t = i / sampleRate;
        const u = n === 1 ? 0 : i / (n - 1);
        const white = noiseAt(i, salt);
        low += 0.16 * (white - low);
        let sample = 0;
        if (id === 'bang') {
            flutter += (2 * Math.PI * 13.5) / sampleRate;
            const wobble = Math.sin(flutter);
            const env = (Math.sin(Math.PI * Math.min(1, u)) ** 0.55) * (0.62 + 0.38 * wobble);
            const freq = 118 - 62 * u + 16 * wobble;
            phase += (2 * Math.PI * freq) / sampleRate;
            sample = env * (Math.sin(phase) * 0.28 + low * 0.92);
        } else if (id === 'ppok') {
            const freq = 720 - 480 * Math.min(1, u * 1.4);
            phase += (2 * Math.PI * freq) / sampleRate;
            const env = Math.exp(-t * 62) * Math.min(1, t / 0.0015);
            const tick = Math.exp(-t * 280) * white * 0.35;
            sample = env * Math.sin(phase) * 0.85 + tick;
        } else if (id === 'ting') {
            const freq = 932 * (1 - 0.04 * u);
            phase += (2 * Math.PI * freq) / sampleRate;
            phaseB += (2 * Math.PI * freq * 2.71) / sampleRate;
            const env = Math.exp(-t * 28) * Math.min(1, t / 0.001);
            const mallet = Math.exp(-t * 220) * white * 0.18;
            sample = env * (Math.sin(phase) * 0.72 + Math.sin(phaseB) * 0.22) + mallet;
        } else {
            const first = t < 0.07 ? t : -1;
            const second = t >= 0.072 ? t - 0.072 : -1;
            const drip = (dt, base, amp) => {
                if (dt < 0) return 0;
                const freq = base * Math.exp(-dt * 14);
                return { freq, amp: amp * Math.exp(-dt * 22) * Math.min(1, dt / 0.0012) };
            };
            const a = drip(first, 1680, 0.85);
            const b = drip(second, 1240, 0.45);
            if (a) {
                phase += (2 * Math.PI * a.freq) / sampleRate;
                sample += Math.sin(phase) * a.amp;
            }
            if (b) {
                phaseC += (2 * Math.PI * b.freq) / sampleRate;
                sample += Math.sin(phaseC) * b.amp;
            }
            sample += Math.exp(-t * 90) * low * 0.08;
        }
        data[i] = sample;
    }
    return finish(data, sampleRate);
}

export function renderTypeVoice(voice, sampleRate = 48000) {
    const id = normalizeTypeVoice(voice);
    const rate = sampleRate > 0 ? sampleRate : 48000;
    return { id, samples: synth(id, rate) };
}

function bufferFor(audio, voice) {
    const id = normalizeTypeVoice(voice);
    const key = `${id}:${audio.sampleRate}`;
    let hit = cache.get(key);
    if (!hit) {
        const rendered = renderTypeVoice(id, audio.sampleRate);
        const buffer = audio.createBuffer(1, rendered.samples.length, audio.sampleRate);
        buffer.getChannelData(0).set(rendered.samples);
        hit = buffer;
        cache.set(key, hit);
    }
    return hit;
}

function releaseNode(entry) {
    if (!entry || entry.released) return;
    entry.released = true;
    entry.done = true;
    try { entry.src?.disconnect?.(); } catch { /* 이미 끊긴 소리입니다. */ }
    try { entry.gain?.disconnect?.(); } catch { /* 이미 끊긴 소리입니다. */ }
}

function dropFinished(audio) {
    const now = audio.currentTime || 0;
    const keep = [];
    for (const entry of live) {
        if (entry.done || now >= (entry.until || 0) + 0.05) releaseNode(entry);
        else keep.push(entry);
    }
    live = keep;
}

function launch(audio, voice) {
    dropFinished(audio);
    if (live.length >= MAX_LIVE) {
        const oldest = live[0];
        const now = audio.currentTime || 0;
        const gain = oldest?.gain?.gain;
        if (gain && typeof gain.setValueAtTime === 'function' && typeof gain.linearRampToValueAtTime === 'function') {
            try {
                const current = Number.isFinite(gain.value) ? gain.value : TYPE_GAIN;
                gain.setValueAtTime(current, now);
                gain.linearRampToValueAtTime(0, now + 0.02);
            } catch {
                /* 램프가 없어도 새 소리는 바로 냅니다. */
            }
        }
        try { oldest?.src?.stop?.(now + 0.03); } catch { /* 이미 끝난 소리입니다. */ }
        oldest.done = true;
        live = live.slice(1);
    }
    const src = audio.createBufferSource();
    const gain = audio.createGain();
    src.buffer = bufferFor(audio, voice);
    const roll = Math.random();
    src.playbackRate.value = 0.97 + (Number.isFinite(roll) ? roll : 0.5) * 0.06;
    gain.gain.value = TYPE_GAIN;
    src.connect(gain);
    gain.connect(audio.destination);
    const at = audio.currentTime || 0;
    src.start(at);
    const seconds = (src.buffer?.duration) || (TYPE_VOICE_MS[normalizeTypeVoice(voice)] / 1000);
    const entry = { src, gain, until: at + seconds, done: false, released: false };
    src.onended = () => releaseNode(entry);
    live.push(entry);
}

export function previewTypeVoice(id) {
    unlockKeyAudio();
    const voice = normalizeTypeVoice(id || typeVoiceId());
    withKeyAudio((audio) => launch(audio, voice));
}

export function playTypeSound() {
    if (!typeSoundEnabled()) return;
    unlockKeyAudio();
    const voice = typeVoiceId();
    withKeyAudio((audio) => launch(audio, voice));
}
