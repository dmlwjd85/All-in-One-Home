/** 내보내기 JSON 키 → 기존 localStorage 이름. 컬렉션 이름과 같습니다. */
export const BACKUP_LISTS = {
    inbox: 'ssugeokInbox',
    studentNotes: 'studentNotes',
    counselNotes: 'counselNotes',
    plans: 'teacherPlans',
    todos: 'teacherTodos',
    attendance: 'teacherAttend',
    roster: 'classRoster',
    ledger: 'ledgerTx',
    budgets: 'ledgerBudgets',
    lessons: 'teacherLessons',
    meets: 'teacherMeets',
    contacts: 'teacherContacts',
    timetable: 'teacherTimetable',
    diary: 'familyDiary',
    ddayCards: 'ddayCards',
    submissionSheets: 'submissionSheets',
};

export const BACKUP_RECORD = 'praiseBoard';

export const BACKUP_LABELS = {
    inbox: '쓱, 적 받은함',
    studentNotes: '학생 메모',
    counselNotes: '상담 메모',
    plans: '주간 계획',
    todos: '할 일',
    attendance: '출결 메모',
    roster: '명렬',
    ledger: '장부',
    budgets: '예산 장부',
    lessons: '수업 메모',
    meets: '회의 메모',
    contacts: '연락',
    timetable: '시간표 메모',
    diary: '일기',
    ddayCards: '기한 카드',
    submissionSheets: '제출물',
    praiseBoard: '칭찬 스티커',
    ssugeokSensitive: '이 기기 민감 메모',
    notebookFields: '쪽 칸',
};

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_ITEMS = 5000;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

const storageKey = (name) => `homenote_v2_${name}`;

function isPlain(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function validateBackup(text) {
    const errors = [];
    if (typeof text !== 'string' || !text.trim()) {
        return { ok: false, errors: ['파일이 비어 있습니다.'], counts: {}, data: null };
    }
    if (text.length > MAX_BYTES) {
        return { ok: false, errors: ['파일이 8MB를 넘습니다.'], counts: {}, data: null };
    }
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return { ok: false, errors: ['JSON 형식이 아닙니다. 올바른 백업 파일인지 확인해 주세요.'], counts: {}, data: null };
    }
    if (!isPlain(data)) {
        return { ok: false, errors: ['백업은 객체여야 합니다.'], counts: {}, data: null };
    }
    if (Object.keys(data).some((key) => FORBIDDEN.has(key))) {
        errors.push('허용되지 않은 키가 있습니다.');
    }
    const known = new Set([...Object.keys(BACKUP_LISTS), BACKUP_RECORD, 'ssugeokSensitive', 'notebookFields', 'exportedAt']);
    const unknown = Object.keys(data).filter((key) => !known.has(key) && !FORBIDDEN.has(key));
    if (unknown.length) errors.push(`알 수 없는 항목이 있습니다: ${unknown.slice(0, 4).join(', ')}`);

    const counts = {};
    for (const key of Object.keys(BACKUP_LISTS)) {
        if (data[key] == null) {
            counts[key] = 0;
            continue;
        }
        if (!Array.isArray(data[key])) {
            errors.push(`${BACKUP_LABELS[key]}은 목록이어야 합니다.`);
            continue;
        }
        if (data[key].length > MAX_ITEMS) errors.push(`${BACKUP_LABELS[key]}이 너무 깁니다.`);
        if (data[key].some((row) => !isPlain(row))) errors.push(`${BACKUP_LABELS[key]}에 잘못된 항목이 있습니다.`);
        counts[key] = data[key].length;
    }

    if (data[BACKUP_RECORD] == null) counts[BACKUP_RECORD] = 0;
    else if (!isPlain(data[BACKUP_RECORD])) errors.push('칭찬 스티커 형식이 아닙니다.');
    else counts[BACKUP_RECORD] = Object.keys(data[BACKUP_RECORD]).length;

    if (data.ssugeokSensitive == null) counts.ssugeokSensitive = 0;
    else if (!Array.isArray(data.ssugeokSensitive)) errors.push('민감 메모는 목록이어야 합니다.');
    else counts.ssugeokSensitive = data.ssugeokSensitive.length;

    if (data.notebookFields == null) counts.notebookFields = 0;
    else if (!isPlain(data.notebookFields)) errors.push('쪽 기록은 객체여야 합니다.');
    else {
        const pages = Object.keys(data.notebookFields);
        if (pages.length > 580) errors.push('쪽 기록이 580쪽을 넘습니다.');
        for (const page of pages) {
            const n = Number(page);
            if (!Number.isInteger(n) || n < 1 || n > 580) {
                errors.push(`쪽 번호가 범위를 벗어났습니다: ${page}`);
                break;
            }
            if (!isPlain(data.notebookFields[page])) {
                errors.push(`${page}쪽 기록이 객체가 아닙니다.`);
                break;
            }
        }
        counts.notebookFields = pages.length;
    }

    return {
        ok: errors.length === 0,
        errors,
        counts,
        data: errors.length ? null : data,
    };
}

export function countBackup(data) {
    return validateBackup(JSON.stringify(data)).counts;
}

function readJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch {
        return fallback;
    }
}

export function buildExportPayload(parts) {
    const notebookFields = {};
    for (let page = 1; page <= 580; page += 1) {
        const raw = localStorage.getItem(`homenote_v2_notebookFields_p${page}`);
        if (!raw) continue;
        try {
            notebookFields[page] = JSON.parse(raw);
        } catch {
            /* 깨진 쪽은 내보내기에서 건너뜁니다. */
        }
    }
    return {
        exportedAt: new Date().toISOString(),
        ...parts,
        ssugeokSensitive: readJson(storageKey('ssugeokSensitive'), []),
        notebookFields,
    };
}

/** 같은 id는 백업 값이 이기고, 이 기기에만 있는 id는 남깁니다. */
export function mergeById(localRows, incomingRows) {
    const merged = [];
    const index = new Map();
    for (const row of Array.isArray(localRows) ? localRows : []) {
        if (!isPlain(row)) continue;
        merged.push({ ...row });
        if (row.id != null && row.id !== '') index.set(String(row.id), merged.length - 1);
    }
    for (const row of Array.isArray(incomingRows) ? incomingRows : []) {
        if (!isPlain(row)) continue;
        const id = row.id != null && row.id !== '' ? String(row.id) : '';
        if (id && index.has(id)) merged[index.get(id)] = { ...merged[index.get(id)], ...row };
        else {
            merged.push({ ...row });
            if (id) index.set(id, merged.length - 1);
        }
    }
    return merged;
}

export function mergePlain(local, incoming) {
    return { ...(isPlain(local) ? local : {}), ...(isPlain(incoming) ? incoming : {}) };
}

/**
 * 백업에 들어 있는 키만 이 기기에 반영합니다.
 * overwrite는 그 키 전체를 바꾸고, merge는 id·칸 단위로 합칩니다.
 */
export function applyBackupLocal(data, options = {}) {
    const merge = options.mode === 'merge';
    for (const [key, name] of Object.entries(BACKUP_LISTS)) {
        if (!Array.isArray(data[key])) continue;
        const next = merge ? mergeById(readJson(storageKey(name), []), data[key]) : data[key];
        localStorage.setItem(storageKey(name), JSON.stringify(next));
    }
    if (isPlain(data[BACKUP_RECORD])) {
        const next = merge ? mergePlain(readJson(storageKey(BACKUP_RECORD), {}), data[BACKUP_RECORD]) : data[BACKUP_RECORD];
        localStorage.setItem(storageKey(BACKUP_RECORD), JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('nb-shared-record', { detail: { name: BACKUP_RECORD } }));
    }
    if (Array.isArray(data.ssugeokSensitive)) {
        const next = merge ? mergeById(readJson(storageKey('ssugeokSensitive'), []), data.ssugeokSensitive) : data.ssugeokSensitive;
        localStorage.setItem(storageKey('ssugeokSensitive'), JSON.stringify(next));
        window.dispatchEvent(new CustomEvent('nb-ssugeok-sensitive'));
    }
    if (isPlain(data.notebookFields)) {
        for (const [page, fields] of Object.entries(data.notebookFields)) {
            const storage = `homenote_v2_notebookFields_p${page}`;
            const next = merge ? mergePlain(readJson(storage, {}), fields) : fields;
            localStorage.setItem(storage, JSON.stringify(next));
        }
    }
    window.dispatchEvent(new CustomEvent('nb-page-fields', { detail: { page: 0 } }));
}
