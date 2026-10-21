/**
 * 9차 날짜 이동 원칙을 고친 뒤 한 번만 채점하는 예문.
 * 기준 시각은 2026-10-21. 기대는 마지막 날짜·기간만 남긴다는 원칙으로 적었습니다.
 * 요일은 weekdayKo로 확인했습니다.
 */
export const MSG_SHIFT = [
    { id: 's1', text: '체육대회가 11/6(금)에서 11/4(수) 10:30로 앞당겨졌습니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-04', time: '10:30', word: '체육' }) && excludedDate(items, '2026-11-06') },
    { id: 's2', text: '과학의 날이 다음주 화요일에서 목요일로 옮겨졌습니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-10-29', time: '', word: '과학' }) && excludedDate(items, '2026-10-27') },
    { id: 's3', text: '박물관 견학 11/2(월) → 11/9(월)', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-09', time: '', word: '박물관' }) && excludedDate(items, '2026-11-02') },
    { id: 's4', text: '수학여행 11/3~11/5에서 11/10~11/12로 연기됩니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-10', end: '2026-11-12', word: '수학' }) && excludedPeriod(items, '2026-11-03', '2026-11-05') },
    { id: 's5', text: '합창 발표는 10/30(금)을 11/6(금)로 미뤄 주세요', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-06', time: '', word: '합창' }) && excludedDate(items, '2026-10-30') },
    { id: 's6', text: '돌봄이 12/2(수)에서 12/1(화) 16:00로 앞당겨집니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-12-01', time: '16:00', word: '돌봄' }) && excludedDate(items, '2026-12-02') },
    { id: 's7', text: '학부모 상담 10/26(월) → 10/28(수) 13:10으로 변경', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-10-28', time: '13:10', word: '상담' }) && excludedDate(items, '2026-10-26') },
    { id: 's8', text: '영어 말하기가 11/11(수)에서 11/13(금)로 변경됩니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-13', time: '', word: '영어' }) && excludedDate(items, '2026-11-11') },
    { id: 's9', text: '겨울 방학식 12/23~12/24에서 12/28~12/29로 옮겨집니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-12-28', end: '2026-12-29', word: '방학' }) && excludedPeriod(items, '2026-12-23', '2026-12-24') },
    { id: 's10', text: '조회가 이번주 금요일에서 목요일로 앞당겨졌습니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-10-22', time: '', word: '조회' }) && excludedDate(items, '2026-10-23') },
    { id: 's11', text: '단풍 소풍이 11/5(목)에서 11/6(금)로 미뤄졌습니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-06', time: '', word: '소풍' }) && excludedDate(items, '2026-11-05') },
    { id: 's12', text: '동요대회가 11/16(월) ➡ 11/20(금)', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-20', time: '', word: '동요' }) && excludedDate(items, '2026-11-16') },
    { id: 's13', text: '방과후 요리 10/28(수) 수업은 11/4(수)로 연기됩니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-04', time: '', word: '요리' }) && excludedDate(items, '2026-10-28') },
    { id: 's14', text: '도서관 이용교육이 11/9(월)에서 11/12(목) 09:40로 변경됩니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-12', time: '09:40', word: '이용' }) && excludedDate(items, '2026-11-09') },
    { id: 's15', text: '진로특강 12/8(화) -> 12/10(목) 14:00', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-12-10', time: '14:00', word: '진로' }) && excludedDate(items, '2026-12-08') },
    { id: 's16', text: '학생회가 11/18(수)에서 11/20(금)로 연기됩니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-20', time: '', word: '학생' }) && excludedDate(items, '2026-11-18') },
    { id: 's17', text: '소방훈련이 10/27(화)에서 10/23(금) 10:30로 앞당겨졌습니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-10-23', time: '10:30', word: '소방' }) && excludedDate(items, '2026-10-27') },
    { id: 's18', text: '학급앨범 촬영이 11/24(화)에서 11/25(수) 15:40로 옮겨집니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-25', time: '15:40', word: '촬영' }) && excludedDate(items, '2026-11-24') },
    { id: 's19', text: '수련회 1/11(월)~1/13(수)에서 1/18(월)~1/20(수)로 변경됩니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2027-01-18', end: '2027-01-20', word: '수련' }) && excludedPeriod(items, '2027-01-11', '2027-01-13') },
    { id: 's20', text: '교직원 연수 11/27(금) → 12/4(금)', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-12-04', time: '', word: '연수' }) && excludedDate(items, '2026-11-27') },
    { id: 's21', text: '발표회가 차주 화요일에서 금요일로 바뀝니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-10-30', time: '', word: '발표' }) && excludedDate(items, '2026-10-27') },
    { id: 's22', text: '운동회가 11/7(토)에서 11/14(토)로 미뤄집니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-14', time: '', word: '운동' }) && excludedDate(items, '2026-11-07') },
];

function included(items) {
    return items.filter((item) => item.include !== false);
}

function excludedDate(items, date) {
    return items.some((item) => item.date === date && item.include === false && item.low === true);
}

function excludedPeriod(items, date, end) {
    return items.some((item) => item.date === date && (item.end || '') === end && item.include === false && item.low === true);
}

function oneIncluded(items, expect) {
    const real = included(items);
    return real.length === 1 && real.every((item) => {
        if (expect.kind && item.kind !== expect.kind) return false;
        if (expect.date && item.date !== expect.date) return false;
        if (expect.end && (item.end || '') !== expect.end) return false;
        if (expect.time != null && (item.time || '') !== expect.time) return false;
        if (expect.word && !String(item.title || '').includes(expect.word)) return false;
        return true;
    });
}
