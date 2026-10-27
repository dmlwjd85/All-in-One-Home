import { useEffect, useRef, useState } from 'react';
import { addDaysYmd, dueLabel, eventClock, startOfWeekMon } from '../lib/date.js';
import { readTodoLine } from '../lib/parse.js';
import { dropInbox, joined, joinedRecords, promoteInbox, receiveOne, removeItem, saveTextItem, toggleTodo } from '../lib/db.js';
import { clearNoticeDay, pickNotice, restoreNoticeDay, saveNotice } from './noticeSave.js';
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

// 열려 있는 알림장 화면의 날짜·입력칸 글·DB 글과 되돌린 글을 보여 줄 함수. 화면을 떠나면 비웁니다.
const liveNotice = { current: null };

export function Notice() {
    const { data, clock, route, showToast, go } = useUi();
    const date = route.params.date || addDaysYmd(clock.ymd, 1);
    const notices = joined(data, 'notices');
    // 그 날 행이 둘(비운 클라우드 행 + 이 기기 민감 행)이면 글이 있는 행을 먼저 보여 줍니다. 저장 위치 고르기와 같은 함수예요.
    const current = pickNotice(notices, date);
    const dbText = current?.text || '';
    const [text, setText] = useState(dbText);
    const [synced, setSynced] = useState(dbText);
    const [saving, setSaving] = useState(false);
    // 쓰던 글을 남긴 채 되돌렸을 때 입력칸 위에 보여 줄 되돌린 글
    const [restored, setRestored] = useState('');
    const busy = useRef(false);
    const others = notices.filter((row) => row.date !== date && String(row.text || '').trim());
    const events = joined(data, 'events').filter((row) => row.date === date);

    useEffect(() => {
        // 되돌리기 안내가 지금 입력칸에 쓰던 글이 있는지 알 수 있게, 열려 있는 알림장 화면의 상태를 적어 둡니다.
        liveNotice.current = { date, text, synced, showRestored: setRestored };
    });
    useEffect(() => () => { liveNotice.current = null; }, []);

    useEffect(() => {
        // DB 글이 바뀌면(되돌리기·다른 기기) 입력칸이 예전 DB 글 그대로이거나 비어 있을(공백만 포함) 때만 새 글로 채웁니다.
        // 저장하는 동안에는 입력칸을 그대로 두고, 저장이 끝난 뒤 한 번만 맞춥니다. 저장에 실패해 DB가 원래대로 돌아가도 쓰던 글이 사라지지 않아요.
        if (saving || dbText === synced) return;
        setText((prev) => prev === synced || !prev.trim() ? dbText : prev);
        setSynced(dbText);
    }, [dbText, saving]);

    async function save(next) {
        if (busy.current) return;
        busy.current = true;
        setSaving(true);
        try {
            await saveOnce(next);
        } finally {
            busy.current = false;
            setSaving(false);
        }
    }

    async function saveOnce(next) {
        if (!next.trim()) {
            if (!current?.text?.trim()) { showToast('적은 내용이 없어서 저장하지 않았어요.'); return; }
            // 그 날 글이 여러 줄(클라우드 옛 글 + 이 기기 민감 글)이어도 함께 비우고 함께 되돌립니다.
            const cleared = await clearNoticeDay(date);
            if (cleared?.storageFailed) return;
            showToast('이 날 알림장을 비웠어요.', false, {
                label: '되돌리기',
                onClick: async () => {
                    const live = liveNotice.current;
                    const typing = Boolean(live && live.date === date && live.text.trim() && live.text !== live.synced);
                    const result = await restoreNoticeDay(cleared.before);
                    if (result?.storageFailed) return;
                    if (typing) live.showRestored(pickNotice(cleared.before, date)?.text || '');
                    showToast(typing ? '알림장을 되돌렸어요. 쓰던 글은 그대로 두었어요.' : '알림장을 되돌렸어요.');
                },
            });
            return;
        }
        const result = await saveNotice(date, next);
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
            {restored && restored === dbText && text.trim() && text !== dbText && (
                <div className="glass" role="group" aria-label="되돌린 글" style={{ marginTop: 12, padding: 12, display: 'flex', gap: 10, alignItems: 'center' }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                        <span className="muted" style={{ display: 'block', fontSize: 13 }}>되돌린 글이에요. 저장하면 지금 쓰는 글로 바뀌어요.</span>
                        <span className="restored-note" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', fontSize: 14, wordBreak: 'break-all' }}>{restored}</span>
                    </div>
                    <Btn className="chip" style={{ flexShrink: 0 }} onClick={() => { setText(dbText); setRestored(''); }}>되돌린 글 불러오기</Btn>
                </div>
            )}
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
                <Btn className="primary-btn" style={{ flex: 1 }} disabled={saving} aria-busy={saving} onClick={() => save(text)}>저장</Btn>
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
