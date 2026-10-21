import { addDaysYmd, dayKeyFromYmd, startOfWeekMon, weekdayKo } from '../lib/date.js';
import { periodStatus } from '../lib/period.js';
import { joined, joinedRecords } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Btn, studentName } from './bits.jsx';

export function Home() {
    const { data, clock, go } = useUi();
    const day = dayKeyFromYmd(clock.ymd);
    const table = data.timetable[day] || {};
    const labels = [1, 2, 3, 4, 5, 6].map((index) => table[`p${index}`] || '');
    const period = periodStatus(clock.hm, data.profile.periodStarts, labels);
    const marks = data.attendance.filter((row) => row.date === clock.ymd);
    const checked = data.profile.checkedDates.includes(clock.ymd);
    const count = data.profile.classSize || data.students.length;
    const todos = joined(data, 'todos');
    const left = todos.filter((row) => !row.done).length;
    const events = joined(data, 'events').filter((row) => row.date >= startOfWeekMon(clock.ymd) && row.date <= addDaysYmd(startOfWeekMon(clock.ymd), 6));
    const feed = [
        ...joinedRecords(data).map((row) => ({ id: row.id, at: row.at || row.date, title: `${data.students.find((item) => item.id === row.sid)?.no || ''} ${studentName(data.students, row.sid)} · ${row.kind}`.trim(), text: row.text, emoji: '👀' })),
        ...joined(data, 'notices').map((row) => ({ id: row.id, at: row.at || row.date, title: row.date === addDaysYmd(clock.ymd, 1) ? '내일 알림장' : '알림장', text: row.text, emoji: '📢' })),
    ].sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 2);
    const birthdays = data.students.filter((row) => row.birthday && row.birthday === clock.ymd.slice(5));
    const follows = joinedRecords(data).filter((row) => row.follow === clock.ymd);

    return (
        <div className="home-grid">
            <section className="hero home-hero">
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                    <span className="hero-kicker" style={{ display: 'inline-flex', alignItems: 'center', minHeight: 36, padding: '0 12px', fontWeight: 800 }}>⏰ {period.text}</span>
                    <Btn className="hero-action" onClick={() => go(`#/attend/${clock.ymd}`)}>{checked ? '출결 고치기' : '출결 하기'}</Btn>
                </div>
                <h2 className="title-font" style={{ fontSize: 26, lineHeight: '34px', margin: '14px 0 8px' }}>{count ? `오늘 우리 반 ${count}명` : '우리 반 이름을 적어 주세요'}</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {marks.map((row) => {
                        const student = data.students.find((item) => item.id === row.sid);
                        if (!student) return null;
                        return <span key={row.id} className="hero-pill" style={{ padding: '6px 10px', fontWeight: 700 }}>{student.no} {student.name} {row.status}{row.note ? `·${row.note}` : ''}</span>;
                    })}
                    {!marks.length && checked && <span className="hero-pill" style={{ padding: '6px 10px' }}>오늘은 모두 출석이에요</span>}
                </div>
                {birthdays.length > 0 && <p style={{ marginBottom: 0 }}>🎂 {birthdays.map((row) => row.name).join(', ')} 생일이에요</p>}
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginTop: 14, fontWeight: 700 }}>
                    <span>{checked ? '출결 확인 끝났어요' : '출결부터 볼까요?'}</span>
                    <span>할 일 {left}개 남음</span>
                </div>
            </section>

            <section className="glass home-quick" style={{ padding: 14 }}>
                <h3 style={{ margin: '0 0 6px', fontSize: 16 }}>일은 ＋에서 시작해요</h3>
                <p className="muted" style={{ margin: 0 }}>회의록, 출결, 메시지 붙여넣기, 기록은 가운데 ＋를 누르면 한 화면에서 고릅니다.</p>
            </section>

            <section className="glass home-time" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>오늘 시간표</h3>
                    <Btn onClick={() => go('#/schedule')} style={{ color: 'var(--primary)', fontWeight: 800 }}>한 주 보기</Btn>
                </div>
                <div className="period-row" style={{ marginTop: 10 }}>
                    {labels.map((label, index) => {
                        const on = period.index === index;
                        const specialist = table[`s${index + 1}`];
                        return (
                            <Btn key={index} className="block" onClick={() => go('#/schedule')} style={{ background: on ? 'var(--primary)' : 'var(--solid)', color: on ? 'var(--on-primary)' : 'var(--ink)', borderRadius: 16, border: '1px solid var(--line)', minHeight: 64, fontWeight: 800, fontSize: 13 }}>
                                <span style={{ display: 'grid' }}><span>{label || `${index + 1}교시`}</span><span style={{ fontWeight: 600, fontSize: 11 }}>{index + 1}교시{specialist ? ` ${specialist}` : ''}</span></span>
                            </Btn>
                        );
                    })}
                </div>
            </section>

            <section className="glass home-todo" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>오늘 할 일</h3>
                    <Btn onClick={() => go('#/todo')} style={{ color: 'var(--primary)', fontWeight: 800 }}>모두 보기</Btn>
                </div>
                <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                    {todos.slice(0, 3).map((row) => (
                        <div key={row.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'center' }}>
                            <span>{row.done ? '☑' : '☐'} {row.title}</span>
                            {row.of ? <span className="muted num">{row.of}명 중 {row.got}명</span> : <span className="muted">{row.due ? `${Number(row.due.slice(5, 7))}/${Number(row.due.slice(8))}까지` : ''}</span>}
                        </div>
                    ))}
                    {follows.map((row) => <p key={row.id} style={{ margin: 0 }}>다시 보기 · {studentName(data.students, row.sid) || '상담'}</p>)}
                    {!todos.length && <p className="muted" style={{ margin: 0 }}>오늘 적어 둔 할 일이 없어요.</p>}
                </div>
            </section>

            <section className="glass home-event" style={{ padding: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ margin: 0, fontSize: 16 }}>이번 주 학급 일정</h3>
                    <Btn onClick={() => go('#/schedule')} style={{ color: 'var(--primary)', fontWeight: 800 }}>달력</Btn>
                </div>
                <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
                    {events.slice(0, 3).map((row) => (
                        <div key={row.id}>
                            <strong>{weekdayKo(row.date)} {Number(row.date.slice(5, 7))}/{Number(row.date.slice(8))} · {row.title}</strong>
                            {row.memo && <p className="muted" style={{ margin: '2px 0 0' }}>{row.memo}</p>}
                        </div>
                    ))}
                    {!events.length && <p className="muted" style={{ margin: 0 }}>이번 주 일정은 아직 없어요.</p>}
                </div>
            </section>

            <section className="glass home-recent" style={{ padding: 14 }}>
                <h3 style={{ margin: '0 0 8px', fontSize: 16 }}>최근에 적은 것</h3>
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
                    {!feed.length && <p className="muted" style={{ margin: 0 }}>아직 기록이 없어요. ＋를 누르면 10초면 남길 수 있어요.</p>}
                </div>
            </section>
        </div>
    );
}
