import { useEffect, useState } from 'react';
import {
    addDoc,
    deleteDoc,
    onSnapshot,
    serverTimestamp,
    setDoc,
    updateDoc,
} from 'firebase/firestore';
import { auth } from '../firebase';
import { isDeviceOnlyList, RECORD_COLLECTIONS } from './collections.js';
import { userCol, userDoc } from './firestorePaths.js';
import { readLocalList, readLocalObject, writeLocalList, writeLocalObject } from './localData.js';
import { ensureUserData } from './migrateUser.js';
import { reportSaveFailure } from './saveNotice.js';
import { isLocalOnlyPage, pageFromNotebookDoc } from './sensitive.js';

const CLOUD_SAVE_ERROR = '클라우드에 저장하지 못했습니다.';
const LOCAL_SAVE_ERROR = '이 기기에 저장하지 못했습니다.';

async function cloudWrite(action, retry) {
    try {
        return await action();
    } catch (err) {
        console.error(err);
        reportSaveFailure({ message: CLOUD_SAVE_ERROR, retry });
        throw err;
    }
}

function localWrite(ok, retry) {
    if (ok) return true;
    reportSaveFailure({ message: LOCAL_SAVE_ERROR, retry });
    return false;
}

function cloudUid(name, signedIn) {
    if (!signedIn || isDeviceOnlyList(name)) return null;
    return auth.currentUser?.uid || null;
}

/** 로그인 시 내 계정 Firestore, 비로그인·상담 기록은 localStorage 입니다. */
export function useSharedList(name, enabled, revision = 0) {
    const [items, setItems] = useState(() => readLocalList(name));
    const [ready, setReady] = useState(!enabled);

    useEffect(() => {
        let cancel = false;
        let unsub = () => {};
        const reloadLocal = () => {
            if (!cancel) setItems(readLocalList(name));
        };
        const onLocal = (event) => {
            if (event.detail?.name === name) reloadLocal();
        };
        window.addEventListener('nb-shared-list', onLocal);

        (async () => {
            const uid = enabled ? auth.currentUser?.uid || null : null;
            if (uid) {
                try {
                    await ensureUserData(uid);
                } catch (err) {
                    console.error(err);
                }
            }
            if (cancel) return;
            if (!uid || isDeviceOnlyList(name)) {
                reloadLocal();
                setReady(true);
                return undefined;
            }
            unsub = onSnapshot(
                userCol(uid, name),
                (snap) => {
                    const next = snap.docs.map((item) => ({ id: item.id, ...item.data() }));
                    setItems(next);
                    writeLocalList(name, next);
                    setReady(true);
                },
                (err) => {
                    console.error(err);
                    reloadLocal();
                    setReady(true);
                },
            );
            return undefined;
        })();

        return () => {
            cancel = true;
            window.removeEventListener('nb-shared-list', onLocal);
            unsub();
        };
    }, [name, enabled, revision]);

    return { items, ready };
}

export async function addItem(name, data, signedIn) {
    const uid = cloudUid(name, signedIn);
    if (uid) {
        return cloudWrite(async () => {
            const ref = await addDoc(userCol(uid, name), { ...data, createdAt: serverTimestamp() });
            return ref.id;
        }, () => addItem(name, data, signedIn));
    }
    const items = readLocalList(name);
    const id = `local-${Date.now()}`;
    localWrite(
        writeLocalList(name, [{ id, ...data, createdAt: new Date().toISOString() }, ...items]),
        () => addItem(name, data, signedIn),
    );
    return id;
}

export async function patchItem(name, id, data, signedIn) {
    const uid = cloudUid(name, signedIn);
    if (uid) {
        await cloudWrite(
            () => updateDoc(userDoc(uid, name, id), data),
            () => patchItem(name, id, data, signedIn),
        );
        return;
    }
    localWrite(
        writeLocalList(name, readLocalList(name).map((row) => (row.id === id ? { ...row, ...data } : row))),
        () => patchItem(name, id, data, signedIn),
    );
}

export async function removeItem(name, id, signedIn) {
    const uid = cloudUid(name, signedIn);
    if (uid) {
        await cloudWrite(
            () => deleteDoc(userDoc(uid, name, id)),
            () => removeItem(name, id, signedIn),
        );
        return;
    }
    localWrite(
        writeLocalList(name, readLocalList(name).filter((row) => row.id !== id)),
        () => removeItem(name, id, signedIn),
    );
}

/** 로그인 시 내 계정의 문서 하나, 손님은 localStorage 객체입니다. */
export function useSharedRecord(name, enabled, revision = 0) {
    const [record, setRecord] = useState(() => readLocalObject(name));
    const recordId = RECORD_COLLECTIONS.find((row) => row.name === name)?.id || 'board';

    useEffect(() => {
        const reload = () => setRecord(readLocalObject(name));
        const onLocal = (event) => {
            if (event.detail?.name === name) reload();
        };
        window.addEventListener('nb-shared-record', onLocal);
        let unsub = () => {};
        let cancel = false;
        (async () => {
            const uid = enabled ? auth.currentUser?.uid || null : null;
            if (uid) {
                try {
                    await ensureUserData(uid);
                } catch (err) {
                    console.error(err);
                }
            }
            if (cancel) return;
            if (!uid) {
                reload();
                return;
            }
            unsub = onSnapshot(
                userDoc(uid, name, recordId),
                (snap) => {
                    if (!snap.exists()) {
                        setRecord(readLocalObject(name));
                        return;
                    }
                    const next = snap.data() || {};
                    setRecord(next);
                    writeLocalObject(name, next);
                },
                (err) => {
                    console.error(err);
                    setRecord(readLocalObject(name));
                },
            );
        })();
        return () => {
            cancel = true;
            window.removeEventListener('nb-shared-record', onLocal);
            unsub();
        };
    }, [name, enabled, revision, recordId]);

    return record;
}

export async function saveRecord(name, data, signedIn) {
    const next = { ...data };
    const uid = cloudUid(name, signedIn);
    localWrite(writeLocalObject(name, next), () => saveRecord(name, data, signedIn));
    if (!uid) return;
    const recordId = RECORD_COLLECTIONS.find((row) => row.name === name)?.id || 'board';
    await cloudWrite(
        () => setDoc(userDoc(uid, name, recordId), {
            ...next,
            updatedAt: serverTimestamp(),
        }, { merge: true }),
        () => saveRecord(name, data, signedIn),
    );
}

export async function upsertDoc(name, id, data, signedIn) {
    if (name === 'notebookFields' && isLocalOnlyPage(pageFromNotebookDoc(id, data))) return;
    const uid = cloudUid(name, signedIn);
    if (uid) {
        await cloudWrite(
            () => setDoc(userDoc(uid, name, id), { ...data, updatedAt: serverTimestamp() }, { merge: true }),
            () => upsertDoc(name, id, data, signedIn),
        );
        return;
    }
    const items = readLocalList(name);
    const idx = items.findIndex((row) => row.id === id);
    if (idx >= 0) items[idx] = { ...items[idx], ...data };
    else items.push({ id, ...data });
    localWrite(writeLocalList(name, items), () => upsertDoc(name, id, data, signedIn));
}
