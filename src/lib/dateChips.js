/**
 * 일정 한 줄에서 날짜·교시·시각 낱말을 찾아 칩으로 바꿉니다(B1 날짜 칩).
 * 칩으로 옮긴 낱말은 제목에서 빼고, 처음 적은 글은 raw로 따로 둡니다.
 * 누른(해제한) 칩은 적용하지 않고 그 낱말을 제목에 그대로 둡니다.
 * 기존 일정은 건드리지 않습니다. 새로 적는 글에만 씁니다.
 */
import { findDates } from './parse.js';
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

/** 칩 목록과 제목·날짜·시각·교시를 돌려줍니다. off: 해제한 칩 id 목록. ampmFlip: 오전·오후를 뒤집은 시각 칩 id 목록. */
export function readEventChips(text, { now = new Date(), periods = DEFAULT_PERIODS, off = [], ampmFlip = [] } = {}) {
    const raw = String(text || '');
    const chips = [];
    let dates = [];
    try { dates = findDates(raw, now); } catch { dates = []; }
    dates.forEach((span, index) => {
        chips.push({ id: `d${index}-${span.index}`, type: 'date', index: span.index, length: span.length + tail(raw, span.index + span.length), ymd: span.ymd, word: raw.substr(span.index, span.length), label: `📅 ${shortDate(span.ymd)}`, warning: span.warning || '' });
    });
    const taken = (at, len) => chips.some((chip) => at < chip.index + chip.length && chip.index < at + len);
    for (const m of raw.matchAll(/(?<![\d가-힣])(\d{1,2})\s*교시/g)) {
        const n = Number(m[1]);
        if (n < 1 || n > 10 || taken(m.index, m[0].length)) continue;
        const start = periods[n - 1] || '';
        chips.push({ id: `p${m.index}`, type: 'period', index: m.index, length: m[0].length + tail(raw, m.index + m[0].length), period: n, time: start, word: m[0], label: `⏰ ${n}교시${start ? ` ${start}` : ''}` });
    }
    const flipSet = new Set(ampmFlip);
    for (const m of raw.matchAll(/(?<![\d가-힣])(오전|오후|아침|저녁)?\s*(\d{1,2})\s*시(?!간|험|작|키)(?:\s*(\d{1,2})\s*분|\s*(반))?/g)) {
        let hour = Number(m[2]);
        const min = m[4] ? 30 : Number(m[3] || 0);
        if (hour > 24 || min > 59 || taken(m.index, m[0].length)) continue;
        const writtenMeridian = Boolean(m[1]);
        if ((m[1] === '오후' || m[1] === '저녁') && hour < 12) hour += 12;
        if ((m[1] === '오전' || m[1] === '아침') && hour === 12) hour = 0;
        /* 학교 시간: 오전·오후 없이 '3시'는 오후로 두고, 고칠 수 있게 ambiguous로 표시합니다. */
        let ambiguous = false;
        if (!writtenMeridian && hour >= 1 && hour <= 6) {
            hour += 12;
            ambiguous = true;
        } else if (!writtenMeridian && hour >= 7 && hour <= 11) {
            ambiguous = true;
        }
        if (hour === 24) hour = 0;
        let hm = `${pad(hour)}:${pad(min)}`;
        const id = `t${m.index}`;
        if (ambiguous && flipSet.has(id)) hm = flipHm(hm);
        const merid = Number(hm.slice(0, 2)) < 12 ? '오전' : '오후';
        const label = ambiguous ? `⏰ ${hm} · ${merid}` : `⏰ ${hm}`;
        chips.push({
            id,
            type: 'time',
            index: m.index,
            length: m[0].length + tail(raw, m.index + m[0].length),
            time: hm,
            word: m[0].trim(),
            label,
            ambiguous,
        });
    }
    chips.sort((a, b) => a.index - b.index);
    const blocked = new Set(off);
    const on = chips.filter((chip) => !blocked.has(chip.id));
    let title = '';
    let at = 0;
    for (const chip of on) {
        title += raw.slice(at, chip.index);
        at = chip.index + chip.length;
    }
    title += raw.slice(at);
    title = title.replace(/\s+/g, ' ').replace(/^[\s,·.:\-]+|[\s,·:\-]+$/g, '').trim();
    const dateChips = on.filter((chip) => chip.type === 'date');
    const distinct = [...new Set(dateChips.map((chip) => chip.ymd))];
    const periodChip = on.find((chip) => chip.type === 'period');
    const timeChip = on.find((chip) => chip.type === 'time');
    const warnings = [];
    if (distinct.length > 1) warnings.push(`날짜가 둘 이상 적혀 있어요. 첫 날짜(${shortDate(distinct[0])})로 넣을게요. 아니면 칩을 눌러 빼 주세요.`);
    dateChips.forEach((chip) => { if (chip.warning) warnings.push(chip.warning); });
    if (on.filter((chip) => chip.type !== 'date').length > 1) warnings.push('시각이 둘 이상 적혀 있어요. 첫 시각으로 넣을게요.');
    if (on.length && !title) warnings.push('날짜 말고 내용도 한 줄 적어 주세요.');
    const first = on.find((chip) => chip.type !== 'date');
    return {
        chips,
        title: title || raw.trim(),
        date: distinct[0] || '',
        time: first?.time || '',
        period: first?.type === 'period' ? periodChip.period : 0,
        raw: raw.trim(),
        changed: on.length > 0,
        warning: warnings.join(' '),
        timeChip: Boolean(timeChip),
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
