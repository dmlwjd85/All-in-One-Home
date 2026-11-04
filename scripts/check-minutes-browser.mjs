/* 회의록 화면을 실제 브라우저로 봅니다: 320·360·390·900·1920px, 라이트·다크.
   넘침·겹침·44px, 작성 칸 위치(첫 화면 안), 달력 팝업, Enter 줄바꿈, 저장 → 일정·할 일 등록과 노란 카드, 다시 저장해도 겹치지 않음. */
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';


const viteBin = resolve('node_modules/vite/bin/vite.js');
/* 포트: MINUTES_PORT 로 고정하거나, 운영체제가 준 빈 포트를 씁니다(무작위로 고르지 않음). */
const freePort = () => new Promise((ok, fail) => {
    const srv = createServer();
    srv.once('error', fail);
    srv.listen(0, '127.0.0.1', () => { const { port: p } = srv.address(); srv.close(() => ok(p)); });
});
const port = Number(process.env.MINUTES_PORT) || await freePort();
const origin = `http://127.0.0.1:${port}/`;
const shots = process.env.SHOT_DIR || 'shots-minutes';
mkdirSync(shots, { recursive: true });
const failures = [];
let uiCaught = 0;
const check = (cond, msg) => { if (!cond) failures.push(msg); };
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const preview = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { stdio: 'pipe' });
for (let i = 0; i < 100; i += 1) {
    try { if ((await fetch(origin)).ok) break; } catch { /* 기다립니다 */ }
    await delay(150);
}
const browser = await puppeteer.launch({ executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const timer = setTimeout(() => { console.error('시간 초과'); process.exit(1); }, 8 * 60 * 1000);

async function open(width, mode, hash, base = origin) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: width >= 900 ? (width >= 1920 ? 1080 : 800) : 760, deviceScaleFactor: 1 });
    await page.goto(`${base}?demo=1&at=08:42&mode=${mode}${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForSelector('#minutes-text', { timeout: 15000 });
    await delay(300);
    return page;
}


/* 화면 동작 탐침: Enter 줄바꿈(U1), 날짜 단추 → 달력 팝업(U2), 넓은 화면 2단(U4). 실패 목록을 돌려줍니다. */
async function probe(base) {
    const bad = [];
    const p1 = await open(390, 'light', '#/minutes/new', base);
    await p1.click('#minutes-text');
    await p1.keyboard.type('할 일');
    await p1.keyboard.press('Enter');
    await p1.keyboard.type('- 메모');
    const v = await p1.$eval('#minutes-text', (el) => el.value);
    if (v.split('\n').length !== 2) bad.push(`Enter 가 줄바꿈이 아닙니다: ${JSON.stringify(v)}`);
    await p1.click('[data-role="minutes-date-btn"]');
    const cal = await p1.waitForSelector('[role="dialog"][data-screen="minutes-cal"] .cal-grid', { timeout: 2000 }).then(() => true, () => false);
    if (!cal) bad.push('날짜 단추를 눌러도 달력 팝업이 뜨지 않습니다.');
    await p1.close();
    const p2 = await open(1280, 'light', '#/minutes/new', base);
    const split = await p2.evaluate(() => {
        const a = document.querySelector('#minutes-text')?.getBoundingClientRect();
        const side = document.querySelector('.minutes-side')?.getBoundingClientRect();
        return Boolean(a && side && side.width > 0 && side.left >= a.right - 1 && side.top < a.bottom);
    });
    if (!split) bad.push('넓은 화면에서 본문과 목록이 2단으로 놓이지 않습니다.');
    await p2.close();
    return bad;
}
const UI_MUT = [
    ['U1 Enter 가로채기', '<Area id="minutes-text"', '<Area id="minutes-text" onKeyDown={(event) => { if (event.key === \'Enter\') event.preventDefault(); }}'],
    ['U2 달력 팝업 없음', 'onClick={() => setPicking(true)}>', 'onClick={() => setPicking(false)}>'],
    ['U4 2단 없음', '<div className="minutes-split" data-screen="minutes-split">', '<div className="minutes" data-screen="minutes-split">'],
];
/* 변이 사본을 저장소 안 임시 폴더에 빌드해 미리보기로 띄웁니다(node_modules 는 위쪽에서 찾음). */
async function mutantOrigin(k, from, to) {
    const dir = resolve(`.minutes-ui-mut-${process.pid}`, String(k));
    for (const f of readdirSync('.')) {
        if (['node_modules', 'dist', '.git'].includes(f) || f.startsWith('.minutes-') || f.startsWith('shots')) continue;
        if (['src', 'public', 'index.html', 'package.json'].includes(f) || /config\.(js|mjs|cjs)$/.test(f) || f.startsWith('.env')) cpSync(f, resolve(dir, f), { recursive: true });
    }
    const file = resolve(dir, 'src/ui/Minutes.jsx');
    const src = readFileSync(file, 'utf8');
    if (!src.includes(from)) return { missing: true };
    writeFileSync(file, src.replace(from, to));
    const built = spawnSync(process.execPath, [viteBin, 'build', '--logLevel', 'error'], { cwd: dir, stdio: 'pipe' });
    if (built.status !== 0) return { error: String(built.stderr).slice(0, 300) };
    const mport = await freePort();
    const proc = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(mport), '--strictPort'], { cwd: dir, stdio: 'pipe' });
    const url = `http://127.0.0.1:${mport}/`;
    for (let i = 0; i < 100; i += 1) {
        try { if ((await fetch(url)).ok) break; } catch { /* 기다립니다 */ }
        await delay(150);
    }
    return { url, proc };
}

/* 보이는 단추·칸끼리 겹침, 화면 밖 넘침, 44px 미만. */
async function layout(page) {
    return page.evaluate(() => {
        const out = { overflow: document.documentElement.scrollWidth > innerWidth + 1, small: [], overlaps: [] };
        const els = [...document.querySelectorAll('[data-screen^="minutes"] button, [data-screen^="minutes"] input, [data-screen^="minutes"] textarea')]
            .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; });
        const boxes = els.map((el) => ({ el, r: el.getBoundingClientRect() }));
        for (const { el, r } of boxes) {
            if (el.tagName === 'BUTTON' && (r.height < 44 || r.width < 44) && !el.closest('.cal-grid')) out.small.push(`${(el.innerText || el.getAttribute('aria-label') || '').trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`);
            if (r.right > innerWidth + 1 || r.left < -1) out.small.push(`밖으로 나감: ${(el.innerText || el.id).slice(0, 20)}`);
        }
        for (let i = 0; i < boxes.length; i += 1) for (let j = i + 1; j < boxes.length; j += 1) {
            const a = boxes[i].r; const b = boxes[j].r;
            if (boxes[i].el.contains(boxes[j].el) || boxes[j].el.contains(boxes[i].el)) continue;
            const w = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (w > 1 && h > 1) out.overlaps.push(`${(boxes[i].el.innerText || boxes[i].el.id).slice(0, 12)} ↔ ${(boxes[j].el.innerText || boxes[j].el.id).slice(0, 12)}`);
        }
        const area = document.querySelector('#minutes-text').getBoundingClientRect();
        const save = document.querySelector('.minutes-save').getBoundingClientRect();
        out.areaTop = Math.round(area.top);
        out.saveBottom = Math.round(save.bottom);
        out.vh = innerHeight;
        out.split = Boolean(document.querySelector('.minutes-split .minutes-side'));
        return out;
    });
}

try {
    for (const mode of ['light', 'dark']) {
        for (const width of [320, 360, 390, 900, 1920]) {
            const page = await open(width, mode, '#/minutes/new');
            const got = await layout(page);
            const tag = `${width} ${mode}`;
            check(!got.overflow, `${tag}: 가로로 넘칩니다.`);
            check(!got.small.length, `${tag}: 작거나 밖으로 나간 단추 ${got.small.join(', ')}`);
            check(!got.overlaps.length, `${tag}: 겹침 ${got.overlaps.join(', ')}`);
            check(got.areaTop < got.vh * 0.6, `${tag}: 본문 칸이 너무 아래(${got.areaTop}px / ${got.vh})에 있습니다.`);
            if (width >= 900) {
                check(got.split, `${tag}: 2단(목록 칸)이 아닙니다.`);
                check(got.saveBottom <= got.vh - 8, `${tag}: 저장 단추가 첫 화면 밖(${got.saveBottom}px)이라 스크롤해야 합니다.`);
            }
            if (width === 390 || width === 1920) await page.screenshot({ path: `${shots}/minutes-${width}-${mode}.png` });
            /* 달력 팝업 */
            await page.click('[data-role="minutes-date-btn"]');
            await page.waitForSelector('[data-screen="minutes-cal"]', { timeout: 3000 }).catch(() => check(false, `${tag}: 달력 팝업이 뜨지 않습니다.`));
            const cal = await page.evaluate(() => {
                const s = document.querySelector('[data-screen="minutes-cal"]');
                if (!s) return null;
                const r = s.getBoundingClientRect();
                const cells = [...s.querySelectorAll('.cal-grid button')].map((b) => b.getBoundingClientRect());
                return { inside: r.top >= -1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.right <= innerWidth + 1, minCell: Math.min(...cells.map((c) => Math.min(c.width, c.height))), selects: document.querySelectorAll('select, input[type="date"]').length };
            });
            check(cal?.inside, `${tag}: 달력 팝업이 화면 밖으로 나갑니다.`);
            check(cal?.minCell >= 40, `${tag}: 달력 칸이 너무 작습니다(${cal?.minCell}).`);
            check(cal?.selects === 0, `${tag}: 드롭다운·날짜 입력이 있습니다.`);
            if (width === 390 || width === 1920) await page.screenshot({ path: `${shots}/minutes-cal-${width}-${mode}.png` });
            await page.click('[data-screen="minutes-cal"] .cal-grid button[aria-label="2026-11-06"]').catch(() => {});
            await delay(150);
            const picked = await page.evaluate(() => ({ open: Boolean(document.querySelector('[data-screen="minutes-cal"]')), label: document.querySelector('[data-role="minutes-date"]')?.innerText || '' }));
            check(!picked.open && /11월 6일|11\/6/.test(picked.label), `${tag}: 달력에서 고른 날짜가 들어가지 않습니다(${picked.label}).`);
            await page.close();
        }
    }

    /* 저장 흐름(390, 라이트) */
    const page = await open(390, 'light', '#/minutes/new');
    const today = await page.evaluate(() => document.querySelector('[data-role="minutes-date"]')?.getAttribute('aria-label') || '');
    check(/\d{4}년 \d{1,2}월 \d{1,2}일/.test(today), `새 회의록 날짜가 비어 있습니다: ${today}`);
    await page.type('#minutes-title', '11월 학년 협의회');
    await page.click('#minutes-text');
    await page.keyboard.type('할 일');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- 11/12(목) 3교시 공개수업');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- 내일까지 가정통신문 제출');
    await page.keyboard.press('Enter');
    await page.keyboard.type('- 김선생님 보고서 작성');
    const body = await page.$eval('#minutes-text', (el) => el.value);
    check(body.split('\n').length === 4, `Enter 가 줄바꿈이 아니라 다른 일을 합니다: ${JSON.stringify(body)}`);
    check(await page.$('[data-screen="minutes-editor"]'), 'Enter 로 저장·분류가 되어 작성 화면을 벗어났습니다.');
    await page.$eval('.minutes-save', (el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
    await page.waitForSelector('[data-screen="minutes-ask"]', { timeout: 5000 }).catch(() => check(false, '흐린 줄의 노란 확인 카드가 뜨지 않습니다.'));
    const ask = await page.evaluate(() => ({ low: document.querySelectorAll('[data-screen="minutes-ask"] .low-card').length, text: document.body.innerText }));
    check(ask.low === 1 && ask.text.includes('보고서'), `노란 카드 수가 다릅니다: ${ask.low}`);
    const after = await layout(page).catch(() => null);
    await page.screenshot({ path: `${shots}/minutes-ask-390-light.png` });
    if (after) check(!after.overflow, '노란 카드 화면이 가로로 넘칩니다.');
    await page.click('.minutes-ask-ok');
    await page.waitForSelector('[data-screen="minutes-view"]', { timeout: 5000 }).catch(() => check(false, '확인 뒤 회의록 보기로 가지 않습니다.'));
    const minutesId = await page.evaluate(() => location.hash.split('/')[2]);
    await page.evaluate(() => { location.hash = '#/todo'; });
    await delay(400);
    const todo = await page.evaluate(() => ({ text: document.body.innerText, links: document.querySelectorAll('[data-minutes-from]').length }));
    check(todo.text.includes('가정통신문 제출') && todo.text.includes('보고서'), '회의록의 할 일이 할 일 목록에 없습니다.');
    check(todo.links >= 2, `할 일에 회의록 표시가 없습니다(${todo.links}).`);
    /* 같은 회의록을 다시 저장해도 겹치지 않음 */
    if (process.env.DBG) console.log('pre', await page.evaluate(() => [location.hash, document.activeElement?.outerHTML?.slice(0, 120), document.querySelector('[role=dialog]')?.getAttribute('aria-label')]));
    await page.evaluate((id) => { location.hash = `#/minutes/${id}/edit`; }, minutesId);
    await delay(500);
    const hashNow = await page.evaluate(() => location.hash);
    if (process.env.DBG) console.log('hash', hashNow, await page.evaluate(() => document.body.innerText.slice(0, 300)));
    await page.waitForSelector('[data-screen="minutes-editor"] #minutes-text');
    if (process.env.DBG) console.log('before', minutesId, await page.evaluate(() => localStorage.getItem('ssug-gyomu-minutes-draft')));
    await page.$eval('.minutes-save', (el) => { el.scrollIntoView({ block: 'center' }); el.click(); });
    if (process.env.DBG) { await delay(800); console.log('after', await page.evaluate(() => [location.hash, document.querySelector('[data-screen="minutes-ask"]')?.innerText])); }
    await page.waitForSelector('[data-screen="minutes-view"]', { timeout: 5000 }).catch(() => check(false, '다시 저장했는데 또 노란 카드를 묻습니다.'));
    await page.evaluate(() => { location.hash = '#/todo'; });
    await delay(400);
    const twice = await page.evaluate(() => (document.body.innerText.match(/가정통신문 제출/g) || []).length);
    check(twice === 1, `다시 저장하면 할 일이 겹쳐 들어갑니다(${twice}개).`);
    await page.close();

    /* 넓은 화면 저장 뒤 2단 보기 스크린숏 */
    const wide = await open(1920, 'light', '#/minutes/new');
    await wide.type('#minutes-title', '교과협의회');
    await wide.type('#minutes-text', '안건\n- 수행평가 일정 논의\n할 일\n- 11/20까지 채점 기준 제출');
    await wide.click('.minutes-save');
    await wide.waitForSelector('[data-screen="minutes-view"]', { timeout: 5000 }).catch(() => check(false, '넓은 화면 저장 뒤 보기로 가지 않습니다.'));
    await wide.screenshot({ path: `${shots}/minutes-view-1920-light.png` });
    await wide.close();

    /* 화면 변이: 일부러 망가뜨린 화면을 위 탐침이 잡는지 봅니다(소스 맞추기 아님). */
    const baseProbe = await probe(origin);
    for (const m of baseProbe) check(false, `탐침(원본): ${m}`);
    let k = 0;
    for (const [name, from, to] of UI_MUT) {
        k += 1;
        const got = await mutantOrigin(k, from, to);
        if (got.missing) { check(false, `변이 ${name}: 바꿀 코드를 찾지 못했습니다.`); continue; }
        if (got.error) { check(false, `변이 ${name}: 빌드 실패 ${got.error}`); continue; }
        let caught;
        try { caught = (await probe(got.url)).length > 0; } catch { caught = true; } finally { got.proc.kill(); }
        check(caught, `변이 ${name} 이(가) 살아남았습니다.`);
        if (caught) uiCaught += 1;
    }
} finally {
    rmSync(resolve(`.minutes-ui-mut-${process.pid}`), { recursive: true, force: true });
    clearTimeout(timer);
    await browser.close();
    preview.kill();
}
if (failures.length) {
    console.error(`회의록 화면 검사 실패 ${failures.length}건:\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log(`회의록 화면 검사 통과 · 화면 변이 ${uiCaught}/3 검출`);
