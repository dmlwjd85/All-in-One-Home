import { useEffect, useState } from 'react';
import { GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'firebase/auth';
import { PenLine } from 'lucide-react';
import { auth } from './firebase';
import { Toast } from './components/ui.jsx';
import { useSharedList } from './lib/store.js';
import { downloadText } from './lib/utils.js';
import NotebookApp from './notebook/NotebookApp.jsx';
import { SENSITIVE_KEY } from './notebook/ssugeokStore.js';

export default function App() {
    const [user, setUser] = useState(null);
    const [authReady, setAuthReady] = useState(false);
    const [guest, setGuest] = useState(() => localStorage.getItem('homenote_guest') === '1');
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
    const todos = useSharedList('teacherTodos', enabled, rev);
    const attendance = useSharedList('teacherAttend', enabled, rev);
    const roster = useSharedList('classRoster', enabled, rev);
    const inbox = useSharedList('ssugeokInbox', enabled, rev);
    const studentNotes = useSharedList('studentNotes', enabled, rev);
    const counselNotes = useSharedList('counselNotes', enabled, rev);
    const plans = useSharedList('teacherPlans', enabled, rev);
    // 예전 홈노트 자료는 화면에 두지 않고 내보내기에만 남깁니다.
    const ledger = useSharedList('ledgerTx', enabled, rev);
    const budgets = useSharedList('ledgerBudgets', enabled, rev);
    const lessons = useSharedList('teacherLessons', enabled, rev);
    const meets = useSharedList('teacherMeets', enabled, rev);
    const contacts = useSharedList('teacherContacts', enabled, rev);
    const timetableList = useSharedList('teacherTimetable', enabled, rev);
    const diaryAll = useSharedList('familyDiary', enabled, rev);

    const author = user?.displayName || user?.email?.split('@')[0] || '선생님';

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
    };

    const exportAll = () => {
        const payload = {
            exportedAt: new Date().toISOString(),
            inbox: inbox.items,
            studentNotes: studentNotes.items,
            counselNotes: counselNotes.items,
            plans: plans.items,
            todos: todos.items,
            attendance: attendance.items,
            roster: roster.items,
            ledger: ledger.items,
            budgets: budgets.items,
            lessons: lessons.items,
            meets: meets.items,
            contacts: contacts.items,
            timetable: timetableList.items,
            diary: diaryAll.items,
            ssugeokSensitive: (() => {
                try {
                    return JSON.parse(localStorage.getItem(SENSITIVE_KEY) || '[]');
                } catch {
                    return [];
                }
            })(),
            notebookFields: Object.fromEntries(
                Array.from({ length: 580 }, (_, i) => {
                    try {
                        const raw = localStorage.getItem(`homenote_v2_notebookFields_p${i + 1}`);
                        return raw ? [i + 1, JSON.parse(raw)] : null;
                    } catch {
                        return null;
                    }
                }).filter(Boolean)
            ),
        };
        downloadText(`교무수첩-백업-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2));
        notify('백업 파일을 내려받았습니다.');
    };

    if (!authReady) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-6">
                <p className="text-lg font-bold">교무수첩을 준비하는 중입니다…</p>
            </div>
        );
    }

    if (!signedIn && !guest) {
        return (
            <main className="min-h-[100dvh] flex items-center justify-center p-4">
                <div className="card max-w-md w-full p-7 text-center">
                    <div className="w-14 h-14 mx-auto rounded-2xl bg-ink-900 text-white flex items-center justify-center mb-5"><PenLine size={28} /></div>
                    <h1 className="text-3xl font-black">2026 교무수첩</h1>
                    <p className="mt-3 text-stone-600 leading-relaxed">
                        PDF 교무수첩과 같은 탭·링크로 움직이고, 칸은 마우스와 키보드로 채울 수 있습니다. 쓰 쪽에서는 쓱적 허브로 학생·출결·상담·주간·업무에 나눌 수 있습니다.
                    </p>
                    <button type="button" className="btn-primary w-full mt-6" onClick={loginGoogle}>Google 계정으로 로그인</button>
                    <button type="button" className="btn-secondary w-full mt-2" onClick={enterGuest}>이 기기에서만 사용</button>
                    <p className="mt-4 text-xs text-stone-500 leading-relaxed">
                        Google 로그인을 쓰면 여러 기기에 기록이 동기화됩니다. Firebase 콘솔에 배포 도메인(github.io)이 허용되어 있어야 합니다.
                    </p>
                </div>
                <Toast message={toast} />
            </main>
        );
    }

    return (
        <>
            <a href="#main" className="skip-link">본문으로 건너뛰기</a>
            <main id="main" tabIndex={-1}>
                <NotebookApp
                    user={user}
                    guest={guest}
                    author={author}
                    signedIn={signedIn}
                    onLogout={logout}
                    onExport={exportAll}
                    inbox={inbox.items}
                    studentNotes={studentNotes.items}
                    counselNotes={counselNotes.items}
                    plans={plans.items}
                    todos={todos.items}
                    attendance={attendance.items}
                    roster={roster.items}
                    onChanged={bump}
                    onToast={notify}
                />
            </main>
            <Toast message={toast} />
        </>
    );
}
