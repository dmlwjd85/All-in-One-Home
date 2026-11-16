/**
 * 급식표 사진 읽기를 실제 크롬에서 끝까지 돌립니다.
 * - 글자 인식 프로그램(작업자·코어)과 한국어 자료를 이 앱과 같은 주소의 ./ocr/ 에서만 받는지(다른 서버로 가는 요청은 막고 실패로 봄)
 * - 사진 파일 → 칸 찾기 → 글자 읽기 → 날짜별 메뉴까지 이어지는지(PR #86 처음 판은 여기서 빈 그림을 넘겨 실패했습니다)
 * 견본: PR 견본(16~20일, 연한 선), 가상 월간표.
 */
import { build } from 'esbuild';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = new URL('..', import.meta.url).pathname;
const dir = mkdtempSync(join(tmpdir(), 'meal-ocr-'));
await build({
    entryPoints: [join(root, 'scripts/harness/meal-ocr.js')], bundle: true, outfile: join(dir, 'app.js'), format: 'esm', platform: 'browser',
    define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'error',
});
writeFileSync(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>meal ocr</title><script type="module" src="./app.js"></script>');

const files = {
    '/': [join(dir, 'index.html'), 'text/html; charset=utf-8'],
    '/app.js': [join(dir, 'app.js'), 'text/javascript'],
    '/ocr/worker.min.js': [resolve(root, 'node_modules/tesseract.js/dist/worker.min.js'), 'text/javascript'],
    '/ocr/tesseract-core-simd-lstm.wasm.js': [resolve(root, 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js'), 'text/javascript'],
    '/ocr/tesseract-core-lstm.wasm.js': [resolve(root, 'node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js'), 'text/javascript'],
    '/ocr/kor.traineddata.gz': [resolve(root, 'public/ocr/kor.traineddata.gz'), 'application/gzip'],
    '/sample.png': [resolve(root, 'scripts/fixtures/sample-meal-example.png'), 'image/png'],
    '/month.png': [resolve(root, 'scripts/fixtures/meal-month-synthetic.png'), 'image/png'],
};
for (const [path, [file]] of Object.entries(files)) if (!existsSync(file)) { console.error(`파일이 없습니다: ${path} ← ${file}`); process.exit(1); }
const served = [];
const server = createServer((req, res) => {
    const path = new URL(req.url, 'http://x').pathname;
    const hit = files[path];
    served.push(path);
    if (!hit) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': hit[1] });
    res.end(readFileSync(hit[0]));
});
await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
const origin = `http://127.0.0.1:${server.address().port}`;

const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!chrome) { console.error('크롬이 없어 급식표 사진 검사를 못 했습니다.'); process.exit(1); }
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--no-zygote'] });
let bad = 0;
const check = (ok, msg) => { if (!ok) { bad += 1; console.error(`✗ ${msg}`); } };
try {
    const page = await browser.newPage();
    const outside = [];
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error?.message || error)));
    page.on('console', (msg) => { if (msg.type() === 'error') errors.push(msg.text()); });
    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const url = req.url();
        if (url.startsWith(origin) || url.startsWith('data:') || url.startsWith('blob:')) req.continue();
        else { outside.push(url); req.abort(); }
    });
    /* 웹 작업자 안의 요청은 위 가로채기에 안 잡히므로, 서버가 받은 길로도 확인합니다. */
    await page.goto(`${origin}/`);
    await page.waitForFunction(() => typeof window.runMealOcr === 'function', { timeout: 30000 });

    const cases = [
        ['/sample.png', 'sample.png', { '2026-11-16': ['현미밥', '김치찌개', '돈가스'], '2026-11-20': ['흰밥', '콩나물국', '고등어구이'] }, 5],
        ['/month.png', 'month.png', JSON.parse(readFileSync(resolve(root, 'scripts/fixtures/meal-month-synthetic.json'), 'utf8')).days.reduce((acc, day) => ({ ...acc, [day.date]: day.items }), {}), 10],
    ];
    for (const [url, name, want, dayCount] of cases) {
        const started = Date.now();
        const got = await page.evaluate((u, n) => window.runMealOcr(u, n), url, name);
        const map = Object.fromEntries(got.days.map((day) => [day.date, day.items]));
        let hit = 0;
        let total = 0;
        for (const [date, items] of Object.entries(want)) for (const item of items) { total += 1; if ((map[date] || []).includes(item)) hit += 1; }
        console.log(`  ${name}: ${((Date.now() - started) / 1000).toFixed(1)}초, 날짜 ${got.days.length}, 메뉴 ${hit}/${total}`);
        check(!got.weak, `${name} 칸 선을 못 찾음`);
        check(got.days.length === dayCount, `${name} 날짜 ${got.days.length}개 (바람 ${dayCount}) ${got.days.map((day) => day.date).join(',')}`);
        check(hit >= total * 0.8, `${name} 메뉴 ${hit}/${total}\n${got.text}`);
    }
    check(outside.length === 0, `다른 서버로 간 요청: ${outside.join(', ')}`);
    check(served.includes('/ocr/kor.traineddata.gz') && served.includes('/ocr/worker.min.js') && served.some((path) => /tesseract-core-.*lstm\.wasm\.js$/.test(path)), `./ocr/ 에서 받은 것: ${served.filter((path) => path.startsWith('/ocr/')).join(', ')}`);
    check(errors.length === 0, `페이지 오류: ${errors.join(' | ')}`);
} finally {
    await browser.close();
    server.close();
}
if (bad) {
    console.error(`급식표 사진 브라우저 검사 실패 ${bad}`);
    process.exit(1);
}
console.log('급식표 사진 브라우저 검사를 통과했습니다.');
