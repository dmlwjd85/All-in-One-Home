import { useMemo, useState } from 'react';
import {
    BookOpen,
    CalendarDays,
    CheckSquare,
    ChevronLeft,
    ChevronRight,
    ClipboardCheck,
    FileText,
    LayoutGrid,
    Pencil,
    Phone,
    Plus,
    Table,
    Trash2,
} from 'lucide-react';
import { EmptyState, Field, Modal, SearchBox } from '../components/ui.jsx';
import { addItem, patchItem, removeItem, upsertDoc } from '../lib/store.js';
import {
    ATTEND_STATUS,
    CONTACT_TYPES,
    PERIODS,
    SUBJECTS,
    WEEKDAYS,
    WEEKDAYS_FULL,
    addDaysYmd,
    fromYmd,
    monthCells,
    monthLabel,
    shiftMonth,
    startOfWeekMon,
    thisMonth,
    todayYmd,
} from '../lib/utils.js';

const KINDS = {
    lesson: { id: 'lesson', tab: 'lesson', label: '수업일지', Icon: BookOpen, cls: 'text-indigo-800 bg-indigo-100' },
    todo: { id: 'todo', tab: 'todo', label: '할 일', Icon: CheckSquare, cls: 'text-emerald-800 bg-emerald-100' },
    meet: { id: 'meet', tab: 'meet', label: '회의록', Icon: FileText, cls: 'text-sky-800 bg-sky-100' },
    contact: { id: 'contact', tab: 'meet', label: '학부모 상담', Icon: Phone, cls: 'text-rose-800 bg-rose-100' },
    attend: { id: 'attend', tab: 'attend', label: '출결', Icon: ClipboardCheck, cls: 'text-amber-900 bg-amber-100' },
};

const TABS = [
    { id: 'home', label: '홈', Icon: LayoutGrid },
    { id: 'cal', label: '달력', Icon: CalendarDays },
    { id: 'lesson', label: '수업', Icon: BookOpen },
    { id: 'todo', label: '할 일', Icon: CheckSquare },
    { id: 'meet', label: '회의', Icon: FileText },
    { id: 'attend', label: '출결', Icon: ClipboardCheck },
    { id: 'time', label: '시간표', Icon: Table },
];

const emptyLesson = (date = todayYmd()) => ({ date, subject: '국어', period: 1, title: '', goal: '', activity: '', eval: '', note: '' });
const emptyMeet = (date = todayYmd()) => ({ id: null, date, title: '', content: '', actions: '' });
const emptyContact = (date = todayYmd()) => ({ date, student: '', type: '전화', summary: '', follow: '' });
const emptyAttend = (date = todayYmd()) => ({ date, student: '', status: '출석', note: '' });

const actionLines = (text) => String(text || '').split(/\n|·|;/).map((s) => s.trim()).filter(Boolean);

export default function TeacherPage({ lessons, todos, meets, contacts, attendance, roster, timetable, signedIn, author, onChanged, onToast }) {
    const [tab, setTab] = useState('home');
    const [q, setQ] = useState('');
    const [modal, setModal] = useState(null);
    const [detail, setDetail] = useState(null);
    const [pickDate, setPickDate] = useState(null);
    const [calView, setCalView] = useState('month');
    const [cursor, setCursor] = useState(todayYmd());
    const [lesson, setLesson] = useState(emptyLesson);
    const [todoText, setTodoText] = useState('');
    const [todoDate, setTodoDate] = useState(todayYmd());
    const [meet, setMeet] = useState(emptyMeet);
    const [contact, setContact] = useState(emptyContact);
    const [attend, setAttend] = useState(emptyAttend);
    const [rosterText, setRosterText] = useState(roster.map((r) => r.name).join('\n'));
    const [attendMonth, setAttendMonth] = useState(thisMonth());

    const names = roster.map((r) => r.name).filter(Boolean);
    const todayLessons = lessons.filter((l) => l.date === todayYmd()).sort((a, b) => (a.period || 0) - (b.period || 0));
    const openTodos = todos.filter((t) => !t.done);
    const ym = cursor.slice(0, 7);
    const year = Number(cursor.slice(0, 4));

    const eventsByDate = useMemo(() => {
        const map = {};
        const push = (date, kind, item) => {
            if (!date) return;
            if (!map[date]) map[date] = [];
            map[date].push({ kind, item });
        };
        lessons.forEach((item) => push(item.date, 'lesson', item));
        todos.forEach((item) => push(item.date, 'todo', item));
        meets.forEach((item) => push(item.date, 'meet', item));
        contacts.forEach((item) => push(item.date, 'contact', item));
        attendance.forEach((item) => push(item.date, 'attend', item));
        return map;
    }, [lessons, todos, meets, contacts, attendance]);

    const filteredLessons = useMemo(() => {
        const n = q.trim().toLowerCase();
        return lessons
            .filter((l) => !n || `${l.title} ${l.subject} ${l.goal} ${l.activity}`.toLowerCase().includes(n))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (a.period || 0) - (b.period || 0));
    }, [lessons, q]);

    const attendByMonth = useMemo(() => {
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

    const kindsOn = (ymd) => Object.keys(KINDS)
        .map((kind) => {
            const items = (eventsByDate[ymd] || []).filter((e) => e.kind === kind);
            return items.length ? { kind, items } : null;
        })
        .filter(Boolean);

    const startWork = (kind, date) => {
        const ymd = date || todayYmd();
        setCursor(ymd);
        setPickDate(null);
        if (kind === 'lesson') {
            setLesson(emptyLesson(ymd));
            setTab('lesson');
            setModal('lesson');
        } else if (kind === 'todo') {
            setTodoDate(ymd);
            setTab('todo');
        } else if (kind === 'meet') {
            setMeet(emptyMeet(ymd));
            setTab('meet');
            setModal('meet');
        } else if (kind === 'contact') {
            setContact(emptyContact(ymd));
            setTab('meet');
            setModal('contact');
        } else if (kind === 'attend') {
            setAttend(emptyAttend(ymd));
            setAttendMonth(ymd.slice(0, 7));
            setTab('attend');
            setModal('attend');
        }
    };

    const saveLesson = async () => {
        if (!lesson.title.trim()) {
            onToast('수업 제목을 입력해 주세요.');
            return;
        }
        await addItem('teacherLessons', { ...lesson, author }, signedIn);
        setModal(null);
        setLesson(emptyLesson(lesson.date));
        onChanged();
        onToast('수업일지를 저장했습니다.');
    };

    const addTodo = async () => {
        if (!todoText.trim()) return;
        await addItem('teacherTodos', { text: todoText.trim(), done: false, date: todoDate, author }, signedIn);
        setTodoText('');
        onChanged();
    };

    const saveMeet = async () => {
        if (!meet.title.trim()) {
            onToast('제목을 입력해 주세요.');
            return;
        }
        const payload = { date: meet.date, title: meet.title.trim(), content: meet.content, actions: meet.actions };
        try {
            const old = meet.id ? meets.find((m) => m.id === meet.id) : null;
            const oldLines = actionLines(old?.actions);
            if (meet.id) {
                await patchItem('teacherMeets', meet.id, payload, signedIn);
                onToast('회의록을 수정했습니다.');
            } else {
                await addItem('teacherMeets', { ...payload, author }, signedIn);
                onToast('회의록을 저장했습니다.');
            }
            const nextLines = actionLines(meet.actions);
            const fresh = meet.id ? nextLines.filter((line) => !oldLines.includes(line)) : nextLines;
            for (const text of fresh) {
                await addItem('teacherTodos', {
                    text,
                    done: false,
                    date: meet.date,
                    author,
                    source: 'meet',
                    meetTitle: payload.title,
                }, signedIn);
            }
            if (fresh.length) onToast(`${fresh.length}건의 후속 할 일을 할 일 탭에 넣었습니다.`);
            setModal(null);
            setMeet(emptyMeet(meet.date));
            onChanged();
        } catch (err) {
            console.error(err);
            onToast('회의록 저장에 실패했습니다.');
        }
    };

    const saveRoster = async () => {
        const lines = rosterText.split('\n').map((s) => s.trim()).filter(Boolean);
        for (const row of roster) await removeItem('classRoster', row.id, signedIn);
        for (const name of lines) await addItem('classRoster', { name }, signedIn);
        setModal(null);
        onChanged();
        onToast('학급 명단을 저장했습니다.');
    };

    const moveCal = (dir) => {
        if (calView === 'year') setCursor(`${year + dir}-01-01`);
        else if (calView === 'month') setCursor(`${shiftMonth(ym, dir)}-01`);
        else if (calView === 'week') setCursor(addDaysYmd(startOfWeekMon(cursor), dir * 7));
        else setCursor(addDaysYmd(cursor, dir));
    };

    const calTitle = calView === 'year'
        ? `${year}년`
        : calView === 'month'
            ? monthLabel(ym)
            : calView === 'week'
                ? `${startOfWeekMon(cursor)} ~ ${addDaysYmd(startOfWeekMon(cursor), 6)}`
                : cursor;

    const renderIcons = (ymd, compact = false) => (
        <div className={`flex flex-wrap ${compact ? 'gap-0.5' : 'gap-1'} mt-1`}>
            {kindsOn(ymd).map(({ kind, items }) => {
                const meta = KINDS[kind];
                const Icon = meta.Icon;
                return (
                    <button
                        key={kind}
                        type="button"
                        className={`inline-flex items-center justify-center rounded-md ${meta.cls} ${compact ? 'w-6 h-6' : 'w-7 h-7'}`}
                        aria-label={`${ymd} ${meta.label} ${items.length}건`}
                        title={`${meta.label} ${items.length}건`}
                        onClick={(e) => {
                            e.stopPropagation();
                            if (items.length === 1) setDetail({ kind, item: items[0].item });
                            else setDetail({ kind, list: items.map((x) => x.item), date: ymd });
                        }}
                    >
                        <Icon size={compact ? 13 : 15} aria-hidden="true" />
                    </button>
                );
            })}
        </div>
    );

    const monthGrid = (targetYm, mini = false) => {
        const cells = monthCells(targetYm);
        return (
            <div className={mini ? '' : ''}>
                <div className="grid grid-cols-7 text-center text-[11px] font-extrabold text-amber-900/70 mb-1">
                    {WEEKDAYS_FULL.map((d) => <div key={d} className={d === '일' ? 'text-rose-700' : d === '토' ? 'text-sky-800' : ''}>{d}</div>)}
                </div>
                <div className="grid grid-cols-7">
                    {cells.map((c) => {
                        const isToday = c.ymd === todayYmd();
                        return (
                            <button
                                key={c.ymd}
                                type="button"
                                className={`cal-cell text-left p-1 ${mini ? 'min-h-[2.4rem]' : ''} ${c.inMonth ? '' : 'opacity-40'} ${isToday ? 'ring-2 ring-amber-800/50' : ''}`}
                                onClick={() => {
                                    if (mini) {
                                        setCursor(c.ymd);
                                        setCalView('month');
                                        return;
                                    }
                                    setPickDate(c.ymd);
                                }}
                            >
                                <span className={`text-xs font-black ${c.ymd.slice(-2) && fromYmd(c.ymd).getDay() === 0 ? 'text-rose-700' : ''}`}>{c.day}</span>
                                {!mini && renderIcons(c.ymd, true)}
                                {mini && kindsOn(c.ymd).length > 0 && <span className="block w-1.5 h-1.5 rounded-full bg-amber-800 mt-0.5 mx-auto" />}
                            </button>
                        );
                    })}
                </div>
            </div>
        );
    };

    const weekStart = startOfWeekMon(cursor);
    const weekDays = Array.from({ length: 7 }, (_, i) => addDaysYmd(weekStart, i));
    const dayEvents = eventsByDate[cursor] || [];

    const DetailBody = ({ kind, item }) => {
        if (!item) return null;
        if (kind === 'lesson') {
            return (
                <>
                    <p className="text-sm text-stone-600">{item.date} · {item.period}교시 {item.subject}</p>
                    <h3 className="font-black text-lg mt-1">{item.title}</h3>
                    {item.goal && <p className="mt-2"><strong>목표</strong> {item.goal}</p>}
                    {item.activity && <p className="mt-2 whitespace-pre-wrap">{item.activity}</p>}
                    {item.eval && <p className="mt-2"><strong>평가</strong> {item.eval}</p>}
                </>
            );
        }
        if (kind === 'todo') {
            return (
                <>
                    <p className="text-sm text-stone-600">{item.date}{item.meetTitle ? ` · 회의: ${item.meetTitle}` : ''}</p>
                    <p className={`font-black text-lg mt-1 ${item.done ? 'line-through' : ''}`}>{item.text}</p>
                </>
            );
        }
        if (kind === 'meet') {
            return (
                <>
                    <p className="text-sm text-stone-600">{item.date}</p>
                    <h3 className="font-black text-lg mt-1">{item.title}</h3>
                    <p className="mt-2 whitespace-pre-wrap">{item.content}</p>
                    {item.actions && <p className="mt-2 bg-emerald-50 rounded-xl p-2"><CheckSquare size={14} className="inline" /> {item.actions}</p>}
                    <div className="flex gap-2 mt-4">
                        <button type="button" className="btn-secondary flex-1" onClick={() => { setMeet({ id: item.id, date: item.date, title: item.title || '', content: item.content || '', actions: item.actions || '' }); setDetail(null); setTab('meet'); setModal('meet'); }}><Pencil size={16} /> 수정</button>
                        <button type="button" className="btn-danger flex-1" onClick={async () => {
                            if (!confirm('이 회의록을 삭제할까요?')) return;
                            await removeItem('teacherMeets', item.id, signedIn);
                            setDetail(null);
                            onChanged();
                        }}><Trash2 size={16} /> 삭제</button>
                    </div>
                </>
            );
        }
        if (kind === 'contact') {
            return (
                <>
                    <p className="text-sm text-stone-600">{item.date} · {item.type}</p>
                    <h3 className="font-black text-lg mt-1">{item.student}</h3>
                    <p className="mt-2 whitespace-pre-wrap">{item.summary}</p>
                    {item.follow && <p className="mt-2">후속: {item.follow}</p>}
                </>
            );
        }
        return (
            <>
                <p className="text-sm text-stone-600">{item.date}</p>
                <h3 className="font-black text-lg mt-1">{item.student} · {item.status}</h3>
                {item.note && <p className="mt-2">{item.note}</p>}
            </>
        );
    };

    return (
        <div className="notebook-shell notebook-page space-y-4">
            <section className="pr-2">
                <p className="text-sm font-bold text-amber-900/70">초등 교무일지</p>
                <h2 className="text-2xl md:text-3xl font-black mt-1 text-ink-900">수업·상담·출결을 한 권에</h2>
                <p className="mt-1 text-stone-700">오늘 수업 {todayLessons.length}건 · 남은 할 일 {openTodos.length}건</p>
            </section>

            <div role="tablist" aria-label="교무일지 메뉴" className="flex gap-1 overflow-x-auto pb-1">
                {TABS.map((t) => (
                    <button
                        key={t.id}
                        type="button"
                        role="tab"
                        aria-selected={tab === t.id}
                        aria-label={t.label}
                        title={t.label}
                        className={`icon-tab shrink-0 ${tab === t.id ? 'bg-amber-900 text-white border-amber-900' : 'bg-[#fffaf0] border-amber-900/20 text-ink-800'}`}
                        onClick={() => setTab(t.id)}
                    >
                        <t.Icon size={20} aria-hidden="true" />
                        <span>{t.label}</span>
                    </button>
                ))}
            </div>

            {tab === 'home' && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {TABS.filter((t) => t.id !== 'home').map((t) => (
                        <button key={t.id} type="button" className="hub-tile" onClick={() => setTab(t.id)}>
                            <span className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-900 flex items-center justify-center border border-amber-900/20">
                                <t.Icon size={24} aria-hidden="true" />
                            </span>
                            {t.label}
                        </button>
                    ))}
                </div>
            )}

            {tab === 'cal' && (
                <div className="space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-1">
                            <button type="button" className="btn-secondary px-3" aria-label="이전" onClick={() => moveCal(-1)}><ChevronLeft size={18} /></button>
                            <h3 className="font-black text-lg min-w-[9rem] text-center">{calTitle}</h3>
                            <button type="button" className="btn-secondary px-3" aria-label="다음" onClick={() => moveCal(1)}><ChevronRight size={18} /></button>
                            <button type="button" className="btn-secondary px-3" onClick={() => { setCursor(todayYmd()); }}>오늘</button>
                        </div>
                        <div className="flex gap-1" role="group" aria-label="달력 단위">
                            {[['year', '년'], ['month', '월'], ['week', '주'], ['day', '일']].map(([id, label]) => (
                                <button key={id} type="button" className={`min-h-tap px-3 rounded-xl font-extrabold border ${calView === id ? 'bg-amber-900 text-white border-amber-900' : 'bg-[#fffaf0] border-amber-900/20'}`} onClick={() => setCalView(id)}>{label}</button>
                            ))}
                        </div>
                    </div>
                    <div className="flex flex-wrap gap-2 text-[11px] font-bold text-stone-600">
                        {Object.values(KINDS).map((k) => (
                            <span key={k.id} className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${k.cls}`}><k.Icon size={12} /> {k.label}</span>
                        ))}
                    </div>
                    {calView === 'year' && (
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                            {Array.from({ length: 12 }, (_, i) => {
                                const m = `${year}-${String(i + 1).padStart(2, '0')}`;
                                return (
                                    <div key={m} className="rounded-xl border border-amber-900/20 p-2 bg-[#fffaf0]/70">
                                        <p className="font-black text-sm mb-1">{i + 1}월</p>
                                        {monthGrid(m, true)}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                    {calView === 'month' && monthGrid(ym, false)}
                    {calView === 'week' && (
                        <div className="grid grid-cols-1 sm:grid-cols-7 gap-2">
                            {weekDays.map((ymd) => (
                                <button key={ymd} type="button" className={`cal-cell p-2 text-left ${ymd === todayYmd() ? 'ring-2 ring-amber-800/50' : ''}`} onClick={() => setPickDate(ymd)}>
                                    <p className="text-xs font-black">{WEEKDAYS_FULL[(fromYmd(ymd).getDay() + 6) % 7]} {ymd.slice(8)}</p>
                                    {renderIcons(ymd)}
                                </button>
                            ))}
                        </div>
                    )}
                    {calView === 'day' && (
                        <div className="space-y-2">
                            <button type="button" className="btn-primary" onClick={() => setPickDate(cursor)}><Plus size={16} /> 이 날짜에 기록 추가</button>
                            {dayEvents.length === 0 ? <EmptyState title="이 날 기록이 없습니다" hint="날짜칸을 누르면 할 일·회의록·출결 등을 바로 적을 수 있습니다." /> : (
                                <ul className="space-y-2">
                                    {dayEvents.map((ev, i) => {
                                        const meta = KINDS[ev.kind];
                                        return (
                                            <li key={`${ev.kind}-${ev.item.id || i}`}>
                                                <button type="button" className="card w-full text-left p-3 flex items-start gap-3" onClick={() => setDetail({ kind: ev.kind, item: ev.item })}>
                                                    <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${meta.cls}`}><meta.Icon size={18} /></span>
                                                    <span>
                                                        <span className="block text-xs font-bold text-stone-500">{meta.label}</span>
                                                        <span className="font-black">{ev.item.title || ev.item.text || ev.item.student || ev.item.status}</span>
                                                    </span>
                                                </button>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                        </div>
                    )}
                </div>
            )}

            {tab === 'lesson' && (
                <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row gap-2">
                        <div className="flex-1"><SearchBox value={q} onChange={setQ} placeholder="과목·제목·활동 검색" /></div>
                        <button type="button" className="btn-primary" onClick={() => { setLesson(emptyLesson(cursor)); setModal('lesson'); }}><Plus size={18} /> 수업일지</button>
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
                <div className="card p-5 space-y-3 bg-[#fffaf0]/80">
                    <div className="grid grid-cols-1 sm:grid-cols-[8rem_1fr_auto] gap-2">
                        <input type="date" className="field" value={todoDate} onChange={(e) => setTodoDate(e.target.value)} aria-label="할 일 날짜" />
                        <input className="field" value={todoText} onChange={(e) => setTodoText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTodo()} placeholder="할 일 입력 후 Enter" />
                        <button type="button" className="btn-primary" onClick={addTodo}>추가</button>
                    </div>
                    {todos.length === 0 && <EmptyState title="할 일이 없습니다" />}
                    <ul className="space-y-2">
                        {todos.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((t) => (
                            <li key={t.id} className="flex items-center gap-3 min-h-tap">
                                <input type="checkbox" checked={!!t.done} onChange={async () => {
                                    await patchItem('teacherTodos', t.id, { done: !t.done }, signedIn);
                                    onChanged();
                                }} aria-label={t.text} />
                                <span className={`flex-1 ${t.done ? 'line-through text-stone-500' : ''}`}>
                                    <span className="text-xs font-bold text-stone-500 mr-2">{t.date}</span>
                                    {t.text}
                                    {t.meetTitle && <span className="ml-1 text-xs text-sky-800">({t.meetTitle})</span>}
                                </span>
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
                        <button type="button" className="btn-primary flex-1" onClick={() => { setMeet(emptyMeet(cursor)); setModal('meet'); }}>회의록</button>
                        <button type="button" className="btn-secondary flex-1" onClick={() => { setContact(emptyContact(cursor)); setModal('contact'); }}>학부모 상담</button>
                    </div>
                    <section>
                        <h3 className="font-black mb-2">회의록</h3>
                        {meets.length === 0 && <p className="text-stone-600 mb-3">아직 회의록이 없습니다.</p>}
                        <ul className="space-y-2">
                            {meets.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((m) => (
                                <li key={m.id} className="card p-4 bg-[#fffaf0]/80">
                                    <p className="text-sm text-stone-600">{m.date}</p>
                                    <p className="font-black">{m.title}</p>
                                    <p className="text-sm whitespace-pre-wrap mt-1">{m.content}</p>
                                    {m.actions && <p className="text-sm mt-2 bg-emerald-50 rounded-xl p-2"><CheckSquare size={14} className="inline" /> {m.actions}</p>}
                                    <div className="flex gap-3 mt-2">
                                        <button type="button" className="text-sm text-stone-700 underline" onClick={() => { setMeet({ id: m.id, date: m.date, title: m.title || '', content: m.content || '', actions: m.actions || '' }); setModal('meet'); }}><Pencil size={14} className="inline" /> 수정</button>
                                        <button type="button" className="text-sm text-rose-700 underline" onClick={async () => {
                                            if (!confirm('이 회의록을 삭제할까요?')) return;
                                            await removeItem('teacherMeets', m.id, signedIn);
                                            onChanged();
                                        }}><Trash2 size={14} className="inline" /> 삭제</button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                    <section>
                        <h3 className="font-black mb-2">학부모 상담 기록</h3>
                        <ul className="space-y-2">
                            {contacts.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).map((c) => (
                                <li key={c.id} className="card p-4 bg-[#fffaf0]/80">
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
                    <div className="flex flex-col sm:flex-row gap-2">
                        <button type="button" className="btn-primary flex-1" onClick={() => { setAttend(emptyAttend(cursor)); setModal('attend'); }}>출결 기록</button>
                        <button type="button" className="btn-secondary flex-1" onClick={() => { setRosterText(names.join('\n')); setModal('roster'); }}>학급 명단</button>
                    </div>
                    <label className="block max-w-[12rem]">
                        <span className="text-sm font-extrabold">조회 월</span>
                        <input type="month" className="field mt-1" value={attendMonth} onChange={(e) => setAttendMonth(e.target.value)} />
                    </label>
                    {!(attendByMonth[attendMonth] || []).length ? (
                        <EmptyState title="이달 출결 기록이 없습니다" hint="지각·결석만 남겨도 상담 때 바로 찾을 수 있습니다." />
                    ) : (
                        Object.keys(attendByMonth).sort().reverse().filter((key) => key === attendMonth || attendMonth === '').map((key) => {
                            const rows = attendByMonth[key] || [];
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
                                <section key={key} className="card p-4 bg-[#fffaf0]/80">
                                    <h3 className="font-black text-lg">{monthLabel(key)}</h3>
                                    <p className="text-sm text-stone-600 mt-1">
                                        {ATTEND_STATUS.map((s) => `${s} ${counts[s] || 0}`).join(' · ')}
                                    </p>
                                    <div className="mt-3 space-y-3">
                                        {Object.keys(byDate).sort().map((d) => (
                                            <div key={d}>
                                                <p className="text-xs font-black text-amber-900/80 mb-1">{d}</p>
                                                <ul className="space-y-1">
                                                    {byDate[d].map((a) => (
                                                        <li key={a.id} className="flex justify-between gap-3 text-sm">
                                                            <span><strong>{a.student}</strong> · {a.status}{a.note ? ` · ${a.note}` : ''}</span>
                                                            <button type="button" className="text-rose-700 underline shrink-0" onClick={async () => {
                                                                await removeItem('teacherAttend', a.id, signedIn);
                                                                onChanged();
                                                            }}>삭제</button>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            );
                        })
                    )}
                    <details className="text-sm">
                        <summary className="font-extrabold cursor-pointer">다른 달 모아보기</summary>
                        <div className="mt-2 space-y-2">
                            {Object.keys(attendByMonth).sort().reverse().filter((key) => key !== attendMonth).map((key) => {
                                const rows = attendByMonth[key];
                                const abs = rows.filter((r) => r.status === '결석').length;
                                const late = rows.filter((r) => r.status === '지각').length;
                                return (
                                    <button key={key} type="button" className="btn-secondary w-full justify-between" onClick={() => setAttendMonth(key)}>
                                        <span>{monthLabel(key)}</span>
                                        <span className="text-xs font-bold">결석 {abs} · 지각 {late} · 총 {rows.length}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </details>
                </div>
            )}

            {tab === 'time' && (
                <div className="card p-4 overflow-x-auto bg-[#fffaf0]/80">
                    <p className="text-sm text-stone-600 mb-3">칸을 누르면 과목을 바꿀 수 있습니다. 빈칸은 공란으로 둡니다.</p>
                    <table className="w-full min-w-[520px] text-center border-collapse">
                        <caption className="sr-only">주간 시간표</caption>
                        <thead>
                            <tr>
                                <th className="p-2 border bg-amber-100/80">교시</th>
                                {WEEKDAYS.map((d) => <th key={d} className="p-2 border bg-amber-100/80">{d}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {PERIODS.map((p) => (
                                <tr key={p}>
                                    <th className="p-2 border bg-amber-50">{p}</th>
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

            {pickDate && (
                <Modal title={`${pickDate} 기록하기`} onClose={() => setPickDate(null)}>
                    <p className="text-sm text-stone-600 mb-3">이 날짜에 남길 업무를 고르면 해당 탭으로 이동합니다.</p>
                    <div className="grid grid-cols-2 gap-2">
                        {Object.values(KINDS).map((k) => (
                            <button key={k.id} type="button" className="hub-tile min-h-[5.2rem]" onClick={() => startWork(k.id, pickDate)}>
                                <span className={`w-10 h-10 rounded-xl flex items-center justify-center ${k.cls}`}><k.Icon size={20} /></span>
                                {k.label}
                            </button>
                        ))}
                    </div>
                    {kindsOn(pickDate).length > 0 && (
                        <div className="mt-4">
                            <p className="text-sm font-black mb-2">이미 있는 기록</p>
                            {renderIcons(pickDate)}
                        </div>
                    )}
                </Modal>
            )}

            {detail && (
                <Modal title={KINDS[detail.kind]?.label || '상세'} onClose={() => setDetail(null)} wide>
                    {detail.list ? (
                        <ul className="space-y-2">
                            {detail.list.map((item) => (
                                <li key={item.id}>
                                    <button type="button" className="card w-full text-left p-3" onClick={() => setDetail({ kind: detail.kind, item })}>
                                        {item.title || item.text || `${item.student || ''} ${item.status || ''}`}
                                    </button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <DetailBody kind={detail.kind} item={detail.item} />
                    )}
                </Modal>
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
                <Modal title={meet.id ? '회의록 수정' : '회의록'} onClose={() => { setModal(null); setMeet(emptyMeet()); }} wide>
                    <Field label="날짜"><input type="date" className="field" value={meet.date} onChange={(e) => setMeet({ ...meet, date: e.target.value })} /></Field>
                    <Field label="제목"><input className="field" value={meet.title} onChange={(e) => setMeet({ ...meet, title: e.target.value })} placeholder="학년 협의회" /></Field>
                    <Field label="내용"><textarea className="field min-h-32" value={meet.content} onChange={(e) => setMeet({ ...meet, content: e.target.value })} /></Field>
                    <Field label="후속 할 일" hint="줄바꿈하면 각각 할 일 탭에 추가됩니다. 이미 넣은 줄은 다시 넣지 않습니다.">
                        <textarea className="field min-h-24" value={meet.actions} onChange={(e) => setMeet({ ...meet, actions: e.target.value })} placeholder={'가정통신문 발송\n학습자료 공유'} />
                    </Field>
                    <button type="button" className="btn-primary w-full" onClick={saveMeet}>{meet.id ? '수정 저장' : '저장'}</button>
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
                        setContact(emptyContact());
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
                        setAttendMonth(attend.date.slice(0, 7));
                        setModal(null);
                        setAttend(emptyAttend(attend.date));
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
