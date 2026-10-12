let lastMessage = '';
let lastAt = 0;

/** 저장이 실패하면 화면 토스트가 다시 시도를 받을 수 있게 알립니다. */
export function reportSaveFailure(detail) {
    const message = detail?.message || '저장하지 못했습니다. 다시 시도해 주세요.';
    const now = Date.now();
    if (message === lastMessage && now - lastAt < 2500) return;
    lastMessage = message;
    lastAt = now;
    window.dispatchEvent(new CustomEvent('nb-save-failed', { detail: { ...detail, message } }));
}
