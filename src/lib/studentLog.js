/**
 * 학생 한 명의 기록 모아 보기: 종류·기간 거르기, 날짜순 정렬, 행발용 복사 글.
 * 다른 모듈을 부르지 않는 순수 함수만 둡니다.
 */

export const LOG_KINDS = ['전체', '관찰', '상담', '칭찬', '보호자'];

export const LOG_PERIODS = [
    { id: 'all', label: '모든 날' },
    { id: 'month', label: '이번 달' },
    { id: 'first', label: '1학기' },
    { id: 'second', label: '2학기' },
    { id: 'year', label: '올해' },
];

function ymdOk(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

/** 학년도. 1·2월은 앞 해 학년도입니다(2027-02-10 → 2026). */
export function schoolYearOf(ymd) {
    if (!ymdOk(ymd)) return 0;
    const y = Number(ymd.slice(0, 4));
    return Number(ymd.slice(5, 7)) < 3 ? y - 1 : y;
}

function lastDayOfFeb(year) {
    return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
}

function dayBefore(ymd) {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

/**
 * 기간의 처음과 끝(둘 다 포함). 'all'이면 null.
 *  - 이번 달: 오늘이 든 달
 *  - 올해: 학년도(3월 1일 ~ 다음 해 2월 끝). 담임에게 올해는 이 반을 맡은 해입니다.
 *  - 1학기: 3월 1일 ~ 2학기 시작 전날(여름방학 포함)
 *  - 2학기: 2학기 시작 ~ 다음 해 2월 끝
 * secondStart는 학사일정의 2학기 시작일입니다. 없으면 8월 17일로 봅니다.
 */
export function periodBounds(id, today, { secondStart = '' } = {}) {
    if (!ymdOk(today) || id === 'all' || !id) return null;
    if (id === 'month') {
        const ym = today.slice(0, 7);
        return { from: `${ym}-01`, to: `${ym}-31` };
    }
    const y = schoolYearOf(today);
    const start = `${y}-03-01`;
    const end = `${y + 1}-02-${lastDayOfFeb(y + 1)}`;
    const second = ymdOk(secondStart) && schoolYearOf(secondStart) === y ? secondStart : `${y}-08-17`;
    if (id === 'first') return { from: start, to: dayBefore(second) };
    if (id === 'second') return { from: second, to: end };
    if (id === 'year') return { from: start, to: end };
    return null;
}

/** 종류와 기간으로 거릅니다. 정렬은 하지 않습니다. */
export function filterLog(rows, { kind = '전체', period = 'all', today = '', secondStart = '' } = {}) {
    const span = periodBounds(period, today, { secondStart });
    return (rows || []).filter((row) => {
        if (kind !== '전체' && row?.kind !== kind) return false;
        if (span && !(row?.date >= span.from && row?.date <= span.to)) return false;
        return true;
    });
}

/** 날짜순. order가 'old'면 오래된 것부터, 아니면 최근 것부터. 같은 날은 남긴 시각(at)으로 정합니다. */
export function sortLog(rows, order = 'new') {
    const list = [...(rows || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.at || '').localeCompare(String(b.at || '')));
    return order === 'old' ? list : list.reverse();
}

/**
 * 행발·누가기록에 붙일 한 덩어리 글. 늘 오래된 것부터 씁니다.
 * mates(row) → 함께 연결된 학생 이름 배열(없으면 빈 배열).
 * 예)
 *   3번 김가나 기록 · 1학기 · 2개
 *   2026-03-04 (관찰) 발표를 끝까지 했어요.
 *   2026-04-10 (칭찬) 모둠 정리를 도왔어요. [함께: 이다라]
 */
export function studentLogText(student, rows, { periodLabel = '', kindLabel = '', mates } = {}) {
    const list = sortLog(rows, 'old');
    const head = [
        `${student?.no ?? ''}번 ${student?.name || ''} 기록`.trim(),
        kindLabel && kindLabel !== '전체' ? kindLabel : '',
        periodLabel,
        `${list.length}개`,
    ].filter(Boolean).join(' · ');
    const lines = list.map((row) => {
        const text = String(row?.text || '').trim().replace(/\r?\n/g, '\n    ');
        const with_ = typeof mates === 'function' ? mates(row) : [];
        const tail = with_ && with_.length ? ` [함께: ${with_.join(', ')}]` : '';
        return `${row?.date || ''} (${row?.kind || '기록'}) ${text}${tail}`;
    });
    return [head, ...lines].join('\n');
}
