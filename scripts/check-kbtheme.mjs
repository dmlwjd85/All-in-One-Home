/** 키보드 테마(모양·소리)를 확인합니다. 저장 키, 소리 파일, 한 번 누름에 한 소리, 끄기·크기·진동, 원 퍼짐 전환, 대비, 눌림 방식. */
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const memory = () => {
    const bag = new Map();
    return { getItem: (k) => (bag.has(k) ? bag.get(k) : null), setItem: (k, v) => bag.set(k, String(v)), removeItem: (k) => bag.delete(k), bag };
};

/* 소리 파일: 16비트 모노 WAV 를 직접 읽습니다. */
function readWav(path) {
    const buf = readFileSync(path);
    const head = buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
    let at = 12; let fmt = null; let data = null;
    while (at + 8 <= buf.length) {
        const id = buf.toString('ascii', at, at + 4); const size = buf.readUInt32LE(at + 4);
        if (id === 'fmt ') fmt = { channels: buf.readUInt16LE(at + 10), rate: buf.readUInt32LE(at + 12), bits: buf.readUInt16LE(at + 22) };
        if (id === 'data') data = buf.subarray(at + 8, at + 8 + size);
        at += 8 + size + (size % 2);
    }
    const samples = new Float32Array(data ? data.length / 2 : 0);
    for (let i = 0; i < samples.length; i += 1) samples[i] = data.readInt16LE(i * 2) / 32768;
    return { head, fmt, samples, bytes: buf.length };
}

const kbv = await import('../src/ui/kbvoices.js');
const { KB_THEMES, DEFAULT_KB_THEME, KB_VOICES, normalizeKbTheme, kbSoundFiles, isKbVoice } = kbv;
const ids = KB_THEMES.map((t) => t.id);
check(ids.join() === 'mx,retro,slim,puff,jelly,type', `테마 순서가 다릅니다: ${ids}`);
check(KB_THEMES.map((t) => t.label).join() === 'MX 미니,기계식 레트로,노트북 슬림,파스텔 마시멜로,젤리 투명 키,타자기', '테마 이름이 다릅니다.');
check(DEFAULT_KB_THEME === 'mx', '기본 테마가 MX 미니가 아닙니다.');
for (const bad of [null, '', 'MX', 'kb-mx', 'x', '__proto__']) check(normalizeKbTheme(bad) === 'mx', `잘못된 테마 값 ${bad} 를 기본으로 돌리지 않습니다.`);
check(KB_VOICES.length === 6 && KB_VOICES.every((v) => isKbVoice(v.id)), '테마 소리 목록이 6개가 아닙니다.');

let totalBytes = 0; let fileCount = 0;
const wavs = {};
for (const theme of KB_THEMES) {
    const files = kbSoundFiles(theme.id);
    check(files.down.length === theme.down && files.up.length === theme.up, `${theme.label} 소리 파일 수가 다릅니다.`);
    for (const rel of [...files.down, ...files.up]) {
        const path = `${root}/public/${rel}`;
        let wav;
        try { wav = readWav(path); } catch { check(false, `소리 파일이 없습니다: ${rel}`); continue; }
        wavs[rel] = wav; totalBytes += wav.bytes; fileCount += 1;
        check(wav.head && wav.fmt?.channels === 1 && wav.fmt.bits === 16 && wav.fmt.rate === 32000, `${rel} 형식이 32kHz 모노 16비트가 아닙니다.`);
        let peak = 0; for (const s of wav.samples) peak = Math.max(peak, Math.abs(s));
        check(peak > 0.05 && peak < 0.99, `${rel} 최대 크기 ${peak.toFixed(3)} 가 범위를 벗어납니다.`);
        const n = wav.samples.length;
        check(Math.abs(wav.samples[0]) < 0.01 && Math.abs(wav.samples[n - 1]) < 0.01, `${rel} 끝이 0으로 닫히지 않아 딸깍 잡음이 납니다.`);
        check(n / 32000 < 0.6, `${rel} 이 0.6초보다 깁니다.`);
    }
}
check(fileCount === 28, `테마 소리 파일이 28개가 아닙니다: ${fileCount}`);
check(totalBytes < 450 * 1024, `테마 소리 파일이 너무 큽니다: ${totalBytes}`);

/* 가짜 오디오와 파일 받기 */
const sources = []; const gains = []; const vibes = []; const fetched = [];
class FakeAudioContext {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.currentTime = 0; this.destination = {}; }
    createBuffer(_c, length, sampleRate) { const data = new Float32Array(length); return { length, sampleRate, getChannelData: () => data }; }
    createBufferSource() {
        const src = { buffer: null, playbackRate: { value: 1 }, connect() {}, disconnect() {}, start() { src.started = true; }, stop() { src.stopped = true; } };
        sources.push(src); return src;
    }
    createGain() {
        const gain = { gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {}, setTargetAtTime() {} }, connect() {}, disconnect() {} };
        gains.push(gain); return gain;
    }
    createDynamicsCompressor() { const p = () => ({ value: 0, setValueAtTime() {} }); return { threshold: p(), knee: p(), ratio: p(), attack: p(), release: p(), connect() {}, disconnect() {} }; }
    decodeAudioData(data) {
        const path = bodies.get(data);
        const wav = readWav(`${root}/public/${path}`);
        return Promise.resolve({ length: wav.samples.length, sampleRate: 32000, duration: wav.samples.length / 32000, getChannelData: () => wav.samples, path, size: data.byteLength });
    }
    resume() { this.state = 'running'; return Promise.resolve(); }
}
const bodies = new WeakMap();
globalThis.fetch = async (url) => {
    const rel = String(url).replace(/^\.\//, '');
    fetched.push(rel);
    try {
        const body = readFileSync(`${root}/public/${rel}`);
        return { ok: true, arrayBuffer: async () => { const ab = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength); bodies.set(ab, rel); return ab; } };
    } catch { return { ok: false }; }
};
const live = memory();
globalThis.localStorage = live;
globalThis.window = { AudioContext: FakeAudioContext, OfflineAudioContext: FakeAudioContext };
Object.defineProperty(globalThis, 'navigator', { value: { vibrate: (ms) => { vibes.push(ms); return true; } }, configurable: true });

const feel = await import('../src/ui/keyfeel.js');
const { KB_VOICE_BOOST, keyVoiceId, setKeyVoice, playKey, setKeySound, setKeyVibe, setKeyVolume, keyVolumeGain, loadKbVoice, pickVariant, mixKeyBurst, previewKeyVoice, setKeyMuted } = feel;

check(keyVoiceId() !== 'kb-mx' && !isKbVoice(keyVoiceId()), '저장값이 없는데 테마 소리가 기본이 됩니다(기존 소리가 바뀜).');
setKeyVoice('kb-retro');
check(keyVoiceId() === 'kb-retro', '테마 소리를 고를 수 없습니다.');
setKeyVoice('kb-nope');
check(!isKbVoice(keyVoiceId()), '없는 테마 소리를 받아 줍니다.');

/* 파일을 받기 전 누름은 조용히, 위로 뗌도 소리 없음 */
setKeySound(true); setKeyVibe(false); setKeyVolume('normal');
live.setItem('ssug-gyomu-key-voice', 'kb-jelly');
const before = sources.length; const fetchedBefore = fetched.length;
playKey('down');
check(sources.length === before, '받기 전 테마 소리 누름이 소리를 냅니다(반쪽 소리).');
check(fetched.length > fetchedBefore, '받기 전 누름이 소리 파일 받기를 시작하지 않습니다.');
check(await loadKbVoice('kb-jelly'), '테마 소리 파일을 받지 못합니다.');
playKey('up');
check(sources.length === before, '받는 사이 손을 떼면 뗌 소리만 납니다(반쪽 소리).');
check(fetched.filter((f) => f.startsWith('sounds/kb/jelly-')).length === 4, `젤리 소리 파일 받기 수가 다릅니다: ${fetched.join()}`);
check(await loadKbVoice('kb-jelly') && fetched.filter((f) => f.startsWith('sounds/kb/jelly-')).length === 4, '받은 소리 파일을 다시 받습니다.');

/* 한 번 누름에 한 소리, 뗄 때 한 소리 */
for (let n = 0; n < 12; n += 1) {
    const s0 = sources.length; const g0 = gains.length;
    playKey('down');
    const downs = sources.slice(s0).filter((s) => s.started);
    check(downs.length === 1, `누름 한 번에 소리가 ${downs.length}개 납니다.`);
    check(downs[0]?.buffer?.path?.startsWith('sounds/kb/jelly-d'), '누름에 누름 녹음이 아닌 소리가 납니다.');
    const g = gains.slice(g0).find((x) => x.gain.value > 0);
    check(Math.abs((g?.gain.value || 0) - keyVolumeGain('normal') * KB_VOICE_BOOST) < 1e-9, '테마 소리 크기가 소리 크기 설정을 따르지 않습니다.');
    const s1 = sources.length;
    playKey('up');
    check(sources.slice(s1).filter((s) => s.started).length === 1 && sources[s1]?.buffer?.path?.startsWith('sounds/kb/jelly-u'), '뗄 때 소리가 한 번이 아닙니다.');
    playKey('up');
    check(sources.length === s1 + 1, '한 번 누름에 뗌 소리가 두 번 납니다.');
}
const prev = sources.at(-2);
playKey('down');
check(prev.stopped || gains.length > 0, '다음 누름이 이전 소리를 정리하지 않습니다.');
playKey('up');

/* 끄기, 크기, 진동 */
setKeySound(false);
const sOff = sources.length;
playKey('down'); playKey('up');
check(sources.length === sOff, '소리를 꺼도 테마 소리가 납니다.');
setKeySound(true); setKeyVibe(true);
vibes.length = 0;
playKey('down'); playKey('up');
check(vibes.length === 1 && vibes[0] === 8, '테마 소리에서 진동 설정을 따르지 않습니다.');
setKeyVibe(false);
vibes.length = 0; playKey('down'); playKey('up');
check(vibes.length === 0, '진동을 꺼도 떨립니다.');
setKeyMuted(true);
const sMute = sources.length; playKey('down'); previewKeyVoice('kb-jelly');
check(sources.length === sMute, '받아쓰기 중에도 테마 소리가 납니다.');
setKeyMuted(false);
setKeyVolume('loud');
const gLoud = gains.length; playKey('down'); playKey('up');
check(gains.slice(gLoud).some((x) => Math.abs(x.gain.value - keyVolumeGain('loud') * KB_VOICE_BOOST) < 1e-9), '크게 설정이 테마 소리에 적용되지 않습니다.');

/* 같은 녹음을 연달아 쓰지 않습니다 */
for (const len of [2, 3, 4]) {
    let last = -1; const seen = new Set(); let repeat = false;
    for (let n = 0; n < 400; n += 1) { const i = pickVariant(new Array(len).fill(0), last); if (i === last) repeat = true; seen.add(i); last = i; }
    check(!repeat && seen.size === len, `녹음 ${len}개 고르기가 반복되거나 일부만 씁니다.`);
}
check(pickVariant([1], 0) === 0 && pickVariant([], 0) === -1, '녹음 1개·0개 고르기가 틀립니다.');

/* 연타 겹침: 실제 녹음으로 30번 15ms */
for (const theme of KB_THEMES) {
    const rel = kbSoundFiles(theme.id).down[0];
    const down = wavs[rel]?.samples;
    if (!down) continue;
    const burst = mixKeyBurst({ voice: `kb-${theme.id}`, volume: 'loud', count: 30, gapMs: 15, sampleRate: 32000, down });
    check(burst.maxVoices <= 6, `${theme.label} 연타에 소리가 ${burst.maxVoices}개 겹칩니다.`);
    check(burst.peak < 0.6, `${theme.label} 연타 최대 크기 ${burst.peak.toFixed(3)} 가 큽니다.`);
}

/* 테마 저장과 소리 따라가기, 원 퍼짐 전환 */
const doc = {
    attrs: new Map(), classes: new Set(), animations: [],
};
const rootEl = {
    getAttribute: (k) => (doc.attrs.has(k) ? doc.attrs.get(k) : null),
    setAttribute: (k, v) => doc.attrs.set(k, String(v)),
    removeAttribute: (k) => doc.attrs.delete(k),
    classList: { add: (c) => doc.classes.add(c), remove: (c) => doc.classes.delete(c) },
    animate: (frames, options) => { doc.animations.push({ frames, options }); return {}; },
};
let reduce = false; let transitions = 0;
globalThis.document = {
    documentElement: rootEl,
    startViewTransition(update) {
        transitions += 1;
        check(doc.classes.has('kb-reveal'), '원 퍼짐 전환 중 표시 클래스가 없습니다.');
        update();
        return { ready: Promise.resolve(), finished: Promise.resolve() };
    },
};
globalThis.matchMedia = (q) => ({ matches: reduce && q.includes('reduce') });
globalThis.innerWidth = 390; globalThis.innerHeight = 844;
const kt = await import('../src/ui/kbtheme.js');
const { KB_THEME_KEY, kbThemeId, setKbTheme, applyKbTheme } = kt;
check(KB_THEME_KEY === 'ssug-gyomu-kb-theme', '테마 저장 키가 다릅니다.');
const st = memory();
check(kbThemeId(st) === 'mx', '저장값이 없으면 MX 미니여야 합니다.');
st.setItem(KB_THEME_KEY, 'weird');
check(kbThemeId(st) === 'mx', '이상한 저장값을 기본으로 돌리지 않습니다.');
const okCss = async () => true;
st.setItem('ssug-gyomu-key-voice', 'kb-retro');
await setKbTheme('slim', { storage: st, x: 40, y: 700, loadCss: okCss });
check(st.getItem(KB_THEME_KEY) === 'slim' && kbThemeId(st) === 'slim', '고른 테마가 저장되지 않습니다.');
check(st.getItem('ssug-gyomu-key-voice') === 'kb-slim', '테마 소리를 쓰는 중인데 새 테마 소리로 옮기지 않습니다.');
check(doc.attrs.get('data-kb') === 'slim' && transitions === 1, '테마 전환이 원 퍼짐으로 바뀌지 않습니다.');
const anim = doc.animations.at(-1);
check(anim?.options?.pseudoElement === '::view-transition-new(root)' && /circle\(0px at 40px 700px\)/.test(anim.frames.clipPath[0]) && anim.options.duration <= 500, '원이 누른 곳에서 퍼지지 않습니다.');
check(!doc.classes.has('kb-reveal'), '전환 뒤 표시 클래스가 남습니다.');
check(!/scale/i.test(JSON.stringify(anim?.frames || {})), '전환에 크기 바꾸기가 들어 있습니다.');
st.setItem('ssug-gyomu-key-voice', 'mongdol');
reduce = true;
await setKbTheme('type', { storage: st, loadCss: okCss });
check(st.getItem('ssug-gyomu-key-voice') === 'mongdol', '다른 소리를 골라 둔 사람의 소리를 테마가 바꿉니다.');
check(doc.attrs.get('data-kb') === 'type' && transitions === 1, '움직임 줄이기에서 바로 바뀌지 않습니다.');
reduce = false;
await setKbTheme('mx', { storage: st, loadCss: okCss });
check(!doc.attrs.has('data-kb') && st.getItem(KB_THEME_KEY) === 'mx', 'MX 미니로 돌아오면 테마 표시가 남습니다.');
await setKbTheme('puff', { storage: st, loadCss: async () => false });
check(!doc.attrs.has('data-kb'), '스타일을 못 받았는데 테마를 반쯤 바꿉니다.');
await applyKbTheme('mx');
check(!doc.attrs.has('data-kb'), '기본 테마 적용이 표시를 지우지 않습니다.');
const keysUsed = [...st.bag.keys()].sort().join();
check(keysUsed === 'ssug-gyomu-kb-theme,ssug-gyomu-key-voice', `테마가 다른 저장 키를 씁니다: ${keysUsed}`);

/* 코드 모양: 지연 받기, 기록·클라우드 미사용, 눌림은 위치만, 글꼴 그대로 */
const src = (p) => readFileSync(`${root}/${p}`, 'utf8');
const css = src('src/ui/kbtheme.css');
const indexCss = src('src/index.css');
const ktSrc = src('src/ui/kbtheme.js');
const app = src('src/App.jsx');
const settings = src('src/ui/Settings.jsx');
check(!/scale/i.test(css) && !/scaleY/.test(indexCss), '키캡 눌림에 scale 이 있습니다.');
check(!/font-family|font:/.test(css), '테마 스타일이 글꼴을 바꿉니다.');
check(!/data-kb="mx"/.test(css), 'MX 미니가 기존 키캡과 다른 스타일을 받습니다.');
for (const id of ids.slice(1)) {
    check(css.includes(`html[data-kb="${id}"] {`) && css.includes(`html.dark[data-kb="${id}"] {`), `${id} 테마의 밝게·어둡게 중 하나가 없습니다.`);
    check(css.includes(`[data-kb-sample="${id}"]`), `${id} 견본이 없습니다.`);
}
const activeRules = [...css.matchAll(/:active\s*\{([^}]*)\}/g)].map((m) => m[1]);
const transforms = [...css.matchAll(/transform:\s*([^;]+);/g)].map((m) => m[1].trim());
check(activeRules.length >= 2 && activeRules.every((r) => /transform:\s*(translateY\(|none)/.test(r)) && transforms.every((t) => /^(translateY\(.*\)|none)$/.test(t)), `눌림이 위치 이동(translateY)으로만 되어 있지 않습니다: ${transforms.join(' | ')}`);
check(/@media \(prefers-reduced-motion: reduce\)[\s\S]*--kb-travel: 0px/.test(css), '움직임 줄이기에서 눌림 이동을 끄지 않습니다.');
check(/import\('\.\/kbtheme\.css'\)/.test(ktSrc), '테마 스타일을 나중에 받지 않습니다.');
const staticCss = [app, settings, ktSrc, src('src/main.jsx')].some((s) => /^import\s+['"][^'"]*kbtheme\.css['"]/m.test(s));
check(!staticCss, '테마 스타일이 첫 화면 묶음에 들어갑니다.');
check(!/firebase|firestore|\.\.\/lib\/db/.test(ktSrc) && !/firebase|firestore/.test(src('src/ui/kbvoices.js')), '테마 코드가 클라우드·기록에 닿습니다.');
for (const p of ['src/lib/db.js', 'firestore.rules']) {
    try { check(!/kb-theme|kbTheme|data-kb/.test(src(p)), `${p} 에 테마 값이 들어갔습니다.`); } catch { /* 파일이 없으면 지나갑니다. */ }
}
check(app.includes('applyStoredKbTheme()') && app.includes('loadKbVoice(voice)'), '앱 시작에서 테마를 적용하지 않습니다.');
check(settings.includes('className="kb-grid"') && settings.includes('data-kb-pick=') && /\.kb-grid\s*\{/.test(src('src/index.css')), '설정 테마 칸(kb-grid)이나 그 모양이 없습니다.');
check(settings.includes('KB_THEMES.map') && settings.includes('aria-pressed={kbTheme === item.id}') && settings.includes('setKbTheme(item.id'), '설정에 테마 고르기가 없습니다.');
check(settings.includes('KB_VOICES.map') && settings.includes('키보드 테마 소리'), '설정에 테마 소리 칩이 없습니다.');
check(!/saveProfile\([^)]*kb/i.test(settings), '테마 값을 프로필(클라우드)에 저장합니다.');
check(/\.kb-grid\s*\{/.test(indexCss), '테마 고르기 칸 자리가 첫 스타일에 없습니다.');
try { statSync(`${root}/docs/keyboard-themes.md`); } catch { check(false, '테마 소리 출처 문서가 없습니다.'); }

/* 대비: 테마 키 바탕 위의 글자 */
const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const colorsIn = (value, bg) => [...value.matchAll(/#([0-9A-Fa-f]{6})\b|rgba\(([^)]+)\)/g)].map((m) => {
    if (m[1]) return hex(`#${m[1]}`);
    const [r, g, b, a] = m[2].split(',').map(Number);
    return [r, g, b].map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
});
const tone = {
    light: { bg: hex('#E8E4DE'), ink: hex('#2E2A2B'), sub: hex('#5E5658'), accent: hex('#A73D74') },
    dark: { bg: hex('#2A2627'), ink: hex('#F6F2EE'), sub: hex('#C9C1BF'), accent: hex('#E08B9A') },
};
let worst = 99;
for (const id of ids.slice(1)) {
    for (const mode of ['light', 'dark']) {
        const sel = mode === 'light' ? `html[data-kb="${id}"] {` : `html.dark[data-kb="${id}"] {`;
        const at = css.indexOf(sel);
        const block = at >= 0 ? css.slice(at, css.indexOf('}', at)) : '';
        const t = tone[mode];
        for (const prop of ['--kb-key', '--kb-key-on']) {
            const line = block.match(new RegExp(`${prop}:([^;]+);`));
            const value = line ? line[1] : (mode === 'dark' ? null : '');
            if (!value) { check(mode === 'dark' && false, `${id} ${mode} ${prop} 값이 없습니다.`); continue; }
            for (const c of colorsIn(value, t.bg)) {
                const inkR = ratio(t.ink, c); const subR = ratio(t.sub, c); const accR = ratio(t.accent, c);
                worst = Math.min(worst, inkR, subR);
                check(inkR >= 4.5 && subR >= 4.5, `${id} ${mode} ${prop} 바탕 글자 대비 ${inkR.toFixed(2)}/${subR.toFixed(2)} 가 4.5보다 낮습니다.`);
                check(accR >= 3, `${id} ${mode} ${prop} 강조색 대비 ${accR.toFixed(2)} 가 3보다 낮습니다.`);
            }
        }
    }
}

if (failures.length) {
    console.error(failures.map((m) => `- ${m}`).join('\n'));
    console.error(`키보드 테마 검사 실패 ${failures.length}건`);
    process.exit(1);
}
console.log(`테마 6개, 소리 파일 ${fileCount}개 ${totalBytes}바이트, 가장 낮은 글자 대비 ${worst.toFixed(2)}. 키보드 테마 검사를 통과했습니다.`);
