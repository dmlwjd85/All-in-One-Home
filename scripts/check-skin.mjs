/** 화면 꾸미기(클래식 교실풍경). 저장 키, html 속성, 클라우드 미사용, 스타일 범위, 글자 대비. */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const src = (p) => readFileSync(`${root}/${p}`, 'utf8');
const memory = () => {
    const bag = new Map();
    return { getItem: (k) => (bag.has(k) ? bag.get(k) : null), setItem: (k, v) => bag.set(k, String(v)), removeItem: (k) => bag.delete(k), bag };
};

const { SKIN_KEY, DEFAULT_SKIN, SKIN_CHOICES, normalizeSkin, skinId, applySkin, setSkin, applyStoredSkin } = await import('../src/ui/skin.js');

check(SKIN_KEY === 'ssug-gyomu-skin', '화면 꾸미기 저장 키가 다릅니다.');
check(DEFAULT_SKIN === 'basic', '기본 꾸미기가 basic이 아닙니다.');
check(SKIN_CHOICES.map((item) => item.id).join() === 'basic,cork', `꾸미기 순서가 다릅니다: ${SKIN_CHOICES.map((item) => item.id)}`);
check(SKIN_CHOICES.map((item) => item.label).join() === '기본,클래식 교실풍경', '꾸미기 이름이 다릅니다.');
check(SKIN_CHOICES.find((item) => item.id === 'cork')?.hint === '어두운 화면은 밤 교실', '밤 교실 안내가 없습니다.');
check(normalizeSkin('classic') === 'cork', 'classic 저장값을 cork 로 읽지 않습니다.');
for (const bad of [null, '', 'CORK', 'theme', '__proto__']) check(normalizeSkin(bad) === 'basic', `잘못된 값 ${bad} 를 기본으로 돌리지 않습니다.`);

const doc = { attrs: new Map() };
const rootEl = {
    getAttribute: (k) => (doc.attrs.has(k) ? doc.attrs.get(k) : null),
    setAttribute: (k, v) => doc.attrs.set(k, String(v)),
    removeAttribute: (k) => doc.attrs.delete(k),
};
globalThis.document = { documentElement: rootEl };

const st = memory();
check(skinId(st) === 'basic', '저장값이 없으면 기본이어야 합니다.');
st.setItem(SKIN_KEY, 'weird');
check(skinId(st) === 'basic', '이상한 저장값을 기본으로 돌리지 않습니다.');
setSkin('cork', st);
check(st.getItem(SKIN_KEY) === 'cork' && skinId(st) === 'cork', '고른 꾸미기가 저장되지 않습니다.');
check(doc.attrs.get('data-skin') === 'cork', '코르크를 골라도 data-skin 이 없습니다.');
setSkin('basic', st);
check(st.getItem(SKIN_KEY) === 'basic' && !doc.attrs.has('data-skin'), '기본으로 돌아오면 속성이 남습니다.');
st.setItem(SKIN_KEY, 'cork');
applyStoredSkin(st);
check(doc.attrs.get('data-skin') === 'cork', '저장값을 적용하지 않습니다.');
applySkin('basic');
check(!doc.attrs.has('data-skin'), '기본 적용이 속성을 지우지 않습니다.');
check([...st.bag.keys()].join() === 'ssug-gyomu-skin', `꾸미기가 다른 저장 키를 씁니다: ${[...st.bag.keys()]}`);

const indexHtml = src('index.html');
check(indexHtml.includes("localStorage.getItem('ssug-gyomu-skin')") && indexHtml.includes("setAttribute('data-skin', 'cork')"), '첫 스크립트가 꾸미기를 읽지 않습니다.');
check(indexHtml.includes("skin === 'classic'") && indexHtml.includes("setItem('ssug-gyomu-skin', 'cork')"), 'classic 값을 cork 로 바꾸지 않습니다.');
const app = src('src/App.jsx');
check(app.includes('applyStoredSkin()'), '앱 시작에서 꾸미기를 적용하지 않습니다.');
const settings = src('src/ui/Settings.jsx');
check(settings.includes('SKIN_CHOICES.map') && settings.includes('data-skin-pick=') && settings.includes('aria-label="화면 꾸미기"'), '설정에 화면 꾸미기 칸이 없습니다.');
check(settings.includes('setSkin(item.id') && !/saveProfile\([^)]*skin/i.test(settings) && !/patchProfile\([^)]*skin/i.test(settings), '꾸미기 값을 프로필(클라우드)에 저장합니다.');

const skinJs = src('src/ui/skin.js');
check(!/firebase|firestore|\.\.\/lib\/db/.test(skinJs), '꾸미기 코드가 클라우드·기록에 닿습니다.');
for (const p of ['src/lib/db.js', 'src/lib/cloudShape.js', 'firestore.rules']) {
    check(!/ssug-gyomu-skin|data-skin|setSkin|SKIN_KEY/.test(src(p)), `${p} 에 꾸미기 값이 들어갔습니다.`);
}

const css = src('src/ui/skin-cork.css');
check(src('src/index.css').includes("import './ui/skin-cork.css'"), '코르크 스타일을 첫 스타일에 넣지 않습니다.');
const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
const selectors = [...stripped.matchAll(/(^|})\s*([^{}@][^{]*)\{/g)].map((m) => m[2].trim()).filter((sel) => sel && !sel.startsWith('@') && !sel.startsWith('}'));
for (const sel of selectors) {
    const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
    check(parts.length && parts.every((p) => /\[data-skin="cork"\]/.test(p)), `코르크 스타일이 기본 화면에 새어 나갑니다: ${sel}`);
}
check(!/--st-present|--st-absent|--st-late|--st-early|--st-out/.test(css), '출결 색 의미를 덮습니다.');
check(css.includes('pointer-events: none'), '장식이 클릭을 가로챕니다.');
check(/min-width:\s*900px/.test(css), '넓은 화면 책상 소품 자리가 없습니다.');
const deco = src('src/ui/SkinDeco.jsx');
check(deco.includes('서로 돕고 함께 자라는 우리 반') && deco.includes('loading="lazy"') && deco.includes('taegeukgi-mark.svg') && deco.includes('flag-frame.webp') && deco.includes('motto-frame.webp'), '급훈·태극기·지연 불러오기가 없습니다.');
check(!/bg-frontwall-ref|wall-flag/.test(deco) && !/taegeukgi\.webp/.test(css), '부정확한 태극기 사진을 씁니다.');
check(/data-prop="speaker"/.test(css) && /data-prop="clock"/.test(css) && /data-prop="bell"/.test(css), '교실 앞벽 소품이 없습니다.');
check(/desk\.webp/.test(css) && /drawer-face\.webp/.test(css) && /cabinet-top\.webp/.test(css), '책상·서랍 그림이 없습니다.');
check(/chalkboard\.webp/.test(css) && /background-size:\s*cover/.test(css) && /border-image:\s*url\('\.\/skin\/bg\/desk\.webp'\)/.test(css), '칠판 그림·나무 틀이 없습니다.');
check(/padding-top:\s*56px/.test(css) && /height:\s*56px/.test(css) && /plaster\.webp/.test(css) && /molding\.webp/.test(css), '넓은 화면 앞벽 띠가 없습니다.');
check(/44px/.test(css) && /fuse-h/.test(css), '폰 앞벽 띠가 없습니다.');
check(/padding-bottom:\s*48px/.test(css) && /100% 48px/.test(css), '넓은 화면 책상 상판이 없습니다.');
check(!/desk-wood\.svg|drawer-handle\.svg|wave\.svg/.test(css), '코드 SVG 텍스처를 배경으로 씁니다.');
check(/data-prop="books"/.test(css) && /data-prop="chalk"/.test(css) && /data-prop="abacus"/.test(css) && /data-prop="eraser"/.test(css), '책상 소품이 없습니다.');
check(/data-prop="stove"/.test(css) && /data-prop="organ"/.test(css) && /data-prop="globe"/.test(css) && /data-prop="plant"/.test(css) && /data-prop="lunch"/.test(css), '넓은 화면 여백 소품이 없습니다.');
check(/padding-bottom:\s*72px/.test(css) && /padding-bottom:\s*168px/.test(css), '쨈이 할 일 마지막 줄을 가릴 자리가 없습니다.');
for (const name of ['stove', 'lunch', 'organ', 'bell', 'abacus', 'eraser', 'chalk', 'globe', 'plant', 'books', 'clock', 'speaker']) {
    const file = `${root}/src/ui/skin/props/${name}.webp`;
    check(existsSync(file), `소품 파일이 없습니다: ${name}.webp`);
    if (existsSync(file)) {
        const bytes = statSync(file).size;
        check(bytes > 800 && bytes <= 40 * 1024, `소품 용량이 이상합니다: ${name}.webp ${bytes}B`);
    }
}
const bgLimit = { chalkboard: 120, desk: 120 };
for (const name of ['chalkboard', 'desk', 'plaster', 'molding', 'drawer-face', 'cabinet-top', 'cabinet-side', 'wall-speaker', 'wall-clock', 'motto-frame', 'flag-frame']) {
    const file = `${root}/src/ui/skin/bg/${name}.webp`;
    check(existsSync(file), `배경 조각이 없습니다: ${name}.webp`);
    if (existsSync(file)) {
        const bytes = statSync(file).size;
        const cap = (bgLimit[name] || 30) * 1024;
        check(bytes > 400 && bytes <= cap, `배경 용량이 이상합니다: ${name}.webp ${bytes}B / ${cap}B`);
    }
}
check(/cork-drawer-open/.test(css) && /translateX\(12px\)/.test(css), '활성 서랍이 앞으로 나오지 않습니다.');
check(!/side-menu[^{]*\.on[^{]*\{[^}]*cork-chip-on/.test(css.replace(/\s+/g, ' ')), '활성 서랍을 분홍 판으로 칠합니다.');
check(/--cork-chip-ink/.test(css) && /--cork-field-ink/.test(css) && /--cork-paper-ink/.test(css) && /--cork-drawer-ink/.test(css), '배경·글자 토큰 쌍이 없습니다.');
check(/quick-bar\.is-open/.test(css) && /content:\s*none/.test(css), '쨈 팝업에서 장식을 가리지 않습니다.');
check(/\.store-badge/.test(css) && /cork-tag-orange/.test(css), '보호 라벨 색이 없습니다.');
check(!/\.store-notice h2[^{]*\{[^}]*cork-tag-orange/.test(css.replace(/\s+/g, ' ')), '보호 안내를 제목 막대로 칠합니다.');
check(!/nth-of-type\(4n/.test(css), '라벨 색이 카드 순서로 무작정 돕니다.');
check(/\[data-screen="todo"\]/.test(css) && /\[data-screen="attend"\]/.test(css) && /\[data-screen="notice"\]/.test(css), '화면별 라벨 색 규칙이 없습니다.');
check(/scrollbar-color/.test(css), '스크롤바가 테마에 안 맞습니다.');
check(/--primary:\s*#9C3B32/.test(css), '주 색이 베릭 레드가 아닙니다.');
check(/--accent:\s*#215E5E/.test(css), '보조 색이 틸이 아닙니다.');
check(/\.field:focus/.test(css) && /\.chip\.on/.test(css) && /\.todo-check/.test(css), '입력창·선택·체크 다듬기가 없습니다.');
check(css.includes('html.dark[data-skin="cork"]'), '어두운 밤 교실 톤이 없습니다.');
check(!/url\(\s*['"]?https?:|unsplash|pexels|shutterstock/i.test(css), '바깥 그림을 씁니다.');

const indexCss = src('src/index.css');
check(/\.skin-swatch/.test(indexCss) && indexCss.includes('data-skin-sample="cork"'), '설정 꾸미기 견본이 없습니다.');
check(!indexCss.includes('-webkit-text-stroke'), '기본 화면에 헤일로가 남았습니다.');
check(css.includes('--text-halo') && css.includes('-webkit-text-stroke: 1.15px var(--text-halo)'), '코르크 바탕 헤일로가 없습니다.');

const sw = src('public/sw.js');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v102'"), '서비스 워커가 v102가 아닙니다.');

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const readVar = (block, name) => {
    const line = block.match(new RegExp(`${name}:\\s*(#[0-9A-Fa-f]{6})`));
    return line ? hex(line[1]) : null;
};
const lightAt = css.indexOf('html[data-skin="cork"] {');
const light = css.slice(lightAt, css.indexOf('\n}', lightAt) + 2);
const darkAt = css.indexOf('html.dark[data-skin="cork"] {');
const dark = css.slice(darkAt, css.indexOf('\n}', darkAt) + 2);
let worst = 99;
for (const [label, block, page] of [
    ['밝은 카드', light, hex('#F6F0E4')],
    ['어두운 카드', dark, hex('#2E281F')],
]) {
    const ink = readVar(block, '--ink');
    const sub = readVar(block, '--ink-sub');
    const hint = readVar(block, '--ink-hint');
    check(ink && sub && hint, `${label} 글자색이 없습니다.`);
    if (!ink) continue;
    const inkR = ratio(ink, page);
    const subR = ratio(sub, page);
    const hintR = ratio(hint, page);
    worst = Math.min(worst, inkR, subR, hintR);
    check(inkR >= 4.5, `${label} 본문 대비 ${inkR.toFixed(2)} 가 4.5보다 낮습니다.`);
    check(subR >= 4.5, `${label} 보조 글자 대비 ${subR.toFixed(2)} 가 4.5보다 낮습니다.`);
    check(hintR >= 4.5, `${label} 안내 글자 대비 ${hintR.toFixed(2)} 가 4.5보다 낮습니다.`);
}
const pairs = [
    ['--cork-paper', '--cork-paper-ink'],
    ['--cork-chip', '--cork-chip-ink'],
    ['--cork-chip-on', '--cork-chip-on-ink'],
    ['--cork-field', '--cork-field-ink'],
    ['--cork-chalk', '--cork-chalk-ink'],
    ['--cork-drawer', '--cork-drawer-ink'],
    ['--cork-drawer-face', '--cork-drawer-ink'],
    ['--cork-drawer-open', '--cork-drawer-ink'],
    ['--cork-tab', '--cork-tab-muted'],
    ['--cork-tab', '--cork-tab-on'],
    ['--cork-tag-blue', '--cork-tag-ink'],
    ['--cork-tag-coral', '--cork-tag-ink'],
    ['--cork-tag-green', '--cork-tag-ink'],
    ['--cork-tag-orange', '--cork-tag-ink'],
    ['--primary', '--on-primary'],
    ['--keycap-top', '--on-primary'],
];
for (const [label, block] of [['밝은', light], ['어두운', dark]]) {
    for (const [bgName, inkName] of pairs) {
        const bg = readVar(block, bgName);
        const ink = readVar(block, inkName);
        check(bg && ink, `${label} ${bgName}/${inkName} 토큰 쌍이 없습니다.`);
        if (!bg || !ink) continue;
        const r = ratio(bg, ink);
        worst = Math.min(worst, r);
        check(r >= 4.5, `${label} ${bgName} 대비 ${inkName} ${r.toFixed(2)} 가 4.5보다 낮습니다.`);
    }
}

/* 키캡 그림자 깊이(px)는 원래 값을 유지하고 색만 바꿉니다. */
const jamShadow = css.match(/html\[data-skin="cork"\][\s\S]*?\.fab-disc\.jar-disc[\s\S]*?box-shadow:\s*([^;]+);/)?.[1] || '';
check(/0 0 0 3px/.test(jamShadow) && /0 3px 0 3px/.test(jamShadow) && /0 6px 0 3px/.test(jamShadow)
    && /0 12px 0 3px/.test(jamShadow) && /0 20px 28px/.test(jamShadow) && /0 8px 16px/.test(jamShadow),
    `쨈 키캡 그림자 깊이가 바뀌었습니다: ${jamShadow.replace(/\s+/g, ' ').slice(0, 180)}`);

if (failures.length) {
    console.error(failures.map((m) => `- ${m}`).join('\n'));
    console.error(`화면 꾸미기 검사 실패 ${failures.length}건`);
    process.exit(1);
}
console.log(`화면 꾸미기 검사를 통과했습니다. 가장 낮은 글자 대비 ${worst.toFixed(2)}.`);
