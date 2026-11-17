/**
 * 할 일·일정이 어디서 왔는지(파생). 목록에서는 긴 글 대신 그림 글자 하나로만 보여 줍니다(스크롤을 줄이려고).
 * 자세히 보기에서는 원래 자리로 가는 단추가 따로 있습니다.
 */
import { MINUTES_LINK_PREFIX } from './minutesExtract.js';

export const ORIGINS = {
    minutes: { icon: '📝', label: '회의록에서 등록' },
    msg: { icon: '💬', label: '메시지에서 등록' },
};

export function originOf(row) {
    if (!row) return null;
    if (String(row.id || '').startsWith(MINUTES_LINK_PREFIX)) return { kind: 'minutes', ...ORIGINS.minutes };
    if (row.source === 'msg') return { kind: 'msg', ...ORIGINS.msg };
    return null;
}

/** 회의록에서 등록할 때 자동으로 붙인 메모('회의록: 제목', '회의록에서')는 그림 글자가 대신하므로 목록에서 뺍니다. */
export function plainMemo(memo, row = null) {
    const text = String(memo || '').trim();
    if (!text) return '';
    if (/^회의록(?:: |에서$)/.test(text) && (!row || originOf(row)?.kind === 'minutes')) return '';
    return text;
}
