import { useEffect, useState } from 'react';
import {
    addDoc,
    collection,
    deleteDoc,
    doc,
    onSnapshot,
    serverTimestamp,
    setDoc,
    updateDoc,
} from 'firebase/firestore';
import { appId, db } from '../firebase';

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
    }
};

export const colRef = (name) => collection(db, 'artifacts', appId, 'public', 'data', name);

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
        const unsub = onSnapshot(
            colRef(name),
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
        return () => unsub();
    }, [name, enabled, revision]);

    return { items, ready };
}

export async function addItem(name, data, signedIn) {
    if (signedIn) {
        const ref = await addDoc(colRef(name), { ...data, createdAt: serverTimestamp() });
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
        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', name, id), data);
        return;
    }
    const next = readLocal(name).map((row) => (row.id === id ? { ...row, ...data } : row));
    writeLocal(name, next);
}

export async function removeItem(name, id, signedIn) {
    if (signedIn) {
        await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', name, id));
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
        if (!enabled) reload();
        else {
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
        }
        return () => {
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
    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', name, 'board'), {
        ...next,
        updatedAt: serverTimestamp(),
    }, { merge: true });
}

export async function upsertDoc(name, id, data, signedIn) {
    if (signedIn) {
        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', name, id), { ...data, updatedAt: serverTimestamp() }, { merge: true });
        return;
    }
    const items = readLocal(name);
    const idx = items.findIndex((row) => row.id === id);
    if (idx >= 0) items[idx] = { ...items[idx], ...data };
    else items.push({ id, ...data });
    writeLocal(name, items);
}
