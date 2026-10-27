/** 구글 캘린더 연동. API는 목으로만 부르고, 콕 일정 문서는 고치지 않는지 봅니다. */
import { readFileSync } from 'node:fs';
import { toCloudRow } from '../src/lib/cloudShape.js';
import {
    GCAL_AUTH_ERROR,
    GCAL_TOKEN_KEY,
    GCAL_MODE_HINT,
    GCAL_OFFLINE_ERROR,
    GCAL_PARTIAL_ERROR,
    GCAL_VAULT,
    SCOPE_EVENTS,
    SCOPE_READONLY,
    calendarRedirectUri,
    diffKokEvents,
    emptyGcalState,
    explainOauthError,
    explainSyncError,
    googleToExternal,
    isPushableKokEvent,
    kokToGoogleEvent,
    mergeCalendarRows,
    normalizeToken,
    parseOauthHash,
    pickTokenUx,
    planModeChange,
    planRecordWipe,
    scopeAllows,
    scopeForMode,
    shouldPushCreate,
    tokenUsable,
    visibleGoogleEvents,
} from '../src/lib/gcalCore.js';
import { applyKokDiff, listExternalEvents, pushKokEvent, uploadKokEvents } from '../src/lib/gcalFlow.js';
import {
    disconnectGcal,
    gcalReady,
    gcalSnapshot,
    refreshGcal,
    subscribeGcal,
    switchGcalMode,
    useGcalRevokeForTest,
    useGcalVaultForTest,
    useTokenStoreForTest,
} from '../src/lib/gcalLive.js';

const failures = [];
function check(ok, message) {
    if (!ok) failures.push(message);
}

function jsonResponse(payload, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
    };
}

function createMock(seed = []) {
    const events = seed.map((row) => structuredClone(row));
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
        const method = String(options.method || 'GET').toUpperCase();
        const href = String(url);
        calls.push({ href, method, body: options.body || '' });
        const parsed = new URL(href);
        const id = decodeURIComponent(parsed.pathname.split('/').pop());
        if (method === 'GET') {
            const prop = parsed.searchParams.get('privateExtendedProperty');
            if (prop) {
                const kokId = prop.slice(prop.indexOf('=') + 1);
                return jsonResponse({ items: events.filter((item) => item.extendedProperties?.private?.kokId === kokId) });
            }
            return jsonResponse({ items: events });
        }
        if (method === 'POST') {
            const body = JSON.parse(options.body);
            const row = { id: `g${events.length + 1}`, ...body };
            events.push(row);
            return jsonResponse(row);
        }
        if (method === 'PATCH') {
            const index = events.findIndex((item) => item.id === id);
            if (index < 0) return jsonResponse({ error: { message: 'missing' } }, 404);
            events[index] = { ...events[index], ...JSON.parse(options.body), id };
            return jsonResponse(events[index]);
        }
        if (method === 'DELETE') {
            const index = events.findIndex((item) => item.id === id);
            if (index < 0) return jsonResponse({}, 404);
            events.splice(index, 1);
            return { ok: true, status: 204, json: async () => ({}) };
        }
        return jsonResponse({}, 500);
    };
    return { fetchImpl, calls, events };
}

check(emptyGcalState().mode === 'readonly', '연동 기본값이 보기만이 아닙니다.');
check(scopeForMode('readonly') === SCOPE_READONLY, '보기만 범위가 calendar.readonly 가 아닙니다.');
check(scopeForMode('write') === SCOPE_EVENTS, '양방향 범위가 calendar.events 가 아닙니다.');
check(scopeAllows(`${SCOPE_READONLY} email`, 'readonly') && !scopeAllows(SCOPE_READONLY, 'write'), '범위 판정이 어긋났습니다.');
check(pickTokenUx({ ios: true, standalone: true }) === 'redirect', '아이폰 홈 화면 앱이 같은 창 이동을 쓰지 않습니다.');
check(pickTokenUx({ ios: true, standalone: false }) === 'popup', '아이폰 사파리 탭까지 리다이렉트로 바꿨습니다.');
check(pickTokenUx({ ios: false, standalone: true }) === 'popup', '데스크톱이 리다이렉트입니다.');
check(calendarRedirectUri({ origin: 'https://dmlwjd85.github.io', pathname: '/All-in-One-Home/' }) === 'https://dmlwjd85.github.io/All-in-One-Home/', '리다이렉트 주소가 다릅니다.');

const now = 1_700_000_000_000;
const token = normalizeToken({ access_token: 'ya29.test', expires_in: '3600', scope: SCOPE_EVENTS }, now);
check(tokenUsable(token, 'write', now + 5_000), '방금 받은 토큰을 못 씁니다.');
check(!tokenUsable(token, 'readonly', now + 5_000), '쓰기 토큰을 보기만 범위로 통과시켰습니다.');
check(!tokenUsable(token, 'write', now + 3600 * 1000), '만료된 토큰을 통과시켰습니다.');
const fromHash = parseOauthHash(`#access_token=ya29.back&expires_in=120&scope=${encodeURIComponent(SCOPE_READONLY)}`, now);
check(fromHash?.accessToken === 'ya29.back' && scopeAllows(fromHash.scope, 'readonly'), '돌아왔을 때 토큰을 읽지 못했습니다.');
check(parseOauthHash('#error=access_denied')?.error === 'access_denied', '거절 해시를 놓쳤습니다.');
check(explainOauthError('access_denied').includes('적어 둔 일정은 그대로'), '권한 거절 안내가 없습니다.');
check(explainSyncError(401) === GCAL_AUTH_ERROR && GCAL_AUTH_ERROR.includes('다시 연결'), '만료 안내가 없습니다.');
check(explainSyncError(0) === GCAL_OFFLINE_ERROR && GCAL_OFFLINE_ERROR.includes('적어 둔 일정은 그대로'), '오프라인 안내가 없습니다.');
check(GCAL_PARTIAL_ERROR.includes('그대로'), '일부 실패 안내가 없습니다.');
check(GCAL_MODE_HINT.includes('보기만') && GCAL_MODE_HINT.includes('고치거나') && GCAL_MODE_HINT.includes('지우지는 않아요'), '방식 안내 문장이 없습니다.');

const allDay = kokToGoogleEvent({ id: 'event-1', date: '2026-10-26', end: '2026-10-28', title: '수학여행', kind: '학급', memo: '경주' });
check(allDay.start.date === '2026-10-26' && allDay.end.date === '2026-10-29', '하루 종일 끝 날짜가 구글 규칙과 다릅니다.');
check(allDay.extendedProperties.private.kokId === 'event-1' && allDay.extendedProperties.private.kokSource === 'ssug-gyomu', '콕 아이디를 구글 비공개 속성에 넣지 않았습니다.');
const timed = kokToGoogleEvent({ id: 'event-2', date: '2026-10-26', time: '14:00', endTime: '16:00', title: '학부모 진로 특강' });
check(timed.start.dateTime === '2026-10-26T14:00:00+09:00' && timed.end.dateTime === '2026-10-26T16:00:00+09:00', '시각 일정이 서울 시각으로 나가지 않습니다.');

const external = googleToExternal({ id: 'abc', summary: '치과', location: '강남', start: { date: '2026-10-26' }, end: { date: '2026-10-28' } });
check(external?.id === 'gcal:abc' && external.externalId === 'abc' && external.readOnly && external.google && external.end === '2026-10-27', '구글 일정을 외부 아이디로 두지 않았습니다.');
check(googleToExternal({
    id: 'mine',
    summary: '수학여행',
    start: { date: '2026-10-26' },
    end: { date: '2026-10-27' },
    extendedProperties: { private: { kokId: 'event-1' } },
}) === null, '콕에서 올린 일정을 구글 일정처럼 한 번 더 보여 줍니다.');
check(!isPushableKokEvent({ id: 'local-1', date: '2026-10-26', title: '건강 조사', localOnly: true }), '이 기기 전용 일정을 구글로 보냅니다.');
check(!isPushableKokEvent({ id: 'local-2', date: '2026-10-26', title: '보건 교육' }), '민감 일정을 구글로 보냅니다.');
check(isPushableKokEvent({ id: 'event-3', date: '2026-10-26', title: '협의회' }), '평범한 일정을 빼 먹었습니다.');

const classes = [{ id: 'event-1', date: '2026-10-26', title: '학급 회의' }];
const merged = mergeCalendarRows(classes, [external]);
check(classes.length === 1 && classes[0].title === '학급 회의', '구글 일정을 학급 일정 문서에 섞었습니다.');
check(merged.length === 2 && merged[1].id === 'gcal:abc', '화면에 구글 일정을 붙이지 않았습니다.');
check(toCloudRow('events', merged[1]) === null, '구글 일정이 클라우드 학급 일정 문서가 될 수 있습니다.');
check(visibleGoogleEvents({ enabled: false, uid: 'teacher', external: [external] }, 'teacher').length === 0, '끈 뒤에도 구글 일정을 보여 줍니다.');
check(visibleGoogleEvents({ enabled: true, uid: 'teacher', external: [external] }, '').length === 0, '로그아웃 뒤에 구글 일정을 보여 줍니다.');

const kept = planModeChange({ mode: 'write', links: { 'event-1': { googleEventId: 'g9' } } }, 'readonly');
check(kept.mode === 'readonly' && kept.deleteRemote === false && kept.links['event-1'].googleEventId === 'g9' && kept.askUpload === false, '보기만으로 바꿀 때 구글 일정을 지우도록 표시했습니다.');
const upgrade = planModeChange({ mode: 'readonly', links: {} }, 'write');
check(upgrade.askUpload && upgrade.deleteRemote === false, '양방향으로 바꿀 때 올리기 확인이 없습니다.');

const oldRow = { id: 'event-4', date: '2026-10-20', title: '지난 회의', at: '2026-10-01T00:00:00.000Z' };
const newRow = { id: 'event-5', date: '2026-11-02', title: '새 협의회', at: '2026-10-21T00:00:00.000Z' };
check(!shouldPushCreate(oldRow, { forwardSince: '2026-10-20T00:00:00.000Z' }), '앞으로만 올리기인데 예전 일정을 올립니다.');
check(shouldPushCreate(newRow, { forwardSince: '2026-10-20T00:00:00.000Z' }), '앞으로 만든 일정을 올리지 않습니다.');
check(shouldPushCreate(oldRow, { bulk: true }), '한꺼번에 올리기에서 예전 일정을 빼 먹었습니다.');

const diff = diffKokEvents(
    [{ id: 'a', date: '2026-10-26', title: '회의', time: '09:00' }],
    [{ id: 'a', date: '2026-10-26', title: '회의', time: '10:00' }, { id: 'b', date: '2026-10-27', title: '연수' }],
);
check(diff.updated.length === 1 && diff.updated[0].id === 'a' && diff.created.length === 1 && diff.created[0].id === 'b', '일정 수정·추가를 구분하지 못했습니다.');
const removed = diffKokEvents([{ id: 'a', date: '2026-10-26', title: '회의' }], []);
check(removed.deleted.length === 1 && removed.deleted[0].id === 'a', '삭제를 놓쳤습니다.');

const seeded = createMock([{
    id: 'g-existing',
    summary: '협의회',
    start: { date: '2026-10-27' },
    end: { date: '2026-10-28' },
    extendedProperties: { private: { kokId: 'event-5', kokSource: 'ssug-gyomu' } },
}, {
    id: 'abc',
    summary: '치과',
    location: '강남',
    start: { date: '2026-10-26' },
    end: { date: '2026-10-28' },
}]);
const listed = await listExternalEvents({
    token: 'ya29.test',
    timeMin: '2026-04-01T00:00:00+09:00',
    timeMax: '2027-04-01T00:00:00+09:00',
    fetchImpl: seeded.fetchImpl,
});
check(listed.ok && listed.events.length === 1 && listed.events[0].externalId === 'abc', `콕 일정을 외부 일정으로 다시 가져왔습니다. ${JSON.stringify(listed.events)}`);

const fresh = createMock([]);
const kok = { id: 'event-8', date: '2026-10-26', title: '교직원 회의', time: '09:00', endTime: '10:00', at: '2026-10-25T00:00:00.000Z' };
const kokCopy = JSON.stringify(kok);
const pushed = await pushKokEvent({ token: 'ya29.test', row: kok, fetchImpl: fresh.fetchImpl });
check(pushed.ok && pushed.link.googleEventId === 'g1', '첫 일정을 만들지 못했습니다.');
check(fresh.calls.filter((call) => call.method === 'POST').length === 1, '첫 생성이 한 번이 아닙니다.');
check(JSON.stringify(kok) === kokCopy, '구글로 보내며 콕 일정을 고쳤습니다.');
const again = await pushKokEvent({ token: 'ya29.test', row: { ...kok, title: '교직원 회의 변경' }, link: pushed.link, fetchImpl: fresh.fetchImpl });
check(again.ok && again.link.googleEventId === 'g1' && fresh.calls.filter((call) => call.method === 'POST').length === 1, '매핑이 있는데도 일정을 또 만들었습니다.');
check(fresh.events[0].summary === '교직원 회의 변경' && fresh.events[0].extendedProperties.private.kokId === 'event-8', '수정을 구글에 반영하지 않았습니다.');

const mirror = createMock([{
    id: 'g-existing',
    summary: '옛 제목',
    extendedProperties: { private: { kokId: 'event-5' } },
}]);
const linked = await pushKokEvent({
    token: 'ya29.test',
    row: { id: 'event-5', date: '2026-11-02', title: '새 협의회' },
    fetchImpl: mirror.fetchImpl,
});
check(linked.ok && linked.link.googleEventId === 'g-existing' && mirror.calls.filter((call) => call.method === 'POST').length === 0, '같은 콕 아이디로 구글 일정을 또 만들었습니다.');

const quiet = await applyKokDiff({
    token: 'ya29.test',
    mode: 'readonly',
    enabled: true,
    links: { 'event-8': { googleEventId: 'g1' } },
    forwardSince: '2026-10-01T00:00:00.000Z',
    diff: { created: [], updated: [], deleted: [kok] },
    fetchImpl: () => { throw new Error('보기만인데 구글을 불렀습니다.'); },
});
check(quiet.skipped && quiet.links['event-8'].googleEventId === 'g1', '보기만 모드에서 구글 일정을 지우거나 매핑을 없앴습니다.');

const dropped = createMock([{ id: 'g1', summary: '교직원 회의', extendedProperties: { private: { kokId: 'event-8' } } }]);
const deleted = await applyKokDiff({
    token: 'ya29.test',
    mode: 'write',
    enabled: true,
    links: { 'event-8': { googleEventId: 'g1' } },
    forwardSince: '2026-10-01T00:00:00.000Z',
    diff: { created: [], updated: [], deleted: [kok] },
    fetchImpl: dropped.fetchImpl,
});
check(deleted.errors.length === 0 && !deleted.links['event-8'] && dropped.events.length === 0, '콕에서 지운 일정이 구글에 남았습니다.');

const broken = createMock([]);
const failed = await applyKokDiff({
    token: 'ya29.test',
    mode: 'write',
    enabled: true,
    links: {},
    forwardSince: '2026-10-01T00:00:00.000Z',
    diff: { created: [kok], updated: [], deleted: [] },
    fetchImpl: async () => { throw new Error('down'); },
});
check(failed.errors.length === 1 && explainSyncError(0).includes('그대로') && JSON.stringify(kok) === kokCopy, '동기화 실패가 콕 일정을 건드립니다.');

const blocked = await uploadKokEvents({
    token: 'ya29.test',
    rows: [{ id: 'health', date: '2026-10-26', title: '건강 조사', at: '2026-10-01T00:00:00.000Z' }, kok],
    links: {},
    fetchImpl: createMock([]).fetchImpl,
});
check(blocked.links.health === undefined && blocked.links['event-8'], '민감 일정을 한꺼번에 올리기에 넣었습니다.');

const keepWipe = planRecordWipe({ enabled: true, mode: 'write' }, 'keep');
check(keepWipe.dropRemote === false && keepWipe.releaseBeforeClear === true, '넣기 모드의 기본이 구글 일정을 지웁니다.');
const dropWipe = planRecordWipe({ enabled: true, mode: 'write' }, 'drop');
check(dropWipe.dropRemote === true && dropWipe.releaseBeforeClear === false, '구글에서도 지우기를 골라도 사본이 남습니다.');
check(planRecordWipe({ enabled: true, mode: 'readonly' }, 'drop').dropRemote === false, '보기만인데 구글 일정을 지웁니다.');

const logged = [];
const consoleError = console.error;
console.error = (...args) => { logged.push(args.map(String).join(' ')); };
const denied = await listExternalEvents({
    token: 'ya29.expired',
    timeMin: '2026-04-01T00:00:00+09:00',
    timeMax: '2027-04-01T00:00:00+09:00',
    fetchImpl: async () => ({
        ok: false,
        status: 401,
        json: async () => {
            console.error('401 json');
            return { error: { code: 401 } };
        },
    }),
});
console.error = consoleError;
check(denied.ok === false && denied.status === 401 && denied.message === GCAL_AUTH_ERROR && logged.length === 0, '401 응답이 콘솔에 남습니다.');

function memoryBag() {
    const map = new Map();
    return {
        getItem(key) { return map.has(key) ? map.get(key) : null; },
        setItem(key, value) { map.set(key, String(value)); },
        removeItem(key) { map.delete(key); },
    };
}

function memoryVault(seed) {
    const map = new Map(seed ? [['state', seed]] : []);
    return {
        async get(key) { return map.get(key); },
        async set(key, value) { map.set(key, value); },
        async remove(key) { map.delete(key); },
    };
}

const dental = googleToExternal({ id: 'abc', summary: '치과', start: { date: '2026-10-26' }, end: { date: '2026-10-27' } });
const tokenBag = memoryBag();
tokenBag.setItem(GCAL_TOKEN_KEY, JSON.stringify({
    accessToken: 'ya29.keep',
    expiresAt: Date.now() + 3600 * 1000,
    scope: SCOPE_EVENTS,
}));
useTokenStoreForTest(tokenBag);
useGcalVaultForTest(memoryVault({
    enabled: true,
    uid: 'teacher',
    mode: 'write',
    links: { 'event-8': { googleEventId: 'g1' } },
    external: [dental],
    forwardSince: '',
    needsUploadAsk: false,
    lastError: '',
    lastSyncAt: '',
}));
const revoked = [];
useGcalRevokeForTest((access, done) => {
    revoked.push(access);
    done();
});
const bootRow = await gcalReady();
let liveOnDisconnect = null;
const stopWatch = subscribeGcal((row) => { liveOnDisconnect = row; });
await disconnectGcal();
stopWatch();
check(revoked.length === 1 && revoked[0] === 'ya29.keep' && tokenBag.getItem(GCAL_TOKEN_KEY) === null, '연동을 끌 때 구글 권한을 해제하지 않거나 토큰이 남습니다.');
check(liveOnDisconnect && liveOnDisconnect.enabled === false && visibleGoogleEvents(liveOnDisconnect, 'teacher').length === 0, '연동을 끄자마자 주간 구글 일정이 남습니다.');
check(bootRow.enabled === true && visibleGoogleEvents(bootRow, 'teacher').length === 1, '부팅 스냅샷이 옛 구글 일정을 들고 있어야 회귀가 성립합니다.');
let remounted = null;
await gcalReady().then(() => { remounted = gcalSnapshot(); });
check(remounted.enabled === false && remounted.mode === 'write' && visibleGoogleEvents(remounted, 'teacher').length === 0, '다른 화면에 갔다 오면 부팅 때 읽은 연동 상태로 덮입니다.');
await switchGcalMode('readonly');
check(gcalSnapshot().mode === 'readonly' && bootRow.mode === 'write', '모드를 바꾼 뒤에도 부팅 모드가 화면에 남습니다.');

const authBag = memoryBag();
authBag.setItem(GCAL_TOKEN_KEY, JSON.stringify({
    accessToken: 'ya29.expired',
    expiresAt: Date.now() + 3600 * 1000,
    scope: SCOPE_READONLY,
}));
useTokenStoreForTest(authBag);
useGcalVaultForTest(memoryVault({
    enabled: true,
    uid: 'teacher',
    mode: 'readonly',
    links: {},
    external: [dental],
    forwardSince: '',
    needsUploadAsk: false,
    lastError: '',
    lastSyncAt: '',
}));
const expiredBoot = await gcalReady();
let hits = 0;
const authLogs = [];
console.error = (...args) => { authLogs.push(args.map(String).join(' ')); };
const deniedFetch = async () => {
    hits += 1;
    return {
        ok: false,
        status: 401,
        json: async () => {
            console.error('401 json');
            return {};
        },
    };
};
await refreshGcal(deniedFetch);
await refreshGcal(deniedFetch);
console.error = consoleError;
check(hits === 1 && authLogs.length === 0 && gcalSnapshot().lastError === GCAL_AUTH_ERROR && authBag.getItem(GCAL_TOKEN_KEY) === null, '401 뒤에 토큰으로 다시 요청하거나 콘솔에 남습니다.');
let afterAuth = null;
await gcalReady().then(() => { afterAuth = gcalSnapshot(); });
check(afterAuth.lastError === GCAL_AUTH_ERROR && expiredBoot.lastError === '', '실패 안내가 다른 화면에서 부팅 상태로 사라집니다.');

const root = new URL('..', import.meta.url).pathname;
const read = (rel) => readFileSync(`${root}/${rel}`, 'utf8');
const live = read('src/lib/gcalLive.js');
const hook = read('src/ui/useGcal.js');
const settings = read('src/ui/Settings.jsx');
const ui = read('src/ui/GcalSettings.jsx');
const schedule = `${read('src/ui/Schedule.jsx')}\n${read('src/ui/EventLine.jsx')}`;
const db = read('src/lib/db.js');
const sw = read('public/sw.js');
const rules = read('scripts/check-rules.mjs');
const workflow = read('.github/workflows/deploy-pages.yml');
const buildJob = workflow.split('deploy:')[0];
check(live.includes(`createVault('${GCAL_VAULT}')`), '캘린더 저장 키가 없습니다.');
check(!live.includes('client_secret') && !ui.includes('client_secret'), '클라이언트 시크릿을 쓰고 있습니다.');
check(db.includes("createVault('ssug-gyomu')") && db.includes("createVault('ssug-gyomu-local')") && !db.includes('ssug-gyomu-gcal'), '기존 저장 키를 건드렸습니다.');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v23'"), '서비스 워커가 v23이 아닙니다.');
check(!ui.includes('<select') && !ui.includes('checkbox'), '연동 방식이 드롭다운이거나 체크박스입니다.');
check(ui.includes('구글 일정 보기만') && ui.includes('만든 일정도 구글에 넣기') && ui.includes('준비 중'), '연동 버튼 문구가 없습니다.');
check(ui.includes('한꺼번에 올리기') && ui.includes('앞으로 만든 것만') && ui.includes('GCAL_MODE_HINT'), '올리기 확인이나 방식 안내가 없습니다.');
check(schedule.includes('gcal-badge') && schedule.includes('보기만') && schedule.includes('classEvents'), '달력에 구글 일정 표시가 없습니다.');
check(hook.includes('gcalReady().then(() => { if (alive) setSnap(gcalSnapshot()); })') && !hook.includes('setSnap(row)'), '부팅 때 읽은 상태로 화면을 덮습니다.');
check(settings.includes("useState('keep')") && settings.includes('구글 일정은 남기기') && settings.includes('구글에서도 지우기') && settings.includes('planRecordWipe'), '기록 삭제 확인에 구글 일정 타일이 없습니다.');
check(live.includes('sessionStorage') && live.includes('oauth2?.revoke') && live.includes('localStorage.removeItem(GCAL_TOKEN_KEY)') && !live.includes('tokenStore = localStorage'), '토큰을 세션 밖에서 보관하거나 권한 해제가 없습니다.');
check(live.includes('quietFetch') && !live.includes('globalThis.fetch'), '401이 페이지 콘솔에 남는 fetch를 씁니다.');
check(rules.includes('정리함 제목만 건강') && rules.includes('정리함 안내만 건강'), '정리함 건강 거절 테스트가 빠져 있습니다.');
check(buildJob.includes('contents: read') && !buildJob.includes('actions: write'), '빌드 잡에 actions: write 가 남아 있습니다.');
check(workflow.includes('npm run check:gcal'), '배포 워크플로가 캘린더 검사를 돌리지 않습니다.');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('구글 캘린더 목 검사를 통과했습니다.');
