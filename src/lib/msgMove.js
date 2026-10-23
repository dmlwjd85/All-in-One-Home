/**
 * 8차 날짜 이동·기간·잡담·마감·상대 날짜 규칙을 고친 뒤 한 번만 채점하는 예문.
 * 기준 시각은 2026-10-21. 기대는 원칙으로만 적었습니다.
 */
export const MSG_MOVE = [
    { id: 'm1', text: '하은 어머님 상담 11/10(화) → 11/11(수) 14:00으로 변경', ok: (items) => yellowOriginal(items, 0, 2, '하은 어머님 상담 11/10(화) → 11/11(수) 14:00으로 변경', { date: '2026-11-11', time: '14:00' }, { date: '2026-11-10' }) },
    { id: 'm2', text: '방과후 농구반 11/12(목) 수업은 11/19(목)로 연기됩니다.', ok: (items) => yellowOriginal(items, 0, 2, '방과후 농구반 11/12(목) 수업은 11/19(목)로 연기됩니다.', { date: '2026-11-19' }, { date: '2026-11-12' }) },
    { id: 'm3', text: '학예회 발표는 10/26(월)을 11/2(월)로 미뤄집니다', ok: (items) => yellowOriginal(items, 0, 2, '학예회 발표는 10/26(월)을 11/2(월)로 미뤄집니다', { date: '2026-11-02' }, { date: '2026-10-26' }) },
    { id: 'm4', text: '돌봄교실 11/3(화)는 11/10(화)로 바뀝니다', ok: (items) => yellowOriginal(items, 0, 2, '돌봄교실 11/3(화)는 11/10(화)로 바뀝니다', { date: '2026-11-10' }, { date: '2026-11-03' }) },
    { id: 'm5', text: '과학 탐구 주간 1월 6일(수)~8일(금)', ok: (items) => oneIncluded(items, { kind: '일정', date: '2027-01-06', end: '2027-01-08', word: '탐구' }) },
    { id: 'm6', text: '겨울 캠프 12월 30일(수)~2일(토)', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-12-30', end: '2027-01-02', word: '캠프' }) },
    { id: 'm7', text: '도서관 주간은 12월 14일부터 16일까지입니다', ok: (items) => oneIncluded(items, { kind: '일정', date: '2026-12-14', end: '2026-12-16', word: '도서관' }) },
    { id: 'm8', text: '내달 14일에 동생 결혼식이에요. 청첩장 나중에 드릴게요', ok: (items) => items.some((item) => item.date === '2026-11-14') && items.every((item) => item.include === false && item.low === true) },
    { id: 'm9', text: '11월 27일 16:30까지 단원평가 문항 탑재', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2026-11-27', time: '16:30', word: '탑재' }) },
    { id: 'm10', text: '11월 4일 1차, 11월 18일 2차 과학 탐구 보고서 검사', ok: (items) => included(items).length === 2 && included(items).every((item) => item.kind === '일정') && titled(items, '2026-11-04', '과학탐구보고서검사1차') && titled(items, '2026-11-18', '과학탐구보고서검사2차') },
    { id: 'm11', text: '이번달 말까지 개인정보 동의서 회신', ok: (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-31' && items[0].include !== false && items[0].low !== true && !/대략/.test(items[0].warning || '') && String(items[0].title).includes('동의서') },
    { id: 'm12', text: '다음달 초 전교직원 연수', ok: (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-01' && items[0].include === false && items[0].low === true && String(items[0].title).includes('연수') },
    { id: 'm13', text: '월초 교직원 조회 회의', ok: (items) => items.some((item) => item.date === '2026-10-01') && items.every((item) => item.include === false && item.low === true) },
    { id: 'm14', text: '급식 시간이 11/17(화)부터 변경됩니다', ok: (items) => included(items).length === 0 && items.filter((item) => item.include === false).length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-17' && items[0].title === '급식 시간이 11/17(화)부터 변경됩니다' },
    { id: 'm15', text: '차주 금요일까지 독서 검사 부탁드려요', ok: (items) => oneIncluded(items, { kind: '할 일', date: '2026-10-30', word: '독서' }) },
];

function included(items) {
    return items.filter((item) => item.include !== false);
}

function yellowOriginal(items, live, yellow, title, fresh, old) {
    const held = items.filter((item) => item.include === false);
    if (included(items).length !== live || held.length !== yellow) return false;
    if (!items.every((item) => item.kind === '일정' && item.title === title)) return false;
    const same = (item, row) => item.date === row.date && (row.time == null || (item.time || '') === row.time);
    return items.some((item) => same(item, fresh)) && items.some((item) => same(item, old));
}

function excludedDate(items, date) {
    return items.some((item) => item.date === date && item.include === false && item.low === true);
}

function titled(items, date, compact) {
    return included(items).some((item) => item.date === date && String(item.title || '').replace(/\s+/g, '') === compact);
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
