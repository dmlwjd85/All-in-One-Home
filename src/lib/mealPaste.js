/**
 * 월간 급식표(표 붙여넣기)를 날짜별 메뉴로 나눕니다.
 * 저장 글에는 '알레르기'라는 낱말을 넣지 않습니다. 번호만 '1.2.5'처럼 붙입니다.
 * 메모 칸(notes)에 id 'meal-YYYYMM' 으로 두어, 기존 메모 동기화를 그대로 씁니다.
 */
import { isValidYmd, seoulYmd } from './date.js';
import { findDates } from './parse.js';
import { groupWeeks, inferYearMonth, keepTableEdges, parseTable, titledMonth, weekSlots, weekStartOf, ymdFrom } from './monthGrid.js';
import { looksLikeCalGrid } from './calGrid.js';
import { fixMenuName, isKnownMenu } from './hangulFix.js';

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

/**
 * 사진에서 읽을 때 칸 선·그림자가 글자로 잘못 읽힌 부스러기를 지웁니다(| ㅣ _ = ' 같은 것, 홀로 떨어진 자모).
 * 붙여 넣은 글에는 이런 글자가 메뉴 안에 올 일이 거의 없어 그대로 써도 됩니다.
 */
export function cleanNoise(line) {
    return String(line || '')
        .replace(/[|｜¦ｌ_=~`'"“”‘’ㆍ•▪■□◆◇★☆：:;【】「」『』!！]/g, ' ')
        .replace(/(^|\s)[ㄱ-ㅎㅏ-ㅣ]+(?=\s|$)/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 번호 표기를 '1.2.5' 한 가지로 맞춥니다. ①②, 1,2,5, (1.2.5), 글자 인식이 붙인 괄호 조각까지. */
function tidyLine(line) {
    let text = scrubWords(cleanNoise(line));
    text = text.replace(/[①-⑳]/g, (ch) => `${CIRCLED.indexOf(ch) + 1}.`);
    text = text.replace(/[()（）\[\]{}<>]/g, ' ');
    text = text.replace(/(\d)\s*[,，、]\s*(?=\d)/g, '$1.');
    text = text.replace(/(\d)\.\s+(?=\d)/g, '$1.');
    return text.replace(/\.+(\s|$)/g, '$1').replace(/\s+/g, ' ').trim();
}

function dishLine(line) {
    let text = tidyLine(line);
    if (!text || /^메모\s*[:：]?$/.test(text)) return null;
    const kcalOnly = text.match(/^(\d{2,4}(?:\.\d)?)(?:\.\d+)?\s*k?cal$/i) || text.match(/^(?:열량|에너지)\s*[:：]?\s*(\d{2,4}(?:\.\d)?)(?:\.\d+)?(?:\s*kcal)?$/i);
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
    /* '배추김치1(9)'처럼 번호 앞에 붙은 숫자 하나는 인쇄 표시라 이름에서 뺍니다. */
    if (codes) text = text.replace(/(?<=[가-힣])\d$/, '').trim();
    /* 이름 뒤에 떨어진 한 글자(칸 선·얼룩을 글자로 읽은 것): 앞부분이 아는 메뉴이고 그 글자는 낱말이 아니면 뺍니다. */
    const tail = text.match(/^(.+[가-힣])\s([가-힣])$/);
    if (tail && isKnownMenu(tail[1]) && !isKnownMenu(tail[2])) text = tail[1];
    if (!/[가-힣]/.test(text) || LABEL.test(text.replace(/\s+/g, '')) || /재량휴업|급식\s*없|휴업일|공휴일/.test(text.replace(/\s+/g, ''))) return null;
    /* 알레르기 번호는 1~22 안의 수만 둡니다(얼룩이 0으로 읽힌 것 등은 뺍니다). */
    codes = codes.split('.').filter((n) => Number(n) >= 1 && Number(n) <= 22).join('.');
    return { name: text.slice(0, 40), codes };
}

/** 칸 글을 메뉴 줄로 다듬습니다. 괄호가 다음 줄로 넘어간 번호는 잇고, 한 줄에 두 메뉴가 붙은 것은 나눕니다. */
function menuLines(cell) {
    const raw = String(cell || '')
        .replace(/\)\s*[,，]?\s*(?=[가-힣])/g, ')\n')
        /* 닫는 괄호 뒤에 붙은 부스러기('푸딩(2) 0'). */
        .replace(/\)[^가-힣()\n]{1,3}(?=\n|$)/g, ')')
        .split(/\n/)
        .map(cleanNoise)
        .filter(Boolean);
    const out = [];
    for (const line of raw) {
        const prev = out[out.length - 1];
        const open = prev ? (prev.match(/[(（]/g) || []).length - (prev.match(/[)）]/g) || []).length : 0;
        /* 앞 줄 괄호가 안 닫혔고 이 줄이 번호로 시작하면 이어 붙입니다('(1.2.5.6.10.' + '16.18)'). */
        if (prev && open > 0 && /^[\d.,\s]+\)?/.test(line) && /^\d/.test(line)) out[out.length - 1] = `${prev}${/[.\d]$/.test(prev) && !prev.endsWith('.') ? '.' : ''}${line}`;
        else out.push(line);
    }
    return out;
}

function cellMenu(cell) {
    const items = [];
    let kcal = '';
    let origin = '';
    for (const line of menuLines(cell)) {
        /* 번호만 있는 줄('(1.2.5.6)')은 바로 위 메뉴의 번호입니다. */
        const only = tidyLine(line);
        if (/^\d{1,2}(?:\.\d{1,2})*$/.test(only) && items.length && !items[items.length - 1].codes && /[(（]/.test(line)) {
            items[items.length - 1].codes = only;
            continue;
        }
        const row = dishLine(line);
        if (!row) continue;
        /* 칸이 좁아 이름 끝 한 글자가 다음 줄로 넘어간 것('…양념간' + '장(5.6.16)'). */
        const last = items[items.length - 1];
        if (row.name && last && !last.codes && /^[가-힣]$/.test(row.name) && row.codes && !/[)）]\s*$/.test(last.raw || '')) {
            last.name = `${last.name}${row.name}`;
            last.codes = row.codes;
            continue;
        }
        if (row.kcal) kcal = kcal || row.kcal;
        else if (row.origin) origin = origin || row.origin;
        else if (row.name) items.push({ name: row.name, codes: row.codes || '', raw: line });
    }
    return { items: items.map(({ raw, ...item }) => item), kcal, origin };
}

export function looksLikeMealTable(text) {
    const src = String(text || '');
    if (looksLikeCalGrid(src)) return false;
    const rows = parseTable(keepTableEdges(src));
    const weeks = groupWeeks(rows);
    const codes = src.match(/\d{1,2}(?:\.\d{1,2}){2,}/g) || [];
    if (weeks.length) {
        const menus = weeks.some((week) => (week.body || []).some((cell) => /[가-힣]{2,}/.test(cell) && !/학년회의|연수|생기부/.test(cell)));
        if (codes.length >= 1 && menus) return true;
    }
    /*
     * 날짜 줄에 행사 이름이 붙은 표('2 생일축하의 날')나 사진에서 읽은 표는 숫자만 있는 머리 줄이 없습니다.
     * 칸 모양으로 날짜별로 나눠 보고, 이틀 넘게 메뉴가 나오며 알레르기 번호가 여럿이거나 메뉴 이름 대부분이 아는 낱말이면 급식표로 봅니다.
     */
    const loose = mealFromCells(rows, {});
    const items = loose.days.flatMap((day) => day.items);
    if (loose.days.length < 2 || items.length < 6) return false;
    const known = items.filter((item) => isKnownMenu(item.name)).length;
    return codes.length >= 3 || known >= items.length * 0.5;
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
    const clean = cleanNoise(line);
    /* 날짜 줄에 행사 이름이 붙은 표('2 생일축하의 날', '20 한우맛체험행사'). 칸에 그 줄만 있을 때만 봅니다. */
    const labeled = alone && clean.match(/^(\d{1,2})\s*일?\s*([가-힣][가-힣\s.,·!]*)$/);
    if (labeled && okDay(Number(labeled[1])) && !/[밥국탕찌개김치볶음구이무침]$/.test(labeled[2].trim())) {
        return { month: 0, day: Number(labeled[1]), wd: -1, label: labeled[2].replace(/[.,]+$/, '').trim() };
    }
    /* 숫자만 둘 있는 칸('6 1'처럼 선 조각이 숫자로 읽힌 것)은 후보를 모두 두고, 옆 칸과 이어지는 쪽을 고릅니다. */
    const nums = alone ? clean.match(/^(\d{1,2})(?:\s+(\d{1,2}))+$/) : null;
    if (nums) {
        const alts = clean.split(/\s+/).map(Number).filter(okDay);
        if (alts.length) return { month: 0, day: alts[0], wd: -1, alts };
    }
    const text = clean.replace(/\s+/g, '');
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
    const m = cleanNoise(line).replace(/\s+/g, '').match(RE_WD);
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
    /* 날짜 칸에 얼룩이 글자로 붙어 읽힌 것('비 30'): 짧은 한 줄에 숫자가 하나면 약한 날짜 후보로 두고, 앞뒤 주와 맞을 때만 씁니다. */
    if (!date && wd < 0 && lines.length === 1) {
        const clean = cleanNoise(lines[0]);
        const nums = clean.match(/\d{1,2}/g) || [];
        if (nums.length === 1 && clean.length <= 6 && !/\d\.\d/.test(clean) && okDay(Number(nums[0]))) {
            date = { month: 0, day: Number(nums[0]), wd: -1, weak: true };
            used = 1;
        }
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
    /*
     * 주마다 날짜 줄이 있는 표에서는 날짜가 왼쪽→오른쪽 하루씩, 위→아래 이레씩 늘어납니다.
     * 이 규칙으로 잘못 읽은 날짜를 고칩니다: 숫자 하나가 빠진 것('2' → 23), 약한 후보('비 30')는 맞을 때만 씁니다.
     */
    const dateRows = grid.map((row, r) => (row.some((cell) => cell?.date && !cell.date.weak && !cell.menu.items.length) ? r : -1)).filter((r) => r >= 0);
    const predict = (r, c) => {
        const votes = [];
        grid[r].forEach((cell, k) => { if (k !== c && cell?.date && !cell.date.weak && !cell.date.alts) votes.push(cell.date.day + (c - k)); });
        const i = dateRows.indexOf(r);
        const up = i > 0 ? grid[dateRows[i - 1]]?.[c] : (dateRows.length && dateRows[dateRows.length - 1] < r ? grid[dateRows[dateRows.length - 1]]?.[c] : null);
        if (up?.date && !up.date.weak) votes.push(up.date.day + 7);
        const down = i >= 0 && i < dateRows.length - 1 ? grid[dateRows[i + 1]]?.[c] : null;
        if (down?.date && !down.date.weak) votes.push(down.date.day - 7);
        return votes.filter(okDay);
    };
    grid.forEach((row, r) => row.forEach((cell, c) => {
        if (!cell?.date || cell.menu.items.length) return;
        const votes = predict(r, c);
        const count = (day) => votes.filter((v) => v === day).length;
        if (cell.date.weak) {
            if (!count(cell.date.day)) cell.date = null;
            else delete cell.date.weak;
            return;
        }
        if (cell.date.alts || count(cell.date.day)) return;
        const best = [...new Set(votes)].sort((a, b) => count(b) - count(a))[0];
        if (best && count(best) >= 2 && String(best).includes(String(cell.date.day))) cell.date.day = best;
    }));
    /* 날짜 줄인데 숫자가 지워져 읽힌 칸: 옆 칸·앞뒤 주가 같은 날짜를 두 번 넘게 가리키면 그 날짜로 봅니다. */
    for (const r of dateRows) {
        grid[r].forEach((cell, c) => {
            if (!cell || cell.date || cell.menu.items.length) return;
            const votes = predict(r, c);
            const best = [...new Set(votes)].sort((a, b) => votes.filter((v) => v === b).length - votes.filter((v) => v === a).length)[0];
            if (best && votes.filter((v) => v === best).length >= 2) cell.date = { month: 0, day: best, wd: -1, guessed: true };
        });
    }
    /* 숫자 후보가 둘인 날짜 칸은 옆 칸 날짜와 하루 차이로 이어지는 쪽을 고릅니다. */
    for (const row of grid) {
        row.forEach((cell, c) => {
            const alts = cell?.date?.alts;
            if (!alts || alts.length < 2) return;
            const left = row.slice(0, c).reverse().findIndex((item) => item?.date && !item.date.alts);
            const right = row.slice(c + 1).findIndex((item) => item?.date && !item.date.alts);
            const want = [];
            if (left >= 0) want.push(row[c - 1 - left].date.day + left + 1);
            if (right >= 0) want.push(row[c + 1 + right].date.day - right - 1);
            const pick = alts.find((day) => want.includes(day)) || alts.find((day) => predict(grid.indexOf(row), c).includes(day));
            if (pick) cell.date.day = pick;
        });
    }
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

/**
 * 붙여 넣은(또는 사진에서 읽은) 급식표 글을 날짜별 메뉴로 나눕니다.
 * 여러 읽는 방법(숫자 머리 줄 표, 칸 모양 표, 날짜로 시작하는 줄)을 모두 해 보고 메뉴를 가장 많이 찾은 쪽을 씁니다.
 * fix: 사진에서 읽은 글이라 닮은 글자로 잘못 읽은 메뉴 이름을 바로잡습니다(바꾼 것은 read 에 원래 글을 남깁니다).
 */
export function parseMealTable(text, { today = '2026-11-15', year = 0, month = 0, now = new Date(), fix = false } = {}) {
    const src = keepTableEdges(text);
    const rows = parseTable(src);
    const base = today || seoulYmd(now);
    const tries = [];

    const weeks = groupWeeks(rows);
    if (weeks.length && weeks.some((week) => (week.body || []).some((cell) => cellMenu(cell).items.length))) {
        const hint = titledMonth(src);
        const inferred = inferYearMonth(weeks, base, { weekStart: weekStartOf(rows), monthHint: hint.month, yearHint: hint.year });
        const y = year || inferred?.year || hint.year || Number(String(base).slice(0, 4));
        const m = month || inferred?.month || hint.month || Number(String(base).slice(5, 7));
        const days = [];
        for (const week of weeks) {
            weekSlots(week.header, { firstWeek: Boolean(week.firstWeek) }).forEach((slot, col) => {
                if (!slot.day) return;
                pushDay(days, ymdFrom(y, m, slot.day, slot.offset), cellMenu(week.body?.[col] || ''), { offset: slot.offset });
            });
        }
        if (days.length) tries.push({ mode: 'meal', year: y, month: m, days });
    }

    const loose = mealFromCells(rows, { today: base, year, month });
    if (loose.days.length) tries.push(loose);

    const lineDays = [];
    for (const block of src.split(/\n(?=\s*(?:\d{4}\s*년|\d{1,2}\s*월|\d{1,2}\s*[./]\s*\d{1,2}))/)) {
        const hit = findDates(block, now).find((item) => !/\d(?:\.\d+){2,}/.test(block.slice(Math.max(0, item.index - 1), item.index + 12)));
        if (hit) pushDay(lineDays, hit.ymd, cellMenu(block));
    }
    if (lineDays.length) {
        const first = lineDays[0].date;
        tries.push({ mode: 'meal', year: year || Number(first.slice(0, 4)), month: month || Number(first.slice(5, 7)), days: lineDays });
    }

    const size = (found) => found.days.reduce((sum, day) => sum + day.items.length, 0) + found.days.length * 0.5;
    const best = tries.sort((x, y) => size(y) - size(x))[0];
    if (!best) return { mode: 'none', year: year || 0, month: month || 0, days: [] };
    if (fix) {
        for (const day of best.days) {
            day.items = day.items.map((item) => {
                const fixed = fixMenuName(item.name);
                return fixed.fixed ? { ...item, name: fixed.name, read: fixed.from } : item;
            });
        }
    }
    return best;
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
        const kcal = String(day.kcal || '').match(/\d{2,4}(?:\.\d)?/);
        if (kcal) lines.push(`kcal ${kcal[0]}`);
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
        if (/^kcal\s+(\d+(?:\.\d)?)/.test(trimmed)) { cur.kcal = trimmed.match(/^kcal\s+(\d+(?:\.\d)?)/)[1]; continue; }
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
