import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { boot, flushCloud, joined, refreshFromCloud, snapshot, subscribe, subscribeStorageIssue, undo, saveTip } from './lib/db.js';
import { refreshGcal, startGcalBridge } from './lib/gcalLive.js';
import { useGcal } from './ui/useGcal.js';
import { GcalDot } from './ui/GcalSettings.jsx';
import { gcalNeedsDot } from './lib/gcalCore.js';
import { seoulParts } from './lib/date.js';
import { restInfo } from './lib/daymark.js';
import { resolveHash } from './lib/routes.js';
import { closeTip, tipForToday } from './lib/tips.js';
import { watchAuth } from './lib/cloud.js';
import { setAuth } from './lib/db.js';
import { cloudReady, signOutFirebase } from './firebase.js';
import { Ui, useUi } from './ui/context.jsx';
import { Btn, IconMenu, IconMoon, IconSearch, IconSettings, IconSun, IconWidgets, Motto, Symbol } from './ui/bits.jsx';
import { playFoilPop } from './ui/sealBurst.js';
import { bloomQuickBar, guardCupBurst, playCupGhost, resetQuickLayer } from './ui/cupBurst.js';
import { QuickBar } from './ui/QuickBar.jsx';
import { quickDate } from './ui/quickText.js';
import { applyStoredFont } from './ui/fontpick.js';
import { isKbVoice, keySoundEnabled, keySoundNoticePending, keyVoiceId, loadKbVoice, playKey, pressTarget, rememberKeySoundNotice, setKeySound, subscribeKeyPrefs, unlockKeyAudio } from './ui/keyfeel.js';
import { jamFeelEnabled, pressDown, pressUp } from './ui/pressFeel.js';
import { applyStoredKbTheme } from './ui/kbtheme.js';
import { TYPE_SOUND_SHOWN, noteCompositionEnd, noteCompositionStart, noteCompositionUpdate, noteTypeInput, noteTypeKey, playTypeSound } from './ui/typesound.js';
import { HOTKEY_ACTIONS, defaultHotkeyRows, hotkeyLabel, kokHotkeyHint, loadHotkeys, matchHotkey, modalOpen, seedHotkeys } from './ui/hotkeys.js';
import { Minutes } from './ui/Minutes.jsx';
import { MENU, menuSelected, menuTarget } from './ui/menu.js';
import { JjaemJar, TabBar } from './ui/TabBar.jsx';
import { ClayMark } from './ui/ClayMark.jsx';
import { Home } from './ui/Home.jsx';
import { WidgetBoard } from './ui/WidgetBoard.jsx';
import { readWidgetMode, writeWidgetMode } from './lib/widgets.js';
import { SideLinks } from './ui/EduLinks.jsx';
import { PlusSheet } from './ui/PlusSheet.jsx';
import { TodoAlarm } from './ui/TodoAlarm.jsx';
import { FlowSheet } from './ui/FlowSheet.jsx';
import { MsgSheet } from './ui/MsgSheet.jsx';
import { Attend } from './ui/Attend.jsx';
import { Neis, Student, Students } from './ui/Students.jsx';
import { Schedule } from './ui/Schedule.jsx';
import { Notice, Tasks } from './ui/Tasks.jsx';
import { Legacy, RosterSettings, Settings } from './ui/Settings.jsx';
import { Day } from './ui/Day.jsx';
import { Start } from './ui/Start.jsx';
import { SyncChip } from './ui/SyncChip.jsx';
import { FuseBar } from './ui/FuseBar.jsx';
import { migrateFxLevel } from './ui/doneFx.js';
import { syncAuthKnown } from './lib/syncStatus.js';

export default function App() {
    const [data, setData] = useState(null);
    const [hash, setHash] = useState(() => location.hash || '#/today');
    const [clock, setClock] = useState(() => seoulParts());
    /* 넓은 화면(900px 이상) '오늘'을 위젯판으로 볼지. 이 기기에만 기억합니다. 휴대폰은 늘 기본 화면입니다. */
    const [wideScreen, setWideScreen] = useState(() => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 900px)').matches);
    const [boardOn, setBoardOn] = useState(() => readWidgetMode());
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined;
        const list = window.matchMedia('(min-width: 900px)');
        const onChange = () => setWideScreen(list.matches);
        onChange();
        list.addEventListener?.('change', onChange);
        return () => list.removeEventListener?.('change', onChange);
    }, []);
    const [toast, setToast] = useState(null);
    const [plus, setPlus] = useState(false);
    const [quickOpen, setQuickOpen] = useState(false);
    const [quickInvite, setQuickInvite] = useState(false);
    const quickInput = useRef(null);
    const quickOpenRef = useRef(false);
    const quickPushed = useRef(false);
    const quickOpenedAt = useRef(-Infinity);
    const pendingQuick = useRef(false);
    const [flow, setFlow] = useState(null);
    const [msg, setMsg] = useState(false);
    const [menu, setMenu] = useState(false);
    const gcalSnap = useGcal();
    const gcalDot = gcalNeedsDot(gcalSnap);
    const [help, setHelp] = useState(false);
    const [search, setSearch] = useState(false);
    const [locked, setLocked] = useState(false);
    const [online, setOnline] = useState(() => navigator.onLine);
    const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
    const [tipFolded, setTipFolded] = useState(false);
    const [hotkeys, setHotkeys] = useState(() => loadHotkeys());
    const toastTimer = useRef(0);

    useEffect(() => { applyStoredFont(); migrateFxLevel(); }, []);
    // 다른 기기(웹·태블릿·휴대폰)에서 고친 기록을 앱으로 돌아올 때 다시 받습니다. 1분에 한 번까지만.
    useEffect(() => {
        const again = () => { if (document.visibilityState === 'visible') refreshFromCloud().catch(() => {}); };
        /* 앱을 닫거나 숨기면 남은 변경을 바로 올립니다. 휴대폰은 숨긴 뒤 곧 멈추므로 기다리지 않습니다. */
        const leave = () => { if (document.visibilityState === 'hidden') flushCloud().catch(() => {}); };
        document.addEventListener('visibilitychange', again);
        document.addEventListener('visibilitychange', leave);
        window.addEventListener('pagehide', leave);
        window.addEventListener('focus', again);
        window.addEventListener('online', again);
        /* 화면을 켜 둔 채 다른 기기에서 고쳐도 5분마다 받아 옵니다. */
        const tick = window.setInterval(() => { if (document.visibilityState === 'visible') refreshFromCloud().catch(() => {}); }, 5 * 60 * 1000);
        return () => {
            window.clearInterval(tick);
            document.removeEventListener('visibilitychange', again);
            document.removeEventListener('visibilitychange', leave);
            window.removeEventListener('pagehide', leave);
            window.removeEventListener('focus', again);
            window.removeEventListener('online', again);
        };
    }, []);
    useEffect(() => guardCupBurst(), []);

    /* 키보드 테마는 이 기기에 둔 값만 봅니다. 테마 소리를 골라 두었으면 쉬는 틈에 파일을 받아 첫 누름부터 들리게 합니다. */
    useEffect(() => {
        applyStoredKbTheme();
        const voice = keyVoiceId();
        if (!isKbVoice(voice)) return undefined;
        const idle = window.requestIdleCallback ? (fn) => window.requestIdleCallback(fn, { timeout: 2000 }) : (fn) => window.setTimeout(fn, 600);
        const stop = window.cancelIdleCallback ? (id) => window.cancelIdleCallback(id) : (id) => window.clearTimeout(id);
        const id = idle(() => loadKbVoice(voice));
        return () => stop(id);
    }, []);

    /* 자료를 처음 읽으면 이 기기가 새 설치인지 한 번만 정합니다. 이미 쓰던 기기는 예전 단축키(/ 와 ?)를 그대로 둡니다. */
    const hotkeySeeded = useRef(false);
    useEffect(() => {
        if (!data || hotkeySeeded.current) return;
        hotkeySeeded.current = true;
        /* 데모 둘러보기는 실제 사용 기록이 아니므로 표시를 남기지 않습니다. */
        if (data.profile?.demo) return;
        if (seedHotkeys(Boolean(data.profile?.started))) setHotkeys(loadHotkeys());
    }, [data]);

    useEffect(() => {
        const sync = () => setHotkeys(loadHotkeys());
        window.addEventListener('ssug-gyomu-hotkeys-changed', sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener('ssug-gyomu-hotkeys-changed', sync);
            window.removeEventListener('storage', sync);
        };
    }, []);

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
            try {
                unsub = await watchAuth((user) => setAuth(user), { memoryOnly: Boolean(snapshot().profile.sharedPc) }) || (() => {});
            } finally {
                /* 로그인 확인이 오지 않아도(연결 실패 등) 동기화 칩이 빈 자리로 계속 남지 않게 잠시 뒤 확정합니다. */
                setTimeout(syncAuthKnown, 5000);
            }
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
        const onPop = () => {
            setHash(location.hash || '#/today');
            /* 뒤로 가기: 열린 쨈 팝업만 닫습니다(열 때 넣어 둔 기록 한 칸이 빠진 것). */
            if (quickOpenRef.current && history.state?.quickJam !== 1) {
                quickInput.current?.blur();
                setQuickOpen(false);
                setQuickInvite(false);
            }
        };
        const onLine = () => {
            setOnline(navigator.onLine);
            if (navigator.onLine) {
                flushCloud().catch(() => {});
                refreshGcal().catch(() => {});
            }
        };
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
        };
    }, []);

    const route = useMemo(() => resolveHash(hash, clock.ymd), [hash, clock.ymd]);
    const place = data
        ? `${data.profile.started ? '1' : '0'}|${route.name}|${route.params.date || ''}|${route.params.no || ''}|${route.params.page || ''}|${route.params.week || ''}|${route.params.view || ''}|${route.params.sec || ''}`
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
        if (route.openQuickBar) pendingQuick.current = true;
    }, [route.openQuickBar]);

    useEffect(() => {
        if (!data?.profile.started || locked) return;
        const fromQuery = new URLSearchParams(location.search).get('quick') === '1';
        if (!pendingQuick.current && !fromQuery) return;
        pendingQuick.current = false;
        setQuickInvite(true);
        setQuickOpen(true);
        quickInput.current?.blur();
        if (!fromQuery) return;
        try {
            const url = new URL(location.href);
            url.searchParams.delete('quick');
            history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
        } catch {
            /* 주소를 못 고쳐도 입력칸은 열려 있습니다. */
        }
    }, [route.openQuickBar, locked, data?.profile.started, hash]);

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

    /* 쨈 팝업: 열면 뒤로 가기 기록을 한 칸 넣고, 어떤 길로 닫든(✕·바탕·뒤로·쨈 다시·Esc·저장) 화면을 처음 그대로 돌려 둡니다. */
    useEffect(() => {
        quickOpenRef.current = quickOpen;
        if (quickOpen) {
            quickOpenedAt.current = performance.now();
            if (history.state?.quickJam !== 1) {
                try { history.pushState({ ...(history.state || {}), quickJam: 1 }, '', location.href); quickPushed.current = true; } catch { /* 기록을 못 넣어도 ✕로 닫힙니다. */ }
            }
            return;
        }
        resetQuickLayer();
        if (!quickPushed.current) {
            /* 새로 고침 뒤 남은 옛 팝업 기록은 뒤로 가지 않고 표시만 지웁니다. */
            if (history.state?.quickJam === 1) {
                try { const { quickJam, ...rest } = history.state; history.replaceState(rest, '', location.href); } catch { /* 그대로 둡니다. */ }
            }
            return;
        }
        quickPushed.current = false;
        if (history.state?.quickJam === 1) {
            try { history.back(); } catch { /* 이미 빠졌습니다. */ }
        }
    }, [quickOpen]);

    const go = useCallback((hash, options) => {
        const next = hash || '#/today';
        if (quickOpenRef.current) { quickInput.current?.blur(); setQuickOpen(false); setQuickInvite(false); }
        setHash(next);
        if (location.hash === next) return;
        if (options?.replace || options?.state) {
            try {
                const url = new URL(location.href);
                url.hash = next;
                const href = `${url.pathname}${url.search}${url.hash}`;
                if (options.replace) history.replaceState(options.state || null, '', href);
                else history.pushState(options.state, '', href);
            } catch {
                location.hash = next;
            }
            return;
        }
        location.hash = next;
    }, []);

    const goBack = useCallback(() => {
        if (history.state?.appFrom || history.state?.rosterFrom) {
            history.back();
            return;
        }
        const parent = route.name === 'day'
            ? (route.params.date ? `#/schedule/month/${route.params.date}` : '#/schedule')
            : route.name === 'roster' || (route.name === 'settings' && route.params.sec)
                ? '#/settings'
                : route.name === 'student'
                    ? '#/students'
                    : route.name === 'minutes' && route.params.mode !== 'list'
                        ? (route.params.mode === 'edit' && route.params.id ? `#/minutes/${route.params.id}` : '#/minutes')
                    : route.name === 'legacy'
                        ? (route.params.page ? '#/settings/legacy' : '#/settings')
                        : '#/today';
        try {
            const url = new URL(location.href);
            url.hash = parent;
            history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
        } catch {
            location.replace(parent);
        }
        setHash(parent);
    }, [route.name, route.params.date, route.params.page, route.params.mode, route.params.id, route.params.sec]);

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
            /* / 키는 화면 아래 쨈 버튼을 직접 누른 것과 똑같습니다: 키캡 눌림·딸깍 소리 → 버튼 클릭(쨈 튐·같은 쨈 팝업) → 키캡 복귀.
               / 전용 입력창은 따로 두지 않습니다. */
            closeLayers();
            pressJamButton();
            return;
        }
        if (id === 'memo') {
            closeLayers();
            go('#/todo');
            window.setTimeout(() => {
                const box = document.querySelector('textarea[aria-label="메모"]');
                box?.scrollIntoView?.({ block: 'center' });
                box?.focus?.({ preventScroll: true });
            }, 60);
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
            go('#/minutes/new');
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
            schedule: '#/schedule',
            todo: '#/todo',
            minutesList: '#/minutes',
            notice: '#/notice',
            students: '#/students',
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
                quickInput.current?.blur();
                setQuickOpen(false);
                setQuickInvite(false);
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
            /* 대화상자나 쨈 빠른 입력창이 떠 있으면 단축키는 쉽니다. 단축키 목록만 같은 키로 닫을 수 있어요. */
            const helpOpen = Boolean(document.querySelector('[aria-modal="true"][aria-label="단축키"]'));
            if (id === 'help' ? (modalOpen() && !helpOpen) : (modalOpen() || quickOpenRef.current)) return;
            event.preventDefault();
            runHotkey(id);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [data?.profile.started, locked, runHotkey]);

    useEffect(() => {
        const unlock = () => unlockKeyAudio();
        const onInput = (event) => {
            if (!TYPE_SOUND_SHOWN) return;
            if (noteTypeInput(event)) playTypeSound();
        };
        const onTypeKey = (event) => {
            if (!TYPE_SOUND_SHOWN) return;
            const kind = noteTypeKey(event);
            if (kind) playTypeSound(kind);
        };
        const onCompositionUpdate = (event) => noteCompositionUpdate(event?.data);
        document.addEventListener('pointerdown', unlock, true);
        document.addEventListener('keydown', unlock, true);
        document.addEventListener('keydown', onTypeKey, true);
        document.addEventListener('compositionstart', noteCompositionStart, true);
        document.addEventListener('compositionupdate', onCompositionUpdate, true);
        document.addEventListener('compositionend', noteCompositionEnd, true);
        document.addEventListener('input', onInput, true);
        return () => {
            document.removeEventListener('pointerdown', unlock, true);
            document.removeEventListener('keydown', unlock, true);
            document.removeEventListener('keydown', onTypeKey, true);
            document.removeEventListener('compositionstart', noteCompositionStart, true);
            document.removeEventListener('compositionupdate', onCompositionUpdate, true);
            document.removeEventListener('compositionend', noteCompositionEnd, true);
            document.removeEventListener('input', onInput, true);
        };
    }, []);

    useEffect(() => {
        const hit = (target) => {
            if (!(target instanceof Element)) return null;
            return pressTarget(target);
        };
        const onPointerDown = (event) => {
            if (event.button !== 0) return;
            const el = hit(event.target);
            if (!el || el.hasAttribute('data-key-preview')) return;
            if (jamFeelEnabled() && el.closest('.fab, .desk-fab, .tab-jelly')) return;
            playKey('down');
        };
        const onPointerUp = (event) => {
            const target = event.target;
            if (jamFeelEnabled() && target instanceof Element && target.closest('.fab, .desk-fab, .tab-jelly')) return;
            playKey('up');
        };
        const keyTarget = (event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return null;
            const el = event.target;
            if (!(el instanceof HTMLElement)) return null;
            if (el.tagName === 'A' || pressTarget(el) !== el) return null;
            if (el.hasAttribute('data-key-preview')) return null;
            return el;
        };
        const onKeyDown = (event) => {
            if (event.repeat || !keyTarget(event)) return;
            if (jamFeelEnabled() && event.target?.closest?.('.fab, .desk-fab, .tab-jelly')) return;
            playKey('down');
        };
        const onKeyUp = (event) => {
            if (!keyTarget(event)) return;
            if (jamFeelEnabled() && event.target?.closest?.('.fab, .desk-fab, .tab-jelly')) return;
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

    /* 팝업·시트가 열리면 떠 있던 알림을 닫습니다(평점관: 알림이 팝업 아래쪽 단추를 5초간 덮음).
       팝업이 열린 뒤에 새로 뜬 알림은 CSS에서 화면 위쪽으로 옮겨 시트 단추를 가리지 않습니다. */
    useEffect(() => {
        if (!toast || typeof MutationObserver === 'undefined') return undefined;
        const modalOpen = () => Boolean(document.querySelector('[aria-modal="true"]'));
        if (modalOpen()) return undefined;
        const mo = new MutationObserver(() => {
            if (!modalOpen()) return;
            clearTimeout(toastTimer.current);
            setToast(null);
        });
        mo.observe(document.body, { childList: true, subtree: true });
        return () => mo.disconnect();
    }, [toast]);

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
        return <div className="app-bg" style={{ padding: 32 }}><p className="title-font" style={{ fontSize: 22 }}>쨈 교무수첩을 열고 있어요.</p></div>;
    }

    if (locked) {
        return (
            <div className="app-bg" style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', padding: 24 }}>
                <div className="solid-card" style={{ padding: 24, maxWidth: 360, width: '100%', display: 'grid', justifyItems: 'center' }}>
                    <Symbol />
                    <p className="title-font" style={{ fontSize: 18, margin: '12px 0 0' }}>쨈 교무수첩</p>
                    <Motto center />
                    <p className="title-font font-display" style={{ fontSize: 26, margin: '12px 0 8px' }}>화면을 잠가 두었어요</p>
                    <p className="muted" style={{ marginTop: 0 }}>공용 컴퓨터라 30분 동안 가만히 있으면 이렇게 가려 둡니다.</p>
                    <Btn className="primary-btn block" onClick={() => setLocked(false)}>다시 열기</Btn>
                </div>
            </div>
        );
    }

    function pressJamButton() {
        /* 지금 보이는 쨈 버튼(넓은 화면 .desk-fab, 좁은 화면 탭바 가운데)을 찾아 사람이 누른 것처럼 누릅니다. */
        const shown = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
        const btn = [...document.querySelectorAll('.desk-fab, .tbj-mid')].find(shown);
        if (!btn) { openQuickBar(); return; }
        const feel = jamFeelEnabled();
        pressDown(btn);
        if (!feel) playKey('down');
        btn.dataset.via = 'slash';
        btn.click();
        window.setTimeout(() => {
            pressUp(btn);
            if (!feel) playKey('up');
            delete btn.dataset.via;
        }, 140);
    }

    function openQuickBar(event) {
        /* 열려 있으면 쨈 버튼이 닫기입니다. 막 연 뒤 0.4초 안의 두 번째 탭(연타)은 무시합니다. */
        if (quickOpenRef.current) {
            if (performance.now() - quickOpenedAt.current > 400) closeQuickBar();
            return;
        }
        const bar = document.querySelector('.quick-bar');
        if (bar) {
            bar.classList.add('is-open');
            bar.setAttribute('aria-hidden', 'false');
        }
        quickInput.current?.focus();
        setQuickInvite(false);
        setQuickOpen(true);
        playFoilPop(event?.currentTarget);
        const opener = event?.currentTarget;
        bloomQuickBar(opener);
        /* React가 열림 상태를 그리며 className을 다시 쓰면 방금 붙인 번짐(is-bloom)이 같은 틀 안에서 지워질 수 있습니다.
           다음 틀에 아직 열려 있는데 번짐이 없으면 한 번 더 붙입니다(버튼·/ 키 모두 같은 길). */
        requestAnimationFrame(() => {
            const bar = document.querySelector('.quick-bar');
            if (quickOpenRef.current && bar && !bar.classList.contains('is-bloom')) bloomQuickBar(opener);
        });
        playCupGhost(opener);
    }

    function closeQuickBar() {
        quickInput.current?.blur();
        setQuickOpen(false);
        setQuickInvite(false);
    }

    const ui = {
        data,
        clock,
        dark,
        showToast,
        openQuick: (kind, extra = {}) => setFlow({ id: 'quick', kind: kind || '관찰', ...extra }),
        openFlow: (next) => setFlow(next),
        openPlus: (opts) => setPlus(opts?.more ? 'more' : true),
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

    const dailyTip = flow || plus || msg ? null : tipForToday(clock.ymd, data.tip);
    const tip = showSoundTip ? { id: 'key-sound', text: '누를 때 소리가 나요', sound: true } : dailyTip;
    const todayRest = restInfo(clock.ymd, joined(data, 'events'));

    const showBoard = wideScreen && boardOn;
    let screen = showBoard ? <WidgetBoard onLeave={() => setBoardOn(writeWidgetMode(false))} /> : <Home />;
    if (route.name === 'attend') screen = <Attend />;
    if (route.name === 'students') screen = <Students />;
    if (route.name === 'student') screen = <Student />;
    if (route.name === 'neis') screen = <Neis />;
    if (route.name === 'schedule') screen = <Schedule />;
    if (route.name === 'todo') screen = <Tasks />;
    if (route.name === 'notice') screen = <Notice key={route.params.date || 'next'} />;
    if (route.name === 'settings') screen = <Settings />;
    if (route.name === 'roster') screen = <RosterSettings />;
    if (route.name === 'day') screen = <Day key={route.params.date} />;
    if (route.name === 'legacy') screen = <Legacy />;
    if (route.name === 'minutes') screen = <Minutes />;

    const titles = {
        today: [clock.label, `${data.profile.className || '학급을 아직 안 적었어요'} · ${clock.clock}`],
        attend: ['출결', `${data.profile.className || '우리 반'} · ${data.students.length || data.profile.classSize || 0}명`],
        students: ['학생 기록', data.profile.className || '번호순으로 볼 수 있어요'],
        student: ['학생', data.profile.className || ''],
        neis: ['나이스 모아 보기', '복사해서 옮긴 뒤 표시해 두세요'],
        schedule: ['일정', data.profile.className || ''],
        todo: ['할 일·메모', '오늘 할 일부터 보여 드려요'],
        notice: ['알림장', '복사해서 붙여 넣어요'],
        minutes: ['회의록', '여러 줄로 적고 저장 버튼으로 남겨요'],
        settings: ['설정', '학급, 소리, 단축키, 계정'],
        roster: ['명단', '번호에 이름을 적어 주세요'],
        day: ['그날의 일지', '나이스에 넣기 전에 이 날을 훑어 보세요'],
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
                <FuseBar />
                <aside className="side">
                    <div className="side-brand">
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '4px 8px 0' }}>
                            <Symbol />
                            <strong className="title-font" style={{ fontSize: 18, lineHeight: '24px' }}>쨈 교무수첩</strong>
                        </div>
                        <Motto />
                    </div>
                    <nav className="side-menu" aria-label="메뉴와 단축키">
                        {MENU.map(([label, href]) => {
                            const on = menuSelected(route.name, href);
                            const action = HOTKEY_ACTIONS.find((item) => item.group === '이동' && item.label === label);
                            const key = action && hotkeys[action.id] ? hotkeyLabel(hotkeys[action.id]) : '';
                            return (
                                <Btn key={label} block aria-current={on ? 'page' : undefined} aria-label={key ? `${label}, 단축키 ${key}` : label} className={on ? 'chip on' : 'chip'} onClick={() => go(menuTarget(href, clock.ymd))}>
                                    <span>{label}</span>{key && <span className="side-hotkey muted" aria-hidden="true">{key}</span>}
                                </Btn>
                            );
                        })}
                        {HOTKEY_ACTIONS.filter((action) => action.group !== '이동' && hotkeys[action.id]).map((action) => {
                            const key = hotkeyLabel(hotkeys[action.id]);
                            return (
                                <Btn key={action.id} block className="chip" aria-label={`${action.label}, 단축키 ${key}`} onClick={() => runHotkey(action.id)}>
                                    <span>{action.label}</span><span className="side-hotkey muted" aria-hidden="true">{key}</span>
                                </Btn>
                            );
                        })}
                    </nav>
                    <SideLinks />
                    <p className="muted" style={{ marginTop: 'auto', fontSize: 13, padding: 8 }}>{kokHotkeyHint(hotkeys)}</p>
                </aside>
                <div className="main">
                    {!cloudReady() && <p className="muted cloud-note">아직 클라우드 연결 전이에요. 이 기기에는 저장돼요.</p>}
                    {!online && cloudReady() && <p className="solid-card" style={{ padding: 12 }} role="status">인터넷이 끊겼어요. 적은 건 이 기기에 저장해 두고, 연결되면 선생님 자리에 올릴게요.</p>}
                    {data.profile.sharedPc && <p className="muted" style={{ marginTop: 0 }}>공용 컴퓨터 모드예요. 30분 동안 가만히 있으면 화면을 잠급니다.</p>}
                    <header className={`topbar${cloudReady() ? ' has-sync' : ''}${(['student', 'legacy', 'day', 'roster'].includes(route.name) || (route.name === 'settings' && route.params.sec)) ? ' has-back' : ''}`}>
                        {(route.name === 'student' || route.name === 'legacy' || route.name === 'day' || route.name === 'roster' || (route.name === 'settings' && route.params.sec)) && (
                            <Btn className="icon-btn" aria-label="뒤로" onClick={goBack}>‹</Btn>
                        )}
                        {route.name === 'today' ? (
                            <div className="date-block">
                                <span className="kicker">{clock.ymd.slice(0, 4)}년 {Number(clock.ymd.slice(5, 7))}월</span>
                                <h1 className="title-font date-line"><span>{Number(clock.ymd.slice(8, 10))}일</span><em className={todayRest.off ? 'day-rest-mark' : undefined}>{clock.weekday}요일</em></h1>
                                <p className="muted">{headingSub}</p>
                            </div>
                        ) : (
                            <div className="date-block">
                                <h1 className="title-font">{heading}</h1>
                                <p className="muted">{headingSub}</p>
                            </div>
                        )}
                        <div className="top-tools">
                            {route.name === 'today' && wideScreen && (
                                <Btn className={showBoard ? 'icon-btn is-on' : 'icon-btn'} aria-label={showBoard ? '기본 화면으로' : '위젯 화면으로'} aria-pressed={showBoard ? 'true' : 'false'} data-role="widget-toggle" onClick={() => setBoardOn(writeWidgetMode(!showBoard))}><IconWidgets /></Btn>
                            )}
                            <Btn className="icon-btn" aria-label="찾기" onClick={() => setSearch(true)}><IconSearch /></Btn>
                            <Btn className="icon-btn" aria-label={dark ? '밝게' : '어둡게'} onClick={() => {
                                const next = dark ? 'light' : 'dark';
                                import('./lib/db.js').then(({ patchProfile }) => patchProfile({ theme: next })).catch(() => {});
                            }}>{dark ? <IconSun /> : <IconMoon />}</Btn>
                            <Btn className={route.name === 'settings' || route.name === 'roster' ? 'icon-btn is-on' : 'icon-btn'} aria-label={gcalDot ? '설정, 구글 캘린더 다시 연결 필요' : '설정'} aria-pressed={route.name === 'settings' || route.name === 'roster'} onClick={() => go('#/settings')}><IconSettings /><GcalDot gcal={gcalSnap} /></Btn>
                            <Btn className="icon-btn" aria-label="메뉴" onClick={() => setMenu(true)}><IconMenu /></Btn>
                        </div>
                        {/* 동기화 칩: 도구 단추 아래 빈자리에 띄워 제목 높이를 늘리지 않습니다(시간표가 탭에 가리지 않게). */}
                        <SyncChip cloudReady={cloudReady()} signedIn={Boolean(data.auth?.uid)} online={online} guest={Boolean(data.profile.guest)} localOnly={['records', 'events', 'todos', 'notes', 'notices'].reduce((sum, name) => sum + (data.local?.[name]?.length || 0), 0)} />
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
                <TabBar routeName={route.name} ymd={clock.ymd} go={go} menuOpen={menu} onMenu={() => setMenu(true)} onCenter={(event) => openQuickBar(event)} />
                <Btn className="desk-fab foil-fab" aria-label="쨈 빠른 입력 열기" onPointerDown={(event) => pressDown(event.currentTarget)} onPointerUp={(event) => pressUp(event.currentTarget)} onPointerCancel={(event) => pressUp(event.currentTarget)} onKeyDown={(event) => { if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) pressDown(event.currentTarget); }} onKeyUp={(event) => { if (event.key === 'Enter' || event.key === ' ') pressUp(event.currentTarget); }} onClick={(event) => openQuickBar(event)}><JjaemJar /><span className="fab-txt" aria-hidden="true">쨈</span></Btn>
                <QuickBar open={quickOpen} invite={quickInvite} inputRef={quickInput} dateYmd={quickDate(route.name, route.params?.date)} onClose={closeQuickBar} />
                <TodoAlarm />
                {plus && (
                    <PlusSheet
                        startMore={plus === 'more'}
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
                                go('#/minutes/new');
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
                <p className="muted hotkey-defaults">기본 단축키: {defaultHotkeyRows().map((row) => `${row.key} ${row.label}`).join(' · ')}. 설정 › 단축키에서 ‘기본값으로 되돌리기’를 누르면 이대로 맞춰요.</p>
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
                        <Btn key={row.id} block className="chip" style={{ justifyContent: 'flex-start' }} onClick={() => { jump(`#/students/${row.no}`, { state: { appFrom: 'find' } }); onClose(); }}>{row.no}번 {row.name}</Btn>
                    ))}
                    {records.map((row) => (
                        <Btn key={row.id} block className="chip" style={{ justifyContent: 'flex-start' }} onClick={() => { jump(row.sid ? `#/students/${data.students.find((item) => item.id === row.sid)?.no || ''}` : '#/students', { state: { appFrom: 'find' } }); onClose(); }}>{row.text}</Btn>
                    ))}
                    {query && !students.length && !records.length && <p className="muted">찾는 말이 기록에 없어요.</p>}
                </div>
            </div>
        </div>
    );
}

