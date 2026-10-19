const fallbackConfig = {
    apiKey: 'AIzaSyAsih-sfnIZ_gX_1l7SAVZHCAhk3KzmiP8',
    authDomain: 'sambong-world-2026.firebaseapp.com',
    projectId: 'sambong-world-2026',
    storageBucket: 'sambong-world-2026.firebasestorage.app',
    messagingSenderId: '',
    appId: '1:728320769100:web:7510c9a77cca6b87a788e9',
    measurementId: 'G-H1RGMJHGTV',
};

function readViteEnv(read) {
    try {
        return read();
    } catch {
        return undefined;
    }
}

const firebaseFromEnv = readViteEnv(() => import.meta.env.VITE_FIREBASE_CONFIG);
const appFromEnv = readViteEnv(() => import.meta.env.VITE_APP_ID);
// 로그인 도우미 주소. 배포에서 dmlwjd85.github.io로 두면 앱과 같은 주소에서 로그인해요(아이폰 홈 화면 앱용).
const authDomainFromEnv = readViteEnv(() => import.meta.env.VITE_FIREBASE_AUTH_DOMAIN);

const baseConfig = firebaseFromEnv
    ? JSON.parse(firebaseFromEnv)
    : fallbackConfig;
export const firebaseConfig = authDomainFromEnv
    ? { ...baseConfig, authDomain: authDomainFromEnv }
    : baseConfig;

export const appId = appFromEnv || 'home-note-app';

let bundle = null;

/** Firebase SDK는 로그인·동기화가 필요할 때만 불러옵니다. */
export async function loadFirebase() {
    if (bundle) return bundle;
    const [{ initializeApp, getApps }, { getAuth }, { getFirestore }] = await Promise.all([
        import('firebase/app'),
        import('firebase/auth'),
        import('firebase/firestore'),
    ]);
    const app = getApps()[0] || initializeApp(firebaseConfig);
    bundle = { app, auth: getAuth(app), db: getFirestore(app), appId };
    return bundle;
}
