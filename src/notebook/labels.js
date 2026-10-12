/** PDF 쪽 번호 → 짧은 이름. 링크 라벨이 비었을 때 씁니다. */
export const DEST_LABEL = {
    1: '표지',
    2: '홈',
    3: '새 학년 준비',
    5: '사용법',
    9: '태그 색인',
    32: '연간 달력',
    33: '학사일정',
    34: '3월',
    35: '4월',
    36: '5월',
    37: '6월',
    38: '7월',
    39: '8월',
    40: '9월',
    41: '10월',
    42: '11월',
    43: '12월',
    44: '1월',
    45: '2월',
    46: '주간 목차',
    99: '특별한 하루',
    140: '학급',
    141: '시간표',
    146: '1인 1역',
    148: '자리 배치',
    154: '명렬표',
    155: '기초조사',
    157: '건강',
    231: '출결',
    256: '상담',
    335: '수업',
    350: '단원',
    380: '체크리스트',
    396: '점수 체크',
    404: '업무',
    405: '기한 있는 일',
    411: '업무 할 일',
    417: '회의록',
    458: '전달 사항',
    468: '예산',
    469: '예산 사업',
    493: '연락처',
    494: '2027 준비',
    495: '쓱적 · 메모',
    496: '쓱적',
    516: '공책',
    559: '칠판',
    560: '칠판',
    561: '화이트보드',
    562: '모눈',
    563: '스티커',
};

export const TAGS = [
    { id: '관찰', page: 10, group: '학생 기록', hint: '누가기록·관찰', color: '#f6c1c6' },
    { id: '출결', page: 11, group: '학생 기록', hint: '결석·지각·서류', color: '#f8d39a' },
    { id: '교과', page: 12, group: '학생 기록', hint: '교과 성취·특기', color: '#f6e08a' },
    { id: '창체', page: 13, group: '학생 기록', hint: '자율·자치·동아리', color: '#c8e6b3' },
    { id: '진로', page: 14, group: '학생 기록', hint: '진로활동', color: '#b7e4d6' },
    { id: '행특', page: 15, group: '학생 기록', hint: '행동특성·종합의견', color: '#b9d4f6' },
    { id: '상담', page: 16, group: '소통', hint: '학생 상담', color: '#cbb8f0' },
    { id: '학부모', page: 17, group: '소통', hint: '보호자 상담·연락', color: '#f0c3e4' },
    { id: '생활', page: 18, group: '보호·안전', hint: '생활지도', color: '#f5c6a8' },
    { id: '학폭', page: 19, group: '보호·안전', hint: '학교폭력 관련', color: '#e8a0a0' },
    { id: '보건', page: 20, group: '보호·안전', hint: '건강·투약·응급', color: '#f7b7c9' },
    { id: '안전', page: 21, group: '보호·안전', hint: '안전사고·교육', color: '#f3d27a' },
    { id: '민원', page: 22, group: '보호·안전', hint: '민원·교육활동 침해', color: '#d7c4b0' },
    { id: '수업', page: 23, group: '수업·평가', hint: '수업 아이디어·성찰', color: '#a8d5c2' },
    { id: '평가', page: 24, group: '수업·평가', hint: '평가 계획·결과', color: '#9ec9e8' },
    { id: '학습지원', page: 25, group: '수업·평가', hint: '기초학력·보정', color: '#c5d68a' },
    { id: '마감', page: 26, group: '업무·행사', hint: '공문·제출 마감', color: '#e8b4a0' },
    { id: '회의', page: 27, group: '업무·행사', hint: '회의 결정·할 일', color: '#b8c4e8' },
    { id: '행사', page: 28, group: '업무·행사', hint: '행사·체험학습', color: '#f0d08a' },
    { id: '예산', page: 29, group: '업무·행사', hint: '예산·품의·구입', color: '#c8e0c0' },
    { id: '연수', page: 30, group: '업무·행사', hint: '연수·출장', color: '#d0c4f0' },
    { id: '개인', page: 31, group: '개인', hint: '개인 일정·마음', color: '#ead7c4' },
];

export function destLabel(to, pages) {
    if (DEST_LABEL[to]) return DEST_LABEL[to];
    const page = pages?.[to - 1];
    return page?.title || `${to}쪽`;
}

export function topNavLabel(link, pageNo) {
    if (link.label) return link.label;
    if (link.to === pageNo + 1) return '다음';
    if (link.to === pageNo - 1) return '이전';
    if (link.to === 2) return '홈';
    return destLabel(link.to);
}

export const LEFT_TABS = [
    { label: '홈', to: 2 },
    { label: '쓱적', to: 496 },
    { label: '연간', to: 32 },
    { label: '주간', to: 46 },
    { label: '하루', to: 99 },
    { label: '학급', to: 140 },
    { label: '학생', to: 154 },
    { label: '출결', to: 231 },
    { label: '상담', to: 256 },
    { label: '수업', to: 335 },
    { label: '업무', to: 404 },
    { label: '태그', to: 9 },
    { label: '공책', to: 516 },
    { label: '칠판', to: 559 },
];

export const RIGHT_TABS = [
    { label: '3', to: 34 },
    { label: '4', to: 35 },
    { label: '5', to: 36 },
    { label: '6', to: 37 },
    { label: '7', to: 38 },
    { label: '8', to: 39 },
    { label: '9', to: 40 },
    { label: '10', to: 41 },
    { label: '11', to: 42 },
    { label: '12', to: 43 },
    { label: '1', to: 44 },
    { label: '2', to: 45 },
    { label: '스티커', to: 563 },
];

/** 활성 탭: 현재 쪽이 그 구간이면 켜집니다. */
export function activeLeft(page) {
    if (page === 1) return null;
    if (page === 2 || page === 3 || page === 4) return 2;
    if (page >= 5 && page <= 8) return 2;
    if (page >= 9 && page <= 31) return 9;
    if (page >= 32 && page <= 45) return 32;
    if (page >= 46 && page <= 98) return 46;
    if (page >= 99 && page <= 139) return 99;
    if (page >= 140 && page <= 153) return 140;
    if (page >= 154 && page <= 230) return 154;
    if (page >= 231 && page <= 255) return 231;
    if (page >= 256 && page <= 334) return 256;
    if (page >= 335 && page <= 403) return 335;
    if (page >= 404 && page <= 494) return 404;
    if (page >= 495 && page <= 515) return 496;
    if (page >= 516 && page <= 558) return 516;
    if (page >= 559 && page <= 562) return 559;
    return null;
}

export function activeRight(page) {
    if (page >= 34 && page <= 45) return page;
    if (page >= 563) return 563;
    return null;
}
