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

/*
 * 보호자 연락처·집 주소 꼴. 앱(자바스크립트 정규식)과 규칙(RE2, matches())이 이 글자를 그대로 함께 씁니다.
 * 그래서 두 쪽 뜻이 같은 문법만 씁니다. 역슬래시(\d, \s)·앞뒤 살피기·플래그는 쓰지 않고 [0-9], [ ] 로 적습니다.
 * 숫자 오탐(날짜·교시·점수·'3동 견학')을 줄이려고 좁게 잡았습니다. 맞는 예·안 맞는 예는 scripts/check-sensitive.mjs 에 있습니다.
 */
export const CONTACT_PATTERNS = [
    // 휴대폰: 010-1234-5678, 010.1234.5678, 010 1234 5678, 01012345678. 앞뒤가 숫자면(긴 번호·시각 값의 일부) 보지 않습니다.
    '(^|[^0-9])01[016789][-. ]?[0-9]{3,4}[-. ]?[0-9]{4}([^0-9]|$)',
    // 일반 전화: 02-123-4567, 031-1234-5678, 070-1234-5678. 붙임표가 있을 때만 봅니다(날짜 2026-10-19 는 앞 숫자 때문에 안 맞습니다).
    '(^|[^0-9])0[0-9]{1,2}-[0-9]{3,4}-[0-9]{4}([^0-9]|$)',
    // 공동주택 동·호: 101동 1203호, 101동1203호. '3동 견학'처럼 호가 없으면 보지 않습니다.
    '[0-9]{1,4} ?동 ?[0-9]{1,4} ?호',
    // 동 없이 붙임표로만 쓴 꼴(101-1203호)은 보지 않습니다. '가정통신문 제2026-123호'·'학급문고 12-1234호'처럼
    // 문서·물건 번호와 구별이 안 되어 알림장 전체가 동기화에서 빠졌습니다. 동·호가 함께 있는 꼴만 봅니다.
    // 아파트·빌라 이름 뒤 동 번호: 푸른아파트 103동
    '(아파트|빌라|맨션|오피스텔) ?[0-9]{1,4} ?동',
    // 도로명 주소: 중앙로12번길, 백범로 31길
    '로 ?[0-9]{1,4}번?길',
    // 지번 주소: 123-4번지, 45번지
    '[0-9]{1,5}(-[0-9]{1,5})? ?번지',
];

export function rulesSafeTextBody() {
    const gaps = SENSITIVE_GAPS.map(({ parts, rules }) => parts.join(rules));
    return `(?s).*(${[...SENSITIVE_WORDS, ...gaps, ...CONTACT_PATTERNS].join('|')}).*`;
}

const SENSITIVE_RE = new RegExp([...SENSITIVE_WORDS, ...SENSITIVE_GAPS.map(({ parts, app }) => parts.join(app)), ...CONTACT_PATTERNS].join('|'));

/* 폭 없는 문자(U+200B~U+200D, U+2060, U+FEFF)와 숨은 붙임표(U+00AD). 낱말 사이에 끼면 '건​강'이 검사를 비켜 갑니다. */
const INVISIBLE_RE = /[​-‍⁠﻿­]/g;

/*
 * 검사용 사본만 바꿉니다. 저장 값은 그대로 둡니다.
 *  - 맥에서 붙여 넣은 분해형 한글(NFD)은 '건강'과 글자가 달라 그대로는 안 맞습니다. 합친 꼴로 바꿔 봅니다.
 *  - NFC 보다 넓은 NFKC 를 씁니다. 전각 숫자·붙임표(０１０－…)도 보통 숫자로 바꿔 연락처를 잡습니다. 한글 음절은 NFC 와 같게 합쳐집니다.
 *  - 저장 값까지 바꾸지 않는 까닭: 선생님이 적은 글을 앱이 몰래 고치지 않고(①·㎡ 같은 글자가 바뀝니다),
 *    이미 올린 줄의 지문이 한꺼번에 달라져 다시 올리기가 몰리는 일을 막습니다. 올릴지 말지는 앱이 이 사본으로 정하므로 이것으로 충분합니다.
 *  - 원문과 사본을 둘 다 봅니다. 규칙(safeText)은 원문만 보므로, 원문에서 맞는 글은 앱도 반드시 민감으로 봐야 규칙에 거절되지 않습니다.
 */
export function sensitiveCheckCopy(text) {
    return String(text ?? '').normalize('NFKC').replace(INVISIBLE_RE, '');
}

function hits(text) {
    const raw = String(text ?? '');
    if (!raw) return false;
    return SENSITIVE_RE.test(raw) || SENSITIVE_RE.test(sensitiveCheckCopy(raw));
}

/** 태그는 본문과 같은 정규식으로 봅니다('건강검진', '보건실', '민원전화'). 규칙이 tags.join(' ') 을 보므로 앱도 띄어 이어 붙여 봅니다. */
export function tagsText(tags) {
    return (Array.isArray(tags) ? tags : []).map((tag) => String(tag ?? '').replace(/^#/, '')).join(' ');
}

export function isSensitiveText(text, tags = []) {
    if (hits(text)) return true;
    return hits(tagsText(tags));
}

export const SENSITIVE_HINT = '이 내용은 이 기기에만 남겨 둘게요.';
export const MEMO_LOCAL_HINT = '이 메모는 이 기기에만 있어요';
