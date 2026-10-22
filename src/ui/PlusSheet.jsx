import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PERIODS } from '../lib/period.js';
import { clipboardHint, readClipboard } from '../lib/msgParse.js';
import { PREVIEW_KINDS, composeDraft } from '../lib/compose.js';
import { recentStudents } from '../lib/recent.js';
import { joinedRecords, saveCompose } from '../lib/db.js';
import { splitPlusActions } from './actions.js';
import { useUi } from './context.jsx';
import { Area, Btn } from './bits.jsx';
import { ChoiceGrid, DateGrid, NumberGrid, PeriodRow, TimeChips } from './pickers.jsx';

const EVENT_OPTIONS = [
    { id: '학급', label: '학급' },
    { id: '학교', label: '학교' },
    { id: '휴일', label: '휴일' },
    { id: '내 일정', label: '내 일정' },
];
const STATUS_OPTIONS = ['결석', '지각', '조퇴', '결과'];

function MicButton({ getText, setText }) {
    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recRef = useRef(null);
    const [on, setOn] = useState(false);
    useEffect(() => () => {
        try { recRef.current?.abort(); } catch { /* 이미 멈춤 */ }
    }, []);
    if (!Ctor) return null;
    function toggle() {
        if (on) {
            try { recRef.current?.stop(); } catch { /* 없음 */ }
            setOn(false);
            return;
        }
        const base = getText();
        const rec = new Ctor();
        rec.lang = 'ko-KR';
        rec.interimResults = true;
        rec.continuous = true;
        rec.onresult = (event) => {
            let said = '';
            for (let i = 0; i < event.results.length; i += 1) said += event.results[i][0].transcript;
            const gap = base && said && !/\s$/.test(base) ? ' ' : '';
            setText(`${base}${gap}${said}`);
        };
        rec.onerror = () => setOn(false);
        rec.onend = () => setOn(false);
        recRef.current = rec;
        try {
            rec.start();
            setOn(true);
        } catch {
            setOn(false);
        }
    }
    return (
        <Btn className="icon-btn" aria-label={on ? '말하기 멈추기' : '말하기'} aria-pressed={on} onClick={toggle} style={on ? { background: 'var(--primary)', color: 'var(--on-primary)', flex: '0 0 44px' } : { flex: '0 0 44px' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M6 11a6 6 0 0 0 12 0M12 17v4M8 21h8" />
            </svg>
        </Btn>
    );
}

function DraftCard({ card, students, today, onPatch }) {
    function touch(partial) {
        onPatch(card.id, partial);
    }
    return (
        <article className={card.low ? 'draft-card low-card' : 'draft-card'}>
            <p className="draft-text">{card.text}</p>
            {card.warning ? <p style={{ fontWeight: 800, marginTop: 0 }}>{card.warning}</p> : null}
            <div className="kind-picks" role="group" aria-label="종류">
                {PREVIEW_KINDS.map((kind) => (
                    <Btn key={kind} className={card.kind === kind ? 'chip on' : 'chip'} onClick={() => touch({ kind })}>{kind}</Btn>
                ))}
            </div>
            {card.kind === '일정' && (
                <div className="kind-picks" role="group" aria-label="일정 종류">
                    {EVENT_OPTIONS.map((item) => (
                        <Btn key={item.id} className={card.eventKind === item.id ? 'chip on' : 'chip'} onClick={() => touch({ eventKind: item.id })}>{item.label}</Btn>
                    ))}
                </div>
            )}
            {card.kind === '출결' && (
                <div className="kind-picks" role="group" aria-label="출결 상태">
                    {STATUS_OPTIONS.map((status) => (
                        <Btn key={status} className={card.status === status ? 'chip on' : 'chip'} onClick={() => touch({ status })}>{status}</Btn>
                    ))}
                </div>
            )}
            {(card.kind === '일정' || card.kind === '할 일') && (
                <input className="field" style={{ marginTop: 8 }} aria-label="제목" value={card.title} onChange={(event) => touch({ title: event.target.value })} />
            )}
            <p className="muted" style={{ margin: '12px 0 8px', fontWeight: 800 }}>번호</p>
            <Btn className={!card.no ? 'chip on' : 'chip'} onClick={() => touch({ no: 0 })}>학생 없음</Btn>
            <div style={{ marginTop: 8 }}>
                <NumberGrid students={students} value={card.no} onPick={(no) => touch({ no })} />
            </div>
            <p className="muted" style={{ margin: '12px 0 8px', fontWeight: 800 }}>날짜</p>
            <DateGrid value={card.date} today={today} onPick={(ymd) => touch({ date: ymd })} />
            {card.end ? (
                <>
                    <p className="muted" style={{ margin: '12px 0 8px', fontWeight: 800 }}>끝나는 날</p>
                    <DateGrid value={card.end} today={today} onPick={(ymd) => touch({ end: ymd })} />
                </>
            ) : null}
            <p className="muted" style={{ margin: '12px 0 8px', fontWeight: 800 }}>교시</p>
            <PeriodRow value={card.period} onPick={(n) => touch({ period: n })} />
            <Btn className="choice-tile" style={{ marginTop: 8 }} onClick={() => touch({ period: 0 })}>교시 없음</Btn>
            <p className="muted" style={{ margin: '12px 0 8px', fontWeight: 800 }}>시각</p>
            <TimeChips value={card.time} onPick={(hm) => touch({ time: hm })} />
            <Btn className={card.include === false ? 'chip block' : 'chip on block'} style={{ marginTop: 8 }} onClick={() => onPatch(card.id, { include: card.include === false }, true)}>{card.include === false ? '빼 둠' : '넣을게요'}</Btn>
        </article>
    );
}

export function PlusSheet({ onClose, onPick }) {
    const { data, clock, showToast } = useUi();
    const { frequent, more } = useMemo(() => splitPlusActions(), []);
    const recent = useMemo(() => recentStudents(data.students, joinedRecords(data), 4), [data]);
    const [phase, setPhase] = useState('compose');
    const [text, setText] = useState('');
    const [hint, setHint] = useState('');
    const [no, setNo] = useState(0);
    const [openMore, setOpenMore] = useState(false);
    const [cards, setCards] = useState([]);
    const box = useRef(null);
    const textRef = useRef('');
    textRef.current = text;

    useEffect(() => { if (phase === 'compose') box.current?.focus(); }, [phase]);

    function patch(id, partial, keepLow = false) {
        setCards((prev) => prev.map((card) => {
            if (card.id !== id) return card;
            const next = { ...card, ...partial };
            if (!keepLow) {
                next.low = false;
                next.include = partial.include !== undefined ? partial.include : true;
                if (partial.kind || partial.no || partial.date || partial.period || partial.time || partial.status) next.warning = '';
            }
            return next;
        }));
    }

    async function paste() {
        const clip = await readClipboard();
        if (!clip.ok) {
            setHint(clipboardHint(clip.reason));
            return;
        }
        setText((prev) => (prev.trim() ? `${prev.trim()}\n${clip.text}` : clip.text));
        setHint('');
        box.current?.focus();
    }

    function preview() {
        const raw = text.trim();
        if (!raw) {
            showToast('한 줄만 적어도 남길 수 있어요.');
            return;
        }
        const periods = data.profile.periodStarts?.length ? data.profile.periodStarts : DEFAULT_PERIODS;
        const draft = composeDraft(raw, { now: new Date(), students: data.students, periods, selectedNo: no });
        if (!draft.cards.length) {
            showToast('읽을 내용이 없어요.');
            return;
        }
        setCards(draft.cards);
        setPhase('preview');
    }

    async function save() {
        const result = await saveCompose(cards, new Date());
        if (!result.ok) {
            showToast(result.message, false);
            return;
        }
        showToast(result.message, true);
        onClose();
    }

    const count = cards.filter((card) => card.include !== false).length;
    const unsure = cards.some((card) => card.low);

    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="할 일 고르기" data-screen="plus" data-phase={phase} onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                {phase === 'compose' ? (
                    <>
                        <h2 className="title-font" style={{ fontSize: 22, margin: '0 0 8px' }}>무엇을 적을까요?</h2>
                        <Area ref={box} rows={3} aria-label="내용" placeholder="쓰거나, 말해 주거나, 안내를 붙여 넣으세요" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                preview();
                            }
                        }} />
                        {hint ? <p className="muted" style={{ margin: '8px 0 0' }}>{hint}</p> : null}
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'stretch' }}>
                            <MicButton getText={() => textRef.current} setText={setText} />
                            <Btn className="chip" onClick={paste}>붙여넣기</Btn>
                            <Btn className="primary-btn" style={{ flex: '1 1 auto', minWidth: 0 }} onClick={preview}>다음</Btn>
                        </div>
                        {recent.length > 0 && (
                            <>
                                <p className="muted" style={{ margin: '12px 0 8px', fontWeight: 800 }}>최근 학생</p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {recent.map((row) => (
                                        <Btn key={row.id} className={no === row.no ? 'chip on' : 'chip'} onClick={() => setNo(row.no)}>{row.no} {row.name}</Btn>
                                    ))}
                                </div>
                            </>
                        )}
                        <p className="muted" style={{ margin: '12px 0 8px', fontWeight: 800 }}>자주 쓰는 일</p>
                        <ChoiceGrid label="자주 쓰는 일" options={frequent.map((item) => ({ id: item.id, label: item.label, emoji: item.emoji }))} onPick={(id) => onPick(frequent.find((item) => item.id === id))} />
                        <Btn className="chip block" style={{ marginTop: 8 }} aria-expanded={openMore} onClick={() => setOpenMore((value) => !value)}>⋯ 더보기</Btn>
                        {openMore && (
                            <div style={{ marginTop: 8 }}>
                                <ChoiceGrid label="더 있는 일" options={more.map((item) => ({ id: item.id, label: item.label, emoji: item.emoji }))} onPick={(id) => onPick(more.find((item) => item.id === id))} />
                            </div>
                        )}
                        <Btn className="chip block" style={{ marginTop: 12 }} onClick={onClose}>닫기</Btn>
                    </>
                ) : (
                    <>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Btn className="icon-btn" aria-label="이전" onClick={() => setPhase('compose')}>‹</Btn>
                            <h2 className="title-font" style={{ fontSize: 22, margin: '8px 0' }}>이렇게 넣을게요</h2>
                        </div>
                        {unsure && <p className="muted" style={{ marginTop: 0 }}>노란 카드는 한 번만 확인해 주세요. 칩을 누르면 바로 바뀌어요.</p>}
                        {cards.map((card) => (
                            <DraftCard key={card.id} card={card} students={data.students} today={clock.ymd} onPatch={patch} />
                        ))}
                        <div className="sheet-foot">
                            <Btn className="primary-btn block" onClick={save}>{count}개 남기기</Btn>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
