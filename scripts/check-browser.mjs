/** 360·390·1280에서 넘침과 버튼 크기, 주요 흐름을 확인하고 화면을 저장합니다. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const root = resolve(new URL('..', import.meta.url).pathname);
const shots = '/opt/cursor/artifacts/screenshots';
mkdirSync(shots, { recursive: true });
const port = 4175;
const origin = `http://127.0.0.1:${port}/`;
const chrome = ['/usr/bin/google-chrome-stable', '/usr/local/bin/google-chrome', '/usr/bin/google-chrome'].find((path) => existsSync(path));
if (!chrome) {
    console.error('크롬을 찾지 못했습니다.');
    process.exit(1);
}

const preview = spawn('npx', ['vite', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
});
let log = '';
preview.stdout.on('data', (chunk) => { log += chunk; });
preview.stderr.on('data', (chunk) => { log += chunk; });

async function waitServer() {
    for (let i = 0; i < 40; i += 1) {
        try {
            const res = await fetch(origin);
            if (res.ok) return;
        } catch { /* 아직 안 열림 */ }
        await delay(250);
    }
    throw new Error('미리보기가 열리지 않았습니다.');
}

const failures = [];
function check(ok, message) {
    if (!ok) failures.push(message);
}

const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function openDemo(width, mode) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    await page.setViewport({ width, height: 800, deviceScaleFactor: 1 });
    const query = mode === 'dark' ? 'demo=1&at=08:42&mode=dark' : 'demo=1&at=08:42&mode=light';
    await page.goto(`${origin}?${query}`, { waitUntil: 'networkidle0' });
    await page.waitForFunction(() => document.body.innerText.includes('오늘 우리 반'), { timeout: 8000 });
    return { context, page };
}

async function audit(page, label) {
    const result = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const overflow = [];
        if (document.documentElement.scrollWidth > width + 1) overflow.push(`문서 ${document.documentElement.scrollWidth}`);
        const nodes = [...document.body.querySelectorAll('*')];
        for (const el of nodes) {
            const style = getComputedStyle(el);
            if (style.position === 'fixed') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 2 || rect.height < 2) continue;
            if (rect.right > width + 1.5 && rect.left >= -1) {
                overflow.push((el.getAttribute('aria-label') || el.textContent || el.className || '').toString().trim().slice(0, 24));
                if (overflow.length > 8) break;
            }
        }
        const small = [];
        for (const el of document.querySelectorAll('button, a, input, textarea, select')) {
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) continue;
            if (rect.width < 43.5 || rect.height < 43.5) {
                small.push(`${(el.getAttribute('aria-label') || el.innerText || el.tagName).toString().trim().slice(0, 18)} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
            }
        }
        return { overflow, small: small.slice(0, 12) };
    });
    if (result.overflow.length) failures.push(`${label} 가로 넘침: ${result.overflow.join(', ')}`);
    if (result.small.length) failures.push(`${label} 44px 미만: ${result.small.join(', ')}`);
}

try {
    await waitServer();
    const scenes = [
        ['home-360-lilac.png', 360, 'light', async (page) => page],
        ['attend-360-lilac.png', 360, 'light', async (page) => { await page.evaluate(() => { location.hash = '#/attend'; }); await delay(200); }],
        ['record-360-lilac.png', 360, 'light', async (page) => { await page.evaluate(() => { location.hash = '#/students/12'; }); await page.waitForFunction(() => document.body.innerText.includes('이하은')); }],
        ['quick-360-lilac.png', 360, 'light', async (page) => { await page.click('[aria-label="쓱, 적"]'); await page.waitForSelector('[aria-label="쓱, 적"][role="dialog"], .sheet'); }],
        ['home-360-dark.png', 360, 'dark', async () => {}],
        ['attend-360-dark.png', 360, 'dark', async (page) => { await page.evaluate(() => { location.hash = '#/attend'; }); await delay(200); }],
        ['record-360-dark.png', 360, 'dark', async (page) => { await page.evaluate(() => { location.hash = '#/students/12'; }); await page.waitForFunction(() => document.body.innerText.includes('이하은')); }],
        ['quick-360-dark.png', 360, 'dark', async (page) => { await page.click('[aria-label="쓱, 적"]'); await delay(250); }],
        ['home-1280-lilac.png', 1280, 'light', async () => {}],
    ];

    for (const [name, width, mode, prepare] of scenes) {
        const { context, page } = await openDemo(width, mode);
        await prepare(page);
        await delay(250);
        await audit(page, name);
        await page.screenshot({ path: resolve(shots, name) });
        await context.close();
    }

    for (const width of [360, 390]) {
        const { context, page } = await openDemo(width, 'light');
        await page.evaluate(() => { location.hash = '#/schedule'; });
        await delay(200);
        await audit(page, `일정 ${width}`);
        await page.evaluate(() => { location.hash = '#/settings'; });
        await delay(200);
        await audit(page, `설정 ${width}`);
        await page.evaluate(() => { location.hash = '#/todo'; });
        await delay(200);
        await audit(page, `할일 ${width}`);
        await context.close();
    }

    const flow = await openDemo(390, 'light');
    const homeText = await flow.page.evaluate(() => document.body.innerText);
    check(homeText.includes('1교시') && homeText.includes('18분'), '홈에 다음 교시 18분이 없습니다.');
    check(homeText.includes('박서준') && homeText.includes('결석'), '홈에 결석이 없습니다.');
    await flow.page.click('[aria-label="쓱, 적"]');
    await flow.page.waitForSelector('textarea');
    await flow.page.type('textarea', '@12 #학습 내일 정리까지 맡았어요');
    await flow.page.keyboard.press('Enter');
    await flow.page.waitForFunction(() => document.body.innerText.includes('되돌리기'));
    await flow.page.click('button::-p-text(되돌리기)').catch(async () => {
        const buttons = await flow.page.$$('button');
        for (const button of buttons) {
            const text = await flow.page.evaluate((el) => el.innerText, button);
            if (text.includes('되돌리기')) { await button.click(); return; }
        }
    });
    await flow.page.evaluate(() => { location.hash = '#/attend'; });
    await flow.page.waitForFunction(() => document.body.innerText.includes('안 온 친구만'));
    const clicked = await flow.page.evaluate(() => {
        const button = [...document.querySelectorAll('button')].find((el) => el.innerText.includes('김하늘'));
        button?.click();
        return Boolean(button);
    });
    check(clicked, '출결 칸을 누르지 못했습니다.');
    await delay(200);
    const attendText = await flow.page.evaluate(() => document.body.innerText);
    check(attendText.includes('김하늘') && attendText.includes('결석'), '출결을 눌러도 결석이 되지 않습니다.');
    await flow.context.close();

    const legacy = await browser.createBrowserContext();
    const legacyPage = await legacy.newPage();
    await legacyPage.setViewport({ width: 390, height: 800 });
    await legacyPage.evaluateOnNewDocument(() => {
        localStorage.setItem('homenote_v2_classRoster', JSON.stringify([{ id: '1', name: '김하늘' }]));
    });
    await legacyPage.goto(`${origin}?mode=light`, { waitUntil: 'networkidle0' });
    await legacyPage.waitForFunction(() => document.body.innerText.includes('이 기기에서만'));
    await legacyPage.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('이 기기에서만'))?.click());
    await legacyPage.waitForFunction(() => document.body.innerText.includes('예전 교무수첩'));
    const still = await legacyPage.evaluate(() => localStorage.getItem('homenote_v2_classRoster'));
    check(still && still.includes('김하늘'), '시작 화면이 원본 키를 지웠습니다.');
    await legacy.close();

    const offline = await openDemo(390, 'light');
    await offline.page.evaluate(async () => {
        const reg = await navigator.serviceWorker.ready;
        return Boolean(reg.active);
    });
    await offline.page.reload({ waitUntil: 'networkidle0' });
    await offline.page.setOfflineMode(true);
    await offline.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await delay(400);
    const offlineText = await offline.page.evaluate(() => document.body.innerText).catch(() => '');
    check(offlineText.includes('쓱') || offlineText.includes('인터넷'), '오프라인에서 껍데기가 열리지 않습니다.');
    await offline.context.close();
} catch (error) {
    failures.push(error?.message || String(error));
} finally {
    await browser.close();
    preview.kill('SIGTERM');
}

if (failures.length) {
    console.error(failures.join('\n'));
    if (log) console.error(log.slice(-2000));
    process.exit(1);
}
console.log('브라우저 검사를 통과했습니다. 화면은 artifacts/screenshots 에 있습니다.');
