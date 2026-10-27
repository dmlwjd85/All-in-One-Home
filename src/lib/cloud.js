import { cloudReady, finishRedirectSignIn, loadFirebase } from '../firebase.js';
import { eventBodyWithoutEndTime, fromCloudProfile, fromCloudRow, toCloudProfile, toCloudRow } from './cloudShape.js';
import { isoOf, pushDecision, timeOf, uploadTime } from './sync.js';

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

/** 서버 시계와 이 기기 시계의 차이(ms). db.js가 접속할 때 재서 알려 줍니다. */
let clockOffset = 0;

export function setClockOffset(ms) {
    clockOffset = Number.isFinite(ms) ? ms : 0;
}

function serverNow() {
    return Date.now() + clockOffset;
}

/** 이 기기에서 고친 시각을 그대로 올립니다. 없거나 서버 기준으로 앞날이면 서버 기준 지금 시각을 씁니다. */
function editedAt(Timestamp, value) {
    return Timestamp.fromMillis(uploadTime(value, serverNow()));
}

function withTimeout(promise, ms) {
    let timer = 0;
    return Promise.race([
        promise,
        new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'deadline-exceeded' })), ms); }),
    ]).finally(() => clearTimeout(timer));
}

function offlineNow() {
    return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** 시각을 견줘 합치는 묶음(시간표 포함). 이 묶음은 서버 판을 읽고 나서 씁니다. */
const CHECKED = new Set([...STAMPED, 'timetable']);
/** 한 번에 같이 보내는 확인-쓰기 수와 하나가 기다리는 시간. */
const PUSH_CHUNK = 12;
const PUSH_TIMEOUT_MS = 15000;

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

/**
 * seen: 이 계정 클라우드에서 본 적 있는 키(Set). 시각 있는 줄이 클라우드에서 없어졌으면 다른 기기가 지운 것으로 봅니다.
 * 돌려주는 stale·gone은 클라우드 쪽이 더 최근이라 올리지 않은 수입니다. 받아 와서 합치면 맞춰집니다.
 */
export async function pushUserData(uid, state, { memoryOnly = false, hashes = {}, seen = null } = {}) {
    if (!uid || !syncAvailable()) return { skipped: true, hashes, pending: 0 };
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return { skipped: true, hashes, pending: 0 };
    const firestore = await import('firebase/firestore');
    const { doc, setDoc, deleteField, runTransaction } = firestore;
    const nextHashes = { ...hashes };
    let pending = 0;
    let stale = 0;
    let gone = 0;
    // 인터넷이 끊긴 채로 덮어쓰면 다른 기기의 더 새 내용을 덮을 수 있어서, 연결된 뒤에 다시 올립니다.
    let offline = offlineNow();
    const bodyFor = (base, shaped, migratedAt, edited) => stamp(firestore, base, shaped.stamps, migratedAt, edited).then((body) => {
        (shaped.clear || []).forEach((key) => { body[key] = deleteField(); });
        return body;
    });
    const checkedSet = (ref, body, key, edited) => runTransaction(ready.db, async (tx) => {
        const snap = await tx.get(ref);
        const verdict = pushDecision({
            exists: snap.exists(),
            serverMs: snap.exists() ? timeOf(snap.data()?.updatedAt) : 0,
            localMs: uploadTime(edited, serverNow()),
            seen: Boolean(seen?.has?.(key)),
        });
        if (verdict === 'write') tx.set(ref, body, { merge: true });
        return verdict;
    }, { maxAttempts: 3 });
    const write = async (name, id, shaped, migratedAt, edited) => {
        const prepared = name === 'events' ? prepareEventWrite(shaped.body) : { body: shaped.body, retryWithoutEndTime: false };
        const clear = shaped.clear || [];
        const key = `${name}/${id}`;
        const mark = fingerprint(prepared.body, clear);
        if (nextHashes[key] === mark) return;
        if (offline) {
            pending += 1;
            return;
        }
        const ref = doc(ready.db, 'users', uid, name, String(id));
        // 예전 줄(고친 시각 없음)과 정리함·보관함은 예전처럼 바로 씁니다.
        const checked = CHECKED.has(name) && timeOf(edited) > 0;
        const put = async (base) => {
            const body = await bodyFor(base, shaped, migratedAt, edited);
            if (!checked) {
                await withTimeout(setDoc(ref, body, { merge: name !== 'legacy' }), PUSH_TIMEOUT_MS);
                return 'write';
            }
            return withTimeout(checkedSet(ref, body, key, edited), PUSH_TIMEOUT_MS);
        };
        const settle = (verdict, base) => {
            if (verdict === 'write') nextHashes[key] = fingerprint(base, clear);
            else if (verdict === 'stale') stale += 1;
            else if (verdict === 'gone') gone += 1;
        };
        try {
            settle(await put(prepared.body), prepared.body);
        } catch (error) {
            const fallback = prepared.retryWithoutEndTime && denied(error) ? eventBodyWithoutEndTime(shaped.body) : null;
            if (fallback) {
                noteEndTimeRejected();
                try {
                    settle(await put(fallback), fallback);
                    return;
                } catch (again) {
                    if (retryable(again)) pending += 1;
                    if (String(again?.code || '').includes('unavailable')) offline = true;
                    return;
                }
            }
            if (retryable(error)) pending += 1;
            // 한 번 연결이 안 된다고 나오면 나머지는 기다리지 않고 다음에 올립니다.
            if (String(error?.code || '').includes('unavailable')) offline = true;
        }
    };
    const jobs = [];

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
            jobs.push(() => write(cloudName, shaped.id, shaped, undefined, row.updatedAt));
        }
    }
    for (const [id, value] of Object.entries(state.timetable || {})) {
        const shaped = toCloudRow('timetable', { id, ...value });
        if (!shaped) continue;
        jobs.push(() => write('timetable', shaped.id, shaped, undefined, state.syncMeta?.timetable?.[id]));
    }
    for (let i = 0; i < jobs.length; i += PUSH_CHUNK) {
        await Promise.all(jobs.slice(i, i + PUSH_CHUNK).map((job) => job()));
    }
    return { ok: pending === 0, hashes: nextHashes, pending, stale, gone };
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

/**
 * 서버 시각을 한 번 잽니다. users/{uid}의 updatedAt에 서버 시각을 적고 바로 읽어 옵니다.
 * 인터넷이 없거나 실패하면 null. 돌려준 값으로 estimateOffset을 셈합니다.
 */
export async function readServerClock(uid, { memoryOnly = false, timeoutMs = 8000 } = {}) {
    if (!uid || !syncAvailable() || offlineNow()) return null;
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return null;
    try {
        const { doc, setDoc, getDocFromServer, serverTimestamp } = await import('firebase/firestore');
        const ref = doc(ready.db, 'users', uid);
        const sentAt = Date.now();
        await withTimeout(setDoc(ref, { updatedAt: serverTimestamp() }, { merge: true }), timeoutMs);
        const receivedAt = Date.now();
        const snap = await withTimeout(getDocFromServer(ref), timeoutMs);
        return { sentAt, receivedAt, serverAt: snap.data()?.updatedAt || null };
    } catch {
        return null;
    }
}

/** 공용 컴퓨터 모드를 켜고 끌 때 클라우드 캐시도 바꿉니다(켜면 이 기기 캐시를 비움). */
export async function switchCloudCache(memoryOnly) {
    if (!syncAvailable()) return false;
    return Boolean(await loadFirebase({ memoryOnly, persist: !memoryOnly }));
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
