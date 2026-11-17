import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { addDaysYmd } from '../lib/date.js';
import { mealCodesShown, mealSummary, mealTray, mealsFromNotes, trayKind, trayToCells, trayToItems } from '../lib/mealPaste.js';
import { saveMealDay } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Btn } from './bits.jsx';
import { FoldCard } from './Fold.jsx';

/** 오늘 화면의 급식 카드. 주말·휴일·메뉴 없는 날은 숨깁니다. */
export function MealCard({ notes, today, hidden }) {
    const map = mealsFromNotes(notes);
    const todayMeal = map[today];
    const [cursor, setCursor] = useState(today);
    const [showCodes, setShowCodes] = useState(() => mealCodesShown(globalThis.localStorage));
    useEffect(() => {
        const sync = () => setShowCodes(mealCodesShown(globalThis.localStorage));
        window.addEventListener('ssug-meal-codes', sync);
        return () => window.removeEventListener('ssug-meal-codes', sync);
    }, []);
    useEffect(() => { setCursor(today); }, [today]);
    if (hidden || !todayMeal?.items?.length) return null;
    const day = map[cursor];
    const summary = mealSummary(todayMeal);
    return (
        <FoldCard id="meal" className="home-meal" title="오늘 급식" summary={summary}>
            <div className="fold-hide" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <h3 style={{ margin: 0, fontSize: 16 }}>오늘 급식</h3>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 8 }}>
                <Btn className="chip" aria-label="이전 날 급식" onClick={() => setCursor((value) => addDaysYmd(value, -1))}>이전</Btn>
                <strong>{Number(cursor.slice(5, 7))}/{Number(cursor.slice(8, 10))}{cursor === today ? ' 오늘' : ''}</strong>
                <Btn className="chip" aria-label="다음 날 급식" onClick={() => setCursor((value) => addDaysYmd(value, 1))}>다음</Btn>
            </div>
            {day?.items?.length ? (
                <ul className="meal-menu" style={{ margin: '8px 0 0', paddingLeft: 18 }}>
                    {day.items.map((item, index) => (
                        <li key={`${day.date}-${index}`} style={{ overflowWrap: 'anywhere' }}>
                            {item.name}
                            {showCodes && item.codes ? <span className="meal-code">{item.codes}</span> : null}
                        </li>
                    ))}
                </ul>
            ) : <p className="muted" style={{ margin: '8px 0 0' }}>이 날은 적힌 메뉴가 없어요.</p>}
            {day?.kcal ? <p className="muted" style={{ margin: '6px 0 0' }}>{day.kcal} kcal</p> : null}
        </FoldCard>
    );
}

/** 하루·한 주 화면에서 그날 메뉴 한 줄. 없으면 null. */
export function MealLine({ notes, date, showCodes }) {
    const day = mealsFromNotes(notes)[date];
    if (!day?.items?.length) return null;
    const codesOn = showCodes ?? mealCodesShown(globalThis.localStorage);
    return (
        <p className="meal-menu muted" data-meal={date} style={{ margin: '4px 0 0', overflowWrap: 'anywhere' }}>
            급식 {day.items.map((item) => (codesOn && item.codes ? `${item.name} ${item.codes}` : item.name)).join(' · ')}
        </p>
    );
}

/** 하루 화면의 급식 칸. 그날 메뉴를 한 줄씩 보여 줍니다. 메뉴가 없는 날은 칸을 두지 않습니다. */
export function MealDay({ notes, date }) {
    const day = mealsFromNotes(notes)[date];
    const [showCodes, setShowCodes] = useState(() => mealCodesShown(globalThis.localStorage));
    useEffect(() => {
        const sync = () => setShowCodes(mealCodesShown(globalThis.localStorage));
        window.addEventListener('ssug-meal-codes', sync);
        return () => window.removeEventListener('ssug-meal-codes', sync);
    }, []);
    if (!day?.items?.length) return null;
    return (
        <section className="glass" data-meal={date} style={{ padding: 14 }}>
            <h2 className="title-font" style={{ marginTop: 0 }}>급식</h2>
            <ul className="meal-menu" style={{ margin: 0, paddingLeft: 18 }}>
                {day.items.map((item, index) => (
                    <li key={`${index}-${item.name}`} style={{ overflowWrap: 'anywhere' }}>
                        {item.name}
                        {showCodes && item.codes ? <span className="meal-code">{item.codes}</span> : null}
                    </li>
                ))}
            </ul>
            {day.kcal ? <p className="muted" style={{ margin: '6px 0 0' }}>{day.kcal} kcal</p> : null}
        </section>
    );
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function dayLabel(ymd, today) {
    const week = WEEK[new Date(`${ymd}T00:00:00`).getDay()];
    return `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일 ${week}요일${ymd === today ? ' · 오늘' : ''}`;
}

function TrayCell({ items, label, showCodes, big = false, slot }) {
    return (
        <div className={big ? 'tray-cell is-big' : 'tray-cell'} data-tray={slot}>
            <span className="tray-label">{label}</span>
            {items.length ? items.map((item, index) => (
                <span key={`${index}-${item.name}`} className="tray-food">
                    {item.name}
                    {showCodes && item.codes ? <span className="meal-code">{item.codes}</span> : null}
                </span>
            )) : <span className="tray-empty" aria-hidden="true" />}
        </div>
    );
}

/** 스테인리스 급식판: 위 4칸(김치부터 반찬), 아래 2칸(왼쪽 밥, 오른쪽 국). */
export function MealTray({ day, showCodes }) {
    const tray = mealTray(day?.items || []);
    return (
        <div className="meal-tray" data-role="meal-tray" role="group" aria-label="급식판">
            <div className="tray-row tray-top">
                {tray.top.map((items, index) => <TrayCell key={index} slot={`top${index + 1}`} items={items} label={trayKind(items[0]?.name) === 'kimchi' ? '김치' : '반찬'} showCodes={showCodes} />)}
            </div>
            <div className="tray-row tray-bottom">
                <TrayCell slot="rice" big items={tray.rice} label="밥" showCodes={showCodes} />
                <TrayCell slot="soup" big items={tray.soup} label="국" showCodes={showCodes} />
            </div>
        </div>
    );
}

/** '오늘 급식' 단추. 누르면 급식판 팝업이 뜹니다. 출결·과제 단추 옆에 둡니다. */
export function MealButton({ notes, today, className = 'chip' }) {
    const [open, setOpen] = useState(false);
    return (
        <>
            <Btn className={className} data-role="meal-open" aria-haspopup="dialog" onClick={() => setOpen(true)}>오늘 급식</Btn>
            {open ? <MealPopup notes={notes} today={today} onClose={() => setOpen(false)} /> : null}
        </>
    );
}

const EDIT_CELLS = [['top1', '위 1'], ['top2', '위 2'], ['top3', '위 3'], ['top4', '위 4']];

/** 급식판 고치기: 칸을 눌러 바로 고칩니다. 한 줄에 메뉴 하나. 옮기려면 지우고 다른 칸에 적습니다. */
function MealTrayEdit({ cells, onChange }) {
    const cell = (slot, label, big = false) => (
        <label key={slot} className={big ? 'tray-cell is-big is-edit' : 'tray-cell is-edit'}>
            <span className="tray-label">{label}</span>
            <textarea className="tray-input" data-tray-input={slot} rows={big ? 3 : 3} value={cells[slot]} aria-label={`${label} 칸 메뉴`} onChange={(event) => onChange({ ...cells, [slot]: event.target.value })} />
        </label>
    );
    return (
        <div className="meal-tray" data-role="meal-tray-edit" role="group" aria-label="급식판 고치기">
            <div className="tray-row tray-top">{EDIT_CELLS.map(([slot, label]) => cell(slot, label))}</div>
            <div className="tray-row tray-bottom">{cell('rice', '밥', true)}{cell('soup', '국', true)}</div>
        </div>
    );
}

function MealPopup({ notes, today, onClose }) {
    const { showToast, openPlus } = useUi();
    const map = mealsFromNotes(notes);
    const [cursor, setCursor] = useState(today);
    const [cells, setCells] = useState(null);
    const [saving, setSaving] = useState(false);
    async function saveEdit() {
        if (saving) return;
        setSaving(true);
        const before = map[cursor];
        const result = await saveMealDay(cursor, trayToItems(cells, before?.items), { kcal: before?.kcal || '', origin: before?.origin || '' });
        setSaving(false);
        if (!result.ok) { if (result.message) showToast(result.message); return; }
        showToast(result.message, true);
        setCells(null);
    }
    const [showCodes] = useState(() => mealCodesShown(globalThis.localStorage));
    useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape' && !cells) onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose, cells]);
    const day = map[cursor];
    const dates = Object.keys(map).sort();
    /* 이전·다음은 급식이 있는 날로 건너뜁니다. 없으면 하루씩 움직입니다. */
    const prev = [...dates].reverse().find((date) => date < cursor) || addDaysYmd(cursor, -1);
    const next = dates.find((date) => date > cursor) || addDaysYmd(cursor, 1);
    return createPortal(
        <div className="sheet-back meal-pop-back" onClick={() => { if (!cells) onClose(); }}>
            <div className="meal-pop" role="dialog" aria-modal="true" aria-label="급식" data-role="meal-pop" onClick={(event) => event.stopPropagation()}>
                <div className="meal-pop-head">
                    <Btn className="chip" aria-label="이전 급식" disabled={Boolean(cells)} onClick={() => setCursor(prev)}>‹ 이전</Btn>
                    <strong className="title-font meal-pop-date">{dayLabel(cursor, today)}</strong>
                    <Btn className="chip" aria-label="다음 급식" disabled={Boolean(cells)} onClick={() => setCursor(next)}>다음 ›</Btn>
                </div>
                {cells ? (
                    <>
                        <MealTrayEdit cells={cells} onChange={setCells} />
                        <p className="muted meal-pop-kcal" style={{ textAlign: 'left' }}>칸을 눌러 고쳐요. 한 줄에 메뉴 하나예요. 옮기려면 지우고 다른 칸에 적어 주세요.</p>
                    </>
                ) : day?.items?.length ? <MealTray day={day} showCodes={showCodes} /> : (
                    <div className="meal-tray is-empty" data-role="meal-tray-empty">
                        <p>{dates.length ? '이 날은 적힌 메뉴가 없어요.' : '아직 넣은 급식표가 없어요. 아래 「급식표 넣기」에서 사진·한글·PDF 파일로 넣어 주세요.'}</p>
                    </div>
                )}
                {!cells && day?.kcal ? <p className="muted meal-pop-kcal">{day.kcal} kcal</p> : null}
                {cells ? (
                    <div className="meal-pop-foot">
                        <Btn className="chip" onClick={() => setCells(null)}>그만두기</Btn>
                        <Btn className="primary-btn" data-role="meal-save" aria-busy={saving} onClick={saveEdit}>저장</Btn>
                    </div>
                ) : (
                    <div className="meal-pop-foot">
                        {cursor !== today ? <Btn className="chip" onClick={() => setCursor(today)}>오늘로</Btn> : null}
                        <Btn className="chip" data-role="meal-add" onClick={() => { onClose(); openPlus?.({ meal: true }); }}>📎 급식표 넣기</Btn>
                        <Btn className="chip" data-role="meal-edit" onClick={() => setCells(trayToCells(day?.items || []))}>고치기</Btn>
                        <Btn className="primary-btn" data-role="meal-close" onClick={onClose}>닫기</Btn>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}
