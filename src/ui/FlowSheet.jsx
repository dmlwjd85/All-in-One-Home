import { useEffect, useState } from 'react';
import { isSensitiveText, SENSITIVE_HINT } from '../lib/sensitive.js';
import { saveQuick, saveTextItem } from '../lib/db.js';
import { MEET_KINDS } from '../lib/msgParse.js';
import { useUi } from './context.jsx';
import { Area, Btn, SpreadHint, TAGS } from './bits.jsx';
import { ChoiceGrid, DateGrid, NumberGrid, PeriodRow, TimeChips } from './pickers.jsx';

const EVENT_OPTIONS = [
    { id: '학급', label: '학급' },
    { id: '학교', label: '학교' },
    { id: '휴일', label: '휴일' },
    { id: '내 일정', label: '내 일정' },
];

function stepsFor(flow) {
    if (flow.id === 'minutes') return ['meet', 'date', 'time', 'text'];
    const kind = flow.kind || '메모';
    if (['관찰', '상담', '칭찬', '보호자'].includes(kind)) return flow.no ? ['text'] : ['student', 'text'];
    if (kind === '할 일') return flow.date ? ['text'] : ['date', 'text'];
    if (kind === '일정') return flow.date ? ['eventKind', 'period', 'time', 'text'] : ['eventKind', 'date', 'period', 'time', 'text'];
    if (kind === '알림장') return flow.date ? ['text'] : ['date', 'text'];
    return ['text'];
}

export function FlowSheet({ flow, onClose }) {
    const { data, clock, showToast } = useUi();
    const steps = stepsFor(flow);
    const [step, setStep] = useState(0);
    const [no, setNo] = useState(flow.no || 0);
    const [date, setDate] = useState(flow.date || '');
    const [time, setTime] = useState('');
    const [period, setPeriod] = useState(0);
    const [eventKind, setEventKind] = useState('학급');
    const [meetKind, setMeetKind] = useState('');
    const [text, setText] = useState('');
    const [tags, setTags] = useState(() => (TAGS[flow.kind]?.[0] ? [TAGS[flow.kind][0]] : []));
    const [neis, setNeis] = useState(flow.kind === '관찰' || flow.kind === '칭찬' || !flow.kind);
    const name = steps[step] || 'text';
    const kind = flow.kind || '메모';
    const student = data.students.find((row) => row.no === Number(no));
    const needsStudent = ['관찰', '상담', '칭찬', '보호자'].includes(kind);

    useEffect(() => {
        if (name === 'text') document.querySelector('[data-flow-text]')?.focus();
    }, [name]);

    function next() {
        setStep((value) => Math.min(steps.length - 1, value + 1));
    }

    async function save() {
        const body = text.trim();
        if (!body) {
            showToast('한 줄만 적어도 남길 수 있어요.');
            return;
        }
        if (flow.id === 'minutes') {
            const line = [meetKind, time, body].filter(Boolean).join(' ');
            const result = await saveTextItem('notes', {
                id: `meet-${Date.now()}`,
                text: line,
                date: date || clock.ymd,
                tags: ['회의', meetKind].filter(Boolean),
                pinned: false,
                source: 'app',
            });
            if (result?.storageFailed) return;
            showToast(result.sensitive ? '이 내용은 이 기기에만 남겨 둘게요. 회의록을 남겼어요.' : '회의록을 남겼어요.', true);
            onClose();
            return;
        }
        const result = await saveQuick({
            kind,
            text: body,
            no,
            tags,
            neis: needsStudent ? neis : undefined,
            date: date || undefined,
            due: kind === '할 일' ? date : undefined,
            eventKind,
            time,
            period,
        }, new Date());
        if (!result.ok) {
            showToast(result.message, false);
            return;
        }
        showToast(result.message, true);
        onClose();
    }

    const titles = {
        meet: '회의 종류',
        student: '누구 이야기예요?',
        eventKind: '일정 종류',
        date: kind === '할 일' ? '기한' : '날짜',
        period: '교시',
        time: '시각',
        text: flow.id === 'minutes' ? '회의록' : kind,
    };
    const sensitive = isSensitiveText(text, tags);

    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label={titles[name]} data-screen="flow" onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {step > 0 ? <Btn className="icon-btn" aria-label="이전" onClick={() => setStep((value) => value - 1)}>‹</Btn> : null}
                    <h2 className="title-font" style={{ fontSize: 22, margin: '8px 0' }}>{titles[name]}</h2>
                </div>
                {name === 'meet' && (
                    <ChoiceGrid label="회의 종류" options={MEET_KINDS.map((item) => ({ id: item, label: item }))} onPick={(id) => { setMeetKind(id); next(); }} />
                )}
                {name === 'student' && <NumberGrid students={data.students} onPick={(picked) => { setNo(picked); next(); }} />}
                {name === 'eventKind' && (
                    <ChoiceGrid label="일정 종류" options={EVENT_OPTIONS} onPick={(id) => { setEventKind(id); next(); }} />
                )}
                {name === 'date' && (
                    <>
                        {kind === '할 일' && <Btn className="choice-tile" style={{ marginBottom: 8 }} onClick={() => { setDate(''); next(); }}>기한 없음</Btn>}
                        <DateGrid value={date} today={clock.ymd} onPick={(ymd) => { setDate(ymd); next(); }} />
                    </>
                )}
                {name === 'period' && (
                    <>
                        <PeriodRow value={period} onPick={(n) => { setPeriod(n); next(); }} />
                        <Btn className="choice-tile" style={{ marginTop: 8 }} onClick={() => { setPeriod(0); next(); }}>교시 없음</Btn>
                    </>
                )}
                {name === 'time' && <TimeChips value={time} onPick={(hm) => { setTime(hm); next(); }} />}
                {name === 'text' && (
                    <>
                        {student && <p style={{ fontWeight: 800, marginTop: 0 }}>{student.no}번 {student.name}</p>}
                        <SpreadHint />
                        <Area data-flow-text rows={4} aria-label="내용" placeholder="여기에 발라 두세요" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
                            if (event.key === 'Enter' && !event.shiftKey) {
                                event.preventDefault();
                                save();
                            }
                        }} />
                        {(TAGS[kind] || []).length > 0 && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                                {TAGS[kind].map((tag) => (
                                    <Btn key={tag} className={tags.includes(tag) ? 'chip on' : 'chip'} onClick={() => setTags((prev) => prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag])}>#{tag}</Btn>
                                ))}
                            </div>
                        )}
                        {needsStudent && <Btn className={neis ? 'chip on' : 'chip'} style={{ marginTop: 8 }} onClick={() => setNeis((value) => !value)}>나이스에 옮길 것</Btn>}
                        {sensitive && <p style={{ fontWeight: 800 }}>🔒 {SENSITIVE_HINT}</p>}
                        <Btn className="primary-btn block" style={{ marginTop: 12 }} onClick={save}>{flow.id === 'minutes' ? '회의록 남기기' : `${kind} 남기기`}</Btn>
                    </>
                )}
            </div>
        </div>
    );
}
