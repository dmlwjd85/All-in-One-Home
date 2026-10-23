import { useEffect, useMemo, useRef, useState } from 'react';
import { boot, flushCloud, snapshot, subscribe, subscribeStorageIssue, undo, saveTip } from './lib/db.js';
import { seoulParts } from './lib/date.js';
import { resolveHash } from './lib/routes.js';
import { closeTip, tipForToday } from './lib/tips.js';
import { watchAuth } from './lib/cloud.js';
import { setAuth } from './lib/db.js';
import { cloudReady, signOutFirebase } from './firebase.js';
import { Ui, useUi } from './ui/context.jsx';
import { Btn, IconMenu, IconMoon, IconSearch, IconSun, KokMark, Symbol } from './ui/bits.jsx';
import { playKey, setKeySound, setKeySoundAnnouncer } from './ui/keyfeel.js';
import { ClayMark } from './ui/ClayMark.jsx';
import { Home } from './ui/Home.jsx';
import { PlusSheet } from './ui/PlusSheet.jsx';
import { FlowSheet } from './ui/FlowSheet.jsx';
import { MsgSheet } from './ui/MsgSheet.jsx';
import { Attend } from './ui/Attend.jsx';
import { Neis, Student, Students } from './ui/Students.jsx';
import { Schedule } from './ui/Schedule.jsx';
import { Notice, Tasks } from './ui/Tasks.jsx';
import { Legacy, Settings } from './ui/Settings.jsx';
import { Start } from './ui/Start.jsx';

const MENU = [
    ['오늘', '#/today'],
    ['출결', '#/attend'],
    ['학생 기록', '#/students'],
    ['일정·시간표', '#/schedule'],
    ['할 일·메모', '#/todo'],
    ['알림장', '#/notice'],
    ['나이스 모아 보기', '#/students/neis'],
    ['설정', '#/settings'],
];

function go(hash) {
    if (location.hash === hash) return;
    location.hash = hash;
}

export default function App() {
    const [data, setData] = useState(null);
    const [hash, setHash] = useState(() => location.hash || '#/today');
    const [clock, setClock] = useState(() => seoulParts());
    const [toast, setToast] = useState(null);
    const [plus, setPlus] = useState(false);
    const [flow, setFlow] = useState(null);
    const [msg, setMsg] = useState(false);
    const [menu, setMenu] = useState(false);
    const [search, setSearch] = useState(false);
    const [locked, setLocked] = useState(false);
    const [online, setOnline] = useState(() => navigator.onLine);
    const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
    const [tipFolded, setTipFolded] = useState(false);
    const toastTimer = useRef(0);

    useEffect(() => {
        let stop = () => {};
        let unsub = () => {};
        let alive = true;
        boot(location.search).then(async () => {
            if (!alive) return;
            setClock(seoulParts());
            setData(snapshot());
            stop = subscribe(setData);
            unsub = await watchAuth((user) => setAuth(user), { memoryOnly: Boolean(snapshot().profile.sharedPc) }) || (() => {});
        });
        return () => {
            alive = false;
            stop();
            unsub();
        };
    }, []);

    useEffect(() => {
        const timer = setInterval(() => setClock(seoulParts()), 30000);
        const onHash = () => setHash(location.hash || '#/today');
        const onLine = () => {
            setOnline(navigator.onLine);
            if (navigator.onLine) flushCloud().catch(() => {});
        };
        window.addEventListener('hashchange', onHash);
        window.addEventListener('online', onLine);
        window.addEventListener('offline', onLine);
        return () => {
            clearInterval(timer);
            window.removeEventListener('hashchange', onHash);
            window.removeEventListener('online', onLine);
            window.removeEventListener('offline', onLine);
        };
    }, []);

    const route = useMemo(() => resolveHash(hash, clock.ymd), [hash, clock.ymd]);

    useEffect(() => {
        if (!route.replace) return;
        history.replaceState(null, '', route.replace);
        setHash(route.replace);
    }, [route.replace]);

    useEffect(() => {
        if (!data?.profile.started) return;
        if (route.openQuick) setFlow((prev) => prev || { id: 'quick', kind: '관찰' });
        if (route.notice) setToast({ message: route.notice, undoable: false });
    }, [route.openQuick, route.notice, data?.profile.started]);

    useEffect(() => {
        if (!data) return;
        const theme = data.profile.theme;
        const next = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', next);
        document.documentElement.style.colorScheme = next ? 'dark' : 'light';
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', next ? '#2A2627' : '#E8E4DE');
        setDark(next);
        try { localStorage.setItem('ssug-gyomu-theme', theme || 'system'); } catch { /* 무시 */ }
    }, [data?.profile.theme]);

    useEffect(() => {
        if (!data?.profile.sharedPc || locked) return undefined;
        let timer = 0;
        const arm = () => {
            clearTimeout(timer);
            timer = setTimeout(() => {
                setLocked(true);
                signOutFirebase().catch(() => {});
            }, 30 * 60 * 1000);
        };
        arm();
        window.addEventListener('pointerdown', arm);
        window.addEventListener('keydown', arm);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('pointerdown', arm);
            window.removeEventListener('keydown', arm);
        };
    }, [data?.profile.sharedPc, locked]);

    useEffect(() => {
        const onKey = (event) => {
            const tag = document.activeElement?.tagName;
            const typing = tag === 'INPUT' || tag === 'TEXTAREA';
            if (event.key === '/' && !typing && data?.profile.started) {
                event.preventDefault();
                setPlus(true);
            }
            if (event.key === 'Escape') {
                setPlus(false);
                setFlow(null);
                setMsg(false);
                setSearch(false);
                setMenu(false);
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [data?.profile.started]);

    useEffect(() => {
        const hit = (target) => {
            if (!(target instanceof Element)) return null;
            const el = target.closest('button, a, label.chip, [role="button"]');
            if (!el || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return null;
            return el;
        };
        const onPointer = (event) => {
            if (event.button !== 0) return;
            if (hit(event.target)) playKey();
        };
        const onKey = (event) => {
            if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
            const el = event.target;
            if (!(el instanceof HTMLElement)) return;
            if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') return;
            if (el.hasAttribute('disabled')) return;
            playKey();
        };
        document.addEventListener('pointerdown', onPointer, true);
        document.addEventListener('keydown', onKey, true);
        return () => {
            document.removeEventListener('pointerdown', onPointer, true);
            document.removeEventListener('keydown', onKey, true);
        };
    }, []);

    useEffect(() => subscribeStorageIssue((message) => showToast(message)), []);

    useEffect(() => {
        setKeySoundAnnouncer(() => {
            showToast('콕, 누를 때 소리가 나요', false, {
                label: '끄기',
                passThrough: true,
                onClick: () => {
                    setKeySound(false);
                    showToast('');
                },
            });
        });
        return () => setKeySoundAnnouncer(null);
    }, []);

    const todayTipId = (!flow && !plus && !msg && data?.profile?.started) ? (tipForToday(clock.ymd, data.tip)?.id || '') : '';
    useEffect(() => {
        if (!todayTipId) return undefined;
        setTipFolded(false);
        const timer = window.setTimeout(() => setTipFolded(true), 5000);
        return () => window.clearTimeout(timer);
    }, [todayTipId]);

    function showToast(message, undoable = false, action = null) {
        clearTimeout(toastTimer.current);
        if (!message) {
            setToast(null);
            return;
        }
        setToast({ message, undoable, action });
        toastTimer.current = setTimeout(() => setToast(null), 5000);
    }

    if (!data) {
        return <div className="app-bg" style={{ padding: 32 }}><p className="title-font" style={{ fontSize: 22 }}>콕 교무수첩을 열고 있어요.</p></div>;
    }

    if (locked) {
        return (
            <div className="app-bg" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
                <div className="solid-card" style={{ padding: 24, maxWidth: 360, width: '100%' }}>
                    <p className="title-font" style={{ fontSize: 26, margin: '0 0 8px' }}>화면을 잠가 두었어요</p>
                    <p className="muted" style={{ marginTop: 0 }}>공용 컴퓨터라 30분 동안 가만히 있으면 이렇게 가려 둡니다.</p>
                    <Btn className="primary-btn block" onClick={() => setLocked(false)}>다시 열기</Btn>
                </div>
            </div>
        );
    }

    const ui = {
        data,
        clock,
        dark,
        showToast,
        openQuick: (kind, extra = {}) => setFlow({ id: 'quick', kind: kind || '관찰', ...extra }),
        openFlow: (next) => setFlow(next),
        openPlus: () => setPlus(true),
        go,
        route,
    };

    if (!data.profile.started) {
        return (
            <Ui.Provider value={ui}>
                <div className="app-bg" data-screen="start"><Start /></div>
            </Ui.Provider>
        );
    }

    const attendHash = `#/attend/${clock.ymd}`;
    const tabs = [
        ['오늘', '#/today', '🏠'],
        ['출결', attendHash, '✓'],
        ['더', '', '+'],
        ['기록', '#/students', '✎'],
        ['일정', '#/schedule', '📅'],
    ];
    const tip = flow || plus || msg ? null : tipForToday(clock.ymd, data.tip);
    const checked = data.profile.checkedDates.includes(clock.ymd);

    let screen = <Home />;
    if (route.name === 'attend') screen = <Attend />;
    if (route.name === 'students') screen = <Students />;
    if (route.name === 'student') screen = <Student />;
    if (route.name === 'neis') screen = <Neis />;
    if (route.name === 'schedule') screen = <Schedule />;
    if (route.name === 'todo') screen = <Tasks />;
    if (route.name === 'notice') screen = <Notice key={route.params.date || 'next'} />;
    if (route.name === 'settings') screen = <Settings />;
    if (route.name === 'legacy') screen = <Legacy />;

    const titles = {
        today: [clock.label, `${data.profile.className || '학급을 아직 안 적었어요'} · ${clock.clock}`],
        attend: ['출결', `${data.profile.className || '우리 반'} · ${data.students.length || data.profile.classSize || 0}명`],
        students: ['학생 기록', data.profile.className || '번호순으로 볼 수 있어요'],
        student: ['학생', data.profile.className || ''],
        neis: ['나이스에 옮길 것', '복사해서 옮긴 뒤 표시해 두세요'],
        schedule: ['일정·시간표', data.profile.className || ''],
        todo: ['할 일·메모', '오늘 할 일부터 보여 드려요'],
        notice: ['알림장', '복사해서 다른 앱에 붙여 넣어요'],
        settings: ['설정', '이 기기와 학급'],
        legacy: ['예전 수첩', '쪽은 읽기만 됩니다'],
        start: ['시작', ''],
    };
    const studentRow = route.name === 'student' ? data.students.find((row) => row.no === route.params.no) : null;
    const [title, sub] = titles[route.name] || titles.today;
    const heading = studentRow ? studentRow.name : title;
    const headingSub = studentRow ? `${studentRow.no}번 · ${data.profile.className || '우리 반'}` : sub;

    return (
        <Ui.Provider value={ui}>
            <div className="app-bg app-frame" data-ready="1">
                <aside className="side">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px 12px' }}>
                        <Symbol />
                        <strong className="title-font" style={{ fontSize: 18 }}>콕 교무수첩</strong>
                    </div>
                    {MENU.map(([label, href]) => (
                        <Btn key={label} block className={(location.hash || '#/today') === href ? 'chip on' : 'chip'} style={{ justifyContent: 'flex-start' }} onClick={() => go(href)}>{label}</Btn>
                    ))}
                    <p className="muted" style={{ marginTop: 'auto', fontSize: 13, padding: 8 }}>/ 키를 누르면 콕과 같은 일 고르기가 열려요.</p>
                </aside>
                <div className="main">
                    {!cloudReady() && <p className="muted cloud-note">아직 클라우드 연결 전이에요. 이 기기에는 저장돼요.</p>}
                    {!online && cloudReady() && <p className="solid-card" style={{ padding: 12 }} role="status">인터넷이 끊겼어요. 적은 건 이 기기에 저장해 두고, 연결되면 선생님 자리에 올릴게요.</p>}
                    {data.profile.sharedPc && <p className="muted" style={{ marginTop: 0 }}>공용 컴퓨터 모드예요. 30분 동안 가만히 있으면 화면을 잠급니다.</p>}
                    <header className="topbar">
                        {(route.name === 'student' || route.name === 'legacy') && (
                            <Btn className="icon-btn" aria-label="뒤로" onClick={() => history.back()}>‹</Btn>
                        )}
                        {route.name === 'today' ? (
                            <div className="date-block">
                                <span className="kicker">{clock.ymd.slice(0, 4)}년 {Number(clock.ymd.slice(5, 7))}월</span>
                                <h1 className="title-font date-line"><span>{Number(clock.ymd.slice(8, 10))}일</span><em>{clock.weekday}요일</em></h1>
                                <p className="muted">{headingSub}</p>
                            </div>
                        ) : (
                            <div className="date-block">
                                <h1 className="title-font">{heading}</h1>
                                <p className="muted">{headingSub}</p>
                            </div>
                        )}
                        <div className="top-tools">
                            {route.name !== 'student' && route.name !== 'legacy' && (
                                <Btn className="icon-btn" aria-label="메뉴" onClick={() => setMenu(true)}><IconMenu /></Btn>
                            )}
                            <Btn className="icon-btn" aria-label="찾기" onClick={() => setSearch(true)}><IconSearch /></Btn>
                            <Btn className="icon-btn" aria-label={dark ? '밝게' : '어둡게'} onClick={() => {
                                const next = dark ? 'light' : 'dark';
                                import('./lib/db.js').then(({ patchProfile }) => patchProfile({ theme: next })).catch(() => {});
                            }}>{dark ? <IconSun /> : <IconMoon />}</Btn>
                        </div>
                    </header>
                    {tip && !tipFolded && (
                        <div className="tip-bubble" role="status">
                            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                                <p style={{ margin: 0, flex: 1 }}>{tip.text}</p>
                                <Btn className="icon-btn" aria-label="팁 닫기" onClick={() => { saveTip(closeTip(data.tip, tip.id, clock.ymd)); }}>✕</Btn>
                            </div>
                        </div>
                    )}
                    {tip && tipFolded && (
                        <Btn className="tip-bulb" aria-label="팁 다시 보기" onClick={() => setTipFolded(false)}>💡</Btn>
                    )}
                    <div data-screen={route.name}>{screen}</div>
                </div>
                <nav className="tabbar" aria-label="주요 메뉴">
                    {tabs.map(([label, href, icon]) => (
                        label === '더' ? (
                            <Btn key={label} className="fab" aria-label="할 일 고르기" onClick={() => setPlus(true)}><KokMark /></Btn>
                        ) : (
                            <Btn key={label} onClick={() => go(href)} style={{ color: (href === '#/today' ? route.name === 'today' : location.hash === href || (label === '출결' && route.name === 'attend')) ? 'var(--ink)' : 'var(--ink-sub)', fontWeight: 800, fontSize: 13 }}>
                                <span style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
                                    <span aria-hidden="true" style={{ color: label === '출결' && checked ? 'var(--st-present)' : 'inherit', fontSize: 16 }}>{icon}</span>
                                    {label}
                                </span>
                            </Btn>
                        )
                    ))}
                </nav>
                <Btn className="desk-fab" aria-label="할 일 고르기" onClick={() => setPlus(true)}><KokMark /></Btn>
                {plus && (
                    <PlusSheet
                        onClose={() => setPlus(false)}
                        onPick={(action) => {
                            setPlus(false);
                            if (!action) return;
                            if (action.id === 'attend') {
                                go(`#/attend/${clock.ymd}`);
                                return;
                            }
                            if (action.id === 'message') {
                                setMsg(true);
                                return;
                            }
                            if (action.id === 'minutes') {
                                setFlow({ id: 'minutes' });
                                return;
                            }
                            if (action.kind) setFlow({ id: 'quick', kind: action.kind });
                        }}
                    />
                )}
                {flow && <FlowSheet flow={flow} onClose={() => setFlow(null)} />}
                {msg && <MsgSheet onClose={() => setMsg(false)} />}
                {menu && <MenuSheet onClose={() => setMenu(false)} />}
                {search && <SearchSheet onClose={() => setSearch(false)} />}
                {toast && (
                    <div className={`toast${toast.action?.passThrough ? ' toast-notice' : ''}`} role="status">
                        {toast.undoable ? <ClayMark size={44} /> : null}
                        <span>{toast.message}</span>
                        {toast.undoable && <Btn style={{ color: 'var(--toast-action)', fontWeight: 800 }} onClick={() => { undo().then((ok) => { if (ok) setToast(null); }); }}>되돌리기</Btn>}
                        {toast.action && <Btn style={{ color: 'var(--toast-action)', fontWeight: 800 }} onClick={() => toast.action.onClick?.()}>{toast.action.label}</Btn>}
                    </div>
                )}
            </div>
        </Ui.Provider>
    );
}

function MenuSheet({ onClose }) {
    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="메뉴" onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                {MENU.map(([label, href]) => (
                    <Btn key={label} block className="chip" style={{ marginBottom: 8, justifyContent: 'flex-start' }} onClick={() => { go(href); onClose(); }}>{label}</Btn>
                ))}
            </div>
        </div>
    );
}

function SearchSheet({ onClose }) {
    const { data, go: jump } = useUi();
    const [q, setQ] = useState('');
    const query = q.trim();
    const students = data.students.filter((row) => !query || `${row.no} ${row.name}`.includes(query));
    const records = [...data.records, ...data.local.records].filter((row) => !query || row.text.includes(query)).slice(0, 8);
    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="찾기" onClick={(event) => event.stopPropagation()}>
                <input className="field" autoFocus placeholder="이름, 번호, 기록 단어" value={q} onChange={(event) => setQ(event.target.value)} aria-label="찾을 말" />
                <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                    {students.slice(0, 8).map((row) => (
                        <Btn key={row.id} block className="chip" style={{ justifyContent: 'flex-start' }} onClick={() => { jump(`#/students/${row.no}`); onClose(); }}>{row.no}번 {row.name}</Btn>
                    ))}
                    {records.map((row) => (
                        <Btn key={row.id} block className="chip" style={{ justifyContent: 'flex-start' }} onClick={() => { jump(row.sid ? `#/students/${data.students.find((item) => item.id === row.sid)?.no || ''}` : '#/students'); onClose(); }}>{row.text}</Btn>
                    ))}
                    {query && !students.length && !records.length && <p className="muted">찾는 말이 기록에 없어요.</p>}
                </div>
            </div>
        </div>
    );
}

