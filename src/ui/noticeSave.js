import { joined, removeItem, saveTextItem, snapshot } from '../lib/db.js';

/** 그 날 알림장 행이 지금 어디(클라우드·이 기기)에 있는지 봅니다. 없으면 undefined. */
function whereNow(date) {
    const row = joined(snapshot(), 'notices').find((item) => item.date === date);
    if (!row) return undefined;
    return row.localOnly ? 'local' : 'cloud';
}

/** main과 같은 저장 경로로 그 날 알림장 글을 저장합니다. */
export function saveNotice(date, text) {
    return saveTextItem('notices', { id: date, date, text, source: 'app', at: new Date().toISOString() }, { from: whereNow(date) });
}

/**
 * 그 날 알림장을 비웁니다. 클라우드 행은 빈 글('')로 저장해 다른 기기에도 비운 상태가 퍼지게 하고,
 * 이 기기에만 둔 민감 알림장은 지금처럼 이 기기에서만 그 날 행을 지웁니다.
 */
export function clearNotice(row) {
    if (row.localOnly) return removeItem('notices', row.id);
    return saveNotice(row.date, '');
}
