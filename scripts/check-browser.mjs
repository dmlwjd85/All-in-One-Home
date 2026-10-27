/** 360·390·1280에서 넘침과 버튼 크기, 주요 흐름을 확인하고 화면을 저장합니다. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
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
const port = 4175;
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
                    `1920에서 출결 16·17번 줄이 할 일 고르기 아래로 지나갑니다: ${JSON.stringify(underFab)}`,
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
            await page.setViewport({ width, height: width === 1920 ? 1080 : 844, deviceScaleFactor: 1 });
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
                soft: document.querySelector('[aria-label="몽글 저소음"]')?.getAttribute('aria-pressed'),
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
                soft: document.querySelector('[aria-label="몽글 저소음"]')?.getAttribute('aria-pressed'),
            }));
            check(kept.click === 'true' && kept.loud === 'true' && kept.soft === 'false', '고른 소리가 다시 열어도 남지 않습니다.');
            const typeFirst = await page.evaluate(() => ({
                stored: localStorage.getItem('ssug-gyomu-type-voice'),
                ppok: document.querySelector('[aria-label="뽁 통통"]')?.getAttribute('aria-pressed'),
            }));
            check(typeFirst.stored === null && typeFirst.ppok === 'true', '글자 소리 처음 선택이 뽁이 아닙니다.');
            const typeLabels = { ppok: '뽁 통통', ting: '띵 실로폰', drop: '물방울 또록', red: '적축 직선', bang: '방귀 뿌우' };
            for (const [id, label] of Object.entries(typeLabels)) {
                await page.evaluate((value) => localStorage.setItem('ssug-gyomu-type-voice', value), id);
                await page.reload({ waitUntil: 'domcontentloaded' });
                await page.waitForFunction(() => document.body.innerText.includes('소리 종류') || document.body.innerText.includes('오늘 우리 반'));
                await page.evaluate(() => { location.hash = '#/settings'; });
                await page.waitForSelector(`[aria-label="${label}"]`);
                const shown = await page.evaluate((want) => ({
                    pressed: [...document.querySelectorAll('.type-picks button[aria-pressed="true"]')].map((el) => el.getAttribute('aria-label')),
                    stored: localStorage.getItem('ssug-gyomu-type-voice'),
                    want,
                }), label);
                check(shown.pressed.length === 1 && shown.pressed[0] === label && shown.stored === id, `저장된 글자 소리 ${id}가 ${label}로 보이지 않습니다. ${shown.pressed.join(',')}`);
            }
            await page.click('[aria-label="띵 실로폰"]');
            await page.waitForFunction(() => localStorage.getItem('ssug-gyomu-type-voice') === 'ting');
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
        await page.click('[aria-label="할 일 고르기"]');
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
                    return {
                        visible,
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
                        && layout.sixthOnScreen && !layout.sixthUnderTab,
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

    /* 콕 키캡: 크기·측면·눌림·터치 영역·그림자와, 토스트가 키캡을 덮지 않는지 계산된 스타일로 봅니다. */
    for (const width of [360, 390, 900, 960, 1000, 1920]) {
        for (const mode of ['light', 'dark']) {
            await withDemo(width, mode, async (page) => {
                const selector = width >= 900 ? '.desk-fab' : '.tabbar .fab';
                const size = width >= 900 ? 64 : 58;
                const cap = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    if (!el) return null;
                    const rect = el.getBoundingClientRect();
                    const after = getComputedStyle(el, '::after');
                    return {
                        w: rect.width,
                        h: rect.height,
                        shadow: after.boxShadow,
                        transition: `${after.transitionProperty} ${after.transitionDuration}`,
                    };
                }, selector);
                check(Boolean(cap), `${width} ${mode}에서 콕 키캡이 없습니다.`);
                if (!cap) return;
                check(Math.abs(cap.w - size) < 0.6 && Math.abs(cap.h - size) < 0.6, `${width} ${mode} 콕 키캡이 ${size}px가 아닙니다: ${cap.w}×${cap.h}`);
                check(cap.w >= 44 && cap.h >= 44, `${width} ${mode} 콕 키캡 터치 영역이 44px보다 작습니다.`);
                check(cap.shadow && cap.shadow !== 'none' && /\b0px 9px 0px\b/.test(cap.shadow) && /inset/.test(cap.shadow), `${width} ${mode} 콕 키캡 측면 9px 그림자가 없습니다: ${cap.shadow}`);
                check(/box-shadow/.test(cap.transition) && /0\.08s/.test(cap.transition), `${width} ${mode} 콕 키캡 눌림 전환이 80ms가 아닙니다: ${cap.transition}`);
                const cdp = await page.createCDPSession();
                await cdp.send('DOM.enable');
                await cdp.send('CSS.enable');
                const { root: docRoot } = await cdp.send('DOM.getDocument');
                const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: docRoot.nodeId, selector });
                await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['active'] });
                await delay(150);
                const pressed = await page.evaluate((sel) => {
                    const el = document.querySelector(sel);
                    const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
                    return { y: matrix.m42, shadow: getComputedStyle(el, '::after').boxShadow };
                }, selector);
                await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: [] });
                await cdp.detach().catch(() => {});
                check(Math.abs(pressed.y - 6) < 0.6, `${width} ${mode} 콕 키캡이 6px 눌리지 않습니다: ${pressed.y}`);
                check(/\b0px 3px 0px\b/.test(pressed.shadow), `${width} ${mode} 눌린 콕 키캡 측면이 3px로 줄지 않습니다: ${pressed.shadow}`);
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

    // 알림장 부제와 지난 알림장 안내: 빈 상태, 저장 직후, 390 한 줄을 지킵니다.
    await withDemo(390, 'light', async (page) => {
        await page.evaluate(async () => {
            for (const name of ['ssug-gyomu', 'ssug-gyomu-local']) {
                const db = await new Promise((resolveDb, reject) => {
                    const req = indexedDB.open(name);
                    req.onsuccess = () => resolveDb(req.result);
                    req.onerror = () => reject(req.error);
                });
                if (!db.objectStoreNames.contains('kv')) continue;
                const store = db.transaction('kv', 'readwrite').objectStore('kv');
                const state = await new Promise((resolveState, reject) => {
                    const req = store.get('state');
                    req.onsuccess = () => resolveState(req.result || null);
                    req.onerror = () => reject(req.error);
                });
                if (!state) continue;
                state.notices = [];
                if (state.local) state.local.notices = [];
                await new Promise((resolvePut, reject) => {
                    const req = store.put(state, 'state');
                    req.onsuccess = resolvePut;
                    req.onerror = () => reject(req.error);
                });
            }
        });
        await page.goto(`${origin}?mode=light&at=08:42#/notice`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForSelector('textarea[aria-label="알림장"]');
        await delay(300);
        const emptyHint = '아직 지난 알림장이 없어요. 저장하면 여기에 모여요.';
        const savedHint = '이 날 알림장은 저장해 두었어요. 다른 날 알림장을 저장하면 여기에 모여요.';
        const sub = await page.evaluate(() => {
            const p = document.querySelector('.date-block p');
            if (!p) return null;
            return { text: p.innerText.trim(), lines: Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight)) };
        });
        check(sub?.text === '복사해서 붙여 넣어요', `알림장 부제가 바뀌었습니다: ${sub?.text}`);
        check(sub?.lines === 1, `390에서 알림장 부제가 한 줄이 아닙니다: ${sub?.lines}줄`);
        const before = await page.evaluate(() => document.body.innerText);
        check(before.includes(emptyHint), '지난 알림장이 없을 때 빈 안내가 보이지 않습니다.');
        await page.type('textarea[aria-label="알림장"]', '줄넘기 챙기기');
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '저장')?.click());
        await page.waitForFunction((hint) => document.body.innerText.includes(hint), { timeout: 5000 }, savedHint).catch(() => {});
        const after = await page.evaluate(() => document.body.innerText);
        check(after.includes(savedHint), '알림장을 저장한 뒤 저장했다는 안내가 보이지 않습니다.');
        check(!after.includes(emptyHint), '알림장을 저장한 뒤에도 "저장하면 여기에 모여요" 빈 안내가 그대로 보입니다.');
    }, 844);

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
