import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PERIODS } from '../lib/period.js';
import { clipboardHint, readClipboard } from '../lib/msgParse.js';
import { joinedRecords, saveParsed, saveQuick, setAttendance } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Area, Btn } from './bits.jsx';
import { DateGrid, NumberGrid, PeriodRow, TimeChips } from './pickers.jsx';
import { FREQUENT_ACTION_IDS, MORE_ACTIONS, PLUS_ACTIONS } from './actions.js';
import { CAPTURE_KINDS, captureDrafts, recentStudents } from './capture.js';
import { ClayMark } from './ClayMark.jsx';
import { useSpeechDictation } from './useSpeechDictation.js';

const EVENT_KINDS = ['학급', '학교', '휴일', '내 일정'];
const ATTEND_STATUS = ['출석', '결석', '지각', '조퇴', '결과'];
const SHORT_LABEL = {
    attend: '출결',
    'quick:상담': '상담',
    'quick:할 일': '할 일',
    'quick:일정': '일정',
};

function oneDate(ymd) {
    if (!ymd) return '날짜 없음';
    return `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;
}

function kindLabel(id) {
    return CAPTURE_KINDS.find((kind) => kind.id === id)?.label || id;
}

function summaryLine(item) {
    const bits = [String(item.title || '').trim(), kindLabel(item.kind)];
    if (item.studentNo) bits.push(`${item.studentNo}번`);
    if (item.date) bits.push(oneDate(item.date));
    if (item.time) bits.push(item.endTime ? `${item.time}–${item.endTime}` : item.time);
    return bits.filter(Boolean).join(' · ');
}

function MicIcon() {
    return (
        <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="11" rx="3" />
            <path d="M6 11a6 6 0 0 0 12 0" />
            <path d="M12 17v4" />
            <path d="M8 21h8" />
        </svg>
    );
}

function StopIcon() {
    return (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" />
        </svg>
    );
}

export function PlusSheet({ onClose, onPick }) {
    const { data, clock, showToast } = useUi();
    const [phase, setPhase] = useState('write');
    const [text, setText] = useState('');
    const [selectedNo, setSelectedNo] = useState(0);
    const [more, setMore] = useState(false);
    const [items, setItems] = useState([]);
    const [savedRecord, setSavedRecord] = useState(false);
    const box = useRef(null);
    const speech = useSpeechDictation(text, setText);
    const recent = useMemo(() => recentStudents(data.students, joinedRecords(data)), [data]);
    const periods = data.profile.periodStarts?.length ? data.profile.periodStarts : DEFAULT_PERIODS;
    const keptCount = items.filter((item) => item.include !== false).length;

    useEffect(() => { box.current?.focus(); }, []);
    useEffect(() => {
        if (phase !== 'done') return undefined;
        const timer = window.setTimeout(onClose, 1200);
        return () => window.clearTimeout(timer);
    }, [phase, onClose]);

    function preview() {
        speech.stop();
        const drafts = captureDrafts(text, {
            now: new Date(),
            periods,
            students: data.students,
            selectedNo,
        });
        if (!drafts.length) {
            showToast('한 줄만 적어도 남길 수 있어요.');
            return;
        }
        setItems(drafts);
        setPhase('preview');
    }

    function patch(id, partial, keepLow = false) {
        setItems((prev) => prev.map((item) => {
            if (item.id !== id) return item;
            const next = { ...item, ...partial };
            if (!keepLow) {
                next.low = false;
                next.warning = '';
            }
            return next;
        }));
    }

    async function paste() {
        const clip = await readClipboard();
        if (!clip.ok) {
            showToast(clipboardHint(clip.reason));
            return;
        }
        setText((prev) => (prev.trim() ? `${prev.trim()}\n${clip.text.trim()}` : clip.text.trim()));
        box.current?.focus();
    }

    async function save() {
        speech.stop();
        const chosen = items.filter((item) => item.include !== false);
        if (!chosen.length) {
            showToast('등록할 항목이 없어요.');
            return;
        }
        for (const item of chosen) {
            if (!String(item.title || '').trim()) {
                showToast('내용을 적어 주세요.');
                return;
            }
            if (['학생기록', '상담', '출결'].includes(item.kind) && !item.studentNo) {
                showToast('학생 번호를 골라 주세요.');
                return;
            }
            if (item.kind === '출결' && !item.status) {
                showToast('출결 상태를 골라 주세요.');
                return;
            }
        }
        const schedule = [];
        let message = '남겼어요.';
        let record = false;
        for (const item of chosen) {
            if (item.kind === '일정' || item.kind === '할 일') {
                schedule.push({ ...item, kind: item.kind, eventKind: item.eventKind || '학급' });
                continue;
            }
            if (item.kind === '출결') {
                const student = data.students.find((row) => row.no === Number(item.studentNo));
                if (!student) {
                    showToast('학생 번호를 골라 주세요.');
                    return;
                }
                const saved = await setAttendance(item.date || clock.ymd, student.id, item.status, { period: item.period || '' });
                if (saved?.storageFailed) return;
                message = `${student.name} 출결을 남겼어요.`;
                continue;
            }
            if (item.kind === '학생기록' || item.kind === '상담') {
                const kind = item.kind === '상담' ? '상담' : (item.recordKind === '칭찬' ? '칭찬' : '관찰');
                const result = await saveQuick({
                    kind,
                    text: item.title,
                    no: item.studentNo,
                    date: item.date || clock.ymd,
                    tags: kind === '상담' ? ['교우'] : kind === '칭찬' ? ['생활'] : ['학습'],
                    neis: kind === '관찰' || kind === '칭찬',
                }, new Date());
                if (!result.ok) {
                    showToast(result.message, false);
                    return;
                }
                message = result.message;
                record = true;
                continue;
            }
            const result = await saveQuick({
                kind: '메모',
                text: item.title,
                date: item.date || undefined,
            }, new Date());
            if (!result.ok) {
                showToast(result.message, false);
                return;
            }
            message = result.message;
        }
        if (schedule.length) {
            const result = await saveParsed(schedule);
            if (!result.ok) {
                showToast(result.message, false);
                return;
            }
            message = schedule.length > 1 || !record ? result.message : message;
        }
        setSavedRecord(record);
        showToast(message, true);
        setPhase('done');
    }

    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="할 일 고르기" data-screen="plus" data-phase={phase} onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                {phase === 'done' ? (
                    <div style={{ textAlign: 'center', padding: '8px 0 12px' }}>
                        <ClayMark size={140} />
                        <h2 className="title-font" style={{ fontSize: 22, margin: '8px 0' }}>남겼어요</h2>
                        <p className="muted">{savedRecord ? '학생 기록은 누가기록에 쌓아 두었어요.' : '적어 둔 자리에 넣었어요.'}</p>
                    </div>
                ) : (
                    <h2 className="title-font" style={{ fontSize: 22, margin: '0 0 8px' }}>{phase === 'preview' ? '이렇게 넣을게요' : '무엇을 적을까요?'}</h2>
                )}
                {phase === 'write' && (
                    <>
                        <div className="msg-compose">
                            <Area
                                ref={box}
                                rows={3}
                                aria-label="기록"
                                placeholder="적거나 붙여 넣으세요. 말하면 여기 받아 적어요."
                                value={text}
                                onChange={(event) => speech.onEdit(event.target.value)}
                                onKeyDown={(event) => {
                                    if (event.key === 'Enter' && !event.shiftKey) {
                                        event.preventDefault();
                                        preview();
                                    }
                                }}
                            />
                            {speech.available && (
                                <Btn
                                    className={speech.listening ? 'icon-btn mic-btn is-on' : 'icon-btn mic-btn'}
                                    aria-label={speech.listening ? '받아쓰기 멈추기' : '말로 적기'}
                                    aria-pressed={speech.listening}
                                    onClick={speech.toggle}
                                >
                                    {speech.listening ? <StopIcon /> : <MicIcon />}
                                    {speech.listening && <span className="mic-dot" aria-hidden="true" />}
                                </Btn>
                            )}
                        </div>
                        {speech.available && speech.note && <p className="muted mic-note" role="status">{speech.note}</p>}
                        {speech.needConfirm && <Btn className="chip block" style={{ marginTop: 8 }} onClick={speech.confirm}>알고 시작할게요</Btn>}
                        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                            <Btn className="chip" onClick={paste}>붙여넣기</Btn>
                        </div>
                        <Btn className="primary-btn block" style={{ marginTop: 8 }} onClick={preview}>다음</Btn>
                        {recent.length > 0 && (
                            <>
                                <p className="muted" style={{ margin: '12px 0 6px' }}>최근 학생</p>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {recent.map((row) => (
                                        <Btn key={row.id} className={selectedNo === row.no ? 'chip on' : 'chip'} onClick={() => setSelectedNo((value) => (value === row.no ? 0 : row.no))}>{row.no} {row.name}</Btn>
                                    ))}
                                </div>
                            </>
                        )}
                        <p className="muted" style={{ margin: '12px 0 6px' }}>자주 하는 일</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {FREQUENT_ACTION_IDS.map((id) => {
                                const action = PLUS_ACTIONS.find((item) => item.id === id);
                                if (!action) return null;
                                return <Btn key={id} className="chip" onClick={() => onPick(action)}>{SHORT_LABEL[id] || action.label}</Btn>;
                            })}
                        </div>
                        <Btn className="chip block" style={{ marginTop: 8 }} aria-expanded={more} onClick={() => setMore((value) => !value)}>{more ? '⋯ 접기' : '⋯ 더보기'}</Btn>
                        {more && (
                            <div className="choice-grid" role="group" aria-label="더 보기" style={{ marginTop: 8 }}>
                                {MORE_ACTIONS.map((item) => (
                                    <Btn key={item.id} className="choice-tile" onClick={() => onPick(item)}>
                                        {item.emoji ? <span aria-hidden="true">{item.emoji}</span> : null}
                                        <span>{item.label}</span>
                                    </Btn>
                                ))}
                            </div>
                        )}
                        <Btn className="chip block" style={{ marginTop: 8 }} onClick={onClose}>닫기</Btn>
                    </>
                )}
                {phase === 'preview' && (
                    <>
                        <p className="muted" style={{ marginTop: 0 }}>노란 카드는 한 번만 확인해 주세요. 칩을 누르면 바로 바뀌어요.</p>
                        {items.map((item) => (
                            <CaptureCard key={item.id} item={item} students={data.students} today={clock.ymd} onPatch={patch} />
                        ))}
                        <div className="sheet-foot">
                            <Btn className="primary-btn block" onClick={save}>{keptCount > 1 ? `${keptCount}개 남기기` : '남기기'}</Btn>
                            <Btn className="chip block" style={{ marginTop: 8 }} onClick={() => setPhase('write')}>다시 적기</Btn>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function CaptureCard({ item, students, today, onPatch }) {
    const [open, setOpen] = useState(false);
    const needsStudent = ['학생기록', '상담', '출결'].includes(item.kind);
    return (
        <article className={item.low ? 'msg-card low-card' : 'msg-card'} aria-label="미리보기">
            {item.warning && <p style={{ fontWeight: 800, marginTop: 0 }}>{item.warning}</p>}
            <Btn className="capture-summary" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                <span>{open ? '접기' : summaryLine(item)}</span>
            </Btn>
            {open && (
                <>
                    <input className="field" style={{ marginTop: 8 }} aria-label="내용" value={item.title} onChange={(event) => onPatch(item.id, { title: event.target.value })} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }} role="group" aria-label="종류">
                        {CAPTURE_KINDS.map((kind) => (
                            <Btn key={kind.id} className={item.kind === kind.id ? 'chip on' : 'chip'} onClick={() => onPatch(item.id, { kind: kind.id, recordKind: kind.id === '상담' ? '상담' : item.recordKind })}>{kind.label}</Btn>
                        ))}
                    </div>
                    {item.kind === '일정' && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }} role="group" aria-label="일정 종류">
                            {EVENT_KINDS.map((kind) => (
                                <Btn key={kind} className={(item.eventKind || '학급') === kind ? 'chip on' : 'chip'} onClick={() => onPatch(item.id, { eventKind: kind })}>{kind}</Btn>
                            ))}
                        </div>
                    )}
                    {item.kind === '출결' && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }} role="group" aria-label="출결 상태">
                            {ATTEND_STATUS.map((status) => (
                                <Btn key={status} className={item.status === status ? 'chip on' : 'chip'} onClick={() => onPatch(item.id, { status })}>{status}</Btn>
                            ))}
                        </div>
                    )}
                    <p className="muted" style={{ margin: '10px 0 6px' }}>{needsStudent ? `번호 · ${item.studentNo ? `${item.studentNo}번` : '학생을 골라 주세요'}` : '번호'}</p>
                    <NumberGrid students={students} value={item.studentNo} onPick={(no) => onPatch(item.id, { studentNo: no })} />
                    <Btn className="chip" style={{ marginTop: 8 }} onClick={() => onPatch(item.id, { studentNo: 0 })}>학생 없음</Btn>
                    <p className="muted" style={{ margin: '10px 0 6px' }}>날짜 · {oneDate(item.date)}</p>
                    <DateGrid value={item.date} today={today} onPick={(ymd) => onPatch(item.id, { date: ymd })} />
                    {item.end && (
                        <>
                            <p className="muted" style={{ margin: '10px 0 6px' }}>끝나는 날 · {oneDate(item.end)}</p>
                            <DateGrid value={item.end} today={today} onPick={(ymd) => onPatch(item.id, { end: ymd })} />
                        </>
                    )}
                    <p className="muted" style={{ margin: '10px 0 6px' }}>교시</p>
                    <PeriodRow value={item.period} onPick={(n) => onPatch(item.id, { period: n })} />
                    <Btn className="chip" style={{ marginTop: 8 }} onClick={() => onPatch(item.id, { period: 0, periodEnd: 0 })}>교시 없음</Btn>
                    <p className="muted" style={{ margin: '10px 0 6px' }}>시각{item.endTime ? ` · ${item.time}–${item.endTime}` : ''}</p>
                    <TimeChips value={item.time} onPick={(hm) => onPatch(item.id, { time: hm, endTime: '' })} />
                    {(item.kind === '학생기록' || item.kind === '상담') && <p className="muted">남기면 누가기록에 쌓여요.</p>}
                </>
            )}
            <Btn className={item.include === false ? 'chip block' : 'chip on block'} style={{ marginTop: 8 }} onClick={() => onPatch(item.id, { include: item.include === false }, true)}>{item.include === false ? '빼 둠' : '넣을게요'}</Btn>
        </article>
    );
}
