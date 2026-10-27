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

/** 9·10교시 기본 시작 시각. 8교시까지는 DEFAULT_PERIODS 를 그대로 씁니다. */
export const EXTRA_PERIODS = ['16:30', '17:20'];
export const MAX_PERIODS = 10;
/** 학교급별 한 교시 길이(분). */
export const LEVEL_LENGTH = { 초: 40, 중: 45, 고: 50 };

/**
 * 지금 시각 기준으로 다음 교시 또는 진행 중인 교시를 고릅니다.
 * labels 는 1교시부터의 과목 이름입니다.
 * opts.last 는 오늘 마지막 교시, opts.skip 은 잠긴 교시 번호, opts.lengths 는 교시별 길이(분)입니다.
 * opts.workStart·opts.workEnd 는 출근·퇴근 시각, opts.endLabel 은 '퇴근' 또는 '조퇴'입니다.
 */
export function periodStatus(hm, starts = DEFAULT_PERIODS, labels = [], opts = {}) {
    const list = (starts || []).filter(isHm);
    const now = minutesOf(hm);
    const endLabel = opts.endLabel || '퇴근';
    const workStart = isHm(opts.workStart) ? minutesOf(opts.workStart) : null;
    const workEnd = isHm(opts.workEnd) ? minutesOf(opts.workEnd) : null;
    if (workEnd != null && now >= workEnd) {
        return { index: -1, phase: 'off', minutes: 0, text: `${endLabel} 시간이 지났어요.` };
    }
    if (workStart != null && now < workStart) {
        return { index: -1, phase: 'early', minutes: workStart - now, text: '출근 전이에요.' };
    }
    if (!list.length) {
        return { index: -1, phase: 'after', minutes: 0, text: '시간표를 아직 정하지 않았어요.' };
    }
    const last = opts.last > 0 ? Math.min(opts.last, list.length) : list.length;
    const skip = new Set(opts.skip || []);
    const lengths = opts.lengths || [];
    let prevEnd = null;
    for (let i = 0; i < last; i += 1) {
        if (skip.has(i + 1)) continue;
        const start = minutesOf(list[i]);
        const subject = labels[i] || '';
        const name = subject ? `${i + 1}교시 ${subject}` : `${i + 1}교시`;
        if (now < start) {
            const minutes = start - now;
            const lunch = prevEnd != null && now >= prevEnd && start - prevEnd >= 30;
            return {
                index: i,
                phase: lunch ? 'lunch' : 'before',
                minutes,
                subject,
                text: lunch ? `점심시간이에요. ${name}까지 ${minutes}분` : `${name}까지 ${minutes}분`,
            };
        }
        const length = Number(lengths[i]) > 0 ? Number(lengths[i]) : 40;
        const nextStart = list[i + 1] ? minutesOf(list[i + 1]) : Infinity;
        const end = Math.min(start + length, nextStart);
        if (now < end) {
            return {
                index: i,
                phase: 'during',
                minutes: end - now,
                subject,
                text: `${name} 중이에요`,
            };
        }
        prevEnd = end;
    }
    if (workEnd != null || now < 18 * 60) {
        return { index: -1, phase: 'afterschool', minutes: 0, text: '방과후 시간이에요.' };
    }
    return { index: -1, phase: 'after', minutes: 0, text: '오늘 수업이 끝났어요.' };
}

/**
 * 퇴근(또는 조퇴)까지 남은 시간. sec 는 자정부터 지난 초입니다.
 * 퇴근 시각이 없거나 출근 전이면 show 가 false 입니다.
 */
export function workTimer(sec, { workStart = '', workEnd = '', leave = '' } = {}) {
    const target = isHm(leave) ? leave : (isHm(workEnd) ? workEnd : '');
    const label = isHm(leave) ? '조퇴' : '퇴근';
    if (!target) return { show: false };
    const endSec = minutesOf(target) * 60;
    const startSec = isHm(workStart) ? minutesOf(workStart) * 60 : null;
    if (startSec != null && sec < startSec) return { show: false };
    const base = { show: true, label, target };
    const span = startSec != null && endSec > startSec ? endSec - startSec : 0;
    if (sec >= endSec) return { ...base, done: true, remain: 0, progress: 1, text: `${label} 시간이 지났어요` };
    const remain = endSec - sec;
    const progress = span ? Math.min(1, Math.max(0, (sec - startSec) / span)) : null;
    let left;
    if (remain > 600) {
        const total = Math.ceil(remain / 60);
        const h = Math.floor(total / 60);
        const m = total % 60;
        left = h ? (m ? `${h}시간 ${m}분` : `${h}시간`) : `${m}분`;
    } else {
        const m = Math.floor(remain / 60);
        const s = remain % 60;
        left = m ? `${m}분 ${String(s).padStart(2, '0')}초` : `${s}초`;
    }
    return { ...base, done: false, remain, progress, seconds: remain <= 600, left, text: `${label}까지 ${left}` };
}
