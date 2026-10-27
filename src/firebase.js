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

export function cloudReady() {
    return Boolean(newFirebaseConfig());
}

let bundle = null;

/** 공용 컴퓨터 모드인지. db.js가 같은 키에 적어 둡니다(이 파일은 db.js를 불러오지 않아요). */
function sharedPcOn() {
    try {
        return localStorage.getItem('ssug-gyomu-shared') === '1';
    } catch {
        return false;
    }
}

/**
 * 공용 컴퓨터에서는 로그인을 이 탭에만 둡니다(browserSessionPersistence).
 * 그냥 두면 파이어베이스 기본값(브라우저에 계속 남음)이라 창을 닫아도 다음 사람이 이어서 열 수 있었어요.
 */
let sessionApplied = null;
async function keepLoginInTab(auth) {
    if (!auth || sessionApplied === auth) return;
    try {
        const { browserSessionPersistence, setPersistence } = await import('firebase/auth');
        await setPersistence(auth, browserSessionPersistence);
        sessionApplied = auth;
    } catch {
        /* 못 바꿔도 30분 잠금과 로그아웃은 그대로 작동합니다. */
    }
}

function loginMode() {
    return bundle ? bundle.memoryOnly : sharedPcOn();
}

/**
 * 파이어스토어를 엽니다. 공용 컴퓨터면 메모리 캐시만 쓰고, 예전에 이 기기에 남은 캐시(IndexedDB)는 비웁니다.
 * (예전에는 이미 연 인스턴스가 있으면 새 설정이 무시돼서, 공용 PC로 바꿔도 학생 기록이 캐시에 남았어요.)
 */
async function openDb(firestore, app, memoryOnly) {
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
    if (memoryOnly) await firestore.clearIndexedDbPersistence(db).catch(() => {});
    return db;
}

let opening = Promise.resolve();

/**
 * memoryOnly: 메모리 캐시가 필요함(공용 컴퓨터, 이 기기 저장소를 못 쓸 때). 한 번 메모리로 바뀌면 그대로 둡니다.
 * persist: 공용 컴퓨터 모드를 끈 경우처럼 이 기기 캐시로 되돌릴 때만 true.
 */
export async function loadFirebase({ memoryOnly = false, persist = false } = {}) {
    const config = newFirebaseConfig();
    if (!config) return null;
    const run = opening.then(() => openBundle(config, memoryOnly, persist));
    opening = run.then(() => undefined, () => undefined);
    return run;
}

async function openBundle(config, memoryOnly, persist) {
    const wantMemory = memoryOnly || (!persist && sharedPcOn());
    if (bundle) {
        const toMemory = wantMemory && !bundle.memoryOnly;
        const toDisk = persist && !wantMemory && bundle.memoryOnly;
        if (!toMemory && !toDisk) {
            if (bundle.memoryOnly || sharedPcOn()) await keepLoginInTab(bundle.auth);
            return bundle;
        }
    }
    const [{ initializeApp, getApps }, { getAuth }, firestore] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
    ]);
    const app = getApps().find((item) => item.name === '[DEFAULT]') || initializeApp(config);
    if (bundle?.db) {
        // 캐시 방식을 바꿀 때는 열려 있던 것을 닫아야 새 설정이 먹고, 디스크 캐시도 비울 수 있어요.
        const old = bundle.db;
        await firestore.terminate(old).catch(() => {});
        if (wantMemory) await firestore.clearIndexedDbPersistence(old).catch(() => {});
    }
    const db = await openDb(firestore, app, wantMemory);
    const auth = getAuth(app);
    if (wantMemory || sharedPcOn()) await keepLoginInTab(auth);
    bundle = { app, auth, db, memoryOnly: wantMemory };
    return bundle;
}

export async function signInGoogle() {
    const ready = await loadFirebase({ memoryOnly: loginMode() });
    if (!ready) {
        const error = new Error('설정 없음');
        error.code = 'no-config';
        throw error;
    }
    const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth');
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
    const ready = await loadFirebase({ memoryOnly: loginMode() });
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
