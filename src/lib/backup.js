import { isValidYmd } from './date.js';
import { isSensitiveText } from './sensitive.js';
import { LEGACY_LISTS } from './migrate.js';
import { cleanAcademic } from './academic.js';
import { mergeGoals, normalizeGoals } from './todoAchieve.js';
import { LEVEL_LENGTH, MAX_PERIODS, isHm } from './period.js';

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
    if (!plain(data) || data.format !== 'ssug-gyomu') errors.push('쨈 교무수첩 백업 파일이 아니에요.');
    if (data?.version !== 1) errors.push('이 앱이 읽는 파일 판이 아니에요.');
    if (errors.length) return { ok: false, errors, data: null };
    for (const key of ['students', 'attendance', 'records', 'events', 'todos', 'notes', 'notices', 'legacy', 'inbox']) {
        if (data[key] != null && !Array.isArray(data[key])) errors.push(`${key} 목록이 이상해요.`);
    }
    (data.students || []).forEach((row) => {
        if (!plain(row) || !(row.no >= 1 && row.no <= 50) || typeof row.name !== 'string' || row.name.length > 20) {
            errors.push('학생 이름이나 번호가 범위를 벗어났어요.');
        }
    });
    (data.records || []).forEach((row, index) => checkRecord(row, errors, index));
    if (data.local != null && !plain(data.local)) errors.push('이 기기 전용 자료 모양이 이상해요.');
    for (const key of LOCAL_LISTS) {
        if (data.local?.[key] != null && !Array.isArray(data.local[key])) errors.push(`이 기기 전용 ${key} 목록이 이상해요.`);
    }
    (Array.isArray(data.local?.records) ? data.local.records : []).forEach((row, index) => checkRecord(row, errors, index));
    /* 새 판에서 더한 칸(학사일정·고친 날·마감한 날·목표·교시 시각). 예전 판 파일에는 없으므로 있을 때만 봅니다. */
    const profile = data.profile;
    if (profile != null && !plain(profile)) errors.push('학급 설정 모양이 이상해요.');
    for (const key of ['ttEdited', 'checkedDates']) {
        if (profile?.[key] != null && (!Array.isArray(profile[key]) || profile[key].length > 2000)) errors.push(`${key} 목록이 이상해요.`);
    }
    if (profile?.academic != null && !plain(profile.academic)) errors.push('학사일정 모양이 이상해요.');
    if (data.goals != null && !plain(data.goals)) errors.push('목표 모양이 이상해요.');
    if (data.periodLocal != null && !plain(data.periodLocal)) errors.push('교시 설정 모양이 이상해요.');
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

function inboxExportRows(state, includeLocal) {
    const rows = Array.isArray(state?.inbox) ? state.inbox : [];
    if (includeLocal) return rows;
    return rows.filter((row) => !isSensitiveText(`${row?.title || ''} ${row?.memo || ''} ${row?.warning || ''}`));
}

function copyData(value) {
    if (value == null || typeof value !== 'object') return value;
    return structuredClone(value);
}

/** 안쪽 백업 본문은 뺍니다. 교체할 때마다 파일 안에 이전 파일이 겹치지 않습니다. */
function copyBackup(backup) {
    if (!backup || typeof backup !== 'object') return null;
    const rest = { ...backup };
    delete rest.payload;
    if (!Object.keys(rest).length) return null;
    try {
        return JSON.parse(JSON.stringify(rest));
    } catch {
        return null;
    }
}

/** 이 기기에만 두는 목록. 백업의 local 안에 들어갑니다(backup은 따로). */
export const LOCAL_LISTS = ['records', 'notes', 'events', 'todos', 'notices', 'contacts', 'pages'];

export function buildExport(state, { includeLocal = false, at, periodLocal } = {}) {
    const profile = state.profile || {};
    const data = {
        format: 'ssug-gyomu',
        version: 1,
        exportedAt: at,
        profile: {
            className: profile.className,
            schoolYear: profile.schoolYear,
            classSize: profile.classSize,
            periodStarts: copyData(profile.periodStarts),
            /* 학사일정, 날짜별로 고친 시간표 날, 출결 마감한 날. 예전 판 백업에는 없어서, 없으면 복원할 때 지금 값을 둡니다. */
            academic: copyData(profile.academic || {}),
            ttEdited: copyData(profile.ttEdited || []),
            checkedDates: copyData(profile.checkedDates || []),
        },
        students: copyData(state.students),
        attendance: copyData(state.attendance),
        records: copyData(state.records),
        events: copyData(state.events),
        todos: copyData(state.todos),
        notes: copyData(state.notes),
        notices: copyData(state.notices),
        timetable: copyData(state.timetable),
        legacy: copyData(state.legacyPages),
        inbox: copyData(inboxExportRows(state, includeLocal)),
        /* 업데이트 전 수정 보관함(PR #66): 다른 기기의 나중 수정에 밀린 이 기기 값. 백업에도 남깁니다. */
        keptLegacy: copyData(state.keptLegacy || []),
        /* 할 일 하루 목표와 날짜별 달성 기록. */
        goals: copyData(normalizeGoals(state.goals)),
    };
    /* 교시 수·길이·9·10교시·출퇴근 시각(이 기기 저장소 값). 고친 시각(syncAt·syncAts)은 기기마다 달라 넣지 않습니다. */
    const period = cleanPeriodLocal(periodLocal);
    if (period) data.periodLocal = period;
    if (includeLocal) {
        const source = state.local || {};
        const previous = source.backup;
        const rest = { ...source };
        delete rest.backup;
        const local = copyData(rest) || {};
        const safe = copyBackup(previous);
        if (safe) local.backup = safe;
        data.local = local;
    }
    return data;
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const DAY_NAMES = new Set(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);

/** 백업의 교시 설정에서 아는 칸만 모양을 보고 꺼냅니다. 쓸 칸이 없으면 null. */
export function cleanPeriodLocal(value) {
    if (!plain(value)) return null;
    const out = {};
    if (typeof value.level === 'string' && LEVEL_LENGTH[value.level]) out.level = value.level;
    const count = Number(value.count);
    if (Number.isInteger(count) && count >= 1 && count <= MAX_PERIODS) out.count = count;
    if (Array.isArray(value.lengths)) out.lengths = value.lengths.slice(0, MAX_PERIODS).map((n) => (Number.isFinite(Number(n)) && n !== null && n !== '' ? Number(n) : null));
    if (Array.isArray(value.extraStarts)) out.extraStarts = value.extraStarts.slice(0, 2).map((v) => (isHm(v) ? v : ''));
    if (Array.isArray(value.locks)) out.locks = [...new Set(value.locks.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= MAX_PERIODS))].sort((a, b) => a - b);
    if (Array.isArray(value.cellLocks)) out.cellLocks = [...new Set(value.cellLocks.filter((v) => typeof v === 'string' && /^[a-z]{3}-\d{1,2}$/.test(v)))];
    for (const key of ['workStart', 'workEnd']) if (value[key] === '' || isHm(value[key])) out[key] = value[key];
    if (plain(value.extra)) {
        const extra = {};
        for (const [day, row] of Object.entries(value.extra)) {
            if (!DAY_NAMES.has(day) || !plain(row)) continue;
            const clean = {};
            for (const [k, v] of Object.entries(row)) if (/^[ps](9|10)$/.test(k) && typeof v === 'string' && v.length <= 40) clean[k] = v;
            if (Object.keys(clean).length) extra[day] = clean;
        }
        out.extra = extra;
    }
    return Object.keys(out).length ? out : null;
}

function dayList(list) {
    return Array.isArray(list) ? list.filter((v) => typeof v === 'string' && DAY_RE.test(v)) : null;
}

/**
 * 백업 파일의 학급 설정 가운데 새 판에서 더한 칸(학년도·학사일정·고친 날·마감한 날)과 목표를 지금 값에 넣습니다.
 * 파일에 없는 칸(예전 판 백업)은 지금 값을 그대로 둡니다. 합치기는 날짜 목록을 합치고, 바꾸기는 파일 값으로 바꿉니다.
 * profile과 goals를 고친 새 값으로 돌려줍니다(받은 값은 바꾸지 않습니다).
 */
export function incomingSettings(current, data, mode) {
    const profile = { ...(current?.profile || {}) };
    let goals = current?.goals;
    const file = plain(data?.profile) ? data.profile : {};
    const year = Number(file.schoolYear);
    if (Number.isInteger(year) && year >= 2020 && year <= 2099) profile.schoolYear = year;
    if (plain(file.academic)) {
        profile.academic = cleanAcademic(mode === 'replace' ? file.academic : { ...(profile.academic || {}), ...file.academic });
    }
    for (const key of ['ttEdited', 'checkedDates']) {
        const list = dayList(file[key]);
        if (!list) continue;
        const next = mode === 'replace' ? list : [...(Array.isArray(profile[key]) ? profile[key] : []), ...list];
        profile[key] = [...new Set(next)].sort();
    }
    if (plain(data?.goals)) goals = mode === 'replace' ? normalizeGoals(data.goals) : mergeGoals(goals, data.goals);
    return { profile, goals };
}

function localRows(list) {
    return Array.isArray(list) ? list.filter((row) => plain(row) && (typeof row.id === 'string' || typeof row.id === 'number')) : [];
}

/**
 * 이 기기 전용 자료(local)를 백업에서 되살립니다. 기록뿐 아니라 할 일·일정·메모·알림장·연락처·쪽도 함께입니다.
 * extraRecords는 파일의 일반 기록 가운데 민감해서 이 기기로 옮길 기록입니다.
 * 파일에 이 기기 전용 자료가 없으면(이 기기 자료를 빼고 내보낸 파일·예전 판) 바꾸기에서도 지금 이 기기 자료를 지우지 않습니다.
 */
export function incomingLocal(current, data, mode, extraRecords = []) {
    const base = plain(current) ? current : {};
    const out = { ...base };
    const file = plain(data?.local) ? data.local : null;
    const merge = (now, incoming) => {
        const map = new Map((Array.isArray(now) ? now : []).map((item) => [item.id, item]));
        for (const item of incoming) map.set(item.id, item);
        return [...map.values()];
    };
    for (const key of LOCAL_LISTS) {
        const incoming = [...(file ? localRows(file[key]) : []), ...(key === 'records' ? localRows(extraRecords) : [])];
        if (file && mode === 'replace') out[key] = merge([], incoming);
        else out[key] = merge(base[key], incoming);
    }
    return out;
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
    const body = JSON.stringify(data, null, 2);
    if (typeof document === 'undefined' || typeof URL.createObjectURL !== 'function') return body;
    try {
        const blob = new Blob([body], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
        URL.revokeObjectURL(url);
    } catch {
        /* 받기가 막혀도 기록 자체는 호출한 쪽이 지킵니다. */
    }
    return body;
}
