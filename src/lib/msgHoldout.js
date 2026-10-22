/** 규칙을 고칠 때 기대값을 맞추지 않는 확인용 예문. 채점 기준은 2026-10-21. */
export const MSG_HOLDOUT = [
    { principle: 'A', text: '오늘 급식 진짜 맛있었어요 ㅋㅋ 오후도 기대돼요~', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { principle: 'A', text: '우산 꼭 챙기세요 오후부터 비 온대요 ㅠㅠ', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { principle: 'A', text: '다들 점심 든든히 드세요 ㅎㅎ 오후 수업 화이팅~', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { principle: 'A', text: '모레 하늘 너무 맑대요 ㅋㅋ 산책 가고 싶다~', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { principle: 'A', text: '오늘 커피가 맛있네요~ 한잔 하실래요 ㅎㅎ', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { principle: 'A', text: '이번 주말 날씨 춥대요 ㅠㅠ 목도리 챙기세요', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { principle: 'B', text: '11/12 방과후 바둑 강좌는 쉽니다', ok: (items) => items.some((item) => item.date === '2026-11-12' && item.time === '' && item.title.includes('방과후') && item.title.includes('바둑')) },
    { principle: 'B', text: '방과후 영어 부 모임은 11월 6일에 있어요', ok: (items) => items.some((item) => item.date === '2026-11-06' && item.time === '' && item.title.includes('방과후') && item.title.includes('영어')) },
    { principle: 'B', text: '차주 월요일 방과후 요리교실 안내장을 나눠 주세요', ok: (items) => items.some((item) => item.date === '2026-10-26' && item.time === '' && item.title.includes('방과후') && item.title.includes('요리')) },
    { principle: 'B', text: '방과후학교 돌봄교실 신청은 10/30까지입니다', ok: (items) => items.some((item) => item.date === '2026-10-30' && item.time === '' && item.title.includes('방과후')) },
    { principle: 'B', text: '11/4부터 방과후 코딩 강사가 바뀝니다', ok: (items) => items.some((item) => item.date === '2026-11-04' && item.time === '' && item.title.includes('방과후') && item.title.includes('코딩')) },
    { principle: 'B', text: '방과후 로봇 교실은 11월 20일에 작품 발표가 있습니다', ok: (items) => items.some((item) => item.date === '2026-11-20' && item.time === '' && item.title.includes('방과후') && item.title.includes('로봇')) },
    { principle: 'C', text: '일시: 10/30(금) 전교 과학의 날', ok: (items) => titled(items, '과학') && !badTitle(items) },
    { principle: 'C', text: '검진일: 11/5 학생 건강검진', ok: (items) => titled(items, '건강검진') && !badTitle(items) },
    { principle: 'C', text: '11/3(화) 학교운영위원회 개최', ok: (items) => titled(items, '학교운영위원회') && !badTitle(items) },
    { principle: 'C', text: '학부모 동의서\n10/28까지 제출 바랍니다', ok: (items) => titled(items, '동의서') && titled(items, '제출') && !badTitle(items) },
    { principle: 'C', text: '일정 11/4(수) 가을 소풍 안내', ok: (items) => titled(items, '소풍') && !badTitle(items) },
    { principle: 'C', text: '기간: 11월 12일(목) 독서 골든벨', ok: (items) => titled(items, '골든벨') && !badTitle(items) },
    { principle: 'D', text: '10/29 학부모 상담 3명', ok: (items) => items.some((item) => item.kind === '일정' && item.date === '2026-10-29' && item.title.includes('상담')) },
    { principle: 'D', text: '내일 진로 상담이 있습니다', ok: (items) => items.some((item) => item.kind === '일정' && item.date === '2026-10-22' && item.title.includes('상담')) },
    { principle: 'D', text: '11월 2일 3교시 개별 상담', ok: (items) => items.some((item) => item.kind === '일정' && item.date === '2026-11-02' && item.time === '10:30' && item.title.includes('상담')) },
    { principle: 'D', text: '다음 주 월요일부터 상담 주간입니다', ok: (items) => items.some((item) => item.kind === '일정' && item.date === '2026-10-26' && item.title.includes('상담')) },
    { principle: 'D', text: '10/27(화) 상담 2건 예정', ok: (items) => items.some((item) => item.kind === '일정' && item.date === '2026-10-27' && item.title.includes('상담')) },
    { principle: 'D', text: '모레 오후 2시 학부모 상담', ok: (items) => items.some((item) => item.kind === '일정' && item.date === '2026-10-23' && item.time === '14:00' && item.title.includes('상담')) },
];

function titled(items, word) {
    return items.some((item) => String(item.title || '').includes(word));
}

function badTitle(items) {
    return items.some((item) => /^(?:일정|일시|기간|검진일|검사일|제출|회신|작성|안내|수|월|화|목|금|토|일)$/.test(String(item.title || '').replace(/\s+/g, '')) || /^(?:수|월|화|목|금|토|일|일정|일시|검진일|제출)\s/.test(item.title || '') || /\s(?:수|월|화|목|금|토|일)$/.test(item.title || ''));
}
