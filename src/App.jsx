import { useEffect, useState } from 'react';
import { loadFirebase } from './firebase.js';
import { Modal, Toast } from './components/ui.jsx';
import { applyBackupLocal, BACKUP_LABELS, buildExportPayload, validateBackup } from './lib/backup.js';
import { reportSaveFailure } from './lib/saveNotice.js';
import { pushBackupCloud, useSharedList, useSharedRecord } from './lib/store.js';
import { downloadText, seoulYmd } from './lib/utils.js';
import NotebookApp from './notebook/NotebookApp.jsx';

export default function App() {
    const [user, setUser] = useState(null);
    const [authReady, setAuthReady] = useState(false);
    const [guest, setGuest] = useState(() => localStorage.getItem('homenote_guest') === '1');
    const [toast, setToast] = useState(null);
    const [rev, setRev] = useState(0);
    const [importPreview, setImportPreview] = useState(null);
    const [importing, setImporting] = useState(false);
    const signedIn = Boolean(user);

    useEffect(() => {
        const onFail = (event) => {
            const detail = event.detail || {};
            setToast({
                message: detail.message || '저장하지 못했습니다. 다시 시도해 주세요.',
                actionLabel: detail.retry ? '다시 시도' : '',
                onAction: detail.retry || null,
            });
            window.clearTimeout(onFail._t);
            onFail._t = window.setTimeout(() => setToast(null), 6000);
        };
        window.addEventListener('nb-save-failed', onFail);
        return () => window.removeEventListener('nb-save-failed', onFail);
    }, []);

    useEffect(() => {
        // 로그인 카드 없이 바로 씁니다. 로그인은 설정에서 하고, 로그인돼 있으면 그대로 동기화합니다.
        let cancelled = false;
        let unsub = () => {};
        const fallback = window.setTimeout(() => {
            if (!cancelled) setAuthReady(true);
        }, 2500);
        loadFirebase().then(async ({ auth }) => {
            const { onAuthStateChanged } = await import('firebase/auth');
            if (cancelled) return;
            unsub = onAuthStateChanged(auth, (u) => {
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
        }).catch((err) => {
            console.error(err);
            if (!cancelled) setAuthReady(true);
        });
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
    const ddayCards = useSharedList('ddayCards', enabled, rev);
    const submissionSheets = useSharedList('submissionSheets', enabled, rev);
    const praiseBoard = useSharedRecord('praiseBoard', enabled, rev);

    const author = user?.displayName || user?.email?.split('@')[0] || '선생님';

    const notify = (msg) => {
        setToast({ message: msg });
        window.clearTimeout(notify._t);
        notify._t = window.setTimeout(() => setToast(null), 2800);
    };

    const bump = () => setRev((n) => n + 1);

    const loginGoogle = async () => {
        try {
            const { auth } = await loadFirebase();
            const { GoogleAuthProvider, signInWithPopup } = await import('firebase/auth');
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
        if (user) {
            const { auth } = await loadFirebase();
            const { signOut } = await import('firebase/auth');
            await signOut(auth);
        }
    };

    const exportAll = () => {
        const payload = buildExportPayload({
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
            ddayCards: ddayCards.items,
            submissionSheets: submissionSheets.items,
            praiseBoard,
        });
        downloadText(`교무수첩-백업-${seoulYmd()}.json`, JSON.stringify(payload, null, 2));
        notify('백업 파일을 내려받았습니다.');
    };

    const reviewImport = (text) => {
        const result = validateBackup(text);
        if (!result.ok) {
            notify(result.errors.slice(0, 2).join(' '));
            return;
        }
        setImportPreview(result);
    };

    const confirmImport = async (mode = 'overwrite') => {
        const data = importPreview?.data;
        if (!data) return;
        setImporting(true);
        try {
            if (signedIn) await pushBackupCloud(data);
            applyBackupLocal(data, { mode });
            setImportPreview(null);
            bump();
            notify(mode === 'merge' ? '백업을 기존 기록과 합쳤습니다.' : '백업으로 덮어썼습니다.');
        } catch (err) {
            console.error(err);
            reportSaveFailure({
                message: '가져오기에 실패했습니다. 다시 시도해 주세요.',
                retry: () => confirmImport(mode),
            });
        } finally {
            setImporting(false);
        }
    };

    const importModal = importPreview ? (
        <Modal title="백업 가져오기" onClose={() => { if (!importing) setImportPreview(null); }}>
            <p className="text-sm text-stone-700 leading-relaxed">덮어쓰기는 백업에 들어 있는 항목 전체를 이 기기 기록으로 바꿉니다. 합치기는 같은 id와 같은 칸만 백업 값으로 고치고, 이 기기에만 있는 기록은 남깁니다.</p>
            {signedIn && (
                <p className="text-sm text-stone-700 leading-relaxed mt-2">로그인 중이면 같은 경로의 클라우드 문서도 갱신합니다. 백업에 없는 클라우드 문서는 지우지 않습니다. 건강·민원·학폭 쪽은 클라우드로 올리지 않습니다.</p>
            )}
            <ul className="mt-3 text-sm leading-relaxed">
                {Object.entries(importPreview.counts).filter(([, count]) => count > 0).map(([key, count]) => (
                    <li key={key}>{BACKUP_LABELS[key] || key} {count}</li>
                ))}
            </ul>
            <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="btn-primary" disabled={importing} onClick={() => confirmImport('overwrite')}>{importing ? '가져오는 중' : '덮어쓰기'}</button>
                <button type="button" className="btn-secondary" disabled={importing} onClick={() => confirmImport('merge')}>합치기</button>
                <button type="button" className="btn-secondary" disabled={importing} onClick={() => setImportPreview(null)}>취소</button>
            </div>
        </Modal>
    ) : null;

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
                    onLogin={loginGoogle}
                    authReady={authReady}
                    onExport={exportAll}
                    onImportText={reviewImport}
                    inbox={inbox.items}
                    studentNotes={studentNotes.items}
                    counselNotes={counselNotes.items}
                    plans={plans.items}
                    todos={todos.items}
                    attendance={attendance.items}
                    roster={roster.items}
                    onChanged={bump}
                    onToast={notify}
                    ddayCards={ddayCards.items}
                    submissionSheets={submissionSheets.items}
                    praiseBoard={praiseBoard}
                />
            </main>
            <Toast message={toast?.message} actionLabel={toast?.actionLabel} onAction={toast?.onAction} />
            {importModal}
        </>
    );
}
