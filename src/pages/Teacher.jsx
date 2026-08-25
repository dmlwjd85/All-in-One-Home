import { useMemo, useState } from 'react';
import { CheckSquare, Plus, Trash2 } from 'lucide-react';
import { EmptyState, Field, Modal, SearchBox } from '../components/ui.jsx';
import { addItem, patchItem, removeItem, upsertDoc } from '../lib/store.js';
import { ATTEND_STATUS, CONTACT_TYPES, PERIODS, SUBJECTS, WEEKDAYS, todayYmd } from '../lib/utils.js';

const TABS = [
    { id: 'today', label: '오늘' },
    { id: 'lesson', label: '수업일지' },
    { id: 'todo', label: '할 일' },
    { id: 'meet', label: '회의·상담' },
    { id: 'attend', label: '출결' },
    { id: 'time', label: '시간표' },
];

export default function TeacherPage({ lessons, todos, meets, contacts, attendance, roster, timetable, signedIn, author, onChanged, onToast }) {
    const [tab, setTab] = useState('today');
    const [q, setQ] = useState('');
    const [modal, setModal] = useState(null);
    const [lesson, setLesson] = useState({ date: todayYmd(), subject: '국어', period: 1, title: '', goal: '', activity: '', eval: '', note: '' });
    const [todoText, setTodoText] = useState('');
    const [meet, setMeet] = useState({ date: todayYmd(), title: '', content: '', actions: '' });
    const [contact, setContact] = useState({ date: todayYmd(), student: '', type: '전화', summary: '', follow: '' });
    const [attend, setAttend] = useState({ date: todayYmd(), student: '', status: '출석', note: '' });
    const [rosterText, setRosterText] = useState(roster.map((r) => r.name).join('\n'));

    const names = roster.map((r) => r.name).filter(Boolean);
    const todayLessons = lessons.filter((l) => l.date === todayYmd()).sort((a, b) => (a.period || 0) - (b.period || 0));
    const openTodos = todos.filter((t) => !t.done);

    const filteredLessons = useMemo(() => {
        const n = q.trim().toLowerCase();
        return lessons
            .filter((l) => !n || `${l.title} ${l.subject} ${l.goal} ${l.activity}`.toLowerCase().includes(n))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (a.period || 0) - (b.period || 0));
    }, [lessons, q]);

    const saveLesson = async () => {
        if (!lesson.title.trim()) {
            onToast('수업 제목을 입력해 주세요.');
            return;
        }
        await addItem('teacherLessons', { ...lesson, author }, signedIn);
        setModal(null);
        setLesson({ date: todayYmd(), subject: '국어', period: 1, title: '', goal: '', activity: '', eval: '', note: '' });
        onChanged();
        onToast('수업일지를 저장했습니다.');
    };

    const addTodo = async () => {
        if (!todoText.trim()) return;
        await addItem('teacherTodos', { text: todoText.trim(), done: false, date: todayYmd(), author }, signedIn);
        setTodoText('');
        onChanged();
    };

    const saveRoster = async () => {
        const lines = rosterText.split('\n').map((s) => s.trim()).filter(Boolean);
        // 기존 명단을 비우고 다시 넣기 위해 개별 문서로 유지
        for (const row of roster) await removeItem('classRoster', row.id, signedIn);
        for (const name of lines) await addItem('classRoster', { name }, signedIn);
        setModal(null);
        onChanged();
        onToast('학급 명단을 저장했습니다.');
    };

    return (
        <div className="space-y-4">
            <section className="bg-indigo-900 text-white rounded-3xl p-5 md:p-7">
                <p className="text-sm font-bold text-indigo-200">초등 교무일지</p>
                <h2 className="text-2xl md:text-3xl font-black mt-1">수업·상담·출결을 한 흐름으로</h2>
                <p className="mt-2 text-indigo-100">오늘 수업 {todayLessons.length}건 · 남은 할 일 {openTodos.length}건</p>
            </section>

            <div role="tablist" aria-label="교무일지 메뉴" className="flex gap-2 overflow-x-auto pb-1">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        className={`shrink-0 min-h-tap px-4 rounded-full font-extrabold border ${tab === t.id ? 'bg-indigo-800 text-white border-indigo-800' : 'bg-white border-stone-300'}`}
                        onClick={() => setTab(t.id)}
                    >
                        {t.label}
                    </button>
                ))}
            </div>

            {tab === 'today' && (
                <div className="space-y-3">
                    <section className="card p-5">
                        <h3 className="font-black text-lg mb-2">오늘 수업</h3>
                        {todayLessons.length === 0 ? <p className="text-stone-600">아직 오늘 수업일지가 없습니다.</p> : (
                            <ol className="space-y-2">
                                {todayLessons.map((l) => (
                                    <li key={l.id} className="border-b border-stone-100 pb-2">
                                        <p className="font-black">{l.period}교시 {l.subject} · {l.title}</p>
                                        {l.goal && <p className="text-sm text-stone-600">목표: {l.goal}</p>}
                                    </li>
                                ))}
                            </ol>
                        )}
                    </section>
                    <section className="card p-5">
                        <h3 className="font-black text-lg mb-2">남은 할 일</h3>
                        {openTodos.slice(0, 8).map((t) => (
                            <label key={t.id} className="flex items-center gap-3 min-h-tap">
                                <input type="checkbox" checked={false} onChange={async () => {
                                    await patchItem('teacherTodos', t.id, { done: true }, signedIn);
                                    onChanged();
                                }} />
                                <span>{t.text}</span>
                            </label>
                        ))}
                        {openTodos.length === 0 && <p className="text-stone-600">밀린 할 일이 없습니다.</p>}
                    </section>
                    <button type="button" className="btn-primary w-full" onClick={() => setModal('lesson')}><Plus size={18} /> 오늘 수업일지 쓰기</button>
                </div>
            )}

            {tab === 'lesson' && (
                <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex-1"><SearchBox value={q} onChange={setQ} placeholder="과목·제목·활동 검색" /></div>
                        <button type="button" className="btn-primary" onClick={() => setModal('lesson')}><Plus size={18} /> 수업일지</button>
                    </div>
                    {filteredLessons.length === 0 ? <EmptyState title="수업일지가 없습니다" hint="차시, 학습목표, 활동, 평가를 남겨 두면 다음 해에도 재사용할 수 있습니다." /> : (
                        <ul className="space-y-2">
                            {filteredLessons.map((l) => (
                                <li key={l.id} className="card p-4">
                                    <p className="text-sm text-stone-600">{l.date} · {l.period}교시 {l.subject}</p>
                                    <h4 className="font-black text-lg">{l.title}</h4>
                                    {l.goal && <p className="text-sm mt-1"><strong>목표</strong> {l.goal}</p>}
                                    {l.activity && <p className="text-sm whitespace-pre-wrap mt-1">{l.activity}</p>}
                                    {l.eval && <p className="text-sm mt-1"><strong>평가</strong> {l.eval}</p>}
                                    <button type="button" className="text-sm text-rose-700 mt-2 underline" onClick={async () => {
                                        if (!confirm('이 수업일지를 삭제할까요?')) return;
                                        await removeItem('teacherLessons', l.id, signedIn);
                                        onChanged();
                                    }}><Trash2 size={14} className="inline" /> 삭제</button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {tab === 'todo' && (
                <div className="card p-5 space-y-3">
                    <div className="flex gap-2">
                        <input className="field flex-1" value={todoText} onChange={(e) => setTodoText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTodo()} placeholder="할 일 입력 후 Enter" />
                        <button type="button" className="btn-primary" onClick={addTodo}>추가</button>
                    </div>
                    {todos.length === 0 && <EmptyState title="할 일이 없습니다" />}
                    <ul className="space-y-2">
                        {todos.map((t) => (
                            <li key={t.id} className="flex items-center gap-3 min-h-tap">
                                <input type="checkbox" checked={!!t.done} onChange={async () => {
                                    await patchItem('teacherTodos', t.id, { done: !t.done }, signedIn);
                                    onChanged();
                                }} aria-label={t.text} />
                                <span className={`flex-1 ${t.done ? 'line-through text-stone-500' : ''}`}>{t.text}</span>
                                <button type="button" className="text-stone-500" aria-label="삭제" onClick={async () => {
                                    await removeItem('teacherTodos', t.id, signedIn);
                                    onChanged();
                                }}><Trash2 size={16} /></button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {tab === 'meet' && (
                <div className="space-y-4">
                    <div className="flex gap-2">
                        <button type="button" className="btn-primary flex-1" onClick={() => setModal('meet')}>회의록</button>
                        <button type="button" className="btn-secondary flex-1" onClick={() => setModal('contact')}>학부모 상담</button>
                    </div>
                    <section>
                        <h3 className="font-black mb-2">회의록</h3>
                        {meets.length === 0 && <p className="text-stone-600 mb-3">아직 회의록이 없습니다.</p>}
                        <ul className="space-y-2">
                            {meets.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((m) => (
                                <li key={m.id} className="card p-4">
                                    <p className="text-sm text-stone-600">{m.date}</p>
                                    <p className="font-black">{m.title}</p>
                                    <p className="text-sm whitespace-pre-wrap mt-1">{m.content}</p>
                                    {m.actions && <p className="text-sm mt-2 bg-emerald-50 rounded-xl p-2"><CheckSquare size={14} className="inline" /> {m.actions}</p>}
                                </li>
                            ))}
                        </ul>
                    </section>
                    <section>
                        <h3 className="font-black mb-2">학부모 상담 기록</h3>
                        <ul className="space-y-2">
                            {contacts.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((c) => (
                                <li key={c.id} className="card p-4">
                                    <p className="font-black">{c.student} · {c.type}</p>
                                    <p className="text-sm text-stone-600">{c.date}</p>
                                    <p className="text-sm mt-1 whitespace-pre-wrap">{c.summary}</p>
                                    {c.follow && <p className="text-sm mt-1">후속: {c.follow}</p>}
                                </li>
                            ))}
                        </ul>
                    </section>
                </div>
            )}

            {tab === 'attend' && (
                <div className="space-y-3">
                    <div className="flex gap-2">
                        <button type="button" className="btn-primary flex-1" onClick={() => setModal('attend')}>출결 기록</button>
                        <button type="button" className="btn-secondary flex-1" onClick={() => { setRosterText(names.join('\n')); setModal('roster'); }}>학급 명단</button>
                    </div>
                    {attendance.length === 0 ? <EmptyState title="출결 기록이 없습니다" hint="지각·결석만 남겨도 상담 때 바로 찾을 수 있습니다." /> : (
                        <ul className="space-y-2">
                            {attendance.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((a) => (
                                <li key={a.id} className="card p-4 flex justify-between gap-3">
                                    <div>
                                        <p className="font-black">{a.student} · {a.status}</p>
                                        <p className="text-sm text-stone-600">{a.date}{a.note ? ` · ${a.note}` : ''}</p>
                                    </div>
                                    <button type="button" className="text-rose-700 text-sm underline" onClick={async () => {
                                        await removeItem('teacherAttend', a.id, signedIn);
                                        onChanged();
                                    }}>삭제</button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            )}

            {tab === 'time' && (
                <div className="card p-4 overflow-x-auto">
                    <p className="text-sm text-stone-600 mb-3">칸을 누르면 과목을 바꿀 수 있습니다. 빈칸은 공란으로 둡니다.</p>
                    <table className="w-full min-w-[520px] text-center border-collapse">
                        <caption className="sr-only">주간 시간표</caption>
                        <thead>
                            <tr>
                                <th className="p-2 border bg-stone-100">교시</th>
                                {WEEKDAYS.map((d) => <th key={d} className="p-2 border bg-stone-100">{d}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {PERIODS.map((p) => (
                                <tr key={p}>
                                    <th className="p-2 border bg-stone-50">{p}</th>
                                    {WEEKDAYS.map((d, di) => {
                                        const key = `${di}-${p}`;
                                        const val = timetable[key] || '';
                                        return (
                                            <td key={key} className="p-1 border">
                                                <label className="sr-only" htmlFor={`tt-${key}`}>{d}요일 {p}교시</label>
                                                <select
                                                    id={`tt-${key}`}
                                                    className="w-full min-h-tap rounded-lg border-0 bg-transparent text-sm font-bold"
                                                    value={val}
                                                    onChange={async (e) => {
                                                        const next = { ...timetable, [key]: e.target.value };
                                                        await upsertDoc('teacherTimetable', 'week', next, signedIn);
                                                        onChanged();
                                                    }}
                                                >
                                                    <option value="">-</option>
                                                    {SUBJECTS.map((s) => <option key={s} value={s}>{s}</option>)}
                                                </select>
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {modal === 'lesson' && (
                <Modal title="수업일지" onClose={() => setModal(null)} wide>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <Field label="날짜"><input type="date" className="field" value={lesson.date} onChange={(e) => setLesson({ ...lesson, date: e.target.value })} /></Field>
                        <Field label="과목">
                            <select className="field" value={lesson.subject} onChange={(e) => setLesson({ ...lesson, subject: e.target.value })}>
                                {SUBJECTS.map((s) => <option key={s}>{s}</option>)}
                            </select>
                        </Field>
                        <Field label="교시">
                            <select className="field" value={lesson.period} onChange={(e) => setLesson({ ...lesson, period: Number(e.target.value) })}>
                                {PERIODS.map((p) => <option key={p} value={p}>{p}교시</option>)}
                            </select>
                        </Field>
                    </div>
                    <Field label="수업 제목"><input className="field" value={lesson.title} onChange={(e) => setLesson({ ...lesson, title: e.target.value })} placeholder="예: 분수의 덧셈" /></Field>
                    <Field label="학습 목표"><input className="field" value={lesson.goal} onChange={(e) => setLesson({ ...lesson, goal: e.target.value })} /></Field>
                    <Field label="주요 활동"><textarea className="field min-h-28" value={lesson.activity} onChange={(e) => setLesson({ ...lesson, activity: e.target.value })} /></Field>
                    <Field label="평가·관찰"><textarea className="field min-h-20" value={lesson.eval} onChange={(e) => setLesson({ ...lesson, eval: e.target.value })} /></Field>
                    <Field label="내일 연결 / 메모"><input className="field" value={lesson.note} onChange={(e) => setLesson({ ...lesson, note: e.target.value })} /></Field>
                    <button type="button" className="btn-primary w-full" onClick={saveLesson}>저장</button>
                </Modal>
            )}

            {modal === 'meet' && (
                <Modal title="회의록" onClose={() => setModal(null)} wide>
                    <Field label="날짜"><input type="date" className="field" value={meet.date} onChange={(e) => setMeet({ ...meet, date: e.target.value })} /></Field>
                    <Field label="제목"><input className="field" value={meet.title} onChange={(e) => setMeet({ ...meet, title: e.target.value })} placeholder="학년 협의회" /></Field>
                    <Field label="내용"><textarea className="field min-h-32" value={meet.content} onChange={(e) => setMeet({ ...meet, content: e.target.value })} /></Field>
                    <Field label="후속 할 일"><input className="field" value={meet.actions} onChange={(e) => setMeet({ ...meet, actions: e.target.value })} /></Field>
                    <button type="button" className="btn-primary w-full" onClick={async () => {
                        if (!meet.title.trim()) return onToast('제목을 입력해 주세요.');
                        await addItem('teacherMeets', { ...meet, author }, signedIn);
                        setModal(null);
                        setMeet({ date: todayYmd(), title: '', content: '', actions: '' });
                        onChanged();
                    }}>저장</button>
                </Modal>
            )}

            {modal === 'contact' && (
                <Modal title="학부모 상담" onClose={() => setModal(null)}>
                    <Field label="날짜"><input type="date" className="field" value={contact.date} onChange={(e) => setContact({ ...contact, date: e.target.value })} /></Field>
                    <Field label="학생">
                        {names.length ? (
                            <select className="field" value={contact.student} onChange={(e) => setContact({ ...contact, student: e.target.value })}>
                                <option value="">선택</option>
                                {names.map((n) => <option key={n}>{n}</option>)}
                            </select>
                        ) : (
                            <input className="field" value={contact.student} onChange={(e) => setContact({ ...contact, student: e.target.value })} placeholder="이름" />
                        )}
                    </Field>
                    <Field label="유형">
                        <select className="field" value={contact.type} onChange={(e) => setContact({ ...contact, type: e.target.value })}>
                            {CONTACT_TYPES.map((t) => <option key={t}>{t}</option>)}
                        </select>
                    </Field>
                    <Field label="내용"><textarea className="field min-h-28" value={contact.summary} onChange={(e) => setContact({ ...contact, summary: e.target.value })} /></Field>
                    <Field label="후속 조치"><input className="field" value={contact.follow} onChange={(e) => setContact({ ...contact, follow: e.target.value })} /></Field>
                    <button type="button" className="btn-primary w-full" onClick={async () => {
                        if (!contact.student.trim() || !contact.summary.trim()) return onToast('학생과 내용을 입력해 주세요.');
                        await addItem('teacherContacts', { ...contact, author }, signedIn);
                        setModal(null);
                        setContact({ date: todayYmd(), student: '', type: '전화', summary: '', follow: '' });
                        onChanged();
                    }}>저장</button>
                </Modal>
            )}

            {modal === 'attend' && (
                <Modal title="출결 기록" onClose={() => setModal(null)}>
                    <Field label="날짜"><input type="date" className="field" value={attend.date} onChange={(e) => setAttend({ ...attend, date: e.target.value })} /></Field>
                    <Field label="학생">
                        {names.length ? (
                            <select className="field" value={attend.student} onChange={(e) => setAttend({ ...attend, student: e.target.value })}>
                                <option value="">선택</option>
                                {names.map((n) => <option key={n}>{n}</option>)}
                            </select>
                        ) : <input className="field" value={attend.student} onChange={(e) => setAttend({ ...attend, student: e.target.value })} />}
                    </Field>
                    <Field label="상태">
                        <select className="field" value={attend.status} onChange={(e) => setAttend({ ...attend, status: e.target.value })}>
                            {ATTEND_STATUS.map((s) => <option key={s}>{s}</option>)}
                        </select>
                    </Field>
                    <Field label="메모"><input className="field" value={attend.note} onChange={(e) => setAttend({ ...attend, note: e.target.value })} /></Field>
                    <button type="button" className="btn-primary w-full" onClick={async () => {
                        if (!attend.student.trim()) return onToast('학생 이름을 입력해 주세요.');
                        await addItem('teacherAttend', { ...attend, author }, signedIn);
                        setModal(null);
                        setAttend({ date: todayYmd(), student: '', status: '출석', note: '' });
                        onChanged();
                    }}>저장</button>
                </Modal>
            )}

            {modal === 'roster' && (
                <Modal title="학급 명단" onClose={() => setModal(null)}>
                    <Field label="한 줄에 한 명" hint="상담·출결 선택 목록에 바로 쓰입니다.">
                        <textarea className="field min-h-48" value={rosterText} onChange={(e) => setRosterText(e.target.value)} placeholder={'김민준\n이서연'} />
                    </Field>
                    <button type="button" className="btn-primary w-full" onClick={saveRoster}>명단 저장</button>
                </Modal>
            )}
        </div>
    );
}
