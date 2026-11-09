import { useState } from 'react';
import { setTodoGoal } from '../lib/db.js';
import { GOAL_CHOICES, normalizeGoals } from '../lib/todoAchieve.js';
import { FX_LEVELS, celebrateDone, fxLevel, reducedMotion, setFxLevel } from './doneFx.js';
import { Btn } from './bits.jsx';

/** 설정 › 할 일 목표·효과(PR C). 목표는 계정과 함께 다른 기기에도 맞춰지고, 효과 세기는 이 기기에만 둡니다. */
export function TodoSettings({ data, showToast }) {
    const goals = normalizeGoals(data.goals);
    const [fx, setFx] = useState(() => fxLevel());
    const choices = GOAL_CHOICES.includes(goals.n) ? GOAL_CHOICES : [...GOAL_CHOICES, goals.n].sort((a, b) => a - b);
    return (
        <section className="glass" style={{ padding: 14 }} data-screen="todo-settings">
            <h2 className="title-font" style={{ marginTop: 0 }}>할 일 목표·효과</h2>
            <h3 style={{ margin: '0 0 8px' }}>하루 목표</h3>
            <p className="muted" style={{ marginTop: 0 }}>하루에 끝낸 할 일이 목표만큼 모이면 그날 달력에 달성 도장이 찍혀요. 체크를 풀어 목표 아래로 내려가면 도장도 지워요.</p>
            <div className="goal-grid" role="group" aria-label="하루 목표 개수">
                {choices.map((n) => (
                    <Btn key={n} className={goals.n === n ? 'choice-tile on' : 'choice-tile'} aria-pressed={goals.n === n} data-goal-pick={n} onClick={async () => {
                        const saved = await setTodoGoal(n);
                        if (saved?.storageFailed) return;
                        showToast(n ? `하루 목표를 ${n}개로 정했어요.` : '하루 목표를 껐어요.', true);
                    }}>{n ? <span className="num">{n}개</span> : <span>끄기</span>}</Btn>
                ))}
            </div>
            <h3 style={{ margin: '16px 0 8px' }}>끝냈을 때 효과</h3>
            <div className="fx-grid" role="group" aria-label="끝냈을 때 효과">
                {FX_LEVELS.map((item) => (
                    <Btn key={item.id} className={fx === item.id ? 'choice-tile on' : 'choice-tile'} aria-pressed={fx === item.id} data-fx-pick={item.id} onClick={() => setFx(setFxLevel(item.id))}>
                        <span>{item.label}</span>
                        <span>{item.hint}</span>
                    </Btn>
                ))}
            </div>
            <p className="muted">중요도가 높을수록 쨈 방울이 더 튀고, 오늘 할 일을 다 끝내면 도장이 찍혀요. 소리는 ‘누를 때 소리’ 설정을 따라요.{reducedMotion() ? ' 이 기기는 동작 줄이기가 켜져 있어 방울 없이 도장만 보여요.' : ''} 이 기기에만 저장돼요.</p>
            <Btn className="chip" data-role="fx-preview" disabled={fx === 'off'} onClick={(event) => {
                const button = event.currentTarget;
                celebrateDone({ done: true, pri: 3, allDone: true }, { rect: button.getBoundingClientRect(), button, level: fx });
            }}>효과 미리 보기</Btn>
        </section>
    );
}
