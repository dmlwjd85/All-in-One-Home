import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './notebook/notebook.css';
import './notebook/diary/diary.css';

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        const base = import.meta.env.BASE_URL || './';
        navigator.serviceWorker.register(`${base}sw.js`).catch((err) => {
            console.warn('서비스 워커 등록 실패', err);
        });
    });
}

const rootEl = document.getElementById('root');

try {
    ReactDOM.createRoot(rootEl).render(<App />);
} catch (err) {
    console.error(err);
    rootEl.innerHTML = '<p style="padding:2rem;font-family:sans-serif;">화면을 열지 못했습니다. 페이지를 새로고침해 주세요.</p>';
}
