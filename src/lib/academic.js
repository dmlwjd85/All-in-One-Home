/** 학교마다 다른 학사일정(개학·여름 방학식·2학기 개학·겨울 방학식·겨울 개학·종업식·재량휴업일).
    profile.academic = { '2026': { firstStart, firstEnd, secondStart, winterStart, winterBack, secondEnd, offDays: ['2026-05-04', ...] } }
    firstEnd는 여름 방학식 날, winterStart는 겨울 방학식 날, secondEnd는 종업식 날입니다(그날까지 수업일).
    winterBack은 겨울방학 뒤 다시 나오는 날(2월 개학)입니다. 겨울 방학식·겨울 개학은 둘 다 넣거나 둘 다 비웁니다.
    학년말에 한 번만 쉬는 학교(겨울 방학식 = 종업식)는 두 칸을 비우고 종업식만 넣습니다. */
import { addDaysYmd, isValidYmd } from './date.js';

export const ACADEMIC_FIELDS = [
    { id: 'firstStart', label: '개학일', hint: '1학기 첫날' },
    { id: 'firstEnd', label: '여름 방학식', hint: '1학기 마지막 날' },
    { id: 'secondStart', label: '2학기 개학일', hint: '2학기 첫날' },
    { id: 'winterStart', label: '겨울 방학식', hint: '겨울방학 전 마지막 날' },
    { id: 'winterBack', label: '겨울 개학일', hint: '겨울방학 뒤 첫날' },
    { id: 'secondEnd', label: '종업식', hint: '학년 마지막 날' },
];
/** 겨울 방학식·겨울 개학일. 학년말 통합 방학인 학교는 비워 둡니다(그래서 둘 다 있거나 둘 다 없어야 합니다). */
export const WINTER_FIELDS = ['winterStart', 'winterBack'];
export const OFF_FIELD = { id: 'offDays', label: '재량휴업일', hint: '여러 날 고를 수 있어요' };
const MAX_OFF = 40;

let current = {};

/** db.js가 상태가 바뀔 때마다 알려 줍니다. 휴일 계산(daymark)과 학기 계산(semester)이 이 값을 씁니다. */
export function setAcademicSource(academic) {
    current = academic && typeof academic === 'object' ? academic : {};
}

export function academicSource() {
    return current;
}

/** 한 학년도 학사일정. 잘못된 값은 버립니다. */
export function cleanYear(row = {}) {
    const out = {};
    for (const { id } of ACADEMIC_FIELDS) if (isValidYmd(row?.[id])) out[id] = row[id];
    const off = Array.isArray(row?.offDays) ? [...new Set(row.offDays.filter(isValidYmd))].sort().slice(0, MAX_OFF) : [];
    if (off.length) out.offDays = off;
    return out;
}

export function cleanAcademic(value = {}) {
    const out = {};
    if (!value || typeof value !== 'object') return out;
    for (const [year, row] of Object.entries(value)) {
        if (!/^20[2-9]\d$/.test(year)) continue;
        const clean = cleanYear(row);
        if (Object.keys(clean).length) out[year] = clean;
    }
    return out;
}

export function academicYear(schoolYear, academic = current) {
    return cleanYear(academic?.[String(Number(schoolYear) || 2026)] || {});
}

/** 날짜 순서가 맞는지, 겨울 방학식·개학이 짝으로 들어갔는지. 틀리면 이유를 돌려줍니다. */
export function academicProblem(row = {}) {
    const order = ACADEMIC_FIELDS.map(({ id, label }) => [row[id], label]).filter(([day]) => day);
    for (let i = 1; i < order.length; i += 1) {
        if (order[i][0] <= order[i - 1][0]) return `${order[i][1]}은 ${order[i - 1][1]}보다 뒤여야 해요.`;
    }
    if (Boolean(row.winterStart) !== Boolean(row.winterBack)) {
        return row.winterStart
            ? '겨울 개학일도 넣어 주세요. 겨울 방학식이 종업식과 같은 날이면 겨울 방학식을 비우고 종업식만 넣어요.'
            : '겨울 방학식도 넣어 주세요.';
    }
    return '';
}

/** 겨울 방학식과 겨울 개학이 짝으로 있는 학년도인지(그러면 종업식 뒤 쉬는 날은 봄방학입니다). */
function hasWinterBreak(row) {
    return Boolean(row.winterStart && row.winterBack && row.winterStart < row.winterBack);
}

/** 수업이 없는 날을 일정 모양으로 만듭니다(휴일 계산용, 화면 목록에는 넣지 않습니다). */
export function academicOffEvents(academic = current) {
    const out = [];
    for (const [year, raw] of Object.entries(academic || {})) {
        const row = cleanYear(raw);
        for (const day of row.offDays || []) out.push({ id: `acad-${day}`, date: day, title: '재량휴업일', kind: '휴일', source: 'academic' });
        if (row.firstEnd && row.secondStart && row.firstEnd < row.secondStart) {
            const from = addDaysYmd(row.firstEnd, 1);
            const to = addDaysYmd(row.secondStart, -1);
            if (from <= to) out.push({ id: `acad-summer-${year}`, date: from, end: to, title: '여름방학', kind: '휴일', source: 'academic' });
        }
        if (hasWinterBreak(row)) {
            const from = addDaysYmd(row.winterStart, 1);
            const to = addDaysYmd(row.winterBack, -1);
            if (from <= to) out.push({ id: `acad-winter-mid-${year}`, date: from, end: to, title: '겨울방학', kind: '휴일', source: 'academic' });
        }
        if (row.firstStart) {
            const prev = cleanYear(academic?.[String(Number(year) - 1)] || {});
            if (prev.secondEnd && prev.secondEnd < row.firstStart) {
                out.push({ id: `acad-winter-${year}`, date: addDaysYmd(prev.secondEnd, 1), end: addDaysYmd(row.firstStart, -1), title: hasWinterBreak(prev) ? '봄방학' : '겨울방학', kind: '휴일', source: 'academic' });
            }
        }
        if (row.secondEnd) {
            /* 다음 학년도 개학일을 아직 모르면 종업식 다음 날부터 2월 말까지를 방학으로 봅니다. */
            const nextStart = cleanYear(academic?.[String(Number(year) + 1)] || {}).firstStart;
            if (!nextStart) {
                const y = Number(row.secondEnd.slice(0, 4));
                const lastFeb = new Date(Date.UTC(y, 2, 0)).getUTCDate();
                const end = Number(row.secondEnd.slice(5, 7)) <= 2 ? `${y}-02-${String(lastFeb).padStart(2, '0')}` : '';
                const from = addDaysYmd(row.secondEnd, 1);
                if (end && from <= end) out.push({ id: `acad-winter-after-${year}`, date: from, end, title: hasWinterBreak(row) ? '봄방학' : '겨울방학', kind: '휴일', source: 'academic' });
            }
        }
    }
    return out;
}
