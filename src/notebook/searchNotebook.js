const FIELD_PREFIX = 'homenote_v2_notebookFields_p';

export function searchNotebook(query, pages) {
    const q = String(query || '').trim().toLowerCase();
    if (!q) return [];
    const hits = [];
    const seen = new Set();
    const push = (hit) => {
        const key = `${hit.page}:${hit.kind}`;
        if (seen.has(key) || hits.length >= 30) return;
        seen.add(key);
        hits.push(hit);
    };
    for (const page of pages || []) {
        const title = String(page.title || '');
        const blob = `${page.n} ${title} ${page.type || ''}`.toLowerCase();
        if (blob.includes(q)) push({ page: page.n, title: title || `${page.n}쪽`, kind: '쪽' });
    }
    if (q.length < 2 || typeof localStorage === 'undefined') return hits;
    for (let i = 0; i < localStorage.length; i += 1) {
        if (hits.length >= 30) break;
        const key = localStorage.key(i);
        if (!key || !key.startsWith(FIELD_PREFIX)) continue;
        const pageNo = Number(key.slice(FIELD_PREFIX.length));
        if (!Number.isInteger(pageNo)) continue;
        let text = '';
        try {
            text = String(localStorage.getItem(key) || '').toLowerCase();
        } catch {
            text = '';
        }
        if (!text.includes(q)) continue;
        const title = pages?.[pageNo - 1]?.title || `${pageNo}쪽`;
        push({ page: pageNo, title, kind: '기록' });
    }
    return hits;
}
