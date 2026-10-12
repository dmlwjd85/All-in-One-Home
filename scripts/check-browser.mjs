import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(new URL('..', import.meta.url).pathname);
const port = 4175;
const base = `http://127.0.0.1:${port}/`;

function chromePath() {
    if (process.env.CHROME_PATH && existsSync(process.env.CHROME_PATH)) return process.env.CHROME_PATH;
    const candidates = [
        '/usr/bin/google-chrome-stable',
        '/usr/bin/google-chrome',
        '/usr/bin/chromium',
        '/usr/bin/chromium-browser',
    ];
    return candidates.find((path) => existsSync(path)) || '';
}

function waitForPreview(child) {
    return new Promise((resolveReady, reject) => {
        let log = '';
        const timer = setTimeout(() => reject(new Error(`preview 시작 실패\n${log}`)), 30000);
        const onData = (chunk) => {
            log += chunk.toString();
            if (log.includes('Local:') || log.includes(`:${port}`)) {
                clearTimeout(timer);
                resolveReady();
            }
        };
        child.stdout.on('data', onData);
        child.stderr.on('data', onData);
        child.on('exit', (code) => {
            clearTimeout(timer);
            reject(new Error(`preview 종료 ${code}\n${log}`));
        });
    });
}

async function go(page, n) {
    await page.evaluate((num) => { location.hash = `#p${num}`; }, n);
    await page.waitForFunction((num) => {
        const rootEl = document.querySelector(`[data-page="${num}"]`);
        const body = rootEl?.querySelector('.nb-body');
        if (!body) return false;
        if (body.innerText.includes('쪽을 열고 있습니다')) return false;
        const title = rootEl.querySelector('.nb-pagetitle, .nb-cover-title');
        return Boolean(title && title.textContent.trim().length > 1);
    }, { timeout: 20000 }, n);
}

async function inspect(page) {
    return page.evaluate(() => {
        const rootEl = document.querySelector('.nb-page');
        const body = rootEl?.querySelector('.nb-body');
        const text = (body?.innerText || '').replace(/\s+/g, ' ').trim();
        const title = (rootEl?.querySelector('.nb-pagetitle, .nb-cover-title')?.innerText || '').trim();
        const overflow = document.documentElement.scrollWidth > window.innerWidth + 2;
        const paper = rootEl?.getBoundingClientRect();
        const missed = [];
        const links = [...document.querySelectorAll('.nb-body [data-to]')];
        for (const el of links) {
            const details = el.closest('details');
            if (details && !details.open) continue;
            el.scrollIntoView({ block: 'center', inline: 'nearest' });
            const rect = el.getBoundingClientRect();
            if (rect.width < 2 || rect.height < 2) {
                missed.push(`${el.getAttribute('data-to')}:size`);
                continue;
            }
            const cx = rect.left + rect.width / 2;
            const cy = rect.top + rect.height / 2;
            const inView = cx >= 0 && cy >= 0 && cx <= window.innerWidth && cy <= window.innerHeight;
            const inPaper = paper && cx >= paper.left - 1 && cx <= paper.right + 1 && cy >= paper.top - 1 && cy <= paper.bottom + 1;
            if (!inView || !inPaper) {
                missed.push(`${el.getAttribute('data-to')}:out`);
                continue;
            }
            const hit = document.elementFromPoint(cx, cy);
            const ok = hit && (hit === el || el.contains(hit) || hit.contains(el));
            if (!ok) missed.push(`${el.getAttribute('data-to')}:hit`);
        }
        window.scrollTo(0, 0);
        return {
            page: rootEl?.dataset.page,
            textLength: text.length,
            title,
            overflow,
            linkCount: links.length,
            missed,
        };
    });
}

export async function runBrowserQuality() {
    const dist = resolve(root, 'dist/index.html');
    if (!existsSync(dist)) throw new Error('dist가 없습니다. npm run build 뒤에 브라우저 검사를 실행하세요.');
    const precachePath = resolve(root, 'dist/precache-manifest.js');
    const precache = readFileSync(precachePath, 'utf8');
    if (!precache.includes('assets/') || !precache.includes('.js')) {
        throw new Error('프리캐시 목록에 빌드된 스크립트가 없습니다.');
    }
    if (!precache.includes('fonts/Pretendard-Regular.woff2') || !precache.includes('fonts/Pretendard-Bold.woff2')) {
        throw new Error('프리캐시 목록에 글꼴이 없습니다.');
    }
    const chrome = chromePath();
    if (!chrome) throw new Error('Chrome/Chromium 실행 파일을 찾지 못했습니다. CHROME_PATH를 지정하세요.');
    const puppeteer = (await import('puppeteer-core')).default;
    const preview = spawn(process.execPath, ['node_modules/vite/bin/vite.js', 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
        cwd: root,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    const browserErrors = [];
    let browser;
    try {
        await waitForPreview(preview);
        await delay(300);
        browser = await puppeteer.launch({
            executablePath: chrome,
            headless: 'new',
            args: ['--no-sandbox', '--disable-dev-shm-usage'],
        });
        const page = await browser.newPage();
        await page.evaluateOnNewDocument(() => localStorage.setItem('homenote_guest', '1'));
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.goto(base, { waitUntil: 'networkidle0', timeout: 60000 });
        await page.waitForSelector('[data-page="1"]', { timeout: 20000 });
        await page.waitForFunction(() => navigator.serviceWorker?.controller, { timeout: 20000 });
        await page.setOfflineMode(true);
        await go(page, 470);
        const offlineText = await page.$eval('[data-page="470"] .nb-body', (el) => el.innerText);
        if (/불러오지 못했|오프라인입니다/.test(offlineText) || !offlineText.includes('사업')) {
            browserErrors.push(`오프라인 미방문 구역 실패: ${offlineText.slice(0, 80)}`);
        }
        await page.setOfflineMode(false);

        const empty = [];
        const overflowPages = [];
        const unreachable = [];
        for (let n = 1; n <= 580; n += 1) {
            await go(page, n);
            const info = await inspect(page);
            if (info.overflow) overflowPages.push(n);
            if (info.textLength <= 4 || info.title.length <= 1) empty.push(`${n}:${info.title || info.textLength}`);
            if (info.missed.length) unreachable.push(`${n}:${info.missed.slice(0, 4).join(',')}`);
            const first = await page.$('.nb-body [data-to]');
            if (first) {
                const dest = Number(await page.evaluate((el) => el.getAttribute('data-to'), first));
                if (dest && dest !== n && dest >= 1 && dest <= 580) {
                    await first.click();
                    await page.waitForFunction((num) => document.querySelector(`[data-page="${num}"]`), { timeout: 8000 }, dest);
                }
            }
        }
        if (empty.length) browserErrors.push(`390px 빈 쪽 ${empty.slice(0, 12).join(' ')}`);
        if (overflowPages.length) browserErrors.push(`390px 가로 넘침 ${overflowPages.slice(0, 12).join(',')}`);
        if (unreachable.length) browserErrors.push(`390px 닿지 않는 본문 링크 ${unreachable.slice(0, 8).join(' | ')}`);

        await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 });
        await go(page, 468);
        const budget = await inspect(page);
        if (budget.missed.length || budget.linkCount < 20) {
            browserErrors.push(`1920 예산 바로가기 ${budget.linkCount}개, 막힘 ${budget.missed.slice(0, 8).join(',')}`);
        }
        const budgetCount = budget.linkCount;
        for (let i = 0; i < budgetCount; i += 1) {
            const dest = await page.evaluate((index) => {
                const el = document.querySelectorAll('.nb-body [data-to]')[index];
                el.scrollIntoView({ block: 'center', inline: 'nearest' });
                return Number(el.getAttribute('data-to'));
            }, i);
            const links = await page.$$('.nb-body [data-to]');
            await links[i].click();
            await page.waitForFunction((num) => document.querySelector(`[data-page="${num}"]`), { timeout: 8000 }, dest);
            await go(page, 468);
        }

        await go(page, 154);
        const tablePx = await page.$eval('.nb-table-text', (el) => parseFloat(getComputedStyle(el).fontSize));
        if (!(tablePx >= 14)) browserErrors.push(`표 글자 ${tablePx}px`);
        const jumpCount = await page.$$eval('.nb-roster-jump button', (els) => els.length);
        if (jumpCount !== 32) browserErrors.push(`명렬 번호 이동 ${jumpCount}개`);

        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await go(page, 2);
        const brand = await page.$eval('.nb-brand-name', (el) => getComputedStyle(el).whiteSpace);
        if (brand !== 'nowrap') browserErrors.push('휴대폰 제목이 한 줄이 아님');
        const hint = await page.$eval('.nb-tab-hint', (el) => getComputedStyle(el).display);
        if (hint === 'none') browserErrors.push('구역 탭 스크롤 힌트가 없음');
        const hintOverlap = await page.evaluate(() => {
            const hintEl = document.querySelector('.nb-tabbar-left .nb-tab-hint');
            const nav = document.querySelector('.nb-left');
            const student = [...document.querySelectorAll('.nb-left .nb-tab')].find((el) => el.textContent.trim() === '학생');
            if (!hintEl || !nav || !student) return true;
            const a = hintEl.getBoundingClientRect();
            const b = student.getBoundingClientRect();
            const box = nav.getBoundingClientRect();
            const left = Math.max(b.left, box.left);
            const right = Math.min(b.right, box.right);
            const top = Math.max(b.top, box.top);
            const bottom = Math.min(b.bottom, box.bottom);
            if (right - left < 1 || bottom - top < 1) return false;
            return !(a.right <= left || right <= a.left || a.bottom <= top || bottom <= a.top);
        });
        if (hintOverlap) browserErrors.push('옆으로 힌트가 학생 탭과 겹침');
        await go(page, 569);
        const stickerPressed = await page.$eval('.nb-sticker', (el) => el.hasAttribute('aria-pressed'));
        if (!stickerPressed) browserErrors.push('스티커 버튼에 누름 상태가 없음');

        await go(page, 159);
        const exportBtn = await page.$('[data-action="export-student"]');
        if (!exportBtn) browserErrors.push('학생 카드 내보내기 버튼이 없음');

        await go(page, 157);
        const badge = await page.$eval('.nb-local-badge', (el) => el.innerText);
        if (!badge.includes('이 기기에만 저장')) browserErrors.push('157쪽 배지가 없음');

        await page.emulateMediaType('print');
        const toolbar = await page.$eval('.nb-toolbar', (el) => getComputedStyle(el).display);
        await page.emulateMediaType('screen');
        if (toolbar !== 'none') browserErrors.push('인쇄에서 도구막대가 보임');

        const badFile = resolve(root, 'scripts/check-browser.mjs');
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
        const input = await page.$('input[type="file"]');
        await input.uploadFile(badFile);
        await page.waitForSelector('[role="status"]', { timeout: 5000 });
        const toast = await page.$eval('[role="status"]', (el) => el.innerText);
        if (!/JSON/.test(toast)) browserErrors.push(`잘못된 JSON 안내가 아님: ${toast}`);
    } finally {
        await browser?.close();
        try { process.kill(-preview.pid, 'SIGTERM'); } catch { preview.kill('SIGTERM'); }
    }
    if (browserErrors.length) {
        console.error(browserErrors.join('\n'));
        process.exit(1);
    }
    console.log('브라우저 품질 검사 통과');
}
