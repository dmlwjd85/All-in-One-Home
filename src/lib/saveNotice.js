/** 저장 실패를 화면에 알립니다. retry 는 사용자가 「다시 시도」를 누를 때 호출합니다. */
export function reportSaveFailure({ message, retry }) {
    console.error(message);
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nb-save-failed', {
        detail: {
            message: message || '저장하지 못했습니다.',
            retry,
        },
    }));
}
