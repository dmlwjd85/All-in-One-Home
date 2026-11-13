/*
 * check-sync-watch 전용: 'firebase/firestore' 대신 쓰는 아주 작은 가짜입니다(패키지 없이 돕니다).
 * 문서는 전역 __fakeFs.docs(경로 → 데이터)에 두고, onSnapshot 은 리스너만 적어 둡니다. 검사가 결과를 직접 넣어 봅니다.
 */
const S = globalThis.__fakeFs || (globalThis.__fakeFs = { docs: new Map(), listeners: [], gets: [], batches: [], denyBatch: false });
export class Timestamp {
    constructor(ms) { this.ms = ms; }
    static fromMillis(ms) { return new Timestamp(ms); }
    static now() { return new Timestamp(Date.now()); }
    toMillis() { return this.ms; }
}
export const serverTimestamp = () => ({ serverTime: true });
export const deleteField = () => ({ deleteField: true });
export const doc = (db, ...path) => ({ kind: 'doc', path: path.join('/') });
export const collection = (db, ...path) => ({ kind: 'col', path: path.join('/') });
export const where = (field, op, value) => ({ field, op, value });
export const query = (col, w) => ({ kind: 'query', path: col.path, w });
const snapDoc = (path, data) => ({ id: path.split('/').pop(), data: () => data, exists: () => data != null, metadata: { hasPendingWrites: false } });
export async function getDoc(ref) { S.gets.push(ref.path); return snapDoc(ref.path, S.docs.get(ref.path) ?? null); }
export const getDocFromServer = getDoc;
export async function getDocs(col) {
    const depth = col.path.split('/').length + 1;
    const list = [...S.docs].filter(([p]) => p.startsWith(`${col.path}/`) && p.split('/').length === depth).map(([p, d]) => snapDoc(p, d));
    S.gets.push(col.path);
    return { metadata: { fromCache: false }, docs: list, forEach: (fn) => list.forEach(fn) };
}
export async function setDoc(ref, data) { S.docs.set(ref.path, data); }
export async function deleteDoc(ref) { S.docs.delete(ref.path); }
export function writeBatch() {
    const ops = [];
    return {
        set: (ref, data) => { ops.push(['set', ref.path, data]); },
        delete: (ref) => { ops.push(['delete', ref.path]); },
        async commit() {
            if (S.denyBatch) throw Object.assign(new Error('denied'), { code: 'permission-denied' });
            S.batches.push(ops.map(([op, path]) => `${op}:${path}`));
            for (const [op, path, data] of ops) { if (op === 'set') S.docs.set(path, data); else S.docs.delete(path); }
        },
    };
}
export function onSnapshot(target, opts, next, error) {
    const listener = { target, opts, next, error, on: true };
    S.listeners.push(listener);
    return () => { listener.on = false; };
}
