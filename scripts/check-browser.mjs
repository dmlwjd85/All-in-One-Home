/** 360·390·1280에서 넘침과 버튼 크기, 주요 흐름을 확인하고 화면을 저장합니다. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import puppeteer from 'puppeteer-core';

const root = resolve(new URL('..', import.meta.url).pathname);
const shots = prepareShots();
const port = 4175;
const origin = `http://127.0.0.1:${port}/`;
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/local/bin/google-chrome', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find((path) => path && existsSync(path));
if (!chrome) {
    console.error('크롬을 찾지 못했습니다.');
    process.exit(1);
}

function prepareShots() {
    const candidates = [process.env.SCREENSHOT_DIR, '/opt/cursor/artifacts/screenshots', '/tmp/ssug-screenshots'].filter(Boolean);
    for (const dir of candidates) {
        try {
            mkdirSync(dir, { recursive: true });
            return dir;
        } catch {
            /* 쓸 수 없는 경로면 다음으로 넘어갑니다. */
        }
    }
    throw new Error('화면을 저장할 곳을 만들지 못했습니다.');
}

const chromeArgs = [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-software-rasterizer',
    '--disable-extensions',
    '--disable-background-networking',
    '--disable-sync',
    '--disable-default-apps',
    '--no-first-run',
    '--no-default-browser-check',
    '--mute-audio',
    '--hide-scrollbars',
    '--metrics-recording-only',
];

const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');
const preview = spawn(process.execPath, [viteBin, 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
    cwd: root,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, CI: '1', BROWSER: 'none' },
});
let log = '';
preview.stdout.on('data', (chunk) => { log += chunk; });
preview.stderr.on('data', (chunk) => { log += chunk; });

async function waitServer() {
    for (let i = 0; i < 40; i += 1) {
        try {
            const res = await fetch(origin);
            if (res.ok) return;
        } catch { /* 아직 안 열림 */ }
        await delay(250);
    }
    throw new Error('미리보기가 열리지 않았습니다.');
}

const failures = [];
function check(ok, message) {
    if (!ok) failures.push(message);
}

let settled = false;

function descendants(pid, found = []) {
    let names = [];
    try { names = readdirSync('/proc'); } catch { return found; }
    for (const name of names) {
        if (!/^\d+$/.test(name)) continue;
        try {
            const stat = readFileSync(`/proc/${name}/stat`, 'utf8');
            const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
            const parent = Number(after[1]);
            if (parent !== pid) continue;
            const child = Number(name);
            descendants(child, found);
            found.push(child);
        } catch { /* 프로세스가 이미 없습니다. */ }
    }
    return found;
}

function killTree(child) {
    const pid = child?.pid;
    if (!pid) return;
    for (const id of descendants(pid)) {
        try { process.kill(id, 'SIGKILL'); } catch { /* 이미 끝났습니다. */ }
    }
    try { process.kill(-pid, 'SIGKILL'); } catch { /* 프로세스 그룹이 없습니다. */ }
    try { process.kill(pid, 'SIGKILL'); } catch { /* 이미 끝났습니다. */ }
}

async function shutdown(code) {
    if (settled) return;
    settled = true;
    clearTimeout(watchdog);
    const chromeProc = browser?.process?.();
    await Promise.race([
        browser?.close().catch(() => {}),
        delay(2000),
    ]);
    killTree(chromeProc);
    browser = null;
    try {
        preview.stdout?.destroy();
        preview.stderr?.destroy();
    } catch { /* 파이프가 이미 닫혔습니다. */ }
    killTree(preview);
    process.exit(code);
}

const watchdog = setTimeout(() => {
    console.error('브라우저 검사가 6분을 넘겨 멈춰서 끝냅니다.');
    shutdown(1);
}, 6 * 60 * 1000);

let browser = null;

async function launchBrowser() {
    const next = await puppeteer.launch({
        executablePath: chrome,
        headless: true,
        timeout: 45000,
        protocolTimeout: 45000,
        dumpio: false,
        args: [...chromeArgs, '--no-zygote'],
    });
    next.on('disconnected', () => {
        if (browser === next) browser = null;
    });
    return next;
}

async function ensureBrowser() {
    if (browser && browser.connected) return browser;
    let last;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
            browser = await launchBrowser();
            return browser;
        } catch (error) {
            last = error;
            browser = null;
            await delay(500);
        }
    }
    throw last;
}

async function resetBrowser() {
    if (browser) await browser.close().catch(() => {});
    browser = null;
}

async function withPage(width, fn) {
    let last;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        let context;
        try {
            const current = await ensureBrowser();
            context = await current.createBrowserContext();
            const page = await context.newPage();
            page.setDefaultTimeout(20000);
            page.setDefaultNavigationTimeout(30000);
            await page.setViewport({ width, height: 800, deviceScaleFactor: 1 });
            await fn(page);
            await context.close().catch(() => {});
            return;
        } catch (error) {
            last = error;
            await context?.close().catch(() => {});
            await resetBrowser();
            await delay(400);
        }
    }
    throw last;
}

async function withDemo(width, mode, fn, height = 800) {
    let last;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
        let context;
        try {
            const current = await ensureBrowser();
            context = await current.createBrowserContext();
            const page = await context.newPage();
            page.setDefaultTimeout(20000);
            page.setDefaultNavigationTimeout(30000);
            await page.setViewport({ width, height, deviceScaleFactor: 1 });
            const query = mode === 'dark' ? 'demo=1&at=08:42&mode=dark' : 'demo=1&at=08:42&mode=light';
            await page.goto(`${origin}?${query}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
            await page.waitForFunction(() => document.body.innerText.includes('오늘 우리 반'), { timeout: 15000 });
            await fn(page);
            await context.close().catch(() => {});
            return;
        } catch (error) {
            last = error;
            await context?.close().catch(() => {});
            await resetBrowser();
            await delay(400);
        }
    }
    throw last;
}

async function audit(page, label) {
    const result = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const overflow = [];
        if (document.documentElement.scrollWidth > width + 1) overflow.push(`문서 ${document.documentElement.scrollWidth}`);
        const nodes = [...document.body.querySelectorAll('*')];
        for (const el of nodes) {
            const style = getComputedStyle(el);
            if (style.position === 'fixed') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 2 || rect.height < 2) continue;
            if (rect.right > width + 1.5 && rect.left >= -1) {
                overflow.push((el.getAttribute('aria-label') || el.textContent || el.className || '').toString().trim().slice(0, 24));
                if (overflow.length > 8) break;
            }
        }
        const small = [];
        for (const el of document.querySelectorAll('button, a, input, textarea, select')) {
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden') continue;
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) continue;
            if (rect.width < 43.5 || rect.height < 43.5) {
                small.push(`${(el.getAttribute('aria-label') || el.innerText || el.tagName).toString().trim().slice(0, 18)} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
            }
        }
        return { overflow, small: small.slice(0, 12) };
    });
    if (result.overflow.length) failures.push(`${label} 가로 넘침: ${result.overflow.join(', ')}`);
    if (result.small.length) failures.push(`${label} 44px 미만: ${result.small.join(', ')}`);
}

async function openPlus(page) {
    await page.evaluate(() => {
        const buttons = [...document.querySelectorAll('[aria-label="할 일 고르기"]')];
        const visible = buttons.find((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0;
        });
        visible?.click();
    });
    await page.waitForSelector('[data-screen="plus"]');
}

async function choiceFit(page, screen, scope = '') {
    return page.evaluate((name, scopeSelector) => {
        const sheetRoot = document.querySelector(`[data-screen="${name}"]`);
        if (!sheetRoot) return { missing: true };
        const root = scopeSelector ? sheetRoot.querySelector(scopeSelector) : sheetRoot;
        if (!root) return { missing: true };
        const sheet = sheetRoot.classList.contains('sheet') ? sheetRoot : (sheetRoot.querySelector('.sheet') || sheetRoot);
        const buttons = [...root.querySelectorAll('.choice-grid button')];
        const view = sheet.getBoundingClientRect();
        const hidden = [];
        const clipped = [];
        const small = [];
        const rects = buttons.map((el) => el.getBoundingClientRect());
        buttons.forEach((el, index) => {
            const rect = rects[index];
            const text = el.innerText.replace(/\s+/g, ' ').trim();
            if (rect.top < view.top - 1 || rect.bottom > Math.min(view.bottom, window.innerHeight) + 1 || rect.left < 0 || rect.right > window.innerWidth + 1) {
                hidden.push(text.slice(0, 24));
            }
            if (rect.width < 43.5 || rect.height < 43.5) small.push(`${text.slice(0, 12)} ${Math.round(rect.width)}×${Math.round(rect.height)}`);
            const range = document.createRange();
            range.selectNodeContents(el);
            const ink = range.getBoundingClientRect();
            if (ink.width > 1 && (ink.right > rect.right + 1 || ink.bottom > rect.bottom + 1 || ink.left < rect.left - 1)) {
                clipped.push(text.slice(0, 24));
            }
        });
        const overlaps = [];
        for (let i = 0; i < rects.length; i += 1) {
            for (let j = i + 1; j < rects.length; j += 1) {
                const a = rects[i];
                const b = rects[j];
                const hit = a.left < b.right - 1 && a.right > b.left + 1 && a.top < b.bottom - 1 && a.bottom > b.top + 1;
                if (hit) overlaps.push(`${buttons[i].innerText.trim().slice(0, 8)}/${buttons[j].innerText.trim().slice(0, 8)}`);
            }
        }
        return {
            scroll: sheet.scrollHeight > sheet.clientHeight + 2,
            hidden,
            clipped,
            small,
            overlaps: overlaps.slice(0, 8),
            selects: sheetRoot.querySelectorAll('select').length,
            labels: buttons.map((el) => el.innerText.replace(/\s+/g, ' ').trim()),
        };
    }, screen, scope);
}

function reportChoice(label, result, { allowScroll = false } = {}) {
    if (!result || result.missing) {
        failures.push(`${label}: 분류 화면이 없습니다.`);
        return;
    }
    if (!allowScroll && result.scroll) failures.push(`${label}: 선택지가 한 화면을 넘어 스크롤이 생깁니다.`);
    if (result.hidden.length) failures.push(`${label}: 화면에 다 안 보이는 선택지 ${result.hidden.join(', ')}`);
    if (result.clipped.length) failures.push(`${label}: 글자가 잘림 ${result.clipped.join(', ')}`);
    if (result.small.length) failures.push(`${label}: 44px 미만 ${result.small.join(', ')}`);
    if (result.overlaps.length) failures.push(`${label}: 글자나 칸이 겹침 ${result.overlaps.join(', ')}`);
    if (result.selects) failures.push(`${label}: 드롭다운이 남아 있습니다.`);
}

async function tipCover(page) {
    return page.evaluate(() => {
        const tip = document.querySelector('.tip-bubble, .tip-bulb');
        const tab = document.querySelector('.tabbar');
        const todo = document.querySelector('.home-todo');
        if (!tip || !tab) return '팁이나 하단 탭이 없습니다.';
        const hit = (a, b) => {
            const left = a.getBoundingClientRect();
            const right = b.getBoundingClientRect();
            return left.bottom > right.top + 1 && left.top < right.bottom - 1 && left.right > right.left + 1 && left.left < right.right - 1;
        };
        if (hit(tip, tab)) return '팁이 하단 탭을 가립니다.';
        if (todo && hit(tip, todo)) return '팁이 오늘 할 일을 가립니다.';
        return '';
    });
}

try {
    await waitServer();
    await ensureBrowser();
    const scenes = [
        ['home-360-lilac.png', 360, 'light', async (page) => page],
        ['attend-360-lilac.png', 360, 'light', async (page) => { await page.evaluate(() => { location.hash = '#/attend'; }); await delay(200); }],
        ['record-360-lilac.png', 360, 'light', async (page) => { await page.evaluate(() => { location.hash = '#/students/12'; }); await page.waitForFunction(() => document.body.innerText.includes('이하은')); }],
        ['quick-360-lilac.png', 360, 'light', async (page) => { await page.click('[aria-label="할 일 고르기"]'); await page.waitForSelector('[aria-label="할 일 고르기"][role="dialog"]'); }],
        ['home-360-dark.png', 360, 'dark', async () => {}],
        ['attend-360-dark.png', 360, 'dark', async (page) => { await page.evaluate(() => { location.hash = '#/attend'; }); await delay(200); }],
        ['record-360-dark.png', 360, 'dark', async (page) => { await page.evaluate(() => { location.hash = '#/students/12'; }); await page.waitForFunction(() => document.body.innerText.includes('이하은')); }],
        ['quick-360-dark.png', 360, 'dark', async (page) => { await page.click('[aria-label="할 일 고르기"]'); await delay(250); }],
        ['home-1280-lilac.png', 1280, 'light', async () => {}],
    ];

    for (const [name, width, mode, prepare] of scenes) {
        await withDemo(width, mode, async (page) => {
            await prepare(page);
            await delay(250);
            await audit(page, name);
            if (name === 'home-360-lilac.png') {
                const covered = await tipCover(page);
                if (covered) failures.push(covered);
                await page.evaluate(() => document.querySelector('.home-todo')?.scrollIntoView({ block: 'center' }));
                await delay(150);
                const coveredTodo = await tipCover(page);
                if (coveredTodo) failures.push(`할 일 화면: ${coveredTodo}`);
                await page.screenshot({ path: resolve(shots, 'home-360-todo.png') });
                await page.evaluate(() => window.scrollTo(0, 0));
                await delay(100);
            }
            await page.screenshot({ path: resolve(shots, name) });
        });
    }

    for (const width of [360, 390]) {
        await withDemo(width, 'light', async (page) => {
            await page.evaluate(() => { location.hash = '#/schedule'; });
            await delay(200);
            await audit(page, `일정 ${width}`);
            await page.evaluate(() => { location.hash = '#/settings'; });
            await delay(200);
            await audit(page, `설정 ${width}`);
            if (width === 360) {
                const covered = await tipCover(page);
                if (covered) failures.push(`설정: ${covered}`);
                await page.screenshot({ path: resolve(shots, 'settings-360-lilac.png') });
            }
            await page.evaluate(() => { location.hash = '#/todo'; });
            await delay(200);
            await audit(page, `할일 ${width}`);
        });
    }

    await withDemo(390, 'light', async (page) => {
        const homeText = await page.evaluate(() => document.body.innerText);
        check(homeText.includes('1교시') && homeText.includes('18분'), '홈에 다음 교시 18분이 없습니다.');
        check(homeText.includes('박서준') && homeText.includes('결석'), '홈에 결석이 없습니다.');
        await page.click('[aria-label="할 일 고르기"]');
        await page.waitForFunction(() => document.body.innerText.includes('회의록 작성'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('관찰'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('누구'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('이하은'))?.click());
        await page.waitForSelector('textarea');
        await page.type('textarea', '@12 #학습 내일 정리까지 맡았어요');
        await page.keyboard.press('Enter');
        await page.waitForFunction(() => document.body.innerText.includes('되돌리기'));
        await page.click('button::-p-text(되돌리기)').catch(async () => {
            const buttons = await page.$$('button');
            for (const button of buttons) {
                const text = await page.evaluate((el) => el.innerText, button);
                if (text.includes('되돌리기')) { await button.click(); return; }
            }
        });
        await page.evaluate(() => { location.hash = '#/attend'; });
        await page.waitForFunction(() => document.body.innerText.includes('출석·결석'));
        const clicked = await page.evaluate(() => {
            const button = [...document.querySelectorAll('button')].find((el) => el.innerText.includes('김하늘'));
            button?.click();
            return Boolean(button);
        });
        check(clicked, '출결 칸을 누르지 못했습니다.');
        await page.waitForFunction(() => [...document.querySelectorAll('button')].some((el) => el.innerText.trim() === '결석'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.trim() === '결석')?.click());
        await delay(250);
        const attendText = await page.evaluate(() => document.body.innerText);
        check(attendText.includes('김하늘') && attendText.includes('결석'), '출결을 눌러도 결석이 되지 않습니다.');

        await page.setViewport({ width: 360, height: 800, deviceScaleFactor: 1 });
        await page.evaluate(async () => {
            const db = await new Promise((resolveDb, reject) => {
                const req = indexedDB.open('ssug-gyomu');
                req.onsuccess = () => resolveDb(req.result);
                req.onerror = () => reject(req.error);
            });
            const store = db.transaction('kv', 'readwrite').objectStore('kv');
            const state = await new Promise((resolveState, reject) => {
                const req = store.get('state');
                req.onsuccess = () => resolveState(req.result);
                req.onerror = () => reject(req.error);
            });
            const student = state.students.find((row) => row.no === 3);
            student.memo = '건강 특이';
            await new Promise((resolvePut, reject) => {
                const req = store.put(state, 'state');
                req.onsuccess = () => resolvePut();
                req.onerror = () => reject(req.error);
            });
        });
        await page.goto(`${origin}?mode=light&at=08:42`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.evaluate(() => { location.hash = '#/students/3'; });
        await page.waitForFunction(() => document.body.innerText.includes('이 메모는 이 기기에만 있어요'), { timeout: 8000 });
        await page.screenshot({ path: resolve(shots, 'student-memo-360.png') });
    });

    await withDemo(390, 'light', async (page) => {
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
        await page.screenshot({ path: resolve(shots, 'after_home_390.png') });
        await openPlus(page);
        await page.waitForFunction(() => document.body.innerText.includes('메시지 붙여넣기') && document.body.innerText.includes('보호자'));
        const plus = await choiceFit(page, 'plus');
        reportChoice('＋ 메뉴 390', plus);
        const need = ['회의록 작성', '출결 체크', '메시지 붙여넣기', '할 일', '일정', '관찰', '상담', '알림장', '메모', '칭찬', '보호자'];
        for (const label of need) {
            if (!plus.labels?.some((item) => item.includes(label))) failures.push(`＋ 메뉴에 ${label}이 없습니다.`);
        }
        const confirm = await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].some((el) => /^(확인|선택|완료)$/.test(el.innerText.trim())));
        check(!confirm, '＋ 메뉴에 확인 버튼이 있습니다.');
        await page.screenshot({ path: resolve(shots, 'after_plus_390.png') });

        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.includes('일정') && !el.innerText.includes('알림'))?.click());
        await page.waitForSelector('[data-screen="flow"]');
        await page.waitForFunction(() => document.body.innerText.includes('일정 종류'));
        const eventKind = await choiceFit(page, 'flow');
        reportChoice('일정 종류 390', eventKind);
        for (const label of ['학급', '학교', '휴일', '내 일정']) {
            if (!eventKind.labels?.some((item) => item.includes(label))) failures.push(`일정 종류에 ${label}이 없습니다.`);
        }
        await page.screenshot({ path: resolve(shots, 'after_event_kind_390.png') });
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="flow"] button')].find((el) => el.innerText.trim() === '학교')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('날짜'));
        check(!(await page.evaluate(() => document.body.innerText.includes('일정 종류'))), '일정 종류를 눌러도 다음 단계로 넘어가지 않습니다.');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-screen="flow"]'));

        await openPlus(page);
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.includes('회의록 작성'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('회의 종류'));
        const meet = await choiceFit(page, 'flow');
        reportChoice('회의록 종류 390', meet);
        for (const label of ['학년회의', '교직원회의', '교과협의회', '학부모회의', '연수']) {
            if (!meet.labels?.some((item) => item.includes(label))) failures.push(`회의 종류에 ${label}이 없습니다.`);
        }
        await page.screenshot({ path: resolve(shots, 'after_meet_kind_390.png') });
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="flow"] button')].find((el) => el.innerText.trim() === '교과협의회')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('날짜') && !document.body.innerText.includes('회의 종류'));
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-screen="flow"]'));

        await page.evaluate(() => { location.hash = '#/attend'; });
        await page.waitForFunction(() => document.body.innerText.includes('출석·결석'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('김하늘'))?.click());
        await page.waitForSelector('[data-screen="attend-status"]');
        const status = await choiceFit(page, 'attend-status');
        reportChoice('출결 상태 390', status);
        for (const label of ['출석', '결석', '지각', '조퇴', '결과']) {
            if (!status.labels?.includes(label)) failures.push(`출결 상태에 ${label}이 없습니다.`);
        }
        await page.screenshot({ path: resolve(shots, 'after_attend_status_390.png') });
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="attend-status"] button')].find((el) => el.innerText.trim() === '조퇴')?.click());
        await page.waitForFunction(() => document.body.innerText.includes('몇 교시'));
        const periodSmall = await page.evaluate(() => [...document.querySelectorAll('[aria-label$="교시"]')].filter((el) => {
            const rect = el.getBoundingClientRect();
            return rect.width > 0 && (rect.width < 43.5 || rect.height < 43.5);
        }).map((el) => el.getAttribute('aria-label')));
        if (periodSmall.length) failures.push(`교시 버튼이 44px 미만: ${periodSmall.join(', ')}`);
        check(!(await page.evaluate(() => [...document.querySelectorAll('[data-screen="attend-status"] button')].some((el) => el.innerText.trim() === '저장'))), '출결에 따로 저장 버튼이 있습니다.');
        await page.keyboard.press('Escape');
        await page.waitForFunction(() => !document.querySelector('[data-screen="attend-status"]'));

        await openPlus(page);
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.includes('메시지 붙여넣기'))?.click());
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.type('[data-screen="message"] textarea', '내일 5교시 공개수업이 있습니다. 가정통신문 내일까지 회신 바랍니다.');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('개 등록') && document.body.innerText.includes('할 일'));
        const preview = await choiceFit(page, 'message', '.msg-card');
        reportChoice('메시지 분류 390', preview, { allowScroll: true });
        check(preview.labels?.some((item) => item.includes('할 일')) && preview.labels?.some((item) => item === '일정' || item.endsWith('일정')), '메시지 카드에 할 일/일정 칩이 없습니다.');
        const kindOn = await page.evaluate(() => {
            const grid = document.querySelector('[aria-label="할 일 또는 일정"]');
            const on = grid?.querySelector('.on');
            return on?.innerText.trim() || '';
        });
        check(kindOn === '일정', `메시지 분류가 일정으로 보이지 않습니다. (${kindOn})`);
        await page.screenshot({ path: resolve(shots, 'after_message_390.png') });
        await page.evaluate(() => [...document.querySelectorAll('[aria-label="할 일 또는 일정"] button')].find((el) => el.innerText.trim() === '할 일')?.click());
        const switched = await page.evaluate(() => {
            const grid = document.querySelector('[aria-label="할 일 또는 일정"]');
            const on = grid?.querySelector('.on')?.innerText.trim();
            const eventGrid = document.querySelector('[aria-label="일정 종류"]');
            const save = [...document.querySelectorAll('button')].some((el) => el.innerText.includes('개 등록'));
            return { on, eventGrid: Boolean(eventGrid), save };
        });
        check(switched.on === '할 일' && !switched.eventGrid && switched.save, '분류 칩을 한 번 눌러도 바로 바뀌지 않습니다.');
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('개 등록'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('되돌리기'));
        await page.screenshot({ path: resolve(shots, 'after_message_saved_390.png') });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('되돌리기'))?.click());
        let undone = true;
        for (let attempt = 0; attempt < 10; attempt += 1) {
            undone = await page.evaluate(async () => {
                const db = await new Promise((resolveDb, reject) => {
                    const req = indexedDB.open('ssug-gyomu');
                    req.onsuccess = () => resolveDb(req.result);
                    req.onerror = () => reject(req.error);
                });
                const state = await new Promise((resolveState, reject) => {
                    const req = db.transaction('kv').objectStore('kv').get('state');
                    req.onsuccess = () => resolveState(req.result);
                    req.onerror = () => reject(req.error);
                });
                const titles = [...(state.todos || []), ...(state.local?.todos || []), ...(state.events || []), ...(state.local?.events || [])].map((row) => row.title);
                return titles.some((title) => String(title).includes('공개수업') || String(title).includes('가정통신문'));
            });
            if (!undone) break;
            await delay(200);
        }
        check(!undone, '되돌리기 뒤에도 메시지 항목이 남아 있습니다.');
    }, 844);

    await withDemo(1280, 'light', async (page) => {
        await audit(page, '홈 16:9');
        await page.screenshot({ path: resolve(shots, 'after_home_16x9.png') });
        await openPlus(page);
        const plus = await choiceFit(page, 'plus');
        reportChoice('＋ 메뉴 16:9', plus);
        await audit(page, '＋ 16:9');
        await page.screenshot({ path: resolve(shots, 'after_plus_16x9.png') });
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => el.innerText.includes('메시지 붙여넣기'))?.click());
        await page.waitForSelector('[data-screen="message"] textarea');
        await page.type('[data-screen="message"] textarea', '내일 5교시 공개수업이 있습니다');
        await page.evaluate(() => [...document.querySelectorAll('[data-screen="message"] button')].find((el) => el.innerText.includes('이 메시지 읽기'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('개 등록'));
        const preview = await choiceFit(page, 'message', '.msg-card');
        reportChoice('메시지 16:9', preview, { allowScroll: true });
        await page.screenshot({ path: resolve(shots, 'after_message_16x9.png') });
    }, 720);

    await withPage(390, async (page) => {
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('homenote_v2_classRoster', JSON.stringify([{ id: '1', name: '김하늘' }]));
        });
        await page.goto(`${origin}?mode=light`, { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => document.body.innerText.includes('이 기기에서만'), { timeout: 8000 });
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('이 기기에서만'))?.click());
        await page.waitForFunction(() => document.body.innerText.includes('예전 교무수첩'));
        const still = await page.evaluate(() => localStorage.getItem('homenote_v2_classRoster'));
        check(still && still.includes('김하늘'), '시작 화면이 원본 키를 지웠습니다.');
    });

    await withDemo(390, 'light', async (page) => {
        await page.evaluate(async () => {
            if (!navigator.serviceWorker) return false;
            return Promise.race([
                navigator.serviceWorker.ready.then((reg) => Boolean(reg.active || reg.installing || reg.waiting)),
                new Promise((resolveReady) => { setTimeout(() => resolveReady(false), 8000); }),
            ]);
        });
        await page.reload({ waitUntil: 'domcontentloaded' });
        await page.setOfflineMode(true);
        await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await delay(400);
        const offlineText = await page.evaluate(() => document.body.innerText).catch(() => '');
        check(offlineText.includes('쓱') || offlineText.includes('인터넷'), '오프라인에서 껍데기가 열리지 않습니다.');
    });
} catch (error) {
    failures.push(error?.message || String(error));
}

if (failures.length) {
    console.error(failures.join('\n'));
    if (log && !/AIza|apiKey|VITE_FIREBASE/.test(log)) console.error(log.slice(-2000));
    await shutdown(1);
}
console.log(`브라우저 검사를 통과했습니다. 화면은 ${shots} 에 있습니다.`);
await shutdown(0);
