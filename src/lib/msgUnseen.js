/**
 * 6차 규칙을 고친 뒤 한 번만 채점하는 예문.
 * 기준 시각은 2026-10-21. 기대는 원칙으로만 적었습니다.
 */
export const MSG_UNSEEN = [
    { id: 'a1', text: '2028년 5월 12일 여름방학 돌봄교실 운영 계획서 제출', ok: (items) => one(items, { kind: '할 일', date: '2028-05-12', word: '계획서' }) && included(items).every((item) => item.kind === '할 일') },
    { id: 'a2', text: '2026년 11월 9일 교직원 연수', ok: (items) => one(items, { kind: '일정', date: '2026-11-09', word: '연수' }) },
    { id: 'a3', text: '2027년 3월 2일 개학식', ok: (items) => one(items, { kind: '일정', date: '2027-03-02', word: '개학' }) },
    { id: 'b1', text: '어제 소풍 정말 고생 많으셨습니다!', ok: (items) => items.length >= 1 && items.every((item) => item.include === false && item.low === true) },
    { id: 'b2', text: '10/28(화) 학급 합창 발표', ok: (items) => items.length === 1 && items[0].date === '2026-10-28' && items[0].low === true && items[0].include === false },
    { id: 'b3', text: '급식 시간 변경 공지', ok: (items) => items.length === 1 && items[0].kind === '일정' && items[0].low === true && items[0].include === false && items[0].title.includes('급식') },
    { id: 'c1', text: '학부모 상담 접수는 다음주 수요일까지 받습니다', ok: (items) => one(items, { kind: '할 일', date: '2026-10-28', word: '상담' }) && included(items).every((item) => item.kind === '할 일') },
    { id: 'd1', text: '2027년 2월 10일 졸업식', ok: (items) => one(items, { kind: '일정', date: '2027-02-10', word: '졸업' }) },
    { id: 'd2', text: '11월 27일 수료식', ok: (items) => one(items, { kind: '일정', date: '2026-11-27', word: '수료' }) },
    { id: 'e1', text: '12월 8일(화) 마을버스 미운행합니다', ok: (items) => one(items, { kind: '일정', date: '2026-12-08', word: '미운행' }) },
    { id: 'f1', text: '도윤이 상담 부탁이 들어왔어요. 글피까지 가능한 시간 알려주세요.', ok: (items) => one(items, { kind: '할 일', date: '2026-10-24', word: '상담' }) && included(items).some((item) => item.title.includes('도윤') && item.title.includes('회신')) },
    { id: 'g1', text: '졸업식 축사 원고는 2027년 1월 20일까지 제출', ok: (items) => one(items, { kind: '할 일', date: '2027-01-20', word: '원고' }) && included(items).every((item) => item.kind === '할 일') },
];

function included(items) {
    return items.filter((item) => item.include !== false);
}

function one(items, expect) {
    const real = included(items);
    return real.length === 1 && real.some((item) => {
        if (expect.kind && item.kind !== expect.kind) return false;
        if (expect.date && item.date !== expect.date) return false;
        if (expect.word && !String(item.title || '').includes(expect.word)) return false;
        return true;
    });
}
