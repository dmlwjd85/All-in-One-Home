import { isValidYmd } from './date.js';

/** 날짜가 없거나 잘못된 달력·시간표는 보기를 유지하고 날짜만 오늘로 맞춥니다. */
function scheduleOpen(view, slug, today, incoming, invalid) {
    return pack('schedule', { view, date: today }, `#/schedule/${slug}/${today}`, incoming, invalid ? { notice: '그 날짜는 달력에 없어요. 일정에서 다시 골라 주세요.' } : {});
}

function pack(name, params, canonical, incoming, extra = {}) {
    return {
        name,
        params,
        replace: canonical === incoming ? '' : canonical,
        notice: '',
        openQuick: false,
        openQuickBar: false,
        ...extra,
    };
}

function pageRoute(n, today, incoming) {
    if (n === 2 || n === 1) return pack('today', {}, '#/today', incoming);
    if (n === 154) return pack('students', {}, '#/students', incoming);
    if (n === 231) return pack('attend', { date: today }, `#/attend/${today}`, incoming);
    if (n >= 159 && n <= 221 && (n - 157) % 2 === 0) {
        const no = (n - 157) / 2;
        return pack('student', { no }, `#/students/${no}`, incoming);
    }
    if (n >= 160 && n <= 222 && (n - 158) % 2 === 0) {
        const no = (n - 158) / 2;
        return pack('student', { no }, `#/students/${no}`, incoming);
    }
    if (n >= 257 && n <= 288) {
        const no = n - 256;
        return pack('student', { no }, `#/students/${no}`, incoming);
    }
    if (n >= 289 && n <= 320) {
        const no = n - 288;
        return pack('student', { no }, `#/students/${no}`, incoming);
    }
    if ([33, 141, 142, 143, 144].includes(n) || (n >= 34 && n <= 45)) {
        return pack('schedule', {}, '#/schedule', incoming);
    }
    if (n >= 404 && n <= 467) return pack('todo', {}, '#/todo', incoming);
    if (n === 496) return pack('today', {}, '#/today', incoming, { openQuick: true });
    if (n >= 1 && n <= 580) return pack('legacy', { page: String(n) }, `#/legacy/${n}`, incoming);
    return pack('today', {}, '#/today', incoming, { notice: '없는 쪽이라 오늘 화면으로 왔어요.' });
}

/** 예전 주소는 가장 가까운 새 화면으로 옮깁니다. */
export function resolveHash(raw, today) {
    const incoming = (raw || '#/today').split('?')[0] || '#/today';
    const body = incoming.replace(/^#/, '') || '/today';
    let path = body.startsWith('/') ? body : `/${body}`;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);

    const pageHash = path.match(/^\/p\/(\d+)$/) || incoming.match(/^#p(\d+)$/);
    if (pageHash) return pageRoute(Number(pageHash[1]), today, incoming);

    if (path === '/today') return pack('today', {}, '#/today', incoming);
    if (path === '/home' || path === '/cover' || path === '/') return pack('today', {}, '#/today', incoming);
    if (path === '/start') return pack('start', {}, '#/start', incoming);
    if (path === '/students') return pack('students', {}, '#/students', incoming);
    if (path === '/students/neis') return pack('neis', {}, '#/students/neis', incoming);
    const scheduleWeek = path.match(/^\/schedule\/week\/(\d{4}-\d{2}-\d{2})$/);
    if (scheduleWeek && isValidYmd(scheduleWeek[1])) {
        return pack('schedule', { view: '주', week: scheduleWeek[1], date: scheduleWeek[1] }, `#/schedule/week/${scheduleWeek[1]}`, incoming);
    }
    if (path === '/schedule/week') return pack('schedule', { view: '주' }, '#/schedule', incoming);
    if (path.startsWith('/schedule/week/')) {
        return pack('schedule', { view: '주' }, '#/schedule', incoming, { notice: '그 날짜는 달력에 없어요. 일정에서 다시 골라 주세요.' });
    }
    const scheduleMonth = path.match(/^\/schedule\/month\/(\d{4}-\d{2}-\d{2})$/);
    if (scheduleMonth && isValidYmd(scheduleMonth[1])) {
        return pack('schedule', { view: '달력', date: scheduleMonth[1] }, `#/schedule/month/${scheduleMonth[1]}`, incoming);
    }
    if (path.startsWith('/schedule/month')) {
        return scheduleOpen('달력', 'month', today, incoming, path !== '/schedule/month');
    }
    const scheduleTable = path.match(/^\/schedule\/table\/(\d{4}-\d{2}-\d{2})$/);
    if (scheduleTable && isValidYmd(scheduleTable[1])) {
        return pack('schedule', { view: '시간표', date: scheduleTable[1] }, `#/schedule/table/${scheduleTable[1]}`, incoming);
    }
    if (path === '/schedule/table' || path.startsWith('/schedule/table/')) {
        return scheduleOpen('시간표', 'table', today, incoming, path !== '/schedule/table');
    }
    if (path === '/schedule' || path === '/timetable' || path === '/class' || path === '/year' || path === '/weeks' || path === '/days') {
        return pack('schedule', {}, '#/schedule', incoming);
    }
    if (path === '/todo' || path === '/work' || path === '/deadlines' || path === '/budget') {
        return pack('todo', {}, '#/todo', incoming);
    }
    if (path === '/settings') return pack('settings', {}, '#/settings', incoming);
    if (path === '/settings/roster') return pack('roster', {}, '#/settings/roster', incoming);
    if (path === '/settings/legacy' || path === '/legacy') return pack('legacy', { page: '' }, '#/settings/legacy', incoming);
    if (path === '/write') return pack('today', {}, '#/today', incoming, { openQuick: true });
    if (path === '/quick') return pack('today', {}, '#/today', incoming, { openQuickBar: true });
    if (path === '/counsel') return pack('students', {}, '#/students', incoming);
    if (path === '/attend') return pack('attend', { date: today }, `#/attend/${today}`, incoming);

    const attendMonth = path.match(/^\/attend\/(\d{4}-\d{2}-\d{2})\/month$/);
    if (attendMonth && isValidYmd(attendMonth[1])) {
        return pack('attend', { date: attendMonth[1], span: 'month' }, `#/attend/${attendMonth[1]}/month`, incoming);
    }
    const attend = path.match(/^\/attend\/(\d{4}-\d{2}-\d{2})$/);
    if (attend && isValidYmd(attend[1])) return pack('attend', { date: attend[1] }, `#/attend/${attend[1]}`, incoming);
    if (path.startsWith('/attend/')) return pack('attend', { date: today }, `#/attend/${today}`, incoming);

    if (path === '/minutes' || path === '/meeting' || path === '/meetings') return pack('minutes', { mode: 'list', id: '' }, '#/minutes', incoming);
    if (path === '/minutes/new') return pack('minutes', { mode: 'new', id: '' }, '#/minutes/new', incoming);
    const minutesAt = path.match(/^\/minutes\/([A-Za-z0-9_-]{1,80})(\/edit)?$/);
    if (minutesAt) {
        const mode = minutesAt[2] ? 'edit' : 'view';
        return pack('minutes', { mode, id: minutesAt[1] }, `#/minutes/${minutesAt[1]}${minutesAt[2] || ''}`, incoming);
    }
    if (path.startsWith('/minutes/')) return pack('minutes', { mode: 'list', id: '' }, '#/minutes', incoming, { notice: '그 회의록을 찾지 못했어요.' });

    if (path === '/notice') return pack('notice', { date: '' }, '#/notice', incoming);
    const notice = path.match(/^\/notice\/(\d{4}-\d{2}-\d{2})$/);
    if (notice && isValidYmd(notice[1])) return pack('notice', { date: notice[1] }, `#/notice/${notice[1]}`, incoming);

    const student = path.match(/^\/students\/(\d{1,2})$/);
    if (student) {
        const no = Number(student[1]);
        if (no >= 1 && no <= 50) return pack('student', { no }, `#/students/${no}`, incoming);
        return pack('students', {}, '#/students', incoming, { notice: '그 번호는 명단에 없어요.' });
    }

    const cards = path.match(/^\/cards(?:\/(\d+))?$/);
    if (cards) {
        if (!cards[1]) return pack('students', {}, '#/students', incoming);
        const no = Number(cards[1]);
        if (no >= 1 && no <= 50) return pack('student', { no }, `#/students/${no}`, incoming);
        return pack('students', {}, '#/students', incoming, { notice: '그 번호는 명단에 없어요.' });
    }

    const legacy = path.match(/^\/legacy\/(\d{1,3})$/);
    if (legacy) {
        const n = Number(legacy[1]);
        if (n >= 1 && n <= 580) return pack('legacy', { page: String(n) }, `#/legacy/${n}`, incoming);
        return pack('legacy', { page: '' }, '#/settings/legacy', incoming);
    }

    const day = path.match(/^\/day\/(\d{4}-\d{2}-\d{2})$/);
    if (day && isValidYmd(day[1])) return pack('day', { date: day[1] }, `#/day/${day[1]}`, incoming);
    if (path === '/day') return pack('day', { date: today }, `#/day/${today}`, incoming);
    if (path.startsWith('/day/')) return pack('schedule', {}, '#/schedule', incoming, { notice: '그 날짜는 달력에 없어요. 일정에서 다시 골라 주세요.' });

    if (/^\/(?:week|month|day|date)\//.test(path)) return pack('schedule', {}, '#/schedule', incoming);

    return pack('today', {}, '#/today', incoming, { notice: '그 화면은 이제 오늘 화면에서 이어서 볼 수 있어요.' });
}
