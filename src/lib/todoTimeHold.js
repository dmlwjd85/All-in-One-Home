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
    map[String(id)] = { time: row.time, sig: holdSig(row) };
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
