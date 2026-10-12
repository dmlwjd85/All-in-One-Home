/** 로그인 계정 공간으로 옮기는 목록형 컬렉션입니다. */
export const LIST_COLLECTIONS = [
    'teacherTodos',
    'teacherAttend',
    'classRoster',
    'ssugeokInbox',
    'studentNotes',
    'counselNotes',
    'teacherPlans',
    'ledgerTx',
    'ledgerBudgets',
    'teacherLessons',
    'teacherMeets',
    'teacherContacts',
    'teacherTimetable',
    'familyDiary',
    'ddayCards',
    'submissionSheets',
];

/** 문서 하나가 board 인 기록입니다. */
export const RECORD_COLLECTIONS = [
    { name: 'praiseBoard', id: 'board' },
];

export const NOTEBOOK_COLLECTION = 'notebookFields';
export const META_COLLECTION = '_meta';
export const MIGRATION_ID = 'legacyImport';

/** 클라우드에 올리지 않는 목록. 상담 기록 전체입니다. */
export const DEVICE_ONLY_LISTS = new Set(['counselNotes']);

export function isDeviceOnlyList(name) {
    return DEVICE_ONLY_LISTS.has(name);
}
