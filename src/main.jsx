import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';

/* 올인원 홈노트: 이중 마운트로 인한 Firebase 리스너 중복 방지 — StrictMode 비활성 */
ReactDOM.createRoot(document.getElementById('root')).render(<App />);
