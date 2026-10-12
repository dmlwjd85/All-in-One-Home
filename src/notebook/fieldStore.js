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

/** 쪽마다 칸 값을 담고, 로그인 시 Firestore·아니면 localStorage에 남깁니다. */
export function usePageFields(page, signedIn) {
    const [fields, setFields] = useState(() => readLocal(page));
    const timer = useRef(0);

    useEffect(() => {
        setFields(readLocal(page));
    }, [page]);

    const persist = useCallback((next) => {
        writeLocal(page, next);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
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
