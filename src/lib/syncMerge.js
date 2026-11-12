/*
 * 기기끼리 합치기(받아 온 값과 이 기기 값 견주기)에 쓰는 순수 함수들.
 * db.js 에서 떼어 냈습니다. 모듈 상태(state·해시·시계)를 읽거나 바꾸지 않고, 넘겨받은 값만 다룹니다.
 * db.js 가 예전 이름 그대로 다시 내보내므로 바깥에서는 db.js 에서 가져와도 됩니다.
 */
import { heldTodoTime, settleHoldWithRemote } from './todoTimeHold.js';
import { CLOUD_COLLECTIONS, LWW_NAMES, fingerprint, printDigest, rowMark, unchangedSincePush } from './cloud.js';
import { toCloudRow } from './cloudShape.js';
import { isSensitiveText } from './sensitive.js';

/* 되돌리기·다른 기기 삭제를 견줄 묶음 */
export const CLOUD_BUCKETS = ['records', 'events', 'todos', 'notes', 'notices', 'attendance'];

/** 받은 시간표 하루를 이 기기 값 대신 쓸지: 이 기기 고친 시각을 알면 클라우드가 더 늦게 고쳤을 때만, 모르면 예전 규칙(fallback). */
export function takeRemoteDay(mine, remoteAt, fallback) {
    if (!mine || !Object.keys(mine).filter((k) => k !== 'editAt' && k !== 'editD').length) return true;
    /* 재기 전에 고친 날(editD): 고친 시각이 정해질 때까지 이 기기 값을 지킵니다(정착 뒤 다시 견줌). 받아오기 fallback이 덮지 않게 합니다. */
    if (!(Number(mine.editAt) > 0) && Number.isFinite(mine.editD)) return false;
    if (Number(mine.editAt) > 0 && Number.isFinite(remoteAt) && remoteAt > 0) return remoteAt > Number(mine.editAt);
    return fallback;
}
export function remoteDay(value, remoteAt) {
    return Number.isFinite(remoteAt) && remoteAt > 0 ? { ...value, editAt: remoteAt } : { ...value };
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

export function unionById(local = [], remote = []) {
    const map = new Map(local.map((row) => [String(row.id), row]));
    remote.forEach((row) => {
        if (!row?.id || map.has(String(row.id))) return;
        map.set(String(row.id), row);
    });
    return [...map.values()];
}

function registeredIds(draft) {
    return new Set([
        ...(draft.todos || []), ...(draft.local?.todos || []),
        ...(draft.events || []), ...(draft.local?.events || []),
    ].map((row) => row?.id).filter(Boolean));
}

export function dropRegisteredInbox(draft) {
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
const OPTIONAL_FROM_CLOUD = { notes: ['title', 'attendees'], todos: ['time', 'pri', 'doneOn', 'doneHm'] };
/* 이 기기에만 두는 민감 메모 칸. 클라우드에는 이 칸을 비워 올리므로, 받아 온 빈 칸으로 이 기기 메모를 덮지 않습니다. */
const LOCAL_SENSITIVE_FIELD = { attendance: 'note', students: 'memo' };
export function takeRemote(cloudName, row, theirs) {
    const next = { ...row, ...theirs };
    for (const key of OPTIONAL_FROM_CLOUD[cloudName] || []) if (!(key in theirs)) delete next[key];
    const localField = LOCAL_SENSITIVE_FIELD[cloudName];
    if (localField && !theirs?.[localField] && isSensitiveText(row?.[localField])) next[localField] = row[localField];
    // 예전 규칙이 시각을 거절해 시각 없이 올린 할 일: 내용이 그대로면 이 기기 시각을 지킵니다(PR #62 검수 1번).
    if (cloudName === 'todos' && row?.time) { const kept = heldTodoTime(row.id, theirs); if (kept) next.time = kept; }
    // 다른 기기가 시각을 넣었거나 고치거나 끝낸 쪽이 이겼으면 지킴 기록은 버립니다(PR #62 r2 1번).
    if (cloudName === 'todos' && row?.id) settleHoldWithRemote(row.id, theirs);
    return next;
}

/** 클라우드 쪽이 이 기기보다 늦게 고쳐졌는지. 어느 한쪽 시각을 모르면(옛 자료) 이 기기 값을 지킵니다. */
export function remoteIsLater(row, remoteAt) {
    const mine = Number(row?.editAt);
    return Number.isFinite(remoteAt) && remoteAt > 0 && Number.isFinite(mine) && mine > 0 && remoteAt > mine;
}

/** 받아 온 할 일에는 클라우드의 고친 시각을 editAt으로 붙여 둡니다(다음 비교의 기준). */
export function withRemoteAt(cloudName, row, remote) {
    if (!LWW_NAMES.includes(cloudName) || !row?.id) return row;
    const at = remote?.ats?.[cloudName]?.[String(row.id)];
    return Number.isFinite(at) && at > 0 ? { ...row, editAt: at } : row;
}

/*
 * 할 일 충돌 사본(PR #57 검수 2·3·5번). 누가 나중에 고쳤는지 알 수 없을 때는 어느 쪽도 버리지 않습니다.
 *  - legacy: 옛 판(v46)에서 고치고 못 올린 할 일(editAt·editD 둘 다 없음). 고친 시각을 모릅니다.
 *  - soft: 클라우드 쪽 시각이 불확실한 문서(v46이 썼거나 시각을 못 잰 기기가 올림). updatedAt은 올린 시각일 뿐입니다.
 *  - stale: 이 기기가 묘비 보관 기간(30일)보다 오래 동기화하지 않았습니다. 그 사이 지운 표시가 사라졌을 수 있습니다.
 * 판단(planTodoConflict):
 *  - keepCopy: 이 기기 수정(시각 확실)을 지키고, 다른 기기가 바꾼 불확실한 클라우드 값은 사본으로 남깁니다.
 *  - takeCopy: 클라우드 값을 받고, 이 기기 수정(legacy·stale)은 사본으로 남깁니다.
 *  - dropCopy: 다른 기기가 지웠으면(묘비, 또는 stale에서 사라짐) 지우되, 이 기기 수정은 사본으로 남깁니다.
 */

function legacyEdit(row) { return !(Number(row?.editAt) > 0) && !Number.isFinite(row?.editD); }
function sameMark(a, b) { return Boolean(a) && Boolean(b) && printDigest(a) === printDigest(b); }

export function planTodoConflict(row, { remote = null, soft = false, gone = null, base = null, stale = false } = {}) {
    const mine = rowMark('todos', row)?.mark;
    if (remote) {
        const theirs = rowMark('todos', remote)?.mark;
        if (!theirs || sameMark(mine, theirs)) return null;
        /* 마지막으로 맞춘 뒤 클라우드가 그대로면 이 기기 수정을 올립니다. */
        if (sameMark(base, theirs)) return null;
        if (stale || legacyEdit(row)) return 'takeCopy';
        if (soft && Number(row?.editAt) > 0) return 'keepCopy';
        return null;
    }
    if (legacyEdit(row) && Number.isFinite(gone)) return 'dropCopy';
    if (stale && base) return 'dropCopy';
    return null;
}

export function refreshShared(local = [], remote = [], cloudName, hashes, ats = null, softAts = null) {
    const byId = new Map((remote || []).filter((row) => row?.id).map((row) => [String(row.id), row]));
    return local.map((row) => {
        const other = row?.id ? byId.get(String(row.id)) : null;
        if (!other) return row;
        const remoteAt = LWW_NAMES.includes(cloudName) ? ats?.[String(row.id)] : undefined;
        if (!unchangedSincePush(hashes, cloudName, row)) {
            /* 할 일: 이 기기에서 고친 뒤 아직 못 올렸어도, 다른 기기가 더 늦게 고쳤으면(고친 시각 기준) 그쪽 값이 이깁니다. */
            if (LWW_NAMES.includes(cloudName) && !softAts?.[String(row.id)] && remoteIsLater(row, remoteAt)) return { ...takeRemote(cloudName, row, other), editAt: remoteAt };
            return row;
        }
        /* 올린 그대로인 할 일은 클라우드 값과 그 고친 시각을 받습니다(다음 비교의 기준). */
        if (LWW_NAMES.includes(cloudName) && Number.isFinite(remoteAt)) return { ...takeRemote(cloudName, row, other), editAt: remoteAt };
        if (cloudName === 'notes' && clippedCopy(row.text, other.text)) {
            /* 옛 판(v30)은 본문을 2000자로 잘라 다시 올립니다. 잘린 사본이면 이 기기 본문을 지키고 다시 올립니다. */
            if (hashes) delete hashes[`${cloudName}/${row.id}`];
            return { ...takeRemote(cloudName, row, other), text: row.text };
        }
        return takeRemote(cloudName, row, other);
    });
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
            if (!unchangedSincePush(hashes, cloudName, row)) {
                /* 할 일을 이 기기에서 고쳤어도, 다른 기기가 그보다 나중에 지웠으면(묘비 시각) 지웁니다. 지운 시각을 모르면 지키고 다시 올립니다. */
                if (!LWW_NAMES.includes(cloudName) || !remoteIsLater(row, remote?.tombs?.[cloudName]?.[String(shaped.id)])) return true;
            }
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
