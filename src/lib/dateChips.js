/**
 * 일정 한 줄에서 날짜·교시·시각 낱말을 찾아 칩으로 바꿉니다(B1 날짜 칩).
 * 칩으로 옮긴 낱말은 제목에서 빼고, 처음 적은 글은 raw로 따로 둡니다.
 * 누른(해제한) 칩은 적용하지 않고 그 낱말을 제목에 그대로 둡니다.
 * 기존 일정은 건드리지 않습니다. 새로 적는 글에만 씁니다.
 */
import { findTimeSpans, readDateSpans } from './jjaemPaste.js';
import { DEFAULT_PERIODS } from './period.js';
import { weekdayKo } from './date.js';

const PARTICLE = '(?:에는|에도|에|엔|부터|까지는|까지)?';

function shortDate(ymd) {
    return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}(${weekdayKo(ymd)})`;
}

function pad(n) {
    return String(n).padStart(2, '0');
}

function tail(text, end) {
    const m = new RegExp(`^${PARTICLE}`).exec(text.slice(end));
    return m ? m[0].length : 0;
}

function flipHm(hm) {
    const [h, mi] = hm.split(':').map(Number);
    const next = (h + 12) % 24;
    return `${pad(next)}:${pad(mi)}`;
}

/* 앞말(오전·오후·밤 등)이 적혀 있으면 오전·오후가 이미 정해진 시각입니다. */
const WRITTEN_AMPM = /^(?:오전|오후|아침|저녁|밤|새벽|낮)/;

/** 앞말 없이 적은 1~11시(「3시」「8:30」「세 시」)만 오전·오후를 고칠 수 있게 둡니다. 「03:00」「15시」「정오」는 정해진 시각입니다. */
function isAmbiguousWord(word) {
    const w = String(word || '').trim();
    if (!w || WRITTEN_AMPM.test(w) || /^(?:정오|자정)/.test(w)) return false;
    const num = /^(\d{1,2})/.exec(w);
    if (num) {
        if (num[1].length === 2 && num[1][0] === '0') return false;
        const h = Number(num[1]);
        return h >= 1 && h <= 11;
    }
    return !/^열두/.test(w);
}

/**
 * 칩 목록과 제목·날짜·시각·교시를 돌려줍니다. off: 해제한 칩 id 목록. ampmFlip: 오전·오후를 뒤집은 시각 칩 id 목록.
 * 날짜·시각은 저장(readJjaemPaste)과 같은 규칙으로 읽어, 칩에 보이는 값이 곧 저장값이 되게 합니다.
 * future: 할 일·일정처럼 앞일을 적는 줄(다가오는 요일·지난 달은 내년).
 */
export function readEventChips(text, { now = new Date(), periods = DEFAULT_PERIODS, off = [], ampmFlip = [], future = false } = {}) {
    /* 저장 쪽(readJjaemPaste)은 앞뒤 빈칸을 뺀 글로 자리를 셉니다. 칩 id(t자리)가 같게 앞 빈칸을 뺍니다. */
    const raw = String(text || '').replace(/^\s+/, '');
    const chips = [];
    const { spans: dates, primary } = readDateSpans(raw, { now, future });
    dates.forEach((span, index) => {
        chips.push({ id: `d${index}-${span.index}`, type: 'date', index: span.index, length: span.length + tail(raw, span.index + span.length), ymd: span.ymd, word: raw.substr(span.index, span.length), label: `📅 ${shortDate(span.ymd)}`, warning: span.warning || '', primary: span === primary });
    });
    const taken = (at, len) => chips.some((chip) => at < chip.index + chip.length && chip.index < at + len);
    for (const m of raw.matchAll(/(?<![\d가-힣])(\d{1,2})\s*교시/g)) {
        const n = Number(m[1]);
        if (n < 1 || n > 10 || taken(m.index, m[0].length)) continue;
        const start = periods[n - 1] || '';
        chips.push({ id: `p${m.index}`, type: 'period', index: m.index, length: m[0].length + tail(raw, m.index + m[0].length), period: n, time: start, word: m[0], label: `⏰ ${n}교시${start ? ` ${start}` : ''}` });
    }
    const flipSet = new Set(ampmFlip);
    let spans = [];
    try { spans = findTimeSpans(raw); } catch { spans = []; }
    for (const span of spans) {
        if (taken(span.index, span.length)) continue;
        const id = `t${span.index}`;
        const ambiguous = isAmbiguousWord(span.word);
        let hm = span.time;
        let endHm = span.endTime || '';
        if (ambiguous && flipSet.has(id)) {
            hm = flipHm(hm);
            if (endHm) endHm = flipHm(endHm);
        }
        const merid = Number(hm.slice(0, 2)) < 12 ? '오전' : '오후';
        const shown = endHm ? `${hm}~${endHm}` : hm;
        chips.push({
            id,
            type: 'time',
            index: span.index,
            /* 밤을 넘기는 범위처럼 글에 그대로 두는 시각은 제목에서 빼지 않습니다. */
            length: span.keep ? 0 : span.length,
            time: hm,
            endTime: endHm,
            word: span.word,
            label: ambiguous ? `⏰ ${shown} · ${merid}` : `⏰ ${shown}`,
            ambiguous,
            ask: span.ask || '',
        });
    }
    chips.sort((a, b) => a.index - b.index);
    const blocked = new Set(off);
    const on = chips.filter((chip) => !blocked.has(chip.id));
    let title = '';
    let at = 0;
    for (const chip of on) {
        if (chip.index < at) continue;
        title += raw.slice(at, chip.index);
        at = chip.index + chip.length;
    }
    title += raw.slice(at);
    title = title.replace(/\s+/g, ' ').replace(/^[\s,·.:\-]+|[\s,·:\-]+$/g, '').trim();
    const dateChips = on.filter((chip) => chip.type === 'date');
    const distinct = [...new Set(dateChips.map((chip) => chip.ymd))];
    /* 저장과 같게: 숫자로 적은 날짜를 먼저, 없으면 글 순서 첫 날짜. */
    const firstDate = dateChips.find((chip) => chip.primary) || dateChips[0] || null;
    const periodChip = on.find((chip) => chip.type === 'period');
    const timeChip = on.find((chip) => chip.type === 'time');
    const warnings = [];
    if (distinct.length > 1) warnings.push(`날짜가 둘 이상 적혀 있어요. ${shortDate(firstDate.ymd)}로 넣을게요. 아니면 칩을 눌러 빼 주세요.`);
    dateChips.forEach((chip) => { if (chip.warning) warnings.push(chip.warning); });
    if (on.filter((chip) => chip.type !== 'date').length > 1) warnings.push('시각이 둘 이상 적혀 있어요. 첫 시각으로 넣을게요.');
    if (on.length && !title) warnings.push('날짜 말고 내용도 한 줄 적어 주세요.');
    const first = on.find((chip) => chip.type !== 'date');
    return {
        chips,
        title: title || raw.trim(),
        date: firstDate?.ymd || '',
        time: first?.time || '',
        endTime: first?.type === 'time' ? first.endTime : '',
        period: first?.type === 'period' ? periodChip.period : 0,
        raw: raw.trim(),
        changed: on.length > 0,
        warning: warnings.join(' '),
        timeChip: Boolean(timeChip),
        /* 시각 칩을 눌러 뺐으면 저장도 시각 없이 합니다. */
        timeOff: chips.some((chip) => chip.type !== 'date' && blocked.has(chip.id)) && !first,
    };
}

/** 미리보기·저장 목록에 실시간 칩(날짜·시각·제목)을 맞춰 넣습니다. 칩이 없으면 그대로 둡니다. */
export function applyLiveChips(items, chipRead) {
    if (!chipRead?.changed || !Array.isArray(items) || !items.length) return items || [];
    return items.map((item) => {
        const next = { ...item };
        if (chipRead.date) next.date = chipRead.date;
        if (chipRead.time) next.time = chipRead.time;
        if (chipRead.period) next.period = chipRead.period;
        if (chipRead.title && (item.kind === '일정' || item.kind === '할 일')) next.title = chipRead.title;
        return next;
    });
}
