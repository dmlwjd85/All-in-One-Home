// Google 로그인 방식 고르기.
// 아이폰 홈 화면 앱은 팝업이 Safari 쪽 저장소로 열려 결과를 앱으로 못 가져옵니다.
// 그래서 로그인 도우미(authDomain)가 앱과 같은 주소(dmlwjd85.github.io)일 때만 이 경우에 리다이렉트로 로그인합니다.
// 데스크톱·안드로이드·아이폰 Safari 탭은 지금처럼 팝업을 씁니다.

const REDIRECT_FLAG = 'authRedirectPending';

export function isIOS(nav = {}) {
    const ua = nav.userAgent || '';
    return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1);
}

export function isStandalone(win, nav = {}) {
    if (nav.standalone === true) return true;
    try {
        return Boolean(win?.matchMedia?.('(display-mode: standalone)').matches);
    } catch {
        return false;
    }
}

export function pickLoginMode({ authDomain, host, nav, win }) {
    const sameOrigin = Boolean(authDomain) && authDomain === host;
    return isIOS(nav) && isStandalone(win, nav) && sameOrigin ? 'redirect' : 'popup';
}

const currentMode = (auth) => pickLoginMode({
    authDomain: auth.config?.authDomain,
    host: window.location.host,
    nav: window.navigator,
    win: window,
});

export function isIosHomeScreenApp() {
    return isIOS(window.navigator) && isStandalone(window, window.navigator);
}

export async function signInWithGoogle(auth) {
    const { GoogleAuthProvider, signInWithPopup, signInWithRedirect } = await import('firebase/auth');
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    if (currentMode(auth) === 'redirect') {
        sessionStorage.setItem(REDIRECT_FLAG, '1');
        return signInWithRedirect(auth, provider);
    }
    return signInWithPopup(auth, provider);
}

/** 리다이렉트로 로그인하고 돌아왔을 때 결과를 받습니다. 그 밖에는 아무것도 하지 않습니다. */
export async function finishRedirectSignIn(auth) {
    if (!sessionStorage.getItem(REDIRECT_FLAG) && currentMode(auth) !== 'redirect') return null;
    sessionStorage.removeItem(REDIRECT_FLAG);
    const { getRedirectResult } = await import('firebase/auth');
    return getRedirectResult(auth);
}
