/** Firestore Timestamp 등을 localStorage에 넣을 수 있는 값으로 바꿉니다. */
export function plainValue(value) {
    if (value == null) return value;
    if (typeof value?.toDate === 'function') {
        const date = value.toDate();
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    if (Array.isArray(value)) return value.map((item) => plainValue(item));
    if (typeof value === 'object') {
        const out = {};
        for (const [key, item] of Object.entries(value)) out[key] = plainValue(item);
        return out;
    }
    return value;
}

export function asDocBody(row) {
    const body = {};
    for (const [key, value] of Object.entries(row || {})) {
        if (key === 'id' || value === undefined) continue;
        body[key] = value;
    }
    return body;
}

function sanitizeDocId(id) {
    const raw = String(id || '').trim();
    if (!raw || raw.includes('/') || raw === '.' || raw === '..') return '';
    return raw.slice(0, 700);
}

export function asDocId(id, fallback = '') {
    return sanitizeDocId(id) || sanitizeDocId(fallback);
}
