/** 과제 동기화: 옛 규칙이면 원본 노트를 남기고, 계정을 바꾸면 과제가 새 계정으로 올라가지 않으며, 과제만 받아도 합칩니다. */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, doc, getDoc, getDocs, serverTimestamp, updateDoc } from 'firebase/firestore';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const [host, portText] = String(process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
const port = Number(portText);
const prevRules = readFileSync(new URL('./fixtures/firestore.rules.prev', import.meta.url), 'utf8');
const nextRules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const vault = () => {
    const map = new Map();
    return { get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } };
};
const mem = new Map();
globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
};

const fb = await import('../src/firebase.js');
const cloud = await import('../src/lib/cloud.js');
const db = await import('../src/lib/db.js');
const { chipState, syncStatus } = await import('../src/lib/syncStatus.js');
db.useVaultsForTest(vault(), vault(), vault());
const wire = (fs) => {
    fb.useFirebaseForTest({ config: { apiKey: 'demo', projectId: 'demo-ssug-rules', authDomain: 'demo.local' }, bundle: { app: null, auth: null, db: fs, memoryOnly: false } });
    db.useCloudForTest({
        available: () => true,
        push: cloud.pushUserData,
        pull: cloud.pullUserData,
        remove: cloud.deleteUserDoc,
        peek: null,
        clock: cloud.measureServerClock,
        sweep: () => 0,
        watch: () => () => {},
    });
};
const ids = async (fs, uid, name) => {
    try {
        const snap = await getDocs(collection(fs, 'users', uid, name));
        return snap.docs.map((item) => item.id);
    } catch {
        return null;
    }
};

const oldEnv = await initializeTestEnvironment({ projectId: 'demo-ssug-old', firestore: { host, port, rules: prevRules } });
try {
    const fs = oldEnv.authenticatedContext('teacher-a').firestore();
    wire(fs);
    await db.boot('');
    await db.setAuth({ uid: 'teacher-a' });
    await wait(300);
    await db.update((draft) => {
        draft.notes.push({
            id: 'hw-keep', title: '옮기기 전 과제', text: '과제 체크 기록이에요.\n@@HW1\n{"v":1,"made":10,"metaAt":10,"roster":["s1"],"checks":{"s1":{"at":10,"on":1}}}',
            date: '2026-11-16', tags: ['회의', '과제'], pinned: false, source: 'app',
        });
        draft.notes.push({ id: 'hx-hw-keep-s2', title: 'hw-keep', text: 's2', tags: ['제출'], pinned: false, source: 'app' });
        return draft;
    });
    await db.flushCloud();
    await db.addHomework('다른 과제', '2026-11-16', 'hw-extra', ['s1']);
    await db.flushCloud();
    await wait(200);
    const notes = await ids(fs, 'teacher-a', 'notes');
    check(notes?.includes('hw-keep') && notes?.includes('hx-hw-keep-s2'), `옛 규칙에서 원본 노트가 지워졌습니다: ${JSON.stringify(notes)}`);
    const homework = await ids(fs, 'teacher-a', 'homework');
    check(homework == null || homework.length === 0, `옛 규칙인데 과제 컬렉션에 문서가 있습니다: ${JSON.stringify(homework)}`);
    check(chipState({ cloudReady: true, signedIn: true, online: true, status: syncStatus() })?.label === '과제는 아직 이 기기에만 있어요', `거절 뒤 칩이 동기화됨입니다: ${syncStatus().homeworkLocal}`);
    check((db.snapshot().homework || []).some((row) => row.id === 'hw-keep' && row.checks?.s1?.on === 1 && row.checks?.s2?.on === 1), '이 기기 과제로 제출이 모이지 않았습니다.');
} finally {
    await oldEnv.cleanup();
}

const env = await initializeTestEnvironment({ projectId: 'demo-ssug-new', firestore: { host, port, rules: nextRules } });
try {
    const fsA = env.authenticatedContext('teacher-a').firestore();
    wire(fsA);
    await db.setAuth({ uid: 'teacher-a' });
    await wait(200);
    const added = await db.addHomework('계정 과제', '2026-11-16', 'hw-acct', ['s1']);
    check(added.ok, '과제를 만들지 못했습니다.');
    await db.toggleHomeworkSubmit('hw-acct', 's1');
    await db.flushCloud();
    await wait(200);
    check((await ids(fsA, 'teacher-a', 'homework'))?.includes('hw-acct'), '새 규칙에서 과제가 올라가지 않습니다.');
    const fsB = env.authenticatedContext('teacher-b').firestore();
    wire(fsB);
    await db.setAuth({ uid: 'teacher-b' });
    await wait(200);
    await db.flushCloud();
    const leaked = await ids(fsB, 'teacher-b', 'homework');
    check(!leaked?.includes('hw-acct'), `다른 계정으로 과제가 올라갔습니다: ${JSON.stringify(leaked)}`);
    check(!(db.snapshot().homework || []).some((row) => row.id === 'hw-acct'), '계정 전환 뒤에도 이전 과제가 화면에 있습니다.');
    wire(fsA);
    await db.setAuth({ uid: 'teacher-a' });
    await wait(200);
    check((db.snapshot().homework || []).some((row) => row.id === 'hw-acct'), '원래 계정으로 돌아오니 과제가 없습니다.');

    const markCheck = async (id, sid) => {
        const ref = doc(fsA, 'users', 'teacher-a', 'homework', id);
        await updateDoc(ref, { [`checks.${sid}`]: `1~${Date.now()}`, updatedAt: serverTimestamp() });
        const pulledNow = await cloud.pullUserData('teacher-a');
        await db.absorbCloudForTest(pulledNow, {});
        return ref;
    };
    await db.addHomework('되돌리기', '2026-11-16', 'hw-u4', ['s1', 's2']);
    await db.toggleHomeworkSubmit('hw-u4', 's1');
    await db.flushCloud();
    await markCheck('hw-u4', 's2');
    await db.undo();
    await db.flushCloud();
    const u4 = (await getDoc(doc(fsA, 'users', 'teacher-a', 'homework', 'hw-u4'))).data()?.checks || {};
    check(String(u4.s2 || '').startsWith('1~') && !String(u4.s1 || '').startsWith('1~'), `되돌리기가 다른 기기 체크 s2를 지웠습니다: ${JSON.stringify(u4)}`);

    await db.addHomework('예전이름', '2026-11-16', 'hw-u5', ['s3', 's4']);
    await db.renameHomework('hw-u5', '새이름');
    await db.flushCloud();
    await markCheck('hw-u5', 's3');
    await markCheck('hw-u5', 's4');
    await db.undo();
    await db.flushCloud();
    const u5doc = (await getDoc(doc(fsA, 'users', 'teacher-a', 'homework', 'hw-u5'))).data() || {};
    check(u5doc.title === '예전이름' && String(u5doc.checks?.s3 || '').startsWith('1~') && String(u5doc.checks?.s4 || '').startsWith('1~'), `이름 되돌리기가 s3·s4를 지웠습니다: ${JSON.stringify(u5doc.checks)} ${u5doc.title}`);

    await db.addHomework('지울과제', '2026-11-16', 'hw-u2', ['s3']);
    await db.flushCloud();
    await db.removeHomework('hw-u2');
    await db.flushCloud();
    await markCheck('hw-u2', 's3');
    await db.undo();
    await db.flushCloud();
    const u2 = (await getDoc(doc(fsA, 'users', 'teacher-a', 'homework', 'hw-u2'))).data() || {};
    check(!Number(u2.gone) && String(u2.checks?.s3 || '').startsWith('1~'), `삭제 되돌리기가 s3를 껐습니다: ${JSON.stringify(u2.checks)} gone=${u2.gone}`);

    const fsC = env.authenticatedContext('teacher-c').firestore();
    wire(fsC);
    await db.setAuth({ uid: 'teacher-c' });
    await wait(200);
    await db.addHomework('실시간 과제', '2026-11-16', 'hw-live', ['s1']);
    await db.flushCloud();
    await db.update((draft) => { draft.homework = []; return draft; });
    const pulled = await cloud.pullUserData('teacher-c', { only: ['homework'] });
    check((pulled?.homework || []).some((row) => row.id === 'hw-live'), '과제만 받기에 문서가 없습니다.');
    await db.absorbCloudForTest(pulled, {});
    check((db.snapshot().homework || []).some((row) => row.id === 'hw-live' && row.title === '실시간 과제'), '과제만 받은 뒤 합치지 않습니다.');
} finally {
    await env.cleanup();
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('과제 동기화 검사(옛 규칙 원본 보존, 계정 전환, 과제만 받기)를 통과했습니다.');
