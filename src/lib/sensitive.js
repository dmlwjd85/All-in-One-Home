/** 건강·민원·학폭·상담은 클라우드로 올리지 않습니다. */
export const SENSITIVE_RE = /건강|보건|알레르기|투약|복약|분리\s*급식|민원|학폭|학교폭력|상담|면담|학부모/;
export const SENSITIVE_TAGS = new Set(['보건', '건강', '학폭', '민원', '알레르기', '상담', '학부모']);

const COUNSEL_DEST = new Set(['counsel', 'parent']);

/** 건강·민원·학폭·상담 쪽은 이 기기에만 둡니다. */
export function isLocalOnlyPage(page) {
    const n = Number(page);
    if (!Number.isFinite(n)) return false;
    if (n === 157 || n === 158) return true;
    if (n >= 19 && n <= 22) return true;
    if (n >= 256 && n <= 334) return true;
    return false;
}

export function isSensitiveText(text, tags = []) {
    if (SENSITIVE_RE.test(String(text || ''))) return true;
    return (tags || []).some((tag) => SENSITIVE_TAGS.has(tag));
}

/** 쓱적 한 줄이 기기 전용인지 봅니다. 상담 목적지·상담 쪽도 포함합니다. */
export function isSensitiveNote(note) {
    if (!note || typeof note !== 'object') return false;
    const tags = Array.isArray(note.tags) ? note.tags : [];
    if (note.sensitive || isSensitiveText(note.text, tags)) return true;
    const dest = note.placement?.destId || note.suggestion?.destId;
    if (COUNSEL_DEST.has(dest)) return true;
    const page = Number(note.placement?.page);
    if (Number.isFinite(page) && page >= 256 && page <= 334) return true;
    return false;
}

export function pageFromNotebookDoc(id, data) {
    const fromData = Number(data?.page);
    if (Number.isFinite(fromData) && fromData > 0) return fromData;
    const match = /^p(\d+)$/.exec(String(id || ''));
    return match ? Number(match[1]) : null;
}
