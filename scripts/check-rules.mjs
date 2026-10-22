/** 에뮬레이터에서 건강·보건이 든 글이 거절되는지, 끝 시각이 두 기기에 남는지 확인합니다. 비밀 값은 쓰지 않습니다. */
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { eventBodyWithoutEndTime, fromCloudRow, toCloudRow } from '../src/lib/cloudShape.js';
import { eventClock } from '../src/lib/date.js';
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

    const uid = 'teacher-span';
    const deviceA = testEnv.authenticatedContext(uid).firestore();
    const deviceB = testEnv.authenticatedContext(uid).firestore();
    const ranged = toCloudRow('events', {
        id: 'span1',
        date: '2026-10-30',
        title: '학부모 진로 특강',
        time: '14:00',
        endTime: '16:00',
        kind: '학급',
        memo: '강당',
        source: 'msg',
    });
    const plain = toCloudRow('events', {
        id: 'plain1',
        date: '2026-10-23',
        title: '과학관 현장체험학습',
        time: '08:50',
        kind: '학급',
        source: 'app',
    });
    if (!ranged?.body?.endTime || plain?.body?.endTime) {
        failures.push('올리는 일정 모양에 끝 시각이 빠지거나, 끝 시각이 없는 일정에 생겼습니다.');
    } else {
        await expectAllow('끝 시각 있는 일정', () => setDoc(doc(deviceA, `users/${uid}/events/${ranged.id}`), ranged.body));
        await expectAllow('끝 시각 없는 일정', () => setDoc(doc(deviceA, `users/${uid}/events/${plain.id}`), plain.body));
        await expectDeny('잘못된 끝 시각', () => setDoc(doc(deviceA, `users/${uid}/events/bad1`), {
            date: '2026-10-30', title: '워크숍', time: '13:00', endTime: '16:00까지', kind: 'class', source: 'app',
        }));
        const pulled = [];
        for (const id of [ranged.id, plain.id]) {
            const snap = await getDoc(doc(deviceB, `users/${uid}/events/${id}`));
            const row = snap.exists() ? fromCloudRow('events', snap.id, snap.data()) : null;
            if (row) pulled.push(row);
        }
        const emptyStore = [];
        const merged = new Map(emptyStore.map((row) => [String(row.id), row]));
        pulled.forEach((row) => {
            if (!row?.id || merged.has(String(row.id))) return;
            merged.set(String(row.id), row);
        });
        const onSecond = [...merged.values()];
        const spanRow = onSecond.find((row) => row.id === ranged.id);
        const plainRow = onSecond.find((row) => row.id === plain.id);
        if (!spanRow || eventClock(spanRow) !== '14:00–16:00' || spanRow.memo !== '강당') {
            failures.push(`빈 저장소에서 14:00–16:00이 유지되지 않았습니다. ${JSON.stringify(spanRow)}`);
        }
        if (!plainRow || plainRow.endTime || eventClock(plainRow) !== '08:50') {
            failures.push(`끝 시각이 없는 기존 일정이 빈 저장소에서 달라졌습니다. ${JSON.stringify(plainRow)}`);
        }
    }

    const oldRules = rules
        .replace(", 'endTime'", '')
        .replace("\n          && (!('endTime' in d()) || hm(d().endTime))", '');
    if (oldRules.includes('endTime')) {
        failures.push('예전 규칙에서 endTime을 빼지 못했습니다.');
    } else {
        const oldEnv = await initializeTestEnvironment({
            projectId: 'demo-ssug-rules-old',
            firestore: { rules: oldRules, host, port: Number(portText) },
        });
        try {
            const oldA = oldEnv.authenticatedContext(uid).firestore();
            const oldB = oldEnv.authenticatedContext(uid).firestore();
            const blocked = toCloudRow('events', {
                id: 'span1',
                date: '2026-10-30',
                title: '학부모 진로 특강',
                time: '14:00',
                endTime: '16:00',
                kind: '학급',
                memo: '강당',
                source: 'msg',
            });
            const fallback = eventBodyWithoutEndTime(blocked.body);
            await expectDeny('예전 규칙의 끝 시각', () => setDoc(doc(oldA, `users/${uid}/events/${blocked.id}`), blocked.body));
            if (!fallback || fallback.endTime) {
                failures.push('거절된 일정에서 끝 시각을 빼지 못했습니다.');
            } else {
                await expectAllow('예전 규칙의 메모 재시도', () => setDoc(doc(oldA, `users/${uid}/events/${blocked.id}`), fallback));
                const snap = await getDoc(doc(oldB, `users/${uid}/events/${blocked.id}`));
                const row = snap.exists() ? fromCloudRow('events', snap.id, snap.data()) : null;
                if (!row || row.endTime || row.time !== '14:00' || !String(row.memo).includes('16:00까지') || !String(row.memo).includes('강당')) {
                    failures.push(`예전 규칙에서 다시 올린 일정이 다른 기기에 남지 않았습니다. ${JSON.stringify(row)}`);
                }
            }
        } finally {
            await oldEnv.cleanup();
        }
    }
} finally {
    await testEnv.cleanup();
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('에뮬레이터에서 건강·보건 쓰기를 거절했고, 같은 계정의 빈 저장소에 14:00–16:00이 남았습니다.');
