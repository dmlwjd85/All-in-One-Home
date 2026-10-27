/**
 * 기기 사이 동기화에 쓰는 순수 함수 모음입니다.
 * 화면·저장소·파이어베이스를 모르고, 넣은 값만 보고 답을 냅니다. 그래서 node 검사로 바로 확인할 수 있어요.
 *
 * - 같은 기록이 두 기기에서 고쳐졌으면 updatedAt이 더 최근인 쪽을 남깁니다.
 * - updatedAt이 없는 옛 기록은 예전처럼 이 기기 것을 남깁니다(덮어쓰지 않음).
 * - 지운 기록은 대기열에 남겨 두었다가, 클라우드에서도 지워질 때까지 다시 시도합니다.
 */
import { cloudDocId, fromCloudRow, toCloudRow } from './cloudShape.js';

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
/** 서버 시각보다 이만큼 넘게 앞선 시각은 믿지 않습니다. */
export const FUTURE_SLACK_MS = 60 * 1000;
/** 서버 시각을 잴 때 왕복이 이보다 길면 버립니다(오차가 커서). */
export const CLOCK_MAX_RTT_MS = 5000;

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
 * - 클라우드로 못 가는 칸(민감한 메모·사유, 클라우드 모양에 없는 칸)은 클라우드 쪽이 비어 있으면 이 기기 값을 둡니다.
 *   예: 민감한 출결 메모가 있어 줄째로 안 올라간 출결을 다른 기기가 '지각'으로 고쳐도 메모·사유는 남습니다.
 */
function blank(value) {
    return value == null || value === '' || (Array.isArray(value) && !value.length);
}

export function takeRemote(cloudName, local, remote) {
    const next = { ...local, ...remote, id: local.id };
    if (local.source) next.source = local.source;
    const shaped = toCloudRow(cloudName, local);
    const reach = shaped ? fromCloudRow(cloudName, shaped.id, shaped.body) || {} : {};
    for (const [key, value] of Object.entries(local)) {
        if (key === 'id' || key === 'updatedAt' || key === 'source') continue;
        if (blank(value) || !blank(remote?.[key])) continue;
        if (shaped && sameRow(reach[key], value)) continue;
        next[key] = value;
    }
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
    const kept = [];
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
                // 이 기기 것이 더 최근인데 클라우드에는 옛 판이 있으면 다시 올리게 알려 줍니다.
                if (timeOf(row?.updatedAt) > timeOf(match.updatedAt)) kept.push(row);
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
    return { rows: out, taken, removed, kept };
}

/**
 * 고친 시각을 하나 정합니다. 앞서 찍힌 시각보다는 늘 뒤입니다(하이브리드 논리 시계).
 * 그래서 시계가 늦은 기기가 남의 고침을 받은 뒤 고쳐도, 받은 것보다 앞선 시각이 찍히지 않아요.
 */
export function stampAfter(nowIso, previous) {
    const now = timeOf(nowIso);
    const before = timeOf(previous);
    if (before && before >= now) return new Date(before + 1).toISOString();
    return nowIso;
}

/** 줄 단위로 비교해 바뀐 것에만 updatedAt을 붙입니다. 같은 시각을 그대로 둔 고침과 시각 없이 새로 만든 줄을 새로 찍습니다. */
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
            if (sameContent(old, row)) return { ...row, updatedAt: old.updatedAt };
            return { ...row, updatedAt: stampAfter(nowIso, old.updatedAt) };
        }
        // 받아 온 줄처럼 시각이 함께 바뀐 줄은 그 시각을 둡니다.
        if (row.updatedAt && row.updatedAt !== old.updatedAt) return row;
        // 시각 없이 새 객체로 저장했어도 내용이 같으면 옛 시각을 이어 둡니다.
        if (sameContent(old, row)) return row.updatedAt === old.updatedAt ? row : { ...row, updatedAt: old.updatedAt };
        return { ...row, updatedAt: stampAfter(nowIso, old.updatedAt) };
    });
}

function sameRow(a, b) {
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

/** 칸 순서와 updatedAt은 빼고 내용만 견줍니다. */
function sameContent(a, b) {
    const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
    keys.delete('updatedAt');
    for (const key of keys) {
        if (!sameRow(a?.[key], b?.[key])) return false;
    }
    return true;
}

/** 시간표는 요일(또는 날짜)마다 따로 시각을 둡니다. */
export function stampTimetable(prevTable = {}, nextTable = {}, prevStamps = {}, nowIso) {
    const stamps = { ...(prevStamps || {}) };
    const days = new Set([...Object.keys(prevTable || {}), ...Object.keys(nextTable || {})]);
    for (const day of days) {
        if (!sameRow(prevTable?.[day] ?? null, nextTable?.[day] ?? null)) stamps[day] = stampAfter(nowIso, stamps[day]);
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

/** online·로그인·다시 맞추기·옛 판 발견은 바로, 다시 보이기·포커스는 30초에 한 번만 받아옵니다. */
const REFRESH_NOW = new Set(['online', 'login', 'retry', 'stale']);

export function shouldRefresh({ reason = 'visible', now = Date.now(), lastAt = 0, gapMs = REFRESH_GAP_MS, hidden = false } = {}) {
    if (hidden) return false;
    if (REFRESH_NOW.has(reason)) return true;
    if (!lastAt) return true;
    return now - lastAt >= gapMs;
}

/* ---------- 기기 시계 맞추기 ---------- */

/**
 * 서버 시각과 이 기기 시계의 차이(ms)를 어림합니다. 크리스티안 방식: 서버가 찍은 시각은 보낸 때와 받은 때의 한가운데쯤.
 * 왕복이 너무 길거나 서버 시각이 없으면 null(이번 값은 버림).
 */
export function estimateOffset({ sentAt, receivedAt, serverAt, maxRtt = CLOCK_MAX_RTT_MS } = {}) {
    const sent = Number(sentAt);
    const got = Number(receivedAt);
    const server = timeOf(serverAt);
    if (!server || !Number.isFinite(sent) || !Number.isFinite(got) || got < sent) return null;
    if (got - sent > maxRtt) return null;
    return Math.round(server - (sent + got) / 2);
}

/**
 * 클라우드에 올릴 고친 시각(ms). serverNow는 서버 기준 지금(기기 시계 + 어림한 차이).
 * 없거나 서버 기준으로 1분 넘게 앞선 시각이면 지금 시각을 씁니다.
 */
export function uploadTime(value, serverNow) {
    const ms = timeOf(value);
    if (!ms || ms > serverNow + FUTURE_SLACK_MS) return serverNow;
    return ms;
}

/** 서버 기준으로 앞날에 찍힌 줄 시각을 지금으로 당깁니다. 바뀐 줄이 없으면 같은 목록을 돌려줍니다. */
export function clampFutureStamps(list, serverNow) {
    if (!Array.isArray(list)) return list;
    let changed = false;
    const out = list.map((row) => {
        const ms = timeOf(row?.updatedAt);
        if (!ms || ms <= serverNow + FUTURE_SLACK_MS) return row;
        changed = true;
        return { ...row, updatedAt: new Date(serverNow).toISOString() };
    });
    return changed ? out : list;
}

/* ---------- 올리기 전에 서버 판 보기 ---------- */

/**
 * 시각 있는 줄을 올리기 전에 서버 판을 보고 정합니다.
 * - 'write': 올립니다(서버에 없고 본 적도 없음, 또는 이 기기 것이 같거나 더 최근).
 * - 'stale': 서버 쪽이 더 최근이라 올리지 않습니다. 받아 와서 합치면 서버 것이 들어옵니다.
 * - 'gone': 전에 있던 문서가 서버에서 없어졌습니다. 다른 기기에서 지운 것이라 지운 쪽을 따릅니다
 *   (인터넷이 끊긴 채로 고친 것보다 지운 것이 이깁니다).
 */
export function pushDecision({ exists = false, serverMs = 0, localMs = 0, seen = false } = {}) {
    if (!exists) return seen ? 'gone' : 'write';
    if (serverMs && serverMs > localMs) return 'stale';
    return 'write';
}

/** 클라우드 묶음에서 빠지면서 같은 id가 이 기기 전용 칸으로 옮겨 간 줄(민감한 내용으로 고친 경우). */
export function movedToLocal(prev = {}, next = {}) {
    const out = [];
    for (const [localName, cloudName] of SYNC_BUCKETS) {
        const localIds = new Set((next?.local?.[localName] || []).map((row) => String(row?.id ?? '')));
        if (!localIds.size) continue;
        const nextIds = new Set((next?.[localName] || []).map((row) => cloudIdOf(cloudName, row)).filter(Boolean));
        for (const row of prev?.[localName] || []) {
            if (!row || row.source === 'demo') continue;
            const id = cloudIdOf(cloudName, row);
            if (!id || nextIds.has(id) || !localIds.has(String(row.id))) continue;
            out.push({ name: cloudName, id });
        }
    }
    return out;
}
