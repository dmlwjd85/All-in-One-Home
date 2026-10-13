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

async function setRosterName(page, value) {
    const input = await page.$('#roster-1 input');
    if (!input) return;
    await page.evaluate((next) => {
        const field = document.querySelector('#roster-1 input');
        const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        proto.set.call(field, next);
        field.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
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
        const nav = document.querySelector('.nb-appnav');
        const navBox = visibleBox(nav);
        if (!nav || !navBox) hits.push('메뉴 없음');
        else {
            if (navBox.left < -1 || navBox.right > window.innerWidth + 1 || navBox.top < -1) hits.push('메뉴가 화면 밖');
            if (overlaps(numBox, navBox)) hits.push('메뉴·쪽번호 겹침');
            const brand = visibleBox(document.querySelector('.nb-toolbar-brand'));
            if (overlaps(brand, navBox)) hits.push('메뉴·제목 겹침');
            for (const btn of document.querySelectorAll('.nb-toolbar-actions button')) {
                if (overlaps(navBox, visibleBox(btn))) {
                    hits.push(`메뉴·도구 ${btn.getAttribute('aria-label') || ''}`);
                    break;
                }
            }
            const currents = [...nav.querySelectorAll('[aria-current="page"]')];
            if (currents.length !== 1) hits.push(`메뉴 현재위치 ${currents.length}`);
            const current = currents[0];
            const scroll = nav.querySelector('.nb-appnav-scroll');
            const currentBox = visibleBox(current);
            const scrollBox = visibleBox(scroll);
            if (current && current.scrollWidth > current.clientWidth + 1) hits.push(`메뉴 글자 잘림 ${current.textContent.trim()}`);
            if (currentBox && scrollBox && !inside(currentBox, scrollBox)) hits.push(`메뉴 현재위치 잘림 ${current.textContent.trim()}`);
            const brandName = document.querySelector('.nb-brand-name');
            if (brandName && brandName.scrollWidth > brandName.clientWidth + 1) hits.push('브랜드 글자 잘림');
            const allBtn = nav.querySelector('[data-nav="all"]');
            const allBox = visibleBox(allBtn);
            if (allBox && (allBox.left < -1 || allBox.right > window.innerWidth + 1)) hits.push('전체 메뉴가 화면 밖');
            if (allBtn && allBtn.scrollWidth > allBtn.clientWidth + 1) hits.push('전체 글자 잘림');
            const brandTop = document.querySelector('.nb-toolbar-brand')?.getBoundingClientRect();
            const ownRow = !brandTop || Math.abs(brandTop.top - navBox.top) > 12;
            if (ownRow && navBox.width < window.innerWidth - 4) hits.push(`메뉴 너비 ${Math.round(navBox.width)}`);
            if (navBox.height > 80) hits.push(`메뉴 높이 ${Math.round(navBox.height)}`);
            const shownChevron = (el) => el && getComputedStyle(el).visibility !== 'hidden' && !el.disabled;
            const prev = nav.querySelector('[data-nav-scroll="prev"]');
            const next = nav.querySelector('[data-nav-scroll="next"]');
            if (scroll) {
                const menuButtons = [...scroll.querySelectorAll('.nb-navbtn')];
                const lastBtn = menuButtons[menuButtons.length - 1];
                const max = lastBtn ? Math.max(0, lastBtn.offsetLeft + lastBtn.offsetWidth - scroll.clientWidth) : 0;
                const overflow = max > 2;
                if (overflow && scroll.scrollLeft > 2 && !shownChevron(prev)) hits.push('앞 메뉴 화살표 없음');
                if (overflow && scroll.scrollLeft < max - 2 && !shownChevron(next)) hits.push('뒤 메뉴 화살표 없음');
                if (!overflow && (shownChevron(prev) || shownChevron(next))) hits.push('넘치지 않는데 메뉴 화살표');
                if (current) {
                    const ideal = current.offsetLeft - (scroll.clientWidth - current.offsetWidth) / 2;
                    const expect = Math.max(0, Math.min(Math.max(0, max), ideal));
                    const delta = Math.abs(scroll.scrollLeft - expect);
                    const starts = [...scroll.querySelectorAll('.nb-navbtn')].map((btn) => btn.offsetLeft);
                    const flush = scroll.scrollLeft <= 2 || starts.some((left) => Math.abs(scroll.scrollLeft - left) <= 2);
                    const limit = flush ? 96 : 12;
                    if (delta > limit) hits.push(`현재 메뉴 가운데 아님 ${current.textContent.trim()}`);
                }
                const host = scroll.getBoundingClientRect();
                const slots = [...scroll.querySelectorAll('.nb-navbtn, .nb-nav-gap')];
                for (const el of slots) {
                    const hidden = getComputedStyle(el).visibility === 'hidden';
                    if (!hidden) continue;
                    const box = el.getBoundingClientRect();
                    const iw = Math.min(box.right, host.right) - Math.max(box.left, host.left);
                    if (iw > 2) hits.push(`메뉴 빈칸 ${(el.textContent || '').trim() || '구분'}`);
                }
                let lead = null;
                for (const el of slots) {
                    if (getComputedStyle(el).visibility === 'hidden') continue;
                    const box = el.getBoundingClientRect();
                    if (box.right <= host.left + 1) continue;
                    lead = box;
                    break;
                }
                if (lead && lead.left > host.left + 4) hits.push(`메뉴 앞 빈칸 ${Math.round(lead.left - host.left)}`);
                for (const btn of scroll.querySelectorAll('.nb-navbtn')) {
                    const style = getComputedStyle(btn);
                    if (style.visibility === 'hidden' || style.display === 'none') continue;
                    const box = btn.getBoundingClientRect();
                    const iw = Math.min(box.right, scrollBox.right) - Math.max(box.left, scrollBox.left);
                    const full = scrollBox && iw >= box.width - 3;
                    const none = !scrollBox || iw <= 2;
                    if (!full && !none) hits.push(`메뉴 글자 중간 잘림 ${btn.textContent.trim()}`);
                    if (btn.scrollWidth > btn.clientWidth + 1) hits.push(`메뉴 글자 잘림 ${btn.textContent.trim()}`);
                }
            }
            const pinsHidden = getComputedStyle(nav.querySelector('.nb-nav-pins') || nav).display === 'none';
            if (!pinsHidden) {
                for (const key of ['timetable', 'cards', 'budget']) {
                    const pin = nav.querySelector(`[data-nav-pin="${key}"]`);
                    const pinBox = visibleBox(pin);
                    if (!pinBox) hits.push(`바로가기 없음 ${key}`);
                    else if (pinBox.left < -1 || pinBox.right > window.innerWidth + 1) hits.push(`바로가기 화면 밖 ${key}`);
                    else if (overlaps(allBox, pinBox)) hits.push(`바로가기·전체 겹침 ${key}`);
                    if (pin && pin.scrollWidth > pin.clientWidth + 1) hits.push(`바로가기 글자 잘림 ${key}`);
                }
            }
            const lum = (rgb) => {
                const m = String(rgb).match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
                if (!m) return null;
                const ch = [Number(m[1]), Number(m[2]), Number(m[3])].map((c) => {
                    const s = c / 255;
                    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
                });
                return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
            };
            const contrast = (el) => {
                if (!el) return null;
                const cs = getComputedStyle(el);
                const a = lum(cs.color);
                const b = lum(cs.backgroundColor);
                if (a == null || b == null) return null;
                const hi = Math.max(a, b);
                const lo = Math.min(a, b);
                return (hi + 0.05) / (lo + 0.05);
            };
            const selected = nav.querySelector('.nb-navbtn.is-on');
            const selectedRatio = contrast(selected);
            if (selected && !(selectedRatio >= 4.5)) hits.push(`메뉴 선택 대비 ${selectedRatio?.toFixed?.(2) || selectedRatio}`);
        }
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
                if (/번 이름$/.test(el.getAttribute('aria-label') || '')) samples.push('학생이름김');
            }
            const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0);
            let avail = el.clientWidth - pad;
            const appearance = cs.appearance || cs.webkitAppearance || '';
            if (el.tagName === 'SELECT' && appearance !== 'none') avail -= 16;
            for (const text of new Set(samples)) {
                if (text && textWidth(el, text) > avail + 1) hits.push(`입력 글자 잘림 ${text.slice(0, 18)}`);
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
        const writeTab = document.querySelector('.nb-left .nb-tab[data-to="496"]');
        if (writeTab && visibleBox(writeTab) && writeTab.textContent.trim() !== '쓱적') {
            hits.push(`쓱적 탭 ${writeTab.textContent.trim()}`);
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
            if (n === 154) await setRosterName(page, '학생이름김');
            const phoneHits = await geometryHits(page);
            if (n === 154) await setRosterName(page, '');
            if (phoneHits.length) browserErrors.push(`390 p${n} ${phoneHits.slice(0, 4).join(', ')}`);
            const first = await page.$('.nb-body [data-to]');
            if (first) {
                const dest = Number(await page.evaluate((el) => el.getAttribute('data-to'), first));
                if (dest && dest !== n && dest >= 1 && dest <= 580) {
                    await first.click({ offset: { x: 10, y: 10 } });
                    await page.waitForFunction((num) => document.querySelector(`[data-page="${num}"]`), { timeout: 8000 }, dest);
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
                const paper = document.querySelector('.nb-page')?.getBoundingClientRect();
                if (!paper || paper.width < 100) return false;
                if (isPhone) return paper.width <= viewW + 2;
                if (viewW <= 1100) return paper.width <= viewW - 40;
                return paper.width < viewW - 20 && paper.height > 640;
            }, {}, width);
            for (let n = 1; n <= 580; n += 1) {
                await go(page, n);
                if (n === 154) await setRosterName(page, '학생이름김');
                const hits = await geometryHits(page);
                if (n === 154) await setRosterName(page, '');
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
        const phoneBar = await page.$eval('.nb-appnav', (el) => el.getBoundingClientRect().height);
        if (!(phoneBar <= 80 && phoneBar >= 48)) browserErrors.push(`휴대폰 메뉴 높이 ${phoneBar}`);
        const phoneHits = await page.$$eval('.nb-appnav .nb-navbtn, .nb-appnav .nb-nav-chev', (els) => els.filter((el) => {
            const style = getComputedStyle(el);
            const box = el.getBoundingClientRect();
            return !el.disabled && style.visibility !== 'hidden' && style.display !== 'none' && box.width >= 1 && box.height >= 1;
        }).map((el) => {
            const box = el.getBoundingClientRect();
            return {
                w: box.width,
                h: box.height,
                name: (el.textContent || el.getAttribute('aria-label') || '').trim(),
            };
        }));
        for (const hit of phoneHits) {
            if (!(hit.w >= 44 && hit.h >= 44)) browserErrors.push(`휴대폰 메뉴 터치 ${hit.name} ${Math.round(hit.w)}x${Math.round(hit.h)}`);
        }
        const phoneTabs = await page.$$eval('.nb-tabbar, .nb-left, .nb-right', (els) => els.filter((el) => getComputedStyle(el).display !== 'none').length);
        if (phoneTabs) browserErrors.push('휴대폰 구역 탭이 메뉴 줄과 따로 있음');
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
        const yearOn = await page.$eval('.nb-appnav [aria-current="page"]', (el) => el.getAttribute('data-nav'));
        if (yearOn !== 'year') browserErrors.push(`연간 현재위치 ${yearOn}`);
        await page.click('.nb-appnav [data-nav="month"]');
        await page.waitForFunction(() => location.hash === '#/month/2026/3' && document.querySelector('[data-page="34"]'));
        await page.click('.nb-appnav [data-nav="week"]');
        await page.waitForFunction(() => location.hash === '#/weeks' && document.querySelector('[data-page="46"]'));
        await page.click('.nb-appnav [data-nav="schedule"]');
        await page.waitForFunction(() => location.hash === '#/schedule' && document.querySelector('[data-page="33"]'));
        await page.click('.nb-appnav [data-nav="day"]');
        await page.waitForFunction(() => location.hash === '#/days' && document.querySelector('[data-page="99"]'));
        await page.goBack();
        await page.waitForFunction(() => location.hash === '#/schedule' && document.querySelector('[data-page="33"]'));
        await page.evaluate(() => { location.hash = '#/month/2026/4'; });
        await page.waitForSelector('[data-page="35"]');
        const monthOn = await page.$eval('.nb-appnav [aria-current="page"]', (el) => el.getAttribute('data-nav'));
        if (monthOn !== 'month') browserErrors.push(`4월 현재위치 ${monthOn}`);
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
        await page.click('.nb-appnav [data-nav="month"]');
        await page.waitForFunction(() => /^#\/month\/2026\//.test(location.hash));
        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.waitForFunction(() => document.querySelector('.nb-app')?.classList.contains('is-phone'));
        await page.evaluate(() => { location.hash = '#/home'; });
        await page.waitForSelector('[data-page="2"]');
        const phoneNav = await page.$eval('.nb-appnav', (el) => getComputedStyle(el).display);
        if (phoneNav === 'none') browserErrors.push('휴대폰에서 메뉴가 숨음');
        await page.click('.nb-appnav [data-nav="all"]');
        await page.waitForSelector('[role="dialog"]');
        const chip = await page.evaluateHandle(() => [...document.querySelectorAll('.nb-nav-chip')].find((el) => el.textContent.trim() === '예산'));
        const chipEl = chip.asElement();
        if (!chipEl) browserErrors.push('전체 메뉴에 예산이 없음');
        else {
            await chipEl.click();
            await page.waitForFunction(() => location.hash === '#/budget' && document.querySelector('[data-page="468"]'));
        }

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
                const menuH = await page.$eval('.nb-appnav-scroll .nb-navbtn', (el) => el.getBoundingClientRect().height);
                if (!(menuH >= 44)) browserErrors.push(`1024 메뉴 높이 ${menuH}`);
            }
            if (width <= 390) {
                const shown = await page.$eval('.nb-appnav-scroll', (scroll) => {
                    const host = scroll.getBoundingClientRect();
                    return [...scroll.querySelectorAll('.nb-navbtn')].filter((btn) => {
                        const style = getComputedStyle(btn);
                        if (style.visibility === 'hidden' || style.display === 'none') return false;
                        const box = btn.getBoundingClientRect();
                        return box.left >= host.left - 1 && box.right <= host.right + 1;
                    }).length;
                });
                if (shown < 3) browserErrors.push(`${label} 보이는 메뉴 ${shown}개`);
            }
            const start = await page.$eval('.nb-appnav-scroll', (el) => el.scrollLeft);
            const next = await page.$('[data-nav-scroll="next"]:not([disabled])');
            if (!next) browserErrors.push(`${label} 뒤 메뉴 화살표가 없음`);
            else {
                const expectMove = await page.$eval('.nb-appnav-scroll', (el) => {
                    const chunk = Math.round(el.clientWidth * 0.7);
                    const buttons = [...el.querySelectorAll('.nb-navbtn')];
                    const last = buttons[buttons.length - 1];
                    const end = last ? Math.max(0, last.offsetLeft + last.offsetWidth - el.clientWidth) : 0;
                    const room = Math.max(0, end - el.scrollLeft);
                    return Math.min(chunk, room);
                });
                await next.click();
                await new Promise((resolve) => setTimeout(resolve, 350));
                const settled = await page.$eval('.nb-appnav-scroll', (el) => {
                    const buttons = [...el.querySelectorAll('.nb-navbtn')];
                    const last = buttons[buttons.length - 1];
                    const max = last ? Math.max(0, last.offsetLeft + last.offsetWidth - el.clientWidth) : 0;
                    return { left: el.scrollLeft, max };
                });
                const atEnd = settled.left >= settled.max - 4;
                const held = settled.left >= start + Math.min(expectMove, Math.max(0, settled.max - start)) - 8;
                if (!(atEnd || held)) browserErrors.push(`${label} 화살표 스크롤이 되돌아감 ${start}→${settled.left}`);
                const wheelTarget = await page.$eval('.nb-appnav-scroll', (el, from) => {
                    const buttons = [...el.querySelectorAll('.nb-navbtn')];
                    const last = buttons[buttons.length - 1];
                    const max = last ? Math.max(0, last.offsetLeft + last.offsetWidth - el.clientWidth) : 0;
                    const forward = from + 90;
                    const target = forward <= max - 2 ? forward : Math.max(0, from - 90);
                    el.scrollLeft = target;
                    return target;
                }, settled.left);
                await new Promise((resolve) => setTimeout(resolve, 300));
                const afterWheel = await page.$eval('.nb-appnav-scroll', (el) => el.scrollLeft);
                if (Math.abs(wheelTarget - settled.left) < 40 || Math.abs(afterWheel - wheelTarget) > 8) {
                    browserErrors.push(`${label} 휠 스크롤이 되돌아감 ${settled.left}→${afterWheel} (목표 ${wheelTarget})`);
                }
            }
        }

        await page.setViewport({ width: 360, height: 844, deviceScaleFactor: 1 });
        await page.waitForFunction(() => document.querySelector('.nb-app')?.classList.contains('is-phone'));
        await page.evaluate(() => { location.hash = '#/home'; });
        await page.waitForFunction(() => location.hash === '#/home' && document.querySelector('[data-page="2"]'));
        const visibleNames = () => page.evaluate(() => {
            const scroll = document.querySelector('.nb-appnav-scroll');
            const host = scroll.getBoundingClientRect();
            return [...scroll.querySelectorAll('.nb-navbtn')].filter((btn) => {
                const box = btn.getBoundingClientRect();
                return Math.min(box.right, host.right) - Math.max(box.left, host.left) > 0.5;
            }).map((btn) => btn.textContent.trim());
        });
        const seenLabels = new Set(await visibleNames());
        const startLeft = await page.$eval('.nb-appnav-scroll', (el) => el.scrollLeft);
        for (let step = 0; step < 40; step += 1) {
            const next = await page.$('[data-nav-scroll="next"]:not([disabled])');
            if (!next) break;
            const before = await page.$eval('.nb-appnav-scroll', (el) => el.scrollLeft);
            await next.click();
            await new Promise((resolve) => setTimeout(resolve, 120));
            const after = await page.$eval('.nb-appnav-scroll', (el) => el.scrollLeft);
            if (after < before + 4) break;
            const names = await visibleNames();
            for (const name of names) seenLabels.add(name);
        }
        const skipped = await page.evaluate((left, seen) => {
            const scroll = document.querySelector('.nb-appnav-scroll');
            const have = new Set(seen);
            return [...scroll.querySelectorAll('.nb-navbtn')].map((btn) => btn.textContent.trim()).filter((name, index, all) => {
                const btn = scroll.querySelectorAll('.nb-navbtn')[index];
                if (btn.offsetLeft + btn.offsetWidth <= left + 1) return false;
                return !have.has(name);
            });
        }, startLeft, [...seenLabels]);
        if (!seenLabels.has('업무') || skipped.length) browserErrors.push(`360 화살표가 메뉴를 건너뜀 ${skipped.join(',') || '업무'}`);

        await page.setViewport({ width: 1366, height: 768, deviceScaleFactor: 1 });
        await page.evaluate(() => { location.hash = '#/home'; });
        await page.waitForFunction(() => location.hash === '#/home' && document.querySelector('[data-page="2"]'));
        await page.click('.nb-appnav [data-nav="students"]');
        await page.waitForFunction(() => location.hash === '#/students' && document.querySelector('[data-page="154"]'));
        await page.click('.nb-appnav [data-nav="all"]');
        await page.waitForSelector('[role="dialog"]');
        await page.goBack();
        await page.waitForFunction(() => location.hash === '#/home' && document.querySelector('[data-page="2"]') && !document.querySelector('[role="dialog"]'));

        await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
        await page.waitForFunction(() => document.querySelector('.nb-app')?.classList.contains('is-phone'));
        for (const [label, hash, num] of [['시간표', '#/timetable', 141], ['학생카드', '#/cards/1', 159], ['예산', '#/budget', 468]]) {
            await page.click('.nb-appnav [data-nav="all"]');
            await page.waitForSelector('[role="dialog"]');
            const chip = await page.evaluateHandle((name) => [...document.querySelectorAll('.nb-nav-chip')].find((el) => el.textContent.trim() === name), label);
            const chipEl = chip.asElement();
            if (!chipEl) browserErrors.push(`전체 메뉴에 ${label}이 없음`);
            else {
                await chipEl.click();
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
                const left = document.querySelector('.nb-left')?.getBoundingClientRect();
                const title = document.querySelector('[data-page="154"] .nb-pagetitle')?.getBoundingClientRect();
                return {
                    tabW: left ? Math.round(left.width) : 0,
                    tabH: left ? Math.round(left.height) : 0,
                    titleTop: title ? Math.round(title.top) : 0,
                    title: document.querySelector('[data-page="154"] .nb-pagetitle')?.textContent.trim() || '',
                };
            });
            if (!(band.tabW >= 52 && band.tabW <= 60 && band.tabH > band.tabW * 4)) {
                browserErrors.push(`${width} 탭 열 ${band.tabW}x${band.tabH}`);
            }
            if (!band.title.includes('명렬') || !(band.titleTop >= 140 && band.titleTop <= 210)) {
                browserErrors.push(`${width} 명렬표 위치 ${band.titleTop} ${band.title}`);
            }
        }

        await page.emulateMediaType('print');
        const toolbar = await page.$eval('.nb-toolbar', (el) => getComputedStyle(el).display);
        const navPrint = await page.$eval('.nb-appnav', (el) => getComputedStyle(el).display);
        await page.emulateMediaType('screen');
        if (toolbar !== 'none') browserErrors.push('인쇄에서 도구막대가 보임');
        if (navPrint !== 'none') browserErrors.push('인쇄에서 메뉴가 보임');

        const badFile = resolve(root, 'scripts/check-browser.mjs');
        await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
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
