/** 교시 시작 시각. 8:42에 1교시가 9:00이면 18분 전입니다. */
export const DEFAULT_PERIODS = ['09:00', '09:40', '10:30', '11:20', '13:10', '14:00', '14:50', '15:40'];

export function minutesOf(hm) {
    const [h, m] = String(hm || '00:00').split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
    return h * 60 + m;
}

export function isHm(value) {
    return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value || ''));
}

/**
 * 지금 시각 기준으로 다음 교시 또는 진행 중인 교시를 고릅니다.
 * labels 는 1교시부터의 과목 이름입니다.
 */
export function periodStatus(hm, starts = DEFAULT_PERIODS, labels = []) {
    const list = (starts || []).filter(isHm);
    const now = minutesOf(hm);
    if (!list.length) {
        return { index: -1, phase: 'after', minutes: 0, text: '시간표를 아직 정하지 않았어요.' };
    }
    for (let i = 0; i < list.length; i += 1) {
        const start = minutesOf(list[i]);
        const subject = labels[i] || '';
        const name = subject ? `${i + 1}교시 ${subject}` : `${i + 1}교시`;
        if (now < start) {
            const minutes = start - now;
            return {
                index: i,
                phase: 'before',
                minutes,
                subject,
                text: subject ? `${name}까지 ${minutes}분` : `${name}까지 ${minutes}분`,
            };
        }
        const end = list[i + 1] ? minutesOf(list[i + 1]) : start + 40;
        if (now < end) {
            return {
                index: i,
                phase: 'during',
                minutes: end - now,
                subject,
                text: subject ? `${name} 중이에요` : `${name} 중이에요`,
            };
        }
    }
    return { index: -1, phase: 'after', minutes: 0, text: '오늘 수업이 끝났어요.' };
}
