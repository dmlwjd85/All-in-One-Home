import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { queuedCloudKeys, replaceRoster, saveQuick, snapshot, undo, useVaultsForTest } from '../src/lib/db.js';
import { resolveHash } from '../src/lib/routes.js';
import { quickDate, quickDateLabel, textFromField } from '../src/ui/quickText.js';
import { nameCandidates, quickSaveDate, studentNoFor, suggestKind } from '../src/ui/quickMatch.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

check(quickDate('today', '', new Date('2026-10-26T14:30:00Z')) === '2026-10-26', '자정 전 한국 날짜가 오늘이 아닙니다.');
check(quickDate('today', '', new Date('2026-10-26T15:30:00Z')) === '2026-10-27', '자정이 지난 한국 날짜가 다음 날이 아닙니다.');
check(quickDate('day', '2026-12-25', new Date('2026-10-26T15:30:00Z')) === '2026-12-25', '일지에서 연 날짜를 오늘로 바꿉니다.');
check(textFromField({ value: '안녕' }, { data: '하' }) === '안녕하', '조합 중인 글자를 빼먹습니다.');
check(textFromField({ value: '안녕하' }, { data: '하' }) === '안녕하', '이미 들어 있는 글자를 한 번 더 붙입니다.');
check(textFromField({ value: '   ' }, null).trim() === '', '빈 칸을 글로 봅니다.');

const sampleStudents = [
    { no: 1, id: 's1', name: '민준' },
    { no: 2, id: 's2', name: '민서' },
    { no: 3, id: 's3', name: '서연' },
];
const previewNames = nameCandidates('민', sampleStudents).map((row) => row.name);
check(previewNames.includes('민준') && previewNames.includes('민서') && !previewNames.includes('서연'), '자동완성 후보가 없습니다.');
check(nameCandidates('ㅁㅈ', sampleStudents).some((row) => row.name === '민준'), '초성 검색이 없습니다.');
const composingName = textFromField({ value: '' }, { data: '민' });
check(nameCandidates(composingName, sampleStudents).some((row) => row.name === '민준'), '조합 중 후보가 없습니다.');
check(suggestKind('내일 운동회', sampleStudents) === '일정', '일정 추천이 없습니다.');
check(suggestKind('금요일 3교시', sampleStudents) === '일정', '요일·교시가 일정이 아닙니다.');
check(suggestKind('10/30 조회', sampleStudents) === '일정', '숫자 날짜가 일정이 아닙니다.');
check(suggestKind('3시 회의', sampleStudents) === '일정', '시각이 일정이 아닙니다.');
check(suggestKind('민준이 조용해요', sampleStudents) === '관찰', '관찰 추천이 없습니다.');
check(suggestKind('가정통신문 제출', sampleStudents) === '할 일', '할 일 추천이 없습니다.');
check(suggestKind('알림장 보내기', sampleStudents) === '할 일', '보내기가 할 일이 아닙니다.');
check(suggestKind('청소하기', sampleStudents) === '할 일', '하기가 할 일이 아닙니다.');
check(suggestKind('그냥 적어요', sampleStudents) === '', '추천이 없을 때도 분류를 고릅니다.');
check(studentNoFor('민준이 발표를 잘했어요', sampleStudents, null) === 1, '학생 연결이 없습니다.');
check(studentNoFor('민준과 민서', sampleStudents, null) === 0, '이름이 둘인데 한 학생으로 붙입니다.');
check(studentNoFor('민준과 민서', sampleStudents, sampleStudents[1]) === 2, '고른 학생으로 연결하지 않습니다.');
const tomorrow = new Date('2026-10-26T01:00:00+09:00');
check(quickSaveDate('일정', '내일 운동회', '2026-10-26', tomorrow) === '2026-10-27', '내일 일정을 오늘로 저장합니다.');
check(quickSaveDate('일정', '3교시 조회', '2026-12-25', tomorrow) === '2026-12-25', '교시만 있는데 날짜를 바꿉니다.');
check(quickSaveDate('메모', '내일 운동회', '2026-12-25', tomorrow) === '2026-12-25', '메모인데 일정 날짜를 씁니다.');
check(resolveHash('#/quick', '2026-10-26').openQuickBar === true, '빠른 입력 주소가 입력칸을 열지 않습니다.');
const manifest = JSON.parse(readFileSync(resolve(root, 'public/manifest.webmanifest'), 'utf8'));
const quickShortcut = (manifest.shortcuts || []).find((item) => item?.name === '빠른 입력' && String(item.url || '').includes('?quick=1'));
check(Boolean(quickShortcut), '매니페스트 바로가기가 없습니다.');
const matchText = readFileSync(resolve(root, 'src/ui/quickMatch.js'), 'utf8');
check(!matchText.includes('fetch(') && !matchText.includes('XMLHttpRequest'), '이름 후보가 서버로 나갑니다.');
check(matchText.includes('키보드의 마이크 버튼으로 받아쓰기를 할 수 있어요.'), '음성 인식을 지원하지 않을 때 안내가 없습니다.');
check(readFileSync(resolve(root, 'src/ui/Settings.jsx'), 'utf8').includes('URL 열기'), '단축어 안내가 없습니다.');

const appText = readFileSync(resolve(root, 'src/App.jsx'), 'utf8');
const opener = appText.slice(appText.indexOf('function openQuickBar'), appText.indexOf('const ui ='));
check(opener.includes('quickInput.current?.focus()') && !opener.includes('setTimeout') && !opener.includes('await'), '탭 안에서 바로 포커스하지 않습니다.');
const urlOpen = appText.slice(appText.indexOf('pendingQuick.current = false'), appText.indexOf('function openQuickBar'));
check(urlOpen.includes('blur()') && !urlOpen.includes('.focus('), '주소로 열 때 키보드를 올립니다.');
const barText = readFileSync(resolve(root, 'src/ui/QuickBar.jsx'), 'utf8');
check(/onPointerDown=\{\(event\) => \{\s*event\.preventDefault\(\)/.test(barText), '칩을 누를 때 키보드가 먼저 내려갑니다.');
check(barText.includes('textFromField'), '조합 중인 글자를 확정하지 않습니다.');
check(barText.includes('showToast(SPEECH_FALLBACK)'), '음성 안내를 보여 주지 않습니다.');
check(barText.includes('body.no = no'), '관찰에 학생 번호를 넘기지 않습니다.');
check(barText.includes('SUGGEST_WAIT') && !barText.includes('useEffect(() => {\n        save('), '분류 추천이 저장을 부릅니다.');

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

await replaceRoster('1 민준\n2 민서');
const linked = await saveQuick({ text: '민준이 발표를 잘했어요', kind: '관찰', no: 1, date: '2026-10-26' });
const linkedRow = snapshot().records.find((row) => String(row.text || '').includes('민준이 발표'));
check(linked.ok && linkedRow?.sid === 's1', '학생 연결이 저장되지 않습니다.');
const linkedSecret = await saveQuick({ text: '민준 학폭을 적습니다', kind: '관찰', no: 1, date: '2026-10-26' });
const linkedLocal = snapshot().local.records.find((row) => String(row.text || '').includes('민준 학폭'));
check(linkedSecret.ok && linkedSecret.message.includes('이 기기에만') && linkedLocal?.sid === 's1', '학생과 연결된 민감한 관찰이 이 기기에만 남지 않습니다.');
check(!snapshot().records.some((row) => String(row.text || '').includes('민준 학폭')), '학생과 연결된 민감한 관찰이 클라우드 목록에 있습니다.');

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

        await page.goto(`${origin}?demo=1&mode=light`, { waitUntil: 'networkidle0' });
        await page.waitForSelector('.tabbar .fab');
        await page.evaluate(() => document.querySelector('.tabbar .fab')?.click());
        await page.waitForFunction(() => document.activeElement?.classList?.contains('quick-field'));
        await page.evaluate(() => {
            const field = document.querySelector('.quick-field');
            field.value = '한';
            field.dispatchEvent(new InputEvent('input', { bubbles: true }));
        });
        const nameState = await page.waitForFunction(() => {
            const names = [...document.querySelectorAll('.quick-name')].map((el) => el.innerText.trim());
            const open = document.querySelector('.quick-bar')?.classList.contains('is-open') || false;
            const undo = (document.querySelector('.toast')?.innerText || '').includes('되돌리기');
            if (names.includes('한지우') && names.includes('한서아') && open && !undo) return 'ready';
            if (!open || undo) return 'saved';
            return false;
        });
        const namesReady = (await nameState.jsonValue()) === 'ready';
        check(namesReady, '글을 치자마자 저장하거나 이름 후보가 없습니다.');
        if (namesReady) {
        const nameLayout = await page.evaluate(() => {
            const name = document.querySelector('.quick-name')?.getBoundingClientRect();
            const chip = document.querySelector('.quick-chip')?.getBoundingClientRect();
            return { nameBottom: name?.bottom || 0, chipTop: chip?.top || 0 };
        });
        check(nameLayout.nameBottom <= nameLayout.chipTop + 1, `후보가 칩과 겹칩니다: ${JSON.stringify(nameLayout)}`);
        const picked = await page.evaluate(() => {
            const button = [...document.querySelectorAll('.quick-name')].find((el) => el.innerText.trim() === '한지우');
            const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true });
            button.dispatchEvent(event);
            return event.defaultPrevented && (document.querySelector('.quick-field')?.value || '').includes('한지우');
        });
        check(picked, '이름 후보를 골라도 이름이 들어가지 않습니다.');
        await page.evaluate(() => {
            const field = document.querySelector('.quick-field');
            field.value = '한지우가 발표를 잘했어요';
            field.dispatchEvent(new InputEvent('input', { bubbles: true }));
        });
        const observeState = await page.waitForFunction(() => {
            const suggested = document.querySelector('[data-kind="관찰"]')?.dataset.suggested === '1';
            const open = document.querySelector('.quick-bar')?.classList.contains('is-open') || false;
            const undo = (document.querySelector('.toast')?.innerText || '').includes('되돌리기');
            if (suggested && open && !undo) return 'ready';
            if (!open || undo) return 'saved';
            return false;
        });
        const observeReady = (await observeState.jsonValue()) === 'ready';
        check(observeReady, '이름을 넣자마자 관찰을 저장합니다.');
        if (observeReady) {
        await page.evaluate(() => {
            document.querySelector('[data-kind="관찰"]').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
        });
        await page.waitForFunction(() => (document.querySelector('.toast')?.innerText || '').includes('한지우'));
        await page.evaluate(() => { location.hash = '#/students/21'; });
        await page.waitForFunction(() => document.body.innerText.includes('한지우가 발표를 잘했어요'));
        await page.evaluate(() => [...document.querySelectorAll('button')].find((el) => el.innerText.includes('되돌리기'))?.click());
        await page.waitForFunction(() => !document.body.innerText.includes('한지우가 발표를 잘했어요'));
        }
        await page.evaluate(() => { location.hash = '#/today'; });
        await page.waitForSelector('.tabbar .fab');
        await page.evaluate(() => document.querySelector('.tabbar .fab')?.click());
        await page.waitForFunction(() => document.querySelector('.quick-bar')?.classList.contains('is-open'));
        }

        await page.evaluate(() => {
            const field = document.querySelector('.quick-field');
            field.value = '내일 운동회';
            field.dispatchEvent(new InputEvent('input', { bubbles: true }));
        });
        const scheduleState = await page.waitForFunction(() => {
            const suggested = document.querySelector('[data-kind="일정"]')?.dataset.suggested === '1';
            const open = document.querySelector('.quick-bar')?.classList.contains('is-open') || false;
            const undo = (document.querySelector('.toast')?.innerText || '').includes('되돌리기');
            if (suggested && open && !undo) return 'ready';
            if (!open || undo) return 'saved';
            return false;
        });
        const scheduleReady = (await scheduleState.jsonValue()) === 'ready';
        check(scheduleReady, '분류 추천이 바로 저장합니다.');
        if (scheduleReady) {
        const expectedDay = quickDateLabel(quickSaveDate('일정', '내일 운동회', '2026-10-26', new Date()));
        await page.evaluate(() => {
            document.querySelector('.quick-field').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        });
        await page.waitForFunction(() => (document.querySelector('.toast')?.innerText || '').includes('일정'));
        const scheduleToast = await page.evaluate(() => document.querySelector('.toast')?.innerText || '');
        check(scheduleToast.includes(expectedDay) && scheduleToast.includes('되돌리기'), `일정 토스트가 날짜와 되돌리기를 빠뜨립니다: ${scheduleToast}`);
        }

        await page.evaluate(() => document.querySelector('.tabbar .fab')?.click());
        await page.waitForFunction(() => document.querySelector('.quick-bar')?.classList.contains('is-open'));
        await page.evaluate(() => {
            window.SpeechRecognition = undefined;
            window.webkitSpeechRecognition = undefined;
            document.querySelector('[aria-label="말로 입력"]')?.click();
        });
        await page.waitForFunction(() => (document.querySelector('.toast')?.innerText || '').includes('키보드의 마이크'));

        const invitePage = await browser.newPage();
        await invitePage.setViewport({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
        await invitePage.evaluateOnNewDocument(() => {
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-theme', 'light');
        });
        await invitePage.goto(`${origin}?demo=1&mode=light#/quick`, { waitUntil: 'networkidle0' });
        await invitePage.waitForSelector('.quick-bar.is-open.is-invite');
        const invited = await invitePage.evaluate(() => ({
            focused: document.activeElement?.classList?.contains('quick-field') || false,
            placeholder: document.querySelector('.quick-field')?.placeholder || '',
            hash: location.hash,
        }));
        check(!invited.focused && invited.placeholder.includes('한 번 누르면'), `주소로 열 때 칸이 크지 않거나 키보드를 억지로 올립니다: ${JSON.stringify(invited)}`);
        await invitePage.goto(`${origin}?demo=1&mode=light&quick=1`, { waitUntil: 'networkidle0' });
        await invitePage.waitForSelector('.quick-bar.is-open.is-invite');
        const fromQuery = await invitePage.evaluate(() => ({
            focused: document.activeElement?.classList?.contains('quick-field') || false,
            quick: new URLSearchParams(location.search).get('quick'),
        }));
        check(!fromQuery.focused && fromQuery.quick !== '1', `바로가기 주소가 입력칸을 열지 않거나 키보드를 올립니다: ${JSON.stringify(fromQuery)}`);
        await invitePage.close();

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
