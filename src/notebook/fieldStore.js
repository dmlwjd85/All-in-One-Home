import { useCallback, useEffect, useRef, useState } from 'react';
import { readPageFields, writePageFields } from '../lib/fieldLocal.js';
import { reportSaveFailure } from '../lib/saveNotice.js';
import { upsertDoc } from '../lib/store.js';
import { isLocalOnlyPage } from '../lib/sensitive.js';

export { isLocalOnlyPage } from '../lib/sensitive.js';
export { readPageFields } from '../lib/fieldLocal.js';

/** 쓱적에서 옮긴 한 줄을 그 쪽 타임라인에 붙입니다. */
export async function appendPageTrail(page, entry, signedIn) {
    const fields = readPageFields(page);
    const notes = Array.isArray(fields.ssugeokNotes) ? fields.ssugeokNotes : [];
    if (notes.some((note) => note.noteId === entry.noteId)) return;
    const next = { ...fields, ssugeokNotes: [entry, ...notes].slice(0, 40) };
    writePageFields(page, next);
    if (!signedIn || isLocalOnlyPage(page) || entry.sensitive) return;
    await upsertDoc('notebookFields', `p${page}`, { fields: next, page: Number(page) }, true);
}

/** 쪽마다 칸 값을 담고, 로그인 시 내 계정·아니면 localStorage에 남깁니다. 민감 쪽은 항상 기기만. */
export function usePageFields(page, signedIn) {
    const [fields, setFields] = useState(() => readPageFields(page));
    const timer = useRef(0);

    useEffect(() => {
        setFields(readPageFields(page));
    }, [page]);

    useEffect(() => {
        const onRefresh = (event) => {
            const target = event.detail?.page;
            if (target !== '*' && Number(target) !== Number(page)) return;
            setFields(readPageFields(page));
        };
        window.addEventListener('nb-page-fields', onRefresh);
        return () => window.removeEventListener('nb-page-fields', onRefresh);
    }, [page]);

    const persist = useCallback((next) => {
        const saved = writePageFields(page, next, { notify: false });
        if (!saved) {
            reportSaveFailure({
                message: '이 기기에 저장하지 못했습니다.',
                retry: async () => {
                    const again = writePageFields(page, next, { notify: false });
                    if (!again) throw new Error('로컬 저장 실패');
                    if (signedIn && !isLocalOnlyPage(page)) {
                        await upsertDoc('notebookFields', `p${page}`, { fields: next, page }, signedIn);
                    }
                },
            });
        }
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
