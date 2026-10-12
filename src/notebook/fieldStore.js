import { useCallback, useEffect, useState } from 'react';
import { upsertDoc } from '../lib/store.js';
import { reportSaveFailure } from '../lib/saveNotice.js';
import { studentCardPage } from './nav.js';
import { isLocalOnlyPage } from './localPages.js';

export { isLocalOnlyPage };

const localKey = (page) => `homenote_v2_notebookFields_p${page}`;

const readLocal = (page) => {
    try {
        const raw = localStorage.getItem(localKey(page));
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
};

const cloudTimers = new Map();

const writeLocal = (page, fields) => {
    try {
        localStorage.setItem(localKey(page), JSON.stringify(fields));
    } catch (err) {
        console.warn('쪽 저장 실패', err);
        reportSaveFailure({
            message: '이 기기에 저장하지 못했습니다. 다시 시도해 주세요.',
            retry: () => writeLocal(page, fields),
        });
        return;
    }
    window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent('nb-page-fields', { detail: { page: Number(page) } }));
    }, 0);
};

function scheduleCloud(page, fields, signedIn) {
    if (!signedIn || isLocalOnlyPage(page)) return;
    const prev = cloudTimers.get(Number(page));
    if (prev) window.clearTimeout(prev.timer);
    const run = () => {
        cloudTimers.delete(Number(page));
        const retry = () => upsertDoc('notebookFields', `p${page}`, { fields, page: Number(page) }, true).catch((err) => {
            console.error(err);
            reportSaveFailure({
                message: '클라우드에 저장하지 못했습니다. 이 기기에는 남아 있습니다. 다시 시도해 주세요.',
                retry,
            });
        });
        retry();
    };
    cloudTimers.set(Number(page), { timer: window.setTimeout(run, 400), run });
}

export function readPageFields(page) {
    return readLocal(page);
}

export function writePageFields(page, fields, signedIn) {
    writeLocal(page, fields);
    scheduleCloud(page, fields, signedIn);
}

const CARD_KEYS = { name: 'name', sex: 'sex', birth: 'birth' };

/** 명렬 값이 비어 있거나 예전 명렬 값과 같으면 학생 카드로 잇습니다. */
export function linkRosterValue(studentNo, rosterKey, value, previous, signedIn) {
    const cardKey = CARD_KEYS[rosterKey];
    if (!cardKey) return;
    const page = studentCardPage(studentNo);
    const card = readLocal(page);
    const current = card[cardKey] ?? '';
    if (current !== '' && current !== (previous ?? '')) return;
    if (current === value) return;
    writePageFields(page, { ...card, [cardKey]: value }, signedIn);
}

/** 쓱적에서 옮긴 한 줄을 그 쪽 타임라인에 붙입니다. */
export async function appendPageTrail(page, entry, signedIn) {
    const fields = readLocal(page);
    const notes = Array.isArray(fields.ssugeokNotes) ? fields.ssugeokNotes : [];
    if (notes.some((n) => n.noteId === entry.noteId)) return;
    const next = { ...fields, ssugeokNotes: [entry, ...notes].slice(0, 40) };
    writeLocal(page, next);
    if (!signedIn || isLocalOnlyPage(page) || entry.sensitive) return;
    await upsertDoc('notebookFields', `p${page}`, { fields: next, page: Number(page) }, true);
}

/** 쪽마다 칸 값을 담고, 로그인 시 Firestore·아니면 localStorage에 남깁니다. */
export function usePageFields(page, signedIn) {
    const [fields, setFields] = useState(() => readLocal(page));
    useEffect(() => {
        setFields(readLocal(page));
    }, [page]);

    useEffect(() => {
        const onRefresh = (event) => {
            const target = Number(event.detail?.page);
            if (target !== 0 && target !== Number(page)) return;
            setFields((prev) => {
                const next = readLocal(page);
                return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
            });
        };
        window.addEventListener('nb-page-fields', onRefresh);
        return () => window.removeEventListener('nb-page-fields', onRefresh);
    }, [page]);

    const persist = useCallback((next) => {
        writePageFields(page, next, signedIn);
    }, [page, signedIn]);

    const setField = useCallback((key, value) => {
        setFields((prev) => {
            const next = { ...prev, [key]: value };
            persist(next);
            return next;
        });
    }, [persist]);

    useEffect(() => {
        const current = Number(page);
        return () => {
            const pending = cloudTimers.get(current);
            if (!pending) return;
            window.clearTimeout(pending.timer);
            cloudTimers.delete(current);
            pending.run();
        };
    }, [page]);

    return { fields, setField };
}

export function useRosterNames() {
    const read = () => {
        const fields = readLocal(154);
        const names = [];
        for (let n = 1; n <= 32; n += 1) names[n] = fields[`name${n}`] || '';
        return names;
    };
    const [names, setNames] = useState(read);
    useEffect(() => {
        const onRefresh = (event) => {
            const target = Number(event.detail?.page);
            if (target !== 0 && target !== 154) return;
            setNames(read());
        };
        window.addEventListener('nb-page-fields', onRefresh);
        return () => window.removeEventListener('nb-page-fields', onRefresh);
    }, []);
    return names;
}
