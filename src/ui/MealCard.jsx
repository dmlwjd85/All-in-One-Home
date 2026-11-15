import { useEffect, useState } from 'react';
import { addDaysYmd } from '../lib/date.js';
import { mealCodesShown, mealSummary, mealsFromNotes } from '../lib/mealPaste.js';
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
                    {day.items.map((item) => (
                        <li key={`${item.name}-${item.codes}`} style={{ overflowWrap: 'anywhere' }}>
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
