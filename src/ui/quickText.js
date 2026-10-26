import { seoulParts } from '../lib/date.js';

/** 일지에서 열면 그 날짜, 아니면 한국 시각의 오늘. */
export function quickDate(routeName, routeDate, now = new Date()) {
    if (routeName === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(String(routeDate || ''))) return routeDate;
    return seoulParts(now).ymd;
}

export function quickDateLabel(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(ymd || ''))) return '';
    return `${Number(ymd.slice(5, 7))}월 ${Number(ymd.slice(8, 10))}일`;
}

/** 조합이 끝나기 전이면 마지막 글자를 붙여 확정합니다. 이미 들어 있으면 그대로 둡니다. */
export function textFromField(input, composing) {
    const dom = String(input?.value ?? '');
    const data = String(composing?.data || '');
    if (data && !dom.endsWith(data)) return `${dom}${data}`;
    return dom;
}
