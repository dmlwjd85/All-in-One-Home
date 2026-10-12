import { useEffect, useRef, useState } from 'react';
import { captureNote } from './ssugeokStore.js';

export default function CaptureFab({ author, signedIn, fromPage, onChanged, onToast }) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState('');
    const inputRef = useRef(null);

    useEffect(() => {
        const onKey = (e) => {
            if (!e.altKey || (e.key !== 's' && e.key !== 'S' && e.code !== 'KeyS')) return;
            e.preventDefault();
            const inline = document.querySelector('[data-ssu-capture]');
            if (inline) {
                inline.focus();
                return;
            }
            setOpen(true);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);

    useEffect(() => {
        if (open) inputRef.current?.focus();
    }, [open]);

    const save = async () => {
        const note = await captureNote({ text, author, fromPage, signedIn });
        if (!note) return;
        setText('');
        setOpen(false);
        onChanged?.();
        onToast?.(note.sensitive ? '건강·민원 내용은 이 기기에만 적었어요.' : '쓱적에 남겼어요.');
    };

    return (
        <div className="nb-fab">
            {open && (
                <form
                    className="nb-fab-pop"
                    onSubmit={(e) => {
                        e.preventDefault();
                        save();
                    }}
                >
                    <label htmlFor="nb-fab-input">쓱 적기</label>
                    <input
                        id="nb-fab-input"
                        ref={inputRef}
                        value={text}
                        onChange={(e) => setText(e.target.value)}
                        placeholder="@12 #행발 오늘 발표를 또렷하게"
                        aria-label="쓱적 한 줄"
                    />
                    <div className="nb-fab-actions">
                        <button type="button" onClick={() => setOpen(false)}>닫기</button>
                        <button type="submit">적기</button>
                    </div>
                </form>
            )}
            <button
                type="button"
                className="nb-fab-btn"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-label="쓱적 적기"
            >
                쓱적
            </button>
        </div>
    );
}
