/** 쨈 아이콘 파일이 있고, 크기와 안전 영역이 맞는지 확인합니다. */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { JJAEM_D } from '../src/ui/jjaemMark.js';

const failures = [];
function check(ok, message) {
    if (!ok) failures.push(message);
}

function read(path) {
    try {
        return readFileSync(path);
    } catch {
        failures.push(`${path} 파일이 없습니다.`);
        return null;
    }
}

function pngSize(buf) {
    if (!buf || buf.length < 24 || buf.toString('ascii', 1, 4) !== 'PNG') return null;
    return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20), color: buf[25] };
}

function decodePng(buf) {
    const size = pngSize(buf);
    if (!size) return null;
    const chunks = [];
    let pos = 8;
    while (pos + 8 <= buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('ascii', pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === 'IDAT') chunks.push(data);
        if (type === 'IEND') break;
        pos += 12 + len;
    }
    const raw = inflateSync(Buffer.concat(chunks));
    const { width, height, color } = size;
    const bpp = { 2: 3, 6: 4 }[color];
    if (!bpp) return null;
    const stride = width * bpp;
    const rows = [];
    let i = 0;
    let prev = Buffer.alloc(stride);
    for (let y = 0; y < height; y += 1) {
        const filter = raw[i];
        i += 1;
        const row = Buffer.from(raw.subarray(i, i + stride));
        i += stride;
        const left = (x) => (x >= bpp ? row[x - bpp] : 0);
        if (filter === 1) {
            for (let x = 0; x < stride; x += 1) row[x] = (row[x] + left(x)) & 255;
        } else if (filter === 2) {
            for (let x = 0; x < stride; x += 1) row[x] = (row[x] + prev[x]) & 255;
        } else if (filter === 3) {
            for (let x = 0; x < stride; x += 1) row[x] = (row[x] + Math.floor((left(x) + prev[x]) / 2)) & 255;
        } else if (filter === 4) {
            const paeth = (a, b, c) => {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                if (pa <= pb && pa <= pc) return a;
                return pb <= pc ? b : c;
            };
            for (let x = 0; x < stride; x += 1) {
                const a = left(x);
                const c = x >= bpp ? prev[x - bpp] : 0;
                row[x] = (row[x] + paeth(a, prev[x], c)) & 255;
            }
        } else if (filter !== 0) return null;
        rows.push(row);
        prev = row;
    }
    return {
        width,
        height,
        pixel(x, y) {
            const p = rows[y].subarray(x * bpp, (x + 1) * bpp);
            return [p[0], p[1], p[2], bpp === 4 ? p[3] : 255];
        },
    };
}

const pngs = {
    'public/favicon-16.png': 16,
    'public/favicon-32.png': 32,
    'public/apple-touch-icon.png': 180,
    'public/pwa-192.png': 192,
    'public/pwa-512.png': 512,
    'public/maskable-512.png': 512,
};
for (const [path, size] of Object.entries(pngs)) {
    const info = pngSize(read(path));
    check(info && info.width === size && info.height === size, `${path} 크기가 ${size}이 아닙니다.`);
}

for (const path of ['public/icon-jjaem.svg', 'public/favicon.svg', 'public/maskable-512.svg']) {
    const text = read(path)?.toString('utf8') || '';
    check(text.includes(JJAEM_D), `${path} 에 쨈 외곽선이 없습니다.`);
    check(!/<text[\s>]/.test(text), `${path} 가 글꼴 글자를 그대로 씁니다.`);
    check(!/font-family=/.test(text), `${path} 가 글꼴 이름에 기대고 있습니다.`);
}
const maskSvg = read('public/maskable-512.svg')?.toString('utf8') || '';
check(/<rect [^>]*width="512"[^>]*fill="url\(#bg\)"/.test(maskSvg) && !/rx="114"/.test(maskSvg), 'maskable 원본이 네모 배경이 아닙니다.');

const ico = read('public/favicon.ico');
if (ico && ico.length > 22) {
    check(ico.readUInt16LE(2) === 1, 'favicon.ico 형식이 아닙니다.');
    const count = ico.readUInt16LE(4);
    const sizes = [];
    for (let i = 0; i < count; i += 1) sizes.push(ico[6 + i * 16] || 256);
    check(sizes.includes(16) && sizes.includes(32), `favicon.ico 크기가 16과 32가 아닙니다. ${sizes.join(',')}`);
}

const apple = decodePng(read('public/apple-touch-icon.png'));
if (apple) {
    const corner = apple.pixel(0, 0);
    check(corner[3] === 255 && corner[0] < 200, 'apple-touch-icon 배경이 불투명이 아닙니다.');
}
const mask = decodePng(read('public/maskable-512.png'));
if (mask) {
    const limit = 0.4 * mask.width + 0.6;
    const cx = (mask.width - 1) / 2;
    const cy = (mask.height - 1) / 2;
    let outside = 0;
    let ink = 0;
    for (let y = 0; y < mask.height; y += 1) {
        for (let x = 0; x < mask.width; x += 1) {
            const [r, g, b, a] = mask.pixel(x, y);
            if (a < 255) outside = 9999;
            if (a > 200 && r > 230 && g > 230 && b > 230) {
                ink += 1;
                const dist = Math.hypot(x - cx, y - cy);
                if (dist > limit) outside += 1;
            }
        }
    }
    check(ink > 1000 && outside === 0, 'maskable 글자가 안전 영역 80% 밖으로 나갑니다.');
}
const tiny = decodePng(read('public/favicon-16.png'));
if (tiny) {
    let ink = 0;
    for (let y = 0; y < tiny.height; y += 1) {
        for (let x = 0; x < tiny.width; x += 1) {
            const [r, g, b, a] = tiny.pixel(x, y);
            if (a > 200 && r > 220 && g > 220 && b > 220) ink += 1;
        }
    }
    check(ink > 8, '16px 파비콘에서 쨈이 보이지 않습니다.');
}

const index = read('index.html')?.toString('utf8') || '';
const manifest = read('public/manifest.webmanifest')?.toString('utf8') || '';
for (const needle of ['favicon.svg?v=16', 'favicon.ico?v=16', 'favicon-16.png?v=16', 'favicon-32.png?v=16', 'apple-touch-icon.png?v=16']) {
    check(index.includes(needle), `index.html 에 ${needle} 가 없습니다.`);
}
for (const needle of ['pwa-192.png?v=16', 'pwa-512.png?v=16', 'maskable-512.png?v=16']) {
    check(manifest.includes(needle), `매니페스트에 ${needle} 가 없습니다.`);
}
check(!index.includes('icon-192.png') && !manifest.includes('icon-512.png'), '예전 아이콘 주소가 남아 있습니다.');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('아이콘 파일과 크기를 확인했습니다.');
