/* 한글(hwp·hwpx)·PDF 파일 읽기: 기록 풀기, 표를 탭 글로, PDF 글 조각을 줄·칸으로, 급식표로 읽히는지 봅니다. */
import { readFileSync } from 'node:fs';
import { deflateRawSync } from 'node:zlib';
import { fileKind, hwpxSectionText, inflateRaw, paraText, pdfItemsToTsv, readZip, sectionText, tableToTsv } from '../src/lib/docFile.js';
import { parseMealTable } from '../src/lib/mealPaste.js';

const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

/* ── hwp 본문 기록을 손으로 만들어 봅니다 ── */
const utf16 = (text) => { const out = []; for (const ch of text) { const c = ch.charCodeAt(0); out.push(c & 255, c >> 8); } return out; };
const rec = (tag, level, data) => {
    const size = data.length;
    const head = (tag | (level << 10) | ((size >= 0xFFF ? 0xFFF : size) << 20)) >>> 0;
    const out = [head & 255, (head >>> 8) & 255, (head >>> 16) & 255, (head >>> 24) & 255];
    if (size >= 0xFFF) out.push(size & 255, (size >>> 8) & 255, (size >>> 16) & 255, (size >>> 24) & 255);
    return [...out, ...data];
};
const para = (level, text) => [...rec(66, level, new Array(24).fill(0)), ...rec(67, level + 1, [...utf16(text), 13, 0])];
const cell = (level, col, row, lines) => [...rec(72, level, [lines.length, 0, 0, 0, 0x20, 0, 0, 0, col, 0, row, 0, 1, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]), ...lines.flatMap((line) => para(level, line))];
const ctrl = (level, id) => rec(71, level, [...[...id].reverse().map((c) => c.charCodeAt(0)), ...new Array(12).fill(0)]);
const days = ['11월 16일(월)', '11월 17일(화)'];
const menus = [['기장밥', '미역국 (5.6.16)', '제육볶음 (5.6.10)'], ['카레라이스 (2.5.6.10)', '유부장국 (5.6)', '깍두기 (9)']];
const body = [
    ...para(0, '11월 학교급식 식단표'),
    ...rec(66, 0, new Array(24).fill(0)),
    ...rec(67, 1, [11, 0, ...new Array(12).fill(0), 11, 0, 13, 0]), // 표가 든 문단(조종 글자 하나가 여덟 칸)
    ...ctrl(1, 'tbl '),
    ...cell(2, 0, 0, ['표 설명']), // 캡션: 표 기록보다 앞
    ...rec(77, 2, [0, 0, 0, 0, 2, 0, 3, 0, 0, 0, 0, 0]),
    ...cell(2, 0, 0, ['구분']), ...cell(2, 1, 0, [days[0]]), ...cell(2, 2, 0, [days[1]]),
    ...cell(2, 0, 1, ['중식']), ...cell(2, 1, 1, menus[0]), ...cell(2, 2, 1, menus[1]),
    ...para(0, '끝 문단'),
];
const hwpText = sectionText(new Uint8Array(body));
ok(hwpText.includes(`구분\t${days[0]}\t${days[1]}`) && hwpText.includes('"기장밥\n미역국 (5.6.16)\n제육볶음 (5.6.10)"') && hwpText.startsWith('11월 학교급식 식단표') && hwpText.endsWith('끝 문단'), `hwp 표를 탭 글로 못 바꿉니다:\n${hwpText}`);
{
    const meal = parseMealTable(hwpText, { today: '2026-11-17', now: new Date('2026-11-17T09:00:00+09:00') });
    const first = (meal.days || []).find((d) => d.date === '2026-11-16');
    ok(first && first.items.map((i) => i.name).join() === '기장밥,미역국,제육볶음' && first.items[2].codes === '5.6.10', `hwp 에서 읽은 표가 급식으로 안 읽힙니다: ${JSON.stringify(meal.days)}`);
}
ok(paraText(new Uint8Array([...utf16('가'), 10, 0, ...utf16('나'), 9, 0, ...new Array(14).fill(0), ...utf16('다'), 13, 0])) === '가\n나 다', '문단 글의 조종 글자 건너뛰기');
{
    const big = '가'.repeat(3000); // 4095바이트를 넘는 기록(크기를 따로 적는 꼴)
    ok(sectionText(new Uint8Array(para(0, big))) === big, '큰 기록(크기 따로 적기)을 못 읽습니다.');
    const packed = deflateRawSync(Buffer.from(body));
    const back = await inflateRaw(new Uint8Array(packed));
    ok(back.length === body.length && sectionText(back) === hwpText, '압축된 본문을 풀지 못합니다.');
}

/* ── hwpx ── */
const xml = `<hs:sec xmlns:hs="s" xmlns:hp="p"><hp:p><hp:run><hp:t>11월 식단표</hp:t></hp:run></hp:p>
<hp:p><hp:run><hp:tbl rowCnt="2" colCnt="3"><hp:tr>
<hp:tc><hp:subList><hp:p><hp:run><hp:t>구분</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="0"/></hp:tc>
<hp:tc><hp:subList><hp:p><hp:run><hp:t>${days[0]}</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="1" rowAddr="0"/></hp:tc>
<hp:tc><hp:subList><hp:p><hp:run><hp:t>${days[1]}</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="2" rowAddr="0"/></hp:tc></hp:tr><hp:tr>
<hp:tc><hp:subList><hp:p><hp:run><hp:t>중식</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="0" rowAddr="1"/></hp:tc>
<hp:tc><hp:subList>${menus[0].map((m) => `<hp:p><hp:run><hp:t>${m}</hp:t></hp:run></hp:p>`).join('')}</hp:subList><hp:cellAddr colAddr="1" rowAddr="1"/></hp:tc>
<hp:tc><hp:subList><hp:p><hp:run><hp:t>카레라이스 (2.5.6.10)</hp:t><hp:lineBreak/><hp:t>유부장국 &amp; 깍두기</hp:t></hp:run></hp:p></hp:subList><hp:cellAddr colAddr="2" rowAddr="1"/></hp:tc>
</hp:tr></hp:tbl></hp:run></hp:p><hp:p><hp:run><hp:t>끝</hp:t></hp:run></hp:p></hs:sec>`;
const hwpxText = hwpxSectionText(xml);
ok(hwpxText.includes(`구분\t${days[0]}\t${days[1]}`) && hwpxText.includes('"기장밥\n미역국 (5.6.16)\n제육볶음 (5.6.10)"') && hwpxText.includes('"카레라이스 (2.5.6.10)\n유부장국 & 깍두기"') && hwpxText.endsWith('끝'), `hwpx 표를 탭 글로 못 바꿉니다:\n${hwpxText}`);
{
    /* 압축 묶음(zip) 한 개짜리를 손으로 만들어 읽습니다. */
    const name = Buffer.from('Contents/section0.xml');
    const raw = Buffer.from(xml);
    const packed = deflateRawSync(raw);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034B50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46); central.writeUInt32LE(0x02014B50, 0); central.writeUInt16LE(8, 10); central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(raw.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
    const end = Buffer.alloc(22); end.writeUInt32LE(0x06054B50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(46 + name.length, 12); end.writeUInt32LE(30 + name.length + packed.length, 16);
    const zip = new Uint8Array(Buffer.concat([local, name, packed, central, name, end]));
    const files = readZip(zip);
    const got = new TextDecoder().decode(await files.get('Contents/section0.xml')());
    ok(got === xml, 'hwpx 묶음(zip)에서 본문을 못 꺼냅니다.');
    ok(fileKind('급식.hwpx', zip) === 'hwpx' && fileKind('a.xlsx', zip) === '', '파일 종류(hwpx)');
}
ok(tableToTsv([{ row: 0, col: 0, text: 'a' }, { row: 1, col: 1, text: 'b\nc' }], 2, 2) === 'a\t\n\t"b\nc"', '표 → 탭 글');
ok(fileKind('x.pdf', new Uint8Array([0x25, 0x50, 0x44, 0x46])) === 'pdf' && fileKind('x.bin', new Uint8Array([0xD0, 0xCF, 0x11, 0xE0])) === 'hwp' && fileKind('a.jpg', new Uint8Array([0xFF, 0xD8])) === 'image' && fileKind('a.txt', new Uint8Array([65, 66])) === '', '파일 종류');

/* ── PDF 글 조각 → 표 ── */
{
    const d5 = ['11월 16일(월)', '11월 17일(화)', '11월 18일(수)', '11월 19일(목)', '11월 20일(금)'];
    const m5 = [['기장밥', '미역국 (5.6.16)', '제육볶음 (5.6.10)'], ['카레라이스 (2.5.6.10)', '유부장국 (5.6)', '깍두기 (9)'], ['보리밥', '된장찌개 (5.6)', '고등어구이 (7)'], ['잡곡밥', '소고기무국 (16)', '닭갈비 (5.6.15)'], ['짜장면 (5.6.10)', '계란국 (1)', '단무지']];
    const items = [{ str: '11월 3주 학교급식 식단표', x: 60, y: 40, w: 150, h: 10 }];
    const colX = [70, 130, 270, 410, 550, 690];
    [['구분', ...d5], ['중식', ...m5.map((m) => m[0])], ['', ...m5.map((m) => m[1])], ['', ...m5.map((m) => m[2])], ['열량', '612 kcal', '655 kcal', '598 kcal', '640 kcal', '702 kcal']].forEach((row, r) => {
        row.forEach((str, c) => { if (str) items.push({ str, x: colX[c], y: 70 + r * 14 + (c === 2 ? 0.6 : 0), w: str.length * 7, h: 10 }); });
    });
    /* 한 낱말이 두 조각으로 나뉜 경우도 붙입니다. */
    items.push({ str: '배추', x: 130, y: 70 + 5 * 14, w: 20, h: 10 }, { str: '김치 (9)', x: 150, y: 70 + 5 * 14, w: 40, h: 10 }, { str: '귤', x: 270, y: 70 + 5 * 14, w: 10, h: 10 });
    const tsv = pdfItemsToTsv([...items].reverse());
    const rows = tsv.split('\n');
    ok(rows[0] === '11월 3주 학교급식 식단표' && rows[1] === `구분\t${d5.join('\t')}` && rows[3] === `\t${m5.map((m) => m[1]).join('\t')}` && rows[6] === '\t배추김치 (9)\t귤\t\t\t', `PDF 글 조각을 줄·칸으로 못 나눕니다:\n${tsv}`);
    const meal = parseMealTable(tsv, { today: '2026-11-17', now: new Date('2026-11-17T09:00:00+09:00') });
    const d16 = (meal.days || []).find((d) => d.date === '2026-11-16');
    ok((meal.days || []).length === 5 && d16 && d16.items.map((i) => i.name).join() === '기장밥,미역국,제육볶음,배추김치' && d16.items[2].codes === '5.6.10' && d16.kcal === '612', `PDF 에서 읽은 표가 급식으로 안 읽힙니다: ${JSON.stringify(meal.days)}`);
    ok(pdfItemsToTsv([]) === '' && pdfItemsToTsv([{ str: '한 줄', x: 1, y: 1, w: 30, h: 10 }]) === '한 줄', '글 조각이 없거나 하나일 때');
}

/* ── 화면·빌드 연결 ── */
const read = (p) => readFileSync(p, 'utf8');
ok(/readDocFile\(picked\)/.test(read('src/ui/GridPaste.jsx')) && /data-role="grid-file"/.test(read('src/ui/GridPaste.jsx')) && /DOC_ACCEPT/.test(read('src/ui/GridPaste.jsx')), '급식표 읽기에 한글·PDF 파일 고르기가 없습니다.');
ok(/data-role="meal-add"/.test(read('src/ui/MealCard.jsx')) && /openPlus\?\.\(\{ meal: true \}\)/.test(read('src/ui/MealCard.jsx')) && /startMeal=\{plus === 'meal'\}/.test(read('src/App.jsx')), "급식판에 '급식표 넣기'가 없습니다.");
ok(/"pdfjs-dist": "\d/.test(read('package.json')) && /copyPdfFiles\(\)/.test(read('vite.config.js')) && /new URL\('pdf\/'/.test(read('src/ui/pdfText.js')) && !/https?:\/\//.test(read('src/ui/pdfText.js')) && !/from 'pdfjs-dist/.test(read('src/ui/pdfText.js')), 'PDF 읽기 파일을 같은 주소에서 받지 않거나, 묶음에 넣었습니다.');
ok(/import\('\.\/pdfText\.js'\)/.test(read('src/ui/docRead.js')), 'PDF 읽기는 쓸 때만 받아야 합니다(처음 화면이 무거워집니다).');
ok(/check:doc-file/.test(read('.github/workflows/deploy-pages.yml')), 'CI에 check:doc-file 이 없습니다.');

if (failures.length) { console.error(`한글·PDF 읽기 검사 실패 ${failures.length}개\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('한글·PDF 읽기 검사를 통과했습니다.');
