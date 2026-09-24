import { addDaysYmd, fromYmd } from './utils.js';

/** 음력 명절을 양력으로 적은 범위 (한국 월력요항 기준) */
export const LUNAR_YEAR_MIN = 2020;
export const LUNAR_YEAR_MAX = 2035;

/**
 * 설날(음 1/1)·부처님오신날(음 4/8)·추석(음 8/15)의 양력 날짜.
 * 중국력과 하루 차이날 수 있어 한국천문연구원/월력요항 값을 고정합니다.
 */
const LUNAR_FESTIVALS = {
    2020: { seollal: '2020-01-25', buddha: '2020-04-30', chuseok: '2020-10-01' },
    2021: { seollal: '2021-02-12', buddha: '2021-05-19', chuseok: '2021-09-21' },
    2022: { seollal: '2022-02-01', buddha: '2022-05-08', chuseok: '2022-09-10' },
    2023: { seollal: '2023-01-22', buddha: '2023-05-27', chuseok: '2023-09-29' },
    2024: { seollal: '2024-02-10', buddha: '2024-05-15', chuseok: '2024-09-17' },
    2025: { seollal: '2025-01-29', buddha: '2025-05-05', chuseok: '2025-10-06' },
    2026: { seollal: '2026-02-17', buddha: '2026-05-24', chuseok: '2026-09-25' },
    2027: { seollal: '2027-02-07', buddha: '2027-05-13', chuseok: '2027-09-15' },
    2028: { seollal: '2028-01-27', buddha: '2028-05-02', chuseok: '2028-10-03' },
    2029: { seollal: '2029-02-13', buddha: '2029-05-20', chuseok: '2029-09-22' },
    2030: { seollal: '2030-02-03', buddha: '2030-05-09', chuseok: '2030-09-12' },
    2031: { seollal: '2031-01-23', buddha: '2031-05-28', chuseok: '2031-10-01' },
    2032: { seollal: '2032-02-11', buddha: '2032-05-16', chuseok: '2032-09-19' },
    2033: { seollal: '2033-01-31', buddha: '2033-05-06', chuseok: '2033-09-08' },
    2034: { seollal: '2034-02-19', buddha: '2034-05-25', chuseok: '2034-09-27' },
    2035: { seollal: '2035-02-08', buddha: '2035-05-15', chuseok: '2035-09-16' },
};

const pad2 = (n) => String(n).padStart(2, '0');
const ymd = (year, month, day) => `${year}-${pad2(month)}-${pad2(day)}`;

const isWeekend = (date) => {
    const day = fromYmd(date).getDay();
    return day === 0 || day === 6;
};

/** 5월 셋째 월요일 (성년의날) */
const thirdMondayOfMay = (year) => {
    const dow = new Date(year, 4, 1).getDay();
    const firstMonday = 1 + (dow <= 1 ? 1 - dow : 8 - dow);
    return ymd(year, 5, firstMonday + 14);
};

const pushMark = (map, date, mark) => {
    if (!date) return;
    if (!map[date]) map[date] = [];
    map[date].push(mark);
};

const holidayIds = (map, date) => (map[date] || []).filter((m) => m.kind === 'holiday').map((m) => m.id);

/** 해당 연도에 대체공휴일을 쓰는지 (현행 규정 + 연도별 확대) */
const usesSubstitute = (id, year) => {
    if (id === 'seollal' || id === 'chuseok' || id === 'children') return year >= 2014;
    if (id === 'foundation') return year >= 2016;
    if (id === 'samil' || id === 'liberation' || id === 'hangeul') return year >= 2021;
    if (id === 'buddha' || id === 'christmas') return year >= 2023;
    if (id === 'labor') return year >= 2026;
    if (id === 'constitution') return year >= 2027;
    return false;
};

const placeSubstitute = (map, holidayDates, afterDate, name) => {
    let date = addDaysYmd(afterDate, 1);
    while (isWeekend(date) || holidayDates.has(date)) {
        date = addDaysYmd(date, 1);
    }
    holidayDates.add(date);
    pushMark(map, date, {
        id: 'substitute',
        kind: 'holiday',
        name,
        short: '대체휴일',
    });
};

const buildYear = (year) => {
    const map = {};
    const y = Number(year);
    if (!Number.isFinite(y)) return map;

    const lunar = LUNAR_FESTIVALS[y];
    const laborIsHoliday = y >= 2026;
    const constitutionIsHoliday = y >= 2026;

    // 양력 법정 공휴일
    pushMark(map, ymd(y, 1, 1), { id: 'newyear', kind: 'holiday', name: '신정', short: '신정' });
    pushMark(map, ymd(y, 3, 1), { id: 'samil', kind: 'holiday', name: '삼일절', short: '삼일절' });
    pushMark(map, ymd(y, 5, 5), { id: 'children', kind: 'holiday', name: '어린이날', short: '어린이날' });
    pushMark(map, ymd(y, 6, 6), { id: 'memorial', kind: 'holiday', name: '현충일', short: '현충일' });
    pushMark(map, ymd(y, 8, 15), { id: 'liberation', kind: 'holiday', name: '광복절', short: '광복절' });
    pushMark(map, ymd(y, 10, 3), { id: 'foundation', kind: 'holiday', name: '개천절', short: '개천절' });
    pushMark(map, ymd(y, 10, 9), { id: 'hangeul', kind: 'holiday', name: '한글날', short: '한글날' });
    pushMark(map, ymd(y, 12, 25), { id: 'christmas', kind: 'holiday', name: '크리스마스', short: '성탄절' });

    if (laborIsHoliday) {
        pushMark(map, ymd(y, 5, 1), { id: 'labor', kind: 'holiday', name: '근로자의날', short: '근로자날' });
    }
    if (constitutionIsHoliday) {
        pushMark(map, ymd(y, 7, 17), { id: 'constitution', kind: 'holiday', name: '제헌절', short: '제헌절' });
    }

    // 음력 명절·부처님오신날 (범위 밖 연도는 양력 공휴일만 표시)
    const seollalDays = [];
    const chuseokDays = [];
    if (lunar?.seollal) {
        const eve = addDaysYmd(lunar.seollal, -1);
        const next = addDaysYmd(lunar.seollal, 1);
        seollalDays.push(eve, lunar.seollal, next);
        pushMark(map, eve, { id: 'seollal', kind: 'holiday', name: '설날 전날', short: '설 전날' });
        pushMark(map, lunar.seollal, { id: 'seollal', kind: 'holiday', name: '설날', short: '설날' });
        pushMark(map, next, { id: 'seollal', kind: 'holiday', name: '설날 다음날', short: '설 연휴' });
        // 정월대보름 = 설날 + 14일
        pushMark(map, addDaysYmd(lunar.seollal, 14), { id: 'daeboreum', kind: 'memorial', name: '정월대보름', short: '대보름' });
    }
    if (lunar?.buddha) {
        pushMark(map, lunar.buddha, { id: 'buddha', kind: 'holiday', name: '부처님오신날', short: '부처님날' });
    }
    if (lunar?.chuseok) {
        const eve = addDaysYmd(lunar.chuseok, -1);
        const next = addDaysYmd(lunar.chuseok, 1);
        chuseokDays.push(eve, lunar.chuseok, next);
        pushMark(map, eve, { id: 'chuseok', kind: 'holiday', name: '추석 전날', short: '추석전날' });
        pushMark(map, lunar.chuseok, { id: 'chuseok', kind: 'holiday', name: '추석', short: '추석' });
        pushMark(map, next, { id: 'chuseok', kind: 'holiday', name: '추석 다음날', short: '추석연휴' });
    }

    // 주요 기념일 (쉬는 날이 아님)
    const memorials = [
        [2, 14, 'valentine', '발렌타인데이', '발렌타인'],
        [3, 14, 'white', '화이트데이', '화이트데이'],
        [4, 5, 'arbor', '식목일', '식목일'],
        [4, 19, 'apr19', '4·19혁명기념일', '4·19'],
        [5, 8, 'parents', '어버이날', '어버이날'],
        [5, 15, 'teachers', '스승의날', '스승의날'],
        [5, 18, 'may18', '5·18민주화운동', '5·18'],
        [5, 21, 'couple', '부부의날', '부부의날'],
        [6, 10, 'jun10', '6·10민주항쟁기념일', '6·10'],
        [6, 25, 'jun25', '6·25한국전쟁', '6·25'],
        [10, 1, 'armed', '국군의날', '국군의날'],
        [10, 24, 'un', '유엔의날', '유엔의날'],
        [11, 11, 'pepero', '빼빼로데이', '빼빼로'],
    ];
    memorials.forEach(([m, d, id, name, short]) => {
        pushMark(map, ymd(y, m, d), { id, kind: 'memorial', name, short });
    });
    if (!laborIsHoliday) {
        pushMark(map, ymd(y, 5, 1), { id: 'labor', kind: 'memorial', name: '근로자의날', short: '근로자날' });
    }
    if (!constitutionIsHoliday) {
        pushMark(map, ymd(y, 7, 17), { id: 'constitution', kind: 'memorial', name: '제헌절', short: '제헌절' });
    }
    pushMark(map, thirdMondayOfMay(y), { id: 'comingofage', kind: 'memorial', name: '성년의날', short: '성년의날' });

    const holidayDates = new Set(
        Object.keys(map).filter((date) => (map[date] || []).some((m) => m.kind === 'holiday'))
    );

    const tryFestivalSub = (days, id, label) => {
        if (!days.length || !usesSubstitute(id, y)) return new Set();
        const periodSet = new Set(days);
        const needs = days.some((date) => {
            if (isWeekend(date)) return true;
            return holidayIds(map, date).some((hid) => hid !== id);
        });
        if (needs) placeSubstitute(map, holidayDates, days[days.length - 1], label);
        return needs ? periodSet : new Set();
    };

    const covered = new Set([
        ...tryFestivalSub(seollalDays, 'seollal', '설날 대체공휴일'),
        ...tryFestivalSub(chuseokDays, 'chuseok', '추석 대체공휴일'),
    ]);

    const singleSubs = [];
    holidayDates.forEach((date) => {
        if (covered.has(date)) return;
        const marks = (map[date] || []).filter((m) => m.kind === 'holiday' && m.id !== 'substitute');
        const eligible = marks.filter((m) => usesSubstitute(m.id, y));
        if (!eligible.length) return;
        const overlap = marks.length > 1;
        if (isWeekend(date) || overlap) {
            singleSubs.push({ date, name: `${eligible[0].name} 대체공휴일` });
        }
    });
    singleSubs
        .sort((a, b) => a.date.localeCompare(b.date))
        .forEach((row) => placeSubstitute(map, holidayDates, row.date, row.name));

    return map;
};

const cache = new Map();

/** 한 해의 날짜 → 공휴일/기념일 목록 */
export const getHolidayMap = (year) => {
    const y = Number(year);
    if (cache.has(y)) return cache.get(y);
    const map = buildYear(y);
    cache.set(y, map);
    return map;
};

/** 해당 날짜의 공휴일·기념일 */
export const holidaysOn = (date) => {
    const ymdDate = String(date || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymdDate)) return [];
    const year = Number(ymdDate.slice(0, 4));
    // 설 전날이 전년도 12월로 넘어갈 수 있어 인접 해도 함께 봅니다.
    const marks = [
        ...(getHolidayMap(year - 1)[ymdDate] || []),
        ...(getHolidayMap(year)[ymdDate] || []),
        ...(getHolidayMap(year + 1)[ymdDate] || []),
    ];
    const seen = new Set();
    return marks.filter((m) => {
        const key = `${m.kind}:${m.id}:${m.name}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

export const isPublicHoliday = (date) => holidaysOn(date).some((m) => m.kind === 'holiday');

/** 칸에 보여줄 대표 표시 (공휴일 우선) */
const CAPTION_PRIORITY = { seollal: 0, chuseok: 0, children: 1, buddha: 2 };

export const holidayCaption = (date) => {
    const list = holidaysOn(date);
    if (!list.length) return null;
    const holidays = list
        .filter((m) => m.kind === 'holiday')
        .slice()
        .sort((a, b) => (CAPTION_PRIORITY[a.id] ?? 5) - (CAPTION_PRIORITY[b.id] ?? 5));
    const primary = holidays[0] || list[0];
    return {
        primary,
        title: list.map((m) => m.name).join(' · '),
        isHoliday: holidays.length > 0,
        isMemorial: holidays.length === 0,
    };
};
