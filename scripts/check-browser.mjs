import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(new URL('..', import.meta.url).pathname);
const port = Number(process.env.PREVIEW_PORT || 4175);
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

function stripAnsi(text) {
    return text.replace(/\u001b\[[0-9;]*m/g, '');
}

/** Vite 로그의 Local: 은 색 코드로 갈라집니다. HTTP로 60초까지 기다립니다. */
async function waitForPreview(child) {
    let log = '';
    const onData = (chunk) => { log += chunk.toString(); };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    let exitCode = null;
    child.on('exit', (code) => { exitCode = code ?? 0; });
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
        if (exitCode != null) {
            throw new Error(`preview 종료 ${exitCode}\n${stripAnsi(log)}`);
        }
        try {
            const res = await fetch(base, { signal: AbortSignal.timeout(1500) });
            if (res.status < 500) return;
        } catch {
            /* 아직 포트가 안 열렸습니다. */
        }
        await delay(300);
    }
    throw new Error(`preview 시작 실패\n${stripAnsi(log)}`);
}

async function go(page, n) {
    await page.evaluate((num) => { location.hash = `#p${num}`; }, n);
    await page.waitForFunction((num) => {
        // 홈은 오늘 보드입니다. data-page는 용지 틀에만 있습니다.
        if (Number(num) === 2) {
            const board = document.querySelector('.dy-board, .dy-m');
            const text = (board?.innerText || '').replace(/\s+/g, '');
            return location.hash === '#/home' && Boolean(board) && (text.includes('이번주') || text.includes('요일'));
        }
        const rootEl = document.querySelector(`[data-page="${num}"]`);
        const body = rootEl?.querySelector('.nb-body');
        if (!body) return false;
        if (body.innerText.includes('쪽을 열고 있습니다')) return false;
        const title = rootEl.querySelector('.nb-pagetitle, .nb-cover-title');
        return Boolean(title && title.textContent.trim().length > 1);
    }, { timeout: 20000 }, n);
}

async function clickTab(page, label) {
    const handle = await page.evaluateHandle((name) => {
        const tabs = [...document.querySelectorAll('.dy-tabs .dy-tab')];
        return tabs.find((node) => {
            const text = [...node.childNodes].filter((item) => item.nodeType === 3).map((item) => item.textContent).join('').replace(/\s+/g, ' ').trim();
            return text === name;
        }) || null;
    }, label);
    const button = handle.asElement();
    if (!button) return null;
    await button.evaluate((node) => node.scrollIntoView({ block: 'nearest', inline: 'center' }));
    await button.click();
    return button;
}

async function clickMoreItem(page, label) {
    const more = await clickTab(page, '더보기');
    if (!more) return null;
    await page.waitForSelector('.dy-more-pop', { timeout: 4000 });
    const handle = await page.evaluateHandle((name) => [...document.querySelectorAll('.dy-more-pop [role="menuitem"]')].find((node) => node.textContent.trim() === name) || null, label);
    const button = handle.asElement();
    if (!button) return null;
    await button.click();
    return button;
}

async function waitForDest(page, n, timeout = 8000) {
    await page.waitForFunction((num) => {
        if (Number(num) === 2) {
            const board = document.querySelector('.dy-board, .dy-m');
            return location.hash === '#/home' && Boolean(board);
        }
        return Boolean(document.querySelector(`[data-page="${num}"]`));
    }, { timeout }, n);
}

async function inspect(page) {
    return page.evaluate(() => {
        const board = document.querySelector('.dy-board, .dy-m');
        const paperEl = document.querySelector('.nb-page');
        if (board && !paperEl) {
            const text = (board.innerText || '').replace(/\s+/g, ' ').trim();
            const title = (board.querySelector('.dy-title, .dy-h')?.innerText || '').trim();
            return {
                page: '2',
                textLength: text.length,
                title,
                overflow: document.documentElement.scrollWidth > window.innerWidth + 2,
                linkCount: 0,
                missed: [],
            };
        }
        const rootEl = paperEl;
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

const SAMPLE_NAME = '선우하늘별';
const SAMPLE_SEX = '남학생';
const SAMPLE_NOTE = '비고란';
const SAMPLE_NOTE_LONG = '비고다섯자';
const SAMPLE_BIRTH = '2019.05.05';

async function writeFields(page, pageNo, fields) {
    await page.evaluate((num, patch) => {
        const key = `homenote_v2_notebookFields_p${num}`;
        const prev = JSON.parse(localStorage.getItem(key) || '{}');
        localStorage.setItem(key, JSON.stringify({ ...prev, ...patch }));
        window.dispatchEvent(new CustomEvent('nb-page-fields', { detail: { page: num } }));
    }, pageNo, fields);
}

function rosterPatch(name, sex, note, birth = '') {
    const patch = {};
    for (let n = 1; n <= 32; n += 1) {
        patch[`name${n}`] = name;
        patch[`sex${n}`] = sex;
        patch[`note${n}`] = note;
        patch[`birth${n}`] = birth;
    }
    return patch;
}

async function prepareClipSamples(page, n) {
    if (n === 154) {
        await writeFields(page, 154, rosterPatch(SAMPLE_NAME, SAMPLE_SEX, SAMPLE_NOTE_LONG, SAMPLE_BIRTH));
        await page.waitForFunction((name, birth) => {
            const row = document.querySelector('#roster-1');
            return row?.querySelector('input')?.value === name
                && row?.querySelector('[aria-label="1번 생년월일"]')?.value === birth;
        }, {}, SAMPLE_NAME, SAMPLE_BIRTH);
    }
    if (n >= 148 && n <= 153) {
        const patch = {};
        for (let i = 0; i < 36; i += 1) patch[`s${i}`] = SAMPLE_NAME;
        await writeFields(page, n, patch);
        await page.waitForFunction((name) => document.querySelector('.nb-seats input')?.value === name, {}, SAMPLE_NAME);
    }
    if (n >= 232 && n <= 255) {
        await writeFields(page, 154, rosterPatch(SAMPLE_NAME, '', ''));
        await page.waitForFunction((name) => {
            const shown = document.querySelector('.nb-roster-name');
            return shown && shown.textContent.trim() === name;
        }, {}, SAMPLE_NAME);
    }
}

async function clearClipSamples(page, n) {
    if (n === 154 || (n >= 232 && n <= 255)) await writeFields(page, 154, rosterPatch('', '', ''));
    if (n >= 148 && n <= 153) {
        const patch = {};
        for (let i = 0; i < 36; i += 1) patch[`s${i}`] = '';
        await writeFields(page, n, patch);
    }
}

async function settleChrome(page) {
    await page.waitForFunction(() => {
        if (document.fonts && document.fonts.status !== 'loaded') return false;
        const nav = document.querySelector('.dy-tabs');
        const current = nav?.querySelector('[aria-current="page"]');
        if (!nav || !current) return false;
        const host = nav.getBoundingClientRect();
        const box = current.getBoundingClientRect();
        return box.width > 2 && box.left >= host.left - 1 && box.right <= host.right + 1;
    }, { timeout: 4000 }).catch(() => {});
    await page.evaluate(() => new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
}

export async function geometryHits(page) {
    await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
    });
    return page.evaluate(() => {
        document.querySelectorAll('.nb-body, .nb-stage-wrap').forEach((el) => {
            el.scrollTop = 0;
        });
        const hits = [];
        const slop = 2;
        if (!document.getElementById('nb-check-no-motion')) {
            const style = document.createElement('style');
            style.id = 'nb-check-no-motion';
            style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; }';
            document.head.appendChild(style);
        }
        const inChrome = (el) => Boolean(el?.closest?.('.dy-fab, .dy-top, .dy-scrim, .dy-quick'));
        const visibleBox = (el) => {
            if (!el) return null;
            const style = getComputedStyle(el);
            if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return null;
            const rect = el.getBoundingClientRect();
            if (rect.width < 1 || rect.height < 1) return null;
            return rect;
        };
        const lumOf = (rgb) => {
            const m = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (!m) return null;
            const ch = [Number(m[1]), Number(m[2]), Number(m[3])].map((c) => {
                const s = c / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
        };
        const contrastOf = (el) => {
            if (!el) return null;
            const cs = getComputedStyle(el);
            const a = lumOf(cs.color);
            const b = lumOf(cs.backgroundColor);
            if (a == null || b == null) return null;
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const overlaps = (a, b) => Boolean(a && b) && !(a.right <= b.left + 0.5 || b.right <= a.left + 0.5 || a.bottom <= b.top + 0.5 || b.bottom <= a.top + 0.5);
        const inside = (box, host) => box.top >= host.top - slop && box.bottom <= host.bottom + slop && box.left >= host.left - slop && box.right <= host.right + slop;
        const labelOf = (el) => (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '컨트롤').trim().replace(/\s+/g, ' ').slice(0, 18);
        const wide = window.innerWidth >= 700;
        const tabLabel = (el) => [...(el?.childNodes || [])].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').replace(/\s+/g, ' ').trim()
            || (el?.textContent || '').replace(/\s+/g, ' ').trim();
        const header = document.querySelector('.dy-top');
        const headerBox = visibleBox(header);
        if (!header || !headerBox) hits.push('머리 없음');
        else if (headerBox.left < -1 || headerBox.right > window.innerWidth + 1 || headerBox.top < -1) hits.push('머리가 화면 밖');
        const bars = document.querySelectorAll('.dy-bar');
        if (bars.length !== 1) hits.push(`머리 줄 ${bars.length}`);
        const brandEl = document.querySelector('.dy-brand');
        const brandBox = visibleBox(brandEl);
        const monthEl = document.querySelector('.dy-month');
        const monthBox = visibleBox(monthEl);
        const actionEl = document.querySelector('.dy-actions');
        const actionBox = visibleBox(actionEl);
        if (!brandBox) hits.push('제목 없음');
        else if (brandEl.scrollWidth > brandEl.clientWidth + 1) hits.push('제목 잘림');
        if (!monthBox) hits.push('달 이동 없음');
        else if (monthEl.scrollWidth > monthEl.clientWidth + 1) hits.push('달 이동 잘림');
        const monthLabel = document.querySelector('.dy-month-label');
        if (monthLabel && monthLabel.scrollWidth > monthLabel.clientWidth + 1) hits.push('달 글자 잘림');
        if (overlaps(brandBox, monthBox)) hits.push('제목·달 겹침');
        if (overlaps(monthBox, actionBox)) hits.push('달·도구 겹침');
        if (overlaps(brandBox, actionBox)) hits.push('제목·도구 겹침');
        for (const name of ['수첩 찾기', '설정']) {
            const btn = document.querySelector(`.dy-actions [aria-label="${name}"]`);
            const box = visibleBox(btn);
            if (!box) hits.push(`${name} 없음`);
            else if (box.width < 40 || box.height < 40 || box.left < -1 || box.right > window.innerWidth + 1) {
                hits.push(`${name} 터치 ${box ? `${Math.round(box.width)}x${Math.round(box.height)}` : '밖'}`);
            }
        }
        const tabRows = [...document.querySelectorAll('.dy-tabs')];
        if (tabRows.length !== 1) hits.push(`탭 줄 ${tabRows.length}`);
        const tabs = tabRows[0];
        const tabsBox = visibleBox(tabs);
        if (!tabs || !tabsBox) hits.push('탭 없음');
        else {
            if (tabsBox.left < -1 || tabsBox.right > window.innerWidth + 1 || tabsBox.top < -1) hits.push('탭이 화면 밖');
            if (tabsBox.height > 60) hits.push(`탭 높이 ${Math.round(tabsBox.height)}`);
            if (headerBox && (tabsBox.top < headerBox.top - 1 || tabsBox.bottom > headerBox.bottom + 1)) hits.push('탭이 머리 밖');
            const currents = [...tabs.querySelectorAll('[aria-current="page"]')];
            if (currents.length !== 1) hits.push(`탭 현재위치 ${currents.length}`);
            const current = currents[0];
            const currentBox = visibleBox(current);
            if (current && current.scrollWidth > current.clientWidth + 1) hits.push(`탭 글자 잘림 ${tabLabel(current)}`);
            if (currentBox && !inside(currentBox, tabsBox)) hits.push(`탭 현재위치 잘림 ${tabLabel(current)}`);
            for (const btn of tabs.querySelectorAll('.dy-tab')) {
                if (btn.scrollWidth > btn.clientWidth + 1) hits.push(`탭 글자 잘림 ${tabLabel(btn)}`);
                if (!document.querySelector('.nb-app.is-phone')) continue;
                const box = visibleBox(btn);
                if (box && box.height < 44) hits.push(`휴대폰 탭 터치 ${tabLabel(btn)} ${Math.round(box.height)}`);
            }
            const paintOf = (el) => {
                let node = el;
                while (node) {
                    const matched = getComputedStyle(node).backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                    if (matched && (matched[4] == null || Number(matched[4]) > 0.4)) return `rgb(${matched[1]}, ${matched[2]}, ${matched[3]})`;
                    node = node.parentElement;
                }
                return '';
            };
            const selected = tabs.querySelector('.dy-tab.is-on');
            if (selected) {
                const fg = lumOf(getComputedStyle(selected).color);
                const bg = lumOf(paintOf(selected));
                const ratio = fg == null || bg == null ? 0 : (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
                // 쓱, 적 탭은 살구 글자(#b85d40)라 크림 바탕에서 4.2입니다.
                const floor = selected.classList.contains('is-ssu') ? 4 : 4.5;
                if (!(ratio >= floor)) hits.push(`탭 선택 대비 ${ratio.toFixed(2)}`);
            }
        }
        for (const el of document.querySelectorAll('.nb-tabbar, .nb-left, .nb-right, .nb-appnav')) {
            if (visibleBox(el)) {
                hits.push('탭이 한 줄이 아님');
                break;
            }
        }
        const pencil = visibleBox(document.querySelector('.dy-fab'));
        if (pencil && (overlaps(pencil, headerBox) || overlaps(pencil, tabsBox))) hits.push('쓱, 적이 머리를 가림');
        if (document.querySelector('.nb-app.is-phone')) {
            for (const el of document.querySelectorAll('.nb-tabbar, .nb-left, .nb-right, .nb-tab-hint')) {
                const st = getComputedStyle(el);
                if (st.display !== 'none' && st.visibility !== 'hidden') {
                    hits.push('휴대폰 위쪽 탭이 메뉴와 따로 있음');
                    break;
                }
            }
        }
        const deskTab = document.querySelector('.nb-tab.is-on');
        if (deskTab && visibleBox(deskTab)) {
            const cs = getComputedStyle(deskTab);
            const lum = (rgb) => {
                const m = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (!m) return null;
                const ch = [Number(m[1]), Number(m[2]), Number(m[3])].map((c) => {
                    const s = c / 255;
                    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
                });
                return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
            };
            const a = lum(cs.color);
            const b = lum(cs.backgroundColor);
            const ratio = a == null || b == null ? 0 : (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
            if (!(ratio >= 4.5)) hits.push(`선택 탭 대비 ${ratio.toFixed(2)}`);
        }
        for (const tab of document.querySelectorAll('.nb-right .nb-tab')) {
            if (!visibleBox(tab)) continue;
            const ratio = contrastOf(tab);
            if (!(ratio >= 6)) hits.push(`오른쪽 탭 대비 ${tab.textContent.trim()} ${ratio == null ? '없음' : ratio.toFixed(2)}`);
        }
        const pageEl = document.querySelector('.nb-page');
        const paper = visibleBox(pageEl);
        const title = document.querySelector('.nb-pagetitle');
        const bar = title?.closest('.nb-titlebar');
        if (title && bar) {
            const before = getComputedStyle(bar, '::before');
            const titleBox = title.getBoundingClientRect();
            const barBox = bar.getBoundingClientRect();
            const tapeGone = before.display === 'none'
                || before.visibility === 'hidden'
                || Number(before.opacity) === 0
                || before.content === 'none'
                || before.content === 'normal';
            if (!tapeGone && before.position === 'absolute') {
                const tapeBottom = barBox.top + (parseFloat(before.top) || 0) + (parseFloat(before.height) || 0);
                if (titleBox.top < tapeBottom - 1) hits.push('제목 장식이 제목과 겹침');
            } else if (!tapeGone && (before.position === 'relative' || before.position === 'static')) {
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
        if (fabBox && window.innerWidth >= 1101) {
            const sticker = [...document.querySelectorAll('.nb-right .nb-tab')].find((el) => el.textContent.trim() === '스티커');
            const stickerBox = visibleBox(sticker);
            if (stickerBox) {
                const dx = Math.max(0, Math.max(stickerBox.left - fabBox.right, fabBox.left - stickerBox.right));
                const dy = Math.max(0, Math.max(stickerBox.top - fabBox.bottom, fabBox.top - stickerBox.bottom));
                const dist = dx > 0 && dy > 0 ? Math.hypot(dx, dy) : Math.max(dx, dy);
                if (dist < 16) hits.push(`쓱적·스티커 간격 ${Math.round(dist)}`);
            }
        }
        if (pageEl && paper) {
            const foot = visibleBox(document.querySelector('.nb-foot'));
            const controls = [...pageEl.querySelectorAll('button, input, select, textarea, a')].filter((el) => {
                if (el.closest('.nb-fab') || el.classList.contains('sr-only')) return false;
                const nav = el.closest('.nb-left, .nb-right');
                if (el.classList.contains('nb-tab') && nav) {
                    const navStyle = getComputedStyle(nav);
                    const row = navStyle.flexDirection === 'row' || navStyle.flexDirection === 'row-reverse';
                    const scrollX = navStyle.overflowX === 'auto' || navStyle.overflowX === 'scroll' || navStyle.overflowX === 'overlay';
                    if (row && scrollX) return false;
                }
                return true;
            });
            const boxes = [];
            let clipped = 0;
            for (const el of controls) {
                const box = visibleBox(el);
                if (!box) continue;
                boxes.push([el, box]);
                if (!inside(box, paper)) {
                    clipped += 1;
                    if (clipped <= 2) hits.push(`잘린 버튼 ${labelOf(el)}`);
                } else if (foot && overlaps(box, foot)) {
                    hits.push(`바닥과 겹침 ${labelOf(el)}`);
                }
            }
            if (clipped > 2) hits.push(`잘린 버튼 ${clipped}개`);
            let crossed = 0;
            for (let i = 0; i < boxes.length; i += 1) {
                const [aEl, aBox] = boxes[i];
                for (let j = i + 1; j < boxes.length; j += 1) {
                    const [bEl, bBox] = boxes[j];
                    if (aEl.contains(bEl) || bEl.contains(aEl)) continue;
                    const iw = Math.min(aBox.right, bBox.right) - Math.max(aBox.left, bBox.left);
                    const ih = Math.min(aBox.bottom, bBox.bottom) - Math.max(aBox.top, bBox.top);
                    if (iw > 4 && ih > 4) {
                        crossed += 1;
                        if (crossed <= 2) hits.push(`겹침 ${labelOf(aEl)}·${labelOf(bEl)}`);
                    }
                }
            }
            if (crossed > 2) hits.push(`겹침 ${crossed}개`);
        }
        if (window.innerWidth >= 1367) {
            const table = document.querySelector('.nb-table-text');
            if (table) {
                const px = parseFloat(getComputedStyle(table).fontSize);
                if (!(px >= 14)) hits.push(`표 글자 ${px}px`);
            }
        }
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const textWidth = (el, text) => {
            const cs = getComputedStyle(el);
            ctx.font = `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
            return ctx.measureText(text).width;
        };
        for (const el of document.querySelectorAll('input, textarea, select')) {
            const box = visibleBox(el);
            if (!box) continue;
            if (el.type === 'file' || el.type === 'hidden') continue;
            const cs = getComputedStyle(el);
            const samples = [];
            if (el.tagName === 'SELECT') samples.push(el.options[el.selectedIndex]?.text || '');
            else if (el.type === 'checkbox' || el.type === 'radio') samples.push(el.value || 'on');
            else if (el.tagName !== 'TEXTAREA') {
                if (el.value) samples.push(el.value);
                if (el.placeholder) samples.push(el.placeholder);
                const aria = el.getAttribute('aria-label') || '';
                if (/번 이름$/.test(aria) || /^자리 /.test(aria)) {
                    samples.push('선우하늘별');
                    samples.push('학생이름김');
                }
                if (/번 성별$/.test(aria)) samples.push('남학생');
                if (/번 비고$/.test(aria)) {
                    samples.push('남학생');
                    samples.push('비고다섯자');
                }
                if (/번 생년월일$/.test(aria)) samples.push('2019.05.05');
            }
            const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
            let avail = el.clientWidth - pad;
            const appearance = cs.appearance || cs.webkitAppearance || '';
            if (el.tagName === 'SELECT' && appearance !== 'none') avail -= 16;
            for (const text of new Set(samples)) {
                if (text && textWidth(el, text) > avail + 1) hits.push(`입력 글자 잘림 ${text.slice(0, 18)}`);
            }
        }
        const cutByAncestor = (el) => {
            const box = el.getBoundingClientRect();
            if (box.width < 1 || box.height < 1) return false;
            let node = el.parentElement;
            while (node && node !== document.body) {
                if (node.classList?.contains('nb-body') || node.classList?.contains('nb-main') || node.classList?.contains('nb-page') || node.classList?.contains('nb-stage-wrap') || node.classList?.contains('nb-app')) break;
                const cs = getComputedStyle(node);
                const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'clip';
                const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'clip';
                if (clipX || clipY) {
                    const host = node.getBoundingClientRect();
                    const seen = box.bottom > host.top + 1 && box.top < host.bottom - 1 && box.right > host.left + 1 && box.left < host.right - 1;
                    const sticks = (clipX && (box.left < host.left - 1 || box.right > host.right + 1))
                        || (clipY && (box.top < host.top - 1 || box.bottom > host.bottom + 1));
                    if (seen && sticks) return true;
                }
                node = node.parentElement;
            }
            return false;
        };
        const coveredBy = (el) => {
            const box = el.getBoundingClientRect();
            const stage = document.querySelector('.nb-stage-wrap')?.getBoundingClientRect();
            const host = stage || { top: 0, left: 0, right: window.innerWidth, bottom: window.innerHeight };
            const left = Math.max(box.left, host.left, 0);
            const right = Math.min(box.right, host.right, window.innerWidth);
            const top = Math.max(box.top, host.top, 0);
            const bottom = Math.min(box.bottom, host.bottom, window.innerHeight);
            if (right - left < 4 || bottom - top < 4) return '';
            const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
            if (!hit || hit === el || el.contains(hit) || hit.contains(el) || inChrome(hit)) return '';
            return (hit.getAttribute('aria-label') || hit.className || hit.textContent || '요소').toString().trim().replace(/\s+/g, ' ').slice(0, 18);
        };
        for (const el of document.querySelectorAll('.nb-roster .nb-ink, .nb-seats .nb-ink, .nb-roster-name, .nb-week-due-item')) {
            if (!visibleBox(el)) continue;
            if (el.scrollWidth > el.clientWidth + 1 || cutByAncestor(el)) {
                const sample = (el.value || el.textContent || '').trim().slice(0, 18);
                hits.push(`글자 잘림 ${sample}`);
            }
            const cover = coveredBy(el);
            if (cover) hits.push(`가림 ${cover}`);
        }
        const clippedTextBox = (rect, start) => {
            let top = rect.top;
            let left = rect.left;
            let right = rect.right;
            let bottom = rect.bottom;
            let node = start;
            while (node && node !== document.documentElement) {
                const cs = getComputedStyle(node);
                const clipX = cs.overflowX === 'hidden' || cs.overflowX === 'auto' || cs.overflowX === 'scroll' || cs.overflowX === 'clip';
                const clipY = cs.overflowY === 'hidden' || cs.overflowY === 'auto' || cs.overflowY === 'scroll' || cs.overflowY === 'clip';
                if (clipX || clipY) {
                    const host = node.getBoundingClientRect();
                    if (clipX) {
                        left = Math.max(left, host.left);
                        right = Math.min(right, host.right);
                    }
                    if (clipY) {
                        top = Math.max(top, host.top);
                        bottom = Math.min(bottom, host.bottom);
                    }
                }
                node = node.parentElement;
            }
            left = Math.max(left, 0);
            top = Math.max(top, 0);
            right = Math.min(right, window.innerWidth);
            bottom = Math.min(bottom, window.innerHeight);
            if (right - left < 2 || bottom - top < 2) return null;
            return { left, top, right, bottom };
        };
        if (pageEl) {
            for (const btn of pageEl.querySelectorAll('button')) {
                if (btn.closest('.nb-fab, .sr-only') || btn.disabled) continue;
                const rect = btn.getBoundingClientRect();
                if (rect.width < 2 || rect.height < 2) continue;
                const visible = clippedTextBox(rect, btn);
                if (!visible) continue;
                const hit = document.elementFromPoint((visible.left + visible.right) / 2, (visible.top + visible.bottom) / 2);
                if (hit && !inChrome(hit) && hit !== btn && !btn.contains(hit) && !hit.contains(btn)) hits.push(`버튼 가림 ${labelOf(btn)}`);
            }
        }
        const floaters = [];
        const seenFloater = new Set();
        const addFloater = (el) => {
            if (!el || seenFloater.has(el) || !visibleBox(el)) return;
            seenFloater.add(el);
            floaters.push(el);
        };
        for (const el of document.querySelectorAll('body *')) {
            const pos = getComputedStyle(el).position;
            if (pos === 'fixed' || pos === 'sticky') addFloater(el);
        }
        document.querySelectorAll('.nb-fab, .nb-fab-btn').forEach(addFloater);
        if (floaters.length && pageEl) {
            const covered = [];
            const targets = pageEl.querySelectorAll('input, textarea, select, button, a, label, p, h1, h2, h3, li, .nb-kicker, .nb-pagetitle, .nb-field-label');
            for (const el of targets) {
                if (el.closest('.sr-only') || el.disabled) continue;
                const box = el.getBoundingClientRect();
                if (box.width < 2 || box.height < 2) continue;
                for (const floater of floaters) {
                    if (floater.classList.contains('dy-fab') || floater.classList.contains('dy-top')) continue;
                    if (floater.contains(el) || el.contains(floater)) continue;
                    const host = floater.getBoundingClientRect();
                    const left = Math.max(box.left, host.left, 0);
                    const right = Math.min(box.right, host.right, window.innerWidth);
                    const top = Math.max(box.top, host.top, 0);
                    const bottom = Math.min(box.bottom, host.bottom, window.innerHeight);
                    if (right - left < 4 || bottom - top < 4) continue;
                    const hit = document.elementFromPoint((left + right) / 2, (top + bottom) / 2);
                    const onFloater = hit === floater || (hit && floater.contains(hit));
                    const onContent = hit === el || (hit && el.contains(hit));
                    if (!onFloater || onContent) continue;
                    covered.push(`${labelOf(floater)}·${labelOf(el)}`);
                    break;
                }
            }
            covered.slice(0, 2).forEach((item) => hits.push(`고정 가림 ${item}`));
            if (covered.length > 2) hits.push(`고정 가림 ${covered.length}개`);
        }
        const pageRoot = document.querySelector('.nb-page');
        if (pageRoot) {
            const fields = [...pageRoot.querySelectorAll('input, textarea, select')];
            const walker = document.createTreeWalker(pageRoot, NodeFilter.SHOW_TEXT);
            let textNode = walker.nextNode();
            while (textNode) {
                const raw = textNode.textContent.replace(/\s+/g, ' ').trim();
                const parent = textNode.parentElement;
                if (raw && parent && !parent.closest('.sr-only, .nb-field-label')) {
                    const pcs = getComputedStyle(parent);
                    if (pcs.display !== 'none' && pcs.visibility !== 'hidden' && Number(pcs.opacity) !== 0) {
                        const range = document.createRange();
                        range.selectNodeContents(textNode);
                        let covered = false;
                        for (const rect of range.getClientRects()) {
                            if (covered || rect.width < 2 || rect.height < 2) continue;
                            for (const field of fields) {
                                if (field.contains(textNode)) continue;
                                const box = field.getBoundingClientRect();
                                const overlapW = Math.min(rect.right, box.right) - Math.max(rect.left, box.left);
                                const overlapH = Math.min(rect.bottom, box.bottom) - Math.max(rect.top, box.top);
                                if (overlapW > 3 && overlapH > 3 && overlapH > rect.height * 0.4) {
                                    hits.push(`글자 가림 ${raw.slice(0, 18)}`);
                                    covered = true;
                                    break;
                                }
                            }
                            if (covered) continue;
                            const visible = clippedTextBox(rect, parent);
                            if (!visible) continue;
                            const hit = document.elementFromPoint((visible.left + visible.right) / 2, (visible.top + visible.bottom) / 2);
                            if (hit && !hit.contains(textNode) && !inChrome(hit)) {
                                hits.push(`글자 가림 ${raw.slice(0, 18)}`);
                                covered = true;
                            }
                        }
                    }
                }
                textNode = walker.nextNode();
            }
        }
        for (const el of document.querySelectorAll('.nb-toolbar-page, .nb-toolbar-user, .nb-brand-name, .nb-tab, .nb-cover-title, .nb-pagetitle')) {
            const box = visibleBox(el);
            if (!box) continue;
            const cs = getComputedStyle(el);
            if (el.scrollWidth > el.clientWidth + 1) {
                const sample = el.textContent.trim().slice(0, 18);
                hits.push(cs.textOverflow === 'ellipsis' ? `말줄임 ${sample}` : `글자 잘림 ${sample}`);
            }
        }
        const coverTitle = document.querySelector('.nb-cover-title');
        if (coverTitle && visibleBox(coverTitle)) {
            const cs = getComputedStyle(coverTitle);
            if (cs.wordBreak !== 'keep-all') hits.push('표지 제목 어절');
            const node = coverTitle.firstChild;
            const words = coverTitle.textContent.trim().split(/\s+/).filter(Boolean);
            if (node && node.nodeType === 3 && words.length) {
                const range = document.createRange();
                const lines = [];
                let buf = '';
                let lastTop = null;
                for (let i = 0; i < node.textContent.length; i += 1) {
                    range.setStart(node, i);
                    range.setEnd(node, i + 1);
                    const rect = range.getClientRects()[0];
                    if (!rect) continue;
                    if (lastTop != null && Math.abs(rect.top - lastTop) > 2) {
                        lines.push(buf);
                        buf = '';
                    }
                    buf += node.textContent[i];
                    lastTop = rect.top;
                }
                if (buf) lines.push(buf);
                const rest = words.slice();
                for (const line of lines) {
                    for (const part of line.trim().split(/\s+/).filter(Boolean)) {
                        if (rest[0] !== part) {
                            hits.push(`표지 제목 단어 잘림 ${part}`);
                            rest.length = 0;
                            break;
                        }
                        rest.shift();
                    }
                }
            }
        }
        const writeTab = [...document.querySelectorAll('.dy-tabs .dy-tab')].find((el) => el.textContent.replace(/\s+/g, ' ').trim().startsWith('쓱, 적'));
        if (!writeTab) hits.push('쓱, 적 탭 없음');
        return hits;
    });
}

async function checkCapturePopup(page, browserErrors) {
    await go(page, 53);
    for (const width of [320, 360, 390, 700]) {
        await page.setViewport({ width, height: 780, deviceScaleFactor: 1 });
        await page.waitForFunction(() => document.querySelector('.nb-app')?.classList.contains('is-phone') && document.querySelector('[data-page="53"]'));
        const sample = `포털확인${width}`;
        await page.evaluate(() => {
            const raw = localStorage.getItem('homenote_v2_ssugeokInbox');
            const items = raw ? JSON.parse(raw) : [];
            localStorage.setItem('homenote_v2_ssugeokInbox', JSON.stringify(items.filter((item) => !String(item.text || '').startsWith('포털확인'))));
        });
        await page.click('.dy-fab');
        await page.waitForSelector('.dy-quick', { timeout: 4000 });
        const hit = await page.evaluate(() => {
            const pop = document.querySelector('.dy-quick');
            const button = document.querySelector('.dy-fab');
            const input = pop?.querySelector('[data-ssu-capture]');
            const save = [...(pop?.querySelectorAll('button') || [])].find((el) => el.textContent.trim() === '남기기');
            const close = pop?.querySelector('[aria-label="닫기"]');
            const onTop = (el) => {
                if (!el) return '없음';
                const rect = el.getBoundingClientRect();
                if (rect.width < 2 || rect.height < 2) return '크기';
                const x = rect.left + rect.width / 2;
                const y = rect.top + rect.height / 2;
                if (x < 1 || y < 1 || x > window.innerWidth - 1 || y > window.innerHeight - 1) return '화면 밖';
                const target = document.elementFromPoint(x, y);
                if (target === el || (target && el.contains(target))) return '';
                return (target?.getAttribute('aria-label') || target?.className || target?.textContent || '다른 요소').toString().trim().replace(/\s+/g, ' ').slice(0, 24);
            };
            return {
                inTabs: Boolean(button?.closest('.dy-tabs, .dy-top')),
                popOutside: Boolean(pop && pop.parentElement?.parentElement === document.body && !pop.closest('.dy-tabs, .nb-stage-wrap')),
                input: onTop(input),
                save: onTop(save),
                close: onTop(close),
            };
        });
        if (hit.inTabs) browserErrors.push(`${width} 쓱, 적 버튼이 탭 줄 안`);
        if (!hit.popOutside) browserErrors.push(`${width} 쓱, 적 창이 본문 안`);
        if (hit.input) browserErrors.push(`${width} 쓱, 적 입력 가림 ${hit.input}`);
        if (hit.save) browserErrors.push(`${width} 쓱, 적 남기기 가림 ${hit.save}`);
        if (hit.close) browserErrors.push(`${width} 쓱, 적 닫기 가림 ${hit.close}`);
        await page.click('.dy-quick [data-ssu-capture]');
        const focused = await page.evaluate(() => document.activeElement?.hasAttribute('data-ssu-capture'));
        if (!focused) browserErrors.push(`${width} 쓱, 적 입력 포커스`);
        await page.type('.dy-quick [data-ssu-capture]', sample);
        await page.click('.dy-quick button[type="submit"]');
        try {
            await page.waitForFunction((text) => {
                if (document.querySelector('.dy-quick')) return false;
                const raw = localStorage.getItem('homenote_v2_ssugeokInbox') || '[]';
                return JSON.parse(raw).some((item) => item.text === text);
            }, { timeout: 4000 }, sample);
        } catch {
            browserErrors.push(`${width} 쓱, 적 남기기 실패`);
        }
        await page.click('.dy-fab');
        await page.waitForSelector('.dy-quick', { timeout: 4000 });
        await page.click('.dy-quick [aria-label="닫기"]');
        try {
            await page.waitForFunction(() => !document.querySelector('.dy-quick'), { timeout: 2000 });
        } catch {
            browserErrors.push(`${width} 쓱, 적 닫기 실패`);
        }
        const kept = await page.evaluate((text) => {
            const raw = localStorage.getItem('homenote_v2_ssugeokInbox') || '[]';
            return JSON.parse(raw).filter((item) => item.text === text).length;
        }, sample);
        if (kept !== 1) browserErrors.push(`${width} 쓱적 저장 ${kept}`);
    }
    await page.evaluate(() => {
        const raw = localStorage.getItem('homenote_v2_ssugeokInbox');
        if (!raw) return;
        const items = JSON.parse(raw).filter((item) => !String(item.text || '').startsWith('포털확인'));
        localStorage.setItem('homenote_v2_ssugeokInbox', JSON.stringify(items));
    });
    await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 1 });
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
        await settleChrome(page);
        for (let n = 1; n <= 580; n += 1) {
            await go(page, n);
            const info = await inspect(page);
            if (info.overflow) overflowPages.push(n);
            if (info.textLength <= 4 || info.title.length <= 1) empty.push(`${n}:${info.title || info.textLength}`);
            if (info.missed.length) unreachable.push(`${n}:${info.missed.slice(0, 4).join(',')}`);
            await prepareClipSamples(page, n);
            const phoneHits = await geometryHits(page);
            await clearClipSamples(page, n);
            if (phoneHits.length) browserErrors.push(`390 p${n} ${phoneHits.slice(0, 4).join(', ')}`);
            const first = await page.$('.nb-body [data-to]');
            if (first) {
                const dest = Number(await page.evaluate((el) => el.getAttribute('data-to'), first));
                if (dest && dest !== n && dest >= 1 && dest <= 580) {
                    await first.click({ offset: { x: 10, y: 10 } });
                    await waitForDest(page, dest);
                }
            }
        }
        if (empty.length) browserErrors.push(`390px 빈 쪽 ${empty.slice(0, 12).join(' ')}`);
        if (overflowPages.length) browserErrors.push(`390px 가로 넘침 ${overflowPages.slice(0, 12).join(',')}`);
        if (unreachable.length) browserErrors.push(`390px 닿지 않는 본문 링크 ${unreachable.slice(0, 8).join(' | ')}`);

        // 390은 위쪽 전체 순회. 나머지는 입력·선택·말줄임·탭 잘림을 같은 검사로 본다.
        for (const [width, height, label] of [[1920, 1080, '1920'], [1366, 768, '1366'], [1024, 768, '1024'], [1023, 900, '1023'], [900, 900, '900'], [800, 900, '800'], [768, 900, '768'], [720, 900, '720'], [360, 780, '360']]) {
            await page.setViewport({ width, height, deviceScaleFactor: 1 });
            await page.waitForFunction((viewW) => {
                const isPhone = viewW <= 700;
                const app = document.querySelector('.nb-app');
                if (!app || app.classList.contains('is-phone') !== isPhone) return false;
                const board = document.querySelector('.dy-board, .dy-m');
                const paper = document.querySelector('.nb-page')?.getBoundingClientRect();
                if (!paper && board) return true;
                if (!paper || paper.width < 100) return false;
                if (isPhone) return paper.width <= viewW + 2;
                return paper.width <= viewW - 16;
            }, {}, width);
            await settleChrome(page);
            for (let n = 1; n <= 580; n += 1) {
                await go(page, n);
                await prepareClipSamples(page, n);
                const hits = await geometryHits(page);
                await clearClipSamples(page, n);
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
        const brandWrap = await page.$eval('.dy-brand', (el) => getComputedStyle(el).flexWrap);
        if (brandWrap !== 'nowrap') browserErrors.push('휴대폰 제목이 한 줄이 아님');
        const phoneBar = await page.$eval('.dy-tabs', (el) => el.getBoundingClientRect().height);
        if (!(phoneBar <= 60 && phoneBar >= 40)) browserErrors.push(`휴대폰 탭 높이 ${phoneBar}`);
        const tabRows = await page.$$eval('.dy-tabs', (els) => els.length);
        if (tabRows !== 1) browserErrors.push(`휴대폰 탭 줄 ${tabRows}`);
        const phoneHits = await page.$$eval('.dy-tabs .dy-tab', (els) => els.filter((el) => {
            const style = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            const host = el.closest('.dy-tabs').getBoundingClientRect();
            const full = box.left >= host.left - 1 && box.right <= host.right + 1;
            return full && !el.disabled && style.visibility !== 'hidden' && style.display !== 'none' && box.width >= 1 && box.height >= 1;
        }).map((el) => {
            const box = el.getBoundingClientRect();
            const name = [...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').replace(/\s+/g, ' ').trim();
            return { w: box.width, h: box.height, name };
        }));
        for (const hit of phoneHits) {
            if (!(hit.h >= 44)) browserErrors.push(`휴대폰 탭 터치 ${hit.name} ${Math.round(hit.w)}x${Math.round(hit.h)}`);
        }
        const phoneTabs = await page.$$eval('.nb-tabbar, .nb-left, .nb-right, .nb-appnav', (els) => els.filter((el) => getComputedStyle(el).display !== 'none').length);
        if (phoneTabs) browserErrors.push('휴대폰 탭이 한 줄이 아님');
        await go(page, 569);
        const stickerPressed = await page.$eval('.nb-sticker', (el) => el.hasAttribute('aria-pressed'));
        if (!stickerPressed) browserErrors.push('스티커 버튼에 누름 상태가 없음');

        await go(page, 159);
        const exportBtn = await page.$('[data-action="export-student"]');
        if (!exportBtn) browserErrors.push('학생 카드 내보내기 버튼이 없음');

        await go(page, 157);
        const badge = await page.$eval('.nb-local-badge', (el) => el.innerText);
        if (!badge.includes('이 기기에만 저장')) browserErrors.push('157쪽 배지가 없음');

        await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
        await page.evaluate(() => { location.hash = '#/year'; });
        await page.waitForSelector('[data-page="32"]');
        const yearOn = await page.$eval('.dy-tabs [aria-current="page"]', (el) => [...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim());
        if (yearOn !== '연간') browserErrors.push(`연간 현재위치 ${yearOn}`);
        if (!await clickTab(page, '월간')) browserErrors.push('월간 탭이 없음');
        await page.waitForFunction(() => {
            const on = document.querySelector('.dy-tabs [aria-current="page"]');
            const name = [...(on?.childNodes || [])].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim();
            return name === '월간' && /^#\/month\/\d{4}\/\d{1,2}$/.test(location.hash) && document.querySelector('.nb-page')?.dataset.type === 'month';
        });
        if (!await clickTab(page, '주간')) browserErrors.push('주간 탭이 없음');
        await page.waitForFunction(() => {
            const on = document.querySelector('.dy-tabs [aria-current="page"]');
            const name = [...(on?.childNodes || [])].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim();
            const n = Number(document.querySelector('.nb-page')?.dataset.page);
            return name === '주간' && (/^#\/week\/\d+$/.test(location.hash) || location.hash === '#/weeks') && n >= 46 && n <= 98;
        });
        if (!await clickMoreItem(page, '학사 일정')) browserErrors.push('더보기에 학사 일정이 없음');
        await page.waitForFunction(() => location.hash === '#/schedule' && document.querySelector('[data-page="33"]'));
        if (!await clickTab(page, '하루')) browserErrors.push('하루 탭이 없음');
        await page.waitForFunction(() => location.hash === '#/days' && document.querySelector('[data-page="99"]'));
        await page.goBack();
        await page.waitForFunction(() => location.hash === '#/schedule' && document.querySelector('[data-page="33"]'));
        await page.evaluate(() => { location.hash = '#/month/2026/4'; });
        await page.waitForSelector('[data-page="35"]');
        const monthOn = await page.$eval('.dy-tabs [aria-current="page"]', (el) => [...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').trim());
        if (monthOn !== '월간') browserErrors.push(`4월 현재위치 ${monthOn}`);
        const day = await page.$('[data-page="35"] .nb-daylink');
        if (!day) browserErrors.push('4월 날짜 버튼이 없음');
        else {
            await day.click();
            await page.waitForFunction(() => location.hash.startsWith('#/date/2026-04-'));
            const landed = await page.$eval('.nb-page', (el) => el.dataset.page);
            if (!(Number(landed) >= 47 && Number(landed) <= 98)) browserErrors.push(`날짜 이동이 주간이 아님 ${landed}`);
            await page.goBack();
            await page.waitForFunction(() => location.hash === '#/month/2026/4' && document.querySelector('[data-page="35"]'));
        }
        await page.evaluate(() => { location.hash = '#/week/10'; });
        await page.waitForFunction(() => {
            const n = Number(document.querySelector('.nb-page')?.dataset.page);
            return n >= 47 && n <= 98;
        });
        if (!await clickTab(page, '월간')) browserErrors.push('주간에서 월간 탭이 없음');
        await page.waitForFunction(() => /^#\/month\/\d{4}\/\d{1,2}$/.test(location.hash) && document.querySelector('.nb-page')?.dataset.type === 'month');
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.waitForFunction(() => document.querySelector('.nb-app')?.classList.contains('is-phone'));
        await page.evaluate(() => { location.hash = '#/home'; });
        await waitForDest(page, 2);
        const phoneNav = await page.$eval('.dy-tabs', (el) => getComputedStyle(el).display);
        if (phoneNav === 'none') browserErrors.push('휴대폰에서 탭이 숨음');
        if (!await clickMoreItem(page, '예산')) browserErrors.push('더보기에 예산이 없음');
        else await page.waitForFunction(() => location.hash === '#/budget' && document.querySelector('[data-page="468"]'));

        await page.setViewport({ width: 1024, height: 768, deviceScaleFactor: 1 });
        await page.evaluate(() => { location.hash = '#/students'; });
        await page.waitForSelector('[data-page="154"]');
        for (const [width, label] of [[1024, '1024'], [390, '390'], [360, '360']]) {
            await page.setViewport({ width, height: width === 1024 ? 768 : 844, deviceScaleFactor: 1 });
            await page.waitForFunction((viewW) => {
                const phone = viewW <= 700;
                return document.querySelector('.nb-app')?.classList.contains('is-phone') === phone;
            }, {}, width);
            if (width === 1024) {
                const menuH = await page.$eval('.dy-tabs .dy-tab', (el) => el.getBoundingClientRect().height);
                if (!(menuH >= 44)) browserErrors.push(`1024 탭 높이 ${menuH}`);
            }
            if (width <= 390) {
                const shown = await page.$eval('.dy-tabs', (scroll) => {
                    const host = scroll.getBoundingClientRect();
                    return [...scroll.querySelectorAll('.dy-tab')].filter((btn) => {
                        const style = getComputedStyle(btn);
                        if (style.visibility === 'hidden' || style.display === 'none') return false;
                        const box = btn.getBoundingClientRect();
                        return box.left >= host.left - 1 && box.right <= host.right + 1;
                    }).length;
                });
                if (shown < 3) browserErrors.push(`${label} 보이는 탭 ${shown}개`);
            }
            const moved = await page.$eval('.dy-tabs', (el) => {
                const max = Math.max(0, el.scrollWidth - el.clientWidth);
                if (max <= 2) return { overflow: false, target: el.scrollLeft, max };
                const target = Math.min(max, el.scrollLeft + Math.max(40, Math.round(el.clientWidth * 0.7)));
                el.scrollLeft = target;
                return { overflow: true, target, max };
            });
            if (moved.overflow) {
                await new Promise((resolve) => setTimeout(resolve, 300));
                const after = await page.$eval('.dy-tabs', (el) => el.scrollLeft);
                if (Math.abs(after - moved.target) > 8) browserErrors.push(`${label} 탭 스크롤이 되돌아감 ${moved.target}→${after}`);
            }
        }

        await page.setViewport({ width: 360, height: 844, deviceScaleFactor: 1 });
        await page.waitForFunction(() => document.querySelector('.nb-app')?.classList.contains('is-phone'));
        await page.evaluate(() => { location.hash = '#/home'; });
        await waitForDest(page, 2);
        const tabNames = await page.$$eval('.dy-tabs .dy-tab', (els) => els.map((el) => [...el.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').replace(/\s+/g, ' ').trim()));
        const seenLabels = new Set();
        const maxScroll = await page.$eval('.dy-tabs', (el) => Math.max(0, el.scrollWidth - el.clientWidth));
        for (let left = 0; left <= maxScroll + 1; left += 36) {
            await page.$eval('.dy-tabs', (el, x) => { el.scrollLeft = x; }, Math.min(left, maxScroll));
            const names = await page.$$eval('.dy-tabs', (els) => {
                const scroll = els[0];
                const host = scroll.getBoundingClientRect();
                return [...scroll.querySelectorAll('.dy-tab')].filter((btn) => {
                    const box = btn.getBoundingClientRect();
                    return box.right > host.left + 1 && box.left < host.right - 1;
                }).map((btn) => [...btn.childNodes].filter((node) => node.nodeType === 3).map((node) => node.textContent).join('').replace(/\s+/g, ' ').trim());
            });
            for (const name of names) seenLabels.add(name);
        }
        const skipped = tabNames.filter((name) => !seenLabels.has(name));
        if (!seenLabels.has('업무') || skipped.length) browserErrors.push(`360 탭 줄이 메뉴를 건너뜀 ${skipped.join(',') || '업무'}`);

        await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
        await page.evaluate(() => { location.hash = '#/home'; });
        await waitForDest(page, 2);
        if (!await clickTab(page, '학생')) browserErrors.push('학생 탭이 없음');
        await page.waitForFunction(() => location.hash === '#/students' && document.querySelector('[data-page="154"]'));
        if (!await clickTab(page, '더보기')) browserErrors.push('더보기 탭이 없음');
        await page.waitForSelector('.dy-more-pop');
        await page.goBack();
        await page.waitForFunction(() => location.hash === '#/home' && document.querySelector('.dy-board, .dy-m') && !document.querySelector('.dy-more-pop'));

        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.waitForFunction(() => document.querySelector('.nb-app')?.classList.contains('is-phone'));
        for (const [label, hash, num] of [['시간표', '#/timetable', 141], ['학생 카드', '#/cards', 159], ['예산', '#/budget', 468]]) {
            const item = await clickMoreItem(page, label);
            if (!item) browserErrors.push(`더보기에 ${label}이 없음`);
            else {
                await page.waitForFunction((value, dest) => location.hash === value && document.querySelector(`[data-page="${dest}"]`), { timeout: 8000 }, hash, num);
            }
        }

        const routeCases = [
            ['#p154', '#/students', '154', false],
            ['#/date/2026-04-13', '#/date/2026-04-13', '53', false],
            ['#/nonsense', '#/cover', '1', true],
            ['#/zzz', '#/cover', '1', true],
            ['#p0', '#/cover', '1', true],
            ['#/week/0', '#/weeks', '46', true],
            ['#/week/53', '#/weeks', '46', true],
            ['#/day/41', '#/days', '99', true],
            ['#/date/2025-01-01', '#/weeks', '46', true],
            ['#/month/2026/2', '#/month/2027/2', '45', true],
            ['#p999', '#/p/580', '580', true],
            ['#/cards/2', '#/cards/2', '161', false],
            ['#/cards/abc', '#/cards', '159', true],
            ['#/cards/-1', '#/cards', '159', true],
            ['#/cards/2.5', '#/cards', '159', true],
            ['#/cards/0', '#/cards', '159', true],
            ['#/cards/33', '#/cards', '159', true],
        ];
        for (const [from, to, num, toast] of routeCases) {
            await page.evaluate((value) => { location.hash = value; }, from);
            await page.waitForFunction((value, dest) => location.hash === value && document.querySelector(`[data-page="${dest}"]`), { timeout: 8000 }, to, num);
            if (toast) {
                await page.waitForFunction(() => /없는 주소/.test(document.querySelector('[role="status"]')?.textContent || ''), { timeout: 4000 });
            }
        }
        await page.waitForFunction(() => !document.querySelector('[role="status"]'), { timeout: 5000 });

        await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 1 });
        await page.waitForFunction(() => document.querySelector('.nb-app')?.classList.contains('is-phone'));
        await page.evaluate(() => { location.hash = '#/week/7'; });
        await page.waitForSelector('[data-page="53"]');
        const period = await page.evaluate(() => {
            const span = [...document.querySelectorAll('.nb-period .nb-tick span')].find((el) => el.textContent.includes('전담'));
            if (!span) return '없음';
            const lines = span.getClientRects().length;
            if (lines !== 1) return `줄 ${lines}`;
            if (span.scrollWidth > span.clientWidth + 1) return `너비 ${span.scrollWidth}>${span.clientWidth}`;
            return 'ok';
        });
        if (period !== 'ok') browserErrors.push(`전담 줄바꿈 ${period}`);

        for (const width of [720, 768, 800]) {
            await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            await page.waitForFunction(() => !document.querySelector('.nb-app')?.classList.contains('is-phone'));
            await page.evaluate(() => { location.hash = '#p154'; });
            await page.waitForSelector('[data-page="154"] .nb-pagetitle');
            const band = await page.evaluate(() => {
                const header = document.querySelector('.dy-top')?.getBoundingClientRect();
                const title = document.querySelector('[data-page="154"] .nb-pagetitle');
                const titleBox = title?.getBoundingClientRect();
                return {
                    rows: document.querySelectorAll('.dy-tabs').length,
                    side: Boolean(document.querySelector('.nb-left, .nb-right, .nb-appnav')),
                    titleTop: titleBox ? Math.round(titleBox.top) : 0,
                    headerBottom: header ? Math.round(header.bottom) : 0,
                    title: title?.textContent.trim() || '',
                };
            });
            if (band.rows !== 1 || band.side) {
                browserErrors.push(`${width} 탭 줄 ${band.rows}`);
            }
            if (!band.title.includes('명렬') || band.titleTop < band.headerBottom - 1) {
                browserErrors.push(`${width} 명렬표 위치 ${band.titleTop} ${band.title}`);
            }
        }

        await go(page, 154);
        await prepareClipSamples(page, 154);
        for (const width of [861, 885, 900, 1023, 1024, 1060]) {
            await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
            await page.waitForFunction((viewW) => !document.querySelector('.nb-app')?.classList.contains('is-phone') && document.querySelector('[data-page="154"]'), {}, width);
            await settleChrome(page);
            const rosterHits = await geometryHits(page);
            if (rosterHits.length) browserErrors.push(`${width} 명렬 ${rosterHits.slice(0, 4).join(', ')}`);
            const rosterFit = await page.evaluate((birth, note) => {
                const bad = [];
                const canvas = document.createElement('canvas').getContext('2d');
                for (const [label, text] of [['생년월일', birth], ['비고', note]]) {
                    const el = document.querySelector(`[aria-label="1번 ${label}"]`);
                    if (!el || el.value !== text) {
                        bad.push(`${label} 값`);
                        continue;
                    }
                    const cs = getComputedStyle(el);
                    canvas.font = `${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`;
                    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
                    if (canvas.measureText(text).width + pad > el.clientWidth + 1 || el.scrollWidth > el.clientWidth + 1) {
                        bad.push(`${label} ${Math.round(el.clientWidth)}`);
                    }
                }
                const who = document.querySelector('#roster-17 .nb-gobtn.who');
                who?.scrollIntoView({ block: 'center', inline: 'center' });
                const box = who?.getBoundingClientRect();
                const hit = box ? document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2) : null;
                if (!who || !hit || (hit !== who && !who.contains(hit))) bad.push('누가 가림');
                return bad;
            }, SAMPLE_BIRTH, SAMPLE_NOTE_LONG);
            if (rosterFit.length) browserErrors.push(`${width} 명렬 글자 ${rosterFit.join(', ')}`);
        }
        await clearClipSamples(page, 154);

        await page.evaluate(() => {
            localStorage.setItem('homenote_v2_ddayCards', JSON.stringify([
                { id: 'due-card', docNo: '12', title: '공문마감', deadline: '2026-05-06', status: 'todo' },
            ]));
            localStorage.setItem('homenote_v2_notebookFields_p405', JSON.stringify({
                t0: '줄마감',
                d0: '2026-05-08',
                c0: false,
                t1: '다른주',
                d1: '2026-05-20',
                c1: false,
            }));
        });
        await page.reload({ waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForSelector('[data-page]', { timeout: 20000 });
        await page.evaluate(() => { location.hash = '#/week/10'; });
        await page.waitForFunction(() => {
            const due = document.querySelector('[data-page="56"] .nb-week-due');
            const text = due?.innerText || '';
            return text.includes('기한') && text.includes('마감') && text.includes('공문마감') && text.includes('줄마감') && !text.includes('다른주');
        }, { timeout: 20000 });
        for (const [width, height, label] of [[1920, 1080, '1920'], [1366, 768, '1366'], [1024, 768, '1024'], [900, 900, '900'], [390, 844, '390'], [360, 780, '360']]) {
            await page.setViewport({ width, height, deviceScaleFactor: 1 });
            await page.evaluate(() => { location.hash = '#/weeks'; });
            await page.waitForSelector('[data-page="46"]');
            await page.evaluate(() => { location.hash = '#/week/10'; });
            await page.waitForFunction((viewW) => {
                const isPhone = viewW <= 700;
                const app = document.querySelector('.nb-app');
                if (!app || app.classList.contains('is-phone') !== isPhone) return false;
                return Boolean(document.querySelector('[data-page="56"] .nb-week-due'));
            }, {}, width);
            await settleChrome(page);
            const dueText = await page.$eval('.nb-week-due', (el) => el.innerText);
            if (!dueText.includes('공문마감') || !dueText.includes('줄마감') || !dueText.includes('마감')) {
                browserErrors.push(`${label} 주간 기한 문구 ${dueText.replace(/\s+/g, ' ').slice(0, 40)}`);
            }
            const dueHits = await geometryHits(page);
            if (dueHits.length) browserErrors.push(`${label} 주간 기한 ${dueHits.slice(0, 4).join(', ')}`);
            const missed = await inspect(page);
            if (missed.missed.some((item) => item.startsWith('405'))) {
                browserErrors.push(`${label} 주간 기한 링크 ${missed.missed.filter((item) => item.startsWith('405')).join(',')}`);
            }
        }
        await page.evaluate(() => { location.hash = '#/week/11'; });
        await page.waitForFunction(() => Number(document.querySelector('.nb-page')?.dataset.page) === 57);
        const leaked = await page.evaluate(() => {
            const text = document.querySelector('.nb-body')?.innerText || '';
            return text.includes('공문마감') || text.includes('줄마감');
        });
        if (leaked) browserErrors.push('다른 주에 이번 주 기한이 보임');

        await checkCapturePopup(page, browserErrors);

        await page.emulateMediaType('print');
        const headerPrint = await page.$eval('.dy-top', (el) => getComputedStyle(el).display);
        const tabPrint = await page.$eval('.dy-tabs', (el) => getComputedStyle(el).display);
        await page.emulateMediaType('screen');
        if (headerPrint !== 'none') browserErrors.push('인쇄에서 머리가 보임');
        if (tabPrint !== 'none') browserErrors.push('인쇄에서 탭이 보임');

        const badFile = resolve(root, 'scripts/check-browser.mjs');
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
        await page.click('[aria-label="설정"]');
        await page.waitForSelector('input[type="file"]');
        const input = await page.$('input[type="file"]');
        await input.uploadFile(badFile);
        await page.waitForFunction(() => /JSON/.test(document.querySelector('[role="status"]')?.innerText || ''), { timeout: 5000 });
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
