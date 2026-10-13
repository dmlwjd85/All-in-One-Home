import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { captureNote } from './ssugeokStore.js';

export default function CaptureFab({ author, signedIn, fromPage, onChanged, onToast }) {
    const [open, setOpen] = useState(false);
    const [text, setText] = useState('');
    const [scrolling, setScrolling] = useState(false);
    const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 700px)').matches);
    const [layerTop, setLayerTop] = useState(96);
    const inputRef = useRef(null);
    const anchorRef = useRef(null);

    useEffect(() => {
        let timer = 0;
        const onScroll = () => {
            if (!window.matchMedia('(max-width: 700px)').matches) return;
            setScrolling(true);
            window.clearTimeout(timer);
            timer = window.setTimeout(() => setScrolling(false), 700);
        };
        document.addEventListener('scroll', onScroll, { capture: true, passive: true });
        return () => {
            document.removeEventListener('scroll', onScroll, { capture: true });
            window.clearTimeout(timer);
        };
    }, []);

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
        const mq = window.matchMedia('(max-width: 700px)');
        const onChange = () => setPhone(mq.matches);
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    useLayoutEffect(() => {
        if (!open || !phone) return undefined;
        const place = () => {
            const box = anchorRef.current?.getBoundingClientRect();
            if (box) setLayerTop(box.bottom + 6);
        };
        place();
        window.addEventListener('resize', place);
        return () => window.removeEventListener('resize', place);
    }, [open, phone]);

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

    const form = open ? (
        <form
            className={`nb-fab-pop${phone ? ' nb-fab-pop-layer' : ''}`}
            style={phone ? { top: layerTop } : undefined}
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
    ) : null;

    return (
        <div className={`nb-fab ${scrolling ? 'is-away' : ''}`}>
            {phone ? (form ? createPortal(form, document.body) : null) : form}
            <button
                ref={anchorRef}
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
