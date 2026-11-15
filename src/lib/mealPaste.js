/**
 * 월간 급식표(표 붙여넣기)를 날짜별 메뉴로 나눕니다.
 * 저장 글에는 '알레르기'라는 낱말을 넣지 않습니다. 번호만 '1.2.5'처럼 붙입니다.
 * 메모 칸(notes)에 id 'meal-YYYYMM' 으로 두어, 기존 메모 동기화를 그대로 씁니다.
 */
import { isValidYmd, seoulYmd } from './date.js';
import { findDates } from './parse.js';
import { groupWeeks, inferYearMonth, isHeaderRow, parseTable, weekSlots, ymdFrom } from './monthGrid.js';
import { looksLikeCalGrid } from './calGrid.js';
import { fixMenuName } from './hangulFix.js';

export const MEAL_TAG = '급식';
export const MEAL_CODE_KEY = 'ssug-gyomu-meal-codes';

export function mealNoteId(year, month) {
    return `meal-${year}${String(month).padStart(2, '0')}`;
}

export function isMealNote(row) {
    return /^meal-\d{6}$/.test(String(row?.id || ''));
}

const CODE = /(\d{1,2}(?:\.\d{1,2})+)\s*$/;
const LONE = /^(.+?)\s*(?<![\d.])(\d{1,2})$/;

function scrubWords(text) {
    return String(text || '').replace(/알레르기|알러지/g, ' ').replace(/\s+/g, ' ').trim();
}

const LABEL = /^(?:조식|중식|석식|아침|점심|저녁|구분|식단|식단표|메뉴|요일|날짜|일자|급식|비고|학교급식|영양소|영양량)$/;
const NUTRIENT = /단백질|탄수화물|지방|칼슘|철분|비타민|나트륨|영양량|에너지/;
const CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';

/** 번호 표기를 '1.2.5' 한 가지로 맞춥니다. ①②, 1,2,5, (1.2.5), 글자 인식이 붙인 괄호 조각까지. */
function tidyLine(line) {
    let text = scrubWords(line);
    text = text.replace(/[①-⑳]/g, (ch) => `${CIRCLED.indexOf(ch) + 1}.`);
    text = text.replace(/[()（）\[\]{}<>]/g, ' ');
    text = text.replace(/(\d)\s*[,，、]\s*(?=\d)/g, '$1.');
    text = text.replace(/(\d)\.\s+(?=\d)/g, '$1.');
    return text.replace(/\.+(\s|$)/g, '$1').replace(/\s+/g, ' ').trim();
}

function dishLine(line) {
    let text = tidyLine(line);
    if (!text || /^메모\s*[:：]?$/.test(text)) return null;
    const kcalOnly = text.match(/^(\d{2,4})(?:\.\d+)?\s*kcal$/i) || text.match(/^(?:열량|에너지)\s*[:：]?\s*(\d{2,4})(?:\.\d+)?(?:\s*kcal)?$/i);
    if (kcalOnly) return { kcal: kcalOnly[1] };
    const origin = text.match(/^원산지\s*[:：]?\s*(.+)$/);
    if (origin) return { origin: origin[1].trim() };
    if (NUTRIENT.test(text)) {
        const kcal = text.match(/(\d{3,4})(?:\.\d+)?\s*kcal/i);
        return kcal ? { kcal: kcal[1] } : null;
    }
    /* 숫자 세 자리 넘게 시작하는 줄은 메뉴가 아니라 열량 같은 숫자 줄입니다(사진에서 'kcal'이 깨져 읽힌 경우 포함). */
    if (/^\d{3,}/.test(text)) return null;
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
    text = text.replace(/[·,，.:;|/\\-]+\s*$/g, '').replace(/^[·,，.:;|*\-]+\s*/g, '').trim();
    if (!/[가-힣]/.test(text) || LABEL.test(text.replace(/\s+/g, ''))) return null;
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

const WEEK = '일월화수목금토';
const OPEN_ = '[(\\[{<（]?';
const CLOSE_ = '[)\\]}>）]?';
const WD = '([일월화수목금토])(?:요일)?';
const WD_OPT = `(?:${OPEN_}${WD}${CLOSE_})?`;
const RE_MD_KO = new RegExp(`^(\\d{1,2})월(\\d{1,2})일?${WD_OPT}$`);
const RE_MD = new RegExp(`^(\\d{1,2})[/.\\-](\\d{1,2})\\.?${WD_OPT}$`);
const RE_MD_SLASH7 = new RegExp(`^(1[0-2]|[1-9])7(\\d{1,2})[(\\[{<（]${WD}${CLOSE_}$`);
const RE_D = new RegExp(`^(\\d{1,2})일?${WD_OPT}$`);
const RE_WD_D = new RegExp(`^${WD}${OPEN_}(\\d{1,2})일?${CLOSE_}$`);
const RE_WD = new RegExp(`^${OPEN_}${WD}${CLOSE_}$`);

function okDay(day) { return day >= 1 && day <= 31; }
function okMonth(month) { return month >= 1 && month <= 12; }

/** 한 줄이 날짜 표시이면 { month, day, wd } (없는 값은 0·-1). 아니면 null. */
function dateToken(line, alone) {
    const text = String(line || '').replace(/\s+/g, '');
    if (!text || text.length > 14) return null;
    let m = text.match(RE_MD_KO);
    if (m && okMonth(Number(m[1])) && okDay(Number(m[2]))) return { month: Number(m[1]), day: Number(m[2]), wd: m[3] ? WEEK.indexOf(m[3]) : -1 };
    m = text.match(RE_MD);
    /* '5.6' 은 번호일 수도 있어, 점으로 쓴 날짜는 요일이 붙었거나 칸에 그것만 있을 때만 날짜로 봅니다. */
    if (m && okMonth(Number(m[1])) && okDay(Number(m[2])) && (m[3] || alone || !text.includes('.'))) return { month: Number(m[1]), day: Number(m[2]), wd: m[3] ? WEEK.indexOf(m[3]) : -1 };
    m = text.match(RE_MD_SLASH7);
    /* 글자 인식이 '11/17(화)'의 빗금을 7로 읽은 경우('11717(화)'). */
    if (m && okDay(Number(m[2]))) return { month: Number(m[1]), day: Number(m[2]), wd: WEEK.indexOf(m[3]) };
    m = text.match(RE_D);
    if (m && okDay(Number(m[1]))) return { month: 0, day: Number(m[1]), wd: m[2] ? WEEK.indexOf(m[2]) : -1 };
    m = text.match(RE_WD_D);
    if (m && okDay(Number(m[2]))) return { month: 0, day: Number(m[2]), wd: WEEK.indexOf(m[1]) };
    return null;
}

function weekdayOnly(line) {
    const m = String(line || '').replace(/\s+/g, '').match(RE_WD);
    return m ? WEEK.indexOf(m[1]) : -1;
}

/** 칸 하나를 날짜(있으면)와 메뉴로 나눕니다. */
function readCell(cell) {
    const lines = String(cell || '').split('\n').map((line) => line.trim()).filter(Boolean);
    let date = null;
    let wd = -1;
    let used = 0;
    for (let i = 0; i < Math.min(2, lines.length); i += 1) {
        const only = weekdayOnly(lines[i]);
        if (only >= 0) { wd = only; used = i + 1; continue; }
        if (date) break;
        const token = dateToken(lines[i], lines.length <= 2);
        if (!token) break;
        date = token;
        used = i + 1;
    }
    if (date && date.wd < 0) date.wd = wd;
    const rest = lines.slice(date || wd >= 0 ? used : 0).join('\n');
    return { date, wd: date ? date.wd : wd, menu: cellMenu(rest), text: rest };
}

function monthsApart(y, m, ty, tm) { return (y * 12 + m) - (ty * 12 + tm); }

/**
 * 칸으로 나뉜 표(사진에서 읽은 표, 형식이 다른 붙여넣기)를 날짜별 메뉴로 묶습니다.
 * 받는 모양: '16' · '16일' · '11/16(월)' · '11월 16일' 같은 날짜 줄 아래(또는 오른쪽)에 메뉴 칸, 칸 첫 줄에 날짜가 있는 달력 모양,
 * 요일만 따로 있는 줄, 맨 왼쪽의 '중식' 같은 이름표 칸.
 * 달이 표에 없으면 요일이 맞는 가까운 달을 고르고, 요일도 없으면 급식이 평일에만 있다는 점으로 고릅니다.
 */
export function mealFromCells(rows, { today = '2026-11-15', year = 0, month = 0, fix = false, title = '' } = {}) {
    const grid = (rows || []).map((row) => (row || []).map(readCell));
    const height = grid.length;
    const width = Math.max(0, ...grid.map((row) => row.length));
    const at = (r, c) => grid[r]?.[c] || null;
    const pure = (cell) => Boolean(cell?.date) && !cell.menu.items.length;
    const perRow = grid.map((row) => row.filter(pure).length);
    const perCol = Array.from({ length: width }, (_, c) => grid.filter((row) => pure(row[c])).length);
    const across = Math.max(0, ...perRow) >= Math.max(0, ...perCol);
    const found = [];
    for (let r = 0; r < height; r += 1) {
        for (let c = 0; c < width; c += 1) {
            const cell = at(r, c);
            if (!cell?.date) continue;
            let menu = cell.menu;
            let wd = cell.date.wd;
            if (pure(cell)) {
                const parts = [];
                if (across) {
                    for (let rr = r + 1; rr < height; rr += 1) {
                        if (perRow[rr] >= 2 || pure(at(rr, c))) break;
                        const below = at(rr, c);
                        if (!below || below.date) continue;
                        if (below.wd >= 0 && wd < 0) wd = below.wd;
                        parts.push(below.text);
                    }
                    if (wd < 0 && r > 0 && at(r - 1, c) && !at(r - 1, c).date) wd = at(r - 1, c).wd;
                } else {
                    for (let cc = c + 1; cc < width; cc += 1) {
                        const side = at(r, cc);
                        if (!side || side.date) continue;
                        if (side.wd >= 0 && wd < 0) wd = side.wd;
                        parts.push(side.text);
                    }
                    if (wd < 0 && c > 0 && at(r, c - 1) && !at(r, c - 1).date) wd = at(r, c - 1).wd;
                }
                menu = cellMenu(parts.join('\n'));
            }
            /* 맨 위에 요일만 있는 줄이 따로 있으면 같은 세로줄의 요일을 씁니다. */
            for (let rr = r - 1; wd < 0 && across && rr >= 0; rr -= 1) {
                const up = at(rr, c);
                if (up && !up.date && up.wd >= 0 && !up.menu.items.length) wd = up.wd;
            }
            if (!menu.items.length) continue;
            found.push({ r, c, day: cell.date.day, month: cell.date.month, wd, menu });
        }
    }
    if (!found.length) return { mode: 'none', year: year || 0, month: month || 0, days: [] };

    /* 달이 넘어가는 자리(30 → 1). */
    let offset = 0;
    let prev = 0;
    const firstMonth = found.find((row) => row.month)?.month || 0;
    for (const row of found) {
        if (row.month && firstMonth) offset = (row.month - firstMonth + 12) % 12;
        else if (prev >= 22 && row.day <= 7) offset += 1;
        row.offset = offset;
        prev = row.day;
    }

    const [ty, tm] = String(today).slice(0, 7).split('-').map(Number);
    const allText = `${title}\n${(rows || []).map((row) => (row || []).join('\n')).join('\n')}`;
    const titled = allText.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월/) || null;
    const titledMonth = titled ? 0 : Number((allText.match(/(?:^|[^\d])(\d{1,2})\s*월\s*(?:학교\s*)?(?:급식|식단)/) || [])[1] || 0);
    let baseYear = Number(year) || (titled ? Number(titled[1]) : 0);
    let baseMonth = Number(month) || firstMonth || (titled ? Number(titled[2]) : 0) || (okMonth(titledMonth) ? titledMonth : 0);
    const scoreOf = (y, m) => {
        let score = 0;
        for (const row of found) {
            const ymd = ymdFrom(y, m, row.day, row.offset);
            if (!ymd) { score -= 4; continue; }
            const wd = new Date(`${ymd}T00:00:00Z`).getUTCDay();
            if (row.wd >= 0) score += wd === row.wd ? 3 : -3;
            else score += wd >= 1 && wd <= 5 ? 1 : -1;
        }
        return score;
    };
    if (!baseYear || !baseMonth) {
        let best = null;
        for (const delta of [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6]) {
            let y = ty;
            let m = tm + delta;
            while (m > 12) { m -= 12; y += 1; }
            while (m < 1) { m += 12; y -= 1; }
            if (baseMonth && m !== baseMonth) continue;
            if (baseYear && y !== baseYear) continue;
            const score = scoreOf(y, m);
            if (!best || score > best.score) best = { y, m, score };
        }
        if (best) { baseYear = best.y; baseMonth = best.m; }
        else {
            baseMonth = baseMonth || tm;
            baseYear = baseYear || (Math.abs(monthsApart(ty, baseMonth, ty, tm)) <= 6 ? ty : (baseMonth > tm ? ty - 1 : ty + 1));
        }
    }

    const days = [];
    for (const row of found) {
        const date = ymdFrom(baseYear, baseMonth, row.day, row.offset);
        if (!date) continue;
        const items = row.menu.items.map((item) => {
            if (!fix) return item;
            const fixed = fixMenuName(item.name);
            return fixed.fixed ? { ...item, name: fixed.name, read: fixed.from } : item;
        });
        pushDay(days, date, { ...row.menu, items }, { offset: row.offset });
    }
    days.sort((a, b) => a.date.localeCompare(b.date));
    return { mode: days.length ? 'meal' : 'none', year: baseYear, month: baseMonth, days };
}

export function parseMealTable(text, { today = '2026-11-15', year = 0, month = 0, now = new Date(), fix = false } = {}) {
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
        if (days.length) {
            /* 사진에서 읽은 글(fix)은 닮은 글자로 잘못 읽은 이름을 바로잡습니다. */
            if (fix) {
                for (const day of days) {
                    day.items = day.items.map((item) => {
                        const fixed = fixMenuName(item.name);
                        return fixed.fixed ? { ...item, name: fixed.name, read: fixed.from } : item;
                    });
                }
            }
            return { mode: 'meal', year: y, month: m, days };
        }
    }
    const blocks = src.split(/\n(?=\s*(?:\d{4}\s*년|\d{1,2}\s*월|\d{1,2}\s*[./]\s*\d{1,2}))/);
    for (const block of blocks) {
        const hit = findDates(block, now)[0];
        if (!hit) continue;
        pushDay(days, hit.ymd, cellMenu(block));
    }
    if (!days.length) {
        const loose = mealFromCells(rows, { today: today || seoulYmd(now), year, month, fix });
        if (loose.days.length) return loose;
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
