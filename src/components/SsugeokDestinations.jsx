import { useMemo, useState } from 'react';
import { Plus, Trash2, Users } from 'lucide-react';
import { EmptyState, Field, Modal } from './ui.jsx';
import { addItem, patchItem, removeItem } from '../lib/store.js';
import { ensureRosterName } from '../lib/ssugeok.js';
import { ATTEND_STATUS, monthLabel, startOfWeekMon, thisMonth, todayYmd } from '../lib/utils.js';

export default function SsugeokDestinations(props) {
    const { view } = props;
    if (view === 'student') return <StudentDest {...props} />;
    if (view === 'attend') return <AttendDest {...props} />;
    if (view === 'counsel') return <CounselDest {...props} />;
    if (view === 'plan') return <PlanDest {...props} />;
    if (view === 'task') return <TaskDest {...props} />;
    return null;
}

function StudentDest({ studentNotes, roster, signedIn, author, onChanged, onToast }) {
    const names = roster.map((r) => r.name).filter(Boolean);
    const [q, setQ] = useState('');
    const [modal, setModal] = useState(null);
    const [note, setNote] = useState({ student: '', text: '', date: todayYmd() });
    const [rosterText, setRosterText] = useState(names.join('\n'));

    const grouped = useMemo(() => {
        const n = q.trim();
        const map = {};
        studentNotes.forEach((row) => {
            const key = row.student || '이름 없음';
            if (n && !`${key} ${row.text}`.includes(n)) return;
            if (!map[key]) map[key] = [];
            map[key].push(row);
        });
        names.forEach((name) => {
            if (n && !name.includes(n)) return;
            if (!map[name]) map[name] = [];
        });
        return Object.entries(map).sort(([a], [b]) => a.localeCompare(b, 'ko'));
    }, [studentNotes, names, q]);

    const saveNote = async () => {
        const student = note.student.trim();
        const text = note.text.trim();
        if (!student || !text) {
            onToast('학생과 내용을 입력해 주세요.');
            return;
        }
        await ensureRosterName(student, roster, signedIn);
        await addItem('studentNotes', { student, text, date: note.date, author }, signedIn);
        setModal(null);
        setNote({ student: '', text: '', date: todayYmd() });
        onChanged();
        onToast('학생 기록을 남겼습니다.');
    };

    const saveRoster = async () => {
        const lines = rosterText.split('\n').map((s) => s.trim()).filter(Boolean);
        for (const row of roster) await removeItem('classRoster', row.id, signedIn);
        for (const name of lines) await addItem('classRoster', { name }, signedIn);
        setModal(null);
        onChanged();
        onToast('명단을 저장했습니다.');
    };

    return (
        <section className="space-y-3">
            <Header
                title="학생"
                hint="명렬에 붙인 쓱적과 관찰을 학생별로 모읍니다."
                actions={(
                    <>
                        <button type="button" className="btn-secondary" onClick={() => { setRosterText(names.join('\n')); setModal('roster'); }}>
                            <Users size={16} /> 명단
                        </button>
                        <button type="button" className="btn-primary" onClick={() => setModal('note')}><Plus size={16} /> 기록</button>
                    </>
                )}
            />
            <input className="field" value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름·내용 검색" aria-label="학생 검색" />
            {names.length === 0 && studentNotes.length === 0 && (
                <p className="text-sm text-stone-600">아직 명단이 없습니다. 쓱적을 학생에게 보낼 때 이름을 적으면 최소 명단이 만들어집니다.</p>
            )}
            {grouped.length === 0 ? (
                <EmptyState title="학생 기록이 없습니다" hint="받은함에서 카드를 밀어 이곳으로 날려보내 보세요." />
            ) : (
                <div className="space-y-3">
                    {grouped.map(([student, rows]) => (
                        <article key={student} className="card p-4 bg-[#fffaf0]/85">
                            <h3 className="font-black text-lg">{student}</h3>
                            {rows.length === 0 ? (
                                <p className="text-sm text-stone-500 mt-1">아직 기록이 없습니다.</p>
                            ) : (
                                <ul className="mt-2 space-y-2">
                                    {rows.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((row) => (
                                        <li key={row.id} className="flex justify-between gap-3">
                                            <span>
                                                <span className="block text-xs font-bold text-stone-500">{row.date}</span>
                                                <span className="whitespace-pre-wrap">{row.text}</span>
                                            </span>
                                            <button type="button" className="text-rose-700 underline shrink-0 min-h-tap" onClick={async () => {
                                                if (!confirm('이 기록을 삭제할까요?')) return;
                                                await removeItem('studentNotes', row.id, signedIn);
                                                onChanged();
                                            }}>삭제</button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                        </article>
                    ))}
                </div>
            )}

            {modal === 'note' && (
                <Modal title="학생 기록" onClose={() => setModal(null)}>
                    <StudentPick names={names} value={note.student} onChange={(student) => setNote({ ...note, student })} />
                    <Field label="날짜"><input type="date" className="field" value={note.date} onChange={(e) => setNote({ ...note, date: e.target.value })} /></Field>
                    <Field label="내용"><textarea className="field min-h-28" value={note.text} onChange={(e) => setNote({ ...note, text: e.target.value })} /></Field>
                    <button type="button" className="btn-primary w-full" onClick={saveNote}>저장</button>
                </Modal>
            )}
            {modal === 'roster' && (
                <Modal title="학급 명단" onClose={() => setModal(null)}>
                    <Field label="한 줄에 한 명" hint="출결·상담을 보낼 때 바로 고를 수 있습니다.">
                        <textarea className="field min-h-48" value={rosterText} onChange={(e) => setRosterText(e.target.value)} placeholder={'김민준\n이서연'} />
                    </Field>
                    <button type="button" className="btn-primary w-full" onClick={saveRoster}>명단 저장</button>
                </Modal>
            )}
        </section>
    );
}

function AttendDest({ attendance, roster, signedIn, author, onChanged, onToast }) {
    const names = roster.map((r) => r.name).filter(Boolean);
    const [month, setMonth] = useState(thisMonth());
    const [modal, setModal] = useState(false);
    const [form, setForm] = useState({ date: todayYmd(), student: '', status: '출석', note: '' });

    const byMonth = useMemo(() => {
        const groups = {};
        attendance.forEach((row) => {
            const key = String(row.date || '').slice(0, 7);
            if (!key) return;
            if (!groups[key]) groups[key] = [];
            groups[key].push(row);
        });
        Object.values(groups).forEach((list) => list.sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.student).localeCompare(String(b.student))));
        return groups;
    }, [attendance]);

    const rows = byMonth[month] || [];
    const counts = ATTEND_STATUS.reduce((acc, s) => {
        acc[s] = rows.filter((r) => r.status === s).length;
        return acc;
    }, {});
    const byDate = {};
    rows.forEach((r) => {
        if (!byDate[r.date]) byDate[r.date] = [];
        byDate[r.date].push(r);
    });

    return (
        <section className="space-y-3">
            <Header
                title="출결"
                hint="지각·결석만 남겨도 상담 때 바로 찾습니다."
                actions={<button type="button" className="btn-primary" onClick={() => setModal(true)}><Plus size={16} /> 출결</button>}
            />
            <label className="block max-w-[12rem]">
                <span className="text-sm font-extrabold">조회 월</span>
                <input type="month" className="field mt-1" value={month} onChange={(e) => setMonth(e.target.value)} />
            </label>
            {rows.length === 0 ? (
                <EmptyState title="이달 출결 기록이 없습니다" hint="쓱적 카드를 출결로 밀거나, 여기서 바로 남길 수 있습니다." />
            ) : (
                <article className="card p-4 bg-[#fffaf0]/85">
                    <h3 className="font-black text-lg">{monthLabel(month)}</h3>
                    <p className="text-sm text-stone-600 mt-1">{ATTEND_STATUS.map((s) => `${s} ${counts[s] || 0}`).join(' · ')}</p>
                    <div className="mt-3 space-y-3">
                        {Object.keys(byDate).sort().map((d) => (
                            <div key={d}>
                                <p className="text-xs font-black text-amber-900/80 mb-1">{d}</p>
                                <ul className="space-y-1">
                                    {byDate[d].map((a) => (
                                        <li key={a.id} className="flex justify-between gap-3 text-sm">
                                            <span><strong>{a.student}</strong> · {a.status}{a.note ? ` · ${a.note}` : ''}</span>
                                            <button type="button" className="text-rose-700 underline shrink-0 min-h-tap" onClick={async () => {
                                                await removeItem('teacherAttend', a.id, signedIn);
                                                onChanged();
                                            }}>삭제</button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ))}
                    </div>
                </article>
            )}
            <details className="text-sm">
                <summary className="font-extrabold cursor-pointer">다른 달 모아보기</summary>
                <div className="mt-2 space-y-2">
                    {Object.keys(byMonth).sort().reverse().filter((key) => key !== month).map((key) => {
                        const list = byMonth[key];
                        const abs = list.filter((r) => r.status === '결석').length;
                        const late = list.filter((r) => r.status === '지각').length;
                        return (
                            <button key={key} type="button" className="btn-secondary w-full justify-between" onClick={() => setMonth(key)}>
                                <span>{monthLabel(key)}</span>
                                <span className="text-xs font-bold">결석 {abs} · 지각 {late} · 총 {list.length}</span>
                            </button>
                        );
                    })}
                </div>
            </details>
            {modal && (
                <Modal title="출결 기록" onClose={() => setModal(false)}>
                    <Field label="날짜"><input type="date" className="field" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
                    <StudentPick names={names} value={form.student} onChange={(student) => setForm({ ...form, student })} />
                    <Field label="상태">
                        <select className="field" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                            {ATTEND_STATUS.map((s) => <option key={s}>{s}</option>)}
                        </select>
                    </Field>
                    <Field label="메모"><input className="field" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></Field>
                    <button type="button" className="btn-primary w-full" onClick={async () => {
                        if (!form.student.trim()) return onToast('학생 이름을 입력해 주세요.');
                        await ensureRosterName(form.student, roster, signedIn);
                        await addItem('teacherAttend', { ...form, student: form.student.trim(), author }, signedIn);
                        setMonth(form.date.slice(0, 7));
                        setModal(false);
                        setForm({ date: todayYmd(), student: '', status: '출석', note: '' });
                        onChanged();
                    }}>저장</button>
                </Modal>
            )}
        </section>
    );
}

function CounselDest({ counselNotes, roster, signedIn, author, onChanged, onToast }) {
    const names = roster.map((r) => r.name).filter(Boolean);
    const [filter, setFilter] = useState('all');
    const [modal, setModal] = useState(false);
    const [form, setForm] = useState({ student: '', text: '', date: todayYmd(), kind: '상담' });

    const items = counselNotes
        .filter((row) => filter === 'all' || row.kind === filter)
        .slice()
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    return (
        <section className="space-y-3">
            <Header
                title="상담·누가"
                hint="쓱적으로 날아온 상담과 누가기록을 모읍니다."
                actions={<button type="button" className="btn-primary" onClick={() => setModal(true)}><Plus size={16} /> 기록</button>}
            />
            <div className="flex gap-1" role="group" aria-label="상담 종류">
                {[['all', '전체'], ['상담', '상담'], ['누가', '누가']].map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        className={`min-h-tap px-3 rounded-xl font-extrabold border ${filter === id ? 'bg-amber-900 text-white border-amber-900' : 'bg-[#fffaf0] border-amber-900/20'}`}
                        onClick={() => setFilter(id)}
                    >
                        {label}
                    </button>
                ))}
            </div>
            {items.length === 0 ? (
                <EmptyState title="상담 기록이 없습니다" hint="받은함에서 카드를 상담으로 밀어 보세요." />
            ) : (
                <ul className="space-y-2">
                    {items.map((row) => (
                        <li key={row.id} className="card p-4 bg-[#fffaf0]/85">
                            <p className="text-xs font-bold text-stone-500">{row.date} · {row.student} · {row.kind || '상담'}</p>
                            <p className="font-black mt-1 whitespace-pre-wrap">{row.text}</p>
                            <button type="button" className="text-sm text-rose-700 underline mt-2 min-h-tap" onClick={async () => {
                                if (!confirm('이 기록을 삭제할까요?')) return;
                                await removeItem('counselNotes', row.id, signedIn);
                                onChanged();
                            }}>삭제</button>
                        </li>
                    ))}
                </ul>
            )}
            {modal && (
                <Modal title="상담·누가 기록" onClose={() => setModal(false)}>
                    <StudentPick names={names} value={form.student} onChange={(student) => setForm({ ...form, student })} />
                    <Field label="날짜"><input type="date" className="field" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
                    <Field label="종류">
                        <div className="flex gap-2">
                            {['상담', '누가'].map((k) => (
                                <button key={k} type="button" className={`btn flex-1 ${form.kind === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setForm({ ...form, kind: k })}>{k}</button>
                            ))}
                        </div>
                    </Field>
                    <Field label="내용"><textarea className="field min-h-28" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
                    <button type="button" className="btn-primary w-full" onClick={async () => {
                        if (!form.student.trim() || !form.text.trim()) return onToast('학생과 내용을 입력해 주세요.');
                        await ensureRosterName(form.student, roster, signedIn);
                        await addItem('counselNotes', { ...form, student: form.student.trim(), text: form.text.trim(), author }, signedIn);
                        setModal(false);
                        setForm({ student: '', text: '', date: todayYmd(), kind: '상담' });
                        onChanged();
                    }}>저장</button>
                </Modal>
            )}
        </section>
    );
}

function PlanDest({ plans, signedIn, author, onChanged, onToast }) {
    const today = todayYmd();
    const week = startOfWeekMon(today);
    const [modal, setModal] = useState(false);
    const [form, setForm] = useState({ text: '', date: today, kind: 'today' });

    const todayItems = plans.filter((p) => p.kind === 'today' && p.date === today);
    const weekItems = plans.filter((p) => p.kind === 'week' && (p.weekStart === week || p.date === today));
    const older = plans
        .filter((p) => !todayItems.includes(p) && !weekItems.includes(p))
        .slice()
        .sort((a, b) => String(b.date).localeCompare(String(a.date)));

    const removePlan = async (row) => {
        if (!confirm('이 기록을 삭제할까요?')) return;
        await removeItem('teacherPlans', row.id, signedIn);
        onChanged();
    };

    return (
        <section className="space-y-3">
            <Header
                title="오늘·주간"
                hint="오늘 할 일과 이번 주 계획을 한눈에 둡니다."
                actions={<button type="button" className="btn-primary" onClick={() => setModal(true)}><Plus size={16} /> 계획</button>}
            />
            <div className="grid gap-3 md:grid-cols-2">
                <PlanList title={`오늘 · ${today}`} items={todayItems} empty="오늘 계획이 없습니다." onRemove={removePlan} />
                <PlanList title={`이번 주 · ${week}`} items={weekItems} empty="이번 주 계획이 없습니다." onRemove={removePlan} />
            </div>
            {older.length > 0 && (
                <PlanList title="지난 기록" items={older} empty="" onRemove={removePlan} />
            )}
            {modal && (
                <Modal title="오늘·주간 계획" onClose={() => setModal(false)}>
                    <Field label="어디에 둘까요">
                        <div className="flex gap-2">
                            <button type="button" className={`btn flex-1 ${form.kind === 'today' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setForm({ ...form, kind: 'today' })}>오늘</button>
                            <button type="button" className={`btn flex-1 ${form.kind === 'week' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setForm({ ...form, kind: 'week' })}>이번 주</button>
                        </div>
                    </Field>
                    <Field label="날짜"><input type="date" className="field" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} /></Field>
                    <Field label="내용"><textarea className="field min-h-28" value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} /></Field>
                    <button type="button" className="btn-primary w-full" onClick={async () => {
                        if (!form.text.trim()) return onToast('내용을 적어 주세요.');
                        await addItem('teacherPlans', {
                            text: form.text.trim(),
                            date: form.date,
                            weekStart: startOfWeekMon(form.date),
                            kind: form.kind,
                            author,
                        }, signedIn);
                        setModal(false);
                        setForm({ text: '', date: todayYmd(), kind: 'today' });
                        onChanged();
                    }}>저장</button>
                </Modal>
            )}
        </section>
    );
}

function TaskDest({ todos, signedIn, author, onChanged, onToast }) {
    const [text, setText] = useState('');
    const [date, setDate] = useState(todayYmd());
    const items = todos.slice().sort((a, b) => Number(!!a.done) - Number(!!b.done) || String(b.date).localeCompare(String(a.date)));

    const addTodo = async () => {
        if (!text.trim()) {
            onToast('할 일을 적어 주세요.');
            return;
        }
        await addItem('teacherTodos', { text: text.trim(), done: false, date, author, source: 'ssugeok' }, signedIn);
        setText('');
        onChanged();
    };

    return (
        <section className="space-y-3">
            <Header title="업무" hint="쓱적에서 날아온 일과 바로 적은 할 일을 같이 둡니다." />
            <div className="card p-4 space-y-3 bg-[#fffaf0]/85">
                <div className="grid grid-cols-1 sm:grid-cols-[8rem_1fr_auto] gap-2">
                    <input type="date" className="field" value={date} onChange={(e) => setDate(e.target.value)} aria-label="할 일 날짜" />
                    <input className="field" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTodo()} placeholder="할 일 입력 후 Enter" />
                    <button type="button" className="btn-primary" onClick={addTodo}>추가</button>
                </div>
                {items.length === 0 ? <EmptyState title="할 일이 없습니다" hint="받은함에서 카드를 업무로 밀어 보세요." /> : (
                    <ul className="space-y-2">
                        {items.map((t) => (
                            <li key={t.id} className="flex items-center gap-3 min-h-tap">
                                <input
                                    type="checkbox"
                                    checked={!!t.done}
                                    onChange={async () => {
                                        await patchItem('teacherTodos', t.id, { done: !t.done }, signedIn);
                                        onChanged();
                                    }}
                                    aria-label={t.text}
                                />
                                <span className={`flex-1 ${t.done ? 'line-through text-stone-500' : ''}`}>
                                    <span className="text-xs font-bold text-stone-500 mr-2">{t.date}</span>
                                    {t.text}
                                </span>
                                <button type="button" className="text-stone-500 min-h-tap" aria-label="삭제" onClick={async () => {
                                    await removeItem('teacherTodos', t.id, signedIn);
                                    onChanged();
                                }}><Trash2 size={16} /></button>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </section>
    );
}

function Header({ title, hint, actions }) {
    return (
        <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
                <h2 className="font-black text-xl">{title}</h2>
                {hint && <p className="text-sm text-stone-600 mt-0.5">{hint}</p>}
            </div>
            {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
        </div>
    );
}

function PlanList({ title, items, empty, onRemove }) {
    return (
        <article className="card p-4 bg-[#fffaf0]/85">
            <h3 className="font-black">{title}</h3>
            {items.length === 0 ? (
                empty ? <p className="text-sm text-stone-500 mt-2">{empty}</p> : null
            ) : (
                <ul className="mt-2 space-y-2">
                    {items.map((row) => (
                        <li key={row.id} className="flex justify-between gap-3">
                            <span>
                                <span className="block text-xs font-bold text-stone-500">{row.date}{row.kind === 'week' ? ' · 이번 주' : ' · 오늘'}</span>
                                <span className="whitespace-pre-wrap font-bold">{row.text}</span>
                            </span>
                            <button type="button" className="text-rose-700 underline shrink-0 min-h-tap" onClick={() => onRemove(row)}>삭제</button>
                        </li>
                    ))}
                </ul>
            )}
        </article>
    );
}

function StudentPick({ names, value, onChange }) {
    return (
        <Field label="학생">
            {names.length > 0 ? (
                <select className="field" value={names.includes(value) ? value : ''} onChange={(e) => onChange(e.target.value)}>
                    <option value="">선택</option>
                    {names.map((n) => <option key={n}>{n}</option>)}
                </select>
            ) : null}
            <input
                className={`field ${names.length ? 'mt-2' : ''}`}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                placeholder={names.length ? '또는 새 이름' : '이름'}
            />
        </Field>
    );
}
