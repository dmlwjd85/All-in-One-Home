import { useEffect, useState } from 'react';
import { DEFAULT_PERIODS } from '../lib/period.js';
import { clipboardHint, EVENT_KINDS, parseSchoolMessages, readClipboard } from '../lib/msgParse.js';
import { saveParsed } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Area, Btn } from './bits.jsx';
import { ChoiceGrid, DateGrid, PeriodRow, TimeChips } from './pickers.jsx';

const KIND_OPTIONS = [{ id: '할 일', label: '할 일' }, { id: '일정', label: '일정' }];

export function MsgSheet({ onClose }) {
    const { data, clock, showToast } = useUi();
    const [phase, setPhase] = useState('paste');
    const [raw, setRaw] = useState('');
    const [hint, setHint] = useState('메시지를 붙여 넣으세요.');
    const [items, setItems] = useState([]);

    useEffect(() => {
        let alive = true;
        readClipboard().then((clip) => {
            if (!alive) return;
            if (!clip.ok) {
                setHint(clipboardHint(clip.reason));
                setPhase('paste');
                return;
            }
            apply(clip.text);
        });
        return () => { alive = false; };
    }, []);

    function apply(text) {
        const periods = data.profile.periodStarts?.length ? data.profile.periodStarts : DEFAULT_PERIODS;
        const parsed = parseSchoolMessages(text, { now: new Date(), periods });
        setRaw(text);
        if (!parsed.items.length) {
            setHint('일정이나 할 일로 읽을 말이 없어요. 날짜나 부탁을 조금 적어 주세요.');
            setItems([]);
            setPhase('paste');
            return;
        }
        const ids = new Set([
            ...data.todos, ...data.local.todos, ...data.events, ...data.local.events,
        ].map((row) => row.id));
        setItems(parsed.items.map((item) => (ids.has(item.id) ? { ...item, duplicate: true, include: false } : item)));
        setPhase('preview');
    }

    function patch(id, partial, keepLow = false) {
        setItems((prev) => prev.map((item) => {
            if (item.id !== id) return item;
            const next = { ...item, ...partial };
            if (!keepLow) {
                next.low = false;
                if (partial.date) next.warning = '';
            }
            return next;
        }));
    }

    async function save() {
        const result = await saveParsed(items);
        showToast(result.message, result.ok);
        if (result.ok) onClose();
    }

    const count = items.filter((item) => item.include !== false).length;

    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="메시지 붙여넣기" data-screen="message" onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                <h2 className="title-font" style={{ fontSize: 22, margin: '0 0 8px' }}>{phase === 'preview' ? '이렇게 넣을게요' : '메시지 붙여넣기'}</h2>
                {phase === 'paste' && (
                    <>
                        <p className="muted" style={{ marginTop: 0 }}>{hint}</p>
                        <Area rows={8} aria-label="메시지" placeholder="카톡이나 문자에 온 안내를 붙여 넣으세요" value={raw} onChange={(event) => setRaw(event.target.value)} />
                        <Btn className="primary-btn block" style={{ marginTop: 12 }} onClick={() => apply(raw)}>이 메시지 읽기</Btn>
                    </>
                )}
                {phase === 'preview' && (
                    <>
                        <p className="muted" style={{ marginTop: 0 }}>노란 카드는 한 번만 확인해 주세요. 칩을 누르면 바로 바뀌어요.</p>
                        {items.map((item) => (
                            <article key={item.id} className={item.low ? 'msg-card low-card' : 'msg-card'}>
                                <ChoiceGrid label="할 일 또는 일정" value={item.kind} options={KIND_OPTIONS} onPick={(id) => patch(item.id, { kind: id, eventKind: id === '일정' ? (item.eventKind || '학급') : '' })} />
                                {item.kind === '일정' && (
                                    <div style={{ marginTop: 8 }}>
                                        <ChoiceGrid label="일정 종류" value={item.eventKind || '학급'} options={EVENT_KINDS.map((id) => ({ id, label: id }))} onPick={(id) => patch(item.id, { eventKind: id })} />
                                    </div>
                                )}
                                {item.warning && <p style={{ fontWeight: 800 }}>{item.warning}</p>}
                                {item.duplicate && <p style={{ fontWeight: 800 }}>이미 등록한 내용이라 빼 두었어요.</p>}
                                {item.sensitive && <p style={{ fontWeight: 800 }}>이 내용은 이 기기에만 남겨 둘게요.</p>}
                                <input className="field" style={{ marginTop: 8 }} aria-label="제목" value={item.title} onChange={(event) => patch(item.id, { title: event.target.value })} />
                                <div style={{ marginTop: 8 }}>
                                    <DateGrid value={item.date} today={clock.ymd} onPick={(ymd) => patch(item.id, { date: ymd })} />
                                </div>
                                <div style={{ marginTop: 8 }}>
                                    <PeriodRow value={item.period} onPick={(n) => {
                                        const starts = data.profile.periodStarts?.length ? data.profile.periodStarts : DEFAULT_PERIODS;
                                        patch(item.id, { period: n, periodEnd: 0, time: starts[n - 1] || item.time });
                                    }} />
                                    <Btn className={item.period ? 'chip' : 'chip on'} style={{ marginTop: 8 }} onClick={() => patch(item.id, { period: 0, periodEnd: 0 })}>교시 없음</Btn>
                                </div>
                                <div style={{ marginTop: 8 }}>
                                    <TimeChips value={item.time} onPick={(hm) => patch(item.id, { time: hm })} />
                                </div>
                                <input className="field" style={{ marginTop: 8 }} aria-label="메모" placeholder="장소나 메모" value={item.memo || ''} onChange={(event) => patch(item.id, { memo: event.target.value })} />
                                <Btn className={item.include === false ? 'chip block' : 'chip on block'} style={{ marginTop: 8 }} onClick={() => patch(item.id, { include: item.include === false }, true)}>{item.include === false ? '빼 둠' : '넣을게요'}</Btn>
                            </article>
                        ))}
                        <div className="sheet-foot">
                            <Btn className="primary-btn block" onClick={save}>{count}개 등록</Btn>
                            <Btn className="chip block" style={{ marginTop: 8 }} onClick={() => setPhase('paste')}>메시지 다시 붙이기</Btn>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
