/**
 * 팀즈·아웃룩에서 복사한 일정과, 한 번에 붙인 일정 목록.
 * 모임 암호·모임 ID·참가 링크는 제목에도 메모에도 남기지 않습니다.
 */
import { seoulYmd } from './date.js';
import { keepTableEdges, ymdFrom } from './monthGrid.js';
import { findDates } from './parse.js';
import { findClocks, findPeriods, looksLikeCalGrid, parseCalGrid, periodClock } from './calGrid.js';

const SECRET = /(?:암호|비밀번호|패스코드|password|passcode)\s*[:：]\s*\S+/i;
const MONTHS = { january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12 };

/** 팀즈 초대 덩어리. 'Microsoft Teams'라는 말만으로는 초대가 아닙니다. */
export function isTeamsInvite(text) {
    const src = String(text || '');
    if (/teams\.microsoft/i.test(src)) return true;
    if (/지금\s*참가/.test(src)) return true;
    if (/모임\s*(?:ID|아이디|id)/i.test(src) && /모임|teams/i.test(src)) return true;
    if (/Microsoft Teams\s*모임/i.test(src) && SECRET.test(src)) return true;
    if (/Microsoft Teams\s*모임/i.test(src) && /모임\s*(?:ID|아이디|id)|teams\.microsoft/i.test(src)) return true;
    return false;
}

export function looksLikeTeams(text) {
    return isTeamsInvite(text);
}

/** 진짜 팀즈 초대일 때만 암호·링크·모임 번호를 걷습니다. 평범한 메모의 '암호:' 줄은 남깁니다. */
export function stripTeamsNoise(text) {
    const src = String(text || '').replace(/\r\n/g, '\n');
    if (!isTeamsInvite(src)) return src;
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
    return Boolean(findEnglishDate(line) || lineDate(line, now));
}

export function looksLikeScheduleList(text, now = new Date()) {
    const lines = String(text || '').split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.some((line) => /까지/.test(line) && /제출|작성|입력|회신|독후감/.test(line))) return false;
    const bullets = lines.filter((line) => /^[-*•·▪]\s*/.test(line));
    return bullets.filter((line) => hasDate(line, now)).length >= 2;
}

const EN_DATE = /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),?\s+(20\d{2})\b/i;

export function findEnglishDate(text) {
    const match = String(text || '').match(EN_DATE);
    if (!match) return null;
    const month = MONTHS[match[1].toLowerCase()];
    const ymd = ymdFrom(Number(match[3]), month, Number(match[2]));
    if (!ymd) return null;
    return { ymd, index: match.index, length: match[0].length };
}

function zoneAdjust(text, time, date) {
    const src = String(text || '');
    const utc = src.match(/UTC\s*([+-])\s*(\d{1,2})(?::(\d{2}))?/i);
    const pacific = /태평양|Pacific/i.test(src);
    if (!utc && !pacific) return null;
    if (!time) return { time, date, warning: '다른 시간대 표기가 있어요. 시각을 확인해 주세요.' };
    const sign = utc ? (utc[1] === '-' ? -1 : 1) : -1;
    const offset = sign * ((utc ? Number(utc[2]) : 8) * 60 + (utc ? Number(utc[3] || 0) : 0));
    const delta = 9 * 60 - offset;
    const [h, mi] = time.split(':').map(Number);
    let total = h * 60 + mi + delta;
    let shift = 0;
    while (total >= 24 * 60) { total -= 24 * 60; shift += 1; }
    while (total < 0) { total += 24 * 60; shift -= 1; }
    const next = `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
    let ymd = date;
    if (shift && date) ymd = ymdFrom(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)) + shift);
    return { time: next, date: ymd || date, warning: '다른 시간대라 한국 시각으로 바꿔 두었어요. 한번 확인해 주세요.' };
}

function placeOf(text) {
    const labeled = String(text || '').match(/(?:장소|위치|where)\s*[:：]\s*([^\n,]+)/i);
    if (labeled) return labeled[1].trim();
    if (/Microsoft Teams\s*모임/i.test(text)) return 'Microsoft Teams 모임';
    return '';
}

function stripWhen(text) {
    let title = String(text || '');
    title = title.replace(/(?:장소|위치|where)\s*[:：]\s*[^\n,]+/gi, ' ');
    title = title.replace(/^(?:제목|subject)\s*[:：]\s*/i, ' ');
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
    const english = findEnglishDate(raw);
    const found = findDates(raw, now);
    const notZone = (row) => !/UTC\s*[+-]\s*$/i.test(String(raw).slice(Math.max(0, row.index - 8), row.index).replace(/[()]/g, ''));
    const primary = english
        ? { ymd: english.ymd, index: english.index, length: english.length, explicit: true, warning: '' }
        : (found.find((item) => item.explicit) || found[0] || null);
    const clocksEarly = findClocks(raw).filter(notZone);
    if (!primary && !clocksEarly.length) return null;
    let end = '';
    if (found.length >= 2) {
        const next = found.find((item) => item.index > primary.index);
        const between = next ? raw.slice(primary.index + primary.length, next.index) : '';
        if (next && (/^\s*[~～\-–—]\s*$/.test(between) || /[~～]\s*$/.test(between))) end = next.ymd;
    }
    const clocks = findClocks(raw).filter((row) => notZone(row) && !/급식/.test(raw.slice(Math.max(0, row.index - 6), row.index)));
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
    const zone = zoneAdjust(raw, time, primary?.ymd || '');
    if (zone?.time) time = zone.time;
    if (zone?.date) primary && (primary.ymd = zone.date);
    const warning = [primary?.warning, zone?.warning].filter(Boolean).join(' ');
    let title = stripWhen(raw).slice(0, 60);
    title = title.replace(/^(?:제목|subject)\s*[:：]\s*/i, '').trim();
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
    const titleLine = lines.find((line) => line !== when && !hasDate(line, now) && !/^(?:장소|위치|where|microsoft)/i.test(line) && !placeOf(line));
    if (titleLine) row.title = stripWhen(titleLine).replace(/^(?:제목|subject)\s*[:：]\s*/i, '').slice(0, 60) || row.title;
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
    const raw = keepTableEdges(text);
    if (!raw.trim()) return { mode: 'none', items: [] };
    if (looksLikeCalGrid(raw)) {
        const grid = parseCalGrid(raw, { today, year, month, periods, lengths });
        return { mode: 'calendar', year: grid.year, month: grid.month, score: grid.score, items: grid.events };
    }
    const clean = stripTeamsNoise(raw);
    if (looksLikeScheduleList(clean, now)) {
        const items = listEvents(clean, now, periods, lengths);
        return { mode: items.length ? 'list' : 'none', items };
    }
    const structured = /(?:^|\n)\s*(?:제목|subject|when|where)\s*[:：]/i.test(raw);
    if (isTeamsInvite(raw) || findEnglishDate(clean) || structured) {
        const items = blockEvent(clean, now, periods, lengths);
        return { mode: items.length ? 'teams' : 'none', items };
    }
    const one = oneEvent(clean, now, periods, lengths);
    return { mode: one ? 'line' : 'none', items: one ? [one] : [] };
}
