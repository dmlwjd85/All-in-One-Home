/**
 * 쨈 교무수첩 아이콘을 만듭니다.
 * 글자는 Pretendard Bold(SIL OFL 1.1) U+CA08 외곽선이고, 글꼴 파일을 아이콘에 넣지 않습니다.
 * 실행: node scripts/make-jjaem-icon.mjs
 */
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { JJAEM_D, JJAEM_FAVICON_D } from '../src/ui/jjaemMark.js';

const root = resolve(new URL('..', import.meta.url).pathname);
const chrome = ['/usr/bin/google-chrome-stable', '/usr/local/bin/google-chrome', '/usr/bin/google-chrome'].find((path) => existsSync(path));

const GLYPH_W = 1649;
const GLYPH_H = 1802;
const STOPS = [
    ['0', '#5E468C'],
    ['.55', '#7A56A8'],
    ['1', '#8A62B0'],
];

function glyphGroup(fill = '#fff') {
    return `<g transform="translate(-13 1638) scale(1 -1)"><path fill="${fill}" d="${JJAEM_D}"/></g>`;
}

function place(canvas, height, nudgeX = 0, nudgeY = 0) {
    const scale = height / GLYPH_H;
    const width = GLYPH_W * scale;
    const x = (canvas - width) / 2 + nudgeX;
    const y = (canvas - height) / 2 + nudgeY;
    return `translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${scale.toFixed(6)})`;
}

function svg({ canvas = 512, radius = 114, glyphH = 312, nudgeX = 0, nudgeY = 0, opaque = false, title = '쨈 교무수첩' }) {
    const grad = STOPS.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('');
    const plate = opaque
        ? `<rect width="${canvas}" height="${canvas}" fill="url(#bg)"/>`
        : `<rect width="${canvas}" height="${canvas}" rx="${radius}" fill="url(#bg)"/>`;
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas} ${canvas}">
  <!-- 쨈 윤곽: Pretendard Bold 1.3.9 U+CA08. Copyright (c) 2021, Kil Hyung-jin. SIL Open Font License 1.1. 글꼴 파일은 넣지 않았습니다. -->
  <title>${title}</title>
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">${grad}</linearGradient></defs>
  ${plate}
  <g transform="${place(canvas, glyphH, nudgeX, nudgeY)}">${glyphGroup()}</g>
</svg>
`;
}

const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

async function centroid(markup) {
    const page = await browser.newPage();
    await page.setViewport({ width: 512, height: 512, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:#000}</style>${markup}`, { waitUntil: 'load' });
    const point = await page.evaluate(() => {
        const svg = document.querySelector('svg');
        const xml = new XMLSerializer().serializeToString(svg);
        const blob = new Blob([xml], { type: 'image/svg+xml' });
        const url = URL.createObjectURL(blob);
        return new Promise((resolvePromise) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = 512;
                canvas.height = 512;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                ctx.drawImage(image, 0, 0, 512, 512);
                const data = ctx.getImageData(0, 0, 512, 512).data;
                let n = 0;
                let x = 0;
                let y = 0;
                for (let i = 0; i < data.length; i += 4) {
                    if (data[i] > 230 && data[i + 1] > 230 && data[i + 2] > 230 && data[i + 3] > 200) {
                        const px = (i / 4) % 512;
                        const py = Math.floor((i / 4) / 512);
                        x += px;
                        y += py;
                        n += 1;
                    }
                }
                URL.revokeObjectURL(url);
                resolvePromise(n ? { x: x / n, y: y / n, n } : null);
            };
            image.src = url;
        });
    });
    await page.close();
    return point;
}

const probe = svg({ radius: 0, glyphH: 312, opaque: true });
const center = await centroid(probe);
const nudgeX = 256 - center.x;
const nudgeY = 256 - center.y;
console.log('centroid', center, 'nudge', { nudgeX, nudgeY });

const any = svg({ canvas: 512, radius: 114, glyphH: 318, nudgeX, nudgeY });
const mask = svg({ canvas: 512, radius: 0, glyphH: 276, nudgeX: nudgeX * (276 / 318), nudgeY: nudgeY * (276 / 318), opaque: true });
const apple = svg({ canvas: 512, radius: 0, glyphH: 318, nudgeX, nudgeY, opaque: true });
const faviconOnly = process.argv.includes('--favicon-only');

function faviconSvg() {
    const grad = STOPS.map(([offset, color]) => `<stop offset="${offset}" stop-color="${color}"/>`).join('');
    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">
  <!-- 16·32px 파비콘. 자세한 외곽선은 icon-jjaem.svg. 글꼴 파일은 넣지 않았습니다. -->
  <title>쨈 교무수첩</title>
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">${grad}</linearGradient></defs>
  <rect width="16" height="16" rx="2" fill="url(#bg)"/>
  <path fill="#fff" shape-rendering="crispEdges" d="${JJAEM_FAVICON_D}"/>
</svg>
`;
}
const small = faviconSvg();

if (!faviconOnly) {
    writeFileSync(resolve(root, 'public/icon-jjaem.svg'), any);
    writeFileSync(resolve(root, 'public/maskable-512.svg'), mask);
}
writeFileSync(resolve(root, 'public/favicon.svg'), small);

async function raster(markup, size, transparent) {
    const page = await browser.newPage();
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    const sized = markup.includes('width=') ? markup : markup.replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setContent(`<!doctype html><style>html,body{margin:0;width:${size}px;height:${size}px;overflow:hidden;background:transparent}</style>${sized}`, { waitUntil: 'load' });
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: size, height: size }, omitBackground: transparent });
    await page.close();
    return png;
}

/** 16px 그림을 픽셀 단위로 두 배 키웁니다. 32px에서도 획이 흐려지지 않습니다. */
async function nearestDouble(markup) {
    const page = await browser.newPage();
    await page.setViewport({ width: 32, height: 32, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:transparent}</style>${markup}<canvas id="c" width="32" height="32"></canvas>`, { waitUntil: 'load' });
    await page.evaluate(() => new Promise((resolve) => {
        const svg = document.querySelector('svg');
        svg.setAttribute('width', '16');
        svg.setAttribute('height', '16');
        const xml = new XMLSerializer().serializeToString(svg);
        const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml' }));
        const image = new Image();
        image.onload = () => {
            const canvas = document.getElementById('c');
            const ctx = canvas.getContext('2d');
            ctx.imageSmoothingEnabled = false;
            const small = document.createElement('canvas');
            small.width = 16;
            small.height = 16;
            const src = small.getContext('2d');
            src.imageSmoothingEnabled = false;
            src.drawImage(image, 0, 0, 16, 16);
            const dots = src.getImageData(0, 0, 16, 16).data;
            const big = ctx.createImageData(32, 32);
            for (let y = 0; y < 16; y += 1) {
                for (let x = 0; x < 16; x += 1) {
                    const i = (y * 16 + x) * 4;
                    for (let dy = 0; dy < 2; dy += 1) {
                        for (let dx = 0; dx < 2; dx += 1) {
                            const j = ((y * 2 + dy) * 32 + (x * 2 + dx)) * 4;
                            big.data[j] = dots[i];
                            big.data[j + 1] = dots[i + 1];
                            big.data[j + 2] = dots[i + 2];
                            big.data[j + 3] = dots[i + 3];
                        }
                    }
                }
            }
            ctx.putImageData(big, 0, 0);
            svg.remove();
            resolve();
        };
        image.src = url;
    }));
    const png = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: 32, height: 32 }, omitBackground: true });
    await page.close();
    return png;
}

const outputs = faviconOnly ? [
    ['public/favicon-16.png', small, 16, true],
] : [
    ['public/favicon-16.png', small, 16, true],
    ['public/apple-touch-icon.png', apple, 180, false],
    ['public/pwa-192.png', any, 192, true],
    ['public/pwa-512.png', any, 512, true],
    ['public/maskable-512.png', mask, 512, false],
];
for (const [name, markup, size, transparent] of outputs) {
    const png = await raster(markup, size, transparent);
    writeFileSync(resolve(root, name), png);
    console.log(name, png.length, transparent ? 'transparent' : 'opaque');
}

function ico(images) {
    const count = images.length;
    let offset = 6 + 16 * count;
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0);
    header.writeUInt16LE(1, 2);
    header.writeUInt16LE(count, 4);
    const entries = [];
    for (const { size, png } of images) {
        const entry = Buffer.alloc(16);
        entry.writeUInt8(size === 256 ? 0 : size, 0);
        entry.writeUInt8(size === 256 ? 0 : size, 1);
        entry.writeUInt16LE(1, 4);
        entry.writeUInt16LE(32, 6);
        entry.writeUInt32LE(png.length, 8);
        entry.writeUInt32LE(offset, 12);
        entries.push(entry);
        offset += png.length;
    }
    return Buffer.concat([header, ...entries, ...images.map((item) => item.png)]);
}

const png16 = await raster(small, 16, true);
const png32 = await nearestDouble(small);
writeFileSync(resolve(root, 'public/favicon-32.png'), png32);
console.log('public/favicon-32.png', png32.length, 'nearest');
writeFileSync(resolve(root, 'public/favicon.ico'), ico([
    { size: 16, png: png16 },
    { size: 32, png: png32 },
]));
console.log('favicon.ico', (await import('node:fs')).statSync(resolve(root, 'public/favicon.ico')).size);

const checked = await centroid(svg({ radius: 0, glyphH: 318, nudgeX, nudgeY, opaque: true }));
console.log('after nudge', checked);
await browser.close();

const py = spawnSync('python3', ['-c', 'import PIL'], { encoding: 'utf8' });
if (py.status !== 0) console.log('PIL 없음. PNG는 그대로 둡니다.');
