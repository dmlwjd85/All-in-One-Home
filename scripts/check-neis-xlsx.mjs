/**
 * 나이스 모아 보기 「내려받기」가 진짜 엑셀 파일(.xlsx)인지 확인합니다.
 * 1) 만드는 코드로 직접 파일을 만들어 풀어 봅니다: 한글·줄바꿈·'=' 시작 값이 글자 칸 그대로인지,
 *    수식(<f>)이 없는지, 머리글 굵게·내용 칸 줄바꿈·열 너비가 있는지.
 * 2) 변이 검사: 만드는 코드를 일부러 망가뜨리면(수식 칸·줄바꿈 끔) 이 검사가 실패를 잡는지.
 * 3) 브라우저: 데모 기록 하나를 '=' 시작·두 줄로 고친 뒤 「내려받기」를 눌러 실제로 받은 파일을 풀어 봅니다.
 *    파일 이름이 나이스모아_날짜.xlsx 인지, 안내 문구에 .csv가 없는지, 엑셀 코드가 첫 화면 묶음에 안 들어갔는지.
 *    python3 openpyxl이 있으면 받은 파일을 openpyxl로도 열어 봅니다(없으면 건너뜀).
 */
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inflateRawSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/* ---------- zip·xlsx 풀기 ---------- */
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
        if (view.getUint32(local, true) !== 0x04034b50) throw new Error(`${name}: 파일 머리가 깨졌어요`);
        const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
        const raw = buf.subarray(start, start + size);
        const data = method === 0 ? raw : inflateRawSync(raw);
        if (crc32(data) !== crc) throw new Error(`${name}: CRC가 맞지 않아요`);
        files.set(name, new TextDecoder('utf-8', { fatal: true }).decode(data));
        at += 46 + nameLen + extraLen + commentLen;
    }
    return files;
}

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d))).replace(/&amp;/g, '&');

/** xlsx 바이트를 풀어 칸 값·종류·모양을 돌려줍니다. */
function readXlsx(buf) {
    const files = unzip(buf);
    const need = ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml'];
    need.forEach((name) => { if (!files.has(name)) throw new Error(`${name}이 없어요`); });
    const shared = [...(files.get('xl/sharedStrings.xml') || '').matchAll(/<si>([\s\S]*?)<\/si>/g)]
        .map((m) => [...m[1].matchAll(/<t(?: [^>]*)?>([\s\S]*?)<\/t>/g)].map((t) => unxml(t[1])).join(''));
    const styles = files.get('xl/styles.xml');
    const fonts = [...(styles.match(/<fonts[^>]*>([\s\S]*?)<\/fonts>/)?.[1] || '').matchAll(/<font>([\s\S]*?)<\/font>/g)].map((m) => m[1]);
    const xfs = [...(styles.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)?.[1] || '').matchAll(/<xf ([^>]*?)(?:\/>|>([\s\S]*?)<\/xf>)/g)]
        .map((m) => ({ fontId: Number(/fontId="(\d+)"/.exec(m[1])?.[1] || 0), wrap: /wrapText="1"/.test(m[2] || '') }));
    const sheet = files.get('xl/worksheets/sheet1.xml');
    const cells = new Map();
    for (const m of sheet.matchAll(/<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = m[3];
        const inner = m[4] || '';
        const type = /t="(\w+)"/.exec(attrs)?.[1] || 'n';
        const s = Number(/s="(\d+)"/.exec(attrs)?.[1] || 0);
        const v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1];
        const isText = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(inner)?.[1];
        let value = '';
        if (type === 's') value = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') value = unxml(isText || '');
        else if (v !== undefined) value = unxml(v);
        cells.set(`${m[1]}${m[2]}`, {
            type, value, formula: /<f[\s>]/.test(inner),
            bold: /<b\/>|<b val="(1|true)"\/>/.test(fonts[xfs[s]?.fontId ?? 0] || ''),
            wrap: !!xfs[s]?.wrap,
        });
    }
    const widths = [...sheet.matchAll(/<col min="(\d+)" max="(\d+)" width="([\d.]+)"/g)].map((m) => ({ min: Number(m[1]), max: Number(m[2]), w: Number(m[3]) }));
    const width = (col) => widths.find((c) => col >= c.min && col <= c.max)?.w || 0;
    const rows = Math.max(0, ...[...cells.keys()].map((k) => Number(k.replace(/^[A-Z]+/, ''))));
    const frozen = /<pane [^>]*ySplit="1"[^>]*topLeftCell="A2"[^>]*state="frozen"/.test(sheet);
    return { files, cells, width, rows, frozen, hasFormula: /<f[\s>]/.test(sheet) };
}

const HEAD = ['번호', '이름', '날짜', '종류', '태그', '내용'];
const COLS = ['A', 'B', 'C', 'D', 'E', 'F'];
const TRICKY = ['=1+1', '+CMD|calc', '@SUM(A1)', '-=1', '＝1+1', '\t=HYPERLINK("x")', '첫 줄\n둘째 줄\n셋째 줄', '<b>&amp;</b> "따옴표"', '한글 가나다 漢字 😀', '0123', '010-1234-5678', '12345'];

/** 읽은 xlsx가 우리 기준에 맞는지 봅니다. 실패 문장 목록을 돌려줍니다. */
function judge(x, { tag, expect }) {
    const bad = [];
    const cell = (ref) => x.cells.get(ref) || { type: '', value: '' };
    HEAD.forEach((h, i) => {
        const c = cell(`${COLS[i]}1`);
        if (c.value !== h) bad.push(`${tag} 머리글 ${COLS[i]}1이 '${h}'가 아니에요: '${c.value}'`);
        if (!c.bold) bad.push(`${tag} 머리글 ${COLS[i]}1이 굵지 않아요`);
    });
    if (x.hasFormula) bad.push(`${tag} 수식 칸(<f>)이 들어 있어요`);
    if (!x.frozen) bad.push(`${tag} 머리글 줄이 맨 위에 고정되지 않았어요(pane ySplit=1 frozen 없음)`);
    for (const [ref, c] of x.cells) {
        if (c.formula) bad.push(`${tag} ${ref}가 수식 칸이에요`);
        if (/^\s*[=+@\-＝＋＠－]/.test(c.value) && !['s', 'inlineStr', 'str'].includes(c.type)) bad.push(`${tag} ${ref}('${c.value}')가 글자 칸이 아니에요(${c.type})`);
        if (c.type === 'str') bad.push(`${tag} ${ref}가 수식 결과 칸(str)이에요`);
        if (/^'[=+@\-]/.test(c.value)) bad.push(`${tag} ${ref}에 CSV식 따옴표가 붙었어요: ${c.value}`);
    }
    if (x.width(6) < 40) bad.push(`${tag} 내용 열이 좁아요: ${x.width(6)}`);
    for (let i = 1; i <= 5; i += 1) if (x.width(i) < 6) bad.push(`${tag} ${COLS[i - 1]}열 너비가 없어요: ${x.width(i)}`);
    if (x.rows !== expect.length + 1) bad.push(`${tag} 행 수가 ${expect.length + 1}이 아니에요: ${x.rows}`);
    expect.forEach((row, r) => {
        row.forEach((want, i) => {
            const c = cell(`${COLS[i]}${r + 2}`);
            if (String(c.value) !== String(want)) bad.push(`${tag} ${COLS[i]}${r + 2} 값이 달라요: ${JSON.stringify(c.value)} ≠ ${JSON.stringify(want)}`);
            /* 내용 칸은 숫자만 있어도(0123·12345) 글자 칸으로 남아 앞자리 0을 지켜야 합니다. */
            if (i === 5 && want !== '' && !['s', 'inlineStr'].includes(c.type)) bad.push(`${tag} ${COLS[i]}${r + 2}('${want}') 내용 칸이 글자 칸이 아니에요(${c.type})`);
            if (i === 5 && String(want).includes('\n') && !c.wrap) bad.push(`${tag} ${COLS[i]}${r + 2} 줄바꿈 칸이 칸 안에서 줄이 안 바뀌어요(wrapText 없음)`);
        });
    });
    return bad;
}

const students = [{ id: 's1', no: 1, name: '김하은' }, { id: 's2', no: 12, name: '이도윤' }];
const groups = [
    ['s1', TRICKY.slice(0, 5).map((text, i) => ({ date: `2026-11-0${i + 1}`, kind: '관찰', tags: ['학습', '교우'], text }))],
    ['s2', TRICKY.slice(5).map((text, i) => ({ date: `2026-11-1${i}`, kind: i % 2 ? '칭찬' : '상담', tags: [], text }))],
    ['none', [{ date: '2026-11-12', kind: '관찰', tags: ['생활'], text: '=A1*2' }]],
];
const expectRows = [
    ...TRICKY.slice(0, 5).map((text, i) => ['1', '김하은', `2026-11-0${i + 1}`, '관찰', '학습 · 교우', text]),
    ...TRICKY.slice(5).map((text, i) => ['12', '이도윤', `2026-11-1${i}`, i % 2 ? '칭찬' : '상담', '', text.replace(/\r\n?/g, '\n')]),
    ['', '학생 미정', '2026-11-12', '관찰', '생활', '=A1*2'],
];

/* ---------- 1) 만드는 코드로 직접 ---------- */
const modPath = resolve(root, 'src/lib/neisXlsx.js');
const mod = await import(pathToFileURL(modPath).href);
check(mod.NEIS_XLSX_TYPE === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'xlsx 파일 종류(MIME)가 달라요.');
const direct = readXlsx(Buffer.from(mod.neisXlsxBytes(mod.neisRows(groups, students))));
judge(direct, { tag: '[직접]', expect: expectRows }).forEach((m) => failures.push(m));
const okDirect = failures.length === 0;

/* ---------- 2) 변이 검사 ---------- */
const src = readFileSync(modPath, 'utf8');
const mutants = [
    ['글자 칸을 수식 칸으로', (s) => s.replace('t="s"><v>${sst(text)}</v></c>`', '><f>${xmlText(text).slice(1)}</f><v>${sst(text)}</v></c>`')],
    ['내용 칸 줄바꿈 끔', (s) => s.replace('<alignment vertical="top" wrapText="1"/>', '<alignment vertical="top"/>')],
    ['머리글 굵게 끔', (s) => s.replace('<font><b/>', '<font>')],
    ['맨 위 고정 지움', (s) => s.replace('<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>', '')],
    ['숫자만 있는 칸을 모두 숫자 칸으로', (s) => s.replace('r > 0 && c === 0 && /^\\d{1,4}$/.test(text)', 'r > 0 && /^\\d{1,5}$/.test(text)')],
];
const tmp = mkdtempSync(join(tmpdir(), 'neis-xlsx-'));
try {
    for (const [name, mutate] of mutants) {
        const changed = mutate(src);
        if (changed === src) { failures.push(`변이 '${name}'를 만들지 못했어요(코드가 바뀜).`); continue; }
        const file = join(tmp, `m-${mutants.findIndex((m) => m[0] === name)}.mjs`);
        writeFileSync(file, changed);
        let caught = false;
        try {
            const m = await import(pathToFileURL(file).href);
            caught = judge(readXlsx(Buffer.from(m.neisXlsxBytes(m.neisRows(groups, students)))), { tag: '[변이]', expect: expectRows }).length > 0;
        } catch { caught = true; }
        check(caught, `변이 '${name}'를 검사가 잡지 못했어요.`);
        console.log(`변이 '${name}': ${caught ? '잡음' : '못 잡음'}`);
    }
} finally { rmSync(tmp, { recursive: true, force: true }); }

/* 누를 때는 미리 불러 둔 엑셀 코드를 기다리지 않고 씁니다(크롬은 손짓이 몇 초 남아 브라우저로는 가려내기 어려워 코드로 봅니다). */
const studentsSrc = readFileSync(resolve(root, 'src/ui/Students.jsx'), 'utf8');
check(studentsSrc.includes("const xlsx = xlsxRef.current || await import('../lib/neisXlsx.js');")
    && /useEffect\(\(\) => \{[\s\S]{0,200}import\('\.\.\/lib\/neisXlsx\.js'\)\.then\(\(mod\) => \{ if \(alive\) xlsxRef\.current = mod; \}\)/.test(studentsSrc), '내려받기가 미리 불러 둔 엑셀 코드를 쓰지 않아요(누른 손짓이 끊길 수 있음).');

/* ---------- 3) 브라우저에서 실제로 내려받기 ---------- */
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
if (!chrome || !existsSync(resolve(root, 'dist/index.html'))) {
    console.error('크롬 또는 dist가 없어 나이스 엑셀 내려받기 검사를 돌릴 수 없어요. npm run build 뒤에 다시 돌려 주세요.');
    process.exit(1);
}
/* 엑셀 만드는 코드는 따로 떨어진 묶음이어야 합니다(첫 화면 묶음에 안 들어감). */
const assets = readdirSync(resolve(root, 'dist/assets')).filter((f) => f.endsWith('.js'));
const withXlsx = assets.filter((f) => readFileSync(resolve(root, 'dist/assets', f), 'utf8').includes('sharedStrings.xml'));
const entry = /src="[^"]*assets\/([^"]+\.js)"/.exec(readFileSync(resolve(root, 'dist/index.html'), 'utf8'))?.[1];
check(withXlsx.length === 1 && withXlsx[0] !== entry, `엑셀 코드가 따로 떨어진 묶음이 아니에요: ${withXlsx.join(',')} (첫 화면 ${entry})`);
if (withXlsx[0]) console.log(`엑셀 코드 묶음: ${withXlsx[0]} ${readFileSync(resolve(root, 'dist/assets', withXlsx[0])).length}바이트`);

const port = 4261;
const origin = `http://127.0.0.1:${port}/`;
const shots = process.env.NEIS_SHOTS || '';
if (shots) mkdirSync(shots, { recursive: true });
try {
    await fetch(origin);
    console.error(`127.0.0.1:${port}에 이미 다른 서버가 있어요. 끈 뒤 다시 돌려 주세요.`);
    process.exit(1);
} catch { /* 비어 있음 */ }
const preview = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
for (let i = 0; i < 60; i += 1) {
    try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
    await wait(250);
}

/* 공유 창(navigator.share)을 흉내 내고, 주소 풀기(revokeObjectURL) 때를 기록합니다. 컴퓨터에서도 공유가 되는 척합니다. */
const MOCK = () => {
    localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
    localStorage.setItem('ssug-gyomu-speech-notice', '1');
    window.__shareCalls = [];
    window.__revoked = [];
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = (u) => { window.__revoked.push(Date.now()); revoke(u); };
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: (d) => !!(d && d.files && d.files.length) });
    Object.defineProperty(navigator, 'share', {
        configurable: true,
        value: async (d) => {
            const f = d.files[0];
            const buf = new Uint8Array(await f.arrayBuffer());
            let bin = '';
            for (let i = 0; i < buf.length; i += 1) bin += String.fromCharCode(buf[i]);
            window.__shareCalls.push({ name: f.name, type: f.type, b64: btoa(bin), active: navigator.userActivation?.isActive ?? null });
            if (localStorage.getItem('neis-share-mode') === 'abort') throw new DOMException('취소했어요', 'AbortError');
        },
    });
};
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const EDITED = '=1+1 먼저 계산해 보자고 했어요.\n둘째 줄: 친구와 <실험> 기구를 & 나눴어요.';
const downloads = mkdtempSync(join(tmpdir(), 'neis-dl-'));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
    for (const [width, height] of [[390, 844], [1280, 900]]) {
        const tag = `[${width}]`;
        const page = await browser.newPage();
        await page.setViewport({ width, height });
        page.on('pageerror', (error) => failures.push(`화면 오류(${width}): ${error?.message || error}`));
        await page.evaluateOnNewDocument(MOCK);
        const dir = join(downloads, String(width));
        mkdirSync(dir, { recursive: true });
        const cdp = await page.createCDPSession();
        await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
        await page.goto(`${origin}?demo=1&mode=light#/students/7`, { waitUntil: 'networkidle0' });
        /* 데모 기록(7번)을 '=' 시작·두 줄로 고칩니다. */
        await page.waitForSelector('[data-edit-for="demo-choi"]', { timeout: 15000 });
        await page.click('[data-edit-for="demo-choi"]');
        await page.waitForSelector('textarea[aria-label="기록 고치기"]', { timeout: 5000 });
        await page.$eval('textarea[aria-label="기록 고치기"]', (el) => { el.select(); });
        await page.keyboard.press('Backspace');
        const [first, second] = EDITED.split('\n');
        await page.type('textarea[aria-label="기록 고치기"]', first);
        await page.keyboard.press('Enter');
        await page.type('textarea[aria-label="기록 고치기"]', second);
        await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '저장')?.click());
        await page.waitForFunction(() => !document.querySelector('textarea[aria-label="기록 고치기"]'), { timeout: 5000 }).catch(() => {});
        const loaded = [];
        page.on('request', (req) => { if (/neisXlsx[^/]*\.js/.test(req.url())) loaded.push(req.url()); });
        await page.goto(`${origin}?mode=light#/students/neis`, { waitUntil: 'networkidle0' });
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === '내려받기'), { timeout: 15000 });
        /* 엑셀 코드는 누르기 전에 미리 불러 둬야 누른 손짓이 끊기지 않습니다. */
        check(loaded.length > 0, `${tag} 나이스 화면을 열었는데 엑셀 코드를 미리 불러오지 않았어요.`);
        const guide = await page.evaluate(() => [...document.querySelectorAll('p')].map((p) => p.innerText).find((t) => t.includes('내려받기')) || '');
        check(guide.includes('엑셀 파일(.xlsx)') && !guide.includes('.csv'), `${tag} 안내 문구가 엑셀 파일이 아니에요: ${guide}`);
        await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.innerText.trim() === '내려받기').click());
        let name = '';
        for (let i = 0; i < 80 && !name; i += 1) {
            await wait(150);
            name = readdirSync(dir).find((f) => !f.endsWith('.crdownload')) || '';
        }
        const toast = await page.evaluate(() => document.body.innerText.includes('엑셀 파일(.xlsx)을 이 기기에만 내려받았어요.'));
        check(toast, `${tag} 내려받은 뒤 알림이 보이지 않아요.`);
        /* 컴퓨터(휴대폰 아님)는 공유 창 없이 바로 내려받고, 주소는 곧바로 풀지 않습니다(1분 뒤). */
        await wait(2500);
        const after = await page.evaluate(() => ({ share: window.__shareCalls.length, revoked: window.__revoked.length }));
        check(after.share === 0, `${tag} 컴퓨터인데 공유 창을 띄웠어요.`);
        check(after.revoked === 0, `${tag} 내려받은 뒤 2.5초 안에 파일 주소를 풀었어요(아이폰에서 받기가 끊길 수 있음).`);
        if (shots) await page.screenshot({ path: join(shots, `neis-${width}.png`) });
        check(/^나이스모아_\d{4}-\d{2}-\d{2}\.xlsx$/.test(name), `${tag} 받은 파일 이름이 나이스모아_날짜.xlsx가 아니에요: '${name}'`);
        if (name) {
            const buf = readFileSync(join(dir, name));
            if (shots) writeFileSync(join(shots, `받은파일-${width}.xlsx`), buf);
            check(buf[0] === 0x50 && buf[1] === 0x4b, `${tag} 받은 파일이 zip(xlsx)이 아니에요.`);
            let x = null;
            try { x = readXlsx(buf); } catch (error) { failures.push(`${tag} 받은 파일을 풀지 못했어요: ${error.message}`); }
            if (x) {
                const all = [...x.cells.values()];
                const edited = all.find((c) => c.value.startsWith('=1+1'));
                check(edited && edited.value === EDITED && edited.type === 's' && !edited.formula && edited.wrap, `${tag} 고친 기록('=' 시작·두 줄)이 글자 칸 그대로가 아니에요: ${JSON.stringify(edited)}`);
                check(all.some((c) => c.value === '모둠 활동에서 친구 의견을 먼저 들어 주고, 마지막 정리까지 맡았어요.'), `${tag} 데모 기록 한글이 깨졌거나 없어요.`);
                check(HEAD.every((h, i) => x.cells.get(`${COLS[i]}1`)?.value === h && x.cells.get(`${COLS[i]}1`)?.bold), `${tag} 머리글 줄이 굵은 '${HEAD.join('·')}'가 아니에요.`);
                check(!x.hasFormula && x.width(6) >= 40, `${tag} 수식 칸이 있거나 내용 열이 좁아요.`);
                check(x.cells.get('B2')?.value && x.cells.get('B2').value !== '학생 미정', `${tag} 학생 이름 칸이 비었어요.`);
            }
            /* python3 openpyxl이 있으면 같은 파일을 열어 봅니다(엑셀 계열 프로그램이 읽는지). */
            const py = spawnSync('python3', ['-c', `
import sys, json, openpyxl
wb = openpyxl.load_workbook(sys.argv[1])
ws = wb.active
rows = [[c.value for c in r] for r in ws.iter_rows()]
hit = [c for r in ws.iter_rows() for c in r if isinstance(c.value, str) and c.value.startswith('=1+1')]
print(json.dumps({"title": ws.title, "head": rows[0], "bold": all(c.font.b for c in ws[1]), "rows": len(rows),
  "edited": hit[0].value if hit else None, "type": hit[0].data_type if hit else None, "wrap": bool(hit and hit[0].alignment.wrap_text),
  "widthF": ws.column_dimensions["F"].width, "frozen": ws.freeze_panes}, ensure_ascii=False))
`, join(dir, name)], { encoding: 'utf8' });
            const hasPy = spawnSync('python3', ['-c', 'import openpyxl'], { encoding: 'utf8' }).status === 0;
            if (hasPy && py.status !== 0) {
                failures.push(`${tag} openpyxl로 받은 파일을 열지 못했어요: ${(py.stderr || '').trim().split('\n').pop()}`);
            } else if (py.status === 0) {
                const o = JSON.parse(py.stdout);
                console.log(`${tag} openpyxl: ${py.stdout.trim()}`);
                check(o.head.join('|') === HEAD.join('|') && o.bold && o.edited === EDITED && o.type === 's' && o.wrap && o.widthF >= 40, `${tag} openpyxl로 연 결과가 달라요: ${py.stdout.trim()}`);
            } else {
                console.log(`${tag} python3 openpyxl이 없어 건너뜁니다.`);
            }
        }
        await page.close();
    }

    /* 아이폰: 공유 창으로 파일을 넘기고, 취소하면 아무 말 없이 끝납니다. 데모 기록을 그대로 씁니다. */
    for (const mode of ['ok', 'abort']) {
        const tag = `[아이폰 공유 ${mode === 'ok' ? '저장' : '취소'}]`;
        const page = await browser.newPage();
        await page.setUserAgent(IPHONE);
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true });
        page.on('pageerror', (error) => failures.push(`화면 오류(${tag}): ${error?.message || error}`));
        await page.evaluateOnNewDocument(MOCK);
        const dir = join(downloads, `iphone-${mode}`);
        mkdirSync(dir, { recursive: true });
        const cdp = await page.createCDPSession();
        await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dir, eventsEnabled: true });
        await page.goto(`${origin}?demo=1&mode=light#/students/neis`, { waitUntil: 'networkidle0' });
        await page.evaluate((m) => localStorage.setItem('neis-share-mode', m), mode);
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.innerText.trim() === '내려받기'), { timeout: 15000 });
        await wait(300);
        await page.tap('.neis-tools button:nth-child(2)');
        await wait(1500);
        const got = await page.evaluate(() => ({
            calls: window.__shareCalls,
            text: document.body.innerText,
        }));
        const files = readdirSync(dir);
        check(got.calls.length === 1, `${tag} 공유 창이 한 번 뜨지 않았어요: ${got.calls.length}`);
        check(files.length === 0, `${tag} 공유를 쓰는데 따로 내려받기도 했어요: ${files.join(',')}`);
        check(!got.text.includes('이 기기에만 내려받았어요') && !got.text.includes('엑셀 파일을 만들지 못했어요'), `${tag} 엉뚱한 알림이 보여요.`);
        const call = got.calls[0];
        if (call) {
            check(call.active !== false, `${tag} 공유를 부를 때 누른 손짓이 끊겼어요(userActivation 없음).`);
            check(/^나이스모아_\d{4}-\d{2}-\d{2}\.xlsx$/.test(call.name) && call.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', `${tag} 넘긴 파일 이름·종류가 달라요: ${call.name} ${call.type}`);
            try {
                const x = readXlsx(Buffer.from(call.b64, 'base64'));
                check(x.frozen && x.cells.get('A1')?.bold && x.cells.get('A1')?.value === '번호' && x.rows > 1, `${tag} 넘긴 파일 내용이 달라요.`);
            } catch (error) { failures.push(`${tag} 넘긴 파일을 풀지 못했어요: ${error.message}`); }
        }
        if (mode === 'ok') check(got.text.includes('엑셀 파일(.xlsx)을 넘겼어요.'), `${tag} 공유 뒤 알림이 없어요.`);
        else check(!got.text.includes('넘겼어요'), `${tag} 공유를 취소했는데 알림이 떴어요(조용히 끝나야 함).`);
        if (shots && mode === 'ok') await page.screenshot({ path: join(shots, 'neis-iphone-share.png') });
        console.log(`${tag} 공유 ${got.calls.length}번 · 내려받은 파일 ${files.length}개`);
        await page.close();
    }
} finally {
    await browser.close();
    preview.kill();
    rmSync(downloads, { recursive: true, force: true });
}

if (failures.length) {
    console.error(`나이스 엑셀 내려받기 검사 실패 ${failures.length}건`);
    failures.forEach((m) => console.error(`- ${m}`));
    process.exit(1);
}
console.log(`나이스 엑셀 내려받기 검사 통과 (직접 ${okDirect ? '통과' : '실패'} · 변이 ${mutants.length}개 잡음 · 브라우저 390·1280 실제 파일 · 아이폰 공유 저장·취소)`);
