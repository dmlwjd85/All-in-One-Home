import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';
import { migrateLegacy } from '../scripts/migrate-legacy-lib.mjs';
import { pullSensitiveToDevice } from '../src/lib/sensitiveCloud.js';

const testEnv = await initializeTestEnvironment({
    projectId: 'demo-homenote',
    firestore: {
        rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'),
        host: '127.0.0.1',
        port: 8080,
    },
});

const own = (uid, name, id) => `artifacts/home-note-app/users/${uid}/${name}/${id}`;
const legacy = (name, id) => `artifacts/home-note-app/public/data/${name}/${id}`;

beforeEach(async () => {
    await testEnv.clearFirestore();
});

after(async () => {
    await testEnv.cleanup();
});

test('본인 기록은 읽고 쓸 수 있습니다', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    const ref = doc(alice, own('alice', 'teacherTodos', 'todo1'));
    await assertSucceeds(setDoc(ref, { text: '인쇄' }));
    await assertSucceeds(updateDoc(ref, { text: '수정' }));
    await assertSucceeds(getDoc(ref));
    await assertSucceeds(getDocs(collection(alice, 'artifacts/home-note-app/users/alice/teacherTodos')));
    await assertSucceeds(setDoc(doc(alice, own('alice', 'praiseBoard', 'board')), { goal: 5 }));
    await assertSucceeds(setDoc(doc(alice, own('alice', 'notebookFields', 'p10')), { page: 10, fields: { a: '1' } }));
    await assertSucceeds(setDoc(doc(alice, own('alice', '_meta', 'legacyImport')), { version: 1 }));
    await assertSucceeds(deleteDoc(ref));
});

test('다른 계정과 비로그인은 내 기록을 열 수 없습니다', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(setDoc(doc(alice, own('alice', 'counselNotes', 'c1')), { text: '면담' }));

    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertFails(getDoc(doc(bob, own('alice', 'counselNotes', 'c1'))));
    await assertFails(getDocs(collection(bob, 'artifacts/home-note-app/users/alice/counselNotes')));
    await assertFails(setDoc(doc(bob, own('alice', 'teacherTodos', 'x')), { text: '침입' }));
    await assertFails(deleteDoc(doc(bob, own('alice', 'counselNotes', 'c1'))));

    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, own('alice', 'counselNotes', 'c1'))));
    await assertFails(setDoc(doc(anon, own('alice', 'teacherTodos', 'x')), { text: '침입' }));
    await assertFails(getDocs(collection(anon, 'artifacts/home-note-app/users/alice/teacherTodos')));
});

test('예전 공유 경로는 로그인 사용자에게도 모두 거부합니다', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), legacy('teacherTodos', 'old1')), { text: '공유되던 할 일' });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(alice, legacy('teacherTodos', 'old1'))));
    await assertFails(getDocs(collection(alice, 'artifacts/home-note-app/public/data/teacherTodos')));
    await assertFails(setDoc(doc(alice, legacy('teacherTodos', 'new')), { text: '추가' }));
    await assertFails(updateDoc(doc(alice, legacy('teacherTodos', 'old1')), { text: '수정' }));
    await assertFails(deleteDoc(doc(alice, legacy('teacherTodos', 'old1'))));

    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, legacy('teacherTodos', 'old1'))));
    await assertFails(getDocs(collection(anon, 'artifacts/home-note-app/public/data/teacherTodos')));
});

function installMemoryStorage() {
    const mem = new Map();
    globalThis.localStorage = {
        getItem: (key) => (mem.has(key) ? mem.get(key) : null),
        setItem: (key, value) => mem.set(key, String(value)),
        removeItem: (key) => mem.delete(key),
        clear: () => mem.clear(),
    };
    if (!globalThis.window) {
        globalThis.window = {
            dispatchEvent() {},
            addEventListener() {},
            removeEventListener() {},
        };
    }
    return mem;
}

function adminDb() {
    if (!getApps().length) initializeApp({ projectId: 'demo-homenote' });
    return getFirestore();
}

test('관리자 이전은 지정 계정으로 복사만 하고 원본을 남깁니다', async () => {
    const db = adminDb();
    await db.doc('artifacts/home-note-app/public/data/teacherTodos/old1').set({ text: '공유 할 일' });
    await db.doc('artifacts/home-note-app/public/data/counselNotes/c1').set({ text: '상담 내용', student: '3번' });
    await db.doc('artifacts/home-note-app/public/data/ssugeokInbox/s1').set({ text: '#상담 메모', tags: ['상담'] });
    await db.doc('artifacts/home-note-app/public/data/ssugeokInbox/n1').set({ text: '회의 메모' });
    await db.doc('artifacts/home-note-app/public/data/notebookFields/p260').set({ page: 260, fields: { t0: '상담 칸' } });
    await db.doc('artifacts/home-note-app/public/data/notebookFields/p10').set({ page: 10, fields: { a: '관찰' } });

    const dry = await migrateLegacy({ db, appId: 'home-note-app', uid: 'alice', dryRun: true });
    assert.equal(dry.deletedSource, false);
    assert.equal(dry.counts.teacherTodos.copied, 1);
    assert.equal((await db.doc('artifacts/home-note-app/users/alice/teacherTodos/old1').get()).exists, false);

    const copied = await migrateLegacy({ db, appId: 'home-note-app', uid: 'alice', dryRun: false });
    assert.equal(copied.counts.teacherTodos.copied, 1);
    assert.equal(copied.counts.counselNotes.copied, 1);
    assert.equal((await db.doc('artifacts/home-note-app/public/data/teacherTodos/old1').get()).exists, true);
    assert.equal((await db.doc('artifacts/home-note-app/users/alice/teacherTodos/old1').get()).data().text, '공유 할 일');

    const again = await migrateLegacy({ db, appId: 'home-note-app', uid: 'alice', dryRun: false });
    assert.equal(again.counts.teacherTodos.copied, 0);
    assert.equal(again.counts.teacherTodos.skipped, 1);

    const alice = testEnv.authenticatedContext('alice').firestore();
    const bob = testEnv.authenticatedContext('bob').firestore();
    await assertSucceeds(getDoc(doc(alice, own('alice', 'teacherTodos', 'old1'))));
    await assertFails(getDoc(doc(bob, own('alice', 'teacherTodos', 'old1'))));
    await assertFails(getDoc(doc(alice, legacy('teacherTodos', 'old1'))));
    await assertFails(getDocs(collection(bob, 'artifacts/home-note-app/public/data/teacherTodos')));

    installMemoryStorage();
    const moved = await pullSensitiveToDevice(alice, 'home-note-app', 'alice');
    assert.equal(moved.counselNotes, 1);
    assert.equal(moved.inbox, 1);
    assert.equal(moved.pages, 1);
    assert.equal((await getDoc(doc(alice, own('alice', 'counselNotes', 'c1')))).exists(), false);
    assert.equal((await getDoc(doc(alice, own('alice', 'ssugeokInbox', 's1')))).exists(), false);
    assert.equal((await getDoc(doc(alice, own('alice', 'ssugeokInbox', 'n1')))).data().text, '회의 메모');
    assert.equal((await getDoc(doc(alice, own('alice', 'notebookFields', 'p260')))).exists(), false);
    assert.equal((await getDoc(doc(alice, own('alice', 'notebookFields', 'p10')))).data().fields.a, '관찰');
    assert.match(localStorage.getItem('homenote_v2_counselNotes'), /상담 내용/);
    assert.match(localStorage.getItem('homenote_v2_ssugeokSensitive'), /#상담 메모/);
    assert.match(localStorage.getItem('homenote_v2_notebookFields_p260'), /상담 칸/);
    assert.equal((await db.doc('artifacts/home-note-app/public/data/counselNotes/c1').get()).exists, true);
    await assertFails(deleteDoc(doc(bob, own('alice', 'teacherTodos', 'old1'))));
});

test('그 밖의 경로는 모두 거부합니다', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(alice, 'secrets/password')));
    await assertFails(setDoc(doc(alice, 'artifacts/home-note-app/public/other/x/y'), { text: '우회' }));
    await assertFails(getDoc(doc(alice, 'artifacts/home-note-app/users/alice/teacherTodos/todo1/secret/extra')));
});
