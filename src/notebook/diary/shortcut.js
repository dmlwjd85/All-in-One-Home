/** 보이는 단축키. 맥·아이폰은 ⌘K, 윈도우와 크롬북은 Ctrl+K. */
export function captureShortcut(ua = '', platform = '') {
    const apple = /Mac|iPhone|iPad|iPod/.test(`${platform} ${ua}`) && !/CrOS/.test(ua);
    return apple ? '⌘K' : 'Ctrl+K';
}

export function captureShortcutHere() {
    if (typeof navigator === 'undefined') return 'Ctrl+K';
    return captureShortcut(navigator.userAgent || '', navigator.platform || '');
}
