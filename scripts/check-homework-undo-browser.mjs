/** 다른 기기가 이름을 바꾼 뒤 날짜 되돌리기를 건너뛰면, 안내가 바로 닫히지 않는지 확인합니다. */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'undo-notice-'));
await build({
    entryPoints: [join(root, 'scripts/harness/undo-notice.jsx')],
    bundle: true,
    outfile: join(dir, 'app.js'),
    format: 'esm',
    platform: 'browser',
    jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' },
    logLevel: 'error',
});
writeFileSync(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><div id="root"></div><script type="module" src="./app.js"></script>');
const files = {
    '/': [join(dir, 'index.html'), 'text/html; charset=utf-8'],
    '/app.js': [join(dir, 'app.js'), 'text/javascript'],
};
const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const hit = files[path];
    if (!hit) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': hit[1] });
    res.end(readFileSync(hit[0]));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;
const chrome = process.env.CHROME_PATH || '/usr/bin/google-chrome';
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
try {
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error?.message || error)));
    await page.goto(origin, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.click('[data-role="setup"]');
    await page.waitForSelector('[data-role="undo"]');
    await page.click('[data-role="undo"]');
    await page.waitForFunction(() => document.querySelector('[data-role="toast-text"]')?.textContent?.includes('다른 기기에서 고쳐서 되돌리지 않았어요'), { timeout: 5000 });
    await new Promise((r) => setTimeout(r, 400));
    const text = await page.$eval('[data-role="toast-text"]', (el) => el.textContent);
    check(text.includes('다른 기기에서 고쳐서 되돌리지 않았어요'), `건너뛴 되돌리기 안내가 바로 닫혔습니다: ${text}`);
    check(!errors.length, `화면 오류: ${errors.join(' | ')}`);
} finally {
    await browser.close();
    server.close();
}
if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('되돌리기 안내가 남아 있습니다.');
