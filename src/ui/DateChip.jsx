import { jjaemDateChip } from '../lib/jjaemPaste.js';
import { seoulYmd } from '../lib/date.js';

/** 시안 A 파란 둥근 날짜 칩(작은 달력 숫자 + 「오늘 · 11월 5일」). */
export function DateChip({ ymd, today = seoulYmd(), className = '' }) {
    const chip = jjaemDateChip(ymd, today);
    if (!chip) return null;
    return (
        <span className={`jjaem-date-chip ${className}`.trim()} title={chip.abs} data-ymd={chip.ymd}>
            <span className="jjaem-date-chip-cal" aria-hidden="true">{chip.day}</span>
            <span className="jjaem-date-chip-label">{chip.label}</span>
        </span>
    );
}
