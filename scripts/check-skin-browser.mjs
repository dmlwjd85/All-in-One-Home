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
const shots = process.env.SHOT_DIR || '/opt/cursor/artifacts/classic-skin-v8';
mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
let contrastChecked = 0;
let contrastFailed = 0;
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
        const wrap = document.querySelector('.skin-deco');
        if (wrap && getComputedStyle(wrap).display !== 'none' && getComputedStyle(wrap).visibility !== 'hidden') {
            wrap.querySelectorAll('.skin-prop, .skin-flag').forEach((el) => {
                const st = getComputedStyle(el);
                if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return;
                const r = el.getBoundingClientRect();
                if (r.width < 2 || r.height < 2) return;
                deco.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom, name: el.getAttribute('data-prop') || el.className });
            });
        }
        const hits = [];
        const skip = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
        const visibleBox = (el, r) => {
            if (r.width < 2 || r.height < 2) return null;
            const st = getComputedStyle(el);
            if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return null;
            let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
            let p = el;
            while (p && p !== document.body) {
                const cs = getComputedStyle(p);
                if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') {
                    const pr = p.getBoundingClientRect();
                    box = {
                        left: Math.max(box.left, pr.left),
                        top: Math.max(box.top, pr.top),
                        right: Math.min(box.right, pr.right),
                        bottom: Math.min(box.bottom, pr.bottom),
                    };
                }
                p = p.parentElement;
            }
            box.left = Math.max(box.left, 0);
            box.top = Math.max(box.top, 0);
            box.right = Math.min(box.right, innerWidth);
            box.bottom = Math.min(box.bottom, innerHeight);
            if (box.right - box.left < 2 || box.bottom - box.top < 2) return null;
            return box;
        };
        const add = (el, name) => {
            const r = el.getBoundingClientRect();
            const box = visibleBox(el, r);
            if (!box) return;
            hits.push({ ...box, name });
        };
        document.querySelectorAll('button, a, input, textarea, select, [role="button"], .fuse-face, .fuse-text, .fuse-k, .fuse-v, .tabbar, .desk-fab, .cloud-note').forEach((el) => add(el, el.getAttribute('aria-label') || el.className || el.tagName));
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
            const p = walker.currentNode.parentElement;
            const box = p ? visibleBox(p, r) : null;
            if (!box) continue;
            hits.push({ ...box, name: walker.currentNode.nodeValue.trim().slice(0, 28) });
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
    const fabCoverFn = () => {
        const overlap = (a, b) => a.left < b.right - 2 && a.right > b.left + 2 && a.top < b.bottom - 2 && a.bottom > b.top + 2;
        const visible = (el) => {
            const r = el.getBoundingClientRect();
            const st = getComputedStyle(el);
            if (r.width < 8 || r.height < 8) return null;
            if (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return null;
            return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
        };
        const clip = (el, r) => {
            let box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
            let p = el;
            while (p && p !== document.body) {
                const cs = getComputedStyle(p);
                if (cs.overflowY !== 'visible' || cs.overflowX !== 'visible') {
                    const pr = p.getBoundingClientRect();
                    box = {
                        left: Math.max(box.left, pr.left),
                        top: Math.max(box.top, pr.top),
                        right: Math.min(box.right, pr.right),
                        bottom: Math.min(box.bottom, pr.bottom),
                    };
                }
                p = p.parentElement;
            }
            box.left = Math.max(box.left, 0);
            box.top = Math.max(box.top, 0);
            box.right = Math.min(box.right, innerWidth);
            box.bottom = Math.min(box.bottom, innerHeight);
            if (box.right - box.left < 2 || box.bottom - box.top < 2) return null;
            return box;
        };
        const fabs = [...document.querySelectorAll('.desk-fab')].map(visible).filter(Boolean);
        if (!fabs.length) return [];
        const hits = [];
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const p = node.parentElement;
                if (!p || ['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(p.tagName)) return NodeFilter.FILTER_REJECT;
                if (p.closest('.desk-fab, .tbj-mid, .tabbar, .quick-bar, .sheet, .sheet-back, .skin-deco')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        while (walker.nextNode()) {
            const p = walker.currentNode.parentElement;
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            const r = range.getBoundingClientRect();
            const box = p ? clip(p, r) : null;
            if (!box) continue;
            if (fabs.some((fab) => overlap(fab, box))) hits.push(walker.currentNode.nodeValue.trim().slice(0, 28));
        }
        return hits;
    };
    const fabCover = await page.evaluate(fabCoverFn);
    if (fabCover.length) check(false, `${label} 쨈 버튼이 글자를 가립니다: ${fabCover[0]}`);
    const scrolled = await page.evaluate(() => {
        const main = document.querySelector('.main');
        if (!main || main.scrollHeight <= main.clientHeight + 4) return false;
        main.scrollTop = main.scrollHeight;
        return true;
    });
    if (scrolled) {
        await delay(50);
        const after = await page.evaluate(fabCoverFn);
        if (after.length) check(false, `${label} 끝까지 스크롤해도 쨈 버튼이 글자를 가립니다: ${after[0]}`);
    }
}

async function haloHits(page, label) {
    const misses = await page.evaluate(() => {
        const miss = [];
        const skipTag = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT']);
        const buttons = [...document.querySelectorAll('button, a, [role="button"], .chip, .icon-btn, .primary-btn')];
        const shadows = [];
        for (const el of buttons) {
            const st = getComputedStyle(el);
            if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) continue;
            const r = el.getBoundingClientRect();
            if (r.width < 8 || r.height < 8) continue;
            const down = (() => {
                let maxDown = 0;
                const shadow = st.boxShadow;
                if (!shadow || shadow === 'none') return 0;
                for (const part of shadow.split(/,(?![^(]*\))/)) {
                    if (/inset/i.test(part)) continue;
                    const nums = [...part.matchAll(/(-?[\d.]+)px/g)].map((m) => Number(m[1]));
                    if (nums.length < 2) continue;
                    maxDown = Math.max(maxDown, nums[1] + (nums[2] || 0) + (nums[3] || 0));
                }
                return maxDown;
            })();
            if (down < 4) continue;
            shadows.push({
                el,
                left: r.left - 4,
                top: r.bottom,
                right: r.right + 4,
                bottom: r.bottom + down,
            });
        }
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const p = node.parentElement;
                if (!p || skipTag.has(p.tagName)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        const overlap = (a, b) => a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
        const overlay = document.querySelector('.sheet-back, .quick-bar.is-open');
        while (walker.nextNode()) {
            const parent = walker.currentNode.parentElement;
            if (overlay && parent && !parent.closest('.sheet, .quick-bar, .tabbar, .desk-fab, .fuse, .fuse-bar')) continue;
            const range = document.createRange();
            range.selectNodeContents(walker.currentNode);
            const r = range.getBoundingClientRect();
            if (r.width < 2 || r.height < 2) continue;
            const box = { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
            const hit = shadows.some((sh) => !sh.el.contains(parent) && overlap(sh, box));
            if (!hit) continue;
            const st = getComputedStyle(parent);
            const stroke = parseFloat(st.webkitTextStrokeWidth) || 0;
            const halo = String(st.getPropertyValue('--text-halo') || '').trim();
            if (stroke >= 1 && halo) continue;
            miss.push(walker.currentNode.nodeValue.trim().slice(0, 28));
        }
        return miss.slice(0, 8);
    });
    if (misses.length) {
        check(false, `${label} 그림자 위 글자에 바탕색 테두리가 없습니다: ${misses.join(' | ')}`);
    }
}

async function contrastHits(page, label) {
    const result = await page.evaluate(() => {
        const parse = (str) => {
            if (!str || str === 'transparent') return null;
            let m = String(str).match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i);
            if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] };
            m = String(str).match(/^rgba?\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
            if (!m) return null;
            let a = 1;
            if (m[4]) a = String(m[4]).endsWith('%') ? parseFloat(m[4]) / 100 : +m[4];
            return { r: +m[1], g: +m[2], b: +m[3], a };
        };
        const lin = (c) => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
        const lum = ({ r, g, b }) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
        const blend = (fg, bg) => {
            const a = Math.max(0, Math.min(1, fg.a ?? 1));
            if (a >= 0.99) return { r: fg.r, g: fg.g, b: fg.b, a: 1 };
            return {
                r: fg.r * a + bg.r * (1 - a),
                g: fg.g * a + bg.g * (1 - a),
                b: fg.b * a + bg.b * (1 - a),
                a: 1,
            };
        };
        const photoLayer = (st) => /url\(/.test(st.backgroundImage || '') && /\.webp|\.jpg|\.jpeg|\.png/i.test(st.backgroundImage || '');
        const opaqueBg = (el) => {
            let cur = el;
            let acc = null;
            let photo = false;
            while (cur && cur !== document.documentElement.parentElement) {
                const st = getComputedStyle(cur);
                if (photoLayer(st)) photo = true;
                const c = parse(st.backgroundColor);
                if (c && c.a > 0.01) {
                    acc = acc ? blend(acc, c) : { r: c.r, g: c.g, b: c.b, a: c.a };
                    if ((acc.a ?? 1) >= 0.95) return { r: acc.r, g: acc.g, b: acc.b, a: 1, photo };
                }
                cur = cur.parentElement;
            }
            const root = parse(getComputedStyle(document.documentElement).backgroundColor) || { r: 255, g: 255, b: 255, a: 1 };
            const out = acc ? blend(acc, root) : root;
            return { r: out.r, g: out.g, b: out.b, a: 1, photo };
        };
        const visible = (el, r) => {
            if (!el || r.width < 1 || r.height < 1) return false;
            if (r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) return false;
            const st = getComputedStyle(el);
            if (st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
            return true;
        };
        const skipTag = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'META', 'LINK', 'HEAD']);
        const items = [];
        const add = (el, text, colorStr) => {
            const r = el.getBoundingClientRect();
            if (!visible(el, r)) return;
            const fg = parse(colorStr);
            if (!fg || fg.a < 0.08) return;
            const bg = opaqueBg(el);
            const paint = blend(fg, bg);
            const st = getComputedStyle(el);
            const px = parseFloat(st.fontSize) || 16;
            const weight = st.fontWeight;
            const bold = weight === 'bold' || Number(weight) >= 700;
            const large = px >= 24 || (px >= 18.67 && bold);
            const need = large ? 3 : 4.5;
            const contrast = ratio(paint, bg);
            items.push({
                text: String(text || '').replace(/\s+/g, ' ').trim().slice(0, 36),
                ratio: contrast,
                need,
                photo: bg.photo,
                fg: `rgb(${Math.round(paint.r)}, ${Math.round(paint.g)}, ${Math.round(paint.b)})`,
                bg: `rgb(${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)})`,
                large,
            });
        };
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node.nodeValue || !node.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
                const p = node.parentElement;
                if (!p || skipTag.has(p.tagName)) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        while (walker.nextNode()) {
            const p = walker.currentNode.parentElement;
            add(p, walker.currentNode.nodeValue, getComputedStyle(p).color);
        }
        document.querySelectorAll('input, textarea').forEach((el) => {
            const st = getComputedStyle(el);
            if (el.value) add(el, el.value, st.color);
            else if (el.placeholder) add(el, el.placeholder, getComputedStyle(el, '::placeholder').color || st.color);
        });
        const violations = items.filter((item) => item.ratio + 1e-6 < item.need);
        return { checked: items.length, failed: violations.length, violations: violations.slice(0, 12) };
    });
    const failCount = result.failed;
    if (failCount) {
        const sample = result.violations.map((item) => `${item.text || '(빈칸)'} ${item.ratio.toFixed(2)}<${item.need} ${item.fg} / ${item.bg}`).join(' | ');
        check(false, `${label} 글자 대비 위반 ${failCount}건: ${sample}`);
    }
    return result;
}

async function openPage({ width = 390, height = 844, mode = 'light', skin = 'basic', kb = null, hash = '#/today' } = {}) {
    const page = await browser.newPage();
    listen(page);
    await pin(page, (skinId, kbId) => {
        if (skinId === 'cork') localStorage.setItem('ssug-gyomu-skin', 'cork');
        else localStorage.setItem('ssug-gyomu-skin', 'basic');
        if (kbId) localStorage.setItem('ssug-gyomu-kb-theme', kbId);
        else localStorage.removeItem('ssug-gyomu-kb-theme');
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
        check(first.labels.includes('기본') && first.labels.includes('클래식 교실풍경'), '설정 타일 이름이 없습니다.');
        check(first.labels.includes('밤 교실'), '밤 교실 안내가 없습니다.');
        await page.click('[data-skin-pick="cork"]');
        await delay(120);
        const after = await page.evaluate(() => ({
            skin: document.documentElement.getAttribute('data-skin'),
            stored: localStorage.getItem('ssug-gyomu-skin'),
            theme: localStorage.getItem('ssug-gyomu-theme'),
            kb: document.documentElement.getAttribute('data-kb'),
            bg: getComputedStyle(document.documentElement).backgroundColor,
            deco: getComputedStyle(document.querySelector('.skin-deco') || document.body).pointerEvents,
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

    const openJam = async (page) => {
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
    };
    const openMenu = async (page) => {
        await page.waitForSelector('button[aria-label="메뉴"]');
        await page.click('button[aria-label="메뉴"]');
        await page.waitForSelector('.sheet[aria-label="메뉴"]', { timeout: 5000 });
    };

    const shotNames = new Set(['home', 'attend', 'todo', 'jam', 'settings']);
    const scenes = [
        ['home', '#/today', async () => {}],
        ['attend', '#/attend', async () => {}],
        ['todo', '#/todo', async () => {}],
        ['jam', '#/today', openJam],
        ['settings', '#/settings/screen', async (page) => {
            await page.waitForSelector('[data-skin-pick="cork"]');
        }],
        ['calendar', '#/schedule', async (page) => {
            await page.waitForFunction(() => location.hash.startsWith('#/schedule'), { timeout: 8000 });
        }],
        ['homework', '#/homework', async () => {}],
        ['minutes', '#/minutes', async () => {}],
        ['notice', '#/notice', async () => {}],
        ['students', '#/students', async () => {}],
        ['sheet', '#/today', openMenu],
    ];
    async function capture(name, hash, prepare, width, mode) {
        const page = await openPage({ width, height: width >= 768 ? 900 : 844, mode, skin: 'cork', hash });
        await prepare(page);
        await delay(180);
        const file = `cork-${name}-${width}-${mode}.png`;
        if (shotNames.has(name)) await page.screenshot({ path: resolve(shots, file) });
        const look = await page.evaluate(() => {
            const wrap = document.querySelector('.skin-deco');
            const shown = wrap && getComputedStyle(wrap).display !== 'none' && getComputedStyle(wrap).visibility !== 'hidden';
            const props = shown ? [...wrap.querySelectorAll('.skin-prop, .skin-flag, .skin-motto')].filter((el) => getComputedStyle(el).display !== 'none').length : 0;
            return {
                skin: document.documentElement.getAttribute('data-skin'),
                deco: wrap ? getComputedStyle(wrap).pointerEvents : 'none',
                shown: Boolean(shown),
                props,
            };
        });
        check(look.skin === 'cork', `${file} 에 코르크가 없습니다.`);
        check(look.deco === 'none', `${file} 장식이 클릭을 가로챕니다.`);
        if (name === 'jam' || name === 'sheet') {
            check(!look.shown, `${file} 팝업인데 장식이 남아 있습니다.`);
        } else {
            check(look.shown && look.props > 0, `${file} 떠 있는 소품이 없습니다.`);
        }
        await overlapHits(page, file);
        await haloHits(page, file);
        const contrast = await contrastHits(page, file);
        contrastChecked += contrast.checked;
        contrastFailed += contrast.failed;
        await page.close();
    }

    for (const width of [320, 390, 768, 1280]) {
        for (const mode of ['light', 'dark']) {
            for (const [name, hash, prepare] of scenes) {
                if (name === 'sheet' && width >= 900) continue;
                await capture(name, hash, prepare, width, mode);
            }
        }
    }

    /* 짬 지우개 분필 가루. 팝업은 열지 않고, 0·200·450ms 프레임을 멈춥니다. */
    const pauseDust = async (page, ms) => {
        const ok = await page.evaluate((t) => {
            const puff = document.querySelector('.chalk-puff');
            if (!puff) return false;
            puff.dataset.hold = '1';
            if (puff.dataset.drop) {
                clearTimeout(Number(puff.dataset.drop));
                puff.dataset.drop = '';
            }
            const anims = puff.getAnimations({ subtree: true });
            for (const anim of anims) {
                anim.pause();
                anim.currentTime = t;
            }
            return anims.length > 0;
        }, ms);
        check(ok, `분필 가루 ${ms}ms 프레임이 없습니다.`);
        await delay(40);
    };
    const fireDust = async (page, selector) => {
        await page.waitForSelector(selector);
        await page.evaluate((sel) => {
            const btn = [...document.querySelectorAll(sel)].find((el) => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.display !== 'none';
            });
            btn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerType: 'mouse' }));
        }, selector);
        await delay(30);
        const dust = await page.evaluate(() => document.querySelector('.chalk-puff')?.className || '');
        check(/chalk-puff/.test(dust), `분필 가루 효과가 없습니다: ${dust}`);
    };
    {
        const page = await openPage({ width: 1280, height: 900, mode: 'light', skin: 'cork', hash: '#/today' });
        await fireDust(page, '.desk-fab');
        await pauseDust(page, 16);
        await page.screenshot({ path: resolve(shots, 'cork-jam-dust-1.png') });
        await pauseDust(page, 200);
        await page.screenshot({ path: resolve(shots, 'cork-jam-dust-2.png') });
        await pauseDust(page, 450);
        await page.screenshot({ path: resolve(shots, 'cork-jam-dust-3.png') });
        await page.close();
    }
    {
        const page = await openPage({ width: 1280, height: 900, mode: 'dark', skin: 'cork', hash: '#/today' });
        await fireDust(page, '.desk-fab');
        await pauseDust(page, 200);
        await page.screenshot({ path: resolve(shots, 'cork-jam-dust-1280-dark.png') });
        await page.close();
    }
    {
        const page = await openPage({ width: 390, height: 844, mode: 'light', skin: 'cork', hash: '#/today' });
        await fireDust(page, '.tbj-mid');
        await pauseDust(page, 200);
        await page.screenshot({ path: resolve(shots, 'cork-jam-dust-390-light.png') });
        await page.close();
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
    console.error(`대비 검사 요소 ${contrastChecked}개, 위반 ${contrastFailed}건.`);
    process.exit(1);
}
console.log(`화면 꾸미기 브라우저 검사를 통과했습니다. 화면은 ${shots} 에 있습니다. 콘솔 오류 ${uniqueErrors.length}건. 대비 검사 요소 ${contrastChecked}개, 위반 ${contrastFailed}건.`);
