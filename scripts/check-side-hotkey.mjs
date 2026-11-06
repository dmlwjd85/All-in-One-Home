/** 왼쪽 메뉴·단축키 갱신과 좁은 화면의 팁을 검사합니다. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIPS } from '../src/lib/tips.js';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
const port = 4197;
const origin = `http://127.0.0.1:${port}/`;
const shots = process.env.SIDE_SHOTS || '';
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

check(TIPS.some((tip) => tip.text.includes('꾹 누르면 바꿀')), '하단 바로가기 필수 팁 누락');
const preview = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 40; i += 1) {
    try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
    await new Promise((r) => setTimeout(r, 250));
}
const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    await page.evaluateOnNewDocument(() => {
        localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
        localStorage.setItem('ssug-gyomu-hotkeys', JSON.stringify({ 'quick:상담': 'a', today: 't' }));
    });
    await page.goto(`${origin}?demo=1#/today`, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.side-menu');
    const rows = await page.$$eval('.side-menu button', (els) => els.map((el) => ({ text: el.innerText, label: el.getAttribute('aria-label'), align: getComputedStyle(el).alignItems, rect: el.getBoundingClientRect().toJSON() })));
    for (const label of ['오늘', '출결', '일정', '할 일·메모', '회의록', '알림장', '학생 기록', '나이스 모아 보기', '설정']) check(rows.some((r) => r.text.split('\n')[0] === label), `${label} 메뉴 누락`);
    check(rows.filter((r) => r.text.startsWith('오늘')).length === 1, '이동 메뉴 중복');
    check(rows.some((r) => r.label === '오늘, 단축키 T'), '기존 메뉴 단축키 누락');
    check(rows.some((r) => r.label === '상담 적기, 단축키 A'), '입력창 단축키 누락');
    check(rows.every((r) => r.align === 'center'), '메뉴 세로 가운데 정렬 누락');
    check(rows.slice(1).every((r, i) => Math.abs(r.rect.top - rows[i].rect.bottom - 8) < 1), '메뉴 사이 간격 불일치');
    check(await page.$eval('.side-hotkey', (el) => el.classList.contains('muted') && parseFloat(getComputedStyle(el).fontSize) <= 12), '단축키 연한 작은 표시 누락');
    if (shots) await page.screenshot({ path: `${shots}/왼쪽메뉴-1280.png` });
    await page.click('[aria-label="상담 적기, 단축키 A"]');
    check(await page.evaluate(() => Boolean(document.querySelector('.sheet, .quick-popover'))), '상담 입력창 열기 실패');
    await page.evaluate(() => {
        localStorage.setItem('ssug-gyomu-hotkeys', JSON.stringify({ 'quick:상담': '', today: '' }));
        window.dispatchEvent(new Event('ssug-gyomu-hotkeys-changed'));
    });
    await page.waitForFunction(() => !document.querySelector('.side-menu [aria-label="상담 적기, 단축키 A"]'));
    check(!await page.$('.side-menu [aria-label="오늘, 단축키 T"]'), '빈 단축키 표시가 남음');
    for (const width of [360, 180]) {
        await page.setViewport({ width, height: 844 });
        await page.reload({ waitUntil: 'networkidle0' });
        if (await page.$('.tip-bulb')) await page.click('.tip-bulb');
        await page.waitForSelector('.tip-bubble');
        const fit = await page.$eval('.tip-bubble', (el) => {
            el.querySelector('p').textContent = '하단 바로가기를 꾹 누르면 바꿀 수 있어요';
            if (innerWidth === 360) el.style.fontSize = '200%';
            const p = el.querySelector('p'); const r = el.getBoundingClientRect();
            return p.scrollWidth <= p.clientWidth + 1 && p.scrollHeight <= p.clientHeight + 1 && r.right <= innerWidth && r.left >= 0;
        });
        if (shots) await page.screenshot({ path: `${shots}/팁-${width}.png` });
        check(fit, `${width === 180 ? '360폭 글자200 상당' : '360폭'} 팁 잘림`);
    }

} finally {
    await browser.close();
    preview.kill();
}
if (failures.length) { console.error(`왼쪽 메뉴·단축키·팁 검사 실패 ${failures.length}개`); for (const f of failures) console.error(`- ${f}`); process.exit(1); }
console.log('왼쪽 메뉴·단축키·팁 검사 통과');
