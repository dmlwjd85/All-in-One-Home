/** 저장 실패를 화면에 알립니다. retry 는 사용자가 「다시 시도」를 누를 때 호출합니다. */
export function reportSaveFailure({ message, retry }) {
    console.error(message);
    if (typeof window === 'undefined') return;
    const detail = {
        message: message || '저장하지 못했습니다.',
        retry,
    };
    // 쪽 칸 저장은 setState 갱신 중에 실패할 수 있어, 알림은 그 렌더가 끝난 뒤에 띄웁니다.
    queueMicrotask(() => {
        window.dispatchEvent(new CustomEvent('nb-save-failed', { detail }));
    });
}
