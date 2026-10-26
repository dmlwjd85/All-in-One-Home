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
import { TYPE_GAIN, TYPE_TARGETS, TYPE_VOICE_MS, TYPE_VOICES, mixTypeBurst, noteTypeInput, noteTypeKey, noteTypeRelease, playTypeSound, previewTypeVoice, renderTypeStroke, renderTypeVoice, resetTypeGraphForTest, scheduleTypeBurst, setTypeSound, setTypeVoice, typePitchForKey, typeVoiceId } from '../src/ui/typesound.js';
import { JAM_KEY, PRESS_HOLD, PRESS_VIBE_MS, jamFeelEnabled, mixJamBurst, renderJamStroke, setJamFeel } from '../src/ui/pressFeel.js';

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
    const expect = Math.round((rate * TYPE_VOICE_MS[voice.id]) / 1000);
    check(samples.length === expect, `${voice.label} 길이가 다릅니다.`);
    check(Math.abs(samples[0]) < 1e-6 && Math.abs(samples[samples.length - 1]) < 1e-6, `${voice.label} 시작·끝이 0이 아닙니다.`);
    const peak = peakOf(samples);
    check(peak > 0.85 && peak < 0.95, `${voice.label} 크기가 맞지 않습니다.`);
    check([...samples].every((sample) => Number.isFinite(sample) && Math.abs(sample) <= 1), `${voice.label} 파형이 범위를 벗어납니다.`);
    for (const kind of ['space', 'enter', 'delete']) {
        const other = renderTypeStroke(voice.id, kind, rate).samples;
        const score = Math.abs(correlation(samples, other));
        check(other.length !== samples.length || score < 0.8, `${voice.label} ${kind} 소리가 글자와 같습니다. ${score.toFixed(2)}`);
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
for (const voice of TYPE_VOICES) {
    check(TYPE_TARGETS[voice.id], `${voice.id} 목표 스위치가 없습니다.`);
    const up = renderTypeStroke(voice.id, 'up', rate).samples;
    const down = typePairs[voice.id].samples;
    check(up.length < down.length, `${voice.label} 뗌이 누름보다 짧지 않습니다.`);
    check(Math.abs(up[0]) < 1e-6 && Math.abs(up[up.length - 1]) < 1e-6, `${voice.label} 뗌 시작·끝이 0이 아닙니다.`);
    const upPeak = peakOf(up);
    check(upPeak > 0.85 && upPeak < 0.95, `${voice.label} 뗌 크기가 맞지 않습니다.`);
    const space = renderTypeStroke(voice.id, 'space', rate).samples;
    check(space.length > down.length, `${voice.label} 스페이스가 글자보다 길지 않습니다.`);
}
const pitchA = typePitchForKey('ㄱ', () => 0.5);
const pitchB = typePitchForKey('ㅎ', () => 0.5);
check(pitchA !== pitchB, '글자마다 높이가 같습니다.');
check(Math.abs(typePitchForKey('ㄱ', () => 0) - typePitchForKey('ㄱ', () => 1)) > 0.01, '같은 글자도 조금 흔들리지 않습니다.');
const voiceStore = memory();
check(typeVoiceId(voiceStore) === 'red', '저장된 글자 소리가 없으면 빨간 직선이 아닙니다.');
check(setTypeVoice('cream', voiceStore) === 'cream' && typeVoiceId(voiceStore) === 'cream', '예전 크림 소리가 읽히지 않습니다.');
check(setTypeVoice('panda', voiceStore) === 'panda' && typeVoiceId(voiceStore) === 'panda', '판다 소리가 저장되지 않습니다.');
check(setTypeVoice('없는소리', voiceStore) === 'red', '모르는 글자 소리를 그대로 둡니다.');
const synthStarted = performance.now();
for (const voice of TYPE_VOICES) {
    renderTypeStroke(voice.id, 'tap', rate);
    renderTypeStroke(voice.id, 'up', rate);
    renderTypeStroke(voice.id, 'space', rate);
}
const synthMs = performance.now() - synthStarted;
console.log(`글자 소리 처음 합성 ${TYPE_VOICES.length * 3}개 ${synthMs.toFixed(1)}ms, 녹음 파일 0바이트`);
check(synthMs < 800, `글자 소리 처음 합성이 느립니다. ${synthMs.toFixed(0)}ms`);

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
setTypeVoice('bang');
playTypeSound();
check(sources.at(-1).buffer.length === Math.round((rate * TYPE_VOICE_MS.bang) / 1000), '방귀를 골라도 글자마다 그 소리가 나지 않습니다.');
const bangTap = sources.at(-1).buffer.length;
playTypeSound('space');
check(sources.at(-1).buffer.length > bangTap, '방귀 스페이스가 글자 소리와 같습니다.');
const field = { tagName: 'TEXTAREA' };
check(noteTypeKey({ key: ' ', target: field }, 90000) === 'space', '스페이스를 글자 소리로 치지 않습니다.');
check(noteTypeInput({ inputType: 'insertText', data: ' ', target: field }, 90005) === false, '스페이스 입력 소리가 한 번 더 납니다.');
check(noteTypeKey({ key: 'Enter', target: field, isComposing: true }, 91000) === '', '조합 중인 엔터에도 소리가 납니다.');
check(noteTypeKey({ key: 'Backspace', target: field, repeat: true }, 92000) === '', '지우기 키를 누르고 있으면 소리가 반복됩니다.');
check(noteTypeKey({ key: 'Delete', target: field, repeat: true }, 92100) === '', 'Delete 키를 누르고 있으면 소리가 반복됩니다.');
check(noteTypeKey({ key: 'Backspace', target: field }, 92200) === 'delete', '지우기 키 한 번을 소리 내지 않습니다.');
check(noteTypeRelease({ key: 'a', target: field }, 93000) === 'up', '글자에서 손을 떼도 소리가 없습니다.');
check(noteTypeRelease({ key: ' ', target: field }, 93100) === 'space-up', '스페이스 뗌이 없습니다.');
check(noteTypeKey({ key: 'Shift', target: field }, 93200) === 'shift', '시프트를 큰 키로 치지 않습니다.');
check(noteTypeKey({ key: 'Tab', target: field }, 93300) === 'tab', '탭을 큰 키로 치지 않습니다.');

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

const jamStore = memory();
check(!jamFeelEnabled(jamStore), '쨈 손맛 기본이 켜져 있습니다.');
check(setJamFeel(true, jamStore) && jamFeelEnabled(jamStore), '쨈 손맛 켜기가 저장되지 않습니다.');
check(setJamFeel(false, jamStore) === false && !jamFeelEnabled(jamStore), '쨈 손맛 끄기가 저장되지 않습니다.');
check(JAM_KEY === 'ssug-gyomu-press-feel', '쨈 손맛 저장 키가 바뀌었습니다.');
check(PRESS_VIBE_MS >= 10 && PRESS_VIBE_MS <= 20, '진동 길이가 10–20ms가 아닙니다.');
check(PRESS_HOLD.x === 1.1 && PRESS_HOLD.y === 0.86, '눌림 크기가 완성본과 다릅니다.');
const foilCss = readFileSync(`${new URL('..', import.meta.url).pathname}/src/ui/foilCup.css`, 'utf8');
check(foilCss.includes('scale(1.1, .86)') && foilCss.includes('cubic-bezier(.28, 1.9, .42, .9)'), '되튐 곡선이 없습니다.');
check(foilCss.includes('transform: none'), '움직임 줄이기에서 눌림을 끄지 않습니다.');
for (const part of ['pop', 'tok']) {
    const stroke = renderJamStroke(part, rate);
    check(Math.abs(stroke.samples[0]) < 1e-6 && Math.abs(stroke.samples.at(-1)) < 1e-6, `${part} 시작·끝이 0이 아닙니다.`);
    const peak = peakOf(stroke.samples);
    check(peak > 0.85 && peak < 0.95, `${part} 크기가 맞지 않습니다.`);
    for (const sampleRate of [44100, 48000]) {
        const burst = mixJamBurst({ part, count: 20, gapMs: 20, fadeMs: 12, sampleRate });
        console.log(`쨈 ${part} 연타 20회 @${sampleRate} peak ${burst.peak.toFixed(4)} jump ${burst.maxJump.toFixed(4)} clip ${burst.clipped}`);
        check(burst.peak <= 1 && burst.peak > 0, `${part} 연타 피크가 1을 넘거나 0입니다.`);
        check(burst.clipped === 0, `${part} 연타가 잘립니다. ${burst.clipped}`);
        check(burst.maxJump < 0.08, `${part} 연타 점프가 큽니다. ${burst.maxJump}`);
    }
}
const popTok = Math.abs(correlation(renderJamStroke('pop', rate).samples, renderJamStroke('tok', rate).samples));
check(popTok < 0.8, `뽁과 톡이 너무 같습니다. ${popTok.toFixed(2)}`);

const root = new URL('..', import.meta.url).pathname;
const feel = readFileSync(`${root}/src/ui/keyfeel.js`, 'utf8');
const settings = readFileSync(`${root}/src/ui/Settings.jsx`, 'utf8');
const speech = readFileSync(`${root}/src/ui/useSpeechDictation.js`, 'utf8');
const db = readFileSync(`${root}/src/lib/db.js`, 'utf8');
const sw = readFileSync(`${root}/public/sw.js`, 'utf8');
check(feel.includes("const SOUND_KEY = 'ssug-gyomu-key-sound'"), '소리 켜기 키가 바뀌었습니다.');
check(feel.includes("const VIBE_KEY = 'ssug-gyomu-key-vibrate'"), '진동 키가 바뀌었습니다.');
check(db.includes("createVault('ssug-gyomu')") && db.includes("createVault('ssug-gyomu-local')"), '내부 저장 키가 바뀌었습니다.');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v18'"), '서비스 워커가 v18이 아닙니다.');
check(sw.includes('function staleAssetUrls') && sw.includes('/* stale-assets-end */'), '옛 assets 정리가 빠졌습니다.');
check(speech.includes('setKeyMuted(listening)'), '받아쓰기 중에 소리를 끄지 않습니다.');
check(!settings.includes('<select') && settings.includes('누를 때 소리 종류') && settings.includes('role="group"'), '소리 고르기가 칩이 아닙니다.');
check(settings.includes('KEY_VOICES.map') && settings.includes('KEY_VOLUMES.map') && settings.includes('data-key-preview'), '설정이 소리 칩을 그리지 않습니다.');
check(settings.includes('쨈 손맛 켜짐') && settings.includes('쨈 손맛 꺼짐') && settings.includes('aria-pressed={jamOn}'), '쨈 손맛 켜기가 없습니다.');
const typeSrc = readFileSync(`${root}/src/ui/typesound.js`, 'utf8');
check(typeSrc.includes("const SOUND_KEY = 'ssug-gyomu-type-sound'") && typeSrc.includes("const VOICE_KEY = 'ssug-gyomu-type-voice'"), '글자 소리 저장 키가 바뀌었습니다.');
check(settings.includes('꺼 두어도 여기서는 미리 들어 볼 수 있어요'), '꺼 둔 미리듣기 안내가 없습니다.');
for (const label of ['몽글', '몽돌', '적축', '갈축', '청축', '끌기', '작게', '보통', '크게']) {
    check(feel.includes(`'${label}'`) || settings.includes(label), `소리 이름 ${label} 이 없습니다.`);
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('버튼 소리 검사를 통과했습니다.');
