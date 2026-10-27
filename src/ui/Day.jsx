import { useEffect, useState } from 'react';
import { addDaysYmd, dayKeyFromYmd, formatKoDate, weekdayKo } from '../lib/date.js';
import { restInfo } from '../lib/daymark.js';
import { joined, joinedRecords, removeItem, saveTextItem, toggleTodo } from '../lib/db.js';
import { mergeCalendarRows, visibleGoogleEvents } from '../lib/gcalCore.js';
import { refreshGcal } from '../lib/gcalLive.js';
import { useUi } from './context.jsx';
import { useGcal } from './useGcal.js';
import { Btn } from './bits.jsx';
import { EventLine } from './EventLine.jsx';
import { isLocked, tableRow, withUsedCount } from '../lib/periodLocal.js';
import { usePeriodLocal } from './usePeriodLocal.js';

const DAY_LABEL = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금' };

function eventEnd(row) {
    return row.end && row.end >= row.date ? row.end : row.date;
}

function onDay(row, date) {
    return row.date <= date && date <= eventEnd(row);
}

export function Day() {
    const { data, clock, route, go, openFlow, showToast } = useUi();
    const gcal = useGcal();
    useEffect(() => { refreshGcal().catch(() => {}); }, []);
    const date = route.params.date;
    const events = mergeCalendarRows(
        joined(data, 'events'),
        visibleGoogleEvents(gcal, data.auth?.uid),
    ).filter((row) => onDay(row, date));
    const todos = joined(data, 'todos').filter((row) => row.due === date);
    const records = joinedRecords(data).filter((row) => row.date === date);
    const follows = joinedRecords(data).filter((row) => row.follow === date && row.date !== date);
    const marks = joined(data, 'attendance').filter((row) => row.date === date && row.status && row.status !== '출석');
    const notices = joined(data, 'notices').filter((row) => row.date === date);
    const dayNotes = joined(data, 'notes').filter((row) => row.id === `day-${date}`);
    const dayNote = dayNotes.find((row) => row.localOnly) || dayNotes[0];
    const [memo, setMemo] = useState(dayNote?.text || '');
    const rest = restInfo(date, joined(data, 'events'));
    const dayKey = dayKeyFromYmd(date);
    const local = withUsedCount(data.timetable, usePeriodLocal());
    const table = tableRow(data.timetable, dayKey, local);
    const school = Boolean(DAY_LABEL[dayKey]);
    const studentOf = (sid) => {
        const row = data.students.find((item) => item.id === sid);
        return row ? `${row.no}번 ${row.name}` : '이름 없는 기록';
    };

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <div className="week-nav">
                <Btn className="icon-btn" aria-label="이전 날" onClick={() => go(`#/day/${addDaysYmd(date, -1)}`, { state: { appFrom: history.state?.appFrom || 'day' } })}>‹</Btn>
                <strong className="title-font">{formatKoDate(date, { today: clock.ymd })}</strong>
                <Btn className="icon-btn" aria-label="다음 날" onClick={() => go(`#/day/${addDaysYmd(date, 1)}`, { state: { appFrom: history.state?.appFrom || 'day' } })}>›</Btn>
            </div>
            <p className="muted" style={{ margin: 0 }}>이 날의 할 일, 일정, 시간표, 출결, 상담을 한곳에 모았어요. 나이스에 넣기 전에 여기서 확인하고 바로 고쳐요.</p>
            {rest.off && <p className="day-rest-mark" style={{ margin: 0 }}>{rest.label === '휴일' ? '휴일이에요.' : `휴일 · ${rest.label}`}</p>}

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>할 일</h2>
                {todos.map((row) => (
                    <div key={row.id} style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <Btn className={row.done ? 'chip on' : 'chip'} style={{ flex: 1, justifyContent: 'flex-start', textAlign: 'left', whiteSpace: 'normal' }} onClick={() => toggleTodo(row.id)}>{row.done ? '끝냄' : '아직'} {row.title}</Btn>
                        <Btn className="chip" onClick={() => removeItem('todos', row.id).then(() => showToast('할 일을 지웠어요.'))}>지우기</Btn>
                    </div>
                ))}
                {!todos.length && <p className="muted">이 날로 발라 둔 할 일이 없어요.</p>}
                <Btn className="chip" onClick={() => openFlow({ id: 'quick', kind: '할 일', date })}>할 일 적기</Btn>
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>일정</h2>
                {events.map((row) => <EventLine key={row.id} row={row} showToast={showToast} />)}
                {!events.length && <p className="muted">이 날 일정은 없어요.</p>}
                <Btn className="chip" onClick={() => openFlow({ id: 'quick', kind: '일정', date })}>일정 적기</Btn>
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>시간표</h2>
                {school && !rest.off && (
                    <div style={{ display: 'grid', gap: 6 }}>
                        {Array.from({ length: local.count }, (_, index) => {
                            if (isLocked(local, dayKey, index + 1)) return null;
                            const subject = table[`p${index + 1}`] || '';
                            const special = table[`s${index + 1}`];
                            return <p key={index} style={{ margin: 0 }}>{index + 1}교시 {subject || '비어 있음'}{special ? ' · 전담' : ''}</p>;
                        })}
                    </div>
                )}
                {(!school || rest.off) && <p className="muted">{weekdayKo(date)}요일은 수업 시간표가 없어요.</p>}
                <Btn className="chip" style={{ marginTop: 8 }} onClick={() => go('#/schedule')}>시간표 고치기</Btn>
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>출결</h2>
                {marks.map((row) => (
                    <p key={row.id} style={{ marginTop: 0 }}>{studentOf(row.sid)} {row.status}{row.reason ? ` · ${row.reason}` : ''}{row.note ? ` · ${row.note}` : ''}</p>
                ))}
                {!marks.length && <p className="muted">결석·지각·조퇴로 적어 둔 친구가 없어요. 모두 출석으로 보면 돼요.</p>}
                <Btn className="chip" onClick={() => go(`#/attend/${date}`)}>출결 고치기</Btn>
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>상담·기록</h2>
                {records.map((row) => {
                    const student = data.students.find((item) => item.id === row.sid);
                    return (
                        <div key={row.id} style={{ marginBottom: 8 }}>
                            <p style={{ margin: 0 }}>{row.localOnly ? '🔒 ' : ''}{row.kind} · {studentOf(row.sid)}</p>
                            <p style={{ margin: '4px 0' }}>{row.text}</p>
                            {student && <Btn className="chip" onClick={() => go(`#/students/${student.no}`, { state: { appFrom: 'day' } })}>이 학생 기록</Btn>}
                        </div>
                    );
                })}
                {follows.map((row) => (
                    <p key={`follow-${row.id}`} className="muted">다시 보기로 한 날 · {studentOf(row.sid)} {row.text}</p>
                ))}
                {!records.length && !follows.length && <p className="muted">이 날 상담이나 관찰 기록이 없어요.</p>}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Btn className="chip" onClick={() => openFlow({ id: 'quick', kind: '상담', date })}>상담 적기</Btn>
                    <Btn className="chip" onClick={() => openFlow({ id: 'quick', kind: '관찰', date })}>관찰 적기</Btn>
                </div>
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>알림장과 메모</h2>
                {notices.map((row) => <p key={row.id} style={{ marginTop: 0 }}>{row.text}</p>)}
                {!notices.length && <p className="muted">이 날 알림장은 아직 없어요.</p>}
                <Btn className="chip" onClick={() => go(`#/notice/${date}`)}>알림장 고치기</Btn>
                <textarea className="field" style={{ marginTop: 8 }} rows={3} aria-label="하루 메모" placeholder="나이스에 넣기 전에 남겨 둘 말" value={memo} onChange={(event) => setMemo(event.target.value)} />
                <Btn className="primary-btn block" style={{ marginTop: 8 }} onClick={async () => {
                    const text = memo.trim();
                    if (!text) {
                        if (!dayNote) {
                            showToast('한 줄만 적어도 남길 수 있어요.');
                            return;
                        }
                        const failed = await removeItem('notes', `day-${date}`);
                        if (failed?.storageFailed) return;
                        showToast('하루 메모를 지웠어요.', true);
                        return;
                    }
                    const result = await saveTextItem('notes', { id: `day-${date}`, text, date, pinned: false, source: 'app' }, { from: dayNote ? (dayNote.localOnly ? 'local' : 'cloud') : undefined });
                    if (result?.storageFailed) return;
                    showToast(result.sensitive ? '이 내용은 이 기기에만 남겨 둘게요.' : '하루 메모를 남겼어요.', true);
                }}>하루 메모 저장</Btn>
            </section>
        </div>
    );
}
