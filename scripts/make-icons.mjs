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

    function hueSat(r, g, b) {
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let hue = 0;
        if (d !== 0) {
            if (max === r) hue = ((g - b) / d) % 6;
            else if (max === g) hue = (b - r) / d + 2;
            else hue = (r - g) / d + 4;
            hue *= 60;
            if (hue < 0) hue += 360;
        }
        return [hue, d];
    }

    let farthest = 0;
    const cx = (side - 1) / 2;
    const cy = (side - 1) / 2;
    for (let y = 0; y < side; y += 1) {
        for (let x = 0; x < side; x += 1) {
            const i = (y * side + x) * 4;
            const r = master.data[i];
            const g = master.data[i + 1];
            const b = master.data[i + 2];
            const [hue, sat] = hueSat(r, g, b);
            const bluePlate = hue > 185 && hue < 245 && sat < 75 && b > r + 8;
            if (bluePlate || sat <= 28) continue;
            const rad = Math.hypot((x - cx) / side, (y - cy) / side);
            if (rad > farthest) farthest = rad;
        }
    }
    // 안전 영역은 지름이 아이콘의 80%인 원입니다. 그림이 그 안에 남도록 조금 안쪽에 맞춥니다.
    const scale = Math.min(1, 0.39 / farthest);

    function png(size, mode) {
        const out = document.createElement('canvas');
        out.width = size;
        out.height = size;
        const octx = out.getContext('2d');
        if (mode === 'any') {
            const srcCanvas = document.createElement('canvas');
            srcCanvas.width = side;
            srcCanvas.height = side;
            srcCanvas.getContext('2d').putImageData(master, 0, 0);
            octx.imageSmoothingEnabled = true;
            octx.imageSmoothingQuality = 'high';
            octx.drawImage(srcCanvas, 0, 0, size, size);
            return out.toDataURL('image/png');
        }
        const img = octx.createImageData(size, size);
        for (let y = 0; y < size; y += 1) {
            for (let x = 0; x < size; x += 1) {
                let mx = (x - (size - 1) / 2) / scale + (side - 1) / 2;
                let my = (y - (size - 1) / 2) / scale + (side - 1) / 2;
                mx = Math.max(0, Math.min(side - 1, mx));
                my = Math.max(0, Math.min(side - 1, my));
                const x1 = Math.max(0, Math.min(side - 2, Math.floor(mx)));
                const y1 = Math.max(0, Math.min(side - 2, Math.floor(my)));
                const tx = mx - x1;
                const ty = my - y1;
                const at = (px, py) => {
                    const i = (py * side + px) * 4;
                    return [master.data[i], master.data[i + 1], master.data[i + 2]];
                };
                const c00 = at(x1, y1);
                const c10 = at(x1 + 1, y1);
                const c01 = at(x1, y1 + 1);
                const c11 = at(x1 + 1, y1 + 1);
                const o = (y * size + x) * 4;
                for (let c = 0; c < 3; c += 1) {
                    img.data[o + c] = c00[c] * (1 - tx) * (1 - ty) + c10[c] * tx * (1 - ty) + c01[c] * (1 - tx) * ty + c11[c] * tx * ty;
                }
                img.data[o + 3] = 255;
            }
        }
        octx.putImageData(img, 0, 0);
        return out.toDataURL('image/png');
    }

    return {
        scale,
        any192: png(192, 'any'),
        any512: png(512, 'any'),
        mask192: png(192, 'maskable'),
        mask512: png(512, 'maskable'),
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
