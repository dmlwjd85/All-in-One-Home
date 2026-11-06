import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { BURST_AT_MS, BURST_MS, DROP_COUNT, FOIL_POP_MS, MAX_ANIMATIONS, SPLAT_COUNT } from '../src/ui/sealBurst.js';
import { FLAVOR_IDS, SEAL_FILL, THEME_FLAVOR } from '../src/ui/sealFlavor.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_FLAVOR = { light: 'strawberry', dark: 'strawberry' };
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

check(THEME_FLAVOR.light === EXPECTED_FLAVOR.light && THEME_FLAVOR.dark === EXPECTED_FLAVOR.dark, `화면 모드와 맛이 어긋납니다: ${JSON.stringify(THEME_FLAVOR)}`);
check(FLAVOR_IDS.includes(THEME_FLAVOR.light) && FLAVOR_IDS.includes(THEME_FLAVOR.dark), '고른 맛이 목록 밖에 있습니다.');
check(SEAL_FILL.light !== SEAL_FILL.dark, '밝게와 어둡게의 컵 색이 같습니다.');
check(BURST_MS >= 300 && BURST_MS <= 500, `예전 터지는 시간이 0.3–0.5초가 아닙니다: ${BURST_MS}`);
check(FOIL_POP_MS === 520 && BURST_AT_MS === 90, `껍질 시간이 완성본과 다릅니다: ${FOIL_POP_MS}/${BURST_AT_MS}`);
check(SPLAT_COUNT === 6 && MAX_ANIMATIONS === 8, '얼룩 수나 동작 상한이 바뀌었습니다.');
check(DROP_COUNT === 8, `D안 방울이 8개가 아닙니다: ${DROP_COUNT}`);

const burstText = readFileSync(resolve(root, 'src/ui/sealBurst.js'), 'utf8');
check(burstText.includes('prefers-reduced-motion') && burstText.includes('opacity: 0.62'), '움직임 줄이기 분기가 없습니다.');
check(!burstText.includes('getBoundingClientRect') && !burstText.includes('offsetWidth') && !burstText.includes('offsetHeight'), '터지는 동작이 레이아웃을 다시 읽습니다.');
const foilCss = readFileSync(resolve(root, 'src/ui/foilCup.css'), 'utf8');
check(!foilCss.includes(':root'), '컵 색이 화면 글자색을 덮습니다.');
check(foilCss.includes('.52s') && foilCss.includes('--cup-j1: #9E1630') && foilCss.includes('scale(1.1, .86)') && foilCss.includes('(c) 2026 쨈 폰트 팀'), '완성본 시간·딸기 색·눌림·저작권이 없습니다.');
/* QA 1차 7번: 접시 그림자는 앱 색(쨈)이나 중립 색이어야 합니다. 푸른빛(80, 90, 200)은 앱 색과 따로 놉니다. */
check(!/rgba\(\s*80\s*,\s*90\s*,\s*200/.test(foilCss) && foilCss.includes('0 6px 20px -6px rgba(138, 35, 64, .30)'), '쨈 접시 그림자가 앱 색이 아닙니다.');
/* 가계부 #31: 막대 위 컵 복사본·조각(0.38초, 방울 10~16px, 은박 14×9px)과 어두운 화면 조각 테두리 */
check(foilCss.includes('animation: cup-bit .38s') && foilCss.includes('width: 14px;\n    height: 9px;') && foilCss.includes('html.dark .cup-bit { box-shadow: 0 0 0 1.5px rgba(255,255,255,.55), 0 0 8px rgba(255,255,255,.22); }') && foilCss.includes('html.dark .cup-foil { border-color: rgba(255,255,255,.8); }'), '가계부 #31 조각 크기·시간·어두운 화면 테두리가 다릅니다.');
const appText = readFileSync(resolve(root, 'src/App.jsx'), 'utf8') + readFileSync(resolve(root, 'src/ui/TabBar.jsx'), 'utf8');
/* 탭바 시안 C: 휴대폰·컴퓨터 모두 JjaemJar. 아래 브라우저는 넓은 화면 desk-fab 병을 봅니다. */
check((appText.match(/aria-label="쨈 빠른 입력 열기"/g) || []).length === 2 && appText.includes('openQuickBar') && !appText.includes('onClick={() => setPlus(true)}'), '버튼이 입력칸을 바로 열지 않거나, 휴대폰·데스크톱 두 버튼 중 하나의 이름이 바뀌었습니다(QA 2차 M2).');
/* QA 1차 1번: 휴대폰에는 단축키가 없으므로, 빠른 입력 안에 + 화면으로 가는 단추가 있어야 합니다. */
const quickText = readFileSync(resolve(root, 'src/ui/QuickBar.jsx'), 'utf8');
check(quickText.includes('메시지·회의록 붙여넣기') && quickText.includes('openPlus') && /className="quick-paste"[\s\S]{0,200}onClick=\{openPaste\}/.test(quickText), '빠른 입력에 + 화면으로 가는 단추가 없습니다.');

const chrome = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => existsSync(path));
if (!chrome) failures.push('브라우저가 없습니다.');

const port = Number(process.env.SEAL_PORT) || 4178;
const origin = `http://127.0.0.1:${port}/`;
let preview;
if (!failures.length) {
    const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');
    preview = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
        cwd: root,
        stdio: 'ignore',
    });
    for (let i = 0; i < 40; i += 1) {
        try {
            const res = await fetch(origin);
            if (res.ok) break;
        } catch { /* 아직 */ }
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    const browser = await puppeteer.launch({
        executablePath: chrome,
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-theme', 'light');
        });
        await page.goto(`${origin}?demo=1&mode=light`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.desk-fab .jar-disc');
        const light = await page.evaluate(() => {
            const button = document.querySelector('.desk-fab');
            const jar = button?.querySelector('.jar-disc');
            const seal = button?.querySelector('.seal-cup, .seal-svg');
            const disc = jar?.getBoundingClientRect();
            return {
                hasJar: Boolean(jar?.querySelector('.jar-svg [data-part="gingham"]')),
                hasSeal: Boolean(seal),
                label: button?.getAttribute('aria-label') || '',
                name: button?.querySelector('.fab-txt')?.textContent || '',
                discW: disc?.width || 0,
                discH: disc?.height || 0,
                txt: button?.querySelector('.fab-txt')?.getBoundingClientRect().bottom || 0,
                bar: window.innerHeight,
            };
        });
        check(light.hasJar && !light.hasSeal, `밝은 화면 desk-fab이 시안 C 딸기잼 병이 아닙니다: ${JSON.stringify(light)}`);
        check(light.label === '쨈 빠른 입력 열기' && light.label.startsWith(light.name), `접근성 이름이 보이는 글자(쨈)로 시작하지 않거나 하는 일과 다릅니다: ${light.label}`);
        check(light.name === '쨈', `버튼 이름이 ${light.name} 입니다.`);
        check(Math.abs(light.discW - 60) < 0.6 && Math.abs(light.discH - 60) < 0.6, `밝은 화면 병 접시가 60px가 아닙니다: ${light.discW}×${light.discH}`);
        check(light.txt <= light.bar + 1, '버튼 이름이 하단 막대 밖으로 나갑니다.');

        await page.evaluate(() => document.documentElement.classList.add('dark'));
        const dark = await page.evaluate(() => {
            const button = document.querySelector('.desk-fab');
            return {
                hasJar: Boolean(button?.querySelector('.jar-disc .jar-svg [data-part="gingham"]')),
                hasSeal: Boolean(button?.querySelector('.seal-cup, .seal-svg')),
                name: button?.querySelector('.fab-txt')?.textContent || '',
            };
        });
        check(dark.hasJar && !dark.hasSeal && dark.name === '쨈', `어두운 화면 desk-fab이 시안 C 딸기잼 병이 아닙니다: ${JSON.stringify(dark)}`);

        await page.evaluate(() => document.documentElement.classList.remove('dark'));
        const burst = await page.evaluate(() => {
            const button = document.querySelector('.desk-fab');
            const jar = button.querySelector('.jar-disc');
            button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
            const squishEl = jar.querySelector('.cup-squish');
            squishEl.style.transition = 'none';
            const squish = getComputedStyle(squishEl).transform;
            return {
                press: button.dataset.press || '',
                squish,
                hasSeal: Boolean(button.querySelector('.seal-cup, .seal-svg')),
            };
        });
        check(!burst.hasSeal, '누르는 동안 SealCup 회귀가 보입니다.');
        check(burst.press === 'down' && burst.squish.includes('1.1') && burst.squish.includes('0.86'), `누르고 있는 동안 눌린 채로 머물지 않습니다. ${JSON.stringify(burst)}`);

        const opened = await page.evaluate(() => {
            const button = document.querySelector('.desk-fab');
            window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
            button.click();
            return {
                focused: document.activeElement?.classList.contains('quick-field') || false,
                open: document.querySelector('.quick-bar')?.classList.contains('is-open') || false,
                plus: Boolean(document.querySelector('[data-screen="plus"]')),
                popping: button.classList.contains('is-popping') || button.classList.contains('is-flash'),
                hasJar: Boolean(button.querySelector('.jar-disc .jar-svg [data-part="gingham"]')),
            };
        });
        check(opened.hasJar && opened.focused && opened.open && !opened.plus && opened.popping, `입력칸이 바로 열리지 않습니다: ${JSON.stringify(opened)}`);

        const rapid = await page.evaluate(() => {
            const button = document.querySelector('.desk-fab');
            for (let i = 0; i < 24; i += 1) button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            return {
                hasJar: Boolean(button.querySelector('.jar-disc .jar-svg [data-part="gingham"]')),
                hasSeal: Boolean(button.querySelector('.seal-cup, .seal-svg')),
                press: button.dataset.press || '',
            };
        });
        check(rapid.hasJar && !rapid.hasSeal, `연타 뒤 desk-fab이 병이 아닙니다: ${JSON.stringify(rapid)}`);

        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('.desk-fab .jar-disc');
        const reduced = await page.evaluate(() => {
            const button = document.querySelector('.desk-fab');
            const jar = button.querySelector('.jar-disc');
            button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            const squish = getComputedStyle(jar.querySelector('.cup-squish')).transform;
            button.click();
            return {
                squish,
                press: button.dataset.press || '',
                popping: button.classList.contains('is-popping'),
                flash: button.classList.contains('is-flash'),
                focused: document.activeElement?.classList.contains('quick-field') || false,
                open: document.querySelector('.quick-bar')?.classList.contains('is-open') || false,
                hasJar: Boolean(jar.querySelector('.jar-svg [data-part="gingham"]')),
                hasSeal: Boolean(button.querySelector('.seal-cup, .seal-svg')),
            };
        });
        check(reduced.hasJar && !reduced.hasSeal, `움직임 줄이기에서 desk-fab이 병이 아닙니다: ${JSON.stringify(reduced)}`);
        check(!reduced.popping && reduced.flash, `움직임 줄이기에서 터짐/번쩍임이 어긋납니다: ${JSON.stringify(reduced)}`);
        check(reduced.press === 'down' && (reduced.squish === 'none' || reduced.squish === 'matrix(1, 0, 0, 1, 0, 0)'), `움직임 줄이기에서 눌림이 남습니다. ${reduced.squish}`);
        check(reduced.focused && reduced.open, `움직임 줄이기에서 입력칸이 바로 열리지 않습니다. ${JSON.stringify(reduced)}`);
    } finally {
        await browser.close();
        preview.kill('SIGTERM');
    }
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('하단 용기 검사를 통과했습니다.');
