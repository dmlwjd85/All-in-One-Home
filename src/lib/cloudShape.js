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
    if (row.memo) body.memo = String(row.memo).slice(0, 300);
    return { id, body, stamps: stamps(['updatedAt']) };
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

function toTable(row) {
    const id = row.id;
    if (!(id === 'mon' || id === 'tue' || id === 'wed' || id === 'thu' || id === 'fri' || /^\d{4}-\d{2}-\d{2}$/.test(id || ''))) return null;
    const body = {};
    for (let period = 1; period <= 8; period += 1) {
        if (row[`p${period}`]) body[`p${period}`] = String(row[`p${period}`]).slice(0, 20);
        if (row[`s${period}`]) body[`s${period}`] = String(row[`s${period}`]).slice(0, 20);
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
    if (collection === 'timetable') {
        const body = {};
        for (let period = 1; period <= 8; period += 1) {
            if (data[`p${period}`]) body[`p${period}`] = data[`p${period}`];
            if (data[`s${period}`]) body[`s${period}`] = data[`s${period}`];
        }
        return body;
    }
    return null;
}
