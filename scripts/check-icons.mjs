/** 쨈 아이콘 파일이 있고, 크기와 안전 영역이 맞는지 확인합니다. */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { JJAEM_D, JJAEM_FAVICON_D, JJAEM_FAVICON_32_D } from '../src/ui/jjaemMark.js';

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

for (const path of ['public/icon-jjaem.svg', 'public/maskable-512.svg']) {
    const text = read(path)?.toString('utf8') || '';
    check(text.includes(JJAEM_D), `${path} 에 쨈 외곽선이 없습니다.`);
    check(!/<text[\s>]/.test(text), `${path} 가 글꼴 글자를 그대로 씁니다.`);
    check(!/font-family=/.test(text), `${path} 가 글꼴 이름에 기대고 있습니다.`);
}
const faviconSvg = read('public/favicon.svg')?.toString('utf8') || '';
check(faviconSvg.includes(JJAEM_FAVICON_D), '파비콘에 작은 화면용 쨈이 없습니다.');
check(!faviconSvg.includes(JJAEM_D), '파비콘이 가는 외곽선을 그대로 씁니다.');
check(!/<text[\s>]/.test(faviconSvg) && !/font-family=/.test(faviconSvg), '파비콘이 글꼴에 기대고 있습니다.');
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
function isWhite(pixel) {
    const [r, g, b, a] = pixel;
    return a > 200 && r > 220 && g > 220 && b > 220;
}

function tileMargin(png, margin) {
    let white = 0;
    let tile = 0;
    for (let y = 0; y < png.height; y += 1) {
        for (let x = 0; x < png.width; x += 1) {
            const edge = x < margin || y < margin || x >= png.width - margin || y >= png.height - margin;
            if (!edge) continue;
            const pixel = png.pixel(x, y);
            if (isWhite(pixel)) white += 1;
            else if (pixel[3] > 200) tile += 1;
        }
    }
    return { white, tile };
}

function nearestDoubleOf(small, big) {
    if (!small || !big || big.width !== small.width * 2 || big.height !== small.height * 2) return false;
    for (let y = 0; y < small.height; y += 1) {
        for (let x = 0; x < small.width; x += 1) {
            const pixel = small.pixel(x, y);
            for (let dy = 0; dy < 2; dy += 1) {
                for (let dx = 0; dx < 2; dx += 1) {
                    const grown = big.pixel(x * 2 + dx, y * 2 + dy);
                    if (grown.some((channel, index) => channel !== pixel[index])) return false;
                }
            }
        }
    }
    return true;
}

const tiny = decodePng(read('public/favicon-16.png'));
const fav32 = decodePng(read('public/favicon-32.png'));
if (tiny) {
    let ink = 0;
    for (let y = 0; y < tiny.height; y += 1) {
        for (let x = 0; x < tiny.width; x += 1) {
            if (isWhite(tiny.pixel(x, y))) ink += 1;
        }
    }
    check(ink > 70, `16px 파비콘 획이 너무 가늘거나 받침이 붙었습니다. 흰 칸 ${ink}`);
    const aeBar = [1, 2, 3, 4, 5, 6].some((y) => isWhite(tiny.pixel(10, y)) && isWhite(tiny.pixel(11, y)) && isWhite(tiny.pixel(12, y)));
    check(aeBar, '16px 파비콘 ㅐ에 짧은 가로획이 없습니다.');
    const edge = tileMargin(tiny, 1);
    check(edge.white === 0 && edge.tile > 8, `16px 파비콘 타일 여백이 없습니다. 가장자리 흰 칸 ${edge.white}, 타일 ${edge.tile}`);
}
if (fav32) {
    const edge = tileMargin(fav32, 2);
    check(edge.white === 0 && edge.tile > 16, `32px 파비콘 타일 여백이 없습니다. 가장자리 흰 칸 ${edge.white}, 타일 ${edge.tile}`);
    check(!nearestDoubleOf(tiny, fav32), '32px 파비콘이 16px를 늘린 것입니다.');
}
check(JJAEM_FAVICON_32_D !== JJAEM_FAVICON_D && JJAEM_FAVICON_32_D.includes('M2 2'), '32px 파비콘 글자가 16px와 따로 그려져 있지 않습니다.');

const index = read('index.html')?.toString('utf8') || '';
const manifest = read('public/manifest.webmanifest')?.toString('utf8') || '';
for (const needle of ['favicon.svg?v=19', 'favicon.ico?v=19', 'favicon-16.png?v=19', 'favicon-32.png?v=19', 'apple-touch-icon.png?v=19']) {
    check(index.includes(needle), `index.html 에 ${needle} 가 없습니다.`);
}
for (const needle of ['pwa-192.png?v=19', 'pwa-512.png?v=19', 'maskable-512.png?v=19']) {
    check(manifest.includes(needle), `매니페스트에 ${needle} 가 없습니다.`);
}
check(!index.includes('icon-192.png') && !manifest.includes('icon-512.png'), '예전 아이콘 주소가 남아 있습니다.');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('아이콘 파일과 크기를 확인했습니다.');
