/** 구역 색. 아이 민트, 업무 라벤더, 날짜 피치, 기록 버터. */

const SCHEDULE = new Set([
    'year-cal', 'academic', 'month', 'week', 'week-toc', 'special-toc', 'special-day', 'prep',
]);
const STUDENT = new Set([
    'roster', 'survey', 'health', 'student-card', 'student-who', 'counsel', 'counsel-toc',
    'parent', 'attend', 'attend-toc', 'class-toc', 'class-rules', 'roles', 'seating',
    'timetable', 'consult-time', 'quick-note',
]);
const WORK = new Set([
    'work-toc', 'deadline', 'todo', 'meeting', 'notice', 'budget-toc', 'budget-item',
    'budget-misc', 'lesson-toc', 'progress', 'unit', 'checklist', 'score', 'eval-area', 'year-prep',
]);
const RECORD = new Set([
    'tag-legend', 'tag-index', 'ssugeok', 'ssugeok-toc', 'memo', 'notebook-toc', 'notebook-paper',
    'board-toc', 'chalkboard', 'whiteboard', 'grid-board', 'sticker-toc', 'sticker-sheet', 'incident',
]);

export const TONE_MARK = {
    peach: '•',
    mint: '•',
    lavender: '•',
    butter: '•',
    sand: '✦',
};

export const TONE_LABEL = {
    peach: '날짜',
    mint: '아이들',
    lavender: '업무',
    butter: '기록',
    sand: '기타',
};

export function toneForType(type) {
    if (SCHEDULE.has(type)) return 'peach';
    if (STUDENT.has(type)) return 'mint';
    if (WORK.has(type)) return 'lavender';
    if (RECORD.has(type)) return 'butter';
    return 'sand';
}

export function toneForPage(pageNo, pages) {
    const type = pages?.[pageNo - 1]?.type;
    return toneForType(type);
}
