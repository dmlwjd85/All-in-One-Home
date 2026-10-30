/** 충돌 사본 제목 머리(PR #57). 저장된 제목에는 그대로 남고, 화면은 이 머리를 떼고 '충돌 사본' 배지로 보여 줍니다. */
export const CONFLICT_PREFIX = '(충돌 사본) ';
export function splitConflict(title) {
    const text = String(title || '');
    return text.startsWith(CONFLICT_PREFIX) ? { conflict: true, title: text.slice(CONFLICT_PREFIX.length) } : { conflict: false, title: text };
}
