import { createVault } from './idb.js';
import { DEFAULT_PERIODS } from './period.js';
import { buildDemo } from './demo.js';
import { parseNote, stripTokens } from './parse.js';
import { isSensitiveText } from './sensitive.js';
import { buildExport, downloadJson, splitSensitive, validateBackupText, oldBackupToBag } from './backup.js';
import { planMigration, readLegacyStorage } from './migrate.js';
import { pushUserData } from './cloud.js';
import { seoulParts, seoulYmd } from './date.js';
import { parseRoster } from './roster.js';

const mainVault = createVault('ssug-gyomu');
const localVault = createVault('ssug-gyomu-local');
const THEME_KEY = 'ssug-gyomu-theme';
const TIP_KEY = 'ssug-gyomu-tips';
const SHARED_KEY = 'ssug-gyomu-shared';

export function emptyState() {
    return {
        profile: {
            className: '',
            schoolYear: 2026,
            classSize: 0,
            periodStarts: [...DEFAULT_PERIODS],
            theme: 'system',
            sharedPc: false,
            started: false,
            guest: true,
            migratedAt: null,
            migration: null,
            demo: false,
            checkedDates: [],
            migrateLater: false,
        },
        students: [],
        attendance: [],
        records: [],
        events: [],
        todos: [],
        notes: [],
        notices: [],
        timetable: {},
        legacyPages: [],
        local: { records: [], notes: [], events: [], todos: [], notices: [], contacts: [], pages: [], backup: null },
        auth: null,
        tip: { hidden: [], seen: [], closes: {}, snooze: '' },
    };
}

let state = emptyState();
let undoStack = [];
const listeners = new Set();
let persistQueue = Promise.resolve();
let memoryOnly = false;

function emit() {
    const snap = snapshot();
    listeners.forEach((fn) => fn(snap));
}

export function snapshot() {
    return state;
}

export function subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

function mirrorTheme(theme) {
    try {
        localStorage.setItem(THEME_KEY, theme || 'system');
        localStorage.setItem(SHARED_KEY, state.profile.sharedPc ? '1' : '0');
        localStorage.setItem(TIP_KEY, JSON.stringify(state.tip));
    } catch {
        /* 저장이 막혀 있어도 화면은 동작합니다. */
    }
}

async function writeVaults(copy) {
    if (memoryOnly) return;
    const local = copy.local;
    const main = { ...copy, local: undefined, auth: null, tip: undefined };
    await mainVault.set('state', main);
    await localVault.set('state', local);
}

function persist() {
    const copy = structuredClone(state);
    persistQueue = persistQueue.then(() => writeVaults(copy)).catch(() => {});
    return persistQueue;
}

export async function update(recipe, { undoable = false } = {}) {
    if (undoable) undoStack = [...undoStack.slice(-4), structuredClone(state)];
    const next = recipe(structuredClone(state)) || state;
    state = next;
    mirrorTheme(state.profile.theme);
    emit();
    await persist();
    if (state.auth?.uid) {
        pushUserData(state.auth.uid, state, { memoryOnly: state.profile.sharedPc }).catch(() => {});
    }
}

export async function undo() {
    const prev = undoStack.pop();
    if (!prev) return false;
    state = prev;
    mirrorTheme(state.profile.theme);
    emit();
    await persist();
    return true;
}

export function legacyAvailable() {
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (key && key.startsWith('homenote_') && key !== 'homenote_guest') return true;
        }
    } catch {
        return false;
    }
    return false;
}

export async function boot(query = '') {
    const params = new URLSearchParams(query || (typeof location === 'undefined' ? '' : location.search));
    if (params.get('at')) {
        const { freezeClock } = await import('./date.js');
        freezeClock(params.get('at'));
    }
    let stored = null;
    let local = null;
    try {
        stored = await mainVault.get('state');
        local = await localVault.get('state');
    } catch {
        memoryOnly = true;
    }
    state = emptyState();
    if (stored && typeof stored === 'object') state = { ...state, ...stored, local: state.local };
    if (local && typeof local === 'object') state.local = { ...state.local, ...local };
    try {
        const tips = JSON.parse(localStorage.getItem(TIP_KEY) || 'null');
        if (tips) state.tip = { ...state.tip, ...tips };
        if (localStorage.getItem(SHARED_KEY) === '1') state.profile.sharedPc = true;
        const savedTheme = localStorage.getItem(THEME_KEY);
        if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') state.profile.theme = savedTheme;
    } catch {
        /* 팁 저장이 없어도 됩니다. */
    }
    if (!state.profile.started && params.get('demo') === '1' && !legacyAvailable()) {
        await loadDemo();
        return snapshot();
    }
    emit();
    return snapshot();
}

export async function loadDemo() {
    const demo = buildDemo(seoulParts());
    await update((draft) => ({
        ...draft,
        ...demo,
        profile: { ...draft.profile, ...demo.profile, theme: draft.profile.theme },
        tip: draft.tip,
        auth: draft.auth,
    }));
}

export async function beginGuest() {
    await update((draft) => {
        draft.profile.guest = true;
        draft.profile.started = draft.profile.started;
        return draft;
    });
}

export async function finishSetup({ className, rosterText, skip }) {
    const parsed = parseRoster(rosterText || '');
    await update((draft) => {
        draft.profile.started = true;
        draft.profile.guest = true;
        draft.profile.demo = false;
        if (className && className.trim()) draft.profile.className = className.trim().slice(0, 30);
        if (!skip && parsed.students.length) {
            draft.students = parsed.students.map((row) => ({
                id: `s${row.no}`,
                no: row.no,
                name: row.name,
                sex: row.sex || '',
                birthday: '',
                active: true,
                memo: '',
                source: 'app',
            }));
            draft.profile.classSize = parsed.students.length;
        }
        return draft;
    });
    return parsed;
}

function nid(prefix) {
    return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function put(list, row) {
    const index = list.findIndex((item) => item.id === row.id);
    if (index >= 0) list[index] = row;
    else list.unshift(row);
}

export async function saveQuick(input, now = new Date()) {
    const text = String(input.text || '').trim();
    if (!text) return { ok: false, message: '한 줄만 적어도 남길 수 있어요.' };
    const parsed = parseNote(text, now);
    const tags = [...new Set([...(input.tags || []), ...parsed.tags])].filter(Boolean).slice(0, 10);
    const sensitive = parsed.sensitive || isSensitiveText(text, tags);
    const no = parsed.studentNo || input.no || 0;
    const clock = seoulParts(now);
    const date = input.date || parsed.detectedDate || clock.ymd;
    let message = '남겼어요.';
    await update((draft) => {
        const student = draft.students.find((row) => row.no === Number(no));
        const sid = student?.id || '';
        const kind = input.kind || '메모';
        const base = { source: 'app', at: now.toISOString() };
        const local = sensitive;
        if (['관찰', '상담', '보호자', '칭찬'].includes(kind)) {
            const chosen = tags.length ? tags : (kind === '관찰' ? ['학습'] : kind === '상담' ? ['교우'] : kind === '보호자' ? ['전화'] : []);
            const row = {
                ...base,
                id: nid('rec'),
                date,
                kind,
                sid,
                text,
                tags: chosen,
                neis: input.neis != null ? Boolean(input.neis) : kind === '관찰' || kind === '칭찬',
            };
            if (input.follow || (kind === '상담' && parsed.detectedDate && text.includes('다시'))) row.follow = input.follow || parsed.detectedDate;
            put(local ? draft.local.records : draft.records, row);
            message = student ? `${student.name} 기록에 넣었어요.` : '기록에 넣었어요.';
        } else if (kind === '할 일') {
            const row = { ...base, id: nid('todo'), title: stripTokens(text) || text, done: false, due: parsed.detectedDate || input.due || '' };
            put(local ? draft.local.todos : draft.todos, row);
            message = '할 일에 넣었어요.';
        } else if (kind === '일정') {
            const row = { ...base, id: nid('event'), date, title: (stripTokens(text) || text).slice(0, 60), kind: '학급', memo: '' };
            put(local ? draft.local.events : draft.events, row);
            message = '일정에 넣었어요.';
        } else if (kind === '알림장') {
            const prev = (local ? draft.local.notices : draft.notices).find((item) => item.date === date);
            const row = { ...base, id: date, date, text: prev ? `${prev.text}\n${text}` : text };
            put(local ? draft.local.notices : draft.notices, row);
            message = '알림장에 넣었어요.';
        } else {
            put(local ? draft.local.notes : draft.notes, { ...base, id: nid('note'), text, date, pinned: false });
            message = '메모로 남겼어요.';
        }
        return draft;
    }, { undoable: true });
    if (sensitive) message = `이 내용은 이 기기에만 남겨 둘게요. ${message}`;
    return { ok: true, message };
}

const CYCLE = ['결석', '지각', '조퇴', '결과'];

export async function cycleAttendance(date, sid) {
    await update((draft) => {
        const id = `${date}_${sid}`;
        const index = draft.attendance.findIndex((row) => row.id === id);
        const current = index >= 0 ? draft.attendance[index].status : '';
        const next = CYCLE[(CYCLE.indexOf(current) + 1) % (CYCLE.length + 1)] || '';
        if (!next) {
            if (index >= 0) draft.attendance.splice(index, 1);
        } else if (index >= 0) draft.attendance[index] = { ...draft.attendance[index], status: next };
        else draft.attendance.unshift({ id, date, sid, status: next, reason: '', note: '', paper: false, source: 'app' });
        if (!draft.profile.checkedDates.includes(date)) draft.profile.checkedDates.push(date);
        return draft;
    }, { undoable: true });
}

export async function patchAttendance(date, sid, patch) {
    await update((draft) => {
        const id = `${date}_${sid}`;
        const index = draft.attendance.findIndex((row) => row.id === id);
        if (index < 0) return draft;
        draft.attendance[index] = { ...draft.attendance[index], ...patch };
        return draft;
    });
}

export async function markChecked(date, on) {
    await update((draft) => {
        const set = new Set(draft.profile.checkedDates);
        if (on) set.add(date);
        else set.delete(date);
        draft.profile.checkedDates = [...set];
        return draft;
    });
}

export async function toggleTodo(id) {
    await update((draft) => {
        const lists = [draft.todos, draft.local.todos];
        for (const list of lists) {
            const row = list.find((item) => item.id === id);
            if (row) row.done = !row.done;
        }
        return draft;
    }, { undoable: true });
}

export async function receiveOne(id, no) {
    await update((draft) => {
        const row = draft.todos.find((item) => item.id === id) || draft.local.todos.find((item) => item.id === id);
        if (!row?.pendingNos) return draft;
        row.pendingNos = row.pendingNos.filter((item) => item !== no);
        row.got = Math.max(0, (row.of || 0) - row.pendingNos.length);
        if (row.pendingNos.length === 0) row.done = true;
        return draft;
    });
}

export async function saveTextItem(bucket, row) {
    const sensitive = isSensitiveText(row.text || row.title || '', row.tags);
    await update((draft) => {
        const target = sensitive ? draft.local[bucket] : draft[bucket];
        put(target, { ...row, source: row.source || 'app' });
        return draft;
    }, { undoable: true });
    return { sensitive };
}

export async function removeItem(bucket, id) {
    await update((draft) => {
        draft[bucket] = (draft[bucket] || []).filter((item) => item.id !== id);
        if (draft.local[bucket]) draft.local[bucket] = draft.local[bucket].filter((item) => item.id !== id);
        return draft;
    }, { undoable: true });
}

export async function patchProfile(patch) {
    await update((draft) => {
        draft.profile = { ...draft.profile, ...patch };
        return draft;
    });
}

export async function replaceRoster(text) {
    const parsed = parseRoster(text);
    if (!parsed.students.length) return parsed;
    await update((draft) => {
        const old = new Map(draft.students.map((row) => [row.no, row]));
        draft.students = parsed.students.map((row) => ({
            id: old.get(row.no)?.id || `s${row.no}`,
            no: row.no,
            name: row.name,
            sex: row.sex || old.get(row.no)?.sex || '',
            birthday: old.get(row.no)?.birthday || '',
            active: true,
            memo: old.get(row.no)?.memo || '',
            source: old.get(row.no)?.source || 'app',
        }));
        draft.profile.classSize = parsed.students.length;
        return draft;
    });
    return parsed;
}

export async function setTimetable(day, period, subject, specialist) {
    await update((draft) => {
        const table = { ...draft.timetable };
        const row = { ...(table[day] || {}) };
        if (subject != null) row[`p${period}`] = subject;
        if (specialist != null) row[`s${period}`] = specialist;
        table[day] = row;
        draft.timetable = table;
        return draft;
    });
}

export function previewLegacy(titles) {
    if (!legacyAvailable()) return null;
    const bag = readLegacyStorage(localStorage);
    return planMigration(bag, { titles, now: new Date() });
}

export async function applyLegacy(plan) {
    await update((draft) => {
        draft.local.backup = plan.backup;
        return draft;
    });
    const fileDate = seoulYmd();
    downloadJson(`교무수첩-원본백업-${fileDate}.json`, plan.backup.payload);
    await update((draft) => {
        const merge = (current, incoming) => {
            const map = new Map((current || []).map((item) => [item.id, item]));
            for (const item of incoming || []) map.set(item.id, item);
            return [...map.values()];
        };
        draft.students = merge(draft.students, plan.students);
        draft.records = merge(draft.records, plan.records);
        draft.attendance = merge(draft.attendance, plan.attendance);
        draft.events = merge(draft.events, plan.events);
        draft.todos = merge(draft.todos, plan.todos);
        draft.notes = merge(draft.notes, plan.notes);
        draft.notices = merge(draft.notices, plan.notices);
        draft.legacyPages = merge(draft.legacyPages, plan.legacyPages);
        draft.timetable = { ...draft.timetable, ...plan.timetable };
        draft.local.records = merge(draft.local.records, plan.local.records);
        draft.local.notes = merge(draft.local.notes, plan.local.notes);
        draft.local.events = merge(draft.local.events, plan.local.events);
        draft.local.todos = merge(draft.local.todos, plan.local.todos);
        draft.local.notices = merge(draft.local.notices, plan.local.notices);
        draft.local.contacts = merge(draft.local.contacts, plan.local.contacts);
        draft.local.pages = merge(draft.local.pages, plan.local.pages);
        draft.local.backup = plan.backup;
        draft.profile.started = true;
        draft.profile.migratedAt = plan.at;
        draft.profile.migration = { counts: plan.counts, summary: plan.summary, conflicts: plan.conflicts, at: plan.at };
        if (!draft.profile.classSize) draft.profile.classSize = plan.students.length;
        draft.profile.migrateLater = false;
        return draft;
    });
}

export async function forgetLegacyImports() {
    await update((draft) => {
        const keep = (list) => (list || []).filter((item) => item.source !== 'legacy' && item.source !== 'legacy-conflict');
        draft.students = keep(draft.students);
        draft.records = keep(draft.records);
        draft.attendance = keep(draft.attendance);
        draft.events = keep(draft.events);
        draft.todos = keep(draft.todos);
        draft.notes = keep(draft.notes);
        draft.notices = keep(draft.notices);
        draft.legacyPages = keep(draft.legacyPages);
        draft.local.records = keep(draft.local.records);
        draft.local.notes = keep(draft.local.notes);
        draft.local.events = keep(draft.local.events);
        draft.local.todos = keep(draft.local.todos);
        draft.local.notices = keep(draft.local.notices);
        draft.local.contacts = keep(draft.local.contacts);
        draft.local.pages = keep(draft.local.pages);
        draft.profile.migratedAt = null;
        draft.profile.migration = null;
        return draft;
    });
}

export function exportFile(includeLocal) {
    const data = buildExport(state, { includeLocal, at: new Date().toISOString() });
    downloadJson(`쓱교무수첩-${seoulYmd()}.json`, data);
    return data;
}

export function downloadOriginal() {
    if (!state.local.backup?.payload) return false;
    downloadJson(`교무수첩-원본백업-${seoulYmd()}.json`, state.local.backup.payload);
    return true;
}

export async function importText(text, mode) {
    const checked = validateBackupText(text);
    if (!checked.ok) return checked;
    if (checked.kind === 'legacy') {
        const plan = planMigration(oldBackupToBag(checked.data), { now: new Date() });
        await applyLegacy(plan);
        return { ok: true, kind: 'legacy', summary: plan.summary };
    }
    const data = checked.data;
    const sensitive = splitSensitive(data.records || []);
    if (mode === 'replace') {
        await update((draft) => {
            draft.local.backup = { exportedAt: new Date().toISOString(), payload: buildExport(draft, { includeLocal: true, at: new Date().toISOString() }) };
            return draft;
        });
        downloadJson(`쓱교무수첩-바꾸기전-${seoulYmd()}.json`, state.local.backup.payload);
    }
    await update((draft) => {
        const merge = (current, incoming) => {
            if (mode === 'replace') return incoming || [];
            const map = new Map((current || []).map((item) => [item.id, item]));
            for (const item of incoming || []) map.set(item.id, item);
            return [...map.values()];
        };
        draft.students = merge(draft.students, data.students);
        draft.attendance = merge(draft.attendance, data.attendance);
        draft.records = merge(draft.records, sensitive.cloud);
        draft.events = merge(draft.events, data.events);
        draft.todos = merge(draft.todos, data.todos);
        draft.notes = merge(draft.notes, data.notes);
        draft.notices = merge(draft.notices, data.notices);
        draft.legacyPages = merge(draft.legacyPages, data.legacy);
        draft.timetable = mode === 'replace' ? (data.timetable || {}) : { ...draft.timetable, ...(data.timetable || {}) };
        if (data.profile?.className) draft.profile.className = data.profile.className;
        if (data.profile?.periodStarts) draft.profile.periodStarts = data.profile.periodStarts;
        draft.local.records = merge(draft.local.records, [...(data.local?.records || []), ...sensitive.local]);
        draft.profile.started = true;
        draft.profile.classSize = draft.students.length || draft.profile.classSize;
        return draft;
    });
    return { ok: true, kind: 'ssug-gyomu', localOnly: sensitive.local.length };
}

export async function setAuth(auth) {
    state = { ...state, auth };
    emit();
}

export async function clearAll() {
    await update((draft) => {
        const theme = draft.profile.theme;
        const next = emptyState();
        next.profile.theme = theme;
        next.tip = { hidden: [], seen: [], closes: {}, snooze: '' };
        return next;
    });
    try {
        await mainVault.remove('state');
        await localVault.remove('state');
    } catch {
        /* 이미 메모리만 쓰는 경우입니다. */
    }
}

export async function saveTip(tip) {
    await update((draft) => {
        draft.tip = tip;
        return draft;
    });
}

export function joinedRecords(current = state) {
    return [
        ...current.records.map((row) => ({ ...row, localOnly: false })),
        ...current.local.records.map((row) => ({ ...row, localOnly: true })),
    ];
}

export function joined(current, bucket) {
    return [
        ...(current[bucket] || []).map((row) => ({ ...row, localOnly: false })),
        ...(current.local?.[bucket] || []).map((row) => ({ ...row, localOnly: true })),
    ];
}
