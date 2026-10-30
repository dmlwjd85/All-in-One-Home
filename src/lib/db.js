import { syncAuthKnown, syncBegin, syncEnd, syncQueued, syncSeen } from './syncStatus.js';
import { createVault } from './idb.js';
import { DEFAULT_PERIODS } from './period.js';
import { patchPeriodLocal, readPeriodLocal, setExtraPeriod, subscribePeriodLocal } from './periodLocal.js';
import { cleanAcademic, setAcademicSource } from './academic.js';
import { buildDemo } from './demo.js';
import { parseNote, stripTokens } from './parse.js';
import { isSensitiveText } from './sensitive.js';
import { buildExport, downloadJson, splitSensitive, validateBackupText, oldBackupToBag } from './backup.js';
import { planMigration, readLegacyStorage } from './migrate.js';
import { CLOUD_COLLECTIONS, deleteUserDoc, fingerprint, printDigest, pullUserData, pushUserData, rowMark, syncAvailable, unchangedSincePush } from './cloud.js';
import { legacyWorkAt, localSettingAts, PERIOD_KEYS, toCloudRow, WORK_KEYS } from './cloudShape.js';
import { dayKeyFromYmd, seoulParts, seoulYmd } from './date.js';
import { parseRoster } from './roster.js';
import { MINUTES_DRAFT_KEY } from './minutes.js';

let mainVault = createVault('ssug-gyomu');
let localVault = createVault('ssug-gyomu-local');
let inboxVault = createVault('ssug-gyomu-inbox');
let inboxDropped = new Set();
const THEME_KEY = 'ssug-gyomu-theme';
const TIP_KEY = 'ssug-gyomu-tips';
const SHARED_KEY = 'ssug-gyomu-shared';
/* 공용 컴퓨터 모드를 켜면서 학급 자료를 남겨 두기로 했는지('1'). 기본은 남김입니다. 지우기를 고른 경우에만 비웁니다. */
const SHARED_KEEP_KEY = 'ssug-gyomu-shared-keep';

export function emptyState() {
    return {
        profile: {
            className: '',
            schoolYear: 2026,
            classSize: 0,
            periodStarts: [...DEFAULT_PERIODS],
            theme: 'system',
            sharedPc: false,
            sharedKeep: false,
            started: false,
            guest: true,
            migratedAt: null,
            migration: null,
            demo: false,
            checkedDates: [],
            migrateLater: false,
        },
        students: [],
        attendance: [],
        records: [],
        events: [],
        todos: [],
        notes: [],
        notices: [],
        timetable: {},
        legacyPages: [],
        inbox: [],
        local: { records: [], notes: [], events: [], todos: [], notices: [], contacts: [], pages: [], backup: null },
        auth: null,
        tip: { hidden: [], seen: [], closes: {}, snooze: '' },
    };
}

let state = emptyState();
let undoStack = [];
const listeners = new Set();
let persistQueue = Promise.resolve();
let memoryOnly = false;
let cloudHashes = {};
let connectTask = null;

function emit() {
    setAcademicSource(state?.profile?.academic);
    const snap = snapshot();
    listeners.forEach((fn) => fn(snap));
}

export function snapshot() {
    return state;
}

export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function mirrorTheme(theme) {
    try {
        localStorage.setItem(THEME_KEY, theme || 'system');
        localStorage.setItem(SHARED_KEY, state.profile.sharedPc ? '1' : '0');
        localStorage.setItem(SHARED_KEEP_KEY, state.profile.sharedPc && state.profile.sharedKeep ? '1' : '0');
        localStorage.setItem(TIP_KEY, JSON.stringify(state.tip));
    } catch {
        /* 저장이 막혀 있어도 화면은 동작합니다. */
    }
}

const storageListeners = new Set();

export function subscribeStorageIssue(fn) {
    storageListeners.add(fn);
    return () => storageListeners.delete(fn);
}

export function storageIssueMessage(error) {
    const name = `${error?.name || ''} ${error?.message || ''}`;
    if (/QuotaExceeded/i.test(name)) return '저장 공간이 가득 차서 기록을 남기지 못했어요. 원래대로 돌려 두었어요.';
    return '이 기기에 기록을 남기지 못해서 원래대로 돌려 두었어요.';
}

function tellStorageIssue(message) {
    storageListeners.forEach((fn) => {
        try { fn(message); } catch { /* 안내는 화면만 고칩니다. */ }
    });
}

function markStorage(error) {
    if (error?.storageFailed) return error;
    const wrapped = new Error(storageIssueMessage(error));
    wrapped.name = error?.name || 'Error';
    wrapped.storageFailed = true;
    wrapped.cause = error;
    return wrapped;
}

async function putState(vault, value) {
    if (value === undefined) await vault.remove('state');
    else await vault.set('state', value);
}

async function restoreVaults(previousMain, previousLocal) {
    try { await putState(mainVault, previousMain); } catch { /* 되돌리기가 막혀도 처음 오류를 올립니다. */ }
    try { await putState(localVault, previousLocal); } catch { /* 한쪽만 남아 있지 않게 둘 다 시도합니다. */ }
}

function platformHasNoVault(error) {
    return typeof indexedDB === 'undefined' && /indexedDB is not defined/.test(`${error?.message || ''}`);
}

async function writeInbox(items) {
    let previous;
    let seen = false;
    try {
        previous = await inboxVault.get('items');
        seen = true;
    } catch (error) {
        if (platformHasNoVault(error)) return;
        throw error;
    }
    try {
        await inboxVault.set('items', Array.isArray(items) ? items : []);
    } catch (error) {
        if (platformHasNoVault(error)) return;
        try {
            if (seen && previous !== undefined) await inboxVault.set('items', previous);
            else await inboxVault.remove('items');
        } catch {
            /* 되돌리기가 막혀도 처음 오류를 올립니다. */
        }
        throw error;
    }
}

async function writeVaults(copy) {
    if (memoryOnly) return;
    const local = copy.local;
    const inbox = copy.inbox;
    const main = { ...copy, local: undefined, auth: null, tip: undefined, inbox: undefined };
    let previousMain;
    let previousLocal;
    try {
        previousMain = await mainVault.get('state');
        previousLocal = await localVault.get('state');
    } catch (error) {
        if (platformHasNoVault(error)) {
            memoryOnly = true;
            return;
        }
        throw markStorage(error);
    }
    let mainWrote = false;
    let localWrote = false;
    try {
        await mainVault.set('state', main);
        mainWrote = true;
        await localVault.set('state', local);
        localWrote = true;
        await writeInbox(inbox);
    } catch (error) {
        if (mainWrote || localWrote) await restoreVaults(previousMain, previousLocal);
        throw markStorage(error);
    }
}

function persist() {
    const copy = structuredClone(state);
    const run = persistQueue.then(() => writeVaults(copy));
    persistQueue = run.then(() => undefined, () => undefined);
    return run;
}

async function revertMemory(previous, undoable) {
    if (undoable) undoStack.pop();
    state = previous;
    mirrorTheme(state.profile.theme);
    emit();
}

const PROFILE_SETTING_PARTS = ['periodStarts', 'ttEdited', 'academic'];
const settingDefault = { periodStarts: [], ttEdited: [], academic: {} };
const settingKey = (profile = {}, part) => JSON.stringify(profile[part] || settingDefault[part]);

/* 바뀐 설정 칸만 그 칸의 고친 시각을 새로 찍습니다(칸 단위 합치기). */
function bumpSettingAts(next, previous = {}) {
    const ats = { ...(next.settingsAts || {}) };
    let changed = false;
    for (const part of PROFILE_SETTING_PARTS) {
        if (settingKey(next, part) === settingKey(previous, part)) continue;
        if ((next.settingsAts || {})[part] !== (previous.settingsAts || {})[part]) continue;
        if (ats[part] === undefined) for (const p of PROFILE_SETTING_PARTS) ats[p] ??= Number(previous.settingsAt) || 0;
        ats[part] = Date.now();
        changed = true;
    }
    if (!changed) return;
    next.settingsAts = ats;
    next.settingsAt = Math.max(...PROFILE_SETTING_PARTS.map((p) => Number(ats[p]) || 0));
}

/* 이 기기 시간표 설정(교시 길이·9·10교시 등)이 바뀌면 다른 기기와 같이 쓰도록 올립니다. */
subscribePeriodLocal(() => { flushCloud().catch(() => {}); });

/*
 * 할 일마다 이 기기에서 마지막으로 고친 시각(editAt, ms)을 적습니다. 클라우드로는 올리지 않고(해시에도 안 들어감),
 * 양쪽에서 같은 할 일을 고쳤을 때 클라우드 updatedAt과 견주어 더 늦게 고친 쪽을 남기는 데만 씁니다.
 * 클라우드에서 받아 합칠 때(fromCloud)는 받은 시각을 그대로 두므로 여기서 새로 찍지 않습니다.
 */
let fromCloud = 0;
export function stampTodoEdits(prev, next, now = Date.now()) {
    const before = new Map([...(prev?.todos || []), ...(prev?.local?.todos || [])].filter((row) => row?.id).map((row) => [String(row.id), row]));
    const strip = (row) => { const { editAt, ...rest } = row; return JSON.stringify(rest); };
    for (const list of [next?.todos || [], next?.local?.todos || []]) {
        for (const row of list) {
            if (!row?.id) continue;
            const old = before.get(String(row.id));
            if (!old) { if (!Number.isFinite(row.editAt)) row.editAt = now; continue; }
            if (strip(old) !== strip(row)) row.editAt = now;
            else if (Number.isFinite(old.editAt) && !Number.isFinite(row.editAt)) row.editAt = old.editAt;
        }
    }
}
function updateFromCloud(recipe) {
    fromCloud += 1;
    try { return update(recipe); } finally { fromCloud -= 1; }
}

export async function update(recipe, { undoable = false } = {}) {
    const previous = structuredClone(state);
    if (undoable) undoStack = [...undoStack.slice(-4), previous];
    const next = recipe(structuredClone(state)) || state;
    if (next !== previous && next?.profile) bumpSettingAts(next.profile, previous.profile);
    if (!fromCloud && next !== previous) stampTodoEdits(previous, next);
    state = next;
    mirrorTheme(state.profile.theme);
    emit();
    try {
        await persist();
    } catch (error) {
        await revertMemory(previous, undoable);
        const message = error?.storageFailed ? error.message : storageIssueMessage(error);
        tellStorageIssue(message);
        return { storageFailed: true, message };
    }
    flushCloud().catch(() => {});
    return null;
}

/** 검사용: 다른 기기에서 받은 자료를 합치는 길을 클라우드 없이 돌립니다. */
export async function absorbCloudForTest(remote, hashes, seen = null) {
    if (hashes) cloudHashes = hashes;
    return updateFromCloud((draft) => absorbCloud(draft, remote, seen));
}

/** 검사에서 두 저장소의 성공·실패를 넣습니다. 저장 키 이름은 바꾸지 않습니다. */
export function useVaultsForTest(nextMain, nextLocal, nextInbox) {
    mainVault = nextMain;
    localVault = nextLocal;
    if (nextInbox) inboxVault = nextInbox;
    memoryOnly = false;
    persistQueue = Promise.resolve();
}

/** 클라우드 규칙이 거절한 줄. 같은 묶음은 한 번만 알립니다. */
let toldRejected = '';

export function cloudRejectedMessage(keys = []) {
    const minutes = keys.filter((key) => key.startsWith('notes/meet-')).length;
    const what = minutes === keys.length ? '회의록' : '기록';
    return `클라우드가 ${what} ${keys.length}개를 받지 않았어요. 이 기기에는 그대로 남아 있고, 나중에 다시 올려요.`;
}

function tellRejected(keys = []) {
    const mark = [...keys].sort().join('|');
    if (mark === toldRejected) return;
    toldRejected = mark;
    if (keys.length) tellStorageIssue(cloudRejectedMessage(keys));
}

export function tellRejectedForTest(keys) {
    tellRejected(keys);
}

/* 검사에서 클라우드 올리기·당겨오기를 에뮬레이터 대신 끼울 수 있게 둡니다. */
let cloudApi = { push: pushUserData, pull: pullUserData, remove: deleteUserDoc, available: syncAvailable };
export function useCloudForTest(api = null) {
    cloudApi = api ? { push: pushUserData, pull: pullUserData, remove: deleteUserDoc, available: () => true, ...api } : { push: pushUserData, pull: pullUserData, remove: deleteUserDoc, available: syncAvailable };
}
let signOutHook = null;
export function useSignOutForTest(fn = null) { signOutHook = fn; }

/*
 * 올리기는 한 번에 하나씩 차례로 합니다. 앱 숨김 때 옛 상태로 시작한 올리기가 뒤늦게 끝나며
 * 새 메모를 올린 뒤의 해시를 옛 해시로 덮지 않게 합니다(5차 검수 1번).
 */
let flushChain = Promise.resolve();
export function flushCloud() {
    const run = flushChain.then(flushCloudTracked, flushCloudTracked);
    flushChain = run.then(() => undefined, () => undefined);
    return run;
}

/* 올리기 중에 바뀌지 않은 칸만 올리기 결과로 바꿉니다. 그 사이 지운 해시는 되살리지 않습니다. */
export function mergePushedHashes(sent, now, pushed) {
    const out = { ...now };
    for (const key of new Set([...Object.keys(sent), ...Object.keys(pushed)])) {
        if (now[key] !== sent[key]) continue;
        if (key in pushed) out[key] = pushed[key];
        else delete out[key];
    }
    return out;
}

async function flushCloudTracked() {
    if (!state.auth?.uid || !cloudApi.available()) return { skipped: true };
    /* 동기화 칩: 올리는 동안 '동기화 중', 끝나면 다 올렸는지에 따라 '동기화됨' 또는 '동기화하지 못했어요'. */
    syncBegin();
    let result = null;
    try {
        result = await flushCloudOnce();
        return result;
    } finally {
        if (!result || result.skipped) syncEnd({ skipped: Boolean(result?.skipped), ok: false });
        else syncEnd({ ok: pushedAll(result), pending: result.pending });
        syncQueued(queuedCloudKeys().length);
    }
}

async function flushCloudOnce() {
    /* 올리기에는 지금 해시의 사본을 넘깁니다. 올리는 동안 이 기기에서 지우거나 받아서 바뀐 해시는 끝난 뒤 덮지 않습니다(PR #52 2차 검수 2번). */
    const sent = { ...cloudHashes };
    const result = await cloudApi.push(state.auth.uid, state, {
        memoryOnly: memoryOnly || state.profile.sharedPc,
        hashes: { ...sent },
    });
    if (result?.hashes) {
        cloudHashes = mergePushedHashes(sent, cloudHashes, result.hashes);
        if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    }
    if (Array.isArray(result?.rejected)) tellRejected(result.rejected);
    await forgetQueuedCloud(cloudApi.remove || deleteUserDoc);
    return result;
}

/**
 * 저장 버튼용: 바로 클라우드에 올리고 결과를 알려 줍니다. 로그인 전이면 'local', 다 올렸으면 'cloud',
 * 연결이 없거나 오래 걸리면 'later'(기기에는 이미 저장됨, 다음에 다시 올림).
 */
export async function flushCloudNow({ timeout = 8000 } = {}) {
    if (!state.auth?.uid || !cloudApi.available()) return 'local';
    let timer = 0;
    try {
        const result = await Promise.race([
            flushCloud(),
            new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), timeout); }),
        ]);
        if (result?.skipped) return 'local';
        if (result?.timedOut || result?.ok === false || (result?.rejected || []).length) return 'later';
        return 'cloud';
    } catch {
        return 'later';
    } finally {
        clearTimeout(timer);
    }
}

/*
 * 되돌리기로 사라진 행은 클라우드 문서도 지웁니다(488149c에서 되살림).
 * pushUserData는 setDoc(merge)만 하므로, 지우지 않으면 다음에 당겨 올 때 되살아납니다.
 * 대기열은 메모리에만 두고 새 저장 키는 만들지 않습니다. 로그인 전이면 대기열에만 남습니다.
 */
const CLOUD_BUCKETS = ['records', 'events', 'todos', 'notes', 'notices', 'attendance'];
/* 지울 대기열은 새로고침 뒤에도 남도록 이 기기(localStorage)에 둡니다. 공용 PC·메모리 모드에서는 남기지 않습니다. */
const CLOUD_FORGET_KEY = 'ssug-gyomu-cloud-forget';
/* 항목마다 계정(uid)과 지운 시각(at)을 둡니다. 로그인한 계정과 다른 항목은 쓰지 않습니다(학생 id가 계정마다 겹칠 수 있음). */
let lastCloudUid = '';
const cloudForget = new Map(readCloudForget());

function rememberCloudUid(uid) {
    if (uid === lastCloudUid) return;
    lastCloudUid = uid;
    saveCloudForget();
}

function forgetEntryKey(uid, key) { return `${uid}|${key}`; }

function readCloudForget() {
    try {
        const saved = JSON.parse(globalThis.localStorage?.getItem(CLOUD_FORGET_KEY) || '{}');
        /* 계정이 없는 예전 배열 형식은 어느 계정 것인지 모르므로 저장소에서도 지웁니다. */
        if (Array.isArray(saved)) {
            globalThis.localStorage?.removeItem(CLOUD_FORGET_KEY);
            return [];
        }
        const list = saved && typeof saved === 'object' && Array.isArray(saved.items) ? saved.items : [];
        lastCloudUid = typeof saved?.last === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(saved.last) ? saved.last : '';
        /* 계정이 적히지 않은 예전 항목은 어느 계정 것인지 모르므로 버립니다. */
        return list.filter((item) => item && typeof item === 'object'
            && typeof item.u === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(item.u)
            && typeof item.k === 'string' && /^[a-z]+\/[A-Za-z0-9_-]{1,120}$/.test(item.k)
            && Number.isFinite(item.at))
            .slice(-500)
            .map((item) => [forgetEntryKey(item.u, item.k), { uid: item.u, key: item.k, at: item.at, ...(typeof item.x === 'string' && /^f[a-z0-9]{1,20}$/.test(item.x) ? { expect: item.x } : {}), ...(typeof item.y === 'string' && /^f[a-z0-9]{1,20}$/.test(item.y) ? { also: item.y } : {}) }]);
    } catch { return []; }
}

function saveCloudForget() {
    try {
        if (memoryOnly || state?.profile?.sharedPc) return;
        const list = [...cloudForget.values()].slice(-500).map((e) => ({ u: e.uid, k: e.key, at: e.at, ...(e.expect ? { x: e.expect } : {}), ...(e.also ? { y: e.also } : {}) }));
        if (list.length || lastCloudUid) globalThis.localStorage?.setItem(CLOUD_FORGET_KEY, JSON.stringify({ last: lastCloudUid, items: list }));
        else globalThis.localStorage?.removeItem(CLOUD_FORGET_KEY);
    } catch { /* 저장 공간이 없으면 이번 실행 동안만 기억합니다. */ }
}

/** 검사용: 로그인한 계정만 바꿉니다(클라우드 연결은 하지 않음). */
export function useAuthForTest(uid) {
    state = { ...state, auth: uid ? { uid } : null };
    if (uid) rememberCloudUid(uid);
}

/** 검사용: 가짜 삭제 함수로 대기열 처리를 돌립니다. */
export function forgetQueuedCloudForTest(remove) {
    return forgetQueuedCloud(remove, { skipSyncCheck: true });
}

/** 검사용: 새로고침을 흉내 내어 저장된 대기열을 다시 읽습니다. */
export function reloadCloudForgetForTest() {
    cloudForget.clear();
    readCloudForget().forEach(([k, v]) => cloudForget.set(k, v));
}

function forgetQueuedFor(uid, key) {
    return Boolean(uid) && cloudForget.has(forgetEntryKey(uid, key));
}

/** 검사에서 지금 로그인한 계정의 클라우드 삭제 대기열을 봅니다. */
export function queuedCloudKeys() {
    const uid = state.auth?.uid;
    return [...cloudForget.values()].filter((e) => e.uid === uid).map((e) => e.key);
}

function queueCloudForget(bucket, id, row = null) {
    if (!CLOUD_BUCKETS.includes(bucket) || !id) return;
    const key = `${bucket}/${id}`;
    /* 로그아웃 상태나 로그인 확인 전이면 이 기기에서 마지막으로 쓴 계정에 붙입니다. 한 번도 로그인하지 않았으면 클라우드에 없으므로 남기지 않습니다. */
    const uid = state.auth?.uid || lastCloudUid;
    const expect = typeof cloudHashes?.[key] === 'string' ? printDigest(cloudHashes[key]) : null;
    /* 오프라인에서 고친 뒤 지우면(결석/질병 → 기타 → 출석) 서버에는 아직 안 올라간 '기타'가 나중에 도착합니다. 지운 줄의 요약도 같이 받아 둡니다. */
    const shaped = row && bucket === 'attendance' ? toCloudRow(bucket, row) : null;
    /* 출결 밖의 줄은 올리기와 같은 해시(rowMark)의 요약을 남깁니다. 진행 중이던 올리기가 같은 내용을 한 번 더 써도 지울 수 있게 합니다. */
    const marked = row && bucket !== 'attendance' ? rowMark(bucket, row) : null;
    const mine = shaped?.id ? printDigest(fingerprint(shaped.body, shaped.clear || [])) : (marked ? printDigest(marked.mark) : null);
    const also = mine && mine !== expect ? mine : null;
    if (uid) {
        cloudForget.set(forgetEntryKey(uid, key), { uid, key, at: Date.now(), ...(expect ? { expect } : {}), ...(also ? { also } : {}) });
        saveCloudForget();
        syncQueued(queuedCloudKeys().length);
    }
    if (Object.prototype.hasOwnProperty.call(cloudHashes, key)) {
        delete cloudHashes[key];
        if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    }
}

async function forgetQueuedCloud(remove = deleteUserDoc, { skipSyncCheck = false } = {}) {
    if (!cloudForget.size || !state.auth?.uid || (!skipSyncCheck && !cloudApi.available())) return;
    const uid = state.auth.uid;
    const memory = memoryOnly || state.profile?.sharedPc;
    for (const [entryKey, entry] of [...cloudForget]) {
        if (entry.uid !== uid) continue;
        const slash = entry.key.indexOf('/');
        const bucket = entry.key.slice(0, slash);
        const id = entry.key.slice(slash + 1);
        if ((state[bucket] || []).some((row) => String(row?.id) === id)) {
            cloudForget.delete(entryKey);
            continue;
        }
        /* 클라우드 문서가 지운 시각보다 나중에 고쳐졌으면 지우지 않습니다. */
        const result = await remove(uid, bucket, id, { memoryOnly: memory, notAfter: entry.at, expect: [entry.expect, entry.also].filter(Boolean).join(',') || null }).catch(() => ({ ok: false }));
        if (result?.ok) cloudForget.delete(entryKey);
    }
    saveCloudForget();
}

function unionById(local = [], remote = []) {
    const map = new Map(local.map((row) => [String(row.id), row]));
    remote.forEach((row) => {
        if (!row?.id || map.has(String(row.id))) return;
        map.set(String(row.id), row);
    });
    return [...map.values()];
}

function withoutDropped(remote = []) {
    return (remote || []).filter((row) => row?.id && !inboxDropped.has(String(row.id)));
}

/** 클라우드에서 지우지 못한 정리함은 다음 받아오기에 다시 붙지 않습니다. */
export function inboxKeptFromCloud(remoteInbox = []) {
    return unionById(state.inbox || [], withoutDropped(remoteInbox));
}

async function rememberDropped(id) {
    const target = inboxId(id);
    if (!target) return;
    inboxDropped.add(target);
    if (memoryOnly) return;
    try {
        const prev = await inboxVault.get('dropped');
        const list = Array.isArray(prev) ? prev.map(String) : [];
        if (!list.includes(target)) list.push(target);
        await inboxVault.set('dropped', list.slice(-400));
    } catch {
        /* 목록을 못 적어도 이번 실행의 메모리에는 남아 있습니다. */
    }
}

function registeredIds(draft) {
    return new Set([
        ...(draft.todos || []), ...(draft.local?.todos || []),
        ...(draft.events || []), ...(draft.local?.events || []),
    ].map((row) => row?.id).filter(Boolean));
}

function dropRegisteredInbox(draft) {
    const taken = registeredIds(draft);
    draft.inbox = (draft.inbox || []).filter((row) => row?.id && !taken.has(row.id));
    return draft;
}

/** 양쪽에 다 있는 줄: 이 기기에서 올린 뒤 고친 적 없으면 다른 기기에서 고친 값으로 바꿉니다.
    이 기기에서 고친 게 아직 안 올라갔으면 이 기기 값이 남고 곧 올라갑니다. 지우는 일은 하지 않습니다. */
export function clippedCopy(mine, theirs) {
    const a = String(mine || '');
    const b = String(theirs || '');
    /* v30은 String(text).slice(0, 2000) 그대로 올립니다. 정확히 2000자 앞부분일 때만 잘린 사본으로 봅니다. */
    return a.length > 2000 && b.length === 2000 && a.startsWith(b);
}

/* 받아 온 값으로 바꿉니다. 클라우드에 없는 칸(다른 기기에서 비운 칸)은 이 기기에서도 비웁니다. */
const OPTIONAL_FROM_CLOUD = { notes: ['title', 'attendees'] };
export function takeRemote(cloudName, row, theirs) {
    const next = { ...row, ...theirs };
    for (const key of OPTIONAL_FROM_CLOUD[cloudName] || []) if (!(key in theirs)) delete next[key];
    return next;
}

/** 클라우드 쪽이 이 기기보다 늦게 고쳐졌는지. 어느 한쪽 시각을 모르면(옛 자료) 이 기기 값을 지킵니다. */
export function remoteIsLater(row, remoteAt) {
    const mine = Number(row?.editAt);
    return Number.isFinite(remoteAt) && remoteAt > 0 && Number.isFinite(mine) && mine > 0 && remoteAt > mine;
}

/** 받아 온 할 일에는 클라우드의 고친 시각을 editAt으로 붙여 둡니다(다음 비교의 기준). */
function withRemoteAt(cloudName, row, remote) {
    if (cloudName !== 'todos' || !row?.id) return row;
    const at = remote?.ats?.todos?.[String(row.id)];
    return Number.isFinite(at) && at > 0 ? { ...row, editAt: at } : row;
}

function refreshShared(local = [], remote = [], cloudName, hashes, ats = null) {
    const byId = new Map((remote || []).filter((row) => row?.id).map((row) => [String(row.id), row]));
    return local.map((row) => {
        const other = row?.id ? byId.get(String(row.id)) : null;
        if (!other) return row;
        if (!unchangedSincePush(hashes, cloudName, row)) {
            /* 할 일: 이 기기에서 고친 뒤 아직 못 올렸어도, 다른 기기가 더 늦게 고쳤으면 그쪽 값이 이깁니다. */
            if (cloudName === 'todos' && remoteIsLater(row, ats?.[String(row.id)])) return { ...takeRemote(cloudName, row, other), editAt: ats[String(row.id)] };
            return row;
        }
        if (cloudName === 'todos' && Number.isFinite(ats?.[String(row.id)])) return { ...takeRemote(cloudName, row, other), editAt: ats[String(row.id)] };
        if (cloudName === 'notes' && clippedCopy(row.text, other.text)) {
            /* 옛 판(v30)은 본문을 2000자로 잘라 다시 올립니다. 잘린 사본이면 이 기기 본문을 지키고 다시 올립니다. */
            if (hashes) delete hashes[`${cloudName}/${row.id}`];
            return { ...takeRemote(cloudName, row, other), text: row.text };
        }
        return takeRemote(cloudName, row, other);
    });
}

/** 기기끼리 같이 쓰는 설정: 칸(교시 설정·9·10교시 과목·교시 시작·고친 날·학사일정)마다 더 늦게 고친 쪽을 받습니다. */
function absorbSettings(draft, settings) {
    if (!settings) return;
    const local = readPeriodLocal();
    const mine = localSettingAts(draft.profile, local);
    const theirs = settings.ats || { period: settings.at, extra: settings.at, periodStarts: settings.at, ttEdited: settings.at, academic: settings.at, work: legacyWorkAt(undefined, settings.at, settings.periodLocal || {}) };
    const newer = (part) => (Number(theirs[part]) || 0) > mine[part];
    const profileAts = { periodStarts: mine.periodStarts, ttEdited: mine.ttEdited, academic: mine.academic };
    if (newer('ttEdited')) { draft.profile.ttEdited = [...(settings.ttEdited || [])].sort(); profileAts.ttEdited = theirs.ttEdited; }
    if (newer('academic')) { draft.profile.academic = cleanAcademic(settings.academic); profileAts.academic = theirs.academic; }
    if (newer('periodStarts') && (settings.periodStarts || []).length) { draft.profile.periodStarts = settings.periodStarts; profileAts.periodStarts = theirs.periodStarts; }
    draft.profile.settingsAts = profileAts;
    draft.profile.settingsAt = Math.max(profileAts.periodStarts, profileAts.ttEdited, profileAts.academic);
    const patch = {};
    const syncAts = { period: mine.period, extra: mine.extra, work: mine.work };
    if (newer('period')) { for (const key of PERIOD_KEYS) if (settings.periodLocal && key in settings.periodLocal) patch[key] = settings.periodLocal[key]; syncAts.period = theirs.period; }
    /* 출퇴근 시각은 따로: 다른 기기가 더 늦게 정하거나 비운 값을 받습니다(빈 값도 비운 시각이 더 늦으면 받음). */
    if (newer('work')) { for (const key of WORK_KEYS) patch[key] = settings.periodLocal?.[key] || ''; syncAts.work = theirs.work; }
    if (newer('extra')) { patch.extra = settings.periodLocal?.extra || {}; syncAts.extra = theirs.extra; }
    if (Object.keys(patch).length) patchPeriodLocal({ ...patch, syncAts, syncAt: Math.max(syncAts.period, syncAts.extra, syncAts.work) }, { fromCloud: true });
}

/* 다른 기기에서 지운 줄(출결·기록·일정·할 일·메모·공지): 이 기기에서 올린 뒤 고치지 않았고(해시 같음) 클라우드에 문서가 없으면 지웁니다.
   해시가 없는 줄(처음 받기, 아직 안 올린 줄)이나 올린 뒤 고친 줄은 그대로 둡니다. */
const PRUNE_BUCKETS = CLOUD_BUCKETS.map((name) => [name, name]);

export function pruneDeletedElsewhere(draft, remote, hashes) {
    for (const [localName, cloudName] of PRUNE_BUCKETS) {
        const ids = remote?.ids?.[cloudName];
        if (!Array.isArray(ids)) continue;
        const present = new Set(ids.map(String));
        draft[localName] = (draft[localName] || []).filter((row) => {
            const shaped = row ? toCloudRow(cloudName, row) : null;
            if (!shaped?.id || present.has(String(shaped.id))) return true;
            if (!unchangedSincePush(hashes, cloudName, row)) return true;
            if (hashes) delete hashes[`${cloudName}/${shaped.id}`];
            return false;
        });
    }
}

/* 받아 온 출결이 이 기기 줄과 같으면 해시를 적어 둡니다. 그래야 다른 기기가 지웠을 때 이 기기도 지우고, 다시 올리지 않습니다. */
export function rememberPulledHashes(rows = [], remoteRows, hashes) {
    if (!Array.isArray(remoteRows) || !hashes) return;
    const mine = new Map(rows.map((row) => [String(row?.id), row]));
    for (const remoteRow of remoteRows) {
        const theirs = remoteRow ? toCloudRow('attendance', remoteRow) : null;
        const local = mine.get(String(remoteRow?.id));
        const ours = local ? toCloudRow('attendance', local) : null;
        if (!theirs?.id || !ours?.id || theirs.id !== ours.id) continue;
        const print = fingerprint(theirs.body, theirs.clear || []);
        if (fingerprint(ours.body, ours.clear || []) === print) hashes[`attendance/${theirs.id}`] = print;
    }
}

/*
 * 받아 온 줄이 이 기기 줄과 똑같으면(모든 묶음) 해시를 적어 둡니다. 예전에는 출결만 적어서, 다른 기기에서 받은
 * 할 일·일정·기록은 해시가 없어 '이 기기에서 고친 줄'로 여겨졌습니다. 그래서 다른 기기가 나중에 고친 값을 받지 않고,
 * 이 기기의 옛 값을 다시 올려 덮기까지 했습니다(기기마다 자료가 다르게 보이던 원인).
 */
export function rememberAllPulled(draft, remote, hashes) {
    if (!remote || !hashes) return;
    for (const [localName, cloudName] of CLOUD_COLLECTIONS) {
        const remoteRows = remote[localName];
        if (!Array.isArray(remoteRows)) continue;
        const mine = new Map((draft[localName] || []).map((row) => [String(row?.id), row]));
        for (const remoteRow of remoteRows) {
            const local = mine.get(String(remoteRow?.id));
            if (!local) continue;
            const theirs = rowMark(cloudName, remoteRow);
            const ours = rowMark(cloudName, local);
            if (theirs && ours && theirs.key === ours.key && theirs.mark === ours.mark) hashes[theirs.key] = theirs.mark;
        }
    }
    for (const [day, value] of Object.entries(remote.timetable || {})) {
        const theirs = rowMark('timetable', { id: day, ...value });
        const ours = draft.timetable?.[day] ? rowMark('timetable', { id: day, ...draft.timetable[day] }) : null;
        if (theirs && ours && theirs.mark === ours.mark) hashes[theirs.key] = theirs.mark;
    }
}

/*
 * 당겨 오는 동안 이 기기에서 고친 줄은 지킵니다. 당기기 전에 본 해시와 지금 해시가 다르면
 * 그 사이에 이 기기 값을 올린 것이므로, 받아 온 옛 값으로 덮지 않습니다(휴대폰에서 고친 출결이 되돌아가던 원인).
 */
export function stableHashes(seen, now) {
    if (!seen) return now;
    const out = {};
    for (const [key, value] of Object.entries(now || {})) {
        if (seen[key] === value) out[key] = value;
    }
    return out;
}

function pruneOnly(draft, remote, seen) {
    const guard = stableHashes(seen, cloudHashes);
    const before = new Set(Object.keys(guard));
    pruneDeletedElsewhere(draft, remote, guard);
    for (const key of before) if (!(key in guard)) delete cloudHashes[key];
    if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    return draft;
}

function absorbCloud(draft, remote, seen = null) {
    const guard = stableHashes(seen, cloudHashes);
    const remoteHas = (remote.students || []).length || (remote.records || []).length;
    if (draft.profile.demo && remoteHas) {
        const keep = (row) => row.source !== 'demo';
        draft.students = draft.students.filter(keep);
        draft.records = draft.records.filter(keep);
        draft.attendance = draft.attendance.filter(keep);
        draft.events = draft.events.filter(keep);
        draft.todos = draft.todos.filter(keep);
        draft.notices = draft.notices.filter(keep);
        draft.notes = draft.notes.filter(keep);
        draft.profile.demo = false;
    }
    /* 이 기기에서 지우고 아직 클라우드에서 못 지운 줄은 받아 오지 않습니다. */
    for (const bucket of CLOUD_BUCKETS) {
        if (Array.isArray(remote[bucket])) remote = { ...remote, [bucket]: remote[bucket].filter((row) => !forgetQueuedFor(state.auth?.uid, `${bucket}/${row?.id}`)) };
    }
    const before = new Set(Object.keys(guard));
    pruneDeletedElsewhere(draft, remote, guard);
    for (const [localName, cloudName] of CLOUD_COLLECTIONS) {
        if (localName === 'inbox') continue;
        draft[localName] = refreshShared(draft[localName] || [], remote[localName], cloudName, guard, remote.ats?.[cloudName]);
    }
    if (guard !== cloudHashes) {
        for (const key of before) if (!(key in guard)) delete cloudHashes[key];
    }
    draft.students = unionById(draft.students, remote.students);
    draft.attendance = unionById(draft.attendance, remote.attendance);
    rememberPulledHashes(draft.attendance, remote.attendance, cloudHashes);
    if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    draft.records = unionById(draft.records, remote.records);
    draft.events = unionById(draft.events, remote.events);
    draft.todos = unionById(draft.todos, (remote.todos || []).map((row) => withRemoteAt('todos', row, remote)));
    draft.notes = unionById(draft.notes, remote.notes);
    draft.notices = unionById(draft.notices, remote.notices);
    draft.legacyPages = unionById(draft.legacyPages, remote.legacyPages);
    draft.inbox = unionById(draft.inbox, withoutDropped(remote.inbox));
    for (const [day, value] of Object.entries(remote.timetable || {})) {
        const mine = draft.timetable[day];
        if (!mine || !Object.keys(mine).length) draft.timetable[day] = value;
        else if (unchangedSincePush(guard, 'timetable', { id: day, ...mine })) draft.timetable[day] = value;
    }
    rememberAllPulled(draft, remote, cloudHashes);
    if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    absorbSettings(draft, remote.settings);
    if (remote.profile?.className && !draft.profile.className) draft.profile.className = remote.profile.className;
    if (remote.profile?.classSize && !draft.profile.classSize) draft.profile.classSize = remote.profile.classSize;
    if ((remote.students || []).length || remote.profile?.className) {
        draft.profile.started = true;
        draft.profile.guest = false;
    }
    return draft;
}

export async function undo() {
    const prev = undoStack.pop();
    if (!prev) return false;
    const current = state;
    state = prev;
    mirrorTheme(state.profile.theme);
    emit();
    try {
        await persist();
    } catch (error) {
        undoStack.push(prev);
        state = current;
        mirrorTheme(state.profile.theme);
        emit();
        tellStorageIssue(error?.storageFailed ? error.message : storageIssueMessage(error));
        return false;
    }
    for (const bucket of CLOUD_BUCKETS) {
        const kept = new Set((prev[bucket] || []).map((row) => row?.id).filter(Boolean));
        for (const row of current[bucket] || []) {
            if (row?.id && !kept.has(row.id)) queueCloudForget(bucket, row.id, row);
        }
    }
    await flushCloud().catch(() => {});
    return true;
}

export function legacyAvailable() {
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (key && key.startsWith('homenote_') && key !== 'homenote_guest') return true;
        }
    } catch {
        return false;
    }
    return false;
}

export async function boot(query = '') {
    const params = new URLSearchParams(query || (typeof location === 'undefined' ? '' : location.search));
    if (params.get('at')) {
        const { freezeClock } = await import('./date.js');
        freezeClock(params.get('at'));
    }
    let stored = null;
    let local = null;
    try {
        stored = await mainVault.get('state');
        local = await localVault.get('state');
    } catch {
        memoryOnly = true;
    }
    state = emptyState();
    if (stored && typeof stored === 'object') state = { ...state, ...stored, local: state.local };
    if (local && typeof local === 'object') state.local = { ...state.local, ...local };
    try {
        const tips = JSON.parse(localStorage.getItem(TIP_KEY) || 'null');
        if (tips) state.tip = { ...state.tip, ...tips };
        if (localStorage.getItem(SHARED_KEY) === '1') state.profile.sharedPc = true;
        const savedTheme = localStorage.getItem(THEME_KEY);
        if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') state.profile.theme = savedTheme;
        /* 자료를 남기기로 하고 켠 공용 모드는 평소처럼 불러옵니다(로그인만 이 탭에 둡니다). */
        if (localStorage.getItem(SHARED_KEY) === '1' && localStorage.getItem(SHARED_KEEP_KEY) === '1') state.profile.sharedKeep = true;
        else if (localStorage.getItem(SHARED_KEY) === '1') {
            memoryOnly = true;
            const theme = state.profile.theme;
            state = emptyState();
            state.profile.theme = theme;
            state.profile.sharedPc = true;
        }
    } catch {
        /* 팁 저장이 없어도 됩니다. */
    }
    if (!memoryOnly) {
        try {
            const held = await inboxVault.get('items');
            if (Array.isArray(held)) state.inbox = held;
            const dropped = await inboxVault.get('dropped');
            inboxDropped = new Set(Array.isArray(dropped) ? dropped.map(String) : []);
        } catch {
            /* 정리함 칸이 없어도 할 일은 열립니다. */
        }
        try {
            const savedHashes = await mainVault.get('cloudHashes');
            if (savedHashes && typeof savedHashes === 'object') cloudHashes = savedHashes;
        } catch {
            /* 해시가 없어도 다시 올리면 됩니다. */
        }
    }
    if (!state.profile.started && params.get('demo') === '1' && !legacyAvailable()) {
        await loadDemo();
        return snapshot();
    }
    emit();
    await applyAttendDraft();
    return snapshot();
}

export async function loadDemo() {
    const demo = buildDemo(seoulParts());
    return update((draft) => ({
        ...draft,
        ...demo,
        profile: { ...draft.profile, ...demo.profile, theme: draft.profile.theme },
        tip: draft.tip,
        auth: draft.auth,
    }));
}

export async function beginGuest() {
    await update((draft) => {
        draft.profile.guest = true;
        draft.profile.started = draft.profile.started;
        return draft;
    });
}

export async function finishSetup({ className, rosterText, skip }) {
    const parsed = parseRoster(rosterText || '');
    const failed = await update((draft) => {
        draft.profile.started = true;
        draft.profile.guest = true;
        draft.profile.demo = false;
        if (className && className.trim()) draft.profile.className = className.trim().slice(0, 30);
        if (!skip && parsed.students.length) {
            draft.students = parsed.students.map((row) => ({
                id: `s${row.no}`,
                no: row.no,
                name: row.name,
                sex: row.sex || '',
                birthday: '',
                active: true,
                memo: '',
                source: 'app',
            }));
            draft.profile.classSize = parsed.students.length;
        }
        return draft;
    });
    if (failed?.storageFailed) return failed;
    return parsed;
}

function nid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function put(list, row) {
    const index = list.findIndex((item) => item.id === row.id);
    if (index >= 0) list[index] = row;
    else list.unshift(row);
}

function dropId(list, id) {
    return (list || []).filter((item) => item?.id !== id);
}

/**
 * 화면이 고치던 그 행(from)이 클라우드↔이 기기 사이를 옮겨 갈 때만 옛 자리의 같은 아이디를 지웁니다.
 * from 을 모르거나 같은 쪽에 남으면 반대쪽은 건드리지 않습니다(main과 같음). 숨은 이 기기 전용 행은 지우지 않습니다.
 */
function relocate(draft, bucket, row, local, from) {
    if (!draft.local) draft.local = {};
    if (!Array.isArray(draft[bucket])) draft[bucket] = [];
    if (!Array.isArray(draft.local[bucket])) draft.local[bucket] = [];
    if (local && from === 'cloud') draft[bucket] = dropId(draft[bucket], row.id);
    if (!local && from === 'local') draft.local[bucket] = dropId(draft.local[bucket], row.id);
    put(local ? draft.local[bucket] : draft[bucket], { ...row, source: row.source || 'app' });
    return draft;
}

export async function saveQuick(input, now = new Date()) {
    const text = String(input.text || '').trim();
    if (!text) return { ok: false, message: '한 줄만 적어도 남길 수 있어요.' };
    const parsed = parseNote(text, now);
    const tags = [...new Set([...(input.tags || []), ...parsed.tags])].filter(Boolean).slice(0, 10);
    const sensitive = parsed.sensitive || isSensitiveText(text, tags);
    const no = parsed.studentNo || input.no || 0;
    const clock = seoulParts(now);
    const date = input.date || parsed.detectedDate || clock.ymd;
    let message = '남겼어요.';
    const failed = await update((draft) => {
        const student = draft.students.find((row) => row.no === Number(no));
        const sid = student?.id || '';
        const kind = input.kind || '메모';
        const base = { source: 'app', at: now.toISOString() };
        const local = sensitive;
        if (['관찰', '상담', '보호자', '칭찬'].includes(kind)) {
            const chosen = tags.length ? tags : (kind === '관찰' ? ['학습'] : kind === '상담' ? ['교우'] : kind === '보호자' ? ['전화'] : []);
            const row = {
                ...base,
                id: nid('rec'),
                date,
                kind,
                sid,
                text,
                tags: chosen,
                neis: input.neis != null ? Boolean(input.neis) : kind === '관찰' || kind === '칭찬',
            };
            if (input.follow || (kind === '상담' && parsed.detectedDate && text.includes('다시'))) row.follow = input.follow || parsed.detectedDate;
            put(local ? draft.local.records : draft.records, row);
            message = student ? `${student.name} 기록에 넣었어요.` : '기록에 넣었어요.';
        } else if (kind === '할 일') {
            const row = { ...base, id: nid('todo'), title: stripTokens(text) || text, done: false, due: input.due != null ? input.due : (parsed.detectedDate || '') };
            put(local ? draft.local.todos : draft.todos, row);
            message = '할 일에 넣었어요.';
        } else if (kind === '일정') {
            const eventKind = ['학급', '학교', '휴일', '내 일정'].includes(input.eventKind) ? input.eventKind : '학급';
            const bits = [];
            if (input.memo) bits.push(String(input.memo));
            if (input.period) bits.push(input.periodEnd ? `${input.period}~${input.periodEnd}교시` : `${input.period}교시`);
            const row = {
                ...base,
                id: nid('event'),
                date,
                title: (stripTokens(text) || text).slice(0, 60),
                kind: eventKind,
                memo: bits.join(' · ').slice(0, 300),
            };
            if (input.time) row.time = input.time;
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endTime || '')) row.endTime = input.endTime;
            put(local ? draft.local.events : draft.events, row);
            message = '일정에 넣었어요.';
        } else if (kind === '알림장') {
            const prev = (local ? draft.local.notices : draft.notices).find((item) => item.date === date);
            const row = { ...base, id: date, date, text: prev ? `${prev.text}\n${text}` : text };
            put(local ? draft.local.notices : draft.notices, row);
            message = '알림장에 넣었어요.';
        } else {
            put(local ? draft.local.notes : draft.notes, { ...base, id: nid('note'), text, date, pinned: false });
            message = '메모로 남겼어요.';
        }
        return draft;
    }, { undoable: true });
    if (failed?.storageFailed) return { ok: false, storageFailed: true, message: failed.message };
    if (sensitive) message = `이 내용은 이 기기에만 남겨 둘게요. ${message}`;
    return { ok: true, message };
}

const CYCLE = ['결석', '지각', '조퇴', '결과'];
const EVENT_KINDS = ['학급', '학교', '휴일', '내 일정'];

/**
 * 메시지에서 고른 일정·할 일을 기존 put()으로 넣습니다.
 * 기기 기록의 source는 msg입니다. 클라우드 규칙이 app·legacy·file만 받으므로
 * 올릴 때는 기존 sourceOf가 app으로 바꿉니다. 아이디 msg… 는 그대로라 중복을 다시 막습니다.
 */
function inboxId(value) {
    const id = String(value || '').slice(0, 40);
    return /^[A-Za-z0-9_-]{1,40}$/.test(id) ? id : '';
}

function heldRow(item, now) {
    const id = inboxId(item.id);
    const title = String(item.title || '').trim().slice(0, 100);
    if (!id || !title) return null;
    const row = {
        id,
        kind: item.kind === '일정' ? '일정' : '할 일',
        title,
        date: item.date || '',
        warning: String(item.warning || '').slice(0, 120),
        at: now.toISOString(),
        source: 'msg',
    };
    if (item.time) row.time = item.time;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(item.endTime || '')) row.endTime = item.endTime;
    if (item.end) row.end = item.end;
    if (item.memo) row.memo = String(item.memo).slice(0, 300);
    if (EVENT_KINDS.includes(item.eventKind)) row.eventKind = item.eventKind;
    if (item.period) row.period = item.period;
    if (item.periodEnd) row.periodEnd = item.periodEnd;
    return row;
}

function blobOf(item) {
    return `${item.title || ''} ${item.memo || ''} ${item.warning || ''} ${item.raw || ''}`;
}

/**
 * 고른 항목은 할 일·일정에 넣고, 빼 둔 항목은 정리함(ssug-gyomu-inbox)에 둡니다.
 * 이미 등록된 아이디는 정리함으로 옮기지 않습니다.
 */
export async function saveParsed(items, now = new Date()) {
    const list = (items || []).filter((item) => item && String(item.title || '').trim());
    const chosen = list.filter((item) => item.include !== false);
    const held = list.filter((item) => item.include === false);
    if (!chosen.length && !held.length) return { ok: false, message: '등록할 항목이 없어요.', count: 0, held: 0 };
    let count = 0;
    let heldCount = 0;
    let skipped = 0;
    let sensitiveCount = 0;
    let filled = 0;
    const failed = await update((draft) => {
        if (!Array.isArray(draft.inbox)) draft.inbox = [];
        const registered = new Set([
            ...draft.todos, ...draft.local.todos, ...draft.events, ...draft.local.events,
        ].map((row) => row.id));
        const parked = new Set(draft.inbox.map((row) => row.id));
        for (const item of chosen) {
            if (!item.id || registered.has(item.id)) {
                skipped += 1;
                continue;
            }
            const blob = blobOf(item);
            const sensitive = isSensitiveText(blob);
            if (sensitive) sensitiveCount += 1;
            const base = { source: 'msg', at: now.toISOString(), id: String(item.id).slice(0, 40) };
            if (item.kind === '일정') {
                let date = item.date || '';
                if (!date) {
                    date = seoulYmd(now);
                    filled += 1;
                }
                const periodLabel = item.period ? (item.periodEnd ? `${item.period}~${item.periodEnd}교시` : `${item.period}교시`) : '';
                const memo = [item.memo, periodLabel && !String(item.memo || '').includes(periodLabel) ? periodLabel : ''].filter(Boolean).join(' · ');
                const row = {
                    ...base,
                    date,
                    title: String(item.title).trim().slice(0, 60),
                    kind: EVENT_KINDS.includes(item.eventKind) ? item.eventKind : '학급',
                    memo: memo.slice(0, 300),
                };
                if (item.time) row.time = item.time;
                if (/^([01]\d|2[0-3]):[0-5]\d$/.test(item.endTime || '')) row.endTime = item.endTime;
                if (item.end && item.end > date) row.end = item.end;
                put(sensitive ? draft.local.events : draft.events, row);
            } else {
                const title = item.time && !String(item.title).includes(item.time)
                    ? `${item.time} ${item.title}`.trim().slice(0, 100)
                    : String(item.title).trim().slice(0, 100);
                put(sensitive ? draft.local.todos : draft.todos, { ...base, title, done: false, due: item.date || '' });
            }
            registered.add(item.id);
            draft.inbox = draft.inbox.filter((row) => row.id !== item.id);
            count += 1;
        }
        for (const item of held) {
            const row = heldRow(item, now);
            if (!row || registered.has(row.id) || parked.has(row.id)) {
                skipped += 1;
                continue;
            }
            if (isSensitiveText(blobOf(item))) sensitiveCount += 1;
            draft.inbox.unshift(row);
            parked.add(row.id);
            heldCount += 1;
        }
        return draft;
    }, { undoable: true });
    if (failed?.storageFailed) return { ok: false, storageFailed: true, message: failed.message, count: 0, skipped, held: 0 };
    if (!count && !heldCount) {
        if (skipped) return { ok: false, message: '이미 등록한 내용이라 넣지 않았어요.', count: 0, skipped, held: 0 };
        return { ok: false, message: '등록할 항목이 없어요.', count: 0, skipped, held: 0 };
    }
    const parts = [];
    if (count) parts.push(`${count}개 등록했어요.`);
    if (heldCount) parts.push(`${heldCount}개는 정리함에 뒀어요.`);
    if (skipped) parts.push(`겹친 ${skipped}개는 이미 있어서 넣지 않았어요.`);
    if (filled) parts.push('날짜가 비어 있던 일정은 오늘로 넣었어요.');
    let message = parts.join(' ');
    if (sensitiveCount) message = `이 내용은 이 기기에만 남겨 둘게요. ${message}`;
    return { ok: true, message, count, skipped, held: heldCount, sensitiveCount };
}

export async function dropInbox(id) {
    const target = inboxId(id);
    if (!target) return { ok: false, message: '정리함에서 찾지 못했어요.' };
    const failed = await update((draft) => {
        draft.inbox = (draft.inbox || []).filter((row) => row.id !== target);
        return draft;
    }, { undoable: true });
    if (failed?.storageFailed) return { ok: false, storageFailed: true, message: failed.message };
    await rememberDropped(target);
    if (state.auth?.uid) {
        deleteUserDoc(state.auth.uid, 'inbox', target, { memoryOnly: memoryOnly || state.profile.sharedPc }).catch(() => {});
    }
    return { ok: true, message: '정리함에서 지웠어요.' };
}

export async function promoteInbox(id) {
    const target = inboxId(id);
    const item = (state.inbox || []).find((row) => row.id === target);
    if (!item) return { ok: false, message: '정리함에서 찾지 못했어요.', count: 0 };
    const result = await saveParsed([{ ...item, include: true }], new Date());
    if ((result.count || 0) > 0) {
        await rememberDropped(target);
        if (state.auth?.uid) {
            deleteUserDoc(state.auth.uid, 'inbox', target, { memoryOnly: memoryOnly || state.profile.sharedPc }).catch(() => {});
        }
    }
    return result;
}

/* 지운 줄의 클라우드 문서 id(공지는 날짜)로 삭제 대기열에 넣습니다. */
function forgetRow(bucket, row) {
    const shaped = row ? toCloudRow(bucket, row) : null;
    queueCloudForget(bucket, shaped?.id || row?.id, row);
}

/* 출석으로 되돌린 줄은 클라우드 문서도 지웁니다. 안 지우면 다음 받기에서 예전 결석·지각이 되살아납니다. */
function forgetAttendance(row) {
    const shaped = row ? toCloudRow('attendance', row) : null;
    if (shaped?.id) queueCloudForget('attendance', shaped.id, row);
}

/*
 * 출결 시트에서 적던 메모·서류: 입력하자마자(0.3초) 그리고 앱을 숨길 때 localStorage에 동기로 남깁니다.
 * 기기 저장소(IndexedDB)는 비동기라 앱을 닫는 순간 끝나지 않을 수 있어서, 다시 열 때 이것을 먼저 되살립니다.
 */
export const ATTEND_DRAFT_KEY = 'ssug-gyomu-attend-draft';
export function writeAttendDraft({ date, sid, status, note = '', paper = false, period = 0 }) {
    if (!date || !sid || !status || status === '출석') return false;
    try {
        globalThis.localStorage?.setItem(ATTEND_DRAFT_KEY, JSON.stringify({ u: draftOwner(), at: Date.now(), date, sid, status, note: String(note).slice(0, 2000), paper: Boolean(paper), period: Number(period) || 0 }));
        return true;
    } catch { return false; }
}
/* 이 기기 자료의 주인: 로그인 중이면 그 계정, 아니면 마지막으로 쓴 계정(앱을 막 열면 로그인 표시가 아직 비어 있습니다). */
function draftOwner() { return state.auth?.uid || lastCloudUid || ''; }
export function clearAttendDraft() {
    try { globalThis.localStorage?.removeItem(ATTEND_DRAFT_KEY); } catch { /* 없어도 됩니다. */ }
}
function readAttendDraft() {
    try {
        const d = JSON.parse(globalThis.localStorage?.getItem(ATTEND_DRAFT_KEY) || 'null');
        if (!d || typeof d !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || typeof d.sid !== 'string' || !d.sid || typeof d.status !== 'string') return null;
        return d;
    } catch { return null; }
}
/** 남은 임시본을 출결에 되살립니다. 다른 계정에서 적던 것은 버립니다. */
export async function applyAttendDraft() {
    const d = readAttendDraft();
    if (!d) return false;
    clearAttendDraft();
    if ((d.u || '') !== draftOwner()) return false;
    const row = state.attendance.find((r) => r.id === `${d.date}_${d.sid}`);
    if (row && row.status === d.status && (row.note || '') === d.note && Boolean(row.paper) === d.paper) return false;
    await setAttendance(d.date, d.sid, d.status, { note: d.note, paper: d.paper, ...(d.period ? { period: d.period } : {}) });
    /* 계정 자료면 올리기 전에 클라우드와 견줍니다: 다른 기기가 이 임시본보다 나중에 고쳤으면 그 값을 따릅니다. */
    if (d.u && Number(d.at) > 0) draftWatch = { uid: d.u, id: `${d.date}_${d.sid}`, at: Number(d.at), draft: d };
    return true;
}

let draftWatch = null;
/*
 * 되살린 임시 출결(앱을 닫을 때 남긴 것)이 다른 기기에서 더 나중에 고친 출결을 덮지 않게 합니다(PR #51 검수 3번).
 * 클라우드 문서의 서버 시각(updatedAt)이 임시본을 남긴 기기 시각보다 늦으면 클라우드 값을 따르고, 임시본은 'attendDraftReplaced'에 남깁니다.
 */
async function checkDraftAgainstCloud(uid) {
    const watch = draftWatch;
    if (!watch || watch.uid !== uid) return;
    draftWatch = null;
    let remote = null;
    try { remote = await cloudApi.pull(uid, { memoryOnly: memoryOnly || state.profile.sharedPc }); } catch { remote = null; }
    const cloudAt = Number(remote?.ats?.attendance?.[watch.id]) || 0;
    const theirs = (remote?.attendance || []).find((row) => row?.id === watch.id);
    if (!theirs || cloudAt <= watch.at) return;
    const mine = state.attendance.find((row) => row.id === watch.id);
    const d = watch.draft;
    /* 그 사이 이 기기에서 또 고쳤으면(임시본과 다르면) 그대로 둡니다. */
    if (!mine || mine.status !== d.status || (mine.note || '') !== d.note || Boolean(mine.paper) !== d.paper) return;
    if (!memoryOnly) await mainVault.set('attendDraftReplaced', { at: Date.now(), uid, draft: d }).catch(() => {});
    const mark = rowMark('attendance', theirs);
    await update((draft) => {
        const index = draft.attendance.findIndex((row) => row.id === watch.id);
        if (index >= 0) draft.attendance[index] = { ...draft.attendance[index], ...theirs };
        if (mark) cloudHashes[mark.key] = mark.mark;
        return draft;
    });
}

export async function setAttendance(date, sid, status, extra = {}) {
    return update((draft) => {
        const id = `${date}_${sid}`;
        const index = draft.attendance.findIndex((row) => row.id === id);
        if (!status || status === '출석') {
            if (index >= 0) forgetAttendance(draft.attendance.splice(index, 1)[0]);
        } else if (index >= 0) {
            draft.attendance[index] = {
                ...draft.attendance[index],
                status,
                reason: extra.reason ?? draft.attendance[index].reason ?? '',
                note: extra.note ?? draft.attendance[index].note ?? '',
                paper: extra.paper != null ? Boolean(extra.paper) : Boolean(draft.attendance[index].paper),
                period: extra.period != null ? extra.period : (draft.attendance[index].period || ''),
            };
        } else {
            draft.attendance.unshift({
                id, date, sid, status,
                reason: extra.reason || '',
                note: extra.note || '',
                paper: Boolean(extra.paper),
                period: extra.period || '',
                source: 'app',
            });
        }
        if (!draft.profile.checkedDates.includes(date)) draft.profile.checkedDates.push(date);
        return draft;
    }, { undoable: true });
}


export async function cycleAttendance(date, sid) {
    await update((draft) => {
        const id = `${date}_${sid}`;
        const index = draft.attendance.findIndex((row) => row.id === id);
        const current = index >= 0 ? draft.attendance[index].status : '';
        const next = CYCLE[(CYCLE.indexOf(current) + 1) % (CYCLE.length + 1)] || '';
        if (!next) {
            if (index >= 0) forgetAttendance(draft.attendance.splice(index, 1)[0]);
        } else if (index >= 0) draft.attendance[index] = { ...draft.attendance[index], status: next };
        else draft.attendance.unshift({ id, date, sid, status: next, reason: '', note: '', paper: false, source: 'app' });
        if (!draft.profile.checkedDates.includes(date)) draft.profile.checkedDates.push(date);
        return draft;
    }, { undoable: true });
}

export async function patchAttendance(date, sid, patch) {
    await update((draft) => {
        const id = `${date}_${sid}`;
        const index = draft.attendance.findIndex((row) => row.id === id);
        if (index < 0) return draft;
        draft.attendance[index] = { ...draft.attendance[index], ...patch };
        return draft;
    });
}

export async function markChecked(date, on) {
    await update((draft) => {
        const set = new Set(draft.profile.checkedDates);
        if (on) set.add(date);
        else set.delete(date);
        draft.profile.checkedDates = [...set];
        return draft;
    });
}

export async function toggleTodo(id) {
    await update((draft) => {
        const lists = [draft.todos, draft.local.todos];
        for (const list of lists) {
            const row = list.find((item) => item.id === id);
            if (row) row.done = !row.done;
        }
        return draft;
    }, { undoable: true });
}

export async function receiveOne(id, no) {
    await update((draft) => {
        const row = draft.todos.find((item) => item.id === id) || draft.local.todos.find((item) => item.id === id);
        if (!row?.pendingNos) return draft;
        row.pendingNos = row.pendingNos.filter((item) => item !== no);
        row.got = Math.max(0, (row.of || 0) - row.pendingNos.length);
        if (row.pendingNos.length === 0) row.done = true;
        return draft;
    });
}

/** from: 화면이 고치던 행이 'cloud'(클라우드)인지 'local'(이 기기)인지. 새 행이면 비워 둡니다. */
export async function saveTextItem(bucket, row, { from } = {}) {
    const text = String(row.text || '');
    const title = String(row.title || '');
    if (bucket === 'notes' && !text.trim() && !title.trim()) {
        return { ok: false, message: '한 줄만 적어도 남길 수 있어요.', sensitive: false };
    }
    const sensitive = isSensitiveText(text, row.tags) || isSensitiveText(title) || isSensitiveText(row.memo) || isSensitiveText(row.note) || isSensitiveText(row.attendees);
    const failed = await update((draft) => {
        relocate(draft, bucket, row, sensitive, from);
        return draft;
    }, { undoable: true });
    if (failed?.storageFailed) return { ok: false, storageFailed: true, message: failed.message, sensitive };
    return { sensitive };
}

export async function removeItem(bucket, id) {
    return update((draft) => {
        /* 지운 줄은 클라우드 문서도 지웁니다. 안 지우면 다음 받기에서 이 기기와 다른 기기 모두 되살아납니다(PR #52 검수 1번). */
        for (const item of draft[bucket] || []) if (item.id === id) forgetRow(bucket, item);
        draft[bucket] = (draft[bucket] || []).filter((item) => item.id !== id);
        if (draft.local[bucket]) draft.local[bucket] = draft.local[bucket].filter((item) => item.id !== id);
        return draft;
    }, { undoable: true });
}

/** 학사일정 한 학년도를 저장합니다. 빈 칸은 지웁니다. */
export async function saveAcademicYear(year, row) {
    return update((draft) => {
        const next = { ...(draft.profile.academic || {}), [String(year)]: row };
        draft.profile.academic = cleanAcademic(next);
        return draft;
    }, { undoable: true });
}

/**
 * 설정을 바꿉니다. 공용 컴퓨터 모드를 켜도 학급 자료는 기본으로 남깁니다.
 * { wipe: true }는 확인창에서 사용자가 '이 컴퓨터 자료 지우기'를 직접 골랐을 때만 넘깁니다.
 */
export async function patchProfile(patch, { wipe = false } = {}) {
    const wipeNow = patch.sharedPc === true && wipe === true;
    const next = patch.sharedPc === true ? { ...patch, sharedKeep: !wipeNow }
        : patch.sharedPc === false ? { ...patch, sharedKeep: false } : patch;
    const failed = await update((draft) => {
        draft.profile = { ...draft.profile, ...next };
        return draft;
    });
    if (failed?.storageFailed) return failed;
    if (wipeNow) {
        memoryOnly = true;
        try {
            await mainVault.remove('state');
            await localVault.remove('state');
            await inboxVault.remove('items');
            await inboxVault.remove('dropped');
            inboxDropped = new Set();
            await mainVault.remove('cloudHashes');
        } catch {
            /* 지우기를 고른 경우에만 이 컴퓨터에 기록을 남기지 않습니다. */
        }
    }
    if (patch.sharedPc === false) memoryOnly = false;
    /* 공용 컴퓨터 모드를 켜면 로그인을 이 탭에만 두고, 끄면 다시 브라우저에 남깁니다(이미 로그인해 있어도). */
    if (typeof patch.sharedPc === 'boolean') {
        try {
            const { setLoginPersistence } = persistenceHook ? { setLoginPersistence: persistenceHook } : await import('../firebase.js');
            await setLoginPersistence(patch.sharedPc);
        } catch { /* 로그인 모듈이 없으면(검사) 넘어갑니다. */ }
    }
}

let persistenceHook = null;
/** 검사용: 로그인 보관 방식을 바꾸는 함수를 가짜로 바꿉니다. */
export function usePersistenceForTest(fn = null) { persistenceHook = fn; }

export async function replaceRoster(text) {
    const parsed = parseRoster(text);
    if (!parsed.students.length && parsed.errors.length) return parsed;
    const failed = await update((draft) => {
        const old = new Map(draft.students.map((row) => [row.no, row]));
        draft.students = parsed.students.map((row) => ({
            id: old.get(row.no)?.id || `s${row.no}`,
            no: row.no,
            name: row.name,
            sex: row.sex || old.get(row.no)?.sex || '',
            birthday: old.get(row.no)?.birthday || '',
            active: true,
            memo: old.get(row.no)?.memo || '',
            source: old.get(row.no)?.source || 'app',
        }));
        draft.profile.classSize = parsed.students.length;
        return draft;
    });
    if (failed?.storageFailed) return failed;
    return parsed;
}

export async function setTimetable(day, period, subject, specialist) {
    /* 9·10교시는 서버 규칙(p1~p8) 밖이라 이 기기에만 둡니다. */
    if (period > 8) {
        setExtraPeriod(day, period, subject, specialist);
        return null;
    }
    return update((draft) => {
        const table = { ...draft.timetable };
        const before = { ...(table[day] || {}) };
        const row = { ...before };
        if (subject != null) row[`p${period}`] = subject;
        if (specialist != null) row[`s${period}`] = specialist;
        table[day] = row;
        /* 요일 기본 시간표를 고치면, 학기에 채워 둔 날짜 가운데 그날 따로 고치지 않은 앞으로의 날도 같이 바꿉니다. */
        if (/^(mon|tue|wed|thu|fri)$/.test(day)) {
            const edited = draft.profile.ttEdited || [];
            const today = todayYmdForTable();
            for (const [key, value] of Object.entries(table)) {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(key) || key < today || edited.includes(key) || dayKeyFromYmd(key) !== day) continue;
                const next = { ...value };
                for (const field of [`p${period}`, `s${period}`]) {
                    if ((value[field] || '') !== (before[field] || '')) continue;
                    if (row[field]) next[field] = row[field];
                    else delete next[field];
                }
                table[key] = next;
            }
        }
        draft.timetable = table;
        return draft;
    });
}

function todayYmdForTable() {
    return seoulYmd();
}

/** 학기·1년 채우기. rows는 날짜별 줄, overwrite 가 참이면 그날 고친 표시도 지웁니다. */
export async function applyTermTimetable(rows, { overwrite = false } = {}) {
    return update((draft) => {
        const table = { ...draft.timetable };
        for (const [day, row] of Object.entries(rows || {})) table[day] = { ...row };
        draft.timetable = table;
        if (overwrite) {
            const done = new Set(Object.keys(rows || {}));
            draft.profile.ttEdited = (draft.profile.ttEdited || []).filter((day) => !done.has(day));
        }
        return draft;
    }, { undoable: true });
}

/** 그날 시간표만 고칩니다. 기본 시간표를 다시 넣어도 이 날은 지켜집니다. */
export async function setDayTimetable(ymd, period, subject, specialist) {
    return update((draft) => {
        const table = { ...draft.timetable };
        const own = table[ymd];
        const edited = draft.profile.ttEdited || [];
        const base = own && (Object.keys(own).length || edited.includes(ymd)) ? own : (table[dayKeyFromYmd(ymd)] || {});
        const row = { ...base };
        if (subject != null) { if (subject) row[`p${period}`] = subject; else delete row[`p${period}`]; }
        if (specialist != null) { if (specialist) row[`s${period}`] = specialist; else delete row[`s${period}`]; }
        table[ymd] = row;
        draft.timetable = table;
        if (!edited.includes(ymd)) draft.profile.ttEdited = [...edited, ymd].sort();
        return draft;
    });
}

/** 그날 고친 것을 버리고 요일 기본 시간표로 돌립니다. */
export async function resetDayTimetable(ymd) {
    return update((draft) => {
        const table = { ...draft.timetable };
        table[ymd] = { ...(table[dayKeyFromYmd(ymd)] || {}) };
        draft.timetable = table;
        draft.profile.ttEdited = (draft.profile.ttEdited || []).filter((day) => day !== ymd);
        return draft;
    });
}

export function previewLegacy(titles) {
    if (!legacyAvailable()) return null;
    const bag = readLegacyStorage(localStorage);
    return planMigration(bag, { titles, now: new Date() });
}

export async function applyLegacy(plan) {
    const kept = await update((draft) => {
        draft.local.backup = plan.backup;
        return draft;
    });
    if (kept?.storageFailed) return kept;
    const fileDate = seoulYmd();
    downloadJson(`교무수첩-원본백업-${fileDate}.json`, plan.backup.payload);
    const moved = await update((draft) => {
        const merge = (current, incoming) => {
            const map = new Map((current || []).map((item) => [item.id, item]));
            for (const item of incoming || []) map.set(item.id, item);
            return [...map.values()];
        };
        draft.students = merge(draft.students, plan.students);
        draft.records = merge(draft.records, plan.records);
        draft.attendance = merge(draft.attendance, plan.attendance);
        draft.events = merge(draft.events, plan.events);
        draft.todos = merge(draft.todos, plan.todos);
        draft.notes = merge(draft.notes, plan.notes);
        draft.notices = merge(draft.notices, plan.notices);
        draft.legacyPages = merge(draft.legacyPages, plan.legacyPages);
        draft.timetable = { ...draft.timetable, ...plan.timetable };
        draft.local.records = merge(draft.local.records, plan.local.records);
        draft.local.notes = merge(draft.local.notes, plan.local.notes);
        draft.local.events = merge(draft.local.events, plan.local.events);
        draft.local.todos = merge(draft.local.todos, plan.local.todos);
        draft.local.notices = merge(draft.local.notices, plan.local.notices);
        draft.local.contacts = merge(draft.local.contacts, plan.local.contacts);
        draft.local.pages = merge(draft.local.pages, plan.local.pages);
        draft.local.backup = plan.backup;
        draft.profile.started = true;
        draft.profile.migratedAt = plan.at;
        draft.profile.migration = { counts: plan.counts, summary: plan.summary, conflicts: plan.conflicts, at: plan.at };
        if (!draft.profile.classSize) draft.profile.classSize = plan.students.length;
        draft.profile.migrateLater = false;
        return draft;
    });
    return moved?.storageFailed ? moved : null;
}

export async function forgetLegacyImports() {
    return update((draft) => {
        const keep = (list) => (list || []).filter((item) => item.source !== 'legacy' && item.source !== 'legacy-conflict');
        draft.students = keep(draft.students);
        draft.records = keep(draft.records);
        draft.attendance = keep(draft.attendance);
        draft.events = keep(draft.events);
        draft.todos = keep(draft.todos);
        draft.notes = keep(draft.notes);
        draft.notices = keep(draft.notices);
        draft.legacyPages = keep(draft.legacyPages);
        draft.local.records = keep(draft.local.records);
        draft.local.notes = keep(draft.local.notes);
        draft.local.events = keep(draft.local.events);
        draft.local.todos = keep(draft.local.todos);
        draft.local.notices = keep(draft.local.notices);
        draft.local.contacts = keep(draft.local.contacts);
        draft.local.pages = keep(draft.local.pages);
        draft.profile.migratedAt = null;
        draft.profile.migration = null;
        return draft;
    });
}

export function exportFile(includeLocal) {
    const data = buildExport(state, { includeLocal, at: new Date().toISOString() });
    downloadJson(`쨈 교무수첩-${seoulYmd()}.json`, data);
    return data;
}

export function downloadOriginal() {
    if (!state.local.backup?.payload) return false;
    downloadJson(`교무수첩-원본백업-${seoulYmd()}.json`, state.local.backup.payload);
    return true;
}

function applyIncoming(draft, data, sensitive, mode) {
    const merge = (current, incoming) => {
        if (mode === 'replace') return incoming || [];
        const map = new Map((current || []).map((item) => [item.id, item]));
        for (const item of incoming || []) map.set(item.id, item);
        return [...map.values()];
    };
    draft.students = merge(draft.students, data.students);
    draft.attendance = merge(draft.attendance, data.attendance);
    draft.records = merge(draft.records, sensitive.cloud);
    draft.events = merge(draft.events, data.events);
    draft.todos = merge(draft.todos, data.todos);
    draft.notes = merge(draft.notes, data.notes);
    draft.notices = merge(draft.notices, data.notices);
    if (Array.isArray(data.inbox)) draft.inbox = merge(draft.inbox, data.inbox);
    dropRegisteredInbox(draft);
    draft.legacyPages = merge(draft.legacyPages, data.legacy);
    draft.timetable = mode === 'replace' ? (data.timetable || {}) : { ...draft.timetable, ...(data.timetable || {}) };
    if (data.profile?.className) draft.profile.className = data.profile.className;
    if (data.profile?.periodStarts) draft.profile.periodStarts = data.profile.periodStarts;
    draft.local.records = merge(draft.local.records, [...(data.local?.records || []), ...sensitive.local]);
    draft.profile.started = true;
    draft.profile.classSize = draft.students.length || draft.profile.classSize;
    return draft;
}

async function restoreState(previous) {
    state = previous;
    mirrorTheme(state.profile.theme);
    emit();
    try {
        await persist();
    } catch {
        /* 화면에는 원래 기록이 남아 있습니다. */
    }
}

export async function importText(text, mode, hooks = {}) {
    const checked = validateBackupText(text);
    if (!checked.ok) return checked;
    if (checked.kind === 'legacy') {
        const plan = planMigration(oldBackupToBag(checked.data), { now: new Date() });
        const moved = await applyLegacy(plan);
        if (moved?.storageFailed) return { ok: false, errors: [moved.message] };
        return { ok: true, kind: 'legacy', summary: plan.summary };
    }
    const data = checked.data;
    const sensitive = splitSensitive(data.records || []);
    if (mode !== 'replace') {
        const failed = await update((draft) => applyIncoming(draft, data, sensitive, mode));
        if (failed?.storageFailed) return { ok: false, errors: [failed.message] };
        return { ok: true, kind: 'ssug-gyomu', localOnly: sensitive.local.length };
    }
    let previous;
    try {
        previous = structuredClone(state);
        const exportedAt = new Date().toISOString();
        const payload = buildExport(state, { includeLocal: true, at: exportedAt });
        JSON.stringify(payload);
        downloadJson(`쨈 교무수첩-바꾸기전-${seoulYmd()}.json`, payload);
        await hooks.onPhase?.('prepared');
        const next = structuredClone(state);
        next.local.backup = { exportedAt, payload };
        applyIncoming(next, data, sensitive, 'replace');
        await hooks.onPhase?.('ready', next);
        state = next;
        mirrorTheme(state.profile.theme);
        emit();
        await persist();
        flushCloud().catch(() => {});
        await hooks.onPhase?.('applied');
    } catch (error) {
        if (previous) await restoreState(previous);
        if (error?.storageFailed) return { ok: false, errors: [error.message] };
        return { ok: false, errors: ['기록을 바꾸지 못해 원래대로 돌려 두었어요.'] };
    }
    return { ok: true, kind: 'ssug-gyomu', localOnly: sensitive.local.length };
}

/* 계정마다 따로 두는 자료. 기기 설정(테마·공용 PC 등)은 기기 것이라 그대로 둡니다. */
const ACCOUNT_PARTS = ['students', 'attendance', 'records', 'events', 'todos', 'notes', 'notices', 'timetable', 'legacyPages', 'inbox'];
const ACCOUNT_PROFILE = ['className', 'schoolYear', 'classSize', 'periodStarts', 'ttEdited', 'academic', 'settingsAts', 'settingsAt', 'checkedDates'];
const accountKey = (uid) => `account:${uid}`;

/**
 * 계정을 바꿀 때: 지금 자료(아직 안 올린 변경 포함)와 해시를 이전 계정 몫으로 보관하고,
 * 새 계정의 보관본이 있으면 되살리고 없으면 비운 뒤 새 계정 자료를 받아 옵니다. 보관에 실패하면 아무것도 바꾸지 않습니다.
 */
async function switchAccountLocal(from, to) {
    clearAttendDraft();
    draftWatch = null;
    const empty = emptyState();
    const pack = {
        data: Object.fromEntries(ACCOUNT_PARTS.map((part) => [part, structuredClone(state[part] ?? empty[part])])),
        profile: Object.fromEntries(ACCOUNT_PROFILE.filter((name) => name in state.profile).map((name) => [name, structuredClone(state.profile[name])])),
        hashes: structuredClone(cloudHashes || {}),
        /* 임시 회의록도 계정 몫입니다(다른 계정 화면에 보이지 않게). */
        drafts: readDrafts(),
    };
    const local = structuredClone(state.local || empty.local);
    let saved;
    let savedLocal;
    if (!memoryOnly) {
        try {
            await mainVault.set(accountKey(from), pack);
            await localVault.set(accountKey(from), local);
            saved = await mainVault.get(accountKey(to));
            savedLocal = await localVault.get(accountKey(to));
        } catch (error) {
            tellStorageIssue(storageIssueMessage(error));
            return false;
        }
    } else {
        memoryStash.set(from, { pack, local });
        ({ pack: saved, local: savedLocal } = memoryStash.get(to) || {});
    }
    /* update()를 쓰지 않습니다: 설정 칸 시각을 새로 찍으면 바뀐 계정의 클라우드 설정을 덮을 수 있습니다. */
    const previousState = state;
    const draft = structuredClone(state);
    {
        for (const part of ACCOUNT_PARTS) draft[part] = structuredClone(saved?.data?.[part] ?? empty[part]);
        for (const name of ACCOUNT_PROFILE) {
            if (saved?.profile && name in saved.profile) draft.profile[name] = structuredClone(saved.profile[name]);
            else if (name in empty.profile) draft.profile[name] = structuredClone(empty.profile[name]);
            else delete draft.profile[name];
        }
        draft.local = structuredClone(savedLocal || empty.local);
    }
    state = draft;
    emit();
    try {
        await persist();
    } catch (error) {
        state = previousState;
        emit();
        tellStorageIssue(error?.storageFailed ? error.message : storageIssueMessage(error));
        return false;
    }
    undoStack = [];
    writeDrafts(saved?.drafts ?? null);
    cloudHashes = structuredClone(saved?.hashes || {});
    if (!memoryOnly) {
        await mainVault.set('cloudHashes', cloudHashes).catch(() => {});
        /* 되살린 보관본은 이제 화면 자료가 되었으므로 지웁니다(다음 전환 때 다시 만듭니다). */
        if (saved) await mainVault.remove(accountKey(to)).catch(() => {});
        if (savedLocal) await localVault.remove(accountKey(to)).catch(() => {});
    } else memoryStash.delete(to);
    return true;
}
const memoryStash = new Map();

function readDrafts() {
    try { return globalThis.localStorage?.getItem(MINUTES_DRAFT_KEY) ?? null; } catch { return null; }
}
function writeDrafts(value) {
    try {
        if (typeof value === 'string' && value) globalThis.localStorage?.setItem(MINUTES_DRAFT_KEY, value);
        else globalThis.localStorage?.removeItem(MINUTES_DRAFT_KEY);
    } catch { /* 저장 공간이 없으면 넘어갑니다. */ }
}

/* 보관에 실패하면 로그아웃합니다. 화면에는 이전 계정 자료가 남으므로, 새 계정으로 올리거나 지우지 않게 합니다. */
async function leaveAfterFailedSwitch() {
    try {
        const { signOutFirebase } = signOutHook ? { signOutFirebase: signOutHook } : await import('../firebase.js');
        await signOutFirebase();
    } catch { /* 로그인 모듈이 없으면(검사) 로그인 표시만 비웁니다. */ }
}

async function connectCloud(uid) {
    syncBegin();
    let ok = false;
    try {
        ok = await connectCloudBody(uid);
    } finally {
        syncEnd({ ok, pull: true, pending: ok ? 0 : undefined });
    }
}

/* 다 올리고 받아 합쳤으면 true. */
async function connectCloudBody(uid) {
    await checkDraftAgainstCloud(uid);
    await settleTodoEdits(uid);
    const pushed = await flushCloud().catch(() => null);
    const seen = { ...cloudHashes };
    const remote = await cloudApi.pull(uid, { memoryOnly: memoryOnly || state.profile.sharedPc });
    if (!remote) return false;
    const hasRemote = remote.settings || remote.profile?.className || ['students', 'records', 'inbox', 'todos', 'events', 'attendance', 'notes', 'notices'].some((name) => (remote[name] || []).length) || Object.keys(remote.timetable || {}).length;
    if (!hasRemote) {
        /* 클라우드가 비었어도(다른 기기에서 마지막 줄까지 지움) 올린 그대로인 줄은 지웁니다(PR #52 2차 검수 1번). */
        await updateFromCloud((draft) => pruneOnly(draft, remote, seen));
        const ok = pushedAll(pushed) && remote.fresh !== false;
        if (ok) markSynced(uid);
        return ok;
    }
    await updateFromCloud((draft) => absorbCloud(draft, remote, seen));
    /* 올리기가 다 끝나고 서버에서 받아 왔어야 '동기화됨'입니다. 못 올린 게 있거나 캐시에서 온 옛 목록이면 시각을 바꾸지 않습니다(PR #52 검수 4번, 10/31 제보). */
    const ok = pushedAll(pushed) && remote.fresh !== false;
    if (ok) markSynced(uid);
    return ok;
}

/*
 * 할 일은 항목마다 더 늦게 고친 쪽이 이깁니다. 올리기 전에, 이 기기에서 고친 뒤 아직 못 올린 할 일이 있으면
 * 클라우드 시각(updatedAt)을 먼저 보고 다른 기기가 더 늦게 고친 항목은 그쪽 값을 받습니다. 그래야 옛 수정이 새 수정을 덮지 않습니다.
 * 한쪽에만 있는 항목·지운 항목은 여기서 건드리지 않습니다(합치기·지운 시각 비교는 받기와 지우기 대기열에서).
 */
async function settleTodoEdits(uid) {
    const dirty = (state.todos || []).filter((row) => row?.id && toCloudRow('todos', row) && !unchangedSincePush(cloudHashes, 'todos', row));
    if (!dirty.length) return;
    let remote = null;
    try { remote = await cloudApi.pull(uid, { memoryOnly: memoryOnly || state.profile.sharedPc }); } catch { return; }
    const ats = remote?.ats?.todos || {};
    const byId = new Map((remote?.todos || []).filter((row) => row?.id).map((row) => [String(row.id), row]));
    if (!dirty.some((row) => byId.has(String(row.id)) && remoteIsLater(row, ats[String(row.id)]))) return;
    await updateFromCloud((draft) => {
        draft.todos = (draft.todos || []).map((row) => {
            const other = row?.id ? byId.get(String(row.id)) : null;
            if (!other || unchangedSincePush(cloudHashes, 'todos', row) || !remoteIsLater(row, ats[String(row.id)])) return row;
            return { ...takeRemote('todos', row, other), editAt: ats[String(row.id)] };
        });
        return draft;
    });
}

function pushedAll(result) {
    return Boolean(result) && !result.skipped && !result.pending && result.ok !== false && !(result.rejected || []).length;
}

const LAST_SYNC_KEY = 'ssug-gyomu-last-sync';
/** 마지막으로 클라우드에서 받아 온 시각(ms). 없으면 0. */
/* 계정마다 따로 적습니다(다른 계정의 시각이 보이지 않게). */
export function lastSyncAt(uid = state.auth?.uid) {
    if (!uid) return 0;
    try { return Number(JSON.parse(localStorage.getItem(LAST_SYNC_KEY) || '{}')?.[uid]) || 0; } catch { return 0; }
}
function markSynced(uid) {
    if (!uid) return;
    try {
        let all = {};
        try { all = JSON.parse(localStorage.getItem(LAST_SYNC_KEY) || '{}') || {}; } catch { all = {}; }
        if (typeof all !== 'object' || Array.isArray(all)) all = {};
        all[uid] = Date.now();
        localStorage.setItem(LAST_SYNC_KEY, JSON.stringify(all));
    } catch { /* 공간이 없으면 표시만 못 합니다. */ }
    emit();
}

const BEFORE_PULL_KEY = 'beforeCloudPull';
/** '클라우드에서 다시 받기' 직전에 남긴 이 기기 자료(되돌릴 때 씁니다). */
export async function readBeforePull() {
    try { return await mainVault.get(BEFORE_PULL_KEY); } catch { return null; }
}

/*
 * 설정의 '클라우드에서 다시 받기': 이 기기를 클라우드 최신 상태로 맞춥니다. 자료를 잃지 않게
 * ① 아직 안 올린 변경을 먼저 올리고(하나라도 못 올리면 멈춤) ② 지금 이 기기 자료를 통째로 보관한 뒤
 * ③ 클라우드에 있는 줄은 클라우드 값으로, 클라우드가 거절한 줄은 그대로 두고, 다른 기기에서 지운 줄만 뺍니다.
 */
export async function pullFromCloudNow() {
    const uid = state.auth?.uid;
    if (!uid || !cloudApi.available()) return { ok: false, reason: 'login' };
    try { await connectTask?.promise; } catch { /* 이어서 올리기에서 다시 봅니다. */ }
    let pushed;
    try { pushed = await flushCloud(); } catch { pushed = null; }
    if (!pushed || pushed.skipped || pushed.pending || pushed.ok === false) return { ok: false, reason: 'push' };
    const rejected = new Set(pushed.rejected || []);
    let remote;
    try { remote = await cloudApi.pull(uid, { memoryOnly: memoryOnly || state.profile.sharedPc }); } catch { remote = null; }
    if (!remote) return { ok: false, reason: 'pull' };
    if (state.auth?.uid !== uid) return { ok: false, reason: 'login' };
    if (!memoryOnly) {
        try {
            await mainVault.set(BEFORE_PULL_KEY, { at: Date.now(), uid, data: structuredClone({ ...state, auth: null }) });
        } catch {
            return { ok: false, reason: 'backup' };
        }
    }
    let dropped = 0;
    const failed = await updateFromCloud((draft) => {
        for (const [localName, cloudName] of CLOUD_COLLECTIONS) {
            const remoteRows = localName === 'inbox' ? withoutDropped(remote.inbox) : (remote[localName] || []).filter((row) => !forgetQueuedFor(uid, `${cloudName}/${row?.id}`));
            const ids = remote.ids?.[cloudName];
            const byId = new Map(remoteRows.filter((row) => row?.id).map((row) => [String(row.id), row]));
            const next = [];
            for (const row of draft[localName] || []) {
                const theirs = row?.id ? byId.get(String(row.id)) : null;
                const mark = rowMark(cloudName, row);
                if (theirs) {
                    byId.delete(String(row.id));
                    /* 올린 그대로인 줄만 클라우드 값으로 바꿉니다. 거절된 줄·올릴 수 없는 줄·그 사이 고친 줄은 이 기기 값을 지킵니다. */
                    const synced = mark && !rejected.has(mark.key) && cloudHashes[mark.key] === mark.mark;
                    /* 할 일은 양쪽에서 고쳤으면 더 늦게 고친 쪽이 이깁니다(클라우드 updatedAt ↔ 이 기기 editAt). */
                    const later = !synced && cloudName === 'todos' && mark && !rejected.has(mark.key) && remoteIsLater(row, remote.ats?.todos?.[String(row.id)]);
                    next.push(synced || later ? withRemoteAt(cloudName, takeRemote(cloudName, row, theirs), remote) : row);
                    continue;
                }
                /* 클라우드 목록이 서버에서 온 게 아니거나(캐시), 올릴 수 없는 줄·거절된 줄·한 번도 클라우드에 닿지 않은 줄은 지우지 않습니다. */
                if (!Array.isArray(ids) || !mark || rejected.has(mark.key) || !cloudHashes[mark.key]) { next.push(row); continue; }
                dropped += 1;
                delete cloudHashes[mark.key];
            }
            next.push(...[...byId.values()].map((row) => withRemoteAt(cloudName, row, remote)));
            draft[localName] = next;
        }
        for (const [day, value] of Object.entries(remote.timetable || {})) draft.timetable[day] = value;
        absorbSettings(draft, remote.settings);
        if (remote.profile?.className) draft.profile.className = remote.profile.className;
        if (remote.profile?.classSize) draft.profile.classSize = remote.profile.classSize;
        rememberAllPulled(draft, remote, cloudHashes);
        if ((remote.students || []).length || remote.profile?.className) { draft.profile.started = true; draft.profile.guest = false; }
        return draft;
    });
    if (failed?.storageFailed) return { ok: false, reason: 'save' };
    if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    markSynced(uid);
    return { ok: true, dropped };
}

let lastRefresh = 0;
/** 앱으로 돌아오거나 창을 다시 볼 때 다른 기기에서 고친 것을 받아 옵니다(1분에 한 번까지). */
export async function refreshFromCloud({ force = false } = {}) {
    const uid = state.auth?.uid;
    if (!uid || !cloudApi.available() || connectTask?.uid !== uid) return { skipped: true };
    const now = Date.now();
    if (!force && now - lastRefresh < 60000) return { skipped: true };
    lastRefresh = now;
    try {
        await connectTask.promise;
        await connectCloud(uid);
        return { ok: true };
    } catch {
        return { ok: false };
    }
}

export async function setAuth(auth) {
    const next = auth?.uid ? { uid: auth.uid, name: auth.name || '', email: auth.email || '' } : null;
    const from = lastCloudUid;
    /* 다른 계정으로 바뀌면 먼저 로그인 표시를 비워(이전 계정 자료가 새 계정으로 올라가지 않게) 자료를 계정별로 바꿔 둡니다. */
    const switching = Boolean(next?.uid && from && from !== next.uid);
    if (switching) {
        state = { ...state, auth: null };
        connectTask = null;
        const moved = await switchAccountLocal(from, next.uid);
        if (!moved) {
            /*
             * 보관에 실패하면 자료를 그대로 두고 로그아웃 상태로 남깁니다. 로그인 표시를 새 계정으로 두면
             * 이전 계정 자료를 고치거나 지운 것이 새 계정 몫으로 올라가거나 지워집니다(4차 검수 1번).
             */
            state = { ...state, auth: null };
            emit();
            tellStorageIssue('저장 공간이 부족해 계정을 바꾸지 못했어요. 이전 계정 자료를 지키려고 로그아웃했어요. 공간을 비운 뒤 다시 로그인해 주세요.');
            await leaveAfterFailedSwitch();
            return { switched: false };
        }
    }
    state = { ...state, auth: next };
    if (next) state.profile.guest = false;
    if (next?.uid) rememberCloudUid(next.uid);
    /* 동기화 칩: 로그인 여부를 알았고, 이 계정의 마지막 동기화 시각과 지우기 대기열 수를 알려 줍니다. */
    syncAuthKnown();
    if (next?.uid) syncSeen(lastSyncAt(next.uid));
    syncQueued(queuedCloudKeys().length);
    emit();
    if (!next?.uid) {
        connectTask = null;
        return;
    }
    if (connectTask?.uid === next.uid) return connectTask.promise;
    const promise = connectCloud(next.uid).catch(() => {});
    connectTask = { uid: next.uid, promise };
    return promise;
}

export async function clearAll() {
    const failed = await update((draft) => {
        const theme = draft.profile.theme;
        const next = emptyState();
        next.profile.theme = theme;
        next.tip = { hidden: [], seen: [], closes: {}, snooze: '' };
        return next;
    });
    if (failed?.storageFailed) return failed;
    try {
        await mainVault.remove('state');
        await localVault.remove('state');
        await inboxVault.remove('items');
        await inboxVault.remove('dropped');
    } catch {
        /* 이미 메모리만 쓰는 경우입니다. */
    }
    inboxDropped = new Set();
}

export async function saveTip(tip) {
    return update((draft) => {
        draft.tip = tip;
        return draft;
    });
}

export function joinedRecords(current = state) {
    return [
        ...current.records.map((row) => ({ ...row, localOnly: false })),
        ...current.local.records.map((row) => ({ ...row, localOnly: true })),
    ];
}

export function joined(current, bucket) {
    return [
        ...(current[bucket] || []).map((row) => ({ ...row, localOnly: false })),
        ...(current.local?.[bucket] || []).map((row) => ({ ...row, localOnly: true })),
    ];
}
