/** 설정의 학사일정 달력·기본 시간표가 한 번 누르기로 들어가고 학기 타일에 반영되는지, 폭·다크에서 겹치지 않는지 브라우저로 봅니다. */
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const shots = process.env.SHOT_DIR || '';
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const chrome = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => existsSync(path));
if (!chrome) { console.error('브라우저가 없습니다.'); process.exit(1); }

const port = Number(process.env.ACADEMIC_PORT) || await new Promise((done, fail) => {
    const probe = createServer();
    probe.once('error', fail);
    probe.listen(0, '127.0.0.1', () => { const { port: free } = probe.address(); probe.close(() => done(free)); });
});
const origin = `http://127.0.0.1:${port}/`;
const preview = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
    await delay(250);
}
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

async function open(width, mode) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: width >= 900 ? 1000 : 844, isMobile: width < 900, hasTouch: width < 900, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument((theme) => {
        localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
        localStorage.setItem('ssug-gyomu-theme', theme);
    }, mode);
    await page.goto(`${origin}?demo=1&at=08:42&mode=${mode}#/settings`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('[data-screen="academic"] .acad-day');
    return page;
}

/* 겹침·누르기 크기: 보이는 버튼끼리 겹치지 않고 44px 이상인지 */
async function layout(page, selector) {
    return page.evaluate((sel) => {
        const box = document.querySelector(sel);
        const els = [...box.querySelectorAll('button, input')].filter((el) => el.offsetParent);
        const rects = els.map((el) => el.getBoundingClientRect());
        const small = els.filter((el, i) => rects[i].height < 43.5 || (el.tagName === 'BUTTON' && rects[i].width < 43.5)).map((el) => el.dataset.ymd || el.dataset.acadField || el.dataset.dtt || el.textContent.trim().slice(0, 10));
        let overlap = 0;
        for (let i = 0; i < rects.length; i += 1) for (let j = i + 1; j < rects.length; j += 1) {
            const a = rects[i]; const b = rects[j];
            if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
            if (Math.min(a.right, b.right) - Math.max(a.left, b.left) > 1 && Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 1) overlap += 1;
        }
        const wide = box.scrollWidth > box.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1;
        return { small, overlap, wide };
    }, selector);
}

const tap = (page, sel) => page.$eval(sel, (el) => el.click());

try {
    /* 1) 학사일정 넣기 → 학기 타일·휴일 반영 */
    const page = await open(390, 'light');
    await tap(page, '[data-acad-field="firstStart"]');
    await tap(page, '[data-ymd="2026-03-03"]');
    let state = await page.evaluate(() => ({
        on: document.querySelector('.acad-field.on')?.dataset.acadField,
        title: document.querySelector('.acad-month strong')?.textContent,
    }));
    check(state.on === 'firstEnd' && state.title.includes('7'), `개학일을 누른 뒤 방학식 칸·7월로 넘어가지 않았습니다: ${JSON.stringify(state)}`);
    await tap(page, '[data-ymd="2026-07-21"]');
    await tap(page, '[data-ymd="2026-08-18"]');
    for (let i = 0; i < 6; i += 1) {
        if (await page.$('[data-ymd="2027-02-10"]')) break;
        await tap(page, '.acad-nav[aria-label="다음 달"]');
    }
    await tap(page, '[data-ymd="2027-02-10"]');
    await tap(page, '[data-acad-field="offDays"]');
    for (let i = 0; i < 12; i += 1) {
        if (await page.$('[data-ymd="2026-05-04"]')) break;
        await tap(page, '.acad-nav[aria-label="앞 달"]');
    }
    await tap(page, '[data-ymd="2026-05-04"]');
    check(await page.$eval('[data-ymd="2026-05-04"]', (el) => el.getAttribute('aria-pressed') === 'true'), '재량휴업일이 표시되지 않습니다.');
    check(await page.$('select, input[type="date"]') === null || !(await page.$eval('[data-screen="academic"]', (el) => !!el.querySelector('select, input[type="date"]'))), '학사일정에 드롭다운·날짜 입력이 있습니다.');
    await tap(page, '[data-acad-save]');
    await delay(300);
    const tiles = await page.evaluate(() => [...document.querySelectorAll('[data-term]')].map((el) => ({ id: el.dataset.term, text: el.innerText.replace(/\s+/g, ' ') })));
    const first = tiles.find((row) => row.id === 'first');
    check(first && first.text.includes('우리 학교') && first.text.includes('3') && first.text.includes('7'), `학기 타일에 학사일정이 반영되지 않았습니다: ${JSON.stringify(tiles)}`);
    const stored = await page.evaluate(async () => (await import('/src/lib/db.js').catch(() => null)) ? 'dev' : 'built');
    void stored;
    check((await page.$eval('[data-acad-save]', (el) => el.textContent)).includes('저장됨'), '저장 뒤에도 저장 버튼이 남았습니다.');

    /* 2) 기본 시간표 → 1학기 타일로 날짜마다 넣기 */
    await page.$eval('[data-dtt="mon-1"]', (el) => el.scrollIntoView({ block: 'center' }));
    await page.focus('[data-dtt="mon-1"]');
    await page.$eval('[data-dtt="mon-1"]', (el) => { el.select?.(); });
    await page.keyboard.type('국어검사');
    await page.$eval('[data-dtt="mon-1"]', (el) => el.blur());
    await delay(200);
    await tap(page, '[data-term="first"]');
    await delay(400);
    const keep = await page.$('[data-term-keep]');
    if (keep) { await keep.click(); await delay(300); }
    await page.evaluate(() => { location.hash = '#/day/2026-03-09'; });
    await delay(500);
    const dayText = await page.evaluate(() => document.querySelector('.main')?.innerText || document.body.innerText);
    check(dayText.includes('국어검사'), '설정 기본 시간표가 1학기 날짜(3월 9일 월)에 들어가지 않았습니다.');
    await page.evaluate(() => { location.hash = '#/day/2026-05-04'; });
    await delay(400);
    check(!(await page.evaluate(() => (document.querySelector('.main')?.innerText || '').includes('국어검사'))), '재량휴업일에도 시간표가 들어갔습니다.');
    await page.close();

    /* 3) 폭·다크 겹침, 44px */
    for (const mode of ['light', 'dark']) {
        for (const width of [360, 390, 900, 1920]) {
            const p = await open(width, mode);
            for (const sel of ['[data-screen="academic"]', '[data-screen="default-tt"]']) {
                const r = await layout(p, sel);
                check(!r.small.length, `${width} ${mode} ${sel}: 44px보다 작은 버튼 ${r.small.slice(0, 5).join(',')}`);
                check(!r.overlap, `${width} ${mode} ${sel}: 겹친 버튼 ${r.overlap}쌍`);
                check(!r.wide, `${width} ${mode} ${sel}: 옆으로 넘칩니다.`);
                if (shots) {
                    const el = await p.$(sel);
                    await el.screenshot({ path: `${shots}/${sel.includes('academic') ? 'academic' : 'default-tt'}-${width}-${mode}.png` });
                }
            }
            if (shots && width < 900) {
                await p.evaluate(() => { location.hash = '#/today'; });
                await delay(300);
                await p.$eval('.tabbar .fab', (el) => el.click());
                await delay(500);
                await p.screenshot({ path: `${shots}/jam-popup-${width}-${mode}.png` });
            }
            await p.close();
        }
    }
} finally {
    await browser.close();
    preview.kill('SIGTERM');
}

if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('check-academic: 학사일정·기본 시간표 통과');
