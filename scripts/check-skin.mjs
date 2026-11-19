/** 화면 꾸미기(클래식 교실풍경). 저장 키, html 속성, 클라우드 미사용, 스타일 범위, 글자 대비. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
check(DEFAULT_SKIN === 'cork', '처음 여는 화면이 교실풍경(cork)이 아닙니다.');
check(SKIN_CHOICES.map((item) => item.id).join() === 'basic,cork', `꾸미기 순서가 다릅니다: ${SKIN_CHOICES.map((item) => item.id)}`);
check(SKIN_CHOICES.map((item) => item.label).join() === '심플,클래식 교실풍경', '꾸미기 이름이 다릅니다.');
check(SKIN_CHOICES.find((item) => item.id === 'cork')?.hint === '어두운 화면은 밤 교실', '밤 교실 안내가 없습니다.');
check(normalizeSkin('classic') === 'cork', 'classic 저장값을 cork 로 읽지 않습니다.');
for (const bad of [null, '', 'CORK', 'theme', '__proto__']) check(normalizeSkin(bad) === 'cork', `잘못된 값 ${bad} 를 처음 화면(교실풍경)으로 돌리지 않습니다.`);

const doc = { attrs: new Map() };
const rootEl = {
    getAttribute: (k) => (doc.attrs.has(k) ? doc.attrs.get(k) : null),
    setAttribute: (k, v) => doc.attrs.set(k, String(v)),
    removeAttribute: (k) => doc.attrs.delete(k),
};
globalThis.document = { documentElement: rootEl };

const st = memory();
check(skinId(st) === 'cork', '저장값이 없으면 교실풍경이어야 합니다.');
st.setItem(SKIN_KEY, 'weird');
check(skinId(st) === 'cork', '이상한 저장값을 교실풍경으로 돌리지 않습니다.');
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
check(indexHtml.includes("skin = '%VITE_DEFAULT_SKIN%' === 'basic' ? 'basic' : 'cork'"), '첫 스크립트가 고른 적 없는 기기를 교실풍경으로 열지 않습니다.');
check(/VITE_DEFAULT_SKIN: basic/.test(src('.github/workflows/deploy-pages.yml')) && !/배포용 빌드[\s\S]*VITE_DEFAULT_SKIN/.test(src('.github/workflows/deploy-pages.yml')), '검사용 빌드만 basic 이어야 합니다(배포용 빌드에는 두지 않습니다).');
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
    if (/^(from|to|\d+(\.\d+)?%)$/.test(sel.trim())) continue;
    const parts = sel.split(',').map((s) => s.trim()).filter(Boolean);
    check(parts.length && parts.every((p) => /\[data-skin="cork"\]/.test(p)), `코르크 스타일이 기본 화면에 새어 나갑니다: ${sel}`);
}
{
    /* 출결 색 의미는 덮지 않습니다. 단, 칠판 위 판서 카드(어두운 바탕) 안에서는 앱의 어두운 화면 값 그대로만 씁니다. */
    const at = css.indexOf('───────── 판서 카드');
    const before = at < 0 ? css : css.slice(0, at);
    check(!/--st-present|--st-absent|--st-late|--st-early|--st-out/.test(before), '출결 색 의미를 덮습니다.');
    const tokens = src('src/styles/tokens.css');
    const darkTokens = tokens.slice(tokens.lastIndexOf('--st-present:'));
    for (const [, name, value] of (at < 0 ? '' : css.slice(at)).matchAll(/(--st-[a-z-]+):\s*([^;]+);/g)) {
        const want = (darkTokens.match(new RegExp(`${name}:\\s*([^;]+);`)) || [])[1];
        check(want && want.trim() === value.trim(), `판서 카드 출결 색이 어두운 화면 값과 다릅니다: ${name} ${value}`);
    }
}
check(css.includes('pointer-events: none'), '장식이 클릭을 가로챕니다.');
check(/min-width:\s*900px/.test(css), '넓은 화면 분필 받침대 자리가 없습니다.');
const deco = src('src/ui/SkinDeco.jsx');
check(src('src/ui/skin.js').includes('서로 돕고 함께 자라는 우리 반') && /skinMotto\(\)/.test(deco) && deco.includes('loading="lazy"') && deco.includes('flag-frame.webp') && deco.includes('motto-frame.webp'), '급훈·태극기·지연 불러오기가 없습니다.');
check(!/bg-frontwall-ref|wall-flag|taegeukgi-mark\.svg/.test(deco), '부정확한 태극기 그림을 씁니다.');
check(/data-prop="speaker"/.test(css) && /data-prop="clock"/.test(css) && /justify-content:\s*center/.test(css) && /gap:\s*16px/.test(css), '교실 앞벽 소품이 한 띠로 이어지지 않습니다.');
check(/drawer-face\.webp/.test(css) && /cabinet-top\.webp/.test(css) && /gap:\s*8px/.test(css), '서랍 그림·칸 사이 틀이 없습니다.');
check(/chalkboard\.webp/.test(css) && /background-size:\s*cover/.test(css) && /border-image:\s*url\('\.\/skin\/bg\/desk\.webp'\)/.test(css), '칠판 그림·나무 틀이 없습니다.');
check(/padding-top:\s*56px/.test(css) && /height:\s*56px/.test(css) && /padding-top:\s*64px/.test(css) && /height:\s*64px/.test(css) && /plaster\.webp/.test(css) && /molding\.webp/.test(css) && /wall-cover\.webp/.test(css), '넓은 화면 앞벽 띠가 없습니다.');
check(/44px/.test(css) && /fuse-h/.test(css), '폰 앞벽 띠가 없습니다.');
check(/\.app-frame:not\(:has\(> \.fuse\)\) \{\s*padding-top: calc\(env\(safe-area-inset-top, 0px\) \+ 44px\);/.test(css) && /\.app-frame:not\(:has\(> \.fuse\)\) \.skin-wall \{\s*top: env\(safe-area-inset-top, 0px\);/.test(css), '타이머 띠가 없을 때 폰 앞벽 띠가 칠판을 가립니다.');
check(/skin-tray/.test(css) && /tray-long\.webp/.test(css) && /border-image-slice/.test(css), '이어진 분필 받침대가 없습니다.');
check(!/scallop/.test(css), '카드 바느질 땀 테두리가 남아 있습니다.');
check(!/data-prop="books"/.test(css) && !/data-prop="stove"/.test(css) && !/data-prop="organ"/.test(css) && !/data-prop="globe"/.test(css) && !/data-prop="plant"/.test(css) && !/data-prop="lunch"/.test(css), '책상 소품이 남아 있습니다.');
check(!/desk-wood\.svg|drawer-handle\.svg|wave\.svg/.test(css), '코드 SVG 텍스처를 배경으로 씁니다.');
check(/padding-bottom:\s*120px/.test(css) && /height:\s*120px/.test(css), '분필 받침대 자리가 없습니다.');
check(/--cork-side:\s*140px/.test(css) && /grid-template-columns:\s*var\(--cork-side\)/.test(css), '넓은 화면 서랍 폭이 70%가 아닙니다.');
check(!/left:\s*200px/.test(css), '앞벽·받침대가 서랍장 옆에 묶여 있습니다.');
check(/\.skin-prop\[data-prop="clock"\][\s\S]*aspect-ratio:\s*1/.test(css), '시계 원 비율이 없습니다.');
{
    /* 시계는 실제로 갑니다: 바늘 각도와, 그림(네모 바탕) 대신 그린 둥근 시계. */
    const { clockAngles } = await import('../src/ui/skin.js');
    const at = clockAngles(new Date(2026, 10, 18, 15, 30, 45));
    check(Math.abs(at.hour - 105.375) < 0.01 && Math.abs(at.minute - 184.5) < 0.01 && at.second === 270, `시계 바늘 각도가 틀립니다: ${JSON.stringify(at)}`);
    check(clockAngles(new Date(2026, 0, 1, 0, 0, 0)).hour === 0 && clockAngles(new Date(2026, 0, 1, 12, 0, 0)).hour === 0, '12시 바늘');
    const deco = readFileSync(`${root}/src/ui/SkinDeco.jsx`, 'utf8');
    check(/function SkinClock/.test(deco) && /data-hand="second"/.test(deco) && /visibilitychange/.test(deco) && !/wall-clock\.webp/.test(deco), '벽시계가 실제로 가는 시계가 아닙니다.');
    check(/html\.dark\[data-skin="cork"\] \.skin-flag,[\s\S]{0,120}filter: brightness/.test(css) && /\.main,\s*html\[data-skin="cork"\] \.topbar \{\s*--neo-raise: 0 2px 0/.test(css), '밤 교실 소품 어둡게·칠판 위 단추 그림자 다듬기가 없습니다.');
}
{
    /* 급훈: 이 기기에만 저장, 길이 제한, 비우면 기본. */
    const { DEFAULT_MOTTO, MOTTO_KEY, MOTTO_MAX, cleanMotto, setSkinMotto, skinMotto } = await import('../src/ui/skin.js');
    const box = new Map();
    const store = { getItem: (k) => (box.has(k) ? box.get(k) : null), setItem: (k, v) => box.set(k, String(v)), removeItem: (k) => box.delete(k) };
    check(skinMotto(store) === DEFAULT_MOTTO, '급훈 기본값');
    check(setSkinMotto('  꿈을   키우는\n교실 ', store) === '꿈을 키우는 교실' && skinMotto(store) === '꿈을 키우는 교실' && box.has(MOTTO_KEY), '급훈 저장·정리');
    check(Array.from(cleanMotto('가'.repeat(80))).length === MOTTO_MAX, '급훈 길이 제한');
    check(setSkinMotto('   ', store) === DEFAULT_MOTTO && !box.has(MOTTO_KEY), '급훈을 비우면 기본으로 돌아가야 합니다.');
    const settings = src('src/ui/Settings.jsx');
    check(/data-role="skin-motto"/.test(settings) && /setSkinMotto\(event\.target\.value\)/.test(settings) && (() => { const cls = settings.slice(settings.indexOf("{sec === 'class' && (<>"), settings.indexOf("{sec === 'calendar' && (<>")); return /data-role="skin-motto"/.test(cls); })(), '설정 › 학급에 급훈 입력칸이 없습니다.');
    check(!/skin-motto|MOTTO_KEY/.test(src('src/lib/db.js')), '급훈은 기록·클라우드에 넣지 않습니다.');
}
{
    /* 판서 카드: 칠판 위 카드는 채움 없이 분필 테두리, 흰 굵은 글씨. 칠판 가장자리는 네 색 분필. */
    for (const name of ['frame-white', 'frame-yellow', 'frame-pink', 'frame-sky', 'frame-green', 'edge-top', 'edge-bottom', 'edge-left', 'edge-right']) {
        check(existsSync(`${root}/src/ui/skin/chalk-${name}.svg`), `분필 그림이 없습니다: chalk-${name}.svg`);
    }
    const board = css.slice(css.indexOf('───────── 판서 카드'));
    check(/\.main \.glass:not\(button\):not\(a\):not\(\[role="button"\]\),/.test(board) && /background: none;\s*border: 2px solid transparent;\s*border-image: url\('\.\/skin\/chalk-frame-white\.svg'\)/.test(board), '판서 카드: 채움을 빼고 분필 테두리를 그려야 합니다.');
    check(/--ink: #FDFCF6;/.test(board) && /color: var\(--ink\);\s*font-weight: 400;/.test(board) && !/font-weight: 700;/.test(board) && /--text-halo: var\(--cork-chalk\);/.test(board), '판서 카드 글씨는 흰 분필, 보통 굵기여야 합니다.');
    check(/\.main \.glass:not\(button\):not\(a\):not\(\[role="button"\]\) \*:not\(h1\):not\(h2\):not\(h3\):not\(h4\):not\(strong\):not\(b\):not\(\.title-font\):not\(\.fold-title\)/.test(board), '판서 카드 안 본문이 굵게 남아 있습니다.');
    check(/\.solid-card:not\(button\):not\(a\):not\(\[role="button"\]\):not\(\[data-note-pin="1"\]\)/.test(board), '고정한 메모는 압정 꽂은 종이로 남아야 합니다.');
    check(/\.week-event \{\s*background-image: none;/.test(board) || /\.cell-grid \.tap \{\s*background-image: none;/.test(board), '판서 카드 안 단추의 종이 결을 걷어야 합니다.');
    check(['top', 'bottom', 'left', 'right'].every((side) => board.split(`chalk-edge-${side}.svg`).length === 3), '칠판 가장자리 네 변(밝은·밤) 분필 선이 없습니다.');
    const hex = (file) => (src(`src/ui/skin/${file}`).match(/stroke="(#[0-9A-Fa-f]{6})"/) || [])[1];
    check(new Set(['chalk-edge-top.svg', 'chalk-edge-bottom.svg', 'chalk-edge-left.svg', 'chalk-edge-right.svg'].map(hex)).size === 4, '칠판 가장자리는 변마다 다른 색 분필이어야 합니다.');
}
{
    /* 급훈 액자: 아홉 조각 액자, 글자 칸이 안쪽 판과 같은 자리, 바탕 없음(단차 없음). */
    const tail = css.slice(css.lastIndexOf('급훈 액자: 그림을 통째로'));
    check(/border-image-slice: 34 27 22 30 fill;/.test(tail) && /border-width: 25cqh 19\.85cqh 16\.18cqh 22\.06cqh;/.test(tail), '급훈 액자는 아홉 조각으로 그려야 합니다.');
    check(/left: 22\.06cqh;\s*right: 19\.85cqh;\s*top: 25cqh;\s*bottom: 16\.18cqh;[\s\S]{0,60}background: none;/.test(tail), '급훈 글자 칸이 액자 안쪽 판과 맞지 않습니다.');
    const decoSrc = src('src/ui/SkinDeco.jsx');
    check(/export function fitMotto\(box, inner\)/.test(decoSrc) && /<MottoText text=\{motto\} \/>/.test(decoSrc) && /ResizeObserver/.test(decoSrc) && /attributeFilter: \['data-font', 'class'\]/.test(decoSrc) && /loadingdone/.test(decoSrc), '급훈 글자를 액자 판에 맞춰 키우지 않습니다.');
    check(!/data-len=/.test(decoSrc) && /\.skin-motto-fit \{/.test(css), '급훈 글자 크기를 글자 수 칸막이(data-len)로 정하고 있습니다.');
    check(/container-type: size;/.test(tail) && /--motto-frame/.test(src('src/ui/SkinDeco.jsx')) && !/<img className="skin-motto-frame"/.test(src('src/ui/SkinDeco.jsx')), '급훈 액자 그림을 통째로 늘리고 있습니다.');
}
{
    /* 교실 테마 쨈 키: 빨강(#E84B68·#A01E42) 대신 밝은 갈색 테두리·받침, 「쨈」 글자도 갈색. */
    const jam = css.slice(css.lastIndexOf('교실 테마의 쨈 키'));
    check(/0 0 0 3px #CDA57A/.test(jam) && /0 3px 0 3px #A9805A/.test(jam) && !/#E84B68|#A01E42|#7E1634/.test(jam), '교실 테마 쨈 키가 밝은 갈색이 아닙니다.');
    check(/html\.dark\[data-skin="cork"\] \.tabbar\.tabbar-jelly \.tbj-mid \.fab-txt,/.test(jam) && /color: #7A4E2A;/.test(jam), '교실 테마 「쨈」 글자색이 갈색이 아닙니다.');
}
check(/padding-bottom:\s*72px/.test(css) && /padding-bottom:\s*80px/.test(css), '쨈이 할 일 마지막 줄을 가릴 자리가 없습니다.');
check(/padding-left:\s*10px/.test(css) && /padding-right:\s*10px/.test(css) && !/padding-left:\s*96px/.test(css), '칠판 안쪽 여백이 넓습니다.');
check(!/fab-eraser|jam-eraser|chalk-puff|cork-chalk-cloud/.test(css), '쨈 지우개·분필 가루가 남아 있습니다.');
check(!/jar-svg[^{]*\{[^}]*display:\s*none/.test(css.replace(/\s+/g, ' ')), '쨈 키캡 병을 숨깁니다.');
check(!/linear-gradient\(90deg, rgba\(246, 240, 228/.test(css), '서랍 메뉴 종이 바탕이 남아 있습니다.');
check(/side-hotkey/.test(css) && /justify-content:\s*center/.test(css), '서랍 글씨 가운데·단축키 위치가 없습니다.');
check(!existsSync(`${root}/src/ui/chalkPuff.js`) && !existsSync(`${root}/src/ui/skin/bg/fab-eraser.webp`) && !existsSync(`${root}/src/ui/skin/bg/jam-eraser.webp`), '쓰지 않는 가루·지우개 파일이 남아 있습니다.');
check(!src('src/ui/pressFeel.js').includes('puffChalkDust') && !src('src/ui/pressFeel.js').includes('chalkPuff'), '짬 누름에 가루 효과가 남아 있습니다.');
for (const name of ['stove', 'lunch', 'organ', 'bell', 'abacus', 'eraser', 'chalk', 'globe', 'plant', 'books', 'clock', 'speaker']) {
    const file = `${root}/src/ui/skin/props/${name}.webp`;
    check(existsSync(file), `소품 파일이 없습니다: ${name}.webp`);
    if (existsSync(file)) {
        const bytes = statSync(file).size;
        check(bytes > 800 && bytes <= 40 * 1024, `소품 용량이 이상합니다: ${name}.webp ${bytes}B`);
    }
}
const bgLimit = { chalkboard: 120, desk: 120, 'tray-long': 80 };
for (const name of ['chalkboard', 'desk', 'plaster', 'molding', 'drawer-face', 'cabinet-top', 'cabinet-side', 'wall-speaker', 'wall-clock', 'motto-frame', 'flag-frame', 'tray-long', 'taegeukgi', 'wall-cover']) {
    const file = `${root}/src/ui/skin/bg/${name}.webp`;
    check(existsSync(file), `배경 조각이 없습니다: ${name}.webp`);
    if (existsSync(file)) {
        const bytes = statSync(file).size;
        const cap = (bgLimit[name] || 30) * 1024;
        check(bytes > 400 && bytes <= cap, `배경 용량이 이상합니다: ${name}.webp ${bytes}B / ${cap}B`);
    }
}
check(!existsSync(`${root}/src/ui/skin/bg/tray-chalk.webp`) && !existsSync(`${root}/src/ui/skin/bg/tray-eraser.webp`) && !existsSync(`${root}/src/ui/skin/bg/tray-wood.webp`), '조각난 분필 받침대 파일이 남아 있습니다.');
check(!/\bjam\b/i.test(deco + css), '꾸미기 파일에 금지 영문이 있습니다.');
check(/skin-flag-mark/.test(css) && /object-fit:\s*contain/.test(css), '태극기가 액자 안에서 비율을 지키지 않습니다.');
for (const name of readdirSync(`${root}/src/ui/skin/bg`)) {
    check(!/\bjam\b/i.test(name), `배경 파일 이름에 금지 영문이 있습니다: ${name}`);
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
check(css.includes('--text-halo') && css.includes('text-shadow: 0 0 1px var(--text-halo), 0 0 2px var(--text-halo), 0 0 3px var(--text-halo);'), '코르크 바탕 헤일로가 없습니다.');
check(!/-webkit-text-stroke:\s*[1-9]/.test(css), '글자 테두리를 획(-webkit-text-stroke)으로 그리면 글씨가 굵게 뭉개집니다. 글자 그림자로 두세요.');

const sw = src('public/sw.js');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v122'"), '서비스 워커가 v122가 아닙니다.');

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

/* 코르크는 쨈 키캡의 깊이·모양을 덮지 않습니다(tabbar.css 그대로). 색(테두리·받침·바탕)만 '교실 테마의 쨈 키' 묶음에서 바꿉니다. */
{
    const at = css.lastIndexOf('교실 테마의 쨈 키');
    const before = at < 0 ? css : css.slice(0, at);
    check(!/\[data-skin="cork"\][^{]*\.fab-disc\.jar-disc/.test(before.replace(/\s+/g, ' ')), '코르크가 쨈 키캡을 덮습니다.');
    const jamBlock = at < 0 ? '' : css.slice(at);
    for (const m of jamBlock.matchAll(/\.fab-disc\.jar-disc[^{]*\{([^}]*)\}/g)) {
        check(!/(^|;|\s)(width|height|border-radius|transform|transition|margin)\s*:/.test(m[1]), `교실 테마 쨈 키가 색 말고 모양까지 바꿉니다: ${m[1].trim().slice(0, 80)}`);
    }
}
const tab = src('src/ui/tabbar.css');
check(/0 0 0 3px/.test(tab) && /0 3px 0 3px/.test(tab) && /0 6px 0 3px/.test(tab)
    && /0 12px 0 3px/.test(tab) && /0 20px 28px/.test(tab) && /0 8px 16px/.test(tab),
    '원래 쨈 키캡 그림자 깊이가 없습니다.');

if (failures.length) {
    console.error(failures.map((m) => `- ${m}`).join('\n'));
    console.error(`화면 꾸미기 검사 실패 ${failures.length}건`);
    process.exit(1);
}
console.log(`화면 꾸미기 검사를 통과했습니다. 가장 낮은 글자 대비 ${worst.toFixed(2)}.`);
