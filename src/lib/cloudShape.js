/** 화면은 한국어로 두고, 클라우드 문서는 배포된 규칙의 칸에만 맞춥니다. */
import { isSensitiveText } from './sensitive.js';

const STATUS_TO = { 결석: 'absent', 지각: 'late', 조퇴: 'early', 결과: 'out' };
const STATUS_FROM = { absent: '결석', late: '지각', early: '조퇴', out: '결과' };
const REASON_TO = { 질병: 'sick', 미인정: 'unexcused', 출석인정: 'approved', 기타: 'other' };
const REASON_FROM = { sick: '질병', unexcused: '미인정', approved: '출석인정', other: '기타' };
const RECORD_TO = { 관찰: 'observe', 상담: 'counsel', 보호자: 'parent', 칭찬: 'praise' };
const RECORD_FROM = { observe: '관찰', counsel: '상담', parent: '보호자', praise: '칭찬' };
const EVENT_TO = { 학급: 'class', 학교: 'school', 휴일: 'holiday', '내 일정': 'mine' };
const EVENT_FROM = { class: '학급', school: '학교', holiday: '휴일', mine: '내 일정' };
const SEX_TO = { 남: 'm', 여: 'f' };
const SEX_FROM = { m: '남', f: '여' };

export function cloudDocId(id) {
    const text = String(id || '');
    return /^[A-Za-z0-9_-]{1,40}$/.test(text) ? text : '';
}

function sourceOf(value) {
    if (value === 'legacy' || value === 'legacy-conflict') return 'legacy';
    if (value === 'file') return 'file';
    if (value === 'demo') return '';
    return 'app';
}

function stamps(names) {
    return names;
}

export function toCloudProfile(state) {
    const profile = state.profile || {};
    const body = {
        displayName: String(state.auth?.name || '').slice(0, 40),
        className: String(profile.className || '').slice(0, 30),
        schoolYear: Number(profile.schoolYear) || 2026,
        classSize: Number(profile.classSize || state.students?.length || 0),
        theme: ['system', 'light', 'dark'].includes(profile.theme) ? profile.theme : 'system',
        migrationVersion: 1,
    };
    if (profile.migratedAt) body.migratedAt = profile.migratedAt;
    return { body, stamps: profile.migratedAt ? ['migratedAt', 'updatedAt'] : ['updatedAt'] };
}

export function fromCloudProfile(data = {}) {
    return {
        className: String(data.className || '').slice(0, 30),
        schoolYear: Number(data.schoolYear) || 2026,
        classSize: Number(data.classSize) || 0,
        theme: ['system', 'light', 'dark'].includes(data.theme) ? data.theme : '',
    };
}

export function toCloudRow(collection, row) {
    if (!row || row.source === 'demo') return null;
    // 학생 메모만 민감하면 이름·번호는 올리고 메모만 빼 둡니다.
    if (collection === 'students') return toStudent(row);
    if (isSensitiveText(row.text, row.tags) || isSensitiveText(row.title) || isSensitiveText(row.note) || isSensitiveText(row.memo) || isSensitiveText(row.raw)) {
        return null;
    }
    if (collection === 'attendance') return toAttendance(row);
    if (collection === 'records') return toRecord(row);
    if (collection === 'events') return toEvent(row);
    if (collection === 'todos') return toTodo(row);
    if (collection === 'notes') return toNote(row);
    if (collection === 'notices') return toNotice(row);
    if (collection === 'legacy') return toLegacy(row);
    if (collection === 'timetable') return toTable(row);
    if (collection === 'inbox') return toInbox(row);
    return null;
}

function toStudent(row) {
    const id = cloudDocId(row.id);
    if (!id || !(row.no >= 1 && row.no <= 50) || !String(row.name || '').trim()) return null;
    const body = { no: Number(row.no), name: String(row.name).trim().slice(0, 20), active: row.active !== false };
    if (SEX_TO[row.sex]) body.sex = SEX_TO[row.sex];
    if (/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(row.birthday || '')) body.birthday = row.birthday;
    const clear = [];
    if (row.memo && !isSensitiveText(row.memo)) body.memo = String(row.memo).slice(0, 200);
    else if (isSensitiveText(row.memo)) clear.push('memo');
    return { id, body, stamps: stamps(['updatedAt']), clear };
}

function toAttendance(row) {
    const sid = cloudDocId(row.sid);
    const status = STATUS_TO[row.status];
    if (!sid || !status || !/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')) return null;
    const id = `${row.date}_${sid}`;
    const body = { date: row.date, sid, status };
    if (REASON_TO[row.reason]) body.reason = REASON_TO[row.reason];
    if (row.period >= 1 && row.period <= 8) body.period = Number(row.period);
    if (typeof row.paper === 'boolean') body.paper = row.paper;
    if (row.note) body.note = String(row.note).slice(0, 100);
    return { id, body, stamps: stamps(['updatedAt']) };
}

function toRecord(row) {
    const id = cloudDocId(row.id);
    const kind = RECORD_TO[row.kind];
    const source = sourceOf(row.source);
    if (!id || !kind || !source || !row.date || !String(row.text || '').trim()) return null;
    const body = { date: row.date, kind, text: String(row.text).slice(0, 2000), source };
    const sid = cloudDocId(row.sid);
    if (sid) body.sid = sid;
    if (Array.isArray(row.tags) && row.tags.length) body.tags = row.tags.map((tag) => String(tag).slice(0, 12)).slice(0, 10);
    if (typeof row.neis === 'boolean') body.neis = row.neis;
    if (row.follow) body.follow = row.follow;
    if (row.minutes >= 0 && row.minutes <= 600) body.minutes = Number(row.minutes);
    return { id, body, stamps: stamps(['updatedAt']) };
}

function toEvent(row) {
    const id = cloudDocId(row.id);
    const source = sourceOf(row.source);
    if (!id || !source || !row.date || !String(row.title || '').trim()) return null;
    const body = {
        date: row.date,
        title: String(row.title).slice(0, 60),
        kind: EVENT_TO[row.kind] || 'class',
        source,
    };
    if (row.end && row.end >= row.date) body.end = row.end;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time || '')) body.time = row.time;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(row.endTime || '')) body.endTime = row.endTime;
    if (row.memo) body.memo = String(row.memo).slice(0, 300);
    return { id, body, stamps: stamps(['updatedAt']) };
}

/** 규칙이 끝 시각을 아직 모르면 그 칸을 빼고 메모에 끝 시각을 붙입니다. */
export function eventBodyWithoutEndTime(body) {
    if (!body || !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.endTime || '')) return null;
    const next = { ...body };
    const end = next.endTime;
    delete next.endTime;
    const memo = String(next.memo || '');
    if (!memo.includes(end)) {
        next.memo = (memo ? `${memo} ${end}까지` : `${end}까지`).slice(0, 300);
    }
    return next;
}

function toTodo(row) {
    const id = cloudDocId(row.id);
    const source = sourceOf(row.source);
    if (!id || !source || !String(row.title || '').trim()) return null;
    const body = { title: String(row.title).slice(0, 100), done: Boolean(row.done), source };
    if (row.due) body.due = row.due;
    if (row.got != null) body.got = Number(row.got);
    if (row.of != null) body.of = Number(row.of);
    if (row.order != null) body.order = Number(row.order);
    return { id, body, stamps: row.done ? stamps(['updatedAt', 'doneAt']) : stamps(['updatedAt']) };
}

function toNote(row) {
    const id = cloudDocId(row.id);
    const source = sourceOf(row.source);
    if (!id || !source || !String(row.text || '').trim()) return null;
    const body = { text: String(row.text).slice(0, 2000), source };
    if (row.date) body.date = row.date;
    if (Array.isArray(row.tags) && row.tags.length) body.tags = row.tags.slice(0, 10);
    if (typeof row.pinned === 'boolean') body.pinned = row.pinned;
    return { id, body, stamps: stamps(['updatedAt']) };
}

function toNotice(row) {
    const id = /^\d{4}-\d{2}-\d{2}$/.test(row.id || '') ? row.id : (/^\d{4}-\d{2}-\d{2}$/.test(row.date || '') ? row.date : '');
    if (!id) return null;
    return { id, body: { text: String(row.text || '').slice(0, 2000) }, stamps: stamps(['updatedAt']) };
}

function toLegacy(row) {
    let id = row.id === 'praiseBoard' ? 'board-praise' : String(row.id || '');
    if (!/^(p[0-9]{1,3}|list-[A-Za-z]{1,30}|board-[A-Za-z]{1,30})$/.test(id)) return null;
    const raw = typeof row.raw === 'string' ? row.raw : JSON.stringify(row.raw ?? {});
    if (raw.length < 2 || raw.length > 200000 || isSensitiveText(raw)) return null;
    const body = { kind: String(row.kind || 'page').slice(0, 30), raw };
    if (row.title) body.title = String(row.title).slice(0, 60);
    return { id, body, stamps: stamps(['at']) };
}

function toInbox(row) {
    const id = cloudDocId(row.id);
    const source = sourceOf(row.source);
    const title = String(row.title || '').trim();
    if (!id || !source || !title) return null;
    const body = {
        title: title.slice(0, 100),
        kind: row.kind === '일정' ? 'event' : 'todo',
        source,
    };
    if (/^\d{4}-\d{2}-\d{2}$/.test(row.date || '')) body.date = row.date;
    if (body.date && row.end && row.end >= body.date) body.end = row.end;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time || '')) body.time = row.time;
    if (/^([01]\d|2[0-3]):[0-5]\d$/.test(row.endTime || '')) body.endTime = row.endTime;
    if (EVENT_TO[row.eventKind]) body.eventKind = EVENT_TO[row.eventKind];
    const memoBits = [row.memo];
    if (row.period) {
        const label = row.periodEnd ? `${row.period}~${row.periodEnd}교시` : `${row.period}교시`;
        if (!String(row.memo || '').includes(label)) memoBits.push(label);
    }
    const memo = memoBits.filter(Boolean).join(' · ').slice(0, 300);
    if (memo) body.memo = memo;
    if (row.warning) body.warning = String(row.warning).slice(0, 120);
    return { id, body, stamps: stamps(['updatedAt']) };
}

function toTable(row) {
    const id = row.id;
    if (!(id === 'mon' || id === 'tue' || id === 'wed' || id === 'thu' || id === 'fri' || /^\d{4}-\d{2}-\d{2}$/.test(id || ''))) return null;
    const body = {};
    for (let period = 1; period <= 10; period += 1) {
        for (const key of [`p${period}`, `s${period}`]) {
            if (!row[key]) continue;
            const value = String(row[key]).slice(0, 20);
            /* 9·10교시(그날만 고친 방과후 등)는 규칙처럼 민감 낱말을 빼고 올립니다. */
            if (period >= 9 && isSensitiveText(value)) continue;
            body[key] = value;
        }
    }
    if (!Object.keys(body).length) return null;
    return { id, body, stamps: stamps(['updatedAt']) };
}

export function fromCloudRow(collection, id, data = {}) {
    if (collection === 'students') {
        return {
            id,
            no: Number(data.no),
            name: data.name || '',
            sex: SEX_FROM[data.sex] || '',
            birthday: data.birthday || '',
            active: data.active !== false,
            memo: data.memo || '',
            source: 'app',
        };
    }
    if (collection === 'attendance') {
        if (!STATUS_FROM[data.status]) return null;
        return {
            id,
            date: data.date,
            sid: data.sid,
            status: STATUS_FROM[data.status],
            reason: REASON_FROM[data.reason] || '',
            period: data.period || '',
            paper: Boolean(data.paper),
            note: data.note || '',
            source: 'app',
        };
    }
    if (collection === 'records') {
        return {
            id,
            date: data.date,
            kind: RECORD_FROM[data.kind] || '관찰',
            sid: data.sid || '',
            text: data.text || '',
            tags: data.tags || [],
            neis: Boolean(data.neis),
            follow: data.follow || '',
            minutes: data.minutes,
            source: data.source === 'legacy' ? 'legacy' : 'app',
        };
    }
    if (collection === 'events') {
        return {
            id,
            date: data.date,
            end: data.end || '',
            time: data.time || '',
            endTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(data.endTime || '') ? data.endTime : '',
            title: data.title || '',
            kind: EVENT_FROM[data.kind] || '학급',
            memo: data.memo || '',
            source: data.source === 'legacy' ? 'legacy' : 'app',
        };
    }
    if (collection === 'todos') {
        return {
            id,
            title: data.title || '',
            done: Boolean(data.done),
            due: data.due || '',
            got: data.got,
            of: data.of,
            order: data.order,
            source: data.source === 'legacy' ? 'legacy' : 'app',
        };
    }
    if (collection === 'notes') {
        return {
            id,
            text: data.text || '',
            date: data.date || '',
            tags: data.tags || [],
            pinned: Boolean(data.pinned),
            source: data.source === 'legacy' ? 'legacy' : 'app',
        };
    }
    if (collection === 'notices') {
        return { id, date: id, text: data.text || '', source: 'app' };
    }
    if (collection === 'legacy') {
        let raw = data.raw;
        try { raw = JSON.parse(data.raw); } catch { /* 글 그대로 */ }
        return { id: id === 'board-praise' ? 'praiseBoard' : id, kind: data.kind || 'page', title: data.title || '', raw, source: 'legacy' };
    }
    if (collection === 'inbox') {
        return {
            id,
            kind: data.kind === 'event' ? '일정' : '할 일',
            title: data.title || '',
            date: data.date || '',
            end: data.end || '',
            time: data.time || '',
            endTime: /^([01]\d|2[0-3]):[0-5]\d$/.test(data.endTime || '') ? data.endTime : '',
            eventKind: EVENT_FROM[data.eventKind] || '',
            memo: data.memo || '',
            warning: data.warning || '',
            source: data.source === 'legacy' ? 'legacy' : (data.source === 'file' ? 'file' : 'app'),
        };
    }
    if (collection === 'timetable') {
        const body = {};
        for (let period = 1; period <= 10; period += 1) {
            if (data[`p${period}`]) body[`p${period}`] = data[`p${period}`];
            if (data[`s${period}`]) body[`s${period}`] = data[`s${period}`];
        }
        return body;
    }
    return null;
}

/** 여러 기기(웹·태블릿·휴대폰)가 같이 쓰는 설정 한 문서: users/{uid}/settings/device.
    9·10교시 과목, 교시 수·길이·잠금, 출퇴근 시각, 1~8교시 시작 시각, 그날 고친 날 표시, 학사일정.
    오늘 조퇴 시각은 그 기기 그날만의 값이라 올리지 않습니다. at 은 마지막으로 고친 시각(ms)이고, 더 늦은 쪽이 이깁니다. */
const HM = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const YMD = /^20[2-9][0-9]-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/;
const SUBJECT_KEY = /^[ps](9|10)$/;

/* 9·10교시 과목: 이 기기는 { mon: { p9 } } 모양, 클라우드에는 'mon-p9=방과후|…' 글자 하나로 둡니다(규칙 계산을 줄이려고). 둘 다 읽습니다. */
function flatExtra(extra = {}) {
    const out = {};
    for (const [day, row] of Object.entries(cleanExtra(extra))) for (const [key, value] of Object.entries(row)) out[`${day}-${key}`] = value;
    return out;
}

function cleanExtra(extra = {}) {
    const out = {};
    const nested = {};
    /* 클라우드 모양 'mon-p9=방과후|tue-p10=보충' 도 읽습니다. */
    if (typeof extra === 'string') extra = Object.fromEntries(extra.split('|').map((item) => item.split('=')).filter((kv) => kv.length === 2));
    for (const [key, value] of Object.entries(extra && typeof extra === 'object' ? extra : {})) {
        const m = /^(mon|tue|wed|thu|fri)-([ps](?:9|10))$/.exec(key);
        if (m) (nested[m[1]] ||= {})[m[2]] = value;
        else if (value && typeof value === 'object') nested[key] = { ...(nested[key] || {}), ...value };
    }
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri']) {
        const row = nested[day];
        if (!row || typeof row !== 'object') continue;
        const clean = {};
        for (const [key, value] of Object.entries(row)) {
            if (SUBJECT_KEY.test(key) && typeof value === 'string' && value.length <= 20 && !isSensitiveText(value)) clean[key] = value;
        }
        if (Object.keys(clean).length) out[day] = clean;
    }
    return out;
}

/** 설정 칸(무리)마다 고친 시각. 한 기기가 학사일정을, 다른 기기가 9교시를 고쳐도 둘 다 남도록 칸 단위로 합칩니다. */
export const SETTING_PARTS = ['period', 'extra', 'periodStarts', 'ttEdited', 'academic'];
const PERIOD_KEYS = ['level', 'count', 'lengths', 'extraStarts', 'locks', 'cellLocks', 'workStart', 'workEnd'];
const ACADEMIC_YEAR = /^20(2[4-9]|3[0-5])$/;
const AT_MAX = 4102444800000;
const atNum = (v) => (Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= AT_MAX ? Number(v) : 0);

export function localSettingAts(profile = {}, local = {}) {
    const legacy = atNum(profile.settingsAt);
    const legacyLocal = atNum(local.syncAt);
    const p = profile.settingsAts || {};
    const l = local.syncAts || {};
    return {
        period: atNum(l.period ?? legacyLocal),
        extra: atNum(l.extra ?? legacyLocal),
        periodStarts: atNum(p.periodStarts ?? legacy),
        ttEdited: atNum(p.ttEdited ?? legacy),
        academic: atNum(p.academic ?? legacy),
    };
}

function cleanSettingAcademic(academic = {}) {
    const out = {};
    const years = Object.keys(academic || {}).filter((year) => ACADEMIC_YEAR.test(year)).sort().slice(-4);
    for (const year of years) {
        const row = academic[year];
        if (!row || typeof row !== 'object') continue;
        const clean = {};
        for (const key of ['firstStart', 'firstEnd', 'secondStart', 'secondEnd']) if (YMD.test(row[key] || '')) clean[key] = row[key];
        const off = (row.offDays || []).filter((v) => YMD.test(v)).slice(0, 40);
        if (off.length) clean.offDays = off;
        if (Object.keys(clean).length) out[year] = clean;
    }
    return out;
}

/* 클라우드에는 숫자 목록을 '45,45,40' 글자로 둡니다(규칙이 한 번에 검사). 받을 때는 글자·목록 모두 읽습니다. */
function csvList(v) {
    if (typeof v === 'string') return v ? v.split(',').map(Number) : [];
    return Array.isArray(v) ? v.map(Number) : [];
}
const toCsv = (list) => list.join(',');

function cleanPeriodPart(local = {}) {
    return {
        level: ['초', '중', '고'].includes(local.level) ? local.level : '초',
        count: Number.isInteger(local.count) && local.count >= 1 && local.count <= 10 ? local.count : 6,
        lengths: csvList(local.lengths).slice(0, 10).map((n) => (Number.isInteger(n) && n >= 0 && n <= 120 ? n : 0)),
        extraStarts: (local.extraStarts || []).filter((v) => HM.test(v)).slice(0, 2),
        locks: csvList(local.locks).filter((n) => Number.isInteger(n) && n >= 1 && n <= 10).slice(0, 10),
        cellLocks: (typeof local.cellLocks === 'string' ? (local.cellLocks ? local.cellLocks.split(',') : []) : (local.cellLocks || [])).filter((v) => /^(mon|tue|wed|thu|fri)-([1-9]|10)$/.test(v)).slice(0, 50),
        workStart: HM.test(local.workStart || '') ? local.workStart : '',
        workEnd: HM.test(local.workEnd || '') ? local.workEnd : '',
    };
}

function cloudPeriodLocal(local) {
    const part = cleanPeriodPart(local);
    const extra = Object.entries(flatExtra(local.extra)).map(([k, v]) => `${k}=${v}`).join('|');
    return { ...part, lengths: toCsv(part.lengths), locks: toCsv(part.locks), cellLocks: part.cellLocks.join(','), extra };
}

export function toCloudSettings(state, local = {}) {
    const profile = state?.profile || {};
    const ats = localSettingAts(profile, local);
    const body = {
        at: Math.max(...SETTING_PARTS.map((part) => ats[part])),
        ats,
        periodLocal: cloudPeriodLocal(local),
        periodStarts: (profile.periodStarts || []).filter((v) => HM.test(v)).slice(0, 8),
        ttEdited: (profile.ttEdited || []).filter((v) => YMD.test(v)).slice(-400),
        academic: cleanSettingAcademic(profile.academic),
    };
    return { body, stamps: ['updatedAt'] };
}

export function fromCloudSettings(data = {}) {
    if (!data || typeof data !== 'object' || !(atNum(data.at) > 0)) return null;
    const at = atNum(data.at);
    const local = data.periodLocal && typeof data.periodLocal === 'object' ? data.periodLocal : {};
    const ats = {};
    /* 칸별 시각이 없는 예전 문서는 문서 시각을 모든 칸에 씁니다. */
    for (const part of SETTING_PARTS) ats[part] = data.ats && typeof data.ats === 'object' ? atNum(data.ats[part]) : at;
    return {
        at,
        ats,
        periodLocal: { ...cleanPeriodPart(local), extra: cleanExtra(local.extra) },
        periodStarts: Array.isArray(data.periodStarts) ? data.periodStarts.filter((v) => HM.test(v)).slice(0, 8) : [],
        ttEdited: Array.isArray(data.ttEdited) ? data.ttEdited.filter((v) => YMD.test(v)).slice(-400) : [],
        academic: cleanSettingAcademic(data.academic && typeof data.academic === 'object' ? data.academic : {}),
    };
}

/** 이 기기 설정(mine)과 클라우드 설정(theirs)을 칸마다 더 늦게 고친 쪽으로 합칩니다. 같은 시각이면 이 기기 쪽. */
export function mergeSettings(mine, theirs) {
    if (!theirs) return mine;
    if (!mine) return theirs;
    const out = { ...mine, ats: { ...mine.ats }, periodLocal: { ...mine.periodLocal } };
    for (const part of SETTING_PARTS) {
        if (!((theirs.ats?.[part] || 0) > (mine.ats?.[part] || 0))) continue;
        out.ats[part] = theirs.ats[part];
        if (part === 'period') for (const key of PERIOD_KEYS) out.periodLocal[key] = theirs.periodLocal[key];
        else if (part === 'extra') out.periodLocal.extra = theirs.periodLocal.extra;
        else out[part] = theirs[part];
    }
    out.at = Math.max(...SETTING_PARTS.map((part) => out.ats[part] || 0));
    out.periodLocal = cloudPeriodLocal(out.periodLocal);
    return out;
}

export { PERIOD_KEYS };
