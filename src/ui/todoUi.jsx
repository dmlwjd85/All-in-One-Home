import { useState } from 'react';
import { PRIORITIES, SORT_KEY, SORTS, badgeOn, doneCount, normalizeGoals, normalizeSort, priLabel, priOf } from '../lib/todoAchieve.js';
import { Btn } from './bits.jsx';

/** 목록에서 제목 앞 작은 중요도 막대(낮음 1칸 · 보통 2칸 · 높음 3칸). 화면 읽기에는 글자로 알립니다. */
export function PriMark({ row }) {
    const p = priOf(row);
    return (
        <span className="pri-mark" data-pri={p} role="img" aria-label={`중요도 ${priLabel(p)}`} title={`중요도 ${priLabel(p)}`}>
            <i className={p >= 1 ? 'on' : ''} /><i className={p >= 2 ? 'on' : ''} /><i className={p >= 3 ? 'on' : ''} />
        </span>
    );
}

/** 입력·고치기에서 한 번 누르는 중요도 타일 3개. */
export function PriPicks({ value, onPick, idBase = 'pri' }) {
    return (
        <div className="pri-picks" role="group" aria-label="중요도" data-role={`${idBase}-picks`}>
            {PRIORITIES.map((item) => (
                <Btn key={item.id} type="button" className={value === item.id ? 'choice-tile on' : 'choice-tile'} aria-pressed={value === item.id} data-pri-pick={item.id} onClick={() => onPick(item.id)}>
                    <PriMark row={{ pri: item.id }} />
                    <span>{item.label}</span>
                </Btn>
            ))}
        </div>
    );
}

function readSort() {
    try { return normalizeSort(localStorage.getItem(SORT_KEY)); } catch { return 'dday'; }
}

/** 정렬 선택(D-day순·중요도순). 이 기기에 기억합니다. */
export function useTodoSort() {
    const [sort, setSort] = useState(readSort);
    const pick = (next) => {
        const clean = normalizeSort(next);
        setSort(clean);
        try { localStorage.setItem(SORT_KEY, clean); } catch { /* 저장이 막혀도 이번 화면은 바뀝니다. */ }
    };
    return [sort, pick];
}

export function SortToggle({ sort, onPick }) {
    return (
        <div className="todo-sort" role="group" aria-label="할 일 정렬">
            {SORTS.map((item) => (
                <Btn key={item.id} className={sort === item.id ? 'choice-tile on' : 'choice-tile'} aria-pressed={sort === item.id} data-sort={item.id} onClick={() => onPick(item.id)}>{item.label}</Btn>
            ))}
        </div>
    );
}

/** 오늘 목표 진행(끝낸 수/목표). 목표가 꺼져 있으면 보이지 않습니다. */
export function GoalMeter({ goals, todos, today }) {
    const g = normalizeGoals(goals);
    if (!g.n) return null;
    const c = doneCount(todos, today);
    const hit = badgeOn(g.days[today]);
    const pips = Math.min(g.n, 10);
    return (
        <span className={hit ? 'goal-meter is-hit' : 'goal-meter'} data-role="goal-meter" aria-label={`오늘 목표 ${g.n}개 중 ${Math.min(c, 99)}개 끝냄${hit ? ', 달성' : ''}`}>
            {hit ? <span className="goal-seal" aria-hidden="true">✓</span> : null}
            <span>{hit ? '목표 달성' : '오늘 목표'} <span className="num">{Math.min(c, 99)}/{g.n}</span></span>
            {!hit && <span className="goal-pips" aria-hidden="true">{Array.from({ length: pips }, (_, i) => <i key={i} className={i < c ? 'on' : ''} />)}</span>}
        </span>
    );
}
