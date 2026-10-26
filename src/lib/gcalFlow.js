/** 구글 캘린더 HTTP. fetchImpl 을 넣어 테스트에서 목으로 바꿉니다. */
import {
    explainSyncError,
    googleToExternal,
    dedupeExternal,
    kokToGoogleEvent,
    shouldPushCreate,
    KOK_PRIVATE_KEY,
} from './gcalCore.js';

const BASE = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

let calendarWorker = null;
let calendarSeq = 0;
const calendarPending = new Map();

function calendarClient() {
    if (calendarWorker) return calendarWorker;
    if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined') return null;
    const source = `
        self.onmessage = async (event) => {
            const job = event.data || {};
            try {
                const response = await fetch(job.url, {
                    method: job.method || 'GET',
                    headers: job.headers || {},
                    body: job.body || undefined,
                });
                const text = await response.text();
                self.postMessage({ id: job.id, ok: response.ok, status: response.status, text });
            } catch {
                self.postMessage({ id: job.id, ok: false, status: 0, text: '', failed: true });
            }
        };
    `;
    try {
        calendarWorker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
    } catch {
        calendarWorker = null;
        return null;
    }
    calendarWorker.onmessage = (event) => {
        const done = calendarPending.get(event.data?.id);
        if (!done) return;
        calendarPending.delete(event.data.id);
        done(event.data);
    };
    return calendarWorker;
}

/** 페이지 fetch 는 401 을 콘솔에 남기므로, 캘린더 호출은 워커에서 받습니다. */
export function quietFetch(url, options = {}) {
    const client = calendarClient();
    if (!client) return globalThis.fetch(url, options);
    const headers = {};
    const raw = options.headers || {};
    if (typeof Headers !== 'undefined' && raw instanceof Headers) raw.forEach((value, key) => { headers[key] = value; });
    else Object.assign(headers, raw);
    const id = ++calendarSeq;
    return new Promise((resolve, reject) => {
        calendarPending.set(id, (data) => {
            if (data?.failed) {
                reject(new TypeError('Failed to fetch'));
                return;
            }
            const text = data?.text || '';
            resolve({
                ok: Boolean(data?.ok),
                status: Number(data?.status || 0),
                text: async () => text,
                json: async () => (text ? JSON.parse(text) : {}),
            });
        });
        client.postMessage({
            id,
            url: String(url),
            method: options.method || 'GET',
            headers,
            body: typeof options.body === 'string' ? options.body : '',
        });
    });
}

function authHeaders(token, extra = {}) {
    return {
        Authorization: `Bearer ${token}`,
        ...extra,
    };
}

function noteAuth(current, status) {
    const code = Number(status || 0);
    if (current === 401 || current === 403) return current;
    if (code === 401 || code === 403) return code;
    return current || 0;
}

async function quietBody(response) {
    try {
        if (typeof response?.body?.cancel === 'function') await response.body.cancel();
        else if (typeof response?.text === 'function') await response.text();
    } catch {
        /* 거절 본문은 화면에만 안내하고 콘솔에는 남기지 않습니다. */
    }
}

async function callGoogle(fetchImpl, url, options) {
    let response;
    try {
        response = await fetchImpl(url, options);
    } catch {
        return { ok: false, status: 0, message: explainSyncError(0), json: {} };
    }
    const status = Number(response?.status || 0);
    if (status === 401 || status === 403) {
        await quietBody(response);
        return { ok: false, status, message: explainSyncError(status), json: {} };
    }
    if (status === 204) return { ok: true, status: 204, json: {} };
    let json = {};
    try {
        json = typeof response?.json === 'function' ? await response.json() : {};
    } catch {
        json = {};
    }
    if (!response?.ok) return { ok: false, status, message: explainSyncError(status), json };
    return { ok: true, status, json };
}

export async function listExternalEvents({ token, timeMin, timeMax, fetchImpl }) {
    const items = [];
    let pageToken = '';
    for (let hop = 0; hop < 8; hop += 1) {
        const params = new URLSearchParams({
            singleEvents: 'true',
            orderBy: 'startTime',
            timeMin,
            timeMax,
            maxResults: '250',
            showDeleted: 'false',
        });
        if (pageToken) params.set('pageToken', pageToken);
        const result = await callGoogle(fetchImpl, `${BASE}?${params}`, { headers: authHeaders(token) });
        if (!result.ok) return { ...result, events: [] };
        for (const item of result.json.items || []) {
            const row = googleToExternal(item);
            if (row) items.push(row);
        }
        pageToken = result.json.nextPageToken || '';
        if (!pageToken) break;
    }
    return { ok: true, status: 200, events: dedupeExternal(items), message: '' };
}

async function findByKokId(token, kokId, fetchImpl) {
    const params = new URLSearchParams({
        privateExtendedProperty: `${KOK_PRIVATE_KEY}=${kokId}`,
        maxResults: '2',
        showDeleted: 'false',
    });
    const result = await callGoogle(fetchImpl, `${BASE}?${params}`, { headers: authHeaders(token) });
    if (!result.ok) return result;
    const found = (result.json.items || []).find((item) => item?.id);
    return { ok: true, status: 200, id: found?.id || '', json: result.json };
}

async function patchEvent(token, eventId, body, fetchImpl) {
    const result = await callGoogle(fetchImpl, `${BASE}/${encodeURIComponent(eventId)}`, {
        method: 'PATCH',
        headers: authHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
    });
    if (!result.ok) return result;
    return { ok: true, status: result.status, id: result.json.id || eventId };
}

export async function pushKokEvent({ token, row, link, fetchImpl }) {
    const body = kokToGoogleEvent(row);
    if (link?.googleEventId) {
        const patched = await patchEvent(token, link.googleEventId, body, fetchImpl);
        if (patched.ok) return { ok: true, link: { googleEventId: patched.id } };
        if (patched.status !== 404 && patched.status !== 410) return patched;
    }
    const found = await findByKokId(token, row.id, fetchImpl);
    if (!found.ok) return found;
    if (found.id) {
        const patched = await patchEvent(token, found.id, body, fetchImpl);
        if (!patched.ok) return patched;
        return { ok: true, link: { googleEventId: patched.id } };
    }
    const created = await callGoogle(fetchImpl, BASE, {
        method: 'POST',
        headers: authHeaders(token, { 'Content-Type': 'application/json' }),
        body: JSON.stringify(body),
    });
    if (!created.ok) return created;
    if (!created.json.id) return { ok: false, status: created.status, message: explainSyncError(created.status) };
    return { ok: true, link: { googleEventId: created.json.id } };
}

export async function removeKokEvent({ token, link, fetchImpl }) {
    if (!link?.googleEventId) return { ok: true, skipped: true };
    const result = await callGoogle(fetchImpl, `${BASE}/${encodeURIComponent(link.googleEventId)}`, {
        method: 'DELETE',
        headers: authHeaders(token),
    });
    if (result.ok || result.status === 404 || result.status === 410) return { ok: true };
    return result;
}

async function pushRow(token, row, links, fetchImpl) {
    const result = await pushKokEvent({ token, row, link: links[row.id], fetchImpl });
    if (!result.ok) return { links, status: result.status, error: result.message || explainSyncError(result.status) };
    return { links: { ...links, [row.id]: result.link }, status: result.status, error: '' };
}

export async function uploadKokEvents({ token, rows, links, fetchImpl }) {
    let next = { ...(links || {}) };
    const errors = [];
    let status = 0;
    for (const row of rows || []) {
        if (!shouldPushCreate(row, { bulk: true })) continue;
        if (next[row.id]) {
            const result = await pushKokEvent({ token, row, link: next[row.id], fetchImpl });
            status = noteAuth(status, result.status);
            if (!result.ok) errors.push(result.message || explainSyncError(result.status));
            else next = { ...next, [row.id]: result.link };
            continue;
        }
        const pushed = await pushRow(token, row, next, fetchImpl);
        next = pushed.links;
        status = noteAuth(status, pushed.status);
        if (pushed.error) errors.push(pushed.error);
    }
    return { links: next, errors, status };
}

/**
 * 쓰기 모드에서만 구글에 반영합니다.
 * 보기만으로 바꿀 때는 이 함수를 부르지 않으며, 이미 올라간 구글 일정은 지우지 않습니다.
 */
export async function applyKokDiff({
    token,
    mode,
    enabled,
    links,
    forwardSince,
    diff,
    fetchImpl,
}) {
    const current = { ...(links || {}) };
    if (!enabled || mode !== 'write' || !token) {
        return { links: current, errors: [], status: 0, skipped: true };
    }
    let next = current;
    const errors = [];
    let status = 0;
    for (const row of diff?.created || []) {
        if (!shouldPushCreate(row, { forwardSince, bulk: false })) continue;
        const pushed = await pushRow(token, row, next, fetchImpl);
        next = pushed.links;
        status = noteAuth(status, pushed.status);
        if (pushed.error) errors.push(pushed.error);
    }
    for (const row of diff?.updated || []) {
        const linked = Boolean(next[row.id]);
        if (!linked && !shouldPushCreate(row, { forwardSince, bulk: false })) continue;
        const pushed = await pushRow(token, row, next, fetchImpl);
        next = pushed.links;
        status = noteAuth(status, pushed.status);
        if (pushed.error) errors.push(pushed.error);
    }
    for (const row of diff?.deleted || []) {
        const link = next[row.id];
        if (!link) continue;
        const removed = await removeKokEvent({ token, link, fetchImpl });
        status = noteAuth(status, removed.status);
        if (!removed.ok) errors.push(removed.message || explainSyncError(removed.status));
        else {
            next = { ...next };
            delete next[row.id];
        }
    }
    return { links: next, errors, status, skipped: false };
}
