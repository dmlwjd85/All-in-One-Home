import { linkText } from './labels.js';

/** PDF 줄칸처럼 보이게 한 입력. 마우스·키보드로 바로 씁니다. */

export function Ink({ value, onChange, className = '', placeholder = '', multiline = false, rows = 2, type = 'text', aria }) {
    const common = {
        className: `nb-ink ${multiline ? 'nb-ink-area' : ''} ${className}`,
        value: value ?? '',
        onChange: (e) => onChange(e.target.value),
        placeholder,
        'aria-label': aria || placeholder || '입력',
    };
    if (multiline) {
        return <textarea {...common} rows={rows} />;
    }
    return <input type={type} {...common} />;
}

export function Tick({ checked, onChange, label }) {
    return (
        <label className="nb-tick">
            <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
            {label ? <span>{label}</span> : null}
        </label>
    );
}

export function Pick({ value, onChange, options, aria }) {
    return (
        <select className="nb-ink nb-ink-select" value={value ?? ''} onChange={(e) => onChange(e.target.value)} aria-label={aria}>
            <option value="">선택</option>
            {options.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
            ))}
        </select>
    );
}

export function TitleBar({ kicker, title, hint }) {
    return (
        <header className="nb-titlebar">
            {kicker && <p className="nb-kicker">{kicker}</p>}
            <h2 className="nb-pagetitle">{title}</h2>
            {hint && <p className="nb-hint">{hint}</p>}
        </header>
    );
}

export function CellGrid({ children, cols = 4, className = '' }) {
    return (
        <div className={`nb-cellgrid ${className}`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {children}
        </div>
    );
}

export function GoBtn({ to, onGo, className = '', children, aria }) {
    return (
        <button
            type="button"
            className={`nb-gobtn ${className}`}
            onClick={(e) => { e.stopPropagation(); onGo?.(to); }}
            aria-label={aria || `${children} ${to}쪽`}
        >
            {children}
        </button>
    );
}

export function LinkGrid({ links, pages, pageNo, onGo, className = '' }) {
    return (
        <div className={`nb-linkgrid ${className}`}>
            {(links || []).map((link, i) => (
                <GoBtn key={`${link.to}-${link.rect?.[0] ?? 0}-${i}`} to={link.to} onGo={onGo} className="chip">
                    {linkText(link, pages, pageNo)}
                </GoBtn>
            ))}
        </div>
    );
}

export function LinedBlock({ n = 8, get, set, prefix, placeholder = '' }) {
    return (
        <div className="nb-lined">
            {Array.from({ length: n }, (_, i) => (
                <Ink
                    key={i}
                    value={get(`${prefix}${i}`)}
                    onChange={(v) => set(`${prefix}${i}`, v)}
                    placeholder={placeholder}
                    aria={`${placeholder || '줄'} ${i + 1}`}
                />
            ))}
        </div>
    );
}
