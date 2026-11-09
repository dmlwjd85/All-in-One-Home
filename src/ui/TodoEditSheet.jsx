import { useEffect, useState } from 'react';
import { saveTextItem } from '../lib/db.js';
import { formatKoDate, addDaysYmd, isValidYmd } from '../lib/date.js';
import { TIME_CHOICES, dueChoices, isTodoTime, shiftTime } from '../lib/todoAlarm.js';
import { useUi } from './context.jsx';
import { Btn, Field } from './bits.jsx';
import { priOf } from '../lib/todoAchieve.js';
import { PriPicks } from './todoUi.jsx';

/**
 * 저장한 할 일 고치기(PR #60): 제목·마감 날짜·알림 시각.
 * 날짜·시각은 드롭다운이나 스크롤 피커 없이 칩과 한 칸씩 옮기는 버튼으로만 고릅니다.
 * 저장은 saveTextItem → update() 를 거쳐 editAt(=클라우드 updatedAt·hlc)이 자동으로 붙어 다른 기기와 '마지막 수정'으로 맞춰집니다.
 */
export function TodoEditSheet({ row, onClose }) {
    const { clock, showToast } = useUi();
    const today = clock.ymd;
    const [title, setTitle] = useState(row?.title || '');
    const [due, setDue] = useState(isValidYmd(row?.due) ? row.due : '');
    const [time, setTime] = useState(isTodoTime(row?.time) ? row.time : '');
    const [pri, setPri] = useState(priOf(row));
    const [busy, setBusy] = useState(false);
    useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    if (!row) return null;

    function pickTime(next) {
        setTime(next);
        /* 시각만 고르고 날짜가 없으면 오늘로 둡니다. 날짜가 있어야 알림이 울립니다. */
        if (next && !due) setDue(today);
    }

    async function save() {
        const clean = title.trim();
        if (!clean) { showToast('할 일 제목을 적어 주세요.'); return; }
        if (busy) return;
        setBusy(true);
        const { localOnly, pendingNos, ...rest } = row;
        const next = { ...rest, title: clean.slice(0, 100), due: due || '' };
        /* 중요도: 고르지 않은 옛 줄은 보통 그대로 두어 괜히 다시 올리지 않습니다. */
        if (pri !== priOf(row) || 'pri' in row) next.pri = pri;
        if (time) next.time = time;
        else if (isTodoTime(row.time)) next.time = '';
        else delete next.time;
        const result = await saveTextItem('todos', next, { from: localOnly ? 'local' : 'cloud' });
        setBusy(false);
        if (result?.storageFailed) { showToast(result.message || '저장하지 못했어요.'); return; }
        showToast(result?.sensitive && !localOnly ? '민감한 낱말이 있어 이 기기에만 고쳐 두었어요.' : '할 일을 고쳤어요.');
        onClose();
    }

    const choices = dueChoices(today);
    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet todo-edit-sheet" role="dialog" aria-modal="true" aria-label="할 일 고치기" data-screen="todo-edit" onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                <h2 className="title-font" style={{ margin: '0 0 12px' }}>할 일 고치기</h2>
                <label className="minutes-label" htmlFor="todo-edit-title">제목</label>
                <Field id="todo-edit-title" value={title} maxLength={100} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); save(); } }} />

                <div className="minutes-label" id="todo-edit-pri">중요도</div>
                <PriPicks value={pri} onPick={setPri} idBase="todo-edit" />

                <div className="minutes-label" id="todo-edit-due">마감 날짜 <strong className="todo-edit-picked" data-role="todo-due">{due ? formatKoDate(due) : '없음'}</strong></div>
                <div className="todo-edit-chips" role="group" aria-labelledby="todo-edit-due">
                    <Btn className={!due ? 'chip on' : 'chip'} aria-pressed={!due} onClick={() => { setDue(''); setTime(''); }}>없음</Btn>
                    {choices.map(([label, ymd]) => (
                        <Btn key={label} className={due === ymd ? 'chip on' : 'chip'} aria-pressed={due === ymd} onClick={() => setDue(ymd)}>{label}</Btn>
                    ))}
                    <Btn className="chip" aria-label="마감 하루 앞으로" onClick={() => setDue(addDaysYmd(due || today, -1))}>‹ 하루</Btn>
                    <Btn className="chip" aria-label="마감 하루 뒤로" onClick={() => setDue(addDaysYmd(due || today, 1))}>하루 ›</Btn>
                </div>

                <div className="minutes-label" id="todo-edit-time">알림 시각 <strong className="todo-edit-picked" data-role="todo-time">{time || '없음'}</strong></div>
                <div className="todo-edit-chips" role="group" aria-labelledby="todo-edit-time">
                    <Btn className={!time ? 'chip on' : 'chip'} aria-pressed={!time} onClick={() => setTime('')}>없음</Btn>
                    {TIME_CHOICES.map((hm) => (
                        <Btn key={hm} className={time === hm ? 'chip on num' : 'chip num'} aria-pressed={time === hm} onClick={() => pickTime(hm)}>{hm}</Btn>
                    ))}
                    <Btn className="chip" aria-label="알림 10분 앞으로" onClick={() => pickTime(shiftTime(time, -10))}>‹ 10분</Btn>
                    <Btn className="chip" aria-label="알림 10분 뒤로" onClick={() => pickTime(shiftTime(time, 10))}>10분 ›</Btn>
                </div>
                <p className="muted" style={{ margin: '8px 0 0' }}>시각을 넣으면 그때 앱이 열려 있을 때 소리와 팝업으로 알려 드려요.</p>

                <div className="detail-actions" style={{ marginTop: 14 }}>
                    <Btn className="choice-tile on" data-role="todo-edit-save" disabled={busy} onClick={save}>저장</Btn>
                    <Btn className="choice-tile" onClick={onClose}>닫기</Btn>
                </div>
            </div>
        </div>
    );
}
