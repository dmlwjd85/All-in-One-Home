/** 버튼 소리를 짧은 wav로 남깁니다. 앱과 같은 합성입니다.
    비교해서 듣기 쉽게 파일 안에서만 크기를 맞추고, 앱 기본은 그대로 작게입니다.
    음원 파일을 가져오지 않습니다. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { KEY_VOICES, keyPitchRate, renderKeyPair } from '../src/ui/keyfeel.js';

const sampleRate = 48000;
const outDir = process.env.KEY_WAV_DIR || '/tmp/ssug-key-sounds';

function resample(data, rate) {
    const length = Math.max(1, Math.floor(data.length / rate));
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
        const pos = i * rate;
        const index = Math.floor(pos);
        const frac = pos - index;
        const left = data[Math.min(index, data.length - 1)] || 0;
        const right = data[Math.min(index + 1, data.length - 1)] || 0;
        out[i] = left + (right - left) * frac;
    }
    return out;
}

function silence(ms) {
    return new Float32Array(Math.round(sampleRate * ms / 1000));
}

function join(chunks) {
    const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Float32Array(length);
    let offset = 0;
    for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.length;
    }
    return out;
}

function wavBytes(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
    const gain = peak > 0 ? 0.5 / peak : 1;
    const header = 44;
    const buffer = Buffer.alloc(header + samples.length * 2);
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(buffer.length - 8, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16);
    buffer.writeUInt16LE(1, 20);
    buffer.writeUInt16LE(1, 22);
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 2, 28);
    buffer.writeUInt16LE(2, 32);
    buffer.writeUInt16LE(16, 34);
    buffer.write('data', 36);
    buffer.writeUInt32LE(samples.length * 2, 40);
    for (let i = 0; i < samples.length; i += 1) {
        const value = Math.max(-1, Math.min(1, samples[i] * gain));
        buffer.writeInt16LE(value < 0 ? value * 0x8000 : value * 0x7fff, header + i * 2);
    }
    return buffer;
}

mkdirSync(outDir, { recursive: true });
const rates = [() => 0, () => 0.5, () => 1].map((roll) => keyPitchRate(roll));
for (const voice of KEY_VOICES) {
    const pair = renderKeyPair(voice.id, sampleRate);
    const chunks = [];
    for (const step of rates) {
        chunks.push(resample(pair.down, step), silence(70), resample(pair.up, step), silence(110));
    }
    const file = `${outDir}/${voice.label}.wav`;
    writeFileSync(file, wavBytes(join(chunks)));
    console.log(file);
}
