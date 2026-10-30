import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './index.css';

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
    /* 새 판이 자리를 잡으면 다시 엽니다. 쓰던 글을 잃지 않게 화면이 가려졌을 때(다른 앱으로 갔을 때)만 다시 엽니다. */
    let hadController = Boolean(navigator.serviceWorker.controller);
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController) { hadController = true; return; }
        const reload = () => { if (document.hidden) window.location.reload(); };
        if (document.hidden) window.location.reload();
        else document.addEventListener('visibilitychange', reload);
    });
}
