/** 라이브 옛 판(v90)과 지금 main(v93)에 이 판의 과제 데이터를 넣으면 노트·할 일·회의록에 안 보이는지 확인합니다. */
import { execSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, symlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import puppeteer from 'puppeteer-core';

const root = resolve('.');
const builds = [
    { label: 'v90', sha: 'e638509feea09f16e4d4ad276e299bfa8e53221c' },
    { label: 'v93', sha: '6e54c95ec24cd01802bacca49c92cda4cde51541' },
];
function prepare(sha) {
    const srcDir = `/tmp/old-app-${sha.slice(0, 10)}`;
    const dist = `${srcDir}/dist`;
    if (!existsSync(`${dist}/index.html`)) {
        mkdirSync(srcDir, { recursive: true });
        execSync(`git archive ${sha} | tar -x -C ${srcDir}`, { cwd: root, stdio: 'inherit' });
        if (!existsSync(`${srcDir}/node_modules`)) symlinkSync(resolve(root, 'node_modules'), `${srcDir}/node_modules`);
        execSync('npx vite build', { cwd: srcDir, stdio: 'inherit', env: { ...process.env, VITE_BASE: './' } });
    }
    return srcDir;
}

const freePort = () => new Promise((ok, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
        const { port } = server.address();
        server.close(() => ok(port));
    });
});
const delay = (ms) => new Promise((r) => setTimeout(r, ms));

const state = {
    profile: { className: '1반', classSize: 3, started: true, guest: true, theme: 'light', periodStarts: ['09:00', '09:40', '10:30', '11:10', '13:00', '13:40', '14:30', '15:10'] },
    students: [{ id: 's1', no: 1, name: '김하늘', active: true, source: 'app' }],
    notes: [
        { id: 'note-1', text: '준비물 메모', tags: [], pinned: true, source: 'app' },
        { id: 'meet-1', text: '회의 본문입니다', title: '학년회의', tags: ['회의'], date: '2026-11-01', pinned: false, source: 'app' },
    ],
    todos: [{ id: 't1', title: '현장체험 준비', done: false, source: 'app' }],
    homework: [{
        id: 'hw-secret', title: '비밀독서록', date: '2026-11-16', made: 10, metaAt: 10, gone: 0,
        roster: ['s1'], checks: { s1: { at: 20, on: 1 } },
    }],
};

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const browser = await puppeteer.launch({
    executablePath: process.env.CHROME_PATH || '/usr/bin/google-chrome',
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
try {
    for (const build of builds) {
        const srcDir = prepare(build.sha);
        const port = await freePort();
        const origin = `http://127.0.0.1:${port}/`;
        const preview = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
            cwd: srcDir,
            stdio: 'ignore',
        });
        try {
            for (let i = 0; i < 80; i += 1) {
                try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
                await delay(150);
            }
            const page = await browser.newPage();
            await page.goto(origin, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.evaluate(async (saved) => {
                localStorage.setItem('ssug-gyomu-onboard', JSON.stringify({ notice: 'folded', auto: false, day: '', steps: {} }));
                localStorage.setItem('ssug-gyomu-home-fold', JSON.stringify({ time: true, todo: true, event: true, recent: true }));
                await new Promise((ok, fail) => {
                    const request = indexedDB.open('ssug-gyomu', 1);
                    request.onupgradeneeded = () => {
                        if (!request.result.objectStoreNames.contains('kv')) request.result.createObjectStore('kv');
                    };
                    request.onerror = () => fail(request.error);
                    request.onsuccess = () => {
                        const tx = request.result.transaction('kv', 'readwrite');
                        tx.objectStore('kv').put(saved, 'state');
                        tx.oncomplete = () => ok();
                        tx.onerror = () => fail(tx.error);
                    };
                });
            }, state);
            async function textAt(hash) {
                await page.goto(`${origin}${hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
                await delay(400);
                return page.evaluate(() => document.body.innerText);
            }
            const todo = await textAt('#/todo');
            const minutes = await textAt('#/minutes');
            const today = await textAt('#/today');
            for (const [name, text] of [['할 일', todo], ['회의록', minutes], ['오늘', today]]) {
                check(!text.includes('비밀독서록') && !text.includes('@@HW1') && !text.includes('과제 체크 기록'), `${build.label} ${name} 화면에 과제 데이터가 보입니다: ${text.slice(0, 240)}`);
            }
            check(todo.includes('준비물 메모') && todo.includes('현장체험 준비'), `${build.label} 할 일·메모가 안 보입니다: ${todo.slice(0, 240)}`);
            check(minutes.includes('학년회의') && !minutes.includes('비밀독서록'), `${build.label} 회의록 목록이 이상합니다: ${minutes.slice(0, 240)}`);
            await page.close();
        } finally {
            preview.kill();
        }
    }
} finally {
    await browser.close();
}
if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('v90과 v93 노트·할 일·회의록·오늘 화면에 과제가 보이지 않습니다.');
