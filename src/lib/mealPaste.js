/**
 * 월간 급식표(표 붙여넣기)를 날짜별 메뉴로 나눕니다.
 * 저장 글에는 '알레르기'라는 낱말을 넣지 않습니다. 번호만 '1.2.5'처럼 붙입니다.
 * 메모 칸(notes)에 id 'meal-YYYYMM' 으로 두어, 기존 메모 동기화를 그대로 씁니다.
 */
import { isValidYmd, seoulYmd } from './date.js';
import { findDates } from './parse.js';
import { groupWeeks, inferYearMonth, isHeaderRow, parseTable, weekSlots, ymdFrom } from './monthGrid.js';
import { looksLikeCalGrid } from './calGrid.js';

export const MEAL_TAG = '급식';
export const MEAL_CODE_KEY = 'ssug-gyomu-meal-codes';

export function mealNoteId(year, month) {
    return `meal-${year}${String(month).padStart(2, '0')}`;
}

export function isMealNote(row) {
    return /^meal-\d{6}$/.test(String(row?.id || ''));
}

const CODE = /(\d{1,2}(?:\.\d{1,2})+)\s*$/;
const LONE = /^(.+?)\s+(\d{1,2})$/;

function scrubWords(text) {
    return String(text || '').replace(/알레르기|알러지/g, ' ').replace(/\s+/g, ' ').trim();
}

function dishLine(line) {
    let text = scrubWords(line).replace(/[()（）]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!text || /^메모\s*[:：]?$/.test(text)) return null;
    const kcalOnly = text.match(/^(\d{2,4})\s*kcal$/i) || text.match(/^열량\s*[:：]?\s*(\d{2,4})$/);
    if (kcalOnly) return { kcal: kcalOnly[1] };
    const origin = text.match(/^원산지\s*[:：]?\s*(.+)$/);
    if (origin) return { origin: origin[1].trim() };
    let codes = '';
    const dotted = text.match(CODE);
    if (dotted) {
        codes = dotted[1];
        text = text.slice(0, dotted.index).trim();
    } else {
        const lone = text.match(LONE);
        if (lone && /[가-힣]/.test(lone[1]) && !/학년|교시|명/.test(lone[1])) {
            codes = lone[2];
            text = lone[1].trim();
        }
    }
    text = text.replace(/[·,，]\s*$/g, '').trim();
    if (!/[가-힣]/.test(text) || text.length < 2) return null;
    return { name: text.slice(0, 40), codes };
}

function cellMenu(cell) {
    const items = [];
    let kcal = '';
    let origin = '';
    for (const line of String(cell || '').split(/\n/)) {
        const row = dishLine(line);
        if (!row) continue;
        if (row.kcal) kcal = kcal || row.kcal;
        else if (row.origin) origin = origin || row.origin;
        else if (row.name) items.push({ name: row.name, codes: row.codes || '' });
    }
    return { items, kcal, origin };
}

export function looksLikeMealTable(text) {
    const src = String(text || '');
    if (looksLikeCalGrid(src)) return false;
    const codes = src.match(/\d(?:\.\d+){1,}/g) || [];
    return codes.length >= 3;
}

function pushDay(days, date, menu, extra = {}) {
    if (!date || !menu.items.length) return;
    const prev = days.find((row) => row.date === date);
    if (prev) {
        prev.items.push(...menu.items);
        prev.kcal = prev.kcal || menu.kcal;
        prev.origin = prev.origin || menu.origin;
        prev.clipped = prev.clipped || extra.clipped;
        return;
    }
    days.push({ date, ...menu, clipped: Boolean(extra.clipped), day: Number(date.slice(8, 10)), offset: extra.offset || 0 });
}

export function parseMealTable(text, { today = '2026-11-15', year = 0, month = 0, now = new Date() } = {}) {
    const src = String(text || '').trim();
    const rows = parseTable(src);
    const weeks = groupWeeks(rows);
    const days = [];
    if (weeks.length && weeks.some((week) => (week.body || []).some((cell) => cellMenu(cell).items.length))) {
        const inferred = inferYearMonth(weeks, today || seoulYmd(now));
        const y = year || inferred?.year || Number(String(today).slice(0, 4));
        const m = month || inferred?.month || Number(String(today).slice(5, 7));
        for (const week of weeks) {
            const slots = weekSlots(week.header);
            slots.forEach((slot, col) => {
                if (!slot.day) return;
                const date = ymdFrom(y, m, slot.day, slot.offset);
                pushDay(days, date, cellMenu(week.body?.[col] || ''), { offset: slot.offset });
            });
        }
        return { mode: 'meal', year: y, month: m, days };
    }
    const blocks = src.split(/\n(?=\s*(?:\d{4}\s*년|\d{1,2}\s*월|\d{1,2}\s*[./]\s*\d{1,2}))/);
    for (const block of blocks) {
        const hit = findDates(block, now)[0];
        if (!hit) continue;
        pushDay(days, hit.ymd, cellMenu(block));
    }
    const first = days[0]?.date || '';
    return {
        mode: days.length ? 'meal' : 'none',
        year: year || (first ? Number(first.slice(0, 4)) : 0),
        month: month || (first ? Number(first.slice(5, 7)) : 0),
        days,
    };
}

export function shiftMealDays(days, year, month) {
    return (days || []).map((row) => {
        const date = row.day ? ymdFrom(year, month, row.day, row.offset || 0) : row.date;
        return { ...row, date: date || row.date };
    }).filter((row) => isValidYmd(row.date));
}

/** 클라우드에 올리는 글. 번호는 이름 뒤에 | 로만 붙이고, 민감 낱말은 넣지 않습니다. */
export function encodeMeals(days) {
    const lines = [];
    for (const day of [...(days || [])].sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
        if (!isValidYmd(day.date) || !day.items?.length) continue;
        lines.push(day.date);
        for (const item of day.items) {
            const name = scrubWords(item.name);
            if (!name) continue;
            const codes = String(item.codes || '').replace(/[^\d.]/g, '');
            lines.push(codes ? `${name}|${codes}` : name);
        }
        if (day.kcal) lines.push(`kcal ${String(day.kcal).replace(/\D/g, '').slice(0, 4)}`);
        if (day.origin) lines.push(`origin ${scrubWords(day.origin).slice(0, 80)}`);
    }
    return lines.join('\n').slice(0, 20000);
}

export function decodeMeals(text) {
    const days = [];
    let cur = null;
    for (const line of String(text || '').split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed) && isValidYmd(trimmed)) {
            cur = { date: trimmed, items: [], kcal: '', origin: '', day: Number(trimmed.slice(8, 10)), offset: 0 };
            days.push(cur);
            continue;
        }
        if (!cur) continue;
        if (/^kcal\s+(\d+)/.test(trimmed)) { cur.kcal = trimmed.match(/^kcal\s+(\d+)/)[1]; continue; }
        if (/^origin\s+/.test(trimmed)) { cur.origin = trimmed.replace(/^origin\s+/, ''); continue; }
        const [name, codes] = trimmed.split('|');
        if (scrubWords(name)) cur.items.push({ name: scrubWords(name), codes: codes || '' });
    }
    return days.filter((day) => day.items.length);
}

export function mealsFromNotes(notes) {
    const map = {};
    for (const row of notes || []) {
        if (!isMealNote(row)) continue;
        for (const day of decodeMeals(row.text)) map[day.date] = day;
    }
    return map;
}

export function mealCodesShown(storage) {
    try { return storage?.getItem(MEAL_CODE_KEY) === '1'; } catch { return false; }
}

export function setMealCodesShown(on, storage) {
    try {
        if (on) storage?.setItem(MEAL_CODE_KEY, '1');
        else storage?.removeItem(MEAL_CODE_KEY);
    } catch { /* 이 기기 설정만이라 실패해도 메뉴는 보입니다. */ }
    try { globalThis.window?.dispatchEvent(new Event('ssug-meal-codes')); } catch { /* 화면이 없어도 값은 남습니다. */ }
}

export function mealSummary(day) {
    const names = (day?.items || []).map((item) => item.name).filter(Boolean);
    if (!names.length) return '';
    return names.slice(0, 2).join(' · ') + (names.length > 2 ? ` 외 ${names.length - 2}` : '');
}
