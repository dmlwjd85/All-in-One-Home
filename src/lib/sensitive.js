/** 클라우드에 올리지 않는 낱말. 앱과 firestore.rules 의 safeText 가 이 목록을 함께 씁니다. */
export const SENSITIVE_WORDS = ['학교폭력', '학폭', '민원', '투약', '복약', '알레르기', '건강', '보건'];

/** 가운데 빈칸이 있어도 같은 말입니다. 규칙에서는 '분리 ?급식'으로 적습니다. */
export const SENSITIVE_GAP = ['분리', '급식'];

export function rulesSafeTextBody() {
    const gap = `${SENSITIVE_GAP[0]} ?${SENSITIVE_GAP[1]}`;
    return `(?s).*(${[...SENSITIVE_WORDS, gap].join('|')}).*`;
}

const SENSITIVE_RE = new RegExp([...SENSITIVE_WORDS, `${SENSITIVE_GAP[0]}\\s*${SENSITIVE_GAP[1]}`].join('|'));
const SENSITIVE_TAGS = new Set(SENSITIVE_WORDS);

export function isSensitiveText(text, tags = []) {
    if (SENSITIVE_RE.test(String(text || ''))) return true;
    return (tags || []).some((tag) => SENSITIVE_TAGS.has(String(tag || '').replace(/^#/, '')));
}

export const SENSITIVE_HINT = '이 내용은 이 기기에만 남겨 둘게요.';
export const MEMO_LOCAL_HINT = '이 메모는 이 기기에만 있어요';
