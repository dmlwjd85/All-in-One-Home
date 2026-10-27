import { cloudReady, finishRedirectSignIn, loadFirebase } from '../firebase.js';
import { eventBodyWithoutEndTime, fromCloudProfile, fromCloudRow, toCloudProfile, toCloudRow } from './cloudShape.js';
import { isoOf, timeOf } from './sync.js';

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
    ['inbox', 'inbox'],
];

/** 고친 시각을 견줘 합치는 묶음. 정리함·보관함은 예전 방식 그대로입니다. */
const STAMPED = new Set(['students', 'attendance', 'records', 'events', 'todos', 'notes', 'notices']);

const RETRYABLE = ['unavailable', 'deadline-exceeded', 'resource-exhausted', 'aborted', 'auth/network-request-failed'];

function retryable(error) {
    const code = String(error?.code || '');
    return RETRYABLE.some((item) => code.includes(item));
}

function denied(error) {
    return String(error?.code || '').includes('permission-denied');
}

/** 이번 실행에서 끝 시각 칸이 거절됐는지. 앱을 다시 열면 한 번 더 시도합니다. */
let endTimeBlocked = false;

export function resetEndTimeUpload() {
    endTimeBlocked = false;
}

export function endTimeUploadBlocked() {
    return endTimeBlocked;
}

export function noteEndTimeRejected() {
    endTimeBlocked = true;
}

/** 거절을 기억한 뒤에는 끝 시각을 빼고 메모로만 올립니다. */
export function prepareEventWrite(body) {
    if (endTimeBlocked && body?.endTime) {
        const memo = eventBodyWithoutEndTime(body);
        return { body: memo || body, retryWithoutEndTime: false };
    }
    return { body, retryWithoutEndTime: Boolean(body?.endTime) };
}

function fingerprint(body, clear = []) {
    return clear.length ? `${JSON.stringify(body)}|${clear.join(',')}` : JSON.stringify(body);
}

/** 이 기기에서 고친 시각을 그대로 올립니다. 없거나 앞날이면 지금 시각을 씁니다. */
function editedAt(Timestamp, value) {
    const ms = timeOf(value);
    if (!ms || ms > Date.now() + 60 * 1000) return Timestamp.now();
    return Timestamp.fromMillis(ms);
}

async function stamp(firestore, body, names, previous, edited) {
    const { Timestamp } = firestore;
    const next = { ...body };
    names.forEach((name) => {
        if (name === 'migratedAt' && previous) {
            const date = new Date(previous);
            next.migratedAt = Number.isNaN(date.getTime()) ? Timestamp.now() : Timestamp.fromDate(date);
            return;
        }
        next[name] = name === 'updatedAt' && edited ? editedAt(Timestamp, edited) : Timestamp.now();
    });
    return next;
}

/** 받아 온 기록을 이 기기가 올릴 때 쓰는 지문. 같으면 다시 올리지 않습니다. */
export function cloudMark(cloudName, row) {
    const shaped = toCloudRow(cloudName, row);
    if (!shaped) return null;
    const prepared = cloudName === 'events' ? prepareEventWrite(shaped.body) : { body: shaped.body };
    return { key: `${cloudName}/${shaped.id}`, mark: fingerprint(prepared.body, shaped.clear || []) };
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
    const write = async (name, id, shaped, migratedAt, edited) => {
        const prepared = name === 'events' ? prepareEventWrite(shaped.body) : { body: shaped.body, retryWithoutEndTime: false };
        const body = await stamp(firestore, prepared.body, shaped.stamps, migratedAt, edited);
        const clear = shaped.clear || [];
        clear.forEach((key) => { body[key] = deleteField(); });
        const key = `${name}/${id}`;
        const mark = fingerprint(prepared.body, clear);
        if (nextHashes[key] === mark) return;
        try {
            await setDoc(doc(ready.db, 'users', uid, name, String(id)), body, { merge: name !== 'legacy' });
            nextHashes[key] = mark;
        } catch (error) {
            const fallback = prepared.retryWithoutEndTime && denied(error) ? eventBodyWithoutEndTime(shaped.body) : null;
            if (fallback) {
                noteEndTimeRejected();
                try {
                    const retryBody = await stamp(firestore, fallback, shaped.stamps, migratedAt, edited);
                    await setDoc(doc(ready.db, 'users', uid, name, String(id)), retryBody, { merge: true });
                    nextHashes[key] = fingerprint(fallback, clear);
                    return;
                } catch (again) {
                    if (retryable(again)) pending += 1;
                    return;
                }
            }
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
            await write(cloudName, shaped.id, shaped, undefined, row.updatedAt);
        }
    }
    for (const [id, value] of Object.entries(state.timetable || {})) {
        const shaped = toCloudRow('timetable', { id, ...value });
        if (!shaped) continue;
        await write('timetable', shaped.id, shaped, undefined, state.syncMeta?.timetable?.[id]);
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
        inbox: [],
        timetable: {},
        timetableStamps: {},
        fromServer: {},
    };
    for (const [localName, cloudName] of COLLECTIONS) {
        const snap = await getDocs(collection(ready.db, 'users', uid, cloudName));
        out.fromServer[cloudName] = snap.metadata?.fromCache === false;
        snap.forEach((item) => {
            const data = item.data();
            const row = fromCloudRow(cloudName, item.id, data);
            // 어느 쪽이 더 최근인지 견주려고 고친 시각만 붙입니다. 클라우드로 다시 올리는 칸은 아닙니다.
            if (!row) return;
            out[localName].push(STAMPED.has(cloudName) ? { ...row, updatedAt: isoOf(data?.updatedAt) } : row);
        });
    }
    const table = await getDocs(collection(ready.db, 'users', uid, 'timetable'));
    out.fromServer.timetable = table.metadata?.fromCache === false;
    table.forEach((item) => {
        const data = item.data();
        const row = fromCloudRow('timetable', item.id, data);
        if (row) {
            out.timetable[item.id] = row;
            const at = isoOf(data?.updatedAt);
            if (at) out.timetableStamps[item.id] = at;
        }
    });
    return out;
}

export async function deleteUserDoc(uid, name, id, { memoryOnly = false } = {}) {
    if (!uid || !name || !id || !syncAvailable()) return { skipped: true };
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return { skipped: true };
    try {
        const { doc, deleteDoc } = await import('firebase/firestore');
        await deleteDoc(doc(ready.db, 'users', uid, name, String(id)));
        return { ok: true };
    } catch {
        return { ok: false };
    }
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
