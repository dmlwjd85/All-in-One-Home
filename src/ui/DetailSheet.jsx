import { useEffect, useState } from 'react';
import { detailRows } from '../lib/detail.js';
import { Btn, TodoTitle } from './bits.jsx';

/** 길어서 잘린 할 일·일정을 눌렀을 때 전체 내용을 보여 주는 팝업. */
export function DetailSheet({ kind, row, onClose, onToggle, onEdit, onSave, onDelete }) {
    const [editing, setEditing] = useState(false);
    const [title, setTitle] = useState(row?.title || '');
    const [confirmDrop, setConfirmDrop] = useState(false);
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
                {editing && (
                    <form className="detail-edit" onSubmit={async (event) => {
                        event.preventDefault();
                        if (await onSave(title)) onClose();
                    }}>
                        <input className="field" aria-label="일정 제목 고치기" value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} autoFocus />
                        <Btn className="primary-btn block" onClick={(event) => event.currentTarget.form?.requestSubmit()}>고친 제목 저장</Btn>
                    </form>
                )}
                {confirmDrop && (
                    <div className="msg-card low-card" role="alert" style={{ marginBottom: 8 }}>
                        <p style={{ marginTop: 0, fontWeight: 800 }}>이 일정을 지울까요? 되돌릴 수 없어요.</p>
                        <div className="detail-actions">
                            <Btn className="choice-tile" onClick={async () => { if (await onDelete()) onClose(); }}>네, 지우기</Btn>
                            <Btn className="choice-tile" onClick={() => setConfirmDrop(false)}>그대로 두기</Btn>
                        </div>
                    </div>
                )}
                <div className="detail-actions">
                    {onSave && !editing ? <Btn className="choice-tile" onClick={() => { setTitle(row.title || ''); setEditing(true); }}>고치기</Btn> : null}
                    {onDelete && !confirmDrop ? <Btn className="choice-tile" onClick={() => setConfirmDrop(true)}>지우기</Btn> : null}
                    {onToggle ? <Btn className="choice-tile" onClick={() => { onToggle(); onClose(); }}>{row.done ? '다시 남기기' : '끝냄 표시'}</Btn> : null}
                    {onEdit ? <Btn className="choice-tile" data-role="detail-edit" onClick={onEdit}>고치기</Btn> : null}
                    <Btn className="choice-tile" onClick={onClose}>닫기</Btn>
                </div>
            </div>
        </div>
    );
}
