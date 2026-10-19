/** 새 프로젝트 ssug-gyomu 설정은 환경 변수로만 받습니다. 값이 없으면 이 기기 저장만 씁니다. */

function readConfig(raw) {
    if (!raw || !String(raw).trim()) return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
        if (!parsed.apiKey || !parsed.projectId || !parsed.authDomain) return null;
        return parsed;
    } catch {
        return null;
    }
}

function envOf(name) {
    return import.meta.env?.[name];
}

export function newFirebaseConfig() {
    const config = readConfig(envOf('VITE_FIREBASE_CONFIG'));
    if (!config) return null;
    if (config.projectId === 'sambong-world-2026') return null;
    return config;
}

export function legacyFirebaseConfig() {
    const config = readConfig(envOf('VITE_LEGACY_FIREBASE_CONFIG'));
    if (!config || config.projectId !== 'sambong-world-2026') return null;
    return config;
}

export function cloudReady() {
    return Boolean(newFirebaseConfig());
}

let bundle = null;

export async function loadFirebase({ memoryOnly = false } = {}) {
    const config = newFirebaseConfig();
    if (!config) return null;
    if (bundle && bundle.memoryOnly === memoryOnly) return bundle;
    const [{ initializeApp, getApps }, { getAuth }, firestore] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
    ]);
    const app = getApps().find((item) => item.name === '[DEFAULT]') || initializeApp(config);
    let cache;
    try {
        cache = memoryOnly
            ? firestore.memoryLocalCache()
            : firestore.persistentLocalCache({ tabManager: firestore.persistentMultipleTabManager() });
    } catch {
        cache = firestore.memoryLocalCache();
    }
    let db;
    try {
        db = firestore.initializeFirestore(app, { localCache: cache });
    } catch {
        db = firestore.getFirestore(app);
    }
    bundle = { app, auth: getAuth(app), db, memoryOnly };
    return bundle;
}

export async function signInGoogle() {
    const ready = await loadFirebase();
    if (!ready) {
        const error = new Error('설정 없음');
        error.code = 'no-config';
        throw error;
    }
    const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    return signInWithPopup(ready.auth, provider);
}

export async function signOutFirebase() {
    if (!bundle) return;
    const { signOut } = await import('firebase/auth');
    await signOut(bundle.auth);
}
