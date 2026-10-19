import { legacyFirebaseConfig } from '../firebase.js';

/** 예전 공개 경로. 새 앱의 저장 경로가 아닙니다. 선생님이 확인한 뒤에만 지웁니다. */
export const LEGACY_PUBLIC_PATH = ['artifacts', 'home-note-app', 'public', 'data'];
export const CONFIRM_PHRASE = '지우기';

const KNOWN = [
    'ssugeokInbox', 'studentNotes', 'counselNotes', 'teacherPlans', 'teacherTodos', 'teacherAttend',
    'classRoster', 'ledgerTx', 'ledgerBudgets', 'teacherLessons', 'teacherMeets', 'teacherContacts',
    'teacherTimetable', 'familyDiary', 'ddayCards', 'submissionSheets', 'notebookFields',
];

export function legacyCloudReady() {
    return Boolean(legacyFirebaseConfig());
}

async function legacyApp() {
    const config = legacyFirebaseConfig();
    if (!config) return null;
    const { initializeApp, getApps } = await import('firebase/app');
    const { getAuth } = await import('firebase/auth');
    const { getFirestore } = await import('firebase/firestore');
    const name = 'ssug-legacy-public';
    const app = getApps().find((item) => item.name === name) || initializeApp(config, name);
    return { auth: getAuth(app), db: getFirestore(app) };
}

export async function signInLegacy() {
    const ready = await legacyApp();
    if (!ready) {
        const error = new Error('설정 없음');
        error.code = 'no-config';
        throw error;
    }
    const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    return signInWithPopup(ready.auth, provider);
}

export async function listLegacyPublic() {
    const ready = await legacyApp();
    if (!ready) return { ready: false, groups: [] };
    const { collection, getDocs } = await import('firebase/firestore');
    const groups = [];
    for (const name of KNOWN) {
        const snap = await getDocs(collection(ready.db, ...LEGACY_PUBLIC_PATH, name));
        groups.push({
            name,
            count: snap.size,
            ids: snap.docs.slice(0, 8).map((item) => item.id),
        });
    }
    return { ready: true, groups, total: groups.reduce((sum, group) => sum + group.count, 0) };
}

/** 확인 문장이 맞을 때만 지웁니다. 배포 스크립트에서는 호출하지 않습니다. */
export async function deleteLegacyPublic(phrase) {
    if (phrase !== CONFIRM_PHRASE) {
        throw new Error('확인 문장이 달라 지우지 않았어요.');
    }
    const ready = await legacyApp();
    if (!ready?.auth.currentUser) throw new Error('예전 프로젝트에 로그인한 뒤에 지울 수 있어요.');
    const { collection, getDocs, writeBatch, doc } = await import('firebase/firestore');
    let removed = 0;
    for (const name of KNOWN) {
        const snap = await getDocs(collection(ready.db, ...LEGACY_PUBLIC_PATH, name));
        let batch = writeBatch(ready.db);
        let count = 0;
        for (const item of snap.docs) {
            batch.delete(doc(ready.db, ...LEGACY_PUBLIC_PATH, name, item.id));
            count += 1;
            removed += 1;
            if (count === 400) {
                await batch.commit();
                batch = writeBatch(ready.db);
                count = 0;
            }
        }
        if (count) await batch.commit();
    }
    return { removed };
}
