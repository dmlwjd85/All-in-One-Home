import { useState } from 'react';
import { eventClock } from '../lib/date.js';
import { removeItem, saveTextItem } from '../lib/db.js';
import { Btn } from './bits.jsx';
import { DetailSheet } from './DetailSheet.jsx';

export function EventLine({ row, showToast }) {
    const [open, setOpen] = useState(false);
    const [detail, setDetail] = useState(false);
    const [title, setTitle] = useState(row.title || '');
    const clock = eventClock(row);
    return (
        <div style={{ marginBottom: 8 }}>
            <Btn className={row.google ? 'gcal-line event-line-text' : 'event-line-text'} data-event-detail="1" aria-label={`일정 자세히: ${row.title || '일정'}`} onClick={() => setDetail(true)}>
                {row.google ? <span className="gcal-badge">구글</span> : (row.localOnly ? '🔒 ' : '')}
                {clock ? `${clock} ` : ''}{row.title}{row.memo ? ` · ${row.memo}` : ''}
                {row.google ? <span className="muted"> · 보기만</span> : null}
            </Btn>
            {detail && <DetailSheet kind="event" row={row} onClose={() => setDetail(false)} />}
            {!row.google && !open && (
                <Btn className="chip" aria-label={`${row.title || '일정'} 고치기`} onClick={() => { setTitle(row.title || ''); setOpen(true); }}>고치기</Btn>
            )}
            {!row.google && open && (
                <div style={{ display: 'grid', gap: 8 }}>
                    <input className="field" aria-label={`${row.title || '일정'} 고치기`} value={title} onChange={(event) => setTitle(event.target.value)} />
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <Btn className="chip" onClick={async () => {
                            const next = title.trim();
                            if (!next) {
                                showToast('한 줄만 적어도 남길 수 있어요.');
                                return;
                            }
                            const result = await saveTextItem('events', { ...row, title: next }, { from: row.localOnly ? 'local' : 'cloud' });
                            if (result?.storageFailed) return;
                            showToast('일정을 고쳤어요.', true);
                            setOpen(false);
                        }}>저장</Btn>
                        <Btn className="chip" onClick={() => removeItem('events', row.id).then((failed) => { if (!failed?.storageFailed) showToast('일정을 지웠어요.', true); })}>지우기</Btn>
                    </div>
                </div>
            )}
        </div>
    );
}
