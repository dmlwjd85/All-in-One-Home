import { addItem, removeItem } from './store.js';
import { ATTEND_STATUS, startOfWeekMon, todayYmd } from './utils.js';

/** 쓱, 적 빠른 분류 힌트. 빈 값은 직접 입력. */
export const SSUGEOK_HINTS = ['생각', '일', '할일'];

/** 날려보내기 목적지. 왼쪽/오른쪽 스와이프 묶음과 맞춥니다. */
export const SSUGEOK_DESTS = [
    { id: 'student', label: '학생', short: '학생', hint: '학생 기록에 붙이기', side: 'left', cls: 'text-indigo-900 bg-indigo-100' },
    { id: 'attend', label: '출결', short: '출결', hint: '학생·날짜 출결 메모', side: 'left', cls: 'text-amber-900 bg-amber-100' },
    { id: 'counsel', label: '상담·누가', short: '상담', hint: '상담·관찰 기록', side: 'left', cls: 'text-rose-900 bg-rose-100' },
    { id: 'plan', label: '오늘·주간', short: '주간', hint: '오늘·이번 주 계획', side: 'right', cls: 'text-sky-900 bg-sky-100' },
    { id: 'task', label: '업무', short: '업무', hint: '할 일 목록으로', side: 'right', cls: 'text-emerald-900 bg-emerald-100' },
];

/** 다이어리 화면. 받은함이 기본이고 달력은 보조 보기입니다. */
export const SSUGEOK_VIEWS = [
    { id: 'inbox', label: '쓱, 적', short: '쓱, 적' },
    { id: 'student', label: '학생', short: '학생' },
    { id: 'attend', label: '출결', short: '출결' },
    { id: 'counsel', label: '상담', short: '상담' },
    { id: 'plan', label: '오늘·주간', short: '주간' },
    { id: 'task', label: '업무', short: '업무' },
    { id: 'cal', label: '달력', short: '달력' },
];

export const destById = (id) => SSUGEOK_DESTS.find((d) => d.id === id);

export const destsOn = (side) => SSUGEOK_DESTS.filter((d) => d.side === side);

/** 목적지 이름 뒤 조사. 받침 없거나 ㄹ이면 로, 그 외는 으로. */
export function dest조사(label) {
    const ch = String(label || '').slice(-1);
    const code = ch.charCodeAt(0);
    if (code < 0xac00 || code > 0xd7a3) return '으로';
    const jong = (code - 0xac00) % 28;
    return jong === 0 || jong === 8 ? '로' : '으로';
}

/** 힌트에 따른 추천 목적지. 자동 전송하지 않고 강조만 합니다. */
export function suggestedDest(typeHint) {
    const h = String(typeHint || '').trim();
    if (h === '할일') return 'task';
    if (h === '생각') return 'counsel';
    if (h === '일') return 'plan';
    return null;
}

/** 본문에 명단 이름이 있으면 그 학생을 미리 고릅니다. */
export function guessStudent(text, names) {
    const t = String(text || '');
    return (names || []).find((n) => n && t.includes(n)) || '';
}

/** 출결 상태 단어를 본문에서 찾습니다. */
export function guessAttendStatus(text) {
    const t = String(text || '');
    if (t.includes('결석')) return '결석';
    if (t.includes('지각')) return '지각';
    if (t.includes('조퇴')) return '조퇴';
    return ATTEND_STATUS[0];
}

/** 명단에 없으면 최소 학생을 한 줄 추가합니다. */
export async function ensureRosterName(name, roster, signedIn) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return;
    if ((roster || []).some((r) => r.name === trimmed)) return;
    await addItem('classRoster', { name: trimmed }, signedIn);
}

/**
 * 쓱, 적 한 건을 목적지로 옮긴 뒤 받은함에서 지웁니다.
 * 기존 출결·할 일 컬렉션을 재사용하고, 없는 목적지는 전용 컬렉션에 둡니다.
 */
export async function sendSsugeokItem({ destId, item, extras, roster, signedIn, author }) {
    const text = String(item?.text || '').trim();
    if (!text) throw new Error('내용이 없습니다.');
    const dest = destById(destId);
    if (!dest) throw new Error('목적지를 찾을 수 없습니다.');

    const date = extras?.date || todayYmd();
    const student = String(extras?.student || '').trim();
    const source = {
        fromSsugeok: true,
        ssugeokHint: item.typeHint || '',
        author,
    };

    if (destId === 'student') {
        if (!student) throw new Error('학생 이름을 입력해 주세요.');
        await ensureRosterName(student, roster, signedIn);
        await addItem('studentNotes', { student, text, date, ...source }, signedIn);
    } else if (destId === 'attend') {
        if (!student) throw new Error('학생 이름을 입력해 주세요.');
        await ensureRosterName(student, roster, signedIn);
        await addItem('teacherAttend', {
            date,
            student,
            status: extras?.status || guessAttendStatus(text),
            note: text,
            ...source,
        }, signedIn);
    } else if (destId === 'counsel') {
        if (!student) throw new Error('학생 이름을 입력해 주세요.');
        await ensureRosterName(student, roster, signedIn);
        await addItem('counselNotes', {
            student,
            text,
            date,
            kind: extras?.kind === '누가' ? '누가' : '상담',
            ...source,
        }, signedIn);
    } else if (destId === 'plan') {
        const kind = extras?.planKind === 'week' ? 'week' : 'today';
        await addItem('teacherPlans', {
            text,
            date,
            weekStart: startOfWeekMon(date),
            kind,
            ...source,
        }, signedIn);
    } else if (destId === 'task') {
        await addItem('teacherTodos', {
            text,
            done: false,
            date,
            source: 'ssugeok',
            ...source,
        }, signedIn);
    }

    if (item.id) await removeItem('ssugeokInbox', item.id, signedIn);
    return dest;
}
