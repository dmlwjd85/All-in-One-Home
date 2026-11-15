/**
 * 팀즈·아웃룩에서 복사한 일정과, 한 번에 붙인 일정 목록.
 * 모임 암호·모임 ID·참가 링크는 제목에도 메모에도 남기지 않습니다.
 */
import { seoulYmd } from './date.js';
import { findDates } from './parse.js';
import { findClocks, findPeriods, looksLikeCalGrid, parseCalGrid, periodClock } from './calGrid.js';

const SECRET = /(?:암호|비밀번호|패스코드|password|passcode)\s*[:：]\s*\S+/i;
const TEAMS = /teams\.microsoft|microsoft\s*teams|모임\s*id|지금\s*참가/i;

export function looksLikeTeams(text) {
    return TEAMS.test(String(text || ''));
}

/** 암호가 들어 있는 줄은 통째로 버리고, 링크·모임 번호·주최자 줄도 걷어 냅니다. */
export function stripTeamsNoise(text) {
    const src = String(text || '').replace(/\r\n/g, '\n');
    const marked = looksLikeTeams(src) || SECRET.test(src);
    if (!marked) return src;
    return src
        .split('\n')
        .filter((line) => !SECRET.test(line))
        .join('\n')
        .replace(/https?:\/\/\S*teams\.microsoft\S*/gi, ' ')
        .replace(/지금\s*참가(?:하기|하세요|해\s*주세요)?\s*[:：]?/g, ' ')
        .replace(/모임\s*(?:ID|아이디|id)\s*[:：]\s*[\d\s]*/gi, ' ')
        .replace(/전화\s*(?:접속|회의)[^\n]*/g, ' ')
        .replace(/주최자\s*[:：]\s*[^\n]*/g, ' ')
        .replace(/도움(?:이|을)?\s*필요[^\n]*/g, ' ')
        .replace(/_{3,}/g, ' ')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function lineDate(line, now) {
    const found = findDates(line, now);
    return found.find((item) => item.explicit) || found[0] || null;
}

function hasDate(line, now) {
    return Boolean(lineDate(line, now));
}

export function looksLikeScheduleList(text, now = new Date()) {
    const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.some((line) => /까지/.test(line) && /제출|작성|입력|회신|독후감/.test(line))) return false;
    const bullets = lines.filter((line) => /^[-*•·▪]\s*/.test(line));
    return bullets.filter((line) => hasDate(line, now)).length >= 2;
}

function placeOf(text) {
    const labeled = String(text || '').match(/(?:장소|위치)\s*[:：]\s*([^\n,]+)/);
    if (labeled) return labeled[1].trim();
    if (/Microsoft Teams\s*모임/i.test(text)) return 'Microsoft Teams 모임';
    return '';
}

function stripWhen(text) {
    let title = String(text || '');
    title = title.replace(/(?:장소|위치)\s*[:：]\s*[^\n,]+/g, ' ');
    title = title.replace(/Microsoft Teams\s*모임/gi, ' ');
    title = title.replace(/종일/g, ' ');
    const spans = [...findClocks(title), ...findPeriods(title)];
    const dates = findDates(title);
    const all = [...spans, ...dates.map((span) => ({ index: span.index, length: span.length }))];
    all.sort((a, b) => a.index - b.index);
    let out = '';
    let at = 0;
    for (const span of all) {
        if (span.index < at) continue;
        out += title.slice(at, span.index);
        at = span.index + span.length;
    }
    out += title.slice(at);
    return out
        .replace(/^[-*•·▪]\s*/, '')
        .replace(/^\d{1,2}[.)]\s*/, '')
        .replace(/(?:^|\s)후(?=\s|$)/g, ' ')
        .replace(/\s*[~～]\s*/g, ' ')
        .replace(/[()（）[\]{}]/g, ' ')
        .replace(/\s+/g, ' ')
        .replace(/^[\s,·.:\-]+|[\s,·.:\-]+$/g, '')
        .trim();
}

function oneEvent(text, now, periods, lengths) {
    const raw = String(text || '').trim();
    if (!raw) return null;
    const found = findDates(raw, now);
    const primary = found.find((item) => item.explicit) || found[0] || null;
    const clocksEarly = findClocks(raw);
    if (!primary && !clocksEarly.length) return null;
    let end = '';
    if (found.length >= 2) {
        const next = found.find((item) => item.index > primary.index);
        const between = next ? raw.slice(primary.index + primary.length, next.index) : '';
        if (next && /^\s*[~～\-–—]\s*$/.test(between)) end = next.ymd;
    }
    const clocks = findClocks(raw).filter((row) => !/급식/.test(raw.slice(Math.max(0, row.index - 6), row.index)));
    const main = clocks.find((row) => !row.approx) || clocks[0] || null;
    const periodsFound = findPeriods(raw);
    let time = main?.start || '';
    let endTime = main?.end || '';
    let period = 0;
    let periodEnd = 0;
    if (periodsFound.length && /교시\s*(?:후|끝나고|끝난)/.test(raw)) {
        const bounds = periodClock(periodsFound[0].to, periodsFound[0].to, periods, lengths);
        time = time || bounds.endTime || bounds.time;
        endTime = '';
        period = periodsFound[0].to;
    } else if (periodsFound.length) {
        period = Math.min(...periodsFound.map((row) => row.from));
        periodEnd = Math.max(...periodsFound.map((row) => row.to));
        if (period === periodEnd) periodEnd = 0;
        if (!time) {
            const bounds = periodClock(period, periodEnd || period, periods, lengths);
            time = bounds.time;
            endTime = bounds.endTime;
        }
    }
    const place = placeOf(raw);
    const warning = primary?.warning || '';
    const title = stripWhen(raw).slice(0, 60);
    return {
        title: title || '일정',
        date: primary?.ymd || '',
        end,
        time,
        endTime: endTime && endTime > time ? endTime : '',
        place,
        person: '',
        memo: place ? `장소 ${place}` : '',
        period,
        periodEnd,
        allDay: !time,
        assumedPm: false,
        approx: Boolean(main?.approx),
        ask: Boolean(warning),
        warning,
        include: !warning,
        eventKind: '학급',
        clipped: false,
        day: primary ? Number(primary.ymd.slice(8, 10)) : 0,
        offset: 0,
        raw,
    };
}

function listEvents(text, now, periods, lengths) {
    const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const items = [];
    for (const line of lines) {
        if (!hasDate(line, now)) continue;
        const row = oneEvent(line, now, periods, lengths);
        if (row) items.push(row);
    }
    return items;
}

function blockEvent(text, now, periods, lengths) {
    const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
    const dated = lines.filter((line) => hasDate(line, now));
    const when = dated[0] || text;
    const row = oneEvent(when, now, periods, lengths);
    if (!row) return [];
    const titleLine = lines.find((line) => line !== when && !hasDate(line, now) && !/^(?:장소|위치|microsoft)/i.test(line) && !placeOf(line));
    if (titleLine) row.title = stripWhen(titleLine).slice(0, 60) || row.title;
    const place = lines.map(placeOf).find(Boolean) || row.place;
    if (place) {
        row.place = place;
        row.memo = `장소 ${place}`;
        if (row.title === place) row.title = titleLine ? stripWhen(titleLine).slice(0, 60) : '일정';
    }
    row.raw = text;
    return [row];
}

/**
 * 붙여넣은 글을 일정 목록으로 읽습니다. 달력 표가 아니면 null 이 아니라 { mode:'none' } 일 수도 있습니다.
 * 달력 표면 mode 는 'calendar' 입니다.
 */
export function readPasteSchedule(text, { now = new Date(), periods, lengths, year = 0, month = 0 } = {}) {
    const today = seoulYmd(now);
    const raw = String(text || '').trim();
    if (!raw) return { mode: 'none', items: [] };
    if (looksLikeCalGrid(raw)) {
        const grid = parseCalGrid(raw, { today, year, month, periods, lengths });
        return { mode: 'calendar', year: grid.year, month: grid.month, score: grid.score, items: grid.events };
    }
    const clean = stripTeamsNoise(raw);
    if (looksLikeScheduleList(clean, now)) {
        const items = listEvents(clean, now, periods, lengths);
        return { mode: items.length ? 'list' : 'none', items };
    }
    if (looksLikeTeams(raw) || (String(raw).includes('\n') && hasDate(clean, now))) {
        const items = blockEvent(clean, now, periods, lengths);
        return { mode: items.length ? 'teams' : 'none', items };
    }
    const one = oneEvent(clean, now, periods, lengths);
    return { mode: one ? 'line' : 'none', items: one ? [one] : [] };
}
