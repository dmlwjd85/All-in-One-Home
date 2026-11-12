/*
 * 넓은 화면 '오늘'의 위젯판. 무엇을 켤지·순서·크기를 이 기기에만 둡니다(클라우드에 올리지 않음).
 * 위젯판을 켤지(기본 화면 ↔ 위젯)도 이 기기 몫입니다. 휴대폰 화면은 늘 기본 화면입니다.
 */
export const WIDGET_LAYOUT_KEY = 'ssug-gyomu-widgets';
export const WIDGET_MODE_KEY = 'ssug-gyomu-widget-mode';

export const WIDGET_SIZES = ['s', 'm', 'l'];
export const SIZE_LABEL = { s: '작게', m: '넓게', l: '크게' };

/** 고를 수 있는 위젯. size 는 처음 크기, icon 은 꾸미기에서 보이는 그림 글자, hint 는 한 줄 설명입니다. */
export const WIDGETS = [
    { id: 'day', label: '하루', size: 'm', icon: '☀️', hint: '오늘 날짜·시간표·일정·출결' },
    { id: 'weather', label: '날씨', size: 's', icon: '⛅', hint: '지금 기온과 사흘 예보' },
    { id: 'todo', label: '할 일', size: 's', icon: '✅', hint: '남은 할 일, 눌러서 끝내기' },
    { id: 'notice', label: '알림장', size: 's', icon: '📢', hint: '오늘·내일 알림장' },
    { id: 'month', label: '한 달', size: 'l', icon: '🗓️', hint: '날짜 칸마다 일정 제목' },
    { id: 'week', label: '한 주', size: 'm', icon: '📆', hint: '요일마다 시각과 일정' },
    { id: 'events', label: '다가오는 일정', size: 's', icon: '⏳', hint: 'D-day 순서' },
    { id: 'year', label: '일 년', size: 'm', icon: '🧭', hint: '달마다 큰 일정' },
];

/** 크기 단추를 누를 때마다 작게 → 넓게 → 크게 → 작게 */
export function nextSize(size) {
    const i = WIDGET_SIZES.indexOf(size);
    return WIDGET_SIZES[(i + 1) % WIDGET_SIZES.length];
}

/** 끌어다 놓기: from 위젯을 to 위젯 자리로 옮깁니다(사이 위젯은 한 칸씩 밀림). */
export function dropWidget(layout, fromId, toId) {
    const list = cleanLayout(layout);
    const from = list.findIndex((w) => w.id === fromId);
    const to = list.findIndex((w) => w.id === toId);
    if (from < 0 || to < 0 || from === to) return list;
    const next = [...list];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

const KNOWN = new Map(WIDGETS.map((w) => [w.id, w]));

export function defaultLayout() {
    return WIDGETS.map((w) => ({ id: w.id, on: true, size: w.size }));
}

/** 저장된 배치를 믿을 수 있는 모양으로 고칩니다. 모르는 위젯은 빼고, 새로 생긴 위젯은 꺼진 채로 뒤에 붙입니다. */
export function cleanLayout(raw) {
    if (!Array.isArray(raw)) return defaultLayout();
    const seen = new Set();
    const out = [];
    for (const item of raw) {
        const id = String(item?.id || '');
        if (!KNOWN.has(id) || seen.has(id)) continue;
        seen.add(id);
        out.push({ id, on: item.on !== false, size: WIDGET_SIZES.includes(item.size) ? item.size : KNOWN.get(id).size });
    }
    if (!out.length) return defaultLayout();
    for (const w of WIDGETS) if (!seen.has(w.id)) out.push({ id: w.id, on: false, size: w.size });
    return out;
}

/** 보이는 위젯 사이에서 한 칸 앞(-1)이나 뒤(+1)로 옮깁니다. 숨긴 위젯은 건너뜁니다. 끝에서는 그대로입니다. */
export function moveWidget(layout, id, delta) {
    const list = cleanLayout(layout);
    const shown = list.filter((w) => w.on);
    const at = shown.findIndex((w) => w.id === id);
    const other = shown[at + delta];
    if (at < 0 || !other) return list;
    const next = [...list];
    const a = next.findIndex((w) => w.id === id);
    const b = next.findIndex((w) => w.id === other.id);
    [next[a], next[b]] = [next[b], next[a]];
    return next;
}

export function setWidgetSize(layout, id, size) {
    if (!WIDGET_SIZES.includes(size)) return cleanLayout(layout);
    return cleanLayout(layout).map((w) => (w.id === id ? { ...w, size } : w));
}

export function toggleWidget(layout, id, on) {
    return cleanLayout(layout).map((w) => (w.id === id ? { ...w, on: typeof on === 'boolean' ? on : !w.on } : w));
}

export function shownWidgets(layout) {
    return cleanLayout(layout).filter((w) => w.on);
}

function store(storage) {
    if (storage) return storage;
    try { return globalThis.localStorage || null; } catch { return null; }
}

export function readWidgetLayout(storage) {
    try {
        const raw = store(storage)?.getItem(WIDGET_LAYOUT_KEY);
        return cleanLayout(raw ? JSON.parse(raw) : null);
    } catch {
        return defaultLayout();
    }
}

export function writeWidgetLayout(layout, storage) {
    const clean = cleanLayout(layout);
    try { store(storage)?.setItem(WIDGET_LAYOUT_KEY, JSON.stringify(clean)); } catch { /* 못 적어도 이번 화면에서는 씁니다. */ }
    return clean;
}

/** 넓은 화면 '오늘'을 위젯판으로 볼지. 기본은 기본 화면입니다. */
export function readWidgetMode(storage) {
    try { return store(storage)?.getItem(WIDGET_MODE_KEY) === 'board'; } catch { return false; }
}

export function writeWidgetMode(on, storage) {
    try { store(storage)?.setItem(WIDGET_MODE_KEY, on ? 'board' : 'home'); } catch { /* 이번 화면에서만 바뀝니다. */ }
    return Boolean(on);
}

/* ── 위젯 내용에 쓰는 날짜 계산(화면 없이 검사할 수 있게 여기에 둡니다) ── */

/** 일정 한 줄이 그 날짜에 걸치는지(여러 날 일정 포함). */
export function eventOn(row, ymd) {
    if (!row?.date) return false;
    const end = row.end && row.end >= row.date ? row.end : row.date;
    return row.date <= ymd && end >= ymd;
}

/** 오늘부터 다가오는 일정(끝나지 않은 것) n개. 오늘 걸친 일정이 먼저입니다. */
export function upcomingEvents(rows, today, n = 5) {
    return (rows || [])
        .filter((row) => row?.date && (row.end && row.end >= row.date ? row.end : row.date) >= today)
        .sort((a, b) => (a.date === b.date ? String(a.time || '').localeCompare(String(b.time || '')) : a.date.localeCompare(b.date)))
        .slice(0, n);
}

/** 올해 지난 날 비율(0~1)과 남은 날. */
export function yearProgress(today) {
    const y = Number(String(today).slice(0, 4));
    const start = Date.UTC(y, 0, 1);
    const end = Date.UTC(y + 1, 0, 1);
    const [, m, d] = String(today).split('-').map(Number);
    const now = Date.UTC(y, m - 1, d);
    const total = Math.round((end - start) / 86400000);
    const day = Math.round((now - start) / 86400000) + 1;
    return { day, total, left: total - day, ratio: Math.min(1, Math.max(0, day / total)) };
}

/** 달마다 일정 수(여러 날 일정은 시작한 달에 셉니다). */
export function eventsByMonth(rows, year) {
    const counts = Array(12).fill(0);
    for (const row of rows || []) {
        if (!row?.date || Number(row.date.slice(0, 4)) !== Number(year)) continue;
        counts[Number(row.date.slice(5, 7)) - 1] += 1;
    }
    return counts;
}

/** 오늘·내일 알림장(글이 있는 것만). */
export function noticesNear(rows, today, tomorrow) {
    const pick = (ymd) => (rows || []).find((row) => row?.date === ymd && String(row.text || '').trim()) || null;
    return { today: pick(today), tomorrow: pick(tomorrow) };
}

/** 날짜 → 그날 걸친 일정(시각 순, 시각 없는 것 먼저 아니라 뒤). 달력 칸에 제목을 쓰려고 씁니다. */
export function eventsByDay(rows, days) {
    const out = new Map(days.map((d) => [d, []]));
    for (const row of rows || []) {
        if (!row?.date) continue;
        for (const d of days) if (eventOn(row, d)) out.get(d).push(row);
    }
    const key = (r) => (/^\d{2}:\d{2}$/.test(String(r.time || '')) ? r.time : '99:99');
    for (const list of out.values()) list.sort((a, b) => key(a).localeCompare(key(b)) || String(a.title || '').localeCompare(String(b.title || '')));
    return out;
}

/** 달마다 일정 제목 n개(시작한 날 순)와 전체 수. 일 년 위젯에 씁니다. */
export function titlesByMonth(rows, year, n = 2) {
    const months = Array.from({ length: 12 }, () => []);
    for (const row of rows || []) {
        if (!row?.date || Number(row.date.slice(0, 4)) !== Number(year)) continue;
        months[Number(row.date.slice(5, 7)) - 1].push(row);
    }
    return months.map((list) => {
        list.sort((a, b) => a.date.localeCompare(b.date));
        return { count: list.length, top: list.slice(0, n) };
    });
}
