/**
 * 규칙을 고치는 동안 보지 않는 확인용 예문.
 * 기준 시각은 2026-10-21. 기대는 원칙으로만 적었습니다.
 */
export const MSG_BLIND = [
    { id: 'n1', text: '11월 18일(수) 전교 과학의 날 행사를 운영합니다.', ok: (items) => one(items, { kind: '일정', date: '2026-11-18', word: '과학' }) },
    { id: 'n2', text: '12월 3일 2교시 음악회를 실시합니다.', ok: (items) => one(items, { kind: '일정', date: '2026-12-03', time: '09:40', word: '음악회' }) },
    { id: 'n3', text: '11/20(금) 도서관 휴강입니다.', ok: (items) => one(items, { kind: '일정', date: '2026-11-20', word: '휴강' }) },
    { id: 'n4', text: '다음 주 화요일부터 급식 메뉴가 바뀝니다.', ok: (items) => items.length === 1 && items[0].include === false && items[0].low === true && items[0].date === '2026-10-27' && String(items[0].title).includes('급식') },
    { id: 'n5', text: '10월 30일 오후 2시 교직원 연수가 있습니다.', ok: (items) => one(items, { kind: '일정', date: '2026-10-30', time: '14:00', word: '연수' }) },
    { id: 'n6', text: '11.7(토) 운동회를 실시합니다.', ok: (items) => one(items, { kind: '일정', date: '2026-11-07', word: '운동회' }) },
    { id: 'g1', text: '애들 오늘 체육복 꼭 입고 오게 해 주세요', ok: (items) => one(items, { kind: '할 일', date: '2026-10-21', word: '체육복' }) },
    { id: 'g2', text: '내일 현장학습 도시락 싸 오라고 안내해 주세요', ok: (items) => one(items, { kind: '할 일', date: '2026-10-22', word: '도시락' }) },
    { id: 'g3', text: '모레 조회는 10분 당겨서 합니다 ㅎㅎ', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { id: 'g4', text: '선생님들 내일 수업 시정표 바뀌었대요 확인 부탁드려요', ok: (items) => one(items, { kind: '할 일', date: '2026-10-22', word: '시정표' }) },
    { id: 'h1', text: '가정통신문\n11월 9일(월) 학교 안전점검의 날 운영\n보호자 참관 신청은 11월 6일까지 회신 바랍니다.', ok: (items) => has(items, { kind: '일정', date: '2026-11-09', word: '안전' }) && has(items, { kind: '할 일', date: '2026-11-06', word: '회신' }) },
    { id: 'h2', text: '[가정통신문] 독감 예방접종 안내. 희망 학생은 10/28까지 동의서를 제출해 주세요.', ok: (items) => has(items, { kind: '할 일', date: '2026-10-28', word: '동의서' }) && items.filter((item) => item.include !== false).every((item) => item.kind === '할 일') },
    { id: 'h3', text: '11월 2일부터 11월 6일까지 학부모 상담주간입니다. 희망 시간은 10월 29일까지 회신해 주세요.', ok: (items) => has(items, { kind: '일정', date: '2026-11-02', end: '2026-11-06', word: '상담' }) && has(items, { kind: '할 일', date: '2026-10-29', word: '회신' }) },
    { id: 'p1', text: '서연이 어머님께 내일 전화 좀 부탁드려요', ok: (items) => one(items, { kind: '할 일', date: '2026-10-22', word: '전화' }) && !badHead(items) },
    { id: 'p2', text: '민수 약 먹이는 거 오늘 점심시간에 해 주세요', ok: (items) => one(items, { kind: '할 일', date: '2026-10-21', time: '12:10', word: '약' }) },
    { id: 'p3', text: '학부모 상담 일정표 오늘 중으로 보내 주세요', ok: (items) => one(items, { kind: '할 일', date: '2026-10-21', word: '상담' }) && items.every((item) => !String(item.title).includes('중으로')) },
    { id: 'c1', text: '오늘 1반 선생님 생신이래요 🎂 복도에서 축하 인사 나누자', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { id: 'c2', text: '점심 맛있었죠 ㅋㅋ 디저트까지 최고~', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { id: 'c3', text: '비 와서 운동장 미끄러워요 ㅠㅠ 우산 챙기세요', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { id: 'c4', text: '안녕하세요 선생님들 오늘 날씨 좋네요 ㅎㅎ', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) && items.every((item) => !String(item.title).includes('안녕하세요')) },
    { id: 'c5', text: '수고하셨습니다~ 내일 봐요', ok: (items) => items.length === 0 || items.every((item) => item.include === false) },
    { id: 'n7', text: '11/14(토) 1교시 공개수업이 있습니다.', ok: (items) => one(items, { kind: '일정', date: '2026-11-14', time: '09:00', word: '공개수업' }) },
    { id: 'n8', text: '방과후 바이올린반은 11월 27일 휴강입니다.', ok: (items) => one(items, { kind: '일정', date: '2026-11-27', time: '', word: '바이올린' }) && items.every((item) => item.time === '') },
    { id: 'n9', text: '교무부 알림. 12월 1일 교직원 회의를 실시합니다.', ok: (items) => one(items, { kind: '일정', date: '2026-12-01', word: '회의' }) },
    { id: 'n10', text: '11.24(화)~11.26(목) 2학기 기말고사를 실시합니다.', ok: (items) => one(items, { kind: '일정', date: '2026-11-24', end: '2026-11-26', word: '기말' }) },
    { id: 'n11', text: '문항 검토 의견은 11월 10일까지 제출 바랍니다.', ok: (items) => one(items, { kind: '할 일', date: '2026-11-10', word: '문항' }) },
    { id: 'n12', text: '내일 5교시 학급 회의 있습니다. 회의록은 모레까지 작성해 주세요.', ok: (items) => has(items, { kind: '일정', date: '2026-10-22', time: '13:10', word: '회의' }) && has(items, { kind: '할 일', date: '2026-10-23', word: '회의록' }) },
    { id: 'n13', text: '10/31 전교생 소방 대피 훈련이 있습니다.', ok: (items) => one(items, { kind: '일정', date: '2026-10-31', word: '대피' }) },
    { id: 'n14', text: '차주 월요일 스쿨버스 운행이 없습니다.', ok: (items) => one(items, { kind: '일정', date: '2026-10-26', word: '스쿨버스' }) },
    { id: 'p4', text: '지호 어머니께서 오늘 하교 후 면담 부탁드려요', ok: (items) => one(items, { kind: '할 일', date: '2026-10-21', word: '면담' }) },
    { id: 'h4', text: '가정통신문 현장체험학습 동의서는 11월 17일까지 회신 바랍니다.', ok: (items) => one(items, { kind: '할 일', date: '2026-11-17', word: '동의서' }) },
    { id: 'c6', text: '오늘 급식 잔반 적게 남기자 캠페인 해요 ㅎㅎ', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { id: 'n15', text: '[안내] (필독) 12월 8일 학교 평가의 날 운영', ok: (items) => one(items, { kind: '일정', date: '2026-12-08', word: '평가' }) && !badHead(items) },
    { id: 'p5', text: '안녕 선생님들 내일 교재 나눠 주세요', ok: (items) => one(items, { kind: '할 일', date: '2026-10-22', word: '교재' }) && !badHead(items) },
];

function one(items, expect) {
    const real = items.filter((item) => item.include !== false);
    return real.length === 1 && has(real, expect);
}

function has(items, expect) {
    return items.some((item) => {
        if (expect.kind && item.kind !== expect.kind) return false;
        if (expect.date && item.date !== expect.date) return false;
        if (expect.end && item.end !== expect.end) return false;
        if (expect.time != null && (item.time || '') !== expect.time) return false;
        if (expect.word && !String(item.title || '').includes(expect.word)) return false;
        if (item.include === false) return false;
        return !fieldOnly(item.title);
    });
}

function fieldOnly(title) {
    return /^(?:일정|일시|기간|검진일|안내|제출|할 일)$/.test(String(title || '').replace(/\s+/g, ''));
}

function badHead(items) {
    return items.some((item) => /안녕하세요|안녕 선생님|\[안내\]|\(필독\)|오늘 중으로/.test(item.title || ''));
}
