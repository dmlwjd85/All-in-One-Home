import { useEffect, useState } from 'react';
import { appId, loadFirebase } from '../firebase.js';
import { isLocalOnlyPage } from '../notebook/localPages.js';
import { reportSaveFailure } from './saveNotice.js';

const localKey = (name) => `homenote_v2_${name}`;

const readLocal = (name) => {
    try {
        const raw = localStorage.getItem(localKey(name));
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
};

const writeLocal = (name, items) => {
    try {
        localStorage.setItem(localKey(name), JSON.stringify(items));
    } catch (err) {
        console.warn('로컬 저장 실패', err);
        reportSaveFailure({
            message: '이 기기에 저장하지 못했습니다. 다시 시도해 주세요.',
            retry: () => writeLocal(name, items),
        });
    }
};

async function firestoreApi() {
    const { db } = await loadFirebase();
    const api = await import('firebase/firestore');
    return { db, ...api };
}

async function collectionRef(name) {
    const { db, collection } = await firestoreApi();
    return collection(db, 'artifacts', appId, 'public', 'data', name);
}

async function documentRef(name, id) {
    const { db, doc } = await firestoreApi();
    return doc(db, 'artifacts', appId, 'public', 'data', name, id);
}

function reportCloudFailure(retry, keptLocal = false) {
    reportSaveFailure({
        message: keptLocal
            ? '클라우드에 저장하지 못했습니다. 이 기기에는 남아 있습니다. 다시 시도해 주세요.'
            : '저장하지 못했습니다. 다시 시도해 주세요.',
        retry,
    });
}

/** 로그인 시 Firestore, 실패·비로그인 시 로컬스토리지로 동일 컬렉션을 다룹니다. */
export function useSharedList(name, enabled, revision = 0) {
    const [items, setItems] = useState(() => readLocal(name));
    const [ready, setReady] = useState(!enabled);

    useEffect(() => {
        if (!enabled) {
            setItems(readLocal(name));
            setReady(true);
            return undefined;
        }
        let stop = false;
        let unsub = () => {};
        firestoreApi().then(({ db, collection, onSnapshot }) => {
            if (stop) return;
            unsub = onSnapshot(
                collection(db, 'artifacts', appId, 'public', 'data', name),
                (snap) => {
                    const next = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                    setItems(next);
                    writeLocal(name, next);
                    setReady(true);
                },
                (err) => {
                    console.error(err);
                    setItems(readLocal(name));
                    setReady(true);
                }
            );
        }).catch((err) => {
            console.error(err);
            if (!stop) {
                setItems(readLocal(name));
                setReady(true);
            }
        });
        return () => {
            stop = true;
            unsub();
        };
    }, [name, enabled, revision]);

    return { items, ready };
}

export async function addItem(name, data, signedIn) {
    if (signedIn) {
        const { addDoc, serverTimestamp } = await firestoreApi();
        const ref = await addDoc(await collectionRef(name), { ...data, createdAt: serverTimestamp() }).catch((err) => {
            console.error(err);
            reportCloudFailure(() => addItem(name, data, signedIn));
            throw err;
        });
        return ref.id;
    }
    const items = readLocal(name);
    const id = `local-${Date.now()}`;
    const next = [{ id, ...data, createdAt: new Date().toISOString() }, ...items];
    writeLocal(name, next);
    return id;
}

export async function patchItem(name, id, data, signedIn) {
    if (signedIn) {
        const { updateDoc } = await firestoreApi();
        await updateDoc(await documentRef(name, id), data).catch((err) => {
            console.error(err);
            reportCloudFailure(() => patchItem(name, id, data, signedIn));
            throw err;
        });
        return;
    }
    const next = readLocal(name).map((row) => (row.id === id ? { ...row, ...data } : row));
    writeLocal(name, next);
}

export async function removeItem(name, id, signedIn) {
    if (signedIn) {
        const { deleteDoc } = await firestoreApi();
        await deleteDoc(await documentRef(name, id)).catch((err) => {
            console.error(err);
            reportCloudFailure(() => removeItem(name, id, signedIn));
            throw err;
        });
        return;
    }
    writeLocal(name, readLocal(name).filter((row) => row.id !== id));
}

const readObject = (name) => {
    try {
        const raw = localStorage.getItem(localKey(name));
        if (!raw) return {};
        const data = JSON.parse(raw);
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
        return {};
    }
};

const writeObject = (name, data) => {
    try {
        localStorage.setItem(localKey(name), JSON.stringify(data));
    } catch (err) {
        console.warn('로컬 저장 실패', err);
        reportSaveFailure({
            message: '이 기기에 저장하지 못했습니다. 다시 시도해 주세요.',
            retry: () => writeObject(name, data),
        });
    }
};

/** 로그인 시 Firestore 문서 하나, 손님은 localStorage 객체입니다. */
export function useSharedRecord(name, enabled, revision = 0) {
    const [record, setRecord] = useState(() => readObject(name));

    useEffect(() => {
        const reload = () => setRecord(readObject(name));
        const onLocal = (event) => {
            if (event.detail?.name === name) reload();
        };
        window.addEventListener('nb-shared-record', onLocal);
        let unsub = () => {};
        let stop = false;
        if (!enabled) reload();
        else {
            firestoreApi().then(({ db, doc, onSnapshot }) => {
                if (stop) return;
                unsub = onSnapshot(
                    doc(db, 'artifacts', appId, 'public', 'data', name, 'board'),
                    (snap) => {
                        if (!snap.exists()) {
                            setRecord(readObject(name));
                            return;
                        }
                        const next = snap.data() || {};
                        setRecord(next);
                        writeObject(name, next);
                    },
                    (err) => {
                        console.error(err);
                        setRecord(readObject(name));
                    }
                );
            }).catch((err) => {
                console.error(err);
                if (!stop) setRecord(readObject(name));
            });
        }
        return () => {
            stop = true;
            window.removeEventListener('nb-shared-record', onLocal);
            unsub();
        };
    }, [name, enabled, revision]);

    return record;
}

export async function saveRecord(name, data, signedIn) {
    const next = { ...data };
    writeObject(name, next);
    window.dispatchEvent(new CustomEvent('nb-shared-record', { detail: { name } }));
    if (!signedIn) return;
    const { setDoc, serverTimestamp } = await firestoreApi();
    await setDoc(await documentRef(name, 'board'), {
        ...next,
        updatedAt: serverTimestamp(),
    }, { merge: true }).catch((err) => {
        console.error(err);
        reportCloudFailure(() => saveRecord(name, data, signedIn), true);
        throw err;
    });
}

export async function upsertDoc(name, id, data, signedIn) {
    if (signedIn) {
        const { setDoc, serverTimestamp } = await firestoreApi();
        await setDoc(await documentRef(name, id), { ...data, updatedAt: serverTimestamp() }, { merge: true }).catch((err) => {
            console.error(err);
            reportCloudFailure(() => upsertDoc(name, id, data, signedIn), true);
            throw err;
        });
        return;
    }
    const items = readLocal(name);
    const idx = items.findIndex((row) => row.id === id);
    if (idx >= 0) items[idx] = { ...items[idx], ...data };
    else items.push({ id, ...data });
    writeLocal(name, items);
}

const LIST_TO_NAME = {
    inbox: 'ssugeokInbox',
    studentNotes: 'studentNotes',
    counselNotes: 'counselNotes',
    plans: 'teacherPlans',
    todos: 'teacherTodos',
    attendance: 'teacherAttend',
    roster: 'classRoster',
    ledger: 'ledgerTx',
    budgets: 'ledgerBudgets',
    lessons: 'teacherLessons',
    meets: 'teacherMeets',
    contacts: 'teacherContacts',
    timetable: 'teacherTimetable',
    diary: 'familyDiary',
    ddayCards: 'ddayCards',
    submissionSheets: 'submissionSheets',
};

async function pool(jobs, size = 8) {
    for (let i = 0; i < jobs.length; i += size) {
        await Promise.all(jobs.slice(i, i + size).map((job) => job()));
    }
}

/** 백업에 들어 있는 문서만 같은 경로에 덮어씁니다. 없는 문서는 지우지 않습니다. */
export async function pushBackupCloud(data) {
    const { setDoc, serverTimestamp } = await firestoreApi();
    const jobs = [];
    for (const [key, name] of Object.entries(LIST_TO_NAME)) {
        if (!Array.isArray(data[key])) continue;
        data[key].forEach((item, index) => {
            if (!item || typeof item !== 'object' || Array.isArray(item)) return;
            const id = item.id ? String(item.id) : `local-${name}-${index}`;
            const rest = { ...item };
            delete rest.id;
            jobs.push(async () => {
                await setDoc(await documentRef(name, id), { ...rest, updatedAt: serverTimestamp() }, { merge: true });
            });
        });
    }
    if (data.praiseBoard && typeof data.praiseBoard === 'object' && !Array.isArray(data.praiseBoard)) {
        const rest = { ...data.praiseBoard };
        jobs.push(async () => {
            await setDoc(await documentRef('praiseBoard', 'board'), { ...rest, updatedAt: serverTimestamp() }, { merge: true });
        });
    }
    if (data.notebookFields && typeof data.notebookFields === 'object') {
        for (const [page, fields] of Object.entries(data.notebookFields)) {
            const n = Number(page);
            if (!Number.isInteger(n) || isLocalOnlyPage(n)) continue;
            if (!fields || typeof fields !== 'object' || Array.isArray(fields)) continue;
            jobs.push(async () => {
                await setDoc(await documentRef('notebookFields', `p${n}`), {
                    fields,
                    page: n,
                    updatedAt: serverTimestamp(),
                }, { merge: true });
            });
        }
    }
    try {
        await pool(jobs);
    } catch (err) {
        console.error(err);
        reportCloudFailure(() => pushBackupCloud(data), true);
        throw err;
    }
}
