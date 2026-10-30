/**
 * 로그인 상태의 출결 '저장' 버튼과 앱 숨김을 실제 브라우저에서 봅니다(가짜 클라우드).
 * - 올리기 실패·응답 없음(8초)이면 '나중에 다시 올려요', 성공이면 '저장됐어요'.
 * - 다른 visibilitychange 처리가 멈춰도 출결 시트가 capture로 먼저 임시본을 남깁니다.
 */
import { build } from 'esbuild';
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const dir = mkdtempSync(join(tmpdir(), 'attend-save-'));
await build({ entryPoints: [new URL('./harness/attend-save.jsx', import.meta.url).pathname], bundle: true, outfile: join(dir, 'app.js'), format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' }, logLevel: 'error' });
writeFileSync(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script>document.addEventListener("visibilitychange",function(e){e.stopImmediatePropagation();});</script><script src="app.js"></script>');
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find((p) => p && existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files', '--no-zygote'] });
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
try {
    const page = await browser.newPage();
    page.on('pageerror', (e) => failures.push(`페이지 오류: ${e.message}`));
    await page.goto(`file://${dir}/index.html`);
    await page.waitForFunction(() => window.__ready === true, { timeout: 20000 });
    const openLate = async () => {
        await page.evaluate(() => window.__open());
        await page.waitForSelector('[data-screen="attend-status"]');
        await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === '지각').click());
        await page.waitForSelector('input[aria-label="메모"]');
    };
    const saveWith = async (mode, memo, wait) => {
        await openLate();
        await page.evaluate((m) => { window.__mode = m; window.__toasts = []; }, mode);
        await page.type('input[aria-label="메모"]', memo);
        const t0 = Date.now();
        await page.click('button[aria-label="출결 저장"]');
        await page.waitForFunction(() => window.__toasts.length > 0, { timeout: wait });
        return { toast: await page.evaluate(() => window.__toasts[0]), ms: Date.now() - t0 };
    };
    const ok = await saveWith('ok', '성공', 5000);
    check(ok.toast === '저장됐어요', `올리기 성공인데 안내가 다릅니다: ${ok.toast}`);
    const fail = await saveWith('fail', '실패', 5000);
    check(fail.toast === '기기에 저장됨, 나중에 다시 올려요', `올리기 실패인데 '저장됐어요'라고 합니다: ${fail.toast}`);
    const hang = await saveWith('hang', '멈춤', 15000).catch(() => ({ toast: '안내 없음' }));
    check(hang.toast === '기기에 저장됨, 나중에 다시 올려요' && hang.ms >= 7000, `올리기가 멈췄을 때 8초 뒤 안내가 없습니다: ${JSON.stringify(hang)}`);
    /* 앱 숨김: 0.3초 임시 저장 전에 숨겨도, 다른 처리가 이벤트를 멈춰도 임시본이 남아야 합니다. */
    await page.evaluate(() => { window.__mode = 'ok'; localStorage.removeItem('ssug-gyomu-attend-draft'); });
    await openLate();
    await page.evaluate(() => {
        const input = document.querySelector('input[aria-label="메모"]');
        const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        set.call(input, '숨기기 직전 메모');
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const draft = await page.evaluate(() => new Promise((resolve) => setTimeout(() => {
        Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
        document.dispatchEvent(new Event('visibilitychange'));
        resolve(localStorage.getItem('ssug-gyomu-attend-draft') || '');
    }, 30)));
    check(draft.includes('숨기기 직전 메모'), `앱을 숨겼는데 출결 임시본이 바로 남지 않았습니다: ${draft || '없음'}`);
} finally {
    await browser.close();
}
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('check:attendsave ok');
