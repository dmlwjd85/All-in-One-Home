import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

const rootEl = document.getElementById('root');

try {
    ReactDOM.createRoot(rootEl).render(<App />);
} catch (err) {
    console.error(err);
    rootEl.innerHTML = '<p style="padding:2rem;font-family:sans-serif;">화면을 열지 못했습니다. 페이지를 새로고침해 주세요.</p>';
}
