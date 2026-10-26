import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { queuedCloudKeys, saveQuick, snapshot, undo, useVaultsForTest } from '../src/lib/db.js';
import { quickDate, quickDateLabel, textFromField } from '../src/ui/quickText.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

check(quickDate('today', '', new Date('2026-10-26T14:30:00Z')) === '2026-10-26', '자정 전 한국 날짜가 오늘이 아닙니다.');
check(quickDate('today', '', new Date('2026-10-26T15:30:00Z')) === '2026-10-27', '자정이 지난 한국 날짜가 다음 날이 아닙니다.');
check(quickDate('day', '2026-12-25', new Date('2026-10-26T15:30:00Z')) === '2026-12-25', '일지에서 연 날짜를 오늘로 바꿉니다.');
check(textFromField({ value: '안녕' }, { data: '하' }) === '안녕하', '조합 중인 글자를 빼먹습니다.');
check(textFromField({ value: '안녕하' }, { data: '하' }) === '안녕하', '이미 들어 있는 글자를 한 번 더 붙입니다.');
check(textFromField({ value: '   ' }, null).trim() === '', '빈 칸을 글로 봅니다.');

const appText = readFileSync(resolve(root, 'src/App.jsx'), 'utf8');
const opener = appText.slice(appText.indexOf('function openQuickBar'), appText.indexOf('const ui ='));
check(opener.includes('quickInput.current?.focus()') && !opener.includes('setTimeout') && !opener.includes('await'), '탭 안에서 바로 포커스하지 않습니다.');
const barText = readFileSync(resolve(root, 'src/ui/QuickBar.jsx'), 'utf8');
check(/onPointerDown=\{\(event\) => \{\s*event\.preventDefault\(\)/.test(barText), '칩을 누를 때 키보드가 먼저 내려갑니다.');
check(barText.includes('textFromField'), '조합 중인 글자를 확정하지 않습니다.');

function makeVault() {
    const bag = new Map();
    return {
        async get(key) { return bag.has(key) ? structuredClone(bag.get(key)) : undefined; },
        async set(key, value) { bag.set(key, structuredClone(value)); },
        async remove(key) { bag.delete(key); },
        dump() { return bag.has('state') ? structuredClone(bag.get('state')) : undefined; },
    };
}

const mainStore = makeVault();
const localStore = makeVault();
useVaultsForTest(mainStore, localStore);

const blank = await saveQuick({ text: '   ', kind: '메모', date: '2026-10-26' });
check(blank.ok === false && !snapshot().notes.length, '빈 글이 저장됩니다.');

const secret = await saveQuick({ text: '학폭 상담을 적습니다', kind: '관찰', date: '2026-10-26' });
const secretRow = snapshot().local.records.find((row) => String(row.text || '').includes('학폭'));
check(secret.ok && secret.message.includes('이 기기에만') && secretRow, '민감한 관찰이 이 기기에만 남지 않습니다.');
check(!snapshot().records.some((row) => String(row.text || '').includes('학폭')), '민감한 관찰이 클라우드 목록에 있습니다.');
check(!queuedCloudKeys().includes(`records/${secretRow?.id}`), '민감한 관찰을 클라우드에서 지우라고 올립니다.');
check(JSON.stringify(localStore.dump() || {}).includes('학폭') && !JSON.stringify(mainStore.dump() || {}).includes('학폭'), '민감한 관찰의 저장소가 바뀌었습니다.');
const undoneSecret = await undo();
check(undoneSecret && !snapshot().local.records.some((row) => String(row.text || '').includes('학폭')), '민감한 관찰 되돌리기가 기기에서 지우지 않습니다.');
check(!JSON.stringify(localStore.dump() || {}).includes('학폭'), '되돌린 민감한 관찰이 기기 저장소에 남습니다.');

const note = await saveQuick({ text: '운동회 안내', kind: '메모', date: '2026-10-26' });
const noteId = snapshot().notes.find((row) => row.text === '운동회 안내')?.id;
check(note.ok && noteId && JSON.stringify(mainStore.dump() || {}).includes('운동회 안내'), '메모가 기기 저장소에 없습니다.');
const undone = await undo();
check(undone && !snapshot().notes.some((row) => row.text === '운동회 안내'), '되돌리기가 화면 기록에서 지우지 않습니다.');
check(!JSON.stringify(mainStore.dump() || {}).includes('운동회 안내'), '되돌리기가 기기 저장소에서 지우지 않습니다.');
check(queuedCloudKeys().includes(`notes/${noteId}`), '되돌리기가 클라우드 쪽을 지우지 않습니다.');

const chrome = ['/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((path) => existsSync(path));
if (!chrome) failures.push('브라우저가 없습니다.');

if (!failures.length) {
    const port = 4179;
    const origin = `http://127.0.0.1:${port}/`;
    const preview = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
        cwd: root,
        stdio: 'ignore',
    });
    for (let i = 0; i < 40; i += 1) {
        try {
            const res = await fetch(origin);
            if (res.ok) break;
        } catch { /* 아직 */ }
        await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
    const browser = await puppeteer.launch({
        executablePath: chrome,
        headless: 'new',
        args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });
    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
        await page.evaluateOnNewDocument(() => {
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-theme', 'light');
        });
        await page.goto(`${origin}?demo=1&mode=light`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.tabbar .fab');
        const opened = await page.evaluate(() => {
            const button = document.querySelector('.tabbar .fab');
            button.click();
            const field = document.querySelector('.quick-field');
            return {
                focused: document.activeElement === field,
                open: document.querySelector('.quick-bar')?.classList.contains('is-open') || false,
                plus: Boolean(document.querySelector('[data-screen="plus"]')),
            };
        });
        check(opened.focused && opened.open && !opened.plus, `입력칸이 바로 포커스되지 않습니다: ${JSON.stringify(opened)}`);
        const todayLabel = quickDateLabel(quickDate('today', '', new Date()));
        const shownDate = await page.evaluate(() => document.querySelector('.quick-date')?.textContent || '');
        check(shownDate.includes(todayLabel), `기본 날짜가 오늘이 아닙니다: ${shownDate} / ${todayLabel}`);

        const empty = await page.evaluate(() => {
            const chip = document.querySelector('[data-kind="메모"]');
            const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
            chip.dispatchEvent(event);
            return {
                prevented: event.defaultPrevented,
                open: document.querySelector('.quick-bar')?.classList.contains('is-open') || false,
            };
        });
        await page.waitForFunction(() => (document.querySelector('.toast')?.innerText || '').includes('한 줄만'));
        const emptyToast = await page.evaluate(() => ({
            text: document.querySelector('.toast')?.innerText || '',
            open: document.querySelector('.quick-bar')?.classList.contains('is-open') || false,
            undo: Boolean(document.querySelector('.toast')?.innerText.includes('되돌리기')),
        }));
        check(empty.prevented, '칩 pointerdown이 기본 동작을 막지 않습니다.');
        check(emptyToast.text.includes('한 줄만') && emptyToast.open && !emptyToast.undo, `빈 글이 막히지 않습니다: ${JSON.stringify(emptyToast)}`);

        await page.evaluate(() => {
            const field = document.querySelector('.quick-field');
            field.value = '회의 메모';
            field.dispatchEvent(new InputEvent('input', { bubbles: true }));
            field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        });
        await page.waitForFunction(() => (document.querySelector('.toast')?.innerText || '').includes('메모로'));
        const memoToast = await page.evaluate(() => document.querySelector('.toast')?.innerText || '');
        check(memoToast.includes('메모로') && memoToast.includes('되돌리기'), `Enter 기본 분류가 메모가 아닙니다: ${memoToast}`);

        await page.evaluate(() => document.querySelector('.toast button')?.click());
        await page.waitForFunction(() => !document.querySelector('.toast'));

        await page.evaluate(() => document.querySelector('.tabbar .fab')?.click());
        const composed = await page.evaluate(() => {
            const field = document.querySelector('.quick-field');
            field.value = '안녕';
            field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
            field.dispatchEvent(new CompositionEvent('compositionupdate', { bubbles: true, data: '하' }));
            const chip = document.querySelector('[data-kind="할 일"]');
            const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
            chip.dispatchEvent(event);
            return event.defaultPrevented;
        });
        check(composed, '분류 칩이 조합 중 탭을 막지 않습니다.');
        await page.waitForFunction(() => (document.querySelector('.toast')?.innerText || '').includes('할 일'));
        await page.evaluate(() => { location.hash = '#/todo'; });
        await page.waitForFunction(() => document.body.innerText.includes('안녕하'));
        const once = await page.evaluate(() => document.body.innerText.split('안녕하').length - 1);
        check(once === 1, `칩 저장이 ${once}번 남았습니다.`);
        await page.evaluate(() => [...document.querySelectorAll('.toast button')].find((el) => el.innerText.includes('되돌리기'))?.click());
        await page.waitForFunction(() => !document.body.innerText.includes('안녕하'));

        await page.evaluate(() => { location.hash = '#/day/2026-12-25'; });
        await page.waitForSelector('[data-screen="day"]');
        await page.evaluate(() => document.querySelector('.tabbar .fab')?.click());
        const dayLabel = await page.evaluate(() => document.querySelector('.quick-date')?.innerText || '');
        check(dayLabel.includes('12월 25일'), `일지 날짜가 ${dayLabel} 입니다.`);

        const lockPage = await browser.newPage();
        await lockPage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
        await lockPage.evaluateOnNewDocument(() => {
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
        });
        await lockPage.goto(`${origin}?demo=1&mode=light`, { waitUntil: 'networkidle0' });
        await lockPage.waitForSelector('.tabbar .fab');
        await lockPage.evaluate(() => { location.hash = '#/settings'; });
        await lockPage.waitForFunction(() => document.body.innerText.includes('공용 컴퓨터 모드'));
        await lockPage.evaluate(() => {
            [...document.querySelectorAll('button')].find((el) => el.innerText.includes('공용 컴퓨터 모드'))?.click();
        });
        await lockPage.waitForFunction(() => document.body.innerText.includes('공용 컴퓨터 모드 켜짐'));
        await new Promise((resolveWait) => setTimeout(resolveWait, 400));
        const client = await lockPage.createCDPSession();
        await client.send('Emulation.setVirtualTimePolicy', {
            policy: 'advance',
            budget: 31 * 60 * 1000,
            maxVirtualTimeTaskStarvationCount: 200,
        });
        try {
            await lockPage.waitForFunction(() => document.body.innerText.includes('화면을 잠가 두었어요'), { timeout: 8000 });
        } catch (error) {
            failures.push(`잠금 화면이 열리지 않습니다: ${error?.message || error}`);
        }
        const lockedUi = await lockPage.evaluate(() => ({
            fab: Boolean(document.querySelector('.fab, .desk-fab, .quick-bar')),
            text: document.body.innerText.includes('화면을 잠가 두었어요'),
        }));
        check(lockedUi.text && !lockedUi.fab, `잠금 화면에서 입력 버튼이 있습니다: ${JSON.stringify(lockedUi)}`);
        await lockPage.close();
    } finally {
        await browser.close();
        preview.kill('SIGTERM');
    }
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('빠른 입력 검사를 통과했습니다.');
