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

/** 내용을 남기지 않는 짧은 요약(FNV-1a). 지울 대기열에는 이 값만 둡니다. */
export function printDigest(text) {
    let h = 0x811c9dc5;
    const str = String(text);
    for (let i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return `f${h.toString(36)}${str.length.toString(36)}`;
}

export function fingerprint(body, clear = []) {
    return clear.length ? `${JSON.stringify(body)}|${clear.join(',')}` : JSON.stringify(body);
}

export async function stamp(firestore, body, names, previous) {
    const { Timestamp, serverTimestamp } = firestore;
    const next = { ...body };
    names.forEach((name) => {
        if (name === 'migratedAt' && previous) {
            const date = new Date(previous);
            next.migratedAt = Number.isNaN(date.getTime()) ? Timestamp.now() : Timestamp.fromDate(date);
            return;
        }
        /* 고친 시각은 기기 시계가 아니라 서버 시각으로 찍습니다(늦은 삭제 비교가 기기 시계에 흔들리지 않게). */
        next[name] = serverTimestamp();
    });
    return next;
}

/** 올리기와 같은 방식으로 이 줄의 해시를 셉니다(받아 온 줄을 '올린 것과 같다'고 적어 둘 때 씁니다). */
export function rowMark(cloudName, row) {
    const shaped = row ? toCloudRow(cloudName, row) : null;
    if (!shaped?.id) return null;
    const body = cloudName === 'events' ? prepareEventWrite(shaped.body).body : shaped.body;
    return { key: `${cloudName}/${shaped.id}`, mark: fingerprint(body, shaped.clear || []) };
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
    const rejected = [];
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
                    if (denied(again)) rejected.push(key);
                    if (retryable(again)) pending += 1;
                    return;
                }
            }
            if (denied(error)) rejected.push(key);
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
    return { ok: pending === 0, hashes: nextHashes, pending, rejected };
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
        /* 받은 문서 id 전부(읽지 못한 모양 포함). 다른 기기에서 지운 줄을 가려낼 때만 씁니다. */
        ids: {},
        /* 출결 문서의 서버 고친 시각(ms). 남은 임시 출결이 더 나중 값을 덮지 않게 견줄 때 씁니다. */
        ats: { attendance: {} },
    };
    try {
        const set = await getDoc(doc(ready.db, 'users', uid, 'settings', 'device'));
        if (set.exists()) out.settings = fromCloudSettings(set.data());
    } catch {
        /* 규칙을 올리기 전에는 읽기가 거절됩니다. 나머지는 그대로 받습니다. */
    }
    for (const [localName, cloudName] of COLLECTIONS) {
        const snap = await getDocs(collection(ready.db, 'users', uid, cloudName));
        /* 캐시에서 온 결과로는 지우기를 하지 않습니다. 서버에서 받은 목록만 ids에 둡니다. */
        const ids = serverIds(snap);
        if (ids) out.ids[cloudName] = ids;
        snap.forEach((item) => {
            const data = item.data();
            const row = fromCloudRow(cloudName, item.id, data);
            if (row) out[localName].push(row);
            if (cloudName === 'attendance' && typeof data?.updatedAt?.toMillis === 'function') out.ats.attendance[item.id] = data.updatedAt.toMillis();
        });
    }
    const table = await getDocs(collection(ready.db, 'users', uid, 'timetable'));
    table.forEach((item) => {
        const row = fromCloudRow('timetable', item.id, item.data());
        if (row) out.timetable[item.id] = row;
    });
    return out;
}

/** 서버에서 받은 결과일 때만 문서 id 목록을 돌려줍니다(캐시면 null). */
export function serverIds(snap) {
    if (snap?.metadata?.fromCache !== false) return null;
    const ids = [];
    snap.forEach((item) => ids.push(String(item.id)));
    return ids;
}

/** 클라우드 문서가 지운 시각보다 나중에 고쳐졌는지 봅니다. */
export function newerThanDelete(data, notAfter) {
    const at = data?.updatedAt;
    const ms = typeof at?.toMillis === 'function' ? at.toMillis() : null;
    return ms != null && Number.isFinite(notAfter) && ms > notAfter;
}

/** 지운 뒤 다른 기기가 고쳤는지 봅니다. 출결은 마지막으로 알던 내용(expect)과 다르면 고친 것으로 봅니다. */
export function keepCloudDoc(name, id, data, { notAfter = null, expect = null } = {}) {
    if (!data) return false;
    if (expect && name === 'attendance') {
        const row = fromCloudRow(name, String(id), data);
        const shaped = row ? toCloudRow(name, row) : null;
        /* expect는 '요약' 하나 또는 쉼표로 이은 여럿(마지막으로 올린 값, 오프라인에서 고친 뒤 지운 값) */
        const allowed = String(expect).split(',').filter(Boolean);
        if (!shaped || !allowed.includes(printDigest(fingerprint(shaped.body, shaped.clear || [])))) return true;
        return false;
    }
    if (!newerThanDelete(data, notAfter)) return false;
    /* 지운 뒤에 고친 시각이 찍혔어도 내용이 지운 줄 그대로면(진행 중이던 올리기가 한 번 더 쓴 것) 지웁니다(PR #52 2차 검수 2번). */
    if (expect) {
        const row = fromCloudRow(name, String(id), data);
        const mark = row ? rowMark(name, row) : null;
        if (mark && String(expect).split(',').filter(Boolean).includes(printDigest(mark.mark))) return false;
    }
    return true;
}

/** 서버에서 문서를 읽어 지워도 될 때만 지웁니다. get·del을 바꿔 넣어 검사합니다. */
export async function guardedDelete({ get, del }, name, id, opts = {}) {
    if (Number.isFinite(opts.notAfter) || opts.expect) {
        const data = await get();
        if (keepCloudDoc(name, id, data, opts)) return { ok: true, kept: true };
    }
    await del();
    return { ok: true };
}

export async function deleteUserDoc(uid, name, id, { memoryOnly = false, notAfter = null, expect = null } = {}) {
    if (!uid || !name || !id || !syncAvailable()) return { skipped: true };
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return { skipped: true };
    try {
        const { doc, deleteDoc, getDocFromServer } = await import('firebase/firestore');
        const ref = doc(ready.db, 'users', uid, name, String(id));
        return await guardedDelete({
            get: async () => { const snap = await getDocFromServer(ref); return snap.exists() ? snap.data() : null; },
            del: () => deleteDoc(ref),
        }, name, id, { notAfter, expect });
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
