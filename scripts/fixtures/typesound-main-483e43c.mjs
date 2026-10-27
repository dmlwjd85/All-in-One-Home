/**
 * main(483e43c) src/ui/typesound.js 의 글자 소리 합성을 그대로 얼려 둔 사본입니다. 고치지 마세요.
 * check-keyfeel 이 예전 소리(뽁·띵·물방울·방귀)가 이 표본과 한 칸도 다르지 않은지 비교합니다.
 */
const TYPE_NOISE = { bang: 57, ppok: 76, ting: 95, drop: 114 };

const TYPE_VOICE_MS = {
    bang: 110,
    ppok: 46,
    ting: 92,
    drop: 156,
};

const DEFAULT_VOICE = 'ppok';

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

export const MAIN_TYPE_VOICE_IDS = Object.keys(TYPE_VOICE_MS);
export const MAIN_TYPE_GAIN = 0.032;
export const MAIN_TYPE_PITCH = [0.97, 1.03];

export function renderMainTypeVoice(id, sampleRate) {
    return synth(id, sampleRate);
}
