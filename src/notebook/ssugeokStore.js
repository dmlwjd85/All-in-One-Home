import { useEffect, useState } from 'react';
import { addItem, patchItem, removeItem } from '../lib/store.js';
import { reportSaveFailure } from '../lib/saveNotice.js';
import { appendPageTrail, dropPageTrail, patchPageTrail } from './fieldStore.js';
import {
    isSensitiveText,
    parseNote,
    presentNote,
    suggestDestination,
} from './ssugeokModel.js';

export const SENSITIVE_KEY = 'homenote_v2_ssugeokSensitive';

const quarantined = new Set();

export function readSensitiveNotes() {
    try {
        const raw = localStorage.getItem(SENSITIVE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

function writeSensitive(notes) {
    try {
        localStorage.setItem(SENSITIVE_KEY, JSON.stringify(notes));
    } catch (err) {
        console.warn('민감 메모 저장 실패', err);
        reportSaveFailure({
            message: '이 기기에 저장하지 못했습니다. 다시 시도해 주세요.',
            retry: () => writeSensitive(notes),
        });
        return;
    }
    window.dispatchEvent(new CustomEvent('nb-ssugeok-sensitive'));
}

export function useSensitiveNotes() {
    const [notes, setNotes] = useState(readSensitiveNotes);
    useEffect(() => {
        const reload = () => setNotes(readSensitiveNotes());
        window.addEventListener('nb-ssugeok-sensitive', reload);
        window.addEventListener('storage', reload);
        return () => {
            window.removeEventListener('nb-ssugeok-sensitive', reload);
            window.removeEventListener('storage', reload);
        };
    }, []);
    return notes;
}

export function mergeNotes(inbox, sensitive) {
    const hidden = new Set((sensitive || []).map((n) => n.id));
    const cloud = [];
    for (const note of inbox || []) {
        if (!note || hidden.has(note.id)) continue;
        const parsed = parseNote(note.text || '');
        const tags = note.tags?.length ? note.tags : parsed.tags;
        if (note.sensitive || isSensitiveText(note.text, tags)) continue;
        cloud.push(note);
    }
    return [...(sensitive || []), ...cloud]
        .map(presentNote)
        .sort((a, b) => String(b.createdAt?.seconds || b.createdAt || '').localeCompare(String(a.createdAt?.seconds || a.createdAt || '')));
}

export async function captureNote({ text, author, fromPage, signedIn }) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return null;
    const parsed = parseNote(trimmed);
    const suggestion = suggestDestination(trimmed, parsed);
    const base = {
        text: trimmed,
        author: author || '',
        fromPage: fromPage || 496,
        typeHint: parsed.tags[0] || '',
        status: 'inbox',
        tags: parsed.tags,
        studentNo: parsed.studentNo,
        detectedDate: parsed.detectedDate,
        sensitive: parsed.sensitive,
        suggestion,
        placement: null,
        createdAt: new Date().toISOString(),
    };
    if (parsed.sensitive) {
        const note = { id: `local-sens-${Date.now()}`, ...base };
        writeSensitive([note, ...readSensitiveNotes()]);
        return note;
    }
    const id = await addItem('ssugeokInbox', base, signedIn);
    return { id, ...base };
}

export async function sortNote(note, suggestion, signedIn) {
    const placement = {
        destId: suggestion.destId,
        page: suggestion.page,
        label: suggestion.label,
        sortedAt: new Date().toISOString(),
    };
    const patch = {
        status: 'sorted',
        placement,
        suggestion,
        tags: note.tags || [],
        studentNo: note.studentNo ?? null,
        detectedDate: note.detectedDate ?? null,
        sensitive: Boolean(note.sensitive),
    };
    if (note.sensitive) {
        writeSensitive(readSensitiveNotes().map((row) => (
            row.id === note.id ? { ...row, ...patch, sensitive: true } : row
        )));
        return placement;
    }
    await appendPageTrail(suggestion.page, {
        noteId: note.id,
        text: note.text,
        date: note.detectedDate || placement.sortedAt.slice(0, 10),
        tags: note.tags || [],
        studentNo: note.studentNo || null,
        sortedAt: placement.sortedAt,
        sensitive: false,
    }, signedIn);
    await patchItem('ssugeokInbox', note.id, { ...patch, sensitive: false }, signedIn);
    return placement;
}

export async function archiveNotes(notes, signedIn) {
    const ids = new Set((notes || []).map((n) => n.id));
    const local = readSensitiveNotes();
    if (local.some((n) => ids.has(n.id))) {
        writeSensitive(local.map((n) => (ids.has(n.id) ? { ...n, status: 'archived' } : n)));
    }
    for (const note of notes || []) {
        if (note.sensitive) continue;
        await patchItem('ssugeokInbox', note.id, { status: 'archived' }, signedIn);
    }
}

function notePatch(text) {
    const parsed = parseNote(text);
    return {
        text,
        typeHint: parsed.tags[0] || '',
        tags: parsed.tags,
        studentNo: parsed.studentNo,
        detectedDate: parsed.detectedDate,
        sensitive: parsed.sensitive,
        suggestion: suggestDestination(text, parsed),
        parsed,
    };
}

/** 쓱, 적에 남긴 글을 그 자리에서 고칩니다. 민감 여부가 바뀌면 기존 보관 위치로 옮깁니다. */
export async function reviseNote(note, text, signedIn) {
    const trimmed = String(text || '').trim();
    if (!trimmed || !note?.id) return null;
    const { parsed, ...patch } = notePatch(trimmed);
    const wasSensitive = Boolean(note.sensitive);
    if (parsed.sensitive && wasSensitive) {
        writeSensitive(readSensitiveNotes().map((row) => (
            row.id === note.id ? { ...row, ...patch, sensitive: true } : row
        )));
    } else if (parsed.sensitive && !wasSensitive) {
        writeSensitive([{ ...note, ...patch, sensitive: true }, ...readSensitiveNotes().filter((row) => row.id !== note.id)]);
        await removeItem('ssugeokInbox', note.id, signedIn);
        if (note.placement?.page) await dropPageTrail(note.placement.page, note.id, signedIn);
    } else if (!parsed.sensitive && wasSensitive) {
        writeSensitive(readSensitiveNotes().filter((row) => row.id !== note.id));
        await addItem('ssugeokInbox', {
            text: patch.text,
            author: note.author || '',
            fromPage: note.fromPage || 496,
            typeHint: patch.typeHint,
            status: note.status || 'inbox',
            tags: patch.tags,
            studentNo: patch.studentNo,
            detectedDate: patch.detectedDate,
            sensitive: false,
            suggestion: patch.suggestion,
            placement: note.placement || null,
            createdAt: note.createdAt || new Date().toISOString(),
        }, signedIn);
        if (note.placement?.page) await dropPageTrail(note.placement.page, note.id, signedIn);
    } else {
        await patchItem('ssugeokInbox', note.id, { ...patch, sensitive: false }, signedIn);
        if (note.placement?.page) {
            const trail = {
                text: trimmed,
                tags: parsed.tags,
                studentNo: parsed.studentNo || null,
            };
            const date = parsed.detectedDate || note.detectedDate;
            if (date) trail.date = date;
            await patchPageTrail(note.placement.page, note.id, trail, signedIn);
        }
    }
    return { ...note, ...patch };
}

/** 쓱, 적 메모를 받은함과, 옮겨 둔 쪽의 사본에서 지웁니다. */
export async function deleteNote(note, signedIn) {
    if (!note?.id) return;
    if (note.sensitive) writeSensitive(readSensitiveNotes().filter((row) => row.id !== note.id));
    else await removeItem('ssugeokInbox', note.id, signedIn);
    if (note.placement?.page) await dropPageTrail(note.placement.page, note.id, signedIn);
}

/** 이미 클라우드 받은함에 있는 건강·민원 메모는 이 기기로 옮기고 클라우드에서는 지웁니다. */
export async function quarantineSensitive(inbox, signedIn) {
    const leaked = (inbox || []).filter((note) => {
        if (!note?.id || quarantined.has(note.id)) return false;
        const parsed = parseNote(note.text || '');
        const tags = note.tags?.length ? note.tags : parsed.tags;
        return Boolean(note.sensitive) || isSensitiveText(note.text, tags);
    });
    if (!leaked.length) return 0;
    const next = readSensitiveNotes();
    for (const note of leaked) {
        quarantined.add(note.id);
        if (!next.some((row) => row.id === note.id)) {
            next.unshift(presentNote({ ...note, sensitive: true, createdAt: note.createdAt || new Date().toISOString() }));
        }
    }
    writeSensitive(next);
    for (const note of leaked) {
        try {
            await removeItem('ssugeokInbox', note.id, signedIn);
        } catch (err) {
            console.error(err);
        }
    }
    return leaked.length;
}
