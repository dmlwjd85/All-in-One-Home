/**
 * 7차 연도 규칙을 고친 뒤 한 번만 채점하는 예문.
 * 기준 시각은 2026-10-21. 기대는 원칙으로만 적었습니다.
 */
export const MSG_YEAR = [
    { id: 'y1', text: '29.4.6 봄 소풍', ok: (items) => one(items, { kind: '일정', date: '2029-04-06', word: '소풍' }) && noDigit(items) },
    { id: 'y2', text: '26.12.09 겨울 음악회를 실시합니다', ok: (items) => one(items, { kind: '일정', date: '2026-12-09', word: '음악' }) && noDigit(items) },
    { id: 'y3', text: '28/7/15 여름 캠프 개강', ok: (items) => one(items, { kind: '일정', date: '2028-07-15', word: '개강' }) && noDigit(items) },
    { id: 'y4', text: '2028. 5. 8.(월) 재량 휴무', ok: (items) => one(items, { kind: '일정', date: '2028-05-08', word: '휴무' }) && included(items)[0].eventKind === '휴일' && !included(items)[0].warning },
    { id: 'y5', text: '2029학년도 과학의 날 4월 19일(목) 운영', ok: (items) => one(items, { kind: '일정', date: '2029-04-19', word: '과학' }) && included(items).every((item) => !item.title.includes('학년도') && !item.warning) },
    { id: 'y6', text: '2029학년도 1월 15일(화) 입학식', ok: (items) => one(items, { kind: '일정', date: '2030-01-15', word: '입학' }) && !included(items)[0].warning },
    { id: 'y7', text: '2027학년도 12월 22일 종업식', ok: (items) => one(items, { kind: '일정', date: '2027-12-22', word: '종업' }) },
    { id: 'y8', text: '2024. 9. 3. 수학여행 사진 공유합니다', ok: (items) => items.length >= 1 && items.every((item) => item.include === false && item.low === true) && items.some((item) => item.date === '2024-09-03') },
    { id: 'y9', text: '2027년 6월 1일 교원 연수 안내를 공유합니다. 참고만 해주세요.', ok: (items) => items.some((item) => item.date === '2027-06-01') && items.every((item) => item.include === false && item.low === true) },
    { id: 'y10', text: '2028년 3월 1일 삼일절 휴무', ok: (items) => one(items, { kind: '일정', date: '2028-03-01', word: '휴무' }) && included(items)[0].eventKind === '휴일' },
    { id: 'y11', text: '27.03.02 새 학기 개학', ok: (items) => one(items, { kind: '일정', date: '2027-03-02', word: '개학' }) && noDigit(items) },
    { id: 'y12', text: '28.11.30까지 학생 건강검진 결과 입력', ok: (items) => one(items, { kind: '할 일', date: '2028-11-30', word: '입력' }) && noDigit(items) },
    { id: 'y13', text: '99.12.25 성탄 행사 자료 공유합니다', ok: (items) => items.length >= 1 && items.every((item) => item.include === false && item.low === true) && items.some((item) => item.date === '1999-12-25') },
];

function included(items) {
    return items.filter((item) => item.include !== false);
}

function noDigit(items) {
    return included(items).every((item) => !/\d/.test(item.title || ''));
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
