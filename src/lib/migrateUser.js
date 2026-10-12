import { getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { appId } from '../firebase';
import {
    DEVICE_ONLY_LISTS,
    LIST_COLLECTIONS,
    META_COLLECTION,
    MIGRATION_ID,
    NOTEBOOK_COLLECTION,
    RECORD_COLLECTIONS,
} from './collections.js';
import { listLocalNotebookPages, fillPageFieldsIfEmpty } from './fieldLocal.js';
import { runBatchOps } from './firestoreBatch.js';
import { legacyCol, userCol, userDoc } from './firestorePaths.js';
import { mergeLocalList, readLocalList, readLocalObject } from './localData.js';
import { asDocBody, asDocId, plainValue } from './plain.js';
import { isLocalOnlyPage, isSensitiveNote, pageFromNotebookDoc } from './sensitive.js';
import { mergeSensitiveNotes } from './sensitiveLocal.js';

const inflight = new Map();

function isRetryable(err) {
    const code = String(err?.code || '');
    return code === 'permission-denied' || code === 'unavailable' || code === 'unauthenticated';
}

function rowFromDoc(snap) {
    return plainValue({ id: snap.id, ...snap.data() });
}

/**
 * 예전 artifacts/{appId}/public/data 를 계정 공간으로 한 번 복사합니다.
 * 예전 문서는 지우지 않습니다. 민감·상담 기록은 클라우드 복사본을 만들지 않고 기기로만 내립니다.
 */
async function copyLegacy(uid) {
    const counts = {};
    for (const name of LIST_COLLECTIONS) {
        const snap = await getDocs(legacyCol(name));
        if (DEVICE_ONLY_LISTS.has(name)) {
            counts[name] = mergeLocalList(name, snap.docs.map(rowFromDoc));
            continue;
        }
        if (name === 'ssugeokInbox') {
            const device = [];
            const cloudDocs = [];
            for (const item of snap.docs) {
                const row = rowFromDoc(item);
                if (isSensitiveNote(row)) device.push(row);
                else cloudDocs.push(item);
            }
            counts.ssugeokSensitive = mergeSensitiveNotes(device);
            counts[name] = await copyMissingDocs(uid, name, cloudDocs);
            continue;
        }
        counts[name] = await copyMissingDocs(uid, name, snap.docs);
    }

    for (const record of RECORD_COLLECTIONS) {
        const snap = await getDocs(legacyCol(record.name));
        counts[record.name] = await copyMissingDocs(uid, record.name, snap.docs);
    }

    const pages = await getDocs(legacyCol(NOTEBOOK_COLLECTION));
    let notebookCloud = 0;
    let notebookDevice = 0;
    const cloudPages = [];
    for (const item of pages.docs) {
        const data = item.data() || {};
        const page = pageFromNotebookDoc(item.id, data);
        if (isLocalOnlyPage(page)) {
            if (fillPageFieldsIfEmpty(page, plainValue(data.fields))) notebookDevice += 1;
            continue;
        }
        cloudPages.push(item);
    }
    notebookCloud = await copyMissingDocs(uid, NOTEBOOK_COLLECTION, cloudPages);
    counts.notebookFields = notebookCloud;
    counts.notebookFieldsDevice = notebookDevice;
    return counts;
}

async function copyMissingDocs(uid, name, docs) {
    if (!docs?.length) return 0;
    const existing = await getDocs(userCol(uid, name));
    const have = new Set(existing.docs.map((item) => item.id));
    const ops = [];
    for (const item of docs) {
        if (!item?.id || have.has(item.id)) continue;
        const ref = userDoc(uid, name, item.id);
        const data = item.data();
        ops.push((batch) => batch.set(ref, data));
    }
    await runBatchOps(ops);
    return ops.length;
}

async function pushLocalListIfCloudEmpty(uid, name) {
    if (DEVICE_ONLY_LISTS.has(name)) return 0;
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

/** 비어 있는 클라우드 문서만 이 기기 값으로 채우고, 비어 있는 기기 쪽만 클라우드 값으로 채웁니다. */
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

    const deletions = [];
    for (const item of snap.docs) {
        const data = item.data() || {};
        const page = pageFromNotebookDoc(item.id, data);
        if (!page) continue;
        fillPageFieldsIfEmpty(page, plainValue(data.fields));
        if (!isLocalOnlyPage(page)) continue;
        deletions.push((batch) => batch.delete(item.ref));
    }
    await runBatchOps(deletions);
}

/** 계정 클라우드에 남은 상담·민감 기록을 기기로 내리고 그 복사본만 지웁니다. */
async function purgeSensitive(uid) {
    for (const name of DEVICE_ONLY_LISTS) {
        const snap = await getDocs(userCol(uid, name));
        if (snap.empty) continue;
        mergeLocalList(name, snap.docs.map(rowFromDoc));
        await runBatchOps(snap.docs.map((item) => (batch) => batch.delete(item.ref)));
    }

    const inbox = await getDocs(userCol(uid, 'ssugeokInbox'));
    const leaked = inbox.docs.filter((item) => isSensitiveNote(rowFromDoc(item)));
    if (leaked.length) {
        mergeSensitiveNotes(leaked.map(rowFromDoc));
        await runBatchOps(leaked.map((item) => (batch) => batch.delete(item.ref)));
    }

    const pages = await getDocs(userCol(uid, NOTEBOOK_COLLECTION));
    const localPages = pages.docs.filter((item) => isLocalOnlyPage(pageFromNotebookDoc(item.id, item.data())));
    if (localPages.length) {
        for (const item of localPages) {
            const data = item.data() || {};
            const page = pageFromNotebookDoc(item.id, data);
            fillPageFieldsIfEmpty(page, plainValue(data.fields));
        }
        await runBatchOps(localPages.map((item) => (batch) => batch.delete(item.ref)));
    }
}

async function markImported(uid, counts) {
    await setDoc(userDoc(uid, META_COLLECTION, MIGRATION_ID), {
        importedAt: serverTimestamp(),
        source: `artifacts/${appId}/public/data`,
        version: 1,
        counts,
        deletedLegacy: false,
    });
}

async function run(uid) {
    const markerRef = userDoc(uid, META_COLLECTION, MIGRATION_ID);
    let markerExists = false;
    try {
        const marker = await getDoc(markerRef);
        markerExists = marker.exists();
    } catch (err) {
        if (isRetryable(err)) {
            console.warn('계정 저장소를 아직 열지 못했습니다. 보안 규칙 배포 후 다시 로그인하면 이어집니다.', err);
            return;
        }
        throw err;
    }

    if (!markerExists) {
        try {
            const counts = await copyLegacy(uid);
            await markImported(uid, counts);
        } catch (err) {
            if (isRetryable(err)) {
                console.warn('예전 공유 기록을 아직 복사하지 못했습니다. 보안 규칙을 배포한 뒤 다시 열면 이어서 복사합니다. 예전 데이터는 지우지 않습니다.', err);
            } else {
                throw err;
            }
        }
    }

    for (const name of LIST_COLLECTIONS) {
        await pushLocalListIfCloudEmpty(uid, name);
    }
    for (const record of RECORD_COLLECTIONS) {
        await pushRecordIfMissing(uid, record.name, record.id);
    }
    await syncNotebook(uid);
    await purgeSensitive(uid);
}

/** 로그인 세션마다 한 번, 계정 공간을 준비하고 민감 기록을 기기에서만 다룹니다. */
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

/** 백업으로 덮어쓴 뒤에는 예전 공유 기록이 다시 섞이지 않게 표시만 남깁니다. */
export async function ensureMigrationMarker(uid, source) {
    if (!uid) return;
    const ref = userDoc(uid, META_COLLECTION, MIGRATION_ID);
    const snap = await getDoc(ref);
    if (snap.exists()) return;
    await setDoc(ref, {
        importedAt: serverTimestamp(),
        source,
        version: 1,
        deletedLegacy: false,
    });
}
