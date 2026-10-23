import { isValidYmd } from './date.js';
import { isSensitiveText } from './sensitive.js';
import { LEGACY_LISTS } from './migrate.js';

const MAX_BYTES = 8 * 1024 * 1024;
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

function plain(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function forbiddenKey(value, path = '') {
    if (!value || typeof value !== 'object') return '';
    for (const key of Object.keys(value)) {
        if (FORBIDDEN.has(key)) return path ? `${path}.${key}` : key;
        const nested = forbiddenKey(value[key], path ? `${path}.${key}` : key);
        if (nested) return nested;
    }
    return '';
}

export function isOldBackup(data) {
    return plain(data) && (data.notebookFields || data.exportedAt) && data.format !== 'ssug-gyomu';
}

export function oldBackupToBag(data) {
    const lists = {};
    for (const [name, exportKey] of Object.entries(LEGACY_LISTS)) {
        if (Array.isArray(data[exportKey])) lists[name] = data[exportKey];
    }
    const pages = {};
    if (plain(data.notebookFields)) {
        for (const [page, fields] of Object.entries(data.notebookFields)) pages[Number(page)] = fields;
    }
    return {
        pages,
        lists,
        sensitive: Array.isArray(data.ssugeokSensitive) ? data.ssugeokSensitive : [],
        praise: plain(data.praiseBoard) ? data.praiseBoard : {},
        extra: plain(data.extra) ? data.extra : {},
    };
}

function checkRecord(row, errors, index) {
    if (!plain(row)) {
        errors.push(`기록 ${index + 1} 형식이 아니에요.`);
        return;
    }
    if (!isValidYmd(row.date)) errors.push('기록 날짜가 이상해요.');
    if (!['관찰', '상담', '보호자', '칭찬'].includes(row.kind)) errors.push('기록 종류를 알 수 없어요.');
    if (typeof row.text !== 'string' || row.text.length > 2000) errors.push('기록 글이 너무 길거나 비어 있어요.');
    if (row.tags != null && (!Array.isArray(row.tags) || row.tags.length > 10 || row.tags.some((tag) => typeof tag !== 'string' || tag.length > 12))) {
        errors.push('태그는 12자 안으로 10개까지예요.');
    }
}

export function validateNewBackup(data) {
    const errors = [];
    if (!plain(data) || data.format !== 'ssug-gyomu') errors.push('콕 교무수첩 백업 파일이 아니에요.');
    if (data?.version !== 1) errors.push('이 앱이 읽는 파일 판이 아니에요.');
    if (errors.length) return { ok: false, errors, data: null };
    for (const key of ['students', 'attendance', 'records', 'events', 'todos', 'notes', 'notices', 'legacy']) {
        if (data[key] != null && !Array.isArray(data[key])) errors.push(`${key} 목록이 이상해요.`);
    }
    (data.students || []).forEach((row) => {
        if (!plain(row) || !(row.no >= 1 && row.no <= 50) || typeof row.name !== 'string' || row.name.length > 20) {
            errors.push('학생 이름이나 번호가 범위를 벗어났어요.');
        }
    });
    (data.records || []).forEach((row, index) => checkRecord(row, errors, index));
    (data.local?.records || []).forEach((row, index) => checkRecord(row, errors, index));
    return { ok: errors.length === 0, errors: errors.slice(0, 8), data: errors.length ? null : data };
}

export function validateBackupText(text) {
    if (typeof text !== 'string' || !text.trim()) return { ok: false, errors: ['파일이 비어 있어요.'], data: null, kind: '' };
    if (text.length > MAX_BYTES) return { ok: false, errors: ['파일이 8MB를 넘어요.'], data: null, kind: '' };
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        return { ok: false, errors: ['파일을 읽지 못했어요. 백업 파일이 맞는지 봐 주세요.'], data: null, kind: '' };
    }
    const bad = forbiddenKey(data);
    if (bad) return { ok: false, errors: ['허용되지 않은 항목이 있어요.'], data: null, kind: '' };
    if (plain(data) && data.format === 'ssug-gyomu') {
        const checked = validateNewBackup(data);
        return { ...checked, kind: 'ssug-gyomu' };
    }
    if (isOldBackup(data)) return { ok: true, errors: [], data, kind: 'legacy' };
    return { ok: false, errors: ['아는 백업 형식이 아니에요.'], data: null, kind: '' };
}

export function buildExport(state, { includeLocal = false, at }) {
    const data = {
        format: 'ssug-gyomu',
        version: 1,
        exportedAt: at,
        profile: {
            className: state.profile.className,
            schoolYear: state.profile.schoolYear,
            classSize: state.profile.classSize,
            periodStarts: state.profile.periodStarts,
        },
        students: state.students,
        attendance: state.attendance,
        records: state.records,
        events: state.events,
        todos: state.todos,
        notes: state.notes,
        notices: state.notices,
        timetable: state.timetable,
        legacy: state.legacyPages,
    };
    if (includeLocal) data.local = state.local;
    return data;
}

export function splitSensitive(records) {
    const cloud = [];
    const local = [];
    for (const row of records || []) {
        if (row.localOnly || isSensitiveText(row.text, row.tags)) local.push({ ...row, localOnly: true });
        else cloud.push(row);
    }
    return { cloud, local };
}

export function downloadJson(filename, data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
}
