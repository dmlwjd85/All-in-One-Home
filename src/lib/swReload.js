/*
 * 새 판(서비스 워커)으로 다시 열 때 쓰던 글을 잃지 않게 합니다(PR #57 r2 검수 1번).
 *  - 사용자가 직접 친 입력란(input·textarea)에 아직 글이 남아 있거나, 입력란을 쓰고 있으면 다시 열지 않습니다.
 *  - 화면이 가려졌고 남은 글이 없을 때만 다시 엽니다. 그래도 다시 열기 직전에 비어 있지 않은 입력란을 모두 초안으로 적어 두고,
 *    다시 연 뒤 같은 자리(빈 칸일 때만)에 되돌립니다. 비밀번호 칸은 적지 않습니다.
 */
export const DRAFT_KEY = 'ssug-gyomu-sw-drafts';
const SKIP_TYPES = new Set(['password', 'hidden', 'file', 'checkbox', 'radio', 'submit', 'button', 'reset', 'image', 'range', 'color']);

function fields(doc) {
    return [...doc.querySelectorAll('input, textarea')].filter((el) => !SKIP_TYPES.has(String(el.type || '').toLowerCase()));
}
function fieldKey(el, all) {
    const tag = el.tagName.toLowerCase();
    const name = el.getAttribute('name') || el.id || el.getAttribute('aria-label') || el.getAttribute('placeholder') || '';
    const same = all.filter((other) => other.tagName === el.tagName && (other.getAttribute('name') || other.id || other.getAttribute('aria-label') || other.getAttribute('placeholder') || '') === name);
    return `${tag}|${name}|${same.indexOf(el)}`;
}

/** 사용자가 친 입력란을 기억합니다. 돌려준 객체의 unsaved()가 참이면 다시 열면 안 됩니다. */
export function trackTyping(doc = document) {
    const typed = new Set();
    doc.addEventListener('input', (event) => { if (event.isTrusted !== false && event.target?.matches?.('input, textarea')) typed.add(event.target); }, true);
    return {
        unsaved() {
            for (const el of [...typed]) {
                if (!el.isConnected) { typed.delete(el); continue; }
                if (String(el.value || '').trim()) return true;
            }
            const active = doc.activeElement;
            /* 입력란에 커서가 있으면(쓰는 중) 다시 열지 않습니다. */
            return Boolean(active && (active.matches?.('input, textarea') && !SKIP_TYPES.has(String(active.type || '').toLowerCase()) || active.isContentEditable));
        },
    };
}

export function saveDrafts(doc = document, storage = sessionStorage, where = location) {
    const all = fields(doc);
    const items = all.filter((el) => String(el.value || '').trim()).map((el) => ({ k: fieldKey(el, all), v: String(el.value) }));
    try {
        if (items.length) storage.setItem(DRAFT_KEY, JSON.stringify({ hash: where.hash || '', path: where.pathname || '', items }));
        else storage.removeItem(DRAFT_KEY);
    } catch { /* 저장 공간이 없으면 다시 열지 않습니다(호출하는 쪽이 확인). */ return false; }
    return true;
}

function setNative(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, value); else el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
}

/** 다시 연 뒤 초안을 되돌립니다. 화면이 늦게 그려지므로 잠시(기본 8초) 기다리며 찾습니다. 빈 칸에만 넣습니다. */
export function restoreDrafts(doc = document, storage = sessionStorage, where = location, waitMs = 8000) {
    let saved = null;
    try { saved = JSON.parse(storage.getItem(DRAFT_KEY) || 'null'); } catch { saved = null; }
    if (!saved?.items?.length) return Promise.resolve(0);
    if ((saved.hash || '') !== (where.hash || '') || (saved.path || '') !== (where.pathname || '')) return Promise.resolve(0);
    const left = new Map(saved.items.map((item) => [item.k, item.v]));
    let restored = 0;
    const tryOnce = () => {
        const all = fields(doc);
        for (const el of all) {
            const key = fieldKey(el, all);
            if (!left.has(key)) continue;
            if (!String(el.value || '')) { setNative(el, left.get(key)); restored += 1; }
            left.delete(key);
        }
        return left.size === 0;
    };
    return new Promise((done) => {
        const finish = () => {
            /* 되돌리지 못한 초안은 남겨 다음에 다시 시도합니다. */
            try {
                if (left.size) storage.setItem(DRAFT_KEY, JSON.stringify({ ...saved, items: [...left].map(([k, v]) => ({ k, v })) }));
                else storage.removeItem(DRAFT_KEY);
            } catch { /* 무시 */ }
            done(restored);
        };
        if (tryOnce()) { finish(); return; }
        const started = Date.now();
        const timer = setInterval(() => { if (tryOnce() || Date.now() - started > waitMs) { clearInterval(timer); finish(); } }, 100);
    });
}

/** 새 판이 자리를 잡았을 때 부릅니다. 안전할 때(가려짐 + 남은 글 없음)만 초안을 적고 다시 엽니다. */
export function reloadWhenSafe({ doc = document, storage = sessionStorage, where = location, typing, reload = () => where.reload() } = {}) {
    let fired = false;
    const attempt = () => {
        if (fired || !doc.hidden || typing?.unsaved()) return false;
        if (!saveDrafts(doc, storage, where)) return false;
        fired = true;
        doc.removeEventListener('visibilitychange', attempt);
        reload();
        return true;
    };
    if (!attempt()) doc.addEventListener('visibilitychange', attempt);
    return attempt;
}
