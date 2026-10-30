/** 새 판으로 다시 열 때 쓰던 글을 잃지 않는지(PR #57 r2 검수 1번): 진짜 크롬에서 입력·가려짐·다시 열기·되돌리기를 봅니다. */
import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import puppeteer from 'puppeteer-core';

const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find((p) => p && existsSync(p));
if (!chrome) { console.error('크롬을 찾지 못했습니다.'); process.exit(1); }
const lib = readFileSync(new URL('../src/lib/swReload.js', import.meta.url), 'utf8');
const html = `<!doctype html><meta charset="utf-8"><body>
<textarea aria-label="메모"></textarea><input placeholder="할 일"><input placeholder="할 일"><input type="password" name="pw">
<script type="module">
import * as sw from '/swReload.js';
window.sw = sw;
window.reloads = 0;
window.typing = sw.trackTyping(document);
window.hiddenNow = false;
Object.defineProperty(document, 'hidden', { get: () => window.hiddenNow });
window.hide = (h) => { window.hiddenNow = h; document.dispatchEvent(new Event('visibilitychange')); };
window.restored = sw.restoreDrafts(document, sessionStorage, location, 1500);
window.ready = true;
</script>`;
const server = createServer((req, res) => {
    if (req.url.startsWith('/swReload.js')) { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(lib); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/#/todo`;
const failures = [];
const check = (ok, m) => { if (!ok) failures.push(m); };
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-zygote'] });
try {
    const page = await browser.newPage();
    await page.goto(url); await page.waitForFunction('window.ready');
    /* 0) R14: 빈 칸이라도 커서가 있으면(막 쓰려는 중) 가려져도 다시 열지 않습니다. 커서를 빼면 엽니다. */
    await page.focus('textarea');
    await page.evaluate(() => { window.r14 = 0; window.r14try = window.sw.reloadWhenSafe({ typing: window.typing, reload: () => { window.r14 += 1; } }); window.hide(true); });
    check(await page.evaluate(() => window.r14) === 0, '빈 칸에 커서가 있는데 가려지자 다시 열었습니다(R14).');
    await page.evaluate(() => { document.activeElement.blur(); window.hide(false); window.hide(true); window.hide(false); });
    check(await page.evaluate(() => window.r14) === 1, '커서를 뺀 빈 화면이 가려졌는데 다시 열지 않았습니다.');
    await page.evaluate(() => sessionStorage.clear());
    /* 1) 메모를 치는 중: 가려져도 다시 열지 않습니다. */
    await page.type('textarea', '쓰던 메모 내용');
    await page.type('input[placeholder="할 일"]', '쓰던 할 일');
    await page.evaluate(() => { window.sw.reloadWhenSafe({ typing: window.typing, reload: () => { window.reloads += 1; } }); window.hide(true); });
    check(await page.evaluate(() => window.reloads) === 0, '쓰던 글이 남았는데 가려지자 다시 열었습니다.');
    /* 커서를 빼도 친 글이 남아 있으면 다시 열지 않습니다. */
    await page.evaluate(() => { document.activeElement.blur(); window.hide(false); window.hide(true); });
    check(await page.evaluate(() => window.reloads) === 0, '친 글이 남아 있는데 다시 열었습니다(커서 밖).');
    /* 2) 글을 저장해 칸이 비면(앱이 비움) 다음 가려짐에 다시 엽니다. 그 전에 남은 칸(앱이 채운 값)은 초안으로 적습니다. */
    await page.evaluate(() => {
        const set = (el, v) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, v); };
        set(document.querySelector('textarea'), '');
        const inp = document.querySelectorAll('input[placeholder="할 일"]');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp[0], '');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(inp[1], '앱이 채운 두 번째 칸');
        document.querySelector('input[name=pw]').value = '비밀';
        window.hide(false); window.hide(true);
    });
    check(await page.evaluate(() => window.reloads) === 1, `남은 글이 없어 가려졌는데 다시 열지 않았습니다: ${await page.evaluate(() => window.reloads)}`);
    const saved = await page.evaluate(() => sessionStorage.getItem('ssug-gyomu-sw-drafts'));
    check(saved && saved.includes('앱이 채운 두 번째 칸') && !saved.includes('비밀'), `초안을 적지 않았거나 비밀번호를 적었습니다: ${saved}`);
    /* 3) 진짜로 다시 열면 같은 칸(두 번째 '할 일')에 되돌립니다. */
    await page.reload(); await page.waitForFunction('window.ready');
    const n = await page.evaluate(() => window.restored);
    const vals = await page.evaluate(() => [...document.querySelectorAll('input[placeholder="할 일"]')].map((el) => el.value));
    check(n === 1 && vals[0] === '' && vals[1] === '앱이 채운 두 번째 칸', `다시 연 뒤 초안을 되돌리지 않았습니다: ${n} ${JSON.stringify(vals)}`);
    check(!(await page.evaluate(() => sessionStorage.getItem('ssug-gyomu-sw-drafts'))), '되돌린 초안을 지우지 않았습니다.');
    /* 4) 다른 화면(해시)에서는 되돌리지 않습니다. */
    await page.evaluate(() => sessionStorage.setItem('ssug-gyomu-sw-drafts', JSON.stringify({ hash: '#/note', path: '/', items: [{ k: 'textarea|메모|0', v: 'x' }] })));
    await page.reload(); await page.waitForFunction('window.ready');
    check(await page.evaluate(() => document.querySelector('textarea').value) === '', '다른 화면 초안을 넣었습니다.');
    /* 5) 화면이 늦게 그려져도(칸이 나중에 생김) 기다렸다가 되돌립니다. */
    await page.evaluate(() => {
        document.querySelector('textarea').remove();
        sessionStorage.setItem('ssug-gyomu-sw-drafts', JSON.stringify({ hash: '#/todo', path: '/', items: [{ k: 'textarea|늦은 칸|0', v: '늦게 그린 칸 초안' }] }));
        const p = window.sw.restoreDrafts(document, sessionStorage, location, 2000);
        setTimeout(() => { const t = document.createElement('textarea'); t.setAttribute('aria-label', '늦은 칸'); document.body.append(t); }, 400);
        return p;
    });
    check(await page.evaluate(() => document.querySelector('textarea[aria-label="늦은 칸"]').value) === '늦게 그린 칸 초안', '늦게 그린 칸에 초안을 되돌리지 않았습니다.');
} finally { await browser.close(); server.close(); }
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('check:swreload 통과');
