import {
    Briefcase,
    CalendarDays,
    CalendarRange,
    ClipboardCheck,
    MessageCircle,
    PenLine,
    Users,
} from 'lucide-react';
import SsugeokInbox from '../components/SsugeokInbox.jsx';
import SsugeokDestinations from '../components/SsugeokDestinations.jsx';
import SsugeokCalendar from '../components/SsugeokCalendar.jsx';
import { SSUGEOK_VIEWS } from '../lib/ssugeok.js';

const ICONS = {
    inbox: PenLine,
    student: Users,
    attend: ClipboardCheck,
    counsel: MessageCircle,
    plan: CalendarRange,
    task: Briefcase,
    cal: CalendarDays,
};

export default function SsugeokDiary({
    view,
    onView,
    inbox,
    studentNotes,
    counselNotes,
    plans,
    todos,
    attendance,
    roster,
    signedIn,
    author,
    onChanged,
    onToast,
}) {
    const pending = inbox.filter((row) => row.text).length;
    const openTodos = todos.filter((t) => !t.done).length;

    return (
        <div className="notebook-shell notebook-page space-y-4">
            <section>
                <p className="text-sm font-bold text-amber-900/70">교사 쓱적 다이어리</p>
                <h2 className="text-2xl md:text-3xl font-black mt-1 text-ink-900">쏟아 넣고, 밀어 나누기</h2>
                <p className="mt-1 text-stone-700">쓱적 {pending}건 · 남은 업무 {openTodos}건 · 학생 {roster.length}명</p>
            </section>

            <div role="tablist" aria-label="쓱적 다이어리 메뉴" className="flex gap-1 overflow-x-auto pb-1">
                {SSUGEOK_VIEWS.map((t) => {
                    const Icon = ICONS[t.id];
                    return (
                        <button
                            key={t.id}
                            type="button"
                            role="tab"
                            aria-selected={view === t.id}
                            aria-label={t.label}
                            title={t.label}
                            className={`icon-tab shrink-0 ${view === t.id ? 'bg-amber-900 text-white border-amber-900' : 'bg-[#fffaf0] border-amber-900/20 text-ink-800'}`}
                            onClick={() => onView(t.id)}
                        >
                            <Icon size={20} aria-hidden="true" />
                            <span>{t.short}</span>
                        </button>
                    );
                })}
            </div>

            {view === 'inbox' && (
                <SsugeokInbox
                    inbox={inbox}
                    roster={roster}
                    signedIn={signedIn}
                    author={author}
                    onChanged={onChanged}
                    onToast={onToast}
                    onView={onView}
                />
            )}

            {view !== 'inbox' && view !== 'cal' && (
                <SsugeokDestinations
                    view={view}
                    studentNotes={studentNotes}
                    counselNotes={counselNotes}
                    plans={plans}
                    todos={todos}
                    attendance={attendance}
                    roster={roster}
                    signedIn={signedIn}
                    author={author}
                    onChanged={onChanged}
                    onToast={onToast}
                />
            )}

            {view === 'cal' && (
                <SsugeokCalendar
                    studentNotes={studentNotes}
                    attendance={attendance}
                    counselNotes={counselNotes}
                    plans={plans}
                    todos={todos}
                    onView={onView}
                />
            )}
        </div>
    );
}
