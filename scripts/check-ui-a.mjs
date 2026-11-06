/** 선생님 시안 A(11/6) 검사: 설정 항목 버튼·‹ 돌아가기·항목 주소 새로고침, 학생 기록 4칸 격자,
    그리고 명단 입력(#/settings/roster, 온보딩)의 .roster-grid 가 학생 기록 격자에 덮이지 않는지 봅니다. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const port = 4196;
const origin = `http://127.0.0.1:${port}/`;
const shots = process.env.UI_A_SHOTS || '';
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

const preview = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
    await new Promise((r) => setTimeout(r, 250));
}
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const cols = (page, sel) => page.$eval(sel, (el) => getComputedStyle(el).gridTemplateColumns.split(' ').filter(Boolean).length).catch(() => -1);
try {
    const page = await browser.newPage();
    await page.evaluateOnNewDocument(() => localStorage.setItem('ssug-gyomu-key-sound-notice', '1'));
    for (const [name, width, scale] of [['390', 390, 1], ['1280', 1280, 1], ['390-글자200', 195, 2]]) {
        const mobile = width < 900;
        await page.setViewport({ width, height: 844, deviceScaleFactor: scale, isMobile: mobile, hasTouch: mobile });
        /* 설정 첫 화면: 항목 버튼 7개, 화면 끝까지 늘어나지 않고 44px 이상 */
        await page.goto(`${origin}?demo=1&mode=light#/settings`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.settings-menu .settings-key');
        const keys = await page.$$eval('.settings-menu .settings-key', (els) => els.map((el) => { const r = el.getBoundingClientRect(); return { sec: el.dataset.sec, w: r.width, h: r.height, right: r.right }; }));
        const vw = await page.evaluate(() => document.documentElement.clientWidth);
        check(keys.length === 7, `[${name}] 설정 항목 버튼이 7개가 아닙니다: ${keys.length}`);
        check(keys.every((k) => k.h >= 44 && k.right <= vw + 0.5), `[${name}] 설정 버튼이 44px보다 작거나 화면 밖으로 나갑니다: ${JSON.stringify(keys)}`);
        if (scale === 1) check(keys.every((k) => k.w < vw * 0.8), `[${name}] 설정 버튼이 화면 끝까지 늘어납니다: ${JSON.stringify(keys)}`);
        if (shots) await page.screenshot({ path: `${shots}/settings-${name}.png` });
        /* 항목 들어가기 → ‹ 돌아가기 */
        await page.click('.settings-key[data-sec="sound"]');
        await page.waitForFunction(() => location.hash === '#/settings/sound');
        check(await page.evaluate(() => document.body.innerText.includes('소리 종류') && !document.querySelector('.settings-menu')), `[${name}] 소리 항목이 따로 열리지 않습니다.`);
        await page.click('[aria-label="뒤로"]');
        await page.waitForFunction(() => location.hash === '#/settings', { timeout: 3000 }).catch(() => {});
        check(await page.evaluate(() => location.hash === '#/settings' && Boolean(document.querySelector('.settings-menu'))), `[${name}] ‹ 로 설정 첫 화면에 돌아오지 않습니다.`);
        /* 항목 주소로 새로고침해도 그 항목이 열립니다. */
        await page.goto(`${origin}?demo=1&mode=light#/settings/account`, { waitUntil: 'networkidle0' });
        await page.reload({ waitUntil: 'networkidle0' });
        check(await page.evaluate(() => document.body.innerText.includes('공용 컴퓨터') && !document.querySelector('.settings-menu')), `[${name}] #/settings/account 새로고침 뒤 계정 항목이 열리지 않습니다.`);
        /* 학생 기록: 4칸(300px 이하 3칸), 이번 달 기록 수 */
        await page.goto(`${origin}?demo=1&mode=light#/students`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.student-roster-grid .roster-cell');
        const want = width <= 300 ? 3 : 4;
        check(await cols(page, '.student-roster-grid') === want, `[${name}] 학생 기록 명단이 ${want}칸이 아닙니다: ${await cols(page, '.student-roster-grid')}`);
        check(await page.evaluate(() => document.querySelector('.student-roster-grid').innerText.includes('이번 달')), `[${name}] 학생 칸에 이번 달 기록 수가 없습니다.`);
        check(await page.evaluate(() => [...document.querySelectorAll('.student-roster-grid .roster-cell')].every((el) => el.getBoundingClientRect().height >= 44)), `[${name}] 학생 칸이 44px보다 낮습니다.`);
        if (shots) await page.screenshot({ path: `${shots}/students-${name}.png` });
        /* 명단 입력은 예전 배치(1칸, 720px 이상 2칸) 그대로 */
        await page.goto(`${origin}?demo=1&mode=light#/settings/roster`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.roster-grid');
        const rosterWant = width >= 720 ? 2 : 1;
        check(await cols(page, '.roster-grid') === rosterWant, `[${name}] 명단 입력 칸이 학생 기록 격자에 덮였습니다: ${await cols(page, '.roster-grid')}칸(기대 ${rosterWant})`);
        if (shots) await page.screenshot({ path: `${shots}/roster-${name}.png` });
    }
} finally {
    await browser.close();
    preview.kill();
}
if (failures.length) { console.error(`시안 A 검사 실패 ${failures.length}개`); for (const f of failures) console.error(`- ${f}`); process.exit(1); }
console.log('시안 A 검사 통과');
