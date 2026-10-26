/** 글을 적을 때 나는 타건음. 축마다 이 자리에서 합성합니다.
    녹음 파일은 넣지 않았습니다. 누름과 뗌, 큰 키의 안정 막대는 따로 만듭니다.
    출처와 목표 스위치는 docs/type-sounds.md 에 적어 두었습니다.
    크기는 교실에 맞게 작게 두고, 빠른 연타는 오래된 소리부터 사그라지게 한 뒤 리미터를 통과합니다. */

import { unlockKeyAudio, withKeyAudio } from './keyfeel.js';

const SOUND_KEY = 'ssug-gyomu-type-sound';
const VOICE_KEY = 'ssug-gyomu-type-voice';

export const TYPE_VOICES = [
    { id: 'red', label: '빨간 직선', hint: '체리 적축' },
    { id: 'brown', label: '갈색 걸림', hint: '체리 갈축' },
    { id: 'blue', label: '파란 딸깍', hint: '체리 청축' },
    { id: 'black', label: '검은 묵직', hint: '체리 흑축' },
    { id: 'topre', label: '고무 컵', hint: '무접점' },
    { id: 'silent', label: '조용한 패드', hint: '저소음 적축' },
    { id: 'typewriter', label: '타자기', hint: '금속 막대' },
    { id: 'laptop', label: '노트북', hint: '짧은 돔' },
    { id: 'cream', label: '윤활 크림', hint: '크림 축' },
    { id: 'ink', label: '깊은 먹물', hint: '잉크 흑축' },
    { id: 'silver', label: '짧은 은색', hint: '스피드' },
    { id: 'boxnavy', label: '굵은 딸깍', hint: '박스 남색' },
    { id: 'panda', label: '또렷한 판다', hint: '홀리 판다' },
    { id: 'alpaca', label: '부드러운 긴 축', hint: '알파카' },
    { id: 'boba', label: '통통한 걸림', hint: '보바' },
    { id: 'zeal', label: '둥근 걸림', hint: '질로우' },
    { id: 'marsh', label: '마시멜로', hint: '말랑한 저소음' },
    { id: 'bang', label: '방귀', hint: '뿌우', playful: true },
];

/** 화면 이름과 따로, 소리를 맞춘 실제 스위치입니다. 방귀만 장난입니다. */
export const TYPE_TARGETS = {
    red: 'Cherry MX Red',
    brown: 'Cherry MX Brown',
    blue: 'Cherry MX Blue',
    black: 'Cherry MX Black',
    topre: 'Topre 45g',
    silent: 'Cherry MX Silent Red',
    typewriter: '버클링 스프링 타자기',
    laptop: '노트북 팬터그래프',
    cream: 'NovelKeys Cream',
    ink: 'Gateron Ink Black',
    silver: 'Cherry MX Speed Silver',
    boxnavy: 'Kailh Box Navy',
    panda: 'Drop Holy Panda',
    alpaca: 'JWK Alpaca',
    boba: 'Gazzew Boba U4T',
    zeal: 'Zealio V2',
    marsh: 'Gazzew Boba U4',
    bang: '장난',
};

/** 목록 순서를 바꿔도 잡음 결이 달라지지 않게 씨앗을 고정합니다. */
const TYPE_NOISE = {
    red: 11, brown: 23, blue: 37, black: 53, topre: 71, silent: 89, typewriter: 101, laptop: 113, cream: 127, bang: 57,
    ink: 131, silver: 149, boxnavy: 163, panda: 179, alpaca: 191, boba: 211, zeal: 227, marsh: 233,
};

export const TYPE_VOICE_MS = {
    red: 38,
    brown: 54,
    blue: 62,
    black: 76,
    topre: 98,
    silent: 26,
    typewriter: 88,
    laptop: 34,
    cream: 70,
    ink: 66,
    silver: 22,
    boxnavy: 50,
    panda: 74,
    alpaca: 46,
    boba: 80,
    zeal: 58,
    marsh: 42,
    bang: 118,
};

/** 버튼 소리의 '작게'보다 낮게 둡니다. 여러 소리가 겹쳐도 1을 넘기지 않게. */
export const TYPE_GAIN = 0.028;

const DEFAULT_VOICE = 'red';
const SAME_TURN_MS = 12;
const MAX_LIVE = 6;
const FADE_SEC = 0.016;

let lastInputAt = -1000;
let lastReleaseAt = -1000;
let pendingKey = '';
const cache = new Map();
let live = [];

function liveStorage() {
    try {
        const storage = globalThis?.localStorage;
        if (!storage || typeof storage.getItem !== 'function') return null;
        return storage;
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
    Chromium은 compositionupdate 다음에 insertCompositionText(isComposing true)를 보내고,
    그 리스너가 끝나면 마이크로태스크가 돈 뒤에야 compositionend가 옵니다.
    받침이 다음 글자로 넘어가면 새 조합의 input이 같은 키의 12ms 안에 들어와, 거름만 있으면 글자가 기록되지 않습니다.
    그래서 조합 글자는 compositionupdate에서 먼저 적습니다. 방금 바뀐 글자의 input만 타고, 같은 글자가 다시 오면 메아리입니다.
    Safari는 compositionend 다음에 isComposing이 false인 input을 보냅니다. */
let lastCompositionData = null;
let freshComposition = null;
let skipCompositionEcho = false;

export function noteCompositionUpdate(data) {
    if (typeof data !== 'string') return;
    if (data === lastCompositionData) {
        freshComposition = null;
        return;
    }
    lastCompositionData = data;
    freshComposition = data;
}

export function noteCompositionStart() {
    lastCompositionData = null;
    freshComposition = null;
    skipCompositionEcho = false;
}

export function noteCompositionEnd() {
    skipCompositionEcho = true;
}

function consumeFresh(data) {
    if (typeof data !== 'string' || data !== freshComposition) return false;
    freshComposition = null;
    lastCompositionData = data;
    return true;
}

function compositionEcho(event) {
    const inputType = String(event?.inputType || '');
    if (inputType === 'insertFromComposition') {
        skipCompositionEcho = false;
        return true;
    }
    if (inputType === 'insertCompositionText' && typeof event?.data === 'string') {
        if (consumeFresh(event.data)) {
            skipCompositionEcho = false;
            return false;
        }
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

function inputNow(now) {
    if (Number.isFinite(now)) return now;
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/** 12ms 안의 두 번째 알림은 소리만 건너뜁니다. 글자는 조합 갱신이 이미 기억해서, 확정 때 메아리로 알아봅니다. */
export function acceptTypeInput(event, now = inputNow()) {
    const at = inputNow(now);
    if (at - lastInputAt < SAME_TURN_MS) return false;
    if (!shouldTypeSound(event)) return false;
    lastInputAt = at;
    return true;
}

/** 같은 순간 두 번 오는 조합 이벤트만 건너뜁니다. 다음 글자는 바로 울립니다. */
export function noteTypeInput(event, now = inputNow()) {
    if (!typeSoundEnabled()) return false;
    const ok = acceptTypeInput(event, now);
    if (ok) pendingKey = String(event?.data || event?.key || '');
    return ok;
}

/** 스페이스·엔터·지우기는 글자 소리와 다른 타건입니다. 바로 뒤의 input은 같은 타로 봅니다. */
export function noteTypeKey(event, now = inputNow()) {
    if (!typeSoundEnabled()) return '';
    if (event?.repeat) return '';
    const key = event?.key;
    const kind = key === ' ' || key === 'Spacebar' ? 'space' : key === 'Enter' ? 'enter' : (key === 'Backspace' || key === 'Delete' ? 'delete' : (key === 'Shift' ? 'shift' : (key === 'Tab' ? 'tab' : '')));
    if (!kind) return '';
    const el = event?.target;
    if (!isTextControl(el) || isSensitiveControl(el)) return '';
    if (event.isComposing || event.keyCode === 229) return '';
    const at = inputNow(now);
    if (at - lastInputAt < SAME_TURN_MS) return '';
    lastInputAt = at;
    pendingKey = String(key || '');
    return kind;
}

/** 손을 뗄 때의 소리. 누름과 시계를 나누어, 짧은 탭의 뗌이 삼켜지지 않게 합니다. */
export function noteTypeRelease(event, now = inputNow()) {
    if (!typeSoundEnabled()) return '';
    if (event?.repeat) return '';
    const el = event?.target;
    if (!isTextControl(el) || isSensitiveControl(el)) return '';
    if (event.isComposing || event.keyCode === 229) return '';
    const key = event?.key;
    const kind = key === ' ' || key === 'Spacebar' ? 'space-up' : key === 'Enter' ? 'enter-up' : (key === 'Backspace' || key === 'Delete' ? 'delete-up' : (key === 'Shift' ? 'shift-up' : (key === 'Tab' ? 'tab-up' : (typeof key === 'string' && key.length === 1 ? 'up' : ''))));
    if (!kind) return '';
    const at = inputNow(now);
    if (at - lastReleaseAt < SAME_TURN_MS) return '';
    lastReleaseAt = at;
    pendingKey = String(key || '');
    return kind;
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

/** 배음은 [주파수, 감쇠 초, 세기, 시작 지연 초]. 바닥을 치는 소리와 클릭을 시간으로 나눕니다. */
const KEY_PROFILES = {
    red: { partials: [[248, 0.012, 0.85, 0], [640, 0.005, 0.28, 0]], noise: 0.42, noiseMs: 0.007, follow: 0.28 },
    brown: { partials: [[980, 0.004, 0.55, 0.006], [210, 0.016, 0.8, 0.012], [520, 0.008, 0.22, 0.012]], noise: 0.3, noiseMs: 0.01, follow: 0.4, noiseAt: 0.011 },
    blue: { partials: [[3400, 0.0014, 1.1, 0], [5600, 0.001, 0.45, 0], [300, 0.011, 0.55, 0.0045]], noise: 0.62, noiseMs: 0.004, follow: 0.08 },
    black: { partials: [[132, 0.03, 0.95, 0], [280, 0.018, 0.35, 0.002]], noise: 0.22, noiseMs: 0.012, follow: 0.72 },
    topre: { partials: [[168, 0.042, 0.75, 0], [390, 0.024, 0.22, 0.003]], noise: 0.08, noiseMs: 0.016, follow: 0.85 },
    silent: { partials: [[620, 0.006, 0.35, 0]], noise: 0.18, noiseMs: 0.005, follow: 0.55 },
    typewriter: { partials: [[1860, 0.0035, 0.95, 0], [740, 0.01, 0.4, 0.001], [2400, 0.002, 0.3, 0]], noise: 0.7, noiseMs: 0.003, follow: 0.05 },
    laptop: { partials: [[410, 0.009, 0.45, 0.002]], noise: 0.85, noiseMs: 0.009, follow: 0.62 },
    cream: { partials: [[196, 0.026, 0.5, 0.004], [430, 0.018, 0.28, 0.016]], noise: 0.12, noiseMs: 0.014, follow: 0.8 },
    ink: { partials: [[92, 0.034, 1, 0], [210, 0.02, 0.22, 0.001]], noise: 0.08, noiseMs: 0.016, follow: 0.88 },
    silver: { partials: [[3100, 0.0022, 1, 0], [1800, 0.004, 0.35, 0]], noise: 0.5, noiseMs: 0.003, follow: 0.05 },
    boxnavy: { partials: [[4800, 0.0011, 1.15, 0], [2400, 0.002, 0.4, 0], [190, 0.014, 0.7, 0.006]], noise: 0.55, noiseMs: 0.0035, follow: 0.06 },
    panda: { partials: [[1700, 0.003, 0.7, 0.005], [108, 0.028, 0.95, 0.012]], noise: 0.28, noiseMs: 0.008, follow: 0.45, noiseAt: 0.004 },
    alpaca: { partials: [[275, 0.016, 0.7, 0], [860, 0.006, 0.32, 0.001]], noise: 0.48, noiseMs: 0.01, follow: 0.5 },
    boba: { partials: [[2300, 0.0024, 0.85, 0.002], [104, 0.03, 0.9, 0.014]], noise: 0.24, noiseMs: 0.009, follow: 0.4 },
    zeal: { partials: [[760, 0.006, 0.6, 0.007], [250, 0.02, 0.75, 0.01]], noise: 0.2, noiseMs: 0.012, follow: 0.55, noiseAt: 0.003 },
    marsh: { partials: [[340, 0.012, 0.22, 0.002]], noise: 0.7, noiseMs: 0.018, follow: 0.94 },
};

function kindParts(kind) {
    const name = String(kind || 'tap');
    const release = name === 'up' || name.endsWith('-up');
    const baseName = name === 'up' ? 'tap' : (name.endsWith('-up') ? name.slice(0, -3) : name);
    const base = ['space', 'enter', 'delete', 'shift', 'tab'].includes(baseName) ? baseName : 'tap';
    return { base, release };
}

function strokeProfile(id, kind) {
    const base = KEY_PROFILES[id] || KEY_PROFILES.red;
    const ms = TYPE_VOICE_MS[id] || TYPE_VOICE_MS[DEFAULT_VOICE];
    const parts = kindParts(kind);
    let profile;
    if (parts.base === 'space') {
        profile = { ...base, ms: Math.round(ms * 1.4), freqScale: 0.7, noise: base.noise * 1.35, rattle: 0.28, stab: 0.22 };
    } else if (parts.base === 'enter') {
        profile = { ...base, ms: Math.round(ms * 1.2), freqScale: 0.92, ding: id === 'typewriter' ? 0.9 : 0.26, rattle: 0.12, stab: 0.14 };
    } else if (parts.base === 'shift') {
        profile = { ...base, ms: Math.round(ms * 1.33), freqScale: 0.74, noise: base.noise * 1.2, rattle: 0.34, stab: 0.26 };
    } else if (parts.base === 'tab') {
        profile = { ...base, ms: Math.round(ms * 1.18), freqScale: 0.84, noise: base.noise * 1.05, rattle: 0.16, stab: 0.1 };
    } else if (parts.base === 'delete') {
        profile = { ...base, ms: Math.max(18, Math.round(ms * 0.62)), freqScale: 1.32, noise: base.noise * 0.45, rattle: 0, stab: 0 };
    } else {
        profile = { ...base, ms, freqScale: 1, ding: 0, rattle: 0, stab: 0 };
    }
    if (!parts.release) return profile;
    return {
        ...profile,
        ms: Math.max(16, Math.round(profile.ms * 0.52)),
        freqScale: (profile.freqScale || 1) * 1.55,
        noise: (profile.noise || 0) * 0.35,
        rattle: (profile.rattle || 0) * 0.35,
        stab: (profile.stab || 0) * 0.25,
        ding: 0,
        noiseAt: 0,
        partials: (profile.partials || []).map((partial) => [partial[0] * 1.15, partial[1] * 0.55, partial[2] * 0.62, 0]),
    };
}

function synth(id, sampleRate, kind = 'tap', variant = 0) {
    if (id === 'bang') return synthBang(sampleRate, kind, variant);
    const profile = strokeProfile(id, kind);
    const n = Math.max(8, Math.round((sampleRate * profile.ms) / 1000));
    const data = new Float32Array(n);
    const salt = (TYPE_NOISE[id] || 57) + variant * 17;
    const phases = profile.partials.map(() => 0);
    let low = 0;
    let dingPhase = 0;
    let rattlePhase = 0;
    for (let i = 0; i < n; i += 1) {
        const t = i / sampleRate;
        const white = noiseAt(i, salt + (kind === 'space' ? 3 : kind === 'enter' ? 5 : kind === 'delete' ? 7 : 0));
        const follow = profile.follow ?? 0.3;
        low += follow * (white - low);
        let sample = 0;
        profile.partials.forEach((partial, index) => {
            const freq = partial[0] * (profile.freqScale || 1);
            const tau = partial[1];
            const amp = partial[2];
            const delay = partial[3] || 0;
            const dt = t - delay;
            if (dt < 0) return;
            phases[index] += (2 * Math.PI * freq) / sampleRate;
            const env = Math.exp(-dt / tau) * Math.min(1, dt / 0.0007);
            sample += Math.sin(phases[index]) * amp * env;
        });
        const noiseStart = profile.noiseAt || 0;
        const noiseT = t - noiseStart;
        if (noiseT >= 0 && noiseT < profile.noiseMs) {
            const u = noiseT / profile.noiseMs;
            const burst = Math.sin(Math.PI * Math.min(1, u));
            sample += (white * (1 - follow) + low * follow) * profile.noise * burst;
        }
        if (profile.rattle && t > 0.012 && t < 0.03) {
            rattlePhase += (2 * Math.PI * 90) / sampleRate;
            const env = Math.exp(-(t - 0.012) / 0.008);
            sample += Math.sin(rattlePhase) * profile.rattle * env * (0.6 + 0.4 * white);
        }
        if (profile.stab && t > 0.006 && t < 0.02) {
            const tick = (t > 0.006 && t < 0.009) || (t > 0.013 && t < 0.016);
            if (tick) sample += white * profile.stab;
        }
        if (profile.ding) {
            dingPhase += (2 * Math.PI * (id === 'typewriter' ? 880 : 740)) / sampleRate;
            const env = Math.exp(-t / 0.045) * Math.min(1, t / 0.002);
            sample += Math.sin(dingPhase) * profile.ding * env;
        }
        data[i] = sample;
    }
    return finish(data, sampleRate);
}

function synthBang(sampleRate, kind, variant = 0) {
    const parts = kindParts(kind);
    const scale = parts.base === 'space' ? 1.25 : parts.base === 'delete' ? 0.7 : parts.base === 'enter' ? 1.1 : parts.base === 'shift' ? 1.2 : parts.base === 'tab' ? 1.05 : 1;
    const ms = Math.max(16, Math.round(TYPE_VOICE_MS.bang * scale * (parts.release ? 0.52 : 1)));
    const n = Math.max(8, Math.round((sampleRate * ms) / 1000));
    const data = new Float32Array(n);
    let low = 0;
    let phase = 0;
    let flutter = 0;
    const salt = TYPE_NOISE.bang + (parts.base === 'space' ? 2 : 0) + variant * 17;
    for (let i = 0; i < n; i += 1) {
        const t = i / sampleRate;
        const u = n === 1 ? 0 : i / (n - 1);
        const white = noiseAt(i, salt);
        low += 0.16 * (white - low);
        flutter += (2 * Math.PI * (parts.base === 'delete' ? 18 : 13.5)) / sampleRate;
        const wobble = Math.sin(flutter);
        const env = (Math.sin(Math.PI * Math.min(1, u)) ** 0.55) * (0.62 + 0.38 * wobble);
        const freq = (parts.base === 'delete' ? 160 : 118) - 62 * u + 16 * wobble;
        phase += (2 * Math.PI * freq) / sampleRate;
        data[i] = env * (Math.sin(phase) * 0.28 + low * 0.92);
    }
    return finish(data, sampleRate);
}

function strokeName(kind) {
    const name = String(kind || 'tap');
    if (name === 'up' || name.endsWith('-up')) return name;
    if (name === 'space' || name === 'enter' || name === 'delete' || name === 'shift' || name === 'tab') return name;
    return 'tap';
}

export function renderTypeStroke(voice, kind = 'tap', sampleRate = 48000, variant = 0) {
    const id = normalizeTypeVoice(voice);
    const rate = sampleRate > 0 ? sampleRate : 48000;
    const stroke = strokeName(kind);
    const salt = Number.isFinite(variant) ? Math.max(0, Math.min(2, variant)) : 0;
    return { id, kind: stroke, samples: synth(id, rate, stroke, salt) };
}

export function renderTypeVoice(voice, sampleRate = 48000) {
    return renderTypeStroke(voice, 'tap', sampleRate);
}

function bufferFor(audio, voice, kind, variant = 0) {
    const id = normalizeTypeVoice(voice);
    const stroke = strokeName(kind);
    const salt = Number.isFinite(variant) ? Math.max(0, Math.min(2, variant)) : 0;
    const key = `${id}:${stroke}:${salt}:${audio.sampleRate}`;
    let hit = cache.get(key);
    if (!hit) {
        const rendered = renderTypeStroke(id, stroke, audio.sampleRate, salt);
        const buffer = audio.createBuffer(1, rendered.samples.length, audio.sampleRate);
        buffer.getChannelData(0).set(rendered.samples);
        hit = buffer;
        cache.set(key, hit);
    }
    return hit;
}

function variantOf(key) {
    const text = String(key || '');
    if (!text) return 0;
    let hash = 0;
    for (let i = 0; i < text.length; i += 1) hash = (hash + text.charCodeAt(i) * (i + 1)) % 3;
    return hash;
}

/** 같은 글자는 비슷한 높이, 다른 글자는 다른 높이. 매 타마다 아주 조금 더 흔듭니다. */
export function typePitchForKey(key, random = Math.random) {
    const text = String(key || '');
    let hash = 2166136261;
    for (let i = 0; i < text.length; i += 1) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
    const unit = text ? ((hash >>> 0) % 1000) / 999 : 0.5;
    const roll = Number(random());
    const wobble = Number.isFinite(roll) ? Math.min(1, Math.max(0, roll)) : 0.5;
    const center = 0.94 + unit * 0.1;
    return Math.min(1.08, Math.max(0.9, center + (wobble - 0.5) * 0.04));
}

let busCtx = null;
let busIn = null;

/** 작은 소리는 그대로 두고, 1에 가까운 합만 눌러 줍니다. 압축기의 자동 보정처럼 키우지 않습니다. */
function typeLimitSample(x) {
    const n = Number(x);
    if (!Number.isFinite(n)) return 0;
    return Math.tanh(n);
}

function typeLimitCurve() {
    const size = 2049;
    const curve = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
        const x = (i / (size - 1)) * 2 - 1;
        curve[i] = typeLimitSample(x);
    }
    return curve;
}

/** 글자 소리는 하나의 버스로 모은 뒤 웨이브셰이퍼로 제한합니다. 컨텍스트는 버튼 소리와 같은 하나를 씁니다. */
function typeBus(audio) {
    if (busCtx === audio && busIn) return busIn;
    busCtx = audio;
    busIn = audio.destination;
    if (typeof audio.createWaveShaper !== 'function') return busIn;
    try {
        const shaper = audio.createWaveShaper();
        shaper.curve = typeLimitCurve();
        shaper.oversample = '2x';
        shaper.connect(audio.destination);
        busIn = shaper;
    } catch {
        busIn = audio.destination;
    }
    return busIn;
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

function fadeOldest(oldest, now) {
    const param = oldest?.gain?.gain;
    const canRamp = param && typeof param.setValueAtTime === 'function' && typeof param.linearRampToValueAtTime === 'function';
    const level = Number.isFinite(oldest?.level) ? oldest.level : TYPE_GAIN;
    if (canRamp) {
        try {
            if (typeof param.cancelScheduledValues === 'function') param.cancelScheduledValues(now);
            param.setValueAtTime(Math.max(0, level), now);
            param.linearRampToValueAtTime(0, now + FADE_SEC);
        } catch {
            /* 램프가 없어도 아래에서 끊습니다. */
        }
        try { oldest?.src?.stop?.(now + FADE_SEC + 0.004); } catch { /* 이미 끝난 소리입니다. */ }
    } else {
        try { oldest?.src?.stop?.(); } catch { /* 이미 끝난 소리입니다. */ }
    }
    if (oldest) oldest.done = true;
}

function launch(audio, voice, kind = 'tap', when, keyName = '') {
    dropFinished(audio);
    const now = Number.isFinite(when) ? when : (audio.currentTime || 0);
    while (live.length >= MAX_LIVE) {
        const oldest = live[0];
        fadeOldest(oldest, now);
        live = live.slice(1);
    }
    const src = audio.createBufferSource();
    const gain = audio.createGain();
    const keyText = String(keyName || '');
    src.buffer = bufferFor(audio, voice, kind, variantOf(keyText));
    src.playbackRate.value = typePitchForKey(keyText);
    const wobble = Math.random();
    const release = kind === 'up' || String(kind).endsWith('-up');
    const level = Math.min(0.049, TYPE_GAIN * (release ? 0.62 : 1) * (0.9 + (Number.isFinite(wobble) ? wobble : 0.5) * 0.2));
    const param = gain.gain;
    param.value = level;
    if (typeof param.setValueAtTime === 'function' && typeof param.linearRampToValueAtTime === 'function') {
        try {
            param.setValueAtTime(0, now);
            param.linearRampToValueAtTime(level, now + 0.002);
        } catch {
            param.value = level;
        }
    }
    src.connect(gain);
    gain.connect(typeBus(audio));
    src.start(now);
    const seconds = (src.buffer?.duration) || (TYPE_VOICE_MS[normalizeTypeVoice(voice)] / 1000);
    const entry = { src, gain, level, until: now + seconds, done: false, released: false };
    src.onended = () => releaseNode(entry);
    live.push(entry);
}

/** 검사와 실측이 실제 재생과 같은 launch를 쓰게 합니다. */
export function scheduleTypeBurst(audio, { voice = 'red', kind = 'tap', count = 50, gapSec = 0.03, when = 0 } = {}) {
    const start = Number.isFinite(when) ? when : 0;
    const gap = Number.isFinite(gapSec) ? Math.max(0, gapSec) : 0;
    const hits = Math.max(0, count);
    for (let i = 0; i < hits; i += 1) launch(audio, voice, kind, start + i * gap);
}

export function resetTypeGraphForTest() {
    live = [];
    busCtx = null;
    busIn = null;
}

export function previewTypeVoice(id) {
    unlockKeyAudio();
    const voice = normalizeTypeVoice(id || typeVoiceId());
    pendingKey = '';
    withKeyAudio((audio) => launch(audio, voice, 'tap', undefined, ''));
}

export function playTypeSound(kind = 'tap') {
    if (!typeSoundEnabled()) return;
    unlockKeyAudio();
    const voice = typeVoiceId();
    const keyName = pendingKey;
    pendingKey = '';
    withKeyAudio((audio) => launch(audio, voice, kind, undefined, keyName));
}

/** 연타를 샘플로 섞어 피크와 샘플 간 점프를 잽니다. 오래된 소리는 페이드하고, 합은 리미터를 통과합니다. */
export function mixTypeBurst({ voice = 'red', kind = 'tap', count = 50, gapMs = 30, fadeMs = 16, sampleRate = 48000 } = {}) {
    const rendered = renderTypeStroke(voice, kind, sampleRate);
    const samples = rendered.samples;
    const gap = Math.max(0, Math.round((sampleRate * gapMs) / 1000));
    const fade = Math.max(1, Math.round((sampleRate * fadeMs) / 1000));
    const length = Math.max(samples.length + 8, gap * Math.max(0, count - 1) + samples.length + 8);
    const mix = new Float32Array(length);
    for (let n = 0; n < count; n += 1) {
        const start = n * gap;
        const pitch = 0.96 + ((n * 17) % 100) / 100 * 0.12;
        const gain = Math.min(0.049, TYPE_GAIN * (0.9 + ((n * 13) % 100) / 100 * 0.2));
        const step = 1 / pitch;
        let cursor = 0;
        for (let i = 0; i < samples.length; i += 1) {
            const at = start + Math.floor(cursor);
            cursor += step;
            if (at >= length) break;
            let env = 1;
            const killer = n + MAX_LIVE;
            if (killer < count) {
                const cut = killer * gap;
                if (at >= cut) {
                    const into = at - cut;
                    env = into >= fade ? 0 : 1 - into / fade;
                }
            }
            const attack = Math.min(1, i / Math.max(2, Math.round(sampleRate * 0.002)));
            mix[at] += samples[i] * gain * env * attack;
        }
    }
    let peak = 0;
    let maxJump = 0;
    let prev = 0;
    for (let i = 0; i < mix.length; i += 1) {
        const limited = typeLimitSample(mix[i]);
        mix[i] = limited;
        peak = Math.max(peak, Math.abs(limited));
        maxJump = Math.max(maxJump, Math.abs(limited - prev));
        prev = limited;
    }
    return { peak, maxJump, voices: count, gapMs, fadeMs, sampleRate, voice, kind };
}
