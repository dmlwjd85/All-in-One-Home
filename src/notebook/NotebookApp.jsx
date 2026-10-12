import { useCallback, useEffect, useMemo, useState } from 'react';
import { Download, LogOut, PenLine } from 'lucide-react';
import notebook from './data/notebook.json';
import { usePageFields } from './fieldStore.js';
import { PAGE_H, PAGE_W } from './layout.js';
import NotebookShell from './NotebookShell.jsx';
import PageBody from './PageBody.jsx';
import { Modal } from '../components/ui.jsx';
import SsugeokInbox from '../components/SsugeokInbox.jsx';
import SsugeokDestinations from '../components/SsugeokDestinations.jsx';
import { SSUGEOK_VIEWS } from '../lib/ssugeok.js';

const MAX = notebook.pageCount;

function readHash() {
    const m = String(location.hash || '').match(/p(\d+)/i);
    const n = m ? Number(m[1]) : 1;
    if (!Number.isFinite(n) || n < 1 || n > MAX) return 1;
    return n;
}

export default function NotebookApp({
    user,
    guest,
    author,
    signedIn,
    onLogout,
    onExport,
    inbox,
    studentNotes,
    counselNotes,
    plans,
    todos,
    attendance,
    roster,
    onChanged,
    onToast,
}) {
    const [page, setPage] = useState(readHash);
    const [scale, setScale] = useState(1);
    const [hub, setHub] = useState(null);
    const { fields, setField } = usePageFields(page, signedIn);
    const pageRec = notebook.pages[page - 1];
    const showChrome = page !== 1;

    const go = useCallback((n) => {
        const next = Math.min(MAX, Math.max(1, Number(n) || 1));
        setPage(next);
        if (location.hash !== `#p${next}`) {
            history.pushState({ page: next }, '', `#p${next}`);
        }
    }, []);

    useEffect(() => {
        const onHash = () => setPage(readHash());
        const onPop = () => setPage(readHash());
        window.addEventListener('hashchange', onHash);
        window.addEventListener('popstate', onPop);
        return () => {
            window.removeEventListener('hashchange', onHash);
            window.removeEventListener('popstate', onPop);
        };
    }, []);

    useEffect(() => {
        const fit = () => {
            const bar = 48;
            const w = Math.max(320, window.innerWidth - 16);
            const h = Math.max(240, window.innerHeight - bar - 16);
            setScale(Math.min(w / PAGE_W, h / PAGE_H));
        };
        fit();
        window.addEventListener('resize', fit);
        return () => window.removeEventListener('resize', fit);
    }, []);

    useEffect(() => {
        const onKey = (e) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement) return;
            if (e.key === 'ArrowRight' || e.key === 'PageDown') {
                e.preventDefault();
                go(page + 1);
            } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
                e.preventDefault();
                go(page - 1);
            } else if (e.key === 'Home') {
                e.preventDefault();
                go(2);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [go, page]);

    const stageStyle = useMemo(() => ({
        width: PAGE_W * scale,
        height: PAGE_H * scale,
    }), [scale]);

    return (
        <div className="nb-app">
            <header className="nb-toolbar">
                <p className="nb-toolbar-brand">
                    <PenLine size={16} aria-hidden="true" />
                    <span>2026 교무수첩</span>
                    <span className="nb-toolbar-page">{pageRec.title} · p.{page}/{MAX}</span>
                </p>
                <div className="nb-toolbar-actions">
                    <span className="nb-toolbar-user">{author}{guest ? ' · 이 기기' : ''}</span>
                    <button type="button" className="btn-secondary nb-toolbtn" onClick={onExport} aria-label="데이터 내보내기">
                        <Download size={16} />
                        <span className="nb-toolhide">내보내기</span>
                    </button>
                    <button type="button" className="btn-secondary nb-toolbtn" onClick={onLogout} aria-label={user ? '로그아웃' : '나가기'}>
                        <LogOut size={16} />
                        <span className="nb-toolhide">{user ? '로그아웃' : '나가기'}</span>
                    </button>
                </div>
            </header>

            <div className="nb-stage-wrap">
                <div className="nb-stage" style={stageStyle}>
                    <div className="nb-scale" style={{ transform: `scale(${scale})`, width: PAGE_W, height: PAGE_H }}>
                        <NotebookShell
                            page={page}
                            pageRec={pageRec}
                            pages={notebook.pages}
                            onGo={go}
                            showChrome={showChrome}
                        >
                            <PageBody
                                page={page}
                                pageRec={pageRec}
                                extra={pageRec.extra || {}}
                                pages={notebook.pages}
                                onGo={go}
                                fields={fields}
                                setField={setField}
                                signedIn={signedIn}
                                author={author}
                                onChanged={onChanged}
                                onToast={onToast}
                                onOpenHub={() => setHub('inbox')}
                            />
                        </NotebookShell>
                    </div>
                </div>
            </div>

            {hub && (
                <Modal title="쓱적 허브 · 날려보내기" onClose={() => setHub(null)} wide>
                    <p className="text-sm text-stone-600 mb-3">
                        PDF 쓰 쪽의 줄 메모는 그대로 두고, 받은함 카드를 학생·출결·상담·주간·업무로 나눕니다. 수첩 탭·링크는 닫아도 유지됩니다.
                    </p>
                    <div className="flex gap-1 overflow-x-auto pb-2 mb-3">
                        {SSUGEOK_VIEWS.filter((v) => v.id !== 'cal').map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                className={`icon-tab ${hub === t.id ? 'bg-amber-900 text-white border-amber-900' : 'bg-[#fffaf0] border-amber-900/20'}`}
                                onClick={() => setHub(t.id)}
                            >
                                {t.short}
                            </button>
                        ))}
                    </div>
                    {hub === 'inbox' ? (
                        <SsugeokInbox
                            inbox={inbox}
                            roster={roster}
                            signedIn={signedIn}
                            author={author}
                            onChanged={onChanged}
                            onToast={onToast}
                            onView={(id) => setHub(id)}
                        />
                    ) : (
                        <SsugeokDestinations
                            view={hub}
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
                </Modal>
            )}
        </div>
    );
}
