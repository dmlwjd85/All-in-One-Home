import { useEffect, useMemo, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { BookOpen, Download, Heart, Home, LogOut, Wallet } from 'lucide-react';
import { auth } from './firebase';
import { Toast } from './components/ui.jsx';
import { useSharedList } from './lib/store.js';
import { downloadText } from './lib/utils.js';
import HomePage from './pages/Home.jsx';
import LedgerPage from './pages/Ledger.jsx';
import TeacherPage from './pages/Teacher.jsx';
import DiaryPage from './pages/Diary.jsx';

const NAV = [
    { id: 'home', label: '홈', icon: Home },
    { id: 'ledger', label: '가계부', icon: Wallet },
    { id: 'teacher', label: '교무일지', icon: BookOpen },
    { id: 'diary', label: '다이어리', icon: Heart },
];

export default function App() {
    const [user, setUser] = useState(null);
    const [authReady, setAuthReady] = useState(false);
    const [guest, setGuest] = useState(() => localStorage.getItem('homenote_guest') === '1');
    const [tab, setTab] = useState('home');
    const [toast, setToast] = useState('');
    const [rev, setRev] = useState(0);
    const signedIn = Boolean(user);

    useEffect(() => {
        let cancelled = false;
        const unsub = onAuthStateChanged(auth, (u) => {
            if (cancelled) return;
            setUser(u);
            setAuthReady(true);
            if (u) {
                setGuest(false);
                localStorage.removeItem('homenote_guest');
            }
        }, (err) => {
            console.error(err);
            if (!cancelled) setAuthReady(true);
        });
        const fallback = window.setTimeout(() => {
            if (!cancelled) setAuthReady(true);
        }, 2500);
        return () => {
            cancelled = true;
            window.clearTimeout(fallback);
            unsub();
        };
    }, []);

    const enabled = signedIn;
    const ledger = useSharedList('ledgerTx', enabled, rev);
    const budgets = useSharedList('ledgerBudgets', enabled, rev);
    const lessons = useSharedList('teacherLessons', enabled, rev);
    const todos = useSharedList('teacherTodos', enabled, rev);
    const meets = useSharedList('teacherMeets', enabled, rev);
    const contacts = useSharedList('teacherContacts', enabled, rev);
    const attendance = useSharedList('teacherAttend', enabled, rev);
    const roster = useSharedList('classRoster', enabled, rev);
    const timetableList = useSharedList('teacherTimetable', enabled, rev);
    const diaryAll = useSharedList('familyDiary', enabled, rev);

    const author = user?.displayName || user?.email?.split('@')[0] || '우리 가족';
    const timetable = useMemo(() => {
        const row = timetableList.items.find((d) => d.id === 'week') || timetableList.items[0] || {};
        const { id, createdAt, updatedAt, ...slots } = row;
        return slots;
    }, [timetableList.items]);

    const diary = useMemo(
        () => diaryAll.items.filter((e) => e.visibility !== 'private' || e.author === author),
        [diaryAll.items, author]
    );

    const notify = (msg) => {
        setToast(msg);
        window.clearTimeout(notify._t);
        notify._t = window.setTimeout(() => setToast(''), 2800);
    };

    const bump = () => setRev((n) => n + 1);

    const loginGoogle = async () => {
        try {
            const provider = new GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            await signInWithPopup(auth, provider);
        } catch (err) {
            console.error(err);
            notify('Google 로그인에 실패했습니다. 이 기기에서만 쓰기를 선택할 수 있습니다.');
        }
    };

    const enterGuest = () => {
        localStorage.setItem('homenote_guest', '1');
        setGuest(true);
    };

    const logout = async () => {
        localStorage.removeItem('homenote_guest');
        setGuest(false);
        if (user) await signOut(auth);
        setTab('home');
    };

    const exportAll = () => {
        const payload = {
            exportedAt: new Date().toISOString(),
            ledger: ledger.items,
            budgets: budgets.items,
            lessons: lessons.items,
            todos: todos.items,
            meets: meets.items,
            contacts: contacts.items,
            attendance: attendance.items,
            roster: roster.items,
            timetable,
            diary: diaryAll.items,
        };
        downloadText(`홈노트-백업-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
        notify('백업 파일을 내려받았습니다.');
    };

    if (!authReady) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-6">
                <p className="text-lg font-bold">홈노트를 준비하는 중입니다…</p>
            </div>
        );
    }

    if (!signedIn && !guest) {
        return (
            <main className="min-h-[100dvh] flex items-center justify-center p-4">
                <div className="card max-w-md w-full p-7 text-center">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-ink-900 text-white flex items-center justify-center mb-5"><Home size={28} /></div>
                    <h1 className="text-3xl font-black">우리집 홈노트</h1>
                    <p className="mt-3 text-stone-600 leading-relaxed">
                        가계부, 초등 교무일지, 가족다이어리를 큰 버튼과 검색 가능한 기록으로 오래 쓸 수 있게 만들었습니다.
                    </p>
                    <button type="button" className="btn-primary w-full mt-6" onClick={loginGoogle}>Google 계정으로 로그인</button>
                    <button type="button" className="btn-secondary w-full mt-2" onClick={enterGuest}>이 기기에서만 사용</button>
                    <p className="mt-4 text-xs text-stone-500 leading-relaxed">
                        Google 로그인을 쓰면 가족 기기에 기록이 동기화됩니다. Firebase 콘솔에 배포 도메인(github.io)이 허용되어 있어야 합니다.
                    </p>
                </div>
            </main>
        );
    }

    return (
        <div className="min-h-[100dvh] flex bg-ink-50">
            <a href="#main" className="skip-link">본문으로 건너뛰기</a>

            <nav aria-label="주요 메뉴" className="hidden md:flex w-64 shrink-0 flex-col border-r border-stone-200 bg-white">
                <div className="p-5">
                    <p className="text-xs font-extrabold tracking-widest text-stone-500">HOME NOTE</p>
                    <p className="text-xl font-black mt-1">우리집 홈노트</p>
                </div>
                <ul className="px-3 space-y-1 flex-1">
                    {NAV.map((item) => (
                        <li key={item.id}>
                            <button
                                type="button"
                                aria-current={tab === item.id ? 'page' : undefined}
                                className={`w-full min-h-tap rounded-2xl px-3 flex items-center gap-3 font-extrabold ${tab === item.id ? 'bg-ink-900 text-white' : 'hover:bg-stone-100'}`}
                                onClick={() => setTab(item.id)}
                            >
                                <item.icon size={20} aria-hidden="true" /> {item.label}
                            </button>
                        </li>
                    ))}
                </ul>
                <div className="p-4 border-t border-stone-200 space-y-2">
                    <button type="button" className="btn-secondary w-full" onClick={exportAll}><Download size={16} /> 데이터 내보내기</button>
                    <button type="button" className="btn-secondary w-full" onClick={logout}><LogOut size={16} /> {user ? '로그아웃' : '나가기'}</button>
                    <p className="text-xs text-stone-500 truncate">{author}{guest ? ' · 이 기기' : ''}</p>
                </div>
            </nav>

            <div className="flex-1 flex flex-col min-w-0">
                <header className="h-16 shrink-0 border-b border-stone-200 bg-white px-4 md:px-8 flex items-center justify-between">
                    <h1 className="text-xl md:text-2xl font-black">{NAV.find((n) => n.id === tab)?.label}</h1>
                    <button type="button" className="btn-secondary md:hidden" onClick={logout} aria-label="로그아웃"><LogOut size={18} /></button>
                </header>

                <main id="main" className="flex-1 overflow-y-auto p-4 md:p-8 pb-28 md:pb-10" tabIndex={-1}>
                    {tab === 'home' && (
                        <HomePage
                            author={author}
                            ledger={ledger.items}
                            lessons={lessons.items}
                            todos={todos.items}
                            diary={diary}
                            onGo={setTab}
                        />
                    )}
                    {tab === 'ledger' && (
                        <LedgerPage
                            items={ledger.items}
                            budgets={budgets.items}
                            signedIn={signedIn}
                            author={author}
                            onChanged={bump}
                            onToast={notify}
                        />
                    )}
                    {tab === 'teacher' && (
                        <TeacherPage
                            lessons={lessons.items}
                            todos={todos.items}
                            meets={meets.items}
                            contacts={contacts.items}
                            attendance={attendance.items}
                            roster={roster.items}
                            timetable={timetable}
                            signedIn={signedIn}
                            author={author}
                            onChanged={bump}
                            onToast={notify}
                        />
                    )}
                    {tab === 'diary' && (
                        <DiaryPage
                            entries={diary}
                            signedIn={signedIn}
                            author={author}
                            onChanged={bump}
                            onToast={notify}
                        />
                    )}
                </main>
            </div>

            <nav aria-label="모바일 주요 메뉴" className="md:hidden fixed bottom-0 inset-x-0 bg-white border-t border-stone-200 pb-[env(safe-area-inset-bottom)]">
                <ul className="grid grid-cols-4">
                    {NAV.map((item) => (
                        <li key={item.id}>
                            <button
                                type="button"
                                aria-current={tab === item.id ? 'page' : undefined}
                                className={`w-full min-h-12 py-2 flex flex-col items-center justify-center text-xs font-extrabold ${tab === item.id ? 'text-teal-800' : 'text-stone-500'}`}
                                onClick={() => setTab(item.id)}
                            >
                                <item.icon size={22} aria-hidden="true" />
                                {item.label}
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>

            <Toast message={toast} />
        </div>
    );
}
