import { useEffect, useState } from 'react';
import { addDaysYmd, formatKoDate } from '../lib/date.js';
import { markChecked, setAttendance } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Btn, statusBg, statusColor } from './bits.jsx';
import { ChoiceGrid, PeriodRow } from './pickers.jsx';

const REASONS = ['질병', '미인정', '출석인정', '기타'];

export function Attend() {
    const { data, clock, route, go } = useUi();
    const date = route.params.date || clock.ymd;
    const [month, setMonth] = useState(false);
    const [reasonFor, setReasonFor] = useState(null);
    const [filter, setFilter] = useState('');
    const marks = data.attendance.filter((row) => row.date === date);
    const byId = new Map(marks.map((row) => [row.sid, row]));
    const size = data.students.length || data.profile.classSize || 0;
    const absent = marks.filter((row) => row.status === '결석').length;
    const late = marks.filter((row) => row.status === '지각').length;
    const other = marks.filter((row) => row.status === '조퇴' || row.status === '결과').length;
    const present = Math.max(0, size - new Set(marks.map((row) => row.sid)).size);
    const boxes = [['출석', present, 'var(--st-present)'], ['결석', absent, 'var(--st-absent)'], ['지각', late, 'var(--st-late)'], ['조퇴·결과', other, 'var(--st-out)']];

    useEffect(() => {
        setFilter('');
    }, [date]);

    function shown(student) {
        if (!filter) return true;
        const status = byId.get(student.id)?.status || '출석';
        if (filter === '조퇴·결과') return status === '조퇴' || status === '결과';
        return status === filter;
    }

    function pickBox(label) {
        setFilter((cur) => (cur === label ? '' : label));
    }

    function openRecord(student) {
        if (student?.no >= 1 && student?.no <= 50) {
            go(`#/students/${student.no}`);
            return;
        }
        setMonth(false);
        setReasonFor(student);
    }

    const visibleStudents = data.students.filter(shown);
    const shownMarks = marks.filter((row) => {
        const student = data.students.find((item) => item.id === row.sid);
        return student && shown(student);
    });

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Btn className="icon-btn" aria-label="이전 날" onClick={() => go(`#/attend/${addDaysYmd(date, -1)}`)}>‹</Btn>
                <strong className="title-font" style={{ fontSize: 18 }}>{formatKoDate(date, { today: clock.ymd })}</strong>
                <Btn className="icon-btn" aria-label="다음 날" onClick={() => go(`#/attend/${addDaysYmd(date, 1)}`)}>›</Btn>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, margin: '12px 0' }}>
                {boxes.map(([label, value, color]) => (
                    <Btn key={label} block className="solid-card" aria-pressed={filter === label} onClick={() => pickBox(label)} style={{ padding: '8px 4px', textAlign: 'center', minHeight: 64, display: 'grid', alignContent: 'center', justifyItems: 'center' }}>
                        <span className="num title-font" style={{ fontSize: 26, color, lineHeight: '30px' }}>{value}</span>
                        <span style={{ fontSize: 12, fontWeight: 800, lineHeight: '16px' }}>{label}</span>
                    </Btn>
                ))}
            </div>
            <p className="muted" style={{ marginTop: 0 }}>친구를 누르면 출석·결석·지각·조퇴·결과 중에서 바로 고릅니다.</p>
            <div style={{ display: 'flex', gap: 8 }}>
                <Btn className={month ? 'chip' : 'chip on'} onClick={() => setMonth(false)}>오늘</Btn>
                <Btn className={month ? 'chip on' : 'chip'} onClick={() => setMonth(true)}>이번 달</Btn>
            </div>
            {month ? <MonthTable students={visibleStudents} attendance={data.attendance} ym={date.slice(0, 7)} onOpen={openRecord} emptyHint={data.students.length ? '이 상태인 친구가 없어요.' : '명단이 없으면 월 출결을 만들 수 없어요.'} /> : (
                <div className="attend-layout" style={{ marginTop: 12 }}>
                    <div>
                        <div className="cell-grid wide">
                            {visibleStudents.map((student) => (
                                <Seat key={student.id} student={student} mark={byId.get(student.id)} onOpen={() => setReasonFor(student)} date={date} />
                            ))}
                        </div>
                        {filter && !visibleStudents.length && <p className="muted">이 상태인 친구가 없어요.</p>}
                    </div>
                    <aside className="solid-card" style={{ padding: 12, marginTop: 12 }}>
                        <h3 style={{ marginTop: 0 }}>사유와 서류</h3>
                        {!shownMarks.length && !filter && <p className="muted">표시한 친구가 없어요. 모두 출석으로 보면 돼요.</p>}
                        {filter && !shownMarks.length && filter !== '출석' && <p className="muted">이 상태인 친구가 없어요.</p>}
                        {shownMarks.map((row) => {
                            const student = data.students.find((item) => item.id === row.sid);
                            return (
                                <Btn key={row.id} block className="chip" style={{ marginBottom: 8, justifyContent: 'flex-start', background: statusBg(row.status), color: 'var(--ink)' }} onClick={() => setReasonFor(student)}>
                                    {student?.no} {student?.name} {row.status} {row.reason} {row.note}
                                </Btn>
                            );
                        })}
                        <Btn className="primary-btn block" onClick={() => markChecked(date, !data.profile.checkedDates.includes(date))}>
                            {data.profile.checkedDates.includes(date) ? '출결 확인을 해제할게요' : '오늘 출결 마쳤어요'}
                        </Btn>
                    </aside>
                </div>
            )}
            {reasonFor && <ReasonSheet student={reasonFor} mark={byId.get(reasonFor.id)} date={date} onClose={() => setReasonFor(null)} />}
        </div>
    );
}

const STATUSES = [
    { id: '출석', label: '출석' },
    { id: '결석', label: '결석' },
    { id: '지각', label: '지각' },
    { id: '조퇴', label: '조퇴' },
    { id: '결과', label: '결과' },
];

function Seat({ student, mark, onOpen }) {
    return (
        <Btn block className="solid-card" style={{ minHeight: 64, background: mark ? statusBg(mark.status) : 'var(--solid)', fontWeight: 800 }} onClick={onOpen}>
            <span style={{ display: 'grid', justifyItems: 'center' }}>
                <span className="num muted" style={{ fontSize: 12 }}>{student.no}</span>
                <span>{student.name}</span>
                {mark && <span style={{ color: statusColor(mark.status), fontSize: 12 }}>{mark.status}</span>}
            </span>
        </Btn>
    );
}

export function ReasonSheet({ student, mark, date, onClose }) {
    useEffect(() => {
        const onKey = (event) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    const [step, setStep] = useState('status');
    const [status, setStatus] = useState(mark?.status || '');
    const [note, setNote] = useState(mark?.note || '');
    const [paper, setPaper] = useState(Boolean(mark?.paper));
    const [period, setPeriod] = useState(Number(mark?.period) || 0);
    const extra = () => ({ note, paper, period });

    async function chooseStatus(next) {
        setStatus(next);
        if (next === '출석') {
            await setAttendance(date, student.id, '');
            onClose();
            return;
        }
        await setAttendance(date, student.id, next, extra());
        setStep(next === '조퇴' || next === '결과' ? 'period' : 'reason');
    }

    async function choosePeriod(n) {
        setPeriod(n);
        await setAttendance(date, student.id, status, { ...extra(), period: n });
        setStep('reason');
    }

    async function chooseReason(next) {
        await setAttendance(date, student.id, status, { ...extra(), reason: next });
        onClose();
    }

    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="출결" data-screen="attend-status" onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                <h2 className="title-font" style={{ fontSize: 22, margin: '8px 0' }}>{student.no}번 {student.name}{status ? ` · ${status}` : ''}</h2>
                {step === 'status' && <ChoiceGrid label="출결 상태" value={status} options={STATUSES} onPick={chooseStatus} />}
                {step === 'period' && (
                    <>
                        <p style={{ fontWeight: 800, marginTop: 0 }}>몇 교시에 나갔나요?</p>
                        <PeriodRow value={period} onPick={choosePeriod} />
                        <Btn className="choice-tile" style={{ marginTop: 8 }} onClick={() => choosePeriod(0)}>교시 없음</Btn>
                    </>
                )}
                {step === 'reason' && (
                    <>
                        <input className="field" aria-label="메모" placeholder="메모가 있으면 먼저 적고 사유를 누르세요" value={note} onChange={(event) => setNote(event.target.value)} />
                        <Btn className={paper ? 'chip on' : 'chip'} style={{ margin: '8px 0' }} onClick={() => setPaper((value) => !value)}>{paper ? '서류 받음' : '서류 아직'}</Btn>
                        <ChoiceGrid label="사유" options={REASONS.map((item) => ({ id: item, label: item }))} onPick={chooseReason} />
                    </>
                )}
            </div>
        </div>
    );
}

function MonthTable({ students, attendance, ym, onOpen, emptyHint }) {
    const rows = students.map((student) => {
        const marks = attendance.filter((row) => row.sid === student.id && row.date.startsWith(ym));
        return { student, marks };
    });
    return (
        <div style={{ display: 'grid', gap: 8, marginTop: 12, minWidth: 0 }}>
            {rows.map(({ student, marks }) => (
                <Btn key={student.id} block className="solid-card" onClick={() => onOpen(student)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, padding: '10px 12px', minHeight: 44, textAlign: 'left' }}>
                    <strong style={{ flex: '0 0 auto' }}>{student.no} {student.name}</strong>
                    <span className="muted" style={{ minWidth: 0, textAlign: 'right' }}>{marks.length ? marks.map((row) => `${Number(row.date.slice(8))}일 ${row.status}`).join(', ') : '결석·지각 없음'}</span>
                </Btn>
            ))}
            {!students.length && <p style={{ margin: 0 }}>{emptyHint}</p>}
        </div>
    );
}
