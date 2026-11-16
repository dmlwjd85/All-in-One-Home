/**
 * 엑셀·팀즈에서 복사한 월간 표(탭으로 나뉜 글, 칸 안 줄바꿈은 큰따옴표).
 * 연·월은 표에 없으므로 요일 칸(월~일)과 달의 길이로 가깝게 고릅니다.
 */
import { isValidYmd } from './date.js';

function pad(n) {
    return String(n).padStart(2, '0');
}

/** 큰따옴표 안의 탭·줄바꿈은 칸에 남기고, 따옴표 두 개는 따옴표 하나로 풉니다. */
export function parseTable(text) {
    const src = String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const rows = [];
    let row = [];
    let cell = '';
    let quote = false;
    for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        if (quote) {
            if (ch === '"') {
                if (src[i + 1] === '"') { cell += '"'; i += 1; }
                else quote = false;
            } else cell += ch;
        } else if (ch === '"') quote = true;
        else if (ch === '\t') { row.push(cell); cell = ''; }
        else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
        else cell += ch;
    }
    if (cell.length || row.length) { row.push(cell); rows.push(row); }
    return rows;
}

export function isDayNum(value) {
    const text = String(value || '').trim();
    if (!/^\d{1,2}$/.test(text)) return false;
    const n = Number(text);
    return n >= 1 && n <= 31;
}

function isMemoLabel(value) {
    return /^메모\s*[:：]?$/.test(String(value || '').trim());
}

/** 날짜 숫자(와 '메모')만 있는 줄은 그 주의 칸 머리입니다. */
export function isHeaderRow(row) {
    const cells = (row || []).map((cell) => String(cell || '').trim());
    const nums = cells.filter(isDayNum);
    if (nums.length < 2) return false;
    return cells.every((cell) => !cell || isDayNum(cell) || isMemoLabel(cell));
}

/** 머리 줄과 그 다음 내용 줄을 한 주로 묶습니다. 빈 줄은 건너뜁니다. */
export function groupWeeks(rows) {
    const weeks = [];
    for (let i = 0; i < rows.length; i += 1) {
        if (!isHeaderRow(rows[i])) continue;
        let body = [];
        for (let j = i + 1; j < rows.length; j += 1) {
            if ((rows[j] || []).every((cell) => !String(cell || '').trim())) continue;
            if (isHeaderRow(rows[j])) break;
            body = rows[j];
            break;
        }
        weeks.push({ header: rows[i], body, firstWeek: weeks.length === 0 });
    }
    return weeks;
}

/**
 * 칸 번호는 요일 시작에 맞춥니다. 첫 주에 큰 날 다음 1일이 있으면 그 앞은 지난달입니다.
 * 그 뒤 주에서 숫자가 작아지면 다음 달입니다.
 */
export function weekSlots(header, { firstWeek = false } = {}) {
    const cells = [];
    for (let i = 0; i < 7; i += 1) cells.push(String(header?.[i] ?? ''));
    const nums = cells.map((cell) => (isDayNum(cell.trim()) ? Number(cell.trim()) : 0));
    const drops = [];
    let prev = 0;
    nums.forEach((day, index) => {
        if (!day) return;
        if (prev && day < prev && prev >= 20 && day <= 15) drops.push(index);
        prev = day;
    });
    let offsets;
    if (firstWeek && drops.length) {
        const at = drops[0];
        offsets = nums.map((day, index) => (day && index < at ? -1 : 0));
    } else {
        let offset = 0;
        prev = 0;
        offsets = nums.map((day) => {
            if (!day) return 0;
            if (prev && day < prev) offset += 1;
            prev = day;
            return offset;
        });
    }
    return cells.map((label, col) => ({
        col,
        day: nums[col],
        offset: offsets[col],
        label: nums[col] ? '' : label.trim(),
    }));
}

function utcWeekday(year, month, day) {
    return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/** 월요일 시작이면 월요일 칸이 1, 일요일 칸이 0. 일요일 시작이면 칸 번호가 그대로 요일입니다. */
function colWeekday(col, weekStart = 1) {
    if (weekStart === 0) return col % 7;
    return col === 6 ? 0 : col + 1;
}

function monthLength(year, month) {
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function hintedLength(weeks) {
    for (const week of weeks) {
        const slots = weekSlots(week.header, { firstWeek: Boolean(week.firstWeek) });
        for (let i = 0; i < 6; i += 1) {
            const left = slots[i];
            const right = slots[i + 1];
            if (left.day >= 28 && left.offset === 0 && right.day === 1 && right.offset === 1) return left.day;
        }
    }
    return 0;
}

/**
 * 오늘에 가깝고, 칸의 요일·달 길이가 맞는 해와 달을 고릅니다.
 * 돌려줌: { year, month, score } 또는 null.
 */
export function inferYearMonth(weeks, today = '2026-11-15', { weekStart = 1, monthHint = 0, yearHint = 0 } = {}) {
    const anchors = [];
    const nexts = [];
    const prevs = [];
    let maxDay = 0;
    for (const week of weeks) {
        for (const slot of weekSlots(week.header, { firstWeek: Boolean(week.firstWeek) })) {
            if (!slot.day) continue;
            if (slot.offset === 0) {
                anchors.push(slot);
                if (slot.day > maxDay) maxDay = slot.day;
            } else if (slot.offset === 1) nexts.push(slot);
            else if (slot.offset === -1) prevs.push(slot);
        }
    }
    if (!anchors.length) return null;
    const hint = hintedLength(weeks);
    const [ty, tm] = String(today).slice(0, 7).split('-').map(Number);
    let best = null;
    for (let year = ty - 1; year <= ty + 2; year += 1) {
        for (let month = 1; month <= 12; month += 1) {
            if (monthHint && month !== monthHint) continue;
            if (yearHint && year !== yearHint) continue;
            const len = monthLength(year, month);
            if (hint && len !== hint) continue;
            if (maxDay > len) continue;
            let score = 0;
            for (const slot of anchors) {
                if (slot.day <= len && utcWeekday(year, month, slot.day) === colWeekday(slot.col, weekStart)) score += 2;
            }
            const ny = month === 12 ? year + 1 : year;
            const nm = month === 12 ? 1 : month + 1;
            const py = month === 1 ? year - 1 : year;
            const pm = month === 1 ? 12 : month - 1;
            for (const slot of nexts) {
                if (utcWeekday(ny, nm, slot.day) === colWeekday(slot.col, weekStart)) score += 2;
            }
            for (const slot of prevs) {
                if (utcWeekday(py, pm, slot.day) === colWeekday(slot.col, weekStart)) score += 2;
            }
            if (!score) continue;
            const contains = year === ty && month === tm;
            const dist = Math.abs((year * 12 + month) - (ty * 12 + tm));
            const row = { year, month, score, contains, dist };
            if (!best || score > best.score || (score === best.score && row.contains && !best.contains) || (score === best.score && row.contains === best.contains && dist < best.dist)) {
                best = row;
            }
        }
    }
    if (!best && monthHint) return { year: yearHint || ty, month: monthHint, score: 0 };
    return best ? { year: best.year, month: best.month, score: best.score } : null;
}

/** '일 월 화…' 머리면 0(일요일 시작), '월 화 수…' 이거나 머리가 없으면 1(월요일 시작). */
export function weekStartOf(rows) {
    for (const row of rows || []) {
        const cells = (row || []).map((cell) => String(cell || '').replace(/\s+/g, '')).filter(Boolean);
        const joined = cells.join('');
        if (joined === '일월화수목금토') return 0;
        if (joined === '월화수목금토일') return 1;
    }
    return 1;
}

/** '2026학년도 12월', '2026년 12월'처럼 표 위에 적힌 달. 없으면 0. */
export function titledMonth(text) {
    const lines = String(text || '').split('\n').slice(0, 8);
    for (const line of lines) {
        if ((line.match(/\d+\s*일/g) || []).length >= 2) continue;
        const school = line.match(/(20\d{2})\s*학년도[^\n]{0,16}?(\d{1,2})\s*월/);
        if (school) {
            const month = Number(school[2]);
            if (month < 1 || month > 12) continue;
            let year = Number(school[1]);
            if (month <= 2) year += 1;
            return { year, month };
        }
        const named = line.match(/(20\d{2})\s*년\s*(\d{1,2})\s*월/);
        if (named) {
            const month = Number(named[2]);
            if (month >= 1 && month <= 12) return { year: Number(named[1]), month };
        }
    }
    return { year: 0, month: 0 };
}

/** 표 글의 앞쪽 탭(빈 요일 칸)은 남기고, 뒤쪽 빈 줄만 걷습니다. */
export function keepTableEdges(text) {
    return String(text || '').replace(/^\uFEFF/, '').replace(/^\n+/, '').replace(/\s+$/, '');
}

/** 웹·한글에서 복사한 table/tr/td. 칸 안 br은 줄바꿈입니다. */
export function htmlTableToTsv(html) {
    const src = String(html || '');
    if (!/<table\b/i.test(src)) return '';
    const rows = [];
    const rowRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch = rowRe.exec(src);
    while (rowMatch) {
        const cells = [];
        const cellRe = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
        let cellMatch = cellRe.exec(rowMatch[1]);
        while (cellMatch) {
            const text = cellMatch[1]
                .replace(/<br\s*\/?>/gi, '\n')
                .replace(/<\/p>/gi, '\n')
                .replace(/<[^>]+>/g, '')
                .replace(/&nbsp;/gi, ' ')
                .replace(/&amp;/gi, '&')
                .replace(/&lt;/gi, '<')
                .replace(/&gt;/gi, '>')
                .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
                .replace(/\u00a0/g, ' ');
            cells.push(text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim());
            cellMatch = cellRe.exec(rowMatch[1]);
        }
        if (cells.length) rows.push(cells);
        rowMatch = rowRe.exec(src);
    }
    if (!rows.length) return '';
    return rows.map((cells) => cells.map((cell) => (/[\t\n"]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)).join('\t')).join('\n');
}

export function ymdFrom(year, month, day, offset = 0) {
    let y = Number(year);
    let m = Number(month) + Number(offset || 0);
    while (m > 12) { m -= 12; y += 1; }
    while (m < 1) { m += 12; y -= 1; }
    const ymd = `${y}-${pad(m)}-${pad(day)}`;
    return isValidYmd(ymd) ? ymd : '';
}

/** 해·달을 바꾸면 같은 칸 숫자로 날짜만 다시 매깁니다. */
export function applyMonth(slots, year, month) {
    return slots.map((slot) => ({ ...slot, date: slot.day ? ymdFrom(year, month, slot.day, slot.offset) : '' }));
}
