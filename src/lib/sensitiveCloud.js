import { collection, deleteDoc, getDocs } from 'firebase/firestore';
import { DEVICE_ONLY_LISTS } from './collections.js';
import { fillPageFieldsIfEmpty } from './fieldLocal.js';
import { mergeLocalList } from './localData.js';
import { plainValue } from './plain.js';
import { isLocalOnlyPage, isSensitiveNote, pageFromNotebookDoc } from './sensitive.js';
import { mergeSensitiveNotes } from './sensitiveLocal.js';

function userCollection(db, appId, uid, name) {
    return collection(db, 'artifacts', appId, 'users', uid, name);
}

function rowFromDoc(snap) {
    return plainValue({ id: snap.id, ...snap.data() });
}

/** 계정 문서만 하나씩 지웁니다. 예전 공개 경로는 건드리지 않습니다. */
async function deleteOwnDocs(docs) {
    for (const item of docs) {
        await deleteDoc(item.ref);
    }
}

/**
 * 내 계정 클라우드에 있는 상담·민감 기록을 이 기기로 내리고, 그 계정 문서만 지웁니다.
 * 규칙이 허용하는 본인 문서만 삭제하므로, 거절되는 경로와 한 배치에 섞지 않습니다.
 */
export async function pullSensitiveToDevice(db, appId, uid) {
    const moved = { counselNotes: 0, inbox: 0, pages: 0 };
    if (!db || !uid) return moved;

    for (const name of DEVICE_ONLY_LISTS) {
        const snap = await getDocs(userCollection(db, appId, uid, name));
        if (snap.empty) continue;
        mergeLocalList(name, snap.docs.map(rowFromDoc));
        await deleteOwnDocs(snap.docs);
        moved.counselNotes += snap.size;
    }

    const inbox = await getDocs(userCollection(db, appId, uid, 'ssugeokInbox'));
    const leaked = inbox.docs.filter((item) => isSensitiveNote(rowFromDoc(item)));
    if (leaked.length) {
        mergeSensitiveNotes(leaked.map(rowFromDoc));
        await deleteOwnDocs(leaked);
        moved.inbox = leaked.length;
    }

    const pages = await getDocs(userCollection(db, appId, uid, 'notebookFields'));
    const localPages = pages.docs.filter((item) => isLocalOnlyPage(pageFromNotebookDoc(item.id, item.data())));
    for (const item of localPages) {
        const data = item.data() || {};
        const page = pageFromNotebookDoc(item.id, data);
        fillPageFieldsIfEmpty(page, plainValue(data.fields));
    }
    if (localPages.length) {
        await deleteOwnDocs(localPages);
        moved.pages = localPages.length;
    }
    return moved;
}
