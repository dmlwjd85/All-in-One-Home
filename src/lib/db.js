import { heldTimesToRetry } from './todoTimeHold.js';
import { CONFLICT_PREFIX } from './conflict.js';
import { syncAuthKnown, syncBegin, syncEnd, syncQueued, syncSeen } from './syncStatus.js';
import { createVault } from './idb.js';
import { DEFAULT_PERIODS } from './period.js';
import { absorbTabbar, adoptTabAccount, parkTabAccount, subscribeTabOrder, switchTabAccount, useTabClock } from '../ui/tabSlots.js';
import { leaveState, patchPeriodLocal, readPeriodLocal, setExtraPeriod, setLeave, subscribePeriodLocal, useLeaveClock } from './periodLocal.js';
import { cleanAcademic, setAcademicSource } from './academic.js';
import { buildDemo } from './demo.js';
import { parseNote, stripTokens } from './parse.js';
import { alarmTimeLabel, readJjaemPaste } from './jjaemPaste.js';
import { isTodoTime } from './todoAlarm.js';
import { isSensitiveText } from './sensitive.js';
import { buildExport, cleanPeriodLocal, downloadJson, fillPeriodLocal, incomingLocal, incomingPeriodStarts, incomingSettings, splitSensitive, validateBackupText, oldBackupToBag } from './backup.js';
import { planMigration, readLegacyStorage } from './migrate.js';
import { CLOUD_COLLECTIONS, LWW_NAMES, TOMB_KEEP_MS, clearTombs, deleteUserDoc, fingerprint, measureServerClock, peekMinutes, peekTodos, printDigest, pullUserData, pushUserData, rowMark, sweepTombs, syncAvailable, unchangedSincePush, watchTodos, writeTombs } from './cloud.js';
import { blockedAsSensitive, cloudRowId, fromCloudRow, legacyWorkAt, localSettingAts, PERIOD_KEYS, SWEEP_COLLECTIONS, toCloudRow, WORK_KEYS } from './cloudShape.js';
import { addDaysYmd, dayKeyFromYmd, seoulParts, seoulYmd } from './date.js';
import { isActiveStudent, parseRoster, planRoster } from './roster.js';
import { groupRecordId, newGroupId } from './nameLink.js';
import { MINUTES_DRAFT_KEY } from './minutes.js';
import { clearAllTextDrafts, clearTextDraft, memoryStore, readTextDraft, writeTextDraft } from './textDraft.js';
import { allDoneToday, doneCount, isPri, mergeGoals, normalizeGoals, priOf, sameGoals, settleGoalDay, cleanGoalN, DEFAULT_GOAL } from './todoAchieve.js';
import { mergeLinks, readLinks } from './eduLinks.js';
import {
    CLOUD_BUCKETS, dropRegisteredInbox, refreshShared, remoteDay, takeRemoteDay, unionById, withRemoteAt,
    clippedCopy, mergePushedHashes, planTodoConflict, pruneDeletedElsewhere, rememberAllPulled, rememberPulledHashes, remoteIsLater, stableHashes, takeRemote,
} from './syncMerge.js';

/* 합치기 순수 함수는 syncMerge.js 로 옮겼습니다. 예전처럼 db.js 에서도 가져올 수 있게 다시 내보냅니다. */
export { clippedCopy, mergePushedHashes, planTodoConflict, pruneDeletedElsewhere, rememberAllPulled, rememberPulledHashes, remoteIsLater, stableHashes, takeRemote };
import { dropMinutesTombs, freshCandidates, noteMinutesGone, noteMinutesTidied, readMinutesTidied, unnoteMinutesTidied, readMinutesGone, unnoteMinutesGone, minutesCandidates, minutesNow, queueMinutesTombs, readMinutesLinks, readMinutesPending, readMinutesTombQueue, rememberMinutesLinks, setMinutesPending, untouchedSince, vanishedCandidates } from './minutesExtract.js';

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
        /* 할 일 하루 목표와 날짜별 달성 기록(PR C). 계정 몫이고 settings/goal 문서로 기기끼리 맞춥니다. */
        goals: { n: DEFAULT_GOAL, nAt: 0, days: {} },
        /* 업데이트 전 수정 보관함(PR #66). 계정 몫이고 이 기기·백업에만 둡니다(클라우드에는 올리지 않음). */
        keptLegacy: [],
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
        /* 서버 보정 시각(조퇴·탭바와 같음). 기기 시각이면 시계가 +1일인 기기의 설정이 하루 동안 늘 이겼습니다(PR #66 r5 P1). */
        ats[part] = serverNow();
        changed = true;
    }
    if (!changed) return;
    next.settingsAts = ats;
    next.settingsAt = Math.max(...PROFILE_SETTING_PARTS.map((p) => Number(ats[p]) || 0));
}

/* 이 기기 시간표 설정(교시 길이·9·10교시 등)이 바뀌면 다른 기기와 같이 쓰도록 올립니다. */
subscribePeriodLocal(() => { flushCloud().catch(() => {}); });
/* 하단 탭바 배치를 고치면 바로 올립니다(로그인하지 않았으면 flushCloud 가 아무것도 하지 않습니다). */
subscribeTabOrder(() => { flushCloud().catch(() => {}); });

/*
 * 할 일마다 이 기기에서 마지막으로 고친 시각(editAt, ms)을 적습니다. 클라우드로는 올리지 않고(해시에도 안 들어감),
 * 양쪽에서 같은 할 일을 고쳤을 때 클라우드 updatedAt과 견주어 더 늦게 고친 쪽을 남기는 데만 씁니다.
 * 클라우드에서 받아 합칠 때(fromCloud)는 받은 시각을 그대로 두므로 여기서 새로 찍지 않습니다.
 */
/*
 * 고친 시각 시계(하이브리드 논리 시계): 기기 시계 + 서버와의 차이(o), 그리고 지금까지 본 가장 늦은 시각(l)보다 항상 1ms 늦게.
 * 기기 시계가 어긋나도(±몇 시간) 서버 시각 기준으로 견주고, 다른 기기 수정을 본 뒤에 고친 것은 반드시 그보다 늦게 찍힙니다.
 * 이 기기(localStorage)에만 둡니다.
 */
const CLOCK_KEY = 'ssug-gyomu-clock';
const CLOCK_AHEAD = 10 * 60 * 1000;
let deviceNow = () => Date.now();
let clock = readClock();
function readClock() {
    try {
        const c = JSON.parse(globalThis.localStorage?.getItem(CLOCK_KEY) || '{}');
        return { o: Number.isFinite(c?.o) && Math.abs(c.o) < 400 * 86400000 ? c.o : 0, l: Number.isFinite(c?.l) && c.l > 0 ? c.l : 0, k: c?.k === true };
    } catch { return { o: 0, l: 0, k: false }; }
}
function saveClock() {
    try { if (!memoryOnly && !state?.profile?.sharedPc) globalThis.localStorage?.setItem(CLOCK_KEY, JSON.stringify(clock)); } catch { /* 공간 없음 */ }
}
/** 서버 기준 지금 시각(ms). */
export function serverNow() { return Math.round(deviceNow() + clock.o); }
/* 조퇴 시각도 서버 기준 시계로 고친 시각을 찍습니다(기기 시계가 어긋나도 나중에 고친 쪽이 이기게). */
useLeaveClock(() => serverNow());
useTabClock(() => serverNow());
/*
 * 이번 실행에서 서버 시각을 재는 데 성공했는지(PR #57 검수 치명 1번). 재기 전에는 기기 시계를 믿지 않습니다.
 *  - 고친 시각은 0(모름)으로 두고 기기 시각은 editD에 따로 적어 둡니다. 0이면 클라우드에는 serverTimestamp(올린 시각)로 올라갑니다.
 *  - 재는 데 성공하면 editD + 차이로 고친 시각을 다시 찍습니다(그 사이 기기 시계를 바꿨으면 지금보다 늦지 않게 자릅니다).
 *  - 끝내 못 재면 올린 시각으로 견주되, 다른 기기가 그 사이 고치거나 지운 할 일은 올리지 않고 보류합니다.
 */
let clockOk = false;
export function clockMeasured() { return clockOk; }
/** 새로 고친(또는 지운) 시각: 서버 기준 지금, 그리고 지금까지 본 어떤 시각보다 늦게. 서버 시각을 재기 전이면 0(모름). */
export function editClock() {
    if (!clockOk) return 0;
    const at = Math.max(serverNow(), clock.l + 1);
    clock.l = at;
    saveClock();
    return at;
}
/** 다른 기기가 찍은 시각을 봤습니다. 서버 기준 지금보다 10분 넘게 앞선 값(시계가 크게 틀린 옛 기기)은 따르지 않습니다. */
function seeClock(ms) {
    if (!Number.isFinite(ms) || ms <= clock.l || ms > serverNow() + CLOCK_AHEAD) return;
    clock.l = ms;
    saveClock();
}
function setClockOffset(offset) {
    if (offset == null || !Number.isFinite(offset) || Math.abs(offset) >= 400 * 86400000) return false;
    clock.o = Math.round(offset);
    clock.k = true;
    clockOk = true;
    saveClock();
    return true;
}
/** 재기 전에 기기 시각(editD)만 적어 둔 시각을 서버 기준으로 바꿉니다.
 *  지금보다 늦게 나오면(그 사이 기기 시계를 바꿈) 고친 시각을 믿을 수 없으므로 -1('모름')을 돌려줍니다(PR #66 r4 전수 점검).
 *  예전에는 지금으로 잘라 찍어, 그 사이 다른 기기가 더 나중에 고친 값을 이길 수 있었습니다. */
const SETTLE_SLACK_MS = 2000;
function settleDeviceTime(d) {
    if (!clockOk || !Number.isFinite(d) || d <= 0) return 0;
    const raw = Math.round(d + clock.o);
    if (raw > serverNow() + SETTLE_SLACK_MS) return -1;
    const at = Math.min(raw, serverNow());
    return at > 0 ? at : 0;
}
/** 검사용: 기기 시계를 바꿔 끼웁니다(시계가 어긋난 기기 흉내). */
export function useDeviceClockForTest(fn = null) { deviceNow = fn || (() => Date.now()); }
export function clockForTest() { return { ...clock }; }
export function resetClockForTest({ measured = false } = {}) { clock = readClock(); clockOk = measured; }

let fromCloud = 0;
export function stampTodoEdits(prev, next, now = null) {
    const at = () => (now == null ? editClock() : now);
    const mark = (row) => {
        const t = at();
        row.editAt = t;
        if (t > 0) delete row.editD; else row.editD = deviceNow();
    };
    /* 할 일·일정·회의록(메모)·출결: 바뀐 줄마다 고친 시각을 찍습니다. 목록마다 따로 견줍니다(같은 id가 다른 목록에 있어도 섞이지 않게). */
    const strip = (row) => { const { editAt, editD, ...rest } = row; return JSON.stringify(rest); };
    const groups = [
        [[...(prev?.todos || []), ...(prev?.local?.todos || [])], [next?.todos || [], next?.local?.todos || []]],
        [prev?.events || [], [next?.events || []]],
        [prev?.notes || [], [next?.notes || []]],
        [prev?.attendance || [], [next?.attendance || []]],
    ];
    for (const [olds, lists] of groups) {
        const before = new Map(olds.filter((row) => row?.id).map((row) => [String(row.id), row]));
        for (const list of lists) {
            for (const row of list) {
                if (!row?.id) continue;
                const old = before.get(String(row.id));
                if (!old) { if (!Number.isFinite(row.editAt)) mark(row); continue; }
                if (strip(old) !== strip(row)) mark(row);
                else {
                    if (Number.isFinite(old.editAt) && !Number.isFinite(row.editAt)) row.editAt = old.editAt;
                    if (Number.isFinite(old.editD) && !Number.isFinite(row.editD) && !(row.editAt > 0)) row.editD = old.editD;
                }
            }
        }
    }
    /* 시간표: 요일(날짜)마다 고친 시각을 찍습니다. */
    const oldTable = prev?.timetable || {};
    for (const [day, value] of Object.entries(next?.timetable || {})) {
        if (!value || typeof value !== 'object') continue;
        const old = oldTable[day];
        /* 요일 기본값을 복사해 만든 날짜(setDayTimetable)는 복사된 editAt이 있어도 새로 고친 것으로 찍습니다. */
        if (!old || strip(old) !== strip(value)) { mark(value); continue; }
        if ('editAt' in old) value.editAt = old.editAt; else delete value.editAt;
        if ('editD' in old) value.editD = old.editD; else delete value.editD;
    }
}
function updateFromCloud(recipe) {
    fromCloud += 1;
    try { return update(recipe); } finally { fromCloud -= 1; }
}

export async function update(recipe, { undoable = false } = {}) {
    /* 일부 받기에서 합친 것인지(뒤이은 올리기가 칩 시각을 바꾸지 않게). await 전에 봅니다. */
    const quiet = fromCloud > 0 && partialAbsorb > 0;
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
    if (quiet) quietFlushes += 1;
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
    if (keys.length === 1 && keys[0] === 'settings/leave') return '클라우드가 오늘 조퇴 시각을 받지 않았어요. 이 기기에는 그대로 남아 있고, 나중에 다시 올려요.';
    const what = minutes === keys.length ? '회의록' : '기록';
    /* 새 판에서 남는 거절은 규칙 검증 거절입니다(시각 정착 전 거절은 알리지 않음). 같은 내용으로는 다시 올려도 거절되고,
       규칙이 앱보다 새것일 때는 새로고침(최신 판)이 도움이 됩니다. 로컬은 지우지 않습니다. */
    return `클라우드가 ${what} ${keys.length}개를 받지 않았어요. 이 기기에는 그대로 남아 있어요. 앱을 새로고침해도 계속 뜨면 그 ${what}을 한 번 고쳐 저장해 주세요.`;
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
const REAL_CLOUD = { push: pushUserData, pull: pullUserData, remove: deleteUserDoc, peek: peekTodos, clock: measureServerClock, sweep: sweepTombs, watch: watchTodos, tomb: writeTombs, minutesPeek: peekMinutes, untomb: clearTombs, available: syncAvailable };
let cloudApi = { ...REAL_CLOUD };
/* 검사용: 넣은 함수만 바꿉니다. peek·clock을 넣지 않은 가짜 클라우드에서는 그 단계를 건너뜁니다(진짜 클라우드 함수가 불리지 않게). */
export function useCloudForTest(api = null) {
    cloudApi = api ? { push: pushUserData, pull: pullUserData, remove: deleteUserDoc, peek: null, clock: null, sweep: null, watch: null, tomb: null, minutesPeek: null, untomb: null, available: () => true, ...api } : { ...REAL_CLOUD };
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

/*
 * 업데이트 전에(구버전에서) 고치고 못 올린 일정·회의록·출결·시간표 줄(PR #66 r3 P1).
 * 구버전은 고친 시각(editAt)을 남기지 않아, 새 판이 한 번 쓴 문서(hlc)·묘비 있는 문서에는 규칙이 hlc 없는 쓰기를 늘 거절하고
 * lost로도 판정되지 않아 두 기기가 영영 갈라졌습니다. 아직 못 올린 줄(올린 해시와 지문이 다름)에만 지금을 고친 시각으로 찍습니다.
 * 서버 시각을 못 쟀으면 editD(기기 시각)를 찍어 두고 settleUnsureEdits가 재기 뒤 정착합니다. 로컬 수정은 버리지 않습니다.
 */
const LEGACY_STAMP = [['events', 'events'], ['notes', 'notes'], ['attendance', 'attendance']];
function legacyUnsent(cloudName, row) {
    if (!row || Number(row.editAt) > 0 || Number.isFinite(row.editD)) return false;
    const mark = rowMark(cloudName, row);
    return Boolean(mark) && cloudHashes[mark.key] !== mark.mark;
}
/*
 * 단, 업데이트 전 수정이 다른 기기의 더 늦은 수정을 덮으면 안 됩니다(PR #66 r4 A7: 구버전에서 T1에 고침 → 다른 기기 신판이 T2에 고침 → 업데이트).
 * 업데이트 전 수정은 고친 시각을 모르므로, 클라우드 문서가 이 기기가 마지막으로 올리거나 받은 판(cloudHashes)과 다르면 덮지 않습니다.
 *  - 일정·회의록: 클라우드 값을 받고, 이 기기 수정은 '(충돌 사본)' 새 줄로 따로 올려 양쪽 수정이 모두 남습니다(할 일 충돌 사본 배지 재사용).
 *  - 출결·시간표: 같은 학생·날짜(요일)에 줄이 하나라 사본을 만들 수 없습니다. 클라우드 값을 받고, 이 기기 값은 보관함(state.keptLegacy: 이 기기에 저장, 백업 파일에도 들어감, 설정에서 되돌리기)에 남기고 알립니다.
 * 클라우드를 읽지 못하면(오프라인·캐시) 이번에는 찍지 않고 다음 올리기에서 다시 봅니다(거절 안내도 띄우지 않음).
 */
const KEPT_MAX = 200;
async function stampUnsentLegacy() {
    const tableRow = (day, value) => (value && typeof value === 'object' ? { id: day, ...value } : null);
    const found = LEGACY_STAMP.some(([local, cloudName]) => (state[local] || []).some((row) => legacyUnsent(cloudName, row)))
        || Object.entries(state.timetable || {}).some(([day, value]) => legacyUnsent('timetable', tableRow(day, value)));
    if (!found) return 0;
    const uid = state.auth?.uid;
    if (!uid || !cloudApi.pull) return 0;
    let remote = null;
    /* 일정·회의록·출결·시간표만 견주므로 그것만 받습니다(묘비는 함께 옵니다). */
    try { remote = await cloudApi.pull(uid, { memoryOnly: memoryOnly || state.profile.sharedPc, only: ['events', 'notes', 'attendance', 'timetable'] }); } catch { remote = null; }
    if (!remote || remote.fresh === false || state.auth?.uid !== uid) return 0;
    let count = 0;
    const copies = [];
    const kept = [];
    const mark = (row) => {
        const at = editClock();
        if (at > 0) { row.editAt = at; delete row.editD; } else { row.editAt = 0; row.editD = deviceNow(); }
        count += 1;
    };
    /* 클라우드가 이 기기가 마지막으로 알던 판 그대로이거나(또는 없음·같은 내용) 덮어도 되는지 */
    const safe = (cloudName, mine, theirs) => {
        if (!theirs) return true;
        const m = rowMark(cloudName, mine);
        const t = rowMark(cloudName, theirs);
        if (!m || !t) return true;
        return t.mark === m.mark || (Boolean(cloudHashes[m.key]) && t.mark === cloudHashes[m.key]);
    };
    await updateFromCloud((draft) => {
        for (const [local, cloudName] of LEGACY_STAMP) {
            const byId = new Map((remote[local] || []).filter((r) => r?.id).map((r) => [String(r.id), r]));
            const next = [];
            for (const row of draft[local] || []) {
                if (!legacyUnsent(cloudName, row)) { next.push(row); continue; }
                const theirs = byId.get(String(row.id)) || null;
                if (safe(cloudName, row, theirs)) { mark(row); next.push(row); continue; }
                const got = withRemoteAt(cloudName, takeRemote(cloudName, row, theirs), remote);
                delete got.editD;
                next.push(got);
                const m = rowMark(cloudName, got); if (m) cloudHashes[m.key] = m.mark;
                if (cloudName === 'attendance') { kept.push({ kind: cloudName, id: String(row.id), row }); continue; }
                const copy = legacyCopy(row);
                copies.push(cloudName);
                next.push(copy);
                /* 제목이 길어 사본 제목이 잘릴 수도 있어, 원래 줄도 기기 보관함에 그대로 남깁니다. */
                kept.push({ kind: cloudName, id: String(row.id), row, copy: copy.id });
            }
            draft[local] = next;
        }
        for (const [day, value] of Object.entries(draft.timetable || {})) {
            if (!legacyUnsent('timetable', tableRow(day, value))) continue;
            const theirs = remote.timetable?.[day] ? { id: day, ...remote.timetable[day] } : null;
            if (safe('timetable', tableRow(day, value), theirs)) { mark(value); continue; }
            kept.push({ kind: 'timetable', id: day, row: value });
            draft.timetable[day] = remoteDay(remote.timetable[day], remote.ats?.timetable?.[day]);
            const m = rowMark('timetable', { id: day, ...draft.timetable[day] }); if (m) cloudHashes[m.key] = m.mark;
        }
        if (kept.length) {
            const at = serverNow();
            draft.keptLegacy = [...(Array.isArray(draft.keptLegacy) ? draft.keptLegacy : []), ...kept.map((k) => ({ ...k, row: structuredClone(k.row), at }))].slice(-KEPT_MAX);
        }
        return draft;
    });
    if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    const keptOnly = kept.filter((k) => !k.copy).length;
    if (copies.length || keptOnly) tellStorageIssue(legacyConflictMessage(copies.length, keptOnly));
    return count + copies.length + keptOnly;
}
/** 업데이트 전 수정의 사본: 새 id, 제목 앞에 '(충돌 사본)'. 아직 올리지 않은 새 줄이고 고친 시각은 지금입니다. */
function legacyCopy(row) {
    /* 회의록(meet-)은 사본도 회의록으로 보이게 머리를 지킵니다. */
    const head = String(row?.id || '').startsWith('meet-') ? 'meet-' : '';
    const id = `${head}c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const { editAt, editD, ...rest } = row || {};
    const base = String(row?.title || '');
    const title = (base.startsWith(CONFLICT_PREFIX) ? base : `${CONFLICT_PREFIX}${base}`).slice(0, 60);
    const at = editClock();
    return { ...rest, id, title, source: 'app', ...(at > 0 ? { editAt: at } : { editAt: 0, editD: deviceNow() }) };
}
export function legacyConflictMessage(copied = 0, kept = 0) {
    const parts = [];
    if (copied) parts.push(`다른 기기에서 나중에 고친 기록 ${copied}개가 있어, 업데이트 전에 이 기기에서 고친 내용은 '충돌 사본'으로 따로 남겼어요.`);
    if (kept) parts.push(`출결·시간표 ${kept}개는 다른 기기에서 나중에 고친 값으로 맞추고, 이 기기에서 고친 값은 설정 › 계정 › 보관함에 남겨 두었어요(되돌릴 수 있어요).`);
    return parts.join(' ');
}
/** 보관함 목록(설정 화면). */
export function keptLegacyList() { return Array.isArray(state.keptLegacy) ? state.keptLegacy : []; }
/**
 * 보관함의 이 기기 값으로 되돌립니다. 지금 고친 것으로 찍혀(서버 보정 시각) 다른 기기에도 올라갑니다.
 * 일정·회의록은 원래 줄을 되돌리고(사본은 그대로 둠), 출결·시간표는 그 학생·날짜(요일) 줄을 바꿉니다.
 */
export async function restoreKeptLegacy(index, expect = null) {
    const entry = keptLegacyList()[index];
    if (!entry?.row) return { ok: false };
    /* 확인하는 사이 목록이 바뀌었으면(다른 탭·가져오기) 엉뚱한 줄을 되돌리지 않습니다. */
    if (expect && (expect.kind !== entry.kind || String(expect.id) !== String(entry.id) || Number(expect.at) !== Number(entry.at))) return { ok: false };
    const { editAt, editD, ...row } = structuredClone(entry.row);
    const result = await update((draft) => {
        if (entry.kind === 'timetable') {
            draft.timetable = { ...(draft.timetable || {}), [entry.id]: row };
        } else if (['events', 'notes', 'attendance'].includes(entry.kind)) {
            const list = draft[entry.kind] || [];
            const at = list.findIndex((r) => String(r?.id) === String(entry.id));
            if (at >= 0) list[at] = { ...row, id: list[at].id }; else list.push({ ...row, id: entry.id });
            draft[entry.kind] = list;
        } else return draft;
        draft.keptLegacy = keptLegacyList().filter((_, i) => i !== index);
        return draft;
    });
    if (result?.storageFailed) return { ok: false };
    flushCloud().catch(() => {});
    return { ok: true };
}

/** 서버 시각을 재기 전에 고쳐(editD만) 아직 고친 시각이 정해지지 않은 줄의 클라우드 키. */
function unsureKeys() {
    const keys = new Set();
    const unsure = (row) => row && !(Number(row.editAt) > 0) && Number.isFinite(row.editD);
    for (const [local, cloudName] of [...LEGACY_STAMP, ['todos', 'todos']]) {
        for (const row of state[local] || []) { if (!unsure(row)) continue; const m = rowMark(cloudName, row); if (m) keys.add(m.key); }
    }
    /* 업데이트 전 수정(아직 시각을 못 찍음, 클라우드를 읽지 못한 동안)도 다음 올리기에서 다시 보므로 알리지 않습니다. */
    for (const [local, cloudName] of LEGACY_STAMP) for (const row of state[local] || []) if (legacyUnsent(cloudName, row)) { const m = rowMark(cloudName, row); if (m) keys.add(m.key); }
    for (const [day, value] of Object.entries(state.timetable || {})) {
        if (legacyUnsent('timetable', { id: day, ...value })) { const m = rowMark('timetable', { id: day, ...value }); if (m) keys.add(m.key); continue; }
        if (!unsure(value)) continue;
        const m = rowMark('timetable', { id: day, ...value }); if (m) keys.add(m.key);
    }
    return keys;
}
/** 검사용 */
export function stampUnsentLegacyForTest() { return stampUnsentLegacy(); }

/*
 * 예전 규칙으로 이미 클라우드에 올라간 줄 가운데 지금 기준으로 민감한 줄(본문의 전화번호·주소, '보건실' 태그 등) 정리.
 * 지금은 toCloudRow 가 null 이라 올리지도 지우지도 않아 클라우드 사본이 남습니다. 그런 줄을 찾으면
 *  1) 이 기기 전용(state.local)으로 옮겨 기기 저장소에 먼저 저장하고(update 가 끝까지 저장한 뒤에야 돌아옵니다),
 *  2) 저장이 끝난 뒤에만 클라우드 문서를 삭제 대기열(forgetRow 와 같은 길)에 넣어 이번 올리기 끝에서 지웁니다. 삭제는 규칙 safeText 를 보지 않습니다.
 * 저장에 실패하면 줄이 클라우드 칸에 그대로 남고 대기열·올린 지문(cloudHashes)도 건드리지 않아, 다음 올리기에서 다시 해 봅니다.
 * 찾을 줄이 없으면 아무것도 하지 않으므로 여러 번 돌아도 됩니다. 다른 기기(옛 앱)가 다시 올린 줄도 받아 온 뒤 같은 길로 정리됩니다.
 */
function moveToLocal(draft, bucket, row) {
    if (!draft.local) draft.local = {};
    if (!Array.isArray(draft.local[bucket])) draft.local[bucket] = [];
    const list = draft.local[bucket];
    const { localOnly: _localOnlyFlag, ...stored } = row;
    const same = list.find((item) => String(item?.id) === String(stored.id));
    if (!same) {
        list.unshift(stored);
        return;
    }
    const plain = (item) => { const { editAt, editD, at, ...rest } = item || {}; return JSON.stringify(rest); };
    if (plain(same) === plain(stored)) return;
    if (bucket === 'notices') {
        /* 알림장은 날짜마다 한 줄입니다. 이 기기 전용 알림장이 이미 있으면 글을 이어 붙여 둘 다 남깁니다. */
        const mine = String(same.text || '');
        const theirs = String(stored.text || '');
        if (theirs && !mine.includes(theirs)) same.text = mine.trim() ? `${mine}\n${theirs}` : theirs;
        return;
    }
    /* 같은 아이디에 다른 내용: 덮지 않고 새 아이디로 하나 더 둡니다(자료를 잃지 않게). */
    let n = 1;
    while (list.some((item) => String(item?.id) === `${stored.id}-m${n}`)) n += 1;
    list.unshift({ ...stored, id: `${stored.id}-m${n}` });
}

function hasSensitiveInCloudBuckets(current) {
    return SWEEP_COLLECTIONS.some((bucket) => (current?.[bucket] || []).some((row) => blockedAsSensitive(bucket, row)));
}

/** draft 를 고치고, 클라우드에서 지울 줄([bucket, 문서 id, 줄])을 돌려줍니다. 대기열에는 넣지 않습니다. */
function sweepSensitiveRows(draft) {
    const moved = [];
    for (const bucket of SWEEP_COLLECTIONS) {
        const rows = draft[bucket] || [];
        if (!rows.some((row) => blockedAsSensitive(bucket, row))) continue;
        const stay = [];
        for (const row of rows) {
            if (!blockedAsSensitive(bucket, row)) {
                stay.push(row);
                continue;
            }
            moveToLocal(draft, bucket, row);
            moved.push([bucket, cloudRowId(bucket, row) || row.id, row]);
        }
        draft[bucket] = stay;
    }
    return moved;
}

async function sweepSensitiveCloud() {
    if (!hasSensitiveInCloudBuckets(state)) return 0;
    let moved = [];
    const failed = await updateFromCloud((draft) => {
        moved = sweepSensitiveRows(draft);
        return draft;
    });
    if (failed?.storageFailed) return 0;
    for (const [bucket, id, row] of moved) {
        /* 그 사이 같은 문서 id 의 줄이 다시 클라우드 칸에 들어왔으면(받아오기) 지우지 않고 다음 정리에 맡깁니다. */
        if ((state[bucket] || []).some((item) => String(cloudRowId(bucket, item) || item?.id) === String(id))) continue;
        queueCloudForget(bucket, id, row);
    }
    return moved.length;
}

/** 검사용: 올리기 없이 민감한 줄 정리만 돌립니다. */
export function sweepSensitiveForTest() { return sweepSensitiveCloud(); }

/* 일부 받기(감시 알림)로 합친 뒤 이어지는 올리기 수. 이 올리기는 칩의 '마지막 동기화' 시각을 바꾸지 않습니다. */
let quietFlushes = 0;
let partialAbsorb = 0;
async function flushCloudTracked() {
    const stamp = quietFlushes > 0 ? (quietFlushes -= 1, false) : true;
    if (!state.auth?.uid || !cloudApi.available()) return { skipped: true };
    /* 동기화 칩: 올리는 동안 '동기화 중', 끝나면 다 올렸는지에 따라 '동기화됨' 또는 '동기화하지 못했어요'. */
    syncBegin();
    let result = null;
    try {
        /* 잰 뒤 기기 시계가 바뀌었거나 거절이 있었으면 올리기 전에 서버 시각을 다시 잽니다(틀린 보정값으로 notAhead·LWW에 걸리지 않게). */
        if (clockNeeds(state.auth.uid, { inPush: true })) await syncServerClock(state.auth.uid);
        result = state.auth?.uid ? await flushCloudOnce() : { skipped: true };
        return result;
    } finally {
        if (!result || result.skipped) syncEnd({ skipped: Boolean(result?.skipped), ok: false });
        else syncEnd({ ok: pushedAll(result), pending: result.pending, stamp });
        syncQueued(queuedCloudKeys().length);
    }
}

async function flushCloudOnce() {
    /* 올리기에는 지금 해시의 사본을 넘깁니다. 올리는 동안 이 기기에서 지우거나 받아서 바뀐 해시는 끝난 뒤 덮지 않습니다(PR #52 2차 검수 2번). */
    await reconcileDirtyTodos(state.auth.uid);
    if (!state.auth?.uid) return { skipped: true };
    /* 지켜 둔 시각(예전 규칙에 거절됨)은 해시를 비워 다시 올립니다. 새 규칙이면 시각까지 올라가고 지킴 기록이 지워집니다(PR #62 r2 1번). */
    const retry = new Set(heldTimesToRetry(state.todos));
    if (retry.size) {
        /* 같은 updatedAt으로는 규칙이 시각만 바꾸는 쓰기를 거절하므로 고친 시각을 1ms 올립니다. 예전에는 '지금'을 찍어,
           그 사이 다른 기기가 더 나중에 고친 할 일을 이길 수 있었습니다(PR #66 r4 전수 점검). 고친 시각을 모르면 예전처럼 지금. */
        state = { ...state, todos: (state.todos || []).map((row) => {
            if (!retry.has(String(row?.id))) return row;
            const at = Number(row?.editAt) > 0 ? Number(row.editAt) + 1 : editClock();
            return at > 0 ? { ...row, editAt: at } : row;
        }) };
        for (const id of retry) delete cloudHashes[`todos/${id}`];
    }
    await stampUnsentLegacy();
    await sweepSensitiveCloud();
    if (!state.auth?.uid) return { skipped: true };
    const sent = { ...cloudHashes };
    const held = heldTodos;
    const sending = held.size ? { ...state, todos: (state.todos || []).filter((row) => !held.has(toCloudRow('todos', row)?.id)) } : state;
    const result = await cloudApi.push(state.auth.uid, sending, {
        memoryOnly: memoryOnly || state.profile.sharedPc,
        hashes: { ...sent },
    });
    if (result?.hashes) {
        cloudHashes = mergePushedHashes(sent, cloudHashes, result.hashes);
        if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    }
    /* 서버 시각을 재기 전(editD만 있음)에 고친 줄은 hlc 문서에 거절돼도 재기 뒤 다시 올라가므로 알리지 않습니다(PR #66 r3 P2-2). */
    if (Array.isArray(result?.rejected)) { const waiting = unsureKeys(); tellRejected(result.rejected.filter((key) => !waiting.has(key))); }
    /* 거절·진 줄은 서버 시각 보정이 틀려서일 수 있습니다(기기 시계가 바뀜). 진 줄은 곧 받기(force)에서, 거절은 다음 받기에서 다시 잽니다. */
    if ((result?.rejected || []).length || (result?.lost || []).length) markClockDoubt(result.rejected || []);
    /* 다른 기기가 더 나중에 고친 줄: 곧바로 받아 와 그쪽 값으로 맞춥니다. */
    if ((result?.lost || []).length) setTimeout(() => { refreshFromCloud({ force: true }).catch(() => {}); }, 0);
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
            .map((item) => [forgetEntryKey(item.u, item.k), { uid: item.u, key: item.k, at: item.at, ...(Number.isFinite(item.d) ? { d: item.d } : {}), ...(item.e === 1 ? { exact: true } : {}), ...(item.s === 1 ? { server: true } : {}), ...(typeof item.x === 'string' && /^f[a-z0-9]{1,20}$/.test(item.x) ? { expect: item.x } : {}), ...(typeof item.y === 'string' && /^f[a-z0-9]{1,20}$/.test(item.y) ? { also: item.y } : {}), ...(typeof item.z === 'string' && /^f[a-z0-9]{1,20}$/.test(item.z) ? { back: item.z } : {}) }]);
    } catch { return []; }
}

function saveCloudForget() {
    try {
        if (memoryOnly || state?.profile?.sharedPc) return;
        const list = [...cloudForget.values()].slice(-500).map((e) => ({ u: e.uid, k: e.key, at: e.at, ...(Number.isFinite(e.d) ? { d: e.d } : {}), ...(e.exact ? { e: 1 } : {}), ...(e.server ? { s: 1 } : {}), ...(e.expect ? { x: e.expect } : {}), ...(e.also ? { y: e.also } : {}), ...(e.back ? { z: e.back } : {}) }));
        if (list.length || lastCloudUid) globalThis.localStorage?.setItem(CLOUD_FORGET_KEY, JSON.stringify({ last: lastCloudUid, items: list }));
        else globalThis.localStorage?.removeItem(CLOUD_FORGET_KEY);
    } catch { /* 저장 공간이 없으면 이번 실행 동안만 기억합니다. */ }
}

/** 검사용: 로그인한 계정만 바꿉니다(클라우드 연결은 하지 않음). */
export function useAuthForTest(uid) {
    state = { ...state, auth: uid ? { uid } : null };
    if (uid) rememberCloudUid(uid);
}

/** 검사용: 가짜 삭제 함수로 대기열 처리를 돌립니다(서버 시각 재기 기다림은 건너뜀. 기다림은 check:lwwsync DAY1이 봅니다). */
export function forgetQueuedCloudForTest(remove) {
    return forgetQueuedCloud(remove, { skipSyncCheck: true, skipClockWait: true });
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
    /* 지문만으로 지울 때(시각을 믿을 수 없음) 견줄 '클라우드에서 다시 읽은 모양'의 요약. 올린 그대로인 줄만 남깁니다(PR #66 r4).
       회의록처럼 받을 때 기본값이 붙는 줄은 올린 지문과 다시 읽은 지문이 달라, 이것 없이는 지우지 못하고 남깁니다. */
    let back = null;
    if (row && mine && mine === expect) {
        const sent = toCloudRow(bucket, row);
        const again = sent?.id ? fromCloudRow(bucket, sent.id, sent.body) : null;
        const m = again ? rowMark(bucket, again) : null;
        back = m ? printDigest(m.mark) : null;
        if (back === expect) back = null;
    }
    if (uid) {
        /* 할 일만 '모름(0)'을 씁니다(묘비·보류로 견줌). 다른 줄은 예전처럼 기기 시각으로 지운 뒤 고친 문서를 지킵니다.
           할 일의 d는 서버 시각 재기 뒤 settleUnsureEdits가 고칩니다. */
        /* 서버 시각을 못 잰 기기(+1일 등)는 기기 시각 그대로 묘비를 남기면 규칙(notAhead)에 걸리거나, 그 뒤 다른 기기가 고친 문서까지 지웁니다.
           다른 줄도 d(기기 시각)를 남기고, 재기 뒤 settleUnsureEdits가 at을 서버 기준으로 바꾼 다음에 지웁니다(PR #66 r3 P2-3). */
        const at = editClock() || (bucket === 'todos' ? 0 : deviceNow());
        /* server: at이 서버 기준(editClock)인지. 아닌 항목(재기 전·구버전이 남긴 대기열)은 지운 시각으로 견주지 않습니다. */
        cloudForget.set(forgetEntryKey(uid, key), { uid, key, at, ...(clockOk ? { server: true } : { d: deviceNow() }), ...(expect ? { expect } : {}), ...(also ? { also } : {}), ...(back ? { back } : {}) });
        saveCloudForget();
        syncQueued(queuedCloudKeys().length);
    }
    if (Object.prototype.hasOwnProperty.call(cloudHashes, key)) {
        delete cloudHashes[key];
        if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    }
}

const UNSURE_FORGET_WAIT_MS = 10 * 60 * 1000;
async function forgetQueuedCloud(remove = deleteUserDoc, { skipSyncCheck = false, skipClockWait = false } = {}) {
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
        /* 일정·회의록·출결: 서버 시각을 재기 전에 지운 줄은 재기 뒤 정착한 시각으로 지웁니다(로컬에서는 이미 빠졌고, 받아오기에도 다시 붙지 않음).
           10분 넘게 재지 못하면 기기 시각(notAfter)은 쓰지 않고, 클라우드 문서가 마지막으로 알던 내용(expect) 그대로일 때만 지웁니다.
           묘비는 서버가 받은 시각으로 남겨 notAhead에 걸리지 않게 합니다(PR #66 r4 2번). */
        const waiting = bucket !== 'todos' && Number.isFinite(entry.d) && !clockOk;
        /* 기기 시각으로만 지운 시각(at)이 남은 일정·회의록·출결(옛 대기열 포함, 재기 전 d 없음)도 시각을 믿지 않습니다. */
        const unsure = bucket !== 'todos' && (waiting || entry.exact === true || entry.server !== true || !(entry.at > 0));
        if (waiting && !skipClockWait && cloudApi.clock && deviceNow() - entry.d < UNSURE_FORGET_WAIT_MS) continue;
        /* 지문(expect)도 시각도 믿을 것이 없으면 지울지 판정할 수 없습니다(PR #66 r5 P2-2). 시각을 아직 못 쟀으면 대기열에 남겨
           재기 뒤 서버 시각으로 지우고(로컬은 지운 채, 받아오기에도 다시 붙지 않음), 재었는데도 모르면 대기열에서 빼 클라우드 항목을 남깁니다
           (다시 보일 수 있지만 다른 기기의 수정을 지우지 않음). 묘비를 서버 시각으로 쓰면 그 뒤 다른 기기가 되살린 수정까지 막으므로 쓰지 않습니다. */
        const known = [entry.expect, entry.also, entry.back].some(Boolean);
        if (unsure && !known && !skipClockWait) {
            if (!clockOk) continue;
            cloudForget.delete(entryKey);
            continue;
        }
        /* 클라우드 문서가 지운 시각보다 나중에 고쳐졌으면 지우지 않습니다. */
        const result = await remove(uid, bucket, id, { memoryOnly: memory, notAfter: !unsure && entry.at > 0 ? entry.at : null, expect: [entry.expect, entry.also, ...(unsure ? [entry.back] : [])].filter(Boolean).join(',') || null, ...(unsure ? { tombNow: true, exact: true } : {}) }).catch(() => ({ ok: false }));
        if (result?.ok) cloudForget.delete(entryKey);
    }
    saveCloudForget();
}

function withoutDropped(remote = []) {
    return (remote || []).filter((row) => row?.id && !inboxDropped.has(String(row.id)));
}

/** 클라우드에서 지우지 못한 임시보관함은 다음 받아오기에 다시 붙지 않습니다. */
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

export { CONFLICT_PREFIX };
/** 이 기기가 마지막으로 받아 온 지 묘비 보관 기간보다 오래됐는지(처음 받는 기기는 아님). */
export function staleSync(uid = state.auth?.uid) {
    const last = lastSyncAt(uid);
    return last > 0 && serverNow() - last > TOMB_KEEP_MS;
}
/** 사본: 새 id, 제목 앞에 '(충돌 사본)'. 아직 올리지 않은 새 할 일로 둡니다. */
export function conflictCopy(row) {
    const id = `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const title = String(row?.title || '').startsWith(CONFLICT_PREFIX) ? String(row.title) : `${CONFLICT_PREFIX}${row?.title || ''}`;
    const { editAt, editD, ...rest } = row || {};
    const at = editClock();
    return { ...rest, id, title: title.slice(0, 100), source: 'app', ...(at > 0 ? { editAt: at } : { editAt: 0, editD: deviceNow() }) };
}
/** 받아 올 때(pull) 할 일 충돌을 먼저 풉니다. 손댄 id는 이후 합치기에서 건드리지 않게 돌려줍니다. */
function resolveTodoConflicts(draft, remote, hashes) {
    const done = new Set();
    if (!Array.isArray(remote?.todos)) return done;
    const byId = new Map(remote.todos.filter((r) => r?.id).map((r) => [String(r.id), r]));
    const ids = Array.isArray(remote?.ids?.todos) ? new Set(remote.ids.todos.map(String)) : null;
    const stale = staleSync();
    const next = [];
    const copies = [];
    for (const row of draft.todos || []) {
        const id = row?.id ? String(row.id) : '';
        if (!id || !toCloudRow('todos', row) || unchangedSincePush(hashes, 'todos', row)) { next.push(row); continue; }
        const other = byId.get(id) || null;
        /* 클라우드에 없다는 것은 서버에서 받은 id 목록으로만 판단합니다(캐시 결과로는 지우지 않음). */
        if (!other && !(ids && !ids.has(id))) { next.push(row); continue; }
        const key = `todos/${id}`;
        const plan = planTodoConflict(row, { remote: other, soft: Boolean(remote.soft?.todos?.[id]), gone: remote.tombs?.todos?.[id], base: hashes?.[key], stale });
        if (!plan) { next.push(row); continue; }
        done.add(id);
        if (plan === 'keepCopy') {
            next.push(row);
            copies.push(conflictCopy(other));
            const mark = rowMark('todos', other); if (mark && hashes) hashes[mark.key] = mark.mark;
        } else if (plan === 'takeCopy') {
            const at = remote.ats?.todos?.[id];
            const got = { ...takeRemote('todos', row, other), editAt: Number.isFinite(at) ? at : 0 };
            delete got.editD;
            next.push(got);
            copies.push(conflictCopy(row));
            const mark = rowMark('todos', got); if (mark && hashes) hashes[mark.key] = mark.mark;
        } else {
            copies.push(conflictCopy(row));
            if (hashes) delete hashes[key];
        }
    }
    draft.todos = copies.length ? [...next, ...copies] : next;
    return done;
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

/** 오늘 조퇴 시각: 다른 기기가 더 늦게 정하거나 취소한 값을 받습니다. */
function absorbLeave(leave) {
    if (leave && Number(leave.at) > leaveState().at) setLeave(leave.d, leave.t, { at: Number(leave.at), fromCloud: true });
}

function pruneOnly(draft, remote, seen) {
    const guard = stableHashes(seen, cloudHashes);
    const before = new Set(Object.keys(guard));
    pruneDeletedElsewhere(draft, remote, guard);
    for (const key of before) if (!(key in guard)) delete cloudHashes[key];
    if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    return draft;
}

function seeRemoteClock(remote) {
    for (const name of LWW_NAMES) for (const at of Object.values(remote?.ats?.[name] || {})) seeClock(at);
    for (const name of LWW_NAMES) for (const at of Object.values(remote?.tombs?.[name] || {})) seeClock(at);
}

function absorbCloud(draft, remote, seen = null) {
    seeRemoteClock(remote);
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
    const settled = resolveTodoConflicts(draft, remote, guard);
    if (settled.size && Array.isArray(remote.todos)) remote = { ...remote, todos: remote.todos.filter((row) => !settled.has(String(row?.id))) };
    pruneDeletedElsewhere(draft, remote, guard);
    for (const [localName, cloudName] of CLOUD_COLLECTIONS) {
        if (localName === 'inbox') continue;
        draft[localName] = refreshShared(draft[localName] || [], remote[localName], cloudName, guard, remote.ats?.[cloudName], remote.soft?.[cloudName]);
    }
    if (guard !== cloudHashes) {
        for (const key of before) if (!(key in guard)) delete cloudHashes[key];
    }
    draft.students = unionById(draft.students, remote.students);
    draft.attendance = unionById(draft.attendance, (remote.attendance || []).map((row) => withRemoteAt('attendance', row, remote)));
    rememberPulledHashes(draft.attendance, remote.attendance, cloudHashes);
    if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    draft.records = unionById(draft.records, remote.records);
    draft.events = unionById(draft.events, (remote.events || []).map((row) => withRemoteAt('events', row, remote)));
    draft.todos = unionById(draft.todos, (remote.todos || []).map((row) => withRemoteAt('todos', row, remote)));
    draft.notes = unionById(draft.notes, (remote.notes || []).map((row) => withRemoteAt('notes', row, remote)));
    draft.notices = unionById(draft.notices, remote.notices);
    draft.legacyPages = unionById(draft.legacyPages, remote.legacyPages);
    draft.inbox = unionById(draft.inbox, withoutDropped(remote.inbox));
    for (const [day, value] of Object.entries(remote.timetable || {})) {
        const mine = draft.timetable[day];
        const remoteAt = remote.ats?.timetable?.[day];
        if (takeRemoteDay(mine, remoteAt, Boolean(mine) && unchangedSincePush(guard, 'timetable', { id: day, ...mine }))) draft.timetable[day] = remoteDay(value, remoteAt);
    }
    rememberAllPulled(draft, remote, cloudHashes);
    if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
    absorbSettings(draft, remote.settings);
    absorbLeave(remote.leave);
        absorbTabbar(remote.tabbar);
    absorbGoals(draft, remote.goal);
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
    state.goals = normalizeGoals(state.goals);
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
            /* 임시보관함 칸이 없어도 할 일은 열립니다. */
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
    if (local && from === 'cloud') {
        /* 이미 올린 줄을 민감한 낱말로 고치면 이 기기에만 두고, 클라우드 사본(예전 문구)도 지웁니다(PR #56 검수 4번). */
        const old = draft[bucket].find((item) => item?.id === row.id);
        if (old) forgetRow(bucket, old);
        draft[bucket] = dropId(draft[bucket], row.id);
    }
    if (!local && from === 'local') draft.local[bucket] = dropId(draft.local[bucket], row.id);
    const { localOnly: _localOnlyFlag, ...stored } = row;
    put(local ? draft.local[bucket] : draft[bucket], { ...stored, source: stored.source || 'app' });
    return draft;
}

/**
 * 번호 목록 → 지금 반 학생(겹치지 않게, 들어온 차례). 명단에 없는 번호는 뺍니다.
 * 지난 명단 학생(active: false)은 같은 번호라도 고르지 않습니다. 다른 기기에서 명단을 바꾸면 배열 앞쪽에 지난 학생이 올 수 있습니다.
 */
function manyStudents(students, nos) {
    const out = [];
    for (const value of nos) {
        const no = Number(value) || 0;
        if (!no) continue;
        const one = (students || []).find((row) => Number(row.no) === no && isActiveStudent(row));
        if (one && !out.includes(one)) out.push(one);
    }
    return out.slice(0, 40);
}

export async function saveQuick(input, now = new Date()) {
    const text = String(input.text || '').trim();
    if (!text) return { ok: false, message: '한 줄만 적어도 남길 수 있어요.' };
    const parsed = parseNote(text, now);
    /* 시안 A: 날짜·시각 낱말은 칩·알람으로 옮기고 할 일·일정 제목에서는 뺍니다. 기록·메모는 맨 앞 날짜 낱말만 빼고 본문을 그대로 둡니다. */
    const ahead = input.kind === '할 일' || input.kind === '일정';
    const paste = readJjaemPaste(text, { now, stripTime: ahead || !input.kind, future: ahead });
    const body = paste.body || text;
    const tags = [...new Set([...(input.tags || []), ...parsed.tags])].filter(Boolean).slice(0, 10);
    const sensitive = parsed.sensitive || isSensitiveText(text, tags);
    const no = parsed.studentNo || input.no || 0;
    const clock = seoulParts(now);
    /* 날짜는 쨈 규칙(「3일 동안」·「2일째」는 날짜 아님)으로만 읽고, 못 읽으면 오늘입니다. */
    const date = input.date || paste.date || clock.ymd;
    /* input.time을 넘긴 경우(빈 칸 포함)는 그 값을 따르고, 안 넘긴 쨈 빠른 입력만 본문에서 시각을 읽습니다. */
    const alarmTime = input.time !== undefined
        ? (isTodoTime(input.time) ? input.time : '')
        : (paste.time || '');
    let message = '남겼어요.';
    const failed = await update((draft) => {
        /* 지난 명단 학생(active: false)과 번호가 겹쳐도 지금 반 학생에게 붙입니다. */
        const student = draft.students.find((row) => row.no === Number(no) && isActiveStudent(row));
        const sid = student?.id || '';
        const kind = input.kind || '메모';
        const base = { source: 'app', at: now.toISOString() };
        const local = sensitive;
        if (['관찰', '상담', '보호자', '칭찬'].includes(kind)) {
            const chosen = tags.length ? tags : (kind === '관찰' ? ['학습'] : kind === '상담' ? ['교우'] : kind === '보호자' ? ['전화'] : []);
            const recordBody = readJjaemPaste(text, { now, stripTime: false, stripDate: 'lead' }).body || text;
            const row = {
                ...base,
                id: nid('rec'),
                date,
                kind,
                sid,
                text: recordBody,
                tags: chosen,
                neis: input.neis != null ? Boolean(input.neis) : kind === '관찰' || kind === '칭찬',
            };
            if (input.follow || (kind === '상담' && parsed.detectedDate && text.includes('다시'))) row.follow = input.follow || parsed.detectedDate;
            /* 여러 학생(input.nos): 학생마다 같은 기록을 하나씩 두고 아이디 앞부분(묶음)을 같게 합니다. 클라우드 칸은 그대로입니다. */
            const many = Array.isArray(input.nos) ? manyStudents(draft.students, [input.no, ...input.nos, parsed.studentNo]) : [];
            if (many.length >= 2) {
                const group = newGroupId(now.getTime());
                many.forEach((one, index) => {
                    put(local ? draft.local.records : draft.records, { ...row, id: groupRecordId(group, index), sid: one.id });
                });
                message = `${many.map((one) => one.name).join(', ')} 기록에 하나씩 넣었어요.`;
            } else {
                if (many.length === 1) row.sid = many[0].id;
                put(local ? draft.local.records : draft.records, row);
                const named = many[0] || student;
                message = named ? `${named.name} 기록에 넣었어요.` : '기록에 넣었어요.';
            }
        } else if (kind === '할 일') {
            const titleSrc = String(input.title || body).trim();
            /* 「밤 12시」는 오늘 00:00(이미 지남)이 아니라 다음 날 00:00(오늘 밤)으로 둡니다. */
            let due = input.due != null ? input.due : (paste.date || '');
            if (alarmTime === '00:00') due = addDaysYmd(due || clock.ymd, 1);
            const row = { ...base, id: nid('todo'), title: stripTokens(titleSrc) || titleSrc, done: false, due };
            if (alarmTime) row.time = alarmTime;
            put(local ? draft.local.todos : draft.todos, row);
            const timeLabel = alarmTime === '00:00' ? '오늘 밤 12시' : alarmTimeLabel(alarmTime);
            message = alarmTime ? `할 일에 넣고 ${timeLabel} 알림을 맞춰 두었어요.` : '할 일에 넣었어요.';
        } else if (kind === '일정') {
            const eventKind = ['학급', '학교', '휴일', '내 일정'].includes(input.eventKind) ? input.eventKind : '학급';
            const bits = [];
            if (input.memo) bits.push(String(input.memo));
            if (input.period) bits.push(input.periodEnd ? `${input.period}~${input.periodEnd}교시` : `${input.period}교시`);
            const row = {
                ...base,
                id: nid('event'),
                date,
                title: (stripTokens(String(input.title != null ? input.title : body).trim()) || body || text).slice(0, 60),
                kind: eventKind,
                memo: bits.join(' · ').slice(0, 300),
            };
            /* 날짜 칩(B1)으로 날짜 낱말을 뺀 제목이면 처음 적은 글을 raw에 둡니다. raw는 이 기기에만 두고 클라우드 칸에는 올리지 않습니다. */
            if (input.raw && String(input.raw).trim() !== row.title) row.raw = String(input.raw).trim().slice(0, 300);
            else if (!input.raw && paste.changed && paste.raw !== row.title) row.raw = paste.raw.slice(0, 300);
            if (alarmTime) row.time = alarmTime;
            else if (input.time) row.time = input.time;
            if (/^([01]\d|2[0-3]):[0-5]\d$/.test(input.endTime || '')) row.endTime = input.endTime;
            /* 「10:30~11:20」처럼 본문에서 읽은 범위는 끝 시각도 둡니다(시작을 따로 고른 경우는 빼요). */
            else if (input.endTime === undefined && paste.endTime && row.time === paste.time && paste.endTime > row.time) row.endTime = paste.endTime;
            put(local ? draft.local.events : draft.events, row);
            /* 시각이 있으면 안내 글에도 적어, 노란 카드에서 고른 시각(예: 저녁 오후 6시)이 들어갔는지 바로 보입니다. */
            const clockLabel = !row.time ? '' : row.endTime
                ? `${alarmTimeLabel(row.time)}부터 ${alarmTimeLabel(row.endTime)}까지예요.`
                : `${alarmTimeLabel(row.time)} 시작이에요.`;
            message = clockLabel ? `일정에 넣었어요. ${clockLabel}` : '일정에 넣었어요.';
        } else if (kind === '알림장') {
            const prev = (local ? draft.local.notices : draft.notices).find((item) => item.date === date);
            const row = { ...base, id: date, date, text: String(prev?.text || '').trim() ? `${prev.text}\n${text}` : text };
            put(local ? draft.local.notices : draft.notices, row);
            message = '알림장에 넣었어요.';
        } else {
            const noteBody = readJjaemPaste(text, { now, stripTime: false, stripDate: 'lead' }).body || text;
            put(local ? draft.local.notes : draft.notes, { ...base, id: nid('note'), text: noteBody, date, pinned: false });
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
 * 회의록 후보 id 가운데 클라우드에 이미 있거나(다른 기기가 등록) 지운 기록(할 일·일정 묘비)이 있는 것.
 * sure=false 면 서버에 닿지 못해 모릅니다(오프라인). 그때 빈 집합으로 보고 만들면 지운 항목이 되살아나므로(PR #64 r2 1번) 부른 쪽은 등록을 미룹니다.
 * 로그인하지 않았거나 클라우드를 쓰지 않는 기기는 다른 기기가 없으므로 sure=true 입니다.
 */
export async function minutesCloudCheck(ids = []) {
    const uid = state.auth?.uid;
    if (!uid || !ids.length || !cloudApi.minutesPeek || !cloudApi.available()) return { known: new Set(), sure: true };
    const out = await Promise.resolve(cloudApi.minutesPeek(uid, ids, { memoryOnly: memoryOnly || state.profile?.sharedPc })).catch(() => null);
    if (!out || typeof out !== 'object') return { known: new Set(), sure: false };
    return { known: new Set(ids.filter((id) => out[id] === true)), sure: ids.every((id) => typeof out[id] === 'boolean') };
}

/** 회의록 노란 카드에서 빼기로 정한 id 를 클라우드 묘비로 남깁니다(다른 기기에서 다시 묻지 않게). 못 쓰면 대기열에 두고 다시 씁니다(PR #64 r2 3번). */
export async function markMinutesDeclined(ids = []) {
    if (!state.auth?.uid || !ids.length) return 0;
    queueMinutesTombs(ids);
    return flushMinutesTombs();
}

/** 대기열의 '뺀 결정' 묘비를 씁니다. 쓴 개수. */
export async function flushMinutesTombs() {
    const uid = state.auth?.uid;
    const queue = readMinutesTombQueue();
    if (!uid || !queue.length || !cloudApi.tomb || !cloudApi.available()) return 0;
    const done = await Promise.resolve(cloudApi.tomb(uid, queue, { memoryOnly: memoryOnly || state.profile?.sharedPc })).catch(() => []);
    const written = Array.isArray(done) ? done.filter((id) => queue.includes(id)) : [];
    dropMinutesTombs(written);
    return written.length;
}

function minutesRowsById() {
    const out = new Map();
    for (const bucket of ['todos', 'events']) {
        for (const row of [...(state[bucket] || []), ...(state.local?.[bucket] || [])]) out.set(row.id, { bucket, row });
    }
    return out;
}

/**
 * 회의록을 저장한 뒤 본문에서 일정·할 일을 찾아 등록합니다(Minutes.jsx 저장 흐름).
 * - 분명한 줄은 바로 등록(auto), 흐린 줄은 노란 카드로 돌려줍니다(ask).
 * - 다른 기기에서 이미 등록했거나, 지웠거나(묘비), 빼기로 정한 id 는 다시 만들거나 묻지 않습니다.
 * - 클라우드를 확인하지 못하면(오프라인) 바로 등록을 미루고, 연결되면 다시 확인한 뒤 등록합니다(settleMinutesPending).
 * - 줄을 고쳐 다시 저장하면 사라진 옛 줄의 항목은 사용자가 손대지 않았을 때만 정리합니다.
 */
export async function registerMinutes({ id, title = '', date = '', text = '', prev = null, periods = DEFAULT_PERIODS, timeCtx = null } = {}) {
    const opts = { periods, title, timeCtx };
    const tidied = await tidyEditedMinutes(id, prev, { text, date }, opts);
    const byId = minutesRowsById();
    const found = freshCandidates(
        minutesCandidates(text, id, { ...opts, now: minutesNow(date) }),
        { registered: [...byId.keys()], remembered: notTidied([...readMinutesLinks(id), ...readMinutesGone()]) },
    );
    const check = await minutesCloudCheck([...found.auto, ...found.ask].map((item) => item.id));
    revivedTidied(check, found.auto);
    if (check.known.size) {
        found.auto = found.auto.filter((item) => !check.known.has(item.id));
        found.ask = found.ask.filter((item) => !check.known.has(item.id));
        /* 묘비가 30일 뒤 정리돼도 이 기기는 기억해 두고 되살리지 않습니다. */
        rememberMinutesLinks(id, [...check.known]);
    }
    if (!check.sure) {
        const deferred = found.auto.length;
        setMinutesPending(id, found.auto);
        return { count: 0, deferred, ask: found.ask, tidied, sure: false };
    }
    setMinutesPending(id, null);
    let count = 0;
    if (found.auto.length) {
        const put = await saveParsed(found.auto);
        if (put?.storageFailed) return { storageFailed: true, count: 0, deferred: 0, ask: [], tidied };
        rememberMinutesLinks(id, found.auto.map((item) => item.id));
        count = put?.count || 0;
    }
    await releaseTidied(found.auto);
    return { count, deferred: 0, ask: found.ask, tidied, sure: true };
}

/** 노란 카드 끝내기: 고른 카드는 등록하고, 모든 카드를 기억하며(다시 묻지 않음), 뺀 카드는 묘비로 다른 기기에 알립니다. */
export async function finishMinutesAsk(minutesId, items = [], chosen = []) {
    let put = null;
    if (chosen.length) {
        put = await saveParsed(chosen);
        if (put?.storageFailed) return put;
    }
    rememberMinutesLinks(minutesId, items.map((item) => item.id));
    const chosenIds = new Set(chosen.map((item) => item.id));
    /* 묘비 쓰기는 기다리지 않습니다(오프라인이면 몇 초 걸림). 못 쓴 것은 대기열에 남아 연결되면 다시 씁니다. */
    const declined = markMinutesDeclined(items.map((item) => item.id).filter((id) => !chosenIds.has(id))).catch(() => 0);
    return { ...(put || { ok: true, count: 0 }), declined };
}

/* 고친 줄을 되돌리면(PR #64 r3 F1): 이 기기가 정리하며 지운 id 는 클라우드 묘비가 있어도 '이미 있음'으로 보지 않습니다.
   정리 묘비는 사용자가 지운 기록이 아니기 때문입니다. 등록한 뒤 묘비를 풀어 다른 기기에서도 남게 합니다. */
function notTidied(ids) {
    const mine = new Set(readMinutesTidied());
    return ids.filter((id) => !mine.has(id));
}
function revivedTidied(check, items = []) {
    const mine = new Set(readMinutesTidied());
    for (const item of items) if (mine.has(item.id)) check.known.delete(item.id);
}
async function releaseTidied(items = []) {
    const mine = new Set(readMinutesTidied());
    const back = items.map((item) => item.id).filter((id) => mine.has(id) && minutesRowsById().has(id));
    if (!back.length) return;
    const uid = state.auth?.uid;
    if (uid && cloudApi.untomb && cloudApi.available()) {
        const done = await Promise.resolve(cloudApi.untomb(uid, back, { memoryOnly: memoryOnly || state.profile?.sharedPc })).catch(() => []);
        unnoteMinutesTidied(done);
    }
}

/** 고친 줄 정리: 옛 본문에서만 나온 항목 중 회의록이 만든 그대로인 것을 지웁니다. 지운 개수. */
async function tidyEditedMinutes(id, prev, next, opts) {
    if (!id || !prev) return 0;
    const byId = minutesRowsById();
    let n = 0;
    for (const item of vanishedCandidates(prev, next, id, opts)) {
        const hit = byId.get(item.id);
        if (!hit || !untouchedSince(item, hit.row, hit.bucket)) continue;
        const failed = await removeItem(hit.bucket, item.id);
        /* 고친 줄 정리는 사용자가 지운 게 아니므로, 줄을 되돌리면 다시 등록되게 '지움' 기억에서 뺍니다. */
        unnoteMinutesGone([item.id]);
        if (!failed?.storageFailed) { n += 1; noteMinutesTidied([item.id]); }
    }
    return n;
}

/** 오프라인에서 미룬 회의록 등록과 '뺀 결정' 묘비를 연결된 뒤 마저 합니다. 등록한 개수. */
export async function settleMinutesPending() {
    if (!state.auth?.uid) return 0;
    await flushMinutesTombs().catch(() => 0);
    let total = 0;
    for (const [mid, items] of Object.entries(readMinutesPending())) {
        const byId = minutesRowsById();
        const fresh = freshCandidates({ auto: Array.isArray(items) ? items : [], ask: [] }, { registered: [...byId.keys()], remembered: notTidied([...readMinutesLinks(mid), ...readMinutesGone()]) }).auto;
        if (!fresh.length) { setMinutesPending(mid, null); continue; }
        const check = await minutesCloudCheck(fresh.map((item) => item.id));
        if (!check.sure) continue;
        revivedTidied(check, fresh);
        if (check.known.size) rememberMinutesLinks(mid, [...check.known]);
        const rest = fresh.filter((item) => !check.known.has(item.id));
        if (rest.length) {
            const put = await saveParsed(rest);
            if (put?.storageFailed) continue;
            rememberMinutesLinks(mid, rest.map((item) => item.id));
            total += put?.count || 0;
        }
        await releaseTidied(rest);
        setMinutesPending(mid, null);
    }
    return total;
}

/**
 * 고른 항목은 할 일·일정에 넣고, 빼 둔 항목은 임시보관함(ssug-gyomu-inbox)에 둡니다.
 * 이미 등록된 아이디는 임시보관함으로 옮기지 않습니다.
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
    if (heldCount) parts.push(`${heldCount}개는 임시보관함에 뒀어요.`);
    if (skipped) parts.push(`겹친 ${skipped}개는 이미 있어서 넣지 않았어요.`);
    if (filled) parts.push('날짜가 비어 있던 일정은 오늘로 넣었어요.');
    let message = parts.join(' ');
    if (sensitiveCount) message = `이 내용은 이 기기에만 남겨 둘게요. ${message}`;
    return { ok: true, message, count, skipped, held: heldCount, sensitiveCount };
}

export async function dropInbox(id) {
    const target = inboxId(id);
    if (!target) return { ok: false, message: '임시보관함에서 찾지 못했어요.' };
    const failed = await update((draft) => {
        draft.inbox = (draft.inbox || []).filter((row) => row.id !== target);
        return draft;
    }, { undoable: true });
    if (failed?.storageFailed) return { ok: false, storageFailed: true, message: failed.message };
    await rememberDropped(target);
    if (state.auth?.uid) {
        deleteUserDoc(state.auth.uid, 'inbox', target, { memoryOnly: memoryOnly || state.profile.sharedPc }).catch(() => {});
    }
    return { ok: true, message: '임시보관함에서 지웠어요.' };
}

export async function promoteInbox(id) {
    const target = inboxId(id);
    const item = (state.inbox || []).find((row) => row.id === target);
    if (!item) return { ok: false, message: '임시보관함에서 찾지 못했어요.', count: 0 };
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
/*
 * 알림장·하루 메모의 쓰던 글 임시본(textDraft.js). 출결 임시본과 같이 localStorage에 동기로 남기고, 계정마다 따로 봅니다.
 * 공용 컴퓨터 모드에서는 이 기기에 글을 남기지 않도록 메모리에만 둡니다(앱을 닫으면 사라집니다).
 */
const textDraftMemory = memoryStore();
function textDraftStore() {
    if (memoryOnly || state.profile?.sharedPc) return textDraftMemory;
    try { return globalThis.localStorage || textDraftMemory; } catch { return textDraftMemory; }
}
export function keepTextDraft(key, text, base = '') {
    return writeTextDraft(key, { text, base }, { store: textDraftStore(), owner: draftOwner() });
}
export function takeTextDraft(key) {
    return readTextDraft(key, { store: textDraftStore(), owner: draftOwner() });
}
export function dropTextDraft(key) {
    clearTextDraft(key, { store: textDraftStore() });
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
    /* 출결만 견주므로 출결만 받습니다. */
    try { remote = await cloudApi.pull(uid, { memoryOnly: memoryOnly || state.profile.sharedPc, only: ['attendance'] }); } catch { remote = null; }
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
        if (index >= 0) draft.attendance[index] = takeRemote('attendance', draft.attendance[index], theirs);
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

/** 서버 기준 지금의 서울 날짜·시각. */
function seoulStamp() {
    const p = seoulParts(new Date(serverNow()));
    return { ymd: p.ymd, hm: p.hm };
}

/** 할 일 두 목록(클라우드·이 기기)을 한 줄씩. */
function allTodos(draft) {
    return [...(draft.todos || []), ...(draft.local?.todos || [])];
}

/**
 * 끝냄 표시를 바꿉니다. 끝낼 때 끝낸 날·시각(서울)을 적고, 풀면 지웁니다('' = 클라우드 칸도 지움).
 * 하루 목표에 닿으면 그 날 달성 기록을 남기고, 풀어서 목표 아래로 내려가면 지웁니다.
 * 돌려주는 값은 화면 효과·알림용입니다: { done, pri, title, allDone, goal, count, goalHit, goalCleared, storageFailed }.
 */
export async function toggleTodo(id) {
    let info = { done: false, pri: 2, title: '', allDone: false, goal: 0, count: 0, goalHit: false, goalCleared: false, found: false };
    const failed = await update((draft) => {
        const lists = [draft.todos, draft.local.todos];
        const { ymd, hm } = seoulStamp();
        let day = '';
        let turnedOn = false;
        let seen = false;
        for (const list of lists) {
            const row = list.find((item) => item.id === id);
            if (!row) continue;
            if (!seen) { turnedOn = !row.done; seen = true; info.pri = priOf(row); info.title = String(row.title || ''); }
            const before = row.doneOn;
            row.done = turnedOn;
            if (turnedOn) { row.doneOn = ymd; row.doneHm = hm; day = ymd; }
            else {
                if (!day && typeof before === 'string' && before) day = before;
                row.doneOn = '';
                row.doneHm = '';
            }
        }
        if (!seen) return draft;
        info.found = true;
        info.done = turnedOn;
        const settled = settleGoalDay(draft.goals, allTodos(draft), day, serverNow(), { unchecked: !turnedOn });
        draft.goals = settled.goals;
        info.goalHit = settled.hit;
        info.goalCleared = settled.cleared;
        const joined = joinedRows(draft.todos, draft.local.todos);
        info.allDone = turnedOn && allDoneToday(joined, ymd);
        info.goal = normalizeGoals(draft.goals).n;
        info.count = doneCount(joined, ymd);
        return draft;
    }, { undoable: true });
    if (failed?.storageFailed) return { ...info, storageFailed: true, done: false };
    return info;
}

/** 두 목록을 id 하나로(이 기기 줄이 같은 id면 이 기기 쪽). 오늘 목록이 다 끝났는지 셀 때만 씁니다. */
function joinedRows(cloudRows, localRows) {
    const map = new Map();
    for (const row of cloudRows || []) if (row?.id != null) map.set(String(row.id), row);
    for (const row of localRows || []) if (row?.id != null) map.set(String(row.id), row);
    return [...map.values()];
}

/** 하루 목표 개수(0은 끔). 고친 시각을 함께 남겨 다른 기기와 늦게 고친 쪽으로 맞춥니다. */
export async function setTodoGoal(n) {
    return update((draft) => {
        const goals = normalizeGoals(draft.goals);
        goals.n = cleanGoalN(n);
        goals.nAt = Math.max(serverNow(), goals.nAt + 1);
        /* 오늘 끝낸 개수로 이미 새 목표를 채웠으면 바로 기록합니다(배지는 지우지 않습니다). */
        draft.goals = settleGoalDay(goals, allTodos(draft), seoulYmd(new Date(serverNow())), serverNow()).goals;
        return draft;
    }, { undoable: true });
}

/** 다른 기기 목표 문서를 합치고, 받아 온 할 일로 오늘 목표를 채웠으면 배지를 더합니다(지우지는 않음). */
function absorbGoals(draft, remoteGoal) {
    const merged = mergeGoals(draft.goals, remoteGoal || null);
    const today = seoulYmd(new Date(serverNow()));
    const settled = settleGoalDay(merged, allTodos(draft), today, serverNow());
    if (!sameGoals(settled.goals, draft.goals)) draft.goals = settled.goals;
}

/** 중요도만 바꿉니다(1 낮음 · 2 보통 · 3 높음). */
export async function setTodoPri(id, pri) {
    if (!isPri(pri)) return null;
    return update((draft) => {
        for (const list of [draft.todos, draft.local.todos]) {
            const row = list.find((item) => item.id === id);
            if (row) row.pri = pri;
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
        if (row.pendingNos.length === 0 && !row.done) {
            const { ymd, hm } = seoulStamp();
            row.done = true;
            row.doneOn = ymd;
            row.doneHm = hm;
            draft.goals = settleGoalDay(draft.goals, allTodos(draft), ymd, serverNow()).goals;
        }
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
    if (bucket === 'todos' || bucket === 'events') { noteMinutesGone([id]); unnoteMinutesTidied([id]); }
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
        /* 쓰던 알림장·하루 메모 임시본도 이 컴퓨터에서 지웁니다. */
        try { clearAllTextDrafts({ store: globalThis.localStorage }); } catch { /* 없어도 됩니다. */ }
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

/**
 * 명단을 바꿉니다. text(붙여 넣은 글) 또는 [{ no, name, sex }] 를 받습니다.
 * 같은 번호·같은 이름이면 그 학생 그대로, 이름이 다르면 새 학생(새 아이디, 메모·생일 없음)입니다.
 * keep 에 든 번호는 이름만 고친 같은 학생으로 봅니다. 빠진 학생은 지우지 않고 지난 명단으로 남깁니다(기록·출결도 그대로).
 */
export async function replaceRoster(input, { keep = [] } = {}) {
    const parsed = Array.isArray(input)
        ? { students: input.map((row) => ({ no: Number(row.no), name: String(row.name || '').trim().slice(0, 20), sex: row.sex || '' })).filter((row) => row.no >= 1 && row.name), errors: [] }
        : parseRoster(input);
    if (!parsed.students.length && parsed.errors.length) return parsed;
    let changes = [];
    const failed = await update((draft) => {
        const plan = planRoster(draft.students, parsed.students, { keep });
        changes = plan.changes;
        draft.students = plan.students;
        draft.profile.classSize = parsed.students.length;
        return draft;
    });
    if (failed?.storageFailed) return failed;
    return { ...parsed, changes };
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
    /* 교시 수·길이·9·10교시·출퇴근 시각은 이 기기 저장소에 있어서 따로 읽어 넣습니다. */
    let periodLocal = null;
    try { periodLocal = readPeriodLocal(); } catch { /* 없어도 백업은 됩니다. */ }
    const data = buildExport(state, { includeLocal, at: new Date().toISOString(), periodLocal });
    /* G1: 교육 사이트 바로가기(이름·주소만)도 함께 넣습니다. */
    try { data.bookmarks = readLinks(); } catch { /* 없어도 백업은 됩니다. */ }
    downloadJson(`쨈 교무수첩-${seoulYmd()}.json`, data);
    return data;
}

export function downloadOriginal() {
    if (!state.local.backup?.payload) return false;
    downloadJson(`교무수첩-원본백업-${seoulYmd()}.json`, state.local.backup.payload);
    return true;
}

const KEPT_KINDS = ['events', 'notes', 'attendance', 'timetable'];
const keptKey = (k) => `${k.kind}\u0000${k.id}\u0000${Number(k.at) || 0}`;
/* 백업 파일의 보관함은 모양이 맞는 것만 받습니다. */
function keptFromFile(list) {
    if (!Array.isArray(list)) return [];
    return list.filter((k) => k && typeof k === 'object' && KEPT_KINDS.includes(k.kind) && (typeof k.id === 'string' || typeof k.id === 'number') && k.row && typeof k.row === 'object' && !Array.isArray(k.row))
        .map((k) => ({ kind: k.kind, id: String(k.id), at: Number(k.at) || 0, row: structuredClone(k.row), ...(typeof k.copy === 'string' ? { copy: k.copy } : {}) }));
}

/**
 * 합치기에서 학생을 아이디로 합칩니다. 이 기기에 있던 학생은 이 기기의 active 값(지금 반인지 지난 명단인지)을 지킵니다.
 * 합친 결과에 같은 번호의 지금 반 학생이 둘 이상이면 뒤에 들어온 쪽을 지난 명단(active: false)으로 두고, 그 수를 돌려줍니다.
 */
export function mergeStudents(current, incoming) {
    const map = new Map((current || []).map((item) => [item.id, item]));
    for (const item of incoming || []) {
        const mine = map.get(item?.id);
        if (mine) map.set(item.id, { ...item, active: mine.active !== false });
        else map.set(item?.id, item);
    }
    const list = [...map.values()];
    const seen = new Set();
    let parked = 0;
    const students = list.map((row) => {
        if (!isActiveStudent(row)) return row;
        const no = Number(row.no) || 0;
        if (!seen.has(no)) {
            seen.add(no);
            return row;
        }
        parked += 1;
        return { ...row, active: false };
    });
    return { students, parked };
}

function applyIncoming(draft, data, sensitive, mode, info = {}) {
    const merge = (current, incoming) => {
        if (mode === 'replace') return incoming || [];
        const map = new Map((current || []).map((item) => [item.id, item]));
        for (const item of incoming || []) map.set(item.id, item);
        return [...map.values()];
    };
    if (mode === 'replace') draft.students = data.students || [];
    else {
        const merged = mergeStudents(draft.students, data.students);
        draft.students = merged.students;
        info.parked = merged.parked;
    }
    draft.attendance = merge(draft.attendance, data.attendance);
    draft.records = merge(draft.records, sensitive.cloud);
    draft.events = merge(draft.events, data.events);
    draft.todos = merge(draft.todos, data.todos);
    draft.notes = merge(draft.notes, data.notes);
    draft.notices = merge(draft.notices, data.notices);
    if (Array.isArray(data.inbox)) draft.inbox = merge(draft.inbox, data.inbox);
    dropRegisteredInbox(draft);
    draft.legacyPages = merge(draft.legacyPages, data.legacy);
    /* 보관함: 합치기는 kind+id+at이 같은 것을 하나로(파일 값 우선) 두고 최근 KEPT_MAX개, 바꾸기는 파일 값으로 통째로. */
    const keptIn = keptFromFile(data.keptLegacy);
    if (mode === 'replace') draft.keptLegacy = keptIn.slice(-KEPT_MAX);
    else {
        const byKey = new Map();
        for (const k of [...(Array.isArray(draft.keptLegacy) ? draft.keptLegacy : []), ...keptIn]) {
            const key = keptKey(k);
            byKey.delete(key);
            byKey.set(key, k);
        }
        draft.keptLegacy = [...byKey.values()].sort((a, b) => (Number(a.at) || 0) - (Number(b.at) || 0)).slice(-KEPT_MAX);
    }
    draft.timetable = mode === 'replace' ? (data.timetable || {}) : { ...draft.timetable, ...(data.timetable || {}) };
    /* 학급 이름·교시 시작 시각: 바꾸기는 파일 값, 합치기는 지금 값이 비어 있을 때만 넣습니다(지금 설정을 덮지 않게). */
    if (data.profile?.className && (mode === 'replace' || !String(draft.profile.className || '').trim())) draft.profile.className = data.profile.className;
    const starts = incomingPeriodStarts(draft.profile, data.profile?.periodStarts, mode);
    if (starts) draft.profile.periodStarts = starts;
    /* 학년도·학사일정·고친 날·마감한 날·목표: 파일에 있을 때만 넣습니다(예전 판 백업은 지금 값을 둡니다). 학년도는 합치기에서 비어 있을 때만. */
    const settings = incomingSettings(draft, data, mode);
    draft.profile = settings.profile;
    if (settings.goals !== undefined) draft.goals = settings.goals;
    /* 이 기기 전용 자료는 기록만이 아니라 할 일·일정·메모·알림장·연락처·쪽까지 되살립니다. */
    draft.local = { ...incomingLocal(draft.local, data, mode, sensitive.local), backup: draft.local?.backup ?? null };
    draft.profile.started = true;
    /* 반 인원은 지금 반 학생만 셉니다(지난 명단 학생 빼고). */
    draft.profile.classSize = draft.students.filter(isActiveStudent).length || draft.profile.classSize;
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
    /* G1: 백업에 든 바로가기는 이 브라우저 목록에 모자란 것만 더합니다(바꾸기에서도 지우지 않음). */
    try { if (Array.isArray(data.bookmarks)) mergeLinks(readLinks(), data.bookmarks); } catch { /* 바로가기는 건너뜁니다. */ }
    const sensitive = splitSensitive(data.records || []);
    /* 교시 설정(이 기기 저장소)은 기록이 다 들어간 뒤에 넣습니다. 지금 고친 것으로 찍혀 다른 기기에도 퍼집니다.
       바꾸기는 파일 값으로 바꾸고, 합치기는 지금 값이 비어 있는 칸에만 넣습니다(지금 설정을 덮지 않게). */
    const period = cleanPeriodLocal(data.periodLocal);
    const applyPeriod = (patch) => { if (patch) { try { patchPeriodLocal(patch); } catch { /* 교시 설정만 건너뜁니다. */ } } };
    const readPeriod = () => { try { return readPeriodLocal(); } catch { return null; } };
    if (mode !== 'replace') {
        const info = {};
        const failed = await update((draft) => applyIncoming(draft, data, sensitive, mode, info));
        if (failed?.storageFailed) return { ok: false, errors: [failed.message] };
        applyPeriod(fillPeriodLocal(readPeriod(), period));
        const parked = Number(info.parked) || 0;
        return {
            ok: true,
            kind: 'ssug-gyomu',
            localOnly: sensitive.local.length,
            parked,
            ...(parked ? { message: `같은 번호 학생이 겹쳐 ${parked}명은 지난 명단으로 두었어요. 설정의 명단에서 확인해 주세요.` } : {}),
        };
    }
    let previous;
    try {
        previous = structuredClone(state);
        const exportedAt = new Date().toISOString();
        /* 바꾸기 전 안전 백업에는 교시 설정(이 기기 저장소 값)도 넣어, 되돌릴 때 함께 살아나게 합니다. */
        const payload = buildExport(state, { includeLocal: true, at: exportedAt, periodLocal: readPeriod() });
        JSON.stringify(payload);
        downloadJson(`쨈 교무수첩-바꾸기전-${seoulYmd()}.json`, payload);
        await hooks.onPhase?.('prepared');
        const next = structuredClone(state);
        next.local.backup = { exportedAt, payload };
        applyIncoming(next, data, sensitive, 'replace');
        /* update()를 거치지 않으므로, 바뀐 설정 칸(교시 시작·고친 날·학사일정)의 고친 시각을 여기서 찍습니다. */
        bumpSettingAts(next.profile, previous.profile);
        await hooks.onPhase?.('ready', next);
        state = next;
        mirrorTheme(state.profile.theme);
        emit();
        await persist();
        applyPeriod(period);
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
const ACCOUNT_PARTS = ['students', 'attendance', 'records', 'events', 'todos', 'notes', 'notices', 'timetable', 'legacyPages', 'inbox', 'goals', 'keptLegacy'];
const ACCOUNT_PROFILE = ['className', 'schoolYear', 'classSize', 'periodStarts', 'ttEdited', 'academic', 'settingsAts', 'settingsAt', 'checkedDates'];
const accountKey = (uid) => `account:${uid}`;

/**
 * 계정을 바꿀 때: 지금 자료(아직 안 올린 변경 포함)와 해시를 이전 계정 몫으로 보관하고,
 * 새 계정의 보관본이 있으면 되살리고 없으면 비운 뒤 새 계정 자료를 받아 옵니다. 보관에 실패하면 아무것도 바꾸지 않습니다.
 */
async function switchAccountLocal(from, to) {
    clearAttendDraft();
    draftWatch = null;
    /* 탭바 배치는 계정 vault와 같이 uid별로 바꿉니다(A 배치가 B로 올라가지 않게). */
    switchTabAccount(from, to);
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
            switchTabAccount(to, from);
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
        /* 화면 자료 되돌림과 같이 탭바도 다시 바꿉니다. */
        switchTabAccount(to, from);
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

async function connectCloud(uid, opts = {}) {
    syncBegin();
    let ok = false;
    try {
        ok = await connectCloudBody(uid, opts);
        /* 오프라인에서 미룬 회의록 등록·뺀 결정을 연결된 뒤 마저 합니다(PR #64 r2 1·3번). 다시 확인하지 못하면 다음 연결 때. */
        if (ok && state.auth?.uid === uid) await settleMinutesPending().catch(() => 0);
        return ok;
    } finally {
        /* 일부 받기는 '마지막 동기화' 시각을 바꾸지 않습니다(칩이 다른 컬렉션까지 방금 맞춘 것처럼 보이지 않게). */
        syncEnd({ ok, pull: true, pending: ok ? 0 : undefined, ...(opts.only ? { stamp: false } : {}) });
    }
}

/*
 * 다 올리고 받아 합쳤으면 true. only가 있으면 그 컬렉션만 받습니다(감시가 '바뀜'을 알린 컬렉션).
 * 일부 받기는 읽지 않은 컬렉션의 목록·ids를 두지 않으므로 그 컬렉션 줄은 지우지도 바꾸지도 않습니다(cloud.js blankPull).
 * '마지막 동기화' 시각(지운 표시 보관 기간 판단에도 씀)은 전체 받기에서만 바꿉니다.
 */
async function connectCloudBody(uid, { only = null, force = false, clockDone = false } = {}) {
    await checkDraftAgainstCloud(uid);
    /* 서버 시각은 접속(로그인·계정 연결)마다 한 번 잽니다. 기기 시계가 바뀌었거나(clockStale), 직접 맞추기(force)면 다시 잽니다.
       못 쟀으면(clockOk 아님) 예전처럼 받을 때마다 다시 재고, 1분마다 다시 재기도 그대로 돕니다. */
    /* 재기가 실패해 '의심' 상태면 1분 간격 다시 재기(startClockRetry)에 맡기고 여기서는 재지 않습니다. 직접 맞추기는 한 번 잽니다. */
    if (!clockDone && (force || (!clockSuspect && clockStale(uid)))) await syncServerClock(uid);
    sweepOldTombs(uid);
    const full = !only;
    /* 일부 받기(감시 알림)는 먼저 올리지 않습니다. 이 기기 변경은 고칠 때마다 따로 올라가고, 못 올린 줄은 합치기가 지킵니다(해시가 다르면 이 기기 값).
       그래서 일부 받기의 성공은 받기만 보고, 칩의 '마지막 동기화'는 바꾸지 않습니다(connectCloud stamp: false). */
    const pushed = full ? await flushCloud().catch(() => null) : { ok: true };
    const from = serverNow();
    const seen = { ...cloudHashes };
    const remote = await cloudApi.pull(uid, { memoryOnly: memoryOnly || state.profile.sharedPc, ...(only ? { only } : {}) });
    if (!remote) return false;
    if (full && remote.fresh !== false && state.auth?.uid === uid) noteFullPull(uid, from);
    const hasRemote = remote.settings || remote.leave || remote.tabbar || remote.goal || remote.profile?.className || ['students', 'records', 'inbox', 'todos', 'events', 'attendance', 'notes', 'notices'].some((name) => (remote[name] || []).length) || Object.keys(remote.timetable || {}).length;
    if (!hasRemote) {
        /* 클라우드가 비었어도(다른 기기에서 마지막 줄까지 지움) 올린 그대로인 줄은 지웁니다(PR #52 2차 검수 1번). */
        await absorbQuietly(full, (draft) => pruneOnly(draft, remote, seen));
        const ok = pushedAll(pushed) && remote.fresh !== false;
        if (ok && full) markSynced(uid);
        return ok;
    }
    await absorbQuietly(full, (draft) => absorbCloud(draft, remote, seen));
    /* 올리기가 다 끝나고 서버에서 받아 왔어야 '동기화됨'입니다. 못 올린 게 있거나 캐시에서 온 옛 목록이면 시각을 바꾸지 않습니다(PR #52 검수 4번, 10/31 제보). */
    const ok = pushedAll(pushed) && remote.fresh !== false;
    if (ok && full) markSynced(uid);
    return ok;
}

/* 일부 받기에서 합칠 때는 뒤이은 올리기가 칩 시각을 바꾸지 않게 표시합니다. */
async function absorbQuietly(full, recipe) {
    if (full) return updateFromCloud(recipe);
    partialAbsorb += 1;
    try { return await updateFromCloud(recipe); } finally { partialAbsorb -= 1; }
}

/*
 * 서버 시각을 다시 잴지. 예전에는 받을 때마다(5분마다) 계정 문서에 쓰고 읽었습니다.
 * 이제 접속마다 한 번 재고, 다음 때만 다시 잽니다.
 *  - 기기 시계가 바뀜: 잰 뒤 기기 시계(Date.now)가 흐른 양과 단조 시계(performance.now)가 흐른 양이 30초 넘게 어긋남
 *    (윈도 시간 동기화·CMOS 보정·직접 변경. 노트북 잠자기도 여기에 걸려 한 번 더 잴 수 있음).
 *  - 켜 둔 채 오래 지남(CLOCK_REFRESH_MS).
 *  - 직접 맞추기(force 받기), 쓰기 거절·진 줄이 나옴(markClockDoubt: 보정값이 틀려 notAhead·LWW에 걸렸을 수 있음).
 */
export const CLOCK_REFRESH_MS = 12 * 3600 * 1000;
export const CLOCK_DRIFT_MS = 30 * 1000;
let monoNow = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
/** 검사용: 단조 시계를 바꿔 끼웁니다(가짜 시간으로 몇 시간을 돌릴 때 기기 시계와 함께 흐르게). */
export function useMonoClockForTest(fn = null) { monoNow = fn || (() => (globalThis.performance?.now ? globalThis.performance.now() : Date.now())); }
let clockFor = { uid: '', dev: 0, mono: 0, doubt: false };
function clockStale(uid) {
    if (!clockOk || clockFor.uid !== uid || clockFor.doubt) return true;
    const mono = monoNow() - clockFor.mono;
    const dev = deviceNow() - clockFor.dev;
    return Math.abs(dev - mono) > CLOCK_DRIFT_MS || mono >= CLOCK_REFRESH_MS || mono < 0;
}
/*
 * 시계가 바뀐 것을 알아챘거나 거절 뒤 다시 재다 실패하면(오프라인 등) '의심' 상태로 둡니다. 그동안은 올리기·받기에서 다시 재지 않고
 * 1분 간격 다시 재기(startClockRetry)만 돕니다. 재기마다 계정 문서 쓰기가 5초 제한까지 기다려 올리기 줄이 늦어지고,
 * 끝나지 않은 쓰기가 오프라인 대기열에 쌓였다가 한꺼번에 나가지 않게 합니다. 재기가 성공하면 풉니다.
 */
let clockSuspect = false;
/** 올리기·받기 경로에서 지금 다시 잴지(잰 적이 있고 의심 상태가 아니며 시계가 바뀌었거나 거절이 있었음). 오프라인이면 올리기 안에서는 재지 않습니다. */
function clockNeeds(uid, { inPush = false } = {}) {
    if (!clockOk || clockSuspect) return false;
    if (inPush && globalThis.navigator?.onLine === false) return false;
    return clockStale(uid);
}
/* 쓰기가 거절되거나 진 줄이 나오면 다음 받기에서 서버 시각을 다시 잽니다. 10분에 한 번까지이고,
   같은 줄의 거절이 이어지면(늘 거절되는 줄) 1시간에 한 번까지로 늘립니다. */
let clockDoubt = { at: -Infinity, sig: '' };
export function markClockDoubt(rejected = []) {
    const now = monoNow();
    const sig = [...rejected].map(String).sort().join(',');
    const gap = sig && sig === clockDoubt.sig ? 60 * 60 * 1000 : 10 * 60 * 1000;
    if (now - clockDoubt.at < gap && now >= clockDoubt.at) return false;
    clockDoubt = { at: now, sig };
    clockFor = { ...clockFor, doubt: true };
    return true;
}
/** 검사용: 의심 상태·다시 재기 상태. */
export function clockStateForTest() { return { ok: clockOk, suspect: clockSuspect, retrying: Boolean(clockRetry), doubt: clockFor.doubt }; }

/* 서버 시각과 이 기기 시계의 차이를 잽니다(로그인·다시 맞추기 때). 못 재면 마지막으로 잰 값을 그대로 씁니다. */
async function syncServerClock(uid) {
    if (!cloudApi.clock) return;
    try {
        const offset = await cloudApi.clock(uid, { memoryOnly: memoryOnly || state.profile.sharedPc, now: () => deviceNow() });
        if (setClockOffset(offset)) { clockFor = { uid, dev: deviceNow(), mono: monoNow(), doubt: false }; clockSuspect = false; stopClockRetry(); await settleUnsureEdits(); return true; }
    } catch { /* 아래에서 다시 잽니다. */ }
    /* 잰 적이 있는데 다시 재기가 실패: 의심 상태로 두고 1분 간격 다시 재기만 돌립니다. */
    if (clockOk) clockSuspect = true;
    startClockRetry(uid);
    return false;
}
/* 오래된 묘비 정리: 서버 시각을 잰 기기에서 실행마다 한 번. 실패해도 다음에 다시 합니다. */
let sweptFor = '';
function sweepOldTombs(uid) {
    if (!clockOk || !cloudApi.sweep || sweptFor === uid) return;
    sweptFor = uid;
    Promise.resolve(cloudApi.sweep(uid, serverNow(), { memoryOnly: memoryOnly || state.profile.sharedPc })).catch(() => { sweptFor = ''; });
}
/* 못 쟀으면 1분마다 다시 잽니다. 재면 보류한 할 일을 올립니다. */
export const CLOCK_RETRY_MS = 60 * 1000;
let clockRetry = null;
let clockRetryMs = CLOCK_RETRY_MS;
/** 검사용: 다시 재기 간격을 줄입니다. */
export function useClockRetryForTest(ms = null) { clockRetryMs = ms || CLOCK_RETRY_MS; }
function stopClockRetry() { if (clockRetry) { clearInterval(clockRetry); clockRetry = null; } }
function startClockRetry(uid) {
    if (clockRetry || (clockOk && !clockSuspect) || typeof setInterval !== 'function') return;
    clockRetry = setInterval(async () => {
        if ((clockOk && !clockSuspect) || state.auth?.uid !== uid) { stopClockRetry(); return; }
        if (await syncServerClock(uid)) flushCloud().catch(() => {});
    }, clockRetryMs);
    clockRetry?.unref?.();
}
/** 검사용: 다시 재기를 바로 한 번 돌립니다. */
export async function retryServerClockForTest() { const uid = state.auth?.uid; return uid ? syncServerClock(uid) : false; }
/** 재기 전에 고친 할 일·일정·회의록·출결·시간표와 지운 기록의 시각을 서버 기준으로 바꿉니다. */
async function settleUnsureEdits() {
    let forgot = false;
    for (const entry of cloudForget.values()) {
        if (!Number.isFinite(entry.d)) continue;
        const at = settleDeviceTime(entry.d);
        if (at > 0) { entry.at = at; entry.server = true; delete entry.d; forgot = true; }
        /* 지운 시각을 믿을 수 없음: 시각 대신 지문(expect)이 맞을 때만 지웁니다. */
        else if (at < 0) { entry.at = 0; entry.exact = true; delete entry.d; forgot = true; }
    }
    if (forgot) saveCloudForget();
    const unsure = (row) => !(row?.editAt > 0) && Number.isFinite(row?.editD);
    /* 줄(행) 목록이지 배열의 배열이 아닙니다. 시간표는 요일 객체 자체가 한 줄입니다. */
    const rowsOf = (draft) => [
        ...(draft.todos || []), ...(draft.local?.todos || []),
        ...(draft.events || []), ...(draft.notes || []), ...(draft.attendance || []),
        ...Object.values(draft.timetable || {}).filter((v) => v && typeof v === 'object'),
    ];
    if (!rowsOf(state).some(unsure)) return;
    await updateFromCloud((draft) => {
        for (const row of rowsOf(draft)) {
            if (!unsure(row)) continue;
            const at = settleDeviceTime(row.editD);
            if (at > 0) { row.editAt = at; delete row.editD; }
            /* 고친 시각을 믿을 수 없음: '모름'(editAt 0, editD 없음)으로 둡니다. 일정·회의록·출결·시간표는 stampUnsentLegacy가,
               할 일은 planTodoConflict(legacy)가 클라우드 판과 견줘, 다르면 사본(또는 보관)으로 양쪽을 남깁니다. */
            else if (at < 0) { row.editAt = 0; delete row.editD; }
        }
        return draft;
    });
}

/*
 * 할 일은 항목마다 '마지막으로 고친' 쪽이 이깁니다(올린 순서가 아님). 올리기 전에, 이 기기에서 고치고 아직 못 올린 할 일의
 * 클라우드 상태를 서버에서 바로 봅니다.
 *  - 다른 기기가 더 늦게 고쳤으면 그 값을 받고 올리지 않습니다(옛 수정이 새 수정을 덮지 않게).
 *  - 다른 기기가 더 늦게 지웠으면(묘비) 이 기기에서도 지웁니다(되살아나지 않게).
 *  - 그 밖(이 기기가 더 늦음, 시각을 모름, 한쪽에만 있음)은 이 기기 값을 지키고 올립니다.
 * 서버에 닿지 못하면 아무것도 바꾸지 않습니다(올리기도 실패해 다음에 다시 봅니다).
 */
let heldTodos = new Set();
/** 검사용: 지금 보류 중인 할 일 id. */
export function heldTodosForTest() { return [...heldTodos]; }
/** 검사용: 올리기 전 다른 기기 값 견주기(peek)만 돌립니다. */
export function reconcileForTest(uid) { return reconcileDirtyTodos(uid); }
async function reconcileDirtyTodos(uid) {
    heldTodos = new Set();
    if (!cloudApi.peek) return;
    const dirty = (state.todos || []).filter((row) => row?.id && toCloudRow('todos', row) && !unchangedSincePush(cloudHashes, 'todos', row));
    if (!dirty.length) return;
    const ids = dirty.map((row) => toCloudRow('todos', row).id);
    let seen = null;
    try { seen = await cloudApi.peek(uid, ids, { memoryOnly: memoryOnly || state.profile.sharedPc }); } catch { seen = null; }
    if (!seen || state.auth?.uid !== uid) return;
    for (const value of Object.values(seen)) { seeClock(value?.at); seeClock(value?.gone); }
    /* 서버 시각을 못 잰 채 고친 할 일(고친 시각 모름): 마지막으로 맞춘 뒤 다른 기기가 고치거나 지웠으면 누가 늦은지 모르므로
       올리지도 버리지도 않고 보류합니다. 시각을 재면 다시 견줍니다. 다른 기기가 손대지 않았으면 올린 시각으로 올립니다. */
    const stale = staleSync(uid);
    const plans = new Map();
    for (const row of dirty) {
        const id = toCloudRow('todos', row).id;
        const value = seen[id];
        if (!value) continue;
        const plan = planTodoConflict(row, { remote: value.row || null, soft: Boolean(value.soft), gone: value.gone, base: cloudHashes[`todos/${id}`], stale });
        if (plan) plans.set(id, plan);
    }
    for (const row of dirty) {
        if (row.editAt > 0 || !Number.isFinite(row.editD) || plans.has(toCloudRow('todos', row).id)) continue;
        const id = toCloudRow('todos', row).id;
        const value = seen[id];
        if (!value) continue;
        const base = cloudHashes[`todos/${id}`];
        const theirs = value.row ? rowMark('todos', value.row)?.mark : null;
        if (value.row ? !(base && theirs && printDigest(theirs) === printDigest(base)) : Number.isFinite(value.gone)) heldTodos.add(id);
    }
    const verdict = (row) => {
        const value = seen[toCloudRow('todos', row)?.id];
        if (!value || unchangedSincePush(cloudHashes, 'todos', row)) return null;
        const plan = plans.get(toCloudRow('todos', row)?.id);
        if (plan) return { plan, value };
        if (value.row && value.soft) return null;
        if (value.row && remoteIsLater(row, value.at)) return { take: value };
        if (!value.row && remoteIsLater(row, value.gone)) return { drop: true };
        return null;
    };
    if (!dirty.some(verdict)) return;
    const taken = [];
    const dropped = [];
    const copies = [];
    const seenAsBase = [];
    await updateFromCloud((draft) => {
        const next = [];
        for (const row of draft.todos || []) {
            const v = row?.id ? verdict(row) : null;
            if (v?.plan === 'keepCopy') { next.push(row); copies.push(conflictCopy(v.value.row)); seenAsBase.push(v.value.row); continue; }
            if (v?.plan === 'takeCopy') { const got = { ...takeRemote('todos', row, v.value.row), editAt: Number.isFinite(v.value.at) ? v.value.at : 0 }; delete got.editD; taken.push(got); next.push(got); copies.push(conflictCopy(row)); continue; }
            if (v?.plan === 'dropCopy') { dropped.push(String(row.id)); copies.push(conflictCopy(row)); continue; }
            if (v?.drop) { dropped.push(String(row.id)); continue; }
            if (v?.take) { const got = { ...takeRemote('todos', row, v.take.row), editAt: v.take.at }; taken.push(got); next.push(got); continue; }
            next.push(row);
        }
        draft.todos = [...next, ...copies];
        return draft;
    });
    for (const row of seenAsBase) { const mark = rowMark('todos', row); if (mark) cloudHashes[mark.key] = mark.mark; }
    /* 받은 값은 클라우드와 같으므로 '올린 것'으로 적어 둡니다. 지운 줄의 해시는 지웁니다. */
    for (const row of taken) { const mark = rowMark('todos', row); if (mark) cloudHashes[mark.key] = mark.mark; }
    for (const id of dropped) delete cloudHashes[`todos/${id}`];
    if (!memoryOnly) mainVault.set('cloudHashes', cloudHashes).catch(() => {});
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
    const from = serverNow();
    try { remote = await cloudApi.pull(uid, { memoryOnly: memoryOnly || state.profile.sharedPc }); } catch { remote = null; }
    if (!remote) return { ok: false, reason: 'pull' };
    if (state.auth?.uid !== uid) return { ok: false, reason: 'login' };
    if (remote.fresh !== false) noteFullPull(uid, from);
    if (!memoryOnly) {
        try {
            await mainVault.set(BEFORE_PULL_KEY, { at: Date.now(), uid, data: structuredClone({ ...state, auth: null }) });
        } catch {
            return { ok: false, reason: 'backup' };
        }
    }
    let dropped = 0;
    seeRemoteClock(remote);
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
                    const later = !synced && LWW_NAMES.includes(cloudName) && mark && !rejected.has(mark.key) && remoteIsLater(row, remote.ats?.[cloudName]?.[String(row.id)]);
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
        for (const [day, value] of Object.entries(remote.timetable || {})) {
            const remoteAt = remote.ats?.timetable?.[day];
            if (takeRemoteDay(draft.timetable[day], remoteAt, true)) draft.timetable[day] = remoteDay(value, remoteAt);
        }
        absorbSettings(draft, remote.settings);
        absorbLeave(remote.leave);
        absorbTabbar(remote.tabbar);
        absorbGoals(draft, remote.goal);
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

/*
 * 받기 횟수 줄이기(1,000명 검수: 교무실 PC를 켜 두면 5분마다 전체 받기로 교사 1명이 하루 약 15만 읽기).
 * 실시간 감시가 살아 있으면 다른 기기의 변경은 감시가 알려 주므로, 주기적인 전체 받기를 멈춥니다.
 * 전체 받기를 하는 때(fullPullDue):
 *  - 로그인·앱 시작(첫 연결), 동기화 칩 직접 누르기(force), 올리기에서 진 줄(lost)이 나왔을 때: 늘.
 *  - 날짜가 바뀐 뒤 처음(하루 한 번, 감시로 못 잡는 지운 줄 확인), 오프라인에서 돌아왔을 때(online): 1분 간격 안에서 늘.
 *  - 감시가 살아 있을 때 앱으로 돌아오면(return: 페이지가 실제로 숨겨졌다가 다시 보임): 숨어 있던 시간이 30분 이상일 때만 바로 받습니다.
 *    휴대폰처럼 오래 숨었다가 돌아오면 그동안 감시가 끊겼을 수 있어 받습니다. 같은 창의 다른 탭(나이스 등)에 잠깐 다녀온 것,
 *    숨겨지지 않은 채 창 focus 만 바뀐 것(focus), 5분 타이머(timer)로는 받지 않습니다(아래 안전망만).
 *  - 안전망: 감시가 살아 있어도 마지막 전체 받기 뒤 2시간이 지나면 다음 돌아옴·타이머에서 한 번 받습니다.
 *    감시가 못 잡는 변경(오래 오프라인이던 기기가 늦게 올린 옛 고친 시각, updatedAt 없이 쓴 옛 판, 묘비 없는 지움)을 위해서입니다.
 *  - 감시가 없거나 죽었으면(옛 규칙 거절, 오프라인, 검사의 가짜 클라우드): 돌아옴·창 focus·타이머 모두 마지막 전체 받기 뒤 15분마다.
 * 감시가 알린 변경은 바뀐 컬렉션만 받습니다(refreshFromCloud({ only })).
 */
export const PULL_RULES = { minGapMs: 60 * 1000, staleMs: 30 * 60 * 1000, fallbackMs: 15 * 60 * 1000, safetyMs: 2 * 3600 * 1000 };

/** 지금 전체 받기를 할지 정합니다(순수 함수). reason: start·force·lost·online·return·focus·timer. hiddenMs: return 때 숨어 있던 시간. */
export function fullPullDue(reason, { now = 0, lastFull = 0, lastTry = 0, today = '', lastFullDay = '', watchLive = false, hiddenMs = 0 } = {}) {
    if (reason === 'start' || reason === 'force' || reason === 'lost') return true;
    if (now - lastTry < PULL_RULES.minGapMs && now >= lastTry) return false;
    if (!(lastFull > 0)) return true;
    if (today && lastFullDay && today !== lastFullDay) return true;
    if (reason === 'online') return true;
    /* 기기 시계가 뒤로 가면(now < lastFull) 오래된 것으로 보고 받습니다. */
    const since = now - lastFull;
    if (since < 0) return true;
    if (!watchLive) return since >= PULL_RULES.fallbackMs;
    /* 감시가 살아 있으면 짧게 숨었다 돌아온 것(같은 창의 다른 탭에 다녀옴)은 창 focus 와 같이 2시간 안전망만 봅니다. */
    if (reason === 'return') return Number(hiddenMs) >= PULL_RULES.staleMs || since >= PULL_RULES.safetyMs;
    if (reason === 'timer') return since >= PULL_RULES.safetyMs;
    return false;
}

let syncNow = () => Date.now();
/** 검사용: 받기 간격을 재는 시계를 바꿉니다. */
export function useSyncClockForTest(fn = null) { syncNow = fn || (() => Date.now()); }

let lastRefresh = 0;
/* 마지막으로 서버에서 다 받은 때(기기 시각), 그날(서울), 받기를 시작한 서버 시각(감시 시작점). 계정마다 새로 셉니다. */
let lastFullPull = { uid: '', at: 0, day: '', from: 0 };
function noteFullPull(uid, from) {
    lastFullPull = { uid, at: syncNow(), day: seoulYmd(new Date(serverNow())), from };
}
/** 검사용: 마지막 전체 받기 기록. */
export function lastFullPullForTest() { return { ...lastFullPull }; }

/*
 * 다른 기기가 고치면(시각만 바꾸거나 지운 것도) 새로고침 없이 받습니다(PR #62 r3 1번).
 * 감시는 바뀐 문서 목록을 알려 주고, 모아서(처음 0.8초) 이 기기가 이미 아는 값(올리거나 받은 해시와 같음)을 빼고 남은 컬렉션만 받습니다.
 * 받기 사이는 3초 이상 두고, 1분 안에 다섯 번 받았으면 20초로 늘려 다른 기기에서 연달아 고칠 때 받기가 몰리지 않게 합니다.
 * 받으면 알림 예약도 새 시각으로 다시 봅니다.
 */
export const WATCH_TIMING = { first: 800, gap: 3000, burstGap: 20000, burst: 5, burstWindow: 60 * 1000, retry: 15 * 60 * 1000, tombRetry: 5000 };
let watchTiming = { ...WATCH_TIMING };
/** 검사용: 감시 묶기 시간을 줄입니다. */
export function useWatchTimingForTest(timing = null) { watchTiming = timing ? { ...WATCH_TIMING, ...timing } : { ...WATCH_TIMING }; }
/* 감시 시작점: 마지막 전체 받기를 시작한 서버 시각보다 10분 앞. 기기가 고친 시각을 찍는 묶음은 하루 더 앞까지 봅니다(늦게 올린 오프라인 수정). */
const WATCH_LOOKBACK_MS = 10 * 60 * 1000;
const WATCH_LATE_MS = 24 * 3600 * 1000;
const blankWatch = () => ({ uid: '', stop: null, timer: 0, last: -Infinity, recent: [], pending: [], live: false, error: '', serverAt: 0, startedAt: 0, day: '', since: 0 });
/* 감시 시작점이 고정이라 오래 켜 두면 결과 목록이 커지고, 30분 넘게 끊겼다 이으면 그 목록을 다시 읽은 것으로 셉니다.
   날짜가 바뀐 뒤나 감시를 켠 지 6시간이 지난 뒤의 전체 받기에서, 그 받기를 시작한 때를 새 시작점으로 감시를 다시 켭니다. */
export const WATCH_RENEW_MS = 6 * 3600 * 1000;
let todoWatch = blankWatch();
const watchNow = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());
function stopTodoWatch() {
    try { todoWatch.stop?.(); } catch { /* 이미 꺼짐 */ }
    if (todoWatch.timer) clearTimeout(todoWatch.timer);
    todoWatch = blankWatch();
}
export function todoWatchForTest(on) { stopTodoWatch(); return on ? startTodoWatch(state.auth?.uid) : undefined; }
/** 감시가 살아 있는지: 모든 리스너가 붙어 오류 없이 서버 결과를 받고 있습니다. */
export function watchLive() { return Boolean(todoWatch.uid && todoWatch.stop && todoWatch.live && !todoWatch.error); }
/** 검사용: 감시 상태. */
export function watchStateForTest() { const { uid, live, error, serverAt, startedAt, pending, since, day } = todoWatch; return { uid, live, error, serverAt, startedAt, since, day, pending: pending.length, alive: watchLive() }; }

/*
 * 감시 알림에서 받을 컬렉션을 고릅니다(순수 함수). 이 기기가 올리거나 받은 값과 같으면(해시 같음) 받지 않습니다.
 * 이 기기가 막 올린 문서가 서버 시각을 달고 되돌아오는 경우가 여기서 걸러집니다.
 *  - 지워진 문서(removed): 이 기기가 아직 클라우드에 있다고 아는 줄(해시 있음)일 때만. 이 기기에서 지운 줄은 해시를 먼저 지웁니다.
 *  - 묘비: 그 줄이 이 기기에 있을 때만 그 컬렉션을 받습니다.
 *  - 설정 문서: 올린 값과 다를 때만(device는 실제로 쓴 문서 모양 'settings/device#doc'과 견줌).
 * 받을 것이 없으면 null, 알림 모양을 모르면(옛 감시) 'all'(전체 받기).
 */
export function watchPullNames(changes, { hashes = {}, has = () => false } = {}) {
    if (!Array.isArray(changes)) return 'all';
    const names = new Set();
    for (const c of changes) {
        if (!c || typeof c !== 'object' || !c.name) return 'all';
        if (c.name === 'settings') { if (!c.mark || hashes[c.id === 'device' ? 'settings/device#doc' : `settings/${c.id}`] !== c.mark) names.add('settings'); continue; }
        if (c.name === 'tombs') { if (!c.removed && c.of && (hashes[`${c.of}/${c.rowId}`] || has(c.of, c.rowId))) names.add(c.of); continue; }
        const key = `${c.name}/${c.id}`;
        if (c.removed) { if (hashes[key]) names.add(c.name); continue; }
        if (!c.mark || hashes[key] !== c.mark) names.add(c.name);
    }
    return names.size ? [...names] : null;
}

const LOCAL_OF = Object.fromEntries(CLOUD_COLLECTIONS.map(([localName, cloudName]) => [cloudName, localName]));
function hasLocalRow(cloudName, id) {
    const local = LOCAL_OF[cloudName];
    return Boolean(local) && (state[local] || []).some((row) => String(row?.id) === String(id));
}
/* 묘비로 받은 뒤에도 그 줄이 남아 있고, 묘비 시각이 그 줄 고친 시각보다 늦은지(모르면 남은 것만으로) */
function tombStillHere(change) {
    const local = LOCAL_OF[change.of];
    const row = local ? (state[local] || []).find((r) => String(r?.id) === String(change.rowId)) : null;
    if (!row) return false;
    const at = Number(change.at);
    const mine = Number(row.editAt);
    return !(Number.isFinite(at) && Number.isFinite(mine) && mine > 0 && mine >= at);
}

async function startTodoWatch(uid) {
    if (!cloudApi.watch || state.auth?.uid !== uid || todoWatch.uid === uid) return;
    stopTodoWatch();
    todoWatch.uid = uid;
    todoWatch.startedAt = syncNow();
    todoWatch.day = seoulYmd(new Date(serverNow()));
    const fire = async () => {
        todoWatch.timer = 0;
        if (state.auth?.uid !== uid || todoWatch.uid !== uid) return;
        /* 간격은 단조 시계로 잽니다. 기기 시계가 뒤로 가도(Date.now 감소) 감시가 멈추지 않습니다(PR #62 r4 3번). */
        const now = watchNow();
        todoWatch.recent = todoWatch.recent.filter((t) => now - t < watchTiming.burstWindow && t <= now);
        const gap = todoWatch.recent.length >= watchTiming.burst ? watchTiming.burstGap : watchTiming.gap;
        const wait = todoWatch.last + gap - now;
        if (wait > 0) { todoWatch.timer = setTimeout(fire, Math.min(wait, gap)); return; }
        /* 이 기기의 올리기가 끝난 뒤의 해시로 견줍니다(막 올린 문서가 되돌아온 알림을 거르려고). */
        try { await flushChain; } catch { /* 올리기 실패와 상관없이 견줍니다. */ }
        if (state.auth?.uid !== uid || todoWatch.uid !== uid) return;
        const changes = todoWatch.pending;
        todoWatch.pending = [];
        const names = changes.some((c) => c === 'all') ? 'all' : watchPullNames(changes, { hashes: cloudHashes, has: hasLocalRow });
        if (!names) return;
        todoWatch.last = watchNow();
        /* 설정 문서만 받는 것(문서 4개)은 몰림 셈에 넣지 않습니다. 이 기기가 올린 설정이 되돌아온 알림 때문에 할 일 받기가 늦어지지 않게 합니다. */
        if (names === 'all' || names.some((name) => name !== 'settings')) todoWatch.recent.push(todoWatch.last);
        const run = refreshFromCloud(names === 'all' ? { force: true } : { only: names });
        /* 옛 판은 묘비를 먼저 쓰고 문서는 나중에 지웁니다. 묘비 알림으로 받았는데 그 줄이 아직 남아 있고 묘비가 더 늦으면
           몇 초 뒤 그 컬렉션을 한 번 더 받습니다(한 번만). 그 문서가 감시 범위 밖 옛 문서면 지움 알림이 오지 않기 때문입니다. */
        const tombs = names === 'all' ? [] : changes.filter((c) => c?.name === 'tombs' && !c.removed && c.of && c.rowId);
        if (tombs.length) {
            run.then(() => {
                const again = [...new Set(tombs.filter((c) => tombStillHere(c)).map((c) => c.of))];
                if (!again.length || todoWatch.uid !== uid) return;
                setTimeout(() => { if (todoWatch.uid === uid) refreshFromCloud({ only: again }).catch(() => {}); }, watchTiming.tombRetry);
            }).catch(() => {});
        } else run.catch(() => {});
    };
    const onChange = (changes) => {
        if (todoWatch.uid !== uid) return;
        /* 옛 모양(인자 없는 알림)은 무엇이 바뀌었는지 모르므로 전체 받기로 합니다. */
        if (Array.isArray(changes)) todoWatch.pending.push(...changes); else todoWatch.pending.push('all');
        if (!todoWatch.timer) todoWatch.timer = setTimeout(fire, watchTiming.first);
    };
    const onStatus = (status) => {
        if (todoWatch.uid !== uid || !status) return;
        todoWatch.live = Boolean(status.live);
        todoWatch.error = String(status.error || '');
        if (status.live) { todoWatch.serverAt = syncNow(); watchRetries = 0; }
    };
    const since = (lastFullPull.uid === uid && lastFullPull.from > 0 ? lastFullPull.from : serverNow()) - WATCH_LOOKBACK_MS;
    todoWatch.since = since;
    let stop = null;
    try { stop = await cloudApi.watch(uid, onChange, { memoryOnly: state.profile?.sharedPc, since, lateSince: since - WATCH_LATE_MS, initial: true, onStatus }); } catch { stop = null; }
    if (todoWatch.uid !== uid) { try { stop?.(); } catch { /* 꺼짐 */ } return; }
    todoWatch.stop = typeof stop === 'function' ? stop : null;
}

/* 오류로 끝난 감시는 15분 뒤부터 다시 켜 봅니다(그 사이는 주기적인 전체 받기가 맡음). 또 실패하면 30분·1시간…(최대 4시간)으로 늘립니다.
   켤 때마다 최근 문서를 읽으므로, 옛 규칙처럼 늘 거절되는 감시를 자꾸 켜지 않게 합니다. 새 감시는 마지막 전체 받기 시점부터 봅니다. */
let watchRetries = 0;
function retryDeadWatch(uid) {
    if (!cloudApi.watch || todoWatch.uid !== uid || !todoWatch.error) return;
    if (Math.abs(syncNow() - todoWatch.startedAt) < watchTiming.retry * 2 ** Math.min(watchRetries, 4)) return;
    watchRetries += 1;
    stopTodoWatch();
    startTodoWatch(uid).catch(() => {});
}

/* 전체 받기가 서버에서 다 받았고(before 뒤 새 기록), 날짜가 바뀌었거나 감시가 오래됐으면 새 시작점으로 감시를 다시 켭니다.
   새 감시는 이번 전체 받기를 시작한 때 10분 앞부터 보므로 그 사이 변경을 놓치지 않습니다. */
function renewWatch(uid, before) {
    if (lastFullPull.uid !== uid || lastFullPull.at === before || todoWatch.uid !== uid || !todoWatch.stop) return;
    if (todoWatch.day === lastFullPull.day && Math.abs(syncNow() - todoWatch.startedAt) < WATCH_RENEW_MS) return;
    stopTodoWatch();
    startTodoWatch(uid).catch(() => {});
}

/**
 * 다른 기기에서 고친 것을 받아 옵니다.
 *  - force: 늘 전체 받기(동기화 칩, 진 줄).
 *  - only: 그 컬렉션만 받기(감시 알림). 간격은 감시가 따로 둡니다.
 *  - reason: 'return'(숨었다가 다시 보임, hiddenMs = 숨어 있던 시간), 'focus'(숨김 없이 창 focus 만 바뀜), 'online'(오프라인에서 돌아옴),
 *    'timer'(5분 타이머). fullPullDue가 받을지 정합니다.
 */
export async function refreshFromCloud({ force = false, only = null, reason = 'return', hiddenMs = 0 } = {}) {
    const uid = state.auth?.uid;
    if (!uid || !cloudApi.available() || connectTask?.uid !== uid) return { skipped: true };
    /* 잰 뒤 기기 시계가 바뀌었으면(30초 넘게 어긋남) 받지 않더라도 서버 시각은 다시 잽니다(5분 타이머·돌아옴마다 봄). */
    let clockDone = false;
    /* 오프라인에서 돌아오면 의심 상태라도 한 번 바로 잽니다(1분 간격 다시 재기를 기다리지 않게). */
    if (clockNeeds(uid) || (reason === 'online' && clockSuspect && !force && !only)) { await syncServerClock(uid); clockDone = true; }
    const now = syncNow();
    const parts = Array.isArray(only) && only.length ? only : null;
    if (!parts && !force) {
        if (reason === 'timer' || reason === 'return' || reason === 'focus') retryDeadWatch(uid);
        const mine = lastFullPull.uid === uid;
        const due = fullPullDue(reason, {
            now,
            lastTry: lastRefresh,
            lastFull: mine ? lastFullPull.at : 0,
            lastFullDay: mine ? lastFullPull.day : '',
            today: seoulYmd(new Date(serverNow())),
            watchLive: watchLive(),
            hiddenMs,
        });
        if (!due) return { skipped: true };
    }
    if (!parts) lastRefresh = now;
    try {
        await connectTask.promise;
        const before = lastFullPull.at;
        await connectCloud(uid, parts ? { only: parts, clockDone } : { force, clockDone });
        if (!parts) renewWatch(uid, before);
        return parts ? { ok: true, only: parts } : { ok: true };
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
        stopTodoWatch();
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
        /* 로그아웃: 지금 탭바를 이전 uid 몫으로 넣고 화면 키는 비웁니다. */
        if (from) parkTabAccount(from);
        connectTask = null;
        stopTodoWatch();
        return;
    }
    /* 같은 계정 재로그인(로그아웃 뒤): 보관해 둔 탭바를 되살립니다. 전환은 switchAccountLocal이 이미 처리. */
    if (!switching) adoptTabAccount(next.uid);
    if (connectTask?.uid === next.uid) return connectTask.promise;
    /* 새 접속: 서버 시각을 한 번 다시 잽니다(받을 때마다 재지는 않음). */
    clockFor = { uid: '', dev: 0, mono: 0, doubt: false };
    clockSuspect = false;
    const promise = connectCloud(next.uid).catch(() => false);
    connectTask = { uid: next.uid, promise };
    promise.then((ok) => {
        if (!ok && connectTask?.promise === promise) connectTask = null;
        startTodoWatch(next.uid);
    });
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
    /* 쓰던 알림장·하루 메모 임시본도 함께 비웁니다(다시 열었을 때 지운 글이 되살아나지 않게). */
    try { clearAllTextDrafts({ store: globalThis.localStorage }); } catch { /* 없어도 됩니다. */ }
    clearAllTextDrafts({ store: textDraftMemory });
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
