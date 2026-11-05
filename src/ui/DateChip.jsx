import { jamDateChip } from '../lib/jamPaste.js';
import { seoulYmd } from '../lib/date.js';

/** 시안 A 파란 둥근 날짜 칩(작은 달력 숫자 + 「오늘 · 11월 5일」). */
export function DateChip({ ymd, today = seoulYmd(), className = '' }) {
    const chip = jamDateChip(ymd, today);
    if (!chip) return null;
    return (
        <span className={`jam-date-chip ${className}`.trim()} title={chip.abs} data-ymd={chip.ymd}>
            <span className="jam-date-chip-cal" aria-hidden="true">{chip.day}</span>
            <span className="jam-date-chip-label">{chip.label}</span>
        </span>
    );
}
