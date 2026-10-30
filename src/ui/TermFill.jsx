import { useState } from 'react';
import { applyTermTimetable } from '../lib/db.js';
import { TERM_CHOICES, planTermFill, termDays, termRange } from '../lib/semester.js';
import { Btn } from './bits.jsx';
import { useUi } from './context.jsx';

/** 기본(요일) 시간표를 1학기·2학기·1년 수업일에 한 번에 넣는 타일. 그날 고친 날이 있으면 먼저 묻습니다. */
export function TermFill({ data, events }) {
    const { showToast } = useUi();
    const [ask, setAsk] = useState(null);
    const year = Number(data.profile.schoolYear) || Number(String(new Date().getFullYear()));
    const edited = data.profile.ttEdited || [];

    async function run(choice, keepEdited) {
        const days = termDays(choice.id, year, events);
        const plan = planTermFill(data.timetable, days, { edited, keepEdited });
        const saved = await applyTermTimetable(plan.rows, { overwrite: !keepEdited });
        setAsk(null);
        if (saved?.storageFailed) return;
        showToast(`${choice.label} 수업일 ${plan.filled}일에 넣었어요.${plan.kept.length ? ` 고친 ${plan.kept.length}일은 그대로 뒀어요.` : ''}`, true);
    }

    function pick(choice) {
        const days = termDays(choice.id, year, events);
        const touched = days.filter((day) => edited.includes(day));
        if (touched.length) setAsk({ choice, touched: touched.length });
        else run(choice, true);
    }

    return (
        <section className="solid-card term-fill" style={{ padding: 12, marginTop: 12 }} data-screen="term-fill">
            <strong>기본 시간표를 날짜마다 넣기</strong>
            <p className="muted" style={{ margin: '4px 0 8px' }}>토·일, 공휴일, 학사일정의 휴업일·방학은 빼고 넣어요. 넣은 뒤에는 날짜를 눌러 그날만 고칠 수 있어요.</p>
            <div className="term-tiles">
                {TERM_CHOICES.map((choice) => {
                    const range = termRange(choice.id, year, events);
                    const days = termDays(choice.id, year, events);
                    const from = days[0] || range.from;
                    const to = days[days.length - 1] || range.to;
                    return (
                        <Btn key={choice.id} className="choice-tile term-tile" data-term={choice.id} onClick={() => pick(choice)}>
                            <strong>{choice.label}</strong>
                            <span className="num term-date">{shortDate(from)}~</span>
                            <span className="num term-date">{shortDate(to)}</span>
                            <span className="muted">{range.source} · {days.length}일</span>
                        </Btn>
                    );
                })}
            </div>
            {ask && (
                <div className="term-ask" role="group" aria-label="고친 날 처리">
                    <p style={{ margin: '10px 0 8px', fontWeight: 800 }}>{ask.choice.label}에 그날만 고친 날이 {ask.touched}일 있어요.</p>
                    <div className="term-tiles">
                        <Btn className="choice-tile on" data-term-keep="1" onClick={() => run(ask.choice, true)}>고친 날은 그대로 (추천)</Btn>
                        <Btn className="choice-tile" data-term-over="1" onClick={() => run(ask.choice, false)}>고친 날도 덮어쓰기</Btn>
                        <Btn className="choice-tile" onClick={() => setAsk(null)}>그만두기</Btn>
                    </div>
                </div>
            )}
        </section>
    );
}

function shortDate(ymd) {
    return `${String(ymd).slice(2, 4)}.${Number(String(ymd).slice(5, 7))}.${Number(String(ymd).slice(8))}`;
}
