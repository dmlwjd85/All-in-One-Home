import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, beforeEach, test } from 'node:test';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, setDoc, updateDoc } from 'firebase/firestore';

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

test('예전 공유 경로는 로그인 읽기만 허용하고 쓰기는 막습니다', async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
        await setDoc(doc(context.firestore(), legacy('teacherTodos', 'old1')), { text: '공유되던 할 일' });
    });

    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertSucceeds(getDoc(doc(alice, legacy('teacherTodos', 'old1'))));
    await assertSucceeds(getDocs(collection(alice, 'artifacts/home-note-app/public/data/teacherTodos')));
    await assertFails(setDoc(doc(alice, legacy('teacherTodos', 'new')), { text: '추가' }));
    await assertFails(updateDoc(doc(alice, legacy('teacherTodos', 'old1')), { text: '수정' }));
    await assertFails(deleteDoc(doc(alice, legacy('teacherTodos', 'old1'))));

    const anon = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(anon, legacy('teacherTodos', 'old1'))));
    await assertFails(getDocs(collection(anon, 'artifacts/home-note-app/public/data/teacherTodos')));
});

test('그 밖의 경로는 모두 거부합니다', async () => {
    const alice = testEnv.authenticatedContext('alice').firestore();
    await assertFails(getDoc(doc(alice, 'secrets/password')));
    await assertFails(setDoc(doc(alice, 'artifacts/home-note-app/public/other/x/y'), { text: '우회' }));
    await assertFails(getDoc(doc(alice, 'artifacts/home-note-app/users/alice/teacherTodos/todo1/secret/extra')));
});
