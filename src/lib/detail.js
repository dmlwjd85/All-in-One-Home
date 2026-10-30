/** 할 일·일정 자세히 보기 팝업에 들어갈 줄을 만듭니다(화면 없이 검사 가능). */
import { eventClock, formatKoDate, isValidYmd } from './date.js';

export function detailRows(kind, row = {}) {
    const out = [];
    if (!row) return out;
    if (isValidYmd(row.date)) {
        const end = isValidYmd(row.end) && row.end > row.date ? row.end : '';
        out.push(['날짜', end ? `${formatKoDate(row.date)} ~ ${formatKoDate(end)}` : formatKoDate(row.date)]);
        if (end) {
            const days = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${row.date}T00:00:00Z`)) / 86400000) + 1;
            out.push(['기간', `${days}일`]);
        }
    }
    if (kind === 'todo' && isValidYmd(row.due)) out.push(['마감', formatKoDate(row.due)]);
    const clock = eventClock(row);
    if (clock) out.push(['시간', clock]);
    if (kind === 'todo') {
        out.push(['상태', row.done ? '끝냄' : '남음']);
        if (row.of) out.push(['받기', `${row.of}명 중 ${row.got || 0}명`]);
    }
    const memo = String(row.memo || row.text || '').trim();
    if (memo && memo !== row.title) out.push(['메모', memo]);
    return out;
}

/** 줄임표로 잘렸는지. 잘린 것만 팝업을 띄웁니다. */
export function isClipped(el) {
    return Boolean(el && el.scrollWidth > el.clientWidth + 1);
}
