import { KINDS } from './bits.jsx';

/** 가운데 ＋에 나오는 일. 새 기능은 이 목록에 한 줄 넣으면 됩니다. */
export const PLUS_ACTIONS = [
    { id: 'minutes', label: '회의록 작성', emoji: '📋' },
    { id: 'attend', label: '출결 체크', emoji: '✓' },
    { id: 'message', label: '메시지 붙여넣기', emoji: '✉' },
    ...KINDS.map((kind) => ({ id: `quick:${kind.id}`, label: kind.label, emoji: kind.emoji, kind: kind.id })),
];

/** 입력창 아래 네 칸. 나머지는 더보기에 그대로 둡니다. */
export const FREQUENT_IDS = ['attend', 'quick:상담', 'quick:할 일', 'quick:일정'];

export function splitPlusActions() {
    const frequent = FREQUENT_IDS.map((id) => PLUS_ACTIONS.find((item) => item.id === id)).filter(Boolean);
    const more = PLUS_ACTIONS.filter((item) => !FREQUENT_IDS.includes(item.id));
    return { frequent, more };
}
