import { cloudReady, finishRedirectSignIn, loadFirebase } from '../firebase.js';
import { fromCloudProfile, fromCloudRow, toCloudProfile, toCloudRow } from './cloudShape.js';

/** 새 기록은 users/{uid} 아래에만 둡니다. 예전 공개 경로에는 쓰지 않습니다. */
const COLLECTIONS = [
    ['students', 'students'],
    ['attendance', 'attendance'],
    ['records', 'records'],
    ['events', 'events'],
    ['todos', 'todos'],
    ['notes', 'notes'],
    ['notices', 'notices'],
    ['legacyPages', 'legacy'],
];

const RETRYABLE = ['unavailable', 'deadline-exceeded', 'resource-exhausted', 'aborted', 'auth/network-request-failed'];

function retryable(error) {
    const code = String(error?.code || '');
    return RETRYABLE.some((item) => code.includes(item));
}

function fingerprint(body, clear = []) {
    return clear.length ? `${JSON.stringify(body)}|${clear.join(',')}` : JSON.stringify(body);
}

async function stamp(firestore, body, names, previous) {
    const { Timestamp } = firestore;
    const next = { ...body };
    names.forEach((name) => {
        if (name === 'migratedAt' && previous) {
            const date = new Date(previous);
            next.migratedAt = Number.isNaN(date.getTime()) ? Timestamp.now() : Timestamp.fromDate(date);
            return;
        }
        next[name] = Timestamp.now();
    });
    return next;
}

export function syncAvailable() {
    return cloudReady();
}

export async function pushUserData(uid, state, { memoryOnly = false, hashes = {} } = {}) {
    if (!uid || !syncAvailable()) return { skipped: true, hashes, pending: 0 };
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return { skipped: true, hashes, pending: 0 };
    const firestore = await import('firebase/firestore');
    const { doc, setDoc, deleteField } = firestore;
    const nextHashes = { ...hashes };
    let pending = 0;
    const write = async (name, id, shaped, migratedAt) => {
        const body = await stamp(firestore, shaped.body, shaped.stamps, migratedAt);
        const clear = shaped.clear || [];
        clear.forEach((key) => { body[key] = deleteField(); });
        const key = `${name}/${id}`;
        const mark = fingerprint(shaped.body, clear);
        if (nextHashes[key] === mark) return;
        try {
            await setDoc(doc(ready.db, 'users', uid, name, String(id)), body, { merge: name !== 'legacy' });
            nextHashes[key] = mark;
        } catch (error) {
            if (retryable(error)) pending += 1;
        }
    };

    const profile = toCloudProfile(state);
    const profileBody = await stamp(firestore, profile.body, profile.stamps, state.profile?.migratedAt);
    const profileMark = fingerprint(profile.body);
    if (nextHashes.profile !== profileMark) {
        try {
            await setDoc(doc(ready.db, 'users', uid), profileBody, { merge: true });
            nextHashes.profile = profileMark;
        } catch (error) {
            if (retryable(error)) pending += 1;
        }
    }

    for (const [localName, cloudName] of COLLECTIONS) {
        for (const row of state[localName] || []) {
            const shaped = toCloudRow(cloudName, row);
            if (!shaped) continue;
            await write(cloudName, shaped.id, shaped);
        }
    }
    for (const [id, value] of Object.entries(state.timetable || {})) {
        const shaped = toCloudRow('timetable', { id, ...value });
        if (!shaped) continue;
        await write('timetable', shaped.id, shaped);
    }
    return { ok: pending === 0, hashes: nextHashes, pending };
}

export async function pullUserData(uid, { memoryOnly = false } = {}) {
    if (!uid || !syncAvailable()) return null;
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return null;
    const { doc, getDoc, collection, getDocs } = await import('firebase/firestore');
    const root = await getDoc(doc(ready.db, 'users', uid));
    const out = {
        profile: root.exists() ? fromCloudProfile(root.data()) : null,
        students: [],
        attendance: [],
        records: [],
        events: [],
        todos: [],
        notes: [],
        notices: [],
        legacyPages: [],
        timetable: {},
    };
    for (const [localName, cloudName] of COLLECTIONS) {
        const snap = await getDocs(collection(ready.db, 'users', uid, cloudName));
        snap.forEach((item) => {
            const row = fromCloudRow(cloudName, item.id, item.data());
            if (row) out[localName].push(row);
        });
    }
    const table = await getDocs(collection(ready.db, 'users', uid, 'timetable'));
    table.forEach((item) => {
        const row = fromCloudRow('timetable', item.id, item.data());
        if (row) out.timetable[item.id] = row;
    });
    return out;
}

export async function watchAuth(onUser, { memoryOnly = false } = {}) {
    if (!syncAvailable()) return () => {};
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return () => {};
    await finishRedirectSignIn();
    const { onAuthStateChanged } = await import('firebase/auth');
    return onAuthStateChanged(ready.auth, (user) => {
        onUser(user ? { uid: user.uid, name: user.displayName || '', email: user.email || '' } : null);
    });
}
