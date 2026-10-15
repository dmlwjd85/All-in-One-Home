import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import CaptureBox from './CaptureBox.jsx';

/** ⌘K · Ctrl+K · 연필 버튼으로 어디서나 여는 쓱, 적. */
export default function QuickCapture({ onClose, ...rest }) {
    const ref = useRef(null);
    useEffect(() => {
        ref.current?.focus();
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return createPortal(
        <div className="dy-scrim" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div className="dy-quick" role="dialog" aria-modal="true" aria-label="쓱, 적 빠르게 적기">
                <div className="dy-quick-head">
                    <h2 className="dy-h">쓱, 적</h2>
                    <kbd className="dy-kbd">⌘K</kbd>
                    <button type="button" className="dy-icon" onClick={onClose} aria-label="닫기"><X size={18} /></button>
                </div>
                <CaptureBox ref={ref} big {...rest} onSaved={() => onClose()} />
            </div>
        </div>,
        document.body,
    );
}
