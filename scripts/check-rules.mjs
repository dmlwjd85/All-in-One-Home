/** 에뮬레이터에서 건강·보건이 든 글이 거절되는지 확인합니다. 비밀 값은 쓰지 않습니다. */
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, setDoc } from 'firebase/firestore';
import { rulesSafeTextBody } from '../src/lib/sensitive.js';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const safeLine = `function safeText(v) { return !v.matches('${rulesSafeTextBody()}'); }`;
if (!rules.includes(safeLine)) {
    console.error('규칙의 safeText가 앱 민감 낱말과 다릅니다.');
    process.exit(1);
}

const hostEnv = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
const [host, portText] = hostEnv.split(':');
const testEnv = await initializeTestEnvironment({
    projectId: 'demo-ssug-rules',
    firestore: {
        rules,
        host,
        port: Number(portText),
    },
});

const db = testEnv.authenticatedContext('teacher-a').firestore();
const failures = [];

async function expectDeny(label, write) {
    try {
        await assertFails(write());
    } catch (error) {
        failures.push(`${label} 쓰기가 거절되지 않았습니다. ${error?.message || error}`);
    }
}

async function expectAllow(label, write) {
    try {
        await assertSucceeds(write());
    } catch (error) {
        failures.push(`${label} 쓰기가 거절되었습니다. ${error?.message || error}`);
    }
}

try {
    await expectDeny('학생 메모 건강', () => setDoc(doc(db, 'users/teacher-a/students/s3'), { no: 3, name: '박서준', memo: '건강 특이' }));
    await expectDeny('학생 메모 보건', () => setDoc(doc(db, 'users/teacher-a/students/s5'), { no: 5, name: '강민우', memo: '보건실' }));
    await expectAllow('학생 메모 반장', () => setDoc(doc(db, 'users/teacher-a/students/s4'), { no: 4, name: '윤채원', memo: '반장' }));
    await expectDeny('기록 건강', () => setDoc(doc(db, 'users/teacher-a/records/r1'), {
        date: '2026-10-19', kind: 'observe', text: '건강 특이', source: 'app',
    }));
    await expectDeny('기록 보건', () => setDoc(doc(db, 'users/teacher-a/records/r2'), {
        date: '2026-10-19', kind: 'counsel', text: '보건 상담', source: 'app',
    }));
    await expectAllow('평범한 기록', () => setDoc(doc(db, 'users/teacher-a/records/r3'), {
        date: '2026-10-19', kind: 'observe', text: '발표를 끝까지 했어요', source: 'app',
    }));
    const stranger = testEnv.unauthenticatedContext().firestore();
    await expectDeny('로그인 없이', () => setDoc(doc(stranger, 'users/teacher-a/students/s9'), { no: 9, name: '장하람' }));
} finally {
    await testEnv.cleanup();
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('에뮬레이터에서 건강·보건 쓰기를 거절했습니다.');
