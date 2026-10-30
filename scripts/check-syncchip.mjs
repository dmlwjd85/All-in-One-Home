/** 동기화 칩·공용 컴퓨터 로그인(이 탭에만)·첫 화면 구글 로그인 먼저: 브라우저 없이 확인합니다. */
import { readFileSync } from 'node:fs';
import { agoLabel, chipState, resetSyncStatusForTest, syncAuthKnown, syncBegin, syncEnd, syncQueued, syncSeen, syncStatus } from '../src/lib/syncStatus.js';
import { boot, flushCloud, patchProfile, setAuth, snapshot, update, useAuthForTest, useCloudForTest, usePersistenceForTest, useVaultsForTest } from '../src/lib/db.js';
import { finishRedirectSignIn, loadFirebase, loginLoadOptions, loginPersistence, setLoginPersistence, useFirebaseForTest } from '../src/firebase.js';

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const now = Date.parse('2026-10-30T09:00:00+09:00');

/* 칩 종류 */
{
    resetSyncStatusForTest();
    check(chipState({ cloudReady: false }) === null, '클라우드 설정이 없는데 칩이 보입니다.');
    check(chipState({ cloudReady: true, now })?.kind === 'wait', '로그인 확인 전에는 빈 자리(wait)여야 합니다.');
    check(chipState({ cloudReady: true, online: false, now })?.kind === 'offline', '인터넷이 끊기면 offline이어야 합니다.');
    syncAuthKnown();
    check(chipState({ cloudReady: true, now })?.kind === 'login', '로그아웃 상태는 login이어야 합니다.');
    check(chipState({ cloudReady: true, guest: true, now })?.kind === 'local', '이 기기에서만 쓰면 local이어야 합니다.');
    syncBegin();
    check(chipState({ cloudReady: true, signedIn: true, now })?.kind === 'syncing', '올리는 중에는 syncing이어야 합니다.');
    syncEnd({ ok: false, at: now });
    const err = chipState({ cloudReady: true, signedIn: true, now });
    check(err?.kind === 'error' && err.retry, '실패하면 error와 다시 맞추기 버튼이어야 합니다.');
    syncBegin();
    syncEnd({ ok: true, at: now - 120000 });
    check(chipState({ cloudReady: true, signedIn: true, now })?.kind === 'synced', '다 올리면 synced여야 합니다.');
    check(syncStatus().busy === 0, `busy 수가 0으로 돌아오지 않았습니다: ${syncStatus().busy}`);
    syncBegin(); syncBegin(); syncEnd({ ok: true, at: now });
    check(syncStatus().busy === 1, '겹친 동기화 수를 세지 못합니다.');
    syncEnd({ ok: true, at: now });
    syncQueued(3);
    check(syncStatus().queued === 3, '지우기 대기열 수를 받지 못했습니다.');
    const before = syncStatus().lastOkAt;
    syncSeen(before - 1000);
    check(syncStatus().lastOkAt === before, '예전 시각이 더 늦은 시각을 덮었습니다.');
    syncSeen(before + 1000);
    check(syncStatus().lastOkAt === before + 1000, '저장된 마지막 동기화 시각을 받지 못했습니다.');
    check(typeof agoLabel(now - 30000, now) === 'string' && agoLabel(now - 30000, now) !== agoLabel(now - 3 * 3600000, now), 'agoLabel이 시간에 따라 달라지지 않습니다.');
}

/* 공용 컴퓨터 모드를 켜고 끄면 로그인 보관 방식도 바뀜 */
{
    const vault = () => { const map = new Map(); return { get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v); }, remove: async (k) => { map.delete(k); } }; };
    useVaultsForTest(vault(), vault(), vault());
    const calls = [];
    usePersistenceForTest((shared) => { calls.push(shared); return true; });
    await patchProfile({ sharedPc: true });
    await patchProfile({ sharedPc: false });
    usePersistenceForTest(null);
    check(JSON.stringify(calls) === '[true,false]', `공용 컴퓨터 전환이 로그인 보관 방식에 닿지 않습니다: ${JSON.stringify(calls)}`);
}

/* 대기 중인 올리기·지우기가 있으면 busy가 0이어도 syncing (M15) */
{
    resetSyncStatusForTest();
    syncAuthKnown();
    check(chipState({ cloudReady: true, signedIn: true, now, status: { ...syncStatus(), busy: 0, pending: 2 } })?.kind === 'syncing', '올리지 못한 줄(pending)이 남았는데 syncing이 아닙니다.');
    check(chipState({ cloudReady: true, signedIn: true, now, status: { ...syncStatus(), busy: 0, queued: 1 } })?.kind === 'syncing', '지우기 대기열(queued)이 남았는데 syncing이 아닙니다.');
    syncQueued(2);
    check(chipState({ cloudReady: true, signedIn: true, now })?.kind === 'syncing', '지우기 대기열이 남았는데 칩이 syncing이 아닙니다.');
    syncQueued(0);
}

const memStore = () => { const mem = new Map(); return { mem, getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) }; };
const mapVault = () => { const map = new Map(); return { map, get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v); }, remove: async (k) => { map.delete(k); } }; };

/* 공용 컴퓨터 모드를 켜도 학급 자료는 기본으로 남고, 확인창에서 지우기를 고를 때만 지움 */
{
    const ls = memStore();
    globalThis.localStorage = ls;
    const mv = mapVault(), lv = mapVault(), iv = mapVault();
    useVaultsForTest(mv, lv, iv);
    usePersistenceForTest(() => true);
    await boot('');
    await update((d) => { d.profile.className = '3반'; d.profile.started = true; d.students = [{ id: 's1', name: '가나' }]; return d; });
    await iv.set('items', [{ id: 'i1' }]);
    await patchProfile({ sharedPc: true });
    await new Promise((r) => setTimeout(r, 20));
    check(mv.map.get('state')?.profile?.className === '3반', '공용 컴퓨터 모드를 켜자 학급 자료(state)가 지워졌습니다.');
    check(Array.isArray(iv.map.get('items')), '공용 컴퓨터 모드를 켜자 정리함 자료가 지워졌습니다.');
    check(snapshot().profile.sharedPc === true && snapshot().profile.sharedKeep === true, '자료를 남기는 공용 모드로 표시되지 않았습니다.');
    check(ls.getItem('ssug-gyomu-shared') === '1' && ls.getItem('ssug-gyomu-shared-keep') === '1', `공용 모드 키가 맞지 않습니다: ${JSON.stringify([...ls.mem])}`);
    /* 새로고침해도 학급 자료로 다시 열림 */
    await boot('');
    check(snapshot().profile.className === '3반' && (snapshot().students || []).length === 1 && snapshot().profile.sharedPc === true, '자료를 남긴 공용 모드에서 새로고침하자 학급 자료가 사라졌습니다.');
    await update((d) => { d.profile.className = '3반b'; return d; });
    await new Promise((r) => setTimeout(r, 20));
    check(mv.map.get('state')?.profile?.className === '3반b', '자료를 남긴 공용 모드에서 새 기록이 저장되지 않습니다.');
    /* 끄면 남김 표시도 지움 */
    await patchProfile({ sharedPc: false });
    check(ls.getItem('ssug-gyomu-shared') === '0' && ls.getItem('ssug-gyomu-shared-keep') === '0' && snapshot().profile.sharedKeep === false, '공용 모드를 꺼도 남김 표시가 남았습니다.');
    /* 확인창에서 지우기를 고른 경우만 지움 */
    await patchProfile({ sharedPc: true }, { wipe: true });
    await new Promise((r) => setTimeout(r, 20));
    check(!mv.map.has('state') && !lv.map.has('state') && !iv.map.has('items'), '지우기를 골랐는데 이 컴퓨터 자료가 남았습니다.');
    check(ls.getItem('ssug-gyomu-shared-keep') === '0', '지우기를 골랐는데 남김 표시가 켜졌습니다.');
    await boot('');
    check(!snapshot().profile.className && snapshot().profile.sharedPc === true, '지우기 공용 모드에서 새로고침하면 빈 화면이어야 합니다.');
    await patchProfile({ sharedPc: false });
    /* wipe는 sharedPc: true와 함께일 때만 */
    await update((d) => { d.profile.className = '4반'; return d; });
    await patchProfile({ theme: 'dark' }, { wipe: true });
    await new Promise((r) => setTimeout(r, 20));
    check(mv.map.get('state')?.profile?.className === '4반', '공용 모드와 상관없는 설정 변경이 자료를 지웠습니다.');
    usePersistenceForTest(null);
    const settings = readFileSync('src/ui/Settings.jsx', 'utf8');
    check(/data-shared="keep"[^\n]*patchProfile\(\{ sharedPc: true \}\)/.test(settings) && /data-shared="wipe"[^\n]*patchProfile\(\{ sharedPc: true \}, \{ wipe: true \}\)/.test(settings), '설정 확인창의 남기기·지우기 버튼이 맞게 이어지지 않았습니다.');
    check(!/data-shared="toggle"[^\n]*patchProfile\(\{ sharedPc: true/.test(settings) && !/wipe: true/.test(readFileSync('src/ui/Start.jsx', 'utf8')), '확인창 없이 지우는 길이 있습니다.');
}

/* 동기화 결과가 칩에 그대로 닿음 (M12, M13, M14) */
{
    globalThis.localStorage = memStore();
    useVaultsForTest(mapVault(), mapVault(), mapVault());
    await boot('');
    useAuthForTest('u1');
    await update((d) => { d.profile.className = 'x'; d.profile.guest = false; return d; });
    resetSyncStatusForTest();
    useCloudForTest({ push: async () => ({ ok: false, rejected: [] }), pull: async () => null, remove: async () => ({ ok: true }), available: () => true });
    await flushCloud();
    check(syncStatus().failed === true, '올리기에 실패했는데 칩이 실패로 바뀌지 않았습니다.');
    useCloudForTest({ push: async (uid, st, { hashes }) => ({ ok: true, hashes, rejected: [] }), pull: async () => null, remove: async () => ({ ok: true }), available: () => true });
    await flushCloud();
    check(syncStatus().failed === false && syncStatus().lastOkAt > 0, '올리기가 끝났는데 칩이 동기화됨으로 바뀌지 않았습니다.');
    resetSyncStatusForTest();
    await setAuth({ uid: 'u1' });
    await new Promise((r) => setTimeout(r, 50));
    check(syncStatus().failed === true, '클라우드에서 받아 오지 못했는데(연결 실패) 칩이 실패가 아닙니다.');
    resetSyncStatusForTest();
    await setAuth(null);
    check(syncStatus().authKnown === true, '로그아웃을 확인했는데 칩이 로그인 확인 전(wait)에 머뭅니다.');
    useCloudForTest(null);
}

/* 로그인 보관 방식: 공용이면 이 탭에만(session), 아니면 브라우저(local) (M9, M10, M16) */
{
    const ls = memStore();
    globalThis.localStorage = ls;
    const calls = [];
    const SESSION = { k: 'session' }, LOCAL = { k: 'local' };
    const fakeAuth = { config: {} };
    const authModule = { browserSessionPersistence: SESSION, browserLocalPersistence: LOCAL, setPersistence: async (a, p) => { calls.push([a, p]); }, getRedirectResult: async () => ({ user: { uid: 'r1' } }) };
    const config = { apiKey: 'k', authDomain: 'x.firebaseapp.com', projectId: 'ssug-gyomu', appId: '1' };
    useFirebaseForTest({ authModule, config, bundle: { auth: fakeAuth, memoryOnly: false } });
    await setLoginPersistence(true);
    check(calls.at(-1)?.[0] === fakeAuth && calls.at(-1)?.[1] === SESSION && loginPersistence() === 'session', '공용 모드인데 로그인을 이 탭에만(session) 두지 않습니다.');
    await setLoginPersistence(false);
    check(calls.at(-1)?.[1] === LOCAL && loginPersistence() === 'local', '공용 모드를 꺼도 로그인이 브라우저(local)로 돌아오지 않습니다.');
    /* 이미 띄운 묶음을 다시 쓸 때도 공용이면 session */
    useFirebaseForTest({ authModule, config, bundle: { auth: fakeAuth, memoryOnly: false } });
    calls.length = 0;
    ls.setItem('ssug-gyomu-shared', '1');
    const b = await loadFirebase({ memoryOnly: false });
    check(b?.auth === fakeAuth && calls.length === 1 && calls[0][1] === SESSION, '공용 모드에서 띄워 둔 로그인 묶음을 다시 쓸 때 탭 한정이 빠졌습니다.');
    ls.setItem('ssug-gyomu-shared', '0');
    /* 로그인은 띄워 둔 묶음의 방식을 따름(새로 띄우지 않음) */
    useFirebaseForTest({ authModule, config, bundle: { auth: fakeAuth, memoryOnly: true } });
    check(loginLoadOptions().memoryOnly === true, '로그인이 띄워 둔 묶음(memoryOnly)을 따르지 않습니다.');
    const cred = await finishRedirectSignIn();
    check(cred?.user?.uid === 'r1', '로그인 마무리가 띄워 둔 공용 묶음을 쓰지 않았습니다.');
    useFirebaseForTest({ authModule, config, bundle: null });
    check(loginLoadOptions().memoryOnly === false, '공용 모드가 아닌데 memoryOnly로 로그인합니다.');
    ls.setItem('ssug-gyomu-shared', '1');
    check(loginLoadOptions().memoryOnly === true, '공용 모드인데 로그인 묶음이 기록을 남기는 방식입니다.');
    useFirebaseForTest({});
}

/* 소스 확인 */
{
    const fb = readFileSync('src/firebase.js', 'utf8');
    check(fb.includes('browserSessionPersistence') && fb.includes('setPersistence'), 'firebase.js가 로그인을 탭에만 두지 않습니다.');
    check(fb.includes("localStorage.getItem('ssug-gyomu-shared') === '1'"), 'firebase.js가 기존 공용 PC 키(ssug-gyomu-shared)를 읽지 않습니다.');
    check(/async function signInGoogle\(\) \{\s*const ready = await loadFirebase\(loginLoadOptions\(\)\);/.test(fb) && /async function finishRedirectSignIn\(\) \{\s*const ready = await loadFirebase\(loginLoadOptions\(\)\);/.test(fb), '구글 로그인이 공용 PC 설정을 따르지 않습니다.');
    const start = readFileSync('src/ui/Start.jsx', 'utf8');
    const g = start.indexOf('구글로 로그인하고 시작'), l = start.indexOf('이 기기에서만 써 볼게요');
    check(g > 0 && l > 0 && g < l, '첫 화면에서 구글 로그인이 먼저 나오지 않습니다.');
    check(/primary-btn block" data-start="google"/.test(start), '구글 로그인이 주 버튼이 아닙니다.');
    check(start.includes('aria-pressed={shared}'), '공용 컴퓨터 토글에 aria-pressed가 없습니다.');
    const app = readFileSync('src/App.jsx', 'utf8');
    check((app.match(/<SyncChip /g) || []).length === 1 && /has-sync/.test(app), '머리줄에 동기화 칩이 한 곳에 있지 않습니다.');
    const db = readFileSync('src/lib/db.js', 'utf8');
    check(/async function flushCloudTracked[\s\S]*?syncBegin\(\)[\s\S]*?syncEnd/.test(db) && /flushChain\.then\(flushCloudTracked, flushCloudTracked\)/.test(db) && /async function connectCloud\(uid\)[\s\S]*?syncBegin\(\)/.test(db), 'db.js 동기화가 칩에 알리지 않습니다.');
    const css = readFileSync('src/styles/sync.css', 'utf8');
    check(!/#[0-9a-fA-F]{3,8}\b/.test(css), 'sync.css에 토큰이 아닌 색이 있습니다.');
    check(!/<select|scroll-snap/.test(start + readFileSync('src/ui/SyncChip.jsx', 'utf8')), '드롭다운이나 스크롤 피커가 있습니다.');
}

if (failures.length) {
    console.error(failures.map((f) => `✗ ${f}`).join('\n'));
    process.exit(1);
}
console.log('check:syncchip 통과');
