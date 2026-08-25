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
    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-stone-900/55" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <div className={`bg-ink-50 sm:rounded-3xl w-full ${wide ? 'max-w-2xl' : 'max-w-md'} max-h-[92dvh] overflow-y-auto p-5 sm:p-6 shadow-2xl border border-stone-200`}>
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

export function Toast({ message }) {
    if (!message) return null;
    return (
        <div role="status" aria-live="polite" className="fixed bottom-24 md:bottom-6 left-1/2 -translate-x-1/2 z-[60] bg-ink-900 text-white px-4 py-3 rounded-2xl shadow-lg text-sm font-bold max-w-[90vw]">
            {message}
        </div>
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
