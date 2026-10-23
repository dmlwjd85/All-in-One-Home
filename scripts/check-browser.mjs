/** 360·390·1280에서 넘침과 버튼 크기, 주요 흐름을 확인하고 화면을 저장합니다. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { addDaysYmd, fromYmd, monthTitle, seoulYmd, startOfWeekMon, weekdayKo } from '../src/lib/date.js';

/**
 * 브라우저 시계. 서울 평일 오전(2026-10-23 금 08:42)으로 고정합니다.
 * 실제 시계와 자정을 쓰지 않아, 주말·자정에도 같은 주를 봅니다.
 * 다른 브랜치로 옮길 때는 이 상수, pinBrowserClock, withPage·withDemo의 호출만 가져가면 됩니다.
 */
const FIXED_NOW = process.env.FIXED_NOW || '2026-10-23T08:42:00+09:00';

async function pinBrowserClock(page) {
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
    }, FIXED_NOW);
}

/** '금요일까지'와 같은 규칙입니다. 오늘을 포함한 가장 가까운 그 요일입니다. */
function nearestWeekdayYmd(today, weekday) {
    const delta = (weekday - fromYmd(today).getDay() + 7) % 7;
    return addDaysYmd(today, delta);
}

function koMonthDay(ymd) {
    return `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;
}

const todayYmd = seoulYmd(new Date(FIXED_NOW));
const fridayYmd = nearestWeekdayYmd(todayYmd, 5);
const fridayLabel = koMonthDay(fridayYmd);
const fridaySlash = `${Number(fridayYmd.slice(5, 7))}/${Number(fridayYmd.slice(8, 10))}`;
const lastFridayLabel = koMonthDay(addDaysYmd(addDaysYmd(startOfWeekMon(todayYmd), 4), -7));
const todayLabel = koMonthDay(todayYmd);
const todaySlash = `${Number(todayYmd.slice(5, 7))}/${Number(todayYmd.slice(8, 10))}`;
const todayWeek = weekdayKo(todayYmd);
const todayMonthLabel = monthTitle(todayYmd.slice(0, 7));
const todayDay = Number(todayYmd.slice(8, 10));
const tuesdayLabel = koMonthDay(nearestWeekdayYmd(todayYmd, 2));

function daysInMonth(ymd) {
    const [year, month] = ymd.split('-').map(Number);
    return new Date(year, month, 0).getDate();
}

function monthEndLabelOf(ymd) {
    return koMonthDay(`${ymd.slice(0, 8)}${String(daysInMonth(ymd)).padStart(2, '0')}`);
}

/** 글에 적을 날짜. 요일은 그 날의 실제 요일입니다. */
function dated(ymd) {
    const month = Number(ymd.slice(5, 7));
    const day = Number(ymd.slice(8, 10));
    return { ymd, label: koMonthDay(ymd), slash: `${month}/${day}(${weekdayKo(ymd)})`, week: weekdayKo(ymd) };
}

/** '25~27일'과 같은 월 없는 기간. 끝이 오늘보다 앞이면 달을 넘깁니다. */
function monthlessSpan(today) {
    const day = Number(today.slice(8, 10));
    const last = daysInMonth(today);
    if (day + 2 <= last) {
        return {
            text: `${day}~${day + 2}일`,
            start: koMonthDay(today),
            end: koMonthDay(addDaysYmd(today, 2)),
        };
    }
    const start = `${today.slice(0, 8)}${String(last).padStart(2, '0')}`;
    return {
        text: `${last}~2일`,
        start: koMonthDay(start),
        end: koMonthDay(addDaysYmd(start, 2)),
    };
}

const monthEndLabel = monthEndLabelOf(todayYmd);
const photo = dated(addDaysYmd(todayYmd, 5));
const delayedFrom = dated(addDaysYmd(todayYmd, 3));
const delayedTo = dated(addDaysYmd(todayYmd, 10));
const pulledFrom = dated(addDaysYmd(todayYmd, 8));
const pulledTo = dated(addDaysYmd(todayYmd, 2));
const bareSpan = monthlessSpan(todayYmd);

const root = resolve(new URL('..', import.meta.url).pathname);
const shots = prepareShots();
const port = 4175;
const origin = `http://127.0.0.1:${port}/`;
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find((path) => path && existsSync(path));
if (!chrome) {
    console.error('크롬을 찾지 못했습니다.');
    process.exit(1);
}

function prepareShots() {
    const candidates = [process.env.SCREENSHOT_DIR, '/opt/cursor/artifacts/screenshots', '/tmp/ssug-screenshots'].filter(Boolean);
    for (const dir of candidates) {
        try {
            mkdirSync(dir, { recursive: true });
            return dir;
        } catch {
            /* 쓸 수 없는 경로면 다음으로 넘어갑니다. */
        }
    }
    throw new Error('화면을 저장할 곳을 만들지 못했습니다.');
}

const chromeArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--hide-scrollbars',
    '--metrics-recording-only',
];

const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');
const preview = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', BROWSER: 'none' },
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

let settled = false;

function descendants(pid, found = []) {
    let names = [];
    try { names = readdirSync('/proc'); } catch { return found; }
    for (const name of names) {
        if (!/^\d+$/.test(name)) continue;
        try {
            const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
            const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            const parent = Number(after[1]);
            if (parent !== pid) continue;
            const child = Number(name);
            descendants(child, found);
            found.push(child);
        } catch { /* 프로세스가 이미 없습니다. */ }
    }
    return found;
}

function killTree(child) {
    const pid = child?.pid;
    if (!pid) return;
    for (const id of descendants(pid)) {
        try { process.kill(id, 'SIGKILL'); } catch { /* 이미 끝났습니다. */ }
    }
    try { process.kill(-pid, 'SIGKILL'); } catch { /* 프로세스 그룹이 없습니다. */ }
    try { process.kill(pid, 'SIGKILL'); } catch { /* 이미 끝났습니다. */ }
}

async function shutdown(code) {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    const chromeProc = browser?.process?.();
    await Promise.race([
        browser?.close().catch(() => {}),
        delay(2000),
    ]);
    killTree(chromeProc);
    browser = null;
    try {
        preview.stdout?.destroy();
        preview.stderr?.destroy();
    } catch { /* 파이프가 이미 닫혔습니다. */ }
    killTree(preview);
    process.exit(code);
}

const watchdog = setTimeout(() => {
    console.error('브라우저 검사가 6분을 넘겨 멈춰서 끝냅니다.');
    shutdown(1);
}, 6 * 60 * 1000);

let browser = null;

async function launchBrowser() {
    const next = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        timeout: 45000,
        protocolTimeout: 45000,
        dumpio: false,
        args: [...chromeArgs, '--no-zygote'],
    });
    next.on('disconnected', () => {
        if (browser === next) browser = null;
    });
    return next;
}

async function ensureBrowser() {
    if (browser && browser.connected) return browser;
    let last;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            browser = await launchBrowser();
            return browser;
        } catch (error) {
            last = error;
            browser = null;
            await delay(500);
        }
    }
    throw last;
}

async function resetBrowser() {
    if (browser) await browser.close().catch(() => {});
    browser = null;
}

async function withPage(width, fn) {
    let last;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        let context;
        try {
            const current = await ensureBrowser();
            context = await current.createBrowserContext();
            const page = await context.newPage();
            page.setDefaultTimeout(20000);
            page.setDefaultNavigationTimeout(30000);
            await pinBrowserClock(page);
            await page.setViewport({ width, height: 800, deviceScaleFactor: 1 });
            await fn(page);
            await context.close().catch(() => {});
            return;
        } catch (error) {
            last = error;
            await context?.close().catch(() => {});
            await resetBrowser();
            await delay(400);
        }
    }
    throw last;
}

async function withDemo(width, mode, fn, height = 800) {
    let last;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        let context;
        let page;
        try {
            const current = await ensureBrowser();
            context = await current.createBrowserContext();
            page = await context.newPage();
            page.setDefaultTimeout(20000);
            page.setDefaultNavigationTimeout(30000);
            await pinBrowserClock(page);
            await page.setViewport({ width, height, deviceScaleFactor: 1 });
            const query = mode === 'dark' ? 'demo=1&at=08:42&mode=dark' : 'demo=1&at=08:42&mode=light';
            await page.goto(`${origin}?${query}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForFunction(() => document.body.innerText.includes('오늘 우리 반'), { timeout: 15000 });
            await fn(page);
            await context.close().catch(() => {});
            return;
        } catch (error) {
            last = error;
            const where = await page?.evaluate(() => document.body?.innerText?.slice(0, 320) || '').catch(() => '');
            console.error(`화면 시도 ${attempt} 실패: ${error?.message}\n${String(where).replace(/\s+/g, ' ')}`);
            await context?.close().catch(() => {});
            await resetBrowser();
            await delay(400);
        }
    }
    throw last;
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
        for (const el of document.querySelectorAll('button, a, input, textarea, select, [role="button"]')) {
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) continue;
            if (rect.width < 43.5 || rect.height < 43.5) {
                small.push(`${(el.getAttribute('aria-label') || el.innerText || el.tagName).toString().trim().slice(0, 18)} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
            }
        }
        function splitShadows(value) {
            const parts = [];
            let buf = '';
            let depth = 0;
            for (const ch of String(value || '')) {
                if (ch === '(') depth += 1;
                else if (ch === ')') depth = Math.max(0, depth - 1);
                if (ch === ',' && depth === 0) {
                    if (buf.trim()) parts.push(buf.trim().replace(/\s+/g, ' '));
                    buf = '';
                } else buf += ch;
            }
            if (buf.trim()) parts.push(buf.trim().replace(/\s+/g, ' '));
            return parts;
        }
        const probe = document.createElement('div');
        probe.style.position = 'absolute';
        probe.style.left = '-9999px';
        document.body.appendChild(probe);
        const signatures = ['--neo-raise', '--neo-raise-sm'].map((name) => {
            probe.style.boxShadow = `var(${name})`;
            return splitShadows(getComputedStyle(probe).boxShadow);
        }).filter((parts) => parts.length);
        probe.remove();
        const raised = [];
        for (const el of document.querySelectorAll('*')) {
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const shadow = style.boxShadow;
            if (!shadow || shadow === 'none') continue;
            const parts = splitShadows(shadow);
            const convex = signatures.some((sig) => sig.every((part) => parts.includes(part)));
            if (!convex) continue;
            const tag = el.tagName;
            const role = el.getAttribute('role');
            if (tag === 'BUTTON' || tag === 'A' || role === 'button') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) continue;
            const rawClass = el.getAttribute('class') || '';
            const name = (el.getAttribute('aria-label') || rawClass || tag).toString().trim().slice(0, 28);
            raised.push(`${tag}.${name}`);
            if (raised.length > 8) break;
        }
        return { overflow, small: small.slice(0, 12), raised };
    });
    if (result.overflow.length) failures.push(`${label} 가로 넘침: ${result.overflow.join(', ')}`);
    if (result.small.length) failures.push(`${label} 44px 미만: ${result.small.join(', ')}`);
    if (result.raised.length) failures.push(`${label} 볼록한 그림자인데 버튼·링크·role=button이 아님: ${result.raised.join(', ')}`);
}

async function controlBoxes(page, selector, label) {
    const result = await page.evaluate((sel) => {
        const els = [...document.querySelectorAll(sel)].filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 1 && rect.height > 1;
        });
        const overlaps = [];
        const small = [];
        els.forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (rect.width < 43.5 || rect.height < 43.5) {
                small.push(`${el.innerText.replace(/\s+/g, ' ').trim().slice(0, 12)} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
            }
        });
        for (let i = 0; i < els.length; i += 1) {
            for (let j = i + 1; j < els.length; j += 1) {
                const a = els[i].getBoundingClientRect();
                const b = els[j].getBoundingClientRect();
                const hit = a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
                if (hit) overlaps.push(`${els[i].innerText.replace(/\s+/g, ' ').trim().slice(0, 8)}/${els[j].innerText.replace(/\s+/g, ' ').trim().slice(0, 8)}`);
            }
        }
        return { overlaps: overlaps.slice(0, 8), small };
    }, selector);
    if (result.overlaps.length) failures.push(`${label} 겹침: ${result.overlaps.join(', ')}`);
    if (result.small.length) failures.push(`${label} 44px 미만: ${result.small.join(', ')}`);
}

async function openPlus(page) {
    await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('[aria-label="할 일 고르기"]')];
        const visible = buttons.find((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
        visible?.click();
    });
    await page.waitForSelector('[data-screen="plus"]');
}

async function clickPlus(page, label) {
    await openPlus(page);
    const direct = await page.evaluate((text) => {
        const hit = [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0 && el.innerText.includes(text);
        });
        if (!hit) return false;
        hit.click();
        return true;
    }, label);
    if (direct) return;
    await page.evaluate(() => {
        [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.includes('더보기'))?.click();
    });
    await page.waitForFunction((text) => [...document.querySelectorAll('[data-screen="plus"] button')].some((el) => el.innerText.includes(text)), {}, label);
    await page.evaluate((text) => {
        [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.includes(text))?.click();
    }, label);
}

async function choiceFit(page, screen, scope = '') {
    return page.evaluate((name, scopeSelector) => {
        const sheetRoot = document.querySelector(`[data-screen="${name}"]`);
        if (!sheetRoot) return { missing: true };
        const root = scopeSelector ? sheetRoot.querySelector(scopeSelector) : sheetRoot;
        if (!root) return { missing: true };
        const sheet = sheetRoot.classList.contains('sheet') ? sheetRoot : (sheetRoot.querySelector('.sheet') || sheetRoot);
        const buttons = [...root.querySelectorAll('.choice-grid button')];
        const view = sheet.getBoundingClientRect();
        const hidden = [];
        const clipped = [];
        const small = [];
        const rects = buttons.map((el) => el.getBoundingClientRect());
        buttons.forEach((el, index) => {
            const rect = rects[index];
            const text = el.innerText.replace(/\s+/g, ' ').trim();
            if (rect.top < view.top - 1 || rect.bottom > Math.min(view.bottom, window.innerHeight) + 1 || rect.left < 0 || rect.right > window.innerWidth + 1) {
                hidden.push(text.slice(0, 24));
            }
            if (rect.width < 43.5 || rect.height < 43.5) small.push(`${text.slice(0, 12)} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
            const range = document.createRange();
            range.selectNodeContents(el);
            const ink = range.getBoundingClientRect();
            if (ink.width > 1 && (ink.right > rect.right + 1 || ink.bottom > rect.bottom + 1 || ink.left < rect.left - 1)) {
                clipped.push(text.slice(0, 24));
            }
        });
        const overlaps = [];
        for (let i = 0; i < rects.length; i += 1) {
            for (let j = i + 1; j < rects.length; j += 1) {
                const a = rects[i];
                const b = rects[j];
                const hit = a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
                if (hit) overlaps.push(`${buttons[i].innerText.trim().slice(0, 8)}/${buttons[j].innerText.trim().slice(0, 8)}`);
            }
        }
        return {
            scroll: sheet.scrollHeight > sheet.clientHeight + 2,
            hidden,
            clipped,
            small,
            overlaps: overlaps.slice(0, 8),
            selects: sheetRoot.querySelectorAll('select').length,
            labels: buttons.map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
        };
    }, screen, scope);
}

function reportChoice(label, result, { allowScroll = false } = {}) {
    if (!result || result.missing) {
        failures.push(`${label}: 분류 화면이 없습니다.`);
        return;
    }
    if (!allowScroll && result.scroll) failures.push(`${label}: 선택지가 한 화면을 넘어 스크롤이 생깁니다.`);
    if (result.hidden.length) failures.push(`${label}: 화면에 다 안 보이는 선택지 ${result.hidden.join(', ')}`);
    if (result.clipped.length) failures.push(`${label}: 글자가 잘림 ${result.clipped.join(', ')}`);
    if (result.small.length) failures.push(`${label}: 44px 미만 ${result.small.join(', ')}`);
    if (result.overlaps.length) failures.push(`${label}: 글자나 칸이 겹침 ${result.overlaps.join(', ')}`);
    if (result.selects) failures.push(`${label}: 드롭다운이 남아 있습니다.`);
}

async function tipCover(page) {
    return page.evaluate(() => {
        const tip = document.querySelector('.tip-bubble, .tip-bulb');
        const tab = document.querySelector('.tabbar');
        const todo = document.querySelector('.home-todo');
        if (!tip || !tab) return '팁이나 하단 탭이 없습니다.';
        const hit = (a, b) => {
            const left = a.getBoundingClientRect();
            const right = b.getBoundingClientRect();
            return left.bottom > right.top + 1 && left.top < right.bottom - 1 && left.right > right.left + 1 && left.left < right.right - 1;
        };
        if (hit(tip, tab)) return '팁이 하단 탭을 가립니다.';
        if (todo && hit(tip, todo)) return '팁이 오늘 할 일을 가립니다.';
        return '';
    });
}

try {
    await waitServer();
    await ensureBrowser();
    const scenes = [
        ['home-360-lilac.png', 360, 'light', async (page) => page],
        ['attend-360-lilac.png', 360, 'light', async (page) => { await page.evaluate(() => { location.hash = '#/attend'; }); await delay(200); }],
        ['record-360-lilac.png', 360, 'light', async (page) => { await page.evaluate(() => { location.hash = '#/students/12'; }); await page.waitForFunction(() => document.body.innerText.includes('이하은')); }],
        ['quick-360-lilac.png', 360, 'light', async (page) => { await page.click('[aria-label="할 일 고르기"]'); await page.waitForSelector('[aria-label="할 일 고르기"][role="dialog"]'); }],
        ['home-360-dark.png', 360, 'dark', async () => {}],
        ['attend-360-dark.png', 360, 'dark', async (page) => { await page.evaluate(() => { location.hash = '#/attend'; }); await delay(200); }],
        ['record-360-dark.png', 360, 'dark', async (page) => { await page.evaluate(() => { location.hash = '#/students/12'; }); await page.waitForFunction(() => document.body.innerText.includes('이하은')); }],
        ['quick-360-dark.png', 360, 'dark', async (page) => { await page.click('[aria-label="할 일 고르기"]'); await delay(250); }],
        ['home-1280-lilac.png', 1280, 'light', async () => {}],
    ];

    for (const [name, width, mode, prepare] of scenes) {
        await withDemo(width, mode, async (page) => {
            await prepare(page);
            await delay(250);
            await audit(page, name);
            if (name.startsWith('home')) await controlBoxes(page, 'button.hero-pill, .home-hero button.hero-action', name);
            if (name.startsWith('attend')) await controlBoxes(page, 'button[aria-pressed]', name);
            if (name === 'home-360-lilac.png') {
                const covered = await tipCover(page);
                if (covered) failures.push(covered);
                await page.evaluate(() => document.querySelector('.home-todo')?.scrollIntoView({ block: 'center' }));
                await delay(150);
                const coveredTodo = await tipCover(page);
                if (coveredTodo) failures.push(`할 일 화면: ${coveredTodo}`);
                await page.screenshot({ path: resolve(shots, 'home-360-todo.png') });
                await page.evaluate(() => window.scrollTo(0, 0));
                await delay(100);
            }
            await page.screenshot({ path: resolve(shots, name) });
        });
    }

    for (const width of [360, 390]) {
        await withDemo(width, 'light', async (page) => {
            await page.evaluate(() => { location.hash = '#/schedule'; });
            await delay(200);
            await audit(page, `일정 ${width}`);
            await page.evaluate(() => { location.hash = '#/settings'; });
            await delay(200);
            await audit(page, `설정 ${width}`);
            if (width === 360) {
                const covered = await tipCover(page);
                if (covered) failures.push(`설정: ${covered}`);
                await page.screenshot({ path: resolve(shots, 'settings-360-lilac.png') });
            }
            await page.evaluate(() => { location.hash = '#/todo'; });
            await delay(200);
            await audit(page, `할일 ${width}`);
        });
    }

    for (const width of [360, 390, 1920]) {
        await withDemo(width, 'light', async (page) => {
            await controlBoxes(page, 'button.hero-pill, .home-hero button.hero-action', `홈 칩 ${width}`);
            await page.evaluate(() => { location.hash = '#/attend'; });
            await delay(200);
            await controlBoxes(page, 'button[aria-pressed]', `출결 요약 ${width}`);
            await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '이번 달')?.click());
            await page.waitForFunction(() => [...document.querySelectorAll('button.solid-card')].some((el) => el.innerText.includes('김하늘')));
            await controlBoxes(page, 'button.solid-card:not([aria-pressed])', `이번 달 ${width}`);
            await audit(page, `출결 너비 ${width}`);
        }, width >= 900 ? 1080 : 800);
    }

    await withDemo(390, 'light', async (page) => {
        const homeText = await page.evaluate(() => document.body.innerText);
        check(homeText.includes('1교시') && homeText.includes('18분'), '홈에 다음 교시 18분이 없습니다.');
        check(homeText.includes('박서준') && homeText.includes('결석'), '홈에 결석이 없습니다.');
        const pill = await page.evaluate(() => {
            const hits = [];
            Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (ms) => { hits.push(ms); return true; } });
            const button = [...document.querySelectorAll('button.hero-pill')].find((el) => el.innerText.includes('박서준'));
            const chip = document.querySelector('button.chip, button.hero-action');
            button?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, cancelable: true }));
            chip?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, cancelable: true }));
            button?.focus();
            return {
                hits,
                tap: Boolean(button?.classList.contains('tap') && button.tagName === 'BUTTON' && button.getAttribute('type') === 'button'),
                focused: document.activeElement === button,
            };
        });
        check(pill.tap && pill.focused && pill.hits.length === 2 && pill.hits.every((n) => n === 8), '홈 출결 칩이 다른 버튼과 같은 눌림·진동·포커스가 아닙니다.');
        await page.evaluate(() => [...document.querySelectorAll('button.hero-pill')].find((el) => el.innerText.includes('박서준'))?.click());
        await page.waitForSelector('[data-screen="attend-status"]');
        const sheetWho = await page.evaluate(() => document.querySelector('[data-screen="attend-status"]')?.innerText || '');
        check(sheetWho.includes('박서준'), '홈 출결 칩이 그 학생 시트를 열지 않습니다.');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-screen="attend-status"]'));
        await clickPlus(page, '관찰');
        await page.waitForFunction(() => document.body.innerText.includes('누구'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('이하은'))?.click());
        await page.waitForSelector('textarea');
        await page.type('textarea', '@12 #학습 내일 정리까지 맡았어요');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.body.innerText.includes('되돌리기'));
        await page.click('button::-p-text(되돌리기)').catch(async () => {
            const buttons = await page.$$('button');
            for (const button of buttons) {
                const text = await page.evaluate((el) => el.innerText, button);
                if (text.includes('되돌리기')) { await button.click(); return; }
            }
        });
        await page.evaluate(() => { location.hash = '#/attend'; });
        await page.waitForFunction(() => document.body.innerText.includes('출석·결석'));
        const feel = await page.evaluate(() => {
            const hits = [];
            Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (ms) => { hits.push(ms); return true; } });
            const summary = document.querySelector('button[aria-pressed]');
            const chip = [...document.querySelectorAll('button.chip')].find((el) => el.innerText.trim() === '오늘');
            summary?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, cancelable: true }));
            chip?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, cancelable: true }));
            summary?.focus();
            return {
                hits,
                tap: Boolean(summary?.classList.contains('tap') && summary.getAttribute('type') === 'button'),
                focused: document.activeElement === summary,
                pressed: summary?.getAttribute('aria-pressed') || '',
            };
        });
        check(feel.tap && feel.focused && feel.pressed === 'false' && feel.hits.length === 2 && feel.hits.every((n) => n === 8), '출결 요약이 다른 버튼과 같은 콕 진동·포커스·aria가 아닙니다.');
        const seats = () => page.evaluate(() => [...document.querySelectorAll('.cell-grid button')].map((el) => el.innerText.replace(/\s+/g, ' ')));
        const pressBox = (name) => page.evaluate((label) => {
            [...document.querySelectorAll('button[aria-pressed]')].find((el) => el.innerText.includes(label))?.click();
        }, name);
        await pressBox('결석');
        let names = await seats();
        check(names.length === 1 && names[0].includes('박서준'), '결석 칸이 그 학생만 보여 주지 않습니다.');
        const pressedShadow = await page.evaluate(() => {
            const probe = document.createElement('div');
            document.body.appendChild(probe);
            probe.style.boxShadow = 'var(--neo-inset)';
            const inset = getComputedStyle(probe).boxShadow;
            probe.style.boxShadow = 'var(--neo-raise)';
            const raise = getComputedStyle(probe).boxShadow;
            probe.remove();
            const boxes = [...document.querySelectorAll('button[aria-pressed]')];
            const absent = boxes.find((el) => el.innerText.includes('결석'));
            const present = boxes.find((el) => el.innerText.includes('출석'));
            return {
                absentOn: absent?.getAttribute('aria-pressed') === 'true' && getComputedStyle(absent).boxShadow === inset,
                presentOff: present?.getAttribute('aria-pressed') === 'false' && getComputedStyle(present).boxShadow === raise,
            };
        });
        check(pressedShadow.absentOn && pressedShadow.presentOff, '고른 출결 칸이 눌린 모양이 아닙니다.');
        await pressBox('결석');
        names = await seats();
        check(names.some((item) => item.includes('김하늘')) && names.some((item) => item.includes('박서준')), '같은 칸을 다시 눌러도 전체가 나오지 않습니다.');
        await pressBox('지각');
        names = await seats();
        check(names.length === 1 && names[0].includes('정유나'), '지각 칸이 그 학생만 보여 주지 않습니다.');
        await pressBox('출석');
        names = await seats();
        const presentOnly = names.some((item) => item.includes('김하늘')) && !names.some((item) => item.includes('박서준')) && !names.some((item) => item.includes('정유나'));
        const presentPressed = await page.evaluate(() => [...document.querySelectorAll('button[aria-pressed]')].find((el) => el.innerText.includes('출석'))?.getAttribute('aria-pressed') === 'true');
        check(presentOnly && presentPressed, '다른 칸을 보다가 출석을 눌러도 출석한 학생만 나오지 않습니다.');
        await pressBox('출석');
        names = await seats();
        check(names.some((item) => item.includes('김하늘')) && names.some((item) => item.includes('박서준')), '출석 칸을 다시 눌러도 전체가 나오지 않습니다.');
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '이번 달')?.click());
        await delay(150);
        const monthRow = await page.evaluate(() => {
            const button = [...document.querySelectorAll('button.solid-card')].find((el) => !el.hasAttribute('aria-pressed') && el.innerText.includes('박서준') && el.classList.contains('tap'));
            button?.click();
            return Boolean(button);
        });
        check(monthRow, '이번 달 학생 줄이 버튼이 아닙니다.');
        await page.waitForFunction(() => (document.querySelector('h1')?.innerText || '').includes('박서준'));
        await page.evaluate(() => { location.hash = '#/attend'; });
        await page.waitForFunction(() => document.body.innerText.includes('출석·결석'));
        const clicked = await page.evaluate(() => {
            const button = [...document.querySelectorAll('button')].find((el) => el.innerText.includes('김하늘'));
            button?.click();
            return Boolean(button);
        });
        check(clicked, '출결 칸을 누르지 못했습니다.');
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '결석'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '결석')?.click());
        await delay(250);
        const attendText = await page.evaluate(() => document.body.innerText);
        check(attendText.includes('김하늘') && attendText.includes('결석'), '출결을 눌러도 결석이 되지 않습니다.');

        await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 1 });
        await page.evaluate(async () => {
            const db = await new Promise((resolveDb, reject) => {
                const req = indexedDB.open('ssug-gyomu');
                req.onsuccess = () => resolveDb(req.result);
                req.onerror = () => reject(req.error);
            });
            const store = db.transaction('kv', 'readwrite').objectStore('kv');
            const state = await new Promise((resolveState, reject) => {
                const req = store.get('state');
                req.onsuccess = () => resolveState(req.result);
                req.onerror = () => reject(req.error);
            });
            const student = state.students.find((row) => row.no === 3);
            student.memo = '건강 특이';
            await new Promise((resolvePut, reject) => {
                const req = store.put(state, 'state');
                req.onsuccess = () => resolvePut();
                req.onerror = () => reject(req.error);
            });
        });
        await page.goto(`${origin}?mode=light&at=08:42`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.evaluate(() => { location.hash = '#/students/3'; });
        await page.waitForFunction(() => document.body.innerText.includes('이 메모는 이 기기에만 있어요'), { timeout: 8000 });
        await page.screenshot({ path: resolve(shots, 'student-memo-360.png') });
    });

    await withDemo(390, 'light', async (page) => {
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
        await page.screenshot({ path: resolve(shots, 'after_home_390.png') });
        await openPlus(page);
        const plus = await choiceFit(page, 'plus');
        reportChoice('＋ 메뉴 390', plus);
        const face = await page.evaluate(() => ({
            field: Boolean(document.querySelector('[data-screen="plus"] textarea')),
            buttons: [...document.querySelectorAll('[data-screen="plus"] button')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
        }));
        check(face.field, '＋에 입력창이 없습니다.');
        for (const label of ['출결', '상담', '할 일', '일정', '더보기']) {
            if (!face.buttons.some((item) => item.includes(label))) failures.push(`＋에 ${label}이 없습니다.`);
        }
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.includes('더보기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('회의록 작성') && document.body.innerText.includes('보호자'));
        const moreLabels = await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()));
        for (const label of ['회의록 작성', '메시지 붙여넣기', '관찰', '알림장', '메모', '칭찬', '보호자']) {
            if (!moreLabels.some((item) => item.includes(label))) failures.push(`＋ 더보기에 ${label}이 없습니다.`);
        }
        const confirm = await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].some((el) => /^(확인|선택|완료)$/.test(el.innerText.trim())));
        check(!confirm, '＋ 메뉴에 확인 버튼이 있습니다.');
        await page.screenshot({ path: resolve(shots, 'after_plus_390.png') });

        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.includes('일정') && !el.innerText.includes('알림'))?.click());
        await page.waitForSelector('[data-screen="flow"]');
        await page.waitForFunction(() => document.body.innerText.includes('일정 종류'));
        const eventKind = await choiceFit(page, 'flow');
        reportChoice('일정 종류 390', eventKind);
        for (const label of ['학급', '학교', '휴일', '내 일정']) {
            if (!eventKind.labels?.some((item) => item.includes(label))) failures.push(`일정 종류에 ${label}이 없습니다.`);
        }
        await page.screenshot({ path: resolve(shots, 'after_event_kind_390.png') });
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="flow"] button')].find((el) => el.innerText.trim() === '학교')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('날짜'));
        check(!(await page.evaluate(() => document.body.innerText.includes('일정 종류'))), '일정 종류를 눌러도 다음 단계로 넘어가지 않습니다.');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-screen="flow"]'));

        await clickPlus(page, '회의록 작성');
        await page.waitForFunction(() => document.body.innerText.includes('회의 종류'));
        const meet = await choiceFit(page, 'flow');
        reportChoice('회의록 종류 390', meet);
        for (const label of ['학년회의', '교직원회의', '교과협의회', '학부모회의', '연수']) {
            if (!meet.labels?.some((item) => item.includes(label))) failures.push(`회의 종류에 ${label}이 없습니다.`);
        }
        await page.screenshot({ path: resolve(shots, 'after_meet_kind_390.png') });
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="flow"] button')].find((el) => el.innerText.trim() === '교과협의회')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('날짜') && !document.body.innerText.includes('회의 종류'));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-screen="flow"]'));

        await page.evaluate(() => { location.hash = '#/attend'; });
        await page.waitForFunction(() => document.body.innerText.includes('출석·결석'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('김하늘'))?.click());
        await page.waitForSelector('[data-screen="attend-status"]');
        const status = await choiceFit(page, 'attend-status');
        reportChoice('출결 상태 390', status);
        for (const label of ['출석', '결석', '지각', '조퇴', '결과']) {
            if (!status.labels?.includes(label)) failures.push(`출결 상태에 ${label}이 없습니다.`);
        }
        await page.screenshot({ path: resolve(shots, 'after_attend_status_390.png') });
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="attend-status"] button')].find((el) => el.innerText.trim() === '조퇴')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('몇 교시'));
        const periodSmall = await page.evaluate(() => [...document.querySelectorAll('[aria-label$="교시"]')].filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && (rect.width < 43.5 || rect.height < 43.5);
        }).map((el) => el.getAttribute('aria-label')));
        if (periodSmall.length) failures.push(`교시 버튼이 44px 미만: ${periodSmall.join(', ')}`);
        check(!(await page.evaluate(() => [...document.querySelectorAll('[data-screen="attend-status"] button')].some((el) => el.innerText.trim() === '저장'))), '출결에 따로 저장 버튼이 있습니다.');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-screen="attend-status"]'));

        await openPlus(page);
        await clickPlus(page, '메시지 붙여넣기');
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.type('[data-screen="message"] textarea', '내일 5교시 공개수업이 있습니다. 가정통신문 내일까지 회신 바랍니다.');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('개 등록') && document.body.innerText.includes('할 일'));
        const preview = await choiceFit(page, 'message', '.msg-card');
        reportChoice('메시지 분류 390', preview, { allowScroll: true });
        check(preview.labels?.some((item) => item.includes('할 일')) && preview.labels?.some((item) => item === '일정' || item.endsWith('일정')), '메시지 카드에 할 일/일정 칩이 없습니다.');
        const kindOn = await page.evaluate(() => {
            const grid = document.querySelector('[aria-label="할 일 또는 일정"]');
            const on = grid?.querySelector('.on');
            return on?.innerText.trim() || '';
        });
        check(kindOn === '일정', `메시지 분류가 일정으로 보이지 않습니다. (${kindOn})`);
        await page.screenshot({ path: resolve(shots, 'after_message_390.png') });
        await page.evaluate(() => [...document.querySelectorAll('[aria-label="할 일 또는 일정"] button')].find((el) => el.innerText.trim() === '할 일')?.click());
        const switched = await page.evaluate(() => {
            const grid = document.querySelector('[aria-label="할 일 또는 일정"]');
            const on = grid?.querySelector('.on')?.innerText.trim();
            const eventGrid = document.querySelector('[aria-label="일정 종류"]');
            const save = [...document.querySelectorAll('button')].some((el) => el.innerText.includes('개 등록'));
            return { on, eventGrid: Boolean(eventGrid), save };
        });
        check(switched.on === '할 일' && !switched.eventGrid && switched.save, '분류 칩을 한 번 눌러도 바로 바뀌지 않습니다.');
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('개 등록'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('되돌리기'));
        await page.screenshot({ path: resolve(shots, 'after_message_saved_390.png') });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('되돌리기'))?.click());
        let undone = true;
        for (let attempt = 0; attempt < 10; attempt += 1) {
            undone = await page.evaluate(async () => {
                const db = await new Promise((resolveDb, reject) => {
                    const req = indexedDB.open('ssug-gyomu');
                    req.onsuccess = () => resolveDb(req.result);
                    req.onerror = () => reject(req.error);
                });
                const state = await new Promise((resolveState, reject) => {
                    const req = db.transaction('kv').objectStore('kv').get('state');
                    req.onsuccess = () => resolveState(req.result);
                    req.onerror = () => reject(req.error);
                });
                const titles = [...(state.todos || []), ...(state.local?.todos || []), ...(state.events || []), ...(state.local?.events || [])].map((row) => row.title);
                return titles.some((title) => String(title).includes('공개수업') || String(title).includes('가정통신문'));
            });
            if (!undone) break;
            await delay(200);
        }
        check(!undone, '되돌리기 뒤에도 메시지 항목이 남아 있습니다.');

        await openPlus(page);
        await clickPlus(page, '메시지 붙여넣기');
        await page.waitForSelector('[data-screen="message"] textarea');
        const four = [
            `[안내] 1. ${photo.label}(${photo.week}) 3~4교시 학급 사진 촬영`,
            '11월 12일까지 공개수업 지도안 제출',
            '가정통신문',
            '학부모 상담주간: 11월 2일(월)~11월 6일(금)',
            '김교사 출장으로 5,6교시 보결',
        ].join('\n');
        await page.focus('[data-screen="message"] textarea');
        await page.keyboard.type(four);
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        const previewReady = await page.waitForFunction(() => document.body.innerText.includes('3개 등록') && document.body.innerText.includes('11월 2일') && document.body.innerText.includes('11월 6일'), { timeout: 8000 }).catch(() => null);
        if (!previewReady) {
            const body = await page.evaluate(() => document.body.innerText.slice(0, 700));
            failures.push(`4건 미리보기가 열리지 않았습니다. ${body}`);
        } else {
        const summary = await page.evaluate(() => {
            const sheet = document.querySelector('[data-screen="message"]');
            const foot = document.querySelector('.sheet-foot');
            const bg = getComputedStyle(foot).backgroundColor;
            const calendar = document.querySelector('[aria-label="날짜"]');
            const select = document.querySelector('[data-screen="message"] select');
            return {
                height: sheet.scrollHeight,
                cards: document.querySelectorAll('.msg-card').length,
                calendar: Boolean(calendar),
                select: Boolean(select),
                bg,
            };
        });
        check(summary.cards === 4, `4건이 ${summary.cards}장으로 나왔습니다.`);
        check(summary.height < 2200, `미리보기가 ${summary.height}px로 너무 깁니다.`);
        check(!summary.calendar, '접힌 카드에 달력이 펼쳐져 있습니다.');
        check(!summary.select, '미리보기에 드롭다운이 있습니다.');
        check(summary.bg && summary.bg !== 'transparent' && summary.bg !== 'rgba(0, 0, 0, 0)', '등록 버튼 배경이 비칩니다.');
        const bounds = await page.evaluate(() => {
            const start = document.querySelector('[aria-label="시작일 고치기"]');
            const end = document.querySelector('[aria-label="끝일 고치기"]');
            const box = (el) => {
                if (!el) return null;
                const rect = el.getBoundingClientRect();
                return { w: rect.width, h: rect.height, text: el.innerText.trim() };
            };
            start?.scrollIntoView({ block: 'center' });
            return { start: box(start), end: box(end) };
        });
        check(bounds.start && bounds.end, '기간 카드에 시작일과 끝일 버튼이 없습니다.');
        check(bounds.start?.text.includes('11월 2일') && bounds.end?.text.includes('11월 6일'), `기간 날짜가 ${bounds.start?.text}~${bounds.end?.text} 입니다.`);
        check(bounds.start.w >= 43.5 && bounds.start.h >= 43.5 && bounds.end.w >= 43.5 && bounds.end.h >= 43.5, '시작일·끝일 버튼이 작습니다.');
        await page.screenshot({ path: resolve(shots, 'after_message_summary_390.png') });
        await page.screenshot({ path: resolve(shots, 'after_range_bounds_390.png') });
        await page.evaluate(() => document.querySelector('[aria-label="시작일 고치기"]')?.click());
        await page.waitForSelector('[aria-label="날짜"]');
        const calendarClear = await page.waitForFunction(() => {
            const sheet = document.querySelector('[data-screen="message"]');
            const foot = document.querySelector('.sheet-foot');
            const days = [...document.querySelectorAll('[aria-label="날짜"] button')];
            if (!sheet || !foot || days.length < 28) return false;
            const top = sheet.getBoundingClientRect().top;
            const footTop = foot.getBoundingClientRect().top;
            return days.every((el) => {
                const rect = el.getBoundingClientRect();
                return rect.top >= top - 1 && rect.bottom <= footTop + 1 && rect.height >= 43.5;
            });
        }, { timeout: 3000 }).then(() => true).catch(() => false);
        check(calendarClear, '펼친 달력의 아래 줄이 등록 버튼에 가립니다.');
        await page.screenshot({ path: resolve(shots, 'after_range_start_390.png') });
        await page.screenshot({ path: resolve(shots, 'after_calendar_clear_390.png') });
        await page.evaluate(() => document.querySelector('[aria-label="2026-11-03"]')?.click());
        const started = await page.evaluate(() => ({
            start: document.querySelector('[aria-label="시작일 고치기"]')?.innerText.trim() || '',
            end: document.querySelector('[aria-label="끝일 고치기"]')?.innerText.trim() || '',
            calendar: Boolean(document.querySelector('[aria-label="날짜"]')),
            select: Boolean(document.querySelector('[data-screen="message"] select')),
        }));
        check(started.start.includes('11월 3일') && started.end.includes('11월 6일') && !started.calendar && !started.select, `시작일을 골라도 끝이 같이 바뀌거나 달력이 남습니다. ${started.start} ${started.end}`);
        await page.evaluate(() => document.querySelector('[aria-label="끝일 고치기"]')?.click());
        await page.waitForSelector('[aria-label="날짜"]');
        await page.screenshot({ path: resolve(shots, 'after_range_end_390.png') });
        await page.evaluate(() => document.querySelector('[aria-label="2026-11-07"]')?.click());
        const ended = await page.evaluate(() => ({
            start: document.querySelector('[aria-label="시작일 고치기"]')?.innerText.trim() || '',
            end: document.querySelector('[aria-label="끝일 고치기"]')?.innerText.trim() || '',
            calendar: Boolean(document.querySelector('[aria-label="날짜"]')),
        }));
        check(ended.end.includes('11월 7일') && ended.start.includes('11월 3일') && !ended.calendar, `끝일을 고쳐도 시작일이 바뀝니다. ${ended.start} ${ended.end}`);
        await page.evaluate(() => document.querySelector('[aria-label="시작일 고치기"]')?.click());
        await page.waitForSelector('[aria-label="2026-11-10"]');
        await page.evaluate(() => document.querySelector('[aria-label="2026-11-10"]')?.click());
        const flipped = await page.evaluate(() => ({
            start: document.querySelector('[aria-label="시작일 고치기"]')?.innerText.trim() || '',
            end: document.querySelector('[aria-label="끝일 고치기"]')?.innerText.trim() || '',
        }));
        check(flipped.start.includes('11월 10일') && flipped.end.includes('11월 10일'), `시작일이 끝보다 늦으면 끝이 따라가지 않습니다. ${flipped.start} ${flipped.end}`);
        await page.evaluate((label) => [...document.querySelectorAll('[aria-label="날짜 고치기"]')].find((el) => el.innerText.includes(label))?.click(), photo.label);
        await page.waitForSelector('[aria-label="날짜"]');
        const opened = await page.evaluate(() => !document.querySelector('[data-screen="message"] select'));
        check(opened, '날짜를 펼쳤는데 드롭다운이 있습니다.');
        await page.screenshot({ path: resolve(shots, 'after_message_date_390.png') });
        await page.evaluate(() => [...document.querySelectorAll('[aria-label="시각 고치기"]')][0]?.click());
        await page.waitForSelector('[aria-label="시각"]');
        const clocks = await page.evaluate(() => [...document.querySelectorAll('[aria-label="시각"] button')].map((el) => el.innerText.trim()));
        check(clocks.includes('14:00') && clocks.includes('13:10') && !clocks.includes('2:00') && !clocks.includes('2:30'), `시각 표기가 섞여 있습니다: ${clocks.join(', ')}`);
        const covered = await page.evaluate(() => {
            const sheet = document.querySelector('[data-screen="message"]');
            sheet.scrollTop = sheet.scrollHeight;
            const foot = document.querySelector('.sheet-foot');
            const rect = foot.getBoundingClientRect();
            const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + 20);
            return foot.contains(hit);
        });
        check(covered, '등록 버튼 아래로 카드가 비칩니다.');
        }
    }, 844);

    await withDemo(390, 'light', async (page) => {
        await openPlus(page);
        await clickPlus(page, '메시지 붙여넣기');
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.type('[data-screen="message"] textarea', '2027년 3월 4일 봄철 돌봄교실 운영 계획서 제출');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('2027년 3월 4일') && document.body.innerText.includes('1개 등록'));
        const yearChip = await page.evaluate(() => document.querySelector('[aria-label="날짜 고치기"]')?.innerText.trim() || '');
        check(yearChip === '2027년 3월 4일', `다른 해 날짜 칩이 ${yearChip} 입니다.`);
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('메시지 다시 붙이기'))?.click());
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.click('[data-screen="message"] textarea', { clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('어제 체육대회 다들 수고 많으셨습니다!');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('빼 둠'));
        const yellow = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '넣을게요'),
        }));
        check(yellow.low && !yellow.chosen, '노란 카드가 기본으로 포함되어 있습니다.');
        async function pasteNext(text) {
            await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('메시지 다시 붙이기'))?.click());
            await page.waitForSelector('[data-screen="message"] textarea');
            await page.click('[data-screen="message"] textarea', { clickCount: 3 });
            await page.keyboard.down('Control');
            await page.keyboard.press('KeyA');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await page.keyboard.type(text);
            await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        }
        await pasteNext('27.1.11 겨울 영재캠프 운영');
        await page.waitForFunction(() => document.body.innerText.includes('2027년 1월 11일') && document.body.innerText.includes('1개 등록'));
        const shortYear = await page.evaluate(() => ({
            chip: document.querySelector('[aria-label="날짜 고치기"]')?.innerText.trim() || '',
            title: document.querySelector('[aria-label="제목"]')?.value || '',
        }));
        check(shortYear.chip === '2027년 1월 11일' && !/\d/.test(shortYear.title), `두 자리 연도 카드가 ${shortYear.chip} / ${shortYear.title} 입니다.`);
        await page.screenshot({ path: resolve(shots, 'after_short_year_390.png') });
        await pasteNext('2027학년도 학부모총회 3월 18일(목) 오후 2시');
        await page.waitForFunction(() => document.body.innerText.includes('2027년 3월 18일') && document.body.innerText.includes('1개 등록'));
        await pasteNext('2025년 11월 3일 학교폭력 실태조사 결과 공유합니다. 참고만 해주세요.');
        await page.waitForFunction(() => document.body.innerText.includes('2025년 11월 3일') && document.body.innerText.includes('0개 등록') && document.body.innerText.includes('빼 둠'));
        const past = await page.evaluate(() => Boolean(document.querySelector('.low-card')));
        check(past, '지난 참고 자료가 노란 카드가 아닙니다.');
        const postpone = `방과후 축구반 ${delayedFrom.slash} 수업은 ${delayedTo.slash}로 연기됩니다.`;
        await pasteNext(postpone);
        await page.waitForFunction((label) => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('빼 둠') && document.body.innerText.includes(label), {}, delayedTo.label);
        const moved = await page.evaluate(() => ({
            chips: [...document.querySelectorAll('[aria-label="날짜 고치기"]')].map((el) => el.innerText.trim()),
            titles: [...document.querySelectorAll('[aria-label="제목"]')].map((el) => el.value),
            low: document.querySelectorAll('.low-card').length,
            aside: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '빼 둠').length,
            kept: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '넣을게요').length,
        }));
        check(moved.chips.includes(delayedTo.label) && moved.chips.includes(delayedFrom.label) && moved.titles.length >= 2 && moved.titles.every((title) => title === postpone) && moved.low >= 2 && moved.aside >= 2 && moved.kept === 0, `연기 카드가 ${JSON.stringify(moved)} 입니다.`);
        await page.screenshot({ path: resolve(shots, 'after_move_date_390.png') });
        const pulledText = `가을 소풍이 ${pulledFrom.slash}에서 ${pulledTo.slash} 15:00로 앞당겨졌습니다`;
        await pasteNext(pulledText);
        await page.waitForFunction((label) => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('빼 둠') && document.body.innerText.includes(label) && document.body.innerText.includes('15:00'), {}, pulledTo.label);
        const pulled = await page.evaluate(() => ({
            chips: [...document.querySelectorAll('[aria-label="날짜 고치기"]')].map((el) => el.innerText.trim()),
            times: [...document.querySelectorAll('[aria-label="시각 고치기"]')].map((el) => el.innerText.trim()),
            titles: [...document.querySelectorAll('[aria-label="제목"]')].map((el) => el.value),
            low: document.querySelectorAll('.low-card').length,
            aside: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '빼 둠').length,
            kept: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '넣을게요').length,
        }));
        check(pulled.chips.includes(pulledTo.label) && pulled.chips.includes(pulledFrom.label) && pulled.times.includes('15:00') && pulled.titles.length >= 2 && pulled.titles.every((title) => title === pulledText) && pulled.low >= 2 && pulled.aside >= 2 && pulled.kept === 0, `앞당김 카드가 ${JSON.stringify(pulled)} 입니다.`);
        await page.screenshot({ path: resolve(shots, 'after_pull_date_390.png') });
        await pasteNext(`${bareSpan.text} 학년 연구실 공사`);
        await page.waitForFunction((start, end) => document.body.innerText.includes('1개 등록') && document.body.innerText.includes(start) && document.body.innerText.includes(end), {}, bareSpan.start, bareSpan.end);
        const span = await page.evaluate(() => ({
            start: document.querySelector('[aria-label="시작일 고치기"]')?.innerText.trim() || '',
            end: document.querySelector('[aria-label="끝일 고치기"]')?.innerText.trim() || '',
            title: document.querySelector('[aria-label="제목"]')?.value || '',
            kept: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '넣을게요').length,
        }));
        check(span.start === bareSpan.start && span.end === bareSpan.end && span.title === '학년 연구실 공사' && !/\d/.test(span.title) && span.kept === 1, `월 없는 기간이 ${JSON.stringify(span)} 입니다.`);
        await page.screenshot({ path: resolve(shots, 'after_monthless_span_390.png') });
        const shiftedText = `${fridaySlash} 교직원 회의는 15:40에서 16:10으로 변경`;
        await pasteNext(shiftedText);
        await page.waitForFunction((label) => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('빼 둠') && document.body.innerText.includes('16:10') && document.body.innerText.includes(label), {}, fridayLabel);
        const shifted = await page.evaluate(() => ({
            chips: [...document.querySelectorAll('[aria-label="날짜 고치기"]')].map((el) => el.innerText.trim()),
            times: [...document.querySelectorAll('[aria-label="시각 고치기"]')].map((el) => el.innerText.trim()),
            titles: [...document.querySelectorAll('[aria-label="제목"]')].map((el) => el.value),
            kept: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '넣을게요').length,
            low: document.querySelectorAll('.low-card').length,
        }));
        check(shifted.chips.includes(fridayLabel) && shifted.times.includes('16:10') && !shifted.times.includes('15:40') && shifted.titles.length === 1 && shifted.titles[0] === shiftedText && shifted.kept === 0 && shifted.low === 1, `시각 이동이 ${JSON.stringify(shifted)} 입니다.`);
        await pasteNext('학예회 11/2(월) 상담 11/6(금)');
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('11월 2일') && document.body.innerText.includes('11월 6일'));
        const unsure = await page.evaluate(() => ({
            chips: [...document.querySelectorAll('[aria-label="날짜 고치기"]')].map((el) => el.innerText.trim()),
            low: document.querySelectorAll('.low-card').length,
            aside: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '빼 둠').length,
            kept: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '넣을게요').length,
        }));
        check(unsure.chips.includes('11월 2일') && unsure.chips.includes('11월 6일') && unsure.low >= 2 && unsure.aside >= 2 && unsure.kept === 0, `모호한 두 날짜가 ${JSON.stringify(unsure)} 입니다.`);
        await page.screenshot({ path: resolve(shots, 'after_unsure_dates_390.png') });
        await pasteNext(`${todaySlash}(${todayWeek}) 오후 2시~4시 학부모 진로 특강 (강당)`);
        await page.waitForFunction((label) => document.body.innerText.includes('1개 등록') && document.body.innerText.includes(label) && document.body.innerText.includes('14:00'), {}, todayLabel);
        const rangedTime = await page.evaluate(() => ({
            cards: document.querySelectorAll('.msg-card').length,
            chip: document.querySelector('[aria-label="시각 고치기"]')?.innerText.trim() || '',
            date: document.querySelector('[aria-label="날짜 고치기"]')?.innerText.trim() || '',
            memo: document.querySelector('[aria-label="메모"]')?.value || '',
            kept: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '넣을게요').length,
            low: document.querySelectorAll('.low-card').length,
        }));
        check(rangedTime.cards === 1 && rangedTime.date === todayLabel && rangedTime.chip === '14:00–16:00' && rangedTime.memo.includes('강당') && rangedTime.kept === 1 && rangedTime.low === 0, `시각 범위가 ${JSON.stringify(rangedTime)} 입니다.`);
        await page.screenshot({ path: resolve(shots, 'after_time_range_390.png') });
        await pasteNext('13:00~16:00 교육과정 워크숍');
        await page.waitForFunction(() => document.body.innerText.includes('13:00') && document.body.innerText.includes('16:00'));
        const workshop = await page.evaluate(() => ({
            cards: document.querySelectorAll('.msg-card').length,
            chip: document.querySelector('[aria-label="시각 고치기"]')?.innerText.trim() || '',
        }));
        check(workshop.cards === 1 && workshop.chip === '13:00–16:00', `워크숍 시각 범위가 ${JSON.stringify(workshop)} 입니다.`);
        await pasteNext('겨울 독서 주간 12월 8일(화)~10일(목)');
        await page.waitForFunction(() => document.body.innerText.includes('12월 8일') && document.body.innerText.includes('12월 10일') && document.body.innerText.includes('1개 등록'));
        await audit(page, '다른 해 날짜');
    }, 844);

    await withDemo(1280, 'light', async (page) => {
        await audit(page, '홈 16:9');
        await page.screenshot({ path: resolve(shots, 'after_home_16x9.png') });
        await openPlus(page);
        const plus = await choiceFit(page, 'plus');
        reportChoice('＋ 메뉴 16:9', plus);
        await audit(page, '＋ 16:9');
        await page.screenshot({ path: resolve(shots, 'after_plus_16x9.png') });
        await clickPlus(page, '메시지 붙여넣기');
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.type('[data-screen="message"] textarea', '내일 5교시 공개수업이 있습니다');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('개 등록'));
        const preview = await choiceFit(page, 'message', '.msg-card');
        reportChoice('메시지 16:9', preview, { allowScroll: true });
        await page.screenshot({ path: resolve(shots, 'after_message_16x9.png') });
    }, 720);

    async function savedTimeSpan(page, label) {
        await openPlus(page);
        await clickPlus(page, '메시지 붙여넣기');
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.type('[data-screen="message"] textarea', `${todaySlash}(${todayWeek}) 오후 2시~4시 학부모 진로 특강 (강당)`);
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('1개 등록') && document.body.innerText.includes('14:00–16:00'));
        await audit(page, `시각 범위 카드 ${label}`);
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('1개 등록'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('되돌리기'));
        await page.evaluate(() => { location.hash = '#/schedule'; });
        await page.waitForFunction(() => document.body.innerText.includes('14:00–16:00') && document.body.innerText.includes('학부모 진로 특강'));
        let week = await page.evaluate(() => document.body.innerText);
        check(week.includes('14:00–16:00') && week.includes('학부모 진로 특강'), `끝 시각이 ${label} 주간에 보이지 않습니다.`);
        if (!(week.includes('08:50') && week.includes('과학관'))) {
            await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '달력')?.click());
            await page.waitForSelector('.cal-grid');
            let found = false;
            for (let hop = 0; hop < 3 && !found; hop += 1) {
                const count = await page.evaluate(() => document.querySelectorAll('.cal-grid button').length);
                for (let index = 0; index < count; index += 1) {
                    const marked = await page.evaluate((n) => document.querySelectorAll('.cal-grid button')[n]?.innerText.includes('·'), index);
                    if (!marked) continue;
                    const body = await page.evaluate(async (n) => {
                        document.querySelectorAll('.cal-grid button')[n].click();
                        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
                        return document.body.innerText;
                    }, index);
                    if (body.includes('과학관') && body.includes('08:50')) {
                        week = body;
                        found = true;
                        break;
                    }
                }
                if (!found) await page.click('[aria-label="다음 달"]');
            }
            check(found, `현장체험 시각을 ${label} 달력에서 찾지 못했습니다.`);
        }
        check(week.includes('과학관') && week.includes('08:50') && !week.includes('08:50–'), `끝 시각 없는 일정이 ${label}에서 범위로 보입니다.`);
        await audit(page, `주간 일정 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_time_span_${label}.png`) });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '달력')?.click());
        for (let hop = 0; hop < 8; hop += 1) {
            const title = await page.evaluate(() => document.querySelector('[aria-label="이전 달"]')?.parentElement?.querySelector('.title-font')?.innerText.trim() || '');
            if (title === todayMonthLabel) break;
            const year = Number((title.match(/(\d{4})년/) || [])[1] || 0);
            const month = Number((title.match(/(\d{1,2})월/) || [])[1] || 0);
            const targetYear = Number((todayMonthLabel.match(/(\d{4})년/) || [])[1] || 0);
            const targetMonth = Number((todayMonthLabel.match(/(\d{1,2})월/) || [])[1] || 0);
            await page.click(year * 12 + month < targetYear * 12 + targetMonth ? '[aria-label="다음 달"]' : '[aria-label="이전 달"]');
        }
        await page.waitForFunction((label) => document.body.innerText.includes(label), {}, todayMonthLabel);
        await page.evaluate((day) => {
            const hit = [...document.querySelectorAll('.cal-grid button')].find((el) => Number(el.style.opacity || '1') >= 1 && Number(el.querySelector('.num')?.textContent) === day);
            hit?.click();
        }, todayDay);
        await page.waitForFunction(() => document.body.innerText.includes('14:00–16:00') && document.body.innerText.includes('학부모 진로 특강'));
        await audit(page, `달력 일정 ${label}`);
    }
    await withDemo(390, 'light', async (page) => { await savedTimeSpan(page, '390'); }, 844);
    await withDemo(360, 'light', async (page) => { await savedTimeSpan(page, '360'); }, 844);

    async function weekdayDeadline(page, label) {
        await openPlus(page);
        await clickPlus(page, '메시지 붙여넣기');
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.type('[data-screen="message"] textarea', '금요일까지 학급 운영비 영수증 제출해 주세요.');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction((label) => document.body.innerText.includes('1개 등록') && document.body.innerText.includes(label), {}, fridayLabel);
        const card = await page.evaluate(() => {
            const node = document.querySelector('.msg-card');
            const text = node?.innerText || '';
            const title = node?.querySelector('input[aria-label="제목"]')?.value || '';
            const include = [...(node?.querySelectorAll('button') || [])].some((el) => el.innerText.trim() === '넣을게요');
            return { text, title, include, cards: document.querySelectorAll('.msg-card').length };
        });
        check(card.cards === 1 && card.include && card.text.includes('할 일') && card.text.includes(fridayLabel) && card.title.includes('학급 운영비') && card.title.includes('영수증') && card.title.includes('제출'), `요일 마감이 ${label}에서 ${fridayLabel} 할 일로 보이지 않습니다. ${card.title}`);
        await audit(page, `요일 마감 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_weekday_due_${label}.png`) });
    }
    await withDemo(390, 'light', async (page) => { await weekdayDeadline(page, '390'); }, 844);
    await withDemo(360, 'light', async (page) => { await weekdayDeadline(page, '360'); }, 844);

    async function weekdaySchedule(page, label) {
        await openPlus(page);
        await clickPlus(page, '메시지 붙여넣기');
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.type('[data-screen="message"] textarea', '금요일 오후 3시 학년 협의회');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction((label) => document.body.innerText.includes('1개 등록') && document.body.innerText.includes(label) && document.body.innerText.includes('15:00'), {}, fridayLabel);
        const meet = await page.evaluate(() => {
            const node = document.querySelector('.msg-card');
            const title = node?.querySelector('input[aria-label="제목"]')?.value || '';
            const include = [...(node?.querySelectorAll('button') || [])].some((el) => el.innerText.trim() === '넣을게요');
            return { title, include, cards: document.querySelectorAll('.msg-card').length, text: node?.innerText || '' };
        });
        check(meet.cards === 1 && meet.include && meet.title === '학년 협의회' && meet.text.includes('일정') && meet.text.includes(fridayLabel), `요일 일정이 ${label}에서 ${fridayLabel} 15:00으로 보이지 않습니다. ${meet.title}`);
        await audit(page, `요일 일정 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_weekday_event_${label}.png`) });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('메시지 다시 붙이기'))?.click());
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.click('[data-screen="message"] textarea', { clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('지난주 금요일까지 학급 운영비 영수증 제출해 주세요.');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction((label) => document.body.innerText.includes('0개 등록') && document.body.innerText.includes(label) && document.body.innerText.includes('빼 둠'), {}, lastFridayLabel);
        const pastWeek = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '넣을게요'),
        }));
        check(pastWeek.low && !pastWeek.chosen, `지난주 금요일 마감이 ${label}에서 노란 카드가 아닙니다.`);
        await audit(page, `지난주 마감 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_last_week_${label}.png`) });
    }
    await withDemo(390, 'light', async (page) => { await weekdaySchedule(page, '390'); }, 844);
    await withDemo(360, 'light', async (page) => { await weekdaySchedule(page, '360'); }, 844);

    async function periodAndQuestion(page, label) {
        await openPlus(page);
        await clickPlus(page, '메시지 붙여넣기');
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.type('[data-screen="message"] textarea', '화요일 2교시 학급 회의');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction((label) => document.body.innerText.includes('1개 등록') && document.body.innerText.includes(label) && document.body.innerText.includes('09:40'), {}, tuesdayLabel);
        const period = await page.evaluate(() => {
            const node = document.querySelector('.msg-card');
            const title = node?.querySelector('input[aria-label="제목"]')?.value || '';
            const include = [...(node?.querySelectorAll('button') || [])].some((el) => el.innerText.trim() === '넣을게요');
            return { title, include, text: node?.innerText || '', cards: document.querySelectorAll('.msg-card').length };
        });
        check(period.cards === 1 && period.include && period.title === '학급 회의' && period.text.includes('2교시') && period.text.includes('일정'), `요일 교시가 ${label}에서 날짜와 교시를 채우지 않습니다. ${period.title} ${period.text}`);
        await audit(page, `요일 교시 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_period_${label}.png`) });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('메시지 다시 붙이기'))?.click());
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.click('[data-screen="message"] textarea', { clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('선생님 내일 회의 있나요?');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('빼 둠'));
        const asked = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '넣을게요'),
            text: document.body.innerText,
        }));
        check(asked.low && !asked.chosen && asked.text.includes('질문'), `질문 문장이 ${label}에서 노란 카드가 아닙니다.`);
        await audit(page, `질문 카드 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_question_${label}.png`) });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('메시지 다시 붙이기'))?.click());
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.click('[data-screen="message"] textarea', { clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('이번 달 말까지 학급문고 정리 부탁드려요');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction((label) => document.body.innerText.includes('1개 등록') && document.body.innerText.includes(label), {}, monthEndLabel);
        const monthEnd = await page.evaluate(() => {
            const node = document.querySelector('.msg-card');
            const title = node?.querySelector('input[aria-label="제목"]')?.value || '';
            const include = [...(node?.querySelectorAll('button') || [])].some((el) => el.innerText.trim() === '넣을게요');
            return { title, include, cards: document.querySelectorAll('.msg-card').length, text: node?.innerText || '' };
        });
        check(monthEnd.cards === 1 && monthEnd.include && monthEnd.title.includes('학급문고') && monthEnd.text.includes('할 일') && monthEnd.text.includes(monthEndLabel), `이번 달 말까지가 ${label}에서 ${monthEndLabel} 할 일로 들어가지 않습니다. ${monthEnd.title}`);
        await audit(page, `말일 마감 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_month_end_${label}.png`) });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('메시지 다시 붙이기'))?.click());
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.click('[data-screen="message"] textarea', { clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('11/12(목) 운동회는 열지 않기로 했습니다.');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('빼 둠'));
        const closed = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '넣을게요'),
            text: document.body.innerText,
        }));
        check(closed.low && !closed.chosen && closed.text.includes('11월 12일'), `열지 않기로가 ${label}에서 노란 카드가 아닙니다.`);
        await audit(page, `열지 않기로 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_not_held_${label}.png`) });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('메시지 다시 붙이기'))?.click());
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.click('[data-screen="message"] textarea', { clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('11월 6일(금) 학년 체육대회는 열리지 못하게 되었습니다.');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('빼 둠'));
        const fell = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '넣을게요'),
            text: document.body.innerText,
        }));
        check(fell.low && !fell.chosen && fell.text.includes('11월 6일'), `열리지 못하게가 ${label}에서 노란 카드가 아닙니다.`);
        await audit(page, `열리지 못하게 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_not_opened_${label}.png`) });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('메시지 다시 붙이기'))?.click());
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.click('[data-screen="message"] textarea', { clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('저 10/24~10/25 제주도 가요~ 귤 사올게요');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('빼 둠'));
        const trip = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '넣을게요'),
            text: document.body.innerText,
        }));
        check(trip.low && !trip.chosen && trip.text.includes('10월 24일'), `제주 잡담이 ${label}에서 노란 카드가 아닙니다.`);
        await audit(page, `제주 잡담 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_personal_trip_${label}.png`) });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('메시지 다시 붙이기'))?.click());
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.click('[data-screen="message"] textarea', { clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('11월 20일(금) 교직원 체육대회가 열리지 못합니다.');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('11월 20일'));
        const cannot = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '넣을게요'),
        }));
        check(cannot.low && !cannot.chosen, `열리지 못합니다가 ${label}에서 노란 카드가 아닙니다.`);
        await audit(page, `열리지 못합니다 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_cannot_hold_${label}.png`) });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('메시지 다시 붙이기'))?.click());
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.click('[data-screen="message"] textarea', { clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('저 11/2~11/3 연차예요. 급한 일은 학년부장님께 부탁드려요.');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('11월 2일'));
        const leave = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '넣을게요'),
            cards: document.querySelectorAll('.msg-card').length,
        }));
        check(leave.low && !leave.chosen && leave.cards === 1, `본인 연차가 ${label}에서 노란 카드 한 장이 아닙니다.`);
        await audit(page, `본인 연차 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_personal_leave_${label}.png`) });
    }
    await withDemo(390, 'light', async (page) => { await periodAndQuestion(page, '390'); }, 844);
    await withDemo(360, 'light', async (page) => { await periodAndQuestion(page, '360'); }, 844);

    await withDemo(390, 'light', async (page) => {
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
        await openPlus(page);
        await page.type('[data-screen="plus"] textarea', '12번 이하은 발표를 끝까지 했어요');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.trim() === '다음')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('학생 기록') && document.body.innerText.includes('넣을게요'));
        const folded = await page.evaluate(() => !document.querySelector('[aria-label="학생 번호"]'));
        check(folded, '미리보기 카드가 접혀 있지 않습니다.');
        await page.screenshot({ path: resolve(shots, 'after_preview_390.png') });
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.getAttribute('aria-expanded') === 'false')?.click());
        await page.waitForFunction(() => document.querySelector('[aria-label="학생 번호"]'));
        const card = await page.evaluate(() => ({
            low: document.querySelectorAll('[data-screen="plus"] .low-card').length,
            kind: document.querySelector('[aria-label="종류"] .on')?.innerText.trim() || '',
            select: document.querySelectorAll('[data-screen="plus"] select').length,
        }));
        check(card.low === 0 && card.kind === '학생 기록' && card.select === 0, `학생 기록 미리보기가 ${JSON.stringify(card)} 입니다.`);
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.trim() === '넣을게요')?.click());
        await page.waitForFunction(() => [...document.querySelectorAll('[data-screen="plus"] button')].some((el) => el.innerText.trim() === '빼 둠'));
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.trim() === '빼 둠')?.click());
        await page.waitForFunction(() => [...document.querySelectorAll('[data-screen="plus"] button')].some((el) => el.innerText.trim() === '넣을게요'));
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.trim() === '남기기')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('되돌리기'));
        await page.waitForFunction(() => !document.querySelector('[data-screen="plus"]'));
        await page.evaluate(() => { location.hash = '#/students/12'; });
        await page.waitForFunction(() => document.body.innerText.includes('발표를 끝까지 했어요'));
    }, 844);

    await withPage(390, async (page) => {
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('homenote_v2_classRoster', JSON.stringify([{ id: '1', name: '김하늘' }]));
        });
        await page.goto(`${origin}?mode=light`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => document.body.innerText.includes('이 기기에서만'), { timeout: 8000 });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('이 기기에서만'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('예전 교무수첩'));
        const legacyText = await page.evaluate(() => document.body.innerText);
        check(legacyText.includes('학생 1명'), '예전 명단을 읽지 못했습니다.');
        const still = await page.evaluate(() => localStorage.getItem('homenote_v2_classRoster'));
        check(still && still.includes('김하늘'), '시작 화면이 원본 키를 지웠습니다.');
    });

    await withDemo(390, 'light', async (page) => {
        const initial = await page.evaluate(() => localStorage.getItem('ssug-gyomu-key-sound'));
        check(initial === null, '콕 소리 기본값이 켜져 있지 않습니다.');
        await page.click('[aria-label="할 일 고르기"]');
        await page.waitForFunction(() => document.body.innerText.includes('누를 때 소리가 나요'));
        const notice = await page.evaluate(() => ({
            text: document.querySelector('.toast')?.innerText || '',
            off: [...document.querySelectorAll('.toast button')].some((el) => el.innerText.trim() === '끄기'),
        }));
        check(notice.text.includes('콕') && notice.text.includes('누를 때 소리가 나요') && notice.off, '처음 소리 안내가 없습니다.');
        await page.evaluate(() => {
            const button = [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.getBoundingClientRect().width > 40);
            button?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, cancelable: true }));
        });
        await delay(80);
        const stillOne = await page.evaluate(() => document.querySelectorAll('.toast').length === 1 && document.body.innerText.includes('누를 때 소리가 나요'));
        check(stillOne, '소리 안내가 한 번보다 많이 나옵니다.');
        await page.evaluate(() => [...document.querySelectorAll('.toast button')].find((el) => el.innerText.trim() === '끄기')?.click());
        await page.waitForFunction(() => !document.body.innerText.includes('누를 때 소리가 나요'));
        const saved = await page.evaluate(() => ({
            sound: localStorage.getItem('ssug-gyomu-key-sound'),
            seen: localStorage.getItem('ssug-gyomu-key-sound-notice'),
        }));
        check(saved.sound === '0' && saved.seen === '1', '소리 끄기가 저장되지 않았습니다.');
    });

    await withDemo(390, 'light', async (page) => {
        await page.evaluate(async () => {
            if (!navigator.serviceWorker) return false;
            return Promise.race([
                navigator.serviceWorker.ready.then((reg) => Boolean(reg.active || reg.installing || reg.waiting)),
                new Promise((resolveReady) => { setTimeout(() => resolveReady(false), 8000); }),
            ]);
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.setOfflineMode(true);
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await delay(400);
        const offlineText = await page.evaluate(() => document.body.innerText).catch(() => '');
        check(
            offlineText.includes('콕') || offlineText.includes('오늘') || offlineText.includes('인터넷'),
            '오프라인에서 껍데기가 열리지 않습니다.',
        );
    });
} catch (error) {
    failures.push(error?.message || String(error));
}

if (failures.length) {
    console.error(failures.join('\n'));
    if (log && !/AIza|apiKey|VITE_FIREBASE/.test(log)) console.error(log.slice(-2000));
    await shutdown(1);
}
console.log(`브라우저 검사를 통과했습니다. 화면은 ${shots} 에 있습니다.`);
await shutdown(0);
