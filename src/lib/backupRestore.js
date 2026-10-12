import { getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth } from '../firebase';
import { BACKUP_LISTS, splitInbox } from './backupFormat.js';
import { isDeviceOnlyList, NOTEBOOK_COLLECTION, RECORD_COLLECTIONS } from './collections.js';
import { clearAllPageFields, notifyPage, writePageFields } from './fieldLocal.js';
import { runBatchOps } from './firestoreBatch.js';
import { userCol, userDoc } from './firestorePaths.js';
import { writeLocalList, writeLocalObject } from './localData.js';
import { ensureMigrationMarker, ensureUserData } from './migrateUser.js';
import { asDocBody, asDocId } from './plain.js';
import { isLocalOnlyPage } from './sensitive.js';
import { mergeSensitiveNotes, writeSensitiveNotes } from './sensitiveLocal.js';

function withId(row, index, prefix) {
    const id = asDocId(row?.id, `${prefix}-${index + 1}`);
    return { ...row, id };
}

async function replaceCloudDocs(uid, name, rows) {
    const snap = await getDocs(userCol(uid, name));
    const ops = [];
    const nextIds = new Set();
    rows.forEach((row, index) => {
        const id = asDocId(row?.id, `restore-${name}-${index + 1}`);
        if (!id || nextIds.has(id)) return;
        nextIds.add(id);
        ops.push((batch) => batch.set(userDoc(uid, name, id), asDocBody(row)));
    });
    for (const item of snap.docs) {
        if (!nextIds.has(item.id)) ops.push((batch) => batch.delete(item.ref));
    }
    await runBatchOps(ops);
}

/**
 * 파일에 들어 있는 항목만 덮어씁니다.
 * 건강·민원·학폭·상담은 클라우드에 쓰지 않고 이 기기 localStorage 만 바꿉니다.
 */
export async function applyBackup(data, { signedIn = false } = {}) {
    const uid = signedIn ? auth.currentUser?.uid : null;
    if (uid) {
        try {
            await ensureUserData(uid);
        } catch (err) {
            console.error(err);
        }
    }

    for (const row of BACKUP_LISTS) {
        if (!(row.key in data)) continue;
        if (row.key === 'inbox') {
            const { cloud, device } = splitInbox(data.inbox);
            const cloudRows = cloud.map((item, index) => withId(item, index, 'inbox'));
            writeLocalList(row.collection, cloudRows);
            if (uid) await replaceCloudDocs(uid, row.collection, cloudRows);
            const deviceRows = device.map((item, index) => ({
                ...withId(item, index, 'sensitive'),
                sensitive: true,
            }));
            if ('ssugeokSensitive' in data) {
                const own = data.ssugeokSensitive.map((item, index) => ({
                    ...withId(item, index, 'sensitive'),
                    sensitive: true,
                }));
                writeSensitiveNotes(dedupe([...own, ...deviceRows]));
            } else if (deviceRows.length) {
                mergeSensitiveNotes(deviceRows);
            }
            continue;
        }
        const items = data[row.key].map((item, index) => withId(item, index, row.key));
        writeLocalList(row.collection, items);
        if (uid && !isDeviceOnlyList(row.collection)) {
            await replaceCloudDocs(uid, row.collection, items);
        }
        if (uid && isDeviceOnlyList(row.collection)) {
            const snap = await getDocs(userCol(uid, row.collection));
            await runBatchOps(snap.docs.map((item) => (batch) => batch.delete(item.ref)));
        }
    }

    if (!('inbox' in data) && 'ssugeokSensitive' in data) {
        writeSensitiveNotes(dedupe(data.ssugeokSensitive.map((item, index) => ({
            ...withId(item, index, 'sensitive'),
            sensitive: true,
        }))));
    }

    if ('notebookFields' in data) {
        clearAllPageFields({ notify: false });
        const cloudRows = [];
        for (const [pageKey, fields] of Object.entries(data.notebookFields || {})) {
            const page = Number(pageKey);
            writePageFields(page, fields, { notify: false });
            if (isLocalOnlyPage(page)) continue;
            cloudRows.push({ id: `p${page}`, fields, page });
        }
        if (uid) await replaceCloudDocs(uid, NOTEBOOK_COLLECTION, cloudRows);
        notifyPage('*');
    }

    if ('praiseBoard' in data) {
        const record = data.praiseBoard || {};
        writeLocalObject('praiseBoard', record);
        if (uid) {
            const spec = RECORD_COLLECTIONS[0];
            await setDoc(userDoc(uid, spec.name, spec.id), {
                ...asDocBody(record),
                updatedAt: serverTimestamp(),
            });
        }
    }

    if (uid) {
        try {
            await ensureMigrationMarker(uid, 'json-backup');
        } catch (err) {
            console.error(err);
        }
    }
}

function dedupe(items) {
    const seen = new Set();
    const out = [];
    for (const item of items) {
        if (!item?.id || seen.has(item.id)) continue;
        seen.add(item.id);
        out.push(item);
    }
    return out;
}

