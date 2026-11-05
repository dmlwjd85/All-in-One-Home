import { useEffect, useRef, useState } from 'react';
import { Btn } from './bits.jsx';
import { menuSelected, menuTarget } from './menu.js';
import { jamFeelEnabled as pressFeelOn, playJam as playPress, pressDown, pressUp, vibratePress } from './pressFeel.js';
import { DEFAULT_ORDER, SIDE_COUNT, TAB_EVENT, TAB_POOL, TAB_KEY, loadTabOrder, moveTab, pickTab, saveTabOrder, tabById } from './tabSlots.js';
import './tabbar.css';

/** 길게 누르는 시간(ms). 짧게 누르면 그 화면으로 갑니다. */
export const HOLD_MS = 520;
const MOVE_PX = 10;

/* 시안 A 젤리 스티커 아이콘(24칸). 색은 위쪽 공용 그라디언트(tbj-pink)를 씁니다. */
const ICONS = {
    today: <><path d="M4 11l8-7 8 7v8a2 2 0 01-2 2h-4v-5H10v5H6a2 2 0 01-2-2v-8z" fill="url(#tbj-pink)" /><circle cx="12" cy="13" r="2" fill="#fff" /></>,
    todo: <><rect x="5" y="4" width="14" height="16" rx="2" fill="url(#tbj-pink)" /><path d="M8 9h8M8 13h6" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></>,
    attend: <><circle cx="12" cy="9" r="4" fill="url(#tbj-pink)" /><path d="M5 19c1.5-3 4-4.5 7-4.5S17.5 16 19 19" stroke="url(#tbj-pink)" strokeWidth="2.4" strokeLinecap="round" /></>,
    schedule: <><rect x="4" y="5" width="16" height="15" rx="2" fill="url(#tbj-pink)" /><path d="M8 3v4M16 3v4M4 10h16" stroke="#fff" strokeWidth="2" strokeLinecap="round" /></>,
    students: <><path d="M6 4h9l5 5v11a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2z" fill="url(#tbj-pink)" /><path d="M14 4v5h5" stroke="#fff" strokeWidth="1.8" /></>,
    more: <><circle cx="6" cy="12" r="2.2" fill="url(#tbj-pink)" /><circle cx="12" cy="12" r="2.2" fill="url(#tbj-pink)" /><circle cx="18" cy="12" r="2.2" fill="url(#tbj-pink)" /></>,
    minutes: <><rect x="4" y="4" width="16" height="16" rx="3" fill="url(#tbj-pink)" /><path d="M8 9h8M8 12h8M8 15h5" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" /></>,
    notice: <><path d="M12 4a5 5 0 00-5 5v4l-2 3h14l-2-3V9a5 5 0 00-5-5z" fill="url(#tbj-pink)" /><circle cx="12" cy="19" r="1.8" fill="url(#tbj-pink)" /></>,
    neis: <><rect x="4" y="5" width="16" height="14" rx="2" fill="url(#tbj-pink)" /><path d="M8 10l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" /></>,
    settings: <><circle cx="12" cy="12" r="7" fill="url(#tbj-pink)" /><circle cx="12" cy="12" r="2.6" fill="#fff" /></>,
};

function TabIcon({ id }) {
    return <svg className="tbj-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">{ICONS[id]}</svg>;
}

/** 시안 C 가운데 쨈: 딸기쨈 병(주름 천 뚜껑·유리 반짝임·알갱이 쨈·딸기 라벨). 글자 「쨈」은 아래에 따로 씁니다. */
export function JjaemJar() {
    return (
        <span className="fab-disc jar-disc" aria-hidden="true">
            <span className="cup-squish">
                <svg className="jar-svg" viewBox="0 0 64 72" aria-hidden="true">
                    <defs>
                        <linearGradient id="tbj-jar-fill" x1="18" y1="22" x2="46" y2="58" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#F27890" /><stop offset=".42" stopColor="#E05A72" /><stop offset="1" stopColor="#B23552" /></linearGradient>
                        <linearGradient id="tbj-jar-lid" x1="14" y1="4" x2="50" y2="18" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#FFE69A" /><stop offset=".45" stopColor="#FFD45E" /><stop offset="1" stopColor="#E0B038" /></linearGradient>
                        <linearGradient id="tbj-jar-hi" x1="20" y1="20" x2="30" y2="60" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#fff" stopOpacity=".9" /><stop offset=".5" stopColor="#fff" stopOpacity=".28" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
                    </defs>
                    <path d="M17.5 22.2c0-3.4 2.6-5.8 6-5.8h17c3.4 0 6 2.4 6 5.8v3.8c0 2.4 2.4 4 2.4 7v20.8c0 5.4-4 8.7-9.2 8.7H24.3c-5.2 0-9.2-3.3-9.2-8.7V33c0-3 2.4-4.6 2.4-7z" fill="#FFFCFA" stroke="#E9DED6" strokeWidth="2.4" strokeLinejoin="round" />
                    <path d="M20.4 33h23.2v19.6c0 3.6-2.5 5.8-6 5.8H26.4c-3.5 0-6-2.2-6-5.8z" fill="url(#tbj-jar-fill)" />
                    {/* 병 입구에서 둥글게 흘러내리는 쨈 */}
                    <path d="M18.8 24.2h26.4v3.3c0 1.2-.9 1.8-2 1.8-1 0-1.7.7-1.7 1.8v2.2a2 2 0 01-4 0v-2.6c0-1-.7-1.6-1.6-1.6-1 0-1.6.6-1.6 1.5a1.7 1.7 0 01-3.4 0c0-.9-.7-1.5-1.6-1.5-1 0-1.7.7-1.7 1.7v1.6a2 2 0 01-4 0v-1.6c0-1-.7-1.7-1.7-1.7-1.1 0-2-.6-2-1.8z" fill="url(#tbj-jar-fill)" />
                    <ellipse cx="25" cy="39" rx="1.6" ry="1" fill="#FFE08A" transform="rotate(-20 25 39)" />
                    <ellipse cx="32.2" cy="42.6" rx="1.45" ry=".9" fill="#FFF1A8" transform="rotate(24 32.2 42.6)" />
                    <ellipse cx="39.2" cy="38" rx="1.5" ry=".95" fill="#FFE08A" transform="rotate(10 39.2 38)" />
                    <ellipse cx="28.2" cy="46.5" rx="1.35" ry=".85" fill="#FFD45E" transform="rotate(-30 28.2 46.5)" />
                    <ellipse cx="37" cy="45.5" rx="1.4" ry=".88" fill="#FFF1A8" transform="rotate(28 37 45.5)" />
                    <path d="M22 26c1.4 0 2.4.8 2.6 2.2.6 4.2.2 10.2-.6 15.4-.3 1.8-1.4 2.6-2.6 2.2-1.1-.4-1.6-1.5-1.4-3 .6-5.2 1.2-11.2.6-15.2-.2-1.2.4-1.6 1.4-1.6z" fill="url(#tbj-jar-hi)" />
                    <rect x="13.5" y="5" width="37" height="13.2" rx="5.5" fill="#FFD45E" stroke="#fff" strokeWidth="2.2" />
                    <rect x="13.5" y="5" width="37" height="13.2" rx="5.5" fill="url(#tbj-jar-lid)" />
                    <path d="M16.5 15.8c2.4 1 5.2.85 7.8-.15 2.7-1 4.5-1 7.2-.05 2.8 1 5.4.95 8 .1 2.5-.8 5.3-.7 7.7.2" stroke="#B88820" strokeWidth="1.25" strokeLinecap="round" opacity=".65" fill="none" />
                    <path d="M18.8 9c1.7 2 3.5 2.1 5.2.2M25.6 8.2c1.7 2.3 3.8 2.4 5.6.15M33 8.3c1.7 2.1 3.9 2.2 5.7.2M40.4 9c1.3 1.6 2.8 1.7 4.3.15" stroke="#C99828" strokeWidth="1.3" strokeLinecap="round" opacity=".72" fill="none" />
                    <path d="M17.8 7.8c5-1.8 11.5-2.2 17.2-1.8 4.6.3 8.8 1.2 12 2.4" stroke="#fff" strokeWidth="1.35" strokeLinecap="round" opacity=".6" fill="none" />
                    <rect x="18.5" y="49" width="27" height="12.2" rx="3.5" fill="#FFF4CF" stroke="#E9DED6" strokeWidth="1.2" />
                    <g transform="translate(27.6 50.8) scale(1.05)">
                        <path d="M4.2 9.4c2.7 0 4.8-2.5 4.8-4.8C9 2.3 7.1.6 4.2.6S-.6 2.3-.6 4.6c0 2.3 2.1 4.8 4.8 4.8z" fill="#E05A72" />
                        <ellipse cx="2.7" cy="4.1" rx=".55" ry=".4" fill="#FFE08A" />
                        <ellipse cx="5.5" cy="5.2" rx=".5" ry=".38" fill="#FFF1A8" />
                        <path d="M1.5 1.2c.75-1 2.15-1 3-.2.75-.85 2.15-.85 2.9.15-1 .35-1.85.3-2.9.05-.95.2-2 .3-3 0z" fill="#6BA86A" />
                    </g>
                </svg>
            </span>
        </span>
    );
}

function isOn(id, routeName, menuOpen) {
    if (id === 'more') return menuOpen;
    const tab = tabById(id);
    return Boolean(tab?.href) && menuSelected(routeName, tab.href);
}

/** 탭 하나: 짧게 누르면 이동, 길게(0.52초) 누르면 배치 바꾸기 시트. 손을 10px 넘게 움직이면 길게 누르기를 그만둡니다. */
function SideTab({ id, on, onGo, onHold }) {
    const tab = tabById(id);
    const timer = useRef(0);
    const held = useRef(false);
    const start = useRef(null);
    const clear = () => { clearTimeout(timer.current); timer.current = 0; };
    useEffect(() => clear, []);
    return (
        <Btn
            className={`tab-jelly${on ? ' is-on' : ''}`}
            aria-current={on && id !== 'more' ? 'page' : undefined}
            aria-expanded={id === 'more' ? on : undefined}
            aria-label={tab.label}
            aria-describedby="tbj-hold-hint"
            data-tab={id}
            onPointerDown={(event) => {
                if (event.button !== 0) return;
                held.current = false;
                start.current = { x: event.clientX, y: event.clientY };
                event.currentTarget.classList.add('is-squish');
                /* 기본 키감 소리 대신 짧은 '톡'과 12ms 진동(손맛 설정이 켜졌을 때만). 꺼져 있으면 기존 키감 소리가 그대로 납니다. */
                if (pressFeelOn()) { playPress('tok'); vibratePress(); }
                clear();
                timer.current = setTimeout(() => { held.current = true; vibratePress(); onHold(); }, HOLD_MS);
            }}
            onPointerMove={(event) => {
                if (!start.current) return;
                if (Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > MOVE_PX) clear();
            }}
            onPointerUp={(event) => { clear(); start.current = null; event.currentTarget.classList.remove('is-squish'); }}
            onPointerCancel={(event) => { clear(); start.current = null; event.currentTarget.classList.remove('is-squish'); }}
            onPointerLeave={(event) => { clear(); event.currentTarget.classList.remove('is-squish'); }}
            onContextMenu={(event) => {
                /* 휴대폰 길게 누르기의 기본 메뉴를 막고, 키보드 메뉴 키(Shift+F10)로도 배치 바꾸기를 엽니다. */
                event.preventDefault();
                if (!held.current) { clear(); held.current = true; onHold(); }
            }}
            onClick={(event) => {
                if (held.current) { held.current = false; event.preventDefault(); return; }
                onGo(tab);
            }}
        >
            <span className="tbj-ico" aria-hidden="true"><span className="tbj-sticker"><TabIcon id={id} /></span></span>
            <span className="tbj-label" aria-hidden="true">{tab.label}</span>
        </Btn>
    );
}

export function TabBar({ routeName, ymd, go, menuOpen, onMenu, onCenter }) {
    const [order, setOrder] = useState(() => loadTabOrder());
    const [editing, setEditing] = useState(false);
    const nav = useRef(null);
    useEffect(() => {
        const sync = () => setOrder(loadTabOrder());
        const onStorage = (event) => { if (!event.key || event.key === TAB_KEY) sync(); };
        window.addEventListener(TAB_EVENT, sync);
        window.addEventListener('storage', onStorage);
        return () => { window.removeEventListener(TAB_EVENT, sync); window.removeEventListener('storage', onStorage); };
    }, []);
    /* 글자를 키우면 탭바가 높아지므로, 본문 아래 여백이 그 높이를 따라가게 --tabbar-h 를 적어 둡니다. */
    useEffect(() => {
        const el = nav.current;
        if (!el || typeof ResizeObserver === 'undefined') return undefined;
        const ro = new ResizeObserver(() => document.documentElement.style.setProperty('--tabbar-h', `${Math.ceil(el.getBoundingClientRect().height)}px`));
        ro.observe(el);
        return () => { ro.disconnect(); document.documentElement.style.removeProperty('--tabbar-h'); };
    }, []);
    const goTab = (tab) => {
        if (!tab.href) { onMenu(); return; }
        go(menuTarget(tab.href, ymd));
    };
    const side = (ids) => ids.map((id) => <SideTab key={id} id={id} on={isOn(id, routeName, menuOpen)} onGo={goTab} onHold={() => setEditing(true)} />);
    const centerKeys = {
        onPointerDown: (event) => pressDown(event.currentTarget),
        onPointerUp: (event) => pressUp(event.currentTarget),
        onPointerCancel: (event) => pressUp(event.currentTarget),
        onKeyDown: (event) => { if (!event.repeat && (event.key === 'Enter' || event.key === ' ')) pressDown(event.currentTarget); },
        onKeyUp: (event) => { if (event.key === 'Enter' || event.key === ' ') pressUp(event.currentTarget); },
    };
    return (
        <>
            <nav ref={nav} className="tabbar tabbar-jelly" aria-label="주요 메뉴">
                <svg className="tbj-defs" width="0" height="0" aria-hidden="true" focusable="false">
                    <defs>
                        <linearGradient id="tbj-pink" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0" stopColor="#FFB8C8" /><stop offset=".4" stopColor="#F07088" /><stop offset=".75" stopColor="#D04560" /><stop offset="1" stopColor="#8F2438" />
                        </linearGradient>
                    </defs>
                </svg>
                <span id="tbj-hold-hint" hidden>길게 누르면 탭 배치를 바꿀 수 있어요.</span>
                {side(order.slice(0, 3))}
                <Btn className="fab foil-fab tbj-mid" aria-label="쨈 빠른 입력 열기" {...centerKeys} onClick={onCenter}><JjaemJar /><span className="fab-txt" aria-hidden="true">쨈</span></Btn>
                {side(order.slice(3, SIDE_COUNT))}
            </nav>
            {editing && <TabPickSheet order={order} onClose={() => setEditing(false)} onSave={(next) => { setOrder(saveTabOrder(next)); setEditing(false); }} />}
        </>
    );
}

const SLOT_NAMES = ['왼쪽 첫째', '왼쪽 둘째', '왼쪽 셋째', '오른쪽 첫째', '오른쪽 둘째', '오른쪽 셋째'];

/** 탭 고르기 시트: 칸마다 탭을 고르고(겹치면 맞바꿈) 옆으로 옮긴 뒤 저장합니다. 가운데 쨈은 늘 그 자리입니다. */
export function TabPickSheet({ order, onClose, onSave }) {
    const [draft, setDraft] = useState(order);
    useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet tbj-sheet" role="dialog" aria-modal="true" aria-labelledby="tbj-sheet-title" onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                <h2 id="tbj-sheet-title" className="title-font" style={{ marginTop: 0 }}>탭 배치 바꾸기</h2>
                <p className="muted" style={{ marginTop: 0 }}>가운데 쨈은 그대로 두고, 양옆 여섯 칸을 골라요.</p>
                <ol className="tbj-slots">
                    {draft.map((id, slot) => (
                        <li key={SLOT_NAMES[slot]} className="tbj-slot">
                            <label className="tbj-slot-name" htmlFor={`tbj-slot-${slot}`}>{SLOT_NAMES[slot]}</label>
                            <select id={`tbj-slot-${slot}`} className="field tbj-select" value={id} onChange={(event) => setDraft(pickTab(draft, slot, event.target.value))}>
                                {TAB_POOL.map((tab) => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
                            </select>
                            <Btn className="icon-btn" aria-label={`${SLOT_NAMES[slot]} 칸을 앞으로`} disabled={slot === 0} onClick={() => setDraft(moveTab(draft, slot, -1))}>‹</Btn>
                            <Btn className="icon-btn" aria-label={`${SLOT_NAMES[slot]} 칸을 뒤로`} disabled={slot === SIDE_COUNT - 1} onClick={() => setDraft(moveTab(draft, slot, 1))}>›</Btn>
                        </li>
                    ))}
                </ol>
                <div className="tbj-foot">
                    <Btn className="chip" onClick={() => setDraft([...DEFAULT_ORDER])}>기본 배치</Btn>
                    <Btn className="chip" onClick={onClose}>닫기</Btn>
                    <Btn className="primary-btn" onClick={() => onSave(draft)}>저장</Btn>
                </div>
            </div>
        </div>
    );
}
