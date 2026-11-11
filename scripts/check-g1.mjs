/** G1 검사: 자료 저장·보호 안내(시안 B)·5분 시작 가이드·교육 사이트 바로가기(시안 C).
    1) 순수 함수: 주소 거르기(http/https만, 계정 넣은 주소 거절), 기본 6곳, 비운 목록 유지, 기본 되돌리기.
    2) 문구 근거: 안내 문구의 민감 낱말이 sensitive.js 목록에 실제로 있는지, 저장소 이름이 db.js 와 같은지.
    3) 브라우저: 320/360/390/900/1920 × 라이트/다크에서 넘침·잘림·겹침 없음, 터치 44px, 새 탭·noopener,
       비밀번호 칸 없음, 숨기기·다시 열기·가이드 표시가 새로 고쳐도 남는지, 사이트 더하기·지우기·되돌리기.
    G1_SHOTS=폴더 를 주면 화면을 찍어 둡니다. */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_LINKS, EDU_LINKS_KEY, MAX_LINKS, addLink, cleanUrl, mergeLinks, normalizeLinks, readLinks, removeLink, restoreDefaults } from '../src/lib/eduLinks.js';
import { GUIDE_STEPS, ONBOARD_KEY, foldForReturning, isReturning, markNoticeSeen, noticeFor, normalizeOnboard, readOnboard, setNotice } from '../src/lib/onboard.js';
import { SENSITIVE_WORDS } from '../src/lib/sensitive.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

/* 1) 순수 함수 */
function memStore() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; }
check(cleanUrl('javascript:alert(1)') === '', 'javascript: 주소를 받습니다.');
check(cleanUrl('data:text/html,hi') === '', 'data: 주소를 받습니다.');
check(cleanUrl('file:///etc/passwd') === '', 'file: 주소를 받습니다.');
check(cleanUrl('https://id:pw@example.org/') === '', '아이디·비밀번호가 든 주소를 받습니다.');
check(cleanUrl('example.org') === 'https://example.org/', '주소 앞에 https:// 를 붙이지 않습니다.');
check(cleanUrl('http://school.example.kr/a?b=1') === 'http://school.example.kr/a?b=1', 'http 주소를 고칩니다.');
check(cleanUrl('localhost') === '', '점 없는 주소를 받습니다.');
check(cleanUrl('https://a b.com') === '', '빈칸 든 주소를 받습니다.');
check(DEFAULT_LINKS.length === 6 && DEFAULT_LINKS.every((row) => row.url.startsWith('https://') && row.builtIn), '기본 사이트가 https 6곳이 아닙니다.');
{
    const store = memStore();
    check(readLinks(store).length === 6, '처음 목록이 기본 6곳이 아닙니다.');
    let items = readLinks(store);
    items = removeLink(items, 'neis', store);
    check(readLinks(store).length === 5 && !readLinks(store).some((r) => r.id === 'neis'), '지운 사이트가 남습니다.');
    let res = addLink(readLinks(store), { title: '우리 학교', url: 'javascript:alert(1)' }, store);
    check(!res.ok && readLinks(store).length === 5, '나쁜 주소를 더합니다.');
    res = addLink(readLinks(store), { title: '  우리   학교  ', url: 'school.example.kr' }, store);
    check(res.ok && readLinks(store).some((r) => r.title === '우리 학교' && r.url === 'https://school.example.kr/'), '사이트 더하기가 남지 않습니다.');
    items = restoreDefaults(readLinks(store), store);
    check(items.length === 7 && items[items.length - 1].id === 'neis' && items.some((r) => r.title === '우리 학교'), '기본 되돌리기가 직접 더한 사이트를 지우거나 기본을 안 넣습니다.');
    for (const row of [...readLinks(store)]) removeLink(readLinks(store), row.id, store);
    check(readLinks(store).length === 0, '모두 지운 목록이 기본으로 돌아옵니다(지운 뜻을 무시).');
    check(normalizeLinks({ items: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, title: `t${i}`, url: `https://e${i}.org/` })) }).length === MAX_LINKS, `바로가기가 ${MAX_LINKS}개를 넘습니다.`);
    check(normalizeLinks({ items: [{ id: 'a', title: 'x', url: 'https://a.org/', password: 'pw', user: 'id' }] }).every((r) => !('password' in r) && !('user' in r)), '바로가기에 계정 칸이 남습니다.');
    store.setItem(EDU_LINKS_KEY, '{망가진');
    check(readLinks(store).length === 6, '망가진 저장값에서 기본으로 돌아가지 않습니다.');
}
check(normalizeOnboard(null).notice === 'open', '처음 안내가 펼친 상태가 아닙니다.');
check(normalizeOnboard({ notice: 'hidden', steps: { attend: true, x: true } }).steps.x === undefined, '모르는 가이드 단계를 저장합니다.');
{
    const store = memStore();
    check(noticeFor(readOnboard(store), '2026-11-10') === 'open', '첫날 안내가 펼쳐지지 않습니다.');
    markNoticeSeen('2026-11-10', store);
    check(noticeFor(readOnboard(store), '2026-11-10') === 'open', '처음 본 날 안에 안내가 접힙니다.');
    check(noticeFor(readOnboard(store), '2026-11-11') === 'folded', '다음 날 저절로 접히지 않아 시간표가 첫 화면에서 밀립니다.');
    setNotice('open', store);
    check(noticeFor(readOnboard(store), '2026-11-12') === 'open', '직접 펼친 안내를 저절로 접습니다.');
    setNotice('hidden', store);
    check(noticeFor(readOnboard(store), '2026-11-13') === 'hidden', '숨긴 안내가 다시 보입니다.');
}
{
    /* 이미 쓰던 선생님은 업데이트 첫날부터 접힘, 예시 학급·오늘 처음 만든 학급은 펼침 */
    const store = memStore();
    const old = { profile: {}, todos: [{ date: '2026-11-03' }], local: {} };
    check(isReturning(old, '2026-11-10') && !isReturning({ profile: { demo: true }, todos: [{ date: '2026-11-03' }] }, '2026-11-10') && !isReturning({ profile: {}, todos: [{ date: '2026-11-10' }] }, '2026-11-10'), '이미 쓰던 선생님 판단이 틀립니다.');
    check(noticeFor(readOnboard(store), '2026-11-10', true) === 'folded', '기존 사용자에게 첫날 안내가 펼쳐집니다.');
    foldForReturning('2026-11-10', store);
    check(readOnboard(store).notice === 'folded' && readOnboard(store).day === '2026-11-10', '기존 사용자 접힘이 저장되지 않습니다.');
    const ls = memStore();
    const merged = mergeLinks(readLinks(ls), [{ id: 'neis', title: 'x', url: 'https://www.neis.go.kr/' }, { id: 'u1', title: '우리 학교', url: 'https://school.example.kr/' }, { id: 'u2', title: '나쁨', url: 'javascript:1' }], ls);
    check(merged.length === 7 && merged[6].id === 'u1', `백업 바로가기 합치기가 틀립니다: ${merged.length}`);
}
check(DEFAULT_LINKS[0].title === '나이스 대국민서비스' && DEFAULT_LINKS[0].url === 'https://www.neis.go.kr/', '나이스 첫 화면 이름이 대국민서비스가 아닙니다.');
{
    const dbText = readFileSync(resolve(root, 'src/lib/db.js'), 'utf8');
    check(dbText.includes('data.bookmarks = readLinks()') && dbText.includes('mergeLinks(readLinks(), data.bookmarks)'), '백업 파일에 바로가기가 들어가지 않거나 가져오지 않습니다.');
    const ui = readFileSync(resolve(root, 'src/ui/EduLinks.jsx'), 'utf8') + readFileSync(resolve(root, 'src/ui/StorageNotice.jsx'), 'utf8');
    check((ui.match(/createPortal\(/g) || []).length >= 2 && (ui.match(/useEscape\(onClose\)/g) || []).length >= 2, '시트가 body 포털·Escape 닫기를 쓰지 않습니다.');
}
check(GUIDE_STEPS.map((s) => s.id).join() === 'storage,attend,jjaem,neis', '5분 가이드 단계 순서가 다릅니다.');
check(ONBOARD_KEY.startsWith('ssug-gyomu') && EDU_LINKS_KEY.startsWith('ssug-gyomu'), '새 키가 ssug-gyomu 로 시작하지 않습니다.');

/* 2) 문구 근거 */
const notice = readFileSync(resolve(root, 'src/ui/StorageNotice.jsx'), 'utf8');
const db = readFileSync(resolve(root, 'src/lib/db.js'), 'utf8');
for (const word of ['학교폭력', '민원', '투약', '알레르기', '건강']) {
    check(notice.includes(word) && SENSITIVE_WORDS.includes(word), `안내의 민감 낱말 ${word}가 sensitive.js 목록에 없습니다.`);
}
check(!/상담·|·상담/.test(notice.split('export function useOnboard')[0]), '안내가 상담을 늘 이 기기에만 둔다고 과장합니다(상담은 민감 낱말일 때만).');
check(db.includes("createVault('ssug-gyomu')") && db.includes("createVault('ssug-gyomu-local')"), 'db.js 저장소 이름이 안내와 다릅니다.');
const allSrc = ['src/ui/StorageNotice.jsx', 'src/ui/EduLinks.jsx', 'src/lib/eduLinks.js', 'src/lib/onboard.js'].map((f) => readFileSync(resolve(root, f), 'utf8')).join('\n');
check(!/type=["']password["']|autoComplete=["'](current-|new-)?password|autoComplete=["']username/.test(allSrc), '비밀번호·계정 칸이 있습니다.');
check(!/<select/.test(allSrc), 'G1 화면에 드롭다운이 있습니다.');
check(!/setDoc|pushUserData|from ['"][^'"]*(firebase|cloud)[^'"]*['"]/.test(readFileSync(resolve(root, 'src/lib/eduLinks.js'), 'utf8') + readFileSync(resolve(root, 'src/lib/onboard.js'), 'utf8')), 'G1 설정을 클라우드에 씁니다.');

/* 3) 브라우저 */
const chrome = ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync);
if (!chrome || !existsSync(resolve(root, 'dist/index.html'))) {
    if (process.env.CI) failures.push('브라우저 또는 dist 가 없어 화면 검사를 못 했습니다.');
    else console.log('브라우저나 dist 가 없어 화면 검사는 건너뜁니다.');
} else {
    const { default: puppeteer } = await import('puppeteer-core');
    const port = 4198;
    const origin = `http://127.0.0.1:${port}/`;
    const shots = process.env.G1_SHOTS || '';
    if (shots) mkdirSync(shots, { recursive: true });
    const preview = spawn(process.execPath, [resolve(root, 'node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port), '--strictPort'], { cwd: root, stdio: 'ignore' });
    for (let i = 0; i < 40; i += 1) {
        try { if ((await fetch(origin)).ok) break; } catch { /* 아직 */ }
        await new Promise((r) => setTimeout(r, 250));
    }
    const browser = await puppeteer.launch({ executablePath: chrome, headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
    const delay = (ms) => new Promise((r) => setTimeout(r, ms));
    /* 하단 탭바에 가리지 않게 가운데로 굴린 뒤 누릅니다. */
    /* 주소 글자를 바꿔 새로 엽니다(# 만 바뀌면 같은 문서라 열린 시트가 남습니다). */
    let nav = 0;
    const fresh = (page, hash) => page.goto(`${origin}?n=${(nav += 1)}${hash}`, { waitUntil: 'networkidle0' });
    const tap = async (page, sel) => { await page.waitForSelector(sel); await page.$eval(sel, (el) => el.scrollIntoView({ block: 'center' })); await delay(50); await page.click(sel); };
    /* 보이는 G1 요소의 넘침·잘림·작은 터치·겹침을 모읍니다. */
    const audit = (page, scope) => page.evaluate((scopeSel) => {
        const out = [];
        const vw = document.documentElement.clientWidth;
        if (document.documentElement.scrollWidth > vw + 1) out.push(`가로 넘침 ${document.documentElement.scrollWidth}>${vw}`);
        const shown = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; };
        for (const box of document.querySelectorAll(scopeSel)) {
            if (!shown(box)) continue;
            const br = box.getBoundingClientRect();
            if (br.right > vw + 1 || br.left < -1) out.push(`${box.className} 화면 밖 ${Math.round(br.left)}~${Math.round(br.right)}`);
            for (const el of box.querySelectorAll('button, a, input')) {
                if (!shown(el)) continue;
                const r = el.getBoundingClientRect();
                if (r.height < 43.5 || r.width < 43.5) out.push(`작은 터치 ${el.innerText || el.getAttribute('aria-label')} ${Math.round(r.width)}x${Math.round(r.height)}`);
                if (r.right > br.right + 1) out.push(`칸 밖 버튼 ${el.innerText}`);
            }
            for (const el of box.querySelectorAll('*')) {
                if (!shown(el) || !el.childNodes.length) continue;
                const s = getComputedStyle(el);
                if (s.textOverflow === 'ellipsis' && el.scrollWidth > el.clientWidth + 1) out.push(`말줄임 ${el.innerText.slice(0, 20)}`);
                if (el.scrollWidth > el.clientWidth + 1 && s.overflowX !== 'visible' && s.overflowX !== 'auto' && s.overflowX !== 'scroll') out.push(`잘림 ${el.className} ${el.innerText.slice(0, 20)}`);
            }
            /* 14px보다 작은 글자는 굵게 쓰지 않습니다(check:browser 규칙과 같음). */
            for (const el of box.querySelectorAll('*')) {
                if (!shown(el) || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
                const st = getComputedStyle(el);
                if (parseFloat(st.fontSize) < 14 && Number(st.fontWeight) >= 700) out.push(`작은 굵은 글자 ${el.innerText.slice(0, 12)} ${st.fontSize}/${st.fontWeight}`);
            }
            /* K 뉴모피즘: 볼록한 그림자는 누를 수 있는 것에만 씁니다. */
            for (const el of box.querySelectorAll('*')) {
                if (!shown(el) || el.closest('button, a, [role="button"]')) continue;
                const sh = getComputedStyle(el).boxShadow;
                if (sh && sh !== 'none' && !sh.includes('inset')) out.push(`누를 수 없는데 볼록함 ${el.tagName}.${el.className}`);
            }
            const kids = [...box.querySelectorAll('.store-item, .side-link, .edu-chip, .links-row, .links-name, .guide-step, .store-actions > *, .guide-actions > *, .links-row-btns > *')].filter(shown).map((el) => ({ el, r: el.getBoundingClientRect() }));
            for (let i = 0; i < kids.length; i += 1) for (let j = i + 1; j < kids.length; j += 1) {
                const a = kids[i].r; const b = kids[j].r;
                if (kids[i].el.contains(kids[j].el) || kids[j].el.contains(kids[i].el)) continue;
                const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
                const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
                if (ox > 1 && oy > 1) out.push(`겹침 ${kids[i].el.innerText.slice(0, 12)} / ${kids[j].el.innerText.slice(0, 12)}`);
            }
        }
        if (document.querySelector('input[type="password"]')) out.push('비밀번호 칸이 있습니다');
        return out;
    }, scope);
    const prep = (theme) => (t) => {
        if (!sessionStorage.getItem('g1-prepped')) {
            localStorage.clear();
            localStorage.setItem('ssug-gyomu-key-sound-notice', '1');
            localStorage.setItem('ssug-gyomu-theme', t);
            /* 띄어쓰기 없는 긴 이름 바로가기 하나를 미리 넣어 잘림·겹침을 봅니다. */
            localStorage.setItem('ssug-gyomu-bookmarks', JSON.stringify({ v: 1, items: [
                { id: 'neis', title: '나이스 대국민서비스', url: 'https://www.neis.go.kr/', builtIn: true },
                { id: 'edunet', title: '에듀넷', url: 'https://www.edunet.net/', builtIn: true },
                { id: 'indischool', title: '인디스쿨', url: 'https://indischool.com/', builtIn: true },
                { id: 'iscream', title: '아이스크림', url: 'https://www.i-scream.co.kr/', builtIn: true },
                { id: 'hiclass', title: '하이클래스', url: 'https://www.hiclass.net/', builtIn: true },
                { id: 'teacherville', title: '티처빌', url: 'https://www.teacherville.co.kr/', builtIn: true },
                { id: 'ulong', title: '서울특별시교육청업무포털', url: 'https://www.sen.go.kr/' },
            ] }));
            sessionStorage.setItem('g1-prepped', '1');
        }
    };
    try {
        for (const theme of ['light', 'dark']) {
            for (const width of [320, 360, 390, 900, 1920]) {
                const tag = `${width}-${theme}`;
                const mobile = width < 900;
                const context = await browser.createBrowserContext();
                const page = await context.newPage();
                await page.setViewport({ width, height: width >= 1920 ? 1080 : (mobile ? 844 : 900), isMobile: mobile, hasTouch: mobile });
                await page.evaluateOnNewDocument(prep(theme), theme);
                await page.goto(`${origin}?demo=1#/today`, { waitUntil: 'networkidle0' });
                await page.waitForSelector('.store-notice');
                check(await page.$eval('.store-notice', (el) => el.dataset.storeNotice) === 'open', `[${tag}] 처음 안내가 펼쳐져 있지 않습니다.`);
                check(await page.evaluate((t) => document.documentElement.classList.contains('dark') === (t === 'dark'), theme), `[${tag}] 테마가 맞지 않습니다.`);
                /* 안내가 오늘 화면 맨 위(첫 카드)인지 */
                check(await page.evaluate(() => { const n = document.querySelector('.store-notice').getBoundingClientRect(); const g = document.querySelector('.home-grid').getBoundingClientRect(); return n.bottom <= g.top + 1; }), `[${tag}] 안내가 오늘 카드들 위에 있지 않거나 겹칩니다.`);
                check((await page.$$eval('.store-item', (els) => els.length)) === 4, `[${tag}] 안내 항목이 4개가 아닙니다.`);
                /* 펼친 안내의 가이드·숨기기 단추가 굴리지 않아도 탭바·쨈(폰)·오른쪽 아래 쨈(넓은 화면) 위로 온전히 보이는지 */
                const actionsClear = () => page.evaluate(() => {
                    const shown = (el) => el && el.getClientRects().length && getComputedStyle(el).display !== 'none';
                    const covers = ['.tabbar', '.tabbar .fab', '.desk-fab', '.add-event-fab'].flatMap((sel) => [...document.querySelectorAll(sel)]).filter(shown).map((el) => el.getBoundingClientRect());
                    const btns = [...document.querySelectorAll('.store-notice.at-top .store-actions button')].filter(shown);
                    if (btns.length !== 2) return `단추 ${btns.length}개`;
                    for (const btn of btns) {
                        const r = btn.getBoundingClientRect();
                        if (r.top < 0 || r.bottom > innerHeight) return `${btn.innerText} 화면 밖 ${Math.round(r.top)}~${Math.round(r.bottom)}/${innerHeight}`;
                        for (const c of covers) {
                            const ox = Math.min(r.right, c.right) - Math.max(r.left, c.left);
                            const oy = Math.min(r.bottom, c.bottom) - Math.max(r.top, c.top);
                            if (ox > 0 && oy > 0) return `${btn.innerText} 가림 ${Math.round(r.top)}~${Math.round(r.bottom)} / ${Math.round(c.top)}`;
                        }
                        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
                        if (!hit || !btn.contains(hit)) return `${btn.innerText} 가운데를 다른 것이 덮음`;
                    }
                    return '';
                });
                {
                    const issue = await actionsClear();
                    check(!issue, `[${tag}] 처음 펼친 안내 단추가 가립니다: ${issue}`);
                    if (shots && width === 390) await page.screenshot({ path: `${shots}/notice-open-390-${theme}.png` });
                }
                if (mobile) {
                    /* 접고 → 맨 아래 머리 줄에서 다시 펼쳐도 단추가 보이는지 */
                    await tap(page, '.store-notice.at-top .store-notice-head');
                    await page.waitForSelector('.store-notice.at-end .store-notice-head');
                    await tap(page, '.store-notice.at-end .store-notice-head');
                    await page.waitForSelector('.store-notice.at-top:not(.is-folded) .store-actions');
                    await delay(400);
                    const issue = await actionsClear();
                    check(!issue, `[${tag}] 아래에서 다시 펼친 안내 단추가 가립니다: ${issue}`);
                    await page.evaluate(() => window.scrollTo(0, 0));
                }
                if (mobile) {
                    check(await page.$eval('.home-links', (el) => getComputedStyle(el).display !== 'none'), `[${tag}] 좁은 화면에 바로가기 블록이 없습니다.`);
                    check(await page.$eval('.side-links', (el) => getComputedStyle(el).display === 'none').catch(() => true), `[${tag}] 좁은 화면에 사이드 묶음이 보입니다.`);
                    check(await page.$eval('.home-links', (el) => el.dataset.open) === '0', `[${tag}] 바로가기 블록이 처음부터 펼쳐져 있습니다.`);
                    check(await page.$eval('.home-links-sum', (el) => el.innerText.includes('나이스') && el.innerText.includes('티처빌')), `[${tag}] 접힌 블록에 사이트 이름이 다 보이지 않습니다.`);
                    await tap(page, '.home-links-head');
                    await page.waitForSelector('.edu-chips');
                } else {
                    check(await page.$eval('.home-links', (el) => getComputedStyle(el).display === 'none'), `[${tag}] 넓은 화면에 접는 블록이 보입니다.`);
                    const widths = await page.evaluate(() => ({
                        menu: [...document.querySelectorAll('.side-menu button')].map((el) => Math.round(el.getBoundingClientRect().width)),
                        links: [...document.querySelectorAll('.side-links .side-link')].map((el) => Math.round(el.getBoundingClientRect().width)),
                    }));
                    check(widths.links.length === 8 && new Set([...widths.menu, ...widths.links]).size === 1, `[${tag}] 사이드 메뉴·사이트 너비가 다릅니다: ${JSON.stringify(widths)}`);
                }
                const links = await page.$$eval('a[data-edu-link]', (els) => els.filter((el) => el.getClientRects().length).map((el) => ({ href: el.href, target: el.target, rel: el.rel })));
                check(links.length === 7 && links.every((l) => l.target === '_blank' && /noopener/.test(l.rel) && l.href.startsWith('https://')), `[${tag}] 바로가기가 새 탭·noopener·https 가 아닙니다: ${JSON.stringify(links)}`);
                for (const issue of await audit(page, '.store-notice, .home-links, .side-links')) failures.push(`[${tag}] 오늘: ${issue}`);
                if (shots) {
                    await page.evaluate(() => { window.scrollTo(0, 0); document.querySelector('.main')?.scrollTo(0, 0); });
                    await page.screenshot({ path: `${shots}/today-${tag}.png` });
                    /* 아래 끝(좁은 화면은 바로가기 블록, 넓은 화면은 왼쪽 묶음)까지 굴려 한 장 더 찍습니다. */
                    await page.evaluate(() => { window.scrollTo(0, document.documentElement.scrollHeight); document.querySelector('.side')?.scrollTo(0, 99999); });
                    await delay(100);
                    await page.screenshot({ path: `${shots}/today-end-${tag}.png` });
                    await page.evaluate(() => window.scrollTo(0, 0));
                }
                /* 5분 가이드 */
                await tap(page, '[data-guide="open"]');
                await page.waitForSelector('[data-guide="sheet"]');
                for (const issue of await audit(page, '.guide-sheet')) failures.push(`[${tag}] 가이드: ${issue}`);
                if (shots) await page.screenshot({ path: `${shots}/guide-${tag}.png` });
                check(await page.evaluate(() => document.querySelector('.guide-sheet')?.closest('.sheet-back')?.parentElement === document.body), `[${tag}] 가이드 시트가 body 에 그려지지 않습니다.`);
                await page.keyboard.press('Escape');
                await delay(100);
                check(!(await page.$('[data-guide="sheet"]')), `[${tag}] Escape 로 가이드가 닫히지 않습니다.`);
                await tap(page, '[data-guide="open"]');
                await page.waitForSelector('[data-guide="sheet"]');
                await tap(page, '[data-guide-go="neis"]');
                await page.waitForFunction(() => location.hash === '#/students/neis', { timeout: 3000 }).catch(() => {});
                check(await page.evaluate(() => location.hash) === '#/students/neis', `[${tag}] 가이드 나이스 단계가 화면을 옮기지 않습니다.`);
                /* 바로가기 고치기 시트 */
                await fresh(page, '#/today');
                await page.waitForSelector('.store-notice');
                if (mobile) { if (await page.$eval('.home-links', (el) => el.dataset.open) !== '1') await tap(page, '.home-links-head'); await tap(page, '[data-edu-edit="home"]'); }
                else await tap(page, '[data-edu-edit="side"]');
                await page.waitForSelector('[data-edu-sheet]');
                await tap(page, '[data-edu-add]');
                await page.waitForSelector('[data-edu-form]');
                for (const issue of await audit(page, '.links-sheet')) failures.push(`[${tag}] 고치기 시트: ${issue}`);
                check(await page.evaluate(() => document.querySelector('.links-sheet')?.closest('.sheet-back')?.parentElement === document.body), `[${tag}] 바로가기 시트가 body 에 그려지지 않습니다.`);
                check(await page.evaluate(() => { const n = document.querySelector('.links-row[data-edu-row="ulong"] .links-name'); const b = document.querySelector('.links-row[data-edu-row="ulong"] .links-row-btns'); if (!n || !b) return false; const r = n.getBoundingClientRect(); const q = b.getBoundingClientRect(); return n.scrollWidth <= n.clientWidth + 1 && (r.right <= q.left + 1 || r.bottom <= q.top + 1); }), `[${tag}] 긴 이름이 버튼에 가리거나 잘립니다.`);
                if (shots) await page.screenshot({ path: `${shots}/links-sheet-${tag}.png` });
                if (width === 390 || width === 1920) {
                    await page.type('#edu-title', '우리 학교');
                    await page.type('#edu-url', 'javascript:alert(1)');
                    await tap(page, '[data-edu-save]');
                    await delay(100);
                    check(await page.evaluate(() => JSON.parse(localStorage.getItem('ssug-gyomu-bookmarks') || 'null') === null || !localStorage.getItem('ssug-gyomu-bookmarks').includes('javascript')), `[${tag}] 나쁜 주소가 저장됩니다.`);
                    await page.$eval('#edu-url', (el) => { el.focus(); el.select(); });
                    await page.type('#edu-url', 'school.example.kr');
                    await tap(page, '[data-edu-save]');
                    await page.waitForSelector('[data-edu-add]');
                    await tap(page, '[data-edu-del="neis"]');
                    await tap(page, '[data-edu-del-yes="neis"]');
                    await page.reload({ waitUntil: 'networkidle0' });
                    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ssug-gyomu-bookmarks')).items);
                    check(saved.length === 7 && saved.some((r) => r.url === 'https://school.example.kr/') && !saved.some((r) => r.id === 'neis'), `[${tag}] 더하기·지우기가 새로 고친 뒤 남지 않습니다: ${JSON.stringify(saved)}`);
                }
                if (await page.$('[data-edu-sheet]')) {
                    await page.keyboard.press('Escape');
                    await delay(100);
                    check(!(await page.$('[data-edu-sheet]')), `[${tag}] Escape 로 바로가기 시트가 닫히지 않습니다.`);
                }
                /* 숨기기 → 새로 고쳐도 숨김 → 설정에서 다시 열기 */
                await fresh(page, '#/today');
                await page.waitForSelector('[data-store-notice-hide]');
                await tap(page, '[data-store-notice-hide]');
                await page.reload({ waitUntil: 'networkidle0' });
                await page.waitForSelector('.home-grid');
                check(!(await page.$('.store-notice')), `[${tag}] 숨긴 안내가 새로 고친 뒤 다시 보입니다.`);
                await fresh(page, '#/settings/account');
                await page.waitForSelector('[data-store-reopen]');
                for (const issue of await audit(page, '[data-screen="store-guide"]')) failures.push(`[${tag}] 설정: ${issue}`);
                if (shots) await page.screenshot({ path: `${shots}/settings-${tag}.png` });
                await tap(page, '[data-store-reopen]');
                await page.waitForFunction(() => location.hash === '#/today', { timeout: 3000 }).catch(() => {});
                await page.waitForSelector('.store-notice', { timeout: 3000 }).catch(() => {});
                check(await page.$eval('.store-notice', (el) => el.dataset.storeNotice).catch(() => '') === 'open', `[${tag}] 설정에서 안내를 다시 열지 못합니다.`);
                /* 가이드 표시가 남는지 */
                const steps = await page.evaluate(() => JSON.parse(localStorage.getItem('ssug-gyomu-onboard')).steps);
                check(steps.neis === true, `[${tag}] 가이드 단계 표시가 남지 않습니다.`);
                /* 접기 */
                if (!(await page.$('.store-notice-head'))) { failures.push(`[${tag}] 다시 연 안내가 없습니다: ${await page.evaluate(() => location.hash + ' ' + localStorage.getItem('ssug-gyomu-onboard'))}`); console.error(failures.join('\n')); process.exit(1); }
                await tap(page, '.store-notice.at-top .store-notice-head');
                check(await page.$eval('.store-notice', (el) => el.dataset.storeNotice) === 'folded' && !(await page.$('.store-item')), `[${tag}] 안내가 접히지 않습니다.`);
                const placed = await page.evaluate(() => ({
                    top: getComputedStyle(document.querySelector('.store-notice.at-top')).display !== 'none',
                    end: Boolean(document.querySelector('.store-notice.at-end')) && getComputedStyle(document.querySelector('.store-notice.at-end')).display !== 'none',
                    timeAboveEnd: (() => { const e = document.querySelector('.store-notice.at-end'); const g = document.querySelector('.home-grid'); return !e || e.getBoundingClientRect().top >= g.getBoundingClientRect().bottom - 1; })(),
                }));
                check(mobile ? (!placed.top && placed.end && placed.timeAboveEnd) : (placed.top && !placed.end), `[${tag}] 접힌 안내 자리가 틀립니다(폰은 맨 아래, 넓으면 맨 위): ${JSON.stringify(placed)}`);
                for (const issue of await audit(page, '.store-notice')) failures.push(`[${tag}] 접힌 안내: ${issue}`);
                if (shots && mobile) {
                    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
                    await delay(100);
                    await page.screenshot({ path: `${shots}/today-folded-end-${tag}.png` });
                    await page.evaluate(() => window.scrollTo(0, 0));
                }
                if (mobile) {
                    await tap(page, '.store-notice.at-end .store-notice-head');
                    await delay(150);
                    check(await page.$eval('.store-notice.at-top', (el) => el.dataset.storeNotice === 'open' && el.getBoundingClientRect().top < innerHeight && el.getBoundingClientRect().bottom > 0), `[${tag}] 맨 아래 머리 줄에서 펼치면 맨 위 카드가 보이지 않습니다.`);
                    await tap(page, '.store-notice.at-top .store-notice-head');
                }
                if (shots) { await page.evaluate(() => window.scrollTo(0, 0)); await page.screenshot({ path: `${shots}/today-folded-${tag}.png` }); }
                await context.close();
            }
        }
        /* 1024·1366×768: 사이드에서 연 시트가 오른쪽 아래 쨈 버튼(z 30)에 가리지 않는지 */
        for (const width of [1024, 1366]) {
            const context = await browser.createBrowserContext();
            const page = await context.newPage();
            await page.setViewport({ width, height: 768 });
            await page.evaluateOnNewDocument(prep('light'), 'light');
            await page.goto(`${origin}?demo=1#/today`, { waitUntil: 'networkidle0' });
            for (const [open, sheet] of [['[data-edu-edit="side"]', '.links-sheet'], ['[data-guide="open"]', '.guide-sheet']]) {
                await tap(page, open);
                await page.waitForSelector(sheet);
                const top = await page.evaluate((sel) => {
                    const fab = document.querySelector('.desk-fab').getBoundingClientRect();
                    const hit = document.elementFromPoint(fab.left + fab.width / 2, fab.top + fab.height / 2);
                    return { underSheet: Boolean(hit?.closest('.sheet-back')), fabHit: Boolean(hit?.closest('.desk-fab')) };
                }, sheet);
                check(top.underSheet && !top.fabHit, `[${width}×768] ${sheet} 위로 쨈 버튼이 올라옵니다: ${JSON.stringify(top)}`);
                if (shots) await page.screenshot({ path: `${shots}/fab-${sheet.slice(1)}-${width}x768.png` });
                await page.keyboard.press('Escape');
                await delay(100);
            }
            await context.close();
        }
    } finally {
        await browser.close();
        preview.kill();
    }
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('G1 저장·보호 안내·5분 가이드·교육 사이트 바로가기 검사를 통과했습니다.');
