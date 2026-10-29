/** 동기화 칩·공용 컴퓨터 로그인(이 탭에만)·첫 화면 구글 로그인 먼저: 브라우저 없이 확인합니다. */
import { readFileSync } from 'node:fs';
import { agoLabel, chipState, resetSyncStatusForTest, syncAuthKnown, syncBegin, syncEnd, syncQueued, syncSeen, syncStatus } from '../src/lib/syncStatus.js';
import { patchProfile, usePersistenceForTest, useVaultsForTest } from '../src/lib/db.js';

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

/* 소스 확인 */
{
    const fb = readFileSync('src/firebase.js', 'utf8');
    check(fb.includes('browserSessionPersistence') && fb.includes('setPersistence'), 'firebase.js가 로그인을 탭에만 두지 않습니다.');
    check(fb.includes("localStorage.getItem('ssug-gyomu-shared') === '1'"), 'firebase.js가 기존 공용 PC 키(ssug-gyomu-shared)를 읽지 않습니다.');
    check(/signInGoogle[\s\S]*?loadFirebase\(\{ memoryOnly: bundle \? bundle\.memoryOnly : sharedPcOn\(\) \}\)/.test(fb), '구글 로그인이 공용 PC 설정을 따르지 않습니다.');
    const start = readFileSync('src/ui/Start.jsx', 'utf8');
    const g = start.indexOf('구글로 로그인하고 시작'), l = start.indexOf('이 기기에서만 써 볼게요');
    check(g > 0 && l > 0 && g < l, '첫 화면에서 구글 로그인이 먼저 나오지 않습니다.');
    check(/primary-btn block" data-start="google"/.test(start), '구글 로그인이 주 버튼이 아닙니다.');
    check(start.includes('aria-pressed={shared}'), '공용 컴퓨터 토글에 aria-pressed가 없습니다.');
    const app = readFileSync('src/App.jsx', 'utf8');
    check((app.match(/<SyncChip /g) || []).length === 2, '제목 아래 동기화 칩이 두 곳(오늘/다른 화면)에 없습니다.');
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
