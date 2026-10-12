import { useCallback, useEffect, useRef, useState } from 'react';
import { upsertDoc } from '../lib/store.js';

const localKey = (page) => `homenote_v2_notebookFields_p${page}`;

const readLocal = (page) => {
    try {
        const raw = localStorage.getItem(localKey(page));
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

const writeLocal = (page, fields) => {
    try {
        localStorage.setItem(localKey(page), JSON.stringify(fields));
    } catch (err) {
        console.warn('쪽 저장 실패', err);
    }
};

/** 건강·민원·학폭 쪽은 이 기기에만 둡니다. Firestore로 올리지 않습니다. */
export function isLocalOnlyPage(page) {
    const n = Number(page);
    if (n === 157 || n === 158) return true;
    if (n >= 19 && n <= 22) return true;
    if (n >= 323 && n <= 334) return true;
    return false;
}

export function readPageFields(page) {
    return readLocal(page);
}

/** 쓱적에서 옮긴 한 줄을 그 쪽 타임라인에 붙입니다. */
export async function appendPageTrail(page, entry, signedIn) {
    const fields = readLocal(page);
    const notes = Array.isArray(fields.ssugeokNotes) ? fields.ssugeokNotes : [];
    if (notes.some((n) => n.noteId === entry.noteId)) return;
    const next = { ...fields, ssugeokNotes: [entry, ...notes].slice(0, 40) };
    writeLocal(page, next);
    window.dispatchEvent(new CustomEvent('nb-page-fields', { detail: { page: Number(page) } }));
    if (!signedIn || isLocalOnlyPage(page) || entry.sensitive) return;
    await upsertDoc('notebookFields', `p${page}`, { fields: next, page: Number(page) }, true);
}

/** 쪽마다 칸 값을 담고, 로그인 시 Firestore·아니면 localStorage에 남깁니다. */
export function usePageFields(page, signedIn) {
    const [fields, setFields] = useState(() => readLocal(page));
    const timer = useRef(0);

    useEffect(() => {
        setFields(readLocal(page));
    }, [page]);

    useEffect(() => {
        const onRefresh = (event) => {
            if (Number(event.detail?.page) !== Number(page)) return;
            setFields(readLocal(page));
        };
        window.addEventListener('nb-page-fields', onRefresh);
        return () => window.removeEventListener('nb-page-fields', onRefresh);
    }, [page]);

    const persist = useCallback((next) => {
        writeLocal(page, next);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            if (!signedIn || isLocalOnlyPage(page)) return;
            upsertDoc('notebookFields', `p${page}`, { fields: next, page }, signedIn).catch((err) => {
                console.error(err);
            });
        }, 400);
    }, [page, signedIn]);

    const setField = useCallback((key, value) => {
        setFields((prev) => {
            const next = { ...prev, [key]: value };
            persist(next);
            return next;
        });
    }, [persist]);

    useEffect(() => () => window.clearTimeout(timer.current), []);

    return { fields, setField };
}
