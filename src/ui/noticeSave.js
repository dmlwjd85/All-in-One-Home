import { isSensitiveText } from '../lib/sensitive.js';
import { joined, saveTextItem, snapshot, update } from '../lib/db.js';

/**
 * 그 날 알림장 행을 하나 고릅니다. 화면(Tasks.jsx)과 저장 위치 고르기가 같은 규칙을 씁니다.
 * 그 날 행이 둘(클라우드 옛 글 + 이 기기 민감 글, 또는 비운 클라우드 행 + 이 기기 행)이면 글이 있는 행을 먼저 고릅니다.
 */
export function pickNotice(rows, date) {
    const day = rows.filter((row) => row.date === date);
    return day.find((row) => String(row.text || '').trim()) || day[0];
}

/** 그 날 알림장 행이 지금 어디(클라우드·이 기기)에 있는지 봅니다. 없으면 undefined. */
function whereNow(date) {
    const row = pickNotice(joined(snapshot(), 'notices'), date);
    if (!row) return undefined;
    return row.localOnly ? 'local' : 'cloud';
}

/** main과 같은 저장 경로로 그 날 알림장 글을 저장합니다. */
export function saveNotice(date, text) {
    return saveTextItem('notices', { id: date, date, text, source: 'app', at: new Date().toISOString() }, { from: whereNow(date) });
}

/**
 * 그 날 글이 있는 알림장 행을 모두 한 번에 비웁니다.
 * 클라우드 행은 빈 글('')로 두어 다른 기기에도 비운 상태가 퍼지게 하고,
 * 이 기기에만 둔 행은 지금처럼 이 기기에서만 지웁니다(같은 아이디의 클라우드 행은 건드리지 않아요).
 * 되돌릴 때 쓸 원래 글(before)을 돌려줍니다.
 */
export async function clearNoticeDay(date) {
    const before = joined(snapshot(), 'notices')
        .filter((row) => row.date === date && String(row.text || '').trim())
        .map((row) => ({ ...row }));
    if (!before.length) return { before };
    const at = new Date().toISOString();
    const failed = await update((draft) => {
        if (!draft.local) draft.local = {};
        before.forEach((row) => {
            if (row.localOnly) {
                draft.local.notices = (draft.local.notices || []).filter((item) => item.id !== row.id);
                return;
            }
            draft.notices = (draft.notices || []).map((item) => item.id === row.id ? { ...item, text: '', at } : item);
        });
        return draft;
    }, { undoable: true });
    if (failed?.storageFailed) return { ...failed, before };
    return { before };
}

/** clearNoticeDay로 비운 행들을 원래 자리(클라우드·이 기기)로 한 번에 되돌립니다. 민감한 글은 클라우드에 두지 않아요. */
export async function restoreNoticeDay(before) {
    const at = new Date().toISOString();
    return update((draft) => {
        if (!draft.local) draft.local = {};
        before.forEach((saved) => {
            const { localOnly, ...row } = saved;
            const local = localOnly || isSensitiveText(row.text);
            const list = (local ? draft.local.notices : draft.notices) || [];
            const next = { ...row, at };
            const kept = list.some((item) => item.id === row.id) ? list.map((item) => item.id === row.id ? next : item) : [...list, next];
            if (local) draft.local.notices = kept;
            else draft.notices = kept;
        });
        return draft;
    }, { undoable: true });
}
