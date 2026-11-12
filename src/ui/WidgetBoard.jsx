import { useEffect, useState } from 'react';
import { addDaysYmd, eventClock, monthCells, startOfWeekMon, weekdayKo } from '../lib/date.js';
import { restInfo } from '../lib/daymark.js';
import { holidayCaption } from '../lib/holidays.js';
import { joined } from '../lib/db.js';
import { visibleGoogleEvents } from '../lib/gcalCore.js';
import { tableForDateWithLocal } from '../lib/semester.js';
import { withUsedCount } from '../lib/periodLocal.js';
import {
    SIZE_LABEL, WIDGETS, dropWidget, eventOn, eventsByDay, moveWidget, nextSize, noticesNear, readWidgetLayout, setWidgetSize,
    titlesByMonth, toggleWidget, upcomingEvents, writeWidgetLayout, yearProgress,
} from '../lib/widgets.js';
import { findPlace, loadWeather, readPlace, weatherText, writePlace } from '../lib/weather.js';
import { toggleTodoFx } from './doneFx.js';
import { useUi } from './context.jsx';
import { useGcal } from './useGcal.js';
import { usePeriodLocal } from './usePeriodLocal.js';
import { Btn, Field, TodoTitle } from './bits.jsx';
import './widgets.css';

const META = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));
const LABEL = Object.fromEntries(WIDGETS.map((w) => [w.id, w.label]));
const WEEK_HEAD = ['월', '화', '수', '목', '금', '토', '일'];

function md(ymd) {
    return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

function dday(ymd, today) {
    const utc = (v) => { const [y, m, d] = v.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    const diff = Math.round((utc(ymd) - utc(today)) / 86400000);
    if (diff <= 0) return '오늘';
    if (diff === 1) return '내일';
    return `D-${diff}`;
}

/** 공휴일 이름(쉬는 날만). 달력 칸에 빨간 글자로 씁니다. */
function holidayName(ymd) {
    const cap = holidayCaption(ymd);
    return cap?.isHoliday ? cap.primary?.name || '' : '';
}

/** 일정 한 줄: 시각이 있으면 앞에, 구글 일정은 'G' 표시 */
function EventChip({ row, withTime = true }) {
    const time = withTime ? eventClock(row).split('–')[0] : '';
    return (
        <span className={row.google ? 'wb-ev-chip is-google' : 'wb-ev-chip'} title={`${row.google ? '[구글] ' : ''}${eventClock(row) ? `${eventClock(row)} ` : ''}${row.title || ''}`}>
            {time ? <b className="wb-ev-time">{time}</b> : null}{row.title || '(제목 없음)'}
        </span>
    );
}

/* ── 위젯 하나하나 ── */

function DayWidget({ data, today, events }) {
    const { go } = useUi();
    const local = withUsedCount(data.timetable, usePeriodLocal());
    const table = tableForDateWithLocal(data, today, local);
    const subjects = Array.from({ length: local.count }, (_, i) => table[`p${i + 1}`] || '').filter(Boolean);
    const rest = restInfo(today, events.filter((row) => !row.google));
    const todays = events.filter((row) => eventOn(row, today));
    const checked = data.profile.checkedDates.includes(today);
    const marks = data.attendance.filter((row) => row.date === today).length;
    return (
        <>
            <div className="wb-day-head">
                <strong className="title-font wb-day-num">{Number(today.slice(8, 10))}</strong>
                <span className="wb-day-week">{weekdayKo(today)}요일{rest.off ? <em className="day-rest-mark"> · {rest.label}</em> : null}</span>
            </div>
            <p className="wb-line muted">{rest.off ? '오늘은 수업이 없어요' : (subjects.join(' · ') || '오늘 시간표가 비어 있어요')}</p>
            <div className="wb-list">
                {todays.slice(0, 3).map((row) => <p key={row.id} className="wb-item clip1">📅 {eventClock(row) ? `${eventClock(row)} ` : ''}{row.title}</p>)}
                {!todays.length && <p className="wb-item muted">오늘 일정은 없어요</p>}
            </div>
            <Btn className="chip wb-more" onClick={() => go(`#/attend/${today}`)}>{checked ? `출결 ${marks ? `${marks}명 표시` : '모두 출석'}` : '출결 하기'}</Btn>
        </>
    );
}
function TodoWidget({ data }) {
    const { go, showToast } = useUi();
    const todos = joined(data, 'todos');
    const left = todos.filter((row) => !row.done);
    return (
        <>
            <p className="wb-big">{left.length}<span className="wb-unit">개 남음</span></p>
            <div className="wb-list">
                {left.slice(0, 5).map((row) => (
                    <Btn key={row.id} className="wb-todo" aria-label={`할 일 끝내기: ${row.title}`} onClick={(event) => toggleTodoFx(row.id, event, { showToast })}>
                        <TodoTitle className="clip1" lead="☐ " title={row.title} />
                    </Btn>
                ))}
                {!left.length && <p className="wb-item muted">다 끝냈어요</p>}
            </div>
            <Btn className="chip wb-more" onClick={() => go('#/todo')}>할 일 모두 보기</Btn>
        </>
    );
}
function EventsWidget({ today, events }) {
    const { go } = useUi();
    const list = upcomingEvents(events, today, 5);
    return (
        <>
            <div className="wb-list">
                {list.map((row) => (
                    <p key={row.id} className="wb-item wb-ev">
                        <span className="wb-dday">{row.date <= today ? '오늘' : dday(row.date, today)}</span>
                        <span className="clip1">{md(row.date)} {row.title}</span>
                    </p>
                ))}
                {!list.length && <p className="wb-item muted">다가오는 일정이 없어요</p>}
            </div>
            <Btn className="chip wb-more" onClick={() => go('#/schedule')}>일정 보기</Btn>
        </>
    );
}
function NoticeWidget({ data, today }) {
    const { go } = useUi();
    const tomorrow = addDaysYmd(today, 1);
    const near = noticesNear(joined(data, 'notices'), today, tomorrow);
    return (
        <>
            <div className="wb-list">
                <p className="wb-sub">오늘</p>
                <p className="wb-notice">{near.today ? near.today.text : <span className="muted">아직 없어요</span>}</p>
                <p className="wb-sub">내일</p>
                <p className="wb-notice">{near.tomorrow ? near.tomorrow.text : <span className="muted">아직 없어요</span>}</p>
            </div>
            <Btn className="chip wb-more" onClick={() => go(`#/notice/${tomorrow}`)}>내일 알림장 쓰기</Btn>
        </>
    );
}

function WeekWidget({ today, events, size }) {
    const { go } = useUi();
    const start = startOfWeekMon(today);
    const days = Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i));
    const byDay = eventsByDay(events, days);
    const max = size === 'l' ? 6 : 3;
    return (
        <>
            <div className={size === 's' ? 'wb-week is-rows' : 'wb-week'}>
                {days.map((ymd) => {
                    const list = byDay.get(ymd);
                    const holi = holidayName(ymd);
                    return (
                        <Btn key={ymd} className={ymd === today ? 'wb-week-day is-today' : 'wb-week-day'} aria-label={`${md(ymd)} ${weekdayKo(ymd)}요일 일정 ${list.length}개${holi ? `, ${holi}` : ''}`} onClick={() => go(`#/day/${ymd}`)}>
                            <span className={`wb-week-label${holi || ['토', '일'].includes(weekdayKo(ymd)) ? ' is-rest' : ''}`}>{weekdayKo(ymd)} <b>{Number(ymd.slice(8, 10))}</b></span>
                            {holi && <span className="wb-holi clip1">{holi}</span>}
                            {list.slice(0, max).map((row) => <EventChip key={row.id} row={row} />)}
                            {list.length > max && <span className="wb-ev-more">+{list.length - max}</span>}
                        </Btn>
                    );
                })}
            </div>
            <Btn className="chip wb-more" onClick={() => go(`#/schedule/week/${today}`)}>한 주 일정 보기</Btn>
        </>
    );
}

function MonthWidget({ today, events, size }) {
    const { go } = useUi();
    const ym = today.slice(0, 7);
    const cells = monthCells(ym);
    const byDay = eventsByDay(events, cells.map((c) => c.ymd));
    const small = size === 's';
    const max = size === 'l' ? 3 : 2;
    /* 작게: 칸이 좁아 제목 대신 점을 찍고, 아래에 이번 달 남은 일정을 몇 줄 적습니다. */
    const left = small ? upcomingEvents(events, today, 8).filter((r) => r.date.slice(0, 7) <= ym).slice(0, 4) : [];
    return (
        <>
            <p className="wb-sub">{Number(ym.slice(0, 4))}년 {Number(ym.slice(5, 7))}월</p>
            <div className={small ? 'wb-month is-small' : 'wb-month'} role="group" aria-label="이번 달">
                {WEEK_HEAD.map((w) => <span key={w} className={w === '토' || w === '일' ? 'wb-month-w is-rest' : 'wb-month-w'}>{w}</span>)}
                {cells.map((cell, i) => {
                    const list = cell.inMonth ? byDay.get(cell.ymd) : [];
                    const holi = cell.inMonth ? holidayName(cell.ymd) : '';
                    const restDay = holi || i % 7 >= 5;
                    const cls = ['wb-month-d', cell.inMonth ? '' : 'is-out', cell.ymd === today ? 'is-today' : '', list.length ? 'has-ev' : '', restDay ? 'is-rest' : ''].filter(Boolean).join(' ');
                    return (
                        <Btn key={cell.ymd} className={cls} aria-label={`${md(cell.ymd)}${holi ? ` ${holi}` : ''}${list.length ? ` 일정 ${list.length}개: ${list.map((r) => r.title).join(', ')}` : ''}`} onClick={() => go(`#/day/${cell.ymd}`)}>
                            <span className="wb-month-num">{cell.day}</span>
                            {!small && holi && <span className="wb-holi clip1">{holi}</span>}
                            {!small && list.slice(0, max).map((row) => <EventChip key={row.id} row={row} withTime={false} />)}
                            {!small && list.length > max && <span className="wb-ev-more">+{list.length - max}</span>}
                        </Btn>
                    );
                })}
            </div>
            {small && (
                <div className="wb-list">
                    {left.map((row) => <p key={row.id} className="wb-item wb-ev"><span className="wb-dday">{row.date <= today ? '오늘' : md(row.date)}</span><span className="clip1">{row.title}</span></p>)}
                    {!left.length && <p className="wb-item muted">이번 달 남은 일정이 없어요</p>}
                </div>
            )}
            <Btn className="chip wb-more" onClick={() => go(`#/schedule/month/${today}`)}>달력 크게 보기</Btn>
        </>
    );
}

function YearWidget({ today, events, size }) {
    const { go } = useUi();
    const year = Number(today.slice(0, 4));
    const progress = yearProgress(today);
    const months = titlesByMonth(events, year, size === 'l' ? 4 : 2);
    const month = Number(today.slice(5, 7));
    const small = size === 's';
    return (
        <>
            <p className="wb-sub">{year}년 · {progress.day}일째, {progress.left}일 남음</p>
            <div className="wb-progress" role="progressbar" aria-label="올해 지난 날" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}>
                <span style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            </div>
            <div className={small ? 'wb-year is-small' : 'wb-year'}>
                {months.map((m, i) => (
                    <Btn key={i} className={i + 1 === month ? 'wb-year-m is-now' : (i + 1 < month ? 'wb-year-m is-past' : 'wb-year-m')} aria-label={`${i + 1}월 일정 ${m.count}개${m.top.length ? `: ${m.top.map((r) => r.title).join(', ')}` : ''}`} onClick={() => go(`#/schedule/month/${year}-${String(i + 1).padStart(2, '0')}-01`)}>
                        <b className="wb-year-name">{i + 1}월</b>
                        {small ? <span className="muted">{m.count || '·'}</span> : (
                            <>
                                {m.top.map((row) => <span key={row.id} className="wb-year-ev clip1">{Number(row.date.slice(8, 10))}일 {row.title}</span>)}
                                {m.count > m.top.length && <span className="wb-ev-more">+{m.count - m.top.length}</span>}
                                {!m.count && <span className="wb-year-ev muted">·</span>}
                            </>
                        )}
                    </Btn>
                ))}
            </div>
        </>
    );
}

function WeatherWidget() {
    const [place, setPlace] = useState(() => readPlace());
    const [draft, setDraft] = useState('');
    const [state, setState] = useState({ data: null, at: 0, error: '', busy: false });
    const [asking, setAsking] = useState(false);

    useEffect(() => {
        if (!place) return undefined;
        let alive = true;
        const run = (force = false) => {
            setState((s) => ({ ...s, busy: true }));
            loadWeather(place, { force }).then((res) => { if (alive) setState({ ...res, busy: false }); });
        };
        run();
        /* 화면을 띄워 둔 동안 30분마다 새로 받습니다(그 사이에는 이 기기에 둔 값). */
        const timer = setInterval(() => run(), 30 * 60 * 1000);
        return () => { alive = false; clearInterval(timer); };
    }, [place]);

    async function pick() {
        const name = draft.trim();
        if (!name) return;
        setAsking(true);
        let found = null;
        try { found = await findPlace(name); } catch { found = null; }
        setAsking(false);
        if (!found) {
            setState({ data: null, at: 0, error: `'${name}'을(를) 찾지 못했어요. 시·군 이름으로 적어 주세요.`, busy: false });
            return;
        }
        writePlace(found);
        setPlace(found);
        setDraft('');
    }

    if (!place || asking) {
        return (
            <form className="wb-weather-set" onSubmit={(event) => { event.preventDefault(); pick(); }}>
                <label className="wb-sub" htmlFor="wb-weather-place">어느 지역 날씨를 볼까요?</label>
                <Field id="wb-weather-place" value={draft} maxLength={30} placeholder="예: 아산" onChange={(event) => setDraft(event.target.value)} />
                <Btn className="chip" type="submit" disabled={asking}>{asking ? '찾는 중…' : '정하기'}</Btn>
                {state.error && <p className="wb-item muted" role="status">{state.error}</p>}
                <p className="wb-fine muted">지역 이름과 좌표만 날씨 서비스(Open-Meteo)에 보내요.</p>
            </form>
        );
    }
    const now = state.data ? weatherText(state.data.code) : null;
    return (
        <>
            <p className="wb-sub">{place.name}</p>
            {state.data ? (
                <>
                    <p className="wb-weather-now"><span aria-hidden="true">{now.icon}</span> <b>{state.data.temp}°</b> <span>{now.label}</span></p>
                    {state.data.feels !== null && <p className="wb-item muted">체감 {state.data.feels}°</p>}
                    <div className="wb-weather-days">
                        {state.data.days.map((day, i) => {
                            const w = weatherText(day.code);
                            return (
                                <span key={day.date} className="wb-weather-day">
                                    <b>{i === 0 ? '오늘' : i === 1 ? '내일' : weekdayKo(day.date)}</b>
                                    <span aria-label={w.label}>{w.icon}</span>
                                    <span className="num">{Math.round(day.min)}°/{Math.round(day.max)}°</span>
                                    {Number.isFinite(day.rain) && <span className="muted num">☔{day.rain}%</span>}
                                </span>
                            );
                        })}
                    </div>
                </>
            ) : (
                <p className="wb-item muted" role="status">{state.busy ? '날씨를 받는 중이에요…' : (state.error || '날씨를 받지 못했어요.')}</p>
            )}
            {state.error && state.data && <p className="wb-fine muted">{state.error} 예전에 받은 값이에요.</p>}
            <Btn className="chip wb-more" onClick={() => { writePlace(null); setPlace(null); setState({ data: null, at: 0, error: '', busy: false }); }}>지역 바꾸기</Btn>
        </>
    );
}

/* ── 꾸미기(휴대폰 홈 화면처럼 그 자리에서) ── */

const SIZE_ICON = { s: '▫', m: '▭', l: '⬜' };

function EditBar({ w, index, count, onChange, layout }) {
    const label = LABEL[w.id];
    return (
        <div className="wb-edit-tools" data-role="widget-tools">
            <Btn className="wb-tool" aria-label={`${label} 앞으로`} disabled={index === 0} onClick={() => onChange(moveWidget(layout, w.id, -1))}>‹</Btn>
            <Btn className="wb-tool wb-tool-size" aria-label={`${label} 크기: ${SIZE_LABEL[w.size]}, 눌러서 ${SIZE_LABEL[nextSize(w.size)]}`} data-role="widget-size" onClick={() => onChange(setWidgetSize(layout, w.id, nextSize(w.size)))}>
                <span aria-hidden="true">{SIZE_ICON[w.size]}</span> {SIZE_LABEL[w.size]}
            </Btn>
            <Btn className="wb-tool" aria-label={`${label} 뒤로`} disabled={index === count - 1} onClick={() => onChange(moveWidget(layout, w.id, 1))}>›</Btn>
            <Btn className="wb-tool wb-tool-hide" aria-label={`${label} 빼기`} data-role="widget-hide" onClick={() => onChange(toggleWidget(layout, w.id, false))}>✕</Btn>
        </div>
    );
}

function AddTray({ layout, onChange }) {
    const hidden = layout.filter((w) => !w.on);
    return (
        <section className="wb-tray" aria-label="위젯 더하기" data-role="widget-tray">
            <p className="wb-tray-title"><b>위젯 더하기</b> <span className="muted">눌러서 판에 올려요. 판 위 위젯은 끌어서 옮기고, ✕로 빼요.</span></p>
            <div className="wb-tray-list">
                {hidden.map((w) => (
                    <Btn key={w.id} className="wb-tray-item" data-widget-add={w.id} aria-label={`${LABEL[w.id]} 위젯 더하기`} onClick={() => onChange(toggleWidget(layout, w.id, true))}>
                        <span className="wb-tray-icon" aria-hidden="true">{META[w.id].icon}</span>
                        <span className="wb-tray-text"><b>＋ {LABEL[w.id]}</b><span className="muted">{META[w.id].hint}</span></span>
                    </Btn>
                ))}
                {!hidden.length && <p className="muted wb-item">모든 위젯이 판에 있어요.</p>}
            </div>
        </section>
    );
}

const BODY = {
    weather: WeatherWidget,
    day: DayWidget,
    todo: TodoWidget,
    week: WeekWidget,
    month: MonthWidget,
    year: YearWidget,
    events: EventsWidget,
    notice: NoticeWidget,
};

const HINT_KEY = 'ssug-gyomu-widget-hint';
function readHint() { try { return localStorage.getItem(HINT_KEY) !== '1'; } catch { return true; } }
function closeHint() { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* 이번만 닫힘 */ } }

/** 넓은 화면 '오늘'의 위젯판 */
export function WidgetBoard({ onLeave }) {
    const { data, clock } = useUi();
    const gcal = useGcal();
    const [layout, setLayout] = useState(() => readWidgetLayout());
    const [editing, setEditing] = useState(false);
    const [drag, setDrag] = useState({ from: '', over: '' });
    const [hint, setHint] = useState(readHint);
    const today = clock.ymd;
    const classEvents = joined(data, 'events');
    const google = visibleGoogleEvents(gcal, data.auth?.uid);
    /* 학급 일정 + 구글 일정(보기만). 달력 위젯들이 함께 씁니다. */
    const events = [...classEvents, ...google].filter((r) => r?.date);
    const shown = layout.filter((w) => w.on);
    const change = (next) => setLayout(writeWidgetLayout(next));
    const finish = () => { setEditing(false); setDrag({ from: '', over: '' }); };
    useEffect(() => {
        if (!editing) return undefined;
        const onKey = (event) => { if (event.key === 'Escape') finish(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [editing]);
    return (
        <div className={editing ? 'wb is-editing' : 'wb'} data-screen="widget-board">
            <div className="wb-bar">
                {editing ? (
                    <>
                        <p className="wb-bar-note" role="status">꾸미는 중이에요. 위젯을 끌어서 옮기고, 크기 단추로 키우거나 줄여요.</p>
                        <Btn className="primary-btn wb-done" data-role="widget-done" onClick={finish}>완료</Btn>
                    </>
                ) : (
                    <>
                        <Btn className="chip wb-edit-btn" data-role="widget-customize" onClick={() => { setEditing(true); setHint(false); closeHint(); }}>✏️ 위젯 꾸미기</Btn>
                        <Btn className="chip" data-role="widget-leave" onClick={onLeave}>기본 화면으로</Btn>
                    </>
                )}
            </div>
            {hint && !editing && (
                <div className="wb-hint" role="note">
                    <span>휴대폰 홈 화면처럼 꾸밀 수 있어요. <b>위젯 꾸미기</b>를 눌러 보세요.</span>
                    <Btn className="icon-btn" aria-label="안내 닫기" onClick={() => { setHint(false); closeHint(); }}>✕</Btn>
                </div>
            )}
            {editing && <AddTray layout={layout} onChange={change} />}
            <div className="wb-grid">
                {shown.map((w, index) => {
                    const Body = BODY[w.id];
                    const dragProps = editing ? {
                        draggable: true,
                        onDragStart: (event) => { event.dataTransfer.effectAllowed = 'move'; try { event.dataTransfer.setData('text/plain', w.id); } catch { /* 일부 브라우저 */ } setDrag({ from: w.id, over: '' }); },
                        onDragOver: (event) => { if (!drag.from || drag.from === w.id) return; event.preventDefault(); if (drag.over !== w.id) setDrag((d) => ({ ...d, over: w.id })); },
                        onDragLeave: () => setDrag((d) => (d.over === w.id ? { ...d, over: '' } : d)),
                        onDrop: (event) => { event.preventDefault(); if (drag.from && drag.from !== w.id) change(dropWidget(layout, drag.from, w.id)); setDrag({ from: '', over: '' }); },
                        onDragEnd: () => setDrag({ from: '', over: '' }),
                    } : {};
                    const cls = ['glass', 'wb-card', `wb-${w.size}`, drag.from === w.id ? 'is-dragging' : '', drag.over === w.id ? 'is-over' : ''].filter(Boolean).join(' ');
                    return (
                        <section key={w.id} className={cls} data-widget={w.id} data-size={w.size} aria-labelledby={`wb-h-${w.id}`} {...dragProps}>
                            <div className="wb-head">
                                {editing && <span className="wb-grip" aria-hidden="true" title="끌어서 옮기기">⠿</span>}
                                <h3 className="wb-title" id={`wb-h-${w.id}`}>{LABEL[w.id]}</h3>
                            </div>
                            {editing && <EditBar w={w} index={index} count={shown.length} layout={layout} onChange={change} />}
                            <div className="wb-body" inert={editing ? 'true' : undefined}><Body data={data} today={today} events={events} size={w.size} /></div>
                        </section>
                    );
                })}
                {!shown.length && (
                    <div className="wb-empty">
                        <p className="muted">판이 비어 있어요.</p>
                        {!editing && <Btn className="primary-btn" onClick={() => setEditing(true)}>위젯 더하기</Btn>}
                    </div>
                )}
            </div>
        </div>
    );
}
