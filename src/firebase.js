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
        if (name === 'VITE_FIREBASE_AUTH_DOMAIN') return import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
    } catch {
        return '';
    }
    return '';
}

export function newFirebaseConfig() {
    const config = readConfig(viteValue('VITE_FIREBASE_CONFIG'));
    if (!config) return null;
    if (config.projectId !== 'ssug-gyomu') return null;
    const domain = String(viteValue('VITE_FIREBASE_AUTH_DOMAIN') || '').trim();
    if (domain && /^[A-Za-z0-9.-]+$/.test(domain)) return { ...config, authDomain: domain };
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

let bundle = null;
/* 검사용 주입(배포 코드에서는 null). check-syncchip이 가짜 firebase/auth와 설정을 넣어 동작을 확인합니다. */
let testAuthModule = null;
let testConfig = null;

export function cloudReady() {
    return Boolean(testConfig || newFirebaseConfig());
}
export function useFirebaseForTest({ authModule = null, config = null, bundle: preset } = {}) {
    testAuthModule = authModule;
    testConfig = config;
    if (preset !== undefined) bundle = preset;
    appliedMode = null;
}
const authModule = () => testAuthModule || import('firebase/auth');

/** 공용 컴퓨터 모드인지. db.js가 같은 키(ssug-gyomu-shared)에 적어 둡니다(이 파일은 db.js를 불러오지 않습니다). */
export function sharedPcOn() {
    try {
        return localStorage.getItem('ssug-gyomu-shared') === '1';
    } catch {
        return false;
    }
}

/**
 * 로그인을 어디에 둘지 정합니다. 공용 컴퓨터면 이 탭에만(browserSessionPersistence) 두어 탭을 닫으면 로그아웃되고,
 * 아니면 파이어베이스 기본값(browserLocalPersistence, 브라우저에 계속 남음)입니다.
 * 바꾸지 못해도 30분 잠금과 로그아웃은 그대로 작동합니다.
 */
let appliedMode = null;
async function applyPersistence(auth, shared) {
    if (!auth) return false;
    const mode = shared ? 'session' : 'local';
    if (appliedMode?.auth === auth && appliedMode.mode === mode) return true;
    try {
        const { browserLocalPersistence, browserSessionPersistence, setPersistence } = await authModule();
        await setPersistence(auth, shared ? browserSessionPersistence : browserLocalPersistence);
        appliedMode = { auth, mode };
        return true;
    } catch {
        return false;
    }
}

/** 설정에서 공용 컴퓨터 모드를 켜고 끌 때 부릅니다. 이미 로그인해 있으면 지금 로그인도 옮깁니다. */
export async function setLoginPersistence(shared) {
    if (!bundle) return false;
    return applyPersistence(bundle.auth, shared);
}

/** 지금 정해진 로그인 보관 방식('session' | 'local' | null). 검사용. */
export function loginPersistence() {
    return appliedMode?.mode || null;
}

export async function loadFirebase({ memoryOnly = false } = {}) {
    const config = testConfig || newFirebaseConfig();
    if (!config) return null;
    if (bundle && bundle.memoryOnly === memoryOnly) {
        if (memoryOnly || sharedPcOn()) await applyPersistence(bundle.auth, true);
        return bundle;
    }
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
    if (memoryOnly || sharedPcOn()) await applyPersistence(bundle.auth, true);
    return bundle;
}

/** 로그인할 때 쓸 설정. 이미 띄운 묶음이 있으면 그 방식을 그대로, 없으면 공용 컴퓨터 여부를 따릅니다. */
export function loginLoadOptions() {
    return { memoryOnly: bundle ? bundle.memoryOnly : sharedPcOn() };
}

export async function signInGoogle() {
    const ready = await loadFirebase(loginLoadOptions());
    if (!ready) {
        const error = new Error('설정 없음');
        error.code = 'no-config';
        throw error;
    }
    const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await authModule();
    const { pickLoginMode } = await import('./lib/googleLogin.js');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const mode = pickLoginMode({
        authDomain: ready.auth?.config?.authDomain || '',
        host: location.host,
        nav: navigator,
        win: window,
    });
    if (mode === 'redirect') {
        await signInWithRedirect(ready.auth, provider);
        return null;
    }
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
    const ready = await loadFirebase(loginLoadOptions());
    if (!ready) return null;
    const { getRedirectResult } = await authModule();
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
