import { useEffect, useRef, useState } from 'react';
import { addDaysYmd, dueLabel, eventClock, startOfWeekMon } from '../lib/date.js';
import { readTodoLine } from '../lib/parse.js';
import { dropInbox, joined, joinedRecords, promoteInbox, receiveOne, removeItem, saveTextItem, toggleTodo } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Btn, IconTrash, SpreadHint } from './bits.jsx';
import { ClayMark } from './ClayMark.jsx';

export function Tasks() {
    const { data, clock, showToast } = useUi();
    const [title, setTitle] = useState('');
    const todos = joined(data, 'todos');
    const inbox = data.inbox || [];
    const notes = joined(data, 'notes');
    const follows = joinedRecords(data).filter((row) => row.follow);
    const start = startOfWeekMon(clock.ymd);
    const end = addDaysYmd(start, 6);
    const groups = [
        ['오늘', todos.filter((row) => !row.due || row.due <= clock.ymd)],
        ['이번 주', todos.filter((row) => row.due > clock.ymd && row.due <= end)],
        ['나중에', todos.filter((row) => row.due > end)],
    ];
    return (
        <div>
            <form onSubmit={async (event) => {
                event.preventDefault();
                if (!title.trim()) return;
                const read = readTodoLine(title.trim(), new Date(), clock.ymd);
                const result = await saveTextItem('todos', { id: `todo-${Date.now()}`, title: read.title, done: false, due: read.due, source: 'app' });
                if (result?.storageFailed) return;
                setTitle('');
                showToast(result.sensitive ? '이 내용은 이 기기에만 남겨 둘게요.' : '할 일에 넣었어요.', true);
            }}>
                <input className="field" aria-label="할 일" placeholder="발라 두고 엔터" value={title} onChange={(event) => setTitle(event.target.value)} />
            </form>
            <section aria-label="정리함" style={{ marginTop: 16 }}>
                <h3 style={{ marginBottom: 8 }}>정리함</h3>
                {!inbox.length && <p className="muted">빼 둔 항목이 없어요. 메시지에서 나중에 정리를 고르면 여기에 남아요.</p>}
                {inbox.map((row) => (
                    <article key={row.id} className="todo-block">
                        <div className="todo-line">
                            <div className="todo-main" style={{ minHeight: 44 }}>
                                <span className="todo-title">{row.kind} · {row.title}</span>
                            </div>
                            {row.date ? <span className="todo-due num">{dueLabel(row.date, clock.ymd)}</span> : null}
                            <Btn className="icon-btn" aria-label="정리함에서 지우기" onClick={async () => {
                                const failed = await dropInbox(row.id);
                                if (!failed?.storageFailed) showToast('정리함에서 지웠어요.', true);
                            }}><IconTrash /></Btn>
                        </div>
                        {row.warning ? <p className="muted" style={{ margin: '4px 0' }}>{row.warning}</p> : null}
                        <Btn className="chip" style={{ minHeight: 44 }} onClick={async () => {
                            const result = await promoteInbox(row.id);
                            if (result?.storageFailed) return;
                            showToast(result.ok ? '다시 등록했어요.' : (result.message || '다시 등록하지 못했어요.'));
                        }}>다시 등록</Btn>
                    </article>
                ))}
            </section>
            {!todos.length && !notes.length && !inbox.length && (
                <div>
                    <ClayMark />
                    <SpreadHint center />
                </div>
            )}
            {groups.map(([label, rows]) => (
                <section key={label} style={{ marginTop: 16 }}>
                    <h3 style={{ marginBottom: 8 }}>{label}</h3>
                    {!rows.length && <p className="muted">없어요.</p>}
                    {rows.map((row) => (
                        <article key={row.id} className="todo-block">
                            <div className="todo-line">
                                <Btn className="todo-main" onClick={() => toggleTodo(row.id)}>
                                    <span aria-hidden="true">{row.done ? '☑' : '☐'}</span>
                                    <span className="todo-title">{row.localOnly ? '🔒 ' : ''}{row.title}</span>
                                </Btn>
                                {row.due ? <span className="todo-due num">{dueLabel(row.due, clock.ymd)}</span> : null}
                                <Btn className="icon-btn" aria-label="할 일 지우기" onClick={async () => {
                                    const failed = await removeItem('todos', row.id);
                                    if (!failed?.storageFailed) showToast('할 일을 지웠어요.', true);
                                }}><IconTrash /></Btn>
                            </div>
                            {row.of ? <p className="num" style={{ margin: '4px 0' }}>{row.of}명 중 {row.got}명 · 안 낸 친구 {row.pendingNos?.length || 0}명</p> : null}
                            {(row.pendingNos || []).length > 0 && (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {(row.pendingNos || []).map((no) => {
                                        const student = data.students.find((item) => item.no === no);
                                        return <Btn key={no} className="chip" onClick={() => receiveOne(row.id, no)}>{no} {student?.name || ''} 받음</Btn>;
                                    })}
                                </div>
                            )}
                        </article>
                    ))}
                </section>
            ))}
            {follows.length > 0 && (
                <section>
                    <h3>다시 볼 상담</h3>
                    {follows.map((row) => <p key={row.id}>{row.follow} · {row.text}</p>)}
                </section>
            )}
            <h3>메모</h3>
            <NoteBox />
            {notes.map((row) => (
                <article key={row.id} className="solid-card" style={{ padding: 12, marginBottom: 8 }}>
                    <p style={{ marginTop: 0 }}>{row.localOnly ? '🔒 ' : ''}{row.pinned ? '📌 ' : ''}{row.text}</p>
                    <Btn className="chip" onClick={() => removeItem('notes', row.id)}>지우기</Btn>
                </article>
            ))}
            {!notes.length && <p className="muted">고정해 두고 싶은 메모가 있으면 여기에 남겨요.</p>}
        </div>
    );
}

function NoteBox() {
    const { showToast } = useUi();
    const [text, setText] = useState('');
    return (
        <form style={{ marginBottom: 12 }} onSubmit={async (event) => {
            event.preventDefault();
            if (!text.trim()) return;
            const result = await saveTextItem('notes', { id: `note-${Date.now()}`, text: text.trim(), date: '', pinned: true, source: 'app' });
            if (result?.storageFailed) return;
            setText('');
            showToast(result.sensitive ? '이 내용은 이 기기에만 남겨 둘게요.' : '메모로 남겼어요.', true);
        }}>
            <textarea className="field" rows={3} aria-label="메모" placeholder="여기에 발라 둘 말" value={text} onChange={(event) => setText(event.target.value)} />
            <Btn className="primary-btn block" style={{ marginTop: 8 }} onClick={(event) => event.currentTarget.form?.requestSubmit()}>메모 남기기</Btn>
        </form>
    );
}

export function Notice() {
    const { data, clock, route, showToast, go } = useUi();
    const date = route.params.date || addDaysYmd(clock.ymd, 1);
    const notices = joined(data, 'notices');
    const current = notices.find((row) => row.date === date);
    const [text, setText] = useState(current?.text || '');
    const cleared = useRef(null);
    const others = notices.filter((row) => row.date !== date && String(row.text || '').trim());
    const events = joined(data, 'events').filter((row) => row.date === date);

    useEffect(() => {
        // 비운 알림장을 되돌리면 입력칸에도 예전 글을 다시 넣습니다.
        if (cleared.current?.date === date && current?.text === cleared.current.text) {
            cleared.current = null;
            setText((prev) => prev.trim() ? prev : current.text);
        }
    }, [current?.text, date]);

    async function save(next) {
        if (!next.trim()) {
            if (!current?.text?.trim()) { showToast('적은 내용이 없어서 저장하지 않았어요.'); return; }
            const failed = await removeItem('notices', current.id);
            if (failed?.storageFailed) return;
            cleared.current = { date, text: current.text };
            showToast('이 날 알림장을 비웠어요.', true);
            return;
        }
        const result = await saveTextItem('notices', { id: date, date, text: next, source: 'app', at: new Date().toISOString() }, { from: current ? (current.localOnly ? 'local' : 'cloud') : undefined });
        if (result?.storageFailed) return;
        showToast(result.sensitive ? '이 내용은 이 기기에만 남겨 둘게요.' : '알림장을 저장했어요.', true);
    }

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Btn className="icon-btn" aria-label="이전 날" onClick={() => { setText(''); go(`#/notice/${addDaysYmd(date, -1)}`); }}>‹</Btn>
                <strong>{date === addDaysYmd(clock.ymd, 1) ? '내일' : date}</strong>
                <Btn className="icon-btn" aria-label="다음 날" onClick={() => { setText(''); go(`#/notice/${addDaysYmd(date, 1)}`); }}>›</Btn>
            </div>
            <textarea className="field" rows={8} aria-label="알림장" style={{ marginTop: 12 }} value={text} onChange={(event) => setText(event.target.value)} placeholder="내일 알림장을 적어 주세요" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <Btn className="chip" onClick={() => {
                    if (!events.length) { showToast('그 날 일정이 없어요.'); return; }
                    const block = events.map((row) => `· ${row.endTime ? `${eventClock(row)} ` : ''}${row.title}${row.memo ? ` (${row.memo})` : ''}`).join('\n');
                    setText((prev) => prev ? `${prev}\n${block}` : block);
                }}>그날 일정 넣기</Btn>
                <Btn className="chip" onClick={async () => {
                    try {
                        await navigator.clipboard.writeText(text);
                        showToast('복사했어요. 다른 앱에 붙여 넣으면 돼요.');
                    } catch {
                        showToast('복사하지 못했어요. 글을 선택해 주세요.');
                    }
                }}>복사</Btn>
                <Btn className="primary-btn" style={{ flex: 1 }} onClick={() => save(text)}>저장</Btn>
            </div>
            <h3>지난 알림장</h3>
            {others.slice(0, 8).map((row) => (
                <Btn key={row.id} block className="glass" style={{ marginBottom: 8, padding: 12, textAlign: 'left' }} onClick={() => go(`#/notice/${row.date}`)}>
                    <strong>{row.date}</strong>
                    <span className="muted" style={{ display: 'block' }}>{row.text}</span>
                </Btn>
            ))}
            {!others.length && <p className="muted">{current?.text?.trim() ? '이 날 알림장은 저장해 두었어요. 다른 날 알림장을 저장하면 여기에 모여요.' : '아직 지난 알림장이 없어요. 저장하면 여기에 모여요.'}</p>}
        </div>
    );
}
