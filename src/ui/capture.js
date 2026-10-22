import { seoulParts } from '../lib/date.js';
import { parseSchoolMessages } from '../lib/msgParse.js';
import { parseNote } from '../lib/parse.js';
import { DEFAULT_PERIODS } from '../lib/period.js';

/** 미리보기에서 고르는 종류. 저장할 때 학생 기록·상담은 기존 누가기록으로 들어갑니다. */
export const CAPTURE_KINDS = [
    { id: '일정', label: '일정' },
    { id: '할 일', label: '할 일' },
    { id: '학생기록', label: '학생 기록' },
    { id: '상담', label: '상담' },
    { id: '출결', label: '출결' },
    { id: '메모', label: '메모' },
];

const ATTEND_STATUS = ['결석', '지각', '조퇴', '결과'];
const SCHEDULE_HINT = /제출|회신|마감|기한|공개수업|회의|행사|연수|교시|출장|협의회|업로드|탑재|부탁(?:드립니다|드려요|해요)|작성해|가정통신문|상담\s*주간|상담주간|체험|소풍|운동회|현장학습/;

export function speechSupported() {
    if (typeof window === 'undefined') return false;
    return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

/** 누가기록에 최근 찍힌 학생 넷. QuickSheet와 같은 순서입니다. */
export function recentStudents(students, records) {
    const last = new Map();
    (records || []).forEach((row) => {
        if (row.sid && (!last.has(row.sid) || String(row.at || row.date) > last.get(row.sid))) {
            last.set(row.sid, String(row.at || row.date));
        }
    });
    return [...(students || [])]
        .sort((a, b) => String(last.get(b.id) || '').localeCompare(String(last.get(a.id) || '')) || a.no - b.no)
        .slice(0, 4);
}

export function recognizeStudent(text, students) {
    const raw = String(text || '');
    const note = parseNote(raw);
    if (note.studentNo) {
        const hit = (students || []).find((row) => row.no === note.studentNo);
        if (hit) return { student: hit, sure: true };
    }
    const bang = raw.match(/(?:^|[^\d])(\d{1,2})\s*번/);
    if (bang) {
        const no = Number(bang[1]);
        const hit = (students || []).find((row) => row.no === no);
        if (hit) return { student: hit, sure: true };
    }
    const hits = [...(students || [])]
        .filter((row) => row.name && row.name.length >= 2 && raw.includes(row.name))
        .sort((a, b) => b.name.length - a.name.length || a.no - b.no);
    const kept = hits.filter((row) => !hits.some((other) => other !== row && other.name.includes(row.name)));
    if (kept.length === 1) return { student: kept[0], sure: true };
    if (kept.length > 1) return { student: [...kept].sort((a, b) => a.no - b.no)[0], sure: false };
    return { student: null, sure: false };
}

function attendStatus(text) {
    const found = ATTEND_STATUS.filter((status) => text.includes(status));
    return { status: found[0] || '', count: found.length };
}

function blank(partial) {
    return {
        id: partial.id,
        kind: '메모',
        title: '',
        date: '',
        end: '',
        time: '',
        endTime: '',
        period: 0,
        periodEnd: 0,
        eventKind: '학급',
        memo: '',
        studentNo: 0,
        status: '',
        recordKind: '관찰',
        low: false,
        warning: '',
        include: true,
        ...partial,
    };
}

function fromParsed(item, studentNo) {
    return blank({
        id: item.id,
        kind: item.kind === '일정' ? '일정' : '할 일',
        title: item.title || '',
        date: item.date || '',
        end: item.end || '',
        time: item.time || '',
        endTime: item.endTime || '',
        period: item.period || 0,
        periodEnd: item.periodEnd || 0,
        eventKind: item.eventKind || '학급',
        memo: item.memo || '',
        studentNo,
        low: Boolean(item.low),
        warning: item.warning || '',
        raw: item.raw || '',
    });
}

/**
 * 입력 한 줄을 미리보기 카드로 바꿉니다.
 * 일정·할 일의 날짜와 시각은 parseSchoolMessages 결과를 그대로 쓰고,
 * 학생은 QuickSheet와 같이 @번호·N번·이름으로 읽습니다.
 */
export function captureDrafts(text, { now = new Date(), periods = DEFAULT_PERIODS, students = [], selectedNo = 0 } = {}) {
    const raw = String(text || '').trim();
    if (!raw) return [];
    const note = parseNote(raw, now);
    const clock = seoulParts(now);
    const who = recognizeStudent(raw, students);
    const selected = (students || []).find((row) => row.no === Number(selectedNo)) || null;
    const student = who.student || selected;
    const studentNo = student?.no || 0;
    const studentSure = who.student ? who.sure : Boolean(selected);
    const parsed = parseSchoolMessages(raw, { now, periods });
    const items = parsed.items || [];
    const dated = items.some((item) => item.date || item.time || item.period);
    const hinted = SCHEDULE_HINT.test(raw);
    const attendance = attendStatus(raw);
    const counselWeek = /상담\s*주간|상담주간/.test(raw);
    const date = note.detectedDate || items.find((item) => item.date)?.date || clock.ymd;
    const when = items[0] || {};

    if (attendance.status && !hinted) {
        return [blank({
            id: 'cap-attend',
            kind: '출결',
            title: raw,
            date,
            studentNo,
            status: attendance.status,
            period: when.period || 0,
            low: !student || !studentSure || attendance.count !== 1,
            warning: !student ? '누구인지 번호에서 골라 주세요.' : (studentSure ? '' : '학생이 여럿이라 번호를 확인해 주세요.'),
        })];
    }

    if (/상담|면담/.test(raw) && !counselWeek && !hinted && (student || !items.length)) {
        return [blank({
            id: 'cap-counsel',
            kind: '상담',
            title: raw,
            date,
            time: when.time || '',
            period: when.period || 0,
            studentNo,
            recordKind: '상담',
            low: !student || !studentSure,
            warning: !student ? '누구인지 번호에서 골라 주세요.' : (studentSure ? '' : '학생이 여럿이라 번호를 확인해 주세요.'),
        })];
    }

    if (student && !hinted && !(dated && !who.student && !selected)) {
        const praise = /칭찬/.test(raw);
        return [blank({
            id: 'cap-record',
            kind: '학생기록',
            title: raw,
            date,
            studentNo,
            recordKind: praise ? '칭찬' : '관찰',
            low: !studentSure,
            warning: studentSure ? '' : '학생이 여럿이라 번호를 확인해 주세요.',
        })];
    }

    if (items.length) {
        return items.map((item) => fromParsed(item, who.student ? studentNo : 0));
    }

    return [blank({
        id: 'cap-memo',
        kind: '메모',
        title: raw,
        date: note.detectedDate || '',
        low: true,
        warning: '종류를 짐작하기 어려워요. 칩에서 골라 주세요.',
    })];
}
