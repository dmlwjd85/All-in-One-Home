import { useEffect, useRef, useState } from 'react';
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
import { eulReul } from '../lib/period.js';
import { isLocked, readPeriodLocal, tableRow, toggleCellLock, togglePeriodLock, withUsedCount } from '../lib/periodLocal.js';
import { usePeriodLocal } from './usePeriodLocal.js';

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
        const local = withUsedCount(data.timetable, readPeriodLocal());
        const row = tableRow(data.timetable, key, local);
        for (let period = 1; period <= local.count; period += 1) {
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
                                <Btn block className="chip" style={{ justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal', marginBottom: 8 }} onClick={() => go(`#/day/${date}`, { state: { appFrom: 'schedule' } })}>{formatKoDate(date, { today: clock.ymd })} 일지</Btn>
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
                        {['월', '화', '수', '목', '금', '토', '일'].map((label, index) => <div key={label} className={index >= 5 ? 'day-rest-mark' : undefined} style={{ textAlign: 'center', fontSize: 12, fontWeight: 500 }}>{label}</div>)}
                        {monthCells(ym).map((cell, index) => {
                            const holiday = holidayCaption(cell.ymd);
                            const rest = restInfo(cell.ymd, classEvents);
                            const has = classEvents.some((row) => onDay(row, cell.ymd));
                            const hasGoogle = shown.some((row) => row.google && onDay(row, cell.ymd));
                            const weekend = index % 7 >= 5;
                            const selected = cell.ymd === focus;
                            const todayCell = cell.ymd === clock.ymd;
                            return (
                                <Btn key={cell.ymd} className={`${selected ? 'block neo-in cal-picked' : 'block'}${rest.off || weekend ? ' day-rest' : ''}${todayCell ? ' cal-today' : ''}`} aria-current={selected ? 'date' : undefined} aria-label={`${formatKoDate(cell.ymd)} 고르기`} onClick={() => go(`#/schedule/month/${cell.ymd}`, { replace: true })} style={{ color: cell.inMonth ? 'var(--ink)' : 'var(--ink-sub)', borderRadius: 12, minHeight: 44 }}>
                                    <span className="num" style={{ fontWeight: 700, color: todayCell ? undefined : (rest.off ? 'var(--rest-ink)' : 'inherit') }}>{cell.day}</span>
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
                            <Btn className="chip" onClick={() => go(`#/day/${focus}`, { state: { appFrom: 'schedule' } })}>이 날 일지</Btn>
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
    const { showToast } = useUi();
    const local = withUsedCount(data.timetable, usePeriodLocal());
    const press = useRef({ timer: 0, held: false });
    /* 편집 칸을 연 칸. 닫으면 포커스를 이 칸으로 돌려 줍니다. */
    const opener = useRef(null);
    const formRef = useRef(null);
    const editKey = edit ? `${edit.day}-${edit.period}` : '';
    useEffect(() => {
        if (!editKey || !formRef.current) return;
        formRef.current.querySelector('input[name="subject"]')?.focus({ preventScroll: true });
        formRef.current.scrollIntoView({ block: 'nearest' });
    }, [editKey]);
    function closeEdit() {
        const back = opener.current;
        if (back?.isConnected) back.focus();
        setEdit(null);
    }
    const count = local.count;
    /* 칸 잠금. 길게 누르기와 편집 칸의 잠금 버튼이 같이 씁니다. */
    function lockCell(dayKey, period) {
        const locked = isLocked(local, dayKey, period);
        if (locked && local.locks.includes(period)) { showToast(`${period}교시 전체가 잠겨 있어요. 왼쪽 숫자 ${period}${eulReul(period)} 눌러 풀어 주세요.`); return false; }
        toggleCellLock(dayKey, period);
        showToast(locked ? '이 칸 잠금을 풀었어요.' : '이 칸을 잠갔어요. 다시 길게 누르거나 잠금 풀기를 누르면 풀려요.');
        return true;
    }
    function holdStart(dayKey, period) {
        clearTimeout(press.current.timer);
        press.current.held = false;
        press.current.timer = setTimeout(() => {
            press.current.held = true;
            lockCell(dayKey, period);
        }, 550);
    }
    function holdEnd() {
        clearTimeout(press.current.timer);
    }
    const editLocked = Boolean(edit && isLocked(local, edit.day, edit.period));
    const days = DAYS.map(([key, label], index) => {
        const ymd = addDaysYmd(weekStart, index);
        return { key, label, ymd, rest: restInfo(ymd, events) };
    });
    return (
        <div style={{ marginTop: 12, minWidth: 0 }}>
            <p className="muted">칸을 누르면 과목을 고칠 수 있어요. 공휴일·휴업일이면 그 요일은 수업 대신 휴일로 보여요. 전담이면 상담 시간으로 보여 드려요.</p>
            <p className="muted">왼쪽 교시 숫자를 누르면 그 교시가 통째로 잠기고, 칸 하나는 길게 누르거나, 칸을 열어 '이 칸 잠그기'를 누르면 잠겨요. 잠긴 교시는 홈에 🔒로 보이고 시간 안내에서 빠져요.</p>
            <div className="tt-grid" style={{ gridTemplateRows: `auto repeat(${count}, minmax(44px, auto))` }}>
                <span />
                {days.map((day) => (
                    <div key={day.key} className={day.rest.off ? 'tt-head day-rest' : 'tt-head'} style={{ color: day.key === todayKey ? 'var(--accent)' : 'inherit', gridColumn: DAYS.findIndex(([key]) => key === day.key) + 2, gridRow: 1 }}>
                        <strong>{day.label}</strong>
                        <span className="num">{Number(day.ymd.slice(8))}</span>
                    </div>
                ))}
                {days.map((day) => (day.rest.off ? (
                    <div key={`off-${day.key}`} className="tt-off day-rest" style={{ gridColumn: DAYS.findIndex(([key]) => key === day.key) + 2, gridRow: `2 / span ${count}` }}>
                        <strong>휴일</strong>
                        <span>{day.rest.label}</span>
                    </div>
                ) : null))}
                {Array.from({ length: count }, (_, index) => {
                    const locked = local.locks.includes(index + 1);
                    return (
                        <Btn key={`h${index}`} className={locked ? 'tt-period is-locked' : 'tt-period'} aria-pressed={locked} aria-label={locked ? `${index + 1}교시 잠금 풀기` : `${index + 1}교시 잠그기`} style={{ gridColumn: 1, gridRow: index + 2, fontWeight: 800 }} onClick={() => {
                            togglePeriodLock(index + 1);
                            showToast(locked ? `${index + 1}교시 잠금을 풀었어요.` : `${index + 1}교시를 잠갔어요. 시간 안내에서 빠져요.`);
                        }}>
                            {locked ? `🔒${index + 1}` : index + 1}
                        </Btn>
                    );
                })}
                {days.map((day) => (day.rest.off ? null : Array.from({ length: count }, (_, index) => {
                    const row = tableRow(data.timetable, day.key, local);
                    const locked = isLocked(local, day.key, index + 1);
                    const subject = row[`p${index + 1}`] || '';
                    return (
                        <Btn key={`${day.key}-${index}`} className={locked ? 'solid-card block tt-locked' : 'solid-card block'} aria-label={`${day.label} ${index + 1}교시 ${locked ? (subject ? `${subject}, 잠김` : '잠김') : (subject || '비움')}${!locked && row[`s${index + 1}`] ? ' 전담' : ''}`} style={{ gridColumn: DAYS.findIndex(([key]) => key === day.key) + 2, gridRow: index + 2 }}
                            onPointerDown={() => holdStart(day.key, index + 1)} onPointerUp={holdEnd} onPointerLeave={holdEnd} onPointerCancel={holdEnd}
                            onContextMenu={(event) => event.preventDefault()}
                            onClick={(event) => {
                            if (press.current.held) { press.current.held = false; return; }
                            opener.current = event.currentTarget;
                            setEdit({ day: day.key, label: day.label, period: index + 1, subject });
                            setSpecialOn(Boolean(row[`s${index + 1}`]));
                        }}>
                            {locked ? (subject ? `🔒 ${subject}` : '🔒') : <>{row[`p${index + 1}`] || '비움'}{row[`s${index + 1}`] ? ' 전담' : ''}</>}
                        </Btn>
                    );
                })))}
            </div>
            {edit && (
                <form key={editKey} ref={formRef} className="solid-card tt-edit" style={{ padding: 12, marginTop: 12 }} onKeyDown={(event) => {
                    if (event.key !== 'Escape' || event.nativeEvent.isComposing) return;
                    event.preventDefault();
                    event.stopPropagation();
                    closeEdit();
                }} onSubmit={async (event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const saved = await setTimetable(edit.day, edit.period, String(form.get('subject') || ''), specialOn ? '전담' : '');
                    if (saved?.storageFailed) return;
                    closeEdit();
                }}>
                    <strong>{edit.label} {edit.period}교시</strong>
                    {/* 과목 칸을 먼저 두어, 탭과 화면 읽기 순서가 과목 → 전담 → 잠그기 → 닫기 → 저장이 되게 합니다. */}
                    <input className="field" name="subject" aria-label="과목" defaultValue={edit.subject} style={{ marginTop: 8 }} />
                    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginTop: 8 }}>
                        <Btn className={specialOn ? 'chip on' : 'chip'} onClick={() => setSpecialOn((value) => !value)}>{specialOn ? '전담 시간이에요' : '전담 아님'}</Btn>
                        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8 }}>
                        {local.locks.includes(edit.period) ? (
                            <span className="muted">🔒 {edit.period}교시 전체가 잠겨 있어요</span>
                        ) : (
                            <Btn className={editLocked ? 'chip on' : 'chip'} aria-pressed={editLocked} aria-label={editLocked ? `${edit.label} ${edit.period}교시 칸 잠금 풀기` : `${edit.label} ${edit.period}교시 칸 잠그기`} onClick={() => lockCell(edit.day, edit.period)}>{editLocked ? '🔒 잠금 풀기' : '이 칸 잠그기'}</Btn>
                        )}
                        <Btn className="chip" aria-label={`${edit.label} ${edit.period}교시 편집 닫기`} onClick={closeEdit}>닫기</Btn>
                        </div>
                    </div>
                    <Btn className="primary-btn block" style={{ marginTop: 8 }} onClick={(event) => event.currentTarget.form?.requestSubmit()}>시간표 저장</Btn>
                </form>
            )}
        </div>
    );
}
