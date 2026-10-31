/** 360·390·1280에서 넘침과 버튼 크기, 주요 흐름을 확인하고 화면을 저장합니다. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';
import { build as viteBuild } from 'vite';
import { addDaysYmd, fromYmd, monthTitle, seoulYmd, startOfWeekMon, weekdayKo } from '../src/lib/date.js';

/**
 * 브라우저 시계. 서울 평일 오전(2026-10-23 금 08:42)으로 고정합니다.
 * 실제 시계와 자정을 쓰지 않아, 주말·자정에도 같은 주를 봅니다.
 * 다른 브랜치로 옮길 때는 이 상수, pinBrowserClock, withPage·withDemo의 호출만 가져가면 됩니다.
 */
const FIXED_NOW = process.env.FIXED_NOW || '2026-10-23T08:42:00+09:00';

/* 오늘 화면 접는 카드(1안): 다른 흐름 검사는 펼친 채로 봅니다. 접힘 검사만 이 값을 끕니다. */
let foldPreset = true;

async function pinBrowserClock(page) {
    await page.evaluateOnNewDocument((open) => {
        if (open && !localStorage.getItem('ssug-gyomu-home-fold')) localStorage.setItem('ssug-gyomu-home-fold', JSON.stringify({ time: true, todo: true, event: true, recent: true }));
    }, foldPreset);
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
    await page.evaluateOnNewDocument(() => {
        window.__cls = 0;
        try {
            new PerformanceObserver((list) => {
                for (const entry of list.getEntries()) {
                    if (!entry.hadRecentInput) {
                        window.__cls += entry.value;
                        (window.__shifts ||= []).push({
                            value: Number(entry.value.toFixed(5)),
                            at: Math.round(entry.startTime),
                            nodes: (entry.sources || []).map((src) => {
                                const el = src.node?.nodeType === 1 ? src.node : src.node?.parentElement;
                                const r = src.currentRect;
                                const p = src.previousRect;
                                return `${el?.className || el?.nodeName || '?'} "${(src.node?.textContent || '').trim().slice(0, 16)}" ${p?.y}→${r?.y} ${p?.height}→${r?.height}`;
                            }),
                        });
                    }
                }
            }).observe({ type: 'layout-shift', buffered: true });
        } catch {
            /* 레이아웃 이동을 못 재도 다른 검사는 이어집니다. */
        }
    });
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

/** 화면 칩과 같습니다. 해가 다르면 해를 붙입니다. */
function chipText(ymd, today = todayYmd) {
    const body = koMonthDay(ymd);
    if (String(ymd).slice(0, 4) !== String(today).slice(0, 4)) return `${String(ymd).slice(0, 4)}년 ${body}`;
    return body;
}

function chipHas(chips, ymd) {
    return (chips || []).includes(chipText(ymd));
}

/** 오늘이 14일 이하면 이번 달 16일, 넘으면 다음 달 2일. 그 뒤 날짜도 같은 달입니다. */
function futureAnchor(today) {
    const day = Number(today.slice(8, 10));
    if (day <= 14) return `${today.slice(0, 8)}16`;
    const year = Number(today.slice(0, 4));
    const month = Number(today.slice(5, 7));
    const nextYear = month === 12 ? year + 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    return `${nextYear}-${String(nextMonth).padStart(2, '0')}-02`;
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
            start: chipText(today),
            end: chipText(addDaysYmd(today, 2)),
        };
    }
    const start = `${today.slice(0, 8)}${String(last).padStart(2, '0')}`;
    return {
        text: `${last}~2일`,
        start: chipText(start),
        end: chipText(addDaysYmd(start, 2)),
    };
}

const monthEndLabel = monthEndLabelOf(todayYmd);
const photo = dated(addDaysYmd(todayYmd, 5));
const delayedFrom = dated(addDaysYmd(todayYmd, 3));
const delayedTo = dated(addDaysYmd(todayYmd, 10));
const pulledFrom = dated(addDaysYmd(todayYmd, 8));
const pulledTo = dated(addDaysYmd(todayYmd, 2));
const bareSpan = monthlessSpan(todayYmd);
const anchorYmd = futureAnchor(todayYmd);
const counselStart = dated(anchorYmd);
const counselEnd = dated(addDaysYmd(anchorYmd, 4));
const counselPick = dated(addDaysYmd(anchorYmd, 1));
const counselLater = dated(addDaysYmd(anchorYmd, 5));
const counselFlip = dated(addDaysYmd(anchorYmd, 8));
const planDue = dated(addDaysYmd(anchorYmd, 10));
const readStart = dated(addDaysYmd(anchorYmd, 6));
const readEnd = dated(addDaysYmd(anchorYmd, 8));

const root = resolve(new URL('..', import.meta.url).pathname);
const shots = prepareShots();
const port = Number(process.env.CHECK_BROWSER_PORT) || 4175;
const origin = `http://127.0.0.1:${port}/`;
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find((path) => path && existsSync(path));
if (!chrome) {
    console.error('크롬을 찾지 못했습니다.');
    process.exit(1);
}

function prepareShots() {
    const candidates = [process.env.SCREENSHOT_DIR, '/tmp/ssug-screenshots'].filter(Boolean);
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

/** 누를 때 소리·글자 소리 모듈을 한 파일로 묶어 페이지에 넣습니다. 실제 Web Audio 그래프로 크기를 잽니다. */
async function pressProbeCode() {
    const out = await viteBuild({
        configFile: false,
        logLevel: 'silent',
        root,
        publicDir: false,
        build: {
            write: false,
            minify: false,
            emptyOutDir: false,
            lib: { entry: resolve(root, 'scripts/fixtures/press-probe.js'), name: 'PressProbe', formats: ['iife'], fileName: () => 'press-probe.js' },
        },
    });
    const result = Array.isArray(out) ? out[0] : out;
    return result.output.find((chunk) => chunk.type === 'chunk').code;
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

/** CSS unicode-range 에 이 글자 번호가 들어 있는지 봅니다. */
function unicodeRangeHas(range, code) {
    return String(range).split(',').some((part) => {
        const m = part.trim().match(/^U\+([0-9A-F]+)(?:-([0-9A-F]+))?$/i);
        if (!m) return false;
        const lo = parseInt(m[1], 16);
        const hi = m[2] ? parseInt(m[2], 16) : lo;
        return code >= lo && code <= hi;
    });
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
            await page.waitForFunction(() => {
                const text = document.body.innerText;
                return text.includes('오늘 우리 반') || text.includes('오늘은 수업이 없어요');
            }, { timeout: 15000 });
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

/* + 화면은 사람이 가는 길 그대로 엽니다: 보이는 쨈 버튼 → 빠른 입력의 '메시지·회의록 붙여넣기'. */
async function openPlus(page) {
    await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('[aria-label="쨈 빠른 입력 열기"]')];
        const visible = buttons.find((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
        visible?.click();
    });
    await page.waitForSelector('.quick-bar.is-open .quick-paste');
    await page.evaluate(() => document.querySelector('.quick-bar.is-open .quick-paste')?.click());
    await page.waitForSelector('[data-screen="plus"]');
}

// 붙여넣기로 연 ＋는 더보기가 펼쳐져 있습니다. 한 화면 맞춤은 접은 기본 화면에서 봅니다(펼친 뒤 스크롤은 예전과 같음).
async function foldPlus(page) {
    await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.includes('접기'))?.click());
    await page.waitForFunction(() => [...document.querySelectorAll('[data-screen="plus"] button')].some((el) => el.innerText.includes('더보기')), { timeout: 5000 });
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
    const indexHtml = readFileSync(resolve(root, 'index.html'), 'utf8');
    const fontsCss = readFileSync(resolve(root, 'public/fonts/fonts.css'), 'utf8');
    const screenCss = readFileSync(resolve(root, 'src/index.css'), 'utf8');
    const tokenCss = readFileSync(resolve(root, 'src/styles/tokens.css'), 'utf8');
    const firstFont = resolve(root, 'public/fonts/JJAEMBody-Regular.first.woff2');
    check(indexHtml.includes('href="./fonts/JJAEMBody-Regular.first.woff2" as="font"'), '첫 화면 글꼴 preload가 없습니다.');
    check(!indexHtml.includes('href="./fonts/JJAEMBody-Regular.ks.woff2"'), '본문 전체 파일을 미리 받습니다.');
    for (const name of ['JJAEMBody-Regular.first.woff2', 'JJAEMBody-Bold.first.woff2', 'JJAEM-TitleFlat-Regular.first.woff2']) {
        check(indexHtml.includes(`<link rel="preload" href="./fonts/${name}" as="font" type="font/woff2" crossorigin>`), `첫 화면 글꼴 ${name} 미리 받기 줄이 없습니다.`);
    }
    check(['400 1em "JJAEM Body"', '700 1em "JJAEM Body"', '400 1em "JJAEM Title Flat"'].every((face) => indexHtml.includes(`'${face}'`)) && indexHtml.includes('document.fonts.load(face,'), '전체 글꼴을 화면과 같은 글꼴 묶음으로 받지 않습니다.');
    check(/getItem\('ssug-gyomu-tips'\) \|\| q\.get\('demo'\) === '1'\) \{\s*warmFonts\(\);/.test(indexHtml), '오늘 화면으로 바로 여는 경우 전체 글꼴을 미리 받지 않아 화면이 밀릴 수 있습니다.');
    check(/\} else \{\s*addEventListener\('load', function \(\) \{\s*\(window\.requestIdleCallback[^\n]*\(warmFonts/.test(indexHtml), '처음 로그인 화면이 쉬는 틈에 다음 화면 글꼴을 받아 두지 않습니다.');
    check(!/rel = 'preload'|\.rel = "preload"/.test(indexHtml), '전체 글꼴을 따로 미리 받기 링크로 받아 같은 파일을 두 번 받을 수 있습니다.');
    check(existsSync(firstFont) && statSync(firstFont).size < 32 * 1024, '첫 화면 글꼴이 작지 않습니다.');
    const jjaemFaces = fontsCss.split('@font-face').slice(1).filter((block) => block.includes("'JJAEM"));
    check(jjaemFaces.length >= 4 && jjaemFaces.every((block) => block.includes('font-display: swap') && !/font-display:\s*block/.test(block)), '쨈 글꼴이 swap이 아닙니다.');
    /** QA 9차 O1·O5·O7·O9: 글꼴 칸 순서, 첫 화면 범위, 전체 파일 받기 글자, 쉬는 틈이 없는 엔진의 대체 경로. */
    const faceList = fontsCss.split('@font-face').slice(1).map((block) => ({
        family: (block.match(/font-family:\s*'([^']+)'/) || [])[1] || '',
        weight: ((block.match(/font-weight:\s*([^;]+);/) || [])[1] || '').trim(),
        file: (block.match(/url\('\.\/([^']+)'\)/) || [])[1] || '',
        range: ((block.match(/unicode-range:\s*([^;]+);/) || [])[1] || '').trim(),
    }));
    for (const [family, weight] of [['JJAEM Body', '400'], ['JJAEM Body', '700'], ['JJAEM Title Flat', '400']]) {
        const ks = faceList.findIndex((face) => face.family === family && face.weight === weight && face.file.endsWith('.ks.woff2'));
        const first = faceList.findIndex((face) => face.family === family && face.weight === weight && face.file.endsWith('.first.woff2'));
        check(ks >= 0 && first > ks && !faceList[ks].range && Boolean(faceList[first].range), `${family} ${weight}: 전체 파일(.ks)이 첫 화면 파일(.first)보다 앞에 있지 않습니다. 뒤에 적은 칸을 먼저 보므로 첫 화면이 큰 파일을 받게 됩니다.`);
        check(first >= 0 && !unicodeRangeHas(faceList[first].range, 0xD7A3), `${family} ${weight}: 전체 파일을 깨우는 글자 '힣'이 첫 화면 파일 범위에 들어 있습니다.`);
    }
    const titleFirst = faceList.find((face) => face.family === 'JJAEM Title Flat' && face.file.endsWith('.first.woff2'));
    check([...'쨈 교무수첩'].every((ch) => unicodeRangeHas(titleFirst?.range || '', ch.codePointAt(0))), `첫 화면 제목 '쨈 교무수첩' 글자가 제목 첫 화면 파일 범위에 다 들어 있지 않습니다. ${titleFirst?.range}`);
    check(indexHtml.includes("document.fonts.load(face, '\\uD7A3')"), "전체 글꼴을 '힣'(U+D7A3, 첫 화면 범위 밖)으로 깨우지 않습니다. 첫 화면 글자로 깨우면 큰 파일을 받지 않습니다.");
    check(indexHtml.includes('(window.requestIdleCallback || function (run) { setTimeout(run, 200); })(warmFonts, { timeout: 4000 });'), '쉬는 틈(requestIdleCallback)이 없는 엔진에서 200ms 뒤 전체 글꼴을 받는 대체 경로가 없습니다.');
    check(tokenCss.includes("--font-display: 'JJAEM Title Flat'"), '제목 글꼴이 쨈 제목 평면이 아닙니다.');
    check(screenCss.includes('.cal-grid .tap.cal-today.cal-picked { box-shadow: inset 0 0 0 2px var(--ink); }'), '오늘이 고른 날이면 안쪽 링이 없습니다.');
    check(screenCss.includes('.dark .cal-grid .tap.cal-today .num { color: var(--bg); }'), '다크 오늘 칸 글자가 바탕색이 아닙니다.');
    check(screenCss.includes('data-font-sample="plain"] { font-family: var(--font-jjaem); }'), '기본 글꼴 견본이 쨈 본문이 아닙니다.');
    await waitServer();
    await ensureBrowser();
    const scenes = [
        ['home-360-lilac.png', 360, 'light', async (page) => page],
        ['attend-360-lilac.png', 360, 'light', async (page) => { await page.evaluate(() => { location.hash = '#/attend'; }); await delay(200); }],
        ['record-360-lilac.png', 360, 'light', async (page) => { await page.evaluate(() => { location.hash = '#/students/12'; }); await page.waitForFunction(() => document.body.innerText.includes('이하은')); }],
        ['quick-360-lilac.png', 360, 'light', async (page) => { await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))); await page.waitForSelector('[aria-label="할 일 고르기"][role="dialog"]'); }],
        ['home-360-dark.png', 360, 'dark', async () => {}],
        ['attend-360-dark.png', 360, 'dark', async (page) => { await page.evaluate(() => { location.hash = '#/attend'; }); await delay(200); }],
        ['record-360-dark.png', 360, 'dark', async (page) => { await page.evaluate(() => { location.hash = '#/students/12'; }); await page.waitForFunction(() => document.body.innerText.includes('이하은')); }],
        ['quick-360-dark.png', 360, 'dark', async (page) => { await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true, cancelable: true }))); await delay(250); }],
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
            if (width === 390) {
                const sample = await page.evaluate(() => getComputedStyle(document.querySelector('[data-font-sample="plain"]')).fontFamily);
                check(String(sample).includes('JJAEM Body'), `기본 글꼴 견본이 쨈 본문이 아닙니다. ${sample}`);
            }
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
            if (width >= 900) {
                const underFab = await page.evaluate(() => {
                    const fab = document.querySelector('.desk-fab')?.getBoundingClientRect();
                    const mainBottom = document.querySelector('.main')?.getBoundingClientRect().bottom ?? window.innerHeight;
                    const hit = (a, b) => Boolean(
                        a && b && a.width > 0 && b.width > 0
                        && a.left < b.right - 0.5 && a.right > b.left + 0.5
                        && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5,
                    );
                    const rows = [...document.querySelectorAll('button.solid-card')].filter((el) => /^(16|17)\s/.test(el.innerText.trim()));
                    for (const row of rows) row.scrollIntoView({ block: 'end' });
                    return rows.map((el) => {
                        const box = el.getBoundingClientRect();
                        return {
                            text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 14),
                            top: Math.round(box.top),
                            bottom: Math.round(box.bottom),
                            under: hit(box, fab) && box.top < mainBottom + 0.5,
                        };
                    });
                });
                check(
                    underFab.length === 2 && underFab.every((row) => !row.under),
                    `1920에서 출결 16·17번 줄이 쨈 버튼 아래로 지나갑니다: ${JSON.stringify(underFab)}`,
                );
            }
            await audit(page, `출결 너비 ${width}`);
        }, width >= 900 ? 1080 : 800);
    }

    await withDemo(390, 'light', async (page) => {
        const homeText = await page.evaluate(() => document.body.innerText);
        const heroText = await page.evaluate(() => document.querySelector('.home-hero')?.innerText || '');
        if (heroText.includes('오늘은 수업이 없어요')) {
            check(!heroText.includes('1교시') && !heroText.includes('18분') && !heroText.includes('출결 하기') && !heroText.includes('출결부터'), '휴일 홈에 교시 알림이나 출결 카드가 남아 있습니다.');
            check(heroText.includes('출결 보기'), '휴일 홈에서 출결 화면으로 가는 버튼이 없습니다.');
            const bannerText = await page.evaluate(() => document.querySelector('.rest-banner')?.innerText || '');
            check(Boolean(bannerText) && !bannerText.includes('수업 대신') && !bannerText.includes('수업과 출결'), '휴일 안내가 시간표에 한 번 더 있습니다.');
        } else {
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
        }
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
        const seatType = await page.evaluate(() => {
            const seat = document.querySelector('.cell-grid button');
            const num = seat?.querySelector('.num');
            const name = num?.nextElementSibling;
            return {
                numWeight: num ? getComputedStyle(num).fontWeight : '',
                numSize: num ? getComputedStyle(num).fontSize : '',
                nameWeight: name ? getComputedStyle(name).fontWeight : '',
            };
        });
        check(seatType.numSize === '12px' && Number(seatType.numWeight) <= 400 && Number(seatType.nameWeight) >= 700, `12px 번호가 보통 굵기가 아닙니다. ${JSON.stringify(seatType)}`);
        const seats = () => page.evaluate(() => [...document.querySelectorAll('.cell-grid button')].map((el) => el.innerText.replace(/\s+/g, ' ')));
        const pressBox = (name) => page.evaluate((label) => {
            [...document.querySelectorAll('button[aria-pressed]')].find((el) => el.innerText.includes(label))?.click();
        }, name);
        await pressBox('결석');
        let names = await seats();
        check(names.length === 1 && names[0].includes('박서준'), '결석 칸이 그 학생만 보여 주지 않습니다.');
        const smallType = await page.evaluate(() => {
            const bold = [];
            let status = 0;
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            while (walker.nextNode()) {
                const text = walker.currentNode.textContent.trim();
                const el = walker.currentNode.parentElement;
                if (!text || !el || !el.getClientRects().length) continue;
                const style = getComputedStyle(el);
                if (style.visibility === 'hidden' || parseFloat(style.fontSize) >= 14) continue;
                if (el.closest('.cell-grid') && text === '결석') status += 1;
                if (Number(style.fontWeight) >= 600) bold.push(`${text.slice(0, 12)} ${style.fontSize}/${style.fontWeight}`);
            }
            return { bold, status };
        });
        check(smallType.status >= 1 && smallType.bold.length === 0, `14px보다 작은 글자가 굵습니다. ${JSON.stringify(smallType)}`);
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
        await page.waitForFunction(() => location.hash.endsWith('/month') && [...document.querySelectorAll('button.solid-card')].some((el) => el.innerText.includes('박서준')));
        const monthRow = await page.evaluate(() => {
            const button = [...document.querySelectorAll('button.solid-card')].find((el) => !el.hasAttribute('aria-pressed') && el.innerText.includes('박서준') && el.classList.contains('tap'));
            button?.click();
            return Boolean(button);
        });
        check(monthRow, '이번 달 학생 줄이 버튼이 아닙니다.');
        await page.waitForFunction(() => (document.querySelector('h1')?.innerText || '').includes('박서준'));
        await page.click('[aria-label="뒤로"]');
        await page.waitForFunction(() => location.hash.endsWith('/month'));
        const monthKept = await page.evaluate(() => [...document.querySelectorAll('button.chip')].some((el) => el.innerText.trim() === '이번 달' && el.classList.contains('on')));
        check(monthKept, '학생에서 돌아오면 이번 달 보기가 오늘로 돌아갑니다.');
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
        const face = await page.evaluate(() => ({
            field: Boolean(document.querySelector('[data-screen="plus"] textarea')),
            buttons: [...document.querySelectorAll('[data-screen="plus"] button')].map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
        }));
        check(face.field, '＋에 입력창이 없습니다.');
        for (const label of ['출결', '상담', '할 일', '일정']) {
            if (!face.buttons.some((item) => item.includes(label))) failures.push(`＋에 ${label}이 없습니다.`);
        }
        // QA 2차 1번: 빠른 입력의 '메시지·회의록 붙여넣기'로 열면 더보기가 이미 펼쳐져 있습니다(접기 단추가 보임).
        check(face.buttons.some((item) => item.includes('접기')) && !face.buttons.some((item) => item.includes('더보기')), `붙여넣기로 연 ＋에 더보기가 펼쳐져 있지 않습니다: ${face.buttons.join(' / ')}`);
        await foldPlus(page);
        reportChoice('＋ 메뉴 390', await choiceFit(page, 'plus'));
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

        /* + → '회의록 작성'은 이제 Enter로 저장되던 흐름 대신 회의록 쓰기 화면을 엽니다. 회의 종류는 그 화면의 칩으로 고릅니다. */
        await clickPlus(page, '회의록 작성');
        await page.waitForSelector('[data-screen="minutes-editor"]');
        const meetLabels = await page.evaluate(() => [...document.querySelectorAll('.minutes-kinds button')].map((el) => el.innerText.trim()));
        for (const label of ['학년회의', '교직원회의', '교과협의회', '학부모회의', '연수']) {
            if (!meetLabels.includes(label)) failures.push(`회의 종류에 ${label}이 없습니다.`);
        }
        check(!(await page.$('[data-screen="flow"]')), '회의록 작성이 아직 예전 흐름(FlowSheet)을 엽니다.');
        await page.screenshot({ path: resolve(shots, 'after_meet_kind_390.png') });
        await page.evaluate(() => { location.hash = '#/today'; });
        await page.waitForFunction(() => !document.querySelector('[data-screen="minutes-editor"]'));
        await page.evaluate(() => localStorage.removeItem('ssug-gyomu-minutes-draft'));

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
        /* 누르면 곧바로 저장되고, 메모·서류를 확실히 올리는 '저장' 단추도 함께 둡니다(삼봉 님 요청, v38). */
        check(await page.evaluate(() => [...document.querySelectorAll('[data-screen="attend-status"] button')].some((el) => el.innerText.trim() === '저장')), '출결 시트에 저장 단추가 없습니다.');
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
            `${planDue.label}까지 공개수업 지도안 제출`,
            '가정통신문',
            `학부모 상담주간: ${counselStart.label}(${counselStart.week})~${counselEnd.label}(${counselEnd.week})`,
            '김교사 출장으로 5,6교시 보결',
        ].join('\n');
        await page.focus('[data-screen="message"] textarea');
        await page.keyboard.type(four);
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        const previewReady = await page.waitForFunction((start, end) => document.body.innerText.includes('3개 등록') && document.body.innerText.includes(start) && document.body.innerText.includes(end), { timeout: 8000 }, counselStart.label, counselEnd.label).catch(() => null);
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
        check(bounds.start?.text.includes(counselStart.label) && bounds.end?.text.includes(counselEnd.label), `기간 날짜가 ${bounds.start?.text}~${bounds.end?.text} 입니다.`);
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
        await page.evaluate((ymd) => document.querySelector(`[aria-label="${ymd}"]`)?.click(), counselPick.ymd);
        const started = await page.evaluate(() => ({
            start: document.querySelector('[aria-label="시작일 고치기"]')?.innerText.trim() || '',
            end: document.querySelector('[aria-label="끝일 고치기"]')?.innerText.trim() || '',
            calendar: Boolean(document.querySelector('[aria-label="날짜"]')),
            select: Boolean(document.querySelector('[data-screen="message"] select')),
        }));
        check(started.start.includes(counselPick.label) && started.end.includes(counselEnd.label) && !started.calendar && !started.select, `시작일을 골라도 끝이 같이 바뀌거나 달력이 남습니다. ${started.start} ${started.end}`);
        await page.evaluate(() => document.querySelector('[aria-label="끝일 고치기"]')?.click());
        await page.waitForSelector('[aria-label="날짜"]');
        await page.screenshot({ path: resolve(shots, 'after_range_end_390.png') });
        await page.evaluate((ymd) => document.querySelector(`[aria-label="${ymd}"]`)?.click(), counselLater.ymd);
        const ended = await page.evaluate(() => ({
            start: document.querySelector('[aria-label="시작일 고치기"]')?.innerText.trim() || '',
            end: document.querySelector('[aria-label="끝일 고치기"]')?.innerText.trim() || '',
            calendar: Boolean(document.querySelector('[aria-label="날짜"]')),
        }));
        check(ended.end.includes(counselLater.label) && ended.start.includes(counselPick.label) && !ended.calendar, `끝일을 고쳐도 시작일이 바뀝니다. ${ended.start} ${ended.end}`);
        await page.evaluate(() => document.querySelector('[aria-label="시작일 고치기"]')?.click());
        await page.waitForSelector(`[aria-label="${counselFlip.ymd}"]`);
        await page.evaluate((ymd) => document.querySelector(`[aria-label="${ymd}"]`)?.click(), counselFlip.ymd);
        const flipped = await page.evaluate(() => ({
            start: document.querySelector('[aria-label="시작일 고치기"]')?.innerText.trim() || '',
            end: document.querySelector('[aria-label="끝일 고치기"]')?.innerText.trim() || '',
        }));
        check(flipped.start.includes(counselFlip.label) && flipped.end.includes(counselFlip.label), `시작일이 끝보다 늦으면 끝이 따라가지 않습니다. ${flipped.start} ${flipped.end}`);
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
        await page.waitForFunction((label) => document.body.innerText.includes(label) && document.body.innerText.includes('1개 등록'), {}, chipText('2027-03-04'));
        const yearChip = await page.evaluate(() => document.querySelector('[aria-label="날짜 고치기"]')?.innerText.trim() || '');
        check(yearChip === chipText('2027-03-04'), `다른 해 날짜 칩이 ${yearChip} 입니다.`);
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('메시지 다시 붙이기'))?.click());
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.click('[data-screen="message"] textarea', { clickCount: 3 });
        await page.keyboard.down('Control');
        await page.keyboard.press('KeyA');
        await page.keyboard.up('Control');
        await page.keyboard.press('Backspace');
        await page.keyboard.type('어제 체육대회 다들 수고 많으셨습니다!');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('지금 저장'));
        const yellow = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '나중에 정리'),
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
        await page.waitForFunction((label) => document.body.innerText.includes(label) && document.body.innerText.includes('1개 등록'), {}, chipText('2027-01-11'));
        const shortYear = await page.evaluate(() => ({
            chip: document.querySelector('[aria-label="날짜 고치기"]')?.innerText.trim() || '',
            title: document.querySelector('[aria-label="제목"]')?.value || '',
        }));
        check(shortYear.chip === chipText('2027-01-11') && !/\d/.test(shortYear.title), `두 자리 연도 카드가 ${shortYear.chip} / ${shortYear.title} 입니다.`);
        await page.screenshot({ path: resolve(shots, 'after_short_year_390.png') });
        await pasteNext('2027학년도 학부모총회 3월 18일(목) 오후 2시');
        await page.waitForFunction((label) => document.body.innerText.includes(label) && document.body.innerText.includes('1개 등록'), {}, chipText('2027-03-18'));
        await pasteNext('2025년 11월 3일 학교폭력 실태조사 결과 공유합니다. 참고만 해주세요.');
        await page.waitForFunction(() => document.body.innerText.includes('2025년 11월 3일') && document.body.innerText.includes('0개 등록') && document.body.innerText.includes('지금 저장'));
        const past = await page.evaluate(() => Boolean(document.querySelector('.low-card')));
        check(past, '지난 참고 자료가 노란 카드가 아닙니다.');
        const postpone = `방과후 축구반 ${delayedFrom.slash} 수업은 ${delayedTo.slash}로 연기됩니다.`;
        await pasteNext(postpone);
        await page.waitForFunction((label) => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('지금 저장') && document.body.innerText.includes(label), {}, delayedTo.label);
        const moved = await page.evaluate(() => ({
            chips: [...document.querySelectorAll('[aria-label="날짜 고치기"]')].map((el) => el.innerText.trim()),
            titles: [...document.querySelectorAll('[aria-label="제목"]')].map((el) => el.value),
            low: document.querySelectorAll('.low-card').length,
            aside: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '지금 저장').length,
            kept: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '나중에 정리').length,
        }));
        check(chipHas(moved.chips, delayedTo.ymd) && chipHas(moved.chips, delayedFrom.ymd) && moved.titles.length >= 2 && moved.titles.every((title) => title === postpone) && moved.low >= 2 && moved.aside >= 2 && moved.kept === 0, `연기 카드가 ${JSON.stringify(moved)} 입니다.`);
        await page.screenshot({ path: resolve(shots, 'after_move_date_390.png') });
        const pulledText = `가을 소풍이 ${pulledFrom.slash}에서 ${pulledTo.slash} 15:00로 앞당겨졌습니다`;
        await pasteNext(pulledText);
        await page.waitForFunction((label) => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('지금 저장') && document.body.innerText.includes(label) && document.body.innerText.includes('15:00'), {}, pulledTo.label);
        const pulled = await page.evaluate(() => ({
            chips: [...document.querySelectorAll('[aria-label="날짜 고치기"]')].map((el) => el.innerText.trim()),
            times: [...document.querySelectorAll('[aria-label="시각 고치기"]')].map((el) => el.innerText.trim()),
            titles: [...document.querySelectorAll('[aria-label="제목"]')].map((el) => el.value),
            low: document.querySelectorAll('.low-card').length,
            aside: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '지금 저장').length,
            kept: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '나중에 정리').length,
        }));
        check(chipHas(pulled.chips, pulledTo.ymd) && chipHas(pulled.chips, pulledFrom.ymd) && pulled.times.includes('15:00') && pulled.titles.length >= 2 && pulled.titles.every((title) => title === pulledText) && pulled.low >= 2 && pulled.aside >= 2 && pulled.kept === 0, `앞당김 카드가 ${JSON.stringify(pulled)} 입니다.`);
        await page.screenshot({ path: resolve(shots, 'after_pull_date_390.png') });
        await pasteNext(`${bareSpan.text} 학년 연구실 공사`);
        await page.waitForFunction((start, end) => document.body.innerText.includes('1개 등록') && document.body.innerText.includes(start) && document.body.innerText.includes(end), {}, bareSpan.start, bareSpan.end);
        const span = await page.evaluate(() => ({
            start: document.querySelector('[aria-label="시작일 고치기"]')?.innerText.trim() || '',
            end: document.querySelector('[aria-label="끝일 고치기"]')?.innerText.trim() || '',
            title: document.querySelector('[aria-label="제목"]')?.value || '',
            kept: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '나중에 정리').length,
        }));
        check(span.start === bareSpan.start && span.end === bareSpan.end && span.title === '학년 연구실 공사' && !/\d/.test(span.title) && span.kept === 1, `월 없는 기간이 ${JSON.stringify(span)} 입니다.`);
        await page.screenshot({ path: resolve(shots, 'after_monthless_span_390.png') });
        const shiftedText = `${fridaySlash} 교직원 회의는 15:40에서 16:10으로 변경`;
        await pasteNext(shiftedText);
        await page.waitForFunction((label) => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('지금 저장') && document.body.innerText.includes('16:10') && document.body.innerText.includes(label), {}, fridayLabel);
        const shifted = await page.evaluate(() => ({
            chips: [...document.querySelectorAll('[aria-label="날짜 고치기"]')].map((el) => el.innerText.trim()),
            times: [...document.querySelectorAll('[aria-label="시각 고치기"]')].map((el) => el.innerText.trim()),
            titles: [...document.querySelectorAll('[aria-label="제목"]')].map((el) => el.value),
            kept: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '나중에 정리').length,
            low: document.querySelectorAll('.low-card').length,
        }));
        check(chipHas(shifted.chips, fridayYmd) && shifted.times.includes('16:10') && !shifted.times.includes('15:40') && shifted.titles.length === 1 && shifted.titles[0] === shiftedText && shifted.kept === 0 && shifted.low === 1, `시각 이동이 ${JSON.stringify(shifted)} 입니다.`);
        await pasteNext(`학예회 ${counselStart.slash} 상담 ${counselEnd.slash}`);
        await page.waitForFunction((start, end) => document.body.innerText.includes('0개 등록') && document.body.innerText.includes(start) && document.body.innerText.includes(end), {}, counselStart.label, counselEnd.label);
        const unsure = await page.evaluate(() => ({
            chips: [...document.querySelectorAll('[aria-label="날짜 고치기"]')].map((el) => el.innerText.trim()),
            low: document.querySelectorAll('.low-card').length,
            aside: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '지금 저장').length,
            kept: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '나중에 정리').length,
        }));
        check(chipHas(unsure.chips, counselStart.ymd) && chipHas(unsure.chips, counselEnd.ymd) && unsure.low >= 2 && unsure.aside >= 2 && unsure.kept === 0, `모호한 두 날짜가 ${JSON.stringify(unsure)} 입니다.`);
        await page.screenshot({ path: resolve(shots, 'after_unsure_dates_390.png') });
        await pasteNext(`${todaySlash}(${todayWeek}) 오후 2시~4시 학부모 진로 특강 (강당)`);
        await page.waitForFunction((label) => document.body.innerText.includes('1개 등록') && document.body.innerText.includes(label) && document.body.innerText.includes('14:00'), {}, todayLabel);
        const rangedTime = await page.evaluate(() => ({
            cards: document.querySelectorAll('.msg-card').length,
            chip: document.querySelector('[aria-label="시각 고치기"]')?.innerText.trim() || '',
            date: document.querySelector('[aria-label="날짜 고치기"]')?.innerText.trim() || '',
            memo: document.querySelector('[aria-label="메모"]')?.value || '',
            kept: [...document.querySelectorAll('.msg-card button')].filter((el) => el.innerText.trim() === '나중에 정리').length,
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
        await pasteNext(`겨울 독서 주간 ${readStart.label}(${readStart.week})~${Number(readEnd.ymd.slice(8, 10))}일(${readEnd.week})`);
        await page.waitForFunction((start, end) => document.body.innerText.includes(start) && document.body.innerText.includes(end) && document.body.innerText.includes('1개 등록'), {}, readStart.label, readEnd.label);
        await audit(page, '다른 해 날짜');
    }, 844);

    await withDemo(1280, 'light', async (page) => {
        await audit(page, '홈 16:9');
        await page.screenshot({ path: resolve(shots, 'after_home_16x9.png') });
        await openPlus(page);
        await foldPlus(page);
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
        async function showCalendar(monthTitle = '') {
            await page.evaluate(() => { location.hash = '#/schedule'; });
            await page.waitForFunction(() => [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '달력'));
            await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '달력')?.click());
            await page.waitForSelector('.cal-grid');
            if (!monthTitle) return;
            for (let back = 0; back < 8; back += 1) {
                const title = await page.evaluate(() => document.querySelector('[aria-label="이전 달"]')?.parentElement?.querySelector('.title-font')?.innerText.trim() || '');
                if (title === monthTitle) return;
                const year = Number((title.match(/(\d{4})년/) || [])[1] || 0);
                const month = Number((title.match(/(\d{1,2})월/) || [])[1] || 0);
                const targetYear = Number((monthTitle.match(/(\d{4})년/) || [])[1] || 0);
                const targetMonth = Number((monthTitle.match(/(\d{1,2})월/) || [])[1] || 0);
                await page.click(year * 12 + month < targetYear * 12 + targetMonth ? '[aria-label="다음 달"]' : '[aria-label="이전 달"]');
            }
        }
        if (!(week.includes('08:50') && week.includes('과학관'))) {
            await showCalendar();
            let found = false;
            for (let hop = 0; hop < 3 && !found; hop += 1) {
                const count = await page.evaluate(() => document.querySelectorAll('.cal-grid button').length);
                for (let index = 0; index < count && !found; index += 1) {
                    const marked = await page.evaluate((n) => document.querySelectorAll('.cal-grid button')[n]?.innerText.includes('·'), index);
                    if (!marked) continue;
                    const monthTitle = await page.evaluate(() => document.querySelector('[aria-label="이전 달"]')?.parentElement?.querySelector('.title-font')?.innerText.trim() || '');
                    const body = await page.evaluate(async (n) => {
                        const before = location.hash;
                        document.querySelectorAll('.cal-grid button')[n].click();
                        const start = performance.now();
                        while (location.hash === before && performance.now() - start < 1500) {
                            await new Promise((resolve) => requestAnimationFrame(resolve));
                        }
                        await new Promise((resolve) => requestAnimationFrame(resolve));
                        return document.body.innerText;
                    }, index);
                    if (body.includes('과학관') && body.includes('08:50')) {
                        week = body;
                        found = true;
                        break;
                    }
                    await showCalendar(monthTitle);
                }
                if (!found) await page.click('[aria-label="다음 달"]');
            }
            check(found, `현장체험 시각을 ${label} 달력에서 찾지 못했습니다.`);
        }
        check(week.includes('과학관') && week.includes('08:50') && !week.includes('08:50–'), `끝 시각 없는 일정이 ${label}에서 범위로 보입니다.`);
        await audit(page, `주간 일정 ${label}`);
        await page.screenshot({ path: resolve(shots, `after_time_span_${label}.png`) });
        await showCalendar();
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

    async function calendarPanel(page) {
        const todayHash = `#/schedule/month/${todayYmd}`;
        await page.evaluate(() => { location.hash = '#/schedule'; });
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '달력'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '달력')?.click());
        await page.waitForFunction((hash) => location.hash === hash, {}, todayHash);
        await page.waitForSelector('.cal-grid');
        const todayRing = await page.evaluate(() => {
            const el = document.querySelector('.cal-grid button.cal-today.cal-picked');
            const probe = document.createElement('div');
            document.body.appendChild(probe);
            probe.style.boxShadow = 'inset 0 0 0 2px var(--ink)';
            const expected = getComputedStyle(probe).boxShadow;
            probe.remove();
            return { found: Boolean(el), shadow: el ? getComputedStyle(el).boxShadow : '', expected };
        });
        check(todayRing.found && todayRing.shadow === todayRing.expected, `오늘이 고른 날이면 안쪽 링이 없습니다. ${JSON.stringify(todayRing)}`);
        const opened = await page.evaluate(() => ({
            panel: document.querySelector('[data-cal-panel]')?.getAttribute('data-cal-panel') || '',
            today: document.querySelector('[data-cal-panel]')?.innerText.includes('오늘') || false,
            monthOn: [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '달력' && el.classList.contains('on')),
        }));
        check(opened.panel === todayYmd && opened.today && opened.monthOn, `달력을 열면 오늘 패널이 아닙니다. ${JSON.stringify(opened)}`);
        const lenBeforeCells = await page.evaluate(() => history.length);
        const otherDay = todayDay === 15 ? 16 : 15;
        const laterDay = todayDay === 30 ? 28 : 30;
        async function clickInMonthDay(day) {
            await page.evaluate((value) => {
                const hit = [...document.querySelectorAll('.cal-grid button')].find((el) => Number(el.querySelector('.num')?.textContent) === value && !String(el.getAttribute('style') || '').includes('ink-sub'));
                hit?.click();
            }, day);
            const ymd = `${todayYmd.slice(0, 8)}${String(day).padStart(2, '0')}`;
            await page.waitForFunction((hash) => location.hash === hash, {}, `#/schedule/month/${ymd}`);
        }
        await clickInMonthDay(otherDay);
        await clickInMonthDay(laterDay);
        const lenAfterCells = await page.evaluate(() => history.length);
        check(lenAfterCells === lenBeforeCells, '날짜 칸을 누를 때마다 기록이 쌓입니다.');
        const marks = await page.evaluate((today, picked) => {
            const buttons = [...document.querySelectorAll('.cal-grid button')];
            const byDay = (day) => buttons.find((el) => Number(el.querySelector('.num')?.textContent) === day && !String(el.getAttribute('style') || '').includes('ink-sub'));
            const todayEl = byDay(today);
            const pickedEl = byDay(picked);
            return {
                todayCurrent: todayEl?.getAttribute('aria-current') || '',
                pickedCurrent: pickedEl?.getAttribute('aria-current') || '',
                todayRing: Boolean(todayEl?.classList.contains('cal-picked')),
                pickedRing: Boolean(pickedEl?.classList.contains('cal-picked')),
            };
        }, todayDay, laterDay);
        check(marks.pickedCurrent === 'date' && marks.pickedRing && marks.todayCurrent !== 'date' && !marks.todayRing, `고른 칸과 오늘 칸이 구분되지 않습니다. ${JSON.stringify(marks)}`);
        const todayDisk = await page.evaluate((today, picked) => {
            const buttons = [...document.querySelectorAll('.cal-grid button')];
            const byDay = (day) => buttons.find((el) => Number(el.querySelector('.num')?.textContent) === day && !String(el.getAttribute('style') || '').includes('ink-sub'));
            const disk = (el) => {
                const num = el?.querySelector('.num');
                if (!num) return null;
                const style = getComputedStyle(num);
                const radius = Number.parseFloat(style.borderRadius) || 0;
                return {
                    today: el.classList.contains('cal-today'),
                    picked: el.classList.contains('cal-picked'),
                    radius,
                    filled: style.backgroundColor !== 'rgba(0, 0, 0, 0)' && style.backgroundColor !== 'transparent',
                };
            };
            const weekend = buttons.find((el) => el.classList.contains('day-rest') && !el.classList.contains('cal-today') && !String(el.getAttribute('style') || '').includes('ink-sub'));
            return { today: disk(byDay(today)), picked: disk(byDay(picked)), weekend: disk(weekend) };
        }, todayDay, laterDay);
        check(
            todayDisk.today?.today && todayDisk.today.filled && todayDisk.today.radius >= 10 && !todayDisk.today.picked
            && todayDisk.picked?.picked && !todayDisk.picked.today && !todayDisk.picked.filled
            && todayDisk.weekend && !todayDisk.weekend.today && !todayDisk.weekend.filled,
            `오늘 칸이 채운 동그라미로 주말·고른 날과 구분되지 않습니다. ${JSON.stringify(todayDisk)}`,
        );
        await page.click('[aria-label="다음 달"]');
        const [year, month] = todayYmd.split('-').map(Number);
        const nextDate = new Date(year, month, 1);
        const nextYm = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
        const first = `${nextYm}-01`;
        const nextTitle = monthTitle(nextYm);
        await page.waitForFunction((hash, title) => location.hash === hash && document.body.innerText.includes(title), {}, `#/schedule/month/${first}`, nextTitle);
        const moved = await page.evaluate(() => ({
            panel: document.querySelector('[data-cal-panel]')?.getAttribute('data-cal-panel') || '',
            text: document.querySelector('[data-cal-panel]')?.innerText || '',
            hash: location.hash,
        }));
        check(moved.panel === first && moved.text.includes('1일') && !moved.text.includes('오늘') && !moved.hash.includes('/day/'), `다음 달 패널이 1일이 아닙니다. ${JSON.stringify(moved)}`);
        await page.evaluate((day) => {
            const hit = [...document.querySelectorAll('.cal-grid button')].find((el) => Number(el.querySelector('.num')?.textContent) === day && !String(el.getAttribute('style') || '').includes('ink-sub'));
            hit?.click();
        }, 15);
        const picked = `${nextYm}-15`;
        await page.waitForFunction((hash) => location.hash === hash && !location.hash.includes('/day/'), {}, `#/schedule/month/${picked}`);
        const pickedPanel = await page.evaluate(() => document.querySelector('[data-cal-panel]')?.innerText || '');
        check(pickedPanel.includes('15일') && !pickedPanel.includes('오늘'), `날짜 칸을 눌러도 패널이 그 날이 아닙니다. ${pickedPanel}`);
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '이 날 일지')?.click());
        await page.waitForFunction((hash) => location.hash === hash, {}, `#/day/${picked}`);
        await page.evaluate(() => history.back());
        await page.waitForFunction((hash) => location.hash === hash, {}, `#/schedule/month/${picked}`);
        const back = await page.evaluate(() => ({
            panel: document.querySelector('[data-cal-panel]')?.getAttribute('data-cal-panel') || '',
            monthOn: [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '달력' && el.classList.contains('on')),
            weekOn: [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '주' && el.classList.contains('on')),
            grid: Boolean(document.querySelector('.cal-grid')),
        }));
        check(back.panel === picked && back.monthOn && !back.weekOn && back.grid, `일지에서 돌아오면 달력 보기가 풀립니다. ${JSON.stringify(back)}`);
        await page.click('[aria-label="이전 달"]');
        await page.waitForFunction((hash) => location.hash === hash, {}, todayHash);
        const returned = await page.evaluate(() => document.querySelector('[data-cal-panel]')?.innerText.includes('오늘') || false);
        check(returned, '오늘이 있는 달로 돌아오면 패널이 오늘이 아닙니다.');
        await page.evaluate(() => { location.hash = '#/schedule/month'; });
        await page.waitForFunction((hash) => location.hash === hash, {}, todayHash);
        const bareMonth = await page.evaluate(() => ({
            monthOn: [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '달력' && el.classList.contains('on')),
            weekOn: [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '주' && el.classList.contains('on')),
            grid: Boolean(document.querySelector('.cal-grid')),
        }));
        check(bareMonth.monthOn && !bareMonth.weekOn && bareMonth.grid, `날짜 없는 달력이 주 보기로 열립니다. ${JSON.stringify(bareMonth)}`);
        await page.evaluate(() => { location.hash = '#/schedule/month/2026-02-30'; });
        await page.waitForFunction((hash) => location.hash === hash && document.body.innerText.includes('달력에 없어요'), {}, todayHash);
        const badMonth = await page.evaluate(() => [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '달력' && el.classList.contains('on')));
        check(badMonth, '잘못된 달력 날짜가 주 보기로 열립니다.');
        await page.evaluate(() => { location.hash = '#/schedule/table'; });
        await page.waitForFunction((hash) => location.hash === hash, {}, `#/schedule/table/${todayYmd}`);
        const bareTable = await page.evaluate(() => ({
            tableOn: [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '시간표' && el.classList.contains('on')),
            weekOn: [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '주' && el.classList.contains('on')),
        }));
        check(bareTable.tableOn && !bareTable.weekOn, `날짜 없는 시간표가 주 보기로 열립니다. ${JSON.stringify(bareTable)}`);
        await page.evaluate(() => { location.hash = '#/schedule/table/2026-13-01'; });
        await page.waitForFunction((hash) => location.hash === hash && document.body.innerText.includes('달력에 없어요'), {}, `#/schedule/table/${todayYmd}`);
        const badTable = await page.evaluate(() => [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '시간표' && el.classList.contains('on')) && ![...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '주' && el.classList.contains('on')));
        check(badTable, '잘못된 시간표 날짜가 주 보기로 열립니다.');
        await audit(page, '달력 패널');
    }
    await withDemo(390, 'light', async (page) => { await calendarPanel(page); }, 844);

    async function darkTodayContrast(width) {
        await withDemo(width, 'dark', async (page) => {
            await page.evaluate(() => { location.hash = '#/schedule'; });
            await page.waitForFunction(() => [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '달력'));
            await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '달력')?.click());
            await page.waitForSelector('.cal-today .num');
            const ratio = await page.evaluate(() => {
                const style = getComputedStyle(document.querySelector('.cal-today .num'));
                const parse = (color) => {
                    const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
                };
                const lum = (rgb) => {
                    const parts = rgb.map((value) => {
                        const channel = value / 255;
                        return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
                    });
                    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2];
                };
                const fg = parse(style.color);
                const bg = parse(style.backgroundColor);
                if (!fg || !bg) return 0;
                const left = lum(fg);
                const right = lum(bg);
                const [hi, lo] = left > right ? [left, right] : [right, left];
                return (hi + 0.05) / (lo + 0.05);
            });
            check(ratio >= 4.5, `${width} 다크 오늘 동그라미 대비 ${Number(ratio).toFixed(2)} 가 4.5보다 낮습니다.`);
        }, width >= 900 ? 800 : 844);
    }
    await darkTodayContrast(390);
    await darkTodayContrast(1280);

    async function saveRoster(page) {
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '명단 저장'), { timeout: 15000 });
        const before = await page.evaluate(() => history.length);
        check(before > 1, `앞선 기록이 없어 명단 저장을 구분하지 못합니다. 기록 ${before}`);
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '명단 저장')?.click());
        try {
            await page.waitForFunction(() => location.hash === '#/settings' && location.hostname === '127.0.0.1', { timeout: 4000 });
        } catch {
            const where = await page.evaluate(() => location.href).catch(() => '');
            check(false, `명단을 저장하면 앱 밖으로 나갑니다. ${where}`);
            return;
        }
        const stayed = await page.evaluate(() => ({
            hash: location.hash,
            host: location.hostname,
            outside: document.body.innerText.includes('다른 사이트'),
        }));
        check(stayed.hash === '#/settings' && stayed.host === '127.0.0.1' && !stayed.outside, `명단을 저장한 뒤 설정에 머물지 않습니다. ${JSON.stringify(stayed)}`);
    }

    async function withRosterEntry(previous, label) {
        const current = await ensureBrowser();
        const context = await current.createBrowserContext();
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        await pinBrowserClock(page);
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-theme', 'light');
        });
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        try {
            await page.goto(`${origin}?demo=1&at=08:42&mode=light#/today`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.goto(previous, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.goto(`${origin}?demo=1&at=08:42&mode=light#/settings/roster`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await saveRoster(page);
        } catch (error) {
            check(false, `${label} 명단 저장 시험이 멈추었습니다. ${error?.message || error}`);
        }
        await context.close().catch(() => {});
    }
    await withRosterEntry('about:blank', '주소로 연');
    await withRosterEntry('data:text/html,<title>outside</title><p>다른 사이트</p>', '다른 사이트에서 연');

    await withDemo(390, 'light', async (page) => {
        await page.evaluate(() => { location.hash = '#/settings'; });
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '명단 고치기'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '명단 고치기')?.click());
        await page.waitForFunction(() => location.hash === '#/settings/roster' && history.state?.rosterFrom === 'settings');
        const marked = await page.evaluate(() => history.state?.rosterFrom === 'settings');
        check(marked, '설정에서 명단으로 들어올 때 표시가 없습니다.');
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '명단 저장')?.click());
        await page.waitForFunction(() => location.hash === '#/settings');
        const shared = await page.evaluate(() => {
            const button = [...document.querySelectorAll('button')].find((el) => el.innerText.includes('공용 컴퓨터 모드'));
            return button?.getAttribute('aria-pressed') || '';
        });
        check(shared === 'false' || shared === 'true', '공용 컴퓨터 버튼에 눌림 상태가 없습니다.');
        await page.evaluate(() => history.back());
        let leftSettings = false;
        try {
            await page.waitForFunction(() => location.hostname === '127.0.0.1' && location.hash !== '#/settings', { timeout: 3000 });
            leftSettings = true;
        } catch {
            leftSettings = false;
        }
        const afterBack = await page.evaluate(() => ({ hash: location.hash, host: location.hostname }));
        check(leftSettings && afterBack.host === '127.0.0.1' && afterBack.hash !== '#/settings', `설정에서 들어온 명단 저장이 설정 기록을 하나 더 남깁니다. ${JSON.stringify(afterBack)}`);
    }, 844);

    /* 오늘 화면 1안: 휴대폰에서는 카드가 한 줄 요약으로 접혀 있고, 누르면 펼치며, 카드마다 기억합니다. */
    foldPreset = false;
    try {
        await withDemo(390, 'light', async (page) => {
            const before = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k !== 'ssug-gyomu-home-fold').map((k) => [k, localStorage.getItem(k)])));
            const shut = await page.evaluate(() => [...document.querySelectorAll('[data-fold]')].map((el) => {
                const head = el.querySelector('.fold-head').getBoundingClientRect();
                const sum = el.querySelector('.fold-sum');
                return { id: el.dataset.fold, open: el.dataset.open, body: el.querySelector('.fold-body').getBoundingClientRect().height, h: head.height, w: head.width,
                    heading: el.querySelector('.fold-head').parentElement.tagName, level: el.querySelector('.fold-head').closest('h3')?.querySelector('.fold-title')?.innerText.trim() || '',
                    sum: sum?.innerText.trim() || '', sumH: sum ? sum.getBoundingClientRect().height : 0, expanded: el.querySelector('.fold-head').getAttribute('aria-expanded') };
            }));
            check(shut.length === 4 && shut.every((c) => c.open === '0' && c.body === 0 && c.expanded === 'false'), `휴대폰 오늘 카드가 기본으로 접혀 있지 않습니다. ${JSON.stringify(shut)}`);
            check(shut.every((c) => c.sum && c.sumH > 0 && c.sumH < 24), `접힌 카드에 한 줄 요약이 없거나 두 줄입니다. ${JSON.stringify(shut)}`);
            check(shut.every((c) => c.heading === 'H3' && c.level), `접는 카드 제목이 h3 안의 버튼이 아닙니다. ${JSON.stringify(shut)}`);
            check(shut.every((c) => !/·\s*$/.test(c.sum)), `접힌 카드 요약 끝에 ' · '가 남았습니다. ${JSON.stringify(shut)}`);
            check(shut.every((c) => c.h >= 44 && c.w >= 44), `접는 카드 머리가 44px보다 작습니다. ${JSON.stringify(shut)}`);
            await controlBoxes(page, '.home-grid button, .home-grid a', '390 접힌 오늘 화면');
            await audit(page, '390 접힌 오늘 화면');
            await page.click('[data-fold="todo"] .fold-head');
            await page.waitForFunction(() => document.querySelector('[data-fold="todo"]').dataset.open === '1');
            const opened = await page.evaluate(() => ({ body: document.querySelector('[data-fold="todo"] .fold-body').getBoundingClientRect().height, line: Boolean(document.querySelector('[data-fold="todo"] [data-home-todo]')), others: [...document.querySelectorAll('[data-fold]')].filter((el) => el.dataset.open === '1').length }));
            check(opened.body > 0 && opened.line && opened.others === 1, `할 일 카드를 눌러도 펼쳐지지 않거나 다른 카드까지 펼쳐집니다. ${JSON.stringify(opened)}`);
            await controlBoxes(page, '.home-grid button, .home-grid a', '390 펼친 오늘 화면');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForSelector('[data-fold="todo"]');
            const kept = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-fold]')].map((el) => [el.dataset.fold, el.dataset.open])));
            check(kept.todo === '1' && kept.time === '0' && kept.event === '0' && kept.recent === '0', `카드 펼침 상태를 기억하지 못합니다. ${JSON.stringify(kept)}`);
            await page.click('[data-fold="todo"] .fold-head');
            await page.waitForFunction(() => document.querySelector('[data-fold="todo"]').dataset.open === '0');
            const after = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).filter((k) => k !== 'ssug-gyomu-home-fold').map((k) => [k, localStorage.getItem(k)])));
            const changed = Object.keys({ ...before, ...after }).filter((k) => before[k] !== after[k] && !/theme|sound|notice/.test(k));
            check(!changed.length, `카드를 접고 펴는데 데이터가 바뀝니다. ${changed.join(', ')}`);
        }, 844);
        await withDemo(1280, 'light', async (page) => {
            const wide = await page.evaluate(() => [...document.querySelectorAll('[data-fold]')].map((el) => ({ head: el.querySelector('.fold-head').getBoundingClientRect().height, body: el.querySelector('.fold-body').getBoundingClientRect().height })));
            check(wide.length === 4 && wide.every((c) => c.head === 0 && c.body > 0), `넓은 화면 오늘 카드가 접혀 보입니다. ${JSON.stringify(wide)}`);
        });
    } finally {
        foldPreset = true;
    }

    async function directBack(width) {
        const current = await ensureBrowser();
        const context = await current.createBrowserContext();
        const page = await context.newPage();
        page.setDefaultTimeout(20000);
        await pinBrowserClock(page);
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-theme', 'light');
        });
        await page.setViewport({ width, height: width >= 900 ? 800 : 844, deviceScaleFactor: 1 });
        const outside = 'data:text/html;charset=utf-8,<title>다른 사이트</title><p>다른 사이트</p>';
        const day = '#/day/2026-10-23';
        const cases = [
            [`${origin}?demo=1&at=08:42&mode=light${day}`, '#/schedule/month/2026-10-23'],
            [`${origin}?demo=1&at=08:42&mode=light#/settings/roster`, '#/settings'],
            [`${origin}?demo=1&at=08:42&mode=light#/students/1`, '#/students'],
            [`${origin}?demo=1&at=08:42&mode=light#/legacy/5`, '#/settings/legacy'],
            [`${origin}?demo=1&at=08:42&mode=light#/settings/legacy`, '#/settings'],
        ];
        try {
            for (const [url, parent] of cases) {
                await page.goto(outside, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await page.waitForSelector('[aria-label="뒤로"]');
                const marked = await page.evaluate(() => Boolean(history.state?.appFrom || history.state?.rosterFrom));
                check(!marked, `${width} 주소로 연 ${url} 에 앱 안 표시가 있습니다.`);
                await page.click('[aria-label="뒤로"]');
                let stayed = false;
                try {
                    await page.waitForFunction((expected) => location.hostname === '127.0.0.1' && location.hash === expected, { timeout: 4000 }, parent);
                    stayed = true;
                } catch {
                    stayed = false;
                }
                const where = await page.evaluate(() => ({ hash: location.hash, host: location.hostname, title: document.title }));
                const leftApp = where.host !== '127.0.0.1' || where.title === '다른 사이트';
                check(stayed && !leftApp && where.hash === parent, leftApp
                    ? `${width}에서 ‹ 가 앱 밖에 나갑니다. ${url} → ${JSON.stringify(where)}`
                    : `${width}에서 ‹ 의 상위 화면이 아닙니다. ${url} → ${JSON.stringify(where)}`);
            }
            await page.goto(`${origin}?demo=1&at=08:42&mode=light#/today`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.evaluate(() => { location.hash = '#/schedule/month/2026-10-23'; });
            await page.waitForFunction(() => location.hash === '#/schedule/month/2026-10-23');
            await page.waitForFunction(() => [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '이 날 일지'));
            await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '이 날 일지')?.click());
            await page.waitForFunction(() => location.hash === '#/day/2026-10-23' && history.state?.appFrom === 'schedule');
            await page.click('[aria-label="뒤로"]');
            await page.waitForFunction(() => location.hash === '#/schedule/month/2026-10-23');
            await page.evaluate(() => history.back());
            let leftMonth = false;
            try {
                await page.waitForFunction(() => location.hostname === '127.0.0.1' && location.hash !== '#/schedule/month/2026-10-23', { timeout: 3000 });
                leftMonth = true;
            } catch {
                leftMonth = false;
            }
            const returned = await page.evaluate(() => ({ hash: location.hash, host: location.hostname }));
            check(leftMonth && returned.host === '127.0.0.1' && returned.hash === '#/today', `${width}에서 앱 안 ‹ 가 달력 기록을 덮습니다. ${JSON.stringify(returned)}`);
        } catch (error) {
            check(false, `${width} ‹ 버튼 시험이 멈추었습니다. ${error?.message || error}`);
        }
        await context.close().catch(() => {});
    }
    await directBack(390);
    await directBack(1280);

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
            const include = [...(node?.querySelectorAll('button') || [])].some((el) => el.innerText.trim() === '나중에 정리');
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
            const include = [...(node?.querySelectorAll('button') || [])].some((el) => el.innerText.trim() === '나중에 정리');
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
        await page.waitForFunction((label) => document.body.innerText.includes('0개 등록') && document.body.innerText.includes(label) && document.body.innerText.includes('지금 저장'), {}, lastFridayLabel);
        const pastWeek = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '나중에 정리'),
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
            const include = [...(node?.querySelectorAll('button') || [])].some((el) => el.innerText.trim() === '나중에 정리');
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
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('지금 저장'));
        const asked = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '나중에 정리'),
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
            const include = [...(node?.querySelectorAll('button') || [])].some((el) => el.innerText.trim() === '나중에 정리');
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
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('지금 저장'));
        const closed = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '나중에 정리'),
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
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('지금 저장'));
        const fell = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '나중에 정리'),
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
        await page.waitForFunction(() => document.body.innerText.includes('0개 등록') && document.body.innerText.includes('지금 저장'));
        const trip = await page.evaluate(() => ({
            low: Boolean(document.querySelector('.low-card')),
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '나중에 정리'),
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
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '나중에 정리'),
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
            chosen: [...document.querySelectorAll('.msg-card button')].some((el) => el.innerText.trim() === '나중에 정리'),
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
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.trim() === '나중에 정리')?.click());
        await page.waitForFunction(() => [...document.querySelectorAll('[data-screen="plus"] button')].some((el) => el.innerText.trim() === '지금 저장'));
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.trim() === '지금 저장')?.click());
        await page.waitForFunction(() => [...document.querySelectorAll('[data-screen="plus"] button')].some((el) => el.innerText.trim() === '나중에 정리'));
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.trim() === '남기기')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('되돌리기'));
        await page.waitForFunction(() => !document.querySelector('[data-screen="plus"]'));
        await page.evaluate(() => { location.hash = '#/students/12'; });
        await page.waitForFunction(() => document.body.innerText.includes('발표를 끝까지 했어요'));
    }, 844);

    await withDemo(390, 'light', async (page) => {
        await openPlus(page);
        await page.type('[data-screen="plus"] textarea', '과학도서 12/31까지');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.trim() === '다음')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('넣을게요') && document.body.innerText.includes('과학도서'));
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.trim() === '나중에 정리')?.click());
        await page.waitForFunction(() => [...document.querySelectorAll('[data-screen="plus"] button')].some((el) => el.innerText.trim() === '지금 저장'));
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.trim() === '남기기')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('정리함에 뒀어요'));
        await page.evaluate(() => { location.hash = '#/todo'; });
        await page.waitForFunction(() => document.body.innerText.includes('정리함') && document.body.innerText.includes('과학도서'));
        const parked = await page.evaluate(() => {
            const inbox = document.querySelector('[aria-label="정리함"]');
            return {
                inbox: inbox?.innerText || '',
                titles: [...document.querySelectorAll('.todo-title')].filter((el) => !inbox?.contains(el)).map((el) => el.innerText),
            };
        });
        check(parked.inbox.includes('과학도서'), '나중에 정리한 콕 항목이 정리함에 없습니다.');
        check(!parked.titles.some((text) => text.includes('과학도서')), '나중에 정리한 콕 항목이 할 일로 등록되었습니다.');
        await page.type('[aria-label="할 일"]', '독서기록 12/31까지');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => [...document.querySelectorAll('.todo-title')].some((el) => el.innerText.includes('독서기록')));
        const typed = await page.evaluate(() => {
            const row = [...document.querySelectorAll('.todo-block')].find((el) => el.innerText.includes('독서기록'));
            return row ? row.innerText.replace(/\s+/g, ' ') : '';
        });
        check(typed.includes('독서기록') && typed.includes('12/31') && !typed.includes('12/31까지'), `할 일 직접 입력에서 12/31까지를 읽지 못했습니다. ${typed}`);
    }, 844);

    /* 충돌 사본(PR #57 r3 검수 3번): 320px에서도 제목이 잘리지 않고, K 토큰 배지로 일반 할 일과 구분됩니다(라이트·다크). */
    for (const mode of ['light', 'dark']) {
        await withDemo(320, mode, async (page) => {
            await page.evaluate(() => { location.hash = '#/todo'; });
            await page.waitForSelector('[aria-label="할 일"]');
            await page.type('[aria-label="할 일"]', '(충돌 사본) 학부모 상담 일정 다시 확인하고 회신 보내기');
            await page.keyboard.press('Enter');
            await page.waitForSelector('[data-conflict-copy="1"]');
            const seen = await page.evaluate(() => {
                const el = document.querySelector('.todo-title[data-conflict-copy="1"]');
                const badge = el?.querySelector('.conflict-badge');
                const text = el?.querySelector('.conflict-text');
                const cs = badge ? getComputedStyle(badge) : null;
                const plain = [...document.querySelectorAll('.todo-title')].find((x) => !x.matches('[data-conflict-copy]'));
                const box = text?.getBoundingClientRect();
                const btn = el?.closest('button')?.getBoundingClientRect();
                return {
                    badge: badge?.innerText || '',
                    text: text?.innerText || '',
                    clipped: text ? text.scrollWidth > text.clientWidth + 1 || getComputedStyle(text).textOverflow === 'ellipsis' : true,
                    inside: box && btn ? box.right <= btn.right + 1 && box.bottom <= btn.bottom + 1 : false,
                    btnH: btn?.height || 0,
                    over: document.documentElement.scrollWidth > window.innerWidth,
                    shadow: cs?.boxShadow || 'none',
                    color: cs?.color || '',
                    plainBadge: Boolean(plain?.querySelector('.conflict-badge')),
                };
            });
            check(seen.badge === '충돌 사본', `${mode} 320: 충돌 사본 배지가 없습니다: ${seen.badge}`);
            check(seen.text.includes('회신 보내기') && !seen.text.includes('(충돌 사본)'), `${mode} 320: 충돌 사본 제목이 다 보이지 않습니다: ${seen.text}`);
            check(!seen.clipped && seen.inside && !seen.over, `${mode} 320: 충돌 사본 제목이 잘리거나 넘칩니다: ${JSON.stringify(seen)}`);
            check(seen.btnH >= 44, `${mode} 320: 충돌 사본 줄 누름 칸이 44px보다 작습니다: ${seen.btnH}`);
            check(seen.shadow !== 'none' && seen.shadow.includes('inset'), `${mode} 320: 배지가 K 뉴모피즘(오목) 토큰을 쓰지 않습니다: ${seen.shadow}`);
            check(!seen.plainBadge, `${mode} 320: 일반 할 일에 충돌 사본 배지가 붙었습니다.`);
            await page.screenshot({ path: resolve(shots, `conflict-copy-320-${mode}.png`) });

            /* 라이브 QA 44d5556 2번: 오늘 화면 요약·하루 화면·상세 시트에서도 머리글 대신 배지가 보이고 잘리지 않습니다. */
            const kst = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()));
            const md = `${Number(kst.slice(5, 7))}/${Number(kst.slice(8, 10))}`;
            await page.type('[aria-label="할 일"]', `(충돌 사본) 오늘 하루 화면 충돌 사본 확인 ${md}`);
            await page.keyboard.press('Enter');
            await new Promise((r) => setTimeout(r, 300));
            const spot = (sel) => page.evaluate((sel) => {
                const el = document.querySelector(sel);
                const badge = el?.querySelector('.conflict-badge');
                const text = el?.querySelector('.conflict-text');
                const r = el?.getBoundingClientRect();
                return {
                    has: Boolean(el), badge: badge?.innerText || '',
                    clipped: text ? text.scrollWidth > text.clientWidth + 1 || getComputedStyle(text).textOverflow === 'ellipsis' : true,
                    offscreen: r ? r.right > window.innerWidth + 1 || r.left < -1 : true,
                    over: document.documentElement.scrollWidth > window.innerWidth,
                    raw: [...document.querySelectorAll('main, [role="dialog"], .sheet, body')].some((n) => n.innerText.includes('(충돌 사본)')),
                };
            }, sel);
            const must = (name, v) => {
                check(v.has && v.badge === '충돌 사본', `${mode} 320 ${name}: 충돌 사본 배지가 없습니다: ${JSON.stringify(v)}`);
                check(!v.clipped && !v.offscreen && !v.over, `${mode} 320 ${name}: 충돌 사본이 잘리거나 넘칩니다: ${JSON.stringify(v)}`);
                check(!v.raw, `${mode} 320 ${name}: '(충돌 사본)' 글자가 그대로 보입니다.`);
            };
            await page.evaluate(() => { location.hash = '#/'; });
            await page.waitForSelector('.home-todo');
            await new Promise((r) => setTimeout(r, 300));
            const folded = await page.evaluate(() => Boolean(document.querySelector('.home-todo .fold-sum')));
            if (folded) must('오늘 요약', await spot('.home-todo .fold-sum [data-conflict-copy="1"]'));
            else {
                await page.evaluate(() => document.querySelector('.home-todo .fold-head')?.click());
                await new Promise((r) => setTimeout(r, 300));
                must('오늘 요약', await spot('.home-todo .fold-sum [data-conflict-copy="1"]'));
                await page.evaluate(() => document.querySelector('.home-todo .fold-head')?.click());
            }
            await page.screenshot({ path: resolve(shots, `conflict-home-320-${mode}.png`) });
            const line = await page.$('.home-line [data-conflict-copy="1"]');
            if (!line) await page.evaluate(() => document.querySelector('.home-todo .fold-head')?.click());
            await page.waitForSelector('.home-line [data-conflict-copy="1"]', { timeout: 5000 });
            await page.evaluate(() => document.querySelector('.home-line [data-conflict-copy="1"]').closest('button').click());
            await page.waitForSelector('.detail-title');
            must('상세 시트', await spot('.detail-title [data-conflict-copy="1"]'));
            await page.screenshot({ path: resolve(shots, `conflict-detail-320-${mode}.png`) });
            await page.keyboard.press('Escape');
            const ymd = kst;
            await page.evaluate((y) => { location.hash = `#/day/${y}`; }, ymd);
            await page.waitForSelector('.day-todo-title[data-conflict-copy="1"]', { timeout: 5000 });
            must('하루 화면', await spot('.day-todo-title[data-conflict-copy="1"]'));
            const dayBtn = await page.evaluate(() => document.querySelector('.day-todo-title[data-conflict-copy="1"]').closest('button').getBoundingClientRect().height);
            check(dayBtn >= 44, `${mode} 320 하루 화면: 충돌 사본 칸이 44px보다 작습니다: ${dayBtn}`);
            await page.screenshot({ path: resolve(shots, `conflict-day-320-${mode}.png`) });
        });
    }

    /* PR #59 검수 1번: 뒤로 버튼이 있는 화면에서 상단 바 제목이 한 글자씩 세로로 눌리지 않습니다(5가지 폭 × 라이트·다크). */
    for (const width of [320, 360, 390, 900, 1920]) {
        for (const mode of ['light', 'dark']) {
            await withDemo(width, mode, async (page) => {
                const ymd = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()));
                for (const [name, hash, want] of [['하루', `#/day/${ymd}`, '그날의 일지'], ['예전 수첩', '#/settings/legacy', '예전 수첩']]) {
                    await page.evaluate((h) => { location.hash = h; }, hash);
                    await page.waitForFunction((w) => document.querySelector('.topbar h1')?.innerText.includes(w), { timeout: 8000 }, want);
                    await new Promise((r) => setTimeout(r, 150));
                    const bar = await page.evaluate(() => {
                        const h1 = document.querySelector('.topbar h1');
                        const sub = document.querySelector('.topbar .date-block p');
                        const r = h1.getBoundingClientRect();
                        const lh = parseFloat(getComputedStyle(h1).lineHeight) || 28;
                        const btns = [...document.querySelectorAll('.topbar button')].filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect());
                        const hit = (a, b) => a.right > b.left + 1 && a.left < b.right - 1 && a.bottom > b.top + 1 && a.top < b.bottom - 1;
                        return {
                            w: Math.round(r.width), lines: Math.round(r.height / lh),
                            subLines: sub ? Math.round(sub.getBoundingClientRect().height / (parseFloat(getComputedStyle(sub).lineHeight) || 18)) : 0,
                            small: btns.filter((b) => b.width < 43.5 || b.height < 43.5).length,
                            overlap: btns.some((b) => hit(b, r) || (sub && hit(b, sub.getBoundingClientRect()))),
                            over: document.documentElement.scrollWidth > window.innerWidth,
                        };
                    });
                    check(bar.lines <= 1 && bar.w >= 100, `${mode} ${width} ${name}: 상단 바 제목이 눌렸습니다: ${JSON.stringify(bar)}`);
                    check(bar.subLines <= 2, `${mode} ${width} ${name}: 상단 바 부제목이 눌렸습니다: ${JSON.stringify(bar)}`);
                    check(!bar.overlap && !bar.over && !bar.small, `${mode} ${width} ${name}: 상단 바 버튼이 겹치거나 작습니다: ${JSON.stringify(bar)}`);
                    if (width <= 390) await page.screenshot({ path: resolve(shots, `topbar-${name === '하루' ? 'day' : 'legacy'}-${width}-${mode}.png`) });
                }
            });
        }
    }

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

    async function keyPickFit(page) {
        return page.evaluate(() => {
            const problems = [];
            const groups = [...document.querySelectorAll('.key-picks')];
            if (groups.length < 2) problems.push('소리 칩 묶음이 없습니다.');
            const tab = document.querySelector('.tabbar')?.getBoundingClientRect();
            const sideEl = document.querySelector('.side');
            const side = sideEl && getComputedStyle(sideEl).display !== 'none' ? sideEl.getBoundingClientRect() : null;
            for (const group of groups) {
                const buttons = [...group.querySelectorAll('button')];
                const rects = buttons.map((el) => el.getBoundingClientRect());
                buttons.forEach((el, index) => {
                    const rect = rects[index];
                    const name = el.getAttribute('aria-label') || el.innerText.trim();
                    if (rect.width < 43.5 || rect.height < 43.5) problems.push(`작음 ${name} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
                    if (rect.left < -1 || rect.right > window.innerWidth + 1) problems.push(`가로 ${name}`);
                    if (tab && rect.bottom > tab.top + 1 && rect.top < tab.bottom - 1 && rect.right > tab.left + 1 && rect.left < tab.right - 1) {
                        problems.push(`탭과 겹침 ${name}`);
                    }
                    if (side && rect.width > 0 && rect.right > side.left + 1 && rect.left < side.right - 1 && rect.bottom > side.top + 1 && rect.top < side.bottom - 1) {
                        problems.push(`메뉴와 겹침 ${name}`);
                    }
                });
                for (let i = 0; i < rects.length; i += 1) {
                    for (let j = i + 1; j < rects.length; j += 1) {
                        const a = rects[i];
                        const b = rects[j];
                        const hit = a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
                        if (hit) problems.push(`겹침 ${buttons[i].innerText.trim()}/${buttons[j].innerText.trim()}`);
                    }
                }
            }
            return {
                problems,
                selects: document.querySelectorAll('[data-screen="settings"] select').length,
            };
        });
    }

    const soundShotDir = process.env.SCREENSHOT_DIR || '/tmp';
    mkdirSync(soundShotDir, { recursive: true });
    for (const width of [360, 390, 1920]) {
        await withDemo(width, 'light', async (page) => {
            /* 폰에서는 맨 위 퇴근 줄(44px) 아래 끝부터가 내용 자리예요. 줄 아래로 844px 높이를 그대로 두고 잽니다. */
            await page.setViewport({ width, height: width === 1920 ? 1080 : 844 + 44, deviceScaleFactor: 1 });
            await page.evaluate(() => localStorage.setItem('ssug-gyomu-key-sound-notice', '1'));
            await page.evaluate(() => { location.hash = '#/settings'; });
            await page.waitForSelector('[aria-label="누를 때 소리 종류"]');
            await page.waitForFunction(() => {
                const el = document.querySelector('[aria-label="누를 때 소리 종류"]');
                el?.closest('section')?.scrollIntoView({ block: 'start' });
                const top = el?.getBoundingClientRect().top ?? -1;
                return top > 80 && top < 420;
            });
            const fit = await keyPickFit(page);
            check(fit.selects === 0, `${width} 소리 고르기에 드롭다운이 있습니다.`);
            check(fit.problems.length === 0, `${width} 소리 칩: ${fit.problems.join(', ')}`);
            if (width !== 390) return;
            const initial = await page.evaluate(() => ({
                voice: localStorage.getItem('ssug-gyomu-key-voice'),
                volume: localStorage.getItem('ssug-gyomu-key-volume'),
                soft: document.querySelector('[aria-label="몽글 말랑"]')?.getAttribute('aria-pressed'),
                small: document.querySelector('[aria-label="작게"]')?.getAttribute('aria-pressed'),
                on: [...document.querySelectorAll('button')].some((el) => el.innerText.includes('누를 때 소리 켜짐')),
            }));
            check(initial.voice === null && initial.volume === null && initial.soft === 'true' && initial.small === 'true' && initial.on, '소리 기본값이 몽글·작게가 아닙니다.');
            await page.screenshot({ path: resolve(soundShotDir, 'settings-sound-390.png') });
            await page.click('[aria-label="청축 클릭"]');
            await page.click('[aria-label="크게"]');
            await page.waitForFunction(() => localStorage.getItem('ssug-gyomu-key-voice') === 'click' && localStorage.getItem('ssug-gyomu-key-volume') === 'loud');
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.body.innerText.includes('소리 종류') || document.body.innerText.includes('오늘 우리 반'));
            await page.evaluate(() => { location.hash = '#/settings'; });
            await page.waitForSelector('[aria-label="청축 클릭"]');
            const kept = await page.evaluate(() => ({
                click: document.querySelector('[aria-label="청축 클릭"]')?.getAttribute('aria-pressed'),
                loud: document.querySelector('[aria-label="크게"]')?.getAttribute('aria-pressed'),
                soft: document.querySelector('[aria-label="몽글 말랑"]')?.getAttribute('aria-pressed'),
            }));
            check(kept.click === 'true' && kept.loud === 'true' && kept.soft === 'false', '고른 소리가 다시 열어도 남지 않습니다.');
            /* 글자 소리는 숨겨 둡니다. 켜 둔 기기에서도 칸이 없고 글을 적어도 소리가 없으며, 저장값은 그대로입니다. */
            await page.evaluate(() => {
                localStorage.setItem('ssug-gyomu-type-sound', '1');
                localStorage.setItem('ssug-gyomu-type-voice', 'bang');
            });
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.body.innerText.includes('소리 종류') || document.body.innerText.includes('오늘 우리 반'));
            await page.evaluate(() => { location.hash = '#/settings'; });
            await page.waitForSelector('[aria-label="누를 때 장난 소리"]');
            const hidden = await page.evaluate(() => {
                window.__soundStarts = 0;
                const start = AudioBufferSourceNode.prototype.start;
                AudioBufferSourceNode.prototype.start = function countStart(...args) {
                    window.__soundStarts += 1;
                    return start.apply(this, args);
                };
                const text = document.querySelector('[data-screen="settings"]')?.innerText || document.body.innerText;
                return {
                    picks: document.querySelectorAll('.type-picks').length,
                    words: [
                        ...[...document.querySelectorAll('p, button, span')].filter((el) => el.innerText.trim() === '글자를 적을 때').map(() => '글자를 적을 때'),
                        ...['글자 소리 켜짐', '글자 소리 꺼짐', '적을 때 소리'].filter((word) => text.includes(word)),
                    ],
                    pressBang: document.querySelector('[aria-label="누를 때 장난 소리"] [aria-label="방귀 뿌우"]')?.getAttribute('aria-pressed'),
                };
            });
            check(hidden.picks === 0 && hidden.words.length === 0, `숨긴 글자 소리가 설정에 보입니다. ${JSON.stringify(hidden)}`);
            check(hidden.pressBang === 'false', '누를 때 장난 소리에 방귀가 없거나 이미 골라져 있습니다.');
            check(await page.evaluate(() => !document.querySelector('[data-type-moved]')), '이미 고른 누를 때 소리가 있는데 옮김 안내가 나옵니다.');
            await page.focus('[aria-label="학급 이름"]');
            await page.keyboard.type('ab c', { delay: 30 });
            await page.keyboard.press('Backspace');
            await page.keyboard.press('Enter');
            await delay(120);
            const typed = await page.evaluate(() => ({
                starts: window.__soundStarts,
                sound: localStorage.getItem('ssug-gyomu-type-sound'),
                voice: localStorage.getItem('ssug-gyomu-type-voice'),
                key: localStorage.getItem('ssug-gyomu-key-voice'),
            }));
            check(typed.starts === 0, `글자를 적을 때 소리가 납니다. ${typed.starts}번`);
            check(typed.sound === '1' && typed.voice === 'bang' && typed.key === 'click', `글자 소리 저장값이 바뀌었습니다. ${JSON.stringify(typed)}`);
            await page.$eval('[aria-label="뽁 통통"]', (el) => el.scrollIntoView({ block: 'center' }));
            await page.click('[aria-label="뽁 통통"]');
            await page.waitForFunction(() => localStorage.getItem('ssug-gyomu-key-voice') === 'ppok');
            const picked = await page.evaluate(() => ({
                ppok: document.querySelector('[aria-label="누를 때 소리 종류"] [aria-label="뽁 통통"]')?.getAttribute('aria-pressed'),
                click: document.querySelector('[aria-label="청축 클릭"]')?.getAttribute('aria-pressed'),
                starts: window.__soundStarts,
                voice: localStorage.getItem('ssug-gyomu-type-voice'),
            }));
            check(picked.ppok === 'true' && picked.click === 'false' && picked.starts >= 1 && picked.voice === 'bang', `누를 때 소리로 뽁을 고를 수 없습니다. ${JSON.stringify(picked)}`);
        }, width === 1920 ? 1080 : 844);
    }

    await withDemo(390, 'light', async (page) => {
        const initial = await page.evaluate(() => localStorage.getItem('ssug-gyomu-key-sound'));
        check(initial === null, '콕 소리 기본값이 켜져 있지 않습니다.');
        const notice = await page.evaluate(() => {
            const tip = document.querySelector('.tip-bubble');
            return {
                text: tip?.innerText || '',
                off: [...(tip?.querySelectorAll('button') || [])].some((el) => el.innerText.trim() === '끄기'),
                toast: [...document.querySelectorAll('.toast')].some((el) => el.innerText.includes('소리가 나요')),
            };
        });
        check(notice.text.includes('누를 때 소리가 나요') && !notice.text.includes('콕') && notice.off && !notice.toast, '처음 소리 안내가 팁에 없습니다.');
        await page.click('[aria-label="쨈 빠른 입력 열기"]');
        await delay(80);
        const during = await page.evaluate(() => ({
            toast: [...document.querySelectorAll('.toast')].some((el) => el.innerText.includes('소리가 나요')),
            seen: localStorage.getItem('ssug-gyomu-key-sound-notice'),
        }));
        check(!during.toast && during.seen !== '1', '소리 안내가 토스트로 뜨거나 한 번보다 많이 나옵니다.');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => (document.querySelector('.tip-bubble')?.innerText || '').includes('누를 때 소리가 나요'));
        await page.evaluate(() => [...document.querySelectorAll('.tip-bubble button')].find((el) => el.innerText.trim() === '끄기')?.click());
        const saved = await page.evaluate(() => ({
            sound: localStorage.getItem('ssug-gyomu-key-sound'),
            seen: localStorage.getItem('ssug-gyomu-key-sound-notice'),
            toast: [...document.querySelectorAll('.toast')].some((el) => el.innerText.includes('소리가 나요')),
        }));
        check(saved.sound === '0' && saved.seen === '1' && !saved.toast, '소리 끄기가 저장되지 않았습니다.');
    });

    /** QA 2차 N2: 옮겨 온 소리 '작게'의 실제 재생 크기(OfflineAudioContext로 그린 피크·RMS)가 글자 소리와 ±5% 안인지 봅니다. */
    const probeCode = await pressProbeCode();
    await withDemo(390, 'light', async (page) => {
        await page.addScriptTag({ content: probeCode });
        const levels = await page.evaluate(async () => {
            const { keyfeel, typesound } = window.PressProbe;
            const rate = 48000;
            const frames = Math.round(rate * 0.4);
            const seeded = (seed) => {
                let x = (seed * 2654435761) >>> 0 || 1;
                return () => {
                    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
                    return x / 4294967296;
                };
            };
            const measure = async (draw, seed) => {
                keyfeel.resetKeyGraphForTest();
                typesound.resetTypeGraphForTest();
                const ctx = new OfflineAudioContext(1, frames, rate);
                const nativeRandom = Math.random;
                Math.random = seeded(seed);
                try {
                    draw(ctx);
                } finally {
                    Math.random = nativeRandom;
                }
                const data = (await ctx.startRendering()).getChannelData(0);
                let peak = 0;
                let sum = 0;
                for (let i = 0; i < data.length; i += 1) {
                    peak = Math.max(peak, Math.abs(data[i]));
                    sum += data[i] * data[i];
                }
                return { peak, rms: Math.sqrt(sum / data.length) };
            };
            const rows = [];
            for (const voice of typesound.TYPE_VOICES.map((item) => item.id)) {
                let keyPeak = 0;
                let keyRms = 0;
                let typePeak = 0;
                let typeRms = 0;
                let seedWorst = 1;
                for (let seed = 1; seed <= 24; seed += 1) {
                    const key = await measure((ctx) => keyfeel.scheduleKeyPress(ctx, { voice, volume: 'small', when: 0.01 }), seed);
                    const type = await measure((ctx) => typesound.scheduleTypeBurst(ctx, { voice, kind: 'tap', count: 1, when: 0.01 }), seed);
                    keyPeak += key.peak;
                    keyRms += key.rms;
                    typePeak += type.peak;
                    typeRms += type.rms;
                    if (['ppok', 'ting', 'drop', 'bang'].includes(voice)) {
                        seedWorst = Math.max(seedWorst, key.peak / type.peak, type.peak / key.peak, key.rms / type.rms, type.rms / key.rms);
                    }
                }
                rows.push({ voice, peak: keyPeak / typePeak, rms: keyRms / typeRms, typePeak: typePeak / 24, seedWorst });
            }
            return rows;
        });
        const line = levels.map((row) => `${row.voice} 피크×${row.peak.toFixed(3)} RMS×${row.rms.toFixed(3)}`).join(' / ');
        console.log(`옮겨 온 소리 작게 실제 재생 크기(글자 소리 대비, 48kHz 24회 평균): ${line}`);
        check(levels.length >= 13 && levels.every((row) => row.typePeak > 0.001), `실제 재생 크기를 잴 수 없습니다. ${JSON.stringify(levels)}`);
        const off = levels.filter((row) => Math.abs(row.peak - 1) > 0.05 || Math.abs(row.rms - 1) > 0.05);
        check(off.length === 0, `옮겨 온 소리 작게가 글자 소리와 ±5%를 넘습니다. ${off.map((row) => `${row.voice} 피크×${row.peak.toFixed(3)} RMS×${row.rms.toFixed(3)}`).join(', ')}`);
        const seedOff = levels.filter((row) => row.seedWorst > 1.05);
        check(seedOff.length === 0, `예전 네 소리가 같은 흔들림에서 글자 소리와 다르게 납니다. ${seedOff.map((row) => `${row.voice} ×${row.seedWorst.toFixed(3)}`).join(', ')}`);
    });

    /** QA 2차: 누름 규칙을 실제 브라우저 이벤트로 봅니다. 꺼진 fieldset·aria-disabled 묶음·data-sensitive 묶음은 조용하고, 첫 legend 안과 label.chip은 소리가 납니다. */
    await withDemo(390, 'light', async (page) => {
        await page.evaluate(() => localStorage.setItem('ssug-gyomu-key-sound-notice', '1'));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.body.innerText.includes('오늘 우리 반') || document.body.innerText.includes('오늘은 수업이 없어요'));
        await page.evaluate(() => {
            window.__soundStarts = 0;
            const start = AudioBufferSourceNode.prototype.start;
            AudioBufferSourceNode.prototype.start = function countStart(...args) {
                window.__soundStarts += 1;
                return start.apply(this, args);
            };
            const stage = document.createElement('div');
            stage.id = 'press-stage';
            stage.style.cssText = 'position:fixed;inset:0;z-index:2147483000;background:#fff;display:flex;flex-wrap:wrap;gap:6px;padding:6px;align-content:flex-start';
            stage.innerHTML = `
                <button type="button" data-case="plain">버튼</button>
                <label class="chip" data-case="chip">칩 라벨</label>
                <fieldset disabled style="margin:0;padding:4px">
                    <legend><button type="button" data-case="legend">첫 legend 버튼</button></legend>
                    <div role="button" data-case="setRole">꺼진 묶음 role=button</div>
                    <button type="button" data-case="setButton">꺼진 묶음 버튼</button>
                </fieldset>
                <div aria-disabled="true"><button type="button" data-case="ariaGroup">aria-disabled 묶음 버튼</button></div>
                <div role="button" aria-disabled="true" data-case="ariaSelf">aria-disabled 단추</div>
                <div data-sensitive="1"><button type="button" data-case="sensitiveButton">민감 묶음 버튼</button><a href="#/" data-case="sensitiveLink">민감 묶음 링크</a></div>`;
            for (const el of stage.querySelectorAll('[data-case]')) el.style.cssText = 'min-width:120px;min-height:44px;display:inline-flex;align-items:center;padding:0 8px;border:1px solid #888';
            document.body.appendChild(stage);
        });
        const expectSound = { plain: true, chip: true, legend: true, setRole: false, setButton: false, ariaGroup: false, ariaSelf: false, sensitiveButton: false, sensitiveLink: false };
        const heard = {};
        for (const name of Object.keys(expectSound)) {
            const before = await page.evaluate(() => window.__soundStarts);
            const box = await page.$eval(`[data-case="${name}"]`, (el) => {
                const rect = el.getBoundingClientRect();
                return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            });
            await page.mouse.move(box.x, box.y);
            await page.mouse.down();
            await delay(30);
            await page.mouse.up();
            await delay(120);
            heard[name] = (await page.evaluate(() => window.__soundStarts)) - before;
        }
        const wrong = Object.entries(expectSound).filter(([name, on]) => (heard[name] > 0) !== on);
        check(wrong.length === 0, `누름 소리 규칙이 브라우저에서 어긋납니다. ${wrong.map(([name, on]) => `${name}: ${on ? '나야 함' : '조용해야 함'} ${heard[name]}번`).join(', ')}`);
        console.log(`누름 장면 소리 횟수: ${Object.entries(heard).map(([name, count]) => `${name} ${count}`).join(' / ')}`);
    });

    /** QA 2차 N1: 글자 소리를 실제로 옮긴 기기에만 옮김 안내가 나오고, 닫으면 다시 나오지 않습니다. 누를 때 소리를 끈 기기에는 소리가 난다고 하지 않습니다. */
    const openSoundSettings = async (page, seed) => {
        await page.evaluate((items) => {
            localStorage.clear();
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            for (const [key, value] of Object.entries(items)) localStorage.setItem(key, value);
            location.hash = '#/settings';
        }, seed);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[aria-label="누를 때 소리 종류"]');
        await page.evaluate(() => document.querySelector('[aria-label="누를 때 소리 종류"]')?.closest('section')?.scrollIntoView({ block: 'start' }));
        await delay(150);
        return page.evaluate(() => {
            const note = document.querySelector('[data-type-moved]');
            const close = note?.querySelector('[aria-label="옮긴 소리 안내 닫기"]')?.getBoundingClientRect();
            const text = note?.querySelector('p')?.getBoundingClientRect();
            return {
                shown: Boolean(note),
                id: note?.getAttribute('data-type-moved') || '',
                text: note?.innerText || '',
                closeSize: close ? [Math.round(close.width), Math.round(close.height)] : null,
                overflow: Boolean(note && note.scrollWidth > note.clientWidth + 1),
                overlap: Boolean(close && text && close.left < text.right - 1 && close.right > text.left + 1 && close.top < text.bottom - 1 && close.bottom > text.top + 1),
                moved: localStorage.getItem('ssug-gyomu-key-voice-moved'),
                voice: localStorage.getItem('ssug-gyomu-key-voice'),
            };
        });
    };
    const soundSection = async (page) => page.$('[aria-label="누를 때 소리 종류"]').then((el) => el.evaluateHandle((node) => node.closest('section')));
    for (const mode of ['light', 'dark']) {
        for (const width of [390, 1280]) {
            await withDemo(width, mode, async (page) => {
                const opened = await openSoundSettings(page, { 'ssug-gyomu-type-sound': '1', 'ssug-gyomu-type-voice': 'red' });
                check(opened.shown && opened.id === 'red' && opened.voice === 'red' && opened.moved === 'red', `${width} ${mode} 글자 소리를 옮긴 기기에 옮김 안내가 없습니다. ${JSON.stringify(opened)}`);
                check(opened.text.includes('‘적축·매끈’') && opened.text.includes('이제 버튼이나 탭을 누르면 이 소리가 나요') && !opened.text.includes('꺼져'), `${width} ${mode} 옮김 안내 말이 켜짐에 맞지 않습니다. ${opened.text}`);
                check(opened.closeSize && opened.closeSize[0] >= 44 && opened.closeSize[1] >= 44 && !opened.overflow && !opened.overlap, `${width} ${mode} 옮김 안내 닫기 단추가 작거나 겹칩니다. ${JSON.stringify(opened)}`);
                /* 닫기 단추를 맨 위로 끌어올려도 폰 맨 위 퇴근 줄 밑에 숨지 않고, 그 자리를 누르면 단추가 눌려야 합니다. */
                const lifted = await page.evaluate(async () => {
                    const close = document.querySelector('[aria-label="옮긴 소리 안내 닫기"]');
                    close.scrollIntoView({ block: 'start' });
                    await new Promise((r) => setTimeout(r, 120));
                    const r = close.getBoundingClientRect();
                    const bar = document.querySelector('.fuse-bar')?.getBoundingClientRect().bottom ?? 0;
                    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(6, r.height / 2));
                    const out = { top: Math.round(r.top), bar: Math.round(bar), own: Boolean(hit && close.contains(hit)) };
                    document.querySelector('[aria-label="누를 때 소리 종류"]')?.closest('section')?.scrollIntoView({ block: 'start' });
                    await new Promise((r2) => setTimeout(r2, 120));
                    return out;
                });
                check(lifted.top >= lifted.bar - 0.5 && lifted.own, `${width} ${mode} 맨 위로 끌어올린 닫기 단추가 맨 위 줄 밑에 숨습니다: ${JSON.stringify(lifted)}`);
                await (await soundSection(page)).screenshot({ path: resolve(soundShotDir, `settings-moved-${width}-${mode}.png`) });
                await page.click('[aria-label="옮긴 소리 안내 닫기"]');
                await page.waitForFunction(() => !document.querySelector('[data-type-moved]'));
                const closedKey = await page.evaluate(() => localStorage.getItem('ssug-gyomu-key-voice-moved'));
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.evaluate(() => { location.hash = '#/settings'; });
                await page.waitForSelector('[aria-label="누를 때 소리 종류"]');
                await page.evaluate(() => document.querySelector('[aria-label="누를 때 소리 종류"]')?.closest('section')?.scrollIntoView({ block: 'start' }));
                await delay(150);
                const after = await page.evaluate(() => ({
                    shown: Boolean(document.querySelector('[data-type-moved]')),
                    voice: localStorage.getItem('ssug-gyomu-key-voice'),
                    red: document.querySelector('[aria-label="적축 매끈"]')?.getAttribute('aria-pressed'),
                }));
                check(closedKey === 'closed' && !after.shown && after.voice === 'red' && after.red === 'true', `${width} ${mode} 닫은 옮김 안내가 다시 나오거나 고른 소리가 바뀝니다. ${closedKey} ${JSON.stringify(after)}`);
                await (await soundSection(page)).screenshot({ path: resolve(soundShotDir, `settings-moved-closed-${width}-${mode}.png`) });
            }, 844);
        }
    }
    /** 맨 아래까지 내리면 크기 칩과 각 화면 마지막 내용이 하단 탭(가운데 단추 포함) 위로 12px 이상 올라와야 합니다.
     *  홈 표시줄이 없는 기기(0)와 있는 기기(34px)를 모두 봅니다. 본문 아래 여백은 탭 높이 + 16px 이상입니다. */
    const bottomFit = async (page, inset) => {
        const cdp = await page.createCDPSession();
        await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: { top: 0, left: 0, right: 0, bottom: inset } });
        await delay(150);
        return page.evaluate(async () => {
            const s = document.scrollingElement; s.scrollTop = s.scrollHeight;
            await new Promise((r) => setTimeout(r, 200));
            const tab = document.querySelector('.tabbar').getBoundingClientRect();
            const fab = document.querySelector('.tabbar .fab')?.getBoundingClientRect();
            const cover = Math.min(tab.top, fab ? fab.top : tab.top);
            const main = document.querySelector('.main');
            let low = -Infinity;
            for (const el of main.querySelectorAll('*')) {
                const r = el.getBoundingClientRect();
                if (!r.width || !r.height || getComputedStyle(el).position === 'fixed' || el.closest('.tabbar,.sheet,[role=dialog]')) continue;
                low = Math.max(low, r.bottom);
            }
            const sizes = document.querySelector('[aria-label="누를 때 소리 크기"]')?.getBoundingClientRect();
            return {
                tabTop: Math.round(tab.top), cover: Math.round(cover), low: Math.round(low), sizes: sizes ? Math.round(sizes.bottom) : null,
                pad: parseFloat(getComputedStyle(main).paddingBottom), tabH: Math.round(tab.height),
                note: Boolean(document.querySelector('[data-type-moved]')),
            };
        });
    };
    for (const width of [360, 390]) {
        for (const state of ['note', 'closed']) {
            await withDemo(width, 'light', async (page) => {
                await openSoundSettings(page, { 'ssug-gyomu-type-sound': '1', 'ssug-gyomu-type-voice': 'red' });
                if (state === 'closed') {
                    await page.click('[aria-label="옮긴 소리 안내 닫기"]');
                    await page.waitForFunction(() => !document.querySelector('[data-type-moved]'));
                }
                const pads = {};
                for (const inset of [0, 34]) {
                    const fit = await bottomFit(page, inset);
                    pads[inset] = fit.pad;
                    const at = `${width} ${state} 홈 표시줄 ${inset}px`;
                    check(fit.note === (state === 'note'), `${at} 옮김 안내 상태가 다릅니다.`);
                    check(fit.sizes !== null && fit.cover - fit.sizes >= 12, `${at} 맨 아래에서 크기 칩이 탭에 가립니다. 칩 ${fit.sizes} / 탭 ${fit.tabTop} / 가운데 단추 ${fit.cover}`);
                    check(fit.cover - fit.low >= 12, `${at} 설정 마지막 내용이 탭에 가립니다. ${fit.low} / ${fit.cover}`);
                    check(fit.pad >= fit.tabH + 16, `${at} 본문 아래 여백 ${fit.pad}px가 탭 ${fit.tabH}px + 16px보다 작습니다.`);
                    if (inset === 34) await page.screenshot({ path: resolve(soundShotDir, `settings-bottom-${width}-${state}.png`) });
                    console.log(`설정 맨 아래 ${at}: 크기 칩과 탭 사이 ${fit.tabTop - fit.sizes}px, 마지막 내용과 가운데 단추 사이 ${fit.cover - fit.low}px`);
                }
                check(pads[34] - pads[0] >= 33, `${width} ${state} 홈 표시줄만큼 본문 아래 여백이 늘지 않습니다. ${pads[0]} → ${pads[34]}`);
            }, 844);
        }
    }
    for (const [label, hash] of [['홈', '#/today'], ['할 일', '#/todo'], ['시간표', '#/schedule']]) {
        await withDemo(360, 'light', async (page) => {
            await page.evaluate((h) => { location.hash = h; }, hash);
            await delay(400);
            for (const inset of [0, 34]) {
                const fit = await bottomFit(page, inset);
                check(fit.cover - fit.low >= 12, `360 ${label} 홈 표시줄 ${inset}px 맨 아래 내용이 탭에 가립니다. ${fit.low} / ${fit.cover}`);
                check(fit.pad >= fit.tabH + 16, `360 ${label} 홈 표시줄 ${inset}px 본문 아래 여백 ${fit.pad}px가 탭 ${fit.tabH}px + 16px보다 작습니다.`);
                if (inset === 34) await page.screenshot({ path: resolve(soundShotDir, `${hash.slice(2)}-bottom-360.png`) });
                console.log(`${label} 맨 아래 360 홈 표시줄 ${inset}px: 마지막 내용과 가운데 단추 사이 ${fit.cover - fit.low}px`);
            }
        }, 844);
    }
    await withDemo(390, 'light', async (page) => {
        const caseH = await openSoundSettings(page, { 'ssug-gyomu-type-sound': '1' });
        check(caseH.shown && caseH.id === 'ppok' && caseH.voice === 'ppok' && caseH.text.includes('‘뽁’'), `H: 글자 소리만 켠 기기가 main 기본 뽁으로 옮겨 안내되지 않습니다. ${JSON.stringify(caseH)}`);
        const caseK = await openSoundSettings(page, { 'ssug-gyomu-type-sound': '1', 'ssug-gyomu-type-voice': 'bang', 'ssug-gyomu-key-voice': 'linear' });
        check(!caseK.shown && caseK.voice === 'linear' && caseK.moved === null, `K: 이미 고른 소리가 있는데 옮기거나 안내합니다. ${JSON.stringify(caseK)}`);
        const caseL = await openSoundSettings(page, { 'ssug-gyomu-type-sound': '1', 'ssug-gyomu-type-voice': 'blue', 'ssug-gyomu-key-sound': '0' });
        check(caseL.shown && caseL.text.includes('‘청축·딸깍’') && caseL.text.includes('꺼져 있어요') && !caseL.text.includes('누르면 이 소리가 나요'), `L: 누를 때 소리를 끈 기기에 소리가 난다고 안내합니다. ${JSON.stringify(caseL)}`);
        await (await soundSection(page)).screenshot({ path: resolve(soundShotDir, 'settings-moved-off-390-light.png') });
        const plain = await openSoundSettings(page, {});
        check(!plain.shown && plain.moved === null, `글자 소리를 쓴 적 없는 기기에 옮김 안내가 나옵니다. ${JSON.stringify(plain)}`);
    }, 844);

    for (const mode of ['light', 'dark']) {
        for (const width of [360, 390, 1920]) {
            await withDemo(width, mode, async (page) => {
                await page.evaluate(() => document.fonts?.ready);
                const layout = await page.evaluate(() => {
                    const hits = (a, b) => Boolean(
                        a && b && a.width > 0 && b.width > 0
                        && a.left < b.right - 0.5 && a.right > b.left + 0.5
                        && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5,
                    );
                    const tip = document.querySelector('.tip-bubble');
                    const tipBox = tip?.getBoundingClientRect();
                    const visible = Boolean(tipBox && tipBox.width > 0 && tipBox.height > 0);
                    const quick = document.querySelector('.home-quick')?.getBoundingClientRect();
                    const closeBtn = tip?.querySelector('[aria-label="팁 닫기"]')?.getBoundingClientRect();
                    const offBtn = [...(tip?.querySelectorAll('button') || [])].find((el) => el.innerText.trim() === '끄기')?.getBoundingClientRect();
                    const cells = [...document.querySelectorAll('.period-row button')].map((el) => el.getBoundingClientRect());
                    const sixth = cells[5];
                    const rest = document.querySelector('.rest-banner')?.getBoundingClientRect();
                    const timetable = sixth || rest;
                    const tab = document.querySelector('.tabbar')?.getBoundingClientRect();
                    const hero = document.querySelector('.hero-action')?.getBoundingClientRect();
                    const kicker = document.querySelector('.hero-kicker')?.getBoundingClientRect();
                    const banner = [...document.querySelectorAll('p')].find((el) => el.textContent.includes('아직 클라우드'))?.getBoundingClientRect();
                    const date = document.querySelector('.date-block')?.getBoundingClientRect();
                    const fab = document.querySelector('.desk-fab')?.getBoundingClientRect();
                    const toast = [...document.querySelectorAll('.toast')].some((el) => el.innerText.includes('소리가 나요'));
                    const viewBottom = window.innerHeight;
                    /* 데모에도 퇴근 타이머가 있습니다. 평일 홈에서도 6교시는 늘 첫 화면에 보여야 하고, 타이머도 첫 화면에 보이며 팁에 가리지 않아야 합니다. */
                    /* 640px 이하에서 타이머는 맨 위 줄(.fuse-face)이 대신합니다. 키캡 카드가 숨으면 맨 위 줄을 타이머로 봅니다. */
                    const leaveCard = document.querySelector('.home-leave');
                    const leave = (leaveCard?.getClientRects().length ? leaveCard : document.querySelector('.fuse-face') || leaveCard)?.getBoundingClientRect();
                    return {
                        visible,
                        hasLeave: Boolean(leave),
                        coversLeave: hits(tipBox, leave),
                        leaveOnScreen: Boolean(leave && leave.top < (tab && tab.height > 0 ? tab.top : viewBottom) && leave.bottom > 0),
                        /* 지금 교시(⏰ N교시까지 …)는 타이머가 있어도 첫 화면에 다 보여야 하고, 탭·타이머에 가리면 안 됩니다. */
                        nowShown: Boolean(kicker && kicker.top >= 0 && kicker.bottom <= viewBottom && !hits(kicker, tab) && !hits(kicker, leave)),
                        cellUnderTab: cells.some((cell) => hits(cell, tab)),
                        text: tip?.innerText || '',
                        toast,
                        coversQuick: hits(tipBox, quick),
                        coversSixth: (sixth ? hits(tipBox, sixth) || cells.some((cell) => hits(tipBox, cell)) : hits(tipBox, rest)),
                        coversHero: hits(tipBox, hero) || hits(tipBox, kicker),
                        coversTab: hits(tipBox, tab),
                        coversBanner: hits(tipBox, banner),
                        coversDate: hits(tipBox, date),
                        coversFab: hits(tipBox, fab) || hits(offBtn, fab) || hits(closeBtn, fab),
                        coversClose: hits(offBtn, closeBtn),
                        sixthUnderTab: hits(timetable, tab),
                        sixthOnScreen: Boolean(timetable && timetable.top < viewBottom && timetable.bottom > 0),
                        quickTop: Math.round(quick?.top ?? -1),
                        sixthTop: Math.round(timetable?.top ?? -1),
                        cls: window.__cls || 0,
                    };
                });
                check(!layout.toast, `${width} ${mode}에서 소리 안내 토스트가 있습니다.`);
                check(layout.cls < 0.001, `${width} ${mode}에서 화면이 밀립니다: ${layout.cls}`);
                if (width < 900) {
                    check(
                        layout.visible && layout.text.includes('누를 때 소리가 나요') && !layout.text.includes('콕')
                        && !layout.coversQuick && !layout.coversSixth && !layout.coversHero && !layout.coversTab
                        && !layout.coversBanner && !layout.coversDate && !layout.coversClose
                        && layout.sixthOnScreen && !layout.sixthUnderTab
                        && (!layout.hasLeave || (layout.leaveOnScreen && !layout.coversLeave && layout.nowShown && !layout.cellUnderTab)),
                        `${width} ${mode}에서 소리 팁이 다른 내용을 가립니다: ${JSON.stringify(layout)}`,
                    );
                    await page.evaluate(() => [...document.querySelectorAll('.tip-bubble button')].find((el) => el.innerText.trim() === '끄기')?.click());
                    const after = await page.evaluate(() => ({
                        quick: Math.round(document.querySelector('.home-quick')?.getBoundingClientRect().top ?? -1),
                        sixth: Math.round((document.querySelectorAll('.period-row button')[5] || document.querySelector('.rest-banner'))?.getBoundingClientRect().top ?? -1),
                        cls: window.__cls || 0,
                        toast: [...document.querySelectorAll('.toast')].some((el) => el.innerText.includes('소리가 나요')),
                        shifts: window.__shifts || [],
                        fonts: [...document.fonts].filter((face) => face.status !== 'unloaded').map((face) => `${face.family} ${face.weight} ${face.status}`),
                    }));
                    check(after.quick === layout.quickTop && after.sixth === layout.sixthTop && after.cls < 0.001 && !after.toast, `${width} ${mode}에서 소리를 끄자 화면이 밀립니다: ${layout.quickTop}/${layout.sixthTop} → ${after.quick}/${after.sixth} cls ${after.cls} ${JSON.stringify({ shifts: after.shifts, fonts: after.fonts })}`);
                } else {
                    check(!layout.visible && !layout.coversQuick && !layout.sixthUnderTab, `${width} ${mode}에서 숨긴 소리 팁이 화면을 가립니다: ${JSON.stringify(layout)}`);
                    await page.evaluate(() => { location.hash = '#/settings'; });
                    await page.waitForFunction(() => document.body.innerText.includes('누를 때 소리가 나요') && !document.body.innerText.includes('콕'));
                    const settings = await page.evaluate(() => {
                        const hits = (a, b) => Boolean(
                            a && b && a.width > 0 && b.width > 0
                            && a.left < b.right - 0.5 && a.right > b.left + 0.5
                            && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5,
                        );
                        const button = [...document.querySelectorAll('button')].find((el) => el.innerText.includes('누를 때 소리'));
                        const note = [...document.querySelectorAll('p')].find((el) => el.offsetParent && el.innerText.includes('누를 때 소리가 나요'));
                        note?.scrollIntoView({ block: 'end' });
                        const fab = document.querySelector('.desk-fab')?.getBoundingClientRect();
                        const noteBox = note?.getBoundingClientRect();
                        const buttonBox = button?.getBoundingClientRect();
                        return {
                            phrase: (note?.innerText.includes('누를 때 소리가 나요') && !note.innerText.includes('콕')) || false,
                            off: Boolean(button),
                            under: hits(buttonBox, fab) || hits(noteBox, fab),
                            aboveFab: Boolean(noteBox && fab && noteBox.bottom <= fab.top + 0.5),
                        };
                    });
                    check(settings.phrase && settings.off && !settings.under && settings.aboveFab, `${width} ${mode} 설정에서 소리 안내가 버튼을 가리거나 없습니다: ${JSON.stringify(settings)}`);
                }
            }, width >= 900 ? 1080 : 800);
        }
    }

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
            offlineText.includes('쨈') || offlineText.includes('오늘') || offlineText.includes('인터넷'),
            '오프라인에서 껍데기가 열리지 않습니다.',
        );
    });

    await withPage(390, async (page) => {
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
        await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => document.body.innerText.includes('이 기기에서만 써 볼게요'));
        const titleFace = await page.evaluate(() => {
            const el = document.querySelector('h1.font-display');
            const link = document.querySelector('link[rel="preload"][as="font"]');
            const style = el ? getComputedStyle(el) : null;
            return { family: style?.fontFamily || '', size: style?.fontSize || '', preload: link?.getAttribute('href') || '' };
        });
        check(titleFace.size === '32px' && titleFace.family.includes('JJAEM Title Flat'), `32px 제목이 쨈 제목 평면이 아닙니다. ${JSON.stringify(titleFace)}`);
        check(titleFace.preload.includes('JJAEMBody-Regular.first.woff2') && !titleFace.preload.includes('JJAEMBody-Regular.ks.woff2'), `첫 화면 글꼴 preload가 작은 파일이 아닙니다. ${titleFace.preload}`);
        const fontLoads = await page.evaluate(async () => {
            await document.fonts.ready;
            await new Promise((done) => { setTimeout(done, 600); });
            // 쉬는 틈 받기는 CI가 바쁘면 늦게 시작할 수 있어 최대 8초까지 기다립니다.
            for (let waited = 0; waited < 8000 && performance.getEntriesByType('resource').filter((entry) => entry.name.includes('.ks.woff2')).length < 3; waited += 200) {
                await new Promise((done) => { setTimeout(done, 200); });
            }
            const nav = performance.getEntriesByType('navigation')[0];
            const loadEnd = nav?.loadEventEnd || 0;
            const fonts = performance.getEntriesByType('resource').filter((entry) => entry.name.includes('.woff2')).map((entry) => ({ name: entry.name.split('/').pop().split('?')[0], start: entry.startTime }));
            return { loadEnd, before: fonts.filter((entry) => !loadEnd || entry.start < loadEnd).map((entry) => entry.name), after: fonts.filter((entry) => loadEnd && entry.start >= loadEnd).map((entry) => entry.name) };
        });
        const firstFonts = fontLoads.before;
        check(
            ['JJAEMBody-Regular.first.woff2', 'JJAEMBody-Bold.first.woff2', 'JJAEM-TitleFlat-Regular.first.woff2'].every((name) => firstFonts.includes(name))
                && !firstFonts.some((name) => name.includes('.ks.')),
            `첫 화면에서 큰 글꼴 파일을 받습니다. ${JSON.stringify(fontLoads)}`,
        );
        const idleFonts = ['JJAEMBody-Regular.ks.woff2', 'JJAEMBody-Bold.ks.woff2', 'JJAEM-TitleFlat-Regular.ks.woff2'];
        check(
            fontLoads.loadEnd > 0 && idleFonts.every((name) => fontLoads.after.filter((item) => item === name).length === 1),
            `로그인 화면을 다 그린 뒤 다음 화면 글꼴을 한 번씩 받아 두지 않습니다. ${JSON.stringify(fontLoads)}`,
        );
        const titleChars = await page.evaluate(() => {
            const seen = new Set();
            const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                const el = node.parentElement;
                if (el && getComputedStyle(el).fontFamily.replace(/["']/g, '').startsWith('JJAEM Title Flat')) [...node.textContent].forEach((ch) => seen.add(ch));
            }
            return [...seen].join('');
        });
        const fontsNow = readFileSync(resolve(root, 'public/fonts/fonts.css'), 'utf8');
        const titleRange = ((fontsNow.split('@font-face').find((block) => block.includes('JJAEM-TitleFlat-Regular.first.woff2')) || '').match(/unicode-range:\s*([^;]+);/) || [])[1] || '';
        const missingTitle = [...titleChars].filter((ch) => !/\s/.test(ch) && !unicodeRangeHas(titleRange, ch.codePointAt(0)));
        check(titleChars.includes('쨈') && missingTitle.length === 0, `로그인 화면 제목 글자 중 첫 화면 제목 파일에 없는 글자가 있어 큰 파일을 받습니다. ${missingTitle.join('')}`);
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '이 기기에서만 써 볼게요')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('예시 학급으로 둘러보기'));
        const before = await page.evaluate(() => {
            const button = [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '예시 학급으로 둘러보기');
            const top = (button?.getBoundingClientRect().top || 0) + window.scrollY;
            window.scrollTo(0, Math.max(0, top - 80));
            return window.scrollY;
        });
        check(before > 200, `온보딩이 아래로 내려가지 않았습니다. scrollY ${before}`);
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '예시 학급으로 둘러보기')?.click());
        await page.waitForFunction(() => {
            const text = document.body.innerText;
            const main = document.querySelector('.main')?.scrollTop || 0;
            return (text.includes('오늘 우리 반') || text.includes('오늘은 수업이 없어요')) && window.scrollY === 0 && main === 0;
        });
        const home = await page.evaluate(() => ({ y: window.scrollY, main: document.querySelector('.main')?.scrollTop || 0 }));
        check(home.y === 0 && home.main === 0, `예시 학급 홈이 맨 위가 아닙니다. scrollY ${home.y}, main ${home.main}`);
        await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
        const mid = await page.evaluate(() => window.scrollY);
        check(mid > 0, '홈을 내려 화면 이동을 확인하지 못했습니다.');
        await page.evaluate(() => { location.hash = '#/todo'; });
        await page.waitForFunction(() => document.querySelector('[data-screen="todo"]') && window.scrollY === 0 && (document.querySelector('.main')?.scrollTop || 0) === 0);
        const todo = await page.evaluate(() => ({ y: window.scrollY, main: document.querySelector('.main')?.scrollTop || 0 }));
        check(todo.y === 0 && todo.main === 0, `할 일 화면이 맨 위가 아닙니다. scrollY ${todo.y}, main ${todo.main}`);
    });

    await withPage(390, async (page) => {
        /** 쉬는 틈(requestIdleCallback)이 없는 엔진(예: 예전 Safari)에서도 로그인 화면을 다 그린 뒤 전체 글꼴을 한 번씩 받아야 합니다. */
        await page.evaluateOnNewDocument(() => {
            try { delete window.requestIdleCallback; } catch { /* 지울 수 없으면 아래에서 비웁니다. */ }
            window.requestIdleCallback = undefined;
        });
        await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => document.body.innerText.includes('이 기기에서만 써 볼게요'));
        const noIdle = await page.evaluate(async () => {
            for (let waited = 0; waited < 8000 && performance.getEntriesByType('resource').filter((entry) => entry.name.includes('.ks.woff2')).length < 3; waited += 200) {
                await new Promise((done) => { setTimeout(done, 200); });
            }
            const loadEnd = performance.getEntriesByType('navigation')[0]?.loadEventEnd || 0;
            const ks = performance.getEntriesByType('resource').filter((entry) => entry.name.includes('.ks.woff2')).map((entry) => ({ name: entry.name.split('/').pop().split('?')[0], start: entry.startTime }));
            return { idle: typeof window.requestIdleCallback, loadEnd, ks };
        });
        check(
            noIdle.idle === 'undefined' && noIdle.loadEnd > 0
                && ['JJAEMBody-Regular.ks.woff2', 'JJAEMBody-Bold.ks.woff2', 'JJAEM-TitleFlat-Regular.ks.woff2'].every((name) => noIdle.ks.filter((item) => item.name === name && item.start >= noIdle.loadEnd).length === 1),
            `쉬는 틈이 없는 엔진에서 로그인 화면 뒤 전체 글꼴을 받지 않습니다. ${JSON.stringify(noIdle)}`,
        );
    });

    await withDemo(390, 'light', async (page) => {
        /** 출결 말고 다른 화면에서도 14px보다 작은 글자는 보통 굵기여야 합니다. 10월 달력에는 개천절·한글날이 있습니다. */
        const smallBold = [];
        for (const [hash, ready] of [
            ['#/today', '오늘'],
            ['#/schedule/month/2026-10-09', '한글날'],
            ['#/todo', '할 일'],
            ['#/students', '이하은'],
            ['#/settings', '글꼴'],
        ]) {
            await page.evaluate((next) => { location.hash = next; }, hash);
            await page.waitForFunction((word) => document.body.innerText.includes(word), {}, ready);
            await delay(250);
            const found = await page.evaluate(() => {
                const bold = [];
                const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
                while (walker.nextNode()) {
                    const text = walker.currentNode.textContent.trim();
                    const el = walker.currentNode.parentElement;
                    if (!text || !el || !el.getClientRects().length) continue;
                    const style = getComputedStyle(el);
                    if (style.visibility === 'hidden' || parseFloat(style.fontSize) >= 14) continue;
                    if (Number(style.fontWeight) >= 600) bold.push(`${text.slice(0, 12)} ${style.fontSize}/${style.fontWeight}`);
                }
                return bold;
            });
            if (found.length) smallBold.push(`${hash}: ${found.join(', ')}`);
        }
        check(smallBold.length === 0, `출결 밖 화면에서 14px보다 작은 글자가 굵습니다. ${smallBold.join(' / ')}`);
    });

    await withDemo(390, 'light', async (page) => {
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
        await openPlus(page);
        const line = `${planDue.label}까지 과학도서 제출\n${counselStart.label} 학예회`;
        await page.evaluate((text) => {
            const box = document.querySelector('[data-screen="plus"] textarea');
            const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            setter.call(box, text);
            box.dispatchEvent(new Event('input', { bubbles: true }));
        }, line);
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.trim() === '다음')?.click());
        await page.waitForFunction(() => document.querySelectorAll('[data-screen="plus"] .msg-card').length >= 2);
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] .msg-card button')].find((el) => el.innerText.trim() === '나중에 정리')?.click());
        await page.waitForFunction(() => [...document.querySelectorAll('[data-screen="plus"] button')].some((el) => el.innerText.trim() === '지금 저장'));
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.trim() === '남기기')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('1개 등록, 1개는 정리함에'));
    }, 844);
    // 숨은 반대쪽 행과 메모 민감어: 알림장·하루 메모·일정 줄을 실제 화면으로 고칩니다.
    await withDemo(390, 'light', async (page) => {
        const readVaults = () => page.evaluate(async () => {
            const read = (name) => new Promise((resolveRead, reject) => {
                const req = indexedDB.open(name);
                req.onerror = () => reject(req.error);
                req.onsuccess = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains('kv')) { resolveRead(null); return; }
                    const get = db.transaction('kv').objectStore('kv').get('state');
                    get.onsuccess = () => resolveRead(get.result || null);
                    get.onerror = () => reject(get.error);
                };
            });
            return { main: await read('ssug-gyomu'), local: await read('ssug-gyomu-local') };
        });
        const rowOf = (side, bucket, id) => (side?.[bucket] || []).find((row) => row.id === id) || null;
        const until = async (test) => {
            for (let attempt = 0; attempt < 40; attempt += 1) {
                const vaults = await readVaults();
                if (test(vaults)) return vaults;
                await delay(150);
            }
            return readVaults();
        };
        const typeInto = (selector, value) => page.evaluate((sel, text) => {
            const box = document.querySelector(sel);
            if (!box) return false;
            const proto = box.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
            Object.getOwnPropertyDescriptor(proto, 'value').set.call(box, text);
            box.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
        }, selector, value);
        const clickText = (label, scope = 'body') => page.evaluate((text, sel) => {
            const button = [...document.querySelectorAll(`${sel} button`)].find((el) => el.innerText.trim() === text);
            button?.click();
            return Boolean(button);
        }, label, scope);
        const open = async (hash) => {
            await page.goto(`${origin}?mode=light&at=08:42${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForFunction(() => document.querySelector('main, #root')?.innerText?.length > 0, { timeout: 15000 });
        };

        await page.evaluate(async () => {
            const open = (name) => new Promise((resolveDb, reject) => {
                const req = indexedDB.open(name);
                req.onsuccess = () => resolveDb(req.result);
                req.onerror = () => reject(req.error);
            });
            const swap = async (name, edit) => {
                const db = await open(name);
                const store = db.transaction('kv', 'readwrite').objectStore('kv');
                const state = await new Promise((resolveState, reject) => {
                    const req = store.get('state');
                    req.onsuccess = () => resolveState(req.result || {});
                    req.onerror = () => reject(req.error);
                });
                edit(state);
                await new Promise((resolvePut, reject) => {
                    const req = store.put(state, 'state');
                    req.onsuccess = () => resolvePut();
                    req.onerror = () => reject(req.error);
                });
            };
            const add = (state, bucket, row) => { state[bucket] = [...(state[bucket] || []), row]; };
            await swap('ssug-gyomu', (state) => {
                add(state, 'notices', { id: '2026-12-01', date: '2026-12-01', text: '준비물 가위', source: 'app' });
                add(state, 'notices', { id: '2026-12-02', date: '2026-12-02', text: '체육복 챙기기', source: 'app' });
                add(state, 'notes', { id: 'day-2026-12-03', date: '2026-12-03', text: '체험학습 서류', pinned: false, source: 'app' });
                add(state, 'events', { id: 'qa-ev-1', date: '2026-12-07', time: '09:00', title: '현장체험 안내문', kind: '학급', memo: '', source: 'app' });
                add(state, 'events', { id: 'qa-ev-2', date: '2026-12-07', time: '13:00', title: '학부모 공개수업', kind: '학급', memo: '', source: 'app' });
            });
            await swap('ssug-gyomu-local', (state) => {
                add(state, 'notices', { id: '2026-12-01', date: '2026-12-01', text: '민원 전화 회신하기', source: 'app' });
                add(state, 'notes', { id: 'day-2026-12-03', date: '2026-12-03', text: '보건실 다녀옴', pinned: false, source: 'app' });
                add(state, 'notes', { id: 'day-2026-12-04', date: '2026-12-04', text: '건강 상담 메모', pinned: false, source: 'app' });
                add(state, 'events', { id: 'qa-ev-1', date: '2026-12-07', time: '08:50', title: '현장체험 출발', kind: '학급', memo: '알레르기 약 챙기기', source: 'app' });
            });
        });

        // 알림장: 클라우드 행을 고쳐도 숨은 기기 행이 남습니다.
        await open('#/notice/2026-12-01');
        const noticeShown = await page.waitForFunction(() => document.querySelector('textarea[aria-label="알림장"]')?.value === '준비물 가위', { timeout: 8000 }).then(() => true, () => false);
        check(noticeShown, '숨은 행 검사: 알림장 화면에 클라우드 알림장이 먼저 나오지 않습니다.');
        await typeInto('textarea[aria-label="알림장"]', '준비물 풀');
        check(await clickText('저장'), '숨은 행 검사: 알림장 저장 단추가 없습니다.');
        let vaults = await until((v) => rowOf(v.main, 'notices', '2026-12-01')?.text === '준비물 풀');
        check(rowOf(vaults.main, 'notices', '2026-12-01')?.text === '준비물 풀', '숨은 행 검사: 알림장 화면에서 고친 글이 클라우드에 들어가지 않습니다.');
        check(rowOf(vaults.local, 'notices', '2026-12-01')?.text === '민원 전화 회신하기', '숨은 행 검사: 알림장을 고치자 숨은 기기 전용 알림장이 지워졌습니다.');

        // 알림장: 민감어로 고치면 클라우드에서 빠지고 기기에만 남습니다.
        await open('#/notice/2026-12-02');
        await page.waitForFunction(() => document.querySelector('textarea[aria-label="알림장"]')?.value === '체육복 챙기기', { timeout: 8000 }).catch(() => {});
        await typeInto('textarea[aria-label="알림장"]', '민원 서류 챙기기');
        await clickText('저장');
        vaults = await until((v) => Boolean(rowOf(v.local, 'notices', '2026-12-02')));
        check(rowOf(vaults.local, 'notices', '2026-12-02')?.text === '민원 서류 챙기기', '숨은 행 검사: 민감어 알림장이 기기에 남지 않습니다.');
        check(!rowOf(vaults.main, 'notices', '2026-12-02'), '숨은 행 검사: 민감어로 고친 알림장의 예전 글이 클라우드에 남았습니다.');

        // 하루 메모: 기기 행을 고쳐도 숨은 클라우드 메모가 남습니다.
        await open('#/day/2026-12-03');
        const memoShown = await page.waitForFunction(() => document.querySelector('textarea[aria-label="하루 메모"]')?.value === '보건실 다녀옴', { timeout: 8000 }).then(() => true, () => false);
        check(memoShown, '숨은 행 검사: 하루 메모 화면에 기기 전용 메모가 나오지 않습니다.');
        await typeInto('textarea[aria-label="하루 메모"]', '보건실 다녀옴, 다시 확인');
        check(await clickText('하루 메모 저장'), '숨은 행 검사: 하루 메모 저장 단추가 없습니다.');
        vaults = await until((v) => rowOf(v.local, 'notes', 'day-2026-12-03')?.text === '보건실 다녀옴, 다시 확인');
        check(rowOf(vaults.local, 'notes', 'day-2026-12-03')?.text === '보건실 다녀옴, 다시 확인', '숨은 행 검사: 하루 메모를 고친 글이 기기에 남지 않습니다.');
        check(rowOf(vaults.main, 'notes', 'day-2026-12-03')?.text === '체험학습 서류', '숨은 행 검사: 하루 메모를 고치자 숨은 클라우드 메모가 지워졌습니다.');

        // 하루 메모: 민감어를 빼면 기기 행은 없어지고 클라우드로 옮겨집니다.
        await open('#/day/2026-12-04');
        await page.waitForFunction(() => document.querySelector('textarea[aria-label="하루 메모"]')?.value === '건강 상담 메모', { timeout: 8000 }).catch(() => {});
        await typeInto('textarea[aria-label="하루 메모"]', '상담 메모 정리');
        await clickText('하루 메모 저장');
        vaults = await until((v) => Boolean(rowOf(v.main, 'notes', 'day-2026-12-04')));
        check(rowOf(vaults.main, 'notes', 'day-2026-12-04')?.text === '상담 메모 정리', '숨은 행 검사: 민감어를 뺀 하루 메모가 클라우드로 옮겨지지 않습니다.');
        check(!rowOf(vaults.local, 'notes', 'day-2026-12-04'), '숨은 행 검사: 클라우드로 옮긴 하루 메모의 예전 민감 글이 기기에 남았습니다.');

        // 일정 줄: 메모에 민감어가 있는 기기 일정은 제목만 고쳐도 기기에 남고, 숨은 클라우드 일정도 남습니다.
        await open('#/day/2026-12-07');
        const lineShown = await page.waitForFunction(() => Boolean(document.querySelector('button[aria-label="현장체험 출발 고치기"]')), { timeout: 8000 }).then(() => true, () => false);
        check(lineShown, '숨은 행 검사: 일정 줄에 기기 전용 일정이 나오지 않습니다.');
        await page.evaluate(() => document.querySelector('button[aria-label="현장체험 출발 고치기"]')?.click());
        await page.waitForSelector('input[aria-label="현장체험 출발 고치기"]', { timeout: 5000 }).catch(() => {});
        await typeInto('input[aria-label="현장체험 출발 고치기"]', '현장체험 출발 9시');
        await page.evaluate(() => [...(document.querySelector('input[aria-label="현장체험 출발 고치기"]')?.parentElement?.querySelectorAll('button') || [])].find((el) => el.innerText.trim() === '저장')?.click());
        vaults = await until((v) => [...(v.main?.events || []), ...(v.local?.events || [])].some((row) => row.title === '현장체험 출발 9시'));
        check(rowOf(vaults.local, 'events', 'qa-ev-1')?.title === '현장체험 출발 9시', '숨은 행 검사: 메모에 민감어가 있는 일정이 기기에 남지 않습니다.');
        check(rowOf(vaults.main, 'events', 'qa-ev-1')?.title === '현장체험 안내문', '숨은 행 검사: 일정 줄을 고치자 숨은 클라우드 일정이 지워지거나 바뀌었습니다.');
        check(!(vaults.main?.events || []).some((row) => String(row.memo || '').includes('알레르기')), '숨은 행 검사: 메모에 민감어가 있는 일정이 클라우드 목록에 들어갔습니다.');

        // 일정 줄: 클라우드 일정을 민감어로 고치면 클라우드에서 빠집니다.
        await page.waitForFunction(() => Boolean(document.querySelector('button[aria-label="학부모 공개수업 고치기"]')), { timeout: 8000 }).catch(() => {});
        await page.evaluate(() => document.querySelector('button[aria-label="학부모 공개수업 고치기"]')?.click());
        await page.waitForSelector('input[aria-label="학부모 공개수업 고치기"]', { timeout: 5000 }).catch(() => {});
        await typeInto('input[aria-label="학부모 공개수업 고치기"]', '학부모 공개수업 건강 상담');
        await page.evaluate(() => [...(document.querySelector('input[aria-label="학부모 공개수업 고치기"]')?.parentElement?.querySelectorAll('button') || [])].find((el) => el.innerText.trim() === '저장')?.click());
        vaults = await until((v) => Boolean(rowOf(v.local, 'events', 'qa-ev-2')));
        check(rowOf(vaults.local, 'events', 'qa-ev-2')?.title === '학부모 공개수업 건강 상담', '숨은 행 검사: 민감어로 고친 일정이 기기에 남지 않습니다.');
        check(!rowOf(vaults.main, 'events', 'qa-ev-2'), '숨은 행 검사: 민감어로 고친 일정의 예전 줄이 클라우드에 남았습니다.');

        // 내보내기(기기 전용 기록 빼기): 민감한 글이 파일에 들어가지 않습니다.
        await open('#/settings');
        await page.evaluate(() => {
            window.__qaExport = null;
            const make = URL.createObjectURL.bind(URL);
            URL.createObjectURL = (blob) => { blob.text().then((text) => { window.__qaExport = text; }); return make(blob); };
        });
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '기록 내려받기'), { timeout: 8000 }).catch(() => {});
        check(await clickText('기록 내려받기'), '숨은 행 검사: 기록 내려받기 단추가 없습니다.');
        const exported = await page.waitForFunction(() => window.__qaExport, { timeout: 5000 }).then((handle) => handle.jsonValue(), () => '');
        check(exported.includes('준비물 풀'), '숨은 행 검사: 내보낸 파일을 읽지 못했습니다.');
        check(exported.includes('현장체험 안내문') && exported.includes('체험학습 서류'), '숨은 행 검사: 숨은 클라우드 행이 내보낸 파일에서 빠졌습니다.');
        const leaked = ['민원 전화 회신하기', '민원 서류 챙기기', '보건실 다녀옴', '알레르기 약 챙기기', '현장체험 출발 9시', '공개수업 건강 상담'].filter((text) => exported.includes(text));
        check(leaked.length === 0, `숨은 행 검사: 기기 전용 기록을 빼고 내보냈는데 민감한 글이 들어갔습니다. ${leaked.join(', ')}`);
    }, 844);

    /* 하단 쨈 버튼: 크기·측면·눌림·터치 영역·그림자와, 토스트가 버튼을 덮지 않는지 계산된 스타일로 봅니다.
       main(#39)의 콕 키캡 검사를 #38 쨈 용기 모양에 맞게 고쳤습니다.
       58/64px 키캡 → 60px 접시(.fab-disc), 9px 측면 → 접시 아래 6px 그림자,
       :active 6px 눌림·80ms 전환 → 누르는 동안(is-pressed) 컵이 납작해지고(1.1×0.86) 70ms 전환, 떼면 원래대로. */
    for (const width of [360, 390, 900, 960, 1000, 1920]) {
        for (const mode of ['light', 'dark']) {
            await withDemo(width, mode, async (page) => {
                const selector = width >= 900 ? '.desk-fab' : '.tabbar .fab';
                const size = 60;
                const cap = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return null;
                    const rect = el.getBoundingClientRect();
                    const disc = el.querySelector('.fab-disc');
                    const squish = el.querySelector('.cup-squish');
                    const discRect = disc?.getBoundingClientRect();
                    return {
                        w: rect.width,
                        h: rect.height,
                        discW: discRect?.width ?? 0,
                        discH: discRect?.height ?? 0,
                        shadow: disc ? getComputedStyle(disc).boxShadow : '',
                        squish: squish ? getComputedStyle(squish).transform : '',
                        transition: squish ? `${getComputedStyle(squish).transitionProperty} ${getComputedStyle(squish).transitionDuration}` : '',
                    };
                }, selector);
                check(Boolean(cap), `${width} ${mode}에서 쨈 버튼이 없습니다.`);
                if (!cap) return;
                check(Math.abs(cap.discW - size) < 0.6 && Math.abs(cap.discH - size) < 0.6, `${width} ${mode} 쨈 접시가 ${size}px가 아닙니다: ${cap.discW}×${cap.discH}`);
                check(cap.w >= 44 && cap.h >= 44, `${width} ${mode} 쨈 버튼 터치 영역이 44px보다 작습니다.`);
                check(cap.shadow && cap.shadow !== 'none' && /\b0px 6px 20px -6px\b/.test(cap.shadow), `${width} ${mode} 쨈 접시 아래 6px 그림자가 없습니다: ${cap.shadow}`);
                check(cap.squish === 'none' && /transform/.test(cap.transition) && /0\.46s/.test(cap.transition), `${width} ${mode} 쨈 컵이 쉬는 모양이 아니거나 돌아오는 전환이 없습니다: ${cap.squish} ${cap.transition}`);
                const pressed = await page.evaluate(async (sel) => {
                    const el = document.querySelector(sel);
                    const squish = el.querySelector('.cup-squish');
                    const rect = el.getBoundingClientRect();
                    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, button: 0, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
                    await new Promise((done) => setTimeout(done, 200));
                    const down = { transform: getComputedStyle(squish).transform, duration: getComputedStyle(squish).transitionDuration, press: el.dataset.press };
                    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1 }));
                    await new Promise((done) => setTimeout(done, 700));
                    return { down, up: { transform: getComputedStyle(squish).transform, press: el.dataset.press } };
                }, selector);
                const matrix = /matrix\(([^)]+)\)/.exec(pressed.down.transform)?.[1].split(',').map(Number) || [];
                check(pressed.down.press === 'down' && Math.abs(matrix[0] - 1.1) < 0.01 && Math.abs(matrix[3] - 0.86) < 0.01, `${width} ${mode} 누르는 동안 쨈 컵이 1.1×0.86으로 눌리지 않습니다: ${pressed.down.transform}`);
                check(/0\.07s/.test(pressed.down.duration), `${width} ${mode} 쨈 컵 눌림 전환이 70ms가 아닙니다: ${pressed.down.duration}`);
                check(pressed.up.press === 'rest' && pressed.up.transform === 'none', `${width} ${mode} 뗀 쨈 컵이 원래대로 돌아오지 않습니다: ${pressed.up.transform}`);
                /* QA 1차 6번(M10): 키보드 Enter·Space도 누르는 동안 눌리고, 떼면 돌아와야 합니다.
                   Enter는 누르는 순간 열려 글자 칸으로 초점이 가므로 버튼 대신 창에서 뗌을 받습니다. */
                for (const key of ['Enter', 'Space']) {
                    await page.evaluate((sel) => document.querySelector(sel).focus(), selector);
                    await page.keyboard.down(key);
                    await delay(200);
                    const keyDown = await page.evaluate((sel) => {
                        const el = document.querySelector(sel);
                        return { transform: getComputedStyle(el.querySelector('.cup-squish')).transform, press: el.dataset.press };
                    }, selector);
                    await page.keyboard.up(key);
                    await delay(700);
                    const keyUp = await page.evaluate((sel) => {
                        const el = document.querySelector(sel);
                        return { transform: getComputedStyle(el.querySelector('.cup-squish')).transform, press: el.dataset.press, open: Boolean(document.querySelector('.quick-bar.is-open')) };
                    }, selector);
                    const keyMatrix = /matrix\(([^)]+)\)/.exec(keyDown.transform)?.[1].split(',').map(Number) || [];
                    check(keyDown.press === 'down' && Math.abs(keyMatrix[0] - 1.1) < 0.01 && Math.abs(keyMatrix[3] - 0.86) < 0.01, `${width} ${mode} ${key}를 누르는 동안 쨈 컵이 눌리지 않습니다: ${keyDown.press} ${keyDown.transform}`);
                    check(keyUp.press === 'rest' && keyUp.transform === 'none', `${width} ${mode} ${key}를 뗀 뒤 쨈 컵이 돌아오지 않습니다: ${keyUp.press} ${keyUp.transform}`);
                    check(keyUp.open, `${width} ${mode} ${key}로 빠른 입력이 열리지 않습니다.`);
                    await page.keyboard.press('Escape');
                    await page.waitForFunction(() => !document.querySelector('.quick-bar.is-open'), { timeout: 3000 }).catch(() => {});
                }
                /* QA 2차 5번: 누른 채 창이 초점을 잃거나(blur) 화면이 가려지면(visibilitychange hidden) 눌림이 풀려야 합니다. */
                const lost = await page.evaluate(async (sel) => {
                    const el = document.querySelector(sel);
                    const rect = el.getBoundingClientRect();
                    const down = () => el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, button: 0, clientX: rect.x + rect.width / 2, clientY: rect.y + rect.height / 2 }));
                    const wait = (ms) => new Promise((done) => setTimeout(done, ms));
                    down();
                    await wait(120);
                    const before = el.dataset.press;
                    window.dispatchEvent(new Event('blur'));
                    await wait(50);
                    const blur = el.dataset.press;
                    down();
                    await wait(120);
                    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
                    document.dispatchEvent(new Event('visibilitychange'));
                    delete document.visibilityState;
                    await wait(50);
                    const hidden = el.dataset.press;
                    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7 }));
                    return { before, blur, hidden, pressed: el.classList.contains('is-pressed') };
                }, selector);
                check(lost.before === 'down' && lost.blur === 'rest' && lost.hidden === 'rest' && !lost.pressed, `${width} ${mode} 창 초점을 잃거나 화면이 가려져도 쨈 컵 눌림이 풀리지 않습니다: ${JSON.stringify(lost)}`);
                /* QA 2차 5번: 키보드 초점 테두리는 바탕과 3:1 이상이어야 합니다(어두운 화면 포함). */
                const ring = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    el.focus();
                    const rgb = (text) => (text.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
                    const lum = ([r, g, b]) => [r, g, b].map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
                    const style = getComputedStyle(el);
                    const probe = document.createElement('div');
                    probe.style.background = 'var(--bg)';
                    document.body.append(probe);
                    const bg = getComputedStyle(probe).backgroundColor;
                    probe.remove();
                    const a = lum(rgb(style.outlineColor));
                    const b = lum(rgb(bg));
                    return { visible: el.matches(':focus-visible'), style: style.outlineStyle, color: style.outlineColor, bg, ratio: Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 100) / 100 };
                }, selector);
                check(ring.visible && ring.style !== 'none' && ring.ratio >= 3, `${width} ${mode} 키보드 초점 테두리가 바탕과 3:1이 안 됩니다: ${JSON.stringify(ring)}`);
                await clickPlus(page, '관찰');
                await page.waitForFunction(() => document.body.innerText.includes('누구'));
                await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('이하은'))?.click());
                await page.waitForSelector('textarea');
                await page.type('textarea', '@12 #학습 키캡 점검');
                await page.keyboard.press('Enter');
                await page.waitForSelector('.toast');
                await delay(300);
                const box = await page.evaluate((sel) => {
                    const t = document.querySelector('.toast').getBoundingClientRect();
                    const f = document.querySelector(sel).getBoundingClientRect();
                    const bottom = f.bottom + 9;
                    return {
                        hit: t.left < f.right && t.right > f.left && t.top < bottom && t.bottom > f.top,
                        inside: t.left >= 0 && t.right <= document.documentElement.clientWidth,
                        t: [t.left, t.top, t.right, t.bottom].map(Math.round),
                        f: [f.left, f.top, f.right, bottom].map(Math.round),
                    };
                }, selector);
                check(!box.hit && box.inside, `${width} ${mode}에서 토스트가 콕 키캡을 덮습니다: ${JSON.stringify(box)}`);
                if (width === 960) await page.screenshot({ path: resolve(shots, `keycap_toast_960_${mode}.png`) });
            });
        }
    }

    /* 시간표 칸 편집: 폰에서도 화면 안(하단 탭 위)에 열리고, 과목 칸으로 포커스가 가며, Esc·닫기로 닫으면 연 칸으로 돌아갑니다. */
    for (const [width, height, count] of [[390, 844, 10], [360, 800, 6], [1280, 900, 6]]) {
        await withDemo(width, 'light', async (page) => {
            await page.evaluate((count) => {
                localStorage.setItem('ssug-gyomu-period-local', JSON.stringify({ level: '초', count, cellLocks: count === 10 ? ['mon-1', 'mon-10'] : [] }));
            }, count);
            await page.evaluate((hash) => { location.hash = hash; }, `#/schedule/table/${todayYmd}`);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForSelector('.tt-grid button.solid-card');
            const cells = await page.$$eval('.tt-grid button.solid-card', (list) => list.map((el) => el.getAttribute('aria-label')));
            const day = cells[0].split(' ')[0];
            check(cells.filter((label) => label.startsWith(`${day} `)).length === count, `${width} 시간표가 ${count}교시까지 보이지 않습니다: ${cells.length}`);
            if (count === 10 && day === '월') {
                const locked = await page.$$eval('.tt-grid button.tt-locked', (list) => list.map((el) => `${el.innerText.trim()}|${el.getAttribute('aria-label')}`));
                check(locked.some((item) => /^🔒 \S+\|월 1교시 \S+, 잠김$/.test(item)) && locked.includes('🔒|월 10교시 잠김') && !locked.some((item) => item.includes('🔒 잠김')), `잠긴 칸에 과목이 함께 보이지 않습니다: ${JSON.stringify(locked)}`);
            }
            for (const [period, how] of [[1, 'Escape'], [count, '닫기']]) {
                const label = cells.find((item) => item.startsWith(`${day} ${period}교시 `));
                await page.evaluate((label) => [...document.querySelectorAll('.tt-grid button.solid-card')].find((el) => el.getAttribute('aria-label') === label).click(), label);
                await page.waitForSelector('form.tt-edit input[name="subject"]');
                await delay(250);
                const box = await page.evaluate(() => {
                    const form = document.querySelector('form.tt-edit').getBoundingClientRect();
                    const tab = document.querySelector('.tabbar');
                    const tabOn = tab && getComputedStyle(tab).display !== 'none';
                    const tabTop = tabOn ? Math.min(...[tab, ...tab.querySelectorAll('*')].map((el) => el.getBoundingClientRect()).filter((rect) => rect.height > 0).map((rect) => rect.top)) : Infinity;
                    const main = document.querySelector('.main')?.getBoundingClientRect();
                    const bottom = Math.min(window.innerHeight, tabTop, main && !tabOn ? main.bottom : Infinity);
                    return { top: Math.round(form.top), bottom: Math.round(form.bottom), limit: Math.round(bottom), focus: document.activeElement?.getAttribute('name') || '' };
                });
                check(box.top >= 0 && box.bottom <= box.limit && box.focus === 'subject', `${width} ${count}교시 ${period}교시 편집 폼이 화면 밖이거나 과목 칸에 포커스가 없습니다: ${JSON.stringify(box)}`);
                /* G9: 탭·읽기 순서는 과목 칸이 먼저이고, 잠그기·닫기는 그 뒤입니다. */
                const order = await page.evaluate(() => [...document.querySelectorAll('form.tt-edit input, form.tt-edit button')].map((el) => el.getAttribute('name') || el.innerText.trim()));
                await page.keyboard.press('Tab');
                const next = await page.evaluate(() => document.activeElement?.innerText?.trim() || document.activeElement?.getAttribute('name') || '');
                await page.keyboard.down('Shift');
                await page.keyboard.press('Tab');
                await page.keyboard.up('Shift');
                const backTo = await page.evaluate(() => document.activeElement?.getAttribute('name') || '');
                const closeAt = order.indexOf('닫기');
                const lockAt = order.findIndex((item) => /잠그기|잠금 풀기/.test(item));
                check(order[0] === 'subject' && closeAt > 0 && (lockAt === -1 || lockAt > 0) && /^전담/.test(next) && backTo === 'subject', `${width} ${period}교시 편집 폼의 탭 순서가 과목 칸부터가 아닙니다: ${JSON.stringify(order)} / Tab→${next} / Shift+Tab→${backTo}`);
                if (period === count) await page.screenshot({ path: resolve(shots, `timetable-edit-${width}.png`) });
                if (how === 'Escape') await page.keyboard.press('Escape');
                else await page.evaluate(() => [...document.querySelectorAll('form.tt-edit button')].find((el) => el.innerText.trim() === '닫기')?.click());
                await page.waitForFunction(() => !document.querySelector('form.tt-edit'));
                const back = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') || '');
                check(back === label, `${width} ${how}로 닫은 뒤 포커스가 연 칸으로 돌아가지 않습니다: ${back} / ${label}`);
            }
        }, height);
    }

    /* 잠금 풀기: 잠긴 칸과 잠긴 교시를 마우스와 키보드로 풀 수 있고, 풀린 뒤 aria-pressed=false와 저장값이 맞습니다. 교시 전체가 잠긴 칸은 칸 잠금으로 바뀌지 않습니다. */
    await withDemo(390, 'light', async (page) => {
        await page.evaluate(() => { localStorage.setItem('ssug-gyomu-period-local', JSON.stringify({ level: '초', count: 6, cellLocks: ['mon-2', 'mon-3'], locks: [5, 6] })); });
        await page.evaluate((hash) => { location.hash = hash; }, `#/schedule/table/${todayYmd}`);
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('.tt-grid button.solid-card');
        const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem('ssug-gyomu-period-local') || '{}'));
        const toastHas = (text) => page.waitForFunction((text) => [...document.querySelectorAll('.toast')].some((el) => el.innerText.includes(text)), { timeout: 3000 }, text).then(() => true, () => false);
        const cellOf = (period) => page.evaluateHandle((period) => [...document.querySelectorAll('.tt-grid button.solid-card')].find((el) => el.getAttribute('aria-label').startsWith(`월 ${period}교시 `)), period);
        for (const [period, how] of [[2, '마우스'], [3, '키보드']]) {
            await (await cellOf(period)).click();
            await page.waitForSelector('form.tt-edit input[name="subject"]');
            const selector = `form.tt-edit button[aria-label="월 ${period}교시 칸 잠금 풀기"]`;
            const before = await page.$eval(selector, (el) => el.getAttribute('aria-pressed')).catch(() => '');
            if (how === '마우스') await page.click(selector);
            else { await page.focus(selector); await page.keyboard.press('Enter'); }
            const toast = await toastHas('이 칸 잠금을 풀었어요');
            const after = await page.$eval(`form.tt-edit button[aria-label="월 ${period}교시 칸 잠그기"]`, (el) => el.getAttribute('aria-pressed')).catch(() => '');
            const cellLocks = (await saved()).cellLocks || [];
            check(before === 'true' && after === 'false' && toast && !cellLocks.includes(`mon-${period}`), `${how}로 잠긴 칸(월 ${period}교시)을 풀지 못합니다: ${JSON.stringify({ before, after, toast, cellLocks })}`);
            await page.keyboard.press('Escape');
            await page.waitForFunction(() => !document.querySelector('form.tt-edit'));
        }
        const cell5 = await cellOf(5);
        const box5 = await cell5.boundingBox();
        await page.mouse.move(box5.x + box5.width / 2, box5.y + box5.height / 2);
        await page.mouse.down();
        await delay(800);
        await page.mouse.up();
        const guide = await toastHas('5교시 전체가 잠겨 있어요');
        await page.keyboard.press('Escape');
        const kept = await saved();
        check(guide && !(kept.cellLocks || []).includes('mon-5') && (kept.locks || []).includes(5), `교시 전체가 잠긴 칸을 길게 누르면 칸 잠금으로 바뀝니다: ${JSON.stringify({ guide, kept })}`);
        for (const [period, how] of [[5, '마우스'], [6, '키보드']]) {
            const selector = `.tt-grid button[aria-label="${period}교시 잠금 풀기"]`;
            const before = await page.$eval(selector, (el) => el.getAttribute('aria-pressed')).catch(() => '');
            if (how === '마우스') await page.click(selector);
            else { await page.focus(selector); await page.keyboard.press('Enter'); }
            await page.waitForSelector(`.tt-grid button[aria-label="${period}교시 잠그기"]`, { timeout: 3000 }).catch(() => {});
            const after = await page.$eval(`.tt-grid button[aria-label="${period}교시 잠그기"]`, (el) => el.getAttribute('aria-pressed')).catch(() => '');
            const locks = (await saved()).locks || [];
            check(before === 'true' && after === 'false' && !locks.includes(period), `${how}로 잠긴 ${period}교시를 풀지 못합니다: ${JSON.stringify({ before, after, locks })}`);
        }
    });

    /* 교시 설정: 첫 열 폭이 줄마다 같고, 시각이 잘리지 않고, '10교시'가 줄바꿈되지 않습니다. 저장 안 한 길이가 있으면 학교급을 바꾸기 전에 묻습니다. */
    for (const width of [360, 390, 1280]) {
        await withDemo(width, 'light', async (page) => {
            await page.evaluate(() => { localStorage.setItem('ssug-gyomu-period-local', JSON.stringify({ level: '초', count: 10, locks: [3] })); });
            await page.evaluate(() => { location.hash = '#/settings'; });
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForSelector('.tt-row');
            const rows = await page.evaluate(() => [...document.querySelectorAll('.tt-row')].map((row) => {
                const time = row.querySelector('input[type="time"]');
                const probe = time.cloneNode();
                probe.style.cssText = 'width:auto;min-width:0;position:absolute;left:0;top:0;visibility:hidden';
                row.appendChild(probe);
                const need = probe.getBoundingClientRect().width;
                probe.remove();
                const name = row.querySelector('strong');
                return {
                    name: name.innerText.trim(),
                    oneLine: name.getBoundingClientRect().height <= parseFloat(getComputedStyle(name).lineHeight) + 1,
                    timeLeft: Math.round(time.getBoundingClientRect().left),
                    lockLeft: Math.round(row.querySelector('button').getBoundingClientRect().left),
                    have: Math.round(time.getBoundingClientRect().width),
                    need: Math.ceil(need),
                    lockOneLine: (() => { const button = row.querySelector('button'); const range = document.createRange(); range.selectNodeContents(button); return range.getBoundingClientRect().height <= parseFloat(getComputedStyle(button).fontSize) * 1.6; })(),
                };
            }));
            check(rows.length === 10 && new Set(rows.map((row) => `${row.timeLeft}/${row.lockLeft}`)).size === 1, `${width} 교시 설정 줄이 어긋납니다: ${JSON.stringify(rows.map((row) => [row.name, row.timeLeft, row.lockLeft]))}`);
            check(rows.every((row) => row.have >= row.need), `${width} 교시 설정 시각이 잘립니다: ${JSON.stringify(rows.filter((row) => row.have < row.need))}`);
            check(rows.every((row) => row.oneLine), `${width} '10교시'가 줄바꿈됩니다: ${JSON.stringify(rows.filter((row) => !row.oneLine).map((row) => row.name))}`);
            check(rows.every((row) => row.lockOneLine), `${width} 교시 설정 잠금 버튼 글자가 줄바꿈됩니다: ${JSON.stringify(rows.filter((row) => !row.lockOneLine).map((row) => row.name))}`);
            if (width === 360) {
                await page.evaluate(() => document.querySelectorAll('.tt-row')[9].scrollIntoView({ block: 'center' }));
                await page.screenshot({ path: resolve(shots, 'timetable-settings-360.png') });
                const len = await page.$('.tt-row input[aria-label="1교시 길이(분)"]');
                await len.click({ clickCount: 3 });
                await len.type('35');
                let asked = '';
                page.once('dialog', async (dialog) => { asked = dialog.message(); await dialog.dismiss(); });
                await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '중학교')?.click());
                await delay(200);
                const level = await page.evaluate(() => JSON.parse(localStorage.getItem('ssug-gyomu-period-local') || '{}').level);
                check(asked.includes('수업 길이') && level === '초', `저장하지 않은 길이가 있는데 학교급을 묻지 않고 바꿉니다: ${asked} / ${level}`);
            }
        }, width >= 900 ? 900 : 800);
    }
    /* 홈 출퇴근 안내 카드: 시각이 없으면 타이머 자리에 보이고, 저장하면 타이머로 바뀌며, 잘못된 시각은 받지 않고, '다음에'는 기억합니다. 쉬는 날에는 숨깁니다. */
    async function freshHome(page, mode) {
        await page.goto(`${origin}?mode=${mode}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => document.body.innerText.includes('이 기기에서만 써 볼게요'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '이 기기에서만 써 볼게요')?.click());
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '나중에 할게요'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '나중에 할게요')?.click());
        await page.waitForFunction(() => document.querySelector('.home-hero'));
        await delay(300);
        return page.evaluate(() => (document.querySelector('.home-hero')?.innerText || '').includes('오늘은 수업이 없어요'));
    }
    async function setTime(page, label, value) {
        await page.evaluate((label, value) => {
            const input = document.querySelector(`.work-setup input[aria-label="${label}"]`);
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        }, label, value);
    }
    async function toastAfterSave(page) {
        /* 토스트 DOM을 지우면 React가 떨어진 노드를 고치므로, 문구가 바뀔 때까지 기다립니다. */
        const toastText = () => page.evaluate(() => [...document.querySelectorAll('.toast')].map((el) => el.innerText.trim()).join(' '));
        const before = await toastText();
        await page.evaluate(() => [...document.querySelectorAll('.work-setup button')].find((el) => el.innerText.trim() === '저장')?.click());
        await page.waitForFunction((prev) => [...document.querySelectorAll('.toast')].map((el) => el.innerText.trim()).join(' ') !== prev, { timeout: 3000 }, before).catch(() => {});
        return toastText();
    }
    const savedWork = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('ssug-gyomu-period-local') || '{}'));
    for (const [width, mode] of [[360, 'light'], [390, 'dark'], [1280, 'light']]) {
        await withPage(width, async (page) => {
            const off = await freshHome(page, mode);
            /* 폰: 안내는 한 줄 띠로 접혀 있고, 시간표(6교시까지)가 띠 위 첫 화면에 보입니다. 띠를 눌러야 문구와 시각 칸이 펼쳐집니다. */
            const strip = await page.evaluate(() => {
                const el = document.querySelector('.work-setup');
                if (!el) return null;
                const head = el.querySelector('.work-setup-strip');
                const headBox = head?.getBoundingClientRect();
                const sum = el.querySelector('.work-setup-sum');
                const body = el.querySelector('.work-setup-body')?.getBoundingClientRect();
                const time = document.querySelector('.home-time')?.getBoundingClientRect();
                const sixth = [...document.querySelectorAll('.period-row button')][5]?.getBoundingClientRect();
                const tab = document.querySelector('.tabbar')?.getBoundingClientRect();
                const viewBottom = tab && tab.height > 0 ? tab.top : window.innerHeight;
                return {
                    height: Math.round(el.getBoundingClientRect().height),
                    top: Math.round(el.getBoundingClientRect().top),
                    headShown: Boolean(headBox && headBox.height > 0),
                    expanded: head?.getAttribute('aria-expanded'),
                    sumLines: sum && sum.getBoundingClientRect().height > 0 ? Math.round(sum.getBoundingClientRect().height / parseFloat(getComputedStyle(sum).lineHeight || '20') || 1) : 0,
                    bodyShown: Boolean(body && body.height > 0),
                    timeTop: Math.round(time?.top ?? -1),
                    sixthBottom: Math.round(sixth?.bottom ?? -1),
                    viewBottom: Math.round(viewBottom),
                    steps: [...el.querySelectorAll('input[type="time"]')].map((input) => input.getAttribute('step')),
                };
            });
            if (!off && strip) {
                check(strip.steps.length === 2 && strip.steps.every((step) => step === '60'), `${width} 안내 카드 출근·퇴근 칸에 step="60"이 없습니다: ${JSON.stringify(strip.steps)}`);
                if (width < 900) {
                    check(strip.headShown && strip.expanded === 'false' && !strip.bodyShown && strip.height <= 80 && strip.sumLines <= 1, `${width} 안내 카드가 한 줄 띠로 접혀 있지 않습니다: ${JSON.stringify(strip)}`);
                    check(strip.timeTop >= 0 && strip.timeTop < strip.top && strip.sixthBottom > 0 && strip.sixthBottom <= strip.viewBottom, `${width} 첫 화면에 시간표 6교시가 다 보이지 않습니다: ${JSON.stringify(strip)}`);
                    await page.screenshot({ path: resolve(shots, `home-work-strip-${width}-${mode}.png`) });
                    await page.click('.work-setup .work-setup-strip');
                    await page.waitForFunction(() => document.querySelector('.work-setup')?.dataset.open === '1', { timeout: 3000 }).catch(() => {});
                    const opened = await page.evaluate(() => ({ expanded: document.querySelector('.work-setup-strip')?.getAttribute('aria-expanded'), body: Math.round(document.querySelector('.work-setup-body')?.getBoundingClientRect().height || 0) }));
                    check(opened.expanded === 'true' && opened.body > 0, `${width} 안내 띠를 눌러도 펼쳐지지 않습니다: ${JSON.stringify(opened)}`);
                } else {
                    check(!strip.headShown && strip.bodyShown, `${width} 넓은 화면 안내 카드가 접혀 있습니다: ${JSON.stringify(strip)}`);
                }
            }
            const card = await page.evaluate(() => {
                const el = document.querySelector('.work-setup');
                if (!el) return null;
                const text = el.querySelector('.work-setup-text');
                const save = [...el.querySelectorAll('button')].find((b) => b.innerText.trim() === '저장');
                const later = [...el.querySelectorAll('button')].find((b) => b.innerText.trim() === '다음에');
                const box = el.getBoundingClientRect();
                const inside = [...el.querySelectorAll('button, input')].every((c) => { const r = c.getBoundingClientRect(); return (r.width === 0 && r.height === 0) || r.left >= box.left - 0.5 && r.right <= box.right + 0.5; });
                const hero = document.querySelector('.home-hero')?.getBoundingClientRect();
                return {
                    text: text?.innerText.trim() || '',
                    lines: text ? Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)) : 0,
                    start: el.querySelector('input[aria-label="출근 시각"]')?.value,
                    end: el.querySelector('input[aria-label="퇴근 시각"]')?.value,
                    saveTap: Boolean(save?.classList.contains('tap') && save.classList.contains('primary-btn') && save.type === 'button'),
                    laterTap: Boolean(later?.classList.contains('tap') && later.classList.contains('chip')),
                    saveWidth: Math.round(save?.getBoundingClientRect().width || 0),
                    cardWidth: Math.round(box.width),
                    inside,
                    besideHero: hero ? Math.round(box.top) === Math.round(hero.top) && box.left > hero.right : false,
                    grid: document.querySelector('.home-grid')?.className || '',
                };
            });
            if (off) {
                check(!card, `${width} 쉬는 날 홈에 출퇴근 안내 카드가 보입니다.`);
                return;
            }
            check(Boolean(card), `${width} 출퇴근 시각이 없는데 홈에 안내 카드가 없습니다.`);
            if (!card) return;
            check(card.text === '출근·퇴근 시각을 정하면 퇴근까지 남은 시간을 보여 드려요.' && card.lines >= 1 && card.lines <= 2, `${width} 안내 카드 문구가 두 줄을 넘거나 다릅니다: ${JSON.stringify(card)}`);
            check(card.start === '08:40' && card.end === '16:40' && !('workEnd' in await savedWork(page)), `${width} 안내 카드에 08:40·16:40이 미리 없거나 저장 전에 써 버립니다: ${JSON.stringify(card)}`);
            check(card.saveTap && card.laterTap && card.inside && card.saveWidth < 160 && card.saveWidth < card.cardWidth / 2, `${width} 안내 카드 버튼이 앱 버튼이 아니거나 카드 밖·길게 늘어납니다: ${JSON.stringify(card)}`);
            check(/has-leave/.test(card.grid) && (width < 900 || card.besideHero), `${width} 안내 카드가 타이머 자리에 없습니다: ${JSON.stringify(card)}`);
            await audit(page, `출퇴근 안내 카드 ${width}`);
            await page.screenshot({ path: resolve(shots, `home-work-setup-${width}-${mode}.png`) });
            await setTime(page, '퇴근 시각', '08:00');
            const early = await toastAfterSave(page);
            check(early.includes('퇴근 시각은 출근 시각보다 늦어야 해요.') && Boolean(await page.$('.work-setup')) && !('workEnd' in await savedWork(page)), `${width} 출근보다 이른 퇴근을 받습니다: ${early}`);
            await setTime(page, '퇴근 시각', '');
            const empty = await toastAfterSave(page);
            check(empty.includes('출근·퇴근 시각을 모두 골라 주세요.') && !('workEnd' in await savedWork(page)), `${width} 빈 퇴근 시각을 받습니다: ${empty}`);
            await setTime(page, '출근 시각', '08:30');
            await setTime(page, '퇴근 시각', '16:40');
            const ok = await toastAfterSave(page);
            await page.waitForSelector('.home-leave[data-leave="퇴근"]', { timeout: 5000 }).catch(() => {});
            const after = await page.evaluate(() => ({ card: Boolean(document.querySelector('.work-setup')), timer: document.querySelector('.home-leave[data-leave="퇴근"]')?.innerText.replace(/\s+/g, ' ') || '' }));
            const stored = await savedWork(page);
            check(ok.includes('퇴근 16:40까지') && !after.card && after.timer.includes('7시간 58분') && stored.workStart === '08:30' && stored.workEnd === '16:40' && stored.level === '초' && stored.count === 6, `${width} 저장한 뒤 타이머로 바뀌지 않습니다: ${ok} / ${JSON.stringify(after)} / ${JSON.stringify(stored)}`);
            await audit(page, `저장 뒤 타이머 ${width}`);
        });
    }
    await withPage(360, async (page) => {
        const off = await freshHome(page, 'light');
        if (off) return;
        await page.evaluate(() => [...document.querySelectorAll('.work-setup button')].find((el) => el.innerText.trim() === '다음에')?.click());
        await delay(250);
        const gone = await page.evaluate(() => ({ card: Boolean(document.querySelector('.work-setup')), key: localStorage.getItem('ssug-gyomu-work-card-off'), local: localStorage.getItem('ssug-gyomu-period-local'), grid: document.querySelector('.home-grid')?.className || '' }));
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => document.querySelector('.home-hero'));
        await delay(300);
        const reloaded = await page.evaluate(() => Boolean(document.querySelector('.work-setup')));
        check(!gone.card && gone.key === '1' && gone.local === null && !/has-leave/.test(gone.grid) && !reloaded, `'다음에'를 눌러도 카드가 남거나 다시 열면 또 보입니다: ${JSON.stringify(gone)} / 다시 열기 ${reloaded}`);
    });

    /* 퇴근 시각 없이 조퇴만 정한 날: 출근 시각이 있으면 조퇴 타이머만 뜨고 안내 띠는 함께 뜨지 않습니다. 출근 시각도 없으면 타이머가 못 뜨니 안내 띠만 남습니다(빈자리 없음). */
    for (const withStart of [true, false]) {
        await withPage(360, async (page) => {
            const off = await freshHome(page, 'light');
            if (off) return;
            await page.evaluate((ymd, withStart) => {
                localStorage.setItem('ssug-gyomu-leave-early', JSON.stringify({ [ymd]: '15:00' }));
                if (withStart) localStorage.setItem('ssug-gyomu-period-local', JSON.stringify({ ...JSON.parse(localStorage.getItem('ssug-gyomu-period-local') || '{}'), workStart: '08:30' }));
            }, todayYmd, withStart);
            await page.reload({ waitUntil: 'domcontentloaded' });
            await page.waitForFunction(() => document.querySelector('.home-hero'));
            await delay(300);
            const both = await page.evaluate(() => ({ timer: document.querySelector('.home-leave[data-leave]')?.innerText.replace(/\s+/g, ' ') || '', card: Boolean(document.querySelector('.work-setup')), count: document.querySelectorAll('.home-leave').length }));
            if (withStart) check(both.timer.includes('15:00') && !both.card && both.count === 1, `출근만 정하고 조퇴한 날 타이머와 안내 카드가 함께 뜨거나 타이머가 없습니다: ${JSON.stringify(both)}`);
            else check(!both.timer && both.card && both.count === 1, `출퇴근 시각 없이 조퇴만 정한 날 홈에 타이머도 안내 띠도 없습니다: ${JSON.stringify(both)}`);
        });
    }

    /* 데모(?demo=1)에는 출퇴근 08:40·16:40이 있어 평일 08:42에 타이머가 보입니다. 이 기기 설정에는 쓰지 않습니다. */
    await withDemo(390, 'light', async (page) => {
        await delay(250);
        const demo = await page.evaluate(() => ({
            off: (document.querySelector('.home-hero')?.innerText || '').includes('오늘은 수업이 없어요'),
            timer: document.querySelector('.home-leave[data-leave="퇴근"]')?.innerText.replace(/\s+/g, ' ') || '',
            card: Boolean(document.querySelector('.work-setup')),
            local: localStorage.getItem('ssug-gyomu-period-local'),
        }));
        if (demo.off) check(!demo.timer && !demo.card, `쉬는 날 데모 홈에 타이머나 안내 카드가 보입니다: ${JSON.stringify(demo)}`);
        else check(demo.timer.includes('7시간 58분') && demo.timer.includes('출근 08:40') && !demo.card, `데모 홈에 퇴근 타이머가 없습니다: ${JSON.stringify(demo)}`);
        check(!demo.local || !/workEnd":"\d/.test(demo.local), `데모 출퇴근 시각을 이 기기 설정에 씁니다: ${demo.local}`);
    });

    /* 휴대폰 첫 화면 시간표(이번 수정의 핵심): 데모 타이머 홈과 안내 띠 홈 모두, 오늘 시간표 카드가 타이머·띠 위에 있고
       시간표 카드 전체(제목, 펼쳤으면 1~6교시 칸 모두)가 탭바 위 첫 화면에 보여야 합니다. 소리 팁 검사와 따로 봅니다.
       데모 타이머 홈은 타이머 큰 숫자도 탭바에 걸리지 않고 키캡 바탕이 칠해져 있어야 하고(대비), 안내 띠 홈은 띠를 펼치면 저장 단추가 탭바 위로 보여야 합니다. */
    const timeFirstScreen = (page) => page.evaluate(() => {
        const box = (el) => { const r = el?.getBoundingClientRect(); return r && r.height > 0 ? r : null; };
        const card = document.querySelector('.home-time');
        const cardBox = box(card);
        const title = box(card?.querySelector('.fold-head')) || box(card?.querySelector('.fold-title'));
        const cells = [...(card?.querySelectorAll('.period-row button') || [])].map(box);
        /* 640px 이하에서는 키캡 대신 맨 위 줄(.fuse-face)이 타이머입니다. 줄은 맨 위에 고정되니 시간표 카드 위에 있고 카드와 겹치지 않아야 합니다. */
        const strip = box(document.querySelector('.fuse-face'));
        const big = box(document.querySelector('.home-leave .leave-big')) || box(document.querySelector('.fuse-face .fuse-v'));
        const key = box(document.querySelector('.home-leave .leave-key')) ? document.querySelector('.home-leave .leave-key') : document.querySelector('.fuse-face');
        const lead = box(document.querySelector('.home-leave')) || strip;
        const tab = box(document.querySelector('.tabbar'));
        const tabTop = tab ? tab.top : window.innerHeight;
        const fab = box(document.querySelector('.tabbar .fab'));
        const open = card?.dataset.open === '1';
        return {
            off: (document.querySelector('.home-hero')?.innerText || '').includes('오늘은 수업이 없어요'),
            open,
            lead: lead ? Math.round(lead.top) : -1,
            strip: strip ? Math.round(strip.bottom) : -1,
            cardTop: Math.round(cardBox?.top ?? -1),
            cardBottom: Math.round(cardBox?.bottom ?? -1),
            titleBottom: Math.round(title?.bottom ?? -1),
            cells: cells.length,
            cellsBottom: cells.length && cells.every(Boolean) ? Math.round(Math.max(...cells.map((r) => r.bottom))) : -1,
            bigBottom: Math.round(big?.bottom ?? -1),
            keyPaint: key ? getComputedStyle(key).backgroundColor : '',
            tabTop: Math.round(tabTop),
            coverTop: Math.round(Math.min(tabTop, fab ? fab.top : tabTop)),
        };
    });
    const timeOk = (t) => t.cardTop >= 0 && t.lead >= 0 && (t.strip >= 0 ? t.strip <= t.cardTop : t.cardTop < t.lead)
        && t.titleBottom > 0 && t.titleBottom <= t.tabTop
        && t.cardBottom > 0 && t.cardBottom <= t.tabTop
        && (!t.open || (t.cells === 6 && t.cellsBottom > 0 && t.cellsBottom <= t.tabTop));
    for (const folded of [false, true]) {
        foldPreset = !folded;
        try {
            for (const width of [360, 390]) {
                const label = `${width} ${folded ? '시간표 접힘' : '시간표 펼침'}`;
                await withDemo(width, 'light', async (page) => {
                    await delay(250);
                    const t = await timeFirstScreen(page);
                    if (!t.off) check(t.open === !folded && timeOk(t), `${label} 데모 타이머 홈 첫 화면에 시간표 카드(제목·1~6교시)가 타이머 위로 다 보이지 않습니다: ${JSON.stringify(t)}`);
                    if (!t.off) check(t.bigBottom > 0 && t.bigBottom <= t.coverTop, `${label} 데모 타이머 홈 첫 화면에서 타이머 큰 숫자가 탭바나 가운데 쨈 단추에 걸립니다: ${JSON.stringify(t)}`);
                    if (!t.off) check(t.keyPaint && t.keyPaint !== 'rgba(0, 0, 0, 0)' && t.keyPaint !== 'transparent', `${label} 데모 타이머 첫 화면 키캡 바탕이 칠해지지 않아 숫자 대비가 무너집니다: ${JSON.stringify(t)}`);
                });
                await withPage(width, async (page) => {
                    const off = await freshHome(page, 'light');
                    const t = await timeFirstScreen(page);
                    if (!off) check(t.open === !folded && timeOk(t), `${label} 안내 띠 홈 첫 화면에 시간표 카드(제목·1~6교시)가 띠 위로 다 보이지 않습니다: ${JSON.stringify(t)}`);
                    if (!off) {
                        await page.click('.work-setup .work-setup-strip');
                        await page.waitForFunction(() => document.querySelector('.work-setup')?.dataset.open === '1', { timeout: 15000 });
                        await delay(400);
                        const save = await page.evaluate(() => {
                            const r = document.querySelector('.work-setup .primary-btn')?.getBoundingClientRect();
                            const tab = document.querySelector('.tabbar')?.getBoundingClientRect();
                            return { top: Math.round(r?.top ?? -1), bottom: Math.round(r?.bottom ?? -1), height: Math.round(r?.height ?? 0), tabTop: Math.round(tab && tab.height > 0 ? tab.top : innerHeight) };
                        });
                        check(save.height > 0 && save.top >= 0 && save.bottom <= save.tabTop, `${label} 안내 띠를 펼치면 저장 단추가 탭바 위로 보이지 않습니다: ${JSON.stringify(save)}`);
                    }
                });
            }
        } finally {
            foldPreset = true;
        }
    }

    /* 회의록: Enter는 줄바꿈만, 저장은 저장 버튼으로만, 임시 저장은 새로 고쳐도 남고, 옛 회의록(#38)도 보입니다. */
    const minutesShots = resolve(shots, 'minutes');
    mkdirSync(minutesShots, { recursive: true });
    const minutesCount = (page) => page.evaluate(() => document.querySelectorAll('.minutes-item').length);
    await withDemo(390, 'light', async (page) => {
        await page.evaluate(() => localStorage.removeItem('ssug-gyomu-minutes-draft'));
        /* 쨈 빠른 입력의 '회의' 칩: 적던 한 줄이 제목이 되고, 저장되지 않은 채 쓰기 화면이 열립니다. */
        await page.evaluate(() => [...document.querySelectorAll('[aria-label="쨈 빠른 입력 열기"]')].find((el) => el.getBoundingClientRect().width > 0)?.click());
        await page.waitForSelector('.quick-bar.is-open input, .quick-bar.is-open textarea');
        await page.type('.quick-bar.is-open input, .quick-bar.is-open textarea', '학년 협의회');
        const meetChip = await page.evaluate(() => {
            const el = document.querySelector('.quick-bar.is-open .quick-chip[data-kind="회의"]');
            const r = el?.getBoundingClientRect();
            return r ? { w: r.width, h: r.height } : null;
        });
        check(meetChip && meetChip.w >= 44 && meetChip.h >= 44, `쨈 '회의' 칩이 없거나 44px 미만입니다: ${JSON.stringify(meetChip)}`);
        await controlBoxes(page, '.quick-bar.is-open .quick-chip', '쨈 분류 칩 390');
        await page.evaluate(() => document.querySelector('.quick-bar.is-open .quick-chip[data-kind="회의"]')?.click());
        await page.waitForSelector('[data-screen="minutes-editor"]');
        check(await page.$eval('#minutes-title', (el) => el.value) === '학년 협의회', '쨈에 적던 글이 회의 제목으로 오지 않습니다.');
        check((await page.evaluate(() => location.hash)) === '#/minutes/new', '쨈 회의 칩이 새 회의록 주소를 열지 않습니다.');

        /* 본문에 Enter: 줄바꿈만 되고 저장·분류되지 않습니다. */
        await page.click('#minutes-text');
        await page.keyboard.type('안건');
        await page.keyboard.press('Enter');
        await page.keyboard.type('- 체험학습 장소 정하기');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Enter');
        await page.keyboard.type('결정');
        await page.keyboard.down('Shift'); await page.keyboard.press('Enter'); await page.keyboard.up('Shift');
        await page.keyboard.type('- 과학관');
        const typed = await page.$eval('#minutes-text', (el) => el.value);
        check(typed === '안건\n- 체험학습 장소 정하기\n\n결정\n- 과학관', `회의록 본문에서 Enter가 줄바꿈이 아닙니다: ${JSON.stringify(typed)}`);
        check(await page.$('[data-screen="minutes-editor"]') && (await page.evaluate(() => location.hash)) === '#/minutes/new', 'Enter를 누르자 회의록 쓰기 화면을 떠났습니다(저장·분류).');
        /* 날짜: 달력에서 한 번 눌러 고릅니다(드롭다운·스크롤 피커 없음). */
        check(!(await page.$('[data-screen="minutes-editor"] select')), '회의록 화면에 드롭다운(select)이 있습니다.');
        const picked = await page.evaluate(() => {
            const cells = [...document.querySelectorAll('[data-screen="minutes-editor"] [aria-label="날짜"] button')].filter((el) => !el.disabled && el.innerText.trim() === '20');
            cells[0]?.click();
            return cells.length;
        });
        check(picked >= 1, '회의록 달력에서 날짜를 누를 수 없습니다.');
        await page.waitForFunction(() => document.querySelector('[data-role="minutes-date"]')?.innerText.includes('20일'));
        await page.type('#minutes-attendees', '1학년 담임');
        await delay(500);
        const draft = await page.evaluate(() => JSON.parse(localStorage.getItem('ssug-gyomu-minutes-draft') || '{}').new || null);
        check(draft && draft.text === typed && draft.title === '학년 협의회' && draft.attendees === '1학년 담임', `회의록 임시 저장이 안 됩니다: ${JSON.stringify(draft)}`);
        await page.screenshot({ path: resolve(minutesShots, 'editor-typed-390-light.png'), fullPage: true });

        /* 새로 고쳐도(데모는 기록을 다시 깔지만) 쓰던 회의록은 남아 있습니다. */
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.waitForSelector('[data-ready="1"]');
        await delay(300);
        await page.evaluate(() => { location.hash = '#/minutes'; });
        await page.waitForSelector('[data-screen="minutes-list"]');
        check(await page.evaluate(() => document.body.innerText.includes('쓰다 만 회의록이 있어요')), '목록에 쓰다 만 회의록 안내가 없습니다.');
        check(await page.evaluate(() => [...document.querySelectorAll('.minutes-item')].some((el) => el.dataset.id === 'meet-demo-old' && el.innerText.includes('학년회의'))), '옛 회의록(meet-…)이 회의록 목록에 보이지 않습니다.');
        const before = await minutesCount(page);
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '이어 쓰기')?.click());
        await page.waitForSelector('[data-screen="minutes-editor"]');
        const restored = await page.evaluate(() => ({ title: document.querySelector('#minutes-title')?.value, text: document.querySelector('#minutes-text')?.value, who: document.querySelector('#minutes-attendees')?.value, date: document.querySelector('[data-role="minutes-date"]')?.innerText }));
        check(restored.title === '학년 협의회' && restored.text === typed && restored.who === '1학년 담임' && restored.date.includes('20일'), `새로 고친 뒤 쓰던 회의록이 돌아오지 않습니다: ${JSON.stringify(restored)}`);

        /* 저장 버튼으로만 저장 → 보기(여러 줄 그대로) */
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="minutes-editor"] button')].find((el) => el.innerText.trim() === '저장')?.click());
        await page.waitForSelector('[data-screen="minutes-view"]');
        const shown = await page.$eval('[data-role="minutes-body"]', (el) => ({ text: el.textContent, lines: el.innerText.split('\n').length, ws: getComputedStyle(el).whiteSpace }));
        check(shown.text === typed && shown.ws === 'pre-wrap' && shown.lines >= 5, `저장한 회의록이 여러 줄로 보이지 않습니다: ${JSON.stringify(shown)}`);
        check(!(await page.evaluate(() => JSON.parse(localStorage.getItem('ssug-gyomu-minutes-draft') || '{}').new)), '저장한 뒤에도 임시 저장이 남아 있습니다.');
        const savedId = await page.evaluate(() => location.hash.replace('#/minutes/', ''));
        check(/^meet-\d+$/.test(savedId), `저장한 회의록 주소가 다릅니다: ${savedId}`);
        await page.screenshot({ path: resolve(minutesShots, 'view-390-light.png'), fullPage: true });
        /* 저장한 뒤 뒤로 가기는 빈 새 회의록이 아니라 목록으로 갑니다. */
        await page.goBack();
        await page.waitForFunction(() => location.hash !== '#/minutes/new' && document.querySelector('[data-screen="minutes-list"]'), { timeout: 5000 }).catch(() => {});
        check((await page.evaluate(() => location.hash)) === '#/minutes' && await page.$('[data-screen="minutes-list"]'), `저장 뒤 뒤로 가기가 목록이 아닙니다: ${await page.evaluate(() => location.hash)}`);
        await page.evaluate((id) => { location.hash = `#/minutes/${id}`; }, savedId);
        await page.waitForSelector('[data-screen="minutes-view"]');

        /* 고치기: id 그대로, 본문에 줄 추가 */
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="minutes-view"] button')].find((el) => el.innerText.trim() === '고치기')?.click());
        await page.waitForSelector('[data-screen="minutes-editor"]');
        await page.focus('#minutes-text');
        await page.evaluate(() => { const el = document.querySelector('#minutes-text'); el.setSelectionRange(el.value.length, el.value.length); });
        await page.keyboard.press('Enter');
        await page.keyboard.type('할 일: 동의서');
        /* 고치다 남긴 임시본도 목록에 '이어 쓰기'가 보입니다. */
        await delay(450);
        await page.evaluate(() => { location.hash = '#/minutes'; });
        await page.waitForSelector('[data-screen="minutes-list"]');
        check(await page.$(`[data-draft-for="${savedId}"]`), '고치던 회의록의 이어 쓰기가 목록에 없습니다.');
        await page.evaluate((id) => [...document.querySelectorAll(`[data-draft-for="${id}"] button`)].find((el) => el.innerText.trim() === '이어 쓰기')?.click(), savedId);
        await page.waitForSelector('[data-screen="minutes-editor"]');
        check((await page.evaluate(() => location.hash)) === `#/minutes/${savedId}/edit` && (await page.$eval('#minutes-text', (el) => el.value)).endsWith('할 일: 동의서'), '이어 쓰기로 고치던 내용이 돌아오지 않습니다.');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="minutes-editor"] button')].find((el) => el.innerText.trim() === '저장')?.click());
        await page.waitForSelector('[data-screen="minutes-view"]');
        check((await page.evaluate(() => location.hash)) === `#/minutes/${savedId}`, '고친 회의록의 id가 바뀌었습니다.');
        check((await page.$eval('[data-role="minutes-body"]', (el) => el.textContent)) === `${typed}\n할 일: 동의서`, '고친 회의록 본문이 다릅니다.');
        await page.evaluate(() => { location.hash = '#/minutes'; });
        await page.waitForSelector('[data-screen="minutes-list"]');
        check((await minutesCount(page)) === before + 1, `회의록 개수가 맞지 않습니다(고치기가 새로 하나를 더 만들었을 수 있음): ${before} → ${await minutesCount(page)}`);

        /* 지우기: 한 번 확인 뒤에만 지웁니다. 그만두기를 누르면 그대로 있습니다. */
        await page.evaluate((id) => { location.hash = `#/minutes/${id}`; }, savedId);
        await page.waitForSelector('[data-screen="minutes-view"]');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="minutes-view"] button')].find((el) => el.innerText.trim() === '지우기')?.click());
        await page.waitForSelector('.minutes-confirm');
        await page.screenshot({ path: resolve(minutesShots, 'delete-confirm-390-light.png') });
        await page.evaluate(() => [...document.querySelectorAll('.minutes-confirm button')].find((el) => el.innerText.trim() === '그만두기')?.click());
        await page.waitForFunction(() => !document.querySelector('.minutes-confirm'));
        check(await page.$('[data-screen="minutes-view"]'), '그만두기를 눌렀는데 회의록이 사라졌습니다.');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="minutes-view"] button')].find((el) => el.innerText.trim() === '지우기')?.click());
        await page.waitForSelector('.minutes-confirm');
        await page.evaluate(() => [...document.querySelectorAll('.minutes-confirm button')].find((el) => el.innerText.trim() === '지우기')?.click());
        await page.waitForSelector('[data-screen="minutes-list"]');
        check((await minutesCount(page)) === before, '확인한 뒤에도 회의록이 지워지지 않았습니다.');
        check(await page.evaluate(() => [...document.querySelectorAll('.minutes-item')].some((el) => el.dataset.id === 'meet-demo-old')), '다른 회의록을 지우자 옛 회의록까지 사라졌습니다.');
        /* 할 일·메모 화면에는 회의록이 섞이지 않고, 회의록으로 가는 단추가 있습니다. */
        await page.evaluate(() => { location.hash = '#/todo'; });
        await page.waitForFunction(() => document.body.innerText.includes('회의록 열기'));
        check(!(await page.evaluate(() => [...document.querySelectorAll('article')].some((el) => el.innerText.includes('현장체험학습 안전 교육')))), '할 일·메모의 메모 목록에 회의록이 섞여 있습니다.');
    }, 844);

    /* 폭·밝기별 겹침·44px: 목록, 보기, 쓰기(달력 포함). 메뉴에 회의록이 보이고 켜집니다. */
    for (const mode of ['light', 'dark']) {
        for (const width of [390, 360, 900, 1920]) {
            await withDemo(width, mode, async (page) => {
                await page.evaluate(() => localStorage.removeItem('ssug-gyomu-minutes-draft'));
                await page.evaluate(() => { location.hash = '#/minutes'; });
                await page.waitForSelector('[data-screen="minutes-list"] .minutes-item');
                if (width >= 900) {
                    const menuOn = await page.evaluate(() => [...document.querySelectorAll('.side a, .side button')].some((el) => el.innerText.trim() === '회의록' && (el.getAttribute('aria-current') === 'page' || el.className.includes('on'))));
                    check(menuOn, `${width} ${mode} 넓은 화면 메뉴에 회의록이 없거나 켜지지 않습니다.`);
                }
                await audit(page, `회의록 목록 ${width} ${mode}`);
                await page.screenshot({ path: resolve(minutesShots, `list-${width}-${mode}.png`) });
                await page.evaluate(() => document.querySelector('.minutes-item[data-id="meet-demo-old"]')?.click());
                await page.waitForSelector('[data-screen="minutes-view"]');
                await audit(page, `회의록 보기 ${width} ${mode}`);
                await controlBoxes(page, '[data-screen="minutes-view"] button', `회의록 보기 단추 ${width} ${mode}`);
                await page.screenshot({ path: resolve(minutesShots, `view-old-${width}-${mode}.png`) });
                await page.evaluate(() => { location.hash = '#/minutes/new'; });
                await page.waitForSelector('[data-screen="minutes-editor"]');
                await page.type('#minutes-title', '교과 협의회 — 아주 긴 제목이 들어가도 줄이 넘치지 않는지 봅니다');
                await page.type('#minutes-text', '첫 줄\n둘째 줄\n셋째 줄');
                await audit(page, `회의록 쓰기 ${width} ${mode}`);
                await controlBoxes(page, '[data-screen="minutes-editor"] .minutes-kinds button', `회의 종류 칩 ${width} ${mode}`);
                await controlBoxes(page, '[data-screen="minutes-editor"] [aria-label="날짜"] button', `회의록 달력 ${width} ${mode}`);
                await controlBoxes(page, '[data-screen="minutes-editor"] .minutes-save-row button', `회의록 저장 줄 ${width} ${mode}`);
                const fields = await page.evaluate(() => ['#minutes-title', '#minutes-attendees', '#minutes-text'].map((sel) => {
                    const r = document.querySelector(sel).getBoundingClientRect();
                    return [sel, Math.round(r.height), Math.round(r.right), document.documentElement.clientWidth];
                }));
                check(fields.every(([, h, right, cw]) => h >= 44 && right <= cw + 1), `${width} ${mode} 회의록 입력칸이 작거나 넘칩니다: ${JSON.stringify(fields)}`);
                await page.screenshot({ path: resolve(minutesShots, `editor-${width}-${mode}.png`), fullPage: true });
                await page.evaluate(() => localStorage.removeItem('ssug-gyomu-minutes-draft'));
            }, width >= 900 ? 900 : 844);
        }
    }
    /* 출결 저장 단추: 메모·서류를 적고 저장 → 알림, 저장 안 하고 닫으면 한 번 묻기, 앱을 닫았다 열어도 고친 값이 남기 */
    for (const width of [390, 1920]) {
        await withDemo(width, 'light', async (page) => {
            const tapSeat = () => page.evaluate(() => document.querySelector('.cell-grid button')?.click());
            const tap = (label) => page.evaluate((label) => {
                const el = [...document.querySelectorAll('[data-screen="attend-status"] button')].find((b) => b.innerText.trim() === label && b.getBoundingClientRect().width > 0);
                el?.click();
                return Boolean(el);
            }, label);
            await page.evaluate(() => { location.hash = '#/attend'; });
            await page.waitForSelector('.cell-grid button');
            await tapSeat();
            await page.waitForSelector('[data-screen="attend-status"]');
            check(await tap('지각'), `${width} 출결 시트에 지각이 없습니다.`);
            await page.waitForSelector('[aria-label="메모"]');
            const box = await page.$eval('[aria-label="출결 저장"]', (el) => { const r = el.getBoundingClientRect(); return { h: r.height, w: r.width, cls: el.className }; }).catch(() => null);
            check(box && box.h >= 44 && /primary-btn/.test(box.cls), `${width} 출결 저장 단추가 없거나 44px보다 작습니다: ${JSON.stringify(box)}`);
            await page.type('[aria-label="메모"]', '버스 늦음');
            await tap('서류 아직');
            /* 저장 안 하고 닫으려 하면 한 번 묻습니다. 취소하면 시트가 남습니다. */
            const asks = [];
            const onDialog = async (dialog) => { asks.push(dialog.message()); await dialog.dismiss(); };
            page.on('dialog', onDialog);
            await page.keyboard.press('Escape');
            await delay(200);
            page.off('dialog', onDialog);
            check(asks.length === 1 && asks[0].includes('저장하지 않고'), `${width} 저장 안 한 출결을 닫을 때 묻지 않습니다: ${JSON.stringify(asks)}`);
            check(await page.$('[data-screen="attend-status"]'), `${width} 닫기를 취소했는데 시트가 닫혔습니다.`);
            if (width === 390) await page.screenshot({ path: resolve(shots, 'attend-save-390.png') });
            await page.click('[aria-label="출결 저장"]');
            await page.waitForFunction(() => !document.querySelector('[data-screen="attend-status"]'));
            await page.waitForFunction(() => document.querySelector('.toast')?.innerText.includes('저장됐어요'), { timeout: 5000 }).catch(() => {});
            const toastText = await page.evaluate(() => document.querySelector('.toast')?.innerText || '');
            check(toastText.includes('저장됐어요'), `${width} 저장 뒤 '저장됐어요' 알림이 없습니다: ${toastText}`);
            if (width === 390) await page.screenshot({ path: resolve(shots, 'attend-saved-390.png') });
            /* 앱을 바로 닫았다가 다시 엽니다. */
            const context = page.browserContext();
            await page.close({ runBeforeUnload: false });
            const again = await context.newPage();
            await pinBrowserClock(again);
            await again.setViewport({ width, height: 800, deviceScaleFactor: 1 });
            await again.goto(`${origin}?at=08:42&mode=light#/attend`, { waitUntil: 'domcontentloaded' });
            await again.waitForSelector('.cell-grid button');
            await delay(300);
            const kept = await again.evaluate(() => ({ seat: document.querySelector('.cell-grid button')?.innerText || '', side: document.querySelector('.attend-layout aside')?.innerText || '' }));
            check(kept.seat.includes('지각') && kept.side.includes('버스 늦음'), `${width} 닫았다 연 뒤 고친 출결이 남지 않았습니다: ${JSON.stringify(kept)}`);
            if (width === 390) await again.screenshot({ path: resolve(shots, 'attend-reopen-390.png') });
            /* 메모만 적고 앱을 숨기면(휴대폰에서 닫기) 이 기기에 먼저 남깁니다. */
            await again.evaluate(() => document.querySelector('.cell-grid button')?.click());
            await again.waitForSelector('[data-screen="attend-status"]');
            await again.evaluate(() => [...document.querySelectorAll('[data-screen="attend-status"] button')].find((b) => b.innerText.trim() === '지각')?.click());
            await again.waitForSelector('[aria-label="메모"]');
            await again.$eval('[aria-label="메모"]', (el) => { el.select?.(); });
            await again.keyboard.press('Backspace');
            await again.type('[aria-label="메모"]', '숨김 저장');
            /* 입력 0.3초가 지나기 전에 숨기고 곧바로 닫습니다(숨김 처리만으로 남아야 함). */
            await again.evaluate(() => window.dispatchEvent(new Event('pagehide')));
            await again.close({ runBeforeUnload: false });
            const third = await context.newPage();
            await pinBrowserClock(third);
            await third.setViewport({ width, height: 800, deviceScaleFactor: 1 });
            await third.goto(`${origin}?at=08:42&mode=light#/attend`, { waitUntil: 'domcontentloaded' });
            await third.waitForSelector('.cell-grid button');
            await delay(300);
            const hidden = await third.evaluate(() => document.querySelector('.attend-layout aside')?.innerText || '');
            check(hidden.includes('숨김 저장'), `${width} 앱을 닫을 때 적던 출결 메모가 사라졌습니다: ${hidden.slice(0, 200)}`);
            /* 숨김 알림 없이 바로 꺼져도(강제 종료) 입력 0.3초 뒤면 이 기기에 남아 있어야 합니다. */
            await third.evaluate(() => document.querySelector('.cell-grid button')?.click());
            await third.waitForSelector('[data-screen="attend-status"]');
            await third.evaluate(() => [...document.querySelectorAll('[data-screen="attend-status"] button')].find((b) => b.innerText.trim() === '지각')?.click());
            await third.waitForSelector('[aria-label="메모"]');
            await third.$eval('[aria-label="메모"]', (el) => { el.select?.(); });
            await third.keyboard.press('Backspace');
            await third.type('[aria-label="메모"]', '바로 꺼짐');
            await delay(700);
            /* 숨김 알림 없이도 0.3초 뒤 이 기기 임시본에 남아 있어야 합니다. */
            const draftNow = await third.evaluate(() => localStorage.getItem('ssug-gyomu-attend-draft') || '');
            check(draftNow.includes('바로 꺼짐'), `${width} 입력 0.3초 뒤 출결 메모가 기기에 남지 않았습니다: ${draftNow.slice(0, 200)}`);
            /* 숨김·닫기 알림이 오기 전에 이미 기기에 있어야 하므로, 닫지 않은 채 새 창으로 엽니다. */
            const fourth = await context.newPage();
            await pinBrowserClock(fourth);
            await fourth.setViewport({ width, height: 800, deviceScaleFactor: 1 });
            await fourth.goto(`${origin}?at=08:42&mode=light#/attend`, { waitUntil: 'domcontentloaded' });
            await fourth.waitForSelector('.cell-grid button');
            await delay(300);
            const killed = await fourth.evaluate(() => document.querySelector('.attend-layout aside')?.innerText || '');
            await third.close({ runBeforeUnload: false });
            check(killed.includes('바로 꺼짐'), `${width} 입력한 출결 메모가 바로 꺼졌을 때 사라졌습니다(입력 즉시 저장 안 됨): ${killed.slice(0, 200)}`);
            /* 저장하지 않고 닫기를 고르면 시트가 닫히고, 적던 메모는 처음 값으로 돌아갑니다. */
            await fourth.evaluate(() => document.querySelector('.cell-grid button')?.click());
            await fourth.waitForSelector('[data-screen="attend-status"]');
            await fourth.evaluate(() => [...document.querySelectorAll('[data-screen="attend-status"] button')].find((b) => b.innerText.trim() === '지각')?.click());
            await fourth.waitForSelector('[aria-label="메모"]');
            await fourth.type('[aria-label="메모"]', ' 버릴 메모');
            await delay(500);
            const accepted = [];
            fourth.on('dialog', async (dialog) => { accepted.push(dialog.message()); await dialog.accept(); });
            await fourth.keyboard.press('Escape');
            await delay(400);
            const after = await fourth.evaluate(() => ({ open: Boolean(document.querySelector('[data-screen="attend-status"]')), side: document.querySelector('.attend-layout aside')?.innerText || '' }));
            check(accepted.length === 1 && !after.open && !after.side.includes('버릴 메모') && after.side.includes('바로 꺼짐'), `${width} 저장하지 않고 닫기가 묻지 않거나 적던 메모를 되돌리지 않습니다: ${JSON.stringify({ accepted, after: { ...after, side: after.side.slice(0, 120) } })}`);
            await fourth.close({ runBeforeUnload: false });
        });
    }
    /* 넓은 화면도 모바일처럼: 쨈 버튼을 누르면 쨈이 튀며 팝업이 열리고, ✕·바깥 누르기·Esc로 닫힙니다. 4개 폭·라이트/다크에서 겹침도 봅니다. */
    for (const mode of ['light', 'dark']) {
        for (const width of [360, 390, 900, 1920]) {
            await withDemo(width, mode, async (page) => {
                const sel = width >= 900 ? '.desk-fab' : '.tabbar .fab';
                const look = () => page.evaluate((sel) => {
                    const bar = document.querySelector('.quick-bar');
                    const r = bar.getBoundingClientRect();
                    const inner = [...bar.querySelectorAll('button, textarea, input')].filter((el) => el.getBoundingClientRect().width > 0).map((el) => el.getBoundingClientRect());
                    const fab = document.querySelector(sel).getBoundingClientRect();
                    const hit = (a, b) => a.x < b.right - 1 && b.x < a.right - 1 && a.y < b.bottom - 1 && b.y < a.bottom - 1;
                    const pairs = inner.some((a, i) => inner.some((b, j) => j > i && hit(a, b)));
                    return { open: bar.classList.contains('is-open'), pop: document.querySelector(sel).classList.contains('is-popping'), inView: r.x >= 0 && r.right <= innerWidth + 1 && r.y >= 0, overlap: pairs || inner.some((a) => hit(a, fab)) };
                }, sel);
                for (const how of ['close', 'outside', 'esc']) {
                    await page.click(sel);
                    await delay(150);
                    const opened = await look();
                    check(opened.open && opened.pop && opened.inView && !opened.overlap, `${width} ${mode} 쨈 버튼이 팝업을 열지 않거나(튐 포함) 겹칩니다: ${JSON.stringify(opened)}`);
                    if (how === 'close') await page.screenshot({ path: resolve(shots, `jam-popup-${width}-${mode}.png`) });
                    await delay(450);
                    if (how === 'close') await page.click('.quick-close');
                    if (how === 'outside') await page.mouse.click(width - 6, 6);
                    if (how === 'esc') await page.keyboard.press('Escape');
                    await delay(250);
                    check(!(await look()).open, `${width} ${mode} 쨈 팝업이 ${how}로 닫히지 않습니다.`);
                }
                if (width === 900) {
                    const squeezed = await page.evaluate(() => [...document.querySelectorAll('.home-grid > *')].filter((el) => el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().width < 240).map((el) => el.className));
                    check(!squeezed.length, `900 홈 카드가 너무 좁게 눌립니다: ${squeezed.join(', ')}`);
                }
            });
        }
    }
    /* 퇴근 타이머 숫자 대비(641px 이상): 키캡(.leave-key) 바탕 위 흰 글자가 모든 키보드 테마 × 밝은·어두운 화면 × 퇴근·조퇴에서 4.5:1을 넘어야 합니다.
       글자를 지운 키캡 화면을 찍어, 글자 자리의 가장 밝은(대비가 가장 낮은) 점과 글자색을 비교합니다. 바탕이 투명해지면 1.3:1 안팎으로 떨어집니다.
       평일(2026-10-26 월 15:20)로 따로 고정하므로 날짜와 상관없는 검사라, 브라우저 시계 날짜마다 되풀이하지 않고 기본 날짜에서 한 번만 돌립니다. */
    if (todayYmd === '2026-10-23') {
        const lowest = [];
        for (const theme of ['mx', 'retro', 'slim', 'puff', 'jelly', 'type']) {
            for (const mode of ['light', 'dark']) {
                /* 640px 이하에서는 키캡 대신 맨 위 줄(FuseBar)이 보이므로, 키캡은 그보다 넓은 720에서 봅니다. 맨 위 줄 대비는 아래에서 따로 봅니다. */
                await withPage(720, async (page) => {
                    await page.evaluateOnNewDocument((theme) => {
                        const fixed = new Date('2026-10-26T15:20:00+09:00').valueOf();
                        const Native = Date;
                        function Weekday(...args) {
                            if (!new.target) return new Native(fixed).toString();
                            return args.length ? new Native(...args) : new Native(fixed);
                        }
                        Weekday.now = () => fixed;
                        Weekday.parse = Native.parse;
                        Weekday.UTC = Native.UTC;
                        Weekday.prototype = Native.prototype;
                        window.Date = Weekday;
                        if (!sessionStorage.getItem('leave-contrast-seeded')) {
                            sessionStorage.setItem('leave-contrast-seeded', '1');
                            localStorage.setItem('ssug-gyomu-kb-theme', theme);
                            localStorage.setItem('ssug-gyomu-period-local', JSON.stringify({ workStart: '08:40', workEnd: '16:40' }));
                        }
                    }, theme);
                    await page.goto(`${origin}?demo=1&at=15:20&mode=${mode}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                    for (const state of ['퇴근', '조퇴']) {
                        if (state === '조퇴') {
                            await page.evaluate(() => localStorage.setItem('ssug-gyomu-leave-early', JSON.stringify({ '2026-10-26': '16:00' })));
                            await page.reload({ waitUntil: 'domcontentloaded' });
                        }
                        await page.waitForSelector(`.home-leave[data-leave="${state}"] .leave-key .leave-big`, { timeout: 15000 });
                        await page.waitForFunction((theme) => (document.documentElement.getAttribute('data-kb') || 'mx') === theme, { timeout: 15000 }, theme);
                        await page.evaluate(() => document.fonts.ready);
                        const key = await page.$('.leave-key');
                        /* 키캡 토큰이 빠지면 바탕이 비쳐 어두운 화면에서도 키캡 모양이 사라집니다. 바탕색과 그라데이션이 칠해졌는지 봅니다. */
                        const paint = await key.evaluate((el) => ({ color: getComputedStyle(el).backgroundColor, image: getComputedStyle(el).backgroundImage }));
                        check(paint.color !== 'rgba(0, 0, 0, 0)' && paint.color !== 'transparent' && paint.image.includes('linear-gradient'), `${theme} ${mode} ${state} 타이머 키캡 바탕이 칠해지지 않습니다: ${JSON.stringify(paint)}`);
                        const texts = await key.evaluate((el) => {
                            const r = el.getBoundingClientRect();
                            return [...el.querySelectorAll('.leave-small, .leave-big')].map((t) => {
                                const b = t.getBoundingClientRect();
                                return { text: t.textContent, color: getComputedStyle(t).color, x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height };
                            });
                        });
                        const hide = await page.addStyleTag({ content: '.leave-key, .leave-key * { color: transparent !important; text-shadow: none !important; }' });
                        await delay(80);
                        const bare = await key.screenshot({ encoding: 'base64' });
                        await hide.evaluate((el) => el.remove());
                        const ratios = await page.evaluate(async (b64, texts) => {
                            const img = new Image();
                            img.src = `data:image/png;base64,${b64}`;
                            await img.decode();
                            const canvas = document.createElement('canvas');
                            canvas.width = img.width;
                            canvas.height = img.height;
                            const g = canvas.getContext('2d');
                            g.drawImage(img, 0, 0);
                            const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
                            const lum = (r, gr, b) => 0.2126 * lin(r) + 0.7152 * lin(gr) + 0.0722 * lin(b);
                            return texts.map((t) => {
                                const [r, gr, b] = t.color.match(/[\d.]+/g).map(Number);
                                const ink = lum(r, gr, b);
                                const data = g.getImageData(Math.max(0, Math.round(t.x)), Math.max(0, Math.round(t.y)), Math.max(1, Math.round(t.w)), Math.max(1, Math.round(t.h))).data;
                                let min = Infinity;
                                for (let i = 0; i < data.length; i += 4) {
                                    const bg = lum(data[i], data[i + 1], data[i + 2]);
                                    min = Math.min(min, (Math.max(ink, bg) + 0.05) / (Math.min(ink, bg) + 0.05));
                                }
                                return { text: t.text, ratio: Math.round(min * 100) / 100 };
                            });
                        }, bare, texts);
                        lowest.push(Math.min(...ratios.map((item) => item.ratio)));
                        check(ratios.length === 2 && ratios.every((item) => item.ratio >= 4.5), `${theme} ${mode} ${state} 타이머 숫자가 키캡 바탕과 4.5:1이 안 됩니다: ${JSON.stringify(ratios)}`);
                    }
                });
            }
        }
        console.log(`퇴근 타이머 숫자 대비 최저 ${Math.min(...lowest)}:1 (테마 6 × 밝은·어두운 × 퇴근·조퇴)`);
    }
    /* 폰 맨 위 '실 심지' 퇴근 줄(FuseBar). 평일 2026-10-26(월)로 따로 고정하므로 기본 날짜에서 한 번만 돌립니다.
       ① 줄이 보이고 남은 실 길이가 남은 시간 비율과 맞는지 ② 조퇴 날은 '조퇴까지' ③ 끝나면 초록 캡슐 ④ 움직임 줄이기면 움직임이 꺼지는지
       ⑤ 자세히 보기가 단추·Esc·포커스로 열고 닫히는지 ⑥ 1280에서는 옛 타이머 그대로인지 ⑦ 줄이 시간표·탭바·쨈 단추를 가리지 않는지
       ⑧ 6 테마 × 밝은·어두운 × 퇴근·조퇴·10분 안쪽·끝남·움직임 줄이기에서 글자 대비가 5:1을 넘는지 봅니다. */
    if (todayYmd === '2026-10-23') {
        const fuseDay = async (page, { theme = 'mx', leave = null, reduce = false } = {}) => {
            if (reduce) await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
            await page.evaluateOnNewDocument((theme, leave) => {
                const fixed = new Date('2026-10-26T15:20:00+09:00').valueOf();
                const Native = Date;
                function Weekday(...args) {
                    if (!new.target) return new Native(fixed).toString();
                    return args.length ? new Native(...args) : new Native(fixed);
                }
                Weekday.now = () => fixed;
                Weekday.parse = Native.parse;
                Weekday.UTC = Native.UTC;
                Weekday.prototype = Native.prototype;
                window.Date = Weekday;
                localStorage.setItem('ssug-gyomu-kb-theme', theme);
                localStorage.setItem('ssug-gyomu-period-local', JSON.stringify({ workStart: '08:40', workEnd: '16:40' }));
                if (leave) localStorage.setItem('ssug-gyomu-leave-early', JSON.stringify({ '2026-10-26': leave }));
                else localStorage.removeItem('ssug-gyomu-leave-early');
            }, theme, leave);
        };
        const fuseGo = async (page, at, mode = 'light') => {
            await page.goto(`${origin}?demo=1&at=${at}&mode=${mode}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForSelector('.fuse-bar', { timeout: 15000 });
            await page.evaluate(() => document.fonts.ready);
            await delay(200);
        };
        const fuseRead = (page) => page.evaluate(() => {
            const box = (el) => { const r = el?.getBoundingClientRect(); return r && r.height > 0 ? { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height } : null; };
            const bar = document.querySelector('.fuse-bar');
            const track = document.querySelector('.fuse-track');
            const live = document.querySelector('.fuse-bar .fuse-live');
            const card = document.querySelector('.home-leave[data-leave]');
            return {
                bar: box(bar),
                face: box(document.querySelector('.fuse-face')),
                state: document.querySelector('.fuse')?.dataset.state || '',
                label: bar?.dataset.fuse || '',
                frac: Number(bar?.dataset.frac),
                aria: bar?.getAttribute('aria-label') || '',
                expanded: bar?.getAttribute('aria-expanded'),
                text: document.querySelector('.fuse-text')?.innerText.replace(/\s+/g, ' ').trim() || '',
                bomb: document.querySelector('.fuse-bar .fuse-bomb')?.textContent.trim() || '',
                bombBg: getComputedStyle(document.querySelector('.fuse-bar .fuse-bomb') || document.body).backgroundColor,
                liveRatio: track && live ? live.getBoundingClientRect().width / track.getBoundingClientRect().width : 0,
                hasLive: Boolean(live),
                cardShown: Boolean(box(card)),
                padTop: parseFloat(getComputedStyle(document.querySelector('.app-frame')).paddingTop),
                anims: document.querySelector('.fuse')?.getAnimations({ subtree: true }).length ?? -1,
                sparkOpacity: Math.min(...[...document.querySelectorAll('.fuse-bar .fuse-spark')].map((el) => Number(getComputedStyle(el).opacity))),
            };
        });

        /* ① 평소: 15:20, 퇴근 16:40 → 남은 80분 / 480분. 실 길이 비율 = 1/6. */
        await withPage(360, async (page) => {
            await fuseDay(page);
            await fuseGo(page, '15:20');
            const f = await fuseRead(page);
            check(f.bar && f.face && Math.round(f.face.top) === 0 && Math.round(f.face.height) === 34 && f.bar.height >= 43.5, `360 맨 위 퇴근 줄이 없거나 34px 줄·44px 누름 크기가 아닙니다: ${JSON.stringify(f)}`);
            check(f.label === '퇴근' && f.text === '퇴근까지 1시간 20분' && f.bomb === '16:40' && !f.cardShown && f.padTop >= 34, `360 맨 위 줄 글자·캡슐·옛 키캡 숨김이 다릅니다: ${JSON.stringify(f)}`);
            check(Math.abs(f.frac - 80 / 480) < 0.002 && Math.abs(f.liveRatio - 80 / 480) < 0.03, `360 남은 실 길이가 남은 시간 비율(0.167)과 다릅니다: ${JSON.stringify(f)}`);
            check(f.aria.includes('퇴근까지 1시간 20분 남았어요') && f.aria.includes('16:40') && f.expanded === 'false', `360 맨 위 줄 읽는 이름이 다릅니다: ${f.aria}`);
            check(f.anims >= 8, `360 불꽃이 움직이지 않습니다: 움직임 ${f.anims}개`);
            /* 탭이 가려지면 불꽃을 멈춥니다. */
            const paused = await page.evaluate(async () => {
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
                document.dispatchEvent(new Event('visibilitychange'));
                await new Promise((r) => setTimeout(r, 120));
                const anims = document.querySelector('.fuse').getAnimations({ subtree: true });
                const out = { flag: document.querySelector('.fuse').dataset.paused, running: anims.filter((a) => a.playState === 'running').length };
                Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
                document.dispatchEvent(new Event('visibilitychange'));
                await new Promise((r) => setTimeout(r, 120));
                out.back = document.querySelector('.fuse').dataset.paused || '';
                return out;
            });
            check(paused.flag === '1' && paused.running === 0 && paused.back === '', `360 탭이 가려져도 불꽃이 멈추지 않습니다: ${JSON.stringify(paused)}`);
            await audit(page, '맨 위 퇴근 줄 360');
            /* 홈의 칸을 맨 위로 끌어올려도 줄 밑에 숨지 않고, 그 자리를 누르면 줄이 아니라 칸이 눌립니다. */
            const lifted = await page.evaluate(async () => {
                const max = document.scrollingElement.scrollHeight - innerHeight;
                const el = [...document.querySelectorAll('.main section, .main .card')].find((n) => { const y = n.getBoundingClientRect().top + scrollY; return y > 120 && y < max - 20; });
                if (!el) return { none: true };
                el.scrollIntoView({ block: 'start' });
                await new Promise((r) => setTimeout(r, 150));
                const r = el.getBoundingClientRect();
                const bar = document.querySelector('.fuse-bar').getBoundingClientRect().bottom;
                const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 4);
                const out = { top: Math.round(r.top), bar: Math.round(bar), under: Boolean(hit?.closest('.fuse')) };
                document.scrollingElement.scrollTop = 0;
                await new Promise((r2) => setTimeout(r2, 100));
                return out;
            });
            check(!lifted.none && lifted.top >= lifted.bar - 0.5 && lifted.top < 120 && !lifted.under, `360 위로 끌어올린 칸이 맨 위 줄 밑에 숨습니다: ${JSON.stringify(lifted)}`);

            /* ⑤ 자세히 보기: 키보드(Enter)로 열고 Esc로 닫으며 포커스가 줄로 돌아옵니다. */
            await page.focus('.fuse-bar');
            await page.keyboard.press('Enter');
            await page.waitForSelector('.fuse-panel', { timeout: 5000 });
            await delay(300);
            const opened = await page.evaluate(() => {
                const panel = document.querySelector('.fuse-panel');
                const r = panel.getBoundingClientRect();
                const tab = document.querySelector('.tabbar').getBoundingClientRect();
                const fab = document.querySelector('.tabbar .fab')?.getBoundingClientRect();
                const bar = document.querySelector('.fuse-bar');
                return {
                    expanded: bar.getAttribute('aria-expanded'),
                    controls: bar.getAttribute('aria-controls') === panel.id,
                    focusIn: panel.contains(document.activeElement),
                    text: panel.innerText.replace(/\s+/g, ' '),
                    live: panel.querySelector('[role="timer"]')?.getAttribute('aria-live'),
                    bottom: r.bottom, tabTop: tab.top, fabTop: fab ? fab.top : tab.top,
                    buttons: [...panel.querySelectorAll('button')].map((b) => ({ t: b.innerText.trim(), tap: b.classList.contains('tap') })),
                };
            });
            check(opened.expanded === 'true' && opened.controls && opened.focusIn && opened.live === 'off', `360 자세히 보기가 키보드로 열리지 않거나 포커스가 들어가지 않습니다: ${JSON.stringify(opened)}`);
            check(['오늘 퇴근 16:40', '1시간 20분 남았어요', '출근 08:40', '진행률', '83%', '출근부터', '6시간 40분', '지금은'].every((t) => opened.text.includes(t)), `360 자세히 보기 내용이 빠졌습니다: ${opened.text}`);
            check(opened.buttons.some((b) => b.t === '오늘 조퇴' && b.tap) && opened.buttons.some((b) => b.t === '접기' && b.tap), `360 자세히 보기 단추가 앱 단추(소리 나는 단추)가 아닙니다: ${JSON.stringify(opened.buttons)}`);
            check(opened.bottom <= opened.fabTop && opened.bottom <= opened.tabTop, `360 자세히 보기가 탭바나 쨈 단추를 덮습니다: ${JSON.stringify(opened)}`);
            await audit(page, '맨 위 줄 자세히 보기 360');
            await page.keyboard.press('Escape');
            await delay(250);
            const closed = await page.evaluate(() => ({ panel: Boolean(document.querySelector('.fuse-panel')), expanded: document.querySelector('.fuse-bar').getAttribute('aria-expanded'), focus: document.activeElement?.classList.contains('fuse-bar') }));
            check(!closed.panel && closed.expanded === 'false' && closed.focus, `360 Esc로 자세히 보기가 닫히지 않거나 포커스가 줄로 돌아오지 않습니다: ${JSON.stringify(closed)}`);
            await page.click('.fuse-bar');
            await page.waitForSelector('.fuse-panel', { timeout: 5000 });
            await page.evaluate(() => [...document.querySelectorAll('.fuse-panel button')].find((b) => b.innerText.trim() === '접기')?.click());
            await delay(250);
            check(!(await page.$('.fuse-panel')), '360 접기를 눌러도 자세히 보기가 닫히지 않습니다.');
        });

        /* ② 조퇴 날 16:00: '조퇴까지 40분', 남은 비율 40/440. ③ 끝난 뒤(16:50): 초록 캡슐과 '퇴근 시간이 지났어요'. 10분 안쪽(16:35)은 초 단위지만 읽는 이름은 분 단위입니다. */
        await withPage(390, async (page) => {
            await fuseDay(page, { leave: '16:00' });
            await fuseGo(page, '15:20');
            const f = await fuseRead(page);
            check(f.label === '조퇴' && f.text === '조퇴까지 40분' && f.bomb === '16:00' && Math.abs(f.frac - 40 / 440) < 0.002 && Math.abs(f.liveRatio - 40 / 440) < 0.03 && f.aria.includes('조퇴까지 40분 남았어요'), `390 조퇴 날 맨 위 줄이 다릅니다: ${JSON.stringify(f)}`);
        });
        await withPage(390, async (page) => {
            await fuseDay(page);
            await fuseGo(page, '16:35');
            const soon = await fuseRead(page);
            check(soon.state === 'soon' && soon.text === '퇴근까지 5분 00초' && soon.aria.includes('약 5분') && !/초/.test(soon.aria), `390 10분 안쪽 줄이 다르거나 읽는 이름이 초마다 바뀝니다: ${JSON.stringify(soon)}`);
            await fuseGo(page, '16:50');
            const done = await fuseRead(page);
            check(done.state === 'done' && done.text.includes('퇴근 시간이 지났어요') && done.frac === 0 && !done.hasLive && done.bombBg !== soon.bombBg && /수고/.test(done.aria), `390 끝난 줄(초록 캡슐·펑)이 다릅니다: ${JSON.stringify(done)}`);
        });

        /* ④ 움직임 줄이기: 움직임이 하나도 없고 불꽃은 멈춘 그림으로 보입니다. */
        await withPage(360, async (page) => {
            await fuseDay(page, { reduce: true });
            await fuseGo(page, '15:20');
            const f = await fuseRead(page);
            check(f.anims === 0 && f.sparkOpacity > 0.5 && f.text === '퇴근까지 1시간 20분', `360 움직임 줄이기에서도 불꽃이 움직이거나 그림이 사라집니다: ${JSON.stringify(f)}`);
        });

        /* ⑥ 1280: 맨 위 줄은 없고 옛 키캡 타이머가 그대로입니다. */
        await withPage(1280, async (page) => {
            await fuseDay(page);
            await fuseGo(page, '15:20').catch(() => {});
            await page.waitForSelector('.home-leave[data-leave="퇴근"] .leave-key', { timeout: 15000 });
            const wide = await page.evaluate(() => ({ fuse: Boolean(document.querySelector('.fuse')), key: Math.round(document.querySelector('.leave-key').getBoundingClientRect().height), text: document.querySelector('.home-leave[data-leave]').innerText.replace(/\s+/g, ' '), pad: getComputedStyle(document.querySelector('.app-frame')).paddingTop }));
            check(!wide.fuse && wide.key > 40 && wide.text.includes('1시간 20분') && wide.pad === '0px', `1280에서 옛 타이머가 바뀌었거나 맨 위 줄이 보입니다: ${JSON.stringify(wide)}`);
        });

        /* ⑦ 08:42(실이 거의 다 남음, 불씨가 글자 가장 가까이): 불꽃·불씨가 어느 순간에도 글자·캡슐에 닿지 않고, 줄이 시간표·탭바·쨈 단추·머리글을 가리지 않습니다. */
        for (const width of [360, 390]) {
            await withPage(width, async (page) => {
                await fuseDay(page);
                await fuseGo(page, '08:42');
                const lay = await page.evaluate(async () => {
                    const rect = (el) => { const r = el?.getBoundingClientRect(); return r && r.height > 0 ? r : null; };
                    const hits = (a, b) => Boolean(a && b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top);
                    const textBoxes = [...document.querySelectorAll('.fuse-k, .fuse-v, .fuse-bar .fuse-bomb')].map(rect);
                    const fx = [...document.querySelectorAll('.fuse-bar .fuse-spark, .fuse-bar .fuse-ember')];
                    const anims = document.querySelector('.fuse').getAnimations({ subtree: true });
                    anims.forEach((a) => a.pause());
                    let touch = 0;
                    for (const step of [0, 0.15, 0.3, 0.5, 0.7, 0.85, 0.99]) {
                        for (const a of anims) {
                            const timing = a.effect.getComputedTiming();
                            a.currentTime = (timing.delay || 0) + timing.duration * step;
                        }
                        for (const el of fx) if (Number(getComputedStyle(el).opacity) > 0.05 && textBoxes.some((t) => hits(rect(el), t))) touch += 1;
                    }
                    anims.forEach((a) => a.play());
                    const face = rect(document.querySelector('.fuse-face'));
                    const main = document.querySelector('.main');
                    const first = rect(main?.firstElementChild);
                    const tab = rect(document.querySelector('.tabbar'));
                    const fab = rect(document.querySelector('.tabbar .fab'));
                    const time = rect(document.querySelector('.home-time'));
                    const date = rect(document.querySelector('.date-block'));
                    const icons = [...document.querySelectorAll('.home-hero button, .main header button')].map(rect).filter(Boolean);
                    return {
                        touch, fx: fx.length,
                        face: face && { top: face.top, bottom: face.bottom },
                        first: first && first.top, time: time && time.top,
                        covers: hits(face, tab) || hits(face, fab) || hits(face, time) || hits(face, date) || hits(face, first) || icons.some((r) => hits(face, r)),
                    };
                });
                check(lay.fx >= 9 && lay.touch === 0, `${width} 불꽃이 글자·캡슐에 닿습니다: ${JSON.stringify(lay)}`);
                check(lay.face && !lay.covers && lay.first >= lay.face.bottom, `${width} 맨 위 줄이 머리글·시간표·탭바·쨈 단추를 가립니다: ${JSON.stringify(lay)}`);
            });
        }

        /* ⑧ 대비: 글자를 지운 줄을 찍고, 글자 자리 모든 점에 대해 (글자색 알파 × 조상 불투명도)로 섞은 색과 바탕을 비교합니다. */
        const fuseLow = {};
        const states = [['퇴근', '15:20', null, false], ['조퇴', '15:20', '16:00', false], ['10분 안쪽', '16:35', null, false], ['끝남', '16:50', null, false], ['움직임 줄이기', '16:35', null, true]];
        for (const theme of ['mx', 'retro', 'slim', 'puff', 'jelly', 'type']) {
            for (const mode of ['light', 'dark']) {
                for (const reduce of [false, true]) {
                    const mine = states.filter((s) => s[3] === reduce);
                    await withPage(360, async (page) => {
                        await fuseDay(page, { theme, reduce });
                        for (const [state, at, leave] of mine) {
                            await page.evaluateOnNewDocument((leave) => {
                                if (leave) localStorage.setItem('ssug-gyomu-leave-early', JSON.stringify({ '2026-10-26': leave }));
                                else localStorage.removeItem('ssug-gyomu-leave-early');
                            }, leave);
                            await fuseGo(page, at, mode);
                            await page.waitForFunction((theme) => (document.documentElement.getAttribute('data-kb') || 'mx') === theme, { timeout: 15000 }, theme);
                            await delay(150);
                            /* 끝남의 '펑'처럼 한 번만 도는 움직임은 끝난 뒤 멈춘 모습으로 잽니다(커지는 도중의 캡슐 가장자리를 바탕으로 잡지 않게). */
                            await page.evaluate(() => Promise.all(document.querySelector('.fuse').getAnimations({ subtree: true })
                                .filter((a) => Number.isFinite(a.effect?.getComputedTiming().endTime))
                                .map((a) => a.finished.catch(() => null))));
                            const face = await page.$('.fuse-face');
                            const texts = await face.evaluate((el) => {
                                const r = el.getBoundingClientRect();
                                const out = [];
                                for (const t of el.querySelectorAll('.fuse-k, .fuse-v, .fuse-bomb')) {
                                    const node = [...t.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
                                    if (!node) continue;
                                    const range = document.createRange();
                                    range.selectNodeContents(node);
                                    const b = range.getBoundingClientRect();
                                    let opacity = 1;
                                    for (let p = t; p && p !== document.documentElement; p = p.parentElement) opacity *= Number(getComputedStyle(p).opacity);
                                    out.push({ text: node.textContent, color: getComputedStyle(t).color, opacity, x: b.left - r.left, y: b.top - r.top, w: b.width, h: b.height });
                                }
                                return out;
                            });
                            const hide = await page.addStyleTag({ content: '.fuse-face, .fuse-face * { color: transparent !important; text-shadow: none !important; }' });
                            await delay(80);
                            const bare = await face.screenshot({ encoding: 'base64' });
                            await hide.evaluate((el) => el.remove());
                            const ratios = await page.evaluate(async (b64, texts) => {
                                const img = new Image();
                                img.src = `data:image/png;base64,${b64}`;
                                await img.decode();
                                const canvas = document.createElement('canvas');
                                canvas.width = img.width;
                                canvas.height = img.height;
                                const g = canvas.getContext('2d');
                                g.drawImage(img, 0, 0);
                                const lin = (v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
                                const lum = (r, gr, b) => 0.2126 * lin(r) + 0.7152 * lin(gr) + 0.0722 * lin(b);
                                const scale = img.width / Math.max(1, document.querySelector('.fuse-face').getBoundingClientRect().width);
                                return texts.map((t) => {
                                    const [r, gr, b, a = 1] = t.color.match(/[\d.]+/g).map(Number);
                                    const alpha = a * t.opacity;
                                    const data = g.getImageData(Math.max(0, Math.round(t.x * scale)), Math.max(0, Math.round(t.y * scale)), Math.max(1, Math.round(t.w * scale)), Math.max(1, Math.round(t.h * scale))).data;
                                    let min = Infinity;
                                    for (let i = 0; i < data.length; i += 4) {
                                        const bg = lum(data[i], data[i + 1], data[i + 2]);
                                        const ink = lum(r * alpha + data[i] * (1 - alpha), gr * alpha + data[i + 1] * (1 - alpha), b * alpha + data[i + 2] * (1 - alpha));
                                        min = Math.min(min, (Math.max(ink, bg) + 0.05) / (Math.min(ink, bg) + 0.05));
                                    }
                                    return { text: t.text, ratio: Math.round(min * 100) / 100 };
                                });
                            }, bare, texts);
                            const low = Math.min(...ratios.map((item) => item.ratio));
                            fuseLow[state] = Math.min(fuseLow[state] ?? Infinity, low);
                            check(ratios.length === 3 && ratios.every((item) => item.ratio >= 5), `${theme} ${mode} ${state} 맨 위 줄 글자가 바탕과 5:1이 안 됩니다: ${JSON.stringify(ratios)}`);
                        }
                    });
                }
            }
        }
        console.log(`맨 위 퇴근 줄 글자 대비 최저(테마 6 × 밝은·어두운): ${Object.entries(fuseLow).map(([k, v]) => `${k} ${v}:1`).join(' / ')}`);
    }
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
