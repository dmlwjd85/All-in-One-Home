/** 라일락 타일에 쓱 심볼을 그려 아이콘으로 저장합니다. */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(new URL('..', import.meta.url).pathname);
const font = pathToFileURL(resolve(root, 'public/fonts/GowunBatang-Bold.woff2')).href;
const chrome = ['/usr/bin/google-chrome-stable', '/usr/local/bin/google-chrome', '/usr/bin/google-chrome'].find((path) => existsSync(path));

function pageHtml(size) {
    const fontSize = Math.round(size * 0.42);
    const dot = Math.round(size * 0.12);
    const inset = Math.round(size * 0.16);
    return `<!doctype html><meta charset="utf-8"><style>
      @font-face { font-family: 'Gowun Batang'; src: url('${font}') format('woff2'); font-weight: 700; }
      html, body { margin: 0; width: ${size}px; height: ${size}px; }
      .tile {
        width: ${size}px; height: ${size}px; display: grid; place-items: center; position: relative;
        background: linear-gradient(135deg, #7048F2 0%, #C2457E 62%, #B85A3E 100%);
        color: #fff; font-family: 'Gowun Batang', serif; font-size: ${fontSize}px; font-weight: 700; line-height: 1;
      }
      .dot { position: absolute; right: ${inset}px; bottom: ${inset}px; width: ${dot}px; height: ${dot}px; border-radius: 999px; background: #E58C6F; }
    </style><div class="tile">쓱<div class="dot"></div></div>`;
}

const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
for (const size of [192, 512]) {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.setContent(pageHtml(size), { waitUntil: 'networkidle0' });
    await page.screenshot({ path: resolve(root, `public/icon-${size}.png`), type: 'png' });
    await page.close();
}
await browser.close();
console.log('아이콘을 저장했습니다.');
