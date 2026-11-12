/**
 * 출결·기록 엑셀(.xlsx) 내려받기 표를 확인합니다(바깥 패키지 없이 node 로 돕니다).
 * 1) 만든 파일을 직접 풀어 zip·CRC·시트 목록·칸 값을 봅니다. 수식 칸(<f>)이 없고 '=' 시작 글도 글자 칸인지.
 * 2) 출결: 학생×날짜 표, 학생별 결석·지각·조퇴·결과 합계(사유별), 서류 받음·아직, 지난 명단 학생은 표시가 있을 때만.
 * 3) 기록: 반 전체(번호·날짜순, 학생별 건수)와 학생 한 명, 나이스 옮김 표시, 이 기기에만 둔 기록 수.
 * 4) 나이스 모아 보기 파일은 예전과 같은 모양(시트 하나, 이름 '나이스 모아 보기')인지.
 */
import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { attendSheets, dayLabel, recordSheets, sheetBytes } from '../src/lib/classXlsx.js';
import { neisRows, neisXlsxBytes } from '../src/lib/neisXlsx.js';
import { schoolDays } from '../src/lib/semester.js';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

function crc32(bytes) {
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i += 1) {
        crc ^= bytes[i];
        for (let k = 0; k < 8; k += 1) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function unzip(buf) {
    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    let end = -1;
    for (let i = buf.length - 22; i >= 0; i -= 1) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
    if (end < 0) throw new Error('zip 끝 표시가 없어요');
    const count = view.getUint16(end + 10, true);
    let at = view.getUint32(end + 16, true);
    const files = new Map();
    for (let n = 0; n < count; n += 1) {
        if (view.getUint32(at, true) !== 0x02014b50) throw new Error('zip 목차가 깨졌어요');
        const method = view.getUint16(at + 10, true);
        const crc = view.getUint32(at + 16, true);
        const size = view.getUint32(at + 20, true);
        const nameLen = view.getUint16(at + 28, true);
        const extraLen = view.getUint16(at + 30, true);
        const commentLen = view.getUint16(at + 32, true);
        const local = view.getUint32(at + 42, true);
        const name = new TextDecoder().decode(buf.subarray(at + 46, at + 46 + nameLen));
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const raw = buf.subarray(start, start + size);
        const data = method === 0 ? raw : inflateRawSync(raw);
        if (crc32(data) !== crc) throw new Error(`${name}: CRC가 맞지 않아요`);
        files.set(name, new TextDecoder('utf-8', { fatal: true }).decode(data));
        at += 46 + nameLen + extraLen + commentLen;
    }
    return files;
}

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

function colIndex(letters) {
    let n = 0;
    for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
}

/** 풀어서 시트 이름과 행(칸 값·종류) 목록을 돌려줍니다. */
function readBook(bytes) {
    const files = unzip(Buffer.from(bytes));
    const shared = [...(files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
        .map((m) => [...m[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => unxml(t[1])).join(''));
    const names = [...files.get('xl/workbook.xml').matchAll(/<sheet name="([^"]*)" sheetId="(\d+)" r:id="(rId\d+)"\/>/g)].map((m) => unxml(m[1]));
    const types = files.get('[Content_Types].xml');
    const rels = files.get('xl/_rels/workbook.xml.rels');
    const sheets = names.map((name, i) => {
        const path = `xl/worksheets/sheet${i + 1}.xml`;
        const xml = files.get(path);
        if (!xml) throw new Error(`${path}이 없어요`);
        if (!types.includes(`/xl/worksheets/sheet${i + 1}.xml`)) throw new Error(`${path}이 목록([Content_Types])에 없어요`);
        if (!rels.includes(`Target="worksheets/sheet${i + 1}.xml"`)) throw new Error(`${path}이 연결(rels)에 없어요`);
        const rows = [];
        for (const m of xml.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
            const r = Number(m[2]) - 1;
            const c = colIndex(m[1]);
            const type = /t="(\w+)"/.exec(m[3])?.[1] || 'n';
            const v = /<v>([\s\S]*?)<\/v>/.exec(m[4] || '')?.[1];
            const value = v === undefined ? '' : type === 's' ? shared[Number(v)] : Number(v);
            (rows[r] ||= [])[c] = { value, type, formula: /<f[\s>]/.test(m[4] || '') };
        }
        return { name, xml, rows: rows.map((row) => Array.from(row || [], (cell) => cell || { value: '', type: '' })) };
    });
    return { files, names, sheets };
}

const val = (sheet, r, c) => sheet.rows[r]?.[c]?.value ?? '';

/* ---------- 출결 ---------- */
const students = [
    { id: 's1', no: 1, name: '김가나', active: true },
    { id: 's2', no: 2, name: '이다라', active: true },
    { id: 's51', no: 51, name: '박마바', active: true },
    { id: 'old3', no: 3, name: '작년아이', active: false },
    { id: 'old4', no: 4, name: '전출아이', active: false },
];
const attendance = [
    { id: 'a1', date: '2026-11-02', sid: 's1', status: '결석', reason: '질병', paper: true, note: '' },
    { id: 'a2', date: '2026-11-03', sid: 's1', status: '지각', reason: '', paper: false, note: '=HYPERLINK("x")' },
    { id: 'a3', date: '2026-11-03', sid: 's51', status: '조퇴', reason: '출석인정', paper: false, period: 4, note: '보건실 다녀옴' },
    { id: 'a4', date: '2026-11-07', sid: 's2', status: '결과', reason: '미인정', paper: false, note: '' },
    { id: 'a5', date: '2026-11-04', sid: 'old4', status: '결석', reason: '기타', paper: true, note: '' },
    { id: 'a6', date: '2026-10-30', sid: 's2', status: '결석', reason: '질병', paper: true, note: '' },
];
const days = schoolDays('2026-11-01', '2026-11-30', []);
check(days.length === 21 && !days.includes('2026-11-07'), `11월 수업일: ${days.length}`);
const att = attendSheets({ students, attendance, from: '2026-11-01', to: '2026-11-30', days });
check(att.count === 5, `11월 출결 표시 수: ${att.count}`);
check(att.localCount === 1, `이 기기에만 둔 출결 메모 수: ${att.localCount}`);
{
    /* 이 기기 전용 메모를 빼면 '출결 목록' 메모 칸이 비고, 평범한 메모는 그대로입니다. */
    const hidden = attendSheets({ students, attendance, from: '2026-11-01', to: '2026-11-30', days, includeLocal: false });
    const listRows = hidden.sheets.find((s) => s.name === '출결 목록').rows;
    check(!listRows.some((r) => r.includes('보건실 다녀옴')) && listRows.some((r) => r.includes('=HYPERLINK("x")')), `민감 메모 빼기: ${JSON.stringify(listRows.map((r) => r.at(-1)))}`);
    check(att.sheets.find((s) => s.name === '출결 목록').rows.some((r) => r.includes('보건실 다녀옴')), '민감 메모 넣기를 골라도 빠졌습니다.');
    const ui = readFileSync('src/ui/ClassExport.jsx', 'utf8');
    check((ui.match(/const \[withLocal, setWithLocal\] = useState\(false\)/g) || []).length === 2 && ui.includes('includeLocal: withLocal })'), '엑셀 화면의 이 기기 전용 자료 기본값이 \'뺌\'이 아니거나 출결 엑셀이 선택을 따르지 않습니다.');
}
check(att.days === 22, `날짜 열 수(수업일 21 + 토요일 표시 1): ${att.days}`);
{
    const book = readBook(sheetBytes(att.sheets));
    check(book.names.join() === '출결표,학생별 합계,출결 목록', `출결 시트: ${book.names}`);
    const [grid, sum, list] = book.sheets;
    check(!book.sheets.some((s) => /<f[\s>]/.test(s.xml)), '출결 파일에 수식 칸이 있습니다.');
    check(/xSplit="2" ySplit="1" topLeftCell="C2"/.test(grid.xml), '출결표의 번호·이름 열이 고정되지 않았습니다.');
    const head = grid.rows[0].map((c) => c.value);
    check(head[0] === '번호' && head[1] === '이름' && head[2] === dayLabel('2026-11-02') && head[2] === '11/2(월)', `출결표 머리글: ${head.slice(0, 4)}`);
    check(head.length === 2 + 22 + 6 && head.includes('11/7(토)'), `출결표 열 수: ${head.length}`);
    /* 학생 행: 지금 반 3명 + 표시가 있는 지난 명단 1명(작년아이는 빠짐) */
    const names = grid.rows.slice(1).map((r) => r[1].value);
    check(names.join() === '김가나,이다라,전출아이 (지난 명단),박마바', `출결표 학생: ${names}`);
    check(grid.rows[1][0].type === 'n' && grid.rows[4][0].value === 51, '번호가 숫자 칸이 아니거나 51번이 없습니다.');
    const col = (ymd) => head.indexOf(dayLabel(ymd));
    check(val(grid, 1, col('2026-11-02')) === '질병결석' && val(grid, 1, col('2026-11-03')) === '지각', `김가나 칸: ${val(grid, 1, col('2026-11-02'))} ${val(grid, 1, col('2026-11-03'))}`);
    check(val(grid, 4, col('2026-11-03')) === '출석인정조퇴', '51번 조퇴 칸이 다릅니다.');
    check(val(grid, 2, col('2026-11-07')) === '미인정결과', '토요일 표시가 빠졌습니다.');
    const t = head.indexOf('결석');
    check(val(grid, 1, t) === 1 && val(grid, 1, t + 1) === 1 && val(grid, 1, t + 4) === 1 && val(grid, 1, t + 5) === 1, `김가나 합계: ${grid.rows[1].slice(t).map((c) => c.value)}`);
    check(grid.rows[1][t].type === 'n', '합계가 숫자 칸이 아닙니다.');
    check(val(grid, 2, t) === 0, '10월 결석이 11월 합계에 들어갔습니다.');
    /* 학생별 합계: 사유별 */
    const sh = sum.rows[0].map((c) => c.value);
    check(sh.includes('결석(질병)') && sh.includes('결과(미인정)') && sh.includes('서류 아직'), `합계 머리글: ${sh}`);
    check(val(sum, 1, sh.indexOf('결석(질병)')) === 1 && val(sum, 4, sh.indexOf('조퇴(출석인정)')) === 1 && val(sum, 3, sh.indexOf('결석(기타)')) === 1, '사유별 합계가 다릅니다.');
    /* 목록: 날짜순, 서류·메모, '=' 시작 메모도 글자 칸 */
    check(list.rows.length === 6 && val(list, 1, 0) === '2026-11-02' && val(list, 5, 0) === '2026-11-07', `출결 목록 순서: ${list.rows.map((r) => r[0]?.value)}`);
    const hyper = list.rows.find((r) => String(r[8]?.value).startsWith('='));
    check(hyper && hyper[8].type === 's' && !hyper[8].formula, "'=' 시작 메모가 글자 칸이 아닙니다.");
    check(list.rows.some((r) => r[7]?.value === '받음') && list.rows.some((r) => r[6]?.value === '4교시'), '서류·교시 칸이 없습니다.');
}
{
    /* 학기: 날짜 열이 26개를 넘어도(AA, AB ...) 열 이름이 맞는지 */
    const term = schoolDays('2026-08-17', '2027-02-12', []);
    const big = attendSheets({ students, attendance, from: '2026-08-17', to: '2027-02-12', days: term });
    const book = readBook(sheetBytes(big.sheets));
    const head = book.sheets[0].rows[0];
    check(head.length === 2 + big.days + 6 && big.days > 100, `학기 열 수: ${head.length} (${big.days}일)`);
    check(head.every((c) => c.value !== ''), '학기 출결표 머리글 사이에 빈 칸이 있습니다(열 이름 계산 오류).');
    check(book.sheets[0].rows[1].length === head.length, '학기 출결표 행 길이가 머리글과 다릅니다.');
    check(/<dimension ref="A1:[A-Z]{2}\d+"\/>/.test(book.sheets[0].xml), '학기 출결표 범위가 두 글자 열로 끝나지 않습니다.');
    check(big.count === 6, `학기 출결 표시 수: ${big.count}`);
}

/* ---------- 기록 ---------- */
const records = [
    { id: 'r1', date: '2026-11-03', sid: 's2', kind: '관찰', tags: ['학습'], text: '발표를 끝까지 했어요', neis: true, localOnly: false },
    { id: 'r2', date: '2026-11-01', sid: 's2', kind: '상담', tags: ['교우'], text: '+친구 관계 상담\n둘째 줄', neis: false, follow: '2026-11-20', localOnly: false },
    { id: 'r3', date: '2026-11-02', sid: 's1', kind: '보호자', tags: ['전화'], text: '알레르기 약 챙기기', localOnly: true },
    { id: 'r4', date: '2026-11-05', sid: 's1', kind: '칭찬', tags: [], text: '=1+1', neis: true, neisMoved: true, localOnly: false },
    { id: 'r5', date: '2026-03-05', sid: 'old3', kind: '관찰', tags: [], text: '작년 기록', neis: true, localOnly: false },
    { id: 'r6', date: '2026-11-06', sid: '', kind: '관찰', tags: [], text: '학생 없이', localOnly: false },
];
{
    const all = recordSheets({ students, records });
    check(all.count === 6 && all.localCount === 1, `기록 수: ${all.count} / 이 기기에만 ${all.localCount}`);
    const book = readBook(sheetBytes(all.sheets));
    check(book.names.join() === '기록,학생별 건수', `기록 시트: ${book.names}`);
    const [rec, counts] = book.sheets;
    check(rec.rows[0].map((c) => c.value).join() === '날짜,번호,이름,종류,태그,내용,나이스,다시 볼 날,저장한 곳', '기록 머리글이 다릅니다.');
    const order = rec.rows.slice(1).map((r) => `${r[1].value}:${r[0].value}`);
    check(order.join() === '1:2026-11-02,1:2026-11-05,2:2026-11-01,2:2026-11-03,3:2026-03-05,:2026-11-06', `기록 순서: ${order}`);
    check(rec.rows[1][8].value === '이 기기에만' && rec.rows[1][5].value === '알레르기 약 챙기기', '이 기기에만 둔 기록 표시가 없습니다.');
    check(rec.rows[2][6].value === '옮김' && rec.rows[4][6].value === '옮길 것' && rec.rows[3][6].value === '', '나이스 옮김 표시가 다릅니다.');
    check(rec.rows[2][5].type === 's' && rec.rows[2][5].value === '=1+1' && !rec.rows[2][5].formula, "'=' 시작 기록이 글자 칸이 아닙니다.");
    check(rec.rows[3][5].value === '+친구 관계 상담\n둘째 줄' && rec.rows[3][7].value === '2026-11-20', '두 줄 기록·다시 볼 날이 다릅니다.');
    check(rec.rows[5][2].value === '작년아이 (지난 명단)' && rec.rows[6][2].value === '학생 미정', '지난 명단·학생 미정 이름이 다릅니다.');
    check(rec.rows[1][1].type === 'n', '기록의 번호가 숫자 칸이 아닙니다.');
    const ch = counts.rows[0].map((c) => c.value);
    check(ch.join() === '번호,이름,관찰,상담,보호자,칭찬,계,나이스 옮길 것', `건수 머리글: ${ch}`);
    const s2 = counts.rows.find((r) => r[1].value === '이다라');
    check(s2 && s2[2].value === 1 && s2[3].value === 1 && s2[6].value === 2 && s2[7].value === 1, `이다라 건수: ${s2?.map((c) => c.value)}`);
    const noLocal = recordSheets({ students, records, includeLocal: false });
    check(noLocal.count === 5 && noLocal.localCount === 0, '이 기기에만 둔 기록 빼기가 되지 않습니다.');
}
{
    const one = recordSheets({ students, records, sid: 's2' });
    check(one.count === 2 && one.sheets.length === 1 && one.localCount === 0, `한 명 기록: ${one.count}`);
    const book = readBook(sheetBytes(one.sheets));
    check(book.names[0] === '2번 이다라 기록', `한 명 시트 이름: ${book.names[0]}`);
    check(book.sheets[0].rows.slice(1).map((r) => r[0].value).join() === '2026-11-01,2026-11-03', '한 명 기록이 날짜순이 아닙니다.');
}
{
    /* 시트 이름에 엑셀이 받지 않는 글자, 31자 넘는 이름, 겹치는 이름 */
    const book = readBook(sheetBytes([{ name: 'a/b:c*d?[e]', rows: [['x']] }, { name: 'a b c d e', rows: [['y']] }, { name: '가'.repeat(40), rows: [['z']] }]));
    check(book.names[0] === 'a b c d  e' || !/[[\]:*?/\\]/.test(book.names[0]), `시트 이름 정리: ${book.names[0]}`);
    check(new Set(book.names.map((n) => n.toLowerCase())).size === 3 && book.names.every((n) => n.length <= 31), `시트 이름 겹침·길이: ${book.names}`);
}

/* ---------- 나이스 모아 보기는 예전 모양 그대로 ---------- */
{
    const groups = [['s1', [{ date: '2026-11-01', kind: '관찰', tags: ['학습'], text: '=1+1' }]]];
    const book = readBook(neisXlsxBytes(neisRows(groups, students)));
    check(book.names.join() === '나이스 모아 보기' && book.sheets.length === 1, `나이스 시트: ${book.names}`);
    check(/<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/.test(book.sheets[0].xml), '나이스 시트 고정 줄이 바뀌었습니다.');
    check(book.sheets[0].rows[1][5].value === '=1+1' && book.sheets[0].rows[1][5].type === 's', '나이스 내용 칸이 글자 칸이 아닙니다.');
}

if (failures.length) {
    console.error(`출결·기록 엑셀 검사 실패 ${failures.length}개`);
    failures.forEach((f) => console.error(`- ${f}`));
    process.exit(1);
}
console.log('출결·기록 엑셀 검사 통과');
