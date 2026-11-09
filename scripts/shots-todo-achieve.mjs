/**
 * 할 일 성취(PR C) 화면 확인: 320·360·390·900·1920px × 라이트·다크에서 겹침·화면 밖·44px 터치를 재고 스크린샷을 남깁니다.
 * SHOTS=폴더 를 주면 그 폴더에 PNG를 남기고, GIF=1 이면 완료 효과 프레임도 남깁니다. 실패가 있으면 1로 끝납니다.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
const port = 4311;
const origin = `http://127.0.0.1:${port}/`;
const shots = process.env.SHOTS || '';
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

const preview = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
    await new Promise((r) => setTimeout(r, 250));
}
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

/* 보이는 단추·칸끼리 겹침, 화면 밖, 44px 미만을 셉니다. */
const audit = (page, sel, { heightOnly = false } = {}) => page.evaluate((sel, heightOnly) => {
    const vw = document.documentElement.clientWidth;
    const out = { small: [], outside: [], overlap: [] };
    const nodes = [...document.querySelectorAll(sel)].filter((el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden'; });
    const boxes = nodes.map((el) => ({ el, r: el.getBoundingClientRect(), name: (el.getAttribute('aria-label') || el.textContent || el.className).trim().slice(0, 24) }));
    for (const b of boxes) {
        if (b.el.matches('button, [role="button"]') && (b.r.height < 44 - 0.5 || (!heightOnly && b.r.width < 44 - 0.5))) out.small.push(`${b.name} ${Math.round(b.r.width)}x${Math.round(b.r.height)}`);
        if (b.r.left < -0.5 || b.r.right > vw + 0.5) out.outside.push(`${b.name} ${Math.round(b.r.left)}~${Math.round(b.r.right)}/${vw}`);
    }
    for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
        const a = boxes[i]; const b = boxes[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const x = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
        const y = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
        if (x > 1 && y > 1) out.overlap.push(`${a.name} ↔ ${b.name}`);
    }
    return out;
}, sel, heightOnly);
const report = (tag, res) => {
    check(!res.small.length, `${tag} 44px 미만: ${res.small.join(', ')}`);
    check(!res.outside.length, `${tag} 화면 밖: ${res.outside.join(', ')}`);
    check(!res.overlap.length, `${tag} 겹침: ${res.overlap.join(', ')}`);
};
const TODO_SEL = '.todo-add-row .field, .pri-picks .choice-tile, .todo-sort .choice-tile, .goal-meter, .todo-line > *, .todo-main .pri-mark, .todo-main .todo-title';

async function addTodo(page, title, pri) {
    await page.click(`.todo-add-row [data-pri-pick="${pri}"]`);
    await page.type('input[aria-label="할 일"]', title);
    await page.keyboard.press('Enter');
    await page.waitForFunction((t) => [...document.querySelectorAll('.todo-title')].some((el) => el.textContent.includes(t)), { timeout: 8000 }, title).catch(async (error) => {
        if (shots) await page.screenshot({ path: `${shots}/_fail-add.png` });
        throw error;
    });
}

try {
    const fresh = async () => {
        const ctx = await browser.createBrowserContext();
        const p = await ctx.newPage();
        await p.evaluateOnNewDocument(() => {
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-tips', JSON.stringify({ hidden: ['*'], seen: [], closes: {}, snooze: '2999-12-31' }));
        });
        return p;
    };
    let page = null;
    for (const mode of ['light', 'dark']) {
        for (const width of [320, 360, 390, 900, 1920]) {
            /* 폭·모드마다 새 저장소(앞 화면에서 적은 할 일이 쌓이지 않게). */
            if (page) await page.browserContext().close();
            page = await fresh();
            const mobile = width < 900;
            const tag = `[${width} ${mode}]`;
            await page.setViewport({ width, height: mobile ? 800 : 1000, deviceScaleFactor: 1, isMobile: mobile, hasTouch: mobile });
            const client = await page.target().createCDPSession();
            await client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
            await page.goto(`${origin}?demo=1&mode=${mode}#/todo`, { waitUntil: 'networkidle0' });
            await page.evaluate(async () => { const r = await indexedDB.databases?.(); return r; });
            await page.waitForSelector('.todo-add-row');
            if (mode === 'dark') await page.evaluate(() => document.documentElement.classList.contains('dark') || document.body.classList.contains('dark'));
            await addTodo(page, '가정통신문 출력해서 나눠주기', 3);
            await addTodo(page, '학년 협의회 자료 아주 길게 정리해서 공유 폴더에 올리기', 1);
            const marks = await page.$$eval('.todo-main .pri-mark', (els) => els.map((el) => el.dataset.pri));
            check(marks.includes('3') && marks.includes('1'), `${tag} 목록에 중요도 표시가 없습니다: ${marks}`);
            report(`${tag} 할 일`, await audit(page, TODO_SEL));
            /* 중요도순 → 높음이 맨 위 */
            await page.click('.todo-sort [data-sort="pri"]');
            const firstPri = await page.$eval('section .todo-block .pri-mark', (el) => el.dataset.pri);
            check(firstPri === '3', `${tag} 중요도순에서 높음이 맨 위가 아닙니다: ${firstPri}`);
            if (shots) {
                await page.evaluate(() => { document.querySelectorAll('.toast, [role="status"]').forEach((el) => { el.style.visibility = 'hidden'; }); document.querySelector('.todo-add-row')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); });
                await page.screenshot({ path: `${shots}/todo-${width}-${mode}.png` });
            }
            const remembered = await page.evaluate(() => localStorage.getItem('ssug-gyomu-todo-sort'));
            check(remembered === 'pri', `${tag} 정렬 선택을 기억하지 않습니다: ${remembered}`);
            await page.click('.todo-sort [data-sort="dday"]');
            /* 오늘 목록을 다 끝내 목표 달성(기본 3개) */
            for (let i = 0; i < 6; i += 1) {
                const btn = await page.$('section .todo-check[aria-pressed="false"]');
                if (!btn) break;
                const inToday = await btn.evaluate((el) => el.closest('section')?.querySelector('h3')?.textContent === '오늘');
                if (!inToday) break;
                await btn.click();
                await new Promise((r) => setTimeout(r, 120));
            }
            await page.waitForSelector('.goal-meter.is-hit', { timeout: 4000 }).catch(() => {});
            await new Promise((r) => setTimeout(r, 400));
            check(Boolean(await page.$('.goal-meter.is-hit')), `${tag} 목표를 채워도 달성 표시가 없습니다.`);
            report(`${tag} 달성 뒤`, await audit(page, TODO_SEL));
            if (shots) { await new Promise((r) => setTimeout(r, 1700)); await page.evaluate(() => { document.querySelectorAll('.toast, [role="status"]').forEach((el) => { el.style.visibility = 'hidden'; }); document.querySelector('.todo-tools')?.scrollIntoView({ block: 'start' }); window.scrollBy(0, -70); }); await page.screenshot({ path: `${shots}/todo-done-${width}-${mode}.png` }); }
            /* 고치기 시트 */
            await page.$eval('.todo-edit-btn', (el) => el.click());
            await page.waitForSelector('.todo-edit-sheet .pri-picks');
            report(`${tag} 고치기`, await audit(page, '.todo-edit-sheet .choice-tile, .todo-edit-sheet .chip, .todo-edit-sheet .field'));
            if (shots) await page.screenshot({ path: `${shots}/edit-${width}-${mode}.png` });
            await page.keyboard.press('Escape');
            /* 달력 달성 도장 */
            const today = await page.evaluate(() => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date()));
            await page.evaluate((d) => { location.hash = `#/schedule/month/${d}`; }, today);
            await page.waitForSelector('.cal-grid', { timeout: 4000 }).catch(() => {});
            const modeBtn = await page.$$('button');
            for (const b of modeBtn) { const t = await b.evaluate((el) => el.textContent.trim()); if (t === '월간') { await b.click(); break; } }
            await page.waitForSelector('.cal-goal', { timeout: 4000 }).catch(() => {});
            check(Boolean(await page.$('.cal-goal')), `${tag} 달력에 달성 도장이 없습니다.`);
            /* 달력 칸 너비(320px에서 39px)는 main과 같은 7칸 격자라 높이만 봅니다. */
            report(`${tag} 달력`, await audit(page, '.cal-grid > button', { heightOnly: true }));
            const cellOk = await page.$eval('.cal-goal', (g) => { const cell = g.closest('button').getBoundingClientRect(); const r = g.getBoundingClientRect(); const n = g.closest('button').querySelector('.num').getBoundingClientRect(); return r.left >= cell.left && r.right <= cell.right && r.top >= n.bottom - 0.5; }).catch(() => false);
            check(cellOk, `${tag} 달성 도장이 날짜 숫자와 겹치거나 칸 밖으로 나갑니다.`);
            if (shots) await page.screenshot({ path: `${shots}/calendar-${width}-${mode}.png`, fullPage: width >= 900 });
            /* 설정 › 할 일 목표·효과 */
            await page.evaluate(() => { location.hash = '#/settings/todo'; });
            await page.waitForSelector('[data-screen="todo-settings"]');
            report(`${tag} 설정`, await audit(page, '[data-screen="todo-settings"] .choice-tile, [data-screen="todo-settings"] .chip'));
            if (shots) await page.screenshot({ path: `${shots}/settings-${width}-${mode}.png`, fullPage: true });
            const sel = await page.evaluate(() => [...document.querySelectorAll('[data-screen="todo-settings"] select, [data-screen="todo-settings"] input[type="range"]')].length);
            check(sel === 0, `${tag} 설정에 드롭다운·스크롤 피커가 있습니다.`);
            await client.detach();
        }
    }

    /* 동작 줄이기: 방울은 안 뜨고, 도장만 */
    await page.browserContext().close();
    page = await fresh();
    await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true });
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await page.goto(`${origin}?demo=1&mode=light#/settings/todo`, { waitUntil: 'networkidle0' });
    await page.click('[data-role="fx-preview"]');
    await new Promise((r) => setTimeout(r, 100));
    const reduced = await page.evaluate(() => ({ drops: document.querySelectorAll('.done-drop').length, stamp: Boolean(document.querySelector('.done-stamp')) }));
    check(reduced.drops === 0 && reduced.stamp, `동작 줄이기에서 방울이 뜨거나 도장이 없습니다: ${JSON.stringify(reduced)}`);
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);
    /* 끄기: 아무 효과 없음 */
    await page.click('[data-fx-pick="off"]');
    check(await page.evaluate(() => localStorage.getItem('ssug-gyomu-done-fx')) === 'off', '효과 끄기를 기억하지 않습니다.');
    await page.click('[data-fx-pick="on"]');
    await page.click('[data-fx-pick="low"]');
    await page.click('[data-role="fx-preview"]');
    await new Promise((r) => setTimeout(r, 60));
    const low = await page.evaluate(() => document.querySelectorAll('.done-drop').length);
    await new Promise((r) => setTimeout(r, 1800));
    await page.click('[data-fx-pick="on"]');
    await page.click('[data-role="fx-preview"]');
    await new Promise((r) => setTimeout(r, 60));
    const full = await page.evaluate(() => document.querySelectorAll('.done-drop').length);
    check(low > 0 && full > low, `줄이기·켜기 방울 수가 다르지 않습니다: 줄이기 ${low} / 켜기 ${full}`);
    await new Promise((r) => setTimeout(r, 1800));
    check(await page.evaluate(() => document.querySelectorAll('.done-drop, .done-ring').length) === 0, '효과가 끝난 뒤에도 방울이 남습니다.');

    /* 완료 효과 GIF 프레임: 오늘 마지막 할 일(높음)을 끝낼 때 */
    if (process.env.GIF && shots) {
        for (const [mode, w, h] of [['light', 390, 640], ['dark', 390, 640], ['light', 900, 640]]) {
            const p2 = await (await browser.createBrowserContext()).newPage();
            await p2.evaluateOnNewDocument(() => { localStorage.setItem('ssug-gyomu-key-sound-notice', '1'); localStorage.setItem('ssug-gyomu-tips', JSON.stringify({ hidden: ['*'], seen: [], closes: {}, snooze: '2999-12-31' })); });
            await p2.setViewport({ width: w, height: h, deviceScaleFactor: 1, isMobile: w < 900, hasTouch: w < 900 });
            await p2.goto(`${origin}?demo=1&mode=${mode}#/todo`, { waitUntil: 'networkidle0' });
            await p2.waitForSelector('.todo-add-row');
            await p2.click('.todo-add-row [data-pri-pick="3"]');
            await p2.type('input[aria-label="할 일"]', '가정통신문 출력해서 나눠주기');
            await p2.keyboard.press('Enter');
            await new Promise((r) => setTimeout(r, 300));
            await p2.evaluate(() => window.scrollTo(0, 0));
            /* 오늘 칸에서 남은 것 하나만 두고 끝내기 */
            const pending = async () => p2.$$eval('section', (secs) => { const s = secs.find((x) => x.querySelector('h3')?.textContent === '오늘'); return s ? [...s.querySelectorAll('.todo-check[aria-pressed="false"]')].length : 0; });
            while (await pending() > 1) {
                await p2.evaluate(() => { const s = [...document.querySelectorAll('section')].find((x) => x.querySelector('h3')?.textContent === '오늘'); [...s.querySelectorAll('.todo-check[aria-pressed="false"]')].pop().click(); });
                await new Promise((r) => setTimeout(r, 1700));
            }
            const last = await p2.evaluateHandle(() => { const s = [...document.querySelectorAll('section')].find((x) => x.querySelector('h3')?.textContent === '오늘'); return s.querySelector('.todo-check[aria-pressed="false"]'); });
            await last.evaluate((el) => el.scrollIntoView({ block: 'center' }));
            await new Promise((r) => setTimeout(r, 1700));
            const dir = `${shots}/gif-${mode}-${w}`;
            mkdirSync(dir, { recursive: true });
            await p2.addStyleTag({ content: '.toast { display: none !important; }' });
            await p2.screenshot({ path: `${dir}/f000.png` });
            await last.evaluate((el) => el.click());
            for (let i = 1; i <= 34; i += 1) {
                await p2.screenshot({ path: `${dir}/f${String(i).padStart(3, '0')}.png` });
            }
            await p2.close();
        }
    }
} finally {
    await browser.close();
    preview.kill();
}
if (failures.length) { console.error(`할 일 성취 화면 검사 실패 ${failures.length}개`); for (const f of failures) console.error(`- ${f}`); process.exit(1); }
console.log('할 일 성취 화면 검사 통과(320·360·390·900·1920 × 라이트·다크)');
