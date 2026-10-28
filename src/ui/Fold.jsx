import { useState } from 'react';
import { Btn } from './bits.jsx';

/* 오늘 화면 접히는 카드(휴대폰 화면만). 기본은 핵심 한 줄만 보이고, 머리를 누르면 펼칩니다.
   카드마다 펼침 상태를 이 기기에 기억합니다(데이터는 바꾸지 않습니다). 넓은 화면은 늘 펼친 그대로입니다. */
export const HOME_FOLD_KEY = 'ssug-gyomu-home-fold';

export function readFold() {
    try {
        const saved = JSON.parse(localStorage.getItem(HOME_FOLD_KEY) || '{}');
        return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch {
        return {};
    }
}

export function writeFold(id, open) {
    try {
        localStorage.setItem(HOME_FOLD_KEY, JSON.stringify({ ...readFold(), [id]: Boolean(open) }));
    } catch { /* 저장 못 해도 화면은 그대로 씁니다. */ }
}

export function FoldCard({ id, className, title, summary, action, children }) {
    const [open, setOpen] = useState(() => readFold()[id] === true);
    const bodyId = `fold-body-${id}`;
    const toggle = () => {
        const next = !open;
        setOpen(next);
        writeFold(id, next);
    };
    return (
        <section className={`glass fold ${className}`} data-fold={id} data-open={open ? '1' : '0'} style={{ padding: 14 }}>
            <div className="fold-top">
                <Btn className="fold-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
                <span className="fold-text">
                    <strong className="fold-title">{title}</strong>
                    {!open && <span className="fold-sum muted">{summary}</span>}
                </span>
                <span className="fold-arrow" aria-hidden="true">{open ? '▴' : '▾'}</span>
            </Btn>
            {open && action}
            </div>
            <div className="fold-body" id={bodyId}>{children}</div>
        </section>
    );
}
