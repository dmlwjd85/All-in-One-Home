/** 이 기기 캘린더 연동. 학급 일정 문서와 기존 저장 키는 건드리지 않습니다. */
import { createVault } from './idb.js';
import { joined, snapshot, subscribe } from './db.js';
import { isIOS, isStandalone } from './googleLogin.js';
import { seoulYmd } from './date.js';
import {
    GCAL_AUTH_ERROR,
    authRetryDelay,
    isAuthStatus,
    GCAL_SHARED_ERROR,
    GCAL_HASH_KEY,
    GCAL_PARTIAL_ERROR,
    GCAL_PENDING_KEY,
    GCAL_RETRY_ERROR,
    GCAL_SCRIPT_ERROR,
    GCAL_TOKEN_KEY,
    calendarRedirectUri,
    emptyGcalState,
    explainOauthError,
    googleClientId,
    googleWindow,
    isPushableKokEvent,
    normalizeToken,
    parseOauthHash,
    pickTokenUx,
    scopeForMode,
    tokenUsable,
    diffKokEvents,
} from './gcalCore.js';
import { applyKokDiff, listExternalEvents, quietFetch, uploadKokEvents } from './gcalFlow.js';

const listeners = new Set();
let memory = emptyGcalState();
let loaded = false;
let vault = createVault('ssug-gyomu-gcal');
let readyPromise = null;
let tokenMemory = null;
let scriptPromise = null;
let queue = Promise.resolve();
let pullLock = null;
let gisClient = null;
let silentImpl = null;
let retryTimer = null;
let retryAttempt = 0;
let scheduleImpl = (fn, ms) => setTimeout(fn, ms);
let cancelImpl = (id) => clearTimeout(id);
let retryFetch = null;

let gisLoader = null;
let uxOverride = null;
let retryStore = null;
export const GCAL_RETRY_KEY = 'ssug-gyomu-gcal-retry';

export function useSilentTokenForTest(fn) { silentImpl = fn; }
/** 테스트: GIS 스크립트 불러오기를 바꿔 끼웁니다. oauth2 객체(또는 null)를 돌려주면 됩니다. */
export function useGisLoaderForTest(fn) { gisLoader = fn; }
export function useTokenUxForTest(ux) { uxOverride = ux; }
export function useRetryStoreForTest(store) { retryStore = store; retryAttempt = readRetryAttempt(); }
export function useGcalSchedulerForTest(schedule, cancel, fetchImpl = null) {
    scheduleImpl = schedule;
    retryFetch = fetchImpl;
    cancelImpl = cancel || (() => {});
    retryTimer = null;
    retryAttempt = 0;
    saveRetryAttempt();
}
export function gcalRetryAttemptForTest() { return retryAttempt; }
export function gcalRetryPendingForTest() { return retryTimer !== null; }

function retryBag() {
    if (retryStore) return retryStore;
    try {
        if (typeof localStorage !== 'undefined') return localStorage;
    } catch {
        /* 저장소가 없으면 메모리만 씁니다. */
    }
    return null;
}

function readRetryAttempt() {
    try {
        const raw = retryBag()?.getItem(GCAL_RETRY_KEY);
        const n = Math.floor(Number(JSON.parse(raw || '{}').attempt) || 0);
        return n > 0 ? Math.min(n, 20) : 0;
    } catch {
        return 0;
    }
}

function saveRetryAttempt() {
    try {
        const bag = retryBag();
        if (!bag) return;
        if (retryAttempt > 0) bag.setItem(GCAL_RETRY_KEY, JSON.stringify({ attempt: retryAttempt }));
        else bag.removeItem(GCAL_RETRY_KEY);
    } catch {
        /* 간격을 못 남겨도 이번 실행에서는 메모리에 있습니다. */
    }
}
retryAttempt = readRetryAttempt();

function emit() {
    const snap = gcalSnapshot();
    listeners.forEach((fn) => {
        try { fn(snap); } catch { /* 화면 구독만 건너뜁니다. */ }
    });
}

export function gcalSnapshot() {
    return memory;
}

export function subscribeGcal(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function memoryStore() {
    const map = new Map();
    return {
        getItem(key) { return map.has(key) ? map.get(key) : null; },
        setItem(key, value) { map.set(key, String(value)); },
        removeItem(key) { map.delete(key); },
    };
}

let tokenStore = null;

function browserStore() {
    if (tokenStore) return tokenStore;
    try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(GCAL_TOKEN_KEY);
    } catch {
        /* 예전에 남겨 둔 토큰이 없어도 됩니다. */
    }
    try {
        if (typeof sessionStorage !== 'undefined') {
            const probe = `${GCAL_TOKEN_KEY}-probe`;
            sessionStorage.setItem(probe, '1');
            sessionStorage.removeItem(probe);
            tokenStore = sessionStorage;
            return tokenStore;
        }
    } catch {
        /* 세션을 못 쓰면 메모리만 씁니다. */
    }
    tokenStore = memoryStore();
    return tokenStore;
}

export function useTokenStoreForTest(store) {
    tokenStore = store;
    tokenMemory = null;
}

let revokeImpl = null;

export function useGcalRevokeForTest(fn) {
    revokeImpl = fn;
}

export function useGcalVaultForTest(next) {
    vault = next;
    readyPromise = null;
    loaded = false;
    memory = emptyGcalState();
}

function readToken(mode) {
    if (tokenMemory && tokenUsable(tokenMemory, mode)) return tokenMemory;
    try {
        const raw = browserStore().getItem(GCAL_TOKEN_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        const token = normalizeToken(parsed);
        if (token && tokenUsable(token, mode)) {
            tokenMemory = token;
            return token;
        }
    } catch {
        /* 토큰이 깨져 있으면 다시 받습니다. */
    }
    return null;
}

function writeToken(record) {
    tokenMemory = record;
    try {
        browserStore().setItem(GCAL_TOKEN_KEY, JSON.stringify({
            accessToken: record.accessToken,
            expiresAt: record.expiresAt,
            scope: record.scope,
        }));
    } catch {
        /* 토큰을 못 남겨도 이번 실행에서는 메모리에 있습니다. */
    }
}

function clearToken() {
    tokenMemory = null;
    try { browserStore().removeItem(GCAL_TOKEN_KEY); } catch { /* 없어도 됩니다. */ }
    try {
        if (typeof localStorage !== 'undefined') localStorage.removeItem(GCAL_TOKEN_KEY);
    } catch {
        /* 예전 칸이 없어도 됩니다. */
    }
}

function readAnyToken() {
    if (tokenMemory?.accessToken) return tokenMemory;
    try {
        const raw = browserStore().getItem(GCAL_TOKEN_KEY);
        const token = normalizeToken(raw ? JSON.parse(raw) : null);
        if (token?.accessToken) {
            tokenMemory = token;
            return token;
        }
    } catch {
        /* 깨진 토큰은 버립니다. */
    }
    return null;
}

function oauthRevoke() {
    if (typeof revokeImpl === 'function') return revokeImpl;
    const revoke = typeof window !== 'undefined' ? window.google?.accounts?.oauth2?.revoke : null;
    return typeof revoke === 'function' ? revoke : null;
}

async function revokeAccessToken(accessToken) {
    const access = String(accessToken || '').trim();
    if (!access) return;
    let fn = oauthRevoke();
    if (!fn && typeof window !== 'undefined') {
        await prepareCalendarScript();
        fn = oauthRevoke();
    }
    if (typeof fn !== 'function') return;
    await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
        };
        const timer = setTimeout(finish, 4000);
        try {
            fn(access, () => {
                clearTimeout(timer);
                finish();
            });
        } catch {
            clearTimeout(timer);
            finish();
        }
    });
}

function dropTokenIfRejected(status) {
    if (status === 401 || status === 403) clearToken();
}

async function readVault() {
    try {
        return await vault.get('state');
    } catch {
        return undefined;
    }
}

async function writeVault(next) {
    memory = next;
    emit();
    try {
        await vault.set('state', next);
    } catch {
        /* 연동 상태를 못 남겨도 적어 둔 일정은 그대로입니다. */
    }
}

export function gcalReady() {
    if (!readyPromise) {
        readyPromise = (async () => {
            const saved = await readVault();
            if (saved && typeof saved === 'object') {
                memory = { ...emptyGcalState(), ...saved, links: saved.links || {}, external: saved.external || [] };
            }
            loaded = true;
            emit();
            return memory;
        })();
    }
    return readyPromise;
}

async function patchGcal(partial) {
    await gcalReady();
    const next = { ...memory, ...partial };
    if (partial.links) next.links = partial.links;
    if (partial.external) next.external = partial.external;
    await writeVault(next);
    return memory;
}

function enqueue(job) {
    const run = queue.then(job, job);
    queue = run.then(() => undefined, () => undefined);
    return run;
}

export function settleGcalQueue() {
    return queue;
}

function currentUid() {
    return snapshot().auth?.uid || '';
}

let rowsImpl = null;
export function useUploadRowsForTest(fn) { rowsImpl = fn; }

function pushableNow() {
    if (typeof rowsImpl === 'function') return rowsImpl().filter(isPushableKokEvent);
    return joined(snapshot(), 'events').filter(isPushableKokEvent);
}

export function prepareCalendarScript() {
    const clientId = googleClientId();
    if (!clientId || typeof document === 'undefined') return Promise.resolve(false);
    if (window.google?.accounts?.oauth2) return Promise.resolve(true);
    if (scriptPromise) return scriptPromise;
    scriptPromise = new Promise((resolve) => {
        const found = document.querySelector('script[data-gis="kok"]');
        const finish = () => resolve(Boolean(window.google?.accounts?.oauth2));
        if (found) {
            if (window.google?.accounts?.oauth2) finish();
            else found.addEventListener('load', finish, { once: true });
            found.addEventListener('error', () => resolve(false), { once: true });
            return;
        }
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.dataset.gis = 'kok';
        script.onload = finish;
        script.onerror = () => resolve(false);
        document.head.appendChild(script);
    });
    return scriptPromise;
}

function sessionBag() {
    try {
        if (typeof sessionStorage !== 'undefined') return sessionStorage;
    } catch {
        /* 세션이 없으면 리다이렉트 이어받기를 건너뜁니다. */
    }
    return null;
}

function rememberPending(pending) {
    const bag = sessionBag();
    if (!bag) return;
    try { bag.setItem(GCAL_PENDING_KEY, JSON.stringify(pending)); } catch { /* 무시 */ }
}

function takePending() {
    const bag = sessionBag();
    if (!bag) return null;
    try {
        const raw = bag.getItem(GCAL_PENDING_KEY);
        bag.removeItem(GCAL_PENDING_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

function tokenUx() {
    if (uxOverride) return uxOverride;
    if (typeof window === 'undefined') return 'popup';
    return pickTokenUx({
        ios: isIOS(window.navigator),
        standalone: isStandalone(window, window.navigator),
    });
}

async function finishToken(raw, pending) {
    const mode = pending?.mode === 'write' ? 'write' : 'readonly';
    const intent = pending?.intent || 'enable';
    if (raw?.error) {
        takePending();
        await patchGcal({ lastError: explainOauthError(raw.error) });
        return { ok: false, message: memory.lastError };
    }
    const token = normalizeToken(raw);
    if (!token || !tokenUsable(token, mode)) {
        await patchGcal({ lastError: explainOauthError('access_denied') });
        return { ok: false, message: memory.lastError };
    }
    writeToken(token);
    stopAuthRetry();
    if (intent === 'renew') {
        await patchGcal({ lastError: '', needsReconnect: false });
        await refreshGcal();
        return { ok: true };
    }
    const ask = mode === 'write' && intent !== 'switch-read';
    await patchGcal({
        uid: currentUid(),
        enabled: true,
        mode,
        needsUploadAsk: ask,
        needsReconnect: false,
        lastError: '',
    });
    await refreshGcal();
    return { ok: true };
}

function openTokenClient(mode, intent) {
    const clientId = googleClientId();
    const ux = tokenUx();
    const pending = {
        intent,
        mode,
        previousMode: memory.mode,
        previousEnabled: memory.enabled,
    };
    if (ux === 'redirect') rememberPending(pending);
    return new Promise((resolve) => {
        let settled = false;
        const done = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };
        try {
            const config = {
                client_id: clientId,
                scope: scopeForMode(mode),
                include_granted_scopes: false,
                ux_mode: ux,
                callback: (response) => {
                    const failed = response?.error ? { error: response.error } : response;
                    finishToken(failed, pending).then(done);
                },
                error_callback: (error) => {
                    const code = error?.type || error?.message || 'popup_closed';
                    finishToken({ error: code }, pending).then(done);
                },
            };
            if (ux === 'redirect') config.redirect_uri = calendarRedirectUri(window.location);
            const email = snapshot().auth?.email || '';
            if (email) config.login_hint = email;
            gisClient = window.google.accounts.oauth2.initTokenClient(config);
            gisClient.requestAccessToken({ prompt: 'consent' });
        } catch {
            takePending();
            done({ ok: false, message: GCAL_SCRIPT_ERROR });
        }
    });
}

function requestToken(mode, intent) {
    const clientId = googleClientId();
    if (!clientId) return Promise.resolve({ ok: false, message: '구글 캘린더 연동은 준비 중이에요.' });
    if (snapshot().profile.sharedPc) return Promise.resolve({ ok: false, message: GCAL_SHARED_ERROR });
    if (!currentUid()) return Promise.resolve({ ok: false, message: '구글 로그인 후 켤 수 있어요.' });
    if (!window.google?.accounts?.oauth2) {
        return prepareCalendarScript().then((ready) => ({
            ok: false,
            message: ready ? GCAL_RETRY_ERROR : GCAL_SCRIPT_ERROR,
        })).then(async (result) => {
            if (result?.message) await patchGcal({ lastError: result.message });
            return result;
        });
    }
    return openTokenClient(mode, intent).then(async (result) => {
        if (result?.message) await patchGcal({ lastError: result.message });
        return result;
    });
}

/** 이미 허락한 계정이면 창 없이 새 토큰을 받습니다. 못 받으면 null 입니다. */
/** 창 없이 갱신할 수 있는 환경인지. 아이폰 홈 화면 앱(리다이렉트)은 직접 눌러야 합니다. */
export function gcalCanSilent() {
    return tokenUx() !== 'redirect';
}

async function loadGis() {
    if (typeof gisLoader === 'function') {
        try { return (await gisLoader()) || null; } catch { return null; }
    }
    if (typeof window === 'undefined') return null;
    if (!window.google?.accounts?.oauth2) {
        try { await prepareCalendarScript(); } catch { /* 못 불러오면 아래에서 null */ }
    }
    return window.google?.accounts?.oauth2 || null;
}

async function silentToken(mode) {
    if (!gcalCanSilent()) return null;
    if (typeof silentImpl === 'function') {
        return Promise.resolve().then(() => silentImpl(mode)).then((raw) => {
            const token = normalizeToken(raw);
            return token && tokenUsable(token, mode) ? token : null;
        }, () => null);
    }
    const oauth2 = await loadGis();
    if (!oauth2) return null;
    const clientId = googleClientId() || (gisLoader ? 'test-client' : '');
    if (!clientId) return null;
    return new Promise((resolve) => {
        let settled = false;
        const done = (value) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(value);
        };
        const timer = setTimeout(() => done(null), 10000);
        try {
            const config = {
                client_id: clientId,
                scope: scopeForMode(mode),
                include_granted_scopes: false,
                callback: (response) => {
                    const token = response?.error ? null : normalizeToken(response);
                    done(token && tokenUsable(token, mode) ? token : null);
                },
                error_callback: () => done(null),
            };
            const email = snapshot().auth?.email || '';
            if (email) config.login_hint = email;
            oauth2.initTokenClient(config).requestAccessToken({ prompt: '' });
        } catch {
            done(null);
        }
    });
}

function stopAuthRetry() {
    if (retryTimer !== null) cancelImpl(retryTimer);
    retryTimer = null;
    retryAttempt = 0;
    saveRetryAttempt();
}

function scheduleAuthRetry() {
    if (retryTimer !== null) return;
    /* 아이폰 홈 화면 앱은 창 없이 갱신할 수 없으니 타이머를 걸지 않습니다. */
    if (!gcalCanSilent()) return;
    const delay = authRetryDelay(retryAttempt);
    retryAttempt += 1;
    saveRetryAttempt();
    retryTimer = scheduleImpl(() => {
        retryTimer = null;
        if (!memory.enabled || !memory.needsReconnect) return undefined;
        return refreshGcal(retryFetch || quietFetch);
    }, delay);
}

/** 토큰이 없거나 거절되면 조용히 새로 받아 봅니다. 실패하면 설정에만 표시하고 잠시 뒤 다시 해 봅니다. */
async function recoverAuth(mode) {
    clearToken();
    const token = await silentToken(mode);
    if (token) {
        writeToken(token);
        stopAuthRetry();
        if (memory.needsReconnect) await patchGcal({ needsReconnect: false });
        return token;
    }
    await markReconnect();
    return null;
}

async function markReconnect() {
    clearToken();
    await patchGcal({ needsReconnect: true, lastError: '' });
    scheduleAuthRetry();
}

export function connectGcal(mode) {
    const next = mode === 'write' ? 'write' : 'readonly';
    if (!loaded) {
        return gcalReady().then(() => ({ ok: false, message: GCAL_RETRY_ERROR }));
    }
    return requestToken(next, 'enable');
}

export function switchGcalMode(mode) {
    const next = mode === 'write' ? 'write' : 'readonly';
    if (!loaded) {
        return gcalReady().then(() => {
            if (memory.enabled && memory.mode !== next) return { ok: false, message: GCAL_RETRY_ERROR };
            if (!memory.enabled) return patchGcal({ mode: next, lastError: '' }).then(() => ({ ok: true, local: true }));
            return { ok: true };
        });
    }
    if (!memory.enabled) return patchGcal({ mode: next, lastError: '' }).then(() => ({ ok: true, local: true }));
    if (memory.mode === next) return Promise.resolve({ ok: true });
    const intent = next === 'write' ? 'switch-write' : 'switch-read';
    return requestToken(next, intent);
}

export function reconnectGcal() {
    const mode = memory.mode === 'write' ? 'write' : 'readonly';
    return requestToken(mode, 'renew');
}

export async function disconnectGcal() {
    const access = readAnyToken()?.accessToken || '';
    clearToken();
    stopAuthRetry();
    await patchGcal({ enabled: false, needsUploadAsk: false, needsReconnect: false, lastError: '' });
    await revokeAccessToken(access);
    return memory;
}

export async function forgetGcalLocal() {
    const access = readAnyToken()?.accessToken || '';
    clearToken();
    memory = emptyGcalState();
    emit();
    try { await vault.remove('state'); } catch { /* 이미 없습니다. */ }
    await revokeAccessToken(access);
}

export async function answerGcalUpload(yes, fetchImpl = quietFetch) {
    await gcalReady();
    const since = new Date().toISOString();
    if (!yes) {
        await patchGcal({ needsUploadAsk: false, forwardSince: since, lastError: '' });
        return { ok: true, uploaded: 0 };
    }
    const token = readToken('write') || await recoverAuth('write');
    if (!token) {
        await patchGcal({ needsUploadAsk: true });
        return { ok: false, message: GCAL_AUTH_ERROR };
    }
    const rows = pushableNow();
    let result = await uploadKokEvents({
        token: token.accessToken,
        rows,
        links: memory.links,
        fetchImpl,
    });
    if (isAuthStatus(result.status)) {
        const fresh = await recoverAuth('write');
        if (fresh) {
            result = await uploadKokEvents({ token: fresh.accessToken, rows, links: result.links, fetchImpl });
            if (isAuthStatus(result.status)) await markReconnect();
        }
    }
    await patchGcal({
        links: result.links,
        needsUploadAsk: false,
        forwardSince: since,
        lastError: result.errors.length ? GCAL_PARTIAL_ERROR : '',
        lastSyncAt: since,
    });
    return { ok: result.errors.length === 0, uploaded: rows.length, errors: result.errors };
}

export function refreshGcal(fetchImpl = quietFetch) {
    if (pullLock) return pullLock;
    pullLock = pullNow(fetchImpl).finally(() => { pullLock = null; });
    return pullLock;
}

async function pullNow(fetchImpl) {
    await gcalReady();
    if (!memory.enabled) return { ok: false, skipped: true };
    if (snapshot().profile.sharedPc) return { ok: false, skipped: true };
    if (currentUid() && memory.uid && memory.uid !== currentUid()) return { ok: false, skipped: true };
    const mode = memory.mode === 'write' ? 'write' : 'readonly';
    let token = readToken(mode) || await recoverAuth(mode);
    if (!token) return { ok: false, needsReconnect: true };
    const windowRange = googleWindow(seoulYmd());
    const listOnce = (access) => listExternalEvents({
        token: access,
        timeMin: windowRange.timeMin,
        timeMax: windowRange.timeMax,
        fetchImpl,
    });
    let listed = await listOnce(token.accessToken);
    if (!listed.ok && isAuthStatus(listed.status)) {
        token = await recoverAuth(mode);
        if (!token) return { ok: false, needsReconnect: true };
        listed = await listOnce(token.accessToken);
        if (!listed.ok && isAuthStatus(listed.status)) {
            await markReconnect();
            return { ok: false, needsReconnect: true };
        }
    }
    if (!listed.ok) {
        dropTokenIfRejected(listed.status);
        await patchGcal({ lastError: listed.message, softFails: (Number(memory.softFails) || 0) + 1 });
        return { ok: false, message: listed.message };
    }
    const keepPartial = memory.lastError === GCAL_PARTIAL_ERROR;
    stopAuthRetry();
    await patchGcal({
        external: listed.events,
        needsReconnect: false,
        softFails: 0,
        lastError: keepPartial ? GCAL_PARTIAL_ERROR : '',
        lastSyncAt: new Date().toISOString(),
    });
    return { ok: true, events: listed.events };
}

export function syncGcalDiffForTest(diff, fetchImpl) { return syncDiff(diff, fetchImpl); }

async function syncDiff(diff, fetchImpl) {
    await gcalReady();
    if (!memory.enabled || memory.mode !== 'write') return { skipped: true };
    if (snapshot().profile.sharedPc) return { skipped: true };
    const token = readToken('write') || await recoverAuth('write');
    if (!token) return { ok: false, needsReconnect: true };
    const send = (access, links) => applyKokDiff({
        token: access,
        mode: 'write',
        enabled: true,
        links,
        forwardSince: memory.forwardSince,
        diff,
        fetchImpl,
    });
    let result = await send(token.accessToken, memory.links);
    if (result.skipped) return result;
    if (isAuthStatus(result.status)) {
        const fresh = await recoverAuth('write');
        if (fresh) {
            /* 이미 올라간 것은 links 로 건너뛰고, 거절된 요청만 한 번 다시 보냅니다. */
            result = await send(fresh.accessToken, result.links);
            if (isAuthStatus(result.status)) await markReconnect();
        }
    }
    await patchGcal({
        links: result.links,
        lastError: result.errors.length ? GCAL_PARTIAL_ERROR : '',
        lastSyncAt: new Date().toISOString(),
    });
    return result;
}

export async function resumeGcalRedirect() {
    const bag = sessionBag();
    const raw = bag?.getItem(GCAL_HASH_KEY) || '';
    if (bag && raw) bag.removeItem(GCAL_HASH_KEY);
    if (!raw) return { ok: false, skipped: true };
    const pending = takePending() || { intent: 'enable', mode: 'readonly' };
    const parsed = parseOauthHash(raw);
    if (!parsed) return { ok: false };
    return finishToken(parsed, pending);
}

export function startGcalBridge() {
    let prev = pushableNow();
    const stop = subscribe(() => {
        const next = pushableNow();
        const diff = diffKokEvents(prev, next);
        prev = next;
        const uid = currentUid();
        if (memory.uid && uid && memory.uid !== uid) return;
        if (!diff.created.length && !diff.updated.length && !diff.deleted.length) return;
        enqueue(() => syncDiff(diff, quietFetch));
    });
    enqueue(() => resumeGcalRedirect());
    return () => stop();
}

export async function pauseGcalForSharedPc() {
    if (!memory.enabled && !readToken('readonly') && !readToken('write')) return;
    await disconnectGcal();
}
