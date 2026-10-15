/**
 * 쪽 번호 해시와 이름 있는 해시를 서로 바꿉니다.
 * `#p12` 는 예전 주소로 그대로 열립니다.
 */
import { monthPage, studentCardPage } from './nav.js';

export const VIEW_PAGES = {
    cover: 1,
    home: 2,
    prep: 3,
    guide: 5,
    tags: 9,
    year: 32,
    schedule: 33,
    weeks: 46,
    days: 99,
    class: 140,
    timetable: 141,
    students: 154,
    cards: 159,
    attend: 231,
    counsel: 256,
    lesson: 335,
    work: 404,
    deadlines: 405,
    budget: 468,
    write: 496,
    notebook: 516,
    board: 559,
    stickers: 563,
};

/** 위쪽 메뉴 키. 1쪽부터 580쪽까지 겹치지 않게 한 칸씩 맡습니다. */
export const MENU_ITEMS = [
    { key: 'cover', label: '표지', group: 'front' },
    { key: 'home', label: '홈', group: 'front' },
    { key: 'year', label: '연간', group: 'cal' },
    { key: 'month', label: '월간', group: 'cal' },
    { key: 'week', label: '주간', group: 'cal' },
    { key: 'schedule', label: '학사', group: 'cal' },
    { key: 'day', label: '하루', group: 'cal' },
    { key: 'class', label: '학급', group: 'class' },
    { key: 'students', label: '학생', group: 'class' },
    { key: 'attend', label: '출결', group: 'class' },
    { key: 'counsel', label: '상담', group: 'class' },
    { key: 'lesson', label: '수업', group: 'class' },
    { key: 'work', label: '업무', group: 'work' },
    { key: 'write', label: '쓱, 적', group: 'book' },
    { key: 'notebook', label: '공책', group: 'book' },
    { key: 'board', label: '칠판', group: 'book' },
    { key: 'stickers', label: '스티커', group: 'book' },
    { key: 'tags', label: '태그', group: 'book' },
];

const MENU_TO_VIEW = {
    cover: 'cover',
    home: 'home',
    tags: 'tags',
    year: 'year',
    schedule: 'schedule',
    week: 'weeks',
    day: 'days',
    class: 'class',
    students: 'students',
    attend: 'attend',
    counsel: 'counsel',
    lesson: 'lesson',
    work: 'work',
    write: 'write',
    notebook: 'notebook',
    board: 'board',
    stickers: 'stickers',
};

export function menuKeyForPage(page) {
    const n = Number(page);
    if (n <= 1) return 'cover';
    if (n <= 8) return 'home';
    if (n <= 31) return 'tags';
    if (n === 32) return 'year';
    if (n === 33) return 'schedule';
    if (n <= 45) return 'month';
    if (n <= 98) return 'week';
    if (n <= 139) return 'day';
    if (n <= 153) return 'class';
    if (n <= 230) return 'students';
    if (n <= 255) return 'attend';
    if (n <= 334) return 'counsel';
    if (n <= 403) return 'lesson';
    if (n <= 494) return 'work';
    if (n <= 515) return 'write';
    if (n <= 558) return 'notebook';
    if (n <= 562) return 'board';
    return 'stickers';
}

export function parseRange(range) {
    const matched = String(range || '').match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\s*~\s*(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
    if (!matched) return null;
    const iso = (year, month, day) => `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return {
        start: iso(matched[1], matched[2], matched[3]),
        end: iso(matched[4], matched[5], matched[6]),
    };
}

function ymdUtc(ymd) {
    const [year, month, day] = ymd.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
}

/** 주간 쪽의 날짜 범위. 범위 바로 바깥(학기 첫날처럼)은 가장 가까운 주로 붙입니다. */
export function weekPageForYmd(ymd, pages) {
    const key = String(ymd || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) return null;
    const weeks = [];
    for (const page of pages || []) {
        if (page.type !== 'week') continue;
        const span = parseRange(page.extra?.range);
        if (span) weeks.push({ n: page.n, ...span });
    }
    const inside = weeks.find((week) => key >= week.start && key <= week.end);
    if (inside) return inside.n;
    const target = ymdUtc(key);
    let best = null;
    let bestDist = Infinity;
    for (const week of weeks) {
        const start = ymdUtc(week.start);
        const end = ymdUtc(week.end);
        const dist = target < start ? (start - target) / 86400000 : (target - end) / 86400000;
        if (dist < bestDist) {
            bestDist = dist;
            best = week;
        }
    }
    if (best && bestDist <= 6) return best.n;
    return null;
}

export function monthTarget(page, pages) {
    const rec = pages?.[page - 1];
    if (rec?.type === 'month') return page;
    if (rec?.type === 'week') {
        const matched = String(rec.extra?.range || '').match(/(\d{4})\.\s*(\d{1,2})\./);
        if (matched) {
            const dest = monthPage(Number(matched[2]), Number(matched[1]));
            if (dest) return dest;
        }
    }
    return monthPage(3, 2026);
}

export function menuDestination(key, page, pages) {
    if (key === 'month') return monthTarget(page, pages);
    const view = MENU_TO_VIEW[key];
    return view ? VIEW_PAGES[view] : 2;
}

/**
 * 해시를 쪽·표준 주소로 풉니다.
 * exact: 주소가 그 쪽을 정확히 가리키면 true. 아니면 안내가 필요합니다.
 * preserve: 맞는 날짜 주소는 주 번호로 바꾸지 않습니다.
 */
export function resolveHash(hash, pages, max = 580) {
    const raw = String(hash || '').replace(/^#/, '');
    const cover = () => canonicalHash(1, pages);
    if (!raw) return { page: 1, canonical: cover(), exact: true, preserve: false };

    let matched = raw.match(/^p(\d+)$/i) || raw.match(/^\/p\/(\d+)$/);
    if (matched) {
        const n = Number(matched[1]);
        if (!Number.isInteger(n) || n < 1) {
            return { page: 1, canonical: cover(), exact: false, preserve: false };
        }
        if (n > max) {
            return { page: max, canonical: canonicalHash(max, pages), exact: false, preserve: false };
        }
        return { page: n, canonical: canonicalHash(n, pages), exact: true, preserve: false };
    }

    matched = raw.match(/^\/month\/(\d{4})\/(\d{1,2})$/);
    if (matched) {
        const year = Number(matched[1]);
        const month = Number(matched[2]);
        const dest = monthPage(month, year);
        if (!dest) return { page: VIEW_PAGES.year, canonical: '#/year', exact: false, preserve: false };
        const rec = pages?.[dest - 1];
        const exact = rec?.type === 'month' && Number(rec.extra?.year) === year && Number(rec.extra?.month) === month;
        return {
            page: dest,
            canonical: exact ? `#/month/${year}/${month}` : canonicalHash(dest, pages),
            exact,
            preserve: false,
        };
    }

    matched = raw.match(/^\/week\/(\d+)$/);
    if (matched) {
        const n = Number(matched[1]);
        const byWeek = (pages || []).find((page) => page.type === 'week' && Number(page.extra?.week) === n);
        if (!byWeek) return { page: VIEW_PAGES.weeks, canonical: '#/weeks', exact: false, preserve: false };
        return { page: byWeek.n, canonical: `#/week/${n}`, exact: true, preserve: false };
    }

    matched = raw.match(/^\/day\/(\d+)$/);
    if (matched) {
        const n = Number(matched[1]);
        const bySlot = (pages || []).find((page) => page.type === 'special-day' && Number(page.extra?.slot) === n);
        if (!bySlot) return { page: VIEW_PAGES.days, canonical: '#/days', exact: false, preserve: false };
        return { page: bySlot.n, canonical: `#/day/${n}`, exact: true, preserve: false };
    }

    matched = raw.match(/^\/date\/(\d{4}-\d{2}-\d{2})$/);
    if (matched) {
        const dest = weekPageForYmd(matched[1], pages);
        if (!dest) return { page: VIEW_PAGES.weeks, canonical: '#/weeks', exact: false, preserve: false };
        return { page: dest, canonical: `#/date/${matched[1]}`, exact: true, preserve: true };
    }

    matched = raw.match(/^\/cards\/(.+)$/);
    if (matched) {
        const token = matched[1];
        const n = Number(token);
        const whole = /^[1-9]\d*$/.test(token);
        const dest = whole ? studentCardPage(n) : 0;
        const rec = pages?.[dest - 1];
        const exact = whole && n <= 32 && rec?.type === 'student-card' && Number(rec.extra?.student) === n;
        if (!exact) return { page: VIEW_PAGES.cards, canonical: '#/cards', exact: false, preserve: false };
        return { page: dest, canonical: `#/cards/${n}`, exact: true, preserve: false };
    }

    const name = raw.replace(/^\//, '');
    if (Object.prototype.hasOwnProperty.call(VIEW_PAGES, name)) {
        return { page: VIEW_PAGES[name], canonical: `#/${name}`, exact: true, preserve: false };
    }
    return { page: 1, canonical: cover(), exact: false, preserve: false };
}

export function canonicalHash(page, pages) {
    const rec = pages?.[page - 1];
    if (rec?.type === 'month' && rec.extra?.year && rec.extra?.month) {
        return `#/month/${rec.extra.year}/${rec.extra.month}`;
    }
    if (rec?.type === 'week' && rec.extra?.week) return `#/week/${rec.extra.week}`;
    if (rec?.type === 'special-day' && rec.extra?.slot) return `#/day/${rec.extra.slot}`;
    if (rec?.type === 'student-card' && rec.extra?.student) return `#/cards/${rec.extra.student}`;
    const named = Object.entries(VIEW_PAGES).find(([, n]) => n === page);
    if (named) return `#/${named[0]}`;
    return `#/p/${page}`;
}

export function pageFromHash(hash, pages, max = 580) {
    return resolveHash(hash, pages, max).page;
}
