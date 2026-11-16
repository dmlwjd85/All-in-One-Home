/** 과제 체크 화면: 메뉴 위치, 저장, 스크롤과 탭, 320~1440·어두운 화면·글자 200%. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync } from 'node:fs';
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
const port = Number(process.env.HW_PORT) || await freePort();
const origin = `http://127.0.0.1:${port}/`;
const shots = process.env.SHOT_DIR || '/opt/cursor/artifacts';
mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const delay = (ms) => new Promise((resolveDelay) => setTimeout(resolveDelay, ms));

const preview = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'ignore' });
for (let i = 0; i < 80; i += 1) {
    try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
    await delay(150);
}
const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

function labelsOf(page, selector) {
    return page.$$eval(selector, (els) => els.map((el) => el.innerText.replace(/\s+/g, ' ').trim()).filter(Boolean));
}

async function openDemo(width, height, hash = '#/today') {
    const page = await browser.newPage();
    page.on('dialog', (dialog) => dialog.accept());
    await page.evaluateOnNewDocument(() => {
        localStorage.setItem('ssug-gyomu-home-fold', JSON.stringify({ time: true, todo: true, event: true, recent: true }));
        localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
        localStorage.setItem('ssug-gyomu-onboard', JSON.stringify({ notice: 'folded', auto: false, day: '', steps: {} }));
    });
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.goto(`${origin}?demo=1&at=08:42&mode=dark${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.body.innerText.includes('오늘 우리 반') || document.body.innerText.includes('과제 체크'), { timeout: 15000 });
    await page.evaluate(() => document.querySelector('[aria-label="팁 닫기"]')?.click());
    return page;
}

function fitScript() {
    const root = document.querySelector('.hw');
    if (!root) return { missing: true };
    const bad = [];
    const boxes = [];
    for (const el of root.querySelectorAll('button, input, p, h2, label')) {
        const rect = el.getBoundingClientRect();
        if (rect.width < 1 || rect.height < 1) continue;
        const text = el.innerText.replace(/\s+/g, ' ').trim().slice(0, 24);
        if (rect.left < -1 || rect.right > window.innerWidth + 1) bad.push(`밖 ${text}`);
        if (el.scrollWidth > el.clientWidth + 2 && el.clientWidth > 0) bad.push(`잘림 ${text}`);
        const range = document.createRange();
        range.selectNodeContents(el);
        const ink = range.getBoundingClientRect();
        if (ink.width > 1 && (ink.right > rect.right + 1 || ink.bottom > rect.bottom + 1 || ink.left < rect.left - 1)) bad.push(`글자 ${text}`);
        if (el.matches('[data-hw-student], [data-role="hw-open"]')) boxes.push(rect);
    }
    for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i];
            const b = boxes[j];
            const hit = a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
            if (hit) bad.push('겹침');
        }
    }
    return { bad: bad.slice(0, 8), dark: document.documentElement.classList.contains('dark') };
}

try {
    const wide = await openDemo(1440, 900);
    const side = await labelsOf(wide, '.side-menu button');
    const attendAt = side.findIndex((label) => label === '출결' || label.startsWith('출결 '));
    check(attendAt >= 0 && (side[attendAt + 1] === '과제 체크' || side[attendAt + 1]?.startsWith('과제 체크')), `넓은 메뉴 순서가 다릅니다: ${side.join('|')}`);
    await wide.screenshot({ path: resolve(shots, 'homework-menu-dark-1440.png') });
    await wide.close();

    const phone = await openDemo(390, 844);
    await phone.click('[aria-label="메뉴"]');
    await phone.waitForSelector('[aria-label="메뉴"][aria-modal="true"], [role="dialog"][aria-label="메뉴"]');
    const menu = await labelsOf(phone, '[role="dialog"][aria-label="메뉴"] button');
    const menuAt = menu.findIndex((label) => label === '출결' || label.startsWith('출결 '));
    check(menuAt >= 0 && (menu[menuAt + 1] === '과제 체크' || menu[menuAt + 1]?.startsWith('과제 체크')), `휴대폰 메뉴 순서가 다릅니다: ${menu.join('|')}`);
    await phone.evaluate(() => [...document.querySelectorAll('[aria-label="메뉴"] button')].find((el) => el.innerText.trim() === '과제 체크')?.click());
    await phone.waitForSelector('#hw-new-title');
    check(await phone.evaluate(() => document.documentElement.classList.contains('dark')), '어두운 화면이 아닙니다.');
    await phone.type('#hw-new-title', '독서록');
    await phone.waitForFunction(() => !document.querySelector('[data-role="hw-add"]')?.disabled);
    await phone.click('[data-role="hw-add"]');
    await phone.waitForFunction(() => document.body.innerText.includes('독서록') && document.body.innerText.includes('제출 0/'));
    await phone.screenshot({ path: resolve(shots, 'homework-list-dark-390.png') });
    await phone.click('[data-role="hw-open"]');
    await phone.waitForSelector('[data-hw-student="s1"]');
    const before = await phone.$eval('[data-role="hw-count"]', (el) => el.innerText);
    await phone.click('[data-hw-student="s1"]');
    await phone.waitForFunction(() => document.querySelector('[data-role="hw-count"]')?.innerText?.includes('제출 1/'));
    check(await phone.$eval('[data-hw-student="s1"]', (el) => el.getAttribute('aria-pressed') === 'true' && el.innerText.includes('제출')), '이름을 눌러도 제출로 바뀌지 않습니다.');
    const scrolled = await phone.evaluate(() => {
        const button = document.querySelector('[data-hw-student="s2"]');
        const pressed = button.getAttribute('aria-pressed');
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 40, button: 0 }));
        window.dispatchEvent(new Event('scroll'));
        button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 30, clientY: 40, button: 0 }));
        return button.getAttribute('aria-pressed') === pressed;
    });
    check(scrolled, '스크롤로 시작한 손끝이 제출을 바꿨습니다.');
    const dragged = await phone.evaluate(() => {
        const button = document.querySelector('[data-hw-student="s2"]');
        const pressed = button.getAttribute('aria-pressed');
        button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 30, clientY: 40, button: 0 }));
        button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 30, clientY: 80, button: 0 }));
        button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 30, clientY: 80, button: 0 }));
        return button.getAttribute('aria-pressed') === pressed;
    });
    check(dragged, '손가락을 움직인 탭이 제출을 바꿨습니다.');
    await phone.click('[data-role="hw-missing"]');
    check(!(await phone.$('[data-hw-student="s1"]')), '미제출만 보기에 제출한 친구가 남습니다.');
    await phone.click('[data-role="hw-all"]');
    await phone.waitForFunction(() => document.body.innerText.includes('미제출한 친구가 없어요'));
    await phone.click('[data-role="hw-missing"]');
    const total = await phone.$eval('[data-role="hw-count"]', (el) => el.innerText);
    check(/제출 (\d+)\/\1/.test(total), `모두 제출 수가 맞지 않습니다: ${total} (처음 ${before})`);
    await phone.screenshot({ path: resolve(shots, 'homework-check-dark-390.png') });
    await phone.reload({ waitUntil: 'domcontentloaded' });
    await phone.waitForSelector('[data-role="hw-count"]', { timeout: 15000 });
    const kept = await phone.$eval('[data-role="hw-count"]', (el) => el.innerText);
    check(kept === total, `다시 열자 제출이 사라졌습니다: ${kept} / ${total}`);

    await phone.setViewport({ width: 320, height: 700 });
    await phone.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
    await delay(100);
    const narrow = await phone.evaluate(fitScript);
    check(!narrow.missing && !narrow.bad?.length && narrow.dark, `320·글자 200%에서 잘리거나 겹칩니다: ${JSON.stringify(narrow)}`);
    await phone.screenshot({ path: resolve(shots, 'homework-check-200-320.png') });
    await phone.setViewport({ width: 1440, height: 900 });
    const wideFit = await phone.evaluate(fitScript);
    check(!wideFit.missing && !wideFit.bad?.length, `1440·글자 200%에서 잘리거나 겹칩니다: ${JSON.stringify(wideFit)}`);
    await phone.screenshot({ path: resolve(shots, 'homework-check-200-1440.png') });
    await phone.close();

    const plus = await openDemo(390, 844);
    await plus.evaluate(() => {
        const buttons = [...document.querySelectorAll('[aria-label="쨈 빠른 입력 열기"]')];
        buttons.find((el) => el.getBoundingClientRect().width > 0)?.click();
    });
    await plus.waitForSelector('.quick-bar.is-open .quick-paste');
    await plus.click('.quick-bar.is-open .quick-paste');
    await plus.waitForSelector('[data-screen="plus"]');
    await plus.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.includes('접기'))?.click());
    await plus.waitForFunction(() => [...document.querySelectorAll('[data-screen="plus"] button')].some((el) => el.innerText.includes('더보기')));
    const plusOrder = await labelsOf(plus, '[data-screen="plus"] button');
    const plusAt = plusOrder.findIndex((label) => label === '출결' || label.startsWith('출결'));
    check(plusAt >= 0 && plusOrder[plusAt + 1]?.includes('과제 체크'), `쨈 메뉴에서 과제 체크가 출결 다음이 아닙니다: ${plusOrder.join('|')}`);
    const plusFit = await plus.evaluate(() => {
        const sheet = document.querySelector('[data-screen="plus"]');
        return { scroll: sheet.scrollHeight > sheet.clientHeight + 2, h: sheet.scrollHeight, c: sheet.clientHeight };
    });
    check(!plusFit.scroll, `쨈 메뉴가 한 화면을 넘어 스크롤이 생깁니다: ${JSON.stringify(plusFit)}`);
    await plus.close();

    const home = await openDemo(360, 800);
    const sixth = await home.evaluate(() => {
        const cells = [...document.querySelectorAll('.period-row button')].map((el) => {
            const box = el.getBoundingClientRect();
            return { text: el.innerText.replace(/\s+/g, ' ').trim().slice(0, 12), top: Math.round(box.top), bottom: Math.round(box.bottom), width: Math.round(box.width), height: Math.round(box.height) };
        });
        const hit = cells.find((cell) => cell.text.includes('6교시') || cell.text.startsWith('6'));
        const box = (sel) => {
            const el = document.querySelector(sel);
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            return { top: Math.round(rect.top), bottom: Math.round(rect.bottom), h: Math.round(rect.height) };
        };
        return {
            hit, view: window.innerHeight, count: cells.length, scroll: Math.round(window.scrollY),
            hero: box('.home-hero'), leave: box('.home-leave'), fuse: box('.fuse-face'), time: box('.home-time'), notice: box('.store-notice'), tip: box('.tip-bubble'),
        };
    });
    check(sixth.hit && sixth.hit.height > 0 && sixth.hit.top < sixth.view && sixth.hit.bottom > 0, `360 첫 화면에서 6교시가 사라졌습니다: ${JSON.stringify(sixth)}`);
    await home.close();
} finally {
    await browser.close();
    preview.kill();
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('과제 체크 브라우저 검사를 통과했습니다.');
