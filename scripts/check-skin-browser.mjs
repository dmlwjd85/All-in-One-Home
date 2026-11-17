/** 화면 꾸미기 전환: 설정 타일, data-skin, 밝기·키보드와 분리, 콘솔 오류, 코르크 화면 저장. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync } from 'node:fs';
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
const port = Number(process.env.SKIN_PORT) || await freePort();
const origin = `http://127.0.0.1:${port}/`;
const shots = process.env.SHOT_DIR || '/opt/cursor/artifacts/cork-skin-v2';
mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => path && existsSync(path));
if (!chrome) {
    console.error('크롬을 찾지 못했습니다.');
    process.exit(1);
}

const FIXED_NOW = '2026-10-23T08:42:00+09:00';
const consoleErrors = [];
const noisy = /Failed to load resource|net::ERR|firebase|Firestore|404|AbortError|favicon/i;

const preview = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
    await delay(150);
}

const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--hide-scrollbars'],
});

async function pin(page, extra, ...args) {
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
    }, FIXED_NOW);
    if (extra) await page.evaluateOnNewDocument(extra, ...args);
}

function listen(page) {
    page.on('pageerror', (error) => {
        const text = String(error?.message || error);
        if (!noisy.test(text)) consoleErrors.push(text);
    });
    page.on('console', (msg) => {
        if (msg.type() !== 'error') return;
        const text = msg.text();
        if (!noisy.test(text)) consoleErrors.push(text);
    });
}

function boxesOverlap(a, b, pad = 1) {
    return a.left < b.right - pad && a.right > b.left + pad && a.top < b.bottom - pad && a.bottom > b.top + pad;
}

async function overlapHits(page, label) {
    const hits = await page.evaluate(() => {
        const deco = [];
        const root = document.querySelector('.app-bg');
        if (!root) return { deco, hits: [] };
        for (const name of ['::before', '::after']) {
            const s = getComputedStyle(root, name);
            const raw = String(s.content || '');
            if (!raw || raw === 'none' || raw === 'normal') continue;
            const w = parseFloat(s.width);
            const h = parseFloat(s.height);
            if (!w || !h || s.display === 'none' || s.visibility === 'hidden') continue;
            const right = s.right === 'auto' ? NaN : parseFloat(s.right);
            const bottom = s.bottom === 'auto' ? NaN : parseFloat(s.bottom);
            const left = s.left === 'auto' ? (Number.isFinite(right) ? innerWidth - right - w : 0) : parseFloat(s.left);
            const top = s.top === 'auto' ? (Number.isFinite(bottom) ? innerHeight - bottom - h : 0) : parseFloat(s.top);
            deco.push({ left, top, right: left + w, bottom: top + h, name });
        }
        const hits = [];
        const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
        const add = (el, name) => {
            const r = el.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) return;
            const st = getComputedStyle(el);
            if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return;
            hits.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, name });
        };
        document.querySelectorAll('button, a, input, textarea, select, [role="button"], .fuse, .tabbar, .desk-fab, .cloud-note').forEach((el) => add(el, el.getAttribute('aria-label') || el.className || el.tagName));
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const p = node.parentElement;
                if (!p || skip.has(p.tagName)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        while (walker.nextNode()) {
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            const r = range.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) continue;
            hits.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, name: walker.currentNode.nodeValue.trim().slice(0, 28) });
        }
        return { deco, hits };
    });
    for (const box of hits.deco) {
        for (const item of hits.hits) {
            if (boxesOverlap(box, item)) {
                check(false, `${label} 장식이 글자·단추와 겹칩니다: ${item.name}`);
                return;
            }
        }
    }
}

async function openPage({ width = 390, height = 844, mode = 'light', skin = 'basic', kb = null, hash = '#/today' } = {}) {
    const page = await browser.newPage();
    listen(page);
    await pin(page, (skinId, kbId) => {
        if (skinId === 'cork') localStorage.setItem('ssug-gyomu-skin', 'cork');
        else localStorage.setItem('ssug-gyomu-skin', 'basic');
        if (kbId) localStorage.setItem('ssug-gyomu-kb-theme', kbId);
    }, skin, kb);
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`${origin}?demo=1&at=08:42&mode=${mode}${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('[data-ready="1"]') || document.body.innerText.includes('오늘 우리 반') || document.body.innerText.includes('화면'), { timeout: 20000 });
    await page.evaluate(() => document.fonts.ready);
    await delay(200);
    return page;
}

try {
    /* 기본은 속성이 없고, 설정에서 코르크로 바꾸면 이 기기에만 남습니다. */
    {
        const page = await openPage({ hash: '#/settings/screen' });
        await page.waitForSelector('[data-skin-pick="cork"]');
        const first = await page.evaluate(() => ({
            skin: document.documentElement.getAttribute('data-skin'),
            stored: localStorage.getItem('ssug-gyomu-skin'),
            tiles: [...document.querySelectorAll('[data-skin-pick]')].map((el) => el.getAttribute('data-skin-pick')),
            labels: (document.querySelector('[aria-label="화면 꾸미기"]') || document.body).innerText,
        }));
        check(!first.skin, `기본인데 data-skin 이 있습니다: ${first.skin}`);
        check(first.tiles.join() === 'basic,cork', `꾸미기 타일이 다릅니다: ${first.tiles}`);
        check(first.labels.includes('기본') && first.labels.includes('교실 코르크'), '설정 타일 이름이 없습니다.');
        await page.click('[data-skin-pick="cork"]');
        await delay(120);
        const after = await page.evaluate(() => ({
            skin: document.documentElement.getAttribute('data-skin'),
            stored: localStorage.getItem('ssug-gyomu-skin'),
            theme: localStorage.getItem('ssug-gyomu-theme'),
            kb: document.documentElement.getAttribute('data-kb'),
            bg: getComputedStyle(document.documentElement).backgroundColor,
            deco: getComputedStyle(document.querySelector('.app-bg'), '::before').pointerEvents,
        }));
        check(after.skin === 'cork' && after.stored === 'cork', `코르크로 바꾸지 못합니다: ${JSON.stringify(after)}`);
        check(after.kb == null, '꾸미기를 바꾸며 키보드 테마가 바뀝니다.');
        check(after.deco === 'none', `장식이 클릭을 가로챕니다: ${after.deco}`);
        await page.click('[data-skin-pick="basic"]');
        await delay(120);
        const back = await page.evaluate(() => ({
            skin: document.documentElement.getAttribute('data-skin'),
            stored: localStorage.getItem('ssug-gyomu-skin'),
        }));
        check(!back.skin && back.stored === 'basic', `기본으로 돌아오지 않습니다: ${JSON.stringify(back)}`);
        await page.close();
    }

    /* 첫 스크립트가 코르크를 바로 붙여 깜빡임을 막습니다. */
    {
        const page = await openPage({ skin: 'cork' });
        const boot = await page.evaluate(() => ({
            skin: document.documentElement.getAttribute('data-skin'),
            stored: localStorage.getItem('ssug-gyomu-skin'),
        }));
        check(boot.skin === 'cork' && boot.stored === 'cork', `다시 열어도 코르크가 아닙니다: ${JSON.stringify(boot)}`);
        await page.close();
    }

    /* 밝기·키보드 테마와 따로입니다. */
    {
        const page = await openPage({ mode: 'dark', skin: 'cork', kb: 'retro' });
        const mix = await page.evaluate(() => ({
            dark: document.documentElement.classList.contains('dark'),
            skin: document.documentElement.getAttribute('data-skin'),
            kb: document.documentElement.getAttribute('data-kb'),
            present: getComputedStyle(document.documentElement).getPropertyValue('--st-present').trim(),
        }));
        check(mix.dark && mix.skin === 'cork' && mix.kb === 'retro', `밝기·키보드·꾸미기가 섞입니다: ${JSON.stringify(mix)}`);
        check(mix.present === '#8EDEBE', `어두운 출결 출석 색이 바뀌었습니다: ${mix.present}`);
        await page.close();
    }

    /* 밝은 화면 출결 색도 그대로입니다. */
    {
        const page = await openPage({ skin: 'cork', hash: '#/attend' });
        const attend = await page.evaluate(() => ({
            present: getComputedStyle(document.documentElement).getPropertyValue('--st-present').trim(),
            absent: getComputedStyle(document.documentElement).getPropertyValue('--st-absent').trim(),
            late: getComputedStyle(document.documentElement).getPropertyValue('--st-late').trim(),
        }));
        check(attend.present === '#15714E' && attend.absent === '#BA253D' && attend.late === '#915200', `출결 색이 바뀌었습니다: ${JSON.stringify(attend)}`);
        await page.close();
    }

    const scenes = [
        ['home', '#/today', async () => {}],
        ['calendar', '#/schedule', async (page) => {
            await page.waitForFunction(() => location.hash.startsWith('#/schedule'), { timeout: 8000 });
        }],
        ['attend', '#/attend', async () => {}],
        ['settings', '#/settings/screen', async (page) => {
            await page.waitForSelector('[data-skin-pick="cork"]');
        }],
        ['jam', '#/today', async (page) => {
            await page.waitForSelector('button[aria-label="쨈 빠른 입력 열기"]');
            await page.evaluate(() => {
                const buttons = [...document.querySelectorAll('button[aria-label="쨈 빠른 입력 열기"]')];
                const visible = buttons.find((el) => {
                    const r = el.getBoundingClientRect();
                    const s = getComputedStyle(el);
                    return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden';
                });
                (visible || buttons[0])?.click();
            });
            await page.waitForSelector('.quick-bar.is-open', { timeout: 5000 });
        }],
    ];

    for (const width of [320, 390, 768, 1280]) {
        for (const mode of ['light', 'dark']) {
            for (const [name, hash, prepare] of scenes) {
                const page = await openPage({ width, height: width >= 768 ? 900 : 844, mode, skin: 'cork', hash });
                await prepare(page);
                await delay(180);
                const file = `cork-${name}-${width}-${mode}.png`;
                await page.screenshot({ path: resolve(shots, file) });
                const look = await page.evaluate(() => ({
                    skin: document.documentElement.getAttribute('data-skin'),
                    deco: getComputedStyle(document.querySelector('.app-bg'), '::before').pointerEvents,
                    before: getComputedStyle(document.querySelector('.app-bg'), '::before').content,
                }));
                check(look.skin === 'cork', `${file} 에 코르크가 없습니다.`);
                check(look.deco === 'none', `${file} 장식이 클릭을 가로챕니다.`);
                check(look.before === 'none' || look.before === 'normal', `${file} 떠 있는 장식이 글자 위에 있습니다.`);
                await overlapHits(page, file);
                await page.close();
            }
        }
    }
} finally {
    await browser.close().catch(() => {});
    preview.kill();
}

const uniqueErrors = [...new Set(consoleErrors)];
check(uniqueErrors.length === 0, `콘솔 오류 ${uniqueErrors.length}건: ${uniqueErrors.slice(0, 6).join(' | ')}`);

if (failures.length) {
    console.error(`화면 꾸미기 브라우저 검사 실패 ${failures.length}건`);
    for (const item of failures) console.error(`- ${item}`);
    process.exit(1);
}
console.log(`화면 꾸미기 브라우저 검사를 통과했습니다. 화면은 ${shots} 에 있습니다. 콘솔 오류 ${uniqueErrors.length}건.`);
