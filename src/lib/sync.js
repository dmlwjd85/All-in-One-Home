/**
 * 기기 사이 동기화에 쓰는 순수 함수 모음입니다.
 * 화면·저장소·파이어베이스를 모르고, 넣은 값만 보고 답을 냅니다. 그래서 node 검사로 바로 확인할 수 있어요.
 *
 * - 같은 기록이 두 기기에서 고쳐졌으면 updatedAt이 더 최근인 쪽을 남깁니다.
 * - updatedAt이 없는 옛 기록은 예전처럼 이 기기 것을 남깁니다(덮어쓰지 않음).
 * - 지운 기록은 대기열에 남겨 두었다가, 클라우드에서도 지워질 때까지 다시 시도합니다.
 */
import { cloudDocId, toCloudRow } from './cloudShape.js';
import { isSensitiveText } from './sensitive.js';

/** 화면 이름 → 클라우드 문서 묶음 이름. 정리함·보관함은 따로 다루므로 넣지 않습니다. */
export const SYNC_BUCKETS = [
    ['students', 'students'],
    ['attendance', 'attendance'],
    ['records', 'records'],
    ['events', 'events'],
    ['todos', 'todos'],
    ['notes', 'notes'],
    ['notices', 'notices'],
];

export const FORGET_LIMIT = 500;
export const FORGET_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
export const REFRESH_GAP_MS = 30 * 1000;

/** ISO 글, 숫자(ms), 파이어베이스 Timestamp 모두 ms로 바꿉니다. 모르면 0. */
export function timeOf(value) {
    if (value == null || value === '') return 0;
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : 0;
    if (typeof value?.toMillis === 'function') {
        const ms = value.toMillis();
        return Number.isFinite(ms) && ms > 0 ? ms : 0;
    }
    if (typeof value === 'object' && Number.isFinite(value.seconds)) {
        const ms = value.seconds * 1000 + Math.floor((Number(value.nanoseconds) || 0) / 1e6);
        return ms > 0 ? ms : 0;
    }
    if (typeof value === 'string') {
        const ms = Date.parse(value);
        return Number.isFinite(ms) && ms > 0 ? ms : 0;
    }
    return 0;
}

/** 클라우드 Timestamp를 기기에 둘 ISO 글로 바꿉니다. 없으면 빈 글. */
export function isoOf(value) {
    const ms = timeOf(value);
    return ms ? new Date(ms).toISOString() : '';
}

/**
 * 클라우드 쪽을 가져올지 정합니다.
 * - 클라우드에 시각이 없으면: 이 기기 것을 남깁니다.
 * - 둘 다 시각이 있으면: 더 최근인 쪽. 같으면 이 기기 것.
 * - 이 기기 쪽에 시각이 없으면(이 기능 전에 적은 옛 기록): 이 기기가 새 방식으로 바뀐 뒤(since)에
 *   다른 곳에서 고쳐진 경우에만 클라우드 것을 가져옵니다. 그 전 것은 예전처럼 이 기기 것을 남깁니다.
 *   단, 이 기기가 마지막으로 올린 내용 그대로라면(clean) 못 올린 고침이 없으니 클라우드 것을 받습니다.
 */
export function remoteWins(local, remote, { since = 0, clean = false } = {}) {
    const rt = timeOf(remote?.updatedAt);
    if (!rt) return false;
    const lt = timeOf(local?.updatedAt);
    if (lt) return rt > lt;
    if (clean) return true;
    const base = timeOf(since);
    return Boolean(base) && rt > base;
}

/** 이 기록이 클라우드에서 쓰는 문서 id. 내용이 민감해도 id는 셉니다(지울 때 필요). */
export function cloudIdOf(cloudName, row) {
    if (!row) return '';
    if (cloudName === 'notices') {
        if (/^\d{4}-\d{2}-\d{2}$/.test(row.id || '')) return row.id;
        return /^\d{4}-\d{2}-\d{2}$/.test(row.date || '') ? row.date : '';
    }
    if (cloudName === 'attendance') {
        const sid = cloudDocId(row.sid);
        if (sid && /^\d{4}-\d{2}-\d{2}$/.test(row.date || '')) return `${row.date}_${sid}`;
        return cloudDocId(row.id);
    }
    return cloudDocId(row.id);
}

export function keyOf(cloudName, id) {
    return id ? `${cloudName}/${id}` : '';
}

/**
 * 클라우드 것을 가져올 때 이 기기에만 있는 칸은 살립니다.
 * - 출처(source)는 이 기기 표시를 그대로 둡니다(보관함·충돌 표시가 바뀌지 않게).
 * - 학생 메모가 민감해서 클라우드에 없으면 이 기기 메모를 지우지 않습니다.
 */
export function takeRemote(cloudName, local, remote) {
    const next = { ...local, ...remote, id: local.id };
    if (local.source) next.source = local.source;
    if (cloudName === 'students' && isSensitiveText(local.memo) && !remote.memo) next.memo = local.memo;
    return next;
}

/**
 * 한 묶음을 합칩니다.
 * forgotten: 지우기 대기열에 있는 클라우드 id(Set). 아직 클라우드에서 안 지워졌어도 되살리지 않습니다.
 * seen: 전에 이 계정 클라우드에서 본 적 있는 키(Set). 서버에서 받은 목록에 없으면 다른 기기에서 지운 것입니다.
 * fromServer: 이번 목록이 서버에서 온 것인지. 캐시만 본 경우에는 지운 것으로 보지 않습니다.
 * isClean(row): 시각 없는 옛 줄이 이 기기가 마지막으로 올린 내용 그대로인지.
 */
export function mergeBucket(cloudName, local = [], remote = [], { since = 0, forgotten = new Set(), seen = null, fromServer = false, isClean = null } = {}) {
    const remoteById = new Map();
    for (const row of remote || []) {
        if (!row?.id) continue;
        const id = String(row.id);
        if (forgotten.has(id)) continue;
        remoteById.set(id, row);
    }
    const taken = [];
    const removed = [];
    const out = [];
    const used = new Set();
    for (const row of local || []) {
        const id = String(row?.id ?? '');
        const cloudId = cloudIdOf(cloudName, row);
        const match = remoteById.get(id) || (cloudId && cloudId !== id ? remoteById.get(cloudId) : null);
        if (match) {
            used.add(String(match.id));
            const clean = !timeOf(row?.updatedAt) && typeof isClean === 'function' && isClean(row);
            if (remoteWins(row, match, { since, clean })) {
                const next = takeRemote(cloudName, row, match);
                out.push(next);
                taken.push(next);
            } else {
                out.push(row);
            }
            continue;
        }
        const key = keyOf(cloudName, cloudId);
        const uploadable = Boolean(toCloudRow(cloudName, row));
        if (fromServer && seen && key && uploadable && seen.has(key)) {
            removed.push(row);
            continue;
        }
        out.push(row);
    }
    for (const [id, row] of remoteById) {
        if (used.has(id)) continue;
        out.push(row);
        taken.push(row);
    }
    return { rows: out, taken, removed };
}

/** 줄 단위로 비교해 바뀐 것에만 updatedAt을 붙입니다. 같은 시각을 그대로 둔 고침만 새로 찍습니다. */
export function stampList(prevList = [], nextList = [], nowIso, { force = false } = {}) {
    if (!Array.isArray(nextList)) return nextList;
    const before = new Map();
    for (const row of prevList || []) {
        if (row?.id != null) before.set(String(row.id), row);
    }
    return nextList.map((row) => {
        if (!row || typeof row !== 'object' || row.id == null) return row;
        const old = before.get(String(row.id));
        if (!old) {
            if ('updatedAt' in row && !force) return row;
            return { ...row, updatedAt: nowIso };
        }
        if (force) {
            // 되돌리기: 시각은 빼고 내용만 견줘서, 달라졌으면 지금 고친 것으로 찍습니다.
            if (sameRow({ ...old, updatedAt: '' }, { ...row, updatedAt: '' })) return { ...row, updatedAt: old.updatedAt };
            return { ...row, updatedAt: nowIso };
        }
        if (row.updatedAt !== old.updatedAt) return row;
        if (sameRow(old, row)) return row;
        return { ...row, updatedAt: nowIso };
    });
}

function sameRow(a, b) {
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

/** 시간표는 요일(또는 날짜)마다 따로 시각을 둡니다. */
export function stampTimetable(prevTable = {}, nextTable = {}, prevStamps = {}, nowIso) {
    const stamps = { ...(prevStamps || {}) };
    const days = new Set([...Object.keys(prevTable || {}), ...Object.keys(nextTable || {})]);
    for (const day of days) {
        if (!sameRow(prevTable?.[day] ?? null, nextTable?.[day] ?? null)) stamps[day] = nowIso;
    }
    return stamps;
}

/** 시간표 한 칸: 비어 있으면 받아 오고, 아니면 더 최근인 쪽을 둡니다. */
export function mergeTimetable(localTable = {}, remoteTable = {}, localStamps = {}, remoteStamps = {}, { since = 0 } = {}) {
    const table = { ...(localTable || {}) };
    const stamps = { ...(localStamps || {}) };
    const takenDays = [];
    for (const [day, value] of Object.entries(remoteTable || {})) {
        const empty = !table[day] || !Object.keys(table[day]).length;
        const win = remoteWins({ updatedAt: stamps[day] }, { updatedAt: remoteStamps?.[day] }, { since });
        if (empty || win) {
            table[day] = value;
            if (remoteStamps?.[day]) stamps[day] = remoteStamps[day];
            takenDays.push(day);
        }
    }
    return { table, stamps, takenDays };
}

/** 이전·다음 상태를 비교해 클라우드 묶음에서 빠진 줄과 다시 생긴 줄을 셉니다. */
export function diffCloudRows(prev = {}, next = {}) {
    const gone = [];
    const present = new Set();
    for (const [localName, cloudName] of SYNC_BUCKETS) {
        const nextIds = new Set();
        for (const row of next?.[localName] || []) {
            const id = cloudIdOf(cloudName, row);
            if (!id) continue;
            nextIds.add(id);
            present.add(keyOf(cloudName, id));
        }
        for (const row of prev?.[localName] || []) {
            if (!row || row.source === 'demo') continue;
            const id = cloudIdOf(cloudName, row);
            if (!id || nextIds.has(id)) continue;
            gone.push({ name: cloudName, id });
        }
    }
    return { gone, present };
}

/* ---------- 지우기 대기열 ---------- */

export function normalizeQueue(raw, now = Date.now()) {
    if (!Array.isArray(raw)) return [];
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const uid = String(item.uid || '');
        const name = String(item.name || '');
        const id = String(item.id || '');
        const at = timeOf(item.at) || now;
        if (!uid || !name || !id) continue;
        if (now - at > FORGET_MAX_AGE_MS) continue;
        const key = `${uid}|${name}/${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ uid, name, id, at });
    }
    return out.slice(-FORGET_LIMIT);
}

/** 대기열에 넣습니다. 같은 계정·같은 문서는 한 번만 둡니다. */
export function queueAdd(queue = [], entries = [], uid, now = Date.now()) {
    if (!uid) return normalizeQueue(queue, now);
    const add = entries.map((entry) => ({ uid, name: entry.name, id: entry.id, at: now }));
    return normalizeQueue([...(queue || []), ...add], now);
}

/** 다시 생긴 줄(되돌리기, 다시 결석 표시 등)은 대기열에서 뺍니다. */
export function queueDropPresent(queue = [], presentKeys = new Set(), uid) {
    return (queue || []).filter((item) => !(item.uid === uid && presentKeys.has(keyOf(item.name, item.id))));
}

export function queueRemove(queue = [], done = []) {
    const gone = new Set(done.map((item) => `${item.uid}|${item.name}/${item.id}`));
    return (queue || []).filter((item) => !gone.has(`${item.uid}|${item.name}/${item.id}`));
}

/** 이 계정에서 아직 클라우드에서 못 지운 id. 묶음 이름별 Set. */
export function forgottenIds(queue = [], uid) {
    const out = {};
    for (const item of queue || []) {
        if (item.uid !== uid) continue;
        if (!out[item.name]) out[item.name] = new Set();
        out[item.name].add(String(item.id));
    }
    return out;
}

/**
 * 대기열을 한 번 비워 봅니다. remove(name, id)는 {ok}를 돌려주는 함수입니다.
 * 실패하거나 너무 오래 걸리면 그대로 남겨 두고 다음에 다시 시도합니다.
 */
export async function drainQueue(queue = [], uid, remove, { timeoutMs = 12000 } = {}) {
    const mine = (queue || []).filter((item) => item.uid === uid);
    const done = [];
    await Promise.all(mine.map(async (item) => {
        let timer = 0;
        try {
            const result = await Promise.race([
                Promise.resolve().then(() => remove(item.name, item.id)),
                new Promise((resolveLater) => { timer = setTimeout(() => resolveLater({ ok: false, timeout: true }), timeoutMs); }),
            ]);
            if (result?.ok) done.push(item);
        } catch {
            /* 다음에 다시 시도합니다. */
        } finally {
            clearTimeout(timer);
        }
    }));
    return { done, left: queueRemove(queue, done) };
}

/* ---------- 다시 볼 때 받아오기 ---------- */

/** online은 바로, 다시 보이기·포커스는 30초에 한 번만 받아옵니다. */
export function shouldRefresh({ reason = 'visible', now = Date.now(), lastAt = 0, gapMs = REFRESH_GAP_MS, hidden = false } = {}) {
    if (hidden) return false;
    if (reason === 'online' || reason === 'login') return true;
    if (!lastAt) return true;
    return now - lastAt >= gapMs;
}
