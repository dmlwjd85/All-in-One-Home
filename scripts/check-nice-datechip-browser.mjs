/**
 * #76 브라우저 동작 검사(코드 글자 비교가 아니라 실제 화면·저장값을 봅니다).
 * - + 화면·메시지 붙여넣기: 칩을 안 건드리면 파서 제목·날짜·기간 그대로, 오전↔오후·칩 빼기를 해도 제목·기간 유지, 여러 줄은 줄마다 파서 값
 * - 빠른 입력·할 일: 오전↔오후로 고친 칩 시각이 저장값(IndexedDB put)에 들어감
 * - 메모: 저장값에 시각을 보이지 않음
 * - 나이스: 목록에서 고른 학생이 상세에 보임, 900px 미만 목록 버튼은 글자 길이·상세를 멀리 밀지 않음
 * - 설정: 900px 이상 두 칸 격자, 버튼은 칸 폭으로 늘지 않고 글자 길이에 맞음
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
if (!chrome || !existsSync(resolve(root, 'dist/index.html'))) {
    console.error('크롬 또는 dist가 없어 #76 브라우저 검사를 돌릴 수 없어요. npm run build 뒤에 다시 돌려 주세요.');
    process.exit(1);
}
const port = 4243;
const origin = `http://127.0.0.1:${port}/`;
const shots = process.env.NICE_SHOTS || '';
if (shots) mkdirSync(shots, { recursive: true });
const FIXED = '2026-11-11T09:00:00+09:00';
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* 다른 미리보기가 같은 자리를 쓰고 있으면 엉뚱한 빌드를 검사하게 되므로 멈춥니다. */
try {
    await fetch(origin);
    console.error(`127.0.0.1:${port}에 이미 다른 서버가 있어요. 끈 뒤 다시 돌려 주세요.`);
    process.exit(1);
} catch { /* 비어 있음 */ }
const preview = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
    await wait(250);
}

async function fresh(browser, { width = 1280, height = 900, hash = '#/today', mode = 'light' } = {}) {
    const context = await browser.createBrowserContext();
    const page = await context.newPage();
    const close = page.close.bind(page);
    page.close = async () => { await close(); await context.close(); };
    await page.setViewport({ width, height });
    page.on('pageerror', (error) => failures.push(`화면 오류(${hash} ${width}): ${error?.message || error}`));
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
        localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
        localStorage.setItem('ssug-gyomu-speech-notice', '1');
        /* 저장값은 IndexedDB에 쓰는 값 그대로 봅니다. */
        /* 글자 폭: 글자 조각(텍스트 노드)만 재서 가장 왼쪽~오른쪽 폭을 돌려줍니다(블록 자식이 있어도 칸 폭이 아니라 글자 폭). */
        window.__ink = (el) => {
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let left = Infinity;
            let right = -Infinity;
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
                if (!node.textContent.trim()) continue;
                const range = document.createRange();
                range.selectNodeContents(node);
                for (const rect of range.getClientRects()) {
                    if (!rect.width) continue;
                    left = Math.min(left, rect.left);
                    right = Math.max(right, rect.right);
                }
            }
            return right > left ? Math.round(right - left) : 0;
        };
        window.__puts = [];
        const put = IDBObjectStore.prototype.put;
        IDBObjectStore.prototype.put = function (value, ...rest) {
            try { window.__puts.push(JSON.parse(JSON.stringify(value))); } catch { /* 복제 못 하는 값 */ }
            return put.call(this, value, ...rest);
        };
    }, FIXED);
    await page.goto(`${origin}?demo=1&mode=${mode}${hash}`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.quick-bar');
    return page;
}

/* IndexedDB에 쓴 값 가운데 제목(또는 글)이 같은 줄을 찾습니다. */
const savedRow = (page, key, value) => page.evaluate((k, v) => {
    const found = [];
    const walk = (node, depth) => {
        if (!node || typeof node !== 'object' || depth > 6) return;
        if (Array.isArray(node)) { node.forEach((item) => walk(item, depth + 1)); return; }
        if (node[k] === v) found.push(node);
        Object.values(node).forEach((item) => walk(item, depth + 1));
    };
    window.__puts.forEach((item) => walk(item, 0));
    return found[found.length - 1] || null;
}, key, value);

const clickText = (page, scope, text) => page.evaluate((s, t) => {
    const el = [...document.querySelectorAll(`${s} button`)].find((b) => b.innerText.replace(/\s+/g, ' ').trim().includes(t) && b.getClientRects().length);
    el?.click();
    return Boolean(el);
}, scope, text);

async function setField(page, selector, text) {
    await page.focus(selector);
    await page.evaluate((sel) => { const el = document.querySelector(sel); el.select?.(); }, selector);
    await page.keyboard.press('Backspace');
    /* 줄바꿈은 Shift+Enter로 넣습니다(Enter는 미리보기). */
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i += 1) {
        if (i) {
            await page.keyboard.down('Shift');
            await page.keyboard.press('Enter');
            await page.keyboard.up('Shift');
        }
        await page.type(selector, lines[i], { delay: 2 });
    }
    await wait(150);
}

/* 칩을 고친 뒤 줄을 더 적습니다(한 건 → 여러 건). */
async function addLine(page, selector, line) {
    await page.focus(selector);
    await page.evaluate((sel) => { const el = document.querySelector(sel); el.setSelectionRange(el.value.length, el.value.length); }, selector);
    await page.keyboard.down('Shift');
    await page.keyboard.press('Enter');
    await page.keyboard.up('Shift');
    await page.type(selector, line, { delay: 2 });
    await wait(150);
}

async function openQuick(page) {
    await page.evaluate(() => [...document.querySelectorAll('[aria-label="쨈 빠른 입력 열기"]')].find((el) => el.getBoundingClientRect().width > 0)?.click());
    await page.waitForSelector('.quick-bar.is-open .quick-field');
}

async function openPlus(page) {
    await openQuick(page);
    await page.evaluate(() => document.querySelector('.quick-bar.is-open .quick-paste')?.click());
    await page.waitForSelector('[data-screen="plus"] textarea');
}

/* + 화면 미리보기 카드를 모두 펼쳐 제목·날짜·끝나는 날·시각을 읽습니다. */
async function plusCards(page) {
    await page.waitForFunction(() => document.querySelector('[data-screen="plus"]')?.dataset.phase === 'preview', { timeout: 4000 });
    return page.evaluate(async () => {
        const cards = [...document.querySelectorAll('[data-screen="plus"] article[aria-label="미리보기"]')];
        const out = [];
        for (const card of cards) {
            const summary = card.querySelector('.capture-summary').innerText.trim();
            card.querySelector('.capture-summary').click();
            await new Promise((r) => setTimeout(r, 60));
            const title = card.querySelector('input[aria-label="내용"]')?.value || '';
            const text = card.innerText;
            out.push({ summary, title, date: /날짜 · ([^\n]+)/.exec(text)?.[1] || '', end: /끝나는 날 · ([^\n]+)/.exec(text)?.[1] || '' });
        }
        return out;
    });
}

async function plusRun(page, text, act) {
    await setField(page, '[data-screen="plus"] textarea', text);
    if (act) await act();
    const live = await page.evaluate(() => ({
        title: document.querySelector('[data-screen="plus"] [data-live-title]')?.innerText || '',
        value: document.querySelector('[data-screen="plus"] [data-live-value]')?.innerText || '',
        multi: document.querySelector('[data-screen="plus"] [data-live-multi]')?.dataset.liveMulti || '',
    }));
    await page.focus('[data-screen="plus"] textarea');
    await page.keyboard.press('Enter');
    const cards = await plusCards(page);
    await clickText(page, '[data-screen="plus"]', '다시 적기');
    await page.waitForSelector('[data-screen="plus"] textarea');
    return { live, cards };
}

async function openMsg(page) {
    await page.evaluate(() => { try { Object.defineProperty(navigator, 'clipboard', { value: { readText: () => Promise.reject(new Error('no')) }, configurable: true }); } catch { /* 없음 */ } });
    await openPlus(page);
    const ok = await clickText(page, '[data-screen="plus"]', '메시지');
    if (!ok) throw new Error('메시지 붙여넣기 단추를 못 찾았어요');
    await page.waitForSelector('[data-screen="message"] textarea');
}

/* 메시지 미리보기 카드의 제목과 날짜 줄을 읽습니다. */
async function msgRun(page, text, act) {
    await setField(page, '[data-screen="message"] textarea', text);
    if (act) await act();
    const live = await page.evaluate(() => ({
        title: document.querySelector('[data-screen="message"] [data-live-title]')?.innerText || '',
        value: document.querySelector('[data-screen="message"] [data-live-value]')?.innerText || '',
        multi: document.querySelector('[data-screen="message"] [data-live-multi]')?.dataset.liveMulti || '',
        chips: document.querySelectorAll('[data-screen="message"] .date-chip').length,
    }));
    await clickText(page, '[data-screen="message"]', '이 메시지 읽기');
    await page.waitForFunction(() => !document.querySelector('[data-screen="message"] textarea'), { timeout: 4000 });
    const cards = await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] .msg-card')].map((card) => `${card.querySelector('input[aria-label="제목"]')?.value || ''} | ${card.innerText.replace(/\s+/g, ' ').trim()}`));
    return { live, cards };
}

const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
    for (const width of [390, 1280]) {
        const tag = `${width}`;
        /* 1) + 화면 */
        {
            const page = await fresh(browser, { width, height: width < 900 ? 844 : 900 });
            await openPlus(page);
            const notice = await plusRun(page, '[알림] 내일 3시 학년 회의가 있습니다. 참석 바랍니다.');
            check(notice.cards.length === 1 && notice.cards[0].title === '학년 회의', `[${tag}] + 제목이 파서 제목(학년 회의)이 아니에요: ${JSON.stringify(notice.cards)}`);
            check(notice.live.title === '학년 회의' && notice.live.value === '2026-11-12 15:00', `[${tag}] + 칩 아래 저장값이 미리보기와 달라요: ${JSON.stringify(notice.live)}`);
            const trip = await plusRun(page, '11월 18일~11월 20일 수학여행');
            check(trip.cards.length === 1 && trip.cards[0].title === '수학여행' && trip.cards[0].end, `[${tag}] + 기간 제목·끝나는 날이 망가졌어요: ${JSON.stringify(trip.cards)}`);
            const flip = await plusRun(page, '[알림] 내일 3시 학년 회의가 있습니다. 참석 바랍니다.', () => page.click('[data-screen="plus"] [data-ampm-flip]'));
            check(flip.cards[0]?.title === '학년 회의' && flip.cards[0]?.summary.includes('03:00'), `[${tag}] + 오전↔오후 뒤 제목·시각이 달라요: ${JSON.stringify(flip.cards)}`);
            const tripOff = await plusRun(page, '11월 18일~11월 20일 수학여행', () => page.click('[data-screen="plus"] .date-chip[data-chip-type="date"]'));
            check(tripOff.cards[0]?.title === '수학여행' && tripOff.cards[0]?.end && tripOff.cards[0]?.date !== tripOff.cards[0]?.end, `[${tag}] + 시작 날짜 칩을 빼면 기간이 망가져요: ${JSON.stringify(tripOff.cards)}`);
            /* 한 줄 가드: 여러 줄이면 칩 고침을 다른 줄에 덮어쓰지 않습니다. */
            /* 한 줄일 때 오전↔오후를 누른 뒤 줄을 더하면, 그 고침을 다른 줄에 덮지 않습니다. */
            const multi = await plusRun(page, '내일 3시 회의', async () => {
                await page.click('[data-screen="plus"] [data-ampm-flip]');
                await addLine(page, '[data-screen="plus"] textarea', '모레 4시 공개수업');
            });
            check(multi.live.multi === '2', `[${tag}] + 여러 줄인데 칩 줄을 그대로 보여요(저장값 오해): ${JSON.stringify(multi.live)}`);
            check(multi.cards.length === 2 && multi.cards[0].summary.includes('15:00') && multi.cards[1].summary.includes('16:00'), `[${tag}] + 여러 줄 시각이 파서 값과 달라요: ${JSON.stringify(multi.cards)}`);
            if (shots && width === 390) {
                await setField(page, '[data-screen="plus"] textarea', '[알림] 내일 3시 학년 회의가 있습니다. 참석 바랍니다.');
                await page.screenshot({ path: `${shots}/plus-title-${tag}.png` });
            }
            await page.close();
        }
        /* 2) 메시지 붙여넣기 */
        {
            const page = await fresh(browser, { width, height: width < 900 ? 844 : 900 });
            await openMsg(page);
            const one = await msgRun(page, '[알림] 내일 3시 학년 회의가 있습니다. 참석 바랍니다.', () => page.click('[data-screen="message"] [data-ampm-flip]'));
            check(one.cards.length === 1 && one.cards[0].split(' | ')[0] === '학년 회의' && /03:00/.test(one.cards[0]) && !/오후로 봤어요/.test(one.cards[0]), `[${tag}] 메시지 한 건 오전↔오후 뒤 제목·시각이 달라요: ${JSON.stringify(one.cards)}`);
            check(one.live.title === '학년 회의', `[${tag}] 메시지 칩 아래 제목이 미리보기와 달라요: ${JSON.stringify(one.live)}`);
            await page.close();
        }
        {
            const page = await fresh(browser, { width, height: width < 900 ? 844 : 900 });
            await openMsg(page);
            const trip = await msgRun(page, '11월 18일~11월 20일 수학여행', () => page.click('[data-screen="message"] .date-chip[data-chip-type="date"]'));
            check(trip.cards.length === 1 && trip.cards[0].split(' | ')[0] === '수학여행' && /11월 18일/.test(trip.cards[0]) && /11월 20일/.test(trip.cards[0]), `[${tag}] 메시지 시작 날짜 칩을 빼면 기간이 망가져요: ${JSON.stringify(trip.cards)}`);
            await page.close();
        }
        {
            const page = await fresh(browser, { width, height: width < 900 ? 844 : 900 });
            await openMsg(page);
            /* 첫 줄에서 오전↔오후를 누른 뒤 여러 건이 되어도, 건마다 파서 값을 그대로 둡니다. */
            const many = await msgRun(page, '1. 11월 13일 3시 학년 협의회', async () => {
                await page.click('[data-screen="message"] [data-ampm-flip]');
                await addLine(page, '[data-screen="message"] textarea', '2. 11월 17일까지 생활기록부 점검 제출');
                await addLine(page, '[data-screen="message"] textarea', '3. 11월 20일 10시 공개수업');
            });
            check(many.live.multi === '3' && many.live.chips === 0 && !many.live.value, `[${tag}] 메시지 여러 건인데 첫 건 저장값·칩을 보여요: ${JSON.stringify(many.live)}`);
            check(many.cards.length >= 3 && /15:00/.test(many.cards.join(' ')) && /10:00/.test(many.cards.join(' ')) && !/03:00/.test(many.cards.join(' ')), `[${tag}] 메시지 여러 건 결과가 파서 값과 달라요: ${JSON.stringify(many.cards)}`);
            await page.close();
        }
        /* 3) 빠른 입력: 고친 칩 시각이 저장값 */
        {
            const page = await fresh(browser, { width, height: width < 900 ? 844 : 900 });
            await openQuick(page);
            await clickText(page, '.quick-bar.is-open .quick-chips', '일정');
            await page.type('.quick-bar.is-open .quick-field', '내일 3시 학년 협의', { delay: 2 });
            await wait(300);
            await page.click('[data-live-chips] [data-ampm-flip]');
            await wait(120);
            await page.focus('.quick-bar.is-open .quick-field');
            await page.keyboard.press('Enter');
            await wait(900);
            const row = await savedRow(page, 'title', '학년 협의');
            check(row && row.time === '03:00' && row.date === '2026-11-12', `[${tag}] 빠른 입력이 고친 칩 시각(03:00)을 저장하지 않아요: ${JSON.stringify(row)}`);
            await page.close();
        }
        /* 4) 할 일: 고친 칩 시각이 저장값, 메모는 시각을 보이지 않음 */
        {
            const page = await fresh(browser, { width, height: width < 900 ? 844 : 900, hash: '#/todo' });
            await page.waitForSelector('input[aria-label="할 일"]');
            await page.type('input[aria-label="할 일"]', '내일 3시 생기부 점검', { delay: 2 });
            await wait(200);
            await page.click('form [data-live-chips] [data-ampm-flip]');
            await wait(120);
            await page.focus('input[aria-label="할 일"]');
            await page.keyboard.press('Enter');
            await wait(900);
            const row = await savedRow(page, 'title', '생기부 점검');
            check(row && row.time === '03:00' && row.due === '2026-11-12', `[${tag}] 할 일이 고친 칩 시각(03:00)을 저장하지 않아요: ${JSON.stringify(row)}`);
            const memo = await page.$('textarea[aria-label="메모"]');
            if (memo) {
                await page.type('textarea[aria-label="메모"]', '내일 3시 회의 자료', { delay: 2 });
                await wait(200);
                const note = await page.evaluate(() => {
                    const box = document.querySelector('textarea[aria-label="메모"]').closest('form').querySelector('[data-live-chips]');
                    return { value: box?.querySelector('[data-live-value]')?.innerText || '', time: box ? box.querySelectorAll('[data-chip-type="time"]').length : -1 };
                });
                check(!/\d{2}:\d{2}/.test(note.value) && note.time === 0, `[${tag}] 메모 칸이 저장하지 않는 시각을 보여요: ${JSON.stringify(note)}`);
            } else check(false, `[${tag}] 메모 칸을 못 찾았어요`);
            await page.close();
        }
        /* 5) 나이스 목록·상세 */
        {
            const page = await fresh(browser, { width, height: width < 900 ? 844 : 900, hash: '#/students/neis' });
            await page.waitForSelector('.neis-list-item');
            const items = await page.$$('.neis-list-item');
            check(items.length >= 2, `[${tag}] 나이스 목록에 학생이 둘 이상 있어야 검사할 수 있어요: ${items.length}`);
            if (items.length >= 2) {
                const label = await items[1].evaluate((el) => el.firstChild.textContent.trim());
                await items[1].click();
                await wait(150);
                const head = await page.$eval('.neis-detail h3', (el) => el.innerText.trim());
                check(head === label, `[${tag}] 나이스 목록에서 고른 학생이 상세에 안 보여요: 고름 ${label} / 상세 ${head}`);
            }
            const fit = await page.evaluate(() => {
                const list = document.querySelector('.neis-list');
                const rows = [...document.querySelectorAll('.neis-list-item')].map((el) => ({ w: Math.round(el.getBoundingClientRect().width), ink: window.__ink(el) }));
                return { rows, listH: Math.round(list.getBoundingClientRect().height), detailTop: Math.round(document.querySelector('.neis-detail').getBoundingClientRect().top - list.getBoundingClientRect().top), vw: innerWidth };
            });
            check(fit.rows.every((r) => r.w <= r.ink + 48), `[${tag}] 나이스 목록 버튼이 글자보다 훨씬 넓어요: ${JSON.stringify(fit.rows)}`);
            if (width < 900) check(fit.detailTop <= 150, `[${tag}] 900px 미만에서 나이스 목록이 상세를 멀리 밀어요: ${fit.detailTop}px`);
            if (shots) await page.screenshot({ path: `${shots}/neis-${tag}.png` });
            await page.close();
        }
    }
    /* 6) 설정 두 칸·버튼 글자 길이 */
    for (const width of [390, 1280, 1920]) {
        const page = await fresh(browser, { width, height: width < 900 ? 844 : 1000, hash: '#/settings' });
        await page.waitForSelector('.settings-menu .settings-key');
        const r = await page.evaluate(() => {
            const menu = document.querySelector('.settings-menu');
            const cols = getComputedStyle(menu).gridTemplateColumns.split(' ').filter(Boolean).length;
            const keys = [...menu.querySelectorAll('.settings-key')].map((el) => {
                return { w: Math.round(el.getBoundingClientRect().width), ink: window.__ink(el), text: el.innerText.replace(/\s+/g, ' ').trim() };
            });
            return { display: getComputedStyle(menu).display, cols, keys };
        });
        if (width >= 900) check(r.display === 'grid' && r.cols === 2, `[${width}] 설정이 두 칸이 아니에요: ${r.display} ${r.cols}`);
        check(r.keys.every((k) => k.w <= k.ink + 48), `[${width}] 설정 버튼이 글자 길이보다 늘어나요: ${JSON.stringify(r.keys.map((k) => `${k.text} ${k.w}/${k.ink}`))}`);
        if (shots) await page.screenshot({ path: `${shots}/settings-${width}.png` });
        await page.close();
    }
} catch (error) {
    failures.push(`검사 중 오류: ${error?.message || error} ${process.env.NICE_DEBUG ? error?.stack : ""}`);
} finally {
    await browser.close().catch(() => {});
    preview.kill('SIGKILL');
}
if (failures.length) {
    console.error(`#76 브라우저 동작 검사 실패 ${failures.length}개`);
    failures.forEach((f) => console.error(`- ${f}`));
    process.exit(1);
}
console.log('#76 브라우저 동작 검사 통과 (+ 화면 제목·기간, 메시지 한 건·여러 건, 빠른 입력·할 일 칩 시각 저장, 메모 시각 숨김, 나이스 목록 선택·너비, 설정 두 칸·버튼 너비)');
