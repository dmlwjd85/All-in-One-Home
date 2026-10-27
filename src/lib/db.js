import { createVault } from './idb.js';
import { DEFAULT_PERIODS } from './period.js';
import { buildDemo } from './demo.js';
import { parseNote, stripTokens } from './parse.js';
import { isSensitiveText } from './sensitive.js';
import { buildExport, downloadJson, splitSensitive, validateBackupText, oldBackupToBag } from './backup.js';
import { planMigration, readLegacyStorage } from './migrate.js';
import { cloudMark, deleteUserDoc, pullUserData, pushUserData, syncAvailable } from './cloud.js';
import {
    SYNC_BUCKETS, diffCloudRows, drainQueue, forgottenIds, keyOf, mergeBucket, mergeTimetable,
    normalizeQueue, queueAdd, queueDropPresent, shouldRefresh, stampList, stampTimetable,
} from './sync.js';
import { syncAuthKnown, syncBegin, syncEnd, syncQueued } from './syncStatus.js';
import { seoulParts, seoulYmd } from './date.js';
import { parseRoster } from './roster.js';

let mainVault = createVault('ssug-gyomu');
let localVault = createVault('ssug-gyomu-local');
let inboxVault = createVault('ssug-gyomu-inbox');
let inboxDropped = new Set();
const THEME_KEY = 'ssug-gyomu-theme';
const TIP_KEY = 'ssug-gyomu-tips';
const SHARED_KEY = 'ssug-gyomu-shared';

export function emptyState() {
    return {
        profile: {
            className: '',
            schoolYear: 2026,
            classSize: 0,
            periodStarts: [...DEFAULT_PERIODS],
            theme: 'system',
            sharedPc: false,
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
/** 클라우드에서 아직 못 지운 문서 목록. ssug-gyomu 저장소의 cloudForget 키에 둡니다. */
let forgetQueue = [];
/** 이 계정 클라우드에서 본 적 있는 문서 키. 다른 기기에서 지운 것을 알아볼 때만 씁니다. */
let cloudSeen = { uid: '', keys: new Set() };
/** 이 기기가 고친 시각을 적기 시작한 때. 그 전 기록은 시각이 없어도 안전하게 다룹니다. */
let syncSince = 0;
let lastRefreshAt = 0;
let refreshTask = null;

function emit() {
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

/** 바뀐 줄에 고친 시각을 붙입니다. 클라우드에는 올리지 않는 기기용 칸이에요(toCloudRow가 고른 칸만 올라갑니다). */
function stampEdits(previous, next, { force = false } = {}) {
    if (!next || typeof next !== 'object') return next;
    const now = new Date().toISOString();
    for (const [localName] of SYNC_BUCKETS) {
        if (Array.isArray(next[localName])) next[localName] = stampList(previous?.[localName], next[localName], now, { force });
    }
    if (next.timetable && typeof next.timetable === 'object') {
        const stamps = stampTimetable(previous?.timetable, next.timetable, next.syncMeta?.timetable, now);
        if (Object.keys(stamps).length) next.syncMeta = { ...(next.syncMeta || {}), timetable: stamps };
    }
    return next;
}

/** 지운 줄은 대기열에, 다시 생긴 줄은 대기열에서 뺍니다. 로그인한 계정 것만 다룹니다. */
function planForget(previous, next, syncDeletes) {
    const signedIn = next?.auth?.uid || previous?.auth?.uid || '';
    // 로그인이 아직 돌아오지 않았을 때는 이 기기가 마지막으로 맞춘 계정에, 그 계정에서 본 문서만 넣습니다.
    const uid = signedIn || cloudSeen.uid || '';
    if (!uid) return null;
    let { gone, present } = diffCloudRows(previous, next);
    if (!signedIn) gone = gone.filter((item) => cloudSeen.keys.has(keyOf(item.name, item.id)));
    let queue = queueDropPresent(forgetQueue, present, uid);
    if (syncDeletes && gone.length) queue = queueAdd(queue, gone, uid);
    const changed = queue.length !== forgetQueue.length || queue.some((item, index) => item !== forgetQueue[index]);
    if (!changed) return null;
    return { queue, gone: syncDeletes ? gone : [] };
}

async function saveForget(queue) {
    forgetQueue = queue;
    syncQueued(forgetQueue.filter((item) => item.uid === state.auth?.uid).length);
    if (memoryOnly) return;
    await mainVault.set('cloudForget', forgetQueue);
}

/** 지운 문서는 다시 올릴 수 있게 지문과 '본 적 있음' 표시를 지웁니다. */
function forgetMarks(entries = []) {
    let touched = false;
    for (const { name, id } of entries) {
        const key = keyOf(name, id);
        if (key in cloudHashes) {
            delete cloudHashes[key];
            touched = true;
        }
        cloudSeen.keys.delete(key);
    }
    if (touched && !memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
}

export async function update(recipe, { undoable = false, syncDeletes = false } = {}) {
    const previous = structuredClone(state);
    if (undoable) undoStack = [...undoStack.slice(-4), previous];
    const next = stampEdits(previous, recipe(structuredClone(state)) || state);
    const forget = planForget(previous, next, syncDeletes);
    const previousQueue = forgetQueue;
    state = next;
    mirrorTheme(state.profile.theme);
    emit();
    try {
        if (forget) await saveForget(forget.queue).catch((error) => { throw markStorage(error); });
        await persist();
    } catch (error) {
        if (forget) await saveForget(previousQueue).catch(() => {});
        await revertMemory(previous, undoable);
        const message = error?.storageFailed ? error.message : storageIssueMessage(error);
        tellStorageIssue(message);
        return { storageFailed: true, message };
    }
    if (forget?.gone.length) forgetMarks(forget.gone);
    flushCloud().catch(() => {});
    return null;
}

/** 검사용: 지우기 대기열과 동기화 기준 시각을 봅니다. */
export function syncMetaForTest() {
    return { queue: structuredClone(forgetQueue), since: syncSince, seen: [...cloudSeen.keys], seenUid: cloudSeen.uid };
}

/** 검사에서 두 저장소의 성공·실패를 넣습니다. 저장 키 이름은 바꾸지 않습니다. */
export function useVaultsForTest(nextMain, nextLocal, nextInbox) {
    mainVault = nextMain;
    localVault = nextLocal;
    if (nextInbox) inboxVault = nextInbox;
    memoryOnly = false;
    persistQueue = Promise.resolve();
}

function seenFor(uid) {
    if (cloudSeen.uid !== uid) cloudSeen = { uid, keys: new Set() };
    return cloudSeen.keys;
}

function saveSeen() {
    if (memoryOnly || !cloudSeen.uid) return;
    mainVault.set('cloudSeen', { uid: cloudSeen.uid, keys: [...cloudSeen.keys].slice(-5000) }).catch(() => {});
}

/** 대기열에 남은 '클라우드에서 지우기'를 한 번 더 해 봅니다. */
let forgetTask = null;

export async function retryForget() {
    if (forgetTask) return forgetTask;
    forgetTask = runForget().finally(() => { forgetTask = null; });
    return forgetTask;
}

async function runForget() {
    const uid = state.auth?.uid;
    if (!uid || !syncAvailable()) return { skipped: true };
    const mine = forgetQueue.filter((item) => item.uid === uid);
    if (!mine.length) return { ok: true, done: 0 };
    const opts = { memoryOnly: memoryOnly || state.profile.sharedPc };
    const { done } = await drainQueue(forgetQueue, uid, (name, id) => deleteUserDoc(uid, name, id, opts));
    if (done.length) {
        const doneKeys = new Set(done.map((item) => `${item.uid}|${item.name}/${item.id}`));
        // 기다리는 동안 새로 들어온 항목은 그대로 둡니다.
        await saveForget(forgetQueue.filter((item) => !doneKeys.has(`${item.uid}|${item.name}/${item.id}`))).catch(() => {});
        forgetMarks(done);
        saveSeen();
    }
    return { ok: done.length === mine.length, done: done.length };
}

export async function flushCloud() {
    if (!state.auth?.uid || !syncAvailable()) return { skipped: true };
    const uid = state.auth.uid;
    syncBegin();
    let result = null;
    let forgot = null;
    try {
        const before = cloudHashes;
        [forgot, result] = await Promise.all([
            retryForget().catch(() => ({ ok: false })),
            pushUserData(uid, state, {
                memoryOnly: memoryOnly || state.profile.sharedPc,
                hashes: cloudHashes,
            }),
        ]);
        if (result?.hashes) {
            const seen = seenFor(uid);
            for (const [key, mark] of Object.entries(result.hashes)) {
                if (key !== 'profile' && before[key] !== mark) seen.add(key);
            }
            cloudHashes = result.hashes;
            // 올리는 사이에 지운 문서는 지문을 남기지 않습니다(다시 생기면 꼭 올라가게).
            for (const item of forgetQueue) {
                if (item.uid !== uid) continue;
                const key = keyOf(item.name, item.id);
                delete cloudHashes[key];
                seen.delete(key);
            }
            if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
            saveSeen();
        }
        return result;
    } finally {
        syncEnd({
            ok: Boolean(result?.ok) && forgot?.ok !== false,
            pending: result?.pending || 0,
            skipped: Boolean(result?.skipped),
        });
    }
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

/** 마지막으로 합친 결과. 지문과 '본 적 있음'을 맞출 때 씁니다. */
let absorbed = null;

function absorbCloud(draft, remote) {
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
    // 같은 기록은 updatedAt이 더 최근인 쪽을 남깁니다. 시각이 없는 옛 기록은 예전처럼 이 기기 것을 둡니다.
    const uid = draft.auth?.uid || '';
    const forgotten = forgottenIds(forgetQueue, uid);
    const seen = uid ? seenFor(uid) : null;
    const taken = [];
    const removed = [];
    for (const [localName, cloudName] of SYNC_BUCKETS) {
        const merged = mergeBucket(cloudName, draft[localName], remote[localName], {
            since: syncSince,
            forgotten: forgotten[cloudName] || new Set(),
            seen,
            fromServer: Boolean(remote.fromServer?.[cloudName]),
            isClean: (row) => {
                const found = cloudMark(cloudName, row);
                return Boolean(found && cloudHashes[found.key] === found.mark);
            },
        });
        draft[localName] = merged.rows;
        merged.taken.forEach((row) => taken.push([cloudName, row]));
        merged.removed.forEach((row) => removed.push([cloudName, row]));
    }
    draft.legacyPages = unionById(draft.legacyPages, remote.legacyPages);
    draft.inbox = unionById(draft.inbox, withoutDropped(remote.inbox));
    const table = mergeTimetable(draft.timetable, remote.timetable, draft.syncMeta?.timetable, remote.timetableStamps, { since: syncSince });
    draft.timetable = table.table;
    if (Object.keys(table.stamps).length) draft.syncMeta = { ...(draft.syncMeta || {}), timetable: table.stamps };
    absorbed = { uid, taken, removed, takenDays: table.takenDays, remote };
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
    // 되돌린 줄도 '방금 고친 것'으로 찍어야 다른 기기의 옛 내용에 덮이지 않습니다.
    const restored = stampEdits(current, { ...structuredClone(prev), auth: current.auth }, { force: true });
    const forget = planForget(current, restored, true);
    const previousQueue = forgetQueue;
    state = restored;
    mirrorTheme(state.profile.theme);
    emit();
    try {
        if (forget) await saveForget(forget.queue).catch((error) => { throw markStorage(error); });
        await persist();
    } catch (error) {
        if (forget) await saveForget(previousQueue).catch(() => {});
        undoStack.push(prev);
        state = current;
        mirrorTheme(state.profile.theme);
        emit();
        tellStorageIssue(error?.storageFailed ? error.message : storageIssueMessage(error));
        return false;
    }
    if (forget?.gone.length) forgetMarks(forget.gone);
    flushCloud().catch(() => {});
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

/** 지우기 대기열, 본 적 있는 키, 시각을 적기 시작한 때를 불러옵니다. 없으면 새로 만듭니다. */
async function loadSyncMeta() {
    try {
        forgetQueue = normalizeQueue(await mainVault.get('cloudForget'));
    } catch {
        forgetQueue = [];
    }
    try {
        const seen = await mainVault.get('cloudSeen');
        if (seen?.uid && Array.isArray(seen.keys)) cloudSeen = { uid: String(seen.uid), keys: new Set(seen.keys.map(String)) };
    } catch {
        /* 없으면 이번 받아오기부터 셉니다. */
    }
    try {
        const since = Number(await mainVault.get('syncSince'));
        if (Number.isFinite(since) && since > 0) syncSince = since;
        else {
            syncSince = Date.now();
            await mainVault.set('syncSince', syncSince);
        }
    } catch {
        syncSince = syncSince || Date.now();
    }
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
        if (localStorage.getItem(SHARED_KEY) === '1') {
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
        await loadSyncMeta();
    } else {
        syncSince = Date.now();
    }
    if (!state.profile.started && params.get('demo') === '1' && !legacyAvailable()) {
        await loadDemo();
        return snapshot();
    }
    emit();
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

export async function setAttendance(date, sid, status, extra = {}) {
    return update((draft) => {
        const id = `${date}_${sid}`;
        const index = draft.attendance.findIndex((row) => row.id === id);
        if (!status || status === '출석') {
            if (index >= 0) draft.attendance.splice(index, 1);
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
    }, { undoable: true, syncDeletes: true });
}


export async function cycleAttendance(date, sid) {
    await update((draft) => {
        const id = `${date}_${sid}`;
        const index = draft.attendance.findIndex((row) => row.id === id);
        const current = index >= 0 ? draft.attendance[index].status : '';
        const next = CYCLE[(CYCLE.indexOf(current) + 1) % (CYCLE.length + 1)] || '';
        if (!next) {
            if (index >= 0) draft.attendance.splice(index, 1);
        } else if (index >= 0) draft.attendance[index] = { ...draft.attendance[index], status: next };
        else draft.attendance.unshift({ id, date, sid, status: next, reason: '', note: '', paper: false, source: 'app' });
        if (!draft.profile.checkedDates.includes(date)) draft.profile.checkedDates.push(date);
        return draft;
    }, { undoable: true, syncDeletes: true });
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

export async function saveTextItem(bucket, row) {
    const sensitive = isSensitiveText(row.text || row.title || '', row.tags);
    const failed = await update((draft) => {
        const target = sensitive ? draft.local[bucket] : draft[bucket];
        put(target, { ...row, source: row.source || 'app' });
        return draft;
    }, { undoable: true });
    if (failed?.storageFailed) return { ok: false, storageFailed: true, message: failed.message, sensitive };
    return { sensitive };
}

export async function removeItem(bucket, id) {
    return update((draft) => {
        draft[bucket] = (draft[bucket] || []).filter((item) => item.id !== id);
        if (draft.local[bucket]) draft.local[bucket] = draft.local[bucket].filter((item) => item.id !== id);
        return draft;
    }, { undoable: true, syncDeletes: true });
}

export async function patchProfile(patch) {
    const failed = await update((draft) => {
        draft.profile = { ...draft.profile, ...patch };
        return draft;
    });
    if (failed?.storageFailed) return failed;
    if (patch.sharedPc === true) {
        memoryOnly = true;
        try {
            await mainVault.remove('state');
            await localVault.remove('state');
            await inboxVault.remove('items');
            await inboxVault.remove('dropped');
            inboxDropped = new Set();
            await mainVault.remove('cloudHashes');
            await mainVault.remove('cloudForget');
            await mainVault.remove('cloudSeen');
        } catch {
            /* 공용 컴퓨터에서는 기록을 남겨 두지 않습니다. */
        }
    }
    if (patch.sharedPc === false) memoryOnly = false;
}

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
    }, { syncDeletes: true });
    if (failed?.storageFailed) return failed;
    return parsed;
}

export async function setTimetable(day, period, subject, specialist) {
    return update((draft) => {
        const table = { ...draft.timetable };
        const row = { ...(table[day] || {}) };
        if (subject != null) row[`p${period}`] = subject;
        if (specialist != null) row[`s${period}`] = specialist;
        table[day] = row;
        draft.timetable = table;
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
    downloadJson(`콕교무수첩-${seoulYmd()}.json`, data);
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
        downloadJson(`콕교무수첩-바꾸기전-${seoulYmd()}.json`, payload);
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

/** 받아 온 기록의 지문을 적어 두어, 같은 내용을 곧바로 다시 올리지 않게 합니다. */
function noteAbsorbed() {
    const info = absorbed;
    absorbed = null;
    if (!info?.uid || info.uid !== state.auth?.uid) return;
    const seen = seenFor(info.uid);
    for (const [localName, cloudName] of SYNC_BUCKETS) {
        if (!info.remote.fromServer?.[cloudName]) continue;
        for (const row of info.remote[localName] || []) {
            const key = keyOf(cloudName, row?.id);
            if (key) seen.add(key);
        }
    }
    for (const [cloudName, row] of info.taken) {
        const found = cloudMark(cloudName, row);
        if (found) {
            cloudHashes[found.key] = found.mark;
            seen.add(found.key);
        }
    }
    for (const [cloudName, row] of info.removed) {
        const found = cloudMark(cloudName, row);
        if (found) {
            delete cloudHashes[found.key];
            seen.delete(found.key);
        }
    }
    if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    saveSeen();
}

/**
 * 먼저 받아 와서 합친 다음 올립니다.
 * (예전에는 올린 뒤 받아 와서, 오래 쉰 기기가 옛 내용으로 클라우드를 덮을 수 있었어요.)
 */
async function connectCloud(uid) {
    syncBegin();
    let ok = false;
    try {
        await retryForget().catch(() => {});
        const remote = await pullUserData(uid, { memoryOnly: memoryOnly || state.profile.sharedPc });
        if (!remote) {
            await flushCloud();
            return;
        }
        const hasRemote = remote.profile?.className || (remote.students || []).length || (remote.records || []).length || (remote.inbox || []).length || (remote.todos || []).length || (remote.events || []).length || (remote.attendance || []).length || (remote.notes || []).length;
        if (!hasRemote) {
            await flushCloud();
            ok = true;
            return;
        }
        if (state.auth?.uid !== uid) return;
        const failed = await update((draft) => absorbCloud(draft, remote));
        if (!failed?.storageFailed) noteAbsorbed();
        else absorbed = null;
        ok = true;
    } finally {
        syncEnd({ ok, skipped: !ok });
    }
}

/**
 * 앱이 다시 보일 때(visibilitychange·focus·online) 클라우드에서 받아와 합칩니다.
 * 다시 보이기·포커스는 30초에 한 번만, 인터넷이 돌아오면 바로 받아옵니다.
 */
export async function refreshFromCloud(reason = 'visible', { now = Date.now(), hidden = false } = {}) {
    const uid = state.auth?.uid;
    if (!uid || !syncAvailable()) return { skipped: true };
    if (refreshTask) return refreshTask;
    if (!shouldRefresh({ reason, now, lastAt: lastRefreshAt, hidden })) return { skipped: true, throttled: true };
    lastRefreshAt = now;
    refreshTask = connectCloud(uid)
        .then(() => ({ ok: true }))
        .catch(() => ({ ok: false }))
        .finally(() => { refreshTask = null; });
    return refreshTask;
}

export async function setAuth(auth) {
    const next = auth?.uid ? { uid: auth.uid, name: auth.name || '', email: auth.email || '' } : null;
    syncAuthKnown();
    state = { ...state, auth: next };
    syncQueued(next?.uid ? forgetQueue.filter((item) => item.uid === next.uid).length : 0);
    if (next) state.profile.guest = false;
    emit();
    if (!next?.uid) {
        connectTask = null;
        return;
    }
    if (connectTask?.uid === next.uid) return connectTask.promise;
    lastRefreshAt = Date.now();
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
