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

/**
 * 빠른 입력·할 일 저장(평점관 r4 P2-1): 칩을 직접 바꿨을 때만 칩 값을 저장에 씁니다. 건드리지 않았으면 null → 각 화면의 파서 값 그대로.
 * - 칩을 뺐으면: 제목은 칩 미리보기 그대로(뺀 낱말이 제목에 남음), 날짜 칩을 뺐으면 글의 「내일」로 돌아가지 않고 fallbackDate(고른 날·오늘).
 * - 오전↔오후만 고쳤으면: 시각만 칩 값, 제목(title '')은 파서 값을 그대로 둡니다.
 */
export function chipSave(chipRead, off = [], fallbackDate = '', flips = []) {
    if (!chipRead) return null;
    const blocked = new Set(off || []);
    const offAny = chipRead.chips.some((chip) => blocked.has(chip.id));
    const flipAny = chipRead.chips.some((chip) => chip.ambiguous && (flips || []).includes(chip.id));
    if (!offAny && !flipAny) return null;
    const dateOff = chipRead.chips.some((chip) => chip.type === 'date' && blocked.has(chip.id)) && !chipRead.date;
    return {
        title: offAny ? chipRead.title : '',
        offAny,
        raw: chipRead.raw,
        date: chipRead.date || (dateOff ? fallbackDate : ''),
        dateOff,
        time: chipRead.time,
        endTime: chipRead.endTime || '',
        timeOff: Boolean(chipRead.timeOff),
        period: chipRead.period || 0,
    };
}

/**
 * 메시지 붙여넣기(평점관 r4 P2-2): 칩으로는 오전·오후만 고칩니다. 제목·날짜는 메시지 파서 값을 그대로 두고,
 * 기간(end)이 있는 항목에는 칩을 대지 않습니다. 뒤집은 시각 칩의 원래 시각과 같은 시각만 바꿉니다.
 */
export function applyChipAmpm(items, chipRead, ampmFlip = []) {
    if (!Array.isArray(items) || !items.length || !chipRead || !ampmFlip?.length) return items || [];
    const flips = new Map();
    for (const chip of chipRead.chips) {
        if (chip.type === 'time' && chip.ambiguous && ampmFlip.includes(chip.id)) flips.set(flipHm(chip.time), chip.time);
    }
    if (!flips.size) return items;
    return items.map((item) => {
        if (!item || item.end || !item.time || !flips.has(item.time)) return item;
        const next = { ...item, time: flips.get(item.time) };
        /* 오전·오후를 직접 정했으니 '오후로 봤어요' 안내는 지웁니다. */
        if (typeof item.warning === 'string') next.warning = item.warning.replace('오전·오후가 없어 오후로 봤어요.', '').replace(/\s{2,}/g, ' ').trim();
        return next;
    });
}

/**
 * 미리보기·저장 목록(파서가 읽은 값)에, 사용자가 칩에서 직접 고친 것만 맞춰 넣습니다.
 * 칩을 건드리지 않았으면(off·ampmFlip이 비었으면) 파서 값(제목·날짜·기간·시각)을 그대로 둡니다.
 * 고쳤어도 제목은 파서 제목을 그대로 두고, 기간(시작~끝)으로 읽힌 날짜는 덮지 않습니다.
 * - 시각 칩을 뺐으면: 남은 시각 칩 값, 없으면 시각 없이
 * - 오전↔오후를 눌렀으면: 그 칩 시각
 * - 날짜 칩을 뺐으면: 기간이 아닐 때만 남은 날짜 칩 값
 */
export function applyLiveChips(items, chipRead, { off = [], ampmFlip = [] } = {}) {
    if (!Array.isArray(items) || !items.length) return items || [];
    if (!chipRead || (!off.length && !ampmFlip.length)) return items;
    const offSet = new Set(off);
    const flipSet = new Set(ampmFlip);
    const chips = chipRead.chips || [];
    const offDate = chips.some((chip) => chip.type === 'date' && offSet.has(chip.id));
    const offTime = chips.some((chip) => chip.type !== 'date' && offSet.has(chip.id));
    const flipped = chips.some((chip) => chip.type === 'time' && chip.ambiguous && flipSet.has(chip.id) && !offSet.has(chip.id));
    if (!offDate && !offTime && !flipped) return items;
    return items.map((item) => {
        /* 기간(end)이 있는 항목에는 칩을 대지 않습니다(평점관 r4 P2-2: 날짜 칩 하나를 빼도 기간이 줄지 않게). */
        if (!item || item.end) return item;
        const next = { ...item };
        if (offDate && chipRead.date) next.date = chipRead.date;
        if (offTime || flipped) {
            next.time = chipRead.time || '';
            next.period = chipRead.period || 0;
            if ('endTime' in item) next.endTime = chipRead.endTime || '';
            /* 오전·오후를 직접 정했으니 '오후로 봤어요' 안내는 지웁니다. */
            if (flipped && typeof item.warning === 'string') next.warning = item.warning.replace('오전·오후가 없어 오후로 봤어요.', '').replace(/\s{2,}/g, ' ').trim();
        }
        return next;
    });
}
