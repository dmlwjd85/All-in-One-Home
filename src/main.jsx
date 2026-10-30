import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { reloadWhenSafe, restoreDrafts, trackTyping } from './lib/swReload.js';

createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <App />
    </React.StrictMode>,
);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        /* updateViaCache: 'none' 이면 sw.js 와 importScripts 목록을 HTTP 캐시 없이 다시 받습니다.
           기본값 imports 는 목록만 max-age=600 사본을 써서, 없는 파일 주소로 설치가 실패합니다. */
        navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' })
            .then((reg) => {
                /* 새 판을 한 시간마다, 그리고 앱으로 돌아올 때 확인합니다(옛 판이 오래 남지 않게). */
                setInterval(() => reg.update().catch(() => {}), 60 * 60 * 1000);
                document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
            })
            .catch(() => {});
    });
    /* 새 판이 자리를 잡으면 다시 엽니다. 화면이 가려졌고 쓰던 글이 남아 있지 않을 때만 다시 열고,
       열기 전 입력란을 초안으로 적어 두었다가 되돌립니다(PR #57 r2 검수 1번). 남은 글이 있으면 다음에 가려질 때 다시 봅니다. */
    const typing = trackTyping(document);
    restoreDrafts(document, sessionStorage, location).catch?.(() => {});
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) { hadController = true; return; }
        reloadWhenSafe({ typing });
    });
}
