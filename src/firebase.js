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

function viteValue(name) {
    try {
        if (name === 'VITE_FIREBASE_CONFIG') return import.meta.env.VITE_FIREBASE_CONFIG;
        if (name === 'VITE_LEGACY_FIREBASE_CONFIG') return import.meta.env.VITE_LEGACY_FIREBASE_CONFIG;
    } catch {
        return '';
    }
    return '';
}

export function newFirebaseConfig() {
    const config = readConfig(viteValue('VITE_FIREBASE_CONFIG'));
    if (!config) return null;
    if (config.projectId !== 'ssug-gyomu') return null;
    return config;
}

export function legacyFirebaseConfig() {
    const config = readConfig(viteValue('VITE_LEGACY_FIREBASE_CONFIG'));
    if (!config || config.projectId !== 'sambong-world-2026') return null;
    return config;
}

export function loginHint(error) {
    if (!error || error.code === 'no-config' || error.code === 'auth/invalid-api-key') {
        return '아직 클라우드 연결 전이에요. 이 기기에는 저장돼요.';
    }
    if (error.code === 'auth/popup-closed-by-user' || error.code === 'auth/cancelled-popup-request') {
        return '로그인 창을 닫으셨어요. 다시 눌러 주세요.';
    }
    return '로그인하지 못했어요. 잠시 후 다시 눌러 주세요.';
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
    const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
        return await signInWithPopup(ready.auth, provider);
    } catch (error) {
        if (error?.code === 'auth/popup-blocked' || error?.code === 'auth/operation-not-supported-in-this-environment') {
            await signInWithRedirect(ready.auth, provider);
            return null;
        }
        throw error;
    }
}

export async function finishRedirectSignIn() {
    const ready = await loadFirebase();
    if (!ready) return null;
    const { getRedirectResult } = await import('firebase/auth');
    try {
        return await getRedirectResult(ready.auth);
    } catch {
        return null;
    }
}

export async function signOutFirebase() {
    if (!bundle) return;
    const { signOut } = await import('firebase/auth');
    await signOut(bundle.auth);
}
