import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Download, LogIn, LogOut, Pencil, Upload } from 'lucide-react';
import catalog from 'virtual:notebook-catalog';
import { usePageFields } from './fieldStore.js';
import { dropSection, loadSection, sectionForPage } from './loadNotebook.js';
import NotebookShell from './NotebookShell.jsx';
import PageBody from './PageBody.jsx';
import SearchDialog from './SearchDialog.jsx';
import { Modal } from '../components/ui.jsx';
import SsugeokInbox from '../components/SsugeokInbox.jsx';
import SsugeokDestinations from '../components/SsugeokDestinations.jsx';
import { SSUGEOK_VIEWS } from '../lib/ssugeok.js';
import DiaryTop from './diary/DiaryTop.jsx';
import TodayBoard from './diary/TodayBoard.jsx';
import QuickCapture from './diary/QuickCapture.jsx';
import { monthOfPage } from './diary/DiaryTop.jsx';
import { monthPageFor, shiftYm } from './diary/dates.js';
import { captureShortcutHere } from './diary/shortcut.js';
import { mergeNotes, quarantineSensitive, useSensitiveNotes } from './ssugeokStore.js';
import { canonicalHash, pageFromHash, resolveHash } from './routes.js';

const MAX = catalog.pageCount;

function readHash() {
    return pageFromHash(location.hash, catalog.pages, MAX);
}

export default function NotebookApp({
    user,
    guest,
    author,
    signedIn,
    onLogout,
    onLogin,
    authReady,
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
    const [navEpoch, setNavEpoch] = useState(0);
    const toastRef = useRef(onToast);
    const noticedRef = useRef('');
    toastRef.current = onToast;
    const [sectionPages, setSectionPages] = useState(null);
    const [sectionError, setSectionError] = useState('');
    const [hub, setHub] = useState(null);
    const [focusId, setFocusId] = useState(null);
    const [searchOpen, setSearchOpen] = useState(false);
    const [phone, setPhone] = useState(() => window.matchMedia('(max-width: 700px)').matches);
    const [quickOpen, setQuickOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const swipeRef = useRef(null);
    const stageRef = useRef(null);
    const fileRef = useRef(null);
    const sensitiveNotes = useSensitiveNotes();
    const ssugeokNotes = useMemo(() => mergeNotes(inbox, sensitiveNotes), [inbox, sensitiveNotes]);
    const { fields, setField } = usePageFields(page, signedIn);
    const sectionName = sectionForPage(page);
    const stub = catalog.pages[page - 1];
    const pageRec = (sectionPages || []).find((item) => item.n === page) || null;
    const showChrome = page !== 1;

    const go = useCallback((n, opts) => {
        const next = Math.min(MAX, Math.max(1, Number(n) || 1));
        setPage(next);
        const hash = opts?.hash || canonicalHash(next, catalog.pages);
        if (location.hash !== hash) {
            history.pushState({ page: next }, '', hash);
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

    const applyLocation = useCallback(() => {
        const resolved = resolveHash(location.hash, catalog.pages, MAX);
        const seen = location.hash || '#';
        setPage(resolved.page);
        setNavEpoch((n) => n + 1);
        if (!resolved.preserve && location.hash !== resolved.canonical) {
            history.replaceState({ page: resolved.page }, '', resolved.canonical);
        }
        if (!resolved.exact) {
            if (noticedRef.current !== seen) {
                noticedRef.current = seen;
                toastRef.current?.('없는 주소라서 가까운 쪽으로 옮겼어요.');
            }
        } else {
            noticedRef.current = '';
        }
    }, []);

    useEffect(() => {
        applyLocation();
        window.addEventListener('hashchange', applyLocation);
        window.addEventListener('popstate', applyLocation);
        return () => {
            window.removeEventListener('hashchange', applyLocation);
            window.removeEventListener('popstate', applyLocation);
        };
    }, [applyLocation]);

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

    const stepMonth = useCallback((delta) => {
        const ym = monthOfPage(catalog.pages[page - 1]);
        const t = shiftYm(ym.y, ym.m, delta);
        const dest = monthPageFor(t.y, t.m);
        if (dest) go(dest);
    }, [go, page]);

    useEffect(() => {
        const onKey = (e) => {
            const typing = e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLSelectElement;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
                e.preventDefault();
                setSearchOpen(false);
                setQuickOpen(true);
                return;
            }
            if (e.altKey && (e.code === 'KeyS' || e.key.toLowerCase() === 's')) {
                e.preventDefault();
                const inline = document.querySelector('.nb-body [data-ssu-capture]');
                if (inline) inline.focus();
                else setQuickOpen(true);
                return;
            }
            if ((e.ctrlKey || e.metaKey) && e.key === '/') {
                e.preventDefault();
                setSearchOpen(true);
                return;
            }
            if (typing) return;
            if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                if (catalog.pages[page - 1]?.type !== 'month') return;
                e.preventDefault();
                stepMonth(e.key === 'ArrowRight' ? 1 : -1);
            } else if (e.key === 'Home') {
                e.preventDefault();
                go(2);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [go, page, stepMonth]);

    const onTouchStart = (e) => {
        const t = e.touches[0];
        swipeRef.current = { x: t.clientX, y: t.clientY };
    };
    const onTouchEnd = (e) => {
        const start = swipeRef.current;
        swipeRef.current = null;
        if (!start || catalog.pages[page - 1]?.type !== 'month') return;
        const t = e.changedTouches[0];
        const dx = t.clientX - start.x;
        const dy = t.clientY - start.y;
        if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.6) stepMonth(dx < 0 ? 1 : -1);
    };

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

    const isHome = page === 2;
    const capProps = { author, signedIn, fromPage: page, onChanged, onToast };

    return (
        <div className={`nb-app dy-app ${phone ? 'is-phone' : ''}`}>
            <p className="sr-only" aria-live="polite">{stub?.title || '교무수첩'}</p>
            <DiaryTop
                page={page}
                pages={catalog.pages}
                onGo={go}
                onSearch={() => setSearchOpen(true)}
                onSettings={() => setSettingsOpen(true)}
                signedIn={signedIn}
            />
            <div className="dy-toast-slot" />

            <div className="nb-stage-wrap dy-stage" ref={stageRef} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
                {isHome ? (
                    <TodayBoard
                        pages={catalog.pages}
                        onGo={go}
                        notes={ssugeokNotes}
                        signedIn={signedIn}
                        author={author}
                        onChanged={onChanged}
                        onToast={onToast}
                        fields={fields}
                        setField={setField}
                        phone={phone}
                    />
                ) : (
                <NotebookShell
                    page={page}
                    pageRec={pageRec || { ...stub, topNav: [], links: [], extra: stub?.extra || {} }}
                    pages={catalog.pages}
                    onGo={go}
                    showChrome={showChrome}
                    phone={phone}
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
                )}
            </div>

            {phone && !quickOpen && (
                <button type="button" className="dy-fab" onClick={() => setQuickOpen(true)} aria-label="쓱, 적 적기">
                    <Pencil size={24} strokeWidth={1.8} />
                </button>
            )}

            {quickOpen && <QuickCapture {...capProps} onClose={() => setQuickOpen(false)} />}

            {settingsOpen && (
                <Modal title="설정" onClose={() => setSettingsOpen(false)}>
                    <div className="dy-settings">
                        <section>
                            <h3 className="dy-h3">계정 · 동기화</h3>
                            {user ? (
                                <>
                                    <p className="dy-muted">{user.email || author} 로 로그인했어요. 여러 기기에 기록이 맞춰집니다.</p>
                                    <button type="button" className="dy-btn-ghost" onClick={onLogout}><LogOut size={16} /> 로그아웃</button>
                                </>
                            ) : (
                                <>
                                    <p className="dy-muted">지금은 이 기기에만 저장돼요. Google로 로그인하면 여러 기기에 맞춰집니다.{authReady ? '' : ' (로그인 상태를 확인하는 중)'}</p>
                                    <button type="button" className="dy-btn-primary" onClick={onLogin}><LogIn size={16} /> Google 계정으로 로그인</button>
                                </>
                            )}
                        </section>
                        <section>
                            <h3 className="dy-h3">백업</h3>
                            <div className="dy-row">
                                <button type="button" className="dy-btn-ghost" onClick={onExport}><Download size={16} /> 내보내기</button>
                                <button type="button" className="dy-btn-ghost" onClick={() => fileRef.current?.click()}><Upload size={16} /> 가져오기</button>
                            </div>
                            <input ref={fileRef} className="sr-only" type="file" accept="application/json,.json" aria-label="백업 JSON 파일" onChange={onFile} />
                        </section>
                        <section>
                            <h3 className="dy-h3">단축키</h3>
                            <p className="dy-muted">{captureShortcutHere()} 쓱, 적 · ⌘/ 찾기 · 월간에서 ← → 달 넘기기</p>
                        </section>
                    </div>
                </Modal>
            )}

            {searchOpen && (
                <SearchDialog pages={catalog.pages} onGo={go} onClose={() => setSearchOpen(false)} />
            )}

            {hub && (
                <Modal title="쓱, 적 허브 · 날려보내기" onClose={() => setHub(null)} wide>
                    <p className="text-sm text-stone-600 mb-3">
                        받은함 카드를 학생·출결·상담·주간·업무로 나눕니다. 수첩 탭·링크는 닫아도 유지됩니다.
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
