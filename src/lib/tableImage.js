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

/**
 * 선 자리 후보: 양옆(가로선이면 위아래)보다 어두운 가는 골. 밝기 문턱이 아니라 이웃과의 차이를 보므로
 * 빛이 고르지 않은 사진의 연한 선도 잡고, 넓게 칠한 색 띠(날짜 줄 바탕)는 선으로 보지 않습니다.
 */
export function ridgeMask(gray, width, height, horizontal, { delta = 7, reach = [2, 4, 7] } = {}) {
    const out = new Uint8Array(width * height);
    const step = horizontal ? width : 1;
    const limit = horizontal ? height : width;
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const i = y * width + x;
            const pos = horizontal ? y : x;
            const v = gray[i];
            for (const d of reach) {
                if (pos - d < 0 || pos + d >= limit) continue;
                const a = gray[i - d * step];
                const b = gray[i + d * step];
                if (v + delta < a && v + delta < b) { out[i] = 1; break; }
            }
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
 * 선 하나를 따라갑니다. 사진 속 표 선은 종이가 휘거나 비스듬히 찍혀 곧은 직선이 아니므로,
 * 선이 달리는 쪽을 여러 토막으로 나눠 토막마다 선 자리를 찾고, 이어지는 자리끼리 묶어 2차 곡선으로 맞춥니다.
 * 돌려줌: [{ at(t) → 자리, t0, t1, thick, mid }] — horizontal 이면 t 는 x, 자리는 y.
 */
export function traceLines(mask, width, height, horizontal) {
    const along = horizontal ? width : height;
    const across = horizontal ? height : width;
    const n = Math.max(8, Math.min(80, Math.round(along / 32)));
    const len = along / n;
    const candidates = [];
    const counts = new Float64Array(across);
    for (let k = 0; k < n; k += 1) {
        const t0 = Math.floor(k * len);
        const t1 = Math.min(along, Math.floor((k + 1) * len));
        counts.fill(0);
        for (let t = t0; t < t1; t += 1) {
            for (let a = 0; a < across; a += 1) {
                if (mask[horizontal ? a * width + t : t * width + a]) counts[a] += 1;
            }
        }
        const min = (t1 - t0) * 0.6;
        let start = -1;
        for (let a = 0; a <= across; a += 1) {
            const on = a < across && counts[a] >= min;
            if (on && start < 0) start = a;
            else if (!on && start >= 0) {
                let sum = 0;
                let weight = 0;
                for (let i = start; i < a; i += 1) { sum += i * counts[i]; weight += counts[i]; }
                const prev = candidates[candidates.length - 1];
                const here = { k, t: (t0 + t1) / 2, pos: sum / weight, from: start, to: a - 1 };
                /* 바로 붙은 겹선은 하나로. */
                if (prev && prev.k === k && start - prev.to <= 3) {
                    prev.pos = (prev.pos + here.pos) / 2;
                    prev.to = a - 1;
                } else candidates.push(here);
                start = -1;
            }
        }
    }
    const tracks = [];
    const tol = Math.max(6, len * 0.08);
    for (const cand of candidates) {
        let best = null;
        let bestDist = tol;
        for (const track of tracks) {
            const last = track.points[track.points.length - 1];
            if (last.k >= cand.k || cand.k - last.k > 6) continue;
            const first = track.points[0];
            const slope = track.points.length > 1 ? (last.pos - first.pos) / (last.t - first.t) : 0;
            const guess = last.pos + slope * (cand.t - last.t);
            const dist = Math.abs(guess - cand.pos);
            if (dist < bestDist) { best = track; bestDist = dist; }
        }
        if (best) best.points.push(cand);
        else tracks.push({ points: [cand] });
    }
    const keep = 3;
    /* 진짜 선은 거의 모든 토막에서 보입니다. 띄엄띄엄 이어진 것(글자 획이 우연히 줄 선 것)은 버립니다. */
    return tracks
        .filter((track) => {
            const pts = track.points;
            if (pts.length < keep) return false;
            const slices = pts[pts.length - 1].k - pts[0].k + 1;
            return pts.length >= slices * 0.6;
        })
        .map((track) => fitTrack(track.points, len));
}

/** 점들에 2차 곡선(점이 적으면 직선)을 맞춥니다. 크게 벗어난 점은 한 번 빼고 다시 맞춥니다. */
function fitTrack(points, len) {
    const solve = (list) => {
        const m = list.length;
        const mt = list.reduce((s, p) => s + p.t, 0) / m;
        const deg = m >= 5 ? 2 : m >= 2 ? 1 : 0;
        if (deg === 0) { const c = list[0].pos; return () => c; }
        /* 정규 방정식(t 를 가운데로 옮겨 수치 안정). */
        const size = deg + 1;
        const A = Array.from({ length: size }, () => new Float64Array(size));
        const B = new Float64Array(size);
        for (const p of list) {
            const x = (p.t - mt) / 1000;
            const pow = [1, x, x * x];
            for (let i = 0; i < size; i += 1) {
                B[i] += pow[i] * p.pos;
                for (let j = 0; j < size; j += 1) A[i][j] += pow[i] * pow[j];
            }
        }
        for (let i = 0; i < size; i += 1) {
            let pivot = i;
            for (let r = i + 1; r < size; r += 1) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
            [A[i], A[pivot]] = [A[pivot], A[i]];
            [B[i], B[pivot]] = [B[pivot], B[i]];
            if (Math.abs(A[i][i]) < 1e-12) { const c = list.reduce((s, p) => s + p.pos, 0) / m; return () => c; }
            for (let r = 0; r < size; r += 1) {
                if (r === i) continue;
                const f = A[r][i] / A[i][i];
                for (let c = i; c < size; c += 1) A[r][c] -= f * A[i][c];
                B[r] -= f * B[i];
            }
        }
        const coef = Array.from({ length: size }, (_, i) => B[i] / A[i][i]);
        return (t) => {
            const x = (t - mt) / 1000;
            return coef[0] + (coef[1] || 0) * x + (coef[2] || 0) * x * x;
        };
    };
    let at = solve(points);
    const good = points.filter((p) => Math.abs(at(p.t) - p.pos) <= 4);
    if (good.length >= 2 && good.length < points.length) at = solve(good);
    const thick = points.reduce((s, p) => s + (p.to - p.from + 1), 0) / points.length;
    const t0 = points[0].t - len / 2;
    const t1 = points[points.length - 1].t + len / 2;
    return { at, t0, t1, thick, mid: at((t0 + t1) / 2), count: points.length };
}

/** 가로선 h 와 세로선 v 가 만나는 점. */
function cross(h, v) {
    let x = v.mid;
    let y = h.at(x);
    for (let i = 0; i < 4; i += 1) {
        x = v.at(y);
        y = h.at(x);
    }
    return { x, y };
}

/** 겹친 선(같은 선을 두 번 찾은 것)을 하나로 줄입니다. */
function dedupe(lines, near = 6) {
    const sorted = [...lines].sort((a, b) => a.mid - b.mid);
    const out = [];
    for (const line of sorted) {
        const prev = out[out.length - 1];
        const lo = Math.max(line.t0, prev?.t0 ?? 0);
        const hi = Math.min(line.t1, prev?.t1 ?? 0);
        const overlap = prev && hi > lo;
        const gap = overlap ? Math.abs(prev.at((lo + hi) / 2) - line.at((lo + hi) / 2)) : Math.abs((prev?.mid ?? -1e9) - line.mid);
        if (prev && gap <= near) {
            if (line.count > prev.count) out[out.length - 1] = { ...line, t0: Math.min(line.t0, prev.t0), t1: Math.max(line.t1, prev.t1) };
            else { prev.t0 = Math.min(line.t0, prev.t0); prev.t1 = Math.max(line.t1, prev.t1); }
        } else out.push({ ...line });
    }
    return out;
}

/**
 * 표 선과 칸을 찾습니다.
 * 돌려줌: { xs, ys, cells(칸 네 귀퉁이), lineMask, ink, hMask, ok } — xs·ys 는 선이 표 가운데를 지나는 자리.
 * 사진 아래위에 다른 표(원산지 표 등)가 함께 찍혔으면, 선이 가장 많이 엇갈리는 표 하나만 고릅니다.
 * 바깥 테두리가 없는 표는 가로 선의 양 끝을 세로 선으로 삼습니다.
 */
export function findGrid(gray, width, height) {
    const ink = inkMask(gray, width, height);
    const hLen = Math.max(24, Math.round(width * 0.06));
    const vLen = Math.max(24, Math.round(height * 0.02));
    /* 바로 세운 뒤의 표 선은 거의 곧습니다. 많이 비스듬한 것은 글자 획이 우연히 이어진 것입니다. */
    const thin = (line) => line.thick <= Math.max(6, height * 0.006) && Math.abs(line.at(line.t1) - line.at(line.t0)) <= (line.t1 - line.t0) * 0.04 + 3;
    const hMask = longRuns(ridgeMask(gray, width, height, true), width, height, hLen, true, 2);
    const vMask = longRuns(ridgeMask(gray, width, height, false), width, height, vLen, false, 3);
    /* 표 선은 표를 가로지르므로 길어야 합니다. 글자 획이 한 줄로 늘어선 것(가로 획이 나란한 한글)은 짧아서 빠집니다. */
    const hs = dedupe(traceLines(hMask, width, height, true)).filter((line) => line.t1 - line.t0 >= width * 0.3 && thin(line));
    const lineMask = new Uint8Array(width * height);
    const fail = { xs: [], ys: [], cells: [], lineMask, ink, hMask, ok: false };
    const vs = dedupe(traceLines(vMask, width, height, false)).filter((line) => line.t1 - line.t0 >= height * 0.12 && thin(line));
    if (hs.length < 2 || !vs.length) return fail;

    /* 서로 만나는 선끼리 묶어, 가장 큰 묶음을 표로 봅니다. */
    /*
     * 표 고르기. 사진에는 자석·종이 가장자리·아래 안내 표 같은 다른 선도 함께 찍힙니다.
     * 1. 위아래 끝이 서로 비슷한 세로선 무리(같은 표의 칸 선)를 찾고, 가장 큰 무리를 표로 봅니다.
     * 2. 그 높이 안의 가로선을 줄로, 그 높이를 대부분 덮는 세로선을 칸 선으로 씁니다.
     * 3. 세로선이 머리 줄(색 바탕)에서 흐려져 끊겨 보이면, 바로 위·아래 가로선까지 옅은 골이 이어질 때만 넓힙니다.
     */
    const overlap = (a, b) => Math.max(0, Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0));
    let family = [];
    let familyScore = 0;
    for (const seed of vs) {
        const span = seed.t1 - seed.t0;
        const members = vs.filter((v) => overlap(v, seed) >= 0.7 * Math.max(span, v.t1 - v.t0));
        const score = members.length >= 2 ? members.reduce((sum, v) => sum + (v.t1 - v.t0), 0) : 0;
        if (score > familyScore) { family = members; familyScore = score; }
    }
    if (family.length < 2) return fail;
    const median = (list) => { const sorted = [...list].sort((x, y) => x - y); return sorted[Math.floor(sorted.length / 2)]; };
    let top = median(family.map((v) => v.t0));
    let bottom = median(family.map((v) => v.t1));
    const left = Math.min(...family.map((v) => v.mid));
    const right = Math.max(...family.map((v) => v.mid));
    const across = (h) => Math.min(h.t1, right) - Math.max(h.t0, left) >= (right - left) * 0.6;
    const atX = (h) => h.at((left + right) / 2);
    const slack = 14;
    let rows = hs.filter((h) => across(h) && atX(h) >= top - slack && atX(h) <= bottom + slack);
    const faint = (v, from, to) => {
        let on = 0;
        let count = 0;
        for (let y = Math.max(0, Math.floor(from)); y <= Math.min(height - 1, Math.ceil(to)); y += 1) {
            const x = Math.round(v.at(y));
            if (x < 4 || x >= width - 4) continue;
            count += 1;
            let best = 255;
            for (let d = -1; d <= 1; d += 1) best = Math.min(best, gray[y * width + x + d]);
            if (best + 3 < gray[y * width + x - 3] && best + 3 < gray[y * width + x + 3]) on += 1;
        }
        return count > 0 && on >= count * 0.5;
    };
    const typical = (() => {
        const ys = rows.map(atX).sort((x, y) => x - y);
        const gaps = ys.slice(1).map((y, i) => y - ys[i]).filter((gap) => gap > slack);
        return gaps.length ? Math.min(...gaps) : height * 0.05;
    })();
    const outside = hs.filter((h) => across(h) && !rows.includes(h));
    for (const side of ['up', 'down']) {
        const edge = side === 'up' ? Math.min(...rows.map(atX), top) : Math.max(...rows.map(atX), bottom);
        const next = outside
            .filter((h) => (side === 'up' ? atX(h) < edge : atX(h) > edge) && Math.abs(atX(h) - edge) <= Math.max(typical * 1.5, 40))
            .sort((x, y) => Math.abs(atX(x) - edge) - Math.abs(atX(y) - edge))[0];
        if (!next) continue;
        const votes = family.filter((v) => (side === 'up' ? faint(v, atX(next), v.t0) : faint(v, v.t1, atX(next)))).length;
        if (votes >= family.length * 0.6) {
            rows.push(next);
            if (side === 'up') top = atX(next); else bottom = atX(next);
        }
    }
    rows = rows.sort((x, y) => atX(x) - atX(y));
    if (rows.length < 2) return fail;
    top = Math.min(top, atX(rows[0]));
    bottom = Math.max(bottom, atX(rows[rows.length - 1]));
    let cols = vs
        .filter((v) => family.includes(v) || overlap(v, { t0: top, t1: bottom }) >= (bottom - top) * 0.6)
        .filter((v) => rows.some((h) => v.mid >= h.t0 - slack && v.mid <= h.t1 + slack))
        .sort((x, y) => x.mid - y.mid);
    if (cols.length < 1) return fail;
    /*
     * 칸 안에서 '(' 같은 획이 세로로 줄지어 선처럼 보이는 경우가 있습니다. 안쪽 칸 하나가 다른 칸의 3분의 1도 안 되게
     * 좁아지면, 두 선 가운데 덜 뚜렷한 쪽을 버립니다(맨 바깥 선은 왼쪽 이름표 칸일 수 있어 그대로 둡니다).
     */
    for (let guard = 0; guard < 8 && cols.length >= 4; guard += 1) {
        const gaps = cols.slice(1).map((v, i) => v.mid - cols[i].mid);
        const typicalGap = [...gaps].sort((x, y) => x - y)[Math.floor(gaps.length / 2)];
        let worst = -1;
        for (let i = 1; i < gaps.length - 1; i += 1) if (gaps[i] < typicalGap * 0.35 && (worst < 0 || gaps[i] < gaps[worst])) worst = i;
        if (worst < 0) break;
        const a = cols[worst];
        const b = cols[worst + 1];
        const weaker = (family.includes(a) && !family.includes(b)) ? b : (family.includes(b) && !family.includes(a)) ? a : (a.count <= b.count ? a : b);
        cols = cols.filter((v) => v !== weaker);
    }

    /* 테두리 없는 표: 가로 선이 세로 선 밖으로 반 칸 넘게 나가 있으면 그 끝을 세로 경계로 더합니다. */
    const rowLeft = Math.min(...rows.map((line) => line.t0));
    const rowRight = Math.max(...rows.map((line) => line.t1));
    const cell = cols.length >= 2 ? (cols[cols.length - 1].mid - cols[0].mid) / (cols.length - 1) : width / 6;
    const straight = (x) => ({ at: () => x, t0: top, t1: bottom, thick: 0, mid: x, count: 0, virtual: true });
    if (cols[0].mid - rowLeft > cell * 0.5) cols = [straight(rowLeft), ...cols];
    if (rowRight - cols[cols.length - 1].mid > cell * 0.5) cols = [...cols, straight(rowRight)];
    if (cols.length < 2) return fail;

    /* 지울 선: 찾은 선 자리(두께 + 한 점 여유) 안의 긴 잉크만. 큰 글자의 긴 획은 건드리지 않습니다. */
    const mark = (line, horizontal, source) => {
        if (line.virtual) return;
        const reach = Math.ceil(line.thick / 2) + 1;
        const from = Math.max(0, Math.floor(line.t0));
        const to = Math.min(horizontal ? width : height, Math.ceil(line.t1));
        for (let t = from; t < to; t += 1) {
            const c = Math.round(line.at(t));
            for (let d = -reach; d <= reach; d += 1) {
                const a = c + d;
                if (horizontal ? (a < 0 || a >= height) : (a < 0 || a >= width)) continue;
                const i = horizontal ? a * width + t : t * width + a;
                if (source[i]) lineMask[i] = 1;
            }
        }
    };
    rows.forEach((line) => mark(line, true, hMask));
    cols.forEach((line) => mark(line, false, vMask));

    /* 칸: 위아래 가로선과 양옆 세로선이 만나는 네 점. */
    const cells = [];
    for (let r = 0; r < rows.length - 1; r += 1) {
        const line = [];
        for (let c = 0; c < cols.length - 1; c += 1) {
            const tl = cross(rows[r], cols[c]);
            const tr = cross(rows[r], cols[c + 1]);
            const bl = cross(rows[r + 1], cols[c]);
            const br = cross(rows[r + 1], cols[c + 1]);
            line.push({ r, c, tl, tr, bl, br,
                x0: Math.round(Math.min(tl.x, bl.x)), x1: Math.round(Math.max(tr.x, br.x)),
                y0: Math.round(Math.min(tl.y, tr.y)), y1: Math.round(Math.max(bl.y, br.y)) });
        }
        cells.push(line);
    }
    /* 겹선·두꺼운 테두리 사이의 아주 좁은 틈은 칸이 아닙니다. */
    const keepRow = cells.map((line) => line.some((item) => item.y1 - item.y0 >= 10));
    const keepCol = cols.slice(0, -1).map((_, c) => cells.some((line) => line[c].x1 - line[c].x0 >= 14));
    const grid = cells.filter((_, r) => keepRow[r]).map((line, r) => line.filter((_, c) => keepCol[c]).map((item, c) => ({ ...item, r, c })));
    const midX = width / 2;
    const midY = height / 2;
    return {
        xs: cols.map((line) => Math.round(line.at(midY))),
        ys: rows.map((line) => Math.round(line.at(midX))),
        cells: grid,
        lineMask,
        ink,
        hMask,
        ok: grid.length >= 1 && (grid[0]?.length || 0) >= 1 && (rows.length >= 2 && cols.length >= 2),
    };
}

/** 선 사이를 칸으로 나눕니다(곧은 표). 너무 좁은 틈(겹선)은 건너뜁니다. */
export function gridCells(xs, ys, { minW = 14, minH = 10 } = {}) {
    const colEdges = [];
    const rowEdges = [];
    for (let i = 0; i < xs.length - 1; i += 1) if (xs[i + 1] - xs[i] >= minW) colEdges.push([xs[i], xs[i + 1]]);
    for (let i = 0; i < ys.length - 1; i += 1) if (ys[i + 1] - ys[i] >= minH) rowEdges.push([ys[i], ys[i + 1]]);
    return rowEdges.map(([y0, y1], r) => colEdges.map(([x0, x1], c) => ({
        r, c, x0, y0, x1, y1,
        tl: { x: x0, y: y0 }, tr: { x: x1, y: y0 }, bl: { x: x0, y: y1 }, br: { x: x1, y: y1 },
    })));
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
    const rows = grid.cells?.length ? grid.cells : gridCells(grid.xs, grid.ys);
    const flat = (order || rows.flat());
    const glyph = glyphHeight(grid.ink, grid.lineMask, width, flat);
    const scale = glyph ? Math.min(maxScale, Math.max(1, target / glyph)) : 2;
    const inset = 2;
    const pieces = [];
    for (const cell of flat) {
        if (cellInk(grid.ink, grid.lineMask, width, cell, inset) < 6) continue;
        const tl = cell.tl || { x: cell.x0, y: cell.y0 };
        const tr = cell.tr || { x: cell.x1, y: cell.y0 };
        const bl = cell.bl || { x: cell.x0, y: cell.y1 };
        const br = cell.br || { x: cell.x1, y: cell.y1 };
        const fullW = (Math.hypot(tr.x - tl.x, tr.y - tl.y) + Math.hypot(br.x - bl.x, br.y - bl.y)) / 2;
        const fullH = (Math.hypot(bl.x - tl.x, bl.y - tl.y) + Math.hypot(br.x - tr.x, br.y - tr.y)) / 2;
        const w = Math.round(fullW) - inset * 2 + 1;
        const h = Math.round(fullH) - inset * 2 + 1;
        if (w < 6 || h < 6) continue;
        /* 칸 네 귀퉁이 사이를 고르게 떠 와 반듯한 네모로 폅니다(비스듬히 찍힌 사진). 선 자리는 흰색. */
        const flatCell = new Uint8Array(w * h);
        for (let y = 0; y < h; y += 1) {
            const v = (inset + y) / fullH;
            for (let x = 0; x < w; x += 1) {
                const u = (inset + x) / fullW;
                const sx = (1 - v) * ((1 - u) * tl.x + u * tr.x) + v * ((1 - u) * bl.x + u * br.x);
                const sy = (1 - v) * ((1 - u) * tl.y + u * tr.y) + v * ((1 - u) * bl.y + u * br.y);
                const x0 = Math.min(width - 2, Math.max(0, Math.floor(sx)));
                const y0 = Math.min(height - 2, Math.max(0, Math.floor(sy)));
                const fx = Math.min(1, Math.max(0, sx - x0));
                const fy = Math.min(1, Math.max(0, sy - y0));
                const i = y0 * width + x0;
                if (grid.lineMask[Math.round(sy) * width + Math.round(sx)]) { flatCell[y * w + x] = 255; continue; }
                flatCell[y * w + x] = Math.round(
                    gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy)
                    + gray[i + width] * (1 - fx) * fy + gray[i + width + 1] * fx * fy,
                );
            }
        }
        /* 칸 바탕 밝기: 밝은 쪽 30% 자리. 이 값을 흰색으로 삼아 색 바탕·그림자를 없앱니다. */
        const hist = new Uint32Array(256);
        for (let i = 0; i < flatCell.length; i += 1) hist[flatCell[i]] += 1;
        let seen = 0;
        let bg = 255;
        const want = w * h * 0.3;
        for (let value = 255; value >= 0; value -= 1) { seen += hist[value]; if (seen >= want) { bg = Math.max(60, value); break; } }
        const sw = Math.max(1, Math.round(w * scale));
        const sh = Math.max(1, Math.round(h * scale));
        const data = new Uint8Array(sw * sh);
        const src = (x, y) => Math.min(255, Math.round((flatCell[y * w + x] * 255) / bg));
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
    return { strips, scale, glyph, rows: rows.length, cols: rows[0]?.length || 0 };
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
    return { ok: true, gray, width, height, angle, grid, cells, strips: built.strips, scale: built.scale, glyph: built.glyph };
}
