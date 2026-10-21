/**
 * 10차. 모호하면 노란 카드로 빼 두는 규칙을 한 번만 채점하는 예문.
 * 기준 시각은 2026-10-21. 요일은 weekdayKo로만 확인했습니다.
 * silent 는 넣을게요인 카드가 기대와 다른 경우입니다. 노란 카드로 보류한 것은 세지 않습니다.
 */
export const MSG_DOUBT = [
    { id: 'd1', text: '조회는 11/10(화) 09:40에서 10:30으로 변경', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-10', time: '10:30', word: '조회' }), silent: (items) => wrongIncluded(items, { kind: '일정', date: '2026-11-10', time: '10:30', word: '조회' }) },
    { id: 'd2', text: '학예 발표는 11/18(수)이 아니라 11/20(금)입니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-20', word: '발표' }) && excludedDate(items, '2026-11-18'), silent: (items) => wrongIncluded(items, { kind: '일정', date: '2026-11-20', word: '발표' }) },
    { id: 'd3', text: '독후감 제출 기한이 11/6(금)에서 11/13(금)으로 연장', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2026-11-13', word: '독후감' }) && excludedDate(items, '2026-11-06'), silent: (items) => wrongIncluded(items, { kind: '할 일', date: '2026-11-13', word: '독후감' }) },
    { id: 'd4', text: '소방 교육이 12/2(수)에서 12/4(금)로 순연됩니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-12-04', word: '소방' }) && excludedDate(items, '2026-12-02'), silent: (items) => wrongIncluded(items, { kind: '일정', date: '2026-12-04', word: '소방' }) },
    { id: 'd5', text: '아침 조회 11/24(화) → 11/25(수) 08:40', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-25', time: '08:40', word: '조회' }) && excludedDate(items, '2026-11-24'), silent: (items) => wrongIncluded(items, { kind: '일정', date: '2026-11-25', time: '08:40', word: '조회' }) },
    { id: 'd6', text: '예선 12/1(화), 본선 12/8(화) 합창', ok: (items) => listed(items, [{ date: '2026-12-01', word: '예선' }, { date: '2026-12-08', word: '본선' }]), silent: (items) => !listed(items, [{ date: '2026-12-01', word: '예선' }, { date: '2026-12-08', word: '본선' }]) && included(items).length > 0 },
    { id: 'd7', text: '1차 12/9(수), 2차 12/16(수) 실기 평가', ok: (items) => listed(items, [{ date: '2026-12-09', word: '실기' }, { date: '2026-12-16', word: '실기' }]), silent: (items) => !listed(items, [{ date: '2026-12-09', word: '실기' }, { date: '2026-12-16', word: '실기' }]) && included(items).length > 0 },
    { id: 'd8', text: '오전 11시 리코더, 오후 2시 합창 12/4(금)', ok: (items) => listed(items, [{ date: '2026-12-04', time: '11:00', word: '리코더' }, { date: '2026-12-04', time: '14:00', word: '합창' }]), silent: (items) => !listed(items, [{ date: '2026-12-04', time: '11:00', word: '리코더' }, { date: '2026-12-04', time: '14:00', word: '합창' }]) && included(items).length > 0 },
    { id: 'd9', text: '작년 5/8 현장학습 사진', ok: (items) => items.length >= 1 && items.every((item) => item.include === false && item.low === true) && items.some((item) => item.date === '2025-05-08'), silent: (items) => included(items).length > 0 },
    { id: 'd10', text: '지난번 12/2 학급 회의 자료', ok: (items) => items.length >= 1 && items.every((item) => item.include === false && item.low === true), silent: (items) => included(items).length > 0 },
    { id: 'd11', text: '소풍은 취소되고 박물관 견학으로 대체됩니다. 12/11(금)', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-12-11', word: '견학' }), silent: (items) => wrongIncluded(items, { kind: '일정', date: '2026-12-11', word: '견학' }) },
    { id: 'd12', text: '10/28 운동회는 취소되고 11/4 체육대회로 대체', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-04', word: '체육' }) && excludedDate(items, '2026-10-28'), silent: (items) => wrongIncluded(items, { kind: '일정', date: '2026-11-04', word: '체육' }) },
    { id: 'd13', text: '학급 앨범은 11/17(화) 가족 사진은 11/24(화)', ok: (items) => yellowDates(items, ['2026-11-17', '2026-11-24']), silent: (items) => included(items).length > 0 },
    { id: 'd14', text: '회의는 10시와 2시 11/12(목)', ok: (items) => items.length >= 2 && items.every((item) => item.include === false && item.low === true) && items.every((item) => item.date === '2026-11-12'), silent: (items) => included(items).length > 0 },
    { id: 'd15', text: '현장학습 11/5(목) 11/19(목) 둘 중 하나', ok: (items) => yellowDates(items, ['2026-11-05', '2026-11-19']), silent: (items) => included(items).length > 0 },
    { id: 'd16', text: '상담 11/11(수) 혹은 11/18(수)', ok: (items) => yellowDates(items, ['2026-11-11', '2026-11-18']), silent: (items) => included(items).length > 0 },
    { id: 'd17', text: '12/3(목) 발명대회', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-12-03', word: '발명' }), silent: (items) => wrongIncluded(items, { kind: '일정', date: '2026-12-03', word: '발명' }) },
    { id: 'd18', text: '11/27(금) 현장학습 장소 변경', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-27', word: '현장' }) && included(items).every((item) => item.title.includes('변경')), silent: (items) => wrongIncluded(items, { kind: '일정', date: '2026-11-27', word: '현장' }) },
    { id: 'd19', text: '글피 6교시 음악은 그대로입니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-10-24', time: '14:00', word: '음악' }) && included(items).every((item) => item.period === 6), silent: (items) => wrongIncluded(items, { kind: '일정', date: '2026-10-24', time: '14:00', word: '음악' }) },
    { id: 'd20', text: '진로 검사 11/9(월)에서 11/16(월)로 앞당겨졌습니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-11-16', word: '진로' }) && excludedDate(items, '2026-11-09'), silent: (items) => wrongIncluded(items, { kind: '일정', date: '2026-11-16', word: '진로' }) },
    { id: 'd21', text: '교직원 연수 12/15(화)이 아니라 12/17(목)', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-12-17', word: '연수' }) && excludedDate(items, '2026-12-15'), silent: (items) => wrongIncluded(items, { kind: '일정', date: '2026-12-17', word: '연수' }) },
    { id: 'd22', text: '과제 제출 기한이 12/18에서 12/22로 연장', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2026-12-22', word: '과제' }) && excludedDate(items, '2026-12-18'), silent: (items) => wrongIncluded(items, { kind: '할 일', date: '2026-12-22', word: '과제' }) },
];

function included(items) {
    return items.filter((item) => item.include !== false);
}

function excludedDate(items, date) {
    return items.some((item) => item.date === date && item.include === false && item.low === true);
}

function matches(item, expect) {
    if (expect.kind && item.kind !== expect.kind) return false;
    if (expect.date && item.date !== expect.date) return false;
    if (expect.time != null && (item.time || '') !== expect.time) return false;
    if (expect.word && !String(item.title || '').includes(expect.word)) return false;
    return true;
}

function oneIncluded(items, expect) {
    const real = included(items);
    return real.length === 1 && real.every((item) => matches(item, expect));
}

function listed(items, rows) {
    const real = included(items);
    return real.length === rows.length && real.every((item) => item.kind === '일정') && rows.every((row) => real.some((item) => matches(item, row)));
}

function yellowDates(items, dates) {
    return items.length >= dates.length
        && items.every((item) => item.include === false && item.low === true)
        && dates.every((date) => items.some((item) => item.date === date));
}

function wrongIncluded(items, expect) {
    return included(items).some((item) => !matches(item, expect));
}
