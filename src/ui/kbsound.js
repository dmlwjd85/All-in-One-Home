/** 키보드 테마 소리(kb-…) 파일을 받고 고릅니다. keyfeel.js는 여기서 버퍼만 받아 같은 launch 길로 한 번에 하나만 냅니다.
    파일은 고를 때(또는 앱이 쉬는 틈에) 처음 한 번 받아 두고, 받는 동안의 누름은 조용히 지나갑니다. */

import { KB_VOICES, isKbVoice, kbSoundFiles, kbVoiceTheme } from './kbvoices.js';

export { KB_VOICES, isKbVoice };

/** 테마 소리 '작게'의 크기. 옮겨 온 글자 소리(0.032 기준, 작게·보통·크게 = 1·2·3배)와 처음 30ms 에너지가 비슷해지는 값입니다.
    녹음 파일은 잔향까지 담아 봉우리가 높아서 기준값보다 큽니다. 보통·크게는 #42의 TYPE_PRESS_STEPS 계단(1·2·3배)을 그대로 씁니다. */
export const KB_VOICE_GAIN = 0.09;

const kbFiles = new Map();
const kbLoads = new Map();

function soundBase() {
    try {
        return import.meta.env?.BASE_URL || './';
    } catch {
        return './';
    }
}

function decodeContext(audio) {
    if (audio) return audio;
    const Offline = typeof window !== 'undefined' ? (window.OfflineAudioContext || window.webkitOfflineAudioContext) : null;
    if (!Offline) return null;
    try { return new Offline(1, 1, 44100); } catch { return null; }
}

function decodeData(audio, data) {
    return new Promise((resolve, reject) => {
        try {
            const pending = audio.decodeAudioData(data, resolve, reject);
            if (pending && typeof pending.then === 'function') pending.then(resolve, reject);
        } catch (error) {
            reject(error);
        }
    });
}

/** 테마 소리 파일을 받아 풀어 둡니다. 실패하면 다음에 다시 받습니다. audio를 주면 그 컨텍스트로 풉니다. */
export function loadKbVoice(id, audio = null) {
    if (!isKbVoice(id) || typeof fetch !== 'function') return Promise.resolve(false);
    if (kbFiles.has(id)) return Promise.resolve(true);
    if (kbLoads.has(id)) return kbLoads.get(id);
    const files = kbSoundFiles(kbVoiceTheme(id));
    const base = soundBase();
    const one = async (path) => {
        const response = await fetch(`${base}${path}`);
        if (!response.ok) throw new Error(path);
        const context = decodeContext(audio);
        if (!context) throw new Error('decode');
        return decodeData(context, await response.arrayBuffer());
    };
    const job = Promise.all([Promise.all(files.down.map(one)), Promise.all(files.up.map(one))])
        .then(([down, up]) => {
            kbFiles.set(id, { down, up, last: {} });
            return true;
        })
        .catch(() => false)
        .finally(() => kbLoads.delete(id));
    kbLoads.set(id, job);
    return job;
}

export function kbVoiceLoaded(id) {
    return kbFiles.has(id);
}

/** 여러 녹음 중 하나를 고릅니다. 바로 앞과 같은 녹음은 피합니다. */
export function pickVariant(list, last, random = Math.random) {
    if (!list?.length) return -1;
    if (list.length === 1) return 0;
    let index = Math.min(list.length - 1, Math.floor(Math.max(0, Number(random()) || 0) * list.length));
    if (index === last) index = (index + 1) % list.length;
    return index;
}

/** 이번 누름·뗌에 쓸 녹음. 아직 받지 않았으면 받기를 시작하고 둘 다 null을 줍니다. */
export function kbBuffers(id, audio = null) {
    const hit = kbFiles.get(id);
    if (!hit) {
        loadKbVoice(id, audio);
        return { down: null, up: null };
    }
    const pick = (part) => {
        const index = pickVariant(hit[part], hit.last[part]);
        if (index < 0) return null;
        hit.last[part] = index;
        return hit[part][index];
    };
    return { down: pick('down'), up: pick('up') };
}
