/** 아침 브리핑: 오늘 일정과 할 일을 비서처럼 차례를 잡아 권합니다. 화면은 ui/MorningBrief.jsx.
    계산만 여기 둡니다(검사하기 쉽게). 기록을 새로 만들거나 고치지 않고, 있는 자료를 읽기만 합니다.
    본 날짜는 이 기기 키 ssug-gyomu-brief 에만 둡니다(기록·클라우드에 넣지 않음). */

export const BRIEF_KEY = 'ssug-gyomu-brief';
export const BRIEF_FROM = '08:00';
export const BRIEF_MAX_STEPS = 5;

const isHm = (v) => typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const minutes = (hm) => (isHm(hm) ? Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)) : -1);
const hmOf = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const cut = (text, n = 22) => { const t = Array.from(String(text || '').replace(/\s+/g, ' ').trim()); return t.length > n ? `${t.slice(0, n - 1).join('')}…` : t.join(''); };

function readState(storage) {
    try {
        const raw = (storage || (typeof localStorage === 'undefined' ? null : localStorage))?.getItem?.(BRIEF_KEY);
        const value = raw ? JSON.parse(raw) : {};
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}
function writeState(patch, storage) {
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    const next = { ...readState(store), ...patch };
    try { store?.setItem?.(BRIEF_KEY, JSON.stringify(next)); } catch { /* 못 남기면 다음에 한 번 더 뜰 뿐입니다. */ }
    return next;
}

export function briefEnabled(storage) { return readState(storage).off !== true; }
export function setBriefEnabled(on, storage) { return writeState({ off: !on }, storage); }
export function briefSeen(ymd, storage) { return readState(storage).seen === ymd; }
export function markBriefSeen(ymd, storage) { return writeState({ seen: ymd }, storage); }

/** 지금 자동으로 띄울지: 켜져 있고, 아침 8시가 지났고, 오늘 아직 안 봤고, 쉬는 날이 아닐 때. */
export function shouldShowBrief({ ymd, hm, rest = false, started = true }, storage) {
    if (!started || rest) return false;
    if (!briefEnabled(storage)) return false;
    if (minutes(hm) < minutes(BRIEF_FROM)) return false;
    return !briefSeen(ymd, storage);
}

export function greeting(hm, weekday) {
    const m = minutes(hm);
    const hello = m < 12 * 60 ? '좋은 아침이에요' : m < 17 * 60 ? '오후도 힘내요' : '오늘도 수고 많으셨어요';
    return weekday ? `${hello}, ${weekday}요일이에요.` : `${hello}.`;
}

/** 할 일 차례: 마감 지남 → 오늘 마감 → 중요도 높음 → 내일 마감 → 나머지(마감 가까운 순). */
export function rankTodos(todos, ymd, tomorrow) {
    const open = (todos || []).filter((row) => row && !row.done && String(row.title || '').trim());
    const score = (row) => {
        const due = typeof row.due === 'string' ? row.due : '';
        if (due && due < ymd) return 0;
        if (due === ymd) return 1;
        if (row.pri === 3) return 2;
        if (due && due === tomorrow) return 3;
        return due ? 4 : 5;
    };
    return open
        .map((row, i) => ({ row, s: score(row), i }))
        .sort((a, b) => a.s - b.s || String(a.row.due || '9999').localeCompare(String(b.row.due || '9999')) || a.i - b.i)
        .map(({ row, s }) => ({ ...row, rank: s }));
}

function todoWhy(row, ymd) {
    if (row.rank === 0) return '마감이 지났어요';
    if (row.rank === 1) return '오늘까지예요';
    if (row.rank === 2) return '중요하다고 표시해 둔 일이에요';
    if (row.rank === 3) return '내일까지예요';
    return row.due ? `${Number(row.due.slice(5, 7))}/${Number(row.due.slice(8))}까지예요` : '';
}

/** 걷는 일(동의서 등)의 남은 사람. */
function pendingText(row) {
    const nos = Array.isArray(row.pendingNos) ? row.pendingNos.filter((n) => n != null) : [];
    if (nos.length) return `${nos.length}명 남았어요(${nos.slice(0, 6).join('·')}${nos.length > 6 ? '…' : ''}번)`;
    if (Number(row.of) > 0 && Number(row.got) >= 0 && row.of > row.got) return `${row.of - row.got}명 남았어요`;
    return '';
}

/**
 * 브리핑 만들기.
 * in: ymd, tomorrow, hm, weekday('목'), rest, checked(오늘 출결 마감), className,
 *     periods [{ n, label, start, length, specialist, locked }], events(오늘), tomorrowEvents, todos(전체),
 *     homework [{ id, title, date, submitted, total }], allergy [{ no, name }], follows [{ no, name }], birthdays [{ no, name }],
 *     absent [{ no, name, status }], noticeTomorrow(내일 알림장을 적었는지)
 * out: { hello, summary, steps[{ id, icon, title, sub, href }], agenda[{ time, text, now }], more }
 */
export function buildBriefing(input) {
    const {
        ymd, tomorrow, hm, weekday = '', checked = false, periods = [], events = [], tomorrowEvents = [], todos = [], homework = [],
        allergy = [], follows = [], birthdays = [], absent = [], noticeTomorrow = true,
    } = input;
    const now = minutes(hm);
    const lessons = periods.filter((p) => p.label && !p.locked);
    const ranked = rankTodos(todos, ymd, tomorrow);
    const urgent = ranked.filter((row) => row.rank <= 1);
    const todayEvents = [...events].sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')));
    const steps = [];
    const push = (step) => { if (step && !steps.some((s) => s.id === step.id)) steps.push(step); };

    /* 1. 급식 알레르기: 놓치면 안 되는 것부터 */
    if (allergy.length) push({ id: 'allergy', icon: '⚠️', title: `급식 알레르기 ${allergy.length}명 확인`, sub: `${allergy.slice(0, 4).map((s) => `${s.no}번 ${s.name}`).join(', ')}${allergy.length > 4 ? ' 외' : ''} · 급식 전에 한 번 챙겨 주세요`, href: allergy.length === 1 ? `#/students/${allergy[0].no}` : '#/today' });

    /* 2. 출결 */
    if (!checked) {
        const first = lessons[0];
        const before = first && isHm(first.start) && now < minutes(first.start) ? `${first.n}교시(${first.start}) 전에 ` : '';
        push({ id: 'attend', icon: '🙋', title: `${before}출결부터 확인해요`, sub: absent.length ? `미리 적어 둔 ${absent.slice(0, 3).map((s) => `${s.no}번 ${s.name} ${s.status}`).join(', ')}${absent.length > 3 ? ' 외' : ''}` : '모두 출석이면 「마감」만 누르면 돼요', href: `#/attend/${ymd}` });
    }

    /* 3. 시각이 정해진 오늘 일정 가운데 가장 가까운 것 */
    const nextEvent = todayEvents.find((row) => !isHm(row.time) || minutes(row.time) >= now - 10);
    if (nextEvent) push({ id: `event-${nextEvent.id}`, icon: '📅', title: `${isHm(nextEvent.time) ? `${nextEvent.time} ` : '오늘 '}${cut(nextEvent.title, 24)}`, sub: cut(nextEvent.memo, 44) || '준비물·장소를 한 번 더 확인해요', href: `#/schedule/week/${ymd}` });

    /* 4. 급한 할 일(마감 지남·오늘) */
    for (const row of urgent.slice(0, 2)) {
        push({ id: `todo-${row.id}`, icon: row.rank === 0 ? '🔥' : '✅', title: cut(row.title, 26), sub: [todoWhy(row, ymd), pendingText(row)].filter(Boolean).join(' · '), href: '#/todo' });
    }

    /* 5. 오늘 마감이거나 지난 과제 가운데 덜 걷힌 것 */
    const hw = homework.filter((row) => row.total > 0 && row.submitted < row.total && row.date && row.date <= ymd).sort((a, b) => String(a.date).localeCompare(String(b.date)))[0];
    if (hw) push({ id: `hw-${hw.id}`, icon: '📚', title: `과제 「${cut(hw.title, 16)}」 걷기`, sub: `${hw.total - hw.submitted}명이 아직 안 냈어요(${hw.submitted}/${hw.total})`, href: `#/homework/${hw.id}` });

    /* 6. 빈 시간 제안: 아직 시작 안 한 전담 시간에 다음 할 일을 */
    const free = periods.find((p) => p.specialist && p.label && isHm(p.start) && minutes(p.start) > now);
    const nextTodo = ranked.find((row) => !steps.some((s) => s.id === `todo-${row.id}`));
    if (free && nextTodo) {
        const end = hmOf(minutes(free.start) + (Number(free.length) || 40));
        push({ id: `slot-${nextTodo.id}`, icon: '🕒', title: `${free.n}교시 ${free.label}(${free.specialist}) 시간에 「${cut(nextTodo.title, 14)}」`, sub: `${free.start}~${end}이 비어요. ${todoWhy(nextTodo, ymd) || '미리 해 두면 가벼워져요'}`, href: '#/todo' });
    } else if (nextTodo && steps.length < 3) {
        push({ id: `todo-${nextTodo.id}`, icon: '✅', title: cut(nextTodo.title, 26), sub: [todoWhy(nextTodo, ymd), pendingText(nextTodo)].filter(Boolean).join(' · ') || '틈날 때 하나 해 두면 좋아요', href: '#/todo' });
    }

    /* 7. 다시 보기로 한 학생, 생일 */
    if (follows.length) push({ id: 'follow', icon: '👀', title: `${follows.slice(0, 3).map((s) => `${s.no}번 ${s.name}`).join(', ')}${follows.length > 3 ? ' 외' : ''} 다시 보기로 한 날`, sub: '지난 기록을 보고 한마디 건네 보세요', href: follows.length === 1 ? `#/students/${follows[0].no}` : '#/students' });
    if (birthdays.length) push({ id: 'birthday', icon: '🎂', title: `${birthdays.slice(0, 3).map((s) => s.name).join(', ')} 생일이에요`, sub: '아침에 축하 한마디 어때요?', href: birthdays.length === 1 ? `#/students/${birthdays[0].no}` : '#/students' });

    /* 8. 내일 준비 */
    const tmr = [...tomorrowEvents].sort((a, b) => String(a.time || '99').localeCompare(String(b.time || '99')))[0];
    if (tmr) push({ id: `tmr-${tmr.id}`, icon: '🎒', title: `내일 ${isHm(tmr.time) ? `${tmr.time} ` : ''}${cut(tmr.title, 20)}`, sub: noticeTomorrow ? (cut(tmr.memo, 40) || '오늘 미리 챙겨 두면 내일이 편해요') : '알림장에 준비물을 적어 보내면 좋아요', href: noticeTomorrow ? `#/schedule/week/${tomorrow}` : '#/notice' });
    else if (!noticeTomorrow && lessons.length) push({ id: 'notice', icon: '📝', title: '내일 알림장이 아직 비어 있어요', sub: '종례 전에 적어 두면 복사해서 바로 보낼 수 있어요', href: '#/notice' });

    const shown = steps.slice(0, BRIEF_MAX_STEPS);
    /* 오늘 흐름: 수업과 일정을 시각 순으로 */
    const agenda = [
        ...lessons.map((p) => ({ at: minutes(p.start), time: isHm(p.start) ? p.start : '', text: `${p.n}교시 ${p.label}${p.specialist ? ` · ${p.specialist}` : ''}`, kind: 'lesson', end: minutes(p.start) + (Number(p.length) || 40) })),
        ...todayEvents.map((row) => ({ at: isHm(row.time) ? minutes(row.time) : 24 * 60, time: isHm(row.time) ? row.time : '종일', text: cut(row.title, 22), kind: 'event', end: isHm(row.time) ? minutes(row.time) + 30 : 24 * 60 })),
    ].sort((a, b) => a.at - b.at).map((row) => ({ time: row.time, text: row.text, kind: row.kind, now: row.kind === 'lesson' && row.at <= now && now < row.end, past: row.end <= now }));

    const bits = [];
    if (lessons.length) bits.push(`수업 ${lessons.length}교시`);
    bits.push(todayEvents.length ? `일정 ${todayEvents.length}개` : '일정 없음');
    bits.push(ranked.length ? `할 일 ${ranked.length}개${urgent.length ? `(급한 것 ${urgent.length})` : ''}` : '할 일 없음');
    return {
        hello: greeting(hm, weekday),
        summary: bits.join(' · '),
        steps: shown,
        agenda,
        more: Math.max(0, steps.length - shown.length),
        calm: shown.length === 0,
    };
}
