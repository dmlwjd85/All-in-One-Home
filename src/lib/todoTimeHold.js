/*
 * 예전 규칙(시각 없는 todos)이 아직 배포되지 않은 동안 지키는 '이 기기 시각'(PR #62 검수 1번).
 * 시각 때문에 올리기가 거절되어 시각 없이 다시 올린 할 일은, 클라우드 문서에 time이 없더라도
 * 내용(제목·마감·끝냄)이 그때 올린 것과 같으면 이 기기의 시각을 지우지 않고 그대로 둡니다.
 * 다른 기기가 내용을 바꾸면(늦게 고친 쪽 우선) 그쪽을 받습니다.
 */
const KEY = 'ssug-gyomu-todo-time-hold';

function read() {
    try {
        const v = JSON.parse(globalThis.localStorage?.getItem(KEY) || '{}');
        return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
    } catch { return {}; }
}
function write(map) {
    try { globalThis.localStorage?.setItem(KEY, JSON.stringify(map)); } catch { /* 저장 공간이 없으면 지키지 못할 뿐입니다. */ }
}

export function holdSig(row) {
    return JSON.stringify([String(row?.title ?? ''), String(row?.due ?? ''), Boolean(row?.done)]);
}

/** 시각 없이 올린 할 일을 적어 둡니다. */
export function holdTodoTime(id, row) {
    if (!id || !row?.time) return;
    const map = read();
    map[String(id)] = { time: row.time, sig: holdSig(row), tryAt: Date.now() };
    write(map);
}

/** 시각까지 올라갔거나 시각을 지웠으면 더 지킬 것이 없습니다. */
export function releaseTodoTime(id) {
    const map = read();
    if (!(String(id) in map)) return;
    delete map[String(id)];
    write(map);
}

/** 클라우드 문서에 time이 없을 때 이 기기 시각을 지켜야 하면 그 시각을 돌려줍니다. */
export function heldTodoTime(id, theirs) {
    const held = read()[String(id)];
    if (!held || !theirs || 'time' in theirs) return '';
    return held.sig === holdSig(theirs) ? held.time : '';
}

/* 규칙이 배포되면 지켜 둔 시각을 저절로 다시 올립니다. 앱을 켠 뒤 첫 올리기와, 그 뒤 10분마다 한 번씩만 시도합니다(예전 규칙에서 쓰기 반복 방지). */
let retryMs = 10 * 60 * 1000;
const triedThisRun = new Set();
export function useHoldRetryForTest(ms = 10 * 60 * 1000) { retryMs = ms; triedThisRun.clear(); }

/**
 * 다시 올릴 할 일 id 목록. 이 기기 할 일이 없어졌거나 시각·내용이 바뀌었으면 지킴 기록을 버립니다
 * (그 변경은 보통 올리기로 시각과 함께 올라갑니다).
 */
export function heldTimesToRetry(todos, now = Date.now()) {
    const map = read();
    const ids = Object.keys(map);
    if (!ids.length) return [];
    const byId = new Map((todos || []).map((row) => [String(row?.id), row]));
    const out = [];
    let changed = false;
    for (const id of ids) {
        const held = map[id];
        const row = byId.get(id);
        if (!row || row.time !== held?.time || holdSig(row) !== held?.sig) { delete map[id]; changed = true; continue; }
        if (!triedThisRun.has(id) || now - Number(held.tryAt || 0) >= retryMs) {
            triedThisRun.add(id);
            map[id] = { ...held, tryAt: now };
            changed = true;
            out.push(id);
        }
    }
    if (changed) write(map);
    return out;
}

/** 클라우드 쪽이 더 늦게 고쳐 이긴 할 일: 다른 기기가 시각을 넣었거나 내용을 고쳤으면 지킴 기록을 버립니다. */
export function settleHoldWithRemote(id, theirs) {
    const held = read()[String(id)];
    if (!held || !theirs) return;
    if ('time' in theirs || held.sig !== holdSig(theirs)) releaseTodoTime(id);
}

export function heldTodoIds() { return Object.keys(read()); }
