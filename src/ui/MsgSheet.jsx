import { useEffect, useRef, useState } from 'react';
import { DEFAULT_PERIODS } from '../lib/period.js';
import { clipboardHint, EVENT_KINDS, parseSchoolMessages, readClipboard } from '../lib/msgParse.js';
import { saveParsed } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Area, Btn } from './bits.jsx';
import { ChoiceGrid, DateGrid, PeriodRow, TimeChips } from './pickers.jsx';

const KIND_OPTIONS = [{ id: '할 일', label: '할 일' }, { id: '일정', label: '일정' }];

function oneDate(ymd, today = '') {
    if (!ymd) return '날짜 없음';
    const body = `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;
    if (today && ymd.slice(0, 4) !== String(today).slice(0, 4)) return `${ymd.slice(0, 4)}년 ${body}`;
    return body;
}

function periodLabel(item) {
    if (item.period && item.periodEnd) return `${item.period}~${item.periodEnd}교시`;
    if (item.period) return `${item.period}교시`;
    return '교시 없음';
}

function timeLabel(item) {
    if (item.time && item.timeEnd) return `${item.time}–${item.timeEnd}`;
    return item.time || '시각 없음';
}

function MsgCard({ item, clock, periods, onPatch }) {
    const [open, setOpen] = useState('');
    const calRef = useRef(null);
    function toggle(name) {
        setOpen((value) => (value === name ? '' : name));
    }
    useEffect(() => {
        if (open !== 'date' && open !== 'start' && open !== 'end') return undefined;
        const frame = requestAnimationFrame(() => {
            const node = calRef.current;
            const sheet = node?.closest('[data-screen="message"]');
            const foot = sheet?.querySelector('.sheet-foot');
            if (!node || !sheet || !foot) return;
            const margin = 12;
            const footTop = foot.getBoundingClientRect().top - margin;
            const bottom = node.getBoundingClientRect().bottom;
            if (bottom > footTop) sheet.scrollTop += bottom - footTop;
        });
        return () => cancelAnimationFrame(frame);
    }, [open]);
    const ranged = Boolean(item.end && item.date && item.end >= item.date);
    function pickBound(which, ymd) {
        let date = item.date;
        let end = item.end;
        if (which === 'start') {
            date = ymd;
            if (end && date > end) end = date;
        } else {
            end = ymd;
            if (date && end < date) date = end;
        }
        onPatch(item.id, { date, end });
        setOpen('');
    }
    return (
        <article className={item.low ? 'msg-card low-card' : 'msg-card'}>
            <ChoiceGrid label="할 일 또는 일정" value={item.kind} options={KIND_OPTIONS} onPick={(id) => onPatch(item.id, { kind: id, eventKind: id === '일정' ? (item.eventKind || '학급') : '' })} />
            {item.kind === '일정' && (
                <div style={{ marginTop: 8 }}>
                    <ChoiceGrid label="일정 종류" value={item.eventKind || '학급'} options={EVENT_KINDS.map((id) => ({ id, label: id }))} onPick={(id) => onPatch(item.id, { eventKind: id })} />
                </div>
            )}
            {item.warning && <p style={{ fontWeight: 800 }}>{item.warning}</p>}
            {item.duplicate && <p style={{ fontWeight: 800 }}>이미 등록한 내용이라 빼 두었어요.</p>}
            {item.sensitive && <p style={{ fontWeight: 800 }}>이 내용은 이 기기에만 남겨 둘게요.</p>}
            <input className="field" style={{ marginTop: 8 }} aria-label="제목" value={item.title} onChange={(event) => onPatch(item.id, { title: event.target.value })} />
            <div className={ranged ? 'msg-summary range' : 'msg-summary'}>
                {ranged ? (
                    <>
                        <Btn className={open === 'start' ? 'chip on' : 'chip'} aria-label="시작일 고치기" onClick={() => toggle('start')}>{oneDate(item.date, clock.ymd)}</Btn>
                        <Btn className={open === 'end' ? 'chip on' : 'chip'} aria-label="끝일 고치기" onClick={() => toggle('end')}>{oneDate(item.end, clock.ymd)}</Btn>
                    </>
                ) : (
                    <Btn className={open === 'date' ? 'chip on' : 'chip'} aria-label="날짜 고치기" onClick={() => toggle('date')}>{oneDate(item.date, clock.ymd)}</Btn>
                )}
                <Btn className={open === 'period' ? 'chip on' : 'chip'} aria-label="교시 고치기" onClick={() => toggle('period')}>{periodLabel(item)}</Btn>
                <Btn className={open === 'time' ? 'chip on' : 'chip'} aria-label="시각 고치기" onClick={() => toggle('time')}>{timeLabel(item)}</Btn>
            </div>
            {(open === 'date' || open === 'start' || open === 'end') && (
                <>
                    <div ref={calRef} style={{ marginTop: 8 }}>
                        {open === 'date' && <DateGrid value={item.date} today={clock.ymd} onPick={(ymd) => { onPatch(item.id, { date: ymd }); setOpen(''); }} />}
                        {open === 'start' && <DateGrid value={item.date} today={clock.ymd} onPick={(ymd) => pickBound('start', ymd)} />}
                        {open === 'end' && <DateGrid value={item.end || item.date} today={clock.ymd} onPick={(ymd) => pickBound('end', ymd)} />}
                    </div>
                    <div className="cal-scroll-room" aria-hidden="true" />
                </>
            )}
            {open === 'period' && (
                <div style={{ marginTop: 8 }}>
                    <PeriodRow value={item.period} onPick={(n) => {
                        onPatch(item.id, { period: n, periodEnd: 0, time: periods[n - 1] || item.time, timeEnd: '' });
                        setOpen('');
                    }} />
                    <Btn className="choice-tile" style={{ marginTop: 8 }} onClick={() => { onPatch(item.id, { period: 0, periodEnd: 0 }); setOpen(''); }}>교시 없음</Btn>
                </div>
            )}
            {open === 'time' && (
                <div style={{ marginTop: 8 }}>
                    <TimeChips value={item.time} onPick={(hm) => { onPatch(item.id, { time: hm, timeEnd: '' }); setOpen(''); }} />
                </div>
            )}
            <input className="field" style={{ marginTop: 8 }} aria-label="메모" placeholder="장소나 메모" value={item.memo || ''} onChange={(event) => onPatch(item.id, { memo: event.target.value })} />
            <Btn className={item.include === false ? 'chip block' : 'chip on block'} style={{ marginTop: 8 }} onClick={() => onPatch(item.id, { include: item.include === false }, true)}>{item.include === false ? '빼 둠' : '넣을게요'}</Btn>
        </article>
    );
}

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
                if (partial.date || partial.end) next.warning = '';
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
                            <MsgCard
                                key={item.id}
                                item={item}
                                clock={clock}
                                periods={data.profile.periodStarts?.length ? data.profile.periodStarts : DEFAULT_PERIODS}
                                onPatch={patch}
                            />
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
