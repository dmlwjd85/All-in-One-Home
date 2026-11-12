/**
 * 위젯판을 실제 크롬에서 봅니다(가짜 자료, 1240·652px 폭).
 * - 한 달 위젯: 날짜 칸에 일정 제목이 보이고, 넘치면 +n, 공휴일 이름, 구글 일정 표시
 * - 한 주 위젯: 요일 칸에 시각과 제목
 * - 꾸미기: 판 위에서 바로(빼기 ✕, 크기 단추, 앞뒤 옮기기, 끌어다 놓기, 위젯 더하기), Esc·완료로 끝, 꾸미는 동안 위젯 속 단추는 눌리지 않음
 * - 단추는 모두 44px 이상, 위젯 밖으로 넘치는 글자 없음, 페이지 오류 없음
 */
import { build } from 'esbuild';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'widgets-'));
const fakes = {
    db: 'export function joined(d, n) { return d[n] || []; }',
    fx: 'export async function toggleTodoFx(id) { window.__go.push("done:" + id); }',
    gcal: 'export function useGcal() { return { enabled: true, uid: "u1", external: [{ google: true, externalId: "g1", date: "2026-11-27", title: "구글 연수" }] }; }',
};
await build({
    entryPoints: [join(root, 'scripts/harness/widgets.jsx')], bundle: true, outfile: join(dir, 'app.js'), format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' }, loader: { '.woff2': 'empty' }, logLevel: 'error',
    plugins: [{
        name: 'fakes',
        setup(b) {
            b.onResolve({ filter: /lib\/db\.js$/ }, () => ({ path: 'db', namespace: 'fake' }));
            b.onResolve({ filter: /doneFx\.js$/ }, () => ({ path: 'fx', namespace: 'fake' }));
            b.onResolve({ filter: /useGcal\.js$/ }, () => ({ path: 'gcal', namespace: 'fake' }));
            b.onLoad({ filter: /.*/, namespace: 'fake' }, (a) => ({ contents: fakes[a.path], loader: 'js' }));
        },
    }],
});
const css = ['src/styles/tokens.css', 'src/index.css', 'src/ui/widgets.css'].map((f) => readFileSync(join(root, f), 'utf8')).join('\n')
    .replace(/@tailwind[^;]*;/g, '').replace(/@import[^;]*;/g, '');
writeFileSync(join(dir, 'app.css'), css);

const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!chrome) { console.error('크롬이 없어 위젯 화면 검사를 못 했습니다.'); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files', '--no-zygote'] });
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const shots = process.env.WIDGET_SHOTS || '';

async function open(width) {
    writeFileSync(join(dir, `index-${width}.html`), `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="app.css"><body class="app-bg"><div style="width:${width}px;padding:20px"><div id="root"></div></div><script src="app.js"></script>`);
    const page = await browser.newPage();
    page.on('pageerror', (e) => failures.push(`${width} 페이지 오류: ${e.message}`));
    await page.setViewport({ width: width + 60, height: 1100 });
    await page.goto(`file://${dir}/index-${width}.html`);
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.__ready === true && document.querySelector('[data-screen="widget-board"]'));
    return page;
}
const order = (page) => page.$$eval('[data-widget]', (els) => els.map((e) => e.dataset.widget));
const smallButtons = (page, label) => page.$$eval('[data-screen="widget-board"] button', (bs) => bs.filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && (r.width < 43.5 || r.height < 43.5) && !b.closest('[inert]');
}).map((b) => `${(b.getAttribute('aria-label') || b.innerText).slice(0, 24)} ${Math.round(b.getBoundingClientRect().width)}x${Math.round(b.getBoundingClientRect().height)}`)).then((list) => check(!list.length, `${label} 44px보다 작은 단추: ${list.join(', ')}`));
const overflow = (page, label) => page.$$eval('[data-widget]', (els) => els.filter((e) => e.scrollWidth > e.clientWidth + 2).map((e) => e.dataset.widget)).then((list) => check(!list.length, `${label} 옆으로 넘치는 위젯: ${list.join(', ')}`));

try {
    for (const width of [1240, 652]) {
        const page = await open(width);
        const label = `${width}px`;
        /* 처음: 안내 한 줄, 한 달 위젯은 크게 */
        check(await page.$('.wb-hint'), `${label} 처음 안내가 없습니다.`);
        check(await page.$eval('[data-widget="month"]', (e) => e.dataset.size) === 'l', `${label} 한 달 위젯이 처음부터 크게가 아닙니다.`);
        /* 한 달: 칸에 제목 */
        const month = await page.evaluate(() => {
            const cell = (d) => [...document.querySelectorAll('[data-widget="month"] .wb-month-d')].find((b) => b.getAttribute('aria-label')?.startsWith(d));
            const text = (el) => (el ? [...el.querySelectorAll('.wb-ev-chip')].map((c) => c.textContent) : []);
            return {
                today: text(cell('11/12 ')), trip: text(cell('11/19 ')), busy: text(cell('11/25 ')), more: cell('11/25 ')?.querySelector('.wb-ev-more')?.textContent,
                google: cell('11/27 ')?.querySelector('.wb-ev-chip.is-google')?.textContent,
                visible: (() => { const c = cell('11/12 ')?.querySelector('.wb-ev-chip'); if (!c) return 0; const r = c.getBoundingClientRect(); return Math.round(r.width); })(),
            };
        });
        check(month.today.includes('학년 협의회') && month.trip.includes('현장체험학습'), `${label} 한 달 칸에 일정 제목이 없습니다: ${JSON.stringify(month)}`);
        check(month.busy.length === 3 && month.more === '+1', `${label} 일정 많은 날에 +n 이 없습니다: ${JSON.stringify(month)}`);
        check(month.google === '구글 연수', `${label} 구글 일정이 달력에 없습니다.`);
        check(month.visible >= 30, `${label} 달력 칸 일정 글자가 너무 좁습니다(${month.visible}px).`);
        /* 한 주: 시각 + 제목 */
        const week = await page.$eval('[data-widget="week"] .wb-week-day.is-today', (e) => e.innerText);
        check(week.includes('15:00') && week.includes('학년 협의회'), `${label} 한 주 칸에 시각·제목이 없습니다: ${week}`);
        /* 일 년: 달마다 제목 */
        const year = await page.$eval('[data-widget="year"] .wb-year-m.is-now', (e) => e.innerText);
        check(year.includes('학년 협의회'), `${label} 일 년 위젯에 이번 달 일정 제목이 없습니다: ${year}`);
        await smallButtons(page, label);
        await overflow(page, label);
        if (shots) await page.screenshot({ path: join(shots, `board-${width}.png`), fullPage: true });

        /* 꾸미기: 판 위에서 바로 */
        await page.click('[data-role="widget-customize"]');
        check(await page.$('[data-role="widget-tray"]') && (await page.$$('[data-role="widget-tools"]')).length === (await page.$$('[data-widget]')).length, `${label} 꾸미기에서 위젯마다 단추가 나오지 않습니다.`);
        check(!(await page.$('.wb-hint')), `${label} 꾸미기를 눌러도 안내가 남습니다.`);
        await page.click('[data-widget="notice"] [data-role="widget-hide"]');
        check(!(await order(page)).includes('notice') && await page.$('[data-widget-add="notice"]'), `${label} ✕로 뺀 위젯이 '위젯 더하기'에 가지 않습니다.`);
        await page.click('[data-widget-add="notice"]');
        check((await order(page)).includes('notice'), `${label} 위젯 더하기가 안 됩니다.`);
        const sizeBefore = await page.$eval('[data-widget="todo"]', (e) => e.dataset.size);
        await page.click('[data-widget="todo"] [data-role="widget-size"]');
        const sizeAfter = await page.$eval('[data-widget="todo"]', (e) => e.dataset.size);
        check(sizeBefore === 's' && sizeAfter === 'm', `${label} 크기 단추가 작게→넓게로 바꾸지 않습니다: ${sizeBefore}→${sizeAfter}`);
        const w0 = (await order(page)).indexOf('weather');
        await page.click('[aria-label="날씨 뒤로"]');
        check((await order(page)).indexOf('weather') === w0 + 1, `${label} 뒤로 옮기기가 한 칸 옮기지 않습니다: ${await order(page)}`);
        await page.click('[aria-label="날씨 앞으로"]');
        check((await order(page)).indexOf('weather') === w0, `${label} 앞으로 옮기기가 안 됩니다.`);
        /* 끌어다 놓기: 일 년을 맨 앞(하루 자리)으로 */
        await page.evaluate(() => {
            const from = document.querySelector('[data-widget="year"]');
            const to = document.querySelector('[data-widget]');
            const dt = new DataTransfer();
            from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
        });
        await page.evaluate(() => {
            const to = document.querySelector('[data-widget]');
            const dt = new DataTransfer();
            to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }));
        });
        await page.evaluate(() => {
            const to = document.querySelector('[data-widget]');
            const dt = new DataTransfer();
            to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
        });
        check((await order(page))[0] === 'year', `${label} 끌어다 놓기로 옮겨지지 않습니다: ${await order(page)}`);
        /* 꾸미는 동안 위젯 속 단추는 눌리지 않습니다. */
        check(await page.$eval('[data-widget="todo"] .wb-body', (e) => e.hasAttribute('inert')), `${label} 꾸미는 동안 위젯 속을 막지(inert) 않습니다.`);
        await page.evaluate(() => { window.__go = []; });
        const box = await page.$eval('[data-widget="todo"] .wb-todo', (e) => { const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
        await page.mouse.click(box.x, box.y);
        check(!(await page.evaluate(() => window.__go.length)), `${label} 꾸미는 중에 할 일이 끝내집니다.`);
        await smallButtons(page, `${label} 꾸미기`);
        if (shots) await page.screenshot({ path: join(shots, `edit-${width}.png`), fullPage: true });
        const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ssug-gyomu-widgets') || '[]'));
        check(saved[0]?.id === 'year' && saved.find((w) => w.id === 'todo')?.size === 'm', `${label} 꾸민 배치를 이 기기에 남기지 않습니다.`);
        await page.keyboard.press('Escape');
        check(!(await page.$('[data-role="widget-tray"]')), `${label} Esc로 꾸미기가 끝나지 않습니다.`);
        await page.click('[data-role="widget-customize"]');
        await page.click('[data-role="widget-done"]');
        check(!(await page.$('[data-role="widget-tools"]')), `${label} 완료로 꾸미기가 끝나지 않습니다.`);
        await page.reload();
        await page.waitForFunction(() => window.__ready === true);
        check((await order(page))[0] === 'year' && !(await page.$('.wb-hint')), `${label} 새로 열면 꾸민 배치나 닫은 안내가 돌아옵니다.`);
        await page.close();
    }
} finally {
    await browser.close();
}
if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('위젯 화면 브라우저 검사를 통과했습니다(1240·652px).');
