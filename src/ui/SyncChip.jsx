import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import '../styles/sync.css';
import { chipState, subscribeSync, syncStatus } from '../lib/syncStatus.js';
import { flushCloud, refreshFromCloud } from '../lib/db.js';
import { Btn } from './bits.jsx';

/**
 * 제목 아래 작은 동기화 칩.
 * - 연결 설정이 있으면 로그인 확인 전에도 같은 크기의 빈 자리를 먼저 잡아 둡니다(늦게 나타나도 화면이 밀리지 않게).
 * - 누르면 무슨 뜻인지 설명이 펼쳐집니다(폰에서는 마우스를 올릴 수 없으니까).
 * - 실패했을 때는 설명 안에 '다시 맞추기' 버튼이 있습니다.
 */
export function SyncChip({ cloudReady, signedIn, online, guest = false }) {
    const status = useSyncExternalStore(subscribeSync, syncStatus, syncStatus);
    const [now, setNow] = useState(() => Date.now());
    const box = useRef(null);
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);
    useEffect(() => {
        const close = (event) => {
            const el = box.current;
            if (el?.open && !el.contains(event.target)) el.open = false;
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, []);
    const chip = chipState({ cloudReady, signedIn, online, guest, status, now });
    if (!chip) return null;
    if (chip.kind === 'wait') {
        return <div className="sync-slot" aria-hidden="true"><span className="sync-chip is-wait" /></div>;
    }
    const retry = () => {
        if (box.current) box.current.open = false;
        refreshFromCloud('retry')
            .then((result) => (result?.ok ? null : flushCloud()))
            .catch(() => {});
    };
    return (
        <div className="sync-slot">
            <details ref={box} className={`sync-chip is-${chip.kind}`} data-sync={chip.kind}>
                <summary aria-label={`${chip.label}. 눌러서 설명 보기`}>
                    <span className="sync-dot" aria-hidden="true" />
                    <span>{chip.label}</span>
                </summary>
                <div className="sync-pop">
                    <p>{chip.hint}</p>
                    {chip.retry ? <Btn className="sync-retry" onClick={retry}>다시 맞추기</Btn> : null}
                </div>
            </details>
            <span className="sync-live" role="status" aria-live="polite">{chip.label}</span>
        </div>
    );
}

/** 🔒 표시가 무슨 뜻인지 한 줄로 알려 줍니다. */
export function LockNote({ style }) {
    return <p className="muted lock-note" style={style}>🔒 표시는 이 기기에만 있는 기록이에요. 로그인해도 다른 기기에는 안 보여요.</p>;
}
