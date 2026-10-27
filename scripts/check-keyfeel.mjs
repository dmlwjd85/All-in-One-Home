/** 버튼 소리 합성, 저장, 연타, 첫 안내를 확인합니다. */
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import {
    TYPE_PRESS_STEPS,
    keyPressGain,
    KEY_FADE_SEC,
    KEY_VOICES,
    KEY_VOICE_MS,
    MAX_KEY_VOICES,
    PRESS_SELECTOR,
    KEY_VOLUMES,
    keyPitchRate,
    closeKeyVoiceMoved,
    keySoundEnabled,
    keyVoiceMoved,
    pressRate,
    keySoundNoticePending,
    keyVibeEnabled,
    keyVoiceId,
    keyVolumeGain,
    keyVolumeId,
    playKey,
    pressTarget,
    previewKeyVoice,
    rememberKeySoundNotice,
    mixKeyBurst,
    renderKeyPair,
    setKeyMuted,
    setKeySound,
    setKeyVibe,
    setKeyVoice,
    setKeyVolume,
    unlockKeyAudio,
} from '../src/ui/keyfeel.js';
import { MAIN_TYPE_GAIN, MAIN_TYPE_PITCH, MAIN_TYPE_VOICE_IDS, renderMainTypeVoice } from './fixtures/typesound-main-483e43c.mjs';
import { mainNoteTypeInput, resetMainTypeInput } from './fixtures/typeinput-main-483e43c.mjs';
import { TYPE_GAIN, TYPE_SOUND_SHOWN, TYPE_VOICE_MS, TYPE_VOICES, mixTypeBurst, noteTypeInput, noteTypeKey, playTypeSound, previewTypeVoice, renderTypeStroke, renderTypeVoice, resetTypeGraphForTest, scheduleTypeBurst, setTypeSound, setTypeVoice, typeVoiceId } from '../src/ui/typesound.js';

const failures = [];
function sameSamples(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) if (!Object.is(a[i], b[i])) return false;
    return true;
}
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
    const expect = Math.round((rate * TYPE_VOICE_MS[voice.id]) / 1000);
    check(samples.length === expect, `${voice.label} 길이가 다릅니다.`);
    check(Math.abs(samples[0]) < 1e-6 && Math.abs(samples[samples.length - 1]) < 1e-6, `${voice.label} 시작·끝이 0이 아닙니다.`);
    const peak = peakOf(samples);
    check(peak > 0.85 && peak < 0.95, `${voice.label} 크기가 맞지 않습니다.`);
    check([...samples].every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1), `${voice.label} 파형이 범위를 벗어납니다.`);
    for (const kind of ['space', 'enter', 'delete']) {
        const other = renderTypeStroke(voice.id, kind, rate).samples;
        const score = Math.abs(correlation(samples, other));
        if (MAIN_TYPE_VOICE_IDS.includes(voice.id)) check(sameSamples(other, samples), `${voice.label} ${kind} 소리가 main처럼 글자 소리와 같지 않습니다.`);
        else check(other.length !== samples.length || score < 0.8, `${voice.label} ${kind} 소리가 글자와 같습니다. ${score.toFixed(2)}`);
        check(Math.abs(other[0]) < 1e-6 && Math.abs(other[other.length - 1]) < 1e-6, `${voice.label} ${kind} 시작·끝이 0이 아닙니다.`);
    }
}
for (let i = 0; i < TYPE_VOICES.length; i += 1) {
    for (let j = i + 1; j < TYPE_VOICES.length; j += 1) {
        const left = TYPE_VOICES[i].id;
        const right = TYPE_VOICES[j].id;
        const score = Math.abs(correlation(typePairs[left].samples, typePairs[right].samples));
        check(score < 0.8, `${left}와 ${right} 글자 소리가 너무 같습니다. ${score.toFixed(2)}`);
    }
}
/** main(483e43c)에 있던 뽁·띵·물방울·방귀는 누름·띄어쓰기·엔터·지우기 모두 main 합성과 표본 하나까지 같아야 합니다. */
for (const id of MAIN_TYPE_VOICE_IDS) {
    for (const sampleRate of [44100, 48000]) {
        const want = renderMainTypeVoice(id, sampleRate);
        check(TYPE_VOICE_MS[id] === Math.round((want.length / sampleRate) * 1000), `${id} 길이가 main과 다릅니다. ${TYPE_VOICE_MS[id]}ms`);
        for (const kind of ['tap', 'space', 'enter', 'delete']) {
            const got = renderTypeStroke(id, kind, sampleRate).samples;
            check(sameSamples(got, want), `${id} ${kind} 소리가 main 합성과 다릅니다. ${sampleRate}Hz 길이 ${got.length}/${want.length}`);
        }
    }
}
/** main에 있던 뽁·띵·물방울. 저장된 값은 그 이름 그대로 같은 소리로 나야 합니다. 지문은 main 파형에서 뽑았습니다. */
const LEGACY_TYPE = {
    ppok: { label: '뽁', 44100: [2029, -1.503304, 99.591032], 48000: [2208, -1.522793, 107.768256] },
    ting: { label: '띵', 44100: [4057, 0.316212, 182.26893], 48000: [4416, 0.250622, 199.74879] },
    drop: { label: '물방울', 44100: [6880, -2.187687, 495.692668], 48000: [7488, -2.528074, 547.437276] },
};
for (const [id, legacy] of Object.entries(LEGACY_TYPE)) {
    const item = TYPE_VOICES.find((voice) => voice.id === id);
    check(item?.label === legacy.label && !item.playful, `${legacy.label} 소리가 목록에 없습니다.`);
    const bag = memory();
    bag.setItem('ssug-gyomu-type-voice', id);
    check(typeVoiceId(bag) === id, `저장된 ${id} 값이 ${typeVoiceId(bag)}(으)로 바뀝니다.`);
    check(setTypeVoice(id, bag) === id && bag.getItem('ssug-gyomu-type-voice') === id, `${id}를 고르면 같은 값으로 저장되지 않습니다.`);
    for (const sampleRate of [44100, 48000]) {
        const samples = renderTypeVoice(id, sampleRate).samples;
        let sum = 0;
        let energy = 0;
        for (const sample of samples) {
            sum += sample;
            energy += sample * sample;
        }
        const [length, wantSum, wantEnergy] = legacy[sampleRate];
        check(samples.length === length && Math.abs(sum - wantSum) < 1e-4 && Math.abs(energy - wantEnergy) < 1e-3, `${legacy.label} 소리가 main과 다릅니다. ${sampleRate}Hz 길이 ${samples.length}, 합 ${sum.toFixed(6)}, 에너지 ${energy.toFixed(6)}`);
    }
}
for (const voice of TYPE_VOICES) {
    const bag = memory();
    bag.setItem('ssug-gyomu-type-voice', voice.id);
    check(typeVoiceId(bag) === voice.id, `저장된 ${voice.id} 값이 유지되지 않습니다.`);
}
const unknownBag = memory();
unknownBag.setItem('ssug-gyomu-type-voice', 'nothing');
check(typeVoiceId(unknownBag) === 'ppok' && typeVoiceId(memory()) === 'ppok', '처음 글자 소리가 main처럼 뽁이 아닙니다.');
check(typePairs.ppok.samples.length < typePairs.ting.samples.length && typePairs.ting.samples.length < typePairs.drop.samples.length, '예전 글자 소리 길이 순서가 main과 다릅니다.');
const typeBurstNotes = [];
for (const sampleRate of [44100, 48000]) {
    for (const voice of TYPE_VOICES) {
        const burst = mixTypeBurst({ voice: voice.id, count: 50, gapMs: 30, fadeMs: 16, sampleRate });
        typeBurstNotes.push(`${voice.id}@${sampleRate} peak ${burst.peak.toFixed(4)} jump ${burst.maxJump.toFixed(4)}`);
        check(burst.peak <= 1 && burst.peak > 0, `${voice.label} 연타 피크가 1을 넘거나 0입니다. ${burst.peak}`);
        check(burst.maxJump < 0.08, `${voice.label} 연타에 클릭이 있습니다. 점프 ${burst.maxJump}`);
    }
}
const typeWorst = typeBurstNotes.reduce((best, line) => {
    const peak = Number(line.match(/peak ([0-9.]+)/)[1]);
    return peak > best.peak ? { peak, line } : best;
}, { peak: 0, line: '' });
console.log(`글자 연타 50×30ms 최대 피크 ${typeWorst.peak.toFixed(4)} (${typeWorst.line})`);

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

/** QA 1차: 옮겨 온 뽁·띵의 RMS·피크를 main 글자 소리(0.032, 음높이 1)와 비교합니다. 작게는 같고, 크게는 3배 안팎입니다. */
function rmsOf(data) {
    let sum = 0;
    for (let i = 0; i < data.length; i += 1) sum += data[i] * data[i];
    return Math.sqrt(sum / Math.max(1, data.length));
}
const levelNotes = [];
for (const sampleRate of [44100, 48000]) {
    for (const id of ['ppok', 'ting']) {
        const main = renderMainTypeVoice(id, sampleRate);
        const mainRms = rmsOf(main) * MAIN_TYPE_GAIN;
        const mainPeak = peakOf(main) * MAIN_TYPE_GAIN;
        const down = renderKeyPair(id, sampleRate).down;
        for (const volumeId of ['small', 'mid', 'loud']) {
            const gain = keyPressGain(id, volumeId);
            const rmsRatio = (rmsOf(down) * gain) / mainRms;
            const peakRatio = (peakOf(down) * gain) / mainPeak;
            levelNotes.push(`${id}@${sampleRate} ${volumeId} RMS×${rmsRatio.toFixed(3)} 피크×${peakRatio.toFixed(3)}`);
            if (volumeId === 'small') check(Math.abs(rmsRatio - 1) < 0.01 && Math.abs(peakRatio - 1) < 0.01, `${id} 작게가 main 글자 소리와 다릅니다. RMS×${rmsRatio} 피크×${peakRatio}`);
            if (volumeId === 'loud') check(rmsRatio >= 2.5 && rmsRatio <= 3.2 && peakRatio >= 2.5 && peakRatio <= 3.2, `${id} 크게가 main 글자 소리보다 너무 크거나 작습니다. RMS×${rmsRatio} 피크×${peakRatio}`);
        }
    }
}
const keyStep = keyVolumeGain('loud') / keyVolumeGain('small');
check(TYPE_PRESS_STEPS.small === 1 && TYPE_PRESS_STEPS.mid > 1 && TYPE_PRESS_STEPS.loud > TYPE_PRESS_STEPS.mid && TYPE_PRESS_STEPS.loud <= keyStep, `옮겨 온 소리 크기 단계가 다른 소리 비율(${keyStep.toFixed(2)})을 넘습니다.`);
check(KEY_VOICES.every((voice) => keyPressGain(voice.id, 'loud') === keyVolumeGain('loud')), '몽글·청축 같은 누를 때 소리 크기가 바뀌었습니다.');
console.log(`옮겨 온 소리 크기(main 글자 소리 대비): ${levelNotes.join(' / ')}`);

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
/** 옮겨 온 소리는 재생할 때도 예전 글자 소리 크기를 기준으로 합니다. */
for (const [voiceId, base] of [['ppok', MAIN_TYPE_GAIN], ['ting', MAIN_TYPE_GAIN], ['red', TYPE_GAIN]]) {
    setKeyVoice(voiceId);
    for (const volumeId of ['small', 'mid', 'loud']) {
        setKeyVolume(volumeId);
        playKey('down');
        const want = base * TYPE_PRESS_STEPS[volumeId];
        check(Math.abs(gains.at(-1).gain.value - want) < 1e-12, `${voiceId} ${volumeId} 재생 크기가 ${want} 가 아닙니다. ${gains.at(-1).gain.value}`);
    }
}
setKeyVoice('click');
setKeyVolume('loud');
playKey('down');
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
setTypeVoice('bang');
playTypeSound();
check(sources.at(-1).buffer.length === Math.round((rate * TYPE_VOICE_MS.bang) / 1000), '방귀를 골라도 글자마다 그 소리가 나지 않습니다.');
const bangTap = sources.at(-1).buffer.length;
playTypeSound('space');
check(sources.at(-1).buffer.length === bangTap, '방귀 스페이스가 main처럼 글자 소리와 같지 않습니다.');
/** 예전 소리는 크기 0.032, 음높이 ±3%(0.97~1.03)가 main 그대로여야 합니다. */
const realRandom = Math.random;
for (const id of MAIN_TYPE_VOICE_IDS) {
    setTypeVoice(id);
    [0, 1].forEach((roll, index) => {
        Math.random = () => roll;
        playTypeSound();
        Math.random = realRandom;
        const rateNow = sources.at(-1).playbackRate.value;
        check(Math.abs(rateNow - MAIN_TYPE_PITCH[index]) < 1e-9, `${id} 음높이 흔들림이 main(${MAIN_TYPE_PITCH[index]})과 다릅니다. ${rateNow}`);
        check(gains.at(-1).gain.value === MAIN_TYPE_GAIN, `${id} 크기가 main(${MAIN_TYPE_GAIN})과 다릅니다. ${gains.at(-1).gain.value}`);
    });
}
/** 새 소리는 스페이스·엔터·지우기를 따로 칩니다. */
const newVoice = TYPE_VOICES.find((voice) => !MAIN_TYPE_VOICE_IDS.includes(voice.id)).id;
setTypeVoice(newVoice);
const field = { tagName: 'TEXTAREA' };
check(noteTypeKey({ key: ' ', target: field }, 90000) === 'space', '스페이스를 글자 소리로 치지 않습니다.');
check(noteTypeInput({ inputType: 'insertText', data: ' ', target: field }, 90005) === false, '스페이스 입력 소리가 한 번 더 납니다.');
check(noteTypeKey({ key: 'Enter', target: field, isComposing: true }, 91000) === '', '조합 중인 엔터에도 소리가 납니다.');
check(noteTypeKey({ key: 'Backspace', target: field, repeat: true }, 92000) === '', '지우기 키를 누르고 있으면 소리가 반복됩니다.');
check(noteTypeKey({ key: 'Delete', target: field, repeat: true }, 92100) === '', 'Delete 키를 누르고 있으면 소리가 반복됩니다.');
check(noteTypeKey({ key: 'Backspace', target: field }, 92200) === 'delete', '지우기 키 한 번을 소리 내지 않습니다.');

/** QA 9차 legacyplay9: 예전 소리는 엔터·지우기에 소리가 없고, 글자·스페이스·방향키 울림 횟수가 main과 같아야 합니다. */
let typeClock = 200000;
function typeRun(lines, pr) {
    let count = 0;
    let at = (typeClock += 5000);
    if (!pr) resetMainTypeInput();
    for (const [key, inputType, data, target] of lines) {
        at += 120;
        if (pr && noteTypeKey({ key, target }, at)) count += 1;
        if (!inputType) continue;
        const event = { inputType, data, target, isComposing: false };
        if (pr ? noteTypeInput(event, at + 1) : mainNoteTypeInput(event, at + 1)) count += 1;
    }
    return count;
}
const plainInput = { tagName: 'INPUT', type: 'text' };
const strokes = (target, enterType) => [
    ['a', 'insertText', 'a', target],
    ['b', 'insertText', 'b', target],
    [' ', 'insertText', ' ', target],
    ['c', 'insertText', 'c', target],
    ['ArrowLeft', '', null, target],
    ['ArrowRight', '', null, target],
    ['Backspace', 'deleteContentBackward', null, target],
    ['Delete', 'deleteContentForward', null, target],
    ['Enter', enterType, null, target],
];
for (const id of MAIN_TYPE_VOICE_IDS) {
    setTypeVoice(id);
    for (const [label, lines] of [['한 줄 칸', strokes(plainInput, '')], ['여러 줄 칸', strokes(field, 'insertLineBreak')]]) {
        const pr = typeRun(lines, true);
        const main = typeRun(lines, false);
        check(pr === main && main === 4, `${id} ${label}에서 'ab c'+방향키+지우기+엔터 울림이 main(${main})과 다릅니다. ${pr}`);
    }
    for (const key of ['Enter', 'Backspace', 'Delete', ' ']) {
        check(noteTypeKey({ key, target: field }, (typeClock += 500)) === '', `${id} 를 골랐는데 ${key} 키에서 따로 소리가 납니다.`);
    }
}
setTypeVoice(newVoice);

resetTypeGraphForTest();
const burstSources = [];
const burstGains = [];
const burstShapers = [];
class BurstParam {
    constructor() {
        this.value = 0;
        this.events = [];
    }
    setValueAtTime(value, time) {
        this.events.push({ type: 'set', value, time });
        this.value = value;
    }
    linearRampToValueAtTime(value, time) {
        this.events.push({ type: 'ramp', value, time });
    }
    cancelScheduledValues() {
        this.events.push({ type: 'cancel' });
    }
}
class BurstAudio {
    constructor() {
        this.state = 'running';
        this.sampleRate = 48000;
        this.currentTime = 0;
        this.destination = { destination: true };
    }
    createBuffer(_channels, length, sampleRate) {
        const data = new Float32Array(length);
        return { length, sampleRate, duration: length / sampleRate, getChannelData: () => data };
    }
    createBufferSource() {
        const src = {
            buffer: null,
            playbackRate: { value: 1 },
            connect() {},
            disconnect() {},
            start() { src.started = true; },
            stop(time) { src.stopped = true; src.stopTime = time; },
            onended: null,
        };
        burstSources.push(src);
        return src;
    }
    createGain() {
        const gain = {
            gain: new BurstParam(),
            connected: null,
            connect(node) { gain.connected = node; },
            disconnect() {},
        };
        burstGains.push(gain);
        return gain;
    }
    createWaveShaper() {
        const shaper = {
            curve: null,
            oversample: 'none',
            connected: null,
            connect(node) { shaper.connected = node; },
        };
        burstShapers.push(shaper);
        return shaper;
    }
    resume() { return Promise.resolve(); }
}
const burstAudio = new BurstAudio();
scheduleTypeBurst(burstAudio, { voice: 'black', count: 8, gapSec: 0, when: 0 });
const runningBurst = burstSources.filter((src) => src.stopTime == null);
check(burstSources.length === 8, '실제 재생이 여덟 타를 만들지 않습니다.');
check(runningBurst.length <= 6 && runningBurst.length >= 1, '동시에 여섯 개를 넘기거나 모두 끊습니다.');
const faded = burstGains.filter((gain) => gain.gain.events.some((event) => event.type === 'ramp' && event.value === 0 && event.time >= 0.016));
check(faded.length >= 2, '오래된 소리를 페이드 없이 바로 끊습니다.');
check(faded.every((gain) => gain.gain.events.some((event) => event.type === 'set' && event.value > 0.01)), '페이드가 나고 있던 크기가 아니라 0에서 시작합니다.');
check(burstSources.filter((src) => typeof src.stopTime === 'number' && src.stopTime >= 0.016).length >= 2, '페이드가 끝나기 전에 소리를 끊습니다.');
function limitsTypeBus(node) {
    if (!node || node.destination) return false;
    if (node.curve && typeof node.curve.length === 'number') {
        const curve = node.curve;
        const last = curve[curve.length - 1];
        const mid = curve[(curve.length - 1) >> 1];
        const small = curve[Math.round((curve.length - 1) * 0.55)];
        return Math.abs(mid) < 0.05 && last > 0.4 && last < 0.95 && small > 0.04 && small < 0.14;
    }
    const threshold = node.threshold?.value;
    const ratio = node.ratio?.value;
    const attack = node.attack?.value;
    return Number.isFinite(threshold) && threshold >= -3 && ratio >= 8 && Number.isFinite(attack) && attack <= 0.005;
}
check(burstShapers.length === 1 && limitsTypeBus(burstGains.at(-1)?.connected) && burstGains.at(-1).connected.connected === burstAudio.destination, '실제 재생 경로에 리미터가 없습니다.');

/** 소리는 2ms 동안 0에서 크기까지 올라옵니다(딸깍 소리 방지). 예전 소리와 새 소리 모두 같은 길입니다. */
resetTypeGraphForTest();
burstGains.length = 0;
scheduleTypeBurst(burstAudio, { voice: 'bang', count: 2, gapSec: 0.05, when: 1 });
scheduleTypeBurst(burstAudio, { voice: newVoice, count: 2, gapSec: 0.05, when: 2 });
const rampStarts = [1, 1.05, 2, 2.05];
const typeGains = burstGains.filter((gain) => gain.gain.events.some((event) => event.type === 'ramp' && event.value > 0));
check(typeGains.length === 4 && typeGains.every((gain, index) => {
    const [set, ramp] = gain.gain.events;
    const when = rampStarts[index];
    return set?.type === 'set' && set.value === 0 && Math.abs(set.time - when) < 1e-9
        && ramp?.type === 'ramp' && ramp.value > 0.01 && ramp.value <= 0.049 && Math.abs(ramp.time - (when + 0.002)) < 1e-9;
}), `글자 소리 시작 램프가 0에서 2ms가 아닙니다. ${JSON.stringify(typeGains.map((gain) => gain.gain.events.slice(0, 2)))}`);


/** 누를 때 소리를 낼 곳: 실제 PRESS_SELECTOR 문자열을 읽어 가짜 요소에 맞춰 봅니다. */
function simpleMatch(el, sel) {
    if (sel.trim() === ':disabled') return Boolean(el.pseudoDisabled);
    const m = sel.trim().match(/^([a-z]*)((?:\.[\w-]+)*)((?:\[[^\]]+\])*)$/i);
    if (!m) throw new Error(`모르는 선택자 ${sel}`);
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    for (const cls of m[2].split('.').filter(Boolean)) if (!el.classList.includes(cls)) return false;
    for (const [, name, value] of m[3].matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)) {
        if (value === undefined ? !(name in el.attrs) : el.attrs[name] !== value) return false;
    }
    return true;
}
function fakeEl(tag, attrs = {}, parent = null) {
    const el = {
        tagName: tag.toUpperCase(),
        attrs,
        parentElement: parent,
        classList: String(attrs.class || '').split(' ').filter(Boolean),
        getAttribute: (name) => (name in attrs ? attrs[name] : null),
        hasAttribute: (name) => name in attrs,
        matches: (sel) => sel.split(',').some((part) => simpleMatch(el, part)),
        closest(sel) {
            for (let node = el; node; node = node.parentElement) if (node.matches(sel)) return node;
            return null;
        },
    };
    if (attrs.type) el.type = attrs.type;
    return el;
}
const inside = (tag, attrs) => {
    const host = fakeEl(tag, attrs);
    return { host, child: fakeEl('span', {}, host) };
};
const sounding = [
    ['버튼', 'button', {}],
    ['링크', 'a', { href: '#/' }],
    ['칩 라벨', 'label', { class: 'chip' }],
    ['role=button', 'div', { role: 'button' }],
    ['탭', 'div', { role: 'tab' }],
    ['켜고 끄는 단추', 'div', { role: 'switch', 'aria-checked': 'false' }],
    ['메뉴 항목', 'div', { role: 'menuitem' }],
    ['체크 칸', 'input', { type: 'checkbox' }],
    ['동그라미 칸', 'input', { type: 'radio' }],
    ['고르기 칸', 'select', {}],
    ['펼치기', 'summary', {}],
    ['하단 키캡', 'div', { class: 'fab' }],
    ['넓은 화면 키캡', 'div', { class: 'desk-fab' }],
    ['이름에 인증이 들어간 버튼', 'button', { 'aria-label': '인증 메일 다시 보내기' }],
];
for (const [label, tag, attrs] of sounding) {
    const { host, child } = inside(tag, attrs);
    check(pressTarget(child) === host && pressTarget(host) === host, `${label}을 눌러도 소리가 나지 않습니다.`);
}
const wrapped = fakeEl('label');
const box = fakeEl('input', { type: 'checkbox' }, wrapped);
wrapped.control = box;
check(pressTarget(fakeEl('span', {}, wrapped)) === box, '체크 칸 이름을 눌러도 소리가 나지 않습니다.');
const silent = [
    ['꺼진 버튼', 'button', { disabled: '' }],
    ['aria-disabled 탭', 'div', { role: 'tab', 'aria-disabled': 'true' }],
    ['aria-disabled 단추', 'div', { role: 'switch', 'aria-disabled': 'true' }],
    ['꺼진 체크 칸', 'input', { type: 'checkbox', disabled: '' }],
    ['비밀번호 칸', 'input', { type: 'password' }],
    ['글 입력칸', 'input', { type: 'text' }],
    ['검색 칸', 'input', { type: 'search' }],
    ['여러 줄 칸', 'textarea', {}],
    ['민감한 체크 칸', 'input', { type: 'checkbox', 'data-sensitive': '1' }],
    ['민감한 버튼', 'button', { 'data-sensitive': '1' }],
    ['민감한 role=button', 'div', { role: 'button', 'data-sensitive': '' }],
    ['민감한 링크', 'a', { href: '#/', 'data-sensitive': '1' }],
    ['인증 고르기 칸', 'select', { 'aria-label': '인증 방법' }],
    ['비밀번호 보기 체크 칸', 'input', { type: 'checkbox', name: 'show-password' }],
];
for (const [label, tag, attrs] of silent) {
    const { host, child } = inside(tag, attrs);
    check(pressTarget(child) === null && pressTarget(host) === null, `${label}에서 소리가 납니다.`);
}
/** 꺼짐 판단: :disabled, 꺼진 fieldset 안, 바깥 aria-disabled, 바깥 data-sensitive 를 하나씩 봅니다. */
const inheritOff = fakeEl('button');
inheritOff.pseudoDisabled = true;
check(pressTarget(inheritOff) === null && pressTarget(fakeEl('span', {}, inheritOff)) === null, ':disabled 로 꺼진 버튼에서 소리가 납니다.');
const offSet = fakeEl('fieldset', { disabled: '' });
const offSetButton = fakeEl('button', {}, offSet);
check(pressTarget(offSetButton) === null && pressTarget(fakeEl('span', {}, offSetButton)) === null, '꺼진 fieldset 안 버튼에서 소리가 납니다.');
const offSetTab = fakeEl('div', { role: 'tab' }, fakeEl('div', {}, offSet));
check(pressTarget(offSetTab) === null, '꺼진 fieldset 안 탭에서 소리가 납니다.');
const onSet = fakeEl('fieldset');
const onSetButton = fakeEl('button', {}, onSet);
check(pressTarget(onSetButton) === onSetButton, '켜진 fieldset 안 버튼이 조용합니다.');
/** QA 2차 N3: HTML 규칙처럼 꺼진 fieldset의 첫 legend 안은 켜져 있습니다. 두 번째 legend와 legend 밖은 꺼져 있습니다. */
const legendSet = fakeEl('fieldset', { disabled: '' });
const firstLegend = fakeEl('legend', {}, legendSet);
const secondLegend = fakeEl('legend', {}, legendSet);
const bodyDiv = fakeEl('div', {}, legendSet);
legendSet.children = [fakeEl('div', {}, legendSet), firstLegend, secondLegend, bodyDiv];
const legendButton = fakeEl('button', {}, firstLegend);
check(pressTarget(legendButton) === legendButton && pressTarget(fakeEl('span', {}, legendButton)) === legendButton, '꺼진 fieldset의 첫 legend 안 버튼이 조용합니다.');
check(pressTarget(fakeEl('button', {}, secondLegend)) === null, '꺼진 fieldset의 두 번째 legend 안 버튼에서 소리가 납니다.');
check(pressTarget(fakeEl('button', {}, bodyDiv)) === null, '꺼진 fieldset의 legend 밖 버튼에서 소리가 납니다.');
const outerOff = fakeEl('fieldset', { disabled: '' });
const innerSet = fakeEl('fieldset', { disabled: '' }, outerOff);
const innerLegendButton = fakeEl('button', {}, fakeEl('legend', {}, innerSet));
check(pressTarget(innerLegendButton) === null, '바깥 fieldset이 꺼졌는데 안쪽 legend 버튼에서 소리가 납니다.');
const outerLegendSet = fakeEl('fieldset', { disabled: '' });
const outerLegend = fakeEl('legend', {}, outerLegendSet);
const nestedOn = fakeEl('button', {}, fakeEl('fieldset', {}, outerLegend));
check(pressTarget(nestedOn) === nestedOn, '첫 legend 안 켜진 fieldset 버튼이 조용합니다.');
const ariaOffGroup = fakeEl('div', { 'aria-disabled': 'true' });
const ariaOffButton = fakeEl('button', {}, ariaOffGroup);
check(pressTarget(ariaOffButton) === null && pressTarget(fakeEl('span', {}, ariaOffButton)) === null, 'aria-disabled 묶음 안 버튼에서 소리가 납니다.');
const ariaOnButton = fakeEl('button', { 'aria-disabled': 'false' });
check(pressTarget(ariaOnButton) === ariaOnButton, 'aria-disabled="false" 버튼이 조용합니다.');
const secretBox = fakeEl('div', { 'data-sensitive': '1' });
const secretButton = fakeEl('button', {}, secretBox);
check(pressTarget(secretButton) === null && pressTarget(fakeEl('span', {}, secretButton)) === null, 'data-sensitive 묶음 안 버튼에서 소리가 납니다.');
const secretLabel = fakeEl('label', {}, secretBox);
secretLabel.control = fakeEl('input', { type: 'checkbox' });
check(pressTarget(fakeEl('span', {}, secretLabel)) === null, 'data-sensitive 묶음 안 체크 칸 이름에서 소리가 납니다.');
const farLabel = fakeEl('label');
farLabel.control = fakeEl('input', { type: 'checkbox' }, fakeEl('div', { 'data-sensitive': '1' }));
check(pressTarget(fakeEl('span', {}, farLabel)) === null, '바깥 이름표가 data-sensitive 묶음 안 체크 칸을 가리킬 때 소리가 납니다.');
const farOffLabel = fakeEl('label');
farOffLabel.control = fakeEl('input', { type: 'checkbox' }, fakeEl('fieldset', { disabled: '' }));
check(pressTarget(fakeEl('span', {}, farOffLabel)) === null, '바깥 이름표가 꺼진 fieldset 안 체크 칸을 가리킬 때 소리가 납니다.');
const farAriaLabel = fakeEl('label');
farAriaLabel.control = fakeEl('input', { type: 'checkbox' }, fakeEl('div', { 'aria-disabled': 'true' }));
check(pressTarget(fakeEl('span', {}, farAriaLabel)) === null, '바깥 이름표가 aria-disabled 묶음 안 체크 칸을 가리킬 때 소리가 납니다.');

const chipField = fakeEl('label', { class: 'chip' });
check(pressTarget(fakeEl('input', { type: 'text' }, chipField)) === null, '칩 안 글 입력칸에서 소리가 납니다.');
const textLabel = fakeEl('label');
textLabel.control = fakeEl('input', { type: 'text' });
check(pressTarget(fakeEl('span', {}, textLabel)) === null, '글 입력칸 이름을 누르면 소리가 납니다.');
check(pressTarget(fakeEl('div')) === null && pressTarget(null) === null, '아무것도 아닌 곳에서 소리가 납니다.');
for (const sel of ['button', 'a', 'label.chip', '[role="button"]']) check(PRESS_SELECTOR.split(', ').includes(sel), `예전 누름 대상 ${sel}이 빠졌습니다.`);

/** 저장값 옮기기: 글자 소리를 켜 둔(type-sound=1) 기기만 글자 소리 종류를 한 번 누를 때 소리로 가져오고, 원래 값은 그대로 둡니다. */
const moveBag = memory();
moveBag.setItem('ssug-gyomu-type-sound', '1');
moveBag.setItem('ssug-gyomu-type-voice', 'ting');
check(keyVoiceId(moveBag) === 'ting' && moveBag.getItem('ssug-gyomu-key-voice') === 'ting' && moveBag.getItem('ssug-gyomu-type-voice') === 'ting', '글자 소리 종류를 누를 때 소리로 한 번 가져오지 않습니다.');
setKeyVoice('click', moveBag);
check(keyVoiceId(moveBag) === 'click' && moveBag.getItem('ssug-gyomu-type-voice') === 'ting', '옮긴 뒤 고른 누를 때 소리를 글자 소리가 다시 덮습니다.');
const keepBag = memory();
keepBag.setItem('ssug-gyomu-type-sound', '1');
keepBag.setItem('ssug-gyomu-key-voice', 'mongdol');
keepBag.setItem('ssug-gyomu-type-voice', 'bang');
check(keyVoiceId(keepBag) === 'mongdol' && keepBag.getItem('ssug-gyomu-type-voice') === 'bang', '이미 고른 누를 때 소리를 글자 소리가 덮습니다.');
const freshBag = memory();
check(keyVoiceId(freshBag) === 'munggeul' && keyVolumeId(freshBag) === 'small' && freshBag.getItem('ssug-gyomu-key-voice') === null, '처음 쓰는 기기의 몽글·작게가 바뀌거나 값을 새로 씁니다.');
/** QA 1차: 글자 소리를 켠 적 없이 종류만 남은 기기(type-voice=bang, key-voice·type-sound 없음)는 몽글 그대로입니다. */
const bangOnlyBag = memory();
bangOnlyBag.setItem('ssug-gyomu-type-voice', 'bang');
check(keyVoiceId(bangOnlyBag) === 'munggeul' && bangOnlyBag.getItem('ssug-gyomu-key-voice') === null && bangOnlyBag.getItem('ssug-gyomu-type-voice') === 'bang', '글자 소리를 켠 적 없는 기기의 남은 종류(방귀)를 누를 때 소리로 옮깁니다.');
for (const off of ['0', '', 'true']) {
    const bag = memory();
    bag.setItem('ssug-gyomu-type-sound', off);
    bag.setItem('ssug-gyomu-type-voice', 'ting');
    check(keyVoiceId(bag) === 'munggeul' && bag.getItem('ssug-gyomu-key-voice') === null, `글자 소리가 '${off}'인 기기의 종류를 옮깁니다.`);
}
/** main은 모르는 글자 소리 값이면 뽁을 냈습니다. 그 소리를 옮기되 글자 소리 저장값은 그대로 둡니다. */
const oddBag = memory();
oddBag.setItem('ssug-gyomu-type-sound', '1');
oddBag.setItem('ssug-gyomu-type-voice', 'nothing');
check(keyVoiceId(oddBag) === 'ppok' && oddBag.getItem('ssug-gyomu-key-voice') === 'ppok' && oddBag.getItem('ssug-gyomu-type-voice') === 'nothing', '모르는 글자 소리 값을 main처럼 뽁으로 옮기지 않거나 저장값을 지웁니다.');
/** QA 2차 N1: 실제로 옮긴 기기에만 안내가 남고, 닫으면 다시 나오지 않습니다. */
const caseH = memory();
caseH.setItem('ssug-gyomu-type-sound', '1');
check(keyVoiceMoved(caseH) === 'ppok' && caseH.getItem('ssug-gyomu-key-voice') === 'ppok' && caseH.getItem('ssug-gyomu-key-voice-moved') === 'ppok', 'H: 글자 소리만 켠 기기가 main 기본 뽁으로 옮겨지지 않거나 안내가 없습니다.');
check(caseH.getItem('ssug-gyomu-type-voice') === null, 'H: 글자 소리 종류를 새로 적습니다.');
check(closeKeyVoiceMoved(caseH) === true && keyVoiceMoved(caseH) === null && caseH.getItem('ssug-gyomu-key-voice-moved') === 'closed', 'H: 안내를 닫아도 남습니다.');
check(keyVoiceId(caseH) === 'ppok' && keyVoiceMoved(caseH) === null, 'H: 닫은 안내가 다시 나옵니다.');
const caseK = memory();
caseK.setItem('ssug-gyomu-type-sound', '1');
caseK.setItem('ssug-gyomu-type-voice', 'bang');
caseK.setItem('ssug-gyomu-key-voice', 'linear');
check(keyVoiceId(caseK) === 'linear' && keyVoiceMoved(caseK) === null && caseK.getItem('ssug-gyomu-key-voice-moved') === null, 'K: 이미 고른 누를 때 소리가 있는데 옮기거나 안내합니다.');
const caseL = memory();
caseL.setItem('ssug-gyomu-type-sound', '1');
caseL.setItem('ssug-gyomu-type-voice', 'blue');
caseL.setItem('ssug-gyomu-key-sound', '0');
check(keyVoiceMoved(caseL) === 'blue' && keySoundEnabled(caseL) === false, 'L: 누를 때 소리를 끈 기기에서 옮김 값이나 꺼짐이 맞지 않습니다.');
const caseOff = memory();
caseOff.setItem('ssug-gyomu-type-voice', 'blue');
check(keyVoiceMoved(caseOff) === null && caseOff.getItem('ssug-gyomu-key-voice') === null, '글자 소리를 끈 기기에 옮김 안내가 나옵니다.');
for (const voice of TYPE_VOICES) {
    const bag = memory();
    check(setKeyVoice(voice.id, bag) === voice.id && keyVoiceId(bag) === voice.id, `누를 때 소리로 ${voice.label}을 고를 수 없습니다.`);
}

/** 연타 30번×15ms: 모든 소리, 크게, 44.1k·48k에서 피크 1 미만, 샘플 간 점프는 소리 하나일 때의 1.25배 안. */
check(MAX_KEY_VOICES === 6 && KEY_FADE_SEC >= 0.002 && KEY_FADE_SEC <= 0.005, '동시 소리 상한 6이나 2~5ms 페이드가 아닙니다.');
check(MAX_KEY_VOICES * 0.9 * keyVolumeGain('loud') < 1, '여섯 소리가 모두 겹쳐도 1을 넘을 수 있습니다.');
const pressBurst = { peak: 0, jump: 0, ratio: 0, line: '' };
for (const sampleRate of [44100, 48000]) {
    for (const voice of [...KEY_VOICES, ...TYPE_VOICES]) {
        const burst = mixKeyBurst({ voice: voice.id, volume: 'loud', count: 30, gapMs: 15, sampleRate });
        const ratio = burst.maxJump / burst.soloJump;
        if (burst.peak > pressBurst.peak) Object.assign(pressBurst, { peak: burst.peak, line: `${voice.id}@${sampleRate}` });
        pressBurst.jump = Math.max(pressBurst.jump, burst.maxJump);
        pressBurst.ratio = Math.max(pressBurst.ratio, ratio);
        check(burst.peak < 1 && burst.peak > 0, `${voice.label} 30×15ms 연타 피크가 1 이상입니다. ${sampleRate} ${burst.peak}`);
        check(ratio <= 1.25, `${voice.label} 30×15ms 연타에 갑작스러운 튐이 있습니다. ${sampleRate} 점프 ${burst.maxJump.toFixed(4)} / 하나 ${burst.soloJump.toFixed(4)}`);
        check(burst.maxVoices <= MAX_KEY_VOICES, `${voice.label} 연타에 소리가 여섯 개 넘게 겹칩니다.`);
        for (const gapMs of [0, 0.5, 1, 2]) {
            const fast = mixKeyBurst({ voice: voice.id, volume: 'loud', count: 30, gapMs, sampleRate });
            check(fast.maxVoices <= MAX_KEY_VOICES && fast.peak < MAX_KEY_VOICES * 0.9 * keyVolumeGain('loud') + 1e-6, `${voice.label} ${gapMs}ms 연타가 상한을 넘습니다. ${fast.maxVoices}개 ${fast.peak}`);
        }
    }
}
console.log(`누름 연타 30×15ms 최대 피크 ${pressBurst.peak.toFixed(4)} (${pressBurst.line}), 최대 점프 ${pressBurst.jump.toFixed(4)}, 하나 대비 ${pressBurst.ratio.toFixed(2)}배`);

/** 실제 재생: 앞 소리는 바로 끊지 않고 2~5ms로 줄이고, 들리는 소리는 여섯 개를 넘지 않습니다. */
const liveAudio = unlockKeyAudio();
const liveSources = [];
const liveGains = [];
FakeAudioContext.prototype.createBufferSource = function createRampSource() {
    const src = {
        buffer: null,
        playbackRate: { value: 1 },
        connect() {},
        disconnect() {},
        start(time) { src.startAt = time; },
        stop(time) { src.stopAt = time ?? liveAudio.currentTime; },
    };
    liveSources.push(src);
    return src;
};
FakeAudioContext.prototype.createGain = function createRampGain() {
    const events = [];
    const gain = {
        gain: {
            value: 0,
            events,
            cancelScheduledValues() {},
            setValueAtTime(value, time) { events.push({ type: 'set', value, time }); },
            linearRampToValueAtTime(value, time) { events.push({ type: 'ramp', value, time }); },
        },
        connect() {},
        disconnect() {},
    };
    liveGains.push(gain);
    return gain;
};
const audibleAt = (now) => liveSources.filter((src, index) => {
    if (src.startAt > now + 1e-9) return false;
    if (src.startAt + src.buffer.length / src.buffer.sampleRate / (src.playbackRate.value || 1) <= now + 1e-9) return false;
    if (src.stopAt != null && src.stopAt <= now + 1e-9) return false;
    const ramp = liveGains[index].gain.events.filter((event) => event.type === 'ramp').at(-1);
    return !ramp || ramp.time > now + 1e-9;
}).length;
setKeyMuted(false);
setKeySound(true);
setKeyVoice('click');
setKeyVolume('loud');
let liveWorst = 0;
for (let i = 0; i < 30; i += 1) {
    liveAudio.currentTime = 10 + i * 0.015;
    playKey('down');
    liveWorst = Math.max(liveWorst, audibleAt(liveAudio.currentTime));
}
const cutEarly = liveSources.slice(0, -1).filter((src, index) => {
    const events = liveGains[index].gain.events;
    const set = events.find((event) => event.type === 'set');
    const ramp = events.find((event) => event.type === 'ramp');
    if (!set || !ramp || ramp.value !== 0) return true;
    const span = ramp.time - set.time;
    return span < 0.002 - 1e-9 || span > 0.005 + 1e-9 || src.stopAt < ramp.time;
});
check(liveSources.length === 30 && cutEarly.length === 0 && liveWorst <= 2, `연타에서 앞 소리를 페이드 없이 끊습니다. ${cutEarly.length}개, 겹침 ${liveWorst}`);
let crowdWorst = 0;
for (let i = 0; i < 20; i += 1) {
    liveAudio.currentTime = 20 + i * 0.0005;
    playKey('down');
    crowdWorst = Math.max(crowdWorst, audibleAt(liveAudio.currentTime));
}
check(crowdWorst <= MAX_KEY_VOICES, `아주 빠른 연타에 소리가 ${crowdWorst}개 겹칩니다.`);
liveAudio.currentTime = 30;
setKeyVoice('ppok');
const ppokFrom = liveSources.length;
playKey('down');
playKey('up');
const ppokTap = renderTypeStroke('ppok', 'tap', rate).samples.length;
check(liveSources.length === ppokFrom + 1 && liveSources.at(-1).buffer.length === ppokTap, '뽁을 골랐는데 누를 때 한 번만 나지 않습니다.');
const ppokEvents = liveGains.at(-1).gain.events;
check(liveSources.at(-1).stopAt == null && !ppokEvents.some((event) => event.type === 'ramp' && event.value === 0), '뽁을 떼면 누를 때 소리가 끊깁니다.');
/** QA 2차 N2: 옮겨 온 소리의 음높이 흔들림은 main 글자 소리(MAIN_TYPE_PITCH)와 같습니다. 다른 소리는 0.94–1.06 입니다. */
check(['ppok', 'ting', 'drop', 'bang'].every((voice) => Math.abs(pressRate(voice, () => 0) - 0.97) < 1e-9 && Math.abs(pressRate(voice, () => 1) - 1.03) < 1e-9)
    && Math.abs(pressRate('red', () => 0) - 0.96) < 1e-9 && Math.abs(pressRate('red', () => 1) - 1.08) < 1e-9
    && Math.abs(pressRate('munggeul', () => 0) - keyPitchRate(() => 0)) < 1e-9, '옮겨 온 소리의 음높이 흔들림이 글자 소리와 다릅니다.');
/** QA 2차 N2: 옮겨 온 소리는 main 글자 소리처럼 0에서 2ms 동안 키우며 시작합니다. */
check(ppokEvents.length === 2 && ppokEvents[0].type === 'set' && ppokEvents[0].value === 0 && ppokEvents[1].type === 'ramp'
    && Math.abs(ppokEvents[1].time - ppokEvents[0].time - 0.002) < 1e-9 && ppokEvents[1].value > 0, `옮겨 온 뽁이 2ms 페이드인 없이 시작합니다. ${JSON.stringify(ppokEvents)}`);
previewKeyVoice('bang');
check(liveSources.length === ppokFrom + 2, '방귀 미리듣기가 한 번 나지 않습니다.');
setKeyVoice('munggeul');
playKey('down');
playKey('up');
check(liveSources.length === ppokFrom + 4, '몽글은 누를 때와 뗄 때 두 번 나야 합니다.');
setKeyMuted(true);
check(liveSources.at(-1).stopAt != null, '받아쓰기 중에 누를 때 소리를 끊지 않습니다.');
playKey('down');
check(liveSources.length === ppokFrom + 4, '받아쓰기 중에 누를 때 소리가 납니다.');
setKeyMuted(false);

const root = new URL('..', import.meta.url).pathname;
const feel = readFileSync(`${root}/src/ui/keyfeel.js`, 'utf8');
/** 연타 측정(mixTypeBurst)의 예전 소리 음높이도 실제 재생처럼 main의 ±3%(0.97~1.03)여야 합니다. */
const typeSource = readFileSync(`${root}/src/ui/typesound.js`, 'utf8');
const burstPitch = typeSource.slice(typeSource.indexOf('export function mixTypeBurst')).match(/const pitch = legacy \? ([^:]+) :/);
const burstRates = burstPitch ? Array.from({ length: 100 }, (_, n) => Function('n', `return ${burstPitch[1]};`)(n)) : [];
check(
    burstRates.length === 100 && Math.abs(Math.min(...burstRates) - MAIN_TYPE_PITCH[0]) < 1e-9 && Math.max(...burstRates) < MAIN_TYPE_PITCH[1] && Math.max(...burstRates) > MAIN_TYPE_PITCH[1] - 0.001,
    `연타 측정의 예전 소리 음높이가 main(${MAIN_TYPE_PITCH.join('~')})과 다릅니다. ${burstPitch?.[1]}`,
);
const settings = readFileSync(`${root}/src/ui/Settings.jsx`, 'utf8');
const speech = readFileSync(`${root}/src/ui/useSpeechDictation.js`, 'utf8');
const db = readFileSync(`${root}/src/lib/db.js`, 'utf8');
const sw = readFileSync(`${root}/public/sw.js`, 'utf8');
check(feel.includes("const SOUND_KEY = 'ssug-gyomu-key-sound'"), '소리 켜기 키가 바뀌었습니다.');
check(feel.includes("const VIBE_KEY = 'ssug-gyomu-key-vibrate'"), '진동 키가 바뀌었습니다.');
check(db.includes("createVault('ssug-gyomu')") && db.includes("createVault('ssug-gyomu-local')"), '내부 저장 키가 바뀌었습니다.');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v23'"), '서비스 워커가 v23이 아닙니다.');
check(sw.includes('function staleAssetUrls') && sw.includes('/* stale-assets-end */'), '옛 assets 정리가 빠졌습니다.');
check(speech.includes('setKeyMuted(listening)'), '받아쓰기 중에 소리를 끄지 않습니다.');
check(!settings.includes('<select') && settings.includes('누를 때 소리 종류') && settings.includes('role="group"'), '소리 고르기가 칩이 아닙니다.');
check(settings.includes('KEY_VOICES.map') && settings.includes('KEY_VOLUMES.map') && settings.includes('data-key-preview'), '설정이 소리 칩을 그리지 않습니다.');
check(settings.includes('꺼 두어도 여기서는 미리 들어 볼 수 있어요'), '꺼 둔 미리듣기 안내가 없습니다.');
for (const label of ['몽글', '몽돌', '적축', '갈축', '청축', '끌기', '작게', '보통', '크게']) {
    check(feel.includes(`'${label}'`) || settings.includes(label), `소리 이름 ${label} 이 없습니다.`);
}

/** 글자 소리는 숨겨 둡니다: 설정에 칸이 없고, 켜 둔 기기에서도 입력 연결이 소리를 부르지 않으며, 저장값은 그대로 둡니다. */
const appSource = readFileSync(`${root}/src/App.jsx`, 'utf8');
check(TYPE_SOUND_SHOWN === false, '글자 소리가 다시 보입니다.');
const hideFrom = settings.indexOf('{TYPE_SOUND_SHOWN && (<>');
const hideTo = settings.indexOf('</>)}', hideFrom);
const typeBits = ['type-picks', 'setTypeSound(', 'previewTypeVoice(', 'setTypeVoice(', '글자 소리 켜짐'];
check(hideFrom > 0 && hideTo > hideFrom && typeBits.every((bit) => {
    let at = settings.indexOf(bit);
    if (at < 0) return false;
    for (; at >= 0; at = settings.indexOf(bit, at + 1)) if (at < hideFrom || at > hideTo) return false;
    return true;
}), '설정에 글자 소리 칸이 숨겨지지 않았습니다.');
check(/const onInput = \(event\) => \{\n\s+if \(!TYPE_SOUND_SHOWN\) return;\n\s+if \(noteTypeInput\(event\)\) playTypeSound\(\);/.test(appSource), '글자 입력 소리 연결이 막혀 있지 않거나 지워졌습니다.');
check(/const onTypeKey = \(event\) => \{\n\s+if \(!TYPE_SOUND_SHOWN\) return;\n\s+const kind = noteTypeKey\(event\);\n\s+if \(kind\) playTypeSound\(kind\);/.test(appSource), '스페이스·엔터 글자 소리 연결이 막혀 있지 않거나 지워졌습니다.');
check(typeSource.includes("const SOUND_KEY = 'ssug-gyomu-type-sound'") && typeSource.includes("'ssug-gyomu-type-voice'"), '글자 소리 저장 키가 바뀌었습니다.');
check(feel.includes("const VOICE_KEY = 'ssug-gyomu-key-voice'") && feel.includes("const VOLUME_KEY = 'ssug-gyomu-key-volume'"), '누를 때 소리 저장 키가 바뀌었습니다.');
check(!/removeItem/.test(feel) && !feel.includes('setItem(TYPE_VOICE_KEY'), '누를 때 소리가 글자 소리 저장값을 지우거나 바꿉니다.');
check(appSource.includes('return pressTarget(target);') && appSource.includes('pressTarget(el) !== el'), '누름과 키보드가 같은 누름 대상 규칙을 쓰지 않습니다.');
check(settings.includes('PRESS_TYPE_VOICES') && settings.includes('aria-label="누를 때 장난 소리"'), '누를 때 소리 종류에 뽁·띵·방귀 같은 소리가 없습니다.');
/** QA 1차: 겹치는 칩 이름, 안내 순서, 글자 소리를 켜 둔 기기 안내. */
/** QA 2차: 옮겨 온 적축·갈축·청축은 축 이름 뒤에 결을 붙입니다. 화면 읽기 이름도 서로 달라야 합니다. */
const chipMatch = settings.match(/const PRESS_CHIP_NAMES = (\{[^}]+\});/);
const chipMap = chipMatch ? Function(`return ${chipMatch[1]};`)() : null;
const chipNames = chipMap ? TYPE_VOICES.map((voice) => chipMap[voice.id] || voice.label) : [];
const allChips = [...KEY_VOICES.map((voice) => voice.label), ...chipNames];
check(chipNames.length === TYPE_VOICES.length && new Set(allChips).size === allChips.length, `누를 때 소리 칩 이름이 겹칩니다. ${allChips.join(',')}`);
check(chipMap && chipMap.red === '적축·매끈' && chipMap.brown === '갈축·톡' && chipMap.blue === '청축·딸깍', `옮겨 온 축 이름이 적축·매끈·갈축·톡·청축·딸깍이 아닙니다. ${JSON.stringify(chipMap)}`);
check(TYPE_VOICES.every((voice) => {
    const clash = KEY_VOICES.find((item) => item.label === voice.label);
    return !clash || (chipMap?.[voice.id] || '').startsWith(`${voice.label}·`);
}), '이름이 겹치는 옮겨 온 소리에 결 이름이 붙지 않았습니다.');
const pressAria = [...KEY_VOICES.map((voice) => `${voice.label} ${voice.hint}`), ...TYPE_VOICES.map((voice) => (chipMap?.[voice.id] ? chipMap[voice.id].replace('·', ' ') : `${voice.label} ${voice.hint}`))];
check(new Set(pressAria).size === pressAria.length && settings.includes('ariaLabel={voice.aria}'), `누를 때 소리 화면 읽기 이름이 겹칩니다. ${pressAria.join(',')}`);
check(KEY_VOICES.find((voice) => voice.id === 'munggeul')?.hint === '말랑', '몽글 결 이름이 말랑이 아닙니다.');
const soundFrom = settings.indexOf('<h2 className="title-font" style={{ marginTop: 0 }}>소리</h2>');
const descAt = settings.indexOf('누를 때 소리가 나요', soundFrom);
const kindAt = settings.indexOf('>소리 종류</p>', soundFrom);
const sizeAt = settings.indexOf('>소리 크기</p>', soundFrom);
check(soundFrom > 0 && descAt > soundFrom && descAt < kindAt && kindAt < sizeAt, '설정 소리 칸이 설명 → 종류 → 크기 순서가 아닙니다.');
check(!settings.includes('체크 칸처럼'), '앱에 없는 체크 칸을 예로 듭니다.');
/** QA 2차 N1: 옮긴 기기에만, 지금 켜짐·꺼짐에 맞는 말로, 닫기 단추와 함께 안내합니다. */
const movedAt = settings.indexOf('{movedId && voiceId === movedId && (');
check(movedAt > 0 && movedAt < hideFrom && settings.includes('useState(() => keyVoiceMoved())') && settings.includes('data-type-moved={movedId}'), '실제로 옮긴 기기에만 옮김 안내를 보이지 않습니다.');
check(/\{soundOn \? ' 이제 버튼이나 탭을 누르면 이 소리가 나요\.' : ' 지금은 누를 때 소리가 꺼져 있어요\. 켜면 이 소리로 들려요\.'\}/.test(settings), '옮김 안내가 소리 켜짐·꺼짐에 맞는 말을 고르지 않습니다.');
check(/aria-label="옮긴 소리 안내 닫기" onClick=\{\(\) => \{\s+closeKeyVoiceMoved\(\);\s+setMovedId\(null\);/.test(settings), '옮김 안내에 닫기 단추가 없습니다.');
check(feel.includes("const MOVED_KEY = 'ssug-gyomu-key-voice-moved'"), '옮김 안내 키가 ssug-gyomu-key-voice-moved 가 아닙니다.');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('버튼 소리 검사를 통과했습니다.');
