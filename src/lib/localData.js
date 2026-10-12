const localKey = (name) => `homenote_v2_${name}`;

function notify(name, eventName) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent(eventName, { detail: { name } }));
}

export function readLocalList(name) {
    try {
        const raw = localStorage.getItem(localKey(name));
        const data = raw ? JSON.parse(raw) : [];
        return Array.isArray(data) ? data : [];
    } catch {
        return [];
    }
}

export function writeLocalList(name, items) {
    try {
        localStorage.setItem(localKey(name), JSON.stringify(items));
    } catch (err) {
        console.warn('로컬 저장 실패', err);
        return false;
    }
    notify(name, 'nb-shared-list');
    return true;
}

export function readLocalObject(name) {
    try {
        const raw = localStorage.getItem(localKey(name));
        if (!raw) return {};
        const data = JSON.parse(raw);
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
        return {};
    }
}

export function writeLocalObject(name, data) {
    try {
        localStorage.setItem(localKey(name), JSON.stringify(data ?? {}));
    } catch (err) {
        console.warn('로컬 저장 실패', err);
        return false;
    }
    notify(name, 'nb-shared-record');
    return true;
}

/** 같은 id 는 기기에 이미 있는 내용을 유지하고, 없는 id 만 앞에 붙입니다. */
export function mergeLocalList(name, incoming) {
    const current = readLocalList(name);
    const seen = new Set(current.map((row) => row?.id).filter(Boolean));
    const extra = [];
    for (const row of incoming || []) {
        if (!row?.id || seen.has(row.id)) continue;
        seen.add(row.id);
        extra.push(row);
    }
    if (!extra.length) return 0;
    writeLocalList(name, [...extra, ...current]);
    return extra.length;
}
