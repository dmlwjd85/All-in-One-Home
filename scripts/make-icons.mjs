/** 고른 클레이 시안(가방·노트·사과)을 앱 아이콘 PNG로 저장합니다. */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = resolve(new URL('..', import.meta.url).pathname);
const sourcePath = resolve(root, 'scripts/icon-source.jpg');
const chrome = ['/usr/bin/google-chrome-stable', '/usr/local/bin/google-chrome', '/usr/bin/google-chrome'].find((path) => existsSync(path));

/** 원본 1024px 시안에서 둥근 판의 바깥 여백을 뺀 범위입니다. */
const PLATE = { L: 121, T: 96, R: 886, B: 871, radius: 170 };

const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setContent('<!doctype html><meta charset="utf-8"><canvas id="c"></canvas>', { waitUntil: 'load' });
const dataUrl = `data:image/jpeg;base64,${readFileSync(sourcePath).toString('base64')}`;
const icons = await page.evaluate(async (src, plate) => {
    const image = new Image();
    image.src = src;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(image, 0, 0);
    const srcData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { L, T, R, B, radius } = plate;
    const width = canvas.width;
    const side = R - L + 1;
    const y0 = T + Math.floor(((B - T + 1) - side) / 2);
    const x0 = L;
    const r2 = (radius - 0.5) * (radius - 0.5);
    const sampleR = radius - 6;

    function inside(x, y) {
        if (x < L || y < T || x > R || y > B) return false;
        const corners = [
            [L + radius, T + radius, x < L + radius && y < T + radius],
            [R - radius, T + radius, x > R - radius && y < T + radius],
            [L + radius, B - radius, x < L + radius && y > B - radius],
            [R - radius, B - radius, x > R - radius && y > B - radius],
        ];
        for (const [cx, cy, hit] of corners) {
            if (!hit) continue;
            const dx = x - cx;
            const dy = y - cy;
            return dx * dx + dy * dy <= r2;
        }
        return true;
    }

    function sample(x, y) {
        const x1 = Math.max(0, Math.min(width - 2, Math.floor(x)));
        const y1 = Math.max(0, Math.min(srcData.height - 2, Math.floor(y)));
        const tx = x - x1;
        const ty = y - y1;
        const at = (px, py) => {
            const i = (py * width + px) * 4;
            return [srcData.data[i], srcData.data[i + 1], srcData.data[i + 2]];
        };
        const c00 = at(x1, y1);
        const c10 = at(x1 + 1, y1);
        const c01 = at(x1, y1 + 1);
        const c11 = at(x1 + 1, y1 + 1);
        return [0, 1, 2].map((c) => c00[c] * (1 - tx) * (1 - ty) + c10[c] * tx * (1 - ty) + c01[c] * (1 - tx) * ty + c11[c] * tx * ty);
    }

    const master = new ImageData(side, side);
    for (let y = 0; y < side; y += 1) {
        for (let x = 0; x < side; x += 1) {
            const sx = x0 + x;
            const sy = y0 + y;
            let rgb;
            if (inside(sx, sy)) {
                const i = (sy * width + sx) * 4;
                rgb = [srcData.data[i], srcData.data[i + 1], srcData.data[i + 2]];
            } else {
                const cx = sx < L + radius ? L + radius : R - radius;
                const cy = sy < T + radius ? T + radius : B - radius;
                const dx = sx - cx;
                const dy = sy - cy;
                const dist = Math.max(Math.hypot(dx, dy), 1e-3);
                rgb = sample(cx + (dx / dist) * sampleR, cy + (dy / dist) * sampleR);
            }
            const o = (y * side + x) * 4;
            master.data[o] = rgb[0];
            master.data[o + 1] = rgb[1];
            master.data[o + 2] = rgb[2];
            master.data[o + 3] = 255;
        }
    }

    const anyCanvas = document.createElement('canvas');
    anyCanvas.width = side;
    anyCanvas.height = side;
    anyCanvas.getContext('2d').putImageData(master, 0, 0);

    // maskable은 같은 도안을 가운데 0.75배로 둡니다.
    // 0.8배면 사과 가장자리가 안전 영역(지름 80% 원) 밖으로 나가 원형 마스크에 잘립니다.
    const maskScale = 0.75;
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = side;
    maskCanvas.height = side;
    const maskCtx = maskCanvas.getContext('2d');
    const draw = Math.round(side * maskScale);
    const ox = Math.floor((side - draw) / 2);
    const oy = Math.floor((side - draw) / 2);
    maskCtx.drawImage(anyCanvas, ox, oy, draw, draw);
    if (oy > 0) maskCtx.drawImage(maskCanvas, ox, oy, draw, 1, 0, 0, side, oy);
    const bottom = oy + draw;
    if (bottom < side) maskCtx.drawImage(maskCanvas, ox, bottom - 1, draw, 1, 0, bottom, side, side - bottom);
    if (ox > 0) maskCtx.drawImage(maskCanvas, ox, 0, 1, side, 0, 0, ox, side);
    const right = ox + draw;
    if (right < side) maskCtx.drawImage(maskCanvas, right - 1, 0, 1, side, right, 0, side - right, side);

    function png(source, size) {
        const out = document.createElement('canvas');
        out.width = size;
        out.height = size;
        const octx = out.getContext('2d');
        octx.imageSmoothingEnabled = true;
        octx.imageSmoothingQuality = 'high';
        octx.drawImage(source, 0, 0, size, size);
        return out.toDataURL('image/png');
    }

    return {
        scale: maskScale,
        any32: png(anyCanvas, 32),
        any180: png(anyCanvas, 180),
        any192: png(anyCanvas, 192),
        any512: png(anyCanvas, 512),
        mask192: png(maskCanvas, 192),
        mask512: png(maskCanvas, 512),
    };
}, dataUrl, PLATE);
await page.close();
await browser.close();

function writePng(name, url) {
    const body = url.replace(/^data:image\/png;base64,/, '');
    writeFileSync(resolve(root, 'public', name), Buffer.from(body, 'base64'));
}
function quantize(path) {
    const bin = ['/usr/bin/pngquant', '/usr/local/bin/pngquant'].find((item) => existsSync(item));
    if (!bin) return;
    const tmp = `${path}.quant.png`;
    const result = spawnSync(bin, ['--quality=80-100', '--speed', '1', '--force', '--output', tmp, path], { encoding: 'utf8' });
    if (result.status === 0 && existsSync(tmp)) renameSync(tmp, path);
    else if (existsSync(tmp)) rmSync(tmp);
}

const outputs = [
    ['favicon-32.png', icons.any32],
    ['apple-touch-icon.png', icons.any180],
    ['icon-192.png', icons.any192],
    ['icon-512.png', icons.any512],
    ['icon-maskable-192.png', icons.mask192],
    ['icon-maskable-512.png', icons.mask512],
];
for (const [name, url] of outputs) {
    const path = resolve(root, 'public', name);
    writePng(name, url);
    quantize(path);
}
console.log(`아이콘을 저장했습니다. maskable scale ${icons.scale.toFixed(3)}`);
