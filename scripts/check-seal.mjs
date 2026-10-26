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
const appText = readFileSync(resolve(root, 'src/App.jsx'), 'utf8');
check(appText.includes('aria-label="할 일 고르기"') && appText.includes('openQuickBar') && !appText.includes('onClick={() => setPlus(true)}'), '버튼이 입력칸을 바로 열지 않습니다.');

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
            const style = getComputedStyle(cup);
            const ids = [...document.querySelectorAll('.seal-cup [id]')].map((el) => el.id);
            return {
                flavor: cup.dataset.flavor,
                fill: style.getPropertyValue('--seal-fill').trim().toUpperCase(),
                jam: style.getPropertyValue('--cup-j1').trim().toUpperCase(),
                plate: style.getPropertyValue('--cup-plate').trim().toUpperCase(),
                label: document.querySelector('.tabbar .fab').getAttribute('aria-label'),
                name: document.querySelector('.tabbar .fab .fab-txt')?.textContent || '',
                drops: cup.querySelectorAll('.cup-pp').length,
                dupIds: ids.length !== new Set(ids).size,
                rawId: ids.some((id) => ['cupd-g', 'cupdjam', 'cupd-foil', 'cupd-dots'].includes(id)),
                d2: getComputedStyle(cup.querySelector('.cup-d2')).display,
                lbl1: getComputedStyle(cup.querySelector('.cup-lbl1')).display,
                lbl2: getComputedStyle(cup.querySelector('.cup-lbl2')).display,
                txt: document.querySelector('.tabbar .fab .fab-txt').getBoundingClientRect().bottom,
                bar: document.querySelector('.tabbar').getBoundingClientRect().bottom,
            };
        });
        check(light.flavor === EXPECTED_FLAVOR.light, `밝은 화면 맛이 ${light.flavor} 입니다.`);
        check(light.fill === SEAL_FILL.light.toUpperCase(), `밝은 컵 색이 ${light.fill} 입니다.`);
        check(light.jam === '#9E1630', `딸기 쨈 색이 ${light.jam} 입니다.`);
        check(light.plate === '#F2F3F6', `밝은 접시 색이 ${light.plate} 입니다.`);
        check(light.label === '할 일 고르기', '접근성 이름이 바뀌었습니다.');
        check(light.name === '쨈', `버튼 이름이 ${light.name} 입니다.`);
        check(light.drops === DROP_COUNT, `방울이 ${light.drops}개입니다.`);
        check(!light.dupIds && !light.rawId, '컵 그림 아이디가 겹치거나 접두가 없습니다.');
        check(light.d2 === 'inline' && light.lbl1 === 'inline' && light.lbl2 === 'none', `60px 접시의 글자 단계가 아닙니다: ${light.d2}/${light.lbl1}/${light.lbl2}`);
        check(light.txt <= light.bar + 1, '버튼 이름이 하단 막대 밖으로 나갑니다.');

        await page.evaluate(() => document.documentElement.classList.add('dark'));
        await page.waitForFunction((flavor) => document.querySelector('.tabbar .fab .seal-cup').dataset.flavor === flavor, {}, EXPECTED_FLAVOR.dark);
        const darkFill = await page.evaluate(() => {
            const style = getComputedStyle(document.querySelector('.tabbar .fab .seal-cup'));
            return {
                fill: style.getPropertyValue('--seal-fill').trim().toUpperCase(),
                jam: style.getPropertyValue('--cup-j1').trim().toUpperCase(),
                plate: style.getPropertyValue('--cup-plate').trim().toUpperCase(),
            };
        });
        check(darkFill.fill === SEAL_FILL.dark.toUpperCase(), `어두운 컵 색이 ${darkFill.fill} 입니다.`);
        check(darkFill.jam === '#9E1630', `어두운 화면에서 쨈 색이 바뀌었습니다: ${darkFill.jam}`);
        check(darkFill.plate === '#262833', `어두운 접시 색이 ${darkFill.plate} 입니다.`);

        await page.evaluate(() => document.documentElement.classList.remove('dark'));
        const burst = await page.evaluate(() => {
            const button = document.querySelector('.tabbar .fab');
            const cup = button.querySelector('.seal-cup');
            button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1 }));
            const anims = cup.getAnimations({ subtree: true }).filter((anim) => String(anim.animationName || '').startsWith('cup-'));
            const squishEl = cup.querySelector('.cup-squish');
            squishEl.style.transition = 'none';
            const squish = getComputedStyle(squishEl).transform;
            return {
                anims: anims.length,
                popping: button.classList.contains('is-popping'),
                press: button.dataset.press || '',
                squish,
            };
        });
        check(burst.anims === 0 && !burst.popping, `누르는 동안 껍질이 먼저 벗겨집니다. ${JSON.stringify(burst)}`);
        check(burst.press === 'down' && burst.squish.includes('1.1') && burst.squish.includes('0.86'), `누르고 있는 동안 눌린 채로 머물지 않습니다. ${JSON.stringify(burst)}`);

        const opened = await page.evaluate(() => {
            const button = document.querySelector('.tabbar .fab');
            const cup = button.querySelector('.seal-cup');
            button.click();
            const first = cup.getAnimations({ subtree: true }).filter((anim) => anim.playState === 'running');
            first.forEach((anim) => { anim.currentTime = 200; });
            button.click();
            const again = cup.getAnimations({ subtree: true }).filter((anim) => anim.playState === 'running');
            const maxTime = again.reduce((max, anim) => Math.max(max, Number(anim.currentTime) || 0), 0);
            const peel = again.some((anim) => String(anim.animationName || '').startsWith('cup-'));
            return {
                running: first.length > 0,
                replay: again.length >= 8 && maxTime < 50 && peel,
                focused: document.activeElement?.classList.contains('quick-field') || false,
                open: document.querySelector('.quick-bar')?.classList.contains('is-open') || false,
                plus: Boolean(document.querySelector('[data-screen="plus"]')),
                popping: button.classList.contains('is-popping'),
            };
        });
        check(opened.running && opened.replay && opened.popping && opened.focused && opened.open && !opened.plus, `입력칸이 바로 열리지 않습니다: ${JSON.stringify(opened)}`);

        const rapid = await page.evaluate(() => {
            const button = document.querySelector('.tabbar .fab');
            const cup = button.querySelector('.seal-cup');
            const before = cup.getAnimations({ subtree: true }).length;
            for (let i = 0; i < 24; i += 1) button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            return {
                drops: cup.querySelectorAll('.cup-pp').length,
                anims: cup.getAnimations({ subtree: true }).length,
                before,
            };
        });
        check(rapid.drops === DROP_COUNT, `연타 뒤 방울이 ${rapid.drops}개로 늘었습니다.`);
        check(rapid.anims <= rapid.before && rapid.anims <= 16, `연타 뒤 동작이 ${rapid.anims}개입니다.`);

        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('.tabbar .fab .seal-cup');
        const reduced = await page.evaluate(() => {
            const button = document.querySelector('.tabbar .fab');
            const cup = button.querySelector('.seal-cup');
            button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
            const squish = getComputedStyle(cup.querySelector('.cup-squish')).transform;
            button.click();
            const dropAnims = [...cup.querySelectorAll('.cup-pp')].reduce((sum, el) => sum + el.getAnimations().length, 0);
            return {
                dropAnims,
                squish,
                drops: cup.querySelectorAll('.cup-pp').length,
                press: button.dataset.press || '',
                popping: button.classList.contains('is-popping'),
                flash: button.classList.contains('is-flash'),
                focused: document.activeElement?.classList.contains('quick-field') || false,
                open: document.querySelector('.quick-bar')?.classList.contains('is-open') || false,
            };
        });
        check(reduced.dropAnims === 0 && !reduced.popping && reduced.flash, `움직임 줄이기에서 터짐이 남습니다: ${JSON.stringify(reduced)}`);
        check(reduced.press === 'down' && (reduced.squish === 'none' || reduced.squish === 'matrix(1, 0, 0, 1, 0, 0)'), `움직임 줄이기에서 눌림이 남습니다. ${reduced.squish}`);
        check(reduced.focused && reduced.open, `움직임 줄이기에서 입력칸이 바로 열리지 않습니다. ${JSON.stringify(reduced)}`);
        check(reduced.drops === DROP_COUNT, '움직임 줄이기에서 방울 요소가 사라졌습니다.');
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
