import { isValidYmd, seoulYmd } from './date.js';
import { detectDate } from './parse.js';
import { isSensitiveText } from './sensitive.js';

/** 예전 앱 localStorage 이름 → 백업 파일 키. 새 앱은 이 키를 읽기만 합니다. */
export const LEGACY_LISTS = {
    ssugeokInbox: 'inbox',
    studentNotes: 'studentNotes',
    counselNotes: 'counselNotes',
    teacherPlans: 'plans',
    teacherTodos: 'todos',
    teacherAttend: 'attendance',
    classRoster: 'roster',
    ledgerTx: 'ledger',
    ledgerBudgets: 'budgets',
    teacherLessons: 'lessons',
    teacherMeets: 'meets',
    teacherContacts: 'contacts',
    teacherTimetable: 'timetable',
    familyDiary: 'diary',
    ddayCards: 'ddayCards',
    submissionSheets: 'submissionSheets',
};

const ARCHIVE_LISTS = new Set(['ledgerTx', 'ledgerBudgets', 'teacherLessons', 'teacherMeets', 'familyDiary', 'teacherTimetable']);
const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const AREA = { 행: '행동', 교: '교우', 창: '창체' };

function filled(value) {
    if (value === true) return true;
    if (value == null || value === false) return false;
    if (typeof value === 'number') return value !== 0;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return false;
}

function pad(n) {
    return String(n).padStart(2, '0');
}

function birthdayOf(value) {
    const s = String(value || '').trim();
    const full = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (full) return `${pad(full[2])}-${pad(full[3])}`;
    const md = s.match(/^(\d{1,2})\D+(\d{1,2})$/);
    if (!md) return '';
    const month = Number(md[1]);
    const day = Number(md[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return '';
    return `${pad(month)}-${pad(day)}`;
}

function asDate(value, fallback) {
    const s = String(value || '').trim();
    if (isValidYmd(s)) return s;
    return detectDate(s) || fallback;
}

function isLocalPage(page) {
    if (page >= 19 && page <= 22) return true;
    if (page === 155 || page === 156 || page === 157 || page === 158) return true;
    if (page >= 323 && page <= 334) return true;
    return false;
}

function cardNo(page) {
    if (page < 159 || page > 221 || (page - 157) % 2 !== 0) return 0;
    return (page - 157) / 2;
}

function whoNo(page) {
    if (page < 160 || page > 222 || (page - 158) % 2 !== 0) return 0;
    return (page - 158) / 2;
}

function monthOfPage(page) {
    if (page < 34 || page > 45) return null;
    const abs = 2026 * 12 + 2 + (page - 34);
    return { year: Math.floor(abs / 12), month: (abs % 12) + 1 };
}

export function storageFromMap(map) {
    const keys = Object.keys(map);
    return {
        length: keys.length,
        key: (index) => keys[index] || null,
        getItem: (name) => (Object.prototype.hasOwnProperty.call(map, name) ? map[name] : null),
    };
}

export function readLegacyStorage(storage) {
    const pages = {};
    const lists = {};
    let sensitive = [];
    let praise = {};
    const extra = {};
    for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i);
        if (!key || !key.startsWith('homenote_') || key === 'homenote_guest') continue;
        const raw = storage.getItem(key);
        let data = raw;
        try {
            data = raw ? JSON.parse(raw) : null;
        } catch {
            data = raw;
        }
        const page = key.match(/^homenote_v2_notebookFields_p(\d+)$/);
        if (page) {
            pages[Number(page[1])] = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
            continue;
        }
        if (key === 'homenote_v2_ssugeokSensitive') {
            sensitive = Array.isArray(data) ? data : [];
            continue;
        }
        if (key === 'homenote_v2_praiseBoard') {
            praise = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
            continue;
        }
        const listName = key.replace(/^homenote_v2_/, '');
        if (LEGACY_LISTS[listName] && Array.isArray(data)) {
            lists[listName] = data;
            continue;
        }
        extra[key] = data;
    }
    return { pages, lists, sensitive, praise, extra };
}

export function buildRawBackup(bag, at) {
    const payload = {
        exportedAt: at,
        ssugeokSensitive: bag.sensitive || [],
        praiseBoard: bag.praise || {},
        notebookFields: {},
    };
    for (const [name, exportKey] of Object.entries(LEGACY_LISTS)) {
        payload[exportKey] = bag.lists?.[name] || [];
    }
    for (const [page, fields] of Object.entries(bag.pages || {})) payload.notebookFields[page] = fields;
    return {
        formatNote: '예전 교무수첩 원본',
        exportedAt: at,
        payload,
        extra: bag.extra || {},
    };
}

function mergeItems(local = [], cloud = [], conflicts, name) {
    const map = new Map();
    const out = [];
    for (const item of local) {
        if (!item || item.id == null) continue;
        map.set(String(item.id), item);
        out.push(item);
    }
    for (const item of cloud) {
        if (!item || item.id == null) continue;
        const prev = map.get(String(item.id));
        if (!prev) {
            map.set(String(item.id), item);
            out.push(item);
            continue;
        }
        if (JSON.stringify(prev) !== JSON.stringify(item)) {
            const copy = { ...item, id: `${item.id}-cloud` };
            out.push(copy);
            conflicts.push(`${name}:${item.id}`);
        }
    }
    return out;
}

export function mergeBags(local, cloud) {
    const conflicts = [];
    const pages = {};
    for (const [page, fields] of Object.entries(local?.pages || {})) pages[page] = { ...fields };
    for (const [page, fields] of Object.entries(cloud?.pages || {})) {
        const base = { ...(pages[page] || {}) };
        for (const [key, value] of Object.entries(fields || {})) {
            if (!Object.prototype.hasOwnProperty.call(base, key)) base[key] = value;
            else if (JSON.stringify(base[key]) !== JSON.stringify(value)) {
                base[`${key}__다른곳`] = value;
                conflicts.push(`p${page}.${key}`);
            }
        }
        pages[page] = base;
    }
    const lists = {};
    const names = new Set([...Object.keys(local?.lists || {}), ...Object.keys(cloud?.lists || {})]);
    for (const name of names) {
        lists[name] = mergeItems(local?.lists?.[name], cloud?.lists?.[name], conflicts, name);
    }
    const sensitive = [...(local?.sensitive || [])];
    for (const item of cloud?.sensitive || []) {
        if (!sensitive.some((row) => JSON.stringify(row) === JSON.stringify(item))) sensitive.push(item);
    }
    return {
        bag: {
            pages,
            lists,
            sensitive,
            praise: { ...(cloud?.praise || {}), ...(local?.praise || {}) },
            extra: { ...(cloud?.extra || {}), ...(local?.extra || {}) },
        },
        conflicts,
    };
}

function emptyPlan(at) {
    return {
        at,
        students: [],
        records: [],
        attendance: [],
        events: [],
        todos: [],
        notes: [],
        notices: [],
        timetable: {},
        legacyPages: [],
        local: { records: [], notes: [], events: [], todos: [], notices: [], contacts: [], pages: [] },
        counts: { original: 0, moved: 0, archived: 0, localOnly: 0 },
        conflicts: [],
    };
}

export function planMigration(bag, options = {}) {
    const now = options.now || new Date();
    const at = options.at || now.toISOString();
    const today = seoulYmd(now);
    const titles = options.titles || {};
    const merged = options.cloudBag ? mergeBags(bag, options.cloudBag) : { bag, conflicts: [] };
    const source = merged.bag;
    const plan = emptyPlan(at);
    plan.conflicts = merged.conflicts;
    plan.backup = buildRawBackup(source, at);
    const bump = (kind) => {
        plan.counts.original += 1;
        plan.counts[kind] += 1;
    };
    const students = new Map();
    const timetableChoice = { page: 0, table: null };
    const archivedFields = new Map();

    const ensure = (no, patch = {}) => {
        const prev = students.get(no) || {
            id: `s${no}`, no, name: '', sex: '', birthday: '', active: true, memo: '', source: 'legacy',
        };
        const next = { ...prev, ...patch, id: `s${no}`, no: Number(no), source: 'legacy' };
        students.set(no, next);
        return next;
    };
    const sidByName = (name) => {
        const found = [...students.values()].find((row) => row.name && row.name === name);
        return found?.id || '';
    };

    const addRecord = (row, local) => {
        const rec = {
            id: row.id,
            date: row.date || today,
            kind: row.kind,
            sid: row.sid || '',
            text: String(row.text || '').slice(0, 2000),
            tags: (row.tags || []).slice(0, 10),
            neis: Boolean(row.neis),
            source: row.source || 'legacy',
            at,
        };
        if (row.follow) rec.follow = row.follow;
        if (row.minutes) rec.minutes = row.minutes;
        (local ? plan.local.records : plan.records).push(rec);
    };
    const addTodo = (row, local) => {
        const todo = {
            id: row.id,
            title: String(row.title || '').slice(0, 100),
            done: Boolean(row.done),
            source: 'legacy',
            at,
        };
        if (row.due) todo.due = row.due;
        if (row.got != null) todo.got = row.got;
        if (row.of != null) todo.of = row.of;
        if (row.pendingNos) todo.pendingNos = row.pendingNos;
        (local ? plan.local.todos : plan.todos).push(todo);
    };
    const addNote = (row, local) => {
        (local ? plan.local.notes : plan.notes).push({
            id: row.id,
            text: String(row.text || '').slice(0, 2000),
            date: row.date || today,
            pinned: Boolean(row.pinned),
            source: 'legacy',
            at,
        });
    };
    const addEvent = (row, local) => {
        (local ? plan.local.events : plan.events).push({
            id: row.id,
            date: row.date,
            title: String(row.title || '').slice(0, 60),
            kind: row.kind || '학급',
            source: 'legacy',
            at,
        });
    };
    const keepArchive = (page, key, value) => {
        if (!archivedFields.has(page)) archivedFields.set(page, {});
        archivedFields.get(page)[key] = value;
    };
    const keepLocal = (page, key, value) => {
        const id = `p${page}`;
        let found = plan.local.pages.find((row) => row.id === id);
        if (!found) {
            found = { id, kind: 'page', title: titles[page] || `${page}쪽`, raw: {}, at };
            plan.local.pages.push(found);
        }
        found.raw[key] = value;
    };

    const consumeRows = (page, fields, indexes, build) => {
        const used = new Set();
        for (const i of indexes) {
            const built = build(i, fields);
            const cells = built.filter((cell) => cell.key);
            const meta = built.find((cell) => cell.meta)?.meta;
            const present = cells.filter((cell) => filled(fields[cell.key]));
            if (!present.length) continue;
            present.forEach((cell) => used.add(cell.key));
            const text = String(cells.find((cell) => cell.role === 'text')?.value || '').trim();
            const sensitive = present.some((cell) => isSensitiveText(String(cell.value ?? '')));
            if (!text) {
                present.forEach((cell) => {
                    bump('archived');
                    keepArchive(page, cell.key, fields[cell.key]);
                });
                continue;
            }
            present.forEach(() => bump(sensitive ? 'localOnly' : 'moved'));
            if (sensitive) {
                present.forEach((cell) => keepLocal(page, cell.key, fields[cell.key]));
            }
            const made = meta;
            if (made?.record) addRecord({ ...made.record, text, id: made.record.id || `lg-p${page}-r${i}` }, sensitive);
            else if (made?.todo) addTodo({ ...made.todo, title: text, id: made.todo.id || `lg-p${page}-t${i}` }, sensitive);
            else if (made?.note) addNote({ ...made.note, text, id: made.note.id || `lg-p${page}-n${i}` }, sensitive);
            else addNote({ id: `lg-p${page}-n${i}`, text, date: today }, sensitive);
        }
        return used;
    };

    for (const [pageKey, fields] of Object.entries(source.pages || {})) {
        const page = Number(pageKey);
        const entries = Object.entries(fields || {}).filter(([, value]) => filled(value));
        if (!entries.length) continue;
        if (isLocalPage(page)) {
            entries.forEach(([key, value]) => {
                bump('localOnly');
                keepLocal(page, key, value);
            });
            continue;
        }

        const used = new Set();
        const studentCard = cardNo(page);
        const who = whoNo(page);
        if (page === 154) {
            for (let n = 1; n <= 50; n += 1) {
                if (filled(fields[`name${n}`])) {
                    bump('moved');
                    ensure(n, { name: String(fields[`name${n}`]).trim().slice(0, 20) });
                    used.add(`name${n}`);
                }
                if (filled(fields[`sex${n}`])) {
                    const sex = String(fields[`sex${n}`]).trim();
                    bump('moved');
                    if (sex === '남' || sex === '여') ensure(n, { sex });
                    used.add(`sex${n}`);
                }
                if (filled(fields[`birth${n}`])) {
                    bump('moved');
                    const birthday = birthdayOf(fields[`birth${n}`]);
                    if (birthday) ensure(n, { birthday });
                    used.add(`birth${n}`);
                }
                if (filled(fields[`note${n}`])) {
                    const note = String(fields[`note${n}`]).trim();
                    const local = isSensitiveText(note);
                    bump(local ? 'localOnly' : 'moved');
                    if (local) {
                        keepLocal(page, `note${n}`, note);
                        addRecord({ id: `lg-p154-note${n}`, kind: '관찰', sid: `s${n}`, text: note, tags: [] }, true);
                    } else ensure(n, { memo: note.slice(0, 200) });
                    used.add(`note${n}`);
                }
            }
        } else if (studentCard) {
            const no = studentCard;
            const direct = {
                name: (value) => ensure(no, { name: String(value).trim().slice(0, 20) }),
                sex: (value) => {
                    const sex = String(value).trim();
                    if (sex === '남' || sex === '여') ensure(no, { sex });
                },
                birth: (value) => {
                    const birthday = birthdayOf(value);
                    if (birthday) ensure(no, { birthday });
                },
            };
            for (const [key, apply] of Object.entries(direct)) {
                if (!filled(fields[key])) continue;
                bump('moved');
                apply(fields[key]);
                used.add(key);
            }
            if (filled(fields.note)) {
                const note = String(fields.note).trim();
                const local = isSensitiveText(note);
                bump(local ? 'localOnly' : 'moved');
                if (local) addRecord({ id: `lg-p${page}-note`, kind: '관찰', sid: `s${no}`, text: note }, true);
                else ensure(no, { memo: note.slice(0, 200) });
                used.add('note');
            }
            for (const [key, tag] of [['peer', '교우'], ['learn', '학습'], ['like', '좋아함'], ['plan', '지도계획']]) {
                if (!filled(fields[key])) continue;
                const text = String(fields[key]).trim();
                const local = isSensitiveText(text);
                bump(local ? 'localOnly' : 'moved');
                addRecord({ id: `lg-p${page}-${key}`, kind: '관찰', sid: `s${no}`, text, tags: [tag], date: today }, local);
                used.add(key);
            }
            for (const key of ['health', 'tel', 'tel1', 'tel2', 'phone', 'guard', 'addr', 'address', 'home', 'contact']) {
                if (!filled(fields[key])) continue;
                bump('localOnly');
                keepLocal(page, key, fields[key]);
                if (key === 'health') addRecord({ id: `lg-p${page}-health`, kind: '관찰', sid: `s${no}`, text: String(fields[key]), tags: [] }, true);
                else plan.local.contacts.push({ id: `lg-p${page}-${key}`, sid: `s${no}`, label: key, value: String(fields[key]), source: 'legacy', at });
                used.add(key);
            }
        } else if (who) {
            const rowUsed = consumeRows(page, fields, Array.from({ length: 16 }, (_, i) => i), (i) => {
                const area = String(fields[`a${i}`] || '').trim();
                const tag = AREA[area] || (area ? area.slice(0, 12) : '');
                return [
                    { key: `d${i}`, value: fields[`d${i}`] },
                    { key: `a${i}`, value: fields[`a${i}`] },
                    { key: `t${i}`, role: 'text', value: fields[`t${i}`] },
                    { key: `n${i}`, value: fields[`n${i}`] },
                    {
                        meta: {
                            record: {
                                id: `lg-p${page}-r${i}`,
                                kind: '관찰',
                                sid: `s${who}`,
                                date: asDate(fields[`d${i}`], today),
                                tags: tag ? [tag] : [],
                                neis: fields[`n${i}`] === true || fields[`n${i}`] === 'true' || fields[`n${i}`] === '1',
                            },
                        },
                    },
                ];
            });
            rowUsed.forEach((key) => used.add(key));
        } else if ((page >= 257 && page <= 288) || (page >= 289 && page <= 320)) {
            const no = page >= 289 ? page - 288 : page - 256;
            const kind = page >= 289 ? '보호자' : '상담';
            const rowUsed = consumeRows(page, fields, Array.from({ length: 8 }, (_, i) => i), (i) => {
                const whoName = String(fields[`who${i}`] || '').trim();
                const text = String(fields[`t${i}`] || '').trim();
                return [
                    { key: `d${i}`, value: fields[`d${i}`] },
                    { key: `who${i}`, value: fields[`who${i}`] },
                    { key: `t${i}`, role: 'text', value: whoName ? `${whoName} ${text}`.trim() : text },
                    {
                        meta: {
                            record: {
                                id: `lg-p${page}-r${i}`,
                                kind,
                                sid: `s${no}`,
                                date: asDate(fields[`d${i}`], today),
                                tags: [],
                            },
                        },
                    },
                ];
            });
            rowUsed.forEach((key) => used.add(key));
        } else if (page >= 223 && page <= 230) {
            const rowUsed = consumeRows(page, fields, Array.from({ length: 20 }, (_, i) => i), (i) => {
                const no = Number(fields[`no${i}`]);
                const text = String(fields[`t${i}`] || '').trim();
                const date = asDate(fields[`d${i}`], today);
                const meta = no >= 1 && no <= 50
                    ? { record: { id: `lg-p${page}-r${i}`, kind: '관찰', sid: `s${no}`, date, tags: [] } }
                    : { note: { id: `lg-p${page}-n${i}`, date } };
                return [
                    { key: `d${i}`, value: fields[`d${i}`] },
                    { key: `no${i}`, value: fields[`no${i}`] },
                    { key: `t${i}`, role: 'text', value: text },
                    { key: `m${i}`, value: fields[`m${i}`] },
                    { meta },
                ];
            });
            rowUsed.forEach((key) => used.add(key));
        } else if (page === 141 || page === 143) {
            const table = { mon: {}, tue: {}, wed: {}, thu: {}, fri: {} };
            let any = false;
            for (let period = 1; period <= 8; period += 1) {
                for (let day = 0; day < 5; day += 1) {
                    const key = `t${period}_${day}`;
                    if (!filled(fields[key])) continue;
                    const text = String(fields[key]).trim();
                    const local = isSensitiveText(text);
                    bump(local ? 'localOnly' : 'moved');
                    used.add(key);
                    any = true;
                    if (!local) {
                        table[DAY_KEYS[day]][`p${period}`] = text.replace(/\s*전담\s*/g, ' ').trim();
                        if (String(fields[key]).includes('전담')) table[DAY_KEYS[day]][`s${period}`] = '전담';
                    } else keepLocal(page, key, text);
                }
            }
            if (any && (page === 141 || timetableChoice.page !== 141)) {
                timetableChoice.page = page;
                timetableChoice.table = table;
            }
        } else if (monthOfPage(page)) {
            const info = monthOfPage(page);
            for (const [key, value] of entries) {
                const day = key.match(/^d(\d{1,2})$/);
                if (!day) continue;
                const date = `${info.year}-${pad(info.month)}-${pad(day[1])}`;
                const text = String(value).trim();
                if (!isValidYmd(date) || !text) continue;
                const local = isSensitiveText(text);
                bump(local ? 'localOnly' : 'moved');
                addEvent({ id: `lg-p${page}-${key}`, date, title: text, kind: '학급' }, local);
                used.add(key);
            }
        } else if (page >= 404 && page <= 467) {
            for (const [key, value] of entries) {
                if (!/^(t|title|task|todo)\d+$/.test(key) || typeof value !== 'string') continue;
                const local = isSensitiveText(value);
                bump(local ? 'localOnly' : 'moved');
                addTodo({ id: `lg-p${page}-${key}`, title: value.trim(), done: false }, local);
                used.add(key);
            }
        }

        for (const [key, value] of entries) {
            if (used.has(key)) continue;
            if (isSensitiveText(typeof value === 'string' ? value : '')) {
                bump('localOnly');
                keepLocal(page, key, value);
                continue;
            }
            bump('archived');
            keepArchive(page, key, value);
        }
    }

    for (const [page, raw] of archivedFields) {
        plan.legacyPages.push({
            id: `p${page}`,
            kind: 'page',
            title: titles[page] || `${page}쪽`,
            raw,
            at,
        });
    }
    if (timetableChoice.table) plan.timetable = timetableChoice.table;

    const listItem = (name, item, index) => {
        const id = item?.id != null ? String(item.id) : String(index + 1);
        const text = String(item?.text || item?.title || item?.name || '').trim();
        if (name === 'classRoster') {
            bump('moved');
            const nameText = String(item?.name || '').trim().slice(0, 20);
            if (!nameText) return;
            const known = [...students.values()].find((row) => row.name === nameText);
            if (known) return;
            let no = Number(item.no);
            if (!(no >= 1 && no <= 50) || students.has(no)) {
                no = 1;
                while (students.has(no) && no <= 50) no += 1;
            }
            if (no <= 50) ensure(no, { name: nameText });
            return;
        }
        if (name === 'teacherContacts') {
            bump('localOnly');
            plan.local.contacts.push({
                id: `lg-list-${name}-${id}`,
                sid: '',
                label: String(item?.name || item?.label || '연락처'),
                value: JSON.stringify(item),
                source: 'legacy',
                at,
            });
            return;
        }
        if (ARCHIVE_LISTS.has(name)) {
            bump('archived');
            return;
        }
        const local = isSensitiveText(text) || isSensitiveText(JSON.stringify(item));
        bump(local ? 'localOnly' : 'moved');
        if (name === 'studentNotes' || name === 'counselNotes' || name === 'ssugeokInbox') {
            const studentName = String(item?.student || '').trim();
            const no = Number(item?.studentNo);
            const sid = no >= 1 && no <= 50 ? `s${no}` : sidByName(studentName);
            if (sid || name !== 'ssugeokInbox') {
                const kind = name === 'counselNotes' && item?.kind !== '누가' ? '상담' : '관찰';
                if (text) addRecord({ id: `lg-list-${name}-${id}`, kind, sid, text, date: asDate(item?.date, today), tags: item?.tags || [] }, local);
            } else if (text) addNote({ id: `lg-list-${name}-${id}`, text, date: asDate(item?.date || item?.detectedDate, today) }, local);
            return;
        }
        if (name === 'teacherAttend') {
            const status = String(item?.status || '');
            if (['결석', '지각', '조퇴', '결과'].includes(status) && !local) {
                const studentName = String(item?.student || '').trim();
                const no = Number(item?.no || item?.studentNo);
                const sid = no >= 1 && no <= 50 ? `s${no}` : sidByName(studentName);
                const date = asDate(item?.date, today);
                if (sid) {
                    plan.attendance.push({
                        id: `${date}_${sid}`,
                        date,
                        sid,
                        status,
                        reason: item?.reason || '',
                        note: String(item?.note || text).slice(0, 100),
                        source: 'legacy',
                        at,
                    });
                }
            } else if (local) {
                plan.local.notes.push({ id: `lg-list-${name}-${id}`, text: text || status, date: asDate(item?.date, today), source: 'legacy', at });
            }
            return;
        }
        if (name === 'teacherTodos' || name === 'ddayCards') {
            addTodo({
                id: `lg-list-${name}-${id}`,
                title: text || '할 일',
                done: Boolean(item?.done) || item?.status === 'done',
                due: asDate(item?.deadline || item?.date, '') || undefined,
            }, local);
            return;
        }
        if (name === 'submissionSheets') {
            const submitted = Array.isArray(item?.submitted) ? item.submitted.map(Number).filter((n) => n >= 1) : [];
            addTodo({
                id: `lg-list-${name}-${id}`,
                title: String(item?.title || '제출물').slice(0, 100),
                done: false,
                got: submitted.length,
                pendingNos: submitted,
            }, local);
            return;
        }
        if (name === 'teacherPlans') {
            if (text) addNote({ id: `lg-list-${name}-${id}`, text, date: asDate(item?.date, today) }, local);
        }
    };

    for (const [name, items] of Object.entries(source.lists || {})) {
        items.forEach((item, index) => {
            if (!filled(item)) return;
            listItem(name, item, index);
        });
        if (ARCHIVE_LISTS.has(name) && items.length) {
            plan.legacyPages.push({
                id: `list-${name}`,
                kind: 'list',
                title: name,
                raw: items,
                at,
            });
        }
    }

    for (const item of source.sensitive || []) {
        if (!filled(item)) continue;
        bump('localOnly');
        const text = String(item?.text || '').trim();
        if (text) addNote({ id: `lg-sensitive-${item.id || plan.local.notes.length + 1}`, text, date: today }, true);
    }
    const praiseKeys = Object.entries(source.praise || {}).filter(([, value]) => filled(value));
    if (praiseKeys.length) {
        praiseKeys.forEach(() => bump('archived'));
        plan.legacyPages.push({ id: 'praiseBoard', kind: 'record', title: '칭찬 스티커', raw: source.praise, at });
    }
    for (const [key, value] of Object.entries(source.extra || {})) {
        if (!filled(value)) continue;
        bump('archived');
        plan.legacyPages.push({ id: `extra-${key}`, kind: 'extra', title: key, raw: value, at });
    }

    plan.students = [...students.values()].sort((a, b) => a.no - b.no);
    const size = plan.students.reduce((max, row) => Math.max(max, row.no), 0);
    plan.todos = plan.todos.map((todo) => {
        if (!todo.pendingNos) return todo;
        const have = new Set(todo.pendingNos);
        const pending = [];
        for (let no = 1; no <= (size || todo.got || 0); no += 1) if (!have.has(no)) pending.push(no);
        const of = size || Math.max(todo.got || 0, ...todo.pendingNos, 0);
        return { ...todo, pendingNos: pending, of, got: Math.max(0, of - pending.length) };
    });
    const sum = plan.counts.moved + plan.counts.archived + plan.counts.localOnly;
    if (sum !== plan.counts.original) {
        throw new Error(`옮기기 개수가 맞지 않습니다. ${plan.counts.original}/${sum}`);
    }
    plan.summary = {
        students: plan.students.length,
        records: plan.records.length + plan.local.records.length,
        todos: plan.todos.length + plan.local.todos.length,
        events: plan.events.length + plan.local.events.length,
        attendance: plan.attendance.length,
        notes: plan.notes.length + plan.local.notes.length,
        legacyPages: plan.legacyPages.length + plan.local.pages.length,
        localOnly: plan.counts.localOnly,
    };
    return plan;
}
