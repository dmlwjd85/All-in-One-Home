/** PR E 브라우저 검사: / 키 쨈 빠른 입력, 모달·IME 보호, 기본 단축키, 출결 마감 눌림 상태, 시간구 노란 카드, 추천값 카드, 5폭×2테마 겹침·44px. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
const port = 4231;
const origin = `http://127.0.0.1:${port}/`;
const shots = process.env.E_SHOTS || '';
if (shots) mkdirSync(shots, { recursive: true });
const FIXED = '2026-11-09T10:00:00+09:00';
const TODAY = '2026-11-09';
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
    await wait(250);
}

async function fresh(browser, { width = 1280, height = 900, mode = 'light', local = {} } = {}) {
    /* 기기마다 저장소가 따로이도록 새 시크릿 문맥에서 엽니다. 페이지를 닫으면 문맥도 닫습니다. */
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const close = page.close.bind(page);
    page.close = async () => { await close(); await context.close(); };
    await page.setViewport({ width, height });
    await page.evaluateOnNewDocument((iso, seed) => {
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
        if (!sessionStorage.getItem('e-seeded')) {
            sessionStorage.setItem('e-seeded', '1');
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-speech-notice', '1');
            for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, v);
        }
        window.__toasts = [];
        new MutationObserver(() => {
            const t = document.querySelector('.toast');
            if (t && t.innerText && window.__toasts[window.__toasts.length - 1] !== t.innerText) window.__toasts.push(t.innerText);
        }).observe(document, { childList: true, subtree: true, characterData: true });
    }, FIXED, local);
    await page.goto(`${origin}?demo=1&mode=${mode}#/today`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.quick-bar');
    if (process.env.E_THROTTLE) await page.emulateCPUThrottling(Number(process.env.E_THROTTLE));
    return page;
}

const quickOpen = (page) => page.evaluate(() => document.querySelector('.quick-bar')?.classList.contains('is-open') && document.activeElement?.classList.contains('quick-field'));
const press = async (page, key) => { await page.evaluate(() => document.activeElement?.blur?.()); await page.keyboard.press(key); await wait(120); };

/* 화면 겹침·넘침·44px. 보이는 단추끼리 겹치거나 화면 밖으로 나가면 실패. */
async function audit(page, label, scope) {
    const r = await page.evaluate((sel) => {
        const host = sel ? document.querySelector(sel) : document.body;
        if (!host) return { missing: true };
        const vis = (el) => { const b = el.getBoundingClientRect(); const cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0; };
        const btns = [...host.querySelectorAll('button')].filter(vis);
        const small = btns.filter((b) => { const x = b.getBoundingClientRect(); return x.height < 44 - 0.5 || x.width < 44 - 0.5; }).map((b) => `${b.innerText.trim().slice(0, 14)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`);
        const out = btns.filter((b) => { const x = b.getBoundingClientRect(); return x.left < -0.5 || x.right > innerWidth + 0.5; }).map((b) => b.innerText.trim().slice(0, 14));
        const overlap = [];
        for (let i = 0; i < btns.length; i += 1) for (let j = i + 1; j < btns.length; j += 1) {
            if (btns[i].contains(btns[j]) || btns[j].contains(btns[i])) continue;
            const a = btns[i].getBoundingClientRect(); const b = btns[j].getBoundingClientRect();
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left); const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (w > 1 && h > 1) overlap.push(`${btns[i].innerText.trim().slice(0, 10)}↔${btns[j].innerText.trim().slice(0, 10)}`);
        }
        const texts = [...host.querySelectorAll('p, strong, span')].filter(vis).filter((el) => el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflow !== 'visible').map((el) => el.innerText.slice(0, 16));
        return { small, out, overlap, texts, hscroll: document.documentElement.scrollWidth > innerWidth + 1 };
    }, scope || '');
    if (r.missing) { check(false, `${label}: ${scope} 없음`); return; }
    check(!r.small.length, `${label}: 44px 미만 ${r.small.join(', ')}`);
    check(!r.out.length, `${label}: 화면 밖 ${r.out.join(', ')}`);
    check(!r.overlap.length, `${label}: 겹침 ${r.overlap.join(', ')}`);
    check(!r.texts.length, `${label}: 글자 잘림 ${r.texts.join(', ')}`);
    check(!r.hscroll, `${label}: 가로 넘침`);
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage', '--autoplay-policy=no-user-gesture-required'] });
try {
    /* 1. / 키와 기본 단축키 */
    {
        const page = await fresh(browser);
        await press(page, '/');
        check(await quickOpen(page), '/ 키가 쨈 빠른 입력창을 열지 않음');
        check(!await page.$('.sheet-back'), '/ 키가 발라 두기 시트를 엶');
        await page.keyboard.type('a/b');
        check((await page.$eval('.quick-field', (el) => el.value)) === 'a/b', '입력칸의 / 가 글자로 들어가지 않음');
        check(await page.evaluate(() => document.querySelector('.quick-bar').classList.contains('is-open')), '입력 중 / 가 창을 닫음');
        await page.keyboard.press('t');
        check((await page.evaluate(() => location.hash)) === '#/today', '입력 중 t가 화면을 옮김');
        await page.keyboard.press('Escape');
        await page.$eval('.quick-field', (el) => { el.value = ''; });
        await wait(150);
        await press(page, 's');
        check((await page.evaluate(() => location.hash)).startsWith('#/schedule'), 's 키 일정 이동 실패');
        await press(page, 'a');
        check((await page.evaluate(() => location.hash)).startsWith('#/attend'), 'a 키 출결 이동 실패');
        await press(page, 'd');
        check((await page.evaluate(() => location.hash)).startsWith('#/todo'), 'd 키 할 일 이동 실패');
        await press(page, 'n');
        await wait(150);
        check(await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === '메모'), 'n 키가 메모 칸으로 가지 않음');
        await page.evaluate(() => document.activeElement?.blur?.());
        await press(page, 'm');
        check((await page.evaluate(() => location.hash)).startsWith('#/minutes'), 'm 키 회의록 이동 실패');
        await press(page, 't');
        check((await page.evaluate(() => location.hash)) === '#/today', 't 키 오늘 이동 실패');
        /* 모달이 떠 있으면 / 는 쉼 */
        await press(page, '?');
        check(Boolean(await page.$('[aria-modal="true"][aria-label="단축키"]')), '? 키 목록이 안 열림');
        check(await page.evaluate(() => document.querySelector('.hotkey-defaults')?.innerText.includes('T 오늘')), '단축키 목록에 기본 키 안내 없음');
        await page.keyboard.press('/');
        await wait(120);
        check(!await page.evaluate(() => document.querySelector('.quick-bar').classList.contains('is-open')), '모달 위에서 / 가 빠른 입력을 엶');
        await page.keyboard.press('t');
        check(Boolean(await page.$('[aria-modal="true"][aria-label="단축키"]')), '모달 위에서 t가 먹음');
        if (shots) await page.screenshot({ path: `${shots}/단축키목록-1280-light.png` });
        await page.keyboard.press('?');
        await wait(120);
        check(!await page.$('[aria-modal="true"][aria-label="단축키"]'), '같은 ? 로 목록이 안 닫힘');
        /* 한글 조합 중 / */
        await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', isComposing: true, bubbles: true })));
        await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', keyCode: 229, bubbles: true })));
        await wait(120);
        check(!await page.evaluate(() => document.querySelector('.quick-bar').classList.contains('is-open')), '한글 조합 중 / 가 창을 엶');
        await page.close();
    }
    /* 1-1. / 키 = 화면 아래 쨈 버튼을 직접 누른 것과 같음(키캡 눌림·딸깍·쨈 튐·같은 팝업). 넓은 화면·좁은 화면, 쨈 손맛 켬·끔 */
    for (const [width, jam] of [[1280, '1'], [1280, '0'], [900, '1'], [1920, '0']]) {
        for (const how of ['button', 'slash']) {
            const page = await fresh(browser, { width, local: { 'ssug-gyomu-press-feel': jam, 'ssug-gyomu-key-sound': '1' } });
            await page.evaluate(() => {
                window.__snd = 0;
                const start = AudioBufferSourceNode.prototype.start;
                AudioBufferSourceNode.prototype.start = function (...a) { window.__snd += 1; return start.apply(this, a); };
                window.__seen = { pressedAtClick: false, popGen: 0, bloom: false, ghost: false };
                const quickBarOpen = () => document.querySelector('.quick-bar').classList.contains('is-open');
                for (const b of document.querySelectorAll('.desk-fab, .tbj-mid')) {
                    b.addEventListener('click', () => {
                        const d = b.querySelector('.fab-disc')?.getBoundingClientRect();
                        window.__seen.atClick = { disc: Math.round(d?.width || 0), bar: Math.round(document.querySelector('.quick-bar').getBoundingClientRect().width), reduce: matchMedia('(prefers-reduced-motion: reduce)').matches, open: quickBarOpen() };
                    }, true);
                    new MutationObserver(() => { if (b.classList.contains('is-pressed')) window.__seen.pressedAtClick = true; window.__seen.popGen = Math.max(window.__seen.popGen, Number(b.dataset.popGen) || 0); }).observe(b, { attributes: true });
                }
                const bar = document.querySelector('.quick-bar');
                new MutationObserver(() => { if (bar.classList.contains('is-bloom')) window.__seen.bloom = true; window.__seen.bx = bar.style.getPropertyValue('--bloom-x'); }).observe(bar, { attributes: true });
                new MutationObserver(() => { if (document.querySelector('[class*="ghost"]')) window.__seen.ghost = true; }).observe(document.body, { childList: true, subtree: true });
            });
            /* 소리 잠금을 풀기 위해 빈 곳을 한 번 누른 뒤 셉니다(사람도 페이지를 한 번은 만집니다). */
            await page.mouse.click(5, 895);
            await wait(120);
            await page.evaluate(() => { window.__snd = 0; });
            const fab = await page.evaluate(() => { const el = [...document.querySelectorAll('.desk-fab, .tbj-mid')].find((e) => e.getBoundingClientRect().width > 0); return el ? el.className : ''; });
            if (how === 'button') {
                const box = await page.evaluate(() => { const el = [...document.querySelectorAll('.desk-fab, .tbj-mid')].find((e) => e.getBoundingClientRect().width > 0); const r = el.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; });
                await page.mouse.move(box.x, box.y);
                await page.mouse.down();
                await wait(60);
                await page.mouse.up();
            } else {
                await page.keyboard.down('/');
                await wait(60);
                await page.keyboard.up('/');
            }
            await wait(30);
            const mid = await page.evaluate(() => ({ ...window.__seen }));
            if (shots && how === 'slash' && jam === '1') await page.screenshot({ path: `${shots}/슬래시-쨈팝-${width}-light.png` });
            await wait(400);
            const end = await page.evaluate(() => ({
                open: document.querySelector('.quick-bar').classList.contains('is-open'),
                focus: document.activeElement?.classList.contains('quick-field'),
                pressed: [...document.querySelectorAll('.desk-fab, .tbj-mid')].some((b) => b.classList.contains('is-pressed')),
                sheet: Boolean(document.querySelector('.sheet-back')),
                bars: document.querySelectorAll('.quick-bar').length,
                snd: window.__snd,
            }));
            const tag = `${how} ${width} 쨈손맛${jam}`;
            check(fab, `${tag}: 쨈 버튼이 안 보임`);
            check(end.open && end.focus, `${tag}: 쨈 팝업이 안 열림 ${JSON.stringify(end)}`);
            check(mid.pressedAtClick, `${tag}: 키캡 눌림 없음`);
            check(mid.popGen >= 1, `${tag}: 쨈 튐(포일 팝) 효과 없음`);
            check(mid.bloom, `${tag}: 팝업 번짐 효과 없음 ${JSON.stringify(mid)}`);
            check(end.snd > 0, `${tag}: 딸깍 소리 없음`);
            check(!end.pressed, `${tag}: 키캡이 눌린 채 남음`);
            check(!end.sheet && end.bars === 1, `${tag}: / 전용 창이나 시트가 따로 열림`);
            page.__r = { ...mid, ...end };
            (globalThis.__slashCmp ||= {})[`${width}-${jam}-${how}`] = { ...mid, ...end };
            await page.close();
        }
        const a = globalThis.__slashCmp[`${width}-${jam}-button`], b = globalThis.__slashCmp[`${width}-${jam}-slash`];
        for (const k of ['open', 'pressedAtClick', 'bloom', 'ghost', 'pressed', 'sheet', 'bars']) check(a[k] === b[k], `${width} 쨈손맛${jam}: 버튼과 / 의 ${k}가 다름 (${a[k]} ≠ ${b[k]})`);
        check(Math.sign(a.snd) === Math.sign(b.snd), `${width} 쨈손맛${jam}: 버튼과 / 의 소리가 다름 (${a.snd} / ${b.snd})`);
    }
    /* 1-2. 글자 칸(input·textarea·편집 가능한 영역)에 커서가 있으면 / 는 글자로 들어감 */
    {
        const page = await fresh(browser);
        await page.evaluate(() => {
            const wrap = document.createElement('div');
            wrap.id = 'slash-probe';
            wrap.innerHTML = '<input id="sp-i"><textarea id="sp-t"></textarea><div id="sp-c" contenteditable="true"></div>';
            document.body.appendChild(wrap);
        });
        for (const sel of ['#sp-i', '#sp-t', '#sp-c']) {
            await page.focus(sel);
            await page.keyboard.type('1/2');
            const v = await page.$eval(sel, (el) => ('value' in el ? el.value : el.textContent));
            check(v === '1/2', `${sel}에서 / 가 글자로 안 들어감: ${v}`);
            check(!await page.evaluate(() => document.querySelector('.quick-bar').classList.contains('is-open')), `${sel}에서 / 가 쨈 팝업을 엶`);
            check(!await page.evaluate(() => [...document.querySelectorAll('.desk-fab, .tbj-mid')].some((b) => b.classList.contains('is-pressed') || Number(b.dataset.popGen) > 0)), `${sel}에서 / 가 쨈 버튼을 누름`);
        }
        await page.close();
    }
    /* 1-3. 다섯 폭(320·360·390·900·1920) × 라이트·다크에서 말줄임표(…)로 잘린 글자가 없음 — 줄을 바꿉니다. */
    for (const [width, mode] of [320, 360, 390, 900, 1920].flatMap((w) => [[w, 'light'], [w, 'dark']])) {
        const page = await fresh(browser, { width, height: 844, mode });
        for (const hash of ['#/today', '#/attend', '#/schedule', '#/todo', '#/minutes', '#/notice', '#/students', '#/settings']) {
            await page.evaluate((h) => { location.hash = h; }, hash);
            await wait(500);
            const cut = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((el) => {
                const cs = getComputedStyle(el);
                if (cs.textOverflow !== 'ellipsis' || !el.getBoundingClientRect().width) return false;
                return el.scrollWidth > el.clientWidth + 1;
            }).map((el) => `${el.className || el.tagName}: ${el.innerText.slice(0, 24)}`));
            check(!cut.length, `${mode} ${width} ${hash} 말줄임표로 잘림: ${cut.join(' / ')}`);
            if (shots && (hash === '#/todo' || hash === '#/today')) await page.screenshot({ path: `${shots}/줄바꿈-${hash.slice(2)}-${width}-${mode}.png` });
        }
        await page.close();
    }
    /* 2. 예전부터 쓰던 기기(저장값)는 그대로 */
    {
        const page = await fresh(browser, { local: { 'ssug-gyomu-hotkeys': JSON.stringify({ plus: '/', help: '?', today: '', attend: '', schedule: '' }) } });
        await press(page, 's');
        check(!(await page.evaluate(() => location.hash)).startsWith('#/schedule'), '예전 저장값의 빈 칸에 새 기본 s가 끼어듦');
        await press(page, '/');
        check(await quickOpen(page), '예전 기기에서도 / 가 쨈 빠른 입력');
        await page.close();
    }
    /* 3. 시간구 노란 카드: 퇴근 미설정 → 확인, 설정 → 바로 */
    {
        const page = await fresh(browser);
        await press(page, '/');
        await page.keyboard.type('퇴근 전까지 공문 회신');
        await page.click('.quick-chip[data-kind="할 일"]');
        await page.waitForSelector('[data-quick-ask="workEnd"]', { timeout: 3000 }).catch(() => {});
        const ask = await page.evaluate(() => ({ text: document.querySelector('.quick-ask')?.innerText || '', open: document.querySelector('.quick-bar').classList.contains('is-open'), bg: getComputedStyle(document.querySelector('.quick-ask') || document.body).backgroundColor }));
        check(ask.text.includes('퇴근 시각') && ask.open, `퇴근 미설정인데 노란 카드가 없음: ${JSON.stringify(ask)}`);
        await audit(page, '노란 카드 1280', '.quick-bar');
        if (shots) await page.screenshot({ path: `${shots}/노란카드-1280-light.png` });
        const pick = await page.$$eval('.quick-ask button', (els) => els.map((el) => el.innerText.trim()));
        check(pick.some((t) => t.includes('오후 4시 20분')) && pick.includes('시각 없이 넣기') && pick.includes('설정에서 정하기'), `노란 카드 선택지가 다름: ${pick.join('|')}`);
        await page.evaluate(() => [...document.querySelectorAll('.quick-ask button')].find((el) => el.innerText.includes('오후 4시 20분')).click());
        await wait(500);
        const toast1 = await page.evaluate(() => window.__toasts.join(' / '));
        check(/알림/.test(toast1) && /4시 20분/.test(toast1), `추천값 선택 뒤 알림 저장 안내 없음: ${toast1}`);
        const saved = await page.evaluate(() => localStorage.getItem('ssug-gyomu-period-local') || '');
        check(!saved.includes('16:30'), '노란 카드가 설정에 추천값을 몰래 저장함');
        await page.evaluate(() => {
            localStorage.setItem('ssug-gyomu-period-local', JSON.stringify({ workStart: '08:30', workEnd: '16:40' }));
            window.__toasts = [];
        });
        await page.reload({ waitUntil: 'networkidle0' });
        await page.waitForSelector('.quick-bar');
        await press(page, '/');
        await page.keyboard.type('퇴근 전까지 출력');
        await page.click('.quick-chip[data-kind="할 일"]');
        await wait(500);
        const toast2 = await page.evaluate(() => window.__toasts.join(' / '));
        check(!await page.$('.quick-ask') && /퇴근 16:40 기준/.test(toast2) && /4시 30분/.test(toast2), `퇴근이 있는데 바로 넣지 않음: ${toast2}`);
        await page.close();
    }
    /* 4. 폭·테마별: 출결 마감, 설정 추천 카드, 노란 카드 */
    for (const mode of ['light', 'dark']) {
        for (const width of [320, 360, 390, 900, 1920]) {
            const page = await fresh(browser, { width, height: width >= 900 ? 1000 : 780, mode });
            await page.goto(`${origin}?demo=1&mode=${mode}#/attend/${TODAY}`, { waitUntil: 'networkidle0' });
            await page.waitForSelector('.attend-close', { timeout: 5000 }).catch(() => {});
            const before = await page.evaluate(() => { const b = document.querySelector('.attend-close'); return b ? { pressed: b.getAttribute('aria-pressed'), text: b.innerText.trim(), shadow: getComputedStyle(b).boxShadow, h: b.getBoundingClientRect().height } : null; });
            check(Boolean(before), `${mode} ${width} 출결 마감 단추 없음`);
            if (before) {
                await page.$eval('.attend-close', (el) => el.scrollIntoView({ block: 'center' }));
                await page.click('.attend-close');
                await wait(350);
                const after = await page.evaluate(() => { const b = document.querySelector('.attend-close'); return { pressed: b.getAttribute('aria-pressed'), text: b.innerText.trim(), shadow: getComputedStyle(b).boxShadow, note: document.querySelector('.attend-close-note')?.innerText || '' }; });
                const [open, closed] = before.pressed === 'true' ? [after, before] : [before, after];
                check(open.pressed === 'false' && /마감하기/.test(open.text) && !/inset/.test(open.shadow), `${mode} ${width} 풀린 단추가 튀어나온 모양 아님: ${JSON.stringify(open)}`);
                check(closed.pressed === 'true' && /마감됨/.test(closed.text) && /inset/.test(closed.shadow), `${mode} ${width} 마감 단추가 눌린 모양 아님: ${JSON.stringify(closed)}`);
                check(before.h >= 44, `${mode} ${width} 마감 단추 높이 ${before.h}`);
                await audit(page, `${mode} ${width} 출결`, '.attend-layout aside');
                if (shots) {
                    await page.screenshot({ path: `${shots}/출결-${after.pressed === 'true' ? '마감됨' : '마감하기'}-${width}-${mode}.png` });
                    await page.click('.attend-close');
                    await wait(350);
                    await page.$eval('.attend-close', (el) => el.scrollIntoView({ block: 'center' }));
                    const st = await page.$eval('.attend-close', (el) => el.getAttribute('aria-pressed'));
                    await page.screenshot({ path: `${shots}/출결-${st === 'true' ? '마감됨' : '마감하기'}-${width}-${mode}.png` });
                }
            }
            await page.goto(`${origin}?demo=1&mode=${mode}#/settings/calendar`, { waitUntil: 'networkidle0' });
            await page.waitForSelector('.tt-settings', { timeout: 5000 }).catch(() => {});
            const sug = await page.evaluate(() => ({ work: Boolean(document.querySelector('[data-suggest="work"]')), bells: Boolean(document.querySelector('[data-suggest="bells"]')) }));
            check(sug.work, `${mode} ${width} 출퇴근 추천 카드 없음`);
            await audit(page, `${mode} ${width} 시간표 설정`, '.tt-settings');
            if (shots) {
                await page.$eval('.tt-settings', (el) => el.scrollIntoView({ block: 'start' }));
                await page.screenshot({ path: `${shots}/설정-추천-${width}-${mode}.png` });
            }
            await page.goto(`${origin}?demo=1&mode=${mode}#/today`, { waitUntil: 'networkidle0' });
            await page.waitForSelector('.quick-bar');
            await press(page, '/');
            await page.keyboard.type('퇴근 전까지 공문 회신');
            await page.click('.quick-chip[data-kind="할 일"]');
            await page.waitForSelector('.quick-ask', { timeout: 3000 }).catch(() => {});
            check(Boolean(await page.$('.quick-ask')), `${mode} ${width} 노란 카드 없음`);
            await audit(page, `${mode} ${width} 노란 카드`, '.quick-bar');
            if (shots) await page.screenshot({ path: `${shots}/노란카드-${width}-${mode}.png` });
            /* 「모레 저녁」은 시각을 정하지 않고 노란 카드(오후 6시 추천)로 묻습니다. */
            await page.evaluate(() => { const el = document.querySelector('.quick-bar textarea, .quick-bar input'); if (el) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } });
            await page.focus('.quick-bar textarea, .quick-bar input').catch(() => {});
            await page.keyboard.down('Control'); await page.keyboard.press('a'); await page.keyboard.up('Control'); await page.keyboard.press('Backspace');
            await page.keyboard.type('모레 저녁 학부모 간담회');
            await page.click('.quick-chip[data-kind="일정"]');
            await page.waitForSelector('[data-quick-ask="vague"]', { timeout: 3000 }).catch(() => {});
            const eve = await page.evaluate(() => ({ text: document.querySelector('.quick-ask')?.innerText || '', btns: [...document.querySelectorAll('.quick-ask button')].map((b) => b.innerText.trim()) }));
            check(/모레 저녁/.test(eve.text) && /몇 시인지/.test(eve.text) && eve.btns.some((t) => t.includes('오후 6시')), `${mode} ${width} 모레 저녁 노란 카드가 다름: ${JSON.stringify(eve)}`);
            await audit(page, `${mode} ${width} 저녁 노란 카드`, '.quick-bar');
            if (shots) await page.screenshot({ path: `${shots}/저녁카드-${width}-${mode}.png` });
            await page.close();
        }
    }
    /* 6. 넓은 화면 사이드바 메뉴 너비 통일(900·1920 × 라이트·다크). 탭바 동기화는 건드리지 않고 CSS만 봅니다. */
    for (const mode of ['light', 'dark']) {
        for (const width of [900, 1920]) {
            const page = await fresh(browser, { width, height: 1000, mode });
            const side = await page.evaluate(() => {
                const btns = [...document.querySelectorAll('.side-menu button')].filter((el) => el.getBoundingClientRect().width > 0);
                const menu = document.querySelector('.side-menu')?.getBoundingClientRect();
                return { shown: btns.length, widths: [...new Set(btns.map((el) => Math.round(el.getBoundingClientRect().width)))], menuW: Math.round(menu?.width || 0) };
            });
            if (side.shown) {
                check(side.widths.length === 1 && Math.abs(side.widths[0] - side.menuW) <= 1, `${mode} ${width} 사이드바 메뉴 너비가 다름: ${JSON.stringify(side)}`);
                await audit(page, `${mode} ${width} 사이드바`, '.side-menu');
            } else check(width < 900, `${mode} ${width} 사이드바가 안 보임`);
            if (shots) await page.screenshot({ path: `${shots}/사이드바-${width}-${mode}.png` });
            await page.close();
        }
    }
    /* 5. 추천값 적용은 한 번 눌러 저장, 이미 값 있으면 카드 없음 */
    {
        const page = await fresh(browser);
        await page.goto(`${origin}?demo=1#/settings/calendar`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('[data-suggest="work"] button');
        await page.click('[data-suggest="work"] button');
        await wait(300);
        const saved = JSON.parse(await page.evaluate(() => localStorage.getItem('ssug-gyomu-period-local') || '{}'));
        check(saved.workStart === '08:30' && saved.workEnd === '16:30', `추천값 적용이 저장되지 않음: ${JSON.stringify(saved)}`);
        check(!await page.$('[data-suggest="work"]'), '적용 뒤에도 추천 카드가 남음');
        const fields = await page.evaluate(() => [document.querySelector('.tt-work input[aria-label="출근 시각"]').value, document.querySelector('.tt-work input[aria-label="퇴근 시각"]').value]);
        check(fields[0] === '08:30' && fields[1] === '16:30', `칸에 추천값이 안 보임: ${fields}`);
        await page.close();
        const kept = await fresh(browser, { local: { 'ssug-gyomu-period-local': JSON.stringify({ workStart: '', workEnd: '17:10' }) } });
        await kept.goto(`${origin}?demo=1#/settings/calendar`, { waitUntil: 'networkidle0' });
        await kept.waitForSelector('.tt-settings');
        check(!await kept.$('[data-suggest="work"]'), '퇴근만 정한 사용자에게 추천 카드를 보임');
        const still = JSON.parse(await kept.evaluate(() => localStorage.getItem('ssug-gyomu-period-local') || '{}'));
        check(still.workEnd === '17:10' && !still.workStart, `기존 퇴근 값이 바뀜: ${JSON.stringify(still)}`);
        await kept.close();
    }
} catch (error) {
    failures.push(`검사 중 오류: ${error.message}`);
} finally {
    await browser.close();
    preview.kill();
}
if (failures.length) { console.error(`PR E 브라우저 검사 실패 ${failures.length}개`); for (const f of failures) console.error(`- ${f}`); process.exit(1); }
console.log('PR E 브라우저 검사 통과');
