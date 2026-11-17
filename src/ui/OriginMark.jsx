import { originOf } from '../lib/origin.js';

/** 파생 표시: 그림 글자 하나. 읽기 프로그램에는 '회의록에서 등록'처럼 읽힙니다. */
export function OriginMark({ row, title = '', minutesId = '' }) {
    const origin = originOf(row);
    if (!origin) return null;
    const label = title ? `${origin.label}: ${title}` : origin.label;
    return (
        <span className="origin-mark" role="img" aria-label={label} title={label} data-origin={origin.kind} {...(origin.kind === 'minutes' ? { 'data-minutes-from': minutesId || '1' } : {})}>{origin.icon}</span>
    );
}
