/**
 * 한글(.hwp · .hwpx) 파일에서 글과 표를 읽습니다. 파일은 이 기기 안에서만 풉니다(어디에도 보내지 않습니다).
 * - 표는 엑셀에서 복사한 것처럼 '칸은 탭, 줄은 줄바꿈, 칸 안에 줄이 여럿이면 따옴표'로 돌려줍니다(급식표·달력 읽기가 그대로 씁니다).
 * - .hwp 는 한글 5.x 형식(복합 파일 + 압축된 본문)만 읽습니다. 암호가 걸린 파일·배포용 문서·한글 97 이전 파일은 읽지 못합니다.
 */

const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

/** 압축 풀기(zlib 머리 없는 deflate). 브라우저와 Node 22 에 있는 DecompressionStream 을 씁니다. */
export async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') throw new Error('unsupported');
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ───────── 복합 파일(OLE) ───────── */
const FREE = 0xFFFFFFFF;
const END = 0xFFFFFFFE;

/** 복합 파일의 스트림을 '경로 → 바이트'로. 경로는 'BodyText/Section0' 꼴입니다. */
export function readCompound(bytes) {
    const sig = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    if (bytes.length < 512 || sig.some((v, i) => bytes[i] !== v)) throw new Error('not-compound');
    const sectorSize = 1 << u16(bytes, 30);
    const miniSize = 1 << u16(bytes, 32);
    const dirStart = u32(bytes, 48);
    const miniCutoff = u32(bytes, 56);
    const miniFatStart = u32(bytes, 60);
    const difatStart = u32(bytes, 68);
    const sectorAt = (n) => (n + 1) * sectorSize;
    /* FAT 가 있는 자리 목록(머리에 109개, 넘치면 DIFAT 사슬) */
    const fatSectors = [];
    for (let i = 0; i < 109; i += 1) { const s = u32(bytes, 76 + i * 4); if (s < END) fatSectors.push(s); }
    let next = difatStart;
    let guard = 0;
    while (next < END && guard < 10000) {
        const at = sectorAt(next);
        for (let i = 0; i < sectorSize / 4 - 1; i += 1) { const s = u32(bytes, at + i * 4); if (s < END) fatSectors.push(s); }
        next = u32(bytes, at + sectorSize - 4);
        guard += 1;
    }
    const fat = [];
    for (const s of fatSectors) {
        const at = sectorAt(s);
        if (at + sectorSize > bytes.length) continue;
        for (let i = 0; i < sectorSize / 4; i += 1) fat.push(u32(bytes, at + i * 4));
    }
    const chain = (start, table) => {
        const out = [];
        let s = start;
        let n = 0;
        while (s < END && s !== FREE && n < 2000000) { out.push(s); s = table[s] ?? END; n += 1; }
        return out;
    };
    const readChain = (start, size = -1) => {
        const list = chain(start, fat);
        const out = new Uint8Array(list.length * sectorSize);
        list.forEach((s, i) => out.set(bytes.subarray(sectorAt(s), Math.min(bytes.length, sectorAt(s) + sectorSize)), i * sectorSize));
        return size >= 0 ? out.subarray(0, size) : out;
    };
    const dir = readChain(dirStart);
    const entries = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
        const nameLen = u16(dir, o + 64);
        const type = dir[o + 66];
        let name = '';
        for (let i = 0; i + 2 < nameLen && i < 64; i += 2) name += String.fromCharCode(u16(dir, o + i));
        entries.push({ name, type, left: u32(dir, o + 68), right: u32(dir, o + 72), child: u32(dir, o + 76), start: u32(dir, o + 116), size: u32(dir, o + 120) });
    }
    if (!entries.length) throw new Error('not-compound');
    const root = entries[0];
    const miniStream = readChain(root.start, root.size);
    const miniFat = [];
    { const raw = readChain(miniFatStart); for (let i = 0; i + 4 <= raw.length; i += 4) miniFat.push(u32(raw, i)); }
    const readMini = (start, size) => {
        const list = chain(start, miniFat);
        const out = new Uint8Array(list.length * miniSize);
        list.forEach((s, i) => out.set(miniStream.subarray(s * miniSize, s * miniSize + miniSize), i * miniSize));
        return out.subarray(0, size);
    };
    const files = new Map();
    const seen = new Set();
    const walk = (index, path) => {
        if (index >= entries.length || index === FREE || seen.has(index)) return;
        seen.add(index);
        const e = entries[index];
        walk(e.left, path);
        const full = path ? `${path}/${e.name}` : e.name;
        if (e.type === 2) files.set(full, e.size < miniCutoff ? readMini(e.start, e.size) : readChain(e.start, e.size));
        else if (e.type === 1) walk(e.child, full);
        walk(e.right, path);
    };
    walk(root.child, '');
    return files;
}

/* ───────── 표 → 글 ───────── */
function quoteCell(text) {
    const clean = String(text || '').replace(/\r/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{2,}/g, '\n').trim();
    return /[\t\n"]/.test(clean) ? `"${clean.replace(/"/g, '""')}"` : clean;
}
/** cells: [{ row, col, text }] → 탭으로 나눈 줄들. 합친 칸은 왼쪽 위 자리에만 글이 들어갑니다. */
export function tableToTsv(cells, rows = 0, cols = 0) {
    const maxRow = Math.max(rows, ...cells.map((c) => c.row + 1), 0);
    const maxCol = Math.max(cols, ...cells.map((c) => c.col + 1), 0);
    if (!maxRow || !maxCol || maxRow > 400 || maxCol > 60) return '';
    const grid = Array.from({ length: maxRow }, () => Array(maxCol).fill(''));
    for (const cell of cells) {
        if (cell.row < maxRow && cell.col < maxCol) grid[cell.row][cell.col] = grid[cell.row][cell.col] ? `${grid[cell.row][cell.col]}\n${cell.text}` : cell.text;
    }
    return grid.map((row) => row.map(quoteCell).join('\t')).join('\n');
}

/* ───────── .hwp (한글 5.x) ───────── */
const TAG_PARA_TEXT = 67;
const TAG_CTRL_HEADER = 71;
const TAG_LIST_HEADER = 72;
const TAG_TABLE = 77;
/* 문단 글 안의 조종 글자: 한 칸짜리(줄바꿈 등)와, 뒤에 정보가 붙어 여덟 칸을 차지하는 것. */
const CHAR_ONE = new Set([0, 10, 13, 24, 25, 26, 27, 28, 29, 30, 31]);

export function paraText(data) {
    let out = '';
    for (let i = 0; i + 1 < data.length; i += 2) {
        const code = u16(data, i);
        if (code >= 32) { out += String.fromCharCode(code); continue; }
        if (code === 10) out += '\n';
        else if (code === 9) out += ' ';
        if (!CHAR_ONE.has(code)) i += 14;
    }
    return out;
}

/** 본문 한 구역의 기록들을 글과 표로. */
export function sectionText(bytes) {
    const out = [];
    const tables = []; // 열려 있는 표(겹친 표는 안쪽 표의 글을 바깥 칸에 그대로 넣습니다)
    const close = (level) => {
        while (tables.length && tables[tables.length - 1].level > level) {
            const t = tables.pop();
            const tsv = tableToTsv(t.cells, t.rows, t.cols);
            if (!tsv) continue;
            const outer = tables[tables.length - 1];
            if (outer?.cell) outer.cell.text += `${outer.cell.text ? '\n' : ''}${t.cells.map((c) => c.text).filter(Boolean).join(' ')}`;
            else out.push(tsv);
        }
    };
    /* 'tbl ' 조종 머리의 깊이들. 표 기록은 그보다 한 단계 깊은 곳에 옵니다(사이에 캡션 문단이 낄 수 있습니다). */
    const pending = [];
    let o = 0;
    while (o + 4 <= bytes.length) {
        const head = u32(bytes, o);
        const tag = head & 0x3FF;
        const level = (head >>> 10) & 0x3FF;
        let size = head >>> 20;
        o += 4;
        if (size === 0xFFF) { size = u32(bytes, o); o += 4; }
        if (o + size > bytes.length) break;
        const data = bytes.subarray(o, o + size);
        o += size;
        /* 표가 열려 있을 때, 표 머리보다 얕은 기록이 나오면 그 표는 끝난 것입니다. */
        close(level);
        while (pending.length && pending[pending.length - 1] >= level && tag !== TAG_TABLE) pending.pop();
        if (tag === TAG_CTRL_HEADER) {
            if (size >= 4 && String.fromCharCode(data[3], data[2], data[1], data[0]) === 'tbl ') pending.push(level);
        } else if (tag === TAG_TABLE && pending.length && pending[pending.length - 1] === level - 1) {
            pending.pop();
            tables.push({ level, rows: size >= 6 ? u16(data, 4) : 0, cols: size >= 8 ? u16(data, 6) : 0, cells: [], cell: null });
        } else if (tag === TAG_LIST_HEADER && tables.length && tables[tables.length - 1].level === level) {
            const t = tables[tables.length - 1];
            t.cell = { col: size >= 10 ? u16(data, 8) : 0, row: size >= 12 ? u16(data, 10) : 0, text: '' };
            t.cells.push(t.cell);
        } else if (tag === TAG_PARA_TEXT) {
            const text = paraText(data).replace(/\s+$/, '');
            const t = tables[tables.length - 1];
            if (t?.cell && level > t.level) t.cell.text += `${t.cell.text ? '\n' : ''}${text}`;
            else if (text.trim()) out.push(text);
        }
    }
    close(-1);
    return out.join('\n');
}

export async function readHwp(bytes) {
    const files = readCompound(bytes);
    const header = files.get('FileHeader');
    if (!header || !String.fromCharCode(...header.subarray(0, 17)).startsWith('HWP Document File')) throw new Error('not-hwp');
    const flags = u32(header, 36);
    if (flags & 2) throw new Error('locked');
    const compressed = Boolean(flags & 1);
    const parts = [...files.keys()].filter((name) => /^BodyText\/Section\d+$/.test(name)).sort((a, b) => Number(a.match(/\d+$/)[0]) - Number(b.match(/\d+$/)[0]));
    if (!parts.length) throw new Error(flags & 4 ? 'locked' : 'empty');
    const texts = [];
    for (const name of parts) {
        const raw = files.get(name);
        texts.push(sectionText(compressed ? await inflateRaw(raw) : raw));
    }
    return texts.filter(Boolean).join('\n');
}

/* ───────── .hwpx (압축 묶음 안의 XML) ───────── */
/** ZIP 안의 파일을 '이름 → 바이트 읽는 함수'로. */
export function readZip(bytes) {
    let end = -1;
    for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i -= 1) {
        if (u32(bytes, i) === 0x06054B50) { end = i; break; }
    }
    if (end < 0) throw new Error('not-zip');
    const count = u16(bytes, end + 10);
    let o = u32(bytes, end + 16);
    const files = new Map();
    const decoder = new TextDecoder('utf-8');
    for (let n = 0; n < count && o + 46 <= bytes.length; n += 1) {
        if (u32(bytes, o) !== 0x02014B50) break;
        const method = u16(bytes, o + 10);
        const compSize = u32(bytes, o + 20);
        const nameLen = u16(bytes, o + 28);
        const extraLen = u16(bytes, o + 30);
        const commentLen = u16(bytes, o + 32);
        const local = u32(bytes, o + 42);
        const name = decoder.decode(bytes.subarray(o + 46, o + 46 + nameLen));
        files.set(name, async () => {
            const dataAt = local + 30 + u16(bytes, local + 26) + u16(bytes, local + 28);
            const data = bytes.subarray(dataAt, dataAt + compSize);
            if (method === 0) return data;
            if (method === 8) return inflateRaw(data);
            throw new Error('zip-method');
        });
        o += 46 + nameLen + extraLen + commentLen;
    }
    return files;
}

const XML_ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unescapeXml = (text) => text.replace(/&(amp|lt|gt|quot|apos);/g, (_, k) => XML_ENT[k]).replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));

/** hwpx 구역 XML 한 장을 글과 표로. 꼬리표 이름의 앞머리(hp: 등)는 보지 않습니다. */
export function hwpxSectionText(xml) {
    const out = [];
    const tables = [];
    let para = null; // 지금 문단의 글
    const flushPara = () => {
        if (para === null) return;
        const text = para.replace(/\s+$/, '');
        para = null;
        const t = tables[tables.length - 1];
        if (t?.cell) t.cell.text += `${t.cell.text ? '\n' : ''}${text}`;
        else if (text.trim()) out.push(text);
    };
    const re = /<(\/?)(?:[A-Za-z0-9]+:)?([A-Za-z]+)\b([^>]*?)(\/?)>|([^<]+)/g;
    let inText = false;
    let m = re.exec(xml);
    while (m) {
        if (m[5] !== undefined) {
            if (inText && para !== null) para += unescapeXml(m[5]);
        } else {
            const closing = m[1] === '/';
            const name = m[2];
            const attrs = m[3] || '';
            const selfClose = m[4] === '/';
            if (name === 'p') {
                if (!closing) { flushPara(); para = ''; if (selfClose) flushPara(); } else flushPara();
            } else if (name === 't') {
                inText = !closing && !selfClose;
            } else if (name === 'lineBreak' && para !== null) {
                para += '\n';
            } else if (name === 'tab' && para !== null && inText) {
                para += ' ';
            } else if (name === 'tbl') {
                if (!closing) {
                    /* 표는 문단 안에 들어 있습니다. 표 앞까지의 글은 그대로 두고 표를 엽니다. */
                    const keep = para;
                    para = null;
                    tables.push({ cells: [], cell: null, rows: Number((attrs.match(/rowCnt="(\d+)"/) || [])[1] || 0), cols: Number((attrs.match(/colCnt="(\d+)"/) || [])[1] || 0), keep });
                } else {
                    flushPara();
                    const t = tables.pop();
                    if (t) {
                        const tsv = tableToTsv(t.cells, t.rows, t.cols);
                        const outer = tables[tables.length - 1];
                        if (outer?.cell) outer.cell.text += `${outer.cell.text ? '\n' : ''}${t.cells.map((c) => c.text).filter(Boolean).join(' ')}`;
                        else if (tsv) out.push(tsv);
                        para = t.keep;
                    }
                }
            } else if (name === 'tc' && tables.length) {
                const t = tables[tables.length - 1];
                if (!closing) { flushPara(); t.cell = { row: t.cells.length ? -1 : 0, col: 0, text: '' }; t.cells.push(t.cell); } else { flushPara(); t.cell = null; }
            } else if (name === 'cellAddr' && tables.length && tables[tables.length - 1].cell) {
                const cell = tables[tables.length - 1].cell;
                cell.col = Number((attrs.match(/colAddr="(\d+)"/) || [])[1] || 0);
                cell.row = Number((attrs.match(/rowAddr="(\d+)"/) || [])[1] || 0);
            }
        }
        m = re.exec(xml);
    }
    flushPara();
    return out.join('\n');
}

export async function readHwpx(bytes) {
    const files = readZip(bytes);
    const names = [...files.keys()].filter((name) => /^Contents\/section\d+\.xml$/i.test(name)).sort((a, b) => Number(a.match(/\d+/)[0]) - Number(b.match(/\d+/)[0]));
    if (!names.length) throw new Error('empty');
    const decoder = new TextDecoder('utf-8');
    const texts = [];
    for (const name of names) texts.push(hwpxSectionText(decoder.decode(await files.get(name)())));
    return texts.filter(Boolean).join('\n');
}

/** 파일 종류: 'hwp' · 'hwpx' · 'pdf' · 'image' · ''(모름). 이름보다 파일 머리를 먼저 봅니다. */
export function fileKind(name, head) {
    const b = head || new Uint8Array(0);
    if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return 'pdf';
    if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return 'hwp';
    const ext = String(name || '').toLowerCase().split('.').pop();
    if (b[0] === 0x50 && b[1] === 0x4B) return ext === 'hwpx' || !['xlsx', 'docx', 'pptx', 'zip'].includes(ext) ? 'hwpx' : '';
    if ((b[0] === 0xFF && b[1] === 0xD8) || (b[0] === 0x89 && b[1] === 0x50) || /^(jpe?g|png|webp|gif|bmp|heic|heif)$/.test(ext)) return 'image';
    if (ext === 'hwp' || ext === 'hwpx' || ext === 'pdf') return ext;
    return '';
}

/* ───────── PDF 글 조각 → 표 ───────── */
/**
 * PDF 한 쪽의 글 조각 [{ str, x, y, w, h }] (y 는 위에서 아래로 커지는 값)을 줄과 칸으로 나눕니다.
 * - 줄: 세로 위치가 비슷한 조각끼리.
 * - 칸: 쪽 전체에서 글이 한 번도 지나가지 않는 세로 빈 띠로 나눕니다(표의 칸 사이가 그렇습니다).
 */
export function pdfItemsToTsv(items) {
    const list = (items || []).filter((it) => String(it.str || '').trim());
    if (!list.length) return '';
    const heights = list.map((it) => it.h || 10).sort((a, b) => a - b);
    const h = heights[Math.floor(heights.length / 2)] || 10;
    /* 줄 나누기 */
    const sorted = [...list].sort((a, b) => a.y - b.y || a.x - b.x);
    const lines = [];
    for (const it of sorted) {
        const line = lines[lines.length - 1];
        if (line && Math.abs(it.y - line.y) <= h * 0.55) { line.items.push(it); line.y = (line.y * (line.items.length - 1) + it.y) / line.items.length; } else lines.push({ y: it.y, items: [it] });
    }
    /* 줄마다 붙어 있는 글 덩어리로 묶습니다. 덩어리가 둘 이상인 줄만 표의 줄로 보고(제목처럼 길게 한 덩어리인 줄은 빼고) 칸 경계를 찾습니다. */
    const runsOf = (line) => {
        const runs = [];
        for (const it of [...line.items].sort((a, b) => a.x - b.x)) {
            const last = runs[runs.length - 1];
            if (last && it.x <= last.b + h * 0.9) { last.b = Math.max(last.b, it.x + Math.max(it.w || 0, 1)); last.items.push(it); } else runs.push({ a: it.x, b: it.x + Math.max(it.w || 0, 1), items: [it] });
        }
        return runs;
    };
    const lineRuns = lines.map(runsOf);
    const tableLines = lineRuns.filter((runs) => runs.length >= 2);
    /* 칸 나누기: 표의 줄에서 글이 덮은 가로 구간을 모으고, 그 사이 빈 띠가 칸 경계 */
    const spans = tableLines.flat().map((run) => [run.a, run.b]).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const [a, b] of spans) {
        const last = merged[merged.length - 1];
        if (last && a <= last[1] + h * 0.5) last[1] = Math.max(last[1], b); else merged.push([a, b]);
    }
    const colOf = (x) => { for (let i = merged.length - 1; i >= 0; i -= 1) if (x >= merged[i][0] - 0.5) return i; return 0; };
    const table = merged.length >= 2 && tableLines.length >= 2;
    return lines.map((line, index) => {
        const parts = [...line.items].sort((a, b) => a.x - b.x);
        /* 한 덩어리인 줄이 여러 칸에 걸쳐 있으면 제목·설명이라 그대로 한 줄로 둡니다. */
        const runs = lineRuns[index];
        const wide = runs.length === 1 && (merged.length >= 3 || merged.filter(([a, b]) => runs[0].a < b && runs[0].b > a).length >= 2);
        if (!table || wide) return joinRun(parts, h);
        const cells = Array(merged.length).fill(null).map(() => []);
        for (const it of parts) cells[colOf(it.x + Math.min((it.w || 0) / 2, h))].push(it);
        return cells.map((cell) => quoteCell(joinRun(cell, h))).join('\t');
    }).join('\n');
}
function joinRun(parts, h) {
    let out = '';
    let end = null;
    for (const it of parts) {
        if (end !== null && it.x - end > h * 0.25 && !/\s$/.test(out) && !/^\s/.test(it.str)) out += ' ';
        out += it.str;
        end = it.x + (it.w || 0);
    }
    return out.replace(/\s+/g, ' ').trim();
}

/** pdf.js 의 글 조각(getTextContent)을 pdfItemsToTsv 가 쓰는 모양으로. pageHeight 는 쪽 높이(위에서 아래로 세기 위해). */
export function pdfPageItems(content, pageHeight) {
    return (content?.items || []).filter((it) => typeof it.str === 'string').map((it) => {
        const t = it.transform || [1, 0, 0, 1, 0, 0];
        const h = Math.abs(t[3]) || Math.abs(it.height) || 10;
        return { str: it.str, x: t[4], y: pageHeight - t[5], w: Math.abs(it.width) || 0, h };
    });
}
