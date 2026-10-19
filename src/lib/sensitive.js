/** 건강·민원·학폭은 클라우드로 올리지 않습니다. 서버 규칙과 같은 낱말을 앱에서도 먼저 가립니다. */
const SENSITIVE_RE = /건강|보건|알레르기|투약|복약|분리\s*급식|민원|학폭|학교폭력/;
const SENSITIVE_TAGS = new Set(['보건', '건강', '학폭', '민원', '알레르기', '투약', '복약']);

export function isSensitiveText(text, tags = []) {
    if (SENSITIVE_RE.test(String(text || ''))) return true;
    return (tags || []).some((tag) => SENSITIVE_TAGS.has(String(tag || '').replace(/^#/, '')));
}

export const SENSITIVE_HINT = '이 내용은 이 기기에만 남겨 둘게요.';
