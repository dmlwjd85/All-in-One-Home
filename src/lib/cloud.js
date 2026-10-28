import { cloudReady, finishRedirectSignIn, loadFirebase } from '../firebase.js';
import { eventBodyWithoutEndTime, fromCloudProfile, fromCloudRow, fromCloudSettings, mergeSettings, toCloudProfile, toCloudRow, toCloudSettings } from './cloudShape.js';
import { readPeriodLocal } from './periodLocal.js';

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

export function fingerprint(body, clear = []) {
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

/** 이 기기 줄이 마지막으로 올린 모양 그대로인지(=이 기기에서 그 뒤로 안 고쳤는지). 그럴 때만 다른 기기 값으로 바꿉니다. */
export function unchangedSincePush(hashes, cloudName, row) {
    const shaped = toCloudRow(cloudName, row);
    if (!shaped) return false;
    const key = `${cloudName}/${shaped.id}`;
    if (!hashes || !hashes[key]) return false;
    const body = cloudName === 'events' ? prepareEventWrite(shaped.body).body : shaped.body;
    return hashes[key] === fingerprint(body, shaped.clear || []);
}

export const CLOUD_COLLECTIONS = COLLECTIONS;

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
        const prepared = name === 'events' ? prepareEventWrite(shaped.body) : { body: shaped.body, retryWithoutEndTime: false };
        const body = await stamp(firestore, prepared.body, shaped.stamps, migratedAt);
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
                    const retryBody = await stamp(firestore, fallback, shaped.stamps, migratedAt);
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

    /* 기기끼리 같이 쓰는 설정. 규칙이 아직 이 문서를 모르면 거절되지만 다른 기록은 그대로 올라갑니다. */
    const settings = toCloudSettings(state, readPeriodLocal());
    if (settings.body.at > 0) {
        const mark = fingerprint(settings.body);
        if (nextHashes['settings/device'] !== mark) {
            try {
                /* 통째로 덮지 않습니다: 클라우드 문서를 읽어 칸마다 더 늦게 고친 쪽을 남긴 뒤 씁니다.
                   다른 기기가 먼저 고친 칸은 그대로 두고, 다음 받기에서 이 기기로 들어옵니다. */
                const ref = doc(ready.db, 'users', uid, 'settings', 'device');
                await firestore.runTransaction(ready.db, async (tx) => {
                    const snap = await tx.get(ref);
                    const merged = mergeSettings(settings.body, snap.exists() ? fromCloudSettings(snap.data()) : null);
                    tx.set(ref, await stamp(firestore, merged, settings.stamps));
                });
                nextHashes['settings/device'] = mark;
            } catch (error) {
                if (retryable(error)) pending += 1;
            }
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
        inbox: [],
        timetable: {},
        settings: null,
    };
    try {
        const set = await getDoc(doc(ready.db, 'users', uid, 'settings', 'device'));
        if (set.exists()) out.settings = fromCloudSettings(set.data());
    } catch {
        /* 규칙을 올리기 전에는 읽기가 거절됩니다. 나머지는 그대로 받습니다. */
    }
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
