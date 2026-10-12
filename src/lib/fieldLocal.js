export const NOTEBOOK_PAGE_COUNT = 580;

export const pageKey = (page) => `homenote_v2_notebookFields_p${page}`;

export function readPageFields(page) {
    try {
        const raw = localStorage.getItem(pageKey(page));
        const data = raw ? JSON.parse(raw) : {};
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch {
        return {};
    }
}

export function pageHasFields(fields) {
    return Boolean(fields) && typeof fields === 'object' && !Array.isArray(fields) && Object.keys(fields).length > 0;
}

export function writePageFields(page, fields, { notify = true } = {}) {
    const next = fields && typeof fields === 'object' && !Array.isArray(fields) ? fields : {};
    try {
        localStorage.setItem(pageKey(page), JSON.stringify(next));
    } catch (err) {
        console.warn('쪽 저장 실패', err);
        return false;
    }
    if (notify) notifyPage(page);
    return true;
}

export function notifyPage(page) {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nb-page-fields', { detail: { page } }));
}

/** 로컬이 비어 있을 때만 채웁니다. 이 기기에 이미 있는 칸은 덮지 않습니다. */
export function fillPageFieldsIfEmpty(page, fields) {
    if (!pageHasFields(fields)) return false;
    if (pageHasFields(readPageFields(page))) return false;
    writePageFields(page, fields);
    return true;
}

export function clearAllPageFields({ notify = true } = {}) {
    for (let page = 1; page <= NOTEBOOK_PAGE_COUNT; page += 1) {
        try {
            localStorage.removeItem(pageKey(page));
        } catch {
            /* 저장소가 막혀 있어도 다음 쪽을 계속 지웁니다. */
        }
    }
    if (notify) notifyPage('*');
}

export function readAllPageFields() {
    const out = {};
    for (let page = 1; page <= NOTEBOOK_PAGE_COUNT; page += 1) {
        const fields = readPageFields(page);
        if (pageHasFields(fields)) out[page] = fields;
    }
    return out;
}

export function listLocalNotebookPages() {
    const pages = [];
    for (let page = 1; page <= NOTEBOOK_PAGE_COUNT; page += 1) {
        const fields = readPageFields(page);
        if (pageHasFields(fields)) pages.push({ page, fields });
    }
    return pages;
}
