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
    /* 선생님 확정(11/6 08:25) 시안 B2: 손그림 스티커 느낌의 딸기쨈 병. 체크무늬 천 뚜껑과 리본, 흘러내리는 잼, 딸기 라벨, 흰 스티커 테두리, 작은 하트. */
    return (
        <span className="fab-disc jar-disc" aria-hidden="true">
            <span className="cup-squish">
                <svg className="jar-svg" viewBox="0 0 64 72" aria-hidden="true">
                    <defs>
                        <pattern id="tbj-gingham" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
                            <rect width="6" height="6" fill="#FFF6F2" />
                            <rect width="3" height="6" fill="#F28C9C" opacity=".75" />
                            <rect width="6" height="3" fill="#F28C9C" opacity=".75" />
                            <rect width="3" height="3" fill="#D9445E" />
                        </pattern>
                        <linearGradient id="tbj-jar-fill" x1="16" y1="28" x2="48" y2="64" gradientUnits="userSpaceOnUse"><stop offset="0" stopColor="#E8506A" /><stop offset=".5" stopColor="#C8304C" /><stop offset="1" stopColor="#9E1E38" /></linearGradient>
                    </defs>
                    {/* 흰 스티커 테두리 */}
                    <path d="M14 15c5-6 31-6 36 0 2.5 1.8 3 4 1.4 6.4 4.4 4.5 7 10.5 7 17.8C58.4 55 47 67 32 67S5.6 55 5.6 39.2c0-7.3 2.6-13.3 7-17.8-1.6-2.4-1.1-4.6 1.4-6.4z" fill="#fff" stroke="#fff" strokeWidth="4.5" strokeLinejoin="round" />
                    {/* 동그란 유리병 */}
                    <path d="M13.4 24.6C10 28.4 8.4 33.4 8.4 39.4 8.4 53.6 18.6 63.6 32 63.6S55.6 53.6 55.6 39.4c0-6-1.6-11-5-14.8z" fill="#FFF8F6" stroke="#3A2A2C" strokeWidth="2" strokeLinejoin="round" />
                    {/* 잼 */}
                    <path d="M11.6 34.2c3.4-1.8 6.2-.6 9.4-1.6 3.6-1.1 6.6.9 10.4-.2 4-1.2 7.4.8 11 0 3.2-.7 6.2-.4 9.4 1.6.6 1.6.9 3.4.9 5.4 0 12.2-8.6 21-20.7 21S11.3 51.8 11.3 39.6c0-2 .1-3.8.3-5.4z" fill="url(#tbj-jar-fill)" />
                    <g fill="#FFC870"><ellipse cx="19" cy="40" rx="1.1" ry=".75" /><ellipse cx="45" cy="41" rx="1.1" ry=".75" /><ellipse cx="22" cy="53" rx="1" ry=".7" /><ellipse cx="43" cy="53" rx="1" ry=".7" /><ellipse cx="16.5" cy="47" rx=".9" ry=".65" /></g>
                    {/* 유리 빛 */}
                    <path d="M14.6 31c-2.4 4.4-2.8 10-1.2 14.6" stroke="#fff" strokeWidth="2" strokeLinecap="round" opacity=".85" fill="none" />
                    {/* 딸기 라벨 */}
                    <path d="M20.2 41.4h23.6l1.4 1.6v9.2l-1.4 1.6H20.2l-1.4-1.6V43z" fill="#FFF0D6" stroke="#3A2A2C" strokeWidth="1.3" strokeLinejoin="round" />
                    <path d="M32 52.6c2.8 0 4.4-2.4 4.4-4.6 0-1.9-1.7-3-4.4-3s-4.4 1.1-4.4 3c0 2.2 1.6 4.6 4.4 4.6z" fill="#E0405C" stroke="#9E1E38" strokeWidth=".6" />
                    <path d="M29.6 45.2c.8-1.3 1.6-1.3 2.4-.3.8-1 1.6-1 2.4.3-.9.5-1.7.4-2.4.2-.7.2-1.5.3-2.4-.2z" fill="#4E9A52" />
                    <g fill="#FFE29A"><circle cx="30.6" cy="47.6" r=".45" /><circle cx="33.4" cy="47.8" r=".45" /><circle cx="32" cy="50" r=".45" /></g>
                    {/* 체크무늬 천 뚜껑 (주름진 끝) */}
                    <path data-part="gingham" d="M15 12.4c4.6-5 29.4-5 34 0 1.6 1.7 1.6 3.8.4 5.6 1.4 1.4 3 2.9 3.4 4.6.4 1.6-.9 2.4-2.2 1.9-1.4 1.6-3.2 1.8-4.6.6-1.6 1.6-3.8 1.6-5.2.2-1.8 1.6-4.2 1.6-5.8.1-1.6 1.5-4 1.5-5.6 0-1.6 1.5-4 1.5-5.8-.1-1.4 1.4-3.6 1.4-5.2-.2-1.4 1.2-3.2 1-4.6-.6-1.3.5-2.6-.3-2.2-1.9.4-1.7 2-3.2 3.4-4.6-1.2-1.8-1.2-3.9.4-5.6z" fill="url(#tbj-gingham)" stroke="#3A2A2C" strokeWidth="1.8" strokeLinejoin="round" />
                    {/* 흘러내리는 잼 두 줄기 */}
                    <path d="M22 25.4c.4 2.6-.2 5 1 6.4 1.2 1.4 3 .4 2.8-1.6-.2-2-.2-3.4.2-4.8z" fill="#C8304C" stroke="#3A2A2C" strokeWidth="1" strokeLinejoin="round" />
                    <path d="M35.6 25.8c.2 3.4-.4 7 .8 8.8 1.2 1.8 3.4.8 3.2-1.4-.2-2.4-.4-5 0-7.4z" fill="#C8304C" stroke="#3A2A2C" strokeWidth="1" strokeLinejoin="round" />
                    <circle cx="37.6" cy="30" r=".55" fill="#fff" opacity=".8" />
                    {/* 끈과 리본 */}
                    <path d="M13.6 19.2c6 1.8 30.8 1.8 36.8 0" stroke="#D9445E" strokeWidth="1.4" strokeLinecap="round" fill="none" />
                    <path d="M44 19.6c-2.6-2.6-5.6-2-5 .4.6 2 3.2 1.4 5-.4zm0 0c2.4-2.8 5.6-2.4 5.2 0-.4 2.2-3.2 1.8-5.2 0zm0 0l-2 5.4m2-5.4l2.8 5" stroke="#D9445E" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" fill="#F7A8B4" />
                    {/* 작은 하트 */}
                    <path d="M58.4 11.4c-.6-1.4-2.6-1-2.4.6.2 1.2 2.4 2.6 2.4 2.6s2.2-1.4 2.4-2.6c.2-1.6-1.8-2-2.4-.6z" fill="none" stroke="#E0405C" strokeWidth="1" strokeLinejoin="round" />
                    <path d="M5 13c-.5-1.1-2.1-.8-1.9.5.1 1 1.9 2.1 1.9 2.1s1.8-1.1 1.9-2.1c.2-1.3-1.4-1.6-1.9-.5z" fill="none" stroke="#E0405C" strokeWidth=".9" strokeLinejoin="round" />
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
