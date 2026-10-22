import { useState } from 'react';
import { addDaysYmd, dayKeyFromYmd, eventClock, formatKoDate, monthCells, monthTitle, startOfWeekMon } from '../lib/date.js';
import { holidayCaption } from '../lib/holidays.js';
import { joined, setTimetable } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Btn } from './bits.jsx';

const DAYS = [['mon', '월'], ['tue', '화'], ['wed', '수'], ['thu', '목'], ['fri', '금']];

export function Schedule() {
    const { data, clock } = useUi();
    const [mode, setMode] = useState('주');
    const [ym, setYm] = useState(clock.ymd.slice(0, 7));
    const [picked, setPicked] = useState(clock.ymd);
    const weekStart = startOfWeekMon(clock.ymd);
    const events = joined(data, 'events');
    const weekEnd = addDaysYmd(weekStart, 6);
    const week = events.filter((row) => coversDay(row, weekStart, weekEnd));
    const specialist = [];
    DAYS.forEach(([key, label]) => {
        const row = data.timetable[key] || {};
        for (let period = 1; period <= 6; period += 1) {
            if (row[`s${period}`]) specialist.push(`${label} ${period}교시 ${row[`p${period}`] || ''} 전담 시간이 비어요`.replace(/\s+/g, ' '));
        }
    });

    return (
        <div>
            <div style={{ display: 'flex', gap: 8 }}>
                {['주', '달력', '시간표'].map((item) => <Btn key={item} className={mode === item ? 'chip on' : 'chip'} onClick={() => setMode(item)}>{item}</Btn>)}
            </div>
            {mode === '주' && (
                <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    {Array.from({ length: 7 }, (_, index) => {
                        const date = addDaysYmd(weekStart, index);
                        const holiday = holidayCaption(date);
                        const mine = week.filter((row) => onDay(row, date));
                        return (
                            <section key={date} className="glass" style={{ padding: 12 }}>
                                <strong>{formatKoDate(date, { today: clock.ymd })} {holiday?.isHoliday ? `· ${holiday.primary.name}` : ''}</strong>
                                {mine.map((row) => <p key={row.id} style={{ marginBottom: 0 }}>{row.localOnly ? '🔒 ' : ''}{eventClock(row) ? `${eventClock(row)} ` : ''}{row.title} {row.memo || ''}</p>)}
                                {!mine.length && !holiday?.isHoliday && <p className="muted" style={{ marginBottom: 0 }}>일정 없음</p>}
                            </section>
                        );
                    })}
                    {specialist.slice(0, 3).map((line) => <p key={line} className="muted">{line}</p>)}
                    <AddEvent />
                </div>
            )}
            {mode === '달력' && (
                <div style={{ marginTop: 12 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <Btn className="icon-btn" aria-label="이전 달" onClick={() => setYm(shift(ym, -1))}>‹</Btn>
                        <strong className="title-font">{monthTitle(ym)}</strong>
                        <Btn className="icon-btn" aria-label="다음 달" onClick={() => setYm(shift(ym, 1))}>›</Btn>
                    </div>
                    <div className="cal-grid" style={{ marginTop: 8 }}>
                        {['월', '화', '수', '목', '금', '토', '일'].map((label) => <div key={label} style={{ textAlign: 'center', fontSize: 12, fontWeight: 800 }}>{label}</div>)}
                        {monthCells(ym).map((cell) => {
                            const holiday = holidayCaption(cell.ymd);
                            const has = events.some((row) => onDay(row, cell.ymd));
                            return (
                                <Btn key={cell.ymd} className="block" onClick={() => setPicked(cell.ymd)} style={{ background: cell.ymd === clock.ymd ? 'var(--primary)' : 'var(--solid)', color: cell.ymd === clock.ymd ? 'var(--on-primary)' : 'var(--ink)', borderRadius: 10, opacity: cell.inMonth ? 1 : 0.45, minHeight: 44 }}>
                                    <span className="num" style={{ fontWeight: 800 }}>{cell.day}</span>
                                    {holiday?.isHoliday && <span style={{ display: 'block', fontSize: 11 }}>{holiday.primary.short || '휴일'}</span>}
                                    {has && <span aria-hidden="true">·</span>}
                                </Btn>
                            );
                        })}
                    </div>
                    <div className="solid-card" style={{ padding: 12, marginTop: 12 }}>
                        <strong>{formatKoDate(picked, { today: clock.ymd })}</strong>
                        {events.filter((row) => onDay(row, picked)).map((row) => <p key={row.id}>{eventClock(row) ? `${eventClock(row)} ` : ''}{row.title}</p>)}
                        {!events.some((row) => onDay(row, picked)) && <p className="muted">이 날 일정은 없어요.</p>}
                    </div>
                </div>
            )}
            {mode === '시간표' && <Timetable data={data} todayKey={dayKeyFromYmd(clock.ymd)} />}
        </div>
    );
}

function eventEnd(row) {
    return row.end && row.end >= row.date ? row.end : row.date;
}

function onDay(row, date) {
    return row.date <= date && date <= eventEnd(row);
}

function coversDay(row, start, end) {
    return row.date <= end && eventEnd(row) >= start;
}

function shift(ym, delta) {
    const [y, m] = ym.split('-').map(Number);
    const date = new Date(y, m - 1 + delta, 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function AddEvent() {
    const { openFlow } = useUi();
    return <Btn className="primary-btn block" onClick={() => openFlow({ id: 'quick', kind: '일정' })}>일정 더하기</Btn>;
}

function Timetable({ data, todayKey }) {
    const [edit, setEdit] = useState(null);
    const [specialOn, setSpecialOn] = useState(false);
    const cells = [<span key="corner" />];
    DAYS.forEach(([key, label]) => {
        cells.push(<strong key={key} style={{ textAlign: 'center', color: key === todayKey ? 'var(--primary)' : 'inherit' }}>{label}</strong>);
    });
    for (let index = 0; index < 6; index += 1) {
        cells.push(<strong key={`h${index}`} style={{ display: 'grid', placeItems: 'center', fontSize: 12 }}>{index + 1}</strong>);
        DAYS.forEach(([key]) => {
            const row = data.timetable[key] || {};
            cells.push(
                <Btn key={`${key}-${index}`} className="solid-card block" onClick={() => {
                    setEdit({ day: key, period: index + 1, subject: row[`p${index + 1}`] || '' });
                    setSpecialOn(Boolean(row[`s${index + 1}`]));
                }}>
                    {row[`p${index + 1}`] || '비움'}{row[`s${index + 1}`] ? ' 전담' : ''}
                </Btn>,
            );
        });
    }
    return (
        <div style={{ marginTop: 12, minWidth: 0 }}>
            <p className="muted">칸을 누르면 과목을 고칠 수 있어요. 전담이면 상담 시간으로 보여 드려요.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '36px repeat(5, minmax(0, 1fr))', gap: 4 }}>
                {cells}
            </div>
            {edit && (
                <form className="solid-card" style={{ padding: 12, marginTop: 12 }} onSubmit={async (event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    await setTimetable(edit.day, edit.period, String(form.get('subject') || ''), specialOn ? '전담' : '');
                    setEdit(null);
                }}>
                    <strong>{edit.period}교시</strong>
                    <input className="field" name="subject" aria-label="과목" defaultValue={edit.subject} style={{ marginTop: 8 }} />
                    <Btn className={specialOn ? 'chip on' : 'chip'} style={{ marginTop: 8 }} onClick={() => setSpecialOn((value) => !value)}>{specialOn ? '전담 시간이에요' : '전담 아님'}</Btn>
                    <Btn className="primary-btn block" style={{ marginTop: 8 }} onClick={(event) => event.currentTarget.form?.requestSubmit()}>시간표 저장</Btn>
                </form>
            )}
        </div>
    );
}
