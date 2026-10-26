import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { readFileSync } from 'node:fs';
import { BURST_MS, MAX_ANIMATIONS, SPLAT_COUNT } from '../src/ui/sealBurst.js';
import { FLAVOR_IDS, SEAL_FILL, THEME_FLAVOR } from '../src/ui/sealFlavor.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPECTED_FLAVOR = { light: 'strawberry', dark: 'strawberry' };
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

check(THEME_FLAVOR.light === EXPECTED_FLAVOR.light && THEME_FLAVOR.dark === EXPECTED_FLAVOR.dark, `화면 모드와 맛이 어긋납니다: ${JSON.stringify(THEME_FLAVOR)}`);
check(FLAVOR_IDS.includes(THEME_FLAVOR.light) && FLAVOR_IDS.includes(THEME_FLAVOR.dark), '고른 맛이 목록 밖에 있습니다.');
check(SEAL_FILL.light !== SEAL_FILL.dark, '밝게와 어둡게의 컵 색이 같습니다.');
check(BURST_MS >= 300 && BURST_MS <= 500, `터지는 시간이 0.3–0.5초가 아닙니다: ${BURST_MS}`);
check(SPLAT_COUNT === 6 && MAX_ANIMATIONS === 8, '얼룩 수나 동작 상한이 바뀌었습니다.');

const burstText = readFileSync(resolve(root, 'src/ui/sealBurst.js'), 'utf8');
check(burstText.includes('prefers-reduced-motion') && burstText.includes('opacity: 0.62'), '움직임 줄이기 분기가 없습니다.');
check(!burstText.includes('getBoundingClientRect') && !burstText.includes('offsetWidth') && !burstText.includes('offsetHeight'), '터지는 동작이 레이아웃을 다시 읽습니다.');
const appText = readFileSync(resolve(root, 'src/App.jsx'), 'utf8');
check(appText.includes('aria-label="할 일 고르기"') && appText.includes('onClick={() => setPlus(true)}'), '버튼 이름이나 바로 열기가 바뀌었습니다.');

const chrome = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => existsSync(path));
if (!chrome) failures.push('브라우저가 없습니다.');

const port = 4178;
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
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-theme', 'light');
        });
        await page.goto(`${origin}?demo=1&mode=light`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.tabbar .fab .seal-cup');
        const light = await page.evaluate(() => {
            const cup = document.querySelector('.tabbar .fab .seal-cup');
            return {
                flavor: cup.dataset.flavor,
                fill: getComputedStyle(cup).getPropertyValue('--seal-fill').trim().toUpperCase(),
                label: document.querySelector('.tabbar .fab').getAttribute('aria-label'),
                splats: cup.querySelectorAll('.seal-splat').length,
            };
        });
        check(light.flavor === EXPECTED_FLAVOR.light, `밝은 화면 맛이 ${light.flavor} 입니다.`);
        check(light.fill === SEAL_FILL.light.toUpperCase(), `밝은 컵 색이 ${light.fill} 입니다.`);
        check(light.label === '할 일 고르기', '접근성 이름이 바뀌었습니다.');
        check(light.splats === SPLAT_COUNT, `얼룩이 ${light.splats}개입니다.`);

        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await page.waitForFunction((flavor) => document.querySelector('.tabbar .fab .seal-cup').dataset.flavor === flavor, {}, EXPECTED_FLAVOR.dark);
        const darkFill = await page.evaluate(() => getComputedStyle(document.querySelector('.tabbar .fab .seal-cup')).getPropertyValue('--seal-fill').trim().toUpperCase());
        check(darkFill === SEAL_FILL.dark.toUpperCase(), `어두운 컵 색이 ${darkFill} 입니다.`);

        await page.evaluate(() => document.documentElement.classList.remove('dark'));
        const burst = await page.evaluate(() => {
            const button = document.querySelector('.tabbar .fab');
            const cup = button.querySelector('.seal-cup');
            button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            const anims = cup.getAnimations({ subtree: true });
            const splatAnims = [...cup.querySelectorAll('.seal-splat')].reduce((sum, el) => sum + el.getAnimations().length, 0);
            return { anims: anims.length, splatAnims, scaled: anims.some((anim) => (anim.effect?.getKeyframes?.() || []).some((frame) => String(frame.transform || '').includes('scale'))) };
        });
        check(burst.anims > 0 && burst.anims <= MAX_ANIMATIONS, `동작이 ${burst.anims}개입니다.`);
        check(burst.splatAnims === SPLAT_COUNT && burst.scaled, '터지는 얼룩 동작이 없습니다.');

        const opened = await page.evaluate(async () => {
            const button = document.querySelector('.tabbar .fab');
            const cup = button.querySelector('.seal-cup');
            const before = performance.now();
            button.click();
            const running = cup.getAnimations({ subtree: true }).some((anim) => anim.playState === 'running');
            return { running, ms: Math.round(performance.now() - before) };
        });
        await page.waitForSelector('[data-screen="plus"]', { timeout: 1500 });
        check(opened.running, '창을 여는 동안 움직임이 이미 끝나 있었습니다.');

        const rapid = await page.evaluate(() => {
            const button = document.querySelector('.tabbar .fab');
            const cup = button.querySelector('.seal-cup');
            for (let i = 0; i < 24; i += 1) button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            return {
                splats: cup.querySelectorAll('.seal-splat').length,
                anims: cup.getAnimations({ subtree: true }).length,
            };
        });
        check(rapid.splats === SPLAT_COUNT, `연타 뒤 얼룩이 ${rapid.splats}개로 늘었습니다.`);
        check(rapid.anims <= MAX_ANIMATIONS, `연타 뒤 동작이 ${rapid.anims}개입니다.`);

        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('.tabbar .fab .seal-cup');
        const reduced = await page.evaluate(() => {
            const button = document.querySelector('.tabbar .fab');
            const cup = button.querySelector('.seal-cup');
            button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            const splatAnims = [...cup.querySelectorAll('.seal-splat')].reduce((sum, el) => sum + el.getAnimations().length, 0);
            const frames = cup.getAnimations().flatMap((anim) => anim.effect?.getKeyframes?.() || []);
            const fades = frames.some((frame) => frame.opacity === 0.62 || frame.opacity === '0.62');
            const scales = frames.some((frame) => String(frame.transform || '').includes('scale'));
            return { splatAnims, fades, scales, splats: cup.querySelectorAll('.seal-splat').length };
        });
        check(reduced.splatAnims === 0 && reduced.fades && !reduced.scales, `움직임 줄이기에서 터짐이 남습니다: ${JSON.stringify(reduced)}`);
        check(reduced.splats === SPLAT_COUNT, '움직임 줄이기에서 얼룩 요소가 사라졌습니다.');
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
