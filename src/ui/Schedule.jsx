import { useEffect, useState } from 'react';
import { addDaysYmd, dayKeyFromYmd, formatKoDate, isValidYmd, monthCells, monthTitle, startOfWeekMon, weekSpanLabel } from '../lib/date.js';
import { holidayCaption } from '../lib/holidays.js';
import { restInfo } from '../lib/daymark.js';
import { joined, setTimetable } from '../lib/db.js';
import { EventLine } from './EventLine.jsx';
import { mergeCalendarRows, visibleGoogleEvents } from '../lib/gcalCore.js';
import { refreshGcal } from '../lib/gcalLive.js';
import { useUi } from './context.jsx';
import { useGcal } from './useGcal.js';
import { Btn } from './bits.jsx';

const DAYS = [['mon', '월'], ['tue', '화'], ['wed', '수'], ['thu', '목'], ['fri', '금']];

export function Schedule() {
    const { data, clock, route, go, showToast } = useUi();
    const focus = isValidYmd(route.params.date) ? route.params.date : (isValidYmd(route.params.week) ? route.params.week : clock.ymd);
    const mode = route.params.view === '달력' ? '달력' : (route.params.view === '시간표' ? '시간표' : '주');
    const ym = focus.slice(0, 7);
    const gcal = useGcal();
    useEffect(() => { refreshGcal().catch(() => {}); }, []);
    const weekStart = startOfWeekMon(focus);
    function openMode(item) {
        if (item === '달력') go(`#/schedule/month/${focus}`);
        else if (item === '시간표') go(`#/schedule/table/${focus}`);
        else go(`#/schedule/week/${focus}`);
    }
    function shiftMonth(delta) {
        const nextYm = shift(ym, delta);
        const next = clock.ymd.slice(0, 7) === nextYm ? clock.ymd : `${nextYm}-01`;
        go(`#/schedule/month/${next}`);
    }
    const classEvents = joined(data, 'events');
    const shown = mergeCalendarRows(classEvents, visibleGoogleEvents(gcal, data.auth?.uid));
    const weekEnd = addDaysYmd(weekStart, 6);
    const week = shown.filter((row) => coversDay(row, weekStart, weekEnd));
    const pickedRest = restInfo(focus, classEvents);
    const specialist = [];
    DAYS.forEach(([key, label]) => {
        const row = data.timetable[key] || {};
        for (let period = 1; period <= 6; period += 1) {
            if (row[`s${period}`]) specialist.push(`${label} ${period}교시 ${row[`p${period}`] || ''} 전담 시간이 비어요`.replace(/\s+/g, ' '));
        }
    });

    return (
        <div>
            {gcal.lastError && <p className="gcal-error" role="status">{gcal.lastError}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
                {['주', '달력', '시간표'].map((item) => <Btn key={item} className={mode === item ? 'chip on' : 'chip'} onClick={() => openMode(item)}>{item}</Btn>)}
            </div>
            {mode === '주' && (
                <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    <div className="week-nav">
                        <Btn className="icon-btn" aria-label="이전 주" onClick={() => go(`#/schedule/week/${addDaysYmd(weekStart, -7)}`)}>‹</Btn>
                        <strong className="title-font">{weekSpanLabel(weekStart)}</strong>
                        <Btn className="icon-btn" aria-label="다음 주" onClick={() => go(`#/schedule/week/${addDaysYmd(weekStart, 7)}`)}>›</Btn>
                    </div>
                    <Btn className="chip" onClick={() => go(`#/schedule/week/${clock.ymd}`)}>이번 주</Btn>
                    {Array.from({ length: 7 }, (_, index) => {
                        const date = addDaysYmd(weekStart, index);
                        const rest = restInfo(date, classEvents);
                        const mine = week.filter((row) => onDay(row, date));
                        return (
                            <section key={date} className={rest.off ? 'glass day-rest' : 'glass'} style={{ padding: 12 }}>
                                <Btn block className="chip" style={{ justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal', marginBottom: 8 }} onClick={() => go(`#/day/${date}`)}>{formatKoDate(date, { today: clock.ymd })} 일지</Btn>
                                {rest.off && <span className="day-rest-mark"> · {rest.label === '휴일' ? '휴일' : `휴일 · ${rest.label}`}</span>}
                                {mine.map((row) => <EventLine key={row.id} row={row} showToast={showToast} />)}
                                {!mine.length && !rest.off && <p className="muted" style={{ marginBottom: 0 }}>일정 없음</p>}
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
                        <Btn className="icon-btn" aria-label="이전 달" onClick={() => shiftMonth(-1)}>‹</Btn>
                        <strong className="title-font">{monthTitle(ym)}</strong>
                        <Btn className="icon-btn" aria-label="다음 달" onClick={() => shiftMonth(1)}>›</Btn>
                    </div>
                    <div className="cal-grid" style={{ marginTop: 8 }}>
                        {['월', '화', '수', '목', '금', '토', '일'].map((label, index) => <div key={label} className={index >= 5 ? 'day-rest-mark' : undefined} style={{ textAlign: 'center', fontSize: 12, fontWeight: 800 }}>{label}</div>)}
                        {monthCells(ym).map((cell, index) => {
                            const holiday = holidayCaption(cell.ymd);
                            const rest = restInfo(cell.ymd, classEvents);
                            const has = classEvents.some((row) => onDay(row, cell.ymd));
                            const hasGoogle = shown.some((row) => row.google && onDay(row, cell.ymd));
                            const weekend = index % 7 >= 5;
                            const selected = cell.ymd === focus;
                            return (
                                <Btn key={cell.ymd} className={`${selected ? 'block neo-in' : 'block'}${rest.off || weekend ? ' day-rest' : ''}`} aria-label={`${formatKoDate(cell.ymd)} 고르기`} onClick={() => go(`#/schedule/month/${cell.ymd}`)} style={{ color: cell.inMonth ? 'var(--ink)' : 'var(--ink-sub)', borderRadius: 12, minHeight: 44 }}>
                                    <span className="num" style={{ fontWeight: 800, color: rest.off ? 'var(--rest-ink)' : (selected || cell.ymd === clock.ymd ? 'var(--accent)' : 'inherit') }}>{cell.day}</span>
                                    {(holiday?.isHoliday || (rest.school && rest.label)) && <span className="day-rest-mark" style={{ display: 'block', fontSize: 11 }}>{holiday?.isHoliday ? (holiday.primary.short || '휴일') : '휴업'}</span>}
                                    {(has || hasGoogle) && (
                                        <span className="cal-marks">
                                            {has && <span aria-hidden="true">·</span>}
                                            {hasGoogle && <span className="gcal-mark" aria-hidden="true">구</span>}
                                        </span>
                                    )}
                                </Btn>
                            );
                        })}
                    </div>
                    <div className={`solid-card${pickedRest.off ? ' day-rest' : ''}`} data-cal-panel={focus} style={{ padding: 12, marginTop: 12 }}>
                        <strong>{formatKoDate(focus, { today: clock.ymd })}</strong>
                        {pickedRest.off && <p className="day-rest-mark" style={{ margin: '4px 0' }}>{pickedRest.label === '휴일' ? '휴일' : `휴일 · ${pickedRest.label}`}</p>}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                            <Btn className="chip" onClick={() => go(`#/day/${focus}`)}>이 날 일지</Btn>
                            <Btn className="chip" onClick={() => go(`#/schedule/week/${focus}`)}>이 주 보기</Btn>
                        </div>
                        {shown.filter((row) => onDay(row, focus)).map((row) => <EventLine key={row.id} row={row} showToast={showToast} />)}
                        {!shown.some((row) => onDay(row, focus)) && <p className="muted">이 날 일정은 없어요.</p>}
                    </div>
                </div>
            )}
            {mode === '시간표' && <Timetable data={data} todayKey={dayKeyFromYmd(clock.ymd)} weekStart={weekStart} events={classEvents} />}
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

function Timetable({ data, todayKey, weekStart, events }) {
    const [edit, setEdit] = useState(null);
    const [specialOn, setSpecialOn] = useState(false);
    const days = DAYS.map(([key, label], index) => {
        const ymd = addDaysYmd(weekStart, index);
        return { key, label, ymd, rest: restInfo(ymd, events) };
    });
    return (
        <div style={{ marginTop: 12, minWidth: 0 }}>
            <p className="muted">칸을 누르면 과목을 고칠 수 있어요. 공휴일·휴업일이면 그 요일은 수업 대신 휴일로 보여요. 전담이면 상담 시간으로 보여 드려요.</p>
            <div className="tt-grid">
                <span />
                {days.map((day) => (
                    <div key={day.key} className={day.rest.off ? 'tt-head day-rest' : 'tt-head'} style={{ color: day.key === todayKey ? 'var(--accent)' : 'inherit', gridColumn: DAYS.findIndex(([key]) => key === day.key) + 2, gridRow: 1 }}>
                        <strong>{day.label}</strong>
                        <span className="num">{Number(day.ymd.slice(8))}</span>
                    </div>
                ))}
                {days.map((day) => (day.rest.off ? (
                    <div key={`off-${day.key}`} className="tt-off day-rest" style={{ gridColumn: DAYS.findIndex(([key]) => key === day.key) + 2, gridRow: '2 / span 6' }}>
                        <strong>휴일</strong>
                        <span>{day.rest.label}</span>
                    </div>
                ) : null))}
                {Array.from({ length: 6 }, (_, index) => (
                    <strong key={`h${index}`} className="tt-period" style={{ gridColumn: 1, gridRow: index + 2 }}>{index + 1}</strong>
                ))}
                {days.map((day) => (day.rest.off ? null : Array.from({ length: 6 }, (_, index) => {
                    const row = data.timetable[day.key] || {};
                    return (
                        <Btn key={`${day.key}-${index}`} className="solid-card block" style={{ gridColumn: DAYS.findIndex(([key]) => key === day.key) + 2, gridRow: index + 2 }} onClick={() => {
                            setEdit({ day: day.key, period: index + 1, subject: row[`p${index + 1}`] || '' });
                            setSpecialOn(Boolean(row[`s${index + 1}`]));
                        }}>
                            {row[`p${index + 1}`] || '비움'}{row[`s${index + 1}`] ? ' 전담' : ''}
                        </Btn>
                    );
                })))}
            </div>
            {edit && (
                <form className="solid-card" style={{ padding: 12, marginTop: 12 }} onSubmit={async (event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const saved = await setTimetable(edit.day, edit.period, String(form.get('subject') || ''), specialOn ? '전담' : '');
                    if (saved?.storageFailed) return;
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
