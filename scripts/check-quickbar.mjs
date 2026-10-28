import { createServer } from 'node:net';
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
// QA 2차 4번: 되돌린 뒤에도 민감한 행 id가 클라우드 삭제 대기열에 오르면 안 됩니다(이 기기에만 있던 글이므로).
check(secretRow?.id && !queuedCloudKeys().some((key) => key === `records/${secretRow.id}` || key.endsWith(`/${secretRow.id}`)), `되돌린 민감한 관찰이 클라우드 삭제 대기열에 올랐습니다: ${JSON.stringify(queuedCloudKeys())}`);

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

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

if (!failures.length) {
    /* 다른 검사·미리보기와 겹치지 않게: QUICKBAR_PORT 가 있으면 그 값, 없으면 빈 포트를 고릅니다. */
    const port = Number(process.env.QUICKBAR_PORT) || await new Promise((done, fail) => {
        const probe = createServer();
        probe.once('error', fail);
        probe.listen(0, '127.0.0.1', () => { const { port: free } = probe.address(); probe.close(() => done(free)); });
    });
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

        /* QA 1차 1번: 휴대폰 폭에서 손가락 탭만으로 + 화면(메시지·회의록)을 엽니다. '/' 단축키를 쓰지 않습니다. */
        const tapPage = await browser.newPage();
        await tapPage.setViewport({ width: 360, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
        await tapPage.evaluateOnNewDocument(() => {
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-theme', 'light');
        });
        await tapPage.goto(`${origin}?demo=1&mode=light`, { waitUntil: 'networkidle0' });
        await tapPage.waitForSelector('.tabbar .fab');
        // QA 2차 1번: 손가락이 누른 횟수를 셉니다. main은 '+ → 더보기 → 메시지' 3번이므로 3번을 넘으면 안 됩니다.
        let taps = 0;
        const path = [];
        await tapPage.tap('.tabbar .fab');
        taps += 1; path.push('쨈');
        await tapPage.waitForSelector('.quick-bar.is-open .quick-paste', { timeout: 3000 }).catch(() => {});
        const paste = await tapPage.evaluate(() => {
            const el = document.querySelector('.quick-bar.is-open .quick-paste');
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return { text: el.innerText.trim(), h: r.height, inView: r.top >= 0 && r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight };
        });
        check(paste && paste.text === '메시지·회의록 붙여넣기' && paste.h >= 44 && paste.inView, `휴대폰에서 빠른 입력에 '메시지·회의록 붙여넣기' 단추가 보이지 않습니다: ${JSON.stringify(paste)}`);
        await delay(500);
        if (paste) {
            await tapPage.tap('.quick-bar.is-open .quick-paste');
            taps += 1; path.push('붙여넣기');
        }
        const plusOpen = await tapPage.waitForSelector('[data-screen="plus"]', { timeout: 3000 }).then(() => true, () => false);
        await delay(300);
        // 화면을 굴리지 않고 지금 보이는 단추만 셉니다. 보이지 않으면 사람처럼 더보기를 한 번 더 누릅니다(그만큼 횟수가 늘어 실패).
        const findTile = (label) => tapPage.evaluateHandle((text) => [...document.querySelectorAll('[data-screen="plus"] button')].find((el) => {
            const r = el.getBoundingClientRect();
            return el.innerText.trim().endsWith(text) && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight;
        }) || null, label).then((handle) => handle.asElement());
        let tile = plusOpen ? await findTile('메시지 붙여넣기') : null;
        if (plusOpen && !tile) {
            const more = await findTile('더보기');
            if (more) {
                await more.tap();
                taps += 1; path.push('더보기');
                await delay(300);
                tile = await findTile('메시지 붙여넣기');
            }
        }
        const barGone = await tapPage.evaluate(() => !document.querySelector('.quick-bar.is-open'));
        const tiles = await tapPage.evaluate(() => (document.querySelector('[data-screen="plus"] [aria-label="더 보기"]')?.textContent || ''));
        if (tile) {
            await tile.tap();
            taps += 1; path.push('메시지 붙여넣기');
        }
        const msgOpen = Boolean(tile) && await tapPage.waitForSelector('[data-screen="message"]', { timeout: 3000 }).then(() => true, () => false);
        const plusState = { bar: !barGone, minutes: tiles.includes('회의록 작성'), msg: msgOpen, taps, path: path.join(' → ') };
        check(plusOpen && !plusState.bar && plusState.msg && plusState.minutes, `휴대폰에서 탭으로 + 화면(메시지·회의록)이 열리지 않습니다: ${JSON.stringify({ plusOpen, ...plusState })}`);
        check(msgOpen && taps <= 3, `메시지·회의록까지 ${taps}번 눌러야 합니다(3번 이하여야 함): ${plusState.path}`);
        console.log(`메시지·회의록까지 누른 횟수: ${taps}번 (${plusState.path})`);

        /* 가계부 #31 연타 보호: 컵을 두 번 빠르게 탭하면 두 번째 탭이 막 열린 막대(칩)에 닿아도 저장 검사가 돌지 않습니다.
           0.5초 뒤 일부러 누른 칩은 그대로 받습니다. */
        // QA 2차 3번: 상자가 바쁘면 두 탭 사이가 길어져(400ms 넘으면 일부러 누른 탭으로 봄) 가끔 실패했습니다.
        // 두 탭의 pointerdown 간격을 페이지 안에서 재고, 300ms를 넘으면 그 회차는 버리고 다시 해 봅니다(최대 4번).
        let cupAt = null;
        let under = null;
        let burst = null;
        let gap = Infinity;
        const gaps = [];
        for (let attempt = 0; attempt < 4; attempt += 1) {
            await tapPage.goto(`${origin}?demo=1&mode=light`, { waitUntil: 'networkidle0' });
            await tapPage.waitForSelector('.tabbar .fab');
            // 손가락은 컵 접시 아래쪽(가운데에서 왼쪽 10px·아래 14px)을 누릅니다. 360 폭에서는 열린 막대의 '할 일' 칩 자리입니다.
            cupAt = await tapPage.evaluate(() => { const r = document.querySelector('.tabbar .fab .fab-disc').getBoundingClientRect(); return { x: r.x + r.width / 2 - 10, y: r.y + r.height / 2 + 14 }; });
            await tapPage.evaluate(() => {
                window.__sawGhost = false;
                window.__downs = [];
                window.addEventListener('pointerdown', (event) => { window.__downs.push(event.timeStamp); }, true);
                new MutationObserver(() => {
                    if (document.querySelector('.fab-ghost.is-burst') && document.querySelectorAll('.cup-burst .cup-bit').length === 12) window.__sawGhost = true;
                }).observe(document.body, { childList: true });
            });
            await tapPage.touchscreen.tap(cupAt.x, cupAt.y);
            await delay(90);
            await tapPage.touchscreen.tap(cupAt.x, cupAt.y);
            await delay(400);
            burst = await tapPage.evaluate(() => ({
                toast: document.querySelector('.toast')?.innerText || '',
                open: Boolean(document.querySelector('.quick-bar.is-open')),
                ghost: window.__sawGhost === true,
                left: document.querySelectorAll('.fab-ghost, .cup-burst').length,
                downs: window.__downs.length,
                gap: window.__downs.length >= 2 ? window.__downs[1] - window.__downs[0] : Infinity,
            }));
            gap = burst.gap;
            gaps.push(Number.isFinite(gap) ? Math.round(gap) : -1);
            if (gap <= 300) break;
            console.log(`연타 검사 ${attempt + 1}회차: 두 탭 간격 ${Math.round(gap)}ms라 다시 합니다.`);
        }
        // 컵 자리를 막대 칩이 덮는지는 연타가 끝난 뒤(막대가 열린 채) 확인합니다. 두 탭 사이에 재지 않아 간격이 늘지 않습니다.
        under = await tapPage.evaluate(({ x, y }) => {
            const el = document.elementFromPoint(x, y);
            const tab = document.querySelector('.tabbar')?.getBoundingClientRect();
            const bar = document.querySelector('.quick-bar.is-open')?.getBoundingClientRect();
            return { cup: Boolean(el?.closest('.tabbar .foil-fab')), inBar: Boolean(el?.closest('.quick-bar.is-open')), tabTop: tab ? Math.round(tab.top) : -1, barBottom: bar ? Math.round(bar.bottom) : -1 };
        }, cupAt);
        console.log(`연타 검사 두 탭 간격: ${gaps.join(', ')}ms`);
        check(gap <= 300, `연타 검사의 두 탭 간격이 4번 모두 300ms를 넘어 검사하지 못했습니다: ${gaps.join(', ')}ms`);
        /* 쨈 팝업: 아래 탭 바는 그대로(컵이 보이고 눌림), 팝업은 탭 바 위에 뜹니다. */
        check(under.cup && !under.inBar && under.barBottom > 0 && under.barBottom <= under.tabTop, `팝업이 아래 탭 바(쨈 컵)를 덮거나 바꿉니다: ${JSON.stringify(under)}`);
        check(burst.ghost && burst.left === 0, `쨈 버튼을 누를 때 컵 복사본·쨈 방울 12개가 터지고 사라지지 않습니다: ${JSON.stringify(burst)}`);
        check(burst.open && !burst.toast.includes('한 줄만'), `컵 연타의 두 번째 탭이 팝업을 바로 닫거나 저장 검사를 일으킵니다: ${JSON.stringify(burst)}`);
        {
            await delay(500);
            await tapPage.touchscreen.tap(cupAt.x, cupAt.y);
            const later = await tapPage.waitForFunction(() => !document.querySelector('.quick-bar.is-open'), { timeout: 3000 }).then(() => true, () => false);
            check(later, '0.5초 뒤 쨈 버튼을 다시 누르면 팝업이 닫혀야 합니다.');
        }

        /* 닫는 네 가지 길(✕ · 바탕 · 뒤로 가기 · 쨈 다시)마다 화면이 처음 그대로 돌아오는지 봅니다. */
        {
            const shape = () => tapPage.evaluate(() => {
                const tab = document.querySelector('.tabbar');
                const r = tab.getBoundingClientRect();
                return JSON.stringify({
                    tab: [Math.round(r.top), Math.round(r.height), getComputedStyle(tab).display, tab.innerText.replace(/\s+/g, ' ')],
                    open: Boolean(document.querySelector('.quick-bar.is-open')),
                    scrim: Boolean(document.querySelector('.quick-scrim.is-open')),
                    ghosts: document.querySelectorAll('.fab-ghost, .cup-burst').length,
                    hash: location.hash,
                    lift: document.documentElement.style.getPropertyValue('--quick-lift') || '',
                });
            });
            await tapPage.goto(`${origin}?demo=1&mode=light#/today`, { waitUntil: 'networkidle0' });
            await tapPage.waitForSelector('.tabbar .fab');
            const before = await shape();
            const histBefore = await tapPage.evaluate(() => history.length);
            const ways = {
                '✕ 단추': async () => {
                    const box = await tapPage.evaluate(() => { const r = document.querySelector('.quick-bar.is-open .quick-close').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; });
                    check(box.w >= 44 && box.h >= 44, `✕ 단추가 44px보다 작습니다: ${JSON.stringify(box)}`);
                    await tapPage.touchscreen.tap(box.x, box.y);
                },
                '바탕 누르기': async () => { await tapPage.touchscreen.tap(20, 40); },
                '뒤로 가기': async () => { await tapPage.goBack({ waitUntil: 'networkidle0' }).catch(() => {}); },
                '쨈 다시': async () => { await delay(450); await tapPage.evaluate(() => document.querySelector('.tabbar .fab').click()); },
            };
            for (const [label, close] of Object.entries(ways)) {
                await tapPage.evaluate(() => document.querySelector('.tabbar .fab').click());
                await delay(120);
                const opened = await tapPage.evaluate(() => Boolean(document.querySelector('.quick-bar.is-open')) && Boolean(document.querySelector('.quick-scrim.is-open')));
                check(opened, `${label}: 쨈 팝업이 열리지 않습니다.`);
                const tabWhileOpen = await shape();
                check(JSON.parse(tabWhileOpen).tab.join('|') === JSON.parse(before).tab.join('|'), `${label}: 팝업이 열린 동안 아래 탭 바가 바뀝니다: ${tabWhileOpen}`);
                await close();
                await delay(500);
                const after = await shape();
                check(after === before, `${label}로 닫은 뒤 화면이 처음과 다릅니다: ${after} / ${before}`);
            }
            const histAfter = await tapPage.evaluate(() => history.length);
            check(histAfter <= histBefore + 1, `팝업을 여닫을 때마다 뒤로 가기 기록이 쌓입니다: ${histBefore} → ${histAfter}`);
        }

        /* QA 1차 5번: 저장이 실패하면 적던 글을 되돌려 두고, 쉬운 말로 알려 줍니다. */
        await tapPage.goto(`${origin}?demo=1&mode=light`, { waitUntil: 'networkidle0' });
        await tapPage.waitForSelector('.tabbar .fab');
        await tapPage.evaluate(() => document.querySelector('.tabbar .fab').click());
        await tapPage.evaluate(() => {
            window.__qaPut = IDBObjectStore.prototype.put;
            IDBObjectStore.prototype.put = function () { throw new DOMException('저장 공간이 가득 찼어요', 'QuotaExceededError'); };
            const field = document.querySelector('.quick-field');
            field.value = '실패 확인 메모';
            field.dispatchEvent(new InputEvent('input', { bubbles: true }));
            field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
        });
        await tapPage.waitForFunction(() => (document.querySelector('.toast')?.innerText || '').includes('그대로 있어요'), { timeout: 5000 }).catch(() => {});
        const kept = await tapPage.evaluate(() => {
            IDBObjectStore.prototype.put = window.__qaPut;
            return { value: document.querySelector('.quick-field')?.value || '', toast: document.querySelector('.toast')?.innerText || '' };
        });
        check(kept.value === '실패 확인 메모' && kept.toast.includes('그대로 있어요'), `저장이 실패했을 때 적던 글이 사라지거나 안내가 없습니다: ${JSON.stringify(kept)}`);
        await tapPage.close();

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
