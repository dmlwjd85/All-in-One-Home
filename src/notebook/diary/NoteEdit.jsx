import { useEffect, useState } from 'react';
import { deleteNote, reviseNote } from '../ssugeokStore.js';

/** 쓱, 적 한 줄을 그 자리에서 고치거나, 확인 뒤에 지웁니다. */
export default function NoteEdit({ note, signedIn, onChanged, onToast, extra = null, variant = 'plain' }) {
    const [mode, setMode] = useState('view');
    const [draft, setDraft] = useState(note.text || '');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (mode === 'view') setDraft(note.text || '');
    }, [note.text, mode]);

    const save = async () => {
        if (busy) return;
        const next = draft.trim();
        if (!next) {
            onToast?.('내용을 적어 주세요.');
            return;
        }
        if (next === (note.text || '').trim()) {
            setMode('view');
            return;
        }
        setBusy(true);
        try {
            await reviseNote(note, next, signedIn);
            onChanged?.();
            onToast?.('고쳤어요.');
            setMode('view');
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (busy) return;
        setBusy(true);
        try {
            await deleteNote(note, signedIn);
            onChanged?.();
            onToast?.('지웠어요.');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="dy-entry">
            {mode === 'edit' ? (
                <textarea
                    className="dy-entry-input"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    aria-label="메모 고치기"
                    rows={3}
                />
            ) : (
                <p className="dy-entry-text">{note.text}</p>
            )}
            {mode === 'confirm' && <p className="dy-entry-ask">이 메모를 지울까요?</p>}
            <div className={`dy-entry-acts ${variant === 'inbox' ? 'dy-inbox-acts' : ''}`}>
                {mode === 'view' && extra}
                {mode === 'view' && (
                    <div className="dy-entry-pair">
                        <button type="button" className="dy-btn-ghost" data-note-edit onClick={() => { setDraft(note.text || ''); setMode('edit'); }}>고치기</button>
                        <button type="button" className="dy-btn-ghost" data-note-delete onClick={() => setMode('confirm')}>지우기</button>
                    </div>
                )}
                {mode === 'edit' && (
                    <div className="dy-entry-pair">
                        <button type="button" className="dy-btn-primary" data-note-save disabled={busy || !draft.trim()} onClick={save}>저장</button>
                        <button type="button" className="dy-btn-ghost" data-note-cancel disabled={busy} onClick={() => setMode('view')}>취소</button>
                    </div>
                )}
                {mode === 'confirm' && (
                    <div className="dy-entry-pair">
                        <button type="button" className="dy-btn-primary" data-note-confirm disabled={busy} onClick={remove}>지우기</button>
                        <button type="button" className="dy-btn-ghost" data-note-cancel disabled={busy} onClick={() => setMode('view')}>취소</button>
                    </div>
                )}
            </div>
        </div>
    );
}
