import { BookOpen, Heart, Home, Wallet } from 'lucide-react';
import { formatWon, thisMonth, todayYmd } from '../lib/utils.js';

export default function HomePage({ author, ledger, lessons, todos, diary, onGo }) {
    const month = thisMonth();
    const monthTx = ledger.filter((r) => String(r.date || '').startsWith(month));
    const income = monthTx.filter((r) => r.type === 'income').reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const expense = monthTx.filter((r) => r.type !== 'income').reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const todayLessons = lessons.filter((l) => l.date === todayYmd());
    const openTodos = todos.filter((t) => !t.done);
    const recentDiary = diary.slice().sort((a, b) => String(b.date).localeCompare(String(a.date)))[0];

    const cards = [
        {
            id: 'ledger',
            icon: Wallet,
            title: '가계부',
            desc: `수입 ${formatWon(income)} · 지출 ${formatWon(expense)}`,
            tone: 'from-teal-50 to-white',
        },
        {
            id: 'teacher',
            icon: BookOpen,
            title: '교무일지',
            desc: `오늘 수업 ${todayLessons.length} · 할 일 ${openTodos.length}`,
            tone: 'from-indigo-50 to-white',
        },
        {
            id: 'diary',
            icon: Heart,
            title: '가족다이어리',
            desc: recentDiary ? `${recentDiary.date} · ${recentDiary.title}` : '첫 기록을 남겨 보세요',
            tone: 'from-rose-50 to-white',
        },
    ];

    return (
        <div className="space-y-5">
            <section className="bg-ink-900 text-white rounded-3xl p-6 md:p-8">
                <p className="text-sm font-bold text-stone-300">우리집 홈노트</p>
                <h1 className="text-3xl font-black mt-1">안녕하세요, {author}님</h1>
                <p className="mt-3 text-stone-200 max-w-xl">가계부, 초등 교무일지, 가족 기록을 큰 글씨와 짧은 동선으로 모아 두었습니다. 아래 카드를 누르면 바로 이동합니다.</p>
            </section>

            <section aria-labelledby="menu-heading">
                <h2 id="menu-heading" className="font-black text-lg mb-3">바로가기</h2>
                <div className="grid gap-3">
                    {cards.map((c) => (
                        <button key={c.id} type="button" onClick={() => onGo(c.id)} className={`card p-5 text-left bg-gradient-to-br ${c.tone} min-h-[5.5rem]`}>
                            <div className="flex items-center gap-4">
                                <span className="w-12 h-12 rounded-2xl bg-white border border-stone-200 flex items-center justify-center text-ink-800"><c.icon size={22} aria-hidden="true" /></span>
                                <span>
                                    <span className="block text-xl font-black">{c.title}</span>
                                    <span className="block text-stone-600 mt-0.5">{c.desc}</span>
                                </span>
                            </div>
                        </button>
                    ))}
                </div>
            </section>

            <section className="card p-5">
                <h2 className="font-black text-lg mb-2 flex items-center gap-2"><Home size={18} /> 오늘 할 일 요약</h2>
                <ul className="list-disc pl-5 space-y-1 text-stone-700">
                    <li>가계부는 금액만 넣어도 월 요약이 바로 바뀝니다.</li>
                    <li>수업일지는 차시·목표·평가를 남겨 두면 다음 학년에도 검색할 수 있습니다.</li>
                    <li>가족 기록은 사진과 한 줄만으로도 타임라인에 쌓입니다.</li>
                </ul>
            </section>
        </div>
    );
}
