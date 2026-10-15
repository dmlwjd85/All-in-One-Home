import { forwardRef, useState } from 'react';
import { captureNote } from '../ssugeokStore.js';

/** 빈 칸에 바로 적는 상자. Enter로 남기고 Shift+Enter로 줄을 바꿉니다. */
const CaptureBox = forwardRef(function CaptureBox({
    author, signedIn, fromPage, onChanged, onToast, onSaved, big = false, autoFocus = false, placeholder,
}, ref) {
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const save = async () => {
        if (busy || !text.trim()) return;
        setBusy(true);
        try {
            const note = await captureNote({ text, author, fromPage, signedIn });
            if (!note) return;
            setText('');
            onChanged?.();
            onToast?.(note.sensitive ? '건강·민원 내용은 이 기기에만 적었어요.' : '쓱, 적에 남겼어요. 나누기는 나중에.');
            onSaved?.(note);
        } finally {
            setBusy(false);
        }
    };
    return (
        <form
            className={`dy-cap ${big ? 'is-big' : ''}`}
            onSubmit={(e) => { e.preventDefault(); save(); }}
        >
            <textarea
                ref={ref}
                data-ssu-capture
                value={text}
                autoFocus={autoFocus}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                        e.preventDefault();
                        save();
                    }
                }}
                placeholder={placeholder || '떠오른 것을 그냥 적어요.\n@12 #행발 발표를 또렷하게'}
                aria-label="쓱, 적 메모"
                rows={big ? 6 : 4}
            />
            <div className="dy-cap-foot">
                <span className="dy-cap-hint">Enter 남기기 · Shift+Enter 줄바꿈</span>
                <button type="submit" className="dy-btn-primary" disabled={!text.trim() || busy}>남기기</button>
            </div>
        </form>
    );
});

export default CaptureBox;
