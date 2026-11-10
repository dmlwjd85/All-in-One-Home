import { useState } from 'react';
import { eventClock } from '../lib/date.js';
import { removeItem, saveTextItem } from '../lib/db.js';
import { Btn, TodoTitle } from './bits.jsx';
import { DetailSheet } from './DetailSheet.jsx';

/** 일정 고치기·지우기. 자세히 보기 팝업 안에서만 씁니다(줄마다 있던 '고치기' 버튼은 없앴어요). */
function eventEditor(row, showToast) {
    if (row.google) return {};
    return {
        onSave: async (title) => {
            const next = String(title || '').trim();
            if (!next) {
                showToast('한 줄만 적어도 남길 수 있어요.');
                return false;
            }
            /* 제목만 바꿉니다. 날짜·시각·메모·처음 적은 글(raw)은 그대로 둡니다. */
            const result = await saveTextItem('events', { ...row, title: next }, { from: row.localOnly ? 'local' : 'cloud' });
            if (result?.storageFailed) return false;
            showToast('일정을 고쳤어요.', true);
            return true;
        },
        onDelete: async () => {
            const failed = await removeItem('events', row.id);
            if (failed?.storageFailed) return false;
            showToast('일정을 지웠어요.', true);
            return true;
        },
    };
}

export function EventLine({ row, showToast }) {
    const [detail, setDetail] = useState(false);
    const clock = eventClock(row);
    return (
        <div style={{ marginBottom: 8 }}>
            <Btn className={row.google ? 'gcal-line event-line-text' : 'event-line-text'} data-event-detail="1" aria-label={`일정 자세히: ${row.title || '일정'}`} onClick={() => setDetail(true)}>
                {row.google ? <span className="gcal-badge">구글</span> : (row.localOnly ? '🔒 ' : '')}
                {/* 충돌 사본(업데이트 전 수정, PR #66 r4)은 할 일과 같은 '충돌 사본' 배지로 보입니다. */}
                <TodoTitle lead={clock ? `${clock} ` : ''} title={row.title} />{row.memo ? ` · ${row.memo}` : ''}
                {row.google ? <span className="muted"> · 보기만</span> : null}
            </Btn>
            {detail && <DetailSheet kind="event" row={row} onClose={() => setDetail(false)} {...eventEditor(row, showToast)} />}
        </div>
    );
}

/** 주간 목록(A1) 한 줄: 시각 + 제목. 누르면 자세히 보기(고치기 포함)가 열립니다. */
export function WeekEvent({ row, showToast }) {
    const [detail, setDetail] = useState(false);
    const clock = eventClock(row);
    const start = clock || '';
    return (
        <>
            <Btn className={row.google ? 'week-event gcal-line' : 'week-event'} data-event-detail="1" aria-label={`일정 자세히: ${start ? `${start} ` : ''}${row.title || '일정'}`} onClick={() => setDetail(true)}>
                <span className="week-time num">{start || '하루'}</span>
                <span className="week-title">
                    {row.google ? <span className="gcal-badge">구글</span> : (row.localOnly ? '🔒 ' : '')}
                    <TodoTitle title={row.title} />
                </span>
            </Btn>
            {detail && <DetailSheet kind="event" row={row} onClose={() => setDetail(false)} {...eventEditor(row, showToast)} />}
        </>
    );
}
