import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { captureShortcut } from '../src/notebook/diary/shortcut.js';

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
        const shownLink = (el) => {
            let node = el;
            while (node && node !== document.body) {
                const st = getComputedStyle(node);
                if (st.display === 'none' || st.visibility === 'hidden') return false;
                node = node.parentElement;
            }
            return true;
        };
        const links = [...document.querySelectorAll('.nb-body [data-to]')].filter(shownLink);
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

async function quietMotion(page) {
    await page.evaluate(() => {
        if (document.getElementById('nb-check-no-motion')) return;
        const style = document.createElement('style');
        style.id = 'nb-check-no-motion';
        style.textContent = '*, *::before, *::after { transition: none !important; animation: none !important; scroll-behavior: auto !important; } .dy-tabs { scroll-snap-type: none !important; }';
        document.head.appendChild(style);
    });
}

export async function geometryHits(page) {
    await quietMotion(page);
    await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
    });
    return page.evaluate(() => {
        document.querySelectorAll('.nb-body, .nb-stage-wrap').forEach((el) => {
            el.scrollTop = 0;
        });
        const hits = [];
        const slop = 2;
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
        if (fabBox && paper && wide && overlaps(fabBox, paper)) hits.push('쓱, 적이 용지 안');
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
                hits.push(`쓱, 적·${labelOf(el)}`);
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
                if (dist < 16) hits.push(`쓱, 적·스티커 간격 ${Math.round(dist)}`);
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
        if (document.body.innerText.includes('쓱적')) hits.push('브랜드 띄어쓰기');
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
        const placeholder = await page.$eval('.dy-quick [data-ssu-capture]', (el) => el.getAttribute('placeholder'));
        if (placeholder !== '쓱, 적어 두세요.') browserErrors.push(`${width} 쓱, 적 안내문 ${placeholder}`);
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
        if (kept !== 1) browserErrors.push(`${width} 쓱, 적 저장 ${kept}`);
    }
    await page.evaluate(() => {
        const raw = localStorage.getItem('homenote_v2_ssugeokInbox');
        if (!raw) return;
        const items = JSON.parse(raw).filter((item) => !String(item.text || '').startsWith('포털확인'));
        localStorage.setItem('homenote_v2_ssugeokInbox', JSON.stringify(items));
    });
    await page.setViewport({ width: 360, height: 780, deviceScaleFactor: 1 });
}

async function checkNoteRevise(page, browserErrors) {
    const wipe = () => page.evaluate(() => {
        const raw = localStorage.getItem('homenote_v2_ssugeokInbox');
        const items = raw ? JSON.parse(raw) : [];
        localStorage.setItem('homenote_v2_ssugeokInbox', JSON.stringify(items.filter((item) => {
            const text = String(item.text || '');
            return !text.startsWith('고치기확인') && !text.startsWith('고친메모');
        })));
    });
    const noteOf = (text, scope) => page.evaluateHandle((sample, root) => {
        const host = root ? document.querySelector(root) : document;
        return [...(host?.querySelectorAll('.dy-entry') || [])].find((el) => {
            const field = el.querySelector('textarea');
            return el.innerText.includes(sample) || field?.value === sample;
        }) || null;
    }, text, scope);
    const clickIn = async (text, attr, scope) => {
        const handle = await noteOf(text, scope);
        const button = await handle.evaluateHandle((el, name) => el?.querySelector(`[${name}]`) || null, attr);
        const exists = await button.evaluate((el) => Boolean(el));
        if (!exists) return false;
        await button.evaluate((el) => el.click());
        return true;
    };
    await wipe();
    for (const width of [1440, 390]) {
        const marker = `고치기확인${width}`;
        const revised = `고친메모${width}`;
        await page.setViewport({ width, height: width === 390 ? 844 : 900, deviceScaleFactor: 1 });
        await go(page, 2);
        await page.waitForSelector('.dy-board [data-ssu-capture], .dy-m [data-ssu-capture]');
        const homePlaceholder = await page.$eval('.dy-board [data-ssu-capture], .dy-m [data-ssu-capture]', (el) => el.getAttribute('placeholder'));
        if (homePlaceholder !== '쓱, 적어 두세요.') browserErrors.push(`${width} 오늘 안내문 ${homePlaceholder}`);
        const branded = await page.evaluate(() => document.body.innerText.includes('쓱적'));
        if (branded) browserErrors.push(`${width} 화면에 쓱적`);
        await page.click('.dy-board [data-ssu-capture], .dy-m [data-ssu-capture]');
        await page.type('.dy-board [data-ssu-capture], .dy-m [data-ssu-capture]', marker);
        await page.click('.dy-board button[type="submit"], .dy-m button[type="submit"]');
        try {
            await page.waitForFunction((text) => {
                const raw = localStorage.getItem('homenote_v2_ssugeokInbox') || '[]';
                return JSON.parse(raw).some((item) => item.text === text)
                    && [...document.querySelectorAll('.dy-entry')].some((el) => el.innerText.includes(text));
            }, { timeout: 4000 }, marker);
        } catch {
            browserErrors.push(`${width} 쓱, 적 남긴 글이 안 보임`);
            continue;
        }
        if (!await clickIn(marker, 'data-note-edit', width === 390 ? '.dy-list' : '.dy-inbox')) {
            browserErrors.push(`${width} 고치기 없음`);
            continue;
        }
        try {
            await page.waitForSelector('.dy-entry-input', { timeout: 2000 });
        } catch {
            browserErrors.push(`${width} 고치기 입력 없음`);
            continue;
        }
        await page.$eval('.dy-entry-input', (el, value) => {
            const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            set.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, revised);
        try {
            await page.waitForFunction((scope) => {
                const host = document.querySelector(scope);
                const btn = host?.querySelector('[data-note-save]');
                return Boolean(btn && !btn.disabled);
            }, { timeout: 2000 }, width === 390 ? '.dy-list' : '.dy-inbox');
        } catch {
            browserErrors.push(`${width} 저장이 켜지지 않음`);
            continue;
        }
        if (!await clickIn(revised, 'data-note-save', width === 390 ? '.dy-list' : '.dy-inbox')) {
            browserErrors.push(`${width} 저장 없음`);
            continue;
        }
        try {
            await page.waitForFunction((text) => {
                const raw = localStorage.getItem('homenote_v2_ssugeokInbox') || '[]';
                return JSON.parse(raw).some((item) => item.text === text);
            }, { timeout: 4000 }, revised);
        } catch {
            browserErrors.push(`${width} 고친 글 저장 실패`);
            continue;
        }
        if (width === 1440) {
            await go(page, 496);
            const onWrite = await page.evaluate((text) => {
                const note = [...document.querySelectorAll('.dy-entry')].find((el) => el.innerText.includes(text));
                return Boolean(note?.querySelector('[data-note-edit]'));
            }, revised);
            if (!onWrite) browserErrors.push('쓰기 쪽에 고치기 없음');
            if (!await clickIn(revised, 'data-note-delete')) browserErrors.push('쓰기 쪽 지우기 없음');
        } else if (!await clickIn(revised, 'data-note-delete', '.dy-list')) {
            browserErrors.push(`${width} 지우기 없음`);
        }
        try {
            await page.waitForFunction((text) => [...document.querySelectorAll('.dy-entry')].some((el) => el.innerText.includes(text) && el.innerText.includes('이 메모를 지울까요?')), { timeout: 2000 }, revised);
        } catch {
            browserErrors.push(`${width} 지우기 확인 없음`);
            continue;
        }
        if (!await clickIn(revised, 'data-note-confirm')) {
            browserErrors.push(`${width} 지우기 확인 버튼 없음`);
            continue;
        }
        try {
            await page.waitForFunction((text) => {
                const raw = localStorage.getItem('homenote_v2_ssugeokInbox') || '[]';
                const goneStore = !JSON.parse(raw).some((item) => item.text === text);
                const goneDom = ![...document.querySelectorAll('.dy-entry')].some((el) => el.innerText.includes(text));
                return goneStore && goneDom;
            }, { timeout: 4000 }, revised);
        } catch {
            browserErrors.push(`${width} 지운 글이 남음`);
        }
    }
    await wipe();
    await go(page, 2);
}

function instantDeleteMisses() {
    const hits = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir, { withFileTypes: true })) {
            const full = resolve(dir, name.name);
            if (name.isDirectory()) {
                if (name.name === 'node_modules' || name.name === 'dist') continue;
                walk(full);
            } else if (/\.jsx$/.test(name.name)) {
                const text = readFileSync(full, 'utf8');
                for (const chunk of text.split('<button').slice(1)) {
                    const end = chunk.indexOf('</button>');
                    const head = chunk.slice(0, end === -1 ? 600 : end);
                    if (/onClick=\{[\s\S]*removeItem\s*\(/.test(head)) hits.push(full.slice(root.length + 1));
                }
            }
        }
    };
    walk(resolve(root, 'src'));
    return hits;
}

function nativeDialogMisses() {
    const hits = [];
    const walk = (dir) => {
        for (const name of readdirSync(dir, { withFileTypes: true })) {
            const full = resolve(dir, name.name);
            if (name.isDirectory()) {
                if (name.name === 'node_modules' || name.name === 'dist') continue;
                walk(full);
            } else if (/\.(js|jsx|mjs)$/.test(name.name)) {
                const text = readFileSync(full, 'utf8');
                if (/\b(confirm|alert|prompt)\s*\(/.test(text)) hits.push(full.slice(root.length + 1));
            }
        }
    };
    walk(resolve(root, 'src'));
    return hits;
}

function shortcutMisses() {
    const cases = [
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 'Win32', 'Ctrl+K'],
        ['Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36', 'Linux x86_64', 'Ctrl+K'],
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 'MacIntel', '⌘K'],
        ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', 'iPhone', '⌘K'],
    ];
    return cases.flatMap(([ua, platform, want]) => (captureShortcut(ua, platform) === want ? [] : [`단축키 ${platform}`]));
}

async function lowContrastButtons(page) {
    return page.evaluate(() => {
        const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
        const lum = (rgb) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
        const parse = (str) => {
            const out = [];
            const re = /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\)/g;
            let matched = re.exec(str);
            while (matched) {
                out.push([Number(matched[1]) / 255, Number(matched[2]) / 255, Number(matched[3]) / 255, matched[4] == null ? 1 : Number(matched[4])]);
                matched = re.exec(str);
            }
            return out;
        };
        const stops = (el) => {
            const colors = [];
            let node = el;
            while (node) {
                const style = getComputedStyle(node);
                for (const color of [...parse(style.backgroundImage), ...parse(style.backgroundColor)]) {
                    if (color[3] >= 0.95) colors.push(color);
                }
                if (colors.length) break;
                node = node.parentElement;
            }
            return colors.length ? colors : [[1, 1, 1, 1]];
        };
        const misses = [];
        for (const el of document.querySelectorAll('button')) {
            if (el.disabled || el.closest('.sr-only')) continue;
            const box = el.getBoundingClientRect();
            if (box.width < 8 || box.height < 8 || box.bottom < 0 || box.top > window.innerHeight) continue;
            const style = getComputedStyle(el);
            if (style.visibility === 'hidden' || style.display === 'none' || Number(style.opacity) < 0.99) continue;
            const texts = [];
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let node = walker.nextNode();
            while (node) {
                if (node.textContent.trim() && !node.parentElement.closest('.sr-only')) texts.push(node.parentElement);
                node = walker.nextNode();
            }
            const samples = texts.length ? texts : [el];
            let worst = 99;
            for (const sample of samples) {
                const fg = parse(getComputedStyle(sample).color)[0];
                if (!fg) continue;
                const fgLum = lum(fg);
                // 흰 글자가 살구 위에 앉는 경우만 봅니다. 어두운 본문은 기존 안내 대비 검사가 맡습니다.
                if (fgLum < 0.6) continue;
                for (const bg of stops(sample)) {
                    const ratio = (Math.max(fgLum, lum(bg)) + 0.05) / (Math.min(fgLum, lum(bg)) + 0.05);
                    if (ratio < worst) worst = ratio;
                }
            }
            if (worst < 4.5) {
                const name = (el.getAttribute('aria-label') || el.innerText || '버튼').replace(/\s+/g, ' ').trim().slice(0, 18);
                misses.push(`${name} ${worst.toFixed(2)}`);
            }
        }
        return misses.slice(0, 8);
    });
}

async function checkQaLayout(page, browserErrors) {
    for (const file of nativeDialogMisses()) browserErrors.push(`네이티브 대화상자 ${file}`);
    for (const file of instantDeleteMisses()) browserErrors.push(`확인 없는 삭제 ${file}`);
    for (const miss of shortcutMisses()) browserErrors.push(miss);
    for (const width of [1440, 1024]) {
        await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
        await go(page, 2);
        await page.waitForSelector('.dy-week .dy-day');
        const week = await page.evaluate(() => {
            const days = [...document.querySelectorAll('.dy-week .dy-day')];
            const boxes = days.map((el) => el.getBoundingClientRect());
            const tops = boxes.map((box) => box.top);
            const widths = boxes.map((box) => box.width);
            const weekBox = document.querySelector('.dy-week')?.getBoundingClientRect();
            const empties = [...document.querySelectorAll('.dy-week .dy-day-empty')];
            const badWrap = empties.some((el) => el.innerText.split('\n').map((line) => line.trim()).some((line) => line === '요' || line === '어'));
            const overlap = empties.some((el) => {
                const sheet = el.parentElement?.querySelector('.dy-day-sheet');
                const card = el.closest('.dy-day')?.getBoundingClientRect();
                if (!sheet || !card) return true;
                const label = el.getBoundingClientRect();
                const lines = sheet.getBoundingClientRect();
                const hits = !(label.bottom <= lines.top + 1 || label.top >= lines.bottom - 1);
                const outside = label.left < card.left - 1 || label.right > card.right + 1 || label.top < card.top - 1;
                return hits || outside;
            });
            const paint = (el) => el ? getComputedStyle(el).backgroundColor : '';
            const sheets = days.map((el) => ({
                today: el.classList.contains('is-today'),
                weekend: el.classList.contains('is-sat') || el.classList.contains('is-sun'),
                empty: el.querySelector('.dy-day-empty')?.textContent || '',
                sheet: paint(el.querySelector('.dy-day-sheet')),
            }));
            return {
                count: days.length,
                topSpread: tops.length ? Math.max(...tops) - Math.min(...tops) : 99,
                widthSpread: widths.length ? Math.max(...widths) - Math.min(...widths) : 99,
                minWidth: widths.length ? Math.min(...widths) : 0,
                weekRight: weekBox?.right || 0,
                view: window.innerWidth,
                badWrap,
                overlap,
                emptyCount: empties.length,
                legend: document.querySelector('.dy-legend')?.innerText || '',
                sheets,
            };
        });
        if (week.count !== 7) browserErrors.push(`${width} 요일 ${week.count}`);
        if (week.topSpread > 4) browserErrors.push(`${width} 요일이 한 줄이 아님`);
        if (week.widthSpread > 8) browserErrors.push(`${width} 요일 너비 차이 ${Math.round(week.widthSpread)}`);
        if (week.minWidth < 96) browserErrors.push(`${width} 요일 칸 ${Math.round(week.minWidth)}`);
        if (week.weekRight > week.view + 2) browserErrors.push(`${width} 주간이 화면 밖`);
        if (week.emptyCount < 1) browserErrors.push(`${width} 빈 날 없음`);
        if (week.badWrap) browserErrors.push(`${width} 빈 날 줄바꿈`);
        if (week.overlap) browserErrors.push(`${width} 빈 날 글자가 줄 위에 겹침`);
        if (!week.legend.includes('오늘') || !week.legend.includes('주말') || !week.legend.includes('업무')) browserErrors.push(`${width} 색 안내 없음`);
        const weekday = week.sheets.filter((day) => day.sheet && !day.today && !day.weekend).map((day) => day.sheet);
        const weekend = week.sheets.filter((day) => day.sheet && day.weekend).map((day) => day.sheet);
        const todaySheet = week.sheets.find((day) => day.today && day.sheet)?.sheet;
        const same = (list) => list.length > 0 && list.every((color) => color === list[0]);
        if (!same(weekday) || !same(weekend) || weekday[0] === weekend[0]) browserErrors.push(`${width} 빈 날 색이 같음`);
        if (todaySheet && (todaySheet === weekday[0] || todaySheet === weekend[0])) browserErrors.push(`${width} 오늘 칸 색이 평일과 같음`);
        const emptyText = week.sheets.map((day) => day.empty).filter(Boolean);
        if (emptyText.some((text) => text === '비어 있어요')) browserErrors.push(`${width} 빈 날 안내가 같음`);
    }

    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await go(page, 2);
    const shown = await page.$eval('.dy-col-right .dy-kbd', (el) => el.textContent.trim());
    const want = captureShortcut(await page.evaluate(() => navigator.userAgent), await page.evaluate(() => navigator.platform));
    if (shown !== want) browserErrors.push(`화면 단축키 ${shown}`);
    const contrast = await page.evaluate(() => {
        const lum = (rgb) => {
            const matched = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (!matched) return null;
            const ch = [Number(matched[1]), Number(matched[2]), Number(matched[3])].map((c) => {
                const s = c / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
        };
        const paint = (el) => {
            let node = el;
            while (node) {
                const matched = getComputedStyle(node).backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
                if (matched && (matched[4] == null || Number(matched[4]) >= 0.95)) return `rgb(${matched[1]}, ${matched[2]}, ${matched[3]})`;
                node = node.parentElement;
            }
            return 'rgb(255, 255, 255)';
        };
        const ratio = (el) => {
            const cs = getComputedStyle(el);
            const a = lum(cs.color);
            const b = lum(paint(el));
            if (a == null || b == null) return 0;
            return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const hint = document.querySelector('.dy-cap-hint');
        const btn = document.querySelector('.dy-cap button[type="submit"]');
        return {
            hint: hint ? ratio(hint) : 0,
            btn: btn ? ratio(btn) : 0,
            opacity: btn ? Number(getComputedStyle(btn).opacity) : 0,
            disabled: Boolean(btn?.disabled),
        };
    });
    if (!contrast.disabled) browserErrors.push('남기기 버튼이 켜져 있음');
    if (!(contrast.hint >= 4.5)) browserErrors.push(`안내 대비 ${contrast.hint.toFixed(2)}`);
    if (!(contrast.btn >= 4.5)) browserErrors.push(`남기기 대비 ${contrast.btn.toFixed(2)}`);
    if (!(contrast.opacity >= 0.99)) browserErrors.push('남기기 흐림');

    await page.click('.dy-board [data-ssu-capture]');
    await page.type('.dy-board [data-ssu-capture]', '버튼줄확인');
    for (const item of await lowContrastButtons(page)) browserErrors.push(`1440 버튼 대비 ${item}`);
    await page.click('.dy-board button[type="submit"]');
    try {
        await page.waitForFunction(() => [...document.querySelectorAll('.dy-inbox .dy-entry')].some((el) => el.innerText.includes('버튼줄확인')), { timeout: 4000 });
    } catch {
        browserErrors.push('1440 버튼 줄 메모 없음');
    }
    const row = await page.evaluate(() => {
        const entry = [...document.querySelectorAll('.dy-inbox .dy-entry')].find((el) => el.innerText.includes('버튼줄확인'));
        const buttons = [...(entry?.querySelectorAll('.dy-entry-acts button') || [])];
        const erase = buttons.find((el) => el.textContent.includes('지우기'));
        if (!erase) return { count: buttons.length, withErase: 0 };
        const top = erase.getBoundingClientRect().top;
        const withErase = buttons.filter((el) => Math.abs(el.getBoundingClientRect().top - top) < 6).length;
        const heights = buttons.map((el) => el.getBoundingClientRect().height);
        return { count: buttons.length, withErase, minH: heights.length ? Math.min(...heights) : 0 };
    });
    if (row.count < 4 || row.withErase !== row.count) browserErrors.push(`1440 버튼이 한 줄이 아님 ${row.count}/${row.withErase}`);
    if (!(row.minH >= 44)) browserErrors.push(`1440 버튼 높이 ${Math.round(row.minH || 0)}`);

    await page.setViewport({ width: 360, height: 844, deviceScaleFactor: 1 });
    await go(page, 2);
    const titleBreaks = await page.evaluate(() => {
        const bad = [];
        const walk = (el, label) => {
            if (!el) return;
            const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
            let node = walker.nextNode();
            const range = document.createRange();
            while (node) {
                const text = node.textContent;
                let prev = null;
                for (let i = 0; i < text.length; i += 1) {
                    const ch = text[i];
                    if (/\s/.test(ch)) {
                        prev = null;
                        continue;
                    }
                    range.setStart(node, i);
                    range.setEnd(node, i + 1);
                    const rect = range.getClientRects()[0];
                    if (!rect) continue;
                    const top = Math.round(rect.top);
                    if (prev && Math.abs(top - prev.top) > 4) bad.push(`${label} ${prev.ch}${ch}`);
                    prev = { ch, top };
                }
                node = walker.nextNode();
            }
        };
        document.querySelectorAll('.dy-m .dy-sec-head .dy-h, .dy-m .dy-sec-head .dy-link').forEach((el, index) => walk(el, index === 0 ? '날짜' : el.innerText.replace(/\s+/g, '').slice(0, 8)));
        return bad.slice(0, 6);
    });
    if (titleBreaks.length) browserErrors.push(`360 제목 줄바꿈 ${titleBreaks.join('|')}`);

    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await go(page, 2);
    await page.waitForSelector('.dy-m [data-ssu-capture]');
    const fill = async (text) => {
        await page.$eval('.dy-m [data-ssu-capture]', (el, value) => {
            const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            set.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, text);
        await page.click('.dy-m button[type="submit"]');
    };
    await fill('토스트확인');
    try {
        await page.waitForFunction(() => [...document.querySelectorAll('.dy-entry')].some((el) => el.innerText.includes('토스트확인')), { timeout: 4000 });
    } catch {
        browserErrors.push('390 토스트용 메모 없음');
    }
    await page.evaluate(() => {
        const entry = [...document.querySelectorAll('.dy-entry')].find((el) => el.innerText.includes('토스트확인'));
        entry?.querySelector('[data-note-edit]')?.click();
    });
    try {
        await page.waitForSelector('[data-note-save]', { timeout: 2000 });
    } catch {
        browserErrors.push('390 저장 버튼 없음');
    }
    for (const item of await lowContrastButtons(page)) browserErrors.push(`390 버튼 대비 ${item}`);
    await fill('토스트둘');
    try {
        await page.waitForSelector('[role="status"]', { timeout: 2500 });
    } catch {
        browserErrors.push('390 토스트 없음');
    }
    const cover = await page.evaluate(() => {
        const painted = (el) => {
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            let top = Math.max(rect.top, 0);
            let left = Math.max(rect.left, 0);
            let right = Math.min(rect.right, window.innerWidth);
            let bottom = Math.min(rect.bottom, window.innerHeight);
            for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
                const style = getComputedStyle(node);
                if (/(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflowY)) {
                    const host = node.getBoundingClientRect();
                    top = Math.max(top, host.top);
                    left = Math.max(left, host.left);
                    right = Math.min(right, host.right);
                    bottom = Math.min(bottom, host.bottom);
                }
            }
            if (right - left < 1 || bottom - top < 1) return null;
            return { top, left, right, bottom };
        };
        const toast = document.querySelector('[role="status"]');
        const save = document.querySelector('[data-note-save]');
        const cancel = document.querySelector('[data-note-cancel]');
        if (!toast || !save || !cancel) return { missing: true };
        const a = painted(toast);
        const overlaps = (el) => {
            const b = painted(el);
            if (!a || !b) return false;
            return !(a.bottom <= b.top + 1 || a.top >= b.bottom - 1 || a.right <= b.left + 1 || a.left >= b.right - 1);
        };
        const fields = [...document.querySelectorAll('textarea, input')].filter((el) => el.type !== 'hidden' && el.type !== 'checkbox');
        const fab = document.querySelector('.dy-fab');
        const style = getComputedStyle(toast);
        return {
            missing: false,
            save: overlaps(save),
            cancel: overlaps(cancel),
            input: fields.some(overlaps),
            fab: overlaps(fab),
            top: a.top,
            position: style.position,
            pointer: style.pointerEvents,
            slot: Boolean(document.querySelector('.dy-toast-slot')),
        };
    });
    if (cover.missing) browserErrors.push('390 토스트 또는 저장 버튼 없음');
    else {
        if (cover.fab) browserErrors.push('390 토스트가 쓱, 적 버튼을 가림');
        if (cover.position !== 'fixed' || cover.slot) browserErrors.push('390 토스트가 흐름에 있음');
        if (cover.pointer !== 'none') browserErrors.push('390 토스트가 클릭을 막음');
    }
    const phoneRows = await page.evaluate(() => {
        const read = (sel) => {
            const acts = document.querySelector(sel);
            const buttons = [...(acts?.querySelectorAll('button') || [])].filter((el) => el.offsetParent);
            const tops = buttons.map((el) => el.getBoundingClientRect().top);
            return { count: buttons.length, spread: tops.length ? Math.max(...tops) - Math.min(...tops) : 99 };
        };
        return { home: read('.dy-inbox .dy-entry-acts') };
    });
    if (phoneRows.home.count < 4) browserErrors.push(`390 오늘 버튼 ${phoneRows.home.count}`);
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await go(page, 496);
    await page.waitForSelector('.nb-ssu-list .dy-entry-acts');
    const phoneWrite = await page.evaluate(() => {
        const acts = document.querySelector('.nb-ssu-list .dy-entry-acts');
        const buttons = [...(acts?.querySelectorAll('button') || [])].filter((el) => el.offsetParent);
        const tops = buttons.map((el) => el.getBoundingClientRect().top);
        return { count: buttons.length, spread: tops.length ? Math.max(...tops) - Math.min(...tops) : 99 };
    });
    if (phoneWrite.count < 3) browserErrors.push(`390 쓱, 적 버튼 ${phoneWrite.count}`);
    for (const width of [1024, 1280]) {
        await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
        await go(page, 2);
        await page.waitForSelector('.dy-board [data-ssu-capture]');
        await page.evaluate(() => {
            const entry = [...document.querySelectorAll('.dy-inbox .dy-entry')].find((el) => el.innerText.includes('토스트확인'));
            entry?.querySelector('[data-note-edit]')?.click();
        });
        await page.$eval('.dy-board [data-ssu-capture]', (el, value) => {
            const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
            set.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
        }, `토스트가로${width}`);
        await page.click('.dy-board button[type="submit"]');
        try {
            await page.waitForSelector('[role="status"]', { timeout: 2500 });
        } catch {
            browserErrors.push(`${width} 토스트 없음`);
        }
        const wideCover = await page.evaluate(() => {
            const painted = (el) => {
                if (!el) return null;
                const rect = el.getBoundingClientRect();
                let top = Math.max(rect.top, 0);
                let left = Math.max(rect.left, 0);
                let right = Math.min(rect.right, window.innerWidth);
                let bottom = Math.min(rect.bottom, window.innerHeight);
                for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
                    const style = getComputedStyle(node);
                    if (/(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflowY)) {
                        const host = node.getBoundingClientRect();
                        top = Math.max(top, host.top);
                        left = Math.max(left, host.left);
                        right = Math.min(right, host.right);
                        bottom = Math.min(bottom, host.bottom);
                    }
                }
                if (right - left < 1 || bottom - top < 1) return null;
                return { top, left, right, bottom };
            };
            const toast = painted(document.querySelector('[role="status"]'));
            if (!toast) return { missing: true };
            const hit = (el) => {
                const b = painted(el);
                if (!b) return false;
                return !(toast.bottom <= b.top + 1 || toast.top >= b.bottom - 1 || toast.right <= b.left + 1 || toast.left >= b.right - 1);
            };
            const fields = [...document.querySelectorAll('textarea, input')].filter((el) => el.type !== 'hidden' && el.type !== 'checkbox');
            const el = document.querySelector('[role="status"]');
            const style = getComputedStyle(el);
            return {
                missing: false,
                input: fields.some(hit),
                save: hit(document.querySelector('[data-note-save]')),
                top: toast.top,
                bottom: toast.bottom,
                height: window.innerHeight,
                position: style.position,
                pointer: style.pointerEvents,
                slot: Boolean(document.querySelector('.dy-toast-slot')),
            };
        });
        if (wideCover.missing) browserErrors.push(`${width} 토스트 없음`);
        else {
            if (wideCover.input) browserErrors.push(`${width} 토스트가 입력을 가림`);
            if (wideCover.save) browserErrors.push(`${width} 토스트가 저장 버튼을 가림`);
            if (wideCover.position !== 'fixed' || wideCover.slot) browserErrors.push(`${width} 토스트가 흐름에 있음`);
            if (wideCover.pointer !== 'none') browserErrors.push(`${width} 토스트가 클릭을 막음`);
        }
        const spread = await page.evaluate(() => {
            const acts = document.querySelector('.dy-inbox .dy-entry-acts');
            const buttons = [...(acts?.querySelectorAll('button') || [])].filter((el) => el.offsetParent);
            const tops = buttons.map((el) => el.getBoundingClientRect().top);
            return { count: buttons.length, spread: tops.length ? Math.max(...tops) - Math.min(...tops) : 99 };
        });
        if (spread.count < 4 || spread.spread > 8) browserErrors.push(`${width} 오늘 버튼이 한 줄이 아님 ${spread.count}/${Math.round(spread.spread)}`);
        await go(page, 496);
        await page.waitForSelector('.nb-ssu-list .dy-entry-acts');
        const writeSpread = await page.evaluate(() => {
            const acts = document.querySelector('.nb-ssu-list .dy-entry-acts');
            const buttons = [...(acts?.querySelectorAll('button') || [])].filter((el) => el.offsetParent);
            const tops = buttons.map((el) => el.getBoundingClientRect().top);
            const more = acts?.querySelector('.dy-act-more summary')?.getBoundingClientRect();
            return {
                count: buttons.length,
                spread: tops.length ? Math.max(...tops) - Math.min(...tops) : 99,
                moreH: more?.height || 0,
                moreW: more?.width || 0,
            };
        });
        if (writeSpread.count < 3 || writeSpread.spread > 8) browserErrors.push(`${width} 쓱, 적 버튼이 한 줄이 아님 ${writeSpread.count}/${Math.round(writeSpread.spread)}`);
        if (width === 1280 && (writeSpread.moreH < 44 || writeSpread.moreH > 46 || writeSpread.moreW < 44 || writeSpread.moreW > 46)) {
            browserErrors.push(`1280 더보기 ${Math.round(writeSpread.moreW)}x${Math.round(writeSpread.moreH)}`);
        }
    }

    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await go(page, 496);
    await page.evaluate(() => { window.confirm = () => { window.__nativeConfirm = true; return false; }; });
    const hub = await page.$('button.nb-hubbtn');
    if (!hub) browserErrors.push('허브 버튼 없음');
    else {
        await hub.click();
        try {
            await page.waitForSelector('textarea[aria-label="쓱, 적 내용"]', { timeout: 3000 });
        } catch {
            browserErrors.push('허브 입력 없음');
        }
        const placeholder = await page.$eval('textarea[aria-label="쓱, 적 내용"]', (el) => el.getAttribute('placeholder'));
        if (placeholder !== '쓱, 적어 두세요.') browserErrors.push(`허브 안내문 ${placeholder}`);
        await page.type('textarea[aria-label="쓱, 적 내용"]', '허브삭제확인');
        await page.evaluate(() => {
            [...document.querySelectorAll('button')].find((el) => el.textContent.includes('쓱, 적에 넣기'))?.click();
        });
        try {
            await page.waitForFunction(() => document.body.innerText.includes('허브삭제확인'), { timeout: 4000 });
        } catch {
            browserErrors.push('허브 메모 없음');
        }
        await page.evaluate(() => {
            const card = [...document.querySelectorAll('article')].find((el) => el.innerText.includes('허브삭제확인'));
            card?.querySelector('[aria-label="삭제"]')?.click();
        });
        try {
            await page.waitForSelector('#ssu-del-title', { timeout: 2000 });
        } catch {
            browserErrors.push('허브 지우기 창 없음');
        }
        const title = await page.$eval('#ssu-del-title', (el) => el.textContent.trim()).catch(() => '');
        if (title !== '이 쓱, 적을 지울까요?') browserErrors.push(`허브 확인 ${title}`);
        if (await page.evaluate(() => window.__nativeConfirm === true)) browserErrors.push('허브가 confirm을 씀');
        await page.evaluate(() => {
            [...document.querySelectorAll('.dy-quick.is-confirm button')].find((el) => el.textContent.trim() === '지우기')?.click();
        });
        try {
            await page.waitForFunction(() => {
                const raw = localStorage.getItem('homenote_v2_ssugeokInbox') || '[]';
                return !JSON.parse(raw).some((item) => item.text === '허브삭제확인');
            }, { timeout: 4000 });
        } catch {
            browserErrors.push('허브 삭제가 저장에 남음');
        }
        await page.keyboard.press('Escape');
    }

    const snapStable = (target) => target.evaluate(() => {
        const nodes = [];
        const push = (el, name) => {
            if (!el || !el.getClientRects().length) return;
            const rect = el.getBoundingClientRect();
            nodes.push({
                name,
                top: Math.round(rect.top * 10) / 10,
                left: Math.round(rect.left * 10) / 10,
            });
        };
        document.querySelectorAll('.dy-tab').forEach((el, index) => push(el, `탭${index}`));
        push(document.querySelector('.dy-month-label'), '달');
        push(document.querySelector('[data-ssu-capture]'), '입력');
        const form = document.querySelector('[data-ssu-capture]')?.closest('form');
        push(form?.querySelector('button[type="submit"]'), '남기기');
        push(document.querySelector('.dy-fab'), '쓱적');
        return nodes;
    });
    const layoutShift = (before, during, after) => {
        const cmp = (a, b, tag) => {
            if (!a || !b || !a.length || !b.length) return `${tag} 없음`;
            if (a.length !== b.length) return `${tag} 개수 ${a.length}/${b.length}`;
            const moved = [];
            for (let i = 0; i < a.length; i += 1) {
                if (Math.abs(a[i].top - b[i].top) > 1 || Math.abs(a[i].left - b[i].left) > 1) {
                    moved.push(`${a[i].name} ${a[i].top}->${b[i].top}`);
                }
            }
            return moved.length ? `${tag} ${moved.slice(0, 3).join('|')}` : '';
        };
        return [cmp(before, during, '동안'), cmp(before, after, '뒤')].filter(Boolean).join('; ');
    };
    const assertScrollClear = async (label) => {
        const bad = await page.evaluate(() => {
            const stage = document.querySelector('.dy-stage');
            const sample = () => {
                const hits = [];
                if (document.querySelector('.dy-toast-slot')) hits.push('빈칸');
                const header = document.querySelector('.dy-top')?.getBoundingClientRect();
                const stageBox = stage?.getBoundingClientRect();
                if (header && stageBox) {
                    const gap = stageBox.top - header.bottom;
                    if (gap > 4) hits.push(`빈띠 ${Math.round(gap)}`);
                    if (gap < -1) hits.push('머리가 본문을 가림');
                }
                if (!stageBox) return hits;
                const targets = document.querySelectorAll('.dy-entry, .nb-dday-card, .dy-card, .dy-day, .nb-page, .nb-kanban section');
                for (const el of targets) {
                    const rect = el.getBoundingClientRect();
                    const top = Math.max(rect.top, stageBox.top);
                    const left = Math.max(rect.left, stageBox.left);
                    const right = Math.min(rect.right, stageBox.right);
                    const bottom = Math.min(rect.bottom, stageBox.bottom, window.innerHeight);
                    if (right - left < 12 || bottom - top < 12) continue;
                    const x = left + Math.min(20, (right - left) / 2);
                    const y = top + 4;
                    const hit = document.elementFromPoint(x, y);
                    if (!hit || hit === el || el.contains(hit)) continue;
                    const cover = hit.closest('.dy-toast-slot, .dy-top');
                    if (!cover) continue;
                    const name = (el.innerText || el.className || '').toString().replace(/\s+/g, ' ').trim().slice(0, 18);
                    hits.push(`가림:${name}`);
                }
                return hits;
            };
            const points = stage ? [0, Math.round(stage.scrollHeight / 2), stage.scrollHeight] : [0];
            const prev = stage?.scrollTop || 0;
            const behavior = stage?.style.scrollBehavior;
            if (stage) stage.style.scrollBehavior = 'auto';
            const found = [];
            for (const top of points) {
                if (stage) stage.scrollTop = top;
                found.push(...sample());
            }
            if (stage) {
                stage.scrollTop = prev;
                stage.style.scrollBehavior = behavior;
            }
            return [...new Set(found)].slice(0, 6);
        });
        if (bad.length) browserErrors.push(`${label} 스크롤 잘림 ${bad.join('|')}`);
    };
    const samples = [
        '@12 #행발 발표를 또렷하게 그리고 복도 게시판까지 안내문을 길게 남긴다',
        '내일 회의 자료 인쇄와 학부모 안내문 초안과 복사실 예약을 한 메모에 모아 둔다',
        '특별한 하루 운동회 준비물을 학급 게시판과 알림장과 가정통신문에 같은 문장으로 적는다',
    ];
    const assertFit = async (label) => {
        const fit = await page.evaluate(() => {
            const width = window.innerWidth;
            const offenders = [];
            for (const el of document.querySelectorAll('button, a, input, textarea, select, summary, .dy-strip-day')) {
                if (el.closest('.dy-tabs, .sr-only, .dy-more')) continue;
                const box = el.getBoundingClientRect();
                if (box.width < 1 || box.height < 1) continue;
                if (box.bottom < 0 || box.top > window.innerHeight) continue;
                if (box.left < -1 || box.right > width + 1) {
                    offenders.push((el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 24));
                }
            }
            return { doc: document.documentElement.scrollWidth, width, offenders: offenders.slice(0, 6) };
        });
        if (fit.doc > fit.width + 1) browserErrors.push(`${label} 가로 스크롤 ${fit.doc}`);
        if (fit.offenders.length) browserErrors.push(`${label} 잘림 ${fit.offenders.join('|')}`);
    };
    const assertClear = async (label) => {
        const bad = await page.evaluate(() => {
            const painted = (el) => {
                if (!el) return null;
                const rect = el.getBoundingClientRect();
                let top = Math.max(rect.top, 0);
                let left = Math.max(rect.left, 0);
                let right = Math.min(rect.right, window.innerWidth);
                let bottom = Math.min(rect.bottom, window.innerHeight);
                for (let node = el.parentElement; node && node !== document.body; node = node.parentElement) {
                    const style = getComputedStyle(node);
                    if (/(auto|scroll|hidden|clip)/.test(style.overflowX + style.overflowY)) {
                        const host = node.getBoundingClientRect();
                        top = Math.max(top, host.top);
                        left = Math.max(left, host.left);
                        right = Math.min(right, host.right);
                        bottom = Math.min(bottom, host.bottom);
                    }
                }
                if (right - left < 1 || bottom - top < 1) return null;
                return { top, left, right, bottom };
            };
            const overlaps = (a, b) => !(a.bottom <= b.top + 1 || a.top >= b.bottom - 1 || a.right <= b.left + 1 || a.left >= b.right - 1);
            const toastEl = document.querySelector('.dy-toast');
            if (toastEl && getComputedStyle(toastEl).position !== 'fixed') return ['토스트:흐름'];
            if (document.querySelector('.dy-toast-slot')) return ['토스트:빈칸'];
            const stage = document.querySelector('.dy-stage');
            const fab = painted(document.querySelector('.dy-fab'));
            if (!stage || !fab) return [];
            const controls = [...document.querySelectorAll('button, a, input, textarea, select, summary')].filter((el) => {
                if (el.closest('.dy-toast, .dy-fab') || el.classList.contains('dy-fab')) return false;
                return true;
            });
            const prev = stage.scrollTop;
            const behavior = stage.style.scrollBehavior;
            stage.style.scrollBehavior = 'auto';
            const stuckAt = () => {
                const origin = stage.scrollTop;
                const hits = [];
                const maxScroll = Math.max(0, stage.scrollHeight - stage.clientHeight);
                for (const el of controls) {
                    const box = painted(el);
                    const raw = el.getBoundingClientRect();
                    if (!box || raw.height < 1 || !overlaps(fab, box)) continue;
                    const name = (el.getAttribute('aria-label') || el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 16);
                    const need = Math.max(0, raw.bottom - fab.top + 2);
                    stage.scrollTop = Math.min(maxScroll, origin + need);
                    const moved = painted(el);
                    const movedRaw = el.getBoundingClientRect();
                    stage.scrollTop = origin;
                    if (moved && overlaps(fab, moved) && movedRaw.bottom > fab.top + 1) hits.push(`단추:${name}`);
                }
                return hits;
            };
            const hits = stuckAt();
            stage.scrollTop = stage.scrollHeight;
            const endHits = stuckAt().map((name) => `끝:${name}`);
            stage.scrollTop = prev;
            stage.style.scrollBehavior = behavior;
            return [...hits, ...endHits].slice(0, 8);
        });
        if (bad.length) browserErrors.push(`${label} 겹침 ${bad.join('|')}`);
    };
    const assertToastText = async (label) => {
        const fit = await page.evaluate(() => {
            const toast = document.querySelector('.dy-toast');
            const span = toast?.querySelector('span');
            const fab = document.querySelector('.dy-fab')?.getBoundingClientRect();
            if (!toast || !span) return { missing: true };
            const box = toast.getBoundingClientRect();
            const style = getComputedStyle(toast);
            const line = parseFloat(getComputedStyle(span).lineHeight) || 22;
            return {
                missing: false,
                text: span.textContent || '',
                sw: span.scrollWidth,
                cw: span.clientWidth,
                sh: span.scrollHeight,
                ch: span.clientHeight,
                lines: Math.round(span.getBoundingClientRect().height / line),
                left: Math.round(box.left),
                right: Math.round(window.innerWidth - box.right),
                position: style.position,
                pointer: style.pointerEvents,
                aboveFab: fab ? box.bottom <= fab.top + 1 : true,
            };
        });
        if (fit.missing) {
            browserErrors.push(`${label} 없음`);
            return;
        }
        if (fit.sw > fit.cw + 1 || fit.sh > fit.ch + 1) browserErrors.push(`${label} 잘림 ${fit.sw}/${fit.cw} ${fit.text.slice(0, 18)}`);
        if (fit.lines > 2) browserErrors.push(`${label} ${fit.lines}줄`);
        if (fit.position !== 'fixed' || fit.pointer !== 'none') browserErrors.push(`${label} 흐름`);
        if (Math.abs(fit.left - 16) > 2 || Math.abs(fit.right - 16) > 2) browserErrors.push(`${label} 여백 ${fit.left}/${fit.right}`);
        if (!fit.aboveFab) browserErrors.push(`${label}가 쓱, 적 버튼을 가림`);
    };
    const assertStageReach = async (label) => {
        const reach = await page.evaluate(() => {
            const stage = document.querySelector('.dy-stage')?.getBoundingClientRect();
            if (!stage) return null;
            const fab = document.querySelector('.dy-fab')?.getBoundingClientRect();
            const scroller = document.querySelector('.dy-stage');
            const prev = scroller?.scrollTop || 0;
            const behavior = scroller?.style.scrollBehavior;
            if (scroller) {
                scroller.style.scrollBehavior = 'auto';
                scroller.scrollTop = scroller.scrollHeight;
            }
            const buttons = [...document.querySelectorAll('.dy-entry button, .nb-dday-card button, .nb-page button')].filter((el) => {
                const box = el.getBoundingClientRect();
                return box.width > 8 && box.height > 8;
            });
            const tail = buttons.length ? buttons[buttons.length - 1].getBoundingClientRect() : null;
            const fabNow = document.querySelector('.dy-fab')?.getBoundingClientRect();
            if (scroller) {
                scroller.scrollTop = prev;
                scroller.style.scrollBehavior = behavior;
            }
            return {
                gap: Math.round((window.innerHeight - stage.bottom) * 10) / 10,
                fabBand: fab ? Math.round(window.innerHeight - fab.top) : 88,
                tailClear: tail && fabNow ? tail.bottom <= fabNow.top + 1 : true,
            };
        });
        if (!reach) {
            browserErrors.push(`${label} 본문 없음`);
            return;
        }
        const reachesScreen = reach.gap <= 8;
        const reachesFab = reach.gap <= reach.fabBand + 4;
        if (!reachesScreen && !reachesFab) browserErrors.push(`${label} 아래 빈칸 ${reach.gap}`);
        if (!reach.tailClear) browserErrors.push(`${label} 마지막 카드가 쓱, 적에 가림`);
    };
    for (const width of [360, 390, 1024, 1280, 1440]) {
        const phone = width <= 700;
        await page.setViewport({ width, height: phone ? 844 : 900, deviceScaleFactor: 1 });
        for (const count of [1, 3, 8]) {
            const notes = Array.from({ length: count }, (_, i) => ({
                id: `local-qa-${width}-${count}-${i}`,
                text: i === 0
                    ? `${samples[0]} 확인용아주긴토큰${'가나다라마바사아자차카타파하'.repeat(2)}`
                    : samples[i % samples.length],
                author: '선생님',
                fromPage: 2,
                status: 'inbox',
                createdAt: new Date(Date.now() - i * 1000).toISOString(),
            }));
            await page.evaluate((items) => {
                localStorage.setItem('homenote_v2_ssugeokInbox', JSON.stringify(items));
            }, notes);
            await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
            await go(page, 2);
            await page.waitForSelector('.dy-inbox .dy-entry-acts');
            await assertFit(`${width} 메모${count}`);
            await assertClear(`${width} 메모${count}`);
            if (phone) await assertStageReach(`${width} 메모${count}`);
            if (!phone) {
                const row = await page.evaluate(() => {
                    const acts = document.querySelector('.dy-inbox .dy-entry-acts');
                    const buttons = [...(acts?.querySelectorAll('button') || [])].filter((el) => el.offsetParent);
                    const tops = buttons.map((el) => el.getBoundingClientRect().top);
                    const heights = buttons.map((el) => el.getBoundingClientRect().height);
                    return {
                        count: buttons.length,
                        spread: tops.length ? Math.max(...tops) - Math.min(...tops) : 99,
                        minH: heights.length ? Math.min(...heights) : 0,
                    };
                });
                if (row.count < 4 || row.spread > 8) browserErrors.push(`${width} 긴 메모 버튼 줄 ${row.count}/${Math.round(row.spread)}`);
                if (!(row.minH >= 44)) browserErrors.push(`${width} 긴 메모 버튼 높이 ${Math.round(row.minH)}`);
            }
            await page.evaluate(() => document.querySelector('.dy-inbox [data-note-edit]')?.click());
            try {
                await page.waitForSelector('.dy-inbox [data-note-save]', { timeout: 2000 });
            } catch {
                browserErrors.push(`${width} 수정${count} 저장 없음`);
            }
            await assertFit(`${width} 수정${count}`);
            await assertClear(`${width} 수정${count}`);
            const captureSel = phone ? '.dy-m [data-ssu-capture]' : '.dy-board [data-ssu-capture]';
            await page.evaluate((sel, value) => {
                const el = document.querySelector(sel);
                if (!el) return;
                const set = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
                set.call(el, value);
                el.dispatchEvent(new Event('input', { bubbles: true }));
            }, captureSel, `토스트실측${width}-${count}`);
            await page.waitForFunction((sel) => {
                const field = document.querySelector(sel);
                const btn = field?.closest('form')?.querySelector('button[type="submit"]');
                return btn && !btn.disabled;
            }, { timeout: 2000 }, captureSel).catch(() => {});
            const beforeLayout = count === 1 ? await snapStable(page) : null;
            await page.evaluate((sel) => document.querySelector(sel)?.closest('form')?.querySelector('button[type="submit"]')?.click(), captureSel);
            try {
                await page.waitForSelector('[role="status"]', { timeout: 2500 });
            } catch {
                browserErrors.push(`${width} 토스트${count} 없음`);
            }
            await assertFit(`${width} 토스트${count}`);
            await assertClear(`${width} 토스트${count}`);
            if (width <= 600) {
                await assertToastText(`${width} 저장 토스트${count}`);
                await assertStageReach(`${width} 토스트${count}`);
            }
            if (count === 1) {
                const duringLayout = await snapStable(page);
                await assertScrollClear(`${width} 토스트`);
                try {
                    await page.waitForFunction(() => !document.querySelector('.dy-toast'), { timeout: 5000 });
                } catch {
                    browserErrors.push(`${width} 토스트가 남지 않음`);
                }
                const afterLayout = await snapStable(page);
                const shift = layoutShift(beforeLayout, duringLayout, afterLayout);
                if (shift) browserErrors.push(`${width} 저장 위치 ${shift}`);
                await assertScrollClear(`${width} 토스트 후`);
            }
            if (count === 8) {
                await go(page, 496);
                await page.waitForSelector('.nb-ssu-list .dy-entry');
                await assertFit(`${width} 쓱적8`);
                await assertClear(`${width} 쓱적8`);
            }
        }
    }
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    const todayStamp = await page.evaluate(() => {
        const n = new Date();
        const m = String(n.getMonth() + 1).padStart(2, '0');
        const d = String(n.getDate()).padStart(2, '0');
        return `${n.getFullYear()}-${m}-${d}`;
    });
    await page.evaluate((stamp) => {
        localStorage.setItem('homenote_v2_teacherAttend', JSON.stringify([{
            id: 'local-att-qa', student: '김가온', status: '지각', date: stamp, note: '늦음', createdAt: new Date().toISOString(),
        }]));
        localStorage.setItem('homenote_v2_teacherTodos', JSON.stringify([{
            id: 'local-todo-qa', text: '확인용 할 일', done: false, date: stamp, createdAt: new Date().toISOString(),
        }]));
        localStorage.setItem('homenote_v2_studentNotes', JSON.stringify([{
            id: 'local-stu-qa', student: '김가온', text: '확인용 학생기록', date: stamp, createdAt: new Date().toISOString(),
        }]));
        localStorage.setItem('homenote_v2_counselNotes', JSON.stringify([{
            id: 'local-cou-qa', student: '김가온', text: '확인용 상담', date: stamp, kind: '상담', createdAt: new Date().toISOString(),
        }]));
        localStorage.setItem('homenote_v2_teacherPlans', JSON.stringify([{
            id: 'local-plan-qa', text: '확인용 계획', date: stamp, kind: 'today', weekStart: stamp, createdAt: new Date().toISOString(),
        }]));
        localStorage.setItem('homenote_v2_classRoster', JSON.stringify([{
            id: 'local-roster-qa', name: '김가온', createdAt: new Date().toISOString(),
        }]));
        const past = new Date(`${stamp}T12:00:00`);
        past.setDate(past.getDate() - 2);
        const future = new Date(`${stamp}T12:00:00`);
        future.setDate(future.getDate() + 3);
        const ymd = (date) => {
            const m = String(date.getMonth() + 1).padStart(2, '0');
            const d = String(date.getDate()).padStart(2, '0');
            return `${date.getFullYear()}-${m}-${d}`;
        };
        localStorage.setItem('homenote_v2_ddayCards', JSON.stringify([
            { id: 'local-dday-qa', docNo: '12', title: '확인용 기한', deadline: stamp, status: 'todo' },
            { id: 'local-dday-past', docNo: '11', title: '지난 기한', deadline: ymd(past), status: 'todo' },
            { id: 'local-dday-soon', docNo: '13', title: '다가올 기한', deadline: ymd(future), status: 'todo' },
        ]));
        localStorage.setItem('homenote_v2_submissionSheets', JSON.stringify([{
            id: 'local-sheet-qa', title: '확인용 제출', submitted: [],
        }]));
        window.confirm = () => { window.__nativeConfirm = true; return false; };
    }, todayStamp);
    await page.reload({ waitUntil: 'networkidle0', timeout: 60000 });
    await go(page, 496);
    const hubBtn = await page.$('button.nb-hubbtn');
    if (!hubBtn) browserErrors.push('삭제 확인 허브 없음');
    else {
        await hubBtn.click();
        await page.waitForSelector('[role="dialog"]');
        await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]');
            [...dialog.querySelectorAll('button')].find((el) => el.textContent.trim() === '출결')?.click();
        });
        try {
            await page.waitForFunction(() => [...document.querySelectorAll('[role="dialog"] button')].some((el) => el.textContent.trim() === '삭제'), { timeout: 3000 });
        } catch {
            browserErrors.push('출결 삭제 버튼 없음');
        }
        await page.evaluate(() => {
            [...document.querySelectorAll('[role="dialog"] button')].find((el) => el.textContent.trim() === '삭제')?.click();
        });
        try {
            await page.waitForSelector('#dy-confirm-title', { timeout: 2000 });
        } catch {
            browserErrors.push('출결 확인 창 없음');
        }
        const attendTitle = await page.$eval('#dy-confirm-title', (el) => el.textContent.trim()).catch(() => '');
        if (attendTitle !== '이 출결을 지울까요?') browserErrors.push(`출결 확인 ${attendTitle}`);
        if (await page.evaluate(() => window.__nativeConfirm === true)) browserErrors.push('출결이 confirm을 씀');
        await page.evaluate(() => {
            [...document.querySelectorAll('.dy-quick.is-confirm button')].find((el) => el.textContent.trim() === '취소')?.click();
        });
        await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]');
            [...dialog.querySelectorAll('button')].find((el) => el.textContent.trim() === '업무')?.click();
        });
        try {
            await page.waitForSelector('[role="dialog"] [aria-label="삭제"]', { timeout: 3000 });
        } catch {
            browserErrors.push('할 일 삭제 버튼 없음');
        }
        await page.click('[role="dialog"] [aria-label="삭제"]');
        try {
            await page.waitForSelector('#dy-confirm-title', { timeout: 2000 });
        } catch {
            browserErrors.push('할 일 확인 창 없음');
        }
        const taskTitle = await page.$eval('#dy-confirm-title', (el) => el.textContent.trim()).catch(() => '');
        if (taskTitle !== '이 할 일을 지울까요?') browserErrors.push(`할 일 확인 ${taskTitle}`);
        await page.evaluate(() => {
            [...document.querySelectorAll('.dy-quick.is-confirm button')].find((el) => el.textContent.trim() === '취소')?.click();
        });
        const expectDelete = async (tab, title, body) => {
            await page.evaluate((label) => {
                const dialog = document.querySelector('[role="dialog"]');
                [...dialog.querySelectorAll('button')].find((el) => el.textContent.trim() === label)?.click();
            }, tab);
            try {
                await page.waitForFunction((label) => [...document.querySelectorAll('[role="dialog"] button')].some((el) => el.textContent.trim() === label), { timeout: 3000 }, '삭제');
            } catch {
                browserErrors.push(`${tab} 삭제 버튼 없음`);
                return;
            }
            await page.evaluate(() => {
                [...document.querySelectorAll('[role="dialog"] button')].find((el) => el.textContent.trim() === '삭제')?.click();
            });
            try {
                await page.waitForSelector('#dy-confirm-title', { timeout: 2000 });
            } catch {
                browserErrors.push(`${tab} 확인 창 없음`);
                return;
            }
            const got = await page.$eval('#dy-confirm-title', (el) => el.textContent.trim()).catch(() => '');
            if (got !== title) browserErrors.push(`${tab} 확인 ${got}`);
            const shown = await page.$eval('.dy-quick.is-confirm .dy-muted', (el) => el.textContent.trim()).catch(() => '');
            if (body && !shown.includes(body)) browserErrors.push(`${tab} 확인 내용 ${shown}`);
            if (await page.evaluate(() => window.__nativeConfirm === true)) browserErrors.push(`${tab}이 confirm을 씀`);
            await page.evaluate(() => {
                [...document.querySelectorAll('.dy-quick.is-confirm button')].find((el) => el.textContent.trim() === '취소')?.click();
            });
        };
        await expectDelete('학생', '이 기록을 지울까요?', '확인용 학생기록');
        await expectDelete('상담', '이 기록을 지울까요?', '확인용 상담');
        await expectDelete('주간', '이 기록을 지울까요?', '확인용 계획');
        await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]');
            [...dialog.querySelectorAll('button')].find((el) => el.textContent.trim() === '학생')?.click();
        });
        await page.evaluate(() => {
            const dialog = document.querySelector('[role="dialog"]');
            [...dialog.querySelectorAll('button')].find((el) => el.textContent.trim() === '명단')?.click();
        });
        try {
            await page.waitForFunction(() => [...document.querySelectorAll('button')].some((el) => el.textContent.trim() === '명단 저장'), { timeout: 2000 });
        } catch {
            browserErrors.push('명단 저장 버튼 없음');
        }
        await page.evaluate(() => {
            [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === '명단 저장')?.click();
        });
        try {
            await page.waitForFunction(() => document.querySelector('#dy-confirm-title')?.textContent.trim() === '명단을 바꿀까요?', { timeout: 2000 });
        } catch {
            browserErrors.push('명단 확인 창 없음');
        }
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    }
    await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });
    await go(page, 405);
    await page.waitForSelector('.nb-dday-card');
    await page.evaluate(() => {
        const card = [...document.querySelectorAll('.nb-dday-card')].find((el) => el.innerText.includes('확인용 기한'));
        [...(card?.querySelectorAll('button') || [])].find((el) => el.textContent.trim() === '지우기')?.click();
    });
    try {
        await page.waitForSelector('#dy-confirm-title', { timeout: 2000 });
    } catch {
        browserErrors.push('기한 확인 창 없음');
    }
    const dueTitle = await page.$eval('#dy-confirm-title', (el) => el.textContent.trim()).catch(() => '');
    if (dueTitle !== '이 기한을 지울까요?') browserErrors.push(`기한 확인 ${dueTitle}`);
    const dueFit = await page.evaluate(() => {
        const card = [...document.querySelectorAll('.nb-dday-card')].find((el) => el.innerText.includes('확인용 기한'));
        const actions = [...(card?.querySelectorAll('.nb-dday-actions button') || [])].map((el) => {
            const rect = el.getBoundingClientRect();
            return { name: el.textContent.trim(), h: rect.height, w: rect.width };
        });
        const submit = document.querySelector('.nb-dday-form button[type="submit"]');
        const bg = submit ? getComputedStyle(submit).backgroundColor : '';
        const shownField = document.querySelector('.nb-ko-date input[type="text"]');
        const shown = shownField?.value || shownField?.placeholder || '';
        const dateInput = document.querySelector('.nb-ko-date-native');
        const opacity = dateInput ? getComputedStyle(dateInput).opacity : '';
        const english = /[A-Za-z]{2,}/.test(document.querySelector('.nb-dday')?.innerText || '');
        const pastCard = [...document.querySelectorAll('.nb-dday-card')].find((el) => el.innerText.includes('지난 기한'));
        const late = pastCard?.querySelector('.nb-dday-badge.is-late');
        const lateStyle = late ? getComputedStyle(late) : null;
        const lum = (rgb) => {
            const m = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (!m) return null;
            const ch = [Number(m[1]), Number(m[2]), Number(m[3])].map((c) => {
                const s = c / 255;
                return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
            });
            return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
        };
        const l1 = lateStyle ? lum(lateStyle.color) : null;
        const l2 = lateStyle ? lum(lateStyle.backgroundColor) : null;
        const contrast = l1 == null || l2 == null ? 0 : (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        const dateText = pastCard?.querySelector('.nb-hint')?.textContent || '';
        const submitRow = [...document.querySelectorAll('.nb-dday-submit button')].map((el) => el.getBoundingClientRect().top);
        const innerShadow = shownField ? getComputedStyle(shownField).boxShadow : '';
        return {
            actions, bg, shown, opacity, english, readOnly: Boolean(shownField?.readOnly),
            late: late?.textContent || '', contrast, dateText,
            rowSpread: submitRow.length ? Math.max(...submitRow) - Math.min(...submitRow) : 99,
            innerShadow,
        };
    });
    for (const btn of dueFit.actions) {
        if (btn.h < 44 || btn.w < 44) browserErrors.push(`1280 기한 버튼 ${btn.name} ${Math.round(btn.w)}x${Math.round(btn.h)}`);
    }
    if (!dueFit.actions.some((btn) => btn.name === '진행' || btn.name === '완료' || btn.name === '지우기')) {
        browserErrors.push('1280 기한 동작 버튼 없음');
    }
    if (dueFit.bg !== 'rgb(154, 83, 64)') browserErrors.push(`1280 올리기 색 ${dueFit.bg}`);
    if (!dueFit.shown || /[A-Za-z]/.test(dueFit.shown) || dueFit.shown.includes('mm')) browserErrors.push(`1280 기한 표시 ${dueFit.shown}`);
    if (dueFit.opacity !== '0') browserErrors.push(`1280 날짜 입력 보임 ${dueFit.opacity}`);
    if (dueFit.english) browserErrors.push('1280 기한 화면에 영문');
    if (!/일 지남$/.test(dueFit.late || '')) browserErrors.push(`1280 지난 배지 ${dueFit.late}`);
    if (!(dueFit.contrast >= 4.5)) browserErrors.push(`1280 지난 배지 대비 ${dueFit.contrast ? dueFit.contrast.toFixed(2) : '없음'}`);
    if (!/^\d{1,2}월 \d{1,2}일 \([일월화수목금토]\)$/.test(dueFit.dateText || '')) browserErrors.push(`1280 기한 날짜 ${dueFit.dateText}`);
    const emptyCols = await page.evaluate(() => ({
        doing: document.querySelector('.nb-kanban .is-doing .nb-dday-empty')?.textContent || '',
        done: document.querySelector('.nb-kanban .is-done .nb-dday-empty')?.textContent || '',
        todo: Boolean(document.querySelector('.nb-kanban .is-todo .nb-dday-empty')),
    }));
    if (!emptyCols.doing || !emptyCols.done) browserErrors.push(`1280 빈 칸 안내 ${emptyCols.doing}/${emptyCols.done}`);
    if (emptyCols.todo) browserErrors.push('1280 할 일 칸에 빈 안내');
    if (dueFit.readOnly) browserErrors.push('1280 기한 입력이 읽기 전용');
    if (dueFit.rowSpread > 8) browserErrors.push(`1280 올리기 줄 ${Math.round(dueFit.rowSpread)}`);
    if (dueFit.innerShadow && dueFit.innerShadow !== 'none') browserErrors.push('1280 날짜 칸 테두리가 겹침');
    const confirmPlace = await page.evaluate(() => {
        const box = document.querySelector('.dy-quick.is-confirm')?.getBoundingClientRect();
        if (!box || box.height < 8) return null;
        const mid = (box.top + box.bottom) / 2;
        return Math.abs(mid - window.innerHeight / 2);
    });
    if (confirmPlace == null || confirmPlace > 100) browserErrors.push(`확인 창이 가운데가 아님 ${confirmPlace == null ? '없음' : Math.round(confirmPlace)}`);
    await page.keyboard.press('Escape');
    await page.click('[aria-label="기한"]');
    await page.keyboard.type('2026-12-24', { delay: 20 });
    try {
        await page.waitForFunction(() => document.querySelector('.nb-ko-date-native')?.value === '2026-12-24', { timeout: 2000 });
    } catch {
        const typedDue = await page.$eval('.nb-ko-date-native', (el) => el.value).catch(() => '');
        browserErrors.push(`1280 기한 입력 ${typedDue || '없음'}`);
    }
    await go(page, 458);
    await page.waitForSelector('.nb-submit');
    await page.evaluate(() => {
        [...document.querySelectorAll('button')].find((el) => el.textContent.trim() === '이 칸 지우기')?.click();
    });
    try {
        await page.waitForSelector('#dy-confirm-title', { timeout: 2000 });
    } catch {
        browserErrors.push('제출 확인 창 없음');
    }
    const sheetTitle = await page.$eval('#dy-confirm-title', (el) => el.textContent.trim()).catch(() => '');
    if (sheetTitle !== '이 칸을 지울까요?') browserErrors.push(`제출 확인 ${sheetTitle}`);
    await page.keyboard.press('Escape');
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await go(page, 458);
    await page.waitForSelector('.nb-submit-grid');
    const sheetEdges = await page.evaluate(() => {
        const paper = document.querySelector('.dy-page')?.getBoundingClientRect();
        const grid = document.querySelector('.nb-submit-grid')?.getBoundingClientRect();
        if (!paper || !grid) return null;
        return {
            left: Math.round(paper.left),
            right: Math.round(window.innerWidth - paper.right),
            padL: Math.round(grid.left - paper.left),
            padR: Math.round(paper.right - grid.right),
            scroll: document.documentElement.scrollWidth,
            inner: window.innerWidth,
            english: /[A-Za-z]{2,}/.test(document.querySelector('.nb-submit')?.innerText || ''),
        };
    });
    if (!sheetEdges) browserErrors.push('390 제출 여백 없음');
    else {
        if (Math.abs(sheetEdges.left - sheetEdges.right) > 1 || sheetEdges.left < 12) {
            browserErrors.push(`390 제출 여백 ${sheetEdges.left}/${sheetEdges.right}`);
        }
        if (Math.abs(sheetEdges.padL - sheetEdges.padR) > 2) {
            browserErrors.push(`390 제출 안쪽 여백 ${sheetEdges.padL}/${sheetEdges.padR}`);
        }
        if (sheetEdges.scroll > sheetEdges.inner + 1) browserErrors.push(`390 제출 가로 스크롤 ${sheetEdges.scroll}`);
        if (sheetEdges.english) browserErrors.push('390 제출 화면에 영문');
    }
    await go(page, 405);
    await page.waitForSelector('.nb-dday-actions');
    const phoneDue = await page.evaluate(() => {
        const card = [...document.querySelectorAll('.nb-dday-card')].find((el) => el.innerText.includes('확인용 기한'));
        const actions = [...(card?.querySelectorAll('.nb-dday-actions button') || [])].map((el) => {
            const rect = el.getBoundingClientRect();
            return { name: el.textContent.trim(), h: rect.height };
        });
        const tops = [...document.querySelectorAll('.nb-dday-submit button')].map((el) => el.getBoundingClientRect().top);
        const date = document.querySelector('.nb-ko-date')?.getBoundingClientRect();
        const paper = document.querySelector('.dy-page')?.getBoundingClientRect();
        return {
            actions,
            rowSpread: tops.length ? Math.max(...tops) - Math.min(...tops) : 99,
            dateRight: date && paper ? Math.round(paper.right - date.right) : -1,
        };
    });
    for (const btn of phoneDue.actions) {
        if (btn.h < 44) browserErrors.push(`390 기한 버튼 ${btn.name} ${Math.round(btn.h)}`);
    }
    if (phoneDue.rowSpread > 8) browserErrors.push(`390 업무 할 일 줄바꿈 ${Math.round(phoneDue.rowSpread)}`);
    if (phoneDue.dateRight < 8) browserErrors.push(`390 날짜 칸 오른쪽 ${phoneDue.dateRight}`);
    for (const width of [360, 390]) {
        await page.setViewport({ width, height: width === 360 ? 780 : 844, deviceScaleFactor: 1 });
        await go(page, 405);
        await page.waitForSelector('.nb-dday-form button[type="submit"]');
        await page.evaluate(() => document.querySelector('.nb-dday-form button[type="submit"]')?.click());
        try {
            await page.waitForFunction(() => (document.querySelector('.dy-toast')?.innerText || '').includes('제목과 기한을 적어 주세요'), { timeout: 2500 });
        } catch {
            browserErrors.push(`${width} 기한 토스트 없음`);
        }
        await assertToastText(`${width} 기한 토스트`);
        await assertClear(`${width} 기한 토스트`);
        await assertStageReach(`${width} 기한`);
    }

    await page.evaluate(() => {
        const raw = localStorage.getItem('homenote_v2_ssugeokInbox');
        if (raw) {
            const items = JSON.parse(raw).filter((item) => {
                const text = String(item.text || '');
                return !text.startsWith('버튼줄') && !text.startsWith('토스트') && !text.startsWith('허브삭제') && !text.includes('확인용아주긴토큰') && !text.startsWith('@12 #행발') && !text.startsWith('내일 회의') && !text.startsWith('특별한 하루');
            });
            localStorage.setItem('homenote_v2_ssugeokInbox', JSON.stringify(items));
        }
        localStorage.removeItem('homenote_v2_teacherAttend');
        localStorage.removeItem('homenote_v2_teacherTodos');
        localStorage.removeItem('homenote_v2_studentNotes');
        localStorage.removeItem('homenote_v2_counselNotes');
        localStorage.removeItem('homenote_v2_teacherPlans');
        localStorage.removeItem('homenote_v2_classRoster');
        localStorage.removeItem('homenote_v2_ddayCards');
        localStorage.removeItem('homenote_v2_submissionSheets');
    });
    await go(page, 2);
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
        await quietMotion(page);
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
            const firstHandle = await page.evaluateHandle(() => {
                const shown = (el) => {
                    let node = el;
                    while (node && node !== document.body) {
                        const st = getComputedStyle(node);
                        if (st.display === 'none' || st.visibility === 'hidden') return false;
                        node = node.parentElement;
                    }
                    const rect = el.getBoundingClientRect();
                    return rect.width >= 8 && rect.height >= 8;
                };
                return [...document.querySelectorAll('.nb-body [data-to]')].find(shown) || null;
            });
            const first = firstHandle.asElement();
            if (first) {
                const dest = Number(await page.evaluate((el) => el.getAttribute('data-to'), first));
                if (dest && dest !== n && dest >= 1 && dest <= 580) {
                    await first.evaluate((el) => {
                        const rect = el.getBoundingClientRect();
                        const x = rect.left + Math.min(10, rect.width / 2);
                        const y = rect.top + Math.min(10, rect.height / 2);
                        const inView = x >= 1 && y >= 1 && x < window.innerWidth - 1 && y < window.innerHeight - 1;
                        if (!inView) el.scrollIntoView({ block: 'center', inline: 'nearest' });
                    });
                    const box = await first.boundingBox();
                    const offset = box && box.width > 24 && box.height > 24 ? { x: 10, y: 10 } : undefined;
                    await first.click(offset ? { offset } : undefined);
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
                const shown = (el) => {
                    let node = el;
                    while (node && node !== document.body) {
                        const st = getComputedStyle(node);
                        if (st.display === 'none' || st.visibility === 'hidden') return false;
                        node = node.parentElement;
                    }
                    return true;
                };
                const el = [...document.querySelectorAll('.nb-body [data-to]')].filter(shown)[index];
                el.scrollIntoView({ block: 'center', inline: 'nearest' });
                el.setAttribute('data-nb-probe', '1');
                return Number(el.getAttribute('data-to'));
            }, i);
            await page.click('[data-nb-probe="1"]');
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
        for (const [label, hash, num] of [['시간표', '#/timetable', 141], ['학생 카드', '#/cards/1', 159], ['예산', '#/budget', 468]]) {
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
        await checkNoteRevise(page, browserErrors);
        await checkQaLayout(page, browserErrors);

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
