import { useEffect } from 'react';
import { detailRows } from '../lib/detail.js';
import { Btn, TodoTitle } from './bits.jsx';

/** 길어서 잘린 할 일·일정을 눌렀을 때 전체 내용을 보여 주는 팝업. */
export function DetailSheet({ kind, row, onClose, onToggle }) {
    useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    if (!row) return null;
    const rows = detailRows(kind, row);
    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet detail-sheet" role="dialog" aria-modal="true" aria-label={kind === 'todo' ? '할 일 자세히' : '일정 자세히'} data-screen="detail" onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                <p className="muted" style={{ margin: 0, fontWeight: 800 }}>{kind === 'todo' ? '할 일' : '일정'}</p>
                <h2 className="title-font detail-title"><TodoTitle lead={row.localOnly ? '🔒 ' : ''} title={row.title} /></h2>
                <dl className="detail-list">
                    {rows.map(([label, value]) => (
                        <div key={label} className="detail-item">
                            <dt>{label}</dt>
                            <dd>{value}</dd>
                        </div>
                    ))}
                </dl>
                <div className="detail-actions">
                    {onToggle ? <Btn className="choice-tile" onClick={() => { onToggle(); onClose(); }}>{row.done ? '다시 남기기' : '끝냄 표시'}</Btn> : null}
                    <Btn className="choice-tile" onClick={onClose}>닫기</Btn>
                </div>
            </div>
        </div>
    );
}
