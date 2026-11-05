/**
 * 시안 A: 쨈 발라두기/빠른 입력에서 날짜·시각 낱말을 칩·알람으로 옮깁니다.
 * 날짜 말은 파란 둥근 칩으로, 시각은 할 일·일정 알림으로 둡니다. 본문에서는 그 낱말을 뺍니다.
 * 기존 detectDate·findDates·dateChips 시각 규칙을 그대로 씁니다.
 */
import { findDates } from './parse.js';
import { addDaysYmd, isValidYmd, seoulYmd } from './date.js';

const PARTICLE = '(?:에는|에도|에|엔|부터|까지는|까지)?';

function pad(n) {
    return String(n).padStart(2, '0');
}

function particleLen(text, end) {
    const m = new RegExp(`^${PARTICLE}`).exec(String(text || '').slice(end));
    return m ? m[0].length : 0;
}

/** 파란 둥근 칩 글자. 예: 「오늘 · 11월 5일」 */
export function jjaemDateChip(ymd, today = seoulYmd()) {
    if (!isValidYmd(ymd)) return null;
    const month = Number(ymd.slice(5, 7));
    const day = Number(ymd.slice(8, 10));
    const abs = `${month}월 ${day}일`;
    let rel = abs;
    if (ymd === today) rel = '오늘';
    else if (ymd === addDaysYmd(today, 1)) rel = '내일';
    else if (ymd === addDaysYmd(today, 2)) rel = '모레';
    else if (ymd === addDaysYmd(today, -1)) rel = '어제';
    return {
        ymd,
        day,
        month,
        abs,
        rel,
        label: rel === abs ? abs : `${rel} · ${abs}`,
    };
}

/** 본문에서 시계 시각(N시·오전/오후)을 찾습니다. 학교 습관으로 1~6시는 오후로 둡니다. */
export function findTimeSpans(raw) {
    const text = String(raw || '');
    const spans = [];
    for (const m of text.matchAll(/(?<![\d가-힣])(오전|오후|아침|저녁)?\s*(\d{1,2})\s*시(?!간|험|작|키)(?:\s*(\d{1,2})\s*분|\s*(반))?/g)) {
        let hour = Number(m[2]);
        const min = m[4] ? 30 : Number(m[3] || 0);
        if (hour > 24 || min > 59) continue;
        if ((m[1] === '오후' || m[1] === '저녁') && hour < 12) hour += 12;
        if (!m[1] && hour >= 1 && hour <= 6) hour += 12;
        if (hour === 24) hour = 0;
        const length = m[0].length + particleLen(text, m.index + m[0].length);
        spans.push({
            index: m.index,
            length,
            time: `${pad(hour)}:${pad(min)}`,
            word: m[0].trim(),
        });
    }
    return spans;
}

function stripSpans(raw, spans) {
    const ordered = [...spans].sort((a, b) => a.index - b.index);
    let out = '';
    let at = 0;
    for (const span of ordered) {
        if (span.index < at) continue;
        out += raw.slice(at, span.index);
        at = span.index + span.length;
    }
    out += raw.slice(at);
    return out.replace(/\s+/g, ' ').replace(/^[\s,·.:\-]+|[\s,·:\-]+$/g, '').trim();
}

/**
 * 쨈 한 줄에서 날짜·시각을 읽고 본문에서 그 낱말을 뺍니다.
 * date: detectDate와 같이 숫자 날짜를 말보다 먼저 둡니다.
 */
export function readJjaemPaste(text, { now = new Date(), stripTime = true } = {}) {
    const raw = String(text || '').trim();
    const today = seoulYmd(now);
    let dates = [];
    try { dates = findDates(raw, now); } catch { dates = []; }
    const primary = dates.find((item) => item.explicit) || dates[0] || null;
    const date = primary?.ymd || '';
    const dateSpans = primary
        ? [{ index: primary.index, length: primary.length + particleLen(raw, primary.index + primary.length), ymd: primary.ymd }]
        : [];
    const timeSpans = findTimeSpans(raw);
    const time = timeSpans[0]?.time || '';
    const remove = [
        ...dateSpans,
        ...(stripTime ? timeSpans : []),
    ];
    const body = remove.length ? (stripSpans(raw, remove) || raw) : raw;
    return {
        raw,
        body,
        date,
        time,
        chip: date ? jjaemDateChip(date, today) : null,
        changed: Boolean(date || time),
        dateWord: primary ? raw.substr(primary.index, primary.length) : '',
    };
}
