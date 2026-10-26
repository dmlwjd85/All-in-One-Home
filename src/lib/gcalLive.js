/** 이 기기 캘린더 연동. 학급 일정 문서와 기존 저장 키는 건드리지 않습니다. */
import { createVault } from './idb.js';
import { joined, snapshot, subscribe } from './db.js';
import { isIOS, isStandalone } from './googleLogin.js';
import { seoulYmd } from './date.js';
import {
    GCAL_AUTH_ERROR,
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

function pushableNow() {
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
    if (intent === 'renew') {
        await patchGcal({ lastError: '' });
        await refreshGcal();
        return { ok: true };
    }
    const ask = mode === 'write' && intent !== 'switch-read';
    await patchGcal({
        uid: currentUid(),
        enabled: true,
        mode,
        needsUploadAsk: ask,
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
    await patchGcal({ enabled: false, needsUploadAsk: false, lastError: '' });
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
    const token = readToken('write');
    if (!token) {
        await patchGcal({
            needsUploadAsk: true,
            lastError: GCAL_AUTH_ERROR,
        });
        return { ok: false };
    }
    const rows = pushableNow();
    const result = await uploadKokEvents({
        token: token.accessToken,
        rows,
        links: memory.links,
        fetchImpl,
    });
    dropTokenIfRejected(result.status);
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
    const token = readToken(mode);
    if (!token) {
        await patchGcal({ lastError: GCAL_AUTH_ERROR });
        return { ok: false };
    }
    const windowRange = googleWindow(seoulYmd());
    const listed = await listExternalEvents({
        token: token.accessToken,
        timeMin: windowRange.timeMin,
        timeMax: windowRange.timeMax,
        fetchImpl,
    });
    if (!listed.ok) {
        dropTokenIfRejected(listed.status);
        await patchGcal({ lastError: listed.message });
        return { ok: false, message: listed.message };
    }
    const keepPartial = memory.lastError === GCAL_PARTIAL_ERROR;
    await patchGcal({
        external: listed.events,
        lastError: keepPartial ? GCAL_PARTIAL_ERROR : '',
        lastSyncAt: new Date().toISOString(),
    });
    return { ok: true, events: listed.events };
}

async function syncDiff(diff, fetchImpl) {
    await gcalReady();
    if (!memory.enabled || memory.mode !== 'write') return { skipped: true };
    if (snapshot().profile.sharedPc) return { skipped: true };
    const token = readToken('write');
    if (!token) {
        await patchGcal({ lastError: GCAL_AUTH_ERROR });
        return { ok: false };
    }
    const result = await applyKokDiff({
        token: token.accessToken,
        mode: 'write',
        enabled: true,
        links: memory.links,
        forwardSince: memory.forwardSince,
        diff,
        fetchImpl,
    });
    if (result.skipped) return result;
    dropTokenIfRejected(result.status);
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
