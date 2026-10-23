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
        navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { updateViaCache: 'none' }).catch(() => {});
    });
}
