import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, LogOut, PenLine, Search, Upload } from 'lucide-react';
import catalog from 'virtual:notebook-catalog';
import { usePageFields } from './fieldStore.js';
import { dropSection, loadSection, sectionForPage } from './loadNotebook.js';
import { fitCanvas } from './layout.js';
import NotebookShell from './NotebookShell.jsx';
import PageBody from './PageBody.jsx';
import SearchDialog from './SearchDialog.jsx';
import { Modal } from '../components/ui.jsx';
import SsugeokInbox from '../components/SsugeokInbox.jsx';
import SsugeokDestinations from '../components/SsugeokDestinations.jsx';
import { SSUGEOK_VIEWS } from '../lib/ssugeok.js';
import CaptureFab from './CaptureFab.jsx';
import { mergeNotes, quarantineSensitive, useSensitiveNotes } from './ssugeokStore.js';

const MAX = catalog.pageCount;

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
    onImportText,
    inbox,
    studentNotes,
    counselNotes,
    plans,
    todos,
    attendance,
    roster,
    onChanged,
    onToast,
    ddayCards,
    submissionSheets,
    praiseBoard,
}) {
    const [page, setPage] = useState(readHash);
    const [sectionPages, setSectionPages] = useState(null);
    const [sectionError, setSectionError] = useState('');
    const [hub, setHub] = useState(null);
    const [focusId, setFocusId] = useState(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 700px)').matches);
    const [box, setBox] = useState(null);
    const stageRef = useRef(null);
    const fileRef = useRef(null);
    const sensitiveNotes = useSensitiveNotes();
    const ssugeokNotes = useMemo(() => mergeNotes(inbox, sensitiveNotes), [inbox, sensitiveNotes]);
    const { fields, setField } = usePageFields(page, signedIn);
    const sectionName = sectionForPage(page);
    const stub = catalog.pages[page - 1];
    const pageRec = (sectionPages || []).find((item) => item.n === page) || null;
    const showChrome = page !== 1;

    const go = useCallback((n) => {
        const next = Math.min(MAX, Math.max(1, Number(n) || 1));
        setPage(next);
        if (location.hash !== `#p${next}`) {
            history.pushState({ page: next }, '', `#p${next}`);
        }
    }, []);

    useEffect(() => {
        let stop = false;
        setSectionError('');
        loadSection(sectionName).then((pages) => {
            if (!stop) setSectionPages(pages);
        }).catch((err) => {
            console.error(err);
            if (!stop) setSectionError('쪽을 불러오지 못했습니다.');
        });
        return () => { stop = true; };
    }, [sectionName]);

    useEffect(() => {
        const mq = window.matchMedia('(max-width: 700px)');
        const onChange = () => setPhone(mq.matches);
        onChange();
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    useEffect(() => {
        const el = stageRef.current;
        if (!el || phone) return undefined;
        const measure = () => {
            const rect = el.getBoundingClientRect();
            setBox(fitCanvas(rect.width - 8, rect.height - 8));
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(el);
        return () => observer.disconnect();
    }, [phone]);

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

    const openNote = useCallback((id) => {
        setFocusId(id);
        go(496);
    }, [go]);

    useEffect(() => {
        let stop = false;
        quarantineSensitive(inbox, signedIn).then((moved) => {
            if (!stop && moved) onChanged?.();
        });
        return () => { stop = true; };
    }, [inbox, signedIn, onChanged]);

    useEffect(() => {
        const onKey = (e) => {
            const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setSearchOpen(true);
                return;
            }
            if (typing) return;
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

    const onFile = async (event) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        if (file.size > 8 * 1024 * 1024) {
            onToast?.('파일이 8MB를 넘습니다.');
            return;
        }
        const text = await file.text();
        onImportText?.(text);
    };

    const canvasStyle = !phone && box?.width ? { width: `${box.width}px`, height: `${box.height}px` } : undefined;

    return (
        <div className={`nb-app ${phone ? 'is-phone' : ''}`}>
            <p className="sr-only" aria-live="polite">{stub?.title || '교무수첩'} {page}쪽</p>
            <header className="nb-toolbar">
                <p className="nb-toolbar-brand">
                    <PenLine size={16} aria-hidden="true" />
                    <span className="nb-brand-name">2026 교무수첩</span>
                    <span className="nb-toolbar-page">{stub?.title}</span>
                </p>
                <span className="nb-toolbar-num" aria-label={`${page}쪽, 전체 ${MAX}쪽`}>{phone ? `p.${page}` : `p.${page}/${MAX}`}</span>
                <div className="nb-toolbar-actions">
                    <span className="nb-toolbar-user">{author}{guest ? ' · 이 기기' : ''}</span>
                    <button type="button" className="btn-secondary nb-toolbtn" onClick={() => setSearchOpen(true)} aria-label="수첩 찾기" aria-keyshortcuts="Control+K">
                        <Search size={16} />
                        <span className="nb-toolhide">찾기</span>
                    </button>
                    <button type="button" className="btn-secondary nb-toolbtn" onClick={onExport} aria-label="데이터 내보내기">
                        <Download size={16} />
                        <span className="nb-toolhide">내보내기</span>
                    </button>
                    <button type="button" className="btn-secondary nb-toolbtn" onClick={() => fileRef.current?.click()} aria-label="백업 가져오기">
                        <Upload size={16} />
                        <span className="nb-toolhide">가져오기</span>
                    </button>
                    <input ref={fileRef} className="sr-only" type="file" accept="application/json,.json" aria-label="백업 JSON 파일" onChange={onFile} />
                    <button type="button" className="btn-secondary nb-toolbtn" onClick={onLogout} aria-label={user ? '로그아웃' : '나가기'}>
                        <LogOut size={16} />
                        <span className="nb-toolhide">{user ? '로그아웃' : '나가기'}</span>
                    </button>
                </div>
            </header>

            <div className="nb-stage-wrap" ref={stageRef}>
                <NotebookShell
                    page={page}
                    pageRec={pageRec || { ...stub, topNav: [], links: [], extra: stub?.extra || {} }}
                    pages={catalog.pages}
                    onGo={go}
                    showChrome={showChrome}
                    style={canvasStyle}
                >
                    {sectionError ? (
                        <div className="nb-load-error">
                            <p>{sectionError}</p>
                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => {
                                    dropSection(sectionName);
                                    setSectionError('');
                                    setSectionPages(null);
                                    loadSection(sectionName).then(setSectionPages).catch(() => setSectionError('쪽을 불러오지 못했습니다.'));
                                }}
                            >
                                다시 불러오기
                            </button>
                        </div>
                    ) : pageRec ? (
                        <PageBody
                            page={page}
                            pageRec={pageRec}
                            extra={pageRec.extra || {}}
                            pages={catalog.pages}
                            onGo={go}
                            fields={fields}
                            setField={setField}
                            signedIn={signedIn}
                            author={author}
                            onChanged={onChanged}
                            onToast={onToast}
                            onOpenHub={() => setHub('inbox')}
                            ssugeokNotes={ssugeokNotes}
                            sensitiveNotes={sensitiveNotes}
                            focusId={focusId}
                            onOpenNote={openNote}
                            ddayCards={ddayCards}
                            submissionSheets={submissionSheets}
                            praiseBoard={praiseBoard}
                        />
                    ) : (
                        <p className="nb-hint">쪽을 불러오는 중입니다…</p>
                    )}
                </NotebookShell>
            </div>

            <CaptureFab
                author={author}
                signedIn={signedIn}
                fromPage={page}
                onChanged={onChanged}
                onToast={onToast}
            />

            {searchOpen && (
                <SearchDialog pages={catalog.pages} onGo={go} onClose={() => setSearchOpen(false)} />
            )}

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
