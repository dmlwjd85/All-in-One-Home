/** 과제 체크. 새 컬렉션을 만들지 않고 기존 메모(notes)에 둡니다.
    과제 한 건은 '과제' 태그 메모(id는 hw-…)이고, 학생 한 명의 제출은 '제출' 태그 메모(id는 hx-…)입니다.
    그래서 기기 합치기는 메모와 같습니다. 항목마다 나중에 고친 쪽이 이기고, 한쪽에만 있는 항목은 합치고,
    지운 항목은 지운 시각(묘비)으로 견줍니다. Firestore 규칙·저장 키는 바꾸지 않습니다. */
import { isValidYmd } from './date.js';

export const HW_TAG = '과제';
export const CHECK_TAG = '제출';
/** 과제 메모의 본문. 제목과 날짜는 메모 칸을 그대로 쓰고, 본문은 빈 칸이 되지 않게 이 표시만 둡니다. */
export const HW_TEXT = '과제';
export const HW_TITLE_MAX = 60;

export function isHomework(row) {
    return Boolean(row && /^hw-/.test(String(row.id || '')) && Array.isArray(row.tags) && row.tags.includes(HW_TAG));
}

export function isHomeworkCheck(row) {
    return Boolean(row && /^hx-/.test(String(row.id || '')) && Array.isArray(row.tags) && row.tags.includes(CHECK_TAG));
}

/** 메모 목록·회의록에 과제 체크가 섞여 보이지 않게 가리는 표시입니다. */
export function isHomeworkNote(row) {
    return isHomework(row) || isHomeworkCheck(row);
}

function fnv32(text) {
    let hash = 0x811c9dc5;
    const body = String(text || '');
    for (let i = 0; i < body.length; i += 1) {
        hash ^= body.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

/** 같은 과제·같은 학생은 어느 기기에서 눌러도 같은 문서가 되게 아이디를 정합니다. 클라우드 아이디는 40자입니다. */
export function homeworkCheckId(assignmentId, sid) {
    const raw = `hx-${assignmentId}-${sid}`;
    if (/^[A-Za-z0-9_-]{1,40}$/.test(raw)) return raw;
    const head = String(assignmentId || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 12);
    return `hx-${head}-${fnv32(`${assignmentId}\n${sid}`)}`.slice(0, 40);
}

export function homeworkTitle(row) {
    const title = String(row?.title || '').trim();
    return title || '이름 없는 과제';
}

export function homeworkAssignments(notes) {
    return (notes || []).filter(isHomework).sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')) || String(a.title || '').localeCompare(String(b.title || ''), 'ko') || String(b.id).localeCompare(String(a.id)));
}

export function submittedIds(notes, assignmentId) {
    const set = new Set();
    for (const row of notes || []) {
        if (!isHomeworkCheck(row) || row.title !== assignmentId) continue;
        const sid = String(row.text || '').trim();
        if (sid) set.add(sid);
    }
    return set;
}

/** 지금 명단만 셉니다. 명단에서 빠진 학생의 제출 표시는 지우지 않고, 다시 들어오면 이어집니다. */
export function homeworkProgress(notes, assignmentId, students) {
    const on = submittedIds(notes, assignmentId);
    const list = Array.isArray(students) ? students : [];
    const submitted = list.filter((student) => student?.id && on.has(student.id)).length;
    return { submitted, total: list.length };
}

export function homeworkProgressLabel({ submitted = 0, total = 0 } = {}) {
    return `제출 ${submitted}/${total}`;
}

export function assignmentRow({ id, title, date }) {
    return {
        id,
        title: String(title || '').trim().slice(0, HW_TITLE_MAX),
        text: HW_TEXT,
        date,
        tags: [HW_TAG],
        pinned: false,
        source: 'app',
    };
}

export function checkRow(assignmentId, sid) {
    return {
        id: homeworkCheckId(assignmentId, sid),
        title: String(assignmentId || '').slice(0, HW_TITLE_MAX),
        text: String(sid || ''),
        tags: [CHECK_TAG],
        pinned: false,
        source: 'app',
    };
}

export function homeworkProblem(title, date) {
    if (!String(title || '').trim()) return '과제 이름을 적어 주세요.';
    if (String(title).trim().length > HW_TITLE_MAX) return `이름은 ${HW_TITLE_MAX}자까지예요.`;
    if (!isValidYmd(date)) return '날짜를 골라 주세요.';
    return '';
}
