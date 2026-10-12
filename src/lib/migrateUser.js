import { getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { appId, db } from '../firebase';
import { LIST_COLLECTIONS, NOTEBOOK_COLLECTION, RECORD_COLLECTIONS } from './collections.js';
import { listLocalNotebookPages, fillPageFieldsIfEmpty } from './fieldLocal.js';
import { runBatchOps } from './firestoreBatch.js';
import { userCol, userDoc } from './firestorePaths.js';
import { readLocalList, readLocalObject } from './localData.js';
import { asDocBody, asDocId, plainValue } from './plain.js';
import { isLocalOnlyPage, isSensitiveNote } from './sensitive.js';
import { mergeSensitiveNotes } from './sensitiveLocal.js';
import { pullSensitiveToDevice } from './sensitiveCloud.js';

const inflight = new Map();

function isRetryable(err) {
    const code = String(err?.code || '');
    return code === 'permission-denied' || code === 'unavailable' || code === 'unauthenticated';
}

/** 클라우드 목록이 비어 있을 때만 이 기기 목록을 올립니다. 상담·민감 메모는 올리지 않습니다. */
async function pushLocalListIfCloudEmpty(uid, name) {
    if (name === 'counselNotes') return 0;
    const snap = await getDocs(userCol(uid, name));
    if (!snap.empty) return 0;
    let local = readLocalList(name);
    if (name === 'ssugeokInbox') {
        const device = [];
        const cloud = [];
        for (const row of local) {
            if (isSensitiveNote(row)) device.push(row);
            else cloud.push(row);
        }
        mergeSensitiveNotes(device);
        local = cloud;
    }
    const ops = [];
    for (const row of local) {
        const id = asDocId(row?.id);
        if (!id) continue;
        ops.push((batch) => batch.set(userDoc(uid, name, id), asDocBody(row)));
    }
    await runBatchOps(ops);
    return ops.length;
}

async function pushRecordIfMissing(uid, name, id) {
    const ref = userDoc(uid, name, id);
    const snap = await getDoc(ref);
    if (snap.exists()) return 0;
    const local = readLocalObject(name);
    if (!Object.keys(local).length) return 0;
    await setDoc(ref, { ...asDocBody(local), updatedAt: serverTimestamp() });
    return 1;
}

/** 없는 쪽만 올리고, 기기가 비어 있는 일반 쪽만 내려 받습니다. 민감 쪽은 올리지 않습니다. */
async function syncNotebook(uid) {
    const snap = await getDocs(userCol(uid, NOTEBOOK_COLLECTION));
    const have = new Set(snap.docs.map((item) => item.id));
    const uploads = [];
    for (const { page, fields } of listLocalNotebookPages()) {
        if (isLocalOnlyPage(page)) continue;
        const id = `p${page}`;
        if (have.has(id)) continue;
        uploads.push((batch) => batch.set(userDoc(uid, NOTEBOOK_COLLECTION, id), { fields, page }));
    }
    await runBatchOps(uploads);

    for (const item of snap.docs) {
        const data = item.data() || {};
        const page = Number(data.page);
        if (!Number.isFinite(page) || isLocalOnlyPage(page)) continue;
        fillPageFieldsIfEmpty(page, plainValue(data.fields));
    }
}

async function run(uid) {
    try {
        for (const name of LIST_COLLECTIONS) {
            await pushLocalListIfCloudEmpty(uid, name);
        }
        for (const record of RECORD_COLLECTIONS) {
            await pushRecordIfMissing(uid, record.name, record.id);
        }
        await syncNotebook(uid);
        await pullSensitiveToDevice(db, appId, uid);
    } catch (err) {
        if (isRetryable(err)) {
            console.warn('계정 저장소를 아직 맞추지 못했습니다. 연결을 확인한 뒤 다시 열어 주세요.', err);
            return;
        }
        throw err;
    }
}

/** 로그인 세션마다 한 번, 내 계정과 이 기기의 민감 기록을 맞춥니다. 예전 공개 경로는 읽지 않습니다. */
export function ensureUserData(uid) {
    if (!uid) return Promise.resolve();
    if (!inflight.has(uid)) {
        const job = run(uid).catch((err) => {
            inflight.delete(uid);
            throw err;
        });
        inflight.set(uid, job);
    }
    return inflight.get(uid);
}
