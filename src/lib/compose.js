import { seoulYmd } from './date.js';
import { parseSchoolMessages } from './msgParse.js';
import { parseNote, stripTokens } from './parse.js';

/** 미리보기 칩. 학생기록은 저장할 때 기존 관찰(누가기록)로 들어갑니다. */
export const PREVIEW_KINDS = ['일정', '할 일', '학생기록', '상담', '출결', '메모'];
const STATUS = /결석|지각|조퇴|결과/;
const SCHOOL = /제출|마감|회신|업로드|가정통신문|안내문|공개수업|연수|회의|협의회|행사|출장|준비물/;

function hid(text) {
    let hash = 0;
    const raw = String(text || '');
    for (let i = 0; i < raw.length; i += 1) hash = (hash * 31 + raw.charCodeAt(i)) >>> 0;
    return hash.toString(36);
}

function byNo(students, no) {
    return (students || []).find((row) => row.no === Number(no)) || null;
}

/** @번호, N번, 이름, 그리고 눌러 둔 최근 학생. */
export function matchStudent(text, students, note, selectedNo = 0) {
    const list = students || [];
    let no = note?.studentNo || 0;
    let how = no ? 'at' : '';
    if (!no) {
        const found = String(text || '').match(/(?<!\d)(\d{1,2})\s*번/);
        if (found) {
            const n = Number(found[1]);
            if (n >= 1 && n <= 50 && byNo(list, n)) {
                no = n;
                how = '번';
            }
        }
    }
    const named = list.filter((row) => row.name && String(text || '').includes(row.name)).sort((a, b) => b.name.length - a.name.length);
    if (!no && named.length === 1) {
        no = named[0].no;
        how = 'name';
    } else if (!no && named.length > 1) {
        no = named[0].no;
        how = 'multi';
    } else if (no && named.length && !named.some((row) => row.no === no)) how = 'conflict';
    if (!no && selectedNo && byNo(list, selectedNo)) {
        no = Number(selectedNo);
        how = 'chip';
    }
    return { no: no || 0, how, student: byNo(list, no) };
}

function blankCard(partial) {
    return {
        id: 'draft',
        kind: '메모',
        low: true,
        include: false,
        warning: '',
        no: 0,
        date: '',
        end: '',
        time: '',
        endTime: '',
        period: 0,
        periodEnd: 0,
        eventKind: '학급',
        status: '결석',
        title: '',
        text: '',
        memo: '',
        ...partial,
    };
}

function unsure(card, warning) {
    return {
        ...card,
        low: true,
        include: false,
        warning: card.warning || warning,
    };
}

function cardFromMessage(item, students, now, index) {
    const text = String(item.raw || item.title || '').trim();
    const note = parseNote(text, now);
    const who = matchStudent(text, students, note, 0);
    const today = seoulYmd(now);
    let card = blankCard({
        id: item.id || `msg-${index}-${hid(text)}`,
        kind: item.kind === '일정' ? '일정' : '할 일',
        low: Boolean(item.low),
        include: !item.low,
        warning: item.warning || '',
        no: who.no || 0,
        date: item.date || note.detectedDate || '',
        end: item.end || '',
        time: item.time || '',
        endTime: item.endTime || '',
        period: item.period || 0,
        periodEnd: item.periodEnd || 0,
        eventKind: item.eventKind || '학급',
        status: (text.match(STATUS) || ['결석'])[0],
        title: item.title || stripTokens(text) || text,
        text,
        memo: item.memo || '',
    });
    if (who.how === 'multi' || who.how === 'conflict') card = unsure(card, '학생이 여럿이라 빼 두었어요.');
    if (!card.date) card = unsure({ ...card, date: today }, '날짜를 달력에서 눌러 주세요.');
    if (card.low && !card.warning) card.warning = '한 번만 확인해 주세요.';
    return card;
}

function cardFromNote(raw, note, msg, who, now) {
    const today = seoulYmd(now);
    const schoolMsg = Boolean(msg && !msg.low && (msg.kind === '일정' || msg.kind === '할 일'));
    const explicit = who.how === 'at' || who.how === '번' || who.how === 'name';
    const useStudent = explicit || (who.how === 'chip' && !schoolMsg);
    const status = (raw.match(STATUS) || [''])[0];
    let kind = '메모';
    let low = false;
    let warning = '';
    if (useStudent && status) kind = '출결';
    else if (useStudent && /상담/.test(raw) && !/상담\s*주간|상담주간/.test(raw)) kind = '상담';
    else if (useStudent && !(schoolMsg && SCHOOL.test(raw))) kind = '학생기록';
    else if (useStudent && schoolMsg) {
        kind = '학생기록';
        low = true;
        warning = '일정인지 학생 기록인지 한 번만 봐 주세요.';
    } else if (/메모/.test(raw) && !schoolMsg) kind = '메모';
    else if (msg) {
        kind = msg.kind === '일정' ? '일정' : '할 일';
        low = Boolean(msg.low);
        warning = msg.warning || '';
    } else if (/메모/.test(raw)) kind = '메모';
    else {
        kind = '메모';
        low = true;
        warning = '종류를 집어 주세요.';
    }
    if (who.how === 'multi' || who.how === 'conflict') {
        low = true;
        warning = warning || '번호와 이름을 한 번만 봐 주세요.';
    }
    let date = (msg && msg.date) || note.detectedDate || '';
    if (!date) {
        date = today;
        if (kind === '일정' || kind === '할 일') {
            low = true;
            warning = warning || '날짜를 달력에서 눌러 주세요.';
        }
    }
    if ((kind === '출결' || kind === '상담' || kind === '학생기록') && !who.student) {
        low = true;
        warning = warning || '누구인지 번호를 눌러 주세요.';
    }
    const title = (msg && msg.title) || stripTokens(raw) || raw;
    return blankCard({
        id: `note-${hid(raw)}`,
        kind,
        low,
        include: !low,
        warning: low ? (warning || '한 번만 확인해 주세요.') : '',
        no: who.no || 0,
        date,
        end: (msg && msg.end) || '',
        time: (msg && msg.time) || '',
        endTime: (msg && msg.endTime) || '',
        period: (msg && msg.period) || 0,
        periodEnd: (msg && msg.periodEnd) || 0,
        eventKind: (msg && msg.eventKind) || '학급',
        status: status || '결석',
        title,
        text: raw,
        memo: (msg && msg.memo) || '',
    });
}

/**
 * 한 줄·붙여넣기를 미리보기 카드로 바꿉니다.
 * 날짜·일정·할 일은 parseSchoolMessages, 번호는 parseNote와 N번·이름입니다.
 * msgParse 안의 규칙은 바꾸지 않습니다.
 */
export function composeDraft(text, { now = new Date(), students = [], periods, selectedNo = 0 } = {}) {
    const raw = String(text || '').trim();
    if (!raw) return { cards: [] };
    const note = parseNote(raw, now);
    const parsed = parseSchoolMessages(raw, { now, periods });
    const who = matchStudent(raw, students, note, selectedNo);
    const multi = parsed.items.length > 1 || (parsed.items.length === 1 && /\n/.test(raw));
    if (multi) return { cards: parsed.items.map((item, index) => cardFromMessage(item, students, now, index)) };
    return { cards: [cardFromNote(raw, note, parsed.items[0] || null, who, now)] };
}
