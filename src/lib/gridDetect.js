/**
 * 표 Screenshot의 가로·세로 선을 찾아 칸을 나눕니다.
 * 글자 인식 결과(낱말 상자)를 그 칸에 넣습니다. 선에 닿은 글자는 잘렸을 수 있다고 표시합니다.
 */

function dark(r, g, b) {
    return r + g + b < 420;
}

function lineCenters(flags, minRun) {
    const out = [];
    let start = -1;
    for (let i = 0; i <= flags.length; i += 1) {
        if (i < flags.length && flags[i]) {
            if (start < 0) start = i;
        } else if (start >= 0) {
            if (i - start >= minRun) out.push(Math.round((start + i - 1) / 2));
            start = -1;
        }
    }
    return out;
}

/**
 * pixels: RGBA. 가로·세로로 길게 어두운 줄을 표 선으로 봅니다.
 * @returns {{ xs: number[], ys: number[] }}
 */
export function detectGridLines(pixels, width, height, { ratio = 0.42 } = {}) {
    const ys = [];
    const rowFlags = [];
    for (let y = 0; y < height; y += 1) {
        let darks = 0;
        for (let x = 0; x < width; x += 1) {
            const i = (y * width + x) * 4;
            if (dark(pixels[i], pixels[i + 1], pixels[i + 2])) darks += 1;
        }
        rowFlags.push(darks / width >= ratio);
    }
    const colFlags = [];
    for (let x = 0; x < width; x += 1) {
        let darks = 0;
        for (let y = 0; y < height; y += 1) {
            const i = (y * width + x) * 4;
            if (dark(pixels[i], pixels[i + 1], pixels[i + 2])) darks += 1;
        }
        colFlags.push(darks / height >= ratio);
    }
    return { xs: lineCenters(colFlags, 1), ys: lineCenters(rowFlags, 1) };
}

function inside(word, x0, x1, y0, y1) {
    const cx = (word.x + word.x1) / 2;
    const cy = (word.y + word.y1) / 2;
    return cx >= x0 && cx < x1 && cy >= y0 && cy < y1;
}

/**
 * words: { text, x, y, x1, y1, conf }
 * 칸 가장자리에 걸친 낱말은 clipped.
 */
export function assignWords(words, xs, ys, { edge = 3 } = {}) {
    const cols = [];
    const rows = [];
    for (let i = 0; i < xs.length - 1; i += 1) if (xs[i + 1] - xs[i] > 8) cols.push([xs[i], xs[i + 1]]);
    for (let i = 0; i < ys.length - 1; i += 1) if (ys[i + 1] - ys[i] > 8) rows.push([ys[i], ys[i + 1]]);
    const cells = rows.map(() => cols.map(() => ({ text: '', clipped: false })));
    for (const word of words || []) {
        const label = String(word.text || '').trim();
        if (!label) continue;
        let placed = false;
        rows.forEach(([y0, y1], r) => {
            cols.forEach(([x0, x1], c) => {
                if (placed || !inside(word, x0, x1, y0, y1)) return;
                const cell = cells[r][c];
                cell.text = `${cell.text} ${label}`.trim();
                const clipped = word.x <= x0 + edge || word.x1 >= x1 - edge || word.y <= y0 + edge || word.y1 >= y1 - edge || Number(word.conf) < 45;
                if (clipped) cell.clipped = true;
                placed = true;
            });
        });
    }
    return cells;
}

/**
 * 선이 잘 안 보일 때, 낱말 상자만으로 같은 높이는 한 줄, 같은 가로는 한 칸으로 묶습니다.
 * 돌려주는 글은 탭으로 나뉜 표입니다.
 */
export function clusterTable(words) {
    const items = (words || []).map((word) => ({ ...word, text: String(word.text || '').trim() })).filter((word) => word.text);
    if (!items.length) return '';
    items.sort((a, b) => a.y - b.y || a.x - b.x);
    const rows = [];
    for (const word of items) {
        const cy = (Number(word.y) + Number(word.y1 || word.y)) / 2;
        const row = rows.find((item) => Math.abs(item.y - cy) < 16);
        if (row) {
            row.words.push(word);
            row.y = (row.y * (row.words.length - 1) + cy) / row.words.length;
        } else rows.push({ y: cy, words: [word] });
    }
    rows.sort((a, b) => a.y - b.y);
    const centers = items.map((word) => (Number(word.x) + Number(word.x1 || word.x)) / 2).sort((a, b) => a - b);
    const cols = [];
    for (const x of centers) {
        const col = cols.find((item) => Math.abs(item - x) < 36);
        if (col == null) cols.push(x);
    }
    cols.sort((a, b) => a - b);
    const nearest = (x) => cols.reduce((best, col, index) => (Math.abs(col - x) < Math.abs(cols[best] - x) ? index : best), 0);
    return rows.map((row) => {
        const cells = cols.map(() => []);
        for (const word of row.words.sort((a, b) => a.x - b.x)) {
            const cx = (Number(word.x) + Number(word.x1 || word.x)) / 2;
            cells[nearest(cx)].push(word.text);
        }
        return cells.map((cell) => cell.reduce((text, piece, index) => {
            if (!index) return piece;
            const prev = cell[index - 1];
            const glue = /^[가-힣]$/.test(prev) && /^[가-힣0-9.]$/.test(piece);
            return glue ? text + piece : `${text} ${piece}`;
        }, '')).join('\t');
    }).join('\n');
}

/** 칸 글을 탭 표로 되돌려 달력·급식 파서가 그대로 읽게 합니다. */
export function cellsToTable(cells) {
    return (cells || []).map((row) => row.map((cell) => {
        const text = String(cell.text || '').trim();
        if (!text) return '';
        return /[\t\n"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    }).join('\t')).join('\n');
}

export function clippedNotes(cells) {
    const notes = [];
    (cells || []).forEach((row, r) => row.forEach((cell, c) => {
        if (cell.clipped && String(cell.text || '').trim()) notes.push({ r, c, text: cell.text });
    }));
    return notes;
}
