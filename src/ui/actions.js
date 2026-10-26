import { KINDS } from './bits.jsx';

/** 가운데 버튼에 나오는 일. 새 기능은 이 목록에 한 줄 넣으면 됩니다. 지우는 항목은 없습니다. */
export const PLUS_ACTIONS = [
    { id: 'minutes', label: '회의록 작성', emoji: '📋' },
    { id: 'attend', label: '출결 체크', emoji: '✓' },
    { id: 'message', label: '메시지 붙여넣기', emoji: '✉' },
    ...KINDS.map((kind) => ({ id: `quick:${kind.id}`, label: kind.label, emoji: kind.emoji, kind: kind.id })),
];

/** 첫 화면에 두는 넷. 나머지는 MORE_ACTIONS 로 더보기 안에 남깁니다. */
export const FREQUENT_ACTION_IDS = ['attend', 'quick:상담', 'quick:할 일', 'quick:일정'];

const FREQUENT = new Set(FREQUENT_ACTION_IDS);
export const MORE_ACTIONS = PLUS_ACTIONS.filter((item) => !FREQUENT.has(item.id));
