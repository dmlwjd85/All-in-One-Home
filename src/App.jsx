import { useEffect, useMemo, useRef, useState } from 'react';
import { boot, snapshot, subscribe, undo, saveTip } from './lib/db.js';
import { seoulParts } from './lib/date.js';
import { resolveHash } from './lib/routes.js';
import { closeTip, tipForToday } from './lib/tips.js';
import { watchAuth } from './lib/cloud.js';
import { setAuth } from './lib/db.js';
import { Ui, useUi } from './ui/context.jsx';
import { Btn, HOME_KINDS, IconMoon, IconSearch, IconSun, Symbol } from './ui/bits.jsx';
import { Home } from './ui/Home.jsx';
import { QuickSheet } from './ui/QuickSheet.jsx';
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
    const [quick, setQuick] = useState(null);
    const [menu, setMenu] = useState(false);
    const [search, setSearch] = useState(false);
    const [locked, setLocked] = useState(false);
    const [online, setOnline] = useState(() => navigator.onLine);
    const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
    const toastTimer = useRef(0);

    useEffect(() => {
        let stop = () => {};
        boot(location.search).then(() => {
            setClock(seoulParts());
            setData(snapshot());
            stop = subscribe(setData);
        });
        return () => stop();
    }, []);

    useEffect(() => {
        let unsub = () => {};
        watchAuth((user) => setAuth(user)).then((fn) => { unsub = fn || (() => {}); });
        return () => unsub();
    }, []);

    useEffect(() => {
        const timer = setInterval(() => setClock(seoulParts()), 30000);
        const onHash = () => setHash(location.hash || '#/today');
        const onLine = () => setOnline(navigator.onLine);
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
        if (route.openQuick) setQuick((prev) => prev || { kind: '관찰' });
        if (route.notice) setToast({ message: route.notice, undoable: false });
    }, [route.openQuick, route.notice, data?.profile.started]);

    useEffect(() => {
        if (!data) return;
        const theme = data.profile.theme;
        const next = theme === 'dark' || (theme !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
        document.documentElement.classList.toggle('dark', next);
        document.documentElement.style.colorScheme = next ? 'dark' : 'light';
        const meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', next ? '#0F0E1A' : '#F6F4FF');
        setDark(next);
        try { localStorage.setItem('ssug-gyomu-theme', theme || 'system'); } catch { /* 무시 */ }
    }, [data?.profile.theme]);

    useEffect(() => {
        if (!data?.profile.sharedPc || locked) return undefined;
        let timer = 0;
        const arm = () => {
            clearTimeout(timer);
            timer = setTimeout(() => setLocked(true), 30 * 60 * 1000);
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
                setQuick({ kind: '관찰' });
            }
            if (event.key === 'Escape') {
                setQuick(null);
                setSearch(false);
                setMenu(false);
            }
            if (quick && !typing && event.key >= '1' && event.key <= '6') {
                const kind = HOME_KINDS[Number(event.key) - 1]?.id;
                if (kind) setQuick((prev) => ({ ...(prev || {}), kind }));
            }
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [quick, data?.profile.started]);

    function showToast(message, undoable = false) {
        clearTimeout(toastTimer.current);
        setToast({ message, undoable });
        toastTimer.current = setTimeout(() => setToast(null), 5000);
    }

    if (!data) {
        return <div className="app-bg" style={{ padding: 32 }}><p className="title-font" style={{ fontSize: 22 }}>쓱 교무수첩을 열고 있어요.</p></div>;
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
        openQuick: (kind, extra = {}) => setQuick({ kind: kind || '관찰', ...extra }),
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
    const tip = quick ? null : tipForToday(clock.ymd, data.tip);
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
                        <strong className="title-font" style={{ fontSize: 18 }}>쓱 교무수첩</strong>
                    </div>
                    {MENU.map(([label, href]) => (
                        <Btn key={label} block className="chip" style={{ justifyContent: 'flex-start', background: (location.hash || '#/today') === href ? 'var(--primary)' : 'transparent', color: (location.hash || '#/today') === href ? 'var(--on-primary)' : 'var(--ink)' }} onClick={() => go(href)}>{label}</Btn>
                    ))}
                    <p className="muted" style={{ marginTop: 'auto', fontSize: 13, padding: 8 }}>어디서든 / 키를 누르면 바로 적을 수 있어요. 엔터로 저장돼요.</p>
                </aside>
                <div className="main">
                    {!online && <p className="solid-card" style={{ padding: 12 }} role="status">인터넷이 끊겼어요. 적은 건 저장해 두고 연결되면 올릴게요.</p>}
                    {data.profile.sharedPc && <p className="muted" style={{ marginTop: 0 }}>공용 컴퓨터 모드예요. 30분 동안 가만히 있으면 화면을 잠급니다.</p>}
                    <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        {route.name === 'student' || route.name === 'legacy' ? (
                            <Btn className="icon-btn" aria-label="뒤로" onClick={() => history.back()}>‹</Btn>
                        ) : (
                            <Btn className="icon-btn" aria-label="메뉴" onClick={() => setMenu(true)} style={{ padding: 0 }}><Symbol /></Btn>
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                            <h1 className="title-font" style={{ fontSize: route.name === 'today' ? 20 : 22, lineHeight: '26px', margin: 0 }}>{heading}</h1>
                            <p className="muted" style={{ margin: 0, fontSize: 13 }}>{headingSub}</p>
                        </div>
                        <Btn className="icon-btn" aria-label="찾기" onClick={() => setSearch(true)}><IconSearch /></Btn>
                        <Btn className="icon-btn" aria-label={dark ? '밝게' : '어둡게'} onClick={() => {
                            const next = dark ? 'light' : 'dark';
                            import('./lib/db.js').then(({ patchProfile }) => patchProfile({ theme: next }));
                        }}>{dark ? <IconSun /> : <IconMoon />}</Btn>
                    </header>
                    <div data-screen={route.name}>{screen}</div>
                </div>
                <nav className="tabbar" aria-label="주요 메뉴">
                    {tabs.map(([label, href, icon]) => (
                        label === '더' ? (
                            <Btn key={label} className="fab" aria-label="쓱, 적" onClick={() => setQuick({ kind: '관찰' })}>+</Btn>
                        ) : (
                            <Btn key={label} onClick={() => go(href)} style={{ color: (href === '#/today' ? route.name === 'today' : location.hash === href || (label === '출결' && route.name === 'attend')) ? 'var(--primary)' : 'var(--ink-sub)', fontWeight: 800, fontSize: 12 }}>
                                <span style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
                                    <span aria-hidden="true" style={{ color: label === '출결' && checked ? 'var(--st-present)' : 'inherit', fontSize: 16 }}>{icon}</span>
                                    {label}
                                </span>
                            </Btn>
                        )
                    ))}
                </nav>
                {tip && (
                    <div className="tip-bubble" role="status">
                        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                            <p style={{ margin: 0, flex: 1 }}>{tip.text}</p>
                            <Btn aria-label="팁 닫기" onClick={() => saveTip(closeTip(data.tip, tip.id, clock.ymd))}>✕</Btn>
                        </div>
                    </div>
                )}
                {quick && <QuickSheet initial={quick} onClose={() => setQuick(null)} />}
                {menu && <MenuSheet onClose={() => setMenu(false)} />}
                {search && <SearchSheet onClose={() => setSearch(false)} />}
                {toast && (
                    <div className="toast" role="status">
                        <span>{toast.message}</span>
                        {toast.undoable && <Btn style={{ color: 'var(--toast-action)', fontWeight: 800 }} onClick={() => { undo(); setToast(null); }}>되돌리기</Btn>}
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
                    <Btn key={label} block className="chip" style={{ marginBottom: 8, background: 'var(--brand-soft)' }} onClick={() => { go(href); onClose(); }}>{label}</Btn>
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
                        <Btn key={row.id} block className="chip" style={{ justifyContent: 'flex-start', background: 'var(--solid)' }} onClick={() => { jump(row.sid ? `#/students/${data.students.find((item) => item.id === row.sid)?.no || ''}` : '#/students'); onClose(); }}>{row.text}</Btn>
                    ))}
                    {query && !students.length && !records.length && <p className="muted">찾는 말이 기록에 없어요.</p>}
                </div>
            </div>
        </div>
    );
}

