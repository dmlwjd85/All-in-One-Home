/**
 * 회의록·학생 기록에 붙이는 사진.
 * - 사진은 줄여서(긴 변 1600px 안팎, JPEG) 먼저 이 기기(IndexedDB 'ssug-gyomu-photos')에 둡니다.
 * - 로그인했고 글이 '이 기기 전용'이 아니면 users/{uid}/photos/{pid}(작은 표지)와 users/{uid}/photoData/{pid}(사진 글자)로 올립니다.
 * - 표지는 바뀐 것만 받습니다(at >= 마지막으로 본 서버 시각). 지운 사진은 표지에 gone 을 남겨 다른 기기도 지웁니다.
 * - 사진 글자는 그 글을 열 때만 받습니다. 기존 동기화(전체 받기)에는 들어가지 않아 읽기 비용이 늘지 않습니다.
 */
import { createVault } from './idb.js';

export const PHOTO_MAX_PER_OWNER = 5;
export const PHOTO_DATA_MAX = 700000; // base64 글자 수(문서 1MB 한도 안쪽)
export const PHOTO_STEPS = [[1600, 0.72], [1400, 0.66], [1200, 0.6], [1000, 0.55], [800, 0.5]];
const OWNER = /^(notes|records)-[A-Za-z0-9_-]{1,80}$/;
const PID = /^ph-[a-z0-9]{8,30}$/;

export function photoOwner(collection, id) {
    const key = `${collection}-${id}`;
    return OWNER.test(key) ? key : '';
}

export function newPhotoId(now = Date.now(), rand = Math.random()) {
    return `ph-${Math.max(0, Math.floor(now)).toString(36).padStart(9, '0')}${Math.min(36 ** 6 - 1, Math.floor(rand * 36 ** 6)).toString(36).padStart(6, '0')}`;
}

/** 긴 변을 max 로 맞춘 크기. 작으면 그대로. */
export function fitSize(w, h, max) {
    const long = Math.max(w, h);
    if (!(long > 0)) return { w: 0, h: 0 };
    const k = long > max ? max / long : 1;
    return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/** 이 글의 사진 표지(지운 것 빼고, 붙인 순서). */
export function ownerPhotos(index, owner) {
    return Object.entries(index || {})
        .filter(([, meta]) => meta && meta.owner === owner && !meta.gone)
        .map(([id, meta]) => ({ id, ...meta }))
        .sort((a, b) => (a.at || 0) - (b.at || 0) || a.id.localeCompare(b.id));
}

/**
 * 서버에서 받은 표지를 이 기기 목록에 합칩니다.
 * 돌려주는 값: { index, drop: [사진 글자를 지울 id], cursor }
 * - 서버가 gone 이면 이 기기에서도 지웁니다(이 기기에서 아직 못 올린 새 사진은 id 가 달라 영향 없음).
 * - 이 기기에서 지우려고 표시한 사진(gone)은 서버 표지가 살아 있어도 되살리지 않습니다.
 */
export function mergeRemote(index, remote, uid, cursor = 0) {
    const next = { ...(index || {}) };
    const drop = [];
    let last = cursor;
    for (const row of remote || []) {
        if (!row || !PID.test(row.id) || !OWNER.test(row.owner || '')) continue;
        if (row.at > last) last = row.at;
        const mine = next[row.id];
        if (row.gone) {
            /* 이 기기 전용으로 바뀌어 클라우드에서만 내린 사진(up 이 비어 있음)은 이 기기에 그대로 둡니다. */
            if (mine && mine.up === uid) { delete next[row.id]; drop.push(row.id); }
            continue;
        }
        if (mine && !mine.up && mine.has) continue;
        if (mine?.gone) continue;
        next[row.id] = { owner: row.owner, w: row.w, h: row.h, at: mine?.at || row.at, up: uid, has: Boolean(mine?.has) };
    }
    return { index: next, drop, cursor: last };
}

/**
 * 올리거나 지우거나 클라우드에서 내려야 할 일.
 * eligible(owner): true(올려도 되는 글) · false(이 기기 전용 글) · null(그 글을 아직 모름 — 아무것도 하지 않음).
 */
export function pendingWork(index, uid, eligible = () => true) {
    const upload = [];
    const remove = [];
    const hide = [];
    for (const [id, meta] of Object.entries(index || {})) {
        if (!meta) continue;
        if (meta.gone) { remove.push(id); continue; }
        const ok = eligible(meta.owner);
        if (meta.up !== uid && meta.has && ok === true) upload.push(id);
        if (meta.up === uid && ok === false) hide.push(id);
    }
    return { upload, remove, hide };
}

/* ───────── 이 기기 저장 ───────── */
let vault = createVault('ssug-gyomu-photos');
let memory = null; // 공용 컴퓨터 모드·검사: 메모리에만
let index = null;
const listeners = new Set();
let version = 0;

const store = {
    async get(key) { if (memory) return memory.get(key); try { return await vault.get(key); } catch { return undefined; } },
    async set(key, value) { if (memory) { memory.set(key, value); return; } await vault.set(key, value); },
    async remove(key) { if (memory) { memory.delete(key); return; } try { await vault.remove(key); } catch { /* 없음 */ } },
};

/** 공용 컴퓨터 모드에서는 사진을 기기에 남기지 않습니다. */
export function usePhotoMemory(on) {
    if (Boolean(memory) === Boolean(on)) return;
    memory = on ? new Map() : null;
    index = null;
}
export function usePhotoVaultForTest(next) { vault = next; memory = null; index = null; }

async function loadIndex() {
    if (!index) index = (await store.get('index')) || {};
    return index;
}
async function saveIndex(next) {
    index = next;
    await store.set('index', next);
    version += 1;
    listeners.forEach((fn) => { try { fn(version); } catch { /* 화면 쪽 오류 */ } });
}
export function subscribePhotos(fn) { listeners.add(fn); return () => listeners.delete(fn); }
export function photosVersion() { return version; }

export async function listPhotos(owner) {
    return ownerPhotos(await loadIndex(), owner);
}

/** 글마다 사진 수(목록의 📷 표시용). */
export async function photoCounts() {
    const out = {};
    for (const meta of Object.values(await loadIndex())) if (meta && !meta.gone) out[meta.owner] = (out[meta.owner] || 0) + 1;
    return out;
}

/* ───────── 줄이기(브라우저) ───────── */
function loadImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('image')); };
        img.src = url;
    });
}

/** 사진 파일을 줄여 { data(base64, 머리말 없음), w, h } 로. 못 읽으면 null. */
export async function shrinkPhoto(file) {
    if (!file || !/^image\//.test(file.type || '')) return null;
    let img;
    try { img = await loadImage(file); } catch { return null; }
    const w0 = img.naturalWidth || img.width;
    const h0 = img.naturalHeight || img.height;
    if (!w0 || !h0) return null;
    for (const [max, quality] of PHOTO_STEPS) {
        const { w, h } = fitSize(w0, h0, max);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        const url = canvas.toDataURL('image/jpeg', quality);
        const data = url.slice(url.indexOf(',') + 1);
        if (!/^data:image\/jpeg/.test(url) || !data) return null;
        if (data.length <= PHOTO_DATA_MAX) return { data, w, h };
    }
    return null;
}

export function photoUrl(data) { return data ? `data:image/jpeg;base64,${data}` : ''; }

/* ───────── 클라우드 ───────── */
const timeout = (promise, ms) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);

async function realCloud({ memoryOnly = false } = {}) {
    const { cloudReady, loadFirebase } = await import('../firebase.js');
    if (!cloudReady()) return null;
    const ready = await loadFirebase({ memoryOnly });
    if (!ready) return null;
    const fs = await import('firebase/firestore');
    const at = (uid, name, id) => fs.doc(ready.db, 'users', uid, name, id);
    return {
        async put(uid, id, meta, data) {
            await timeout(fs.setDoc(at(uid, 'photoData', id), { data }), 30000);
            await timeout(fs.setDoc(at(uid, 'photos', id), { owner: meta.owner, w: meta.w, h: meta.h, gone: false, at: fs.serverTimestamp() }), 10000);
        },
        async gone(uid, id, meta) {
            await timeout(fs.setDoc(at(uid, 'photos', id), { owner: meta.owner, w: meta.w || 1, h: meta.h || 1, gone: true, at: fs.serverTimestamp() }), 10000);
            await timeout(fs.deleteDoc(at(uid, 'photoData', id)), 10000);
        },
        async data(uid, id) {
            const snap = await timeout(fs.getDoc(at(uid, 'photoData', id)), 30000);
            return snap.exists() ? String(snap.data().data || '') : '';
        },
        async metas(uid, since) {
            const base = fs.collection(ready.db, 'users', uid, 'photos');
            const q = since ? fs.query(base, fs.where('at', '>=', fs.Timestamp.fromMillis(since))) : base;
            const snap = await timeout(fs.getDocsFromServer(q), 15000);
            return snap.docs.map((d) => {
                const v = d.data();
                return { id: d.id, owner: v.owner, w: v.w, h: v.h, gone: v.gone === true, at: typeof v.at?.toMillis === 'function' ? v.at.toMillis() : 0 };
            });
        },
    };
}
let cloudMaker = realCloud;
export function usePhotoCloudForTest(maker = null) { cloudMaker = maker || realCloud; }

/**
 * 표지를 받고(바뀐 것만), 밀린 올리기·지우기를 합니다. 한 번에 하나만 돕니다.
 * who: { uid, memoryOnly }, eligible(owner): 올려도 되는 글인지.
 */
let syncing = null;
let lastSync = 0;
export function syncPhotos(who, eligible = () => true, { force = false, now = Date.now() } = {}) {
    if (!who?.uid) return Promise.resolve({ skipped: true });
    if (syncing) return syncing;
    if (!force && now - lastSync < 60000) return Promise.resolve({ skipped: true });
    syncing = (async () => {
        const out = { pulled: 0, uploaded: 0, removed: 0, failed: 0 };
        try {
            const cloud = await cloudMaker(who);
            if (!cloud) return { skipped: true };
            const cursors = (await store.get('cursor')) || {};
            const cursor = Number(cursors[who.uid]) || 0;
            const remote = await cloud.metas(who.uid, cursor);
            const merged = mergeRemote(await loadIndex(), remote, who.uid, cursor);
            for (const id of merged.drop) await store.remove(`p:${id}`);
            out.pulled = remote.length;
            if (JSON.stringify(merged.index) !== JSON.stringify(await loadIndex())) await saveIndex(merged.index);
            if (merged.cursor !== cursor) await store.set('cursor', { ...cursors, [who.uid]: merged.cursor });
            lastSync = now;
            const work = pendingWork(await loadIndex(), who.uid, eligible);
            for (const id of work.upload) {
                const meta = (await loadIndex())[id];
                const data = await store.get(`p:${id}`);
                if (!meta || !data) continue;
                try {
                    await cloud.put(who.uid, id, meta, data);
                    await saveIndex({ ...(await loadIndex()), [id]: { ...meta, up: who.uid } });
                    out.uploaded += 1;
                } catch { out.failed += 1; }
            }
            /* 글이 '이 기기 전용'으로 바뀌면 사진을 이 기기에 받아 둔 뒤 클라우드에서 내립니다. */
            for (const id of work.hide) {
                const meta = (await loadIndex())[id];
                if (!meta) continue;
                try {
                    let data = await store.get(`p:${id}`);
                    if (!data) { data = await cloud.data(who.uid, id); if (data) await store.set(`p:${id}`, data); }
                    if (!data) { out.failed += 1; continue; }
                    await cloud.gone(who.uid, id, meta);
                    await saveIndex({ ...(await loadIndex()), [id]: { ...meta, up: '', has: true } });
                    out.hidden = (out.hidden || 0) + 1;
                } catch { out.failed += 1; }
            }
            for (const id of work.remove) {
                const meta = (await loadIndex())[id];
                if (!meta) continue;
                try {
                    if (meta.up === who.uid) await cloud.gone(who.uid, id, meta);
                    const next = { ...(await loadIndex()) };
                    delete next[id];
                    await store.remove(`p:${id}`);
                    await saveIndex(next);
                    out.removed += 1;
                } catch { out.failed += 1; }
            }
        } catch {
            out.failed += 1;
        }
        return out;
    })().finally(() => { syncing = null; });
    return syncing;
}

/** 사진 글자. 이 기기에 없으면 클라우드에서 받아 둡니다. 못 받으면 ''. */
export async function photoData(id, who = null) {
    const local = await store.get(`p:${id}`);
    if (local) return local;
    const meta = (await loadIndex())[id];
    if (!meta || !who?.uid || meta.up !== who.uid) return '';
    try {
        const cloud = await cloudMaker(who);
        const data = cloud ? await cloud.data(who.uid, id) : '';
        if (!data) return '';
        try {
            await store.set(`p:${id}`, data);
            const now = (await loadIndex())[id];
            if (now) { index = { ...index, [id]: { ...now, has: true } }; await store.set('index', index); }
        } catch { /* 공간이 없으면 이번에만 보여 줍니다. */ }
        return data;
    } catch {
        return '';
    }
}

/**
 * 사진 붙이기. 돌려주는 값: { ok, id } 또는 { ok:false, why: 'full'|'read'|'storage' }.
 * 올리기는 syncPhotos 가 뒤에서 합니다(부르는 쪽에서 이어 부름).
 */
export async function addPhoto(owner, file, { now = Date.now() } = {}) {
    if (!OWNER.test(owner || '')) return { ok: false, why: 'read' };
    if ((await listPhotos(owner)).length >= PHOTO_MAX_PER_OWNER) return { ok: false, why: 'full' };
    const small = await shrinkPhoto(file);
    if (!small) return { ok: false, why: 'read' };
    return addShrunk(owner, small, { now });
}
export async function addShrunk(owner, small, { now = Date.now() } = {}) {
    const id = newPhotoId(now);
    try {
        await store.set(`p:${id}`, small.data);
        await saveIndex({ ...(await loadIndex()), [id]: { owner, w: small.w, h: small.h, at: now, up: '', has: true } });
    } catch {
        await store.remove(`p:${id}`);
        return { ok: false, why: 'storage' };
    }
    return { ok: true, id };
}

/** 사진 지우기. 올린 적 없으면 바로 지우고, 올렸으면 표시해 두었다가 syncPhotos 가 클라우드에서도 지웁니다. */
export async function removePhoto(id) {
    const all = await loadIndex();
    const meta = all[id];
    if (!meta) return;
    await store.remove(`p:${id}`);
    const next = { ...all };
    if (meta.up) next[id] = { ...meta, gone: true, has: false };
    else delete next[id];
    await saveIndex(next);
}

/** 글을 지울 때 그 글의 사진도 지웁니다. */
export async function removeOwnerPhotos(owner) {
    for (const row of await listPhotos(owner)) await removePhoto(row.id);
}

/** '모두 지우기': 이 기기의 사진을 비웁니다(클라우드 사진은 건드리지 않습니다). */
export async function clearLocalPhotos() {
    const all = await loadIndex();
    for (const id of Object.keys(all)) await store.remove(`p:${id}`);
    await store.remove('index');
    await store.remove('cursor');
    index = {};
    lastSync = 0;
    version += 1;
    listeners.forEach((fn) => { try { fn(version); } catch { /* 화면 */ } });
}
