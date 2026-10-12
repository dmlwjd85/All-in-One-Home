export const SENSITIVE_KEY = 'homenote_v2_ssugeokSensitive';

function notify() {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nb-ssugeok-sensitive'));
}

export function readSensitiveNotes() {
    try {
        const raw = localStorage.getItem(SENSITIVE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
    } catch {
        return [];
    }
}

export function writeSensitiveNotes(notes) {
    try {
        localStorage.setItem(SENSITIVE_KEY, JSON.stringify(Array.isArray(notes) ? notes : []));
    } catch (err) {
        console.warn('민감 메모 저장 실패', err);
    }
    notify();
}

export function removeSensitiveNote(id) {
    if (!id) return;
    const next = readSensitiveNotes().filter((row) => row.id !== id);
    writeSensitiveNotes(next);
}

/** 같은 id 는 유지하고, 클라우드에서 내려온 민감 메모만 추가합니다. */
export function mergeSensitiveNotes(incoming) {
    const current = readSensitiveNotes();
    const seen = new Set(current.map((row) => row?.id).filter(Boolean));
    const extra = [];
    for (const row of incoming || []) {
        if (!row?.id || seen.has(row.id)) continue;
        seen.add(row.id);
        extra.push({ ...row, sensitive: true });
    }
    if (!extra.length) return 0;
    writeSensitiveNotes([...extra, ...current]);
    return extra.length;
}
