/**
 * 5차 검수에서 재현한 순서 그대로: 로그인(에뮬레이터) → 지각 저장 → 메모를 적다가 '저장' 없이 앱 숨김/닫기
 * → 다시 열기. 메모가 이 기기와 클라우드에 남아야 합니다. 로그아웃 상태와 '안 올린 로컬 변경' 경우도 봅니다.
 * firebase emulators:exec 안에서 돌립니다.
 */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDocs, setDoc, Timestamp } from 'firebase/firestore';
import { fingerprint, serverIds } from '../src/lib/cloud.js';
import { fromCloudRow, toCloudRow } from '../src/lib/cloudShape.js';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-ssug-rules', firestore: { host, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const fsFor = (uid) => env.authenticatedContext(uid).firestore();
const DATE = '2026-10-28';

/* 앱이 닫히면(closed) 그 뒤에 시작된 올리기는 서버에 닿지 못하고 멈춥니다. */
let closed = false;
const cloud = {
    available: () => true,
    async push(uid, state, { hashes = {} } = {}) {
        await Promise.resolve();
        if (closed) return new Promise(() => {});
        const next = { ...hashes };
        for (const r of state.attendance) {
            const shaped = toCloudRow('attendance', r);
            if (!shaped) continue;
            const key = `attendance/${shaped.id}`;
            const fp = fingerprint(shaped.body, shaped.clear || []);
            if (next[key] === fp) continue;
            await setDoc(doc(fsFor(uid), 'users', uid, 'attendance', shaped.id), { ...shaped.body, updatedAt: Timestamp.now() });
            next[key] = fp;
        }
        return { ok: true, hashes: next, rejected: [] };
    },
    async pull(uid) {
        const snap = await getDocs(collection(fsFor(uid), 'users', uid, 'attendance'));
        return { profile: { className: '검사반' }, attendance: snap.docs.map((d) => fromCloudRow('attendance', d.id, d.data())).filter(Boolean), ids: { attendance: serverIds(snap) } };
    },
};
const cloudNote = async (uid, sid) => {
    const snap = await getDocs(collection(fsFor(uid), 'users', uid, 'attendance'));
    const d = snap.docs.find((x) => x.id === `${DATE}_${sid}`);
    return d ? `${d.data().status}/${d.data().note || ''}` : '∅';
};

const plain = (from = null) => { const map = new Map(from || []); return { map, get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };
let round = 0;
async function openApp(saved, login) {
    round += 1;
    const mem = new Map(saved?.ls || []);
    globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    /* 같은 db.js를 새로 불러와 앱을 다시 연 것처럼 합니다. */
    const db = await import(`../src/lib/db.js?open=${round}`);
    const vaults = [plain(saved?.main), plain(saved?.local), plain(saved?.inbox)];
    db.useVaultsForTest(...vaults);
    db.useCloudForTest(cloud);
    closed = false;
    await db.boot('?at=08:42');
    if (login) await db.setAuth({ uid: 'u1' });
    /* 앱을 닫는 순간: 이미 끝난 저장만 남고, 기다리던 기기 저장·올리기는 사라집니다. */
    const close = () => { closed = true; return { ls: [...mem], main: [...vaults[0].map], local: [...vaults[1].map], inbox: [...vaults[2].map] }; };
    return { db, close };
}
/* 출결 시트의 앱 숨김 처리와 같은 순서(시트 임시본 동기 저장 → 상태 반영 → 앱 전체 올리기). */
function hideWhileTyping(db, sid, memo) {
    db.writeAttendDraft({ date: DATE, sid, status: '지각', note: memo, paper: false, period: 0 });
    db.setAttendance(DATE, sid, '지각', { note: memo, paper: false, period: 0 }).catch(() => {});
    db.flushCloud().catch(() => {});
}

for (const login of [true, false]) {
    const tag = login ? '로그인' : '로그아웃';
    await env.clearFirestore();
    const memo = `메모-${tag}`;
    let app = await openApp(null, login);
    await app.db.setAttendance(DATE, 's3', '지각');
    if (login) await app.db.flushCloudNow();
    hideWhileTyping(app.db, 's3', memo);
    let saved = app.close();
    app = await openApp(saved, login);
    const row = app.db.snapshot().attendance.find((r) => r.id === `${DATE}_s3`);
    check(row?.status === '지각' && row?.note === memo, `${tag}: '저장' 없이 숨기고 닫았다 열면 메모가 사라집니다: ${JSON.stringify(row)}`);
    if (login) {
        await app.db.flushCloud();
        const c = await cloudNote('u1', 's3');
        check(c === `late/${memo}`, `${tag}: 다시 연 뒤 메모가 클라우드에 올라가지 않았습니다: ${c}`);
    }
    app.close();
}

/* 안 올린 로컬 변경: 기기 저장은 끝났지만 올리기 전에 닫힘. 다시 열 때 당겨오기가 덮으면 안 됩니다. */
{
    await env.clearFirestore();
    let app = await openApp(null, true);
    await app.db.setAttendance(DATE, 's4', '결석', { reason: '질병' });
    await app.db.flushCloudNow();
    closed = true;
    await app.db.setAttendance(DATE, 's4', '결석', { reason: '질병', note: '안 올림' });
    await new Promise((r) => setTimeout(r, 50));
    const saved = app.close();
    check((await cloudNote('u1', 's4')) === 'absent/', '검사 준비: 클라우드에 옛 값이 있어야 합니다.');
    app = await openApp(saved, true);
    const row = app.db.snapshot().attendance.find((r) => r.id === `${DATE}_s4`);
    check(row?.note === '안 올림', `다시 열 때 당겨오기가 안 올린 로컬 변경을 덮었습니다: ${JSON.stringify(row)}`);
    await app.db.flushCloud();
    check((await cloudNote('u1', 's4')) === 'absent/안 올림', `안 올린 로컬 변경이 다시 연 뒤 올라가지 않았습니다: ${await cloudNote('u1', 's4')}`);
    app.close();
}

/* 다른 계정에서 적던 임시본은 되살리지 않습니다. */
{
    await env.clearFirestore();
    const app = await openApp(null, true);
    globalThis.localStorage.setItem('ssug-gyomu-attend-draft', JSON.stringify({ u: 'u9', date: DATE, sid: 's5', status: '결석', note: '남의 것' }));
    await app.db.applyAttendDraft();
    check(!app.db.snapshot().attendance.some((r) => r.sid === 's5'), '다른 계정의 출결 임시본을 되살렸습니다.');
    app.close();
}

await env.cleanup();
if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('check-attend-cloud: 숨기고 닫았다 열어도 출결 메모가 남습니다');
process.exit(0);
