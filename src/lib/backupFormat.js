import { isDeviceOnlyList, LIST_COLLECTIONS, RECORD_COLLECTIONS } from './collections.js';
import { NOTEBOOK_PAGE_COUNT } from './fieldLocal.js';
import { isSensitiveNote } from './sensitive.js';

export const BACKUP_LISTS = [
    { key: 'inbox', collection: 'ssugeokInbox', label: '쓱적' },
    { key: 'studentNotes', collection: 'studentNotes', label: '학생 메모' },
    { key: 'counselNotes', collection: 'counselNotes', label: '상담 기록', deviceOnly: true },
    { key: 'plans', collection: 'teacherPlans', label: '계획' },
    { key: 'todos', collection: 'teacherTodos', label: '할 일' },
    { key: 'attendance', collection: 'teacherAttend', label: '출결' },
    { key: 'roster', collection: 'classRoster', label: '명렬' },
    { key: 'ledger', collection: 'ledgerTx', label: '가계부' },
    { key: 'budgets', collection: 'ledgerBudgets', label: '예산 한도' },
    { key: 'lessons', collection: 'teacherLessons', label: '수업' },
    { key: 'meets', collection: 'teacherMeets', label: '회의' },
    { key: 'contacts', collection: 'teacherContacts', label: '연락' },
    { key: 'timetable', collection: 'teacherTimetable', label: '시간표' },
    { key: 'diary', collection: 'familyDiary', label: '일기' },
    { key: 'ddayCards', collection: 'ddayCards', label: '기한 카드' },
    { key: 'submissionSheets', collection: 'submissionSheets', label: '제출물' },
];

const LIST_BY_KEY = new Map(BACKUP_LISTS.map((row) => [row.key, row]));
const KNOWN_KEYS = new Set([
    ...BACKUP_LISTS.map((row) => row.key),
    'praiseBoard',
    'ssugeokSensitive',
    'notebookFields',
    'exportedAt',
]);

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function buildBackupPayload(sources) {
    const payload = { exportedAt: new Date().toISOString() };
    for (const row of BACKUP_LISTS) payload[row.key] = sources[row.key] || [];
    payload.praiseBoard = sources.praiseBoard && typeof sources.praiseBoard === 'object' ? sources.praiseBoard : {};
    payload.ssugeokSensitive = sources.ssugeokSensitive || [];
    payload.notebookFields = sources.notebookFields || {};
    return payload;
}

export function splitInbox(items) {
    const cloud = [];
    const device = [];
    for (const item of items || []) {
        if (isSensitiveNote(item)) device.push({ ...item, sensitive: true });
        else cloud.push(item);
    }
    return { cloud, device };
}

function previewCount(key, data) {
    if (key === 'ssugeokSensitive') {
        const extra = data.inbox ? splitInbox(data.inbox).device.length : 0;
        const own = Array.isArray(data.ssugeokSensitive) ? data.ssugeokSensitive.length : 0;
        return { key, label: '건강·민원·학폭·상담 메모', count: own + extra, deviceOnly: true };
    }
    if (key === 'notebookFields') {
        const pages = data.notebookFields && typeof data.notebookFields === 'object'
            ? Object.keys(data.notebookFields).length
            : 0;
        return { key, label: '쪽 칸', count: pages, deviceOnly: false };
    }
    if (key === 'praiseBoard') {
        const count = isPlainObject(data.praiseBoard) ? Object.keys(data.praiseBoard).length : 0;
        return { key, label: '칭찬 스티커', count, deviceOnly: false };
    }
    const row = LIST_BY_KEY.get(key);
    return {
        key,
        label: row?.label || key,
        count: Array.isArray(data[key]) ? data[key].length : 0,
        deviceOnly: Boolean(row?.deviceOnly),
    };
}

export function parseBackup(text) {
    let data;
    try {
        data = JSON.parse(String(text || ''));
    } catch {
        return { ok: false, error: 'JSON 파일이 아닙니다.' };
    }
    if (!isPlainObject(data)) return { ok: false, error: '백업 형식이 아닙니다.' };

    const errors = [];
    for (const row of BACKUP_LISTS) {
        if (!(row.key in data)) continue;
        if (!Array.isArray(data[row.key])) {
            errors.push(`${row.label}은 목록이어야 합니다.`);
            continue;
        }
        if (data[row.key].some((item) => !isPlainObject(item))) {
            errors.push(`${row.label}에 항목이 아닌 값이 있습니다.`);
        }
    }
    if ('ssugeokSensitive' in data) {
        if (!Array.isArray(data.ssugeokSensitive)) errors.push('민감 메모는 목록이어야 합니다.');
        else if (data.ssugeokSensitive.some((item) => !isPlainObject(item))) errors.push('민감 메모에 항목이 아닌 값이 있습니다.');
    }
    if ('praiseBoard' in data && !isPlainObject(data.praiseBoard)) errors.push('칭찬 스티커 형식이 아닙니다.');
    if ('notebookFields' in data) {
        if (!isPlainObject(data.notebookFields)) errors.push('쪽 기록 형식이 아닙니다.');
        else {
            for (const [page, fields] of Object.entries(data.notebookFields)) {
                const n = Number(page);
                if (!Number.isInteger(n) || n < 1 || n > NOTEBOOK_PAGE_COUNT || !isPlainObject(fields)) {
                    errors.push('쪽 기록에 읽을 수 없는 쪽이 있습니다.');
                    break;
                }
            }
        }
    }

    const present = [...KNOWN_KEYS].filter((key) => key !== 'exportedAt' && key in data);
    if (!present.length) errors.push('가져올 기록이 없습니다.');
    if (errors.length) return { ok: false, error: errors[0] };

    const preview = [];
    for (const row of BACKUP_LISTS) {
        if (!(row.key in data)) continue;
        if (row.key === 'inbox') {
            const parts = splitInbox(data.inbox);
            preview.push({
                key: row.key,
                label: row.label,
                count: parts.cloud.length,
                deviceOnly: false,
            });
            continue;
        }
        preview.push(previewCount(row.key, data));
    }
    if ('ssugeokSensitive' in data || (Array.isArray(data.inbox) && splitInbox(data.inbox).device.length)) {
        const parts = Array.isArray(data.inbox) ? splitInbox(data.inbox) : { device: [] };
        const own = Array.isArray(data.ssugeokSensitive) ? data.ssugeokSensitive : [];
        const ids = new Set();
        let count = 0;
        for (const item of [...own, ...parts.device]) {
            const id = item?.id || `row-${count}`;
            if (ids.has(id)) continue;
            ids.add(id);
            count += 1;
        }
        preview.push({
            key: 'ssugeokSensitive',
            label: '건강·민원·학폭·상담 메모',
            count,
            deviceOnly: true,
        });
    }
    if ('notebookFields' in data) preview.push(previewCount('notebookFields', data));
    if ('praiseBoard' in data) preview.push(previewCount('praiseBoard', data));

    return {
        ok: true,
        data,
        preview,
        exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    };
}

export function collectionForBackupKey(key) {
    return LIST_BY_KEY.get(key)?.collection || '';
}

export function backupKeysCoverCloudLists() {
    const covered = new Set(BACKUP_LISTS.map((row) => row.collection));
    return LIST_COLLECTIONS.every((name) => covered.has(name))
        && RECORD_COLLECTIONS.every((row) => row.name === 'praiseBoard');
}

export function deviceOnlyBackupKeys() {
    return BACKUP_LISTS.filter((row) => row.deviceOnly || isDeviceOnlyList(row.collection)).map((row) => row.key);
}
