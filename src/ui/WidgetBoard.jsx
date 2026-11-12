import { useEffect, useState } from 'react';
import { addDaysYmd, eventClock, monthCells, startOfWeekMon, weekdayKo } from '../lib/date.js';
import { restInfo } from '../lib/daymark.js';
import { joined } from '../lib/db.js';
import { tableForDateWithLocal } from '../lib/semester.js';
import { withUsedCount } from '../lib/periodLocal.js';
import {
    SIZE_LABEL, WIDGETS, WIDGET_SIZES, eventOn, eventsByMonth, moveWidget, noticesNear, readWidgetLayout, setWidgetSize,
    toggleWidget, upcomingEvents, writeWidgetLayout, yearProgress,
} from '../lib/widgets.js';
import { findPlace, loadWeather, readPlace, weatherText, writePlace } from '../lib/weather.js';
import { toggleTodoFx } from './doneFx.js';
import { useUi } from './context.jsx';
import { usePeriodLocal } from './usePeriodLocal.js';
import { Btn, Field, TodoTitle } from './bits.jsx';
import './widgets.css';

const LABEL = Object.fromEntries(WIDGETS.map((w) => [w.id, w.label]));

function md(ymd) {
    return `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8, 10))}`;
}

function dday(ymd, today) {
    const diff = Math.round((Date.UTC(...ymd.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n)))) - Date.UTC(...today.split('-').map((n, i) => (i === 1 ? Number(n) - 1 : Number(n))))) / 86400000);
    if (diff <= 0) return '오늘';
    if (diff === 1) return '내일';
    return `D-${diff}`;
}

/* ── 위젯 하나하나 ── */

function DayWidget({ data, today, events }) {
    const { go } = useUi();
    const local = withUsedCount(data.timetable, usePeriodLocal());
    const table = tableForDateWithLocal(data, today, local);
    const subjects = Array.from({ length: local.count }, (_, i) => table[`p${i + 1}`] || '').filter(Boolean);
    const rest = restInfo(today, events);
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

function WeekWidget({ today, events }) {
    const { go } = useUi();
    const start = startOfWeekMon(today);
    const days = Array.from({ length: 7 }, (_, i) => addDaysYmd(start, i));
    return (
        <>
            <div className="wb-week">
                {days.map((ymd) => {
                    const list = events.filter((row) => eventOn(row, ymd));
                    return (
                        <Btn key={ymd} className={ymd === today ? 'wb-week-day is-today' : 'wb-week-day'} aria-label={`${md(ymd)} ${weekdayKo(ymd)}요일 일정 ${list.length}개`} onClick={() => go(`#/day/${ymd}`)}>
                            <span className="wb-week-label">{weekdayKo(ymd)} <b>{Number(ymd.slice(8, 10))}</b></span>
                            {list.slice(0, 3).map((row) => <span key={row.id} className="wb-week-ev clip1">{row.title}</span>)}
                            {list.length > 3 && <span className="wb-week-ev muted">외 {list.length - 3}</span>}
                        </Btn>
                    );
                })}
            </div>
            <Btn className="chip wb-more" onClick={() => go(`#/schedule/week/${today}`)}>한 주 일정 보기</Btn>
        </>
    );
}

function MonthWidget({ today, events }) {
    const { go } = useUi();
    const ym = today.slice(0, 7);
    const cells = monthCells(ym);
    return (
        <>
            <p className="wb-sub">{Number(ym.slice(0, 4))}년 {Number(ym.slice(5, 7))}월</p>
            <div className="wb-month" role="group" aria-label="이번 달">
                {['월', '화', '수', '목', '금', '토', '일'].map((w) => <span key={w} className="wb-month-w">{w}</span>)}
                {cells.map((cell) => {
                    const has = cell.inMonth && events.some((row) => eventOn(row, cell.ymd));
                    const cls = ['wb-month-d', cell.inMonth ? '' : 'is-out', cell.ymd === today ? 'is-today' : '', has ? 'has-ev' : ''].filter(Boolean).join(' ');
                    return (
                        <Btn key={cell.ymd} className={cls} aria-label={`${md(cell.ymd)}${has ? ' 일정 있음' : ''}`} onClick={() => go(`#/day/${cell.ymd}`)}>
                            {cell.day}
                        </Btn>
                    );
                })}
            </div>
            <Btn className="chip wb-more" onClick={() => go(`#/schedule/month/${today}`)}>달력 보기</Btn>
        </>
    );
}

function YearWidget({ today, events }) {
    const { go } = useUi();
    const year = Number(today.slice(0, 4));
    const progress = yearProgress(today);
    const counts = eventsByMonth(events, year);
    const month = Number(today.slice(5, 7));
    return (
        <>
            <p className="wb-sub">{year}년 · {progress.day}일째, {progress.left}일 남음</p>
            <div className="wb-progress" role="progressbar" aria-label="올해 지난 날" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.ratio * 100)}>
                <span style={{ width: `${Math.round(progress.ratio * 100)}%` }} />
            </div>
            <div className="wb-year">
                {counts.map((n, i) => (
                    <Btn key={i} className={i + 1 === month ? 'wb-year-m is-now' : (i + 1 < month ? 'wb-year-m is-past' : 'wb-year-m')} aria-label={`${i + 1}월 일정 ${n}개`} onClick={() => go(`#/schedule/month/${year}-${String(i + 1).padStart(2, '0')}-01`)}>
                        <b>{i + 1}월</b>
                        <span className="muted">{n ? `일정 ${n}` : '·'}</span>
                    </Btn>
                ))}
            </div>
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

/* ── 꾸미기 ── */

function Customize({ layout, onChange, onClose }) {
    return (
        <section className="glass wb-edit" aria-label="위젯 꾸미기" data-role="widget-edit">
            <div className="wb-edit-top">
                <h2 className="title-font" style={{ margin: 0, fontSize: 18 }}>위젯 꾸미기</h2>
                <Btn className="primary-btn wb-edit-done" onClick={onClose}>다 됐어요</Btn>
            </div>
            <p className="muted" style={{ margin: '4px 0 10px' }}>켜고 끄고, 순서와 크기를 고르세요. 이 컴퓨터에만 저장돼요.</p>
            <ul className="wb-edit-list">
                {layout.map((w, i) => (
                    <li key={w.id} className="wb-edit-row" data-widget-row={w.id}>
                        <Btn className={w.on ? 'chip on' : 'chip'} aria-pressed={w.on ? 'true' : 'false'} onClick={() => onChange(toggleWidget(layout, w.id))}>{w.on ? '켬' : '끔'}</Btn>
                        <strong className="wb-edit-name">{LABEL[w.id]}</strong>
                        <span className="wb-edit-sizes" role="group" aria-label={`${LABEL[w.id]} 크기`}>
                            {WIDGET_SIZES.map((size) => (
                                <Btn key={size} className={w.size === size ? 'chip on' : 'chip'} aria-pressed={w.size === size ? 'true' : 'false'} onClick={() => onChange(setWidgetSize(layout, w.id, size))}>{SIZE_LABEL[size]}</Btn>
                            ))}
                        </span>
                        <span className="wb-edit-move">
                            <Btn className="icon-btn" aria-label={`${LABEL[w.id]} 위로`} disabled={i === 0} onClick={() => onChange(moveWidget(layout, w.id, -1))}>↑</Btn>
                            <Btn className="icon-btn" aria-label={`${LABEL[w.id]} 아래로`} disabled={i === layout.length - 1} onClick={() => onChange(moveWidget(layout, w.id, 1))}>↓</Btn>
                        </span>
                    </li>
                ))}
            </ul>
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

/** 넓은 화면 '오늘'의 위젯판 */
export function WidgetBoard({ onLeave }) {
    const { data, clock } = useUi();
    const [layout, setLayout] = useState(() => readWidgetLayout());
    const [editing, setEditing] = useState(false);
    const today = clock.ymd;
    const events = joined(data, 'events');
    const shown = layout.filter((w) => w.on);
    const change = (next) => setLayout(writeWidgetLayout(next));
    return (
        <div className="wb" data-screen="widget-board">
            <div className="wb-bar">
                <Btn className={editing ? 'chip on' : 'chip'} aria-pressed={editing ? 'true' : 'false'} data-role="widget-customize" onClick={() => setEditing((v) => !v)}>꾸미기</Btn>
                <Btn className="chip" data-role="widget-leave" onClick={onLeave}>기본 화면으로</Btn>
            </div>
            {editing && <Customize layout={layout} onChange={change} onClose={() => setEditing(false)} />}
            <div className="wb-grid">
                {shown.map((w) => {
                    const Body = BODY[w.id];
                    return (
                        <section key={w.id} className={`glass wb-card wb-${w.size}`} data-widget={w.id} aria-labelledby={`wb-h-${w.id}`}>
                            <h3 className="wb-title" id={`wb-h-${w.id}`}>{LABEL[w.id]}</h3>
                            <div className="wb-body"><Body data={data} today={today} events={events} /></div>
                        </section>
                    );
                })}
                {!shown.length && <p className="muted">켜 둔 위젯이 없어요. 꾸미기에서 골라 주세요.</p>}
            </div>
        </div>
    );
}

