/**
 * 기기마다 자료가 다르게 보이던 원인 재현과 '클라우드에서 다시 받기' 검사(에뮬레이터, 규칙 적용).
 * 다른 기기(A)는 에뮬레이터에 바로 쓰고, 이 기기(B)는 db.js의 실제 길(저장·지우기·받기·다시 받기)로 다룹니다.
 * 올리기는 실제 pushUserData처럼 줄마다 해시가 같으면 건너뛰고, 비운 칸은 deleteField로 지웁니다.
 */
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, deleteField, doc, getDoc, getDocs, getDocFromServer, setDoc, Timestamp } from 'firebase/firestore';
import { guardedDelete, keepCloudDoc, printDigest, rowMark, serverIds } from '../src/lib/cloud.js';
import { fromCloudRow, toCloudRow } from '../src/lib/cloudShape.js';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const [host, port] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const env = await initializeTestEnvironment({ projectId: 'demo-ssug-rules', firestore: { host, port: Number(port), rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } });
const fsFor = (uid) => env.authenticatedContext(uid).firestore();
const UID = 'u1';
const NAMES = ['todos', 'events', 'notes', 'attendance'];
let offline = false;
let rejectKeys = new Set();
let pulls = 0;
let dropIdsOnce = false;
let slowPush = 0;
let bareProfile = false;
const cloud = {
    available: () => true,
    async push(uid, state, { hashes = {} } = {}) {
        if (offline) return { ok: false, pending: 1, hashes, rejected: [] };
        /* 실제 pushUserData처럼 Firebase를 불러온 뒤에야 해시를 읽습니다(그 사이 이 기기에서 지울 수 있음). */
        if (slowPush) await new Promise((r) => setTimeout(r, slowPush));
        const next = { ...hashes };
        const rejected = [];
        for (const name of NAMES) {
            for (const r of state[name] || []) {
                const shaped = toCloudRow(name, r);
                const m = rowMark(name, r);
                if (!shaped || next[m.key] === m.mark) continue;
                if (rejectKeys.has(m.key)) { rejected.push(m.key); continue; }
                const body = { ...shaped.body, updatedAt: Timestamp.now() };
                for (const key of shaped.clear || []) body[key] = deleteField();
                await setDoc(doc(fsFor(uid), 'users', uid, name, shaped.id), body, { merge: true });
                next[m.key] = m.mark;
            }
        }
        return { ok: true, pending: 0, hashes: next, rejected };
    },
    async pull(uid) {
        pulls += 1;
        const out = { profile: bareProfile ? {} : { className: '검사반' }, ids: {}, ats: { attendance: {} } };
        for (const name of NAMES) {
            const snap = await getDocs(collection(fsFor(uid), 'users', uid, name));
            out[name] = snap.docs.map((d) => fromCloudRow(name, d.id, d.data())).filter(Boolean);
            if (!dropIdsOnce) out.ids[name] = serverIds(snap);
            if (name === 'attendance') for (const d of snap.docs) out.ats.attendance[d.id] = d.data().updatedAt?.toMillis?.() || 0;
        }
        dropIdsOnce = false;
        return out;
    },
    async remove(uid, name, id, opts = {}) {
        const ref = doc(fsFor(uid), 'users', uid, name, String(id));
        return guardedDelete({ get: async () => { const s = await getDocFromServer(ref); return s.exists() ? s.data() : null; }, del: () => deleteDoc(ref) }, name, id, opts);
    },
};
const other = (name, id, body) => setDoc(doc(fsFor(UID), 'users', UID, name, id), { ...body, updatedAt: Timestamp.now() });
const otherTodo = (id, title) => other('todos', id, { title, done: false, source: 'app' });
const cloudDoc = async (name, id) => { const d = await getDoc(doc(fsFor(UID), 'users', UID, name, id)); return d.exists() ? d.data() : null; };
const cloudTitle = async (id) => (await cloudDoc('todos', id))?.title || '∅';
const plain = () => { const map = new Map(); return { map, get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };
const mem = new Map();
globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const db = await import('../src/lib/db.js');
db.useVaultsForTest(plain(), plain(), plain());
db.useCloudForTest(cloud);
await env.clearFirestore();
await otherTodo('t1', '보고서 v1');
await otherTodo('t2', '지울 일');
await db.boot('?at=08:42');
await db.setAuth({ uid: UID });
const row = (name, id) => db.snapshot()[name].find((t) => t.id === id);
const title = (id) => row('todos', id)?.title || '∅';
check(title('t1') === '보고서 v1', `처음 받기 실패: ${title('t1')}`);
check(db.lastSyncAt() > 0, '마지막 동기화 시각이 남지 않았습니다');
check(db.lastSyncAt('u9') === 0, '다른 계정에 마지막 동기화 시각이 보입니다');

/* 1) 다른 기기가 고친 할 일: 자동 받기에서 받아야 하고, 이 기기의 옛 값을 다시 올려 덮으면 안 됩니다. */
await otherTodo('t1', '보고서 v2');
await db.refreshFromCloud({ force: true });
check(title('t1') === '보고서 v2', `다른 기기에서 고친 할 일을 받지 않았습니다(원인 1): ${title('t1')}`);
await db.flushCloud();
check(await cloudTitle('t1') === '보고서 v2', `이 기기 옛 값이 클라우드를 덮었습니다: ${await cloudTitle('t1')}`);

/* 2) 안 올린 변경은 다시 받기 전에 올라가고 그대로 남습니다. 못 올리면 아무것도 바꾸지 않습니다. */
await db.saveTextItem('todos', { id: 't3', title: '이 기기에서 새로', done: false });
offline = true;
const stop = await db.pullFromCloudNow();
check(!stop.ok && stop.reason === 'push' && title('t3') !== '∅' && title('t2') !== '∅', `못 올렸는데 다시 받기를 진행했습니다: ${JSON.stringify(stop)}`);
/* 올리기에 실패하면 '마지막 동기화' 시각을 바꾸지 않습니다(자동 받기 포함). */
const syncedAt = db.lastSyncAt();
await new Promise((r) => setTimeout(r, 15));
await db.refreshFromCloud({ force: true });
check(db.lastSyncAt() === syncedAt, `올리기에 실패했는데 마지막 동기화 시각이 바뀌었습니다: ${syncedAt} → ${db.lastSyncAt()}`);
offline = false;
await deleteDoc(doc(fsFor(UID), 'users', UID, 'todos', 't2'));
/* 서버 목록이 아니면(캐시) 다른 기기에서 지운 줄이라도 지우지 않습니다. */
dropIdsOnce = true;
const cached = await db.pullFromCloudNow();
check(cached.ok && cached.dropped === 0 && title('t2') === '지울 일', `캐시 목록으로 지웠습니다: ${JSON.stringify(cached)} ${title('t2')}`);
const done = await db.pullFromCloudNow();
check(done.ok && done.dropped === 1, `다시 받기 결과가 다릅니다: ${JSON.stringify(done)}`);
check(title('t3') === '이 기기에서 새로' && await cloudTitle('t3') === '이 기기에서 새로', '안 올린 변경이 사라졌습니다');
check(title('t2') === '∅', '다른 기기에서 지운 할 일이 남았습니다');
check(db.lastSyncAt() > syncedAt, '다시 받기 뒤 마지막 동기화 시각이 그대로입니다');
const kept = await db.readBeforePull();
check(kept?.data?.todos?.some((t) => t.id === 't2'), '다시 받기 전 자료를 보관하지 않았습니다');

/* 3) 한 번도 클라우드에 닿지 않은 줄은 다시 받기로 지우지 않습니다. */
rejectKeys = new Set(['todos/t4']);
await db.saveTextItem('todos', { id: 't4', title: '아직 못 올림', done: false });
const third = await db.pullFromCloudNow();
check(third.ok && title('t4') === '아직 못 올림', `클라우드에 없던 줄을 지웠습니다: ${JSON.stringify(third)} ${title('t4')}`);
rejectKeys = new Set();

/* 4) 다시 받기는 클라우드 값을 실제로 적용합니다(올린 그대로인 줄). */
await otherTodo('t1', '보고서 v3');
const fourth = await db.pullFromCloudNow();
check(fourth.ok && title('t1') === '보고서 v3', `다시 받기가 클라우드 값을 적용하지 않았습니다: ${title('t1')}`);

/* 5) 클라우드가 거절한 줄을 이 기기에서 고쳤으면 다시 받기가 옛 값으로 덮지 않고, 다른 기기에서 지웠어도 남깁니다. */
await db.saveTextItem('todos', { id: 't6', title: 'v1', done: false });
await db.saveTextItem('todos', { id: 't7', title: '남길 v1', done: false });
await db.flushCloud();
check(await cloudTitle('t6') === 'v1', '검사 준비: t6가 올라가지 않았습니다');
rejectKeys = new Set(['todos/t6', 'todos/t7']);
await db.saveTextItem('todos', { ...row('todos', 't6'), title: 'v2 거절된 수정' });
await db.saveTextItem('todos', { ...row('todos', 't7'), title: '남길 v2 거절' });
await deleteDoc(doc(fsFor(UID), 'users', UID, 'todos', 't7'));
const fifth = await db.pullFromCloudNow();
check(fifth.ok && title('t6') === 'v2 거절된 수정', `다시 받기가 거절된 줄의 수정을 옛 값으로 덮었습니다: ${title('t6')}`);
check(title('t7') === '남길 v2 거절', `다시 받기가 거절된 줄을 지웠습니다: ${title('t7')} ${JSON.stringify(fifth)}`);
rejectKeys = new Set();

/* 6) 앱에서 지우면(removeItem) 클라우드 문서도 지워지고, 다시 받아도 되살아나지 않습니다(할 일·일정·메모). */
await db.saveTextItem('events', { id: 'e1', title: '지울 일정', date: '2026-10-30', kind: '학급' });
await db.saveTextItem('notes', { id: 'n1', text: '지울 메모' });
await db.flushCloud();
check(await cloudDoc('events', 'e1') && await cloudDoc('notes', 'n1') && await cloudTitle('t3') !== '∅', '검사 준비: 지울 줄이 올라가지 않았습니다');
await db.removeItem('todos', 't3');
await db.removeItem('events', 'e1');
await db.removeItem('notes', 'n1');
await db.flushCloud();
check(await cloudTitle('t3') === '∅' && !(await cloudDoc('events', 'e1')) && !(await cloudDoc('notes', 'n1')), '앱에서 지운 줄이 클라우드에 남았습니다');
await db.refreshFromCloud({ force: true });
await db.pullFromCloudNow();
check(!row('todos', 't3') && !row('events', 'e1') && !row('notes', 'n1'), '지운 줄이 다시 받기에서 되살아났습니다');

/* 7) 다른 기기에서 지운 할 일은 자동 받기에서도 빠집니다. */
await otherTodo('t8', '다른 기기가 지울 일');
await db.refreshFromCloud({ force: true });
check(title('t8') === '다른 기기가 지울 일', '검사 준비: t8을 받지 못했습니다');
await deleteDoc(doc(fsFor(UID), 'users', UID, 'todos', 't8'));
await db.refreshFromCloud({ force: true });
check(title('t8') === '∅', '다른 기기에서 지운 할 일이 자동 받기 뒤에도 남았습니다');

/* 8) 비운 칸: 이 기기에서 비우면 클라우드에서도 지우고, 다른 기기에서 비우면 이 기기도 비웁니다. */
await db.saveTextItem('events', { id: 'e2', title: '상담', date: '2026-10-30', kind: '학급', memo: '지울 메모', time: '09:00' });
await db.saveTextItem('notes', { id: 'n2', text: '회의 본문', title: '학년 회의', attendees: '김, 이' });
await db.flushCloud();
await db.saveTextItem('events', { ...row('events', 'e2'), memo: '', time: '' });
await db.flushCloud();
const e2 = await cloudDoc('events', 'e2');
check(e2 && !('memo' in e2) && !('time' in e2), `이 기기에서 비운 일정 칸이 클라우드에 남았습니다: ${JSON.stringify(e2)}`);
await other('notes', 'n2', { text: '회의 본문', source: 'app' });
await db.refreshFromCloud({ force: true });
check(row('notes', 'n2') && !row('notes', 'n2').title && !row('notes', 'n2').attendees, `다른 기기에서 비운 회의록 제목이 남았습니다(자동 받기): ${JSON.stringify(row('notes', 'n2'))}`);
await other('notes', 'n2', { text: '회의 본문', source: 'app', title: '다시 제목' });
await db.pullFromCloudNow();
await other('notes', 'n2', { text: '회의 본문', source: 'app' });
await db.pullFromCloudNow();
check(row('notes', 'n2') && !row('notes', 'n2').title, `다른 기기에서 비운 회의록 제목이 남았습니다(다시 받기): ${JSON.stringify(row('notes', 'n2'))}`);

/* 9) 올리는 중에 연달아 지우기: 진행 중이던 올리기가 지운 일정을 다시 써서 되살리면 안 됩니다(2차 검수 2번). */
await db.saveTextItem('todos', { id: 't9', title: '연달아 지울 일', done: false });
await db.saveTextItem('events', { id: 'e9', title: '연달아 지울 일정', date: '2026-10-31' });
await db.saveTextItem('notes', { id: 'n9', text: '연달아 지울 메모' });
await db.flushCloud();
check(await cloudDoc('events', 'e9'), '검사 준비: e9가 올라가지 않았습니다');
slowPush = 30;
await db.removeItem('todos', 't9');
await db.removeItem('events', 'e9');
await db.removeItem('notes', 'n9');
await db.flushCloud();
slowPush = 0;
await db.flushCloud();
check(!(await cloudDoc('events', 'e9')) && !(await cloudDoc('todos', 't9')) && !(await cloudDoc('notes', 'n9')), `연달아 지운 줄이 클라우드에 남았습니다: e9=${JSON.stringify(await cloudDoc('events', 'e9'))}`);
await db.pullFromCloudNow();
check(!row('events', 'e9'), '연달아 지운 일정이 되살아났습니다');
/* 지운 줄의 해시가 되살아나면, 같은 내용으로 되살린(되돌리기) 일정이 '이미 올림'으로 보여 안 올라갑니다. */
await db.saveTextItem('events', { id: 'e9', title: '연달아 지울 일정', date: '2026-10-31' });
await db.flushCloud();
check(await cloudDoc('events', 'e9'), '지운 뒤 같은 내용으로 되살린 일정이 클라우드에 올라가지 않았습니다(올리는 중 지운 해시가 되살아남)');
await db.removeItem('events', 'e9');
await db.flushCloud();
/* 올리기 결과는 올리는 동안 이 기기에서 지운 해시를 되살리지 않습니다. */
const merged = db.mergePushedHashes({ 'events/a': 'x', 'todos/b': 'y' }, { 'todos/b': 'y' }, { 'events/a': 'x', 'todos/b': 'y2', 'notes/c': 'z' });
check(!('events/a' in merged) && merged['todos/b'] === 'y2' && merged['notes/c'] === 'z', `올리기 결과가 지운 해시를 되살렸습니다: ${JSON.stringify(merged)}`);
/* 지운 뒤 시각이 찍혔어도 내용이 지운 줄 그대로면 지우고, 내용이 다르면(다른 기기가 고침) 남깁니다. */
const ev = { id: 'e10', title: '같은 일정', date: '2026-10-31', kind: '학급' };
const same = printDigest(rowMark('events', ev).mark);
const later = { ...toCloudRow('events', ev).body, updatedAt: { toMillis: () => 2000 } };
check(keepCloudDoc('events', 'e10', later, { notAfter: 1000, expect: same }) === false, '지운 줄과 같은 내용인데 남겼습니다');
check(keepCloudDoc('events', 'e10', { ...later, title: '다른 기기가 고침' }, { notAfter: 1000, expect: same }) === true, '지운 뒤 다른 기기가 고친 일정을 지웠습니다');
check(keepCloudDoc('events', 'e10', later, { notAfter: 1000 }) === true, '요약 없이 늦은 문서를 지웠습니다');

/* 10) 다른 기기에서 마지막 줄까지 지워 클라우드가 비어도, 자동 받기가 올린 그대로인 줄을 지웁니다(2차 검수 1번). */
await db.flushCloud();
bareProfile = true;
rejectKeys = new Set(['todos/t6', 'todos/t7']);
await db.saveTextItem('todos', { ...row('todos', 't6'), title: '빈 클라우드 거절 v3' });
await db.saveTextItem('todos', { ...row('todos', 't7'), title: '빈 클라우드 거절 v4' });
const keptRejected = [title('t6'), title('t7')];
await db.saveTextItem('events', { id: 'e11', title: '마지막 일정', date: '2026-11-02' });
await db.flushCloud();
await env.clearFirestore();
await db.refreshFromCloud({ force: true });
rejectKeys = new Set();
check(!row('events', 'e11') && db.snapshot().events.length === 0, `클라우드가 비었는데 다른 기기에서 지운 일정이 남았습니다: ${JSON.stringify(db.snapshot().events)}`);
check(title('t6') === keptRejected[0] && title('t7') === keptRejected[1], `클라우드가 비었을 때 거절된(안 올라간) 줄까지 지웠습니다: ${JSON.stringify(keptRejected)} → ${title('t6')},${title('t7')}`);

/* 11) 서비스 워커: 옛 판 페이지가 요청한 옛 assets와 목록 파일은 새 캐시에 넣지 않습니다(2차 검수 3번). */
{
    const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
    const start = sw.indexOf('function assetSuffix');
    const end = sw.indexOf('/* stale-assets-end */');
    const box = { URL };
    vm.runInNewContext(`${sw.slice(start, end)}\nthis.shouldStoreRuntime = shouldStoreRuntime;`, box);
    const scope = 'https://teacher.github.io/All-in-One-Home/sw.js';
    const base = 'https://teacher.github.io/All-in-One-Home/';
    const list = ['./', './index.html', './assets/index-NEW.js', './assets/index-NEW.css'];
    const store = (path) => box.shouldStoreRuntime(base + path, list, scope);
    check(sw.includes('shouldStoreRuntime(request.url, PRECACHE'), '서비스 워커가 저장 전에 shouldStoreRuntime을 보지 않습니다');
    check(!store('assets/index-OLD.js') && !store('assets/index-OLD.css'), '옛 판 assets를 새 캐시에 넣습니다');
    check(!store('precache-manifest.js?v=ssug-gyomu-shell-v40'), '목록 파일을 런타임 캐시에 넣습니다');
    check(store('assets/index-NEW.js') && store('index.html') && store('sounds/ding.mp3') && store('icon-jjaem.svg'), '목록의 파일이나 소리·아이콘을 저장하지 않습니다');
}

await env.cleanup();
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('check:cloudpull ok');
process.exit(0);
