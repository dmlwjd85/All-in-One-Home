/**
 * 클라우드에 올리지 않는 낱말. 앱과 firestore.rules 의 safeText 가 이 목록을 함께 씁니다.
 *
 * 고르는 기준: 학생 개인의 건강·안전·가정 형편을 드러내는 말, 그리고 학교 일정에 흔히 섞이지 않는 말.
 * - '상담'은 넣지 않습니다. '학부모 상담 주간'처럼 일정에 흔해서 동기화가 거의 막힙니다(check-g1 도 이 약속을 지킵니다).
 * - '장애'만 따로 넣지 않습니다. '장애물 달리기'가 걸립니다. 대신 '특수교육대상'을 씁니다.
 * - '진단평가'는 걸리지 않도록 '진단서'만 넣습니다.
 * 낱말을 바꾸면 firestore.rules 의 safeText 도 같이 바꾸고(npm run check:rules 가 비교), 규칙은 앱을 먼저 배포한 뒤에 올립니다.
 */
export const SENSITIVE_WORDS = [
    // 학교폭력·민원
    '학교폭력', '학폭', '민원',
    // 건강·투약
    '투약', '복약', '알레르기', '알러지', '건강', '보건', '진단서', '정신과', '우울', '아토피', '천식', '뇌전증', '당뇨',
    // 안전(자해·학대·성 관련)
    '자해', '자살', '학대', '방임', '가정폭력', '성폭력', '성폭행', '성추행', '성희롱',
    // 가정 형편·지원 대상
    '기초수급', '수급자', '차상위', '한부모', '조손', '이혼', '특수교육대상',
];

/**
 * 가운데 빈칸이나 가운뎃점이 있어도 같은 말입니다.
 * 앱은 빈칸 여러 개까지 보고, 규칙(RE2)은 사이에 한 글자까지만 봅니다(앱이 더 넓게 막습니다).
 */
export const SENSITIVE_GAPS = [
    { parts: ['분리', '급식'], app: '\\s*', rules: ' ?' },
    { parts: ['정서', '행동'], app: '[\\s·ㆍ]*', rules: '[ ·ㆍ]?' },
];

/** 예전 이름(첫 묶음). */
export const SENSITIVE_GAP = SENSITIVE_GAPS[0].parts;

export function rulesSafeTextBody() {
    const gaps = SENSITIVE_GAPS.map(({ parts, rules }) => parts.join(rules));
    return `(?s).*(${[...SENSITIVE_WORDS, ...gaps].join('|')}).*`;
}

const SENSITIVE_RE = new RegExp([...SENSITIVE_WORDS, ...SENSITIVE_GAPS.map(({ parts, app }) => parts.join(app))].join('|'));
const SENSITIVE_TAGS = new Set(SENSITIVE_WORDS);

export function isSensitiveText(text, tags = []) {
    if (SENSITIVE_RE.test(String(text || ''))) return true;
    return (tags || []).some((tag) => SENSITIVE_TAGS.has(String(tag || '').replace(/^#/, '')));
}

export const SENSITIVE_HINT = '이 내용은 이 기기에만 남겨 둘게요.';
export const MEMO_LOCAL_HINT = '이 메모는 이 기기에만 있어요';
