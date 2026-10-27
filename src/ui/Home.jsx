import { useEffect, useState } from 'react';
import { addDaysYmd, dayKeyFromYmd, dueLabel, eventClock, startOfWeekMon, weekdayKo } from '../lib/date.js';
import { iraParticle, restInfo } from '../lib/daymark.js';
import { periodStatus, workTimer } from '../lib/period.js';
import { joined, joinedRecords } from '../lib/db.js';
import { visibleGoogleEvents } from '../lib/gcalCore.js';
import { useUi } from './context.jsx';
import { useGcal } from './useGcal.js';
import { Btn, Motto, Symbol, studentName } from './bits.jsx';
import { ClayMark } from './ClayMark.jsx';
import { ReasonSheet } from './Attend.jsx';
import { allLengths, allStarts, isLocked, lastPeriod, skipPeriods, tableRow, withUsedCount } from '../lib/periodLocal.js';
import { usePeriodLocal } from './usePeriodLocal.js';
import { WorkTimer, useLeave, useWorkClock, wantsFast } from './WorkTimer.jsx';

export function Home() {
    const { data, go, showToast } = useUi();
    const [attendStudent, setAttendStudent] = useState(null);
    /* 홈 문구와 퇴근 타이머가 같은 시계를 씁니다. */
    const [fast, setFast] = useState(false);
    const clock = useWorkClock(fast);
    const day = dayKeyFromYmd(clock.ymd);
    const local = withUsedCount(data.timetable, usePeriodLocal());
    const leave = useLeave(clock.ymd);
    const table = tableRow(data.timetable, day, local);
    const labels = Array.from({ length: local.count }, (_, index) => table[`p${index + 1}`] || '');
    const period = periodStatus(clock.hm, allStarts(data.profile.periodStarts, local), labels, {
        last: lastPeriod(table, local, day),
        skip: skipPeriods(table, local, day),
        lengths: allLengths(local),
        workStart: local.workStart,
        workEnd: leave || local.workEnd,
        endLabel: leave ? '조퇴' : '퇴근',
    });
    const marks = data.attendance.filter((row) => row.date === clock.ymd);
    const checked = data.profile.checkedDates.includes(clock.ymd);
    const count = data.profile.classSize || data.students.length;
    const todos = joined(data, 'todos');
    const left = todos.filter((row) => !row.done).length;
    const weekStart = startOfWeekMon(clock.ymd);
    const weekEnd = addDaysYmd(weekStart, 6);
    const gcal = useGcal();
    const events = joined(data, 'events').filter((row) => {
        const end = row.end && row.end >= row.date ? row.end : row.date;
        return row.date <= weekEnd && end >= weekStart;
    });
    const googleWeek = visibleGoogleEvents(gcal, data.auth?.uid).filter((row) => {
        const end = row.end && row.end >= row.date ? row.end : row.date;
        return row.date <= weekEnd && end >= weekStart;
    }).slice(0, 2);
    const feed = [
        ...joinedRecords(data).map((row) => ({ id: row.id, at: row.at || row.date, title: `${data.students.find((item) => item.id === row.sid)?.no || ''} ${studentName(data.students, row.sid)} · ${row.kind}`.trim(), text: row.text, emoji: '👀' })),
        ...joined(data, 'notices').filter((row) => String(row.text || '').trim()).map((row) => ({ id: row.id, at: row.at || row.date, title: row.date === addDaysYmd(clock.ymd, 1) ? '내일 알림장' : '알림장', text: row.text, emoji: '📢' })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 2);
    const birthdays = data.students.filter((row) => row.birthday && row.birthday === clock.ymd.slice(5));
    const follows = joinedRecords(data).filter((row) => row.follow === clock.ymd);
    const todayRest = restInfo(clock.ymd, joined(data, 'events'));
    const timer = !todayRest.off && (local.workEnd || leave) ? <WorkTimer ymd={clock.ymd} local={local} leave={leave} showToast={showToast} now={clock} /> : null;
    const wantFast = Boolean(timer) && wantsFast(workTimer(clock.sec, { workStart: local.workStart, workEnd: local.workEnd, leave }));
    useEffect(() => { if (wantFast !== fast) setFast(wantFast); }, [wantFast, fast]);
    /* 빈 교시는 빼고, 잠긴 교시는 잠김으로 보여 줍니다. 과목이 하나도 없으면 교시 칸만 보여 줍니다. */
    const slots = labels.map((label, index) => ({ index, label, locked: isLocked(local, day, index + 1) }));
    const strip = slots.some((slot) => slot.label) ? slots.filter((slot) => slot.label) : slots;

    return (
        <div className={timer ? 'home-grid has-leave' : 'home-grid'}>
            <section className="hero home-hero">
                {todayRest.off ? (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                            <span className="hero-kicker" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 36, padding: '0 12px', fontWeight: 800 }}>오늘은 수업이 없어요</span>
                            <Btn className="hero-action" onClick={() => go(`#/attend/${clock.ymd}`)}>출결 보기</Btn>
                        </div>
                        <h2 className="title-font font-display" style={{ fontSize: 26, lineHeight: '34px', margin: '14px 0 8px' }}>{todayRest.label === '휴일' ? '휴일' : todayRest.label}</h2>
                        <p style={{ margin: '0 0 8px', fontWeight: 700 }}>{todayRest.label === '휴일' ? '시간표와 출결 대신 쉽니다. 필요하면 출결 보기를 누르세요.' : `${todayRest.label}${iraParticle(todayRest.label)} 수업과 출결 대신 쉽니다.`}</p>
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8, fontWeight: 700 }}>
                            <span>할 일 {left}개 남음</span>
                        </div>
                    </>
                ) : (
                    <>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                            <span className="hero-kicker" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 36, padding: '0 12px', fontWeight: 800 }}>⏰ {period.text}</span>
                            <Btn className="hero-action" onClick={() => go(`#/attend/${clock.ymd}`)}>{checked ? '출결 고치기' : '출결 하기'}</Btn>
                        </div>
                        <h2 className="title-font font-display" style={{ fontSize: 26, lineHeight: '34px', margin: '14px 0 8px' }}>{count ? `오늘 우리 반 ${count}명` : '우리 반 이름을 적어 주세요'}</h2>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {marks.map((row) => {
                                const student = data.students.find((item) => item.id === row.sid);
                                if (!student) return null;
                                return (
                                    <Btn key={row.id} className="hero-pill" onClick={() => setAttendStudent(student)}>
                                        {student.no} {student.name} {row.status}{row.note ? `·${row.note}` : ''}
                                    </Btn>
                                );
                            })}
                            {!marks.length && checked && <span className="hero-pill">오늘은 모두 출석이에요</span>}
                        </div>
                        {birthdays.length > 0 && <p style={{ marginBottom: 0 }}>🎂 {birthdays.map((row) => row.name).join(', ')} 생일이에요</p>}
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14, fontWeight: 700 }}>
                            <span>{checked ? '출결 확인 끝났어요' : '출결부터 볼까요?'}</span>
                            <span>할 일 {left}개 남음</span>
                        </div>
                    </>
                )}
            </section>
            {timer}

            <section className="glass home-quick" style={{ padding: 14 }}>
                <div className="home-brand">
                    <Symbol />
                    <p className="title-font home-brand-name">쨈 교무수첩</p>
                    <Motto />
                </div>
                <h3 className="home-quick-title" style={{ margin: '0 0 6px', fontSize: 16 }}>생각나면 발라 두기</h3>
                <p className="muted" style={{ margin: 0 }}>생각난 한 줄을 가운데 쨈 버튼에 발라 두면 일정, 할 일, 학생 기록으로 나눠 드려요. 회의록처럼 가끔 쓰는 일은 더보기에 있어요.</p>
            </section>

            <section className="glass home-time" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>오늘 시간표</h3>
                    <Btn onClick={() => go(`#/schedule/week/${clock.ymd}`)} style={{ color: 'var(--accent)', fontWeight: 800 }}>한 주 보기</Btn>
                </div>
                {todayRest.off ? (
                    <div className="day-rest rest-banner" style={{ marginTop: 10 }}>
                        <strong className="day-rest-mark">휴일</strong>
                        <span>{todayRest.label === '휴일' ? '오늘은 수업이 없어요.' : '시간표는 오늘 없어요.'}</span>
                    </div>
                ) : (
                    <div className="period-row" style={{ marginTop: 10, gridTemplateColumns: `repeat(${strip.length > 6 ? Math.ceil(strip.length / 2) : strip.length}, minmax(0, 1fr))` }}>
                        {strip.map(({ index, label, locked }) => {
                            const on = period.index === index;
                            const specialist = table[`s${index + 1}`];
                            return (
                                <Btn key={index} className={on ? 'block neo-in' : 'block neo'} aria-label={locked ? `${index + 1}교시 ${label} 잠김`.replace(/\s+/g, ' ') : undefined} onClick={() => go('#/schedule')} style={{ minHeight: 64, fontWeight: 500, fontSize: 13 }}>
                                    <span style={{ display: 'grid' }}>
                                        <span style={{ color: on ? 'var(--accent)' : (locked ? 'var(--ink-sub)' : 'var(--ink)') }}>{locked ? `🔒 ${label || '잠김'}` : (label || `${index + 1}교시`)}</span>
                                        {(label || locked) && <span style={{ fontWeight: 500, fontSize: 11, color: 'var(--ink-sub)' }}>{index + 1}교시{locked ? ' 잠김' : (specialist ? ` ${specialist}` : '')}</span>}
                                    </span>
                                </Btn>
                            );
                        })}
                    </div>
                )}
            </section>

            <section className="glass home-todo" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>오늘 할 일</h3>
                    <Btn onClick={() => go('#/todo')} style={{ color: 'var(--accent)', fontWeight: 800 }}>모두 보기</Btn>
                </div>
                <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                    {todos.slice(0, 3).map((row) => (
                        <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                            <span>{row.done ? '☑' : '☐'} {row.title}</span>
                            {row.of ? <span className="muted num">{row.of}명 중 {row.got}명</span> : <span className={`num${row.due ? ' todo-due' : ' muted'}`}>{row.due ? dueLabel(row.due, clock.ymd) : ''}</span>}
                        </div>
                    ))}
                    {follows.map((row) => <p key={row.id} style={{ margin: 0 }}>다시 보기 · {studentName(data.students, row.sid) || '상담'}</p>)}
                    {!todos.length && <p className="muted" style={{ margin: 0 }}>오늘 발라 둔 할 일이 없어요.</p>}
                    {(data.inbox || []).length > 0 && (
                        <Btn onClick={() => go('#/todo')} style={{ justifyContent: 'flex-start', minHeight: 44, fontWeight: 800 }}>정리함 {(data.inbox || []).length}개</Btn>
                    )}
                </div>
            </section>

            <section className="glass home-event" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>이번 주 학급 일정</h3>
                    <Btn onClick={() => go(`#/schedule/week/${clock.ymd}`)} style={{ color: 'var(--accent)', fontWeight: 800 }}>한 주</Btn>
                </div>
                <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
                    {events.slice(0, 3).map((row) => (
                        <div key={row.id}>
                            <strong>{row.end && row.end > row.date ? `${Number(row.date.slice(5, 7))}/${Number(row.date.slice(8))}~${Number(row.end.slice(5, 7))}/${Number(row.end.slice(8))}` : `${weekdayKo(row.date)} ${Number(row.date.slice(5, 7))}/${Number(row.date.slice(8))}`} · {row.endTime ? `${eventClock(row)} ` : ''}{row.title}</strong>
                            {row.memo && <p className="muted" style={{ margin: '2px 0 0' }}>{row.memo}</p>}
                        </div>
                    ))}
                    {googleWeek.map((row) => (
                        <div key={row.id} className="gcal-line">
                            <strong><span className="gcal-badge">구글</span>{weekdayKo(row.date)} {Number(row.date.slice(5, 7))}/{Number(row.date.slice(8))} · {row.title}</strong>
                            <p className="muted" style={{ margin: '2px 0 0' }}>보기만</p>
                        </div>
                    ))}
                    {!events.length && !googleWeek.length && <p className="muted" style={{ margin: 0 }}>이번 주 일정은 아직 없어요.</p>}
                </div>
            </section>

            <section className="glass home-recent" style={{ padding: 14 }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>최근에 발라 둔 것</h3>
                <div style={{ display: 'grid', gap: 10 }}>
                    {feed.map((row) => (
                        <div key={row.id} style={{ display: 'flex', gap: 10 }}>
                            <span aria-hidden="true">{row.emoji}</span>
                            <div>
                                <strong>{row.title}</strong>
                                <p className="muted" style={{ margin: 0 }}>{row.text}</p>
                            </div>
                        </div>
                    ))}
                    {!feed.length && (
                        <div>
                            <ClayMark />
                            <p className="muted" style={{ margin: 0, textAlign: 'center' }}>아직 기록이 없어요. 생각나면 발라 두면 누가기록에 쌓여요.</p>
                        </div>
                    )}
                </div>
            </section>
            {attendStudent && (
                <ReasonSheet
                    student={attendStudent}
                    mark={marks.find((row) => row.sid === attendStudent.id)}
                    date={clock.ymd}
                    onClose={() => setAttendStudent(null)}
                />
            )}
        </div>
    );
}
