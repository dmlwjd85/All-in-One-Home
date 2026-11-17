/** 기본 꾸미기 화면이 main 과 같은지 픽셀로 견줍니다. MAIN_ORIGIN 이 있으면 두 미리보기를 견주고, 없으면 이 빌드만 찍습니다. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const viteBin = resolve('node_modules/vite/bin/vite.js');
const freePort = () => new Promise((ok, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        server.close(() => ok(port));
    });
});
const shots = process.env.SHOT_DIR || '/opt/cursor/artifacts/cork-skin';
mkdirSync(shots, { recursive: true });
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome'].find((path) => path && existsSync(path));
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const FIXED_NOW = '2026-10-23T08:42:00+09:00';

async function serve(cwd) {
    const port = await freePort();
    const origin = `http://127.0.0.1:${port}/`;
    const preview = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd, stdio: 'ignore' });
    for (let i = 0; i < 80; i += 1) {
        try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
        await delay(150);
    }
    return { origin, preview };
}

async function freezePage(page) {
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.addStyleTag({ content: '*, *::before, *::after { animation: none !important; animation-delay: 0s !important; transition: none !important; } .fuse-wave, .fuse-spark, .fuse-ember, .fuse-char { animation: none !important; }' });
}

async function shot(browser, origin, label) {
    const scenes = [
        ['home', '#/today', async () => {}],
        ['calendar', '#/schedule', async () => {}],
        ['attend', '#/attend', async () => {}],
        ['jam', '#/today', async (page) => {
            await page.waitForSelector('button[aria-label="쨈 빠른 입력 열기"]');
            await page.evaluate(() => {
                const buttons = [...document.querySelectorAll('button[aria-label="쨈 빠른 입력 열기"]')];
                const visible = buttons.find((el) => el.getBoundingClientRect().height > 0);
                (visible || buttons[0])?.click();
            });
            await page.waitForSelector('.quick-bar.is-open', { timeout: 5000 });
            /* 쨈 뚜껑 애니메이션이 끝나면 키캡이 같아집니다. 움직임 끄기 때문에 클래스만 걷습니다. */
            await page.evaluate(() => {
                document.querySelectorAll('.foil-fab').forEach((el) => el.classList.remove('is-popping', 'is-pressed', 'is-flash', 'is-burst'));
                document.querySelectorAll('.cup-pp, .cup-bit').forEach((el) => el.remove());
            });
        }],
    ];
    const out = {};
    for (const [name, hash, prepare] of scenes) {
        const page = await browser.newPage();
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
        await page.evaluateOnNewDocument((iso) => {
            const fixed = new Date(iso).valueOf();
            const NativeDate = Date;
            function FrozenDate(...args) {
                if (!new.target) return new NativeDate(fixed).toString();
                if (args.length === 0) return new NativeDate(fixed);
                return new NativeDate(...args);
            }
            FrozenDate.now = () => fixed;
            FrozenDate.parse = NativeDate.parse;
            FrozenDate.UTC = NativeDate.UTC;
            FrozenDate.prototype = NativeDate.prototype;
            window.Date = FrozenDate;
            localStorage.setItem('ssug-gyomu-home-fold', JSON.stringify({ time: true, todo: true, event: true, recent: true }));
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-onboard', JSON.stringify({ notice: 'folded', auto: false, day: '', steps: {} }));
            localStorage.setItem('ssug-gyomu-skin', 'basic');
            localStorage.removeItem('ssug-gyomu-kb-theme');
        }, FIXED_NOW);
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.goto(`${origin}?demo=1&at=08:42&mode=light${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => document.querySelector('[data-ready="1"]') || document.body.innerText.includes('오늘 우리 반'), { timeout: 20000 });
        await freezePage(page);
        await prepare(page);
        await freezePage(page);
        await page.evaluate(() => document.fonts.ready);
        await delay(400);
        const skin = await page.evaluate(() => document.documentElement.getAttribute('data-skin'));
        if (skin) throw new Error(`${label} ${name} 에 data-skin=${skin} 이 있습니다.`);
        await delay(500);
        const buf = await page.screenshot({ type: 'png' });
        writeFileSync(resolve(shots, `basic-${name}-390-light-${label}.png`), buf);
        out[name] = buf;
        await page.close();
    }
    return out;
}

function diffPng(a, b) {
    if (a.equals(b)) return { same: true, bytes: a.length };
    return { same: false, a: a.length, b: b.length };
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'] });
const here = await serve(process.cwd());
let main;
try {
    const ours = await shot(browser, here.origin, 'branch');
    const mainCwd = process.env.MAIN_DIST;
    const report = {};
    if (mainCwd && existsSync(mainCwd)) {
        main = await serve(mainCwd);
        let theirs = await shot(browser, main.origin, 'main');
        for (const name of Object.keys(ours)) report[name] = diffPng(ours[name], theirs[name]);
        for (let round = 0; round < 2 && Object.values(report).some((v) => v.same === false); round += 1) {
            const againOurs = await shot(browser, here.origin, 'branch');
            const againTheirs = await shot(browser, main.origin, 'main');
            for (const name of Object.keys(ours)) {
                ours[name] = againOurs[name];
                theirs[name] = againTheirs[name];
                report[name] = diffPng(ours[name], theirs[name]);
            }
        }
    } else {
        for (const name of Object.keys(ours)) report[name] = { skipped: true, reason: 'MAIN_DIST 없음' };
    }
    console.log(JSON.stringify(report, null, 2));
    const bad = Object.entries(report).filter(([, v]) => v.same === false);
    if (bad.length) {
        console.error(`기본 화면 픽셀이 main 과 다릅니다: ${bad.map(([n]) => n).join(', ')}`);
        process.exit(2);
    }
} finally {
    await browser.close().catch(() => {});
    here.preview.kill();
    main?.preview.kill();
}
