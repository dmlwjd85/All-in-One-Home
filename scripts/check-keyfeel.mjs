/** 버튼 소리 합성, 저장, 연타, 첫 안내를 확인합니다. */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
    KEY_VOICES,
    KEY_VOICE_MS,
    KEY_VOLUMES,
    keyPitchRate,
    keySoundEnabled,
    keySoundNoticePending,
    keyVibeEnabled,
    keyVoiceId,
    keyVolumeGain,
    keyVolumeId,
    playKey,
    previewKeyVoice,
    rememberKeySoundNotice,
    mixKeyBurst,
    renderKeyPair,
    setKeyMuted,
    setKeySound,
    setKeyVibe,
    setKeyVoice,
    setKeyVolume,
} from '../src/ui/keyfeel.js';
import { TYPE_GAIN, TYPE_VOICES, playTypeSound, previewTypeVoice, renderTypeVoice, setTypeSound } from '../src/ui/typesound.js';

const failures = [];
function check(ok, message) {
    if (!ok) failures.push(message);
}

function memory() {
    const bag = new Map();
    return {
        getItem: (key) => (bag.has(key) ? bag.get(key) : null),
        setItem: (key, value) => bag.set(key, String(value)),
    };
}

function peakOf(data) {
    let peak = 0;
    for (let i = 0; i < data.length; i += 1) peak = Math.max(peak, Math.abs(data[i]));
    return peak;
}

function energy(data, start, end) {
    let sum = 0;
    const from = Math.max(0, start);
    const to = Math.min(data.length, end);
    const span = Math.max(1, to - from);
    for (let i = from; i < to; i += 1) sum += data[i] * data[i];
    return sum / span;
}

function centroid(data, sampleRate) {
    const bins = 180;
    const size = 1024;
    const length = Math.min(data.length, size);
    let weighted = 0;
    let total = 0;
    for (let k = 1; k < bins; k += 1) {
        let real = 0;
        let imag = 0;
        const omega = (2 * Math.PI * k) / size;
        for (let i = 0; i < length; i += 1) {
            real += data[i] * Math.cos(omega * i);
            imag -= data[i] * Math.sin(omega * i);
        }
        const power = real * real + imag * imag;
        weighted += (k * sampleRate / size) * power;
        total += power;
    }
    return total ? weighted / total : 0;
}

function correlation(left, right) {
    const length = Math.min(left.length, right.length);
    let dot = 0;
    let aa = 0;
    let bb = 0;
    for (let i = 0; i < length; i += 1) {
        dot += left[i] * right[i];
        aa += left[i] * left[i];
        bb += right[i] * right[i];
    }
    return dot / Math.sqrt(aa * bb);
}

const rate = 48000;
const pairs = Object.fromEntries(KEY_VOICES.map((voice) => [voice.id, renderKeyPair(voice.id, rate)]));
const again = renderKeyPair('click', rate);
check(again.down.length === pairs.click.down.length && again.down.every((sample, index) => sample === pairs.click.down[index]), '같은 소리는 늘 같은 파형이어야 합니다.');
check(renderKeyPair('없는소리', rate).id === 'munggeul', '모르는 소리는 몽글로 돌아가지 않습니다.');
check(renderKeyPair('없는소리', rate).down.every((sample, index) => sample === pairs.munggeul.down[index]), '모르는 소리의 파형이 몽글이 아닙니다.');

for (const voice of KEY_VOICES) {
    const pair = pairs[voice.id];
    const expectDown = Math.round((rate * KEY_VOICE_MS[voice.id].down) / 1000);
    const expectUp = Math.round((rate * KEY_VOICE_MS[voice.id].up) / 1000);
    check(pair.down.length === expectDown && pair.up.length === expectUp, `${voice.label} 길이가 다릅니다.`);
    check(pair.up.length < pair.down.length, `${voice.label} 뗄 때 소리가 누를 때보다 짧지 않습니다.`);
    const downPeak = peakOf(pair.down);
    const upPeak = peakOf(pair.up);
    check(downPeak > 0.85 && downPeak < 0.95, `${voice.label} 누름 크기가 맞지 않습니다.`);
    check(upPeak < downPeak * 0.85, `${voice.label} 뗌이 누름만큼 큽니다.`);
    check([...pair.down, ...pair.up].every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1), `${voice.label} 파형이 범위를 벗어납니다.`);
    check(Math.abs(pair.down[0]) < 1e-6 && Math.abs(pair.down[pair.down.length - 1]) < 1e-6, `${voice.label} 누름 시작·끝이 0이 아닙니다.`);
    check(Math.abs(pair.up[0]) < 1e-6 && Math.abs(pair.up[pair.up.length - 1]) < 1e-6, `${voice.label} 뗌 시작·끝이 0이 아닙니다.`);
}

check(pairs.scrape.down.length > pairs.click.down.length && pairs.click.down.length > pairs.munggeul.down.length, '끌기·청축·몽글 길이가 순서와 다릅니다.');
const tone = Object.fromEntries(KEY_VOICES.map((voice) => [voice.id, centroid(pairs[voice.id].down, rate)]));
check(tone.click > tone.scrape && tone.scrape > tone.linear && tone.linear > tone.munggeul, `밝기 순서가 다릅니다. ${JSON.stringify(tone)}`);
check(tone.mongdol < tone.tactile && tone.munggeul < tone.tactile, '몽돌·몽글이 갈축보다 밝습니다.');
const earlyAt = Math.floor(rate * 0.004);
const midFrom = Math.floor(rate * 0.007);
const midTo = Math.floor(rate * 0.013);
check(energy(pairs.tactile.down, midFrom, midTo) > energy(pairs.tactile.down, 0, earlyAt), '갈축 걸림이 가운데에 없습니다.');
check(energy(pairs.click.down, 0, earlyAt) > energy(pairs.click.down, midFrom, midTo) * 2, '청축 찰칵이 앞쪽에 없습니다.');
check(energy(pairs.linear.down, 0, earlyAt) > energy(pairs.linear.down, midFrom, midTo), '적축이 한 번의 타건이 아닙니다.');

for (let i = 0; i < KEY_VOICES.length; i += 1) {
    for (let j = i + 1; j < KEY_VOICES.length; j += 1) {
        const left = KEY_VOICES[i].id;
        const right = KEY_VOICES[j].id;
        const score = Math.abs(correlation(pairs[left].down, pairs[right].down));
        check(score < 0.8, `${left}와 ${right} 파형이 너무 같습니다. ${score.toFixed(2)}`);
    }
}

const typePairs = Object.fromEntries(TYPE_VOICES.map((voice) => [voice.id, renderTypeVoice(voice.id, rate)]));
check(TYPE_GAIN <= 0.05, '글자 소리가 교실용으로 작지 않습니다.');
for (const voice of TYPE_VOICES) {
    const samples = typePairs[voice.id].samples;
    const expect = Math.round((rate * ({ bang: 110, ppok: 46, ting: 92, drop: 156 })[voice.id]) / 1000);
    check(samples.length === expect, `${voice.label} 길이가 다릅니다.`);
    check(Math.abs(samples[0]) < 1e-6 && Math.abs(samples[samples.length - 1]) < 1e-6, `${voice.label} 시작·끝이 0이 아닙니다.`);
    const peak = peakOf(samples);
    check(peak > 0.85 && peak < 0.95, `${voice.label} 크기가 맞지 않습니다.`);
    check([...samples].every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1), `${voice.label} 파형이 범위를 벗어납니다.`);
}
for (let i = 0; i < TYPE_VOICES.length; i += 1) {
    for (let j = i + 1; j < TYPE_VOICES.length; j += 1) {
        const left = TYPE_VOICES[i].id;
        const right = TYPE_VOICES[j].id;
        const score = Math.abs(correlation(typePairs[left].samples, typePairs[right].samples));
        check(score < 0.8, `${left}와 ${right} 글자 소리가 너무 같습니다. ${score.toFixed(2)}`);
    }
}
check(typePairs.ppok.samples.length < typePairs.ting.samples.length && typePairs.ting.samples.length < typePairs.bang.samples.length && typePairs.bang.samples.length < typePairs.drop.samples.length, '글자 소리 길이가 순서와 다릅니다.');

check(Math.abs(keyPitchRate(() => 0) - 0.94) < 1e-9 && Math.abs(keyPitchRate(() => 1) - 1.06) < 1e-9, '음높이 흔들림 범위가 아닙니다.');
check(Math.abs(keyPitchRate(() => 0.5) - 1) < 1e-9, '음높이 가운데가 1이 아닙니다.');
check(KEY_VOLUMES[0].id === 'small' && KEY_VOLUMES[0].gain <= 0.05 && KEY_VOLUMES[2].gain <= 0.2, '기본 크기가 교실용으로 작지 않습니다.');
check(keyVolumeGain('small') < keyVolumeGain('mid') && keyVolumeGain('mid') < keyVolumeGain('loud'), '크기 단계가 커지지 않습니다.');
const burstNotes = [];
for (const sampleRate of [44100, 48000]) {
    for (const voice of KEY_VOICES) {
        for (const gapMs of [0, 8, 15, 40]) {
            const burst = mixKeyBurst({ voice: voice.id, volume: 'loud', count: 12, gapMs, fadeMs: 10, sampleRate });
            burstNotes.push(`${voice.id}@${sampleRate} ${gapMs}ms ${burst.peak.toFixed(4)}`);
            check(burst.peak <= 1 && burst.peak > 0, `${voice.label} 연타 피크가 1을 넘거나 0입니다. ${sampleRate} ${gapMs}ms ${burst.peak}`);
        }
    }
}
const worst = burstNotes.reduce((best, line) => {
    const peak = Number(line.split(' ').at(-1));
    return peak > best.peak ? { peak, line } : best;
}, { peak: 0, line: '' });
console.log(`연타 최대 피크 ${worst.peak.toFixed(4)} (${worst.line})`);

const store = memory();
check(keyVoiceId(store) === 'munggeul' && keyVolumeId(store) === 'small', '기본 소리나 크기가 몽글·작게가 아닙니다.');
check(keySoundEnabled(store) && keyVibeEnabled(store), '소리와 진동 기본이 켜져 있지 않습니다.');
check(setKeyVoice('click', store) === 'click' && keyVoiceId(store) === 'click', '고른 소리가 저장되지 않습니다.');
check(setKeyVolume('loud', store) === 'loud' && keyVolumeId(store) === 'loud', '고른 크기가 저장되지 않습니다.');
check(setKeyVoice('없는소리', store) === 'munggeul' && keyVoiceId(store) === 'munggeul', '모르는 소리를 그대로 저장합니다.');
check(setKeyVolume('huge', store) === 'small' && keyVolumeId(store) === 'small', '모르는 크기를 그대로 저장합니다.');
setKeySound(false, store);
check(!keySoundEnabled(store) && !keySoundNoticePending(store), '소리를 꺼도 안내가 남습니다.');
setKeySound(true, store);
check(keySoundNoticePending(store), '첫 안내를 이미 본 것으로 봅니다.');
check(rememberKeySoundNotice(store) && !keySoundNoticePending(store), '첫 안내를 기억하지 않습니다.');
setKeyVibe(false, store);
check(!keyVibeEnabled(store), '진동 끄기가 저장되지 않습니다.');

const bag = new Map();
globalThis.localStorage = {
    getItem: (key) => (bag.has(key) ? bag.get(key) : null),
    setItem: (key, value) => bag.set(key, String(value)),
    removeItem: (key) => bag.delete(key),
};
const sources = [];
const gains = [];
class FakeAudioContext {
    constructor() {
        this.state = 'running';
        this.sampleRate = 48000;
        this.currentTime = 0;
        this.destination = {};
    }
    createBuffer(_channels, length, sampleRate) {
        const data = new Float32Array(length);
        return { length, sampleRate, getChannelData: () => data };
    }
    createBufferSource() {
        const src = {
            buffer: null,
            playbackRate: { value: 1 },
            connect() {},
            disconnect() { src.disconnected = true; },
            start() { src.started = true; },
            stop() { src.stopped = true; },
        };
        sources.push(src);
        return src;
    }
    createGain() {
        const gain = { gain: { value: 0 }, connect() {}, disconnect() { gain.disconnected = true; } };
        gains.push(gain);
        return gain;
    }
    resume() {
        this.state = 'running';
        return Promise.resolve();
    }
}
globalThis.window = { AudioContext: FakeAudioContext };

check(keySoundNoticePending(), '저장값이 없는데 안내를 이미 본 것으로 봅니다.');
previewKeyVoice('mongdol');
check(sources.length === 2 && sources.every((src) => src.started && !src.stopped), '소리 칩 미리듣기가 바로 나지 않습니다.');
check(sources[0].playbackRate.value >= 0.94 && sources[0].playbackRate.value <= 1.06, '미리듣기 음높이가 범위를 벗어납니다.');
check(gains[0].gain.value === keyVolumeGain('small') && gains[1].gain.value === keyVolumeGain('small'), '미리듣기가 기본 크기가 아닙니다.');
check(keySoundNoticePending(), '미리듣기가 첫 안내를 꺼 버립니다.');
playKey('down');
check(sources.length === 3 && sources[2].started && !sources[2].stopped, '첫 누름에 소리가 없습니다.');
check(sources[0].stopped && sources[1].stopped, '다음 누름이 이전 미리듣기를 끊지 않습니다.');
check(keySoundNoticePending(), '누름이 소리 안내를 지웁니다.');
const beforeRapid = sources.length;
const started = performance.now();
for (let i = 0; i < 24; i += 1) playKey('down');
const elapsed = performance.now() - started;
check(elapsed < 400, `연타가 밀립니다. ${elapsed.toFixed(0)}ms`);
check(sources.length === beforeRapid + 24, '연타가 소리를 건너뜁니다.');
check(sources.slice(beforeRapid, -1).every((src) => src.stopped) && !sources.at(-1).stopped, '연타 소리가 겹칩니다.');
playKey('up');
check(sources.at(-2).stopped && !sources.at(-1).stopped && sources.at(-1).buffer.length === Math.round((rate * KEY_VOICE_MS.munggeul.up) / 1000), '뗄 때 소리가 따로 나지 않습니다.');
setKeyVoice('click');
setKeyVolume('loud');
playKey('down');
check(sources.at(-1).buffer.length === Math.round((rate * KEY_VOICE_MS.click.down) / 1000), '고른 청축이 재생되지 않습니다.');
check(gains.at(-1).gain.value === keyVolumeGain('loud'), '크게가 적용되지 않습니다.');
setKeyMuted(true);
check(sources.at(-1).stopped, '받아쓰기 중에 나던 소리를 끊지 않습니다.');
const mutedCount = sources.length;
playKey('down');
previewKeyVoice('click');
check(sources.length === mutedCount, '받아쓰기 중에 소리가 납니다.');
setKeyMuted(false);
setKeySound(false);
playKey('down');
check(sources.length === mutedCount, '소리를 꺼도 납니다.');
playTypeSound();
check(sources.length === mutedCount, '꺼진 글자 소리가 납니다.');
setTypeSound(true);
previewTypeVoice('bang');
playTypeSound();
check(sources.length === mutedCount + 2, '글자 소리 미리듣기나 입력이 나지 않습니다.');
check(!sources.at(-2).stopped && !sources.at(-1).stopped, '이어 친 글자 소리가 앞 소리를 끊습니다.');
check(gains.at(-1).gain.value <= 0.05, '글자 소리가 작지 않습니다.');
sources.at(-1).onended();
check(sources.at(-1).disconnected && gains.at(-1).disconnected, '끝난 글자 소리 노드를 끊지 않습니다.');

const root = new URL('..', import.meta.url).pathname;
const feel = readFileSync(`${root}/src/ui/keyfeel.js`, 'utf8');
const settings = readFileSync(`${root}/src/ui/Settings.jsx`, 'utf8');
const speech = readFileSync(`${root}/src/ui/useSpeechDictation.js`, 'utf8');
const db = readFileSync(`${root}/src/lib/db.js`, 'utf8');
const sw = readFileSync(`${root}/public/sw.js`, 'utf8');
check(feel.includes("const SOUND_KEY = 'ssug-gyomu-key-sound'"), '소리 켜기 키가 바뀌었습니다.');
check(feel.includes("const VIBE_KEY = 'ssug-gyomu-key-vibrate'"), '진동 키가 바뀌었습니다.');
check(db.includes("createVault('ssug-gyomu')") && db.includes("createVault('ssug-gyomu-local')"), '내부 저장 키가 바뀌었습니다.');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v16'"), '서비스 워커가 v16이 아닙니다.');
check(sw.includes('function staleAssetUrls') && sw.includes('/* stale-assets-end */'), '옛 assets 정리가 빠졌습니다.');
check(speech.includes('setKeyMuted(listening)'), '받아쓰기 중에 소리를 끄지 않습니다.');
check(!settings.includes('<select') && settings.includes('누를 때 소리 종류') && settings.includes('role="group"'), '소리 고르기가 칩이 아닙니다.');
check(settings.includes('KEY_VOICES.map') && settings.includes('KEY_VOLUMES.map') && settings.includes('data-key-preview'), '설정이 소리 칩을 그리지 않습니다.');
check(settings.includes('꺼 두어도 여기서는 미리 들어 볼 수 있어요'), '꺼 둔 미리듣기 안내가 없습니다.');
for (const label of ['몽글', '몽돌', '적축', '갈축', '청축', '끌기', '작게', '보통', '크게']) {
    check(feel.includes(`'${label}'`) || settings.includes(label), `소리 이름 ${label} 이 없습니다.`);
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('버튼 소리 검사를 통과했습니다.');
