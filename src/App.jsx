import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { boot, flushCloud, joined, refreshFromCloud, snapshot, subscribe, subscribeStorageIssue, undo, saveTip } from './lib/db.js';
import { refreshGcal, startGcalBridge } from './lib/gcalLive.js';
import { seoulParts } from './lib/date.js';
import { restInfo } from './lib/daymark.js';
import { resolveHash } from './lib/routes.js';
import { closeTip, tipForToday } from './lib/tips.js';
import { watchAuth } from './lib/cloud.js';
import { setAuth } from './lib/db.js';
import { cloudReady, signOutFirebase } from './firebase.js';
import { Ui, useUi } from './ui/context.jsx';
import { Btn, IconMenu, IconMoon, IconSearch, IconSettings, IconSun, KokMark, Symbol } from './ui/bits.jsx';
import { applyStoredFont } from './ui/fontpick.js';
import { keySoundEnabled, keySoundNoticePending, playKey, rememberKeySoundNotice, setKeySound, subscribeKeyPrefs, unlockKeyAudio } from './ui/keyfeel.js';
import { noteCompositionEnd, noteTypeInput, playTypeSound } from './ui/typesound.js';
import { HOTKEY_ACTIONS, hotkeyLabel, loadHotkeys, matchHotkey } from './ui/hotkeys.js';
import { MENU, menuSelected, menuTarget, tabSelected } from './ui/menu.js';
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
import { SyncChip } from './ui/SyncChip.jsx';

export default function App() {
    const [data, setData] = useState(null);
    const [hash, setHash] = useState(() => location.hash || '#/today');
    const [clock, setClock] = useState(() => seoulParts());
    const [toast, setToast] = useState(null);
    const [plus, setPlus] = useState(false);
    const [flow, setFlow] = useState(null);
    const [msg, setMsg] = useState(false);
    const [menu, setMenu] = useState(false);
    const [help, setHelp] = useState(false);
    const [search, setSearch] = useState(false);
    const [locked, setLocked] = useState(false);
    const [online, setOnline] = useState(() => navigator.onLine);
    const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
    const [tipFolded, setTipFolded] = useState(false);
    const toastTimer = useRef(0);

    useEffect(() => { applyStoredFont(); }, []);

    useEffect(() => {
        let stop = () => {};
        let unsub = () => {};
        let stopGcal = () => {};
        let alive = true;
        boot(location.search).then(async () => {
            if (!alive) return;
            setClock(seoulParts());
            setData(snapshot());
            stop = subscribe(setData);
            stopGcal = startGcalBridge();
            unsub = await watchAuth((user) => setAuth(user), { memoryOnly: Boolean(snapshot().profile.sharedPc) }) || (() => {});
        });
        return () => {
            alive = false;
            stop();
            unsub();
            stopGcal();
        };
    }, []);

    useEffect(() => {
        const timer = setInterval(() => setClock(seoulParts()), 30000);
        const onHash = () => setHash(location.hash || '#/today');
        const onPop = () => setHash(location.hash || '#/today');
        const onLine = () => {
            setOnline(navigator.onLine);
            if (navigator.onLine) {
                flushCloud().catch(() => {});
                refreshGcal().catch(() => {});
                refreshFromCloud('online').catch(() => {});
            }
        };
        // 다른 기기에서 고친 걸 보려고, 다시 볼 때 클라우드에서 받아와 합칩니다(30초에 한 번).
        const onVisible = () => {
            if (document.visibilityState === 'visible') refreshFromCloud('visible').catch(() => {});
        };
        const onFocus = () => refreshFromCloud('focus').catch(() => {});
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onFocus);
        window.addEventListener('hashchange', onHash);
        window.addEventListener('popstate', onPop);
        window.addEventListener('online', onLine);
        window.addEventListener('offline', onLine);
        return () => {
            clearInterval(timer);
            window.removeEventListener('hashchange', onHash);
            window.removeEventListener('popstate', onPop);
            window.removeEventListener('online', onLine);
            window.removeEventListener('offline', onLine);
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onFocus);
        };
    }, []);

    const route = useMemo(() => resolveHash(hash, clock.ymd), [hash, clock.ymd]);
    const place = data
        ? `${data.profile.started ? '1' : '0'}|${route.name}|${route.params.date || ''}|${route.params.no || ''}|${route.params.page || ''}|${route.params.week || ''}|${route.params.view || ''}`
        : '';
    useLayoutEffect(() => {
        if (!place) return;
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        document.querySelector('.main')?.scrollTo(0, 0);
    }, [place]);

    useEffect(() => {
        if (!route.replace) return;
        const next = route.replace.startsWith('#') ? route.replace : `#${route.replace}`;
        try {
            const url = new URL(location.href);
            url.hash = next;
            if (url.hash !== location.hash) history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
        } catch {
            /* 주소창을 못 고쳐도 아래 setHash로 화면은 옮깁니다. */
        }
        setHash(next);
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

    const go = useCallback((hash) => {
        const next = hash || '#/today';
        setHash(next);
        if (location.hash !== next) location.hash = next;
    }, []);

    const runHotkey = useCallback((id) => {
        const ymd = clock.ymd;
        const closeLayers = () => {
            setPlus(false);
            setFlow(null);
            setMsg(false);
            setSearch(false);
            setMenu(false);
            setHelp(false);
        };
        if (id === 'help') {
            setHelp((open) => !open);
            return;
        }
        if (id === 'plus') {
            closeLayers();
            setPlus(true);
            return;
        }
        if (id === 'search') {
            closeLayers();
            setSearch(true);
            return;
        }
        if (id === 'message') {
            closeLayers();
            setMsg(true);
            return;
        }
        if (id === 'minutes') {
            closeLayers();
            setFlow({ id: 'minutes' });
            return;
        }
        if (id.startsWith('quick:')) {
            closeLayers();
            setFlow({ id: 'quick', kind: id.slice(6) });
            return;
        }
        const href = {
            today: '#/today',
            attend: `#/attend/${ymd}`,
            students: '#/students',
            schedule: '#/schedule',
            todo: '#/todo',
            notice: '#/notice',
            neis: '#/students/neis',
            settings: '#/settings',
        }[id];
        if (!href) return;
        closeLayers();
        go(href);
    }, [clock.ymd, go]);

    useEffect(() => {
        const onKey = (event) => {
            if (locked) return;
            if (event.key === 'Escape') {
                setPlus(false);
                setFlow(null);
                setMsg(false);
                setSearch(false);
                setMenu(false);
                setHelp(false);
                return;
            }
            if (!data?.profile.started) return;
            const id = matchHotkey(event, loadHotkeys());
            if (!id) return;
            event.preventDefault();
            runHotkey(id);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [data?.profile.started, locked, runHotkey]);

    useEffect(() => {
        const unlock = () => unlockKeyAudio();
        const onInput = (event) => {
            if (!noteTypeInput(event)) return;
            playTypeSound();
        };
        document.addEventListener('pointerdown', unlock, true);
        document.addEventListener('keydown', unlock, true);
        document.addEventListener('compositionend', noteCompositionEnd, true);
        document.addEventListener('input', onInput, true);
        return () => {
            document.removeEventListener('pointerdown', unlock, true);
            document.removeEventListener('keydown', unlock, true);
            document.removeEventListener('compositionend', noteCompositionEnd, true);
            document.removeEventListener('input', onInput, true);
        };
    }, []);

    useEffect(() => {
        const hit = (target) => {
            if (!(target instanceof Element)) return null;
            const el = target.closest('button, a, label.chip, [role="button"]');
            if (!el || el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true') return null;
            return el;
        };
        const onPointerDown = (event) => {
            if (event.button !== 0) return;
            const el = hit(event.target);
            if (!el || el.hasAttribute('data-key-preview')) return;
            playKey('down');
        };
        const onPointerUp = () => {
            playKey('up');
        };
        const keyTarget = (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return null;
            const el = event.target;
            if (!(el instanceof HTMLElement)) return null;
            if (el.tagName !== 'BUTTON' && el.getAttribute('role') !== 'button') return null;
            if (el.hasAttribute('disabled') || el.hasAttribute('data-key-preview')) return null;
            return el;
        };
        const onKeyDown = (event) => {
            if (event.repeat || !keyTarget(event)) return;
            playKey('down');
        };
        const onKeyUp = (event) => {
            if (!keyTarget(event)) return;
            playKey('up');
        };
        document.addEventListener('pointerdown', onPointerDown, true);
        document.addEventListener('pointerup', onPointerUp, true);
        document.addEventListener('pointercancel', onPointerUp, true);
        document.addEventListener('keydown', onKeyDown, true);
        document.addEventListener('keyup', onKeyUp, true);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('pointerup', onPointerUp, true);
            document.removeEventListener('pointercancel', onPointerUp, true);
            document.removeEventListener('keydown', onKeyDown, true);
            document.removeEventListener('keyup', onKeyUp, true);
        };
    }, []);

    useEffect(() => subscribeStorageIssue((message) => showToast(message)), []);

    const [soundTip, setSoundTip] = useState(() => keySoundNoticePending());
    const [soundSilenced, setSoundSilenced] = useState(() => !keySoundEnabled());
    useEffect(() => subscribeKeyPrefs(() => {
        if (!keySoundEnabled()) setSoundSilenced(true);
    }), []);

    const showSoundTip = Boolean(soundTip && !flow && !plus && !msg && data?.profile?.started);
    const todayTipId = !data?.profile?.started || flow || plus || msg
        ? ''
        : (showSoundTip ? 'key-sound' : (tipForToday(clock.ymd, data.tip)?.id || ''));
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
        openHotkeyHelp: () => setHelp(true),
        route,
    };

    if (!data.profile.started) {
        return (
            <Ui.Provider value={ui}>
                <div className="app-bg" data-screen="start"><Start /></div>
            </Ui.Provider>
        );
    }

    const tabs = [
        ['오늘', '#/today', '🏠'],
        ['할 일', '#/todo', '☑'],
        ['더', '', '+'],
        ['기록', '#/students', '✎'],
        ['일정', '#/schedule', '📅'],
    ];
    const dailyTip = flow || plus || msg ? null : tipForToday(clock.ymd, data.tip);
    const tip = showSoundTip ? { id: 'key-sound', text: '콕, 누를 때 소리가 나요', sound: true } : dailyTip;
    const todayRest = restInfo(clock.ymd, joined(data, 'events'));

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
                    {MENU.map(([label, href]) => {
                        const on = menuSelected(route.name, href);
                        return (
                            <Btn key={label} block aria-current={on ? 'page' : undefined} className={on ? 'chip on' : 'chip'} style={{ justifyContent: 'flex-start' }} onClick={() => go(menuTarget(href, clock.ymd))}>{label}</Btn>
                        );
                    })}
                    <p className="muted" style={{ marginTop: 'auto', fontSize: 13, padding: 8 }}>기본으로 / 키를 누르면 콕이 열려요. 설정에서 바꿀 수 있어요.</p>
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
                                <h1 className="title-font date-line"><span>{Number(clock.ymd.slice(8, 10))}일</span><em className={todayRest.off ? 'day-rest-mark' : undefined}>{clock.weekday}요일</em></h1>
                                <p className="muted">{headingSub}</p>
                                <SyncChip cloudReady={cloudReady()} signedIn={Boolean(data.auth?.uid)} online={online} />
                            </div>
                        ) : (
                            <div className="date-block">
                                <h1 className="title-font">{heading}</h1>
                                <p className="muted">{headingSub}</p>
                                <SyncChip cloudReady={cloudReady()} signedIn={Boolean(data.auth?.uid)} online={online} />
                            </div>
                        )}
                        <div className="top-tools">
                            <Btn className="icon-btn" aria-label="찾기" onClick={() => setSearch(true)}><IconSearch /></Btn>
                            <Btn className="icon-btn" aria-label={dark ? '밝게' : '어둡게'} onClick={() => {
                                const next = dark ? 'light' : 'dark';
                                import('./lib/db.js').then(({ patchProfile }) => patchProfile({ theme: next })).catch(() => {});
                            }}>{dark ? <IconSun /> : <IconMoon />}</Btn>
                            <Btn className={route.name === 'settings' ? 'icon-btn is-on' : 'icon-btn'} aria-label="설정" aria-pressed={route.name === 'settings'} onClick={() => go('#/settings')}><IconSettings /></Btn>
                            <Btn className="icon-btn" aria-label="메뉴" onClick={() => setMenu(true)}><IconMenu /></Btn>
                        </div>
                    </header>
                    {tip && !tipFolded && (
                        <div className="tip-bubble" role="status">
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <p style={{ margin: 0, flex: 1, minWidth: 0 }}>{tip.text}</p>
                                {tip.sound && (
                                    <Btn className={soundSilenced ? 'chip' : 'chip on'} onClick={() => {
                                        setKeySound(false);
                                        rememberKeySoundNotice();
                                        setSoundSilenced(true);
                                    }}>끄기</Btn>
                                )}
                                <Btn className="icon-btn" aria-label="팁 닫기" onClick={() => {
                                    if (tip.sound) {
                                        rememberKeySoundNotice();
                                        setSoundTip(false);
                                        return;
                                    }
                                    saveTip(closeTip(data.tip, tip.id, clock.ymd));
                                }}>✕</Btn>
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
                            <Btn key={label} onClick={() => go(href)} style={{ color: tabSelected(label, route.name) ? 'var(--ink)' : 'var(--ink-sub)', fontWeight: 800, fontSize: 13 }}>
                                <span style={{ display: 'grid', justifyItems: 'center', gap: 2 }}>
                                    <span aria-hidden="true" style={{ fontSize: 16 }}>{icon}</span>
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
                {menu && <MenuSheet onClose={() => setMenu(false)} go={go} ymd={clock.ymd} routeName={route.name} />}
                {help && <HotkeySheet onClose={() => setHelp(false)} />}
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

function MenuSheet({ onClose, go, ymd, routeName }) {
    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="메뉴" onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                {MENU.map(([label, href]) => {
                    const on = menuSelected(routeName, href);
                    return (
                        <Btn key={label} block aria-current={on ? 'page' : undefined} className={on ? 'chip on' : 'chip'} style={{ marginBottom: 8, justifyContent: 'flex-start' }} onClick={() => { go(menuTarget(href, ymd)); onClose(); }}>{label}</Btn>
                    );
                })}
            </div>
        </div>
    );
}

function HotkeySheet({ onClose }) {
    const map = loadHotkeys();
    const rows = HOTKEY_ACTIONS.filter((action) => map[action.id]);
    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="단축키" onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                <h2 className="title-font" style={{ marginTop: 0 }}>단축키</h2>
                <p className="muted">지금 이 기기에 잡아 둔 키예요. 바꾸는 곳은 설정입니다.</p>
                {rows.map((action) => (
                    <p key={action.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, margin: '8px 0' }}>
                        <span style={{ minWidth: 0 }}>{action.label}</span>
                        <strong>{hotkeyLabel(map[action.id])}</strong>
                    </p>
                ))}
                {!rows.length && <p>아직 잡아 둔 키가 없어요.</p>}
                <Btn className="chip block" onClick={onClose}>닫기</Btn>
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

