import { useMemo, useState } from 'react';
import {
    Briefcase,
    CalendarRange,
    ChevronLeft,
    ChevronRight,
    ClipboardCheck,
    MessageCircle,
    Users,
} from 'lucide-react';
import { EmptyState, Modal } from './ui.jsx';
import { holidayCaption, holidaysOn, LUNAR_YEAR_MAX, LUNAR_YEAR_MIN } from '../lib/holidays.js';
import {
    fromYmd,
    monthCells,
    monthLabel,
    shiftMonth,
    todayYmd,
    WEEKDAYS_FULL,
} from '../lib/utils.js';

const MARKS = {
    student: { id: 'student', label: '학생', Icon: Users, cls: 'text-indigo-800 bg-indigo-100' },
    attend: { id: 'attend', label: '출결', Icon: ClipboardCheck, cls: 'text-amber-900 bg-amber-100' },
    counsel: { id: 'counsel', label: '상담', Icon: MessageCircle, cls: 'text-rose-800 bg-rose-100' },
    plan: { id: 'plan', label: '주간', Icon: CalendarRange, cls: 'text-sky-800 bg-sky-100' },
    task: { id: 'task', label: '업무', Icon: Briefcase, cls: 'text-emerald-800 bg-emerald-100' },
};

export default function SsugeokCalendar({
    studentNotes,
    attendance,
    counselNotes,
    plans,
    todos,
    onView,
}) {
    const [cursor, setCursor] = useState(todayYmd());
    const [pick, setPick] = useState(null);
    const ym = cursor.slice(0, 7);

    const eventsByDate = useMemo(() => {
        const map = {};
        const push = (date, kind, item) => {
            if (!date) return;
            if (!map[date]) map[date] = [];
            map[date].push({ kind, item });
        };
        studentNotes.forEach((item) => push(item.date, 'student', item));
        attendance.forEach((item) => push(item.date, 'attend', item));
        counselNotes.forEach((item) => push(item.date, 'counsel', item));
        plans.forEach((item) => push(item.date, 'plan', item));
        todos.forEach((item) => push(item.date, 'task', item));
        return map;
    }, [studentNotes, attendance, counselNotes, plans, todos]);

    const kindsOn = (ymd) => Object.keys(MARKS)
        .map((kind) => {
            const items = (eventsByDate[ymd] || []).filter((e) => e.kind === kind);
            return items.length ? { kind, items } : null;
        })
        .filter(Boolean);

    const dateTone = (ymd, isHoliday) => {
        if (isHoliday || fromYmd(ymd).getDay() === 0) return 'text-rose-700';
        if (fromYmd(ymd).getDay() === 6) return 'text-sky-800';
        return '';
    };

    const cells = monthCells(ym);
    const picked = pick ? (eventsByDate[pick] || []) : [];

    return (
        <section className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-1">
                    <button type="button" className="btn-secondary px-3" aria-label="이전 달" onClick={() => setCursor(`${shiftMonth(ym, -1)}-01`)}><ChevronLeft size={18} /></button>
                    <h2 className="font-black text-lg min-w-[8rem] text-center">{monthLabel(ym)}</h2>
                    <button type="button" className="btn-secondary px-3" aria-label="다음 달" onClick={() => setCursor(`${shiftMonth(ym, 1)}-01`)}><ChevronRight size={18} /></button>
                    <button type="button" className="btn-secondary px-3" onClick={() => setCursor(todayYmd())}>오늘</button>
                </div>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] font-bold text-stone-600">
                {Object.values(MARKS).map((k) => (
                    <span key={k.id} className={`inline-flex items-center gap-1 px-2 py-1 rounded-full ${k.cls}`}><k.Icon size={12} /> {k.label}</span>
                ))}
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-rose-800 bg-rose-100">공휴일</span>
                <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-amber-900 bg-amber-100">기념일</span>
            </div>
            <p className="text-[11px] text-stone-500">설날·추석·부처님오신날은 {LUNAR_YEAR_MIN}–{LUNAR_YEAR_MAX}년 한국 음력 기준입니다. 달력은 보조 보기이고, 기록은 쓱적에서 날려보냅니다.</p>
            <div className="grid grid-cols-7 text-center text-[11px] font-extrabold text-amber-900/70 mb-1">
                {WEEKDAYS_FULL.map((d) => <div key={d} className={d === '일' ? 'text-rose-700' : d === '토' ? 'text-sky-800' : ''}>{d}</div>)}
            </div>
            <div className="grid grid-cols-7">
                {cells.map((c) => {
                    const isToday = c.ymd === todayYmd();
                    const cap = holidayCaption(c.ymd);
                    const isHoliday = !!cap?.isHoliday;
                    const isMemorial = !!cap?.isMemorial;
                    return (
                        <button
                            key={c.ymd}
                            type="button"
                            title={cap?.title || undefined}
                            className={`cal-cell text-left p-1 ${c.inMonth ? '' : 'opacity-40'} ${isToday ? 'ring-2 ring-amber-800/50' : ''} ${isHoliday && c.inMonth ? 'cal-cell-holiday' : ''} ${isMemorial && c.inMonth && !isHoliday ? 'cal-cell-memorial' : ''}`}
                            onClick={() => setPick(c.ymd)}
                        >
                            <span className={`text-xs font-black ${dateTone(c.ymd, isHoliday)}`}>{c.day}</span>
                            {cap && (
                                <span className={`block text-[9px] leading-tight font-extrabold truncate ${isHoliday ? 'text-rose-700' : 'text-amber-800/90'}`} title={cap.title}>
                                    {cap.primary.short}
                                </span>
                            )}
                            <div className="flex flex-wrap gap-0.5 mt-1">
                                {kindsOn(c.ymd).map(({ kind, items }) => {
                                    const meta = MARKS[kind];
                                    return (
                                        <span key={kind} className={`inline-flex items-center justify-center w-6 h-6 rounded-md ${meta.cls}`} title={`${meta.label} ${items.length}건`}>
                                            <meta.Icon size={13} aria-hidden="true" />
                                        </span>
                                    );
                                })}
                            </div>
                        </button>
                    );
                })}
            </div>

            {pick && (
                <Modal title={`${pick} 기록`} onClose={() => setPick(null)}>
                    {holidaysOn(pick).length > 0 && (
                        <p className="text-sm font-extrabold mb-2">
                            {holidaysOn(pick).map((h) => (
                                <span key={`${h.kind}-${h.id}-${h.name}`} className={h.kind === 'holiday' ? 'text-rose-700' : 'text-amber-800'}>
                                    {h.name}
                                    {' '}
                                </span>
                            ))}
                        </p>
                    )}
                    {picked.length === 0 ? (
                        <EmptyState title="이 날 기록이 없습니다" hint="쓱적에 먼저 적고 카드를 밀어 나누세요." />
                    ) : (
                        <ul className="space-y-2">
                            {picked.map((ev, i) => {
                                const meta = MARKS[ev.kind];
                                const item = ev.item;
                                return (
                                    <li key={`${ev.kind}-${item.id || i}`}>
                                        <button
                                            type="button"
                                            className="card w-full text-left p-3 flex items-start gap-3"
                                            onClick={() => { setPick(null); onView(ev.kind); }}
                                        >
                                            <span className={`w-9 h-9 rounded-xl flex items-center justify-center ${meta.cls}`}><meta.Icon size={18} /></span>
                                            <span>
                                                <span className="block text-xs font-bold text-stone-500">{meta.label}{item.student ? ` · ${item.student}` : ''}</span>
                                                <span className="font-black">{item.text || item.note || item.status}</span>
                                            </span>
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                    <button type="button" className="btn-primary w-full mt-3" onClick={() => { setPick(null); onView('inbox'); }}>
                        쓱적으로 가서 적기
                    </button>
                </Modal>
            )}
        </section>
    );
}
