import { cloudReady, loadFirebase } from '../firebase.js';
import { isSensitiveText } from './sensitive.js';

/** 새 기록은 users/{uid} 아래에만 둡니다. 예전 공개 경로에는 쓰지 않습니다. */
const COLLECTIONS = ['students', 'attendance', 'records', 'events', 'todos', 'notes', 'notices', 'legacyPages'];

const FIELDS = {
    students: ['no', 'name', 'sex', 'birthday', 'active', 'memo', 'source'],
    attendance: ['date', 'sid', 'status', 'reason', 'period', 'paper', 'note', 'source'],
    records: ['date', 'kind', 'sid', 'text', 'tags', 'neis', 'follow', 'minutes', 'source', 'at', 'neisMoved'],
    events: ['date', 'end', 'time', 'title', 'kind', 'memo', 'source', 'at'],
    todos: ['title', 'done', 'due', 'got', 'of', 'order', 'doneAt', 'pendingNos', 'source', 'at'],
    notes: ['text', 'date', 'tags', 'pinned', 'source', 'at'],
    notices: ['date', 'text', 'copiedAt', 'source', 'at'],
    legacy: ['kind', 'raw', 'title', 'at'],
};

function pick(row, keys) {
    const out = {};
    keys.forEach((key) => {
        if (row[key] !== undefined && row[key] !== null && row[key] !== '') out[key] = row[key];
    });
    return out;
}

export function syncAvailable() {
    return cloudReady();
}

export async function pushUserData(uid, state, { memoryOnly = false } = {}) {
    if (!uid || !syncAvailable()) return { skipped: true };
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return { skipped: true };
    const { doc, setDoc } = await import('firebase/firestore');
    const profile = {
        displayName: state.auth?.name || '',
        className: state.profile.className || '',
        schoolYear: state.profile.schoolYear || 2026,
        classSize: state.profile.classSize || state.students.length || 0,
        theme: state.profile.theme || 'system',
        periodStart: state.profile.periodStarts || [],
        migratedAt: state.profile.migratedAt || '',
        migrationVersion: 1,
    };
    await setDoc(doc(ready.db, 'users', uid), profile, { merge: true });
    for (const name of COLLECTIONS) {
        const rows = state[name] || [];
        for (const row of rows) {
            if (!row?.id) continue;
            if (isSensitiveText(row.text, row.tags) || isSensitiveText(row.title) || isSensitiveText(row.note) || isSensitiveText(row.memo)) continue;
            const cloudName = name === 'legacyPages' ? 'legacy' : name;
            const body = pick(row, FIELDS[cloudName] || []);
            if (!Object.keys(body).length) continue;
            try {
                await setDoc(doc(ready.db, 'users', uid, cloudName, String(row.id)), body, { merge: true });
            } catch {
                /* 보관본처럼 고칠 수 없는 문서는 넘어갑니다. 이 기기 기록은 그대로입니다. */
            }
        }
    }
    if (state.timetable) {
        for (const [id, value] of Object.entries(state.timetable)) {
            const body = {};
            for (let period = 1; period <= 8; period += 1) {
                if (value?.[`p${period}`]) body[`p${period}`] = value[`p${period}`];
                if (value?.[`s${period}`]) body[`s${period}`] = value[`s${period}`];
            }
            if (Object.keys(body).length) await setDoc(doc(ready.db, 'users', uid, 'timetable', id), body, { merge: true });
        }
    }
    return { ok: true };
}

export async function watchAuth(onUser) {
    if (!syncAvailable()) return () => {};
    const ready = await loadFirebase();
    if (!ready) return () => {};
    const { onAuthStateChanged } = await import('firebase/auth');
    return onAuthStateChanged(ready.auth, (user) => {
        onUser(user ? { uid: user.uid, name: user.displayName || '', email: user.email || '' } : null);
    });
}
