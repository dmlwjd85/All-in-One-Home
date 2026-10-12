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

async function geometryHits(page) {
    return page.evaluate(() => {
        document.querySelectorAll('.nb-body, .nb-stage-wrap').forEach((el) => {
            el.scrollTop = 0;
        });
        const hits = [];
        const slop = 2;
        const visibleBox = (el) => {
            if (!el) return null;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return null;
            return rect;
        };
        const overlaps = (a, b) => Boolean(a && b) && !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
        const inside = (box, host) => box.top >= host.top - slop && box.bottom <= host.bottom + slop && box.left >= host.left - slop && box.right <= host.right + slop;
        const labelOf = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '컨트롤').trim().replace(/\s+/g, ' ').slice(0, 18);
        const num = document.querySelector('.nb-toolbar-num');
        const numBox = visibleBox(num);
        const numText = (num?.textContent || '').trim();
        const wide = window.innerWidth >= 700;
        const numOk = wide ? /^p\.\d+\/580$/.test(numText) : /^p\.\d+$/.test(numText);
        if (!numOk) hits.push(`쪽번호 문구 ${numText}`);
        if (num && num.scrollWidth > num.clientWidth + 1) hits.push(`쪽번호 잘림 ${numText}`);
        if (numBox && (numBox.left < -1 || numBox.right > window.innerWidth + 1)) hits.push('쪽번호가 화면 밖');
        if (numBox) {
            for (const x of [numBox.left + 1, (numBox.left + numBox.right) / 2, numBox.right - 1]) {
                const hit = document.elementFromPoint(x, (numBox.top + numBox.bottom) / 2);
                if (hit && hit !== num && !num.contains(hit)) hits.push(`쪽번호가 가려짐 ${numText}`);
            }
        }
        for (const btn of document.querySelectorAll('.nb-toolbar-actions button')) {
            if (overlaps(numBox, visibleBox(btn))) hits.push(`쪽번호·버튼 ${btn.getAttribute('aria-label') || btn.textContent.trim()}`);
        }
        const pageEl = document.querySelector('.nb-page');
        const paper = visibleBox(pageEl);
        const title = document.querySelector('.nb-pagetitle');
        const bar = title?.closest('.nb-titlebar');
        if (title && bar) {
            const before = getComputedStyle(bar, '::before');
            const titleBox = title.getBoundingClientRect();
            const barBox = bar.getBoundingClientRect();
            if (before.content !== 'none' && before.position === 'absolute') {
                const tapeBottom = barBox.top + (parseFloat(before.top) || 0) + (parseFloat(before.height) || 0);
                if (titleBox.top < tapeBottom - 1) hits.push('제목 장식이 제목과 겹침');
            } else if (before.position === 'relative' || before.position === 'static') {
                const tapeH = parseFloat(before.height) || 0;
                if (tapeH > 0 && titleBox.top < barBox.top + tapeH - 1) hits.push('제목 장식이 제목과 겹침');
            }
        }
        for (const tabbar of document.querySelectorAll('.nb-tabbar')) {
            const hint = tabbar.querySelector('.nb-tab-hint');
            const hintBox = visibleBox(hint);
            const nav = tabbar.querySelector('.nb-left, .nb-right');
            const navBox = visibleBox(nav);
            if (hint && hint.scrollWidth > hint.clientWidth + 1) hits.push('힌트 잘림');
            if (hintBox && hintBox.top < window.innerHeight && hintBox.bottom > 0 && (hintBox.right > window.innerWidth + 1 || hintBox.left < -1)) {
                hits.push('힌트가 화면 밖');
            }
            for (const tab of tabbar.querySelectorAll('.nb-tab')) {
                const tabBox = visibleBox(tab);
                if (overlaps(hintBox, tabBox)) {
                    hits.push(`힌트·탭 ${tab.textContent.trim()}`);
                    break;
                }
            }
            const current = tabbar.querySelector('.nb-tab[aria-current="page"]');
            const currentBox = visibleBox(current);
            if (currentBox && navBox && !inside(currentBox, navBox)) hits.push(`선택탭 잘림 ${current.textContent.trim()}`);
            if (currentBox && paper && !inside(currentBox, paper)) hits.push(`선택탭이 용지 밖 ${current.textContent.trim()}`);
        }
        const jump = document.querySelector('.nb-roster-jump');
        if (jump && paper) {
            if (jump.scrollWidth > jump.clientWidth + 1) hits.push('번호 칩이 가로로 스크롤됨');
            for (const chip of jump.querySelectorAll('button')) {
                const chipBox = visibleBox(chip);
                if (!chipBox) {
                    hits.push(`번호 칩 안 보임 ${chip.textContent.trim()}`);
                    break;
                }
                if (!inside(chipBox, paper)) {
                    hits.push(`번호 칩 잘림 ${chip.textContent.trim()}`);
                    break;
                }
            }
        }
        const fab = document.querySelector('.nb-fab-btn');
        const fabBox = visibleBox(fab);
        if (fabBox && paper && wide && overlaps(fabBox, paper)) hits.push('쓱적이 용지 안');
        if (fabBox) {
            const stage = document.querySelector('.nb-stage-wrap')?.getBoundingClientRect();
            const nodes = document.querySelectorAll('.nb-body button, .nb-body input, .nb-body select, .nb-body textarea, .nb-body a, .nb-tab');
            for (const el of nodes) {
                if (el.classList.contains('sr-only')) continue;
                const elBox = visibleBox(el);
                if (!elBox) continue;
                if (elBox.bottom < 0 || elBox.top > window.innerHeight || elBox.right < 0 || elBox.left > window.innerWidth) continue;
                if (!overlaps(fabBox, elBox)) continue;
                if (stage) {
                    const top = Math.max(fabBox.top, elBox.top, stage.top);
                    const bottom = Math.min(fabBox.bottom, elBox.bottom, stage.bottom);
                    const left = Math.max(fabBox.left, elBox.left, stage.left);
                    const right = Math.min(fabBox.right, elBox.right, stage.right);
                    if (bottom - top < 1 || right - left < 1) continue;
                }
                hits.push(`쓱적·${labelOf(el)}`);
                break;
            }
        }
        if (pageEl && paper) {
            const controls = pageEl.querySelectorAll('button, input, select, textarea, a');
            let clipped = 0;
            for (const el of controls) {
                if (el.closest('.nb-fab') || el.classList.contains('sr-only')) continue;
                if (el.classList.contains('nb-tab') && el.getAttribute('aria-current') !== 'page') continue;
                const box = visibleBox(el);
                if (!box) continue;
                if (inside(box, paper)) continue;
                const ix = Math.min(box.right, paper.right) - Math.max(box.left, paper.left);
                const iy = Math.min(box.bottom, paper.bottom) - Math.max(box.top, paper.top);
                const partial = ix > 1 && iy > 1;
                let scrollable = false;
                if (!partial) {
                    let node = el.parentElement;
                    while (node && node !== pageEl.parentElement) {
                        const style = getComputedStyle(node);
                        const host = node.getBoundingClientRect();
                        const hostInPage = inside(host, paper);
                        const scrollY = (style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight + 1;
                        const scrollX = (style.overflowX === 'auto' || style.overflowX === 'scroll') && node.scrollWidth > node.clientWidth + 1;
                        const vertical = box.top < paper.top - slop || box.bottom > paper.bottom + slop;
                        const horizontal = box.left < paper.left - slop || box.right > paper.right + slop;
                        if (hostInPage && ((vertical && scrollY && box.height <= node.clientHeight + slop) || (horizontal && scrollX && box.width <= node.clientWidth + slop))) {
                            const revealsY = !vertical || (scrollY && box.height <= node.clientHeight + slop);
                            const revealsX = !horizontal || (scrollX && box.width <= node.clientWidth + slop);
                            if (revealsY && revealsX) {
                                scrollable = true;
                                break;
                            }
                        }
                        node = node.parentElement;
                    }
                }
                if (partial || !scrollable) {
                    clipped += 1;
                    if (clipped <= 2) hits.push(`잘린 버튼 ${labelOf(el)}`);
                }
            }
            if (clipped > 2) hits.push(`잘린 버튼 ${clipped}개`);
        }
        if (window.innerWidth >= 1367) {
            const table = document.querySelector('.nb-table-text');
            if (table) {
                const px = parseFloat(getComputedStyle(table).fontSize);
                if (!(px >= 14)) hits.push(`표 글자 ${px}px`);
            }
        }
        return hits;
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
            const phoneHits = await geometryHits(page);
            if (phoneHits.length) browserErrors.push(`390 p${n} ${phoneHits.slice(0, 4).join(', ')}`);
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

        for (const [width, height, label] of [[1920, 1080, '1920'], [1366, 768, '1366'], [360, 780, '360']]) {
            await page.setViewport({ width, height, deviceScaleFactor: 1 });
            await page.waitForFunction((isPhone) => document.querySelector('.nb-app')?.classList.contains('is-phone') === isPhone, {}, width <= 700);
            for (let n = 1; n <= 580; n += 1) {
                await go(page, n);
                const hits = await geometryHits(page);
                if (hits.length) browserErrors.push(`${label} p${n} ${hits.slice(0, 4).join(', ')}`);
            }
        }
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
