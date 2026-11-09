import { cloudReady, finishRedirectSignIn, loadFirebase } from '../firebase.js';
import { eventBodyWithoutEndTime, todoBodyWithoutTime, fromCloudProfile, fromCloudRow, fromCloudSettings, legacySettingsBody, mergeSettings, cleanLeave, toCloudProfile, toCloudRow, toCloudSettings } from './cloudShape.js';
import { clearLeave, leaveNow, leaveState, readLeaveBackoff, readPeriodLocal, setLeave, writeLeaveBackoff } from './periodLocal.js';

/* 조퇴 문서를 규칙이 거절하면(예: 새 규칙 게시 전) 5분부터 두 배씩, 6시간까지 쉬었다가 다시 올립니다. */
/* 재시도 늦추기는 로컬에 둬서 새로 고쳐도 이어집니다. */
const LEAVE_MAX_WAIT = 6 * 3600 * 1000;
const LEAVE_MAX_AGE = 2 * 24 * 3600 * 1000;
export function resetLeaveBackoffForTest() { writeLeaveBackoff(null); }
export function leaveBackoffForTest() { return { ...readLeaveBackoff() }; }
import { cleanTabbar, tabState } from '../ui/tabSlots.js';
import { holdTodoTime, releaseTodoTime } from './todoTimeHold.js';
import { fromGoalDoc, mergeGoals, toGoalDoc } from './todoAchieve.js';

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

function denied(error) {
    return String(error?.code || '').includes('permission-denied');
}

/*
 * 올리기 실패를 나눕니다. 규칙 거절은 'rejected'(이 기기에 남기고 알림), 나머지는 모두 'pending'(다음에 다시 올림)입니다.
 * 예전에는 거절도 재시도 오류도 아닌 실패(로그인 만료·internal·unknown 등)를 아무 데도 세지 않아,
 * 올리지 못했는데도 칩이 '동기화됨'으로 보였습니다(10/31 할 일 7개·1개 제보).
 */
export function classifyWriteError(error) {
    return denied(error) ? 'rejected' : 'pending';
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

export async function stamp(firestore, body, names, previous, at = null) {
    const { Timestamp, serverTimestamp } = firestore;
    const next = { ...body };
    names.forEach((name) => {
        /* 할 일: updatedAt은 '올린 시각'이 아니라 '마지막으로 고친 시각'(서버 시각으로 보정한 기기 시계)입니다(PR #56 검수 1·2번). */
        if (name === 'updatedAt' && Number.isFinite(at) && at > 0) {
            next.updatedAt = Timestamp.fromMillis(at);
            return;
        }
        /* 할 일 hlc: v47이 쓴 표시(updatedAt과 늘 같음). v46은 이 칸을 모르므로 규칙이 v46의 덮어쓰기를 가려냅니다.
           고친 시각을 모르면(서버 시각을 재지 못함·옛 판 자료) 올린 시각으로 쓰고 u: true(시각 불확실)를 붙입니다. */
        if (name === 'hlc') {
            const sure = Number.isFinite(at) && at > 0;
            next.hlc = sure ? Timestamp.fromMillis(at) : serverTimestamp();
            next.u = sure ? firestore.deleteField() : true;
            return;
        }
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

/* 검사용: 이 기기가 보낸 할 일·일정 쓰기 수(PR #62 r3 3번: 예전 규칙에서 쓰기가 몰리지 않는지). */
let writesSent = 0;
export function cloudWritesForTest() { return writesSent; }

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
        const body = await stamp(firestore, prepared.body, shaped.stamps, migratedAt, shaped.at);
        const clear = shaped.clear || [];
        clear.forEach((key) => { body[key] = deleteField(); });
        const key = `${name}/${id}`;
        const mark = fingerprint(prepared.body, clear);
        if (nextHashes[key] === mark) return;
        try {
            writesSent += 1;
            await setDoc(doc(ready.db, 'users', uid, name, String(id)), body, { merge: name !== 'legacy' });
            nextHashes[key] = mark;
            if (name === 'todos') releaseTodoTime(id);
        } catch (error) {
            const timeless = name === 'todos' && denied(error) ? todoBodyWithoutTime(shaped.body) : null;
            const fallback = timeless || (prepared.retryWithoutEndTime && denied(error) ? eventBodyWithoutEndTime(shaped.body) : null);
            if (fallback) {
                if (!timeless) noteEndTimeRejected();
                try {
                    const retryBody = await stamp(firestore, fallback, shaped.stamps, migratedAt, shaped.at);
                    writesSent += 1;
                    await setDoc(doc(ready.db, 'users', uid, name, String(id)), retryBody, { merge: true });
                    /* 거절된 본래 내용의 표시를 남깁니다. 시각 없는 표시를 남기면 올리기마다 '바뀜'으로 보여
                       거절 + 시각 없이 쓰기가 되풀이됩니다(PR #62 r3 3번: 새로 고친 뒤 6초에 82번).
                       다시 올리기는 heldTimesToRetry가 해시를 비울 때(앱을 켠 뒤 한 번, 그 뒤 10분마다)만 합니다. */
                    nextHashes[key] = timeless ? mark : fingerprint(fallback, clear);
                    if (timeless) holdTodoTime(id, shaped.body);
                    return;
                } catch (again) {
                    if (classifyWriteError(again) === 'rejected') rejected.push(key);
                    else pending += 1;
                    return;
                }
            }
            if (classifyWriteError(error) === 'rejected') rejected.push(key);
            else pending += 1;
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
            if (classifyWriteError(error) === 'pending') pending += 1;
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
                const write = (legacy) => firestore.runTransaction(ready.db, async (tx) => {
                    const snap = await tx.get(ref);
                    const merged = mergeSettings(settings.body, snap.exists() ? fromCloudSettings(snap.data()) : null);
                    tx.set(ref, await stamp(firestore, legacy ? legacySettingsBody(merged) : merged, settings.stamps));
                });
                /* 출퇴근 칸 시각(ats.work)을 모르는 예전 규칙이면 거절됩니다. 그때는 예전 모양으로 한 번 더 올립니다. */
                try { await write(false); } catch (error) {
                    if (!String(error?.code || '').includes('permission-denied')) throw error;
                    await write(true);
                }
                nextHashes['settings/device'] = mark;
            } catch (error) {
                /* 설정 문서를 모르는 옛 규칙의 거절은 다른 기록을 막지 않습니다. 그 밖의 실패는 다시 올립니다. */
                if (classifyWriteError(error) === 'pending') pending += 1;
            }
        }
    }

    /* 오늘 조퇴 시각: settings/leave 한 문서. 클라우드 값을 읽어 더 늦게 고친 쪽만 남깁니다(같으면 그대로). */
    let rawLeave = leaveState();
    /* 오랫동안 오프라인이던 기기: 규칙은 2일보다 오래된 at을 영구히 거절합니다.
       오늘 조퇴면 지금 시각으로 다시 찍어 보내고, 오늘이 아니면 올리지 않고 지웁니다. */
    if (rawLeave.date) {
        const today = new Date(leaveNow() + 9 * 3600 * 1000).toISOString().slice(0, 10);
        if (rawLeave.date !== today) { clearLeave(); rawLeave = leaveState(); }
        else if (rawLeave.at > 0 && rawLeave.at < leaveNow() - LEAVE_MAX_AGE + 10 * 60 * 1000) {
            setLeave(rawLeave.date, rawLeave.hm);
            rawLeave = leaveState();
        }
    }
    let leave = cleanLeave(rawLeave);
    /* 예전 모양(at 없음) 로컬 값: 클라우드에 조퇴 문서가 없을 때만 지금 시각으로 올립니다(있으면 클라우드 값이 이깁니다). */
    const legacyLeave = !leave && !rawLeave.at && Boolean(rawLeave.date && rawLeave.hm);
    if (legacyLeave) leave = { d: rawLeave.date, t: rawLeave.hm, at: leaveNow() };
    if (leave) {
        const mark = legacyLeave ? fingerprint({ legacy: rawLeave }) : fingerprint(leave);
        const leaveBackoff = readLeaveBackoff();
        const resting = leaveBackoff.mark === mark && Date.now() < leaveBackoff.until;
        if (nextHashes['settings/leave'] !== mark && !resting) {
            try {
                const ref = doc(ready.db, 'users', uid, 'settings', 'leave');
                let wrote = false;
                await firestore.runTransaction(ready.db, async (tx) => {
                    const snap = await tx.get(ref);
                    const theirs = snap.exists() ? cleanLeave(snap.data()) : null;
                    if (theirs && (legacyLeave || theirs.at >= leave.at)) return;
                    tx.set(ref, await stamp(firestore, leave, ['updatedAt']));
                    wrote = true;
                });
                if (legacyLeave && wrote) setLeave(leave.d, leave.t, { at: leave.at, fromCloud: true });
                nextHashes['settings/leave'] = legacyLeave && wrote ? fingerprint(leave) : mark;
                writeLeaveBackoff(null);
            } catch (error) {
                const kind = classifyWriteError(error);
                if (kind === 'rejected') {
                    /* 거절은 실패로 알립니다(조용히 ok 처리하지 않음). */
                    rejected.push('settings/leave');
                    const wait = leaveBackoff.mark === mark ? Math.min(leaveBackoff.wait * 2, LEAVE_MAX_WAIT) : 5 * 60 * 1000;
                    writeLeaveBackoff({ mark, until: Date.now() + wait, wait });
                } else pending += 1;
            }
        }
    }

    /* 하단 탭바 배치: settings/tabbar 한 문서. 한 번이라도 고친 기기만 올리고, 클라우드가 더 늦게 고친 값이면 덮지 않습니다. */
    const tabbar = cleanTabbar(tabState());
    if (tabbar) {
        const mark = fingerprint(tabbar);
        if (nextHashes['settings/tabbar'] !== mark) {
            try {
                const ref = doc(ready.db, 'users', uid, 'settings', 'tabbar');
                await firestore.runTransaction(ready.db, async (tx) => {
                    const snap = await tx.get(ref);
                    const theirs = snap.exists() ? cleanTabbar(snap.data()) : null;
                    if (theirs && theirs.at >= tabbar.at) return;
                    tx.set(ref, await stamp(firestore, tabbar, ['updatedAt']));
                });
                nextHashes['settings/tabbar'] = mark;
            } catch (error) {
                /* 탭바 문서를 모르는 옛 규칙의 거절은 다른 기록을 막지 않습니다(설정 문서와 같음). 그 밖의 실패는 다시 올립니다. */
                if (classifyWriteError(error) === 'pending') pending += 1;
            }
        }
    }

    /* 할 일 하루 목표·달성 기록: settings/goal 한 문서(PR C). 클라우드 값과 합친 뒤(목표는 늦게 고친 쪽, 날짜마다 늦게 고친 쪽) 달라졌을 때만 씁니다. */
    const goalDoc = toGoalDoc(state.goals);
    if (goalDoc) {
        const mark = fingerprint(goalDoc);
        if (nextHashes['settings/goal'] !== mark) {
            try {
                const ref = doc(ready.db, 'users', uid, 'settings', 'goal');
                await firestore.runTransaction(ready.db, async (tx) => {
                    const snap = await tx.get(ref);
                    const theirs = snap.exists() ? fromGoalDoc(snap.data()) : null;
                    const merged = toGoalDoc(mergeGoals(state.goals, theirs));
                    const same = theirs && JSON.stringify(toGoalDoc(theirs)) === JSON.stringify(merged);
                    if (!merged || same) return;
                    tx.set(ref, await stamp(firestore, merged, ['updatedAt']));
                });
                nextHashes['settings/goal'] = mark;
            } catch (error) {
                /* 목표 문서를 모르는 옛 규칙의 거절은 다른 기록을 막지 않습니다(탭바 문서와 같음). 그 밖의 실패는 다시 올립니다. */
                if (classifyWriteError(error) === 'pending') pending += 1;
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
        ats: { attendance: {}, todos: {} },
        /* 고친 시각이 불확실한 할 일(v46이 쓴 것, 시각을 못 잰 기기가 올린 것). 올린 시각일 뿐이라 '나중'을 믿지 않습니다. */
        soft: { todos: {} },
        /* 모든 목록을 서버에서 받았으면 true. 캐시에서 온 옛 목록이면 칩이 '동기화됨'을 보이지 않습니다. */
        fresh: true,
    };
    try {
        const set = await getDoc(doc(ready.db, 'users', uid, 'settings', 'device'));
        if (set.exists()) out.settings = fromCloudSettings(set.data());
    } catch {
        /* 규칙을 올리기 전에는 읽기가 거절됩니다. 나머지는 그대로 받습니다. */
    }
    try {
        const leaveSnap = await getDoc(doc(ready.db, 'users', uid, 'settings', 'leave'));
        if (leaveSnap.exists()) out.leave = cleanLeave(leaveSnap.data());
    } catch {
        /* 조퇴 문서를 모르는 옛 규칙이면 거절됩니다. */
    }
    try {
        const tabSnap = await getDoc(doc(ready.db, 'users', uid, 'settings', 'tabbar'));
        if (tabSnap.exists()) out.tabbar = cleanTabbar(tabSnap.data());
    } catch {
        /* 탭바 문서를 모르는 옛 규칙이면 거절됩니다. 이 기기 배치는 그대로 둡니다. */
    }
    try {
        const goalSnap = await getDoc(doc(ready.db, 'users', uid, 'settings', 'goal'));
        if (goalSnap.exists()) out.goal = fromGoalDoc(goalSnap.data());
    } catch {
        /* 목표 문서를 모르는 옛 규칙이면 거절됩니다. 이 기기 목표는 그대로 둡니다. */
    }
    for (const [localName, cloudName] of COLLECTIONS) {
        const snap = await getDocs(collection(ready.db, 'users', uid, cloudName));
        /* 캐시에서 온 결과로는 지우기를 하지 않습니다. 서버에서 받은 목록만 ids에 둡니다. */
        const ids = serverIds(snap);
        if (ids) out.ids[cloudName] = ids;
        else out.fresh = false;
        snap.forEach((item) => {
            const data = item.data();
            const row = fromCloudRow(cloudName, item.id, data);
            if (row) out[localName].push(row);
            if ((cloudName === 'attendance' || cloudName === 'todos') && typeof data?.updatedAt?.toMillis === 'function') out.ats[cloudName][item.id] = data.updatedAt.toMillis();
            if (cloudName === 'todos' && softDoc(data)) out.soft.todos[item.id] = true;
        });
    }
    /* 지운 표시(묘비): 다른 기기가 지운 할 일과 지운 시각. 규칙을 올리기 전에는 읽기가 거절되므로 없는 것으로 봅니다. */
    out.tombs = { todos: {} };
    try {
        const tombs = await getDocs(collection(ready.db, 'users', uid, 'tombs'));
        tombs.forEach((item) => {
            const t = tombFromDoc(item.id, item.data());
            if (t) out.tombs[t.name][t.id] = t.at;
        });
    } catch { /* 옛 규칙 */ }
    const table = await getDocs(collection(ready.db, 'users', uid, 'timetable'));
    table.forEach((item) => {
        const row = fromCloudRow('timetable', item.id, item.data());
        if (row) out.timetable[item.id] = row;
    });
    return out;
}

/* 묘비 문서: users/{uid}/tombs/todos-{id} = { k: 'todos', at: 지운 시각 } */
/* 묘비는 TOMB_KEEP_MS(30일) 동안 둡니다. 그보다 오래 오프라인이던 기기의 옛 수정만 되살아날 수 있습니다. */
export const TOMB_KEEP_MS = 30 * 86400000;
/** 오래된 묘비를 지웁니다. 서버 시각(now)을 잰 기기에서만 부릅니다. 지운 개수. */
export async function sweepTombs(uid, now, { memoryOnly = false, keep = TOMB_KEEP_MS, max = 200 } = {}) {
    if (!uid || !Number.isFinite(now) || !syncAvailable()) return 0;
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return 0;
    const { collection, deleteDoc, doc, getDocsFromServer, limit, orderBy, query, where, Timestamp } = await import('firebase/firestore');
    try {
        const old = await timeout(getDocsFromServer(query(collection(ready.db, 'users', uid, 'tombs'), where('at', '<', Timestamp.fromMillis(now - keep)), orderBy('at'), limit(max))), 10000);
        let n = 0;
        for (const item of old.docs) { await deleteDoc(doc(ready.db, 'users', uid, 'tombs', item.id)); n += 1; }
        return n;
    } catch { return 0; }
}
export function tombId(name, id) { return `${name}-${id}`; }
export function tombFromDoc(docId, data) {
    const m = /^(todos)-([A-Za-z0-9_-]{1,40})$/.exec(String(docId || ''));
    const at = typeof data?.at?.toMillis === 'function' ? data.at.toMillis() : NaN;
    if (!m || data?.k !== m[1] || !Number.isFinite(at)) return null;
    return { name: m[1], id: m[2], at };
}

const timeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error('timeout'), { code: 'deadline-exceeded' })), ms))]);

/**
 * 서버 시각 - 기기 시계(ms). 계정 문서의 updatedAt에 서버 시각을 찍고 서버에서 다시 읽어 견줍니다.
 * 기기 시계가 몇 분~몇 시간 어긋나도 할 일의 '마지막 수정' 비교가 흔들리지 않게 합니다(PR #56 검수 2번). 못 재면 null.
 */
export async function measureServerClock(uid, { memoryOnly = false, now = () => Date.now(), wait = 5000 } = {}) {
    if (!uid || !syncAvailable()) return null;
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return null;
    const { doc, setDoc, getDocFromServer, serverTimestamp } = await import('firebase/firestore');
    const ref = doc(ready.db, 'users', uid);
    try {
        const t0 = now();
        await timeout(setDoc(ref, { updatedAt: serverTimestamp() }, { merge: true }), wait);
        const t1 = now();
        const snap = await timeout(getDocFromServer(ref), wait);
        const ms = snap.data()?.updatedAt?.toMillis?.();
        /* 쓰기 왕복이 길면(느린 망) 오차가 커서 쓰지 않습니다. */
        if (!Number.isFinite(ms) || t1 - t0 > wait) return null;
        return ms - (t0 + t1) / 2;
    } catch {
        return null;
    }
}

/**
 * 올리기 전에 이 기기에서 고친 할 일의 클라우드 상태를 서버에서 바로 봅니다.
 * { [id]: { row, at } }(문서 있음) 또는 { [id]: { gone: 지운 시각|null } }(문서 없음). 서버에 닿지 못하면 null.
 */
export async function peekTodos(uid, ids = [], { memoryOnly = false } = {}) {
    if (!uid || !ids.length || !syncAvailable()) return null;
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return null;
    const { doc, getDocFromServer } = await import('firebase/firestore');
    const out = {};
    try {
        for (const id of ids) {
            const snap = await getDocFromServer(doc(ready.db, 'users', uid, 'todos', String(id)));
            if (snap.exists()) {
                const data = snap.data();
                const at = data?.updatedAt?.toMillis?.();
                out[id] = { row: fromCloudRow('todos', String(id), data), at: Number.isFinite(at) ? at : null, soft: softDoc(data) };
                continue;
            }
            let gone = null;
            try {
                const tomb = await getDocFromServer(doc(ready.db, 'users', uid, 'tombs', tombId('todos', id)));
                gone = tomb.exists() ? tombFromDoc(tomb.id, tomb.data())?.at ?? null : null;
            } catch { /* 옛 규칙: 지운 시각을 모름 */ }
            out[id] = { gone };
        }
    } catch {
        return null;
    }
    return out;
}

/**
 * 다른 기기가 할 일을 고치면 바로 알려 줍니다(PR #62 r3 1번). 첫 목록과 이 기기가 막 쓴 변경(hasPendingWrites)은 건너뜁니다.
 * 받은 내용으로 직접 합치지 않고, 알림만 보내 평소 받기(refreshFromCloud)로 합칩니다. 끄는 함수를 돌려줍니다.
 */
export async function watchTodos(uid, onChange, { memoryOnly = false } = {}) {
    if (!uid || typeof onChange !== 'function' || !syncAvailable()) return () => {};
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return () => {};
    const { collection, doc, onSnapshot } = await import('firebase/firestore');
    let first = true;
    try {
        const offTodos = onSnapshot(collection(ready.db, 'users', uid, 'todos'), (snap) => {
            if (first) { first = false; return; }
            if (snap.metadata.hasPendingWrites || snap.metadata.fromCache) return;
            if (snap.docChanges().length) onChange();
        }, () => { /* 끊기면 평소처럼 돌아올 때·5분마다 받습니다. */ });
        /* 오늘 조퇴 시각(문서 하나)도 실시간으로 봅니다. */
        let firstLeave = true;
        const offLeave = onSnapshot(doc(ready.db, 'users', uid, 'settings', 'leave'), (snap) => {
            if (firstLeave) { firstLeave = false; return; }
            if (snap.metadata.hasPendingWrites || snap.metadata.fromCache) return;
            onChange();
        }, () => {});
        return () => { offTodos(); offLeave(); };
    } catch {
        return () => {};
    }
}

/** 고친 시각이 불확실한 할 일 문서인지: hlc가 없거나(v46·옛 자료) u가 true(시각을 못 잰 기기). */
export function softDoc(data) { return !data?.hlc || data.u === true; }

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
    /* 지운 시각을 모르는 할 일(서버 시각을 못 잰 기기): 마지막으로 알던 내용 그대로일 때만 지웁니다. 다른 기기가 고쳤으면 남깁니다. */
    if (name === 'todos' && !Number.isFinite(notAfter)) {
        if (!expect) return false;
        const row = fromCloudRow(name, String(id), data);
        const mark = row ? rowMark(name, row) : null;
        return !(mark && String(expect).split(',').filter(Boolean).includes(printDigest(mark.mark)));
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
    /* 할 일은 지운 시각을 묘비로 남깁니다. 오프라인에서 그보다 먼저 고친 기기가 나중에 올려도 되살아나지 않게 합니다(검수 3번).
       묘비를 못 쓰면(옛 규칙) 예전처럼 지우기만 합니다. */
    if (opts.tomb) { try { await opts.tomb(); } catch { /* 옛 규칙 */ } }
    await del();
    return { ok: true };
}

export async function deleteUserDoc(uid, name, id, { memoryOnly = false, notAfter = null, expect = null } = {}) {
    if (!uid || !name || !id || !syncAvailable()) return { skipped: true };
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return { skipped: true };
    try {
        const { doc, deleteDoc, getDocFromServer, setDoc, Timestamp, serverTimestamp } = await import('firebase/firestore');
        const ref = doc(ready.db, 'users', uid, name, String(id));
        /* 지운 시각을 모르면(서버 시각을 못 잰 기기) 서버가 받은 시각으로 묘비를 남깁니다. */
        const tomb = name === 'todos'
            ? () => timeout(setDoc(doc(ready.db, 'users', uid, 'tombs', tombId('todos', id)), { k: 'todos', at: Number.isFinite(notAfter) && notAfter > 0 ? Timestamp.fromMillis(notAfter) : serverTimestamp() }), 5000)
            : null;
        return await guardedDelete({
            get: async () => { const snap = await getDocFromServer(ref); return snap.exists() ? snap.data() : null; },
            del: () => deleteDoc(ref),
        }, name, id, { notAfter, expect, tomb });
    } catch {
        return { ok: false };
    }
}

export async function watchAuth(onUser, { memoryOnly = false } = {}) {
    if (!syncAvailable()) return () => {};
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return () => {};
    // redirect 결과 대기와 observer 등록을 분리합니다. 오류는 로그인 안내로 전달합니다.
    void finishRedirectSignIn().catch((error) => {
        window.dispatchEvent(new CustomEvent('ssug-auth-error', { detail: { code: error?.code || 'auth/redirect-failed' } }));
    });
    const { onAuthStateChanged } = await import('firebase/auth');
    return onAuthStateChanged(ready.auth, (user) => {
        onUser(user ? { uid: user.uid, name: user.displayName || '', email: user.email || '' } : null);
    });
}
