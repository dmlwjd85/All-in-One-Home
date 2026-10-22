import { useState } from 'react';
import { monthCells, monthTitle, shiftMonth } from '../lib/date.js';
import { Btn } from './bits.jsx';

export const TIME_CHOICES = [
    ['09:00', '09:00'],
    ['09:40', '09:40'],
    ['10:30', '10:30'],
    ['11:20', '11:20'],
    ['12:10', '12:10'],
    ['13:10', '13:10'],
    ['14:00', '14:00'],
    ['14:30', '14:30'],
    ['14:50', '14:50'],
    ['15:40', '15:40'],
    ['16:00', '16:00'],
    ['', '시각 없음'],
];

export function ChoiceGrid({ options, value = '', onPick, label }) {
    return (
        <div className="choice-grid" role="group" aria-label={label}>
            {options.map((item) => (
                <Btn key={item.id} className={value === item.id ? 'choice-tile on' : 'choice-tile'} onClick={() => onPick(item.id)}>
                    {item.emoji ? <span aria-hidden="true">{item.emoji}</span> : null}
                    <span>{item.label}</span>
                </Btn>
            ))}
        </div>
    );
}

export function DateGrid({ value, today, onPick }) {
    const [ym, setYm] = useState(() => (value || today || '').slice(0, 7));
    const month = ym || (today || '').slice(0, 7);
    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <Btn className="icon-btn" aria-label="이전 달" onClick={() => setYm(shiftMonth(month, -1))}>‹</Btn>
                <strong className="title-font">{monthTitle(month)}</strong>
                <Btn className="icon-btn" aria-label="다음 달" onClick={() => setYm(shiftMonth(month, 1))}>›</Btn>
            </div>
            <div className="cal-grid" style={{ marginTop: 8 }} role="group" aria-label="날짜">
                {['월', '화', '수', '목', '금', '토', '일'].map((label) => (
                    <div key={label} style={{ textAlign: 'center', fontSize: 12, fontWeight: 800, lineHeight: '20px' }}>{label}</div>
                ))}
                {monthCells(month).map((cell) => {
                    const on = cell.ymd === value;
                    return (
                        <Btn
                            key={cell.ymd}
                            className="block"
                            aria-label={cell.ymd}
                            onClick={() => onPick(cell.ymd)}
                            style={{
                                background: on ? 'var(--primary)' : 'var(--solid)',
                                color: on ? 'var(--on-primary)' : (cell.inMonth ? 'var(--ink)' : 'var(--ink-sub)'),
                                borderRadius: 10,
                                minHeight: 44,
                                padding: 0,
                                fontWeight: 800,
                                boxShadow: cell.ymd === today && !on ? 'inset 0 0 0 2px var(--primary)' : 'none',
                            }}
                        >
                            <span className="num">{cell.day}</span>
                        </Btn>
                    );
                })}
            </div>
        </div>
    );
}

export function NumberGrid({ students, value = 0, onPick }) {
    if (!students.length) {
        return <Btn className="choice-tile" onClick={() => onPick(0)}>학생 없이 적기</Btn>;
    }
    return (
        <div className="num-grid" role="group" aria-label="학생 번호">
            {students.map((row) => (
                <Btn key={row.id} className={Number(value) === row.no ? 'choice-tile num-tile on' : 'choice-tile num-tile'} aria-label={`${row.no}번 ${row.name}`} onClick={() => onPick(row.no)}>
                    <span className="num">{row.no}</span>
                    <span className="num-name">{row.name}</span>
                </Btn>
            ))}
        </div>
    );
}

export function PeriodRow({ value, onPick }) {
    return (
        <div className="period-picks" role="group" aria-label="교시">
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                <Btn key={n} className={Number(value) === n ? 'chip on block' : 'chip block'} aria-label={`${n}교시`} onClick={() => onPick(n)}>{n}</Btn>
            ))}
        </div>
    );
}

export function TimeChips({ value, onPick, allowNone = true }) {
    const choices = TIME_CHOICES.filter((item) => allowNone || item[0] !== '');
    const known = new Set(choices.map((item) => item[0]));
    const extra = value && !known.has(value) ? [[value, value]] : [];
    return (
        <div className="time-picks" role="group" aria-label="시각">
            {[...extra, ...choices].map(([id, label]) => (
                <Btn key={label + id} className={(value || '') === id ? 'chip on' : 'chip'} onClick={() => onPick(id)}>{label}</Btn>
            ))}
        </div>
    );
}
