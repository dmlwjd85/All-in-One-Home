/** 한국 달력 날짜와 시각. */

export function fromYmd(s) {
    const [y, m, d] = String(s || '').split('-').map(Number);
    return new Date(y || 1970, (m || 1) - 1, d || 1);
}

export function toYmd(d) {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

export function addDaysYmd(s, n) {
    const d = fromYmd(s);
    d.setDate(d.getDate() + n);
    return toYmd(d);
}

export function startOfWeekMon(s) {
    const d = fromYmd(s);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return toYmd(d);
}

export function shiftMonth(ym, delta) {
    const [y, m] = String(ym).split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthCells(ym) {
    const [y, m] = String(ym).split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const startPad = (first.getDay() + 6) % 7;
    const days = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i += 1) {
        const d = new Date(y, m - 1, 1 - (startPad - i));
        cells.push({ ymd: toYmd(d), inMonth: false, day: d.getDate() });
    }
    for (let day = 1; day <= days; day += 1) {
        cells.push({
            ymd: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            inMonth: true,
            day,
        });
    }
    while (cells.length % 7 !== 0) {
        const last = fromYmd(cells[cells.length - 1].ymd);
        last.setDate(last.getDate() + 1);
        cells.push({ ymd: toYmd(last), inMonth: false, day: last.getDate() });
    }
    return cells;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/** 일정 시각. endTime이 있으면 14:00–16:00, 없으면 시작 시각만. */
export function eventClock(row) {
    const time = String(row?.time || '');
    const end = String(row?.endTime || '');
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(time) && /^([01]\d|2[0-3]):[0-5]\d$/.test(end)) return `${time}–${end}`;
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(time) ? time : '';
}

export function weekdayKo(ymd) {
    return WEEK[fromYmd(ymd).getDay()];
}

export function dayKeyFromYmd(ymd) {
    return DAY_KEYS[fromYmd(ymd).getDay()];
}

export function isValidYmd(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
    const [y, m, d] = s.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
}

/** 화면 확인용. ?at=08:42 가 있으면 시각만 고정합니다. */
let frozenHm = null;

export function freezeClock(hm) {
    frozenHm = /^\d{2}:\d{2}$/.test(hm || '') ? hm : null;
}

export function seoulParts(date = new Date()) {
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: 'Asia/Seoul',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        weekday: 'short',
    });
    const bag = {};
    for (const part of fmt.formatToParts(date)) {
        if (part.type !== 'literal') bag[part.type] = part.value;
    }
    const ymd = `${bag.year}-${bag.month}-${bag.day}`;
    let hour = Number(bag.hour);
    let minute = Number(bag.minute);
    if (frozenHm) {
        const [h, m] = frozenHm.split(':').map(Number);
        hour = h;
        minute = m;
    }
    const hm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const ap = hour < 12 ? '오전' : '오후';
    const h12 = hour % 12 === 0 ? 12 : hour % 12;
    const weekday = weekdayKo(ymd);
    return {
        ymd,
        hm,
        hour,
        minute,
        ap,
        h12,
        weekday,
        label: `${Number(bag.month)}월 ${Number(bag.day)}일 ${weekday}`,
        clock: `${ap} ${h12}:${String(minute).padStart(2, '0')}`,
    };
}

export function seoulYmd(date = new Date()) {
    return seoulParts(date).ymd;
}

export function formatKoDate(ymd, { withWeek = true, today = '' } = {}) {
    if (!isValidYmd(ymd)) return '';
    const [y, m, d] = ymd.split('-').map(Number);
    const head = `${m}월 ${d}일`;
    if (ymd === today) return withWeek ? `${head} (${weekdayKo(ymd)}) · 오늘` : `${head} · 오늘`;
    if (!withWeek) return `${y}년 ${head}`;
    return `${head} (${weekdayKo(ymd)})`;
}

export function monthTitle(ym) {
    const [y, m] = String(ym).split('-');
    return `${y}년 ${Number(m)}월`;
}

/** 할 일 마감. 예: 10/28(수), D-3. 오늘은 D-day, 지난 날은 D+n. */
export function dueLabel(due, today) {
    if (!isValidYmd(due) || !isValidYmd(today)) return '';
    const month = Number(due.slice(5, 7));
    const day = Number(due.slice(8, 10));
    const diff = Math.round((fromYmd(due).getTime() - fromYmd(today).getTime()) / 86400000);
    const mark = diff === 0 ? 'D-day' : (diff > 0 ? `D-${diff}` : `D+${-diff}`);
    return `${month}/${day}(${weekdayKo(due)}), ${mark}`;
}

export function weekSpanLabel(startYmd) {
    if (!isValidYmd(startYmd)) return '';
    const end = addDaysYmd(startYmd, 6);
    const left = `${Number(startYmd.slice(5, 7))}/${Number(startYmd.slice(8, 10))}`;
    const right = `${Number(end.slice(5, 7))}/${Number(end.slice(8, 10))}`;
    return `${left}–${right}`;
}

export const DAY_IDS = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const DAY_LABELS = ['월', '화', '수', '목', '금'];
