import { useEffect, useState } from 'react';
import { saveRecord } from '../lib/store.js';
import { readPageFields } from './fieldStore.js';
import { praiseStats } from './boardsModel.js';

function rosterNames() {
    const fields = readPageFields(154);
    return Array.from({ length: 32 }, (_, i) => ({
        no: i + 1,
        name: String(fields[`name${i + 1}`] || '').trim(),
    }));
}

export default function PraiseBoard({ board, signedIn, onChanged, onToast }) {
    const students = rosterNames();
    const goal = Math.max(1, Number(board?.goal) || 10);
    const counts = board?.counts || {};
    const stats = praiseStats(counts, goal);
    const [burst, setBurst] = useState(null);

    useEffect(() => {
        if (!burst) return undefined;
        const timer = window.setTimeout(() => setBurst(null), 1200);
        return () => window.clearTimeout(timer);
    }, [burst]);

    const save = async (next, toast) => {
        await saveRecord('praiseBoard', next, signedIn);
        onChanged?.();
        if (toast) onToast?.(toast);
    };

    const countOf = (no) => Number(counts[no] || counts[String(no)] || 0);

    const stamp = (no, delta) => {
        const prev = countOf(no);
        const nextCount = Math.max(0, prev + delta);
        const nextCounts = { ...counts, [no]: nextCount };
        const reached = delta > 0 && prev < goal && nextCount >= goal;
        save(
            { goal, counts: nextCounts },
            reached ? `${no}번이 목표를 채웠어요.` : '',
        );
        if (reached) setBurst(no);
    };

    return (
        <section className="nb-praise">
            <div className="nb-praise-head">
                <label>
                    한 명 목표
                    <input
                        type="number"
                        min="1"
                        max="30"
                        value={goal}
                        aria-label="칭찬 스티커 목표"
                        onChange={(e) => save({ goal: Math.max(1, Number(e.target.value) || 1), counts })}
                    />
                </label>
                <div className="nb-thermo" role="meter" aria-valuemin={0} aria-valuemax={stats.max} aria-valuenow={stats.total} aria-label="우리 반 칭찬 온도">
                    <span style={{ width: `${stats.percent}%` }} />
                </div>
                <p className="nb-hint">우리 반 {stats.total}/{stats.max} · 목표를 채운 아이 {stats.reached}명</p>
            </div>
            <div className="nb-praise-grid">
                {students.map((student) => {
                    const count = countOf(student.no);
                    const done = count >= goal;
                    return (
                        <div key={student.no} className={`nb-praise-card ${done ? 'is-done' : ''}`}>
                            <button type="button" onClick={() => stamp(student.no, 1)} aria-label={`${student.no}번 칭찬 스티커 ${count}개`}>
                                <b>{student.no}</b>
                                {student.name ? <small>{student.name}</small> : null}
                                <span>{done ? '★' : '☆'} {count}</span>
                            </button>
                            {count > 0 && (
                                <button type="button" className="nb-praise-minus" onClick={() => stamp(student.no, -1)} aria-label={`${student.no}번 스티커 하나 빼기`}>−</button>
                            )}
                        </div>
                    );
                })}
            </div>
            {burst && <p className="nb-burst" role="status">{burst}번 목표 달성!</p>}
        </section>
    );
}
