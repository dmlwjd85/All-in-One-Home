import { useEffect, useState, useSyncExternalStore } from 'react';
import '../styles/sync.css';
import { chipState, subscribeSync, syncStatus } from '../lib/syncStatus.js';

/** 제목 아래 작은 동기화 칩. 누르는 버튼이 아니라 지금 상태만 알려 줍니다. */
export function SyncChip({ cloudReady, signedIn, online }) {
    const status = useSyncExternalStore(subscribeSync, syncStatus, syncStatus);
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 30000);
        return () => clearInterval(timer);
    }, []);
    const chip = chipState({ cloudReady, signedIn, online, status, now });
    if (!chip) return null;
    return (
        <span className={`sync-chip is-${chip.kind}`} role="status" aria-live="polite" title={chip.hint} aria-label={`${chip.label}. ${chip.hint}`} data-sync={chip.kind}>
            <span className="sync-dot" aria-hidden="true" />
            <span>{chip.label}</span>
        </span>
    );
}

/** 🔒 표시가 무슨 뜻인지 한 줄로 알려 줍니다. */
export function LockNote({ style }) {
    return <p className="muted lock-note" style={style}>🔒 표시는 이 기기에만 있는 기록이에요. 로그인해도 다른 기기에는 안 보여요.</p>;
}
