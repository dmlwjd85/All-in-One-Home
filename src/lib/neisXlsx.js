/**
 * 나이스 모아 보기 「내려받기」용 엑셀 파일(.xlsx)을 만듭니다.
 * 바깥 라이브러리 없이 엑셀 파일 구조(OOXML)를 압축하지 않은 zip으로 묶습니다.
 * - 모든 칸은 글자 칸으로 써서, '='·'+'로 시작해도 수식으로 바뀌지 않습니다.
 * - 머리글 줄은 굵게, 내용 칸은 칸 안에서 줄이 바뀌고, 열 너비를 미리 맞춰 둡니다.
 */

export const NEIS_XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
export const NEIS_HEAD = ['번호', '이름', '날짜', '종류', '태그', '내용'];
const WIDTHS = [7, 12, 12, 9, 18, 70];

/** XML에 넣을 수 없는 제어 글자는 빼고, 특수 글자는 바꿔 적습니다. */
function xmlText(value) {
    return String(value ?? '')
        .replace(/\r\n?/g, '\n')
        .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function colName(index) {
    return String.fromCharCode(65 + index);
}

/** 학생별 기록 묶음을 머리글 + 행 목록(모두 글자)으로 바꿉니다. */
export function neisRows(groups, students) {
    const rows = [NEIS_HEAD];
    groups.forEach(([sid, list]) => {
        const student = students.find((item) => item.id === sid);
        const no = student?.no ?? '';
        const name = student?.name || '학생 미정';
        list.forEach((row) => {
            rows.push([
                no,
                name,
                row.date || '',
                row.kind || '',
                (row.tags || []).join(' · '),
                row.text || '',
            ].map((cell) => String(cell ?? '')));
        });
    });
    return rows;
}

function sheetXml(rows, strings) {
    const index = new Map();
    const sst = (text) => {
        if (!index.has(text)) {
            index.set(text, strings.length);
            strings.push(text);
        }
        return index.get(text);
    };
    const body = rows.map((cells, r) => {
        const style = r === 0 ? 1 : 2;
        const xml = cells.map((cell, c) => {
            const text = String(cell ?? '');
            if (!text) return `<c r="${colName(c)}${r + 1}" s="${style}"/>`;
            /* 번호 칸의 순수한 숫자만 숫자로 둡니다(정렬용). 나머지는 모두 글자 칸입니다. */
            if (r > 0 && c === 0 && /^\d{1,4}$/.test(text)) return `<c r="${colName(c)}${r + 1}" s="${style}"><v>${Number(text)}</v></c>`;
            return `<c r="${colName(c)}${r + 1}" s="${style}" t="s"><v>${sst(text)}</v></c>`;
        }).join('');
        return `<row r="${r + 1}">${xml}</row>`;
    }).join('');
    const cols = WIDTHS.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('');
    const last = `${colName(NEIS_HEAD.length - 1)}${Math.max(rows.length, 1)}`;
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>'
        + `<dimension ref="A1:${last}"/>`
        + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
        + '<sheetFormatPr defaultRowHeight="16.5"/>'
        + `<cols>${cols}</cols>`
        + `<sheetData>${body}</sheetData>`
        + `<autoFilter ref="A1:${last}"/>`
        + '<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>'
        /* 출력할 때 가로 A4 한 장 폭에 맞춰 내용 열이 다음 장으로 넘어가지 않게 합니다. */
        + '<pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/>'
        + '</worksheet>';
}

function sharedXml(strings) {
    const items = strings.map((text) => `<si><t xml:space="preserve">${xmlText(text)}</t></si>`).join('');
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${strings.length}" uniqueCount="${strings.length}">${items}</sst>`;
}

const STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<fonts count="2"><font><sz val="11"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font>'
    + '<font><b/><sz val="11"/><name val="맑은 고딕"/><family val="3"/><charset val="129"/></font></fonts>'
    + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
    + '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/><bgColor indexed="64"/></patternFill></fill></fills>'
    + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
    + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
    + '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
    + '<xf numFmtId="49" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>'
    + '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>'
    + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
    + '</styleSheet>';

function workbookXml() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        + '<sheets><sheet name="나이스 모아 보기" sheetId="1" r:id="rId1"/></sheets>'
        + '</workbook>';
}

const CONTENT_TYPES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
    + '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
    + '</Types>';

const ROOT_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>';

const BOOK_RELS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>'
    + '</Relationships>';

let crcTable = null;
function crc32(bytes) {
    if (!crcTable) {
        crcTable = new Uint32Array(256);
        for (let n = 0; n < 256; n += 1) {
            let c = n;
            for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            crcTable[n] = c >>> 0;
        }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
}

/** 압축하지 않은(STORE) zip으로 묶습니다. */
function zipStore(files) {
    const enc = new TextEncoder();
    const parts = [];
    const central = [];
    let offset = 0;
    /* 1980-01-01 00:00 (zip 날짜 최소값) */
    const dosTime = 0;
    const dosDate = (0 << 9) | (1 << 5) | 1;
    files.forEach(([name, text]) => {
        const nameBytes = enc.encode(name);
        const data = enc.encode(text);
        const crc = crc32(data);
        const local = new DataView(new ArrayBuffer(30));
        local.setUint32(0, 0x04034b50, true);
        local.setUint16(4, 20, true);
        local.setUint16(6, 0x0800, true);
        local.setUint16(8, 0, true);
        local.setUint16(10, dosTime, true);
        local.setUint16(12, dosDate, true);
        local.setUint32(14, crc, true);
        local.setUint32(18, data.length, true);
        local.setUint32(22, data.length, true);
        local.setUint16(26, nameBytes.length, true);
        local.setUint16(28, 0, true);
        parts.push(new Uint8Array(local.buffer), nameBytes, data);
        const head = new DataView(new ArrayBuffer(46));
        head.setUint32(0, 0x02014b50, true);
        head.setUint16(4, 20, true);
        head.setUint16(6, 20, true);
        head.setUint16(8, 0x0800, true);
        head.setUint16(10, 0, true);
        head.setUint16(12, dosTime, true);
        head.setUint16(14, dosDate, true);
        head.setUint32(16, crc, true);
        head.setUint32(20, data.length, true);
        head.setUint32(24, data.length, true);
        head.setUint16(28, nameBytes.length, true);
        head.setUint32(42, offset, true);
        central.push(new Uint8Array(head.buffer), nameBytes);
        offset += 30 + nameBytes.length + data.length;
    });
    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, centralSize, true);
    end.setUint32(16, offset, true);
    const all = [...parts, ...central, new Uint8Array(end.buffer)];
    const out = new Uint8Array(all.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    all.forEach((part) => { out.set(part, at); at += part.length; });
    return out;
}

/** 행 목록(첫 줄은 머리글)으로 .xlsx 바이트를 만듭니다. */
export function neisXlsxBytes(rows) {
    const strings = [];
    const sheet = sheetXml(rows, strings);
    return zipStore([
        ['[Content_Types].xml', CONTENT_TYPES],
        ['_rels/.rels', ROOT_RELS],
        ['xl/workbook.xml', workbookXml()],
        ['xl/_rels/workbook.xml.rels', BOOK_RELS],
        ['xl/styles.xml', STYLES],
        ['xl/sharedStrings.xml', sharedXml(strings)],
        ['xl/worksheets/sheet1.xml', sheet],
    ]);
}
