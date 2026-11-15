/**
 * 표 사진(급식표·달력 캡처)을 글자 인식에 맞게 다듬습니다. 화면·캔버스 없이 숫자 배열만 다뤄서 검사에서도 그대로 돕니다.
 *
 * 순서
 *  1. 밝기 배열로 바꾸고, 주변보다 뚜렷이 어두운 점(잉크)을 고릅니다. 칸 바탕에 색이 있어도 글자만 남습니다.
 *  2. 길게 이어진 잉크를 표 선으로 보고, 선이 모인 자리로 칸을 나눕니다. 조금 기운 사진은 먼저 바로 세웁니다.
 *  3. 칸마다 선을 지우고 글자를 키워, 한 줄로 세운 그림(세로 띠)으로 붙입니다.
 *     글자 인식은 표 선과 옆 칸 글에 약하므로, 칸을 따로 떼어 한 단으로 읽히는 쪽이 훨씬 정확합니다.
 *  4. 인식한 줄을 세로 자리로 원래 칸에 되돌립니다.
 */

/** RGBA → 밝기(0~255). 투명한 곳은 흰 바탕으로 봅니다. */
export function toGray(rgba, width, height) {
    const out = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < out.length; i += 1, p += 4) {
        const a = rgba[p + 3] / 255;
        const lum = 0.299 * rgba[p] + 0.587 * rgba[p + 1] + 0.114 * rgba[p + 2];
        out[i] = Math.round(lum * a + 255 * (1 - a));
    }
    return out;
}

function integral(gray, width, height) {
    const sum = new Float64Array((width + 1) * (height + 1));
    for (let y = 0; y < height; y += 1) {
        let row = 0;
        for (let x = 0; x < width; x += 1) {
            row += gray[y * width + x];
            sum[(y + 1) * (width + 1) + x + 1] = sum[y * (width + 1) + x + 1] + row;
        }
    }
    return sum;
}

/** 주변 평균보다 뚜렷이 어두운 점을 1로 둡니다(적응형 이진화). 그림자·색 바탕에서도 글자와 선만 남습니다. */
export function inkMask(gray, width, height, { win = 0, ratio = 0.87, floor = 14 } = {}) {
    const size = win || Math.min(61, Math.max(15, Math.round(Math.max(width, height) / 40) | 1));
    const half = size >> 1;
    const sum = integral(gray, width, height);
    const out = new Uint8Array(width * height);
    const stride = width + 1;
    for (let y = 0; y < height; y += 1) {
        const y0 = Math.max(0, y - half);
        const y1 = Math.min(height, y + half + 1);
        for (let x = 0; x < width; x += 1) {
            const x0 = Math.max(0, x - half);
            const x1 = Math.min(width, x + half + 1);
            const total = sum[y1 * stride + x1] - sum[y0 * stride + x1] - sum[y1 * stride + x0] + sum[y0 * stride + x0];
            const mean = total / ((x1 - x0) * (y1 - y0));
            const value = gray[y * width + x];
            if (value < mean * ratio && mean - value > floor) out[y * width + x] = 1;
        }
    }
    return out;
}

/** 가로(또는 세로)로 minLen 넘게 이어진 잉크만 남깁니다. 끊긴 점 gap 개까지는 이어진 것으로 봅니다. */
export function longRuns(ink, width, height, minLen, horizontal, gap = 2) {
    const out = new Uint8Array(width * height);
    const outer = horizontal ? height : width;
    const inner = horizontal ? width : height;
    const at = horizontal ? (o, i) => o * width + i : (o, i) => i * width + o;
    for (let o = 0; o < outer; o += 1) {
        let start = -1;
        let last = -1;
        for (let i = 0; i <= inner; i += 1) {
            const on = i < inner && ink[at(o, i)] === 1;
            if (on) {
                if (start < 0) start = i;
                last = i;
            } else if (start >= 0 && (i === inner || i - last > gap)) {
                if (last - start + 1 >= minLen) for (let k = start; k <= last; k += 1) out[at(o, k)] = 1;
                start = -1;
            }
        }
    }
    return out;
}

function project(mask, width, height, horizontal) {
    const out = new Float64Array(horizontal ? height : width);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            if (mask[y * width + x]) out[horizontal ? y : x] += 1;
        }
    }
    return out;
}

/** 값이 큰 자리를 묶어 선 하나로 봅니다. { at: 가운데, from, to } */
function peaks(proj, min) {
    const out = [];
    let start = -1;
    for (let i = 0; i <= proj.length; i += 1) {
        const on = i < proj.length && proj[i] >= min;
        if (on && start < 0) start = i;
        else if (!on && start >= 0) {
            out.push({ at: Math.round((start + i - 1) / 2), from: start, to: i - 1 });
            start = -1;
        }
    }
    return out;
}

/**
 * 표가 기운 각도(도)를 가로 선에서 잽니다. 선 점을 조금씩 기울여 쌓았을 때 가장 날카롭게 모이는 각도입니다.
 * 선이 거의 없으면 0.
 */
export function skewAngle(hMask, width, height, { max = 4, step = 0.25 } = {}) {
    const pts = [];
    const stride = Math.max(1, Math.floor((width * height) / 400000));
    for (let y = 0; y < height; y += 1) {
        for (let x = (y * 7) % stride; x < width; x += stride) if (hMask[y * width + x]) pts.push(x, y);
    }
    if (pts.length < 400) return 0;
    let best = 0;
    let bestScore = -1;
    const bins = new Float64Array(height * 2 + 1);
    for (let deg = -max; deg <= max + 1e-9; deg += step) {
        const t = Math.tan((deg * Math.PI) / 180);
        bins.fill(0);
        for (let i = 0; i < pts.length; i += 2) {
            const yy = Math.round(pts[i + 1] - (pts[i] - width / 2) * t) + Math.floor(height / 2);
            if (yy >= 0 && yy < bins.length) bins[yy] += 1;
        }
        let score = 0;
        for (let i = 0; i < bins.length; i += 1) score += bins[i] * bins[i];
        if (score > bestScore * 1.0005) { bestScore = score; best = deg; }
    }
    return Math.abs(best) < step / 2 ? 0 : best;
}

/** 가운데를 축으로 deg 도만큼 돌려 바로 세웁니다(빈 곳은 흰색). */
export function rotateGray(gray, width, height, deg) {
    if (!deg) return gray;
    const rad = (deg * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const cx = width / 2;
    const cy = height / 2;
    const out = new Uint8Array(width * height).fill(255);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const dx = x - cx;
            const dy = y - cy;
            const sx = cx + dx * cos - dy * sin;
            const sy = cy + dx * sin + dy * cos;
            const x0 = Math.floor(sx);
            const y0 = Math.floor(sy);
            if (x0 < 0 || y0 < 0 || x0 >= width - 1 || y0 >= height - 1) continue;
            const fx = sx - x0;
            const fy = sy - y0;
            const i = y0 * width + x0;
            out[y * width + x] = Math.round(
                gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy)
                + gray[i + width] * (1 - fx) * fy + gray[i + width + 1] * fx * fy,
            );
        }
    }
    return out;
}

/**
 * 표 선과 칸을 찾습니다.
 * 돌려줌: { xs, ys, lineMask, ink, ok } — xs·ys 는 선의 가운데 자리(왼쪽→오른쪽, 위→아래).
 * 바깥 테두리가 없는 표는 가로 선의 양 끝을 세로 선으로 삼습니다.
 */
export function findGrid(gray, width, height) {
    const ink = inkMask(gray, width, height);
    const hLen = Math.max(24, Math.round(width * 0.035));
    const vLen = Math.max(24, Math.round(height * 0.035));
    const hMask = longRuns(ink, width, height, hLen, true);
    const vMask = longRuns(ink, width, height, vLen, false);
    const hProj = project(hMask, width, height, true);
    const vProj = project(vMask, width, height, false);
    const hMax = Math.max(0, ...hProj);
    const vMax = Math.max(0, ...vProj);
    const lineMask = new Uint8Array(width * height);
    if (hMax < width * 0.2 || vMax < height * 0.04) return { xs: [], ys: [], lineMask, ink, hMask, ok: false };
    let rows = peaks(hProj, Math.max(hMax * 0.35, width * 0.12));
    let cols = peaks(vProj, Math.max(vMax * 0.3, height * 0.03));
    /* 가까이 붙은 선(겹선·굵은 테두리)은 하나로 합칩니다. */
    const merge = (list, near) => list.reduce((acc, item) => {
        const prev = acc[acc.length - 1];
        if (prev && item.from - prev.to <= near) { prev.to = item.to; prev.at = Math.round((prev.from + prev.to) / 2); } else acc.push({ ...item });
        return acc;
    }, []);
    rows = merge(rows, 4);
    cols = merge(cols, 4);
    /* 지울 선은 찾은 표 선 자리(양옆 한 점 여유)의 긴 잉크뿐입니다. 큰 글자의 긴 획은 건드리지 않습니다. */
    for (const row of rows) {
        for (let y = Math.max(0, row.from - 1); y <= Math.min(height - 1, row.to + 1); y += 1) {
            for (let x = 0; x < width; x += 1) if (hMask[y * width + x]) lineMask[y * width + x] = 1;
        }
    }
    for (const col of cols) {
        for (let x = Math.max(0, col.from - 1); x <= Math.min(width - 1, col.to + 1); x += 1) {
            for (let y = 0; y < height; y += 1) if (vMask[y * width + x]) lineMask[y * width + x] = 1;
        }
    }
    const ys = rows.map((row) => row.at);
    const xs = cols.map((col) => col.at);
    /* 테두리 없는 표: 가로 선이 세로 선 밖으로 한 칸 넘게 나가 있으면 그 끝을 칸 경계로 더합니다. */
    if (ys.length >= 2) {
        let left = width;
        let right = 0;
        for (const y of ys) {
            for (let x = 0; x < width; x += 1) if (hMask[y * width + x]) { if (x < left) left = x; if (x > right) right = x; }
        }
        const cell = xs.length >= 2 ? (xs[xs.length - 1] - xs[0]) / (xs.length - 1) : width / 6;
        if (!xs.length || xs[0] - left > cell * 0.5) xs.unshift(left);
        if (right - xs[xs.length - 1] > cell * 0.5) xs.push(right);
    }
    return { xs, ys, lineMask, ink, hMask, ok: xs.length >= 2 && ys.length >= 2 };
}

/** 선 사이를 칸으로 나눕니다. 너무 좁은 틈(겹선)은 건너뜁니다. */
export function gridCells(xs, ys, { minW = 14, minH = 10 } = {}) {
    const colEdges = [];
    const rowEdges = [];
    for (let i = 0; i < xs.length - 1; i += 1) if (xs[i + 1] - xs[i] >= minW) colEdges.push([xs[i], xs[i + 1]]);
    for (let i = 0; i < ys.length - 1; i += 1) if (ys[i + 1] - ys[i] >= minH) rowEdges.push([ys[i], ys[i + 1]]);
    return rowEdges.map(([y0, y1], r) => colEdges.map(([x0, x1], c) => ({ r, c, x0, y0, x1, y1 })));
}

/** 칸 안 글자의 높이(점). 잉크가 있는 줄이 이어진 길이의 가운데값입니다. */
function glyphHeight(ink, lineMask, width, cells) {
    const runs = [];
    for (const cell of cells) {
        let run = 0;
        for (let y = cell.y0 + 2; y <= cell.y1 - 2; y += 1) {
            let any = false;
            for (let x = cell.x0 + 2; x < cell.x1 - 2; x += 1) {
                const i = y * width + x;
                if (ink[i] && !lineMask[i]) { any = true; break; }
            }
            if (any && y < cell.y1 - 2) run += 1;
            else { if (run >= 5) runs.push(run); run = 0; }
        }
    }
    if (!runs.length) return 0;
    runs.sort((a, b) => a - b);
    return runs[Math.floor(runs.length / 2)];
}

function cellInk(ink, lineMask, width, cell, inset) {
    let n = 0;
    for (let y = cell.y0 + inset; y <= cell.y1 - inset; y += 1) {
        for (let x = cell.x0 + inset; x <= cell.x1 - inset; x += 1) {
            const i = y * width + x;
            if (ink[i] && !lineMask[i]) n += 1;
        }
    }
    return n;
}

/**
 * 칸마다 선을 지우고, 바탕을 희게 맞추고, 글자를 키워 세로로 이어 붙입니다.
 * 돌려줌: 띠 목록 [{ data, width, height, bands: [{ r, c, y0, y1 }] }], 한 장이 너무 길면 여러 장으로 나눕니다.
 */
export function buildStrips(gray, width, height, grid, { target = 34, maxScale = 4, maxHeight = 5200, pad = 18, gapY = 30, order = null } = {}) {
    const rows = gridCells(grid.xs, grid.ys);
    const flat = (order || rows.flat());
    const glyph = glyphHeight(grid.ink, grid.lineMask, width, flat);
    const scale = glyph ? Math.min(maxScale, Math.max(1, target / glyph)) : 2;
    const inset = 2;
    const pieces = [];
    for (const cell of flat) {
        if (cellInk(grid.ink, grid.lineMask, width, cell, inset) < 6) continue;
        const x0 = cell.x0 + inset;
        const y0 = cell.y0 + inset;
        const w = cell.x1 - cell.x0 - inset * 2 + 1;
        const h = cell.y1 - cell.y0 - inset * 2 + 1;
        if (w < 6 || h < 6) continue;
        /* 칸 바탕 밝기: 밝은 쪽 가운데값. 이 값을 흰색으로 삼아 색 바탕·그림자를 없앱니다. */
        const hist = new Uint32Array(256);
        for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) hist[gray[(y0 + y) * width + x0 + x]] += 1;
        let seen = 0;
        let bg = 255;
        const want = w * h * 0.3;
        for (let v = 255; v >= 0; v -= 1) { seen += hist[v]; if (seen >= want) { bg = Math.max(60, v); break; } }
        const sw = Math.max(1, Math.round(w * scale));
        const sh = Math.max(1, Math.round(h * scale));
        const data = new Uint8Array(sw * sh);
        const src = (x, y) => {
            const i = (y0 + y) * width + x0 + x;
            if (grid.lineMask[i]) return 255;
            return Math.min(255, Math.round((gray[i] * 255) / bg));
        };
        for (let y = 0; y < sh; y += 1) {
            const fy = Math.min(h - 1.001, (y + 0.5) / scale - 0.5);
            const iy = Math.max(0, Math.floor(fy));
            const ty = Math.max(0, fy - iy);
            for (let x = 0; x < sw; x += 1) {
                const fx = Math.min(w - 1.001, (x + 0.5) / scale - 0.5);
                const ix = Math.max(0, Math.floor(fx));
                const tx = Math.max(0, fx - ix);
                const ix1 = Math.min(w - 1, ix + 1);
                const iy1 = Math.min(h - 1, iy + 1);
                data[y * sw + x] = Math.round(
                    src(ix, iy) * (1 - tx) * (1 - ty) + src(ix1, iy) * tx * (1 - ty)
                    + src(ix, iy1) * (1 - tx) * ty + src(ix1, iy1) * tx * ty,
                );
            }
        }
        pieces.push({ r: cell.r, c: cell.c, data, w: sw, h: sh });
    }
    const strips = [];
    let batch = [];
    let tall = pad;
    const flush = () => {
        if (!batch.length) return;
        const w = Math.max(...batch.map((piece) => piece.w)) + pad * 2;
        const h = tall;
        const data = new Uint8Array(w * h).fill(255);
        const bands = [];
        let y = pad;
        for (const piece of batch) {
            for (let row = 0; row < piece.h; row += 1) data.set(piece.data.subarray(row * piece.w, (row + 1) * piece.w), (y + row) * w + pad);
            bands.push({ r: piece.r, c: piece.c, y0: y - gapY / 2, y1: y + piece.h + gapY / 2 });
            y += piece.h + gapY;
        }
        strips.push({ data, width: w, height: h, bands });
        batch = [];
        tall = pad;
    };
    for (const piece of pieces) {
        if (batch.length && tall + piece.h + gapY > maxHeight) flush();
        batch.push(piece);
        tall += piece.h + gapY;
    }
    flush();
    return { strips, scale, rows: rows.length, cols: rows[0]?.length || 0 };
}

/**
 * 인식한 줄을 원래 칸으로 되돌립니다.
 * lines: [{ text, y0, y1, conf }] (띠 그림 안의 세로 자리). 칸마다 text(줄바꿈으로 이은 글)와 lines([{ text, conf }])를 채웁니다.
 */
export function placeLines(cells, bands, lines) {
    for (const line of lines || []) {
        const text = String(line.text || '').replace(/\s+/g, ' ').trim();
        if (!text) continue;
        const mid = (Number(line.y0) + Number(line.y1)) / 2;
        const band = bands.find((item) => mid >= item.y0 && mid < item.y1);
        if (!band) continue;
        const cell = cells[band.r]?.[band.c];
        if (!cell) continue;
        cell.text = cell.text ? `${cell.text}\n${text}` : text;
        const conf = Number(line.conf);
        (cell.lines = cell.lines || []).push({ text, conf: Number.isFinite(conf) ? conf : 0 });
    }
    return cells;
}

/** 표 사진 한 장을 읽을 준비: 바로 세우고, 칸을 찾고, 띠 그림을 만듭니다. 칸을 못 찾으면 ok: false. */
export function prepareTable(rgba, width, height, opts = {}) {
    let gray = toGray(rgba, width, height);
    let grid = findGrid(gray, width, height);
    let angle = 0;
    if (grid.hMask) {
        angle = skewAngle(grid.hMask, width, height);
        if (angle) {
            gray = rotateGray(gray, width, height, angle);
            grid = findGrid(gray, width, height);
        }
    }
    if (!grid.ok) return { ok: false, gray, width, height, angle };
    const built = buildStrips(gray, width, height, grid, opts);
    const cells = Array.from({ length: built.rows }, () => Array.from({ length: built.cols }, () => ({ text: '' })));
    return { ok: true, gray, width, height, angle, grid, cells, strips: built.strips, scale: built.scale };
}
