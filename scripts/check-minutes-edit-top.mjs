/**
 * 회의록 보기의 '고치기'가 맨 위 줄(목록으로 옆)에 있는지 실제 화면에서 봅니다(390·1280).
 * - 제목·본문보다 위, 처음 화면 안에 보이고, 아래쪽에는 '고치기'가 하나도 남지 않음
 * - 버튼은 글자 길이만큼(줄 폭으로 늘지 않음), 누르면 눌림(아래로 2px)
 * - 누르면 같은 id의 고치기 화면이 열리고, 저장하면 보기로 돌아와 고친 본문이 보임
 * - 본문이 길어도 맨 위에서 바로 보이고, 지우기 → 그만두기 흐름은 그대로
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean).find(existsSync);
if (!chrome || !existsSync(resolve(root, 'dist/index.html'))) {
    console.error('크롬 또는 dist가 없어 회의록 고치기 위치 검사를 돌릴 수 없어요. npm run build 뒤에 다시 돌려 주세요.');
    process.exit(1);
}
const port = 4251;
const origin = `http://127.0.0.1:${port}/`;
const shots = process.env.MINUTES_SHOTS || '';
if (shots) mkdirSync(shots, { recursive: true });
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

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

const ID = 'meet-demo-old';
const viewSel = '[data-screen="minutes-view"]';
/* 보기 화면에서 고치기 단추들의 위치·크기와 제목·본문·아래 단추 위치를 잽니다. */
const measure = (page) => page.evaluate((sel) => {
    const view = document.querySelector(sel);
    const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), h: Math.round(r.height) }; };
    const edits = [...view.querySelectorAll('button')].filter((b) => b.innerText.trim() === '고치기' && b.getClientRects().length);
    const ink = (el) => { const range = document.createRange(); range.selectNodeContents(el); const r = range.getBoundingClientRect(); return Math.round(r.width); };
    const back = [...view.querySelectorAll('button')].find((b) => b.innerText.includes('회의록 목록'));
    const edit = edits[0] || null;
    return {
        count: edits.length,
        inActions: edits.some((b) => b.closest('.minutes-actions')),
        edit: rect(edit),
        ink: edit ? ink(edit) : 0,
        cls: edit ? edit.className : '',
        shadow: edit ? getComputedStyle(edit).boxShadow : '',
        back: rect(back),
        title: rect(view.querySelector('.minutes-view-title')),
        body: rect(view.querySelector('[data-role="minutes-body"]')),
        row: rect(edit?.parentElement),
        vh: innerHeight,
        overflow: document.documentElement.scrollWidth > innerWidth + 1,
    };
}, viewSel);

const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
try {
    for (const [width, height] of [[390, 844], [1280, 900]]) {
        const context = await browser.createBrowserContext();
        const page = await context.newPage();
        await page.setViewport({ width, height });
        page.on('pageerror', (error) => failures.push(`화면 오류(${width}): ${error?.message || error}`));
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-speech-notice', '1');
        });
        await page.goto(`${origin}?demo=1&mode=light#/minutes/${ID}`, { waitUntil: 'networkidle0' });
        await page.waitForSelector(viewSel, { timeout: 15000 });
        const m = await measure(page);
        const tag = `[${width}]`;
        check(m.count === 1, `${tag} 보기 화면의 '고치기'가 하나가 아니에요: ${m.count}`);
        check(!m.inActions, `${tag} '고치기'가 아직 아래쪽(지우기 줄)에 있어요.`);
        if (m.edit) {
            check(m.title && m.edit.bottom <= m.title.top + 1, `${tag} '고치기'가 제목보다 위에 있지 않아요: 고치기 ${m.edit.top}~${m.edit.bottom}, 제목 ${m.title?.top}`);
            check(m.body && m.edit.bottom <= m.body.top, `${tag} '고치기'가 본문보다 위에 있지 않아요.`);
            check(m.edit.top >= 0 && m.edit.bottom <= m.vh, `${tag} '고치기'가 처음 화면 안에 없어요: ${m.edit.top}/${m.vh}`);
            check(m.back && Math.abs((m.back.top + m.back.bottom) / 2 - (m.edit.top + m.edit.bottom) / 2) <= 6, `${tag} '고치기'가 '회의록 목록'과 같은 줄이 아니에요: ${JSON.stringify({ back: m.back, edit: m.edit })}`);
            check(m.edit.w <= m.ink + 48 && m.edit.w < m.row.w * 0.6, `${tag} '고치기'가 글자 길이보다 늘어나요: ${m.edit.w}px(글자 ${m.ink}px, 줄 ${m.row.w}px)`);
            check(m.edit.h >= 44, `${tag} '고치기' 높이가 44px보다 작아요: ${m.edit.h}`);
            check(/\bprimary-btn\b/.test(m.cls) && /\btap\b/.test(m.cls) && m.shadow && m.shadow !== 'none', `${tag} '고치기'가 키캡(primary-btn·tap·그림자) 모양이 아니에요: ${m.cls} / ${m.shadow}`);
        }
        check(!m.overflow, `${tag} 가로로 넘쳐요.`);
        if (shots) await page.screenshot({ path: `${shots}/after-view-${width}.png` });

        /* 눌림: 누르고 있는 동안 아래로 내려갑니다. */
        const btn = await page.$('[data-role="minutes-edit"]');
        if (!btn) { failures.push(`${tag} data-role="minutes-edit" 단추가 없어요.`); await context.close(); continue; }
        const box = await btn.boundingBox();
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down();
        await wait(60);
        const pressed = await page.$eval('[data-role="minutes-edit"]', (el) => getComputedStyle(el).transform);
        check(pressed && pressed !== 'none', `${tag} '고치기'를 눌러도 눌림이 없어요: ${pressed}`);
        await page.mouse.up();

        /* 누르면 같은 id의 고치기 화면 → 줄을 보태 저장 → 보기에 그대로 */
        await page.waitForSelector('[data-screen="minutes-editor"]', { timeout: 5000 }).catch(() => {});
        check((await page.evaluate(() => location.hash)) === `#/minutes/${ID}/edit`, `${tag} '고치기'를 눌러도 고치기 화면이 열리지 않아요: ${await page.evaluate(() => location.hash)}`);
        const before = await page.$eval('#minutes-text', (el) => el.value).catch(() => null);
        check(before && before.includes('현장체험학습'), `${tag} 고치기 화면에 원래 본문이 없어요: ${before}`);
        const extra = Array.from({ length: 40 }, (_, i) => `${i + 1}. 긴 회의록 줄`).join('\n');
        await page.$eval('#minutes-text', (el, add) => {
            const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
            setter.call(el, `${el.value}\n${add}`);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, extra);
        /* 옛 데모 회의록은 제목 칸이 비어 있을 수 있어, 비었을 때만 제목을 적습니다(저장 조건). */
        if (!(await page.$eval('#minutes-title', (el) => el.value.trim()))) await page.type('#minutes-title', '학년회의');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="minutes-editor"] button')].find((el) => el.innerText.trim() === '저장')?.click());
        await page.waitForSelector(viewSel, { timeout: 5000 }).catch(() => {});
        check((await page.evaluate(() => location.hash)) === `#/minutes/${ID}`, `${tag} 저장한 뒤 같은 회의록 보기로 돌아오지 않아요.`);
        const body = await page.$eval('[data-role="minutes-body"]', (el) => el.textContent).catch(() => '');
        check(body === `${before}\n${extra}`, `${tag} 고친 본문이 저장되지 않았어요.`);
        await page.evaluate(() => scrollTo(0, 0));
        const long = await measure(page);
        check(long.edit && long.edit.top >= 0 && long.edit.bottom <= long.vh && long.count === 1, `${tag} 본문이 길 때 '고치기'가 처음 화면에 없어요: ${JSON.stringify(long.edit)}`);
        if (shots) await page.screenshot({ path: `${shots}/after-long-${width}.png` });

        /* 지우기 → 그만두기는 그대로 */
        await page.evaluate((sel) => [...document.querySelectorAll(`${sel} button`)].find((el) => el.innerText.trim() === '지우기')?.click(), viewSel);
        await page.waitForSelector('.minutes-confirm', { timeout: 3000 }).catch(() => {});
        check(await page.$('.minutes-confirm'), `${tag} 지우기 확인이 뜨지 않아요.`);
        await page.evaluate(() => [...document.querySelectorAll('.minutes-confirm button')].find((el) => el.innerText.trim() === '그만두기')?.click());
        await wait(200);
        check(!(await page.$('.minutes-confirm')) && await page.$(viewSel), `${tag} 그만두기 뒤 보기 화면이 그대로가 아니에요.`);
        await context.close();
    }
} catch (error) {
    failures.push(`검사 중 오류: ${error?.message || error}`);
} finally {
    await browser.close().catch(() => {});
    preview.kill('SIGKILL');
}
if (failures.length) {
    console.error(`회의록 고치기 위치 검사 실패 ${failures.length}개`);
    failures.forEach((f) => console.error(`- ${f}`));
    process.exit(1);
}
console.log('회의록 고치기 위치 검사 통과 (390·1280: 맨 위 줄·제목 위·처음 화면 안·하나뿐·글자 길이·눌림·고치기 화면 열림·저장·긴 본문·지우기 그만두기)');
