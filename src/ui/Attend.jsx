import { useRef, useState } from 'react';
import { addDaysYmd, formatKoDate } from '../lib/date.js';
import { cycleAttendance, markChecked, patchAttendance } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Btn, statusBg, statusColor } from './bits.jsx';

const REASONS = ['질병', '미인정', '출석인정', '기타'];

export function Attend() {
    const { data, clock, route, go } = useUi();
    const date = route.params.date || clock.ymd;
    const [month, setMonth] = useState(false);
    const [reasonFor, setReasonFor] = useState(null);
    const marks = data.attendance.filter((row) => row.date === date);
    const byId = new Map(marks.map((row) => [row.sid, row]));
    const size = data.students.length || data.profile.classSize || 0;
    const absent = marks.filter((row) => row.status === '결석').length;
    const late = marks.filter((row) => row.status === '지각').length;
    const other = marks.filter((row) => row.status === '조퇴' || row.status === '결과').length;
    const present = Math.max(0, size - new Set(marks.map((row) => row.sid)).size);
    const boxes = [['출석', present, 'var(--st-present)'], ['결석', absent, 'var(--st-absent)'], ['지각', late, 'var(--st-late)'], ['조퇴·결과', other, 'var(--st-out)']];

    return (
        <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                <Btn className="icon-btn" aria-label="이전 날" onClick={() => go(`#/attend/${addDaysYmd(date, -1)}`)}>‹</Btn>
                <strong className="title-font" style={{ fontSize: 18 }}>{formatKoDate(date, { today: clock.ymd })}</strong>
                <Btn className="icon-btn" aria-label="다음 날" onClick={() => go(`#/attend/${addDaysYmd(date, 1)}`)}>›</Btn>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0,1fr))', gap: 8, margin: '12px 0' }}>
                {boxes.map(([label, value, color]) => (
                    <div key={label} className="solid-card" style={{ padding: 8, textAlign: 'center', minHeight: 64 }}>
                        <div className="num title-font" style={{ fontSize: 26, color }}>{value}</div>
                        <div style={{ fontSize: 12, fontWeight: 800 }}>{label}</div>
                    </div>
                ))}
            </div>
            <p className="muted" style={{ marginTop: 0 }}>안 온 친구만 눌러 주세요. 한 번 누르면 결석, 또 누르면 지각·조퇴·결과로 바뀌어요.</p>
            <div style={{ display: 'flex', gap: 8 }}>
                <Btn className={month ? 'chip' : 'chip on'} onClick={() => setMonth(false)}>오늘</Btn>
                <Btn className={month ? 'chip on' : 'chip'} onClick={() => setMonth(true)}>이번 달</Btn>
            </div>
            {month ? <MonthTable students={data.students} attendance={data.attendance} ym={date.slice(0, 7)} /> : (
                <div className="attend-layout" style={{ marginTop: 12 }}>
                    <div className="cell-grid wide">
                        {data.students.map((student) => (
                            <Seat key={student.id} student={student} mark={byId.get(student.id)} onOpen={() => setReasonFor(student)} date={date} />
                        ))}
                    </div>
                    <aside className="solid-card" style={{ padding: 12, marginTop: 12 }}>
                        <h3 style={{ marginTop: 0 }}>사유와 서류</h3>
                        {!marks.length && <p className="muted">표시한 친구가 없어요. 모두 출석으로 보면 돼요.</p>}
                        {marks.map((row) => {
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

function Seat({ student, mark, onOpen, date }) {
    const skip = useRef(false);
    const timer = useRef(0);
    return (
        <Btn
            block
            className="solid-card"
            style={{ minHeight: 64, background: mark ? statusBg(mark.status) : 'var(--solid)', fontWeight: 800 }}
            onPointerDown={() => { timer.current = setTimeout(() => { skip.current = true; onOpen(); }, 480); }}
            onPointerUp={() => clearTimeout(timer.current)}
            onPointerLeave={() => clearTimeout(timer.current)}
            onClick={() => {
                if (skip.current) { skip.current = false; return; }
                cycleAttendance(date, student.id);
            }}
        >
            <span style={{ display: 'grid', justifyItems: 'center' }}>
                <span className="num muted" style={{ fontSize: 12 }}>{student.no}</span>
                <span>{student.name}</span>
                {mark && <span style={{ color: statusColor(mark.status), fontSize: 11 }}>{mark.status}</span>}
            </span>
        </Btn>
    );
}

function ReasonSheet({ student, mark, date, onClose }) {
    const [reason, setReason] = useState(mark?.reason || '질병');
    const [note, setNote] = useState(mark?.note || '');
    const [paper, setPaper] = useState(Boolean(mark?.paper));
    if (!mark) {
        return (
            <div className="sheet-back" onClick={onClose}>
                <div className="sheet" role="dialog" aria-modal="true" aria-label="사유" onClick={(event) => event.stopPropagation()}>
                    <p>먼저 출결 칸을 눌러 결석이나 지각으로 바꿔 주세요.</p>
                    <Btn className="primary-btn block" onClick={onClose}>알겠어요</Btn>
                </div>
            </div>
        );
    }
    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="사유" onClick={(event) => event.stopPropagation()}>
                <h2 className="title-font" style={{ marginTop: 8 }}>{student.no}번 {student.name} · {mark.status}</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {REASONS.map((item) => <Btn key={item} className={reason === item ? 'chip on' : 'chip'} onClick={() => setReason(item)}>{item}</Btn>)}
                </div>
                <input className="field" style={{ marginTop: 12 }} aria-label="메모" placeholder="감기, 병원…" value={note} onChange={(event) => setNote(event.target.value)} />
                <Btn className={paper ? 'chip on' : 'chip'} style={{ marginTop: 8 }} onClick={() => setPaper((value) => !value)}>서류 받음</Btn>
                <Btn className="primary-btn block" style={{ marginTop: 12 }} onClick={async () => { await patchAttendance(date, student.id, { reason, note, paper }); onClose(); }}>저장</Btn>
            </div>
        </div>
    );
}

function MonthTable({ students, attendance, ym }) {
    const rows = students.map((student) => {
        const marks = attendance.filter((row) => row.sid === student.id && row.date.startsWith(ym));
        return { student, marks };
    });
    return (
        <div className="solid-card" style={{ marginTop: 12, minWidth: 0 }}>
            {rows.map(({ student, marks }) => (
                <div key={student.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: 12, borderBottom: '1px solid var(--line)', minWidth: 0 }}>
                    <strong style={{ flex: '0 0 auto' }}>{student.no} {student.name}</strong>
                    <span className="muted" style={{ minWidth: 0, textAlign: 'right' }}>{marks.length ? marks.map((row) => `${Number(row.date.slice(8))}일 ${row.status}`).join(', ') : '결석·지각 없음'}</span>
                </div>
            ))}
            {!students.length && <p style={{ padding: 16 }}>명단이 없으면 월 출결을 만들 수 없어요.</p>}
        </div>
    );
}
