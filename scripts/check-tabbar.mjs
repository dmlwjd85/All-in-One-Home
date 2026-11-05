/** 하단 탭바 시안 A(말랑젤리) 검사: 7칸, 길게 눌러 배치 바꾸기·저장·다시 열어도 유지, 가운데 쨈 병 + 아래 글자,
    360·390에서 손가락 자리 44px, 글자 200%(360을 180 CSS px로)에서 일곱 글자·「쨈」이 탭바 안에 보이는지.
    변이 가드: HOLD_MS·minmax(44px)·fab-txt relative·aria-label·Esc 닫기·CI build 뒤 check:tabbar.
    포트: TABBAR_PORT(기본 47943). 캡처: TABBAR_SHOTS 폴더가 있으면 PNG를 남깁니다. */
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { DEFAULT_ORDER, TAB_KEY, loadTabOrder, moveTab, normalizeOrder, pickTab, saveTabOrder } from '../src/ui/tabSlots.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

/* 1) 칸 배치 규칙 */
check(DEFAULT_ORDER.join() === 'today,todo,attend,schedule,students,more', '기본 배치가 오늘·할 일·출결 | 일정·기록·더 가 아닙니다.');
check(normalizeOrder(['x', 'todo', 'todo']).length === 6 && normalizeOrder([]).join() === DEFAULT_ORDER.join(), '모르는·겹친 칸을 정리하지 못합니다.');
check(normalizeOrder(['today', 'todo', 'attend', 'schedule', 'students', 'minutes']).includes('more'), '「더」(메뉴) 칸이 빠질 수 있습니다.');
check(pickTab(DEFAULT_ORDER, 0, 'schedule').slice(0, 4).join() === 'schedule,todo,attend,today', '이미 있는 탭을 고르면 두 칸을 맞바꾸지 않습니다.');
check(moveTab(DEFAULT_ORDER, 0, 1).slice(0, 2).join() === 'todo,today' && moveTab(DEFAULT_ORDER, 0, -1).join() === DEFAULT_ORDER.join(), '칸 옮기기가 다릅니다.');
{
    const mem = new Map();
    const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
    saveTabOrder(['minutes', 'todo', 'attend', 'schedule', 'students', 'more'], store, 5);
    const raw = JSON.parse(mem.get(TAB_KEY));
    check(TAB_KEY === 'ssug-gyomu-tabbar' && raw.at === 5 && loadTabOrder(store)[0] === 'minutes', '배치 저장 키·모양이 다릅니다.');
    mem.set(TAB_KEY, '{망가진');
    check(loadTabOrder(store).join() === DEFAULT_ORDER.join(), '망가진 저장값에서 기본 배치로 돌아오지 않습니다.');
}

/* 소스 변이 가드: QA가 놓친 5개(HOLD_MS·44px 미디어·쨈 라벨 겹침·aria-label·Esc) */
{
    const tabJsx = readFileSync(resolve(root, 'src/ui/TabBar.jsx'), 'utf8');
    const tabCss = readFileSync(resolve(root, 'src/ui/tabbar.css'), 'utf8');
    const workflow = readFileSync(resolve(root, '.github/workflows/deploy-pages.yml'), 'utf8');
    const hold = Number((tabJsx.match(/export const HOLD_MS = (\d+)/) || [])[1]);
    check(Number.isFinite(hold) && hold >= 400 && hold <= 800, `길게 누르기 시간(HOLD_MS)이 0.4~0.8초 밖입니다: ${hold}`);
    check(/@media \(min-width: 301px\) and \(max-width: 340px\)[\s\S]*?minmax\(44px, auto\)/.test(tabCss), '좁은 화면(301~340) 가운데 칸 minmax(44px)가 없습니다.');
    check(!/minmax\(30px/.test(tabCss), '터치 자리 minmax가 30px로 줄어 있습니다.');
    const midFab = (tabCss.match(/\.tabbar\.tabbar-jelly \.tbj-mid \.fab-txt \{([\s\S]*?)\n\}/) || [])[1] || '';
    check(/position:\s*relative/.test(midFab) && !/position:\s*absolute/.test(midFab), '가운데 「쨈」 글자가 absolute라 병과 겹칠 수 있습니다.');
    check(!/\.tabbar\.tabbar-jelly \.tbj-mid \.fab-txt[^{]*\{[^}]*position:\s*absolute/.test(tabCss), '탭바 가운데 fab-txt가 absolute입니다.');
    check(/aria-label=\{tab\.label\}/.test(tabJsx), '옆 칸 aria-label이 없습니다.');
    check(tabJsx.includes('aria-label="쨈 빠른 입력 열기"'), '가운데 쨈 aria-label이 없습니다.');
    check(/event\.key === 'Escape'\)\s*onClose\(\)/.test(tabJsx) || /if \(event\.key === 'Escape'\) onClose\(\)/.test(tabJsx), '배치 시트 Esc 닫기가 없습니다.');
    const buildAt = workflow.indexOf('npm run build');
    const tabbarAt = workflow.indexOf('npm run check:tabbar');
    check(tabbarAt > buildAt && buildAt >= 0, 'CI에서 check:tabbar가 build 뒤에 없습니다.');
}


const chrome = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => existsSync(path));
if (!chrome) failures.push('브라우저가 없습니다.');
const port = Number(process.env.TABBAR_PORT) || 47943;
const origin = `http://127.0.0.1:${port}/`;
const shots = process.env.TABBAR_SHOTS || '';
if (shots) mkdirSync(shots, { recursive: true });

async function measure(page) {
    return page.evaluate(() => {
        const nav = document.querySelector('.tabbar');
        const box = nav.getBoundingClientRect();
        const inside = (r) => r.left >= box.left - 0.5 && r.right <= box.right + 0.5 && r.top >= box.top - 24 && r.bottom <= box.bottom + 0.5 && r.width > 0;
        const cells = [...nav.children].filter((el) => el.matches('button'));
        const labels = [...nav.querySelectorAll('.tbj-label')].map((el) => {
            const r = el.getBoundingClientRect();
            const btn = el.closest('button').getBoundingClientRect();
            return { text: el.textContent, ok: inside(r) && r.left >= btn.left - 1 && r.right <= btn.right + 1, h: Math.round(r.height), w: Math.round(r.width), sw: el.scrollWidth, cw: el.clientWidth };
        });
        const mid = nav.querySelector('.tbj-mid');
        const disc = mid.querySelector('.jar-disc').getBoundingClientRect();
        const txt = mid.querySelector('.fab-txt').getBoundingClientRect();
        const midBox = mid.getBoundingClientRect();
        const lineH = parseFloat(getComputedStyle(nav.querySelector('.tbj-label')).lineHeight);
        const midTxtStyle = getComputedStyle(mid.querySelector('.fab-txt'));
        return {
            count: cells.length,
            midIndex: cells.indexOf(mid),
            labels,
            oneLine: labels.every((l) => l.h <= lineH + 1),
            midText: mid.querySelector('.fab-txt').textContent,
            midTxtInside: inside(txt),
            noOverlap: txt.top >= disc.bottom - 0.5,
            midTxtPos: midTxtStyle.position,
            midAria: mid.getAttribute('aria-label') || '',
            sideAria: cells.filter((el) => el !== mid).map((el) => ({ tab: el.getAttribute('data-tab'), aria: el.getAttribute('aria-label') || '', label: el.querySelector('.tbj-label')?.textContent || '' })),
            midTouch: Math.min(midBox.width, midBox.height),
            sideTouch: Math.min(...cells.filter((el) => el !== mid).map((el) => { const r = el.getBoundingClientRect(); return Math.min(r.width, r.height); })),
            jarSvg: Boolean(mid.querySelector('.jar-svg rect[fill="#FFD45E"]')),
            navH: Math.round(box.height),
            hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
        };
    });
}

let preview;
if (!failures.length) {
    preview = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
    for (let i = 0; i < 40; i += 1) {
        try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    try {
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-theme', 'light');
        });
        for (const [name, width, scale] of [['360', 360, 1], ['390', 390, 1], ['360-글자200', 180, 2]]) {
            await page.setViewport({ width, height: name.includes('200') ? 400 : 780, deviceScaleFactor: scale, isMobile: true, hasTouch: true });
            await page.goto(`${origin}?demo=1&mode=light`, { waitUntil: 'networkidle0' });
            await page.waitForSelector('.tabbar .tbj-mid .jar-disc');
            const m = await measure(page);
            check(m.count === 7 && m.midIndex === 3, `[${name}] 탭바가 7칸(가운데 쨈)이 아닙니다: ${m.count}칸, 가운데 ${m.midIndex}`);
            check(m.labels.map((l) => l.text).join() === '오늘,할 일,출결,일정,기록,더', `[${name}] 기본 라벨이 다릅니다: ${m.labels.map((l) => l.text)}`);
            check(m.labels.every((l) => l.ok && l.sw <= l.cw + 1), `[${name}] 라벨이 탭바·칸 밖으로 나가거나 잘립니다: ${JSON.stringify(m.labels)}`);
            check(m.oneLine, `[${name}] 라벨이 세로로 쪼개집니다: ${JSON.stringify(m.labels)}`);
            check(m.midText === '쨈' && m.midTxtInside && m.noOverlap && m.jarSvg, `[${name}] 가운데 「쨈」 글자가 병 아래에 따로 보이지 않습니다: ${JSON.stringify(m)}`);
            check(m.midTxtPos === 'relative' || m.midTxtPos === 'static', `[${name}] 가운데 「쨈」 글자 position이 absolute 등이라 병과 겹칩니다: ${m.midTxtPos}`);
            check(m.midAria.includes('쨈'), `[${name}] 가운데 aria-label이 없습니다: ${m.midAria}`);
            check(m.sideAria.every((s) => s.aria && s.aria === s.label), `[${name}] 옆 칸 aria-label이 없거나 라벨과 다릅니다: ${JSON.stringify(m.sideAria)}`);
            check(!m.hScroll, `[${name}] 가로로 넘칩니다.`);
            if (scale === 1) {
                check(m.midTouch >= 44 && m.sideTouch >= 44, `[${name}] 손가락 자리가 44px보다 작습니다: 가운데 ${m.midTouch}, 옆 ${m.sideTouch}`);
            } else {
                check(m.midTouch * scale >= 44 && m.navH >= 56, `[${name}] 큰 글자에서 가운데 자리가 작거나 탭바가 납작합니다: ${m.midTouch}, 높이 ${m.navH}`);
            }
            if (shots) {
                await page.screenshot({ path: `${shots}/tabbar-${name}.png` });
                const nav = await page.$('.tabbar');
                await nav.screenshot({ path: `${shots}/tabbar-${name}-bar.png` });
            }
        }

        /* 짧게 누르면 기존 화면으로 갑니다. */
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
        await page.goto(`${origin}?demo=1&mode=light`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.tab-jelly[data-tab="todo"]');
        await page.tap('.tab-jelly[data-tab="todo"]');
        await page.waitForFunction(() => location.hash === '#/todo');
        check(await page.$eval('.tab-jelly[data-tab="todo"]', (el) => el.getAttribute('aria-current') === 'page'), '할 일 탭이 켜지지 않습니다.');
        await page.tap('.tab-jelly[data-tab="attend"]');
        await page.waitForFunction(() => location.hash.startsWith('#/attend/'));
        await page.tap('.tab-jelly[data-tab="more"]');
        await page.waitForSelector('[role="dialog"][aria-label="메뉴"]');
        await page.keyboard.press('Escape').catch(() => {});
        await page.evaluate(() => document.querySelector('.sheet-back')?.click());

        /* 길게 누르면 배치 바꾸기 시트, 저장하면 다시 열어도 그대로입니다. */
        const el = await page.$('.tab-jelly[data-tab="today"]');
        const r = await el.boundingBox();
        await page.touchscreen.touchStart(r.x + r.width / 2, r.y + r.height / 2);
        await new Promise((done) => setTimeout(done, 700));
        await page.touchscreen.touchEnd();
        await page.waitForSelector('.tbj-sheet', { timeout: 3000 }).catch(() => {});
        const opened = await page.$('.tbj-sheet');
        check(Boolean(opened), '길게 눌러도 배치 바꾸기 시트가 열리지 않습니다.');
        check(await page.evaluate(() => location.hash.startsWith('#/attend/')), '길게 누른 뒤 화면이 바뀌었습니다(누름이 이동으로 새었습니다).');
        if (opened) {
            if (shots) await page.screenshot({ path: `${shots}/tabbar-sheet-390.png` });
            await page.select('#tbj-slot-0', 'minutes');
            await page.evaluate(() => [...document.querySelectorAll('.tbj-foot button')].find((b) => b.textContent === '저장').click());
            await page.waitForFunction(() => !document.querySelector('.tbj-sheet'));
            await page.reload({ waitUntil: 'networkidle0' });
            await page.waitForSelector('.tab-jelly');
            const after = await page.$$eval('.tabbar .tbj-label', (els) => els.map((e) => e.textContent).join());
            check(after === '회의록,할 일,출결,일정,기록,더', `저장한 배치가 다시 열면 남지 않습니다: ${after}`);
            const saved = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) || '{}'), TAB_KEY);
            check(Array.isArray(saved.order) && Number.isInteger(saved.at), '저장값 모양이 { order, at } 가 아닙니다.');
            if (shots) await page.screenshot({ path: `${shots}/tabbar-saved-390.png` });
        }


        /* Esc로 배치 시트가 닫히는지(변이: Esc 핸들러 제거). 저장 뒤라 data-tab은 회의록일 수 있어 아무 옆 칸이나 씁니다. */
        {
            const el2 = await page.$('.tab-jelly');
            check(Boolean(el2), 'Esc 검사용 탭 칸이 없습니다.');
            if (el2) {
                const r2 = await el2.boundingBox();
                await page.touchscreen.touchStart(r2.x + r2.width / 2, r2.y + r2.height / 2);
                await new Promise((done) => setTimeout(done, 700));
                await page.touchscreen.touchEnd();
                await page.waitForSelector('.tbj-sheet', { timeout: 3000 }).catch(() => {});
                const sheet2 = await page.$('.tbj-sheet');
                check(Boolean(sheet2), 'Esc 검사 전에 배치 시트가 열리지 않습니다.');
                if (sheet2) {
                    await page.keyboard.press('Escape');
                    await page.waitForFunction(() => !document.querySelector('.tbj-sheet'), { timeout: 2000 }).catch(() => {});
                    check(!(await page.$('.tbj-sheet')), 'Esc로 배치 시트가 닫히지 않습니다.');
                }
            }
        }

        /* 가운데 쨈은 그대로 빠른 입력을 엽니다. */
        await page.evaluate(() => document.querySelector('.tabbar .fab')?.click());
        await page.waitForFunction(() => document.querySelector('.quick-bar')?.classList.contains('is-open'), { timeout: 3000 }).catch(() => {});
        check(await page.evaluate(() => document.querySelector('.quick-bar')?.classList.contains('is-open')), '가운데 쨈이 빠른 입력을 열지 않습니다.');
    } finally {
        await browser.close();
        preview.kill('SIGTERM');
    }
}

if (failures.length) {
    console.error(failures.map((m) => `- ${m}`).join('\n'));
    process.exit(1);
}
console.log('탭바 검사 통과');
