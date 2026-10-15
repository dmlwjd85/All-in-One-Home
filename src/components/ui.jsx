import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

export function IconBtn({ label, onClick, children, className = '' }) {
    return (
        <button type="button" aria-label={label} title={label} onClick={onClick} className={`btn-secondary ${className}`}>
            {children}
            <span className="sr-only">{label}</span>
        </button>
    );
}

export function EmptyState({ title, hint }) {
    return (
        <div className="card p-8 text-center">
            <p className="text-lg font-black text-ink-800">{title}</p>
            {hint && <p className="mt-2 text-stone-600">{hint}</p>}
        </div>
    );
}

export function Modal({ title, onClose, children, wide = false }) {
    const ref = useRef(null);
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    useEffect(() => {
        const root = ref.current;
        const previous = document.activeElement;
        const focusables = () => [...root.querySelectorAll('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')]
            .filter((el) => !el.disabled && el.getAttribute('aria-hidden') !== 'true');
        focusables()[0]?.focus();
        const onKey = (event) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onCloseRef.current?.();
                return;
            }
            if (event.key !== 'Tab') return;
            const list = focusables();
            if (!list.length) return;
            const first = list[0];
            const last = list[list.length - 1];
            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        };
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('keydown', onKey);
            if (previous instanceof HTMLElement) previous.focus();
        };
    }, []);

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-stone-900/55" role="presentation" onClick={() => onCloseRef.current?.()}>
            <div
                ref={ref}
                className={`bg-ink-50 sm:rounded-3xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[92dvh] overflow-y-auto p-5 sm:p-6 shadow-2xl border border-stone-200`}
                role="dialog"
                aria-modal="true"
                aria-labelledby="modal-title"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="flex items-start justify-between gap-3 mb-4">
                    <h2 id="modal-title" className="text-xl font-black text-ink-900">{title}</h2>
                    <button type="button" className="btn-secondary px-3" onClick={onClose} aria-label="닫기">닫기</button>
                </div>
                {children}
            </div>
        </div>
    );
}

export function Field({ label, children, hint }) {
    return (
        <label className="block mb-3">
            <span className="block text-sm font-extrabold text-ink-800 mb-1">{label}</span>
            {children}
            {hint && <span className="block mt-1 text-xs text-stone-600">{hint}</span>}
        </label>
    );
}

function placeToast(el) {
    if (!el) return;
    const narrow = window.innerWidth <= 600;
    el.classList.toggle('is-bar', narrow);
    if (narrow) {
        const fab = document.querySelector('.dy-fab');
        const fabBox = fab?.getBoundingClientRect();
        const fabLeft = fabBox && fabBox.width >= 8 ? fabBox.left : window.innerWidth - 84;
        const fabTop = fabBox && fabBox.height >= 8 ? fabBox.top : window.innerHeight - 80;
        const fabBottom = fabBox && fabBox.height >= 8 ? fabBox.bottom : window.innerHeight - 16;
        const rightEdge = fabLeft - 12;
        el.style.left = '16px';
        el.style.right = `${Math.max(16, Math.round(window.innerWidth - rightEdge))}px`;
        el.style.width = 'auto';
        el.style.height = 'auto';
        el.style.maxWidth = 'none';
        el.style.bottom = 'auto';
        el.style.top = `${Math.round(fabTop)}px`;
        const toastHeight = el.getBoundingClientRect().height || 38;
        const blockers = [];
        for (const node of document.querySelectorAll('button, a, input, textarea, select')) {
            if (node.closest('.dy-toast') || node.classList.contains('dy-fab')) continue;
            const shown = getComputedStyle(node);
            if (shown.display === 'none' || shown.visibility === 'hidden' || Number(shown.opacity) === 0) continue;
            const rect = node.getBoundingClientRect();
            if (rect.width < 8 || rect.height < 8) continue;
            if (rect.right <= 17 || rect.left >= rightEdge - 1) continue;
            blockers.push(rect);
        }
        const clearAt = (top) => !blockers.some((rect) => !(top + toastHeight <= rect.top + 1 || top >= rect.bottom - 1));
        const onBand = (top) => top + toastHeight > fabTop + 1 && top < fabBottom - 1;
        const lowest = window.innerHeight - toastHeight - 4;
        let chosen = null;
        for (let top = lowest; top >= 8; top -= 1) {
            if (!onBand(top) || !clearAt(top)) continue;
            chosen = top;
            break;
        }
        if (chosen == null) {
            for (let top = lowest; top >= 8; top -= 2) {
                if (!clearAt(top)) continue;
                chosen = top;
                break;
            }
        }
        el.style.top = `${Math.round(chosen == null ? Math.max(8, fabBottom - toastHeight) : chosen)}px`;
        return;
    }
    el.style.bottom = 'auto';
    el.style.width = 'max-content';
    const gap = document.querySelector('.dy-status-gap');
    const bar = document.querySelector('.dy-bar');
    const height = 32;
    if (!gap || !bar) {
        el.style.top = '8px';
        el.style.height = `${height}px`;
        el.style.right = '12px';
        el.style.left = 'auto';
        el.style.maxWidth = 'min(240px, calc(100vw - 24px))';
        return;
    }
    const box = gap.getBoundingClientRect();
    const barBox = bar.getBoundingClientRect();
    el.style.top = `${Math.round(barBox.top + (barBox.height - height) / 2)}px`;
    el.style.height = `${height}px`;
    el.style.right = `${Math.round(window.innerWidth - box.right)}px`;
    el.style.left = 'auto';
    el.style.maxWidth = `${Math.max(0, Math.floor(box.width))}px`;
}

export function Toast({ message, actionLabel, onAction }) {
    const ref = useRef(null);
    useLayoutEffect(() => {
        if (!message) return undefined;
        const el = ref.current;
        let frame = 0;
        const place = () => {
            placeToast(el);
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(() => placeToast(el));
        };
        place();
        const watched = [document.querySelector('.dy-status-gap'), document.querySelector('.dy-bar'), document.querySelector('.dy-fab')].filter(Boolean);
        const observer = new ResizeObserver(place);
        watched.forEach((node) => observer.observe(node));
        window.addEventListener('resize', place);
        window.addEventListener('scroll', place, true);
        return () => {
            cancelAnimationFrame(frame);
            observer.disconnect();
            window.removeEventListener('resize', place);
            window.removeEventListener('scroll', place, true);
        };
    }, [message]);
    if (!message) return null;
    return createPortal(
        <div ref={ref} role="status" aria-live="polite" className="dy-toast">
            <span>{message}</span>
            {actionLabel && onAction ? (
                <button type="button" className="min-h-tap min-w-tap rounded-xl bg-white text-ink-900 px-3 py-2" onClick={onAction}>
                    {actionLabel}
                </button>
            ) : null}
        </div>,
        document.body,
    );
}

export function ConfirmDialog({ title, body, confirmLabel = '지우기', onConfirm, onClose }) {
    useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose?.(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return createPortal(
        <div className="dy-scrim" onPointerDown={(event) => { if (event.target === event.currentTarget) onClose?.(); }}>
            <div className="dy-quick is-confirm" role="dialog" aria-modal="true" aria-labelledby="dy-confirm-title">
                <h2 id="dy-confirm-title" className="dy-h">{title}</h2>
                {body ? <p className="dy-muted">{body}</p> : null}
                <div className="dy-row">
                    <button type="button" className="dy-btn-ghost" onClick={onClose}>취소</button>
                    <button type="button" className="dy-btn-primary" onClick={onConfirm}>{confirmLabel}</button>
                </div>
            </div>
        </div>,
        document.body,
    );
}

export function SearchBox({ value, onChange, placeholder }) {
    return (
        <input
            type="search"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            className="field"
            aria-label={placeholder}
        />
    );
}
