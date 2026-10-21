/**
 * 5차 규칙을 고친 뒤 한 번만 채점하는 예문.
 * 기준 시각은 2026-10-21. 기대는 원칙으로만 적었습니다.
 */
export const MSG_FRESH = [
    { id: 'a1', text: '이번주 금요일 4교시 학급 자치회 진행해 주세요.', ok: (items) => included(items).length === 1 && included(items)[0].date === '2026-10-23' && included(items)[0].time === '11:20' && included(items)[0].title.includes('자치') },
    { id: 'a2', text: '내일 6교시 환경 게시판 정리 좀 해 주세요', ok: (items) => included(items).length === 1 && included(items)[0].date === '2026-10-22' && included(items)[0].title.includes('게시판') },
    { id: 'a3', text: '모레 2교시 역할극 연습 진행 부탁드립니다', ok: (items) => included(items).length === 1 && included(items)[0].date === '2026-10-23' },
    { id: 'b1', text: '2027년 3월 4일 봄철 돌봄교실 운영 계획서 제출', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2027-03-04', word: '계획서' }) && included(items).every((item) => item.kind === '할 일') },
    { id: 'b2', text: '11/27(금)까지 현장학습 안전 서류 제출 바랍니다', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2026-11-27', word: '서류' }) },
    { id: 'b3', text: '겨울방학 급식 운영 계획서는 12/11(금)까지 작성해 주세요', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2026-12-11', word: '계획서' }) && included(items).every((item) => item.kind === '할 일') },
    { id: 'c1', text: '준비물은 11/20(금)까지 제출해 주세요. 빠진 물건은 알려 주세요.', ok: (items) => included(items).length === 1 && included(items)[0].date === '2026-11-20' && included(items).every((item) => item.date) },
    { id: 'c2', text: '이번주 안으로 알림장 검사 부탁드려요', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2026-10-23', word: '알림장' }) },
    { id: 'c3', text: '금주 안으로 독서 기록장 걷어 주세요', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2026-10-23', word: '독서' }) },
    { id: 'd1', text: '스쿨버스 노선이 11/3(화)부터 변경됩니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-03', word: '노선' }) },
    { id: 'd2', text: '2. 10/29 전교 체육대회', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-10-29', word: '체육' }) },
    { id: 'd3', text: '1월 15일(금)은 재량휴업일입니다.', ok: (items) => oneIncluded(items, { kind: '일정', date: '2027-01-15', word: '휴업' }) && included(items)[0].eventKind === '휴일' },
    { id: 'd4', text: '차주 수요일 통학차량 운행이 없습니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-10-28', word: '통학' }) },
    { id: 'd5', text: '다음 주 목요일부터 간식 메뉴가 바뀝니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-10-29', word: '간식' }) },
    { id: 'e1', text: '모레 급식이 9시 30분으로 당겨집니다', ok: (items) => included(items).length === 1 && included(items)[0].title.includes('급식') && !included(items)[0].title.includes('으로') },
    { id: 'e2', text: '1차 상담 신청은 11/2부터 받습니다', ok: (items) => included(items).length >= 1 && included(items).every((item) => item.title.replace(/\s+/g, '') !== '상담' && !item.title.includes('받습니다')) && included(items).some((item) => item.title.includes('신청')) },
    { id: 'e3', text: '내일 조회가 8시 20분으로 당겨집니다', ok: (items) => included(items).length === 1 && included(items)[0].title.includes('조회') && !/이\s*으로|가\s*으로/.test(included(items)[0].title) },
    { id: 'f1', text: '12월 7일부터 12월 11일까지 독서 주간입니다. 독후감은 12월 4일까지 제출해 주세요.', ok: (items) => hasIncluded(items, { kind: '일정', date: '2026-12-07', end: '2026-12-11', word: '독서' }) && hasIncluded(items, { kind: '할 일', date: '2026-12-04', word: '독후감' }) },
    { id: 'f2', text: '내일 2교시 음악 발표가 있습니다. 참관 메모는 모레까지 작성해 주세요.', ok: (items) => hasIncluded(items, { kind: '일정', date: '2026-10-22', time: '09:40', word: '음악' }) && hasIncluded(items, { kind: '할 일', date: '2026-10-23', word: '메모' }) },
    { id: 'f3', text: '내일 3교시 공개수업이 있고 참관록을 작성해 주세요', ok: (items) => hasIncluded(items, { kind: '일정', word: '공개수업' }) && items.some((item) => item.include === false && item.title.includes('참관')) },
    { id: 'g1', text: '점심 맛있었죠 ㅋㅋ 아이스크림까지 최고~', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { id: 'g2', text: '오늘 간식 진짜 달아요 ㅎㅎ 디저트까지 맛집', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { id: 'g3', text: '비 온대요 내일 우산 챙기세요 ㅠㅠ', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { id: 'h1', text: '안녕하세요 선생님들. 11/6(금) 전교 조회는 없습니다.', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-06', word: '조회' }) && items.every((item) => !String(item.title).includes('안녕하세요')) },
    { id: 'h2', text: '지호 아버님께 내일 중으로 약 복용 확인 부탁드려요', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2026-10-22', word: '약' }) && items.every((item) => !String(item.title).includes('중으로')) },
    { id: 'h3', text: '오늘 5반 선생님 생신이에요 🎂 축하 카드 붙이자', ok: (items) => items.length >= 1 && items.every((item) => item.include === false) },
    { id: 'h4', text: '[안내] (필독) 11/25(수) 학교 대청소의 날 운영', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-25', word: '대청소' }) && items.every((item) => !/\[안내\]|\(필독\)/.test(item.title || '')) },
    { id: 'h5', text: '11/19(목) 학교운영위원회', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2026-11-19', word: '학교운영위원회' }) },
    { id: 'h6', text: '방과후 플루트반 12/2(수) 휴강입니다.', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-12-02', time: '', word: '플루트' }) },
    { id: 'h7', text: '모레 방과후 시간에 학부모 면담', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-10-23', time: '16:00', word: '면담' }) },
    { id: 'h8', text: '수아 어머님께 오늘 하교 후에 전화 부탁드려요', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2026-10-21', word: '전화' }) },
    { id: 'h9', text: '수학여행 12/9~12/11\n2박 3일\n장소: 경주 일대', ok: (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-12-09' && included(items)[0].end === '2026-12-11' && String(included(items)[0].memo).includes('경주') },
    { id: 'h10', text: '내일까지 회신 바랍니다', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2026-10-22', word: '회신' }) },
];

function included(items) {
    return items.filter((item) => item.include !== false);
}

function oneIncluded(items, expect) {
    const real = included(items);
    return real.length === 1 && hasIncluded(real, expect);
}

function hasIncluded(items, expect) {
    return items.some((item) => {
        if (item.include === false) return false;
        if (expect.kind && item.kind !== expect.kind) return false;
        if (expect.date && item.date !== expect.date) return false;
        if (expect.end && item.end !== expect.end) return false;
        if (expect.time != null && (item.time || '') !== expect.time) return false;
        if (expect.word && !String(item.title || '').includes(expect.word)) return false;
        return true;
    });
}
