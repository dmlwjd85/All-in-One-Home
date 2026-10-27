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
    /* 수업이 모두 잠긴 날은 수업·점심·방과후 문구 대신 퇴근 기준으로만 안내합니다. */
    if (!Array.from({ length: last }, (_, i) => i + 1).some((n) => !skip.has(n))) {
        const text = workEnd != null ? `오늘 수업은 모두 잠겼어요. ${opts.workEnd}에 ${endLabel}해요.` : '오늘 수업은 모두 잠겼어요.';
        return { index: -1, phase: 'nolesson', minutes: workEnd != null ? workEnd - now : 0, text };
    }
    const lengths = opts.lengths || [];
    const slotEnd = (i) => {
        const start = minutesOf(list[i]);
        const length = Number(lengths[i]) > 0 ? Number(lengths[i]) : 40;
        const nextStart = list[i + 1] ? minutesOf(list[i + 1]) : Infinity;
        return Math.min(start + length, nextStart);
    };
    /* 점심은 4교시가 끝난 뒤부터 5교시 시작 전까지입니다. 잠긴 교시는 빈 시간일 뿐 점심이 아닙니다. */
    const lunchFrom = list.length > 4 ? slotEnd(3) : null;
    const lunchTo = list.length > 4 ? minutesOf(list[4]) : null;
    const inLunch = lunchFrom != null && lunchTo - lunchFrom >= 30 && now >= lunchFrom && now < lunchTo;
    for (let i = 0; i < last; i += 1) {
        if (skip.has(i + 1)) continue;
        const start = minutesOf(list[i]);
        const subject = labels[i] || '';
        const name = subject ? `${i + 1}교시 ${subject}` : `${i + 1}교시`;
        if (now < start) {
            const minutes = start - now;
            const lunch = inLunch;
            return {
                index: i,
                phase: lunch ? 'lunch' : 'before',
                minutes,
                subject,
                text: lunch ? `점심시간이에요. ${name}까지 ${minutes}분` : `${name}까지 ${minutes}분`,
            };
        }
        const end = slotEnd(i);
        if (now < end) {
            return {
                index: i,
                phase: 'during',
                minutes: end - now,
                subject,
                text: `${name} 중이에요`,
            };
        }
    }
    if (inLunch) {
        return { index: -1, phase: 'lunch', minutes: lunchTo - now, text: '점심시간이에요.' };
    }
    if (workEnd != null || now < 18 * 60) {
        return { index: -1, phase: 'afterschool', minutes: 0, text: '방과후 시간이에요.' };
    }
    return { index: -1, phase: 'after', minutes: 0, text: '오늘 수업이 끝났어요.' };
}

/**
 * 퇴근(또는 조퇴)까지 남은 시간. sec 는 자정부터 지난 초입니다.
 * 출근·퇴근 시각 중 하나라도 없거나 출근 전이면 show 가 false 입니다.
 */
export function workTimer(sec, { workStart = '', workEnd = '', leave = '' } = {}) {
    const target = isHm(leave) ? leave : (isHm(workEnd) ? workEnd : '');
    const label = isHm(leave) ? '조퇴' : '퇴근';
    if (!target || !isHm(workStart)) return { show: false };
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

/** 조퇴 시각이 알맞은지 봅니다. 출근 뒤, 지금 뒤, 퇴근 전만 받습니다. 괜찮으면 빈 문자열입니다. */
export function leaveProblem(hm, nowHm, { workStart = '', workEnd = '' } = {}) {
    if (!isHm(hm)) return '조퇴 시각은 14:30처럼 골라 주세요.';
    const at = minutesOf(hm);
    if (isHm(workStart) && at <= minutesOf(workStart)) return `출근 시각(${workStart})보다 늦은 시각으로 골라 주세요.`;
    if (isHm(workEnd) && at >= minutesOf(workEnd)) return `퇴근 시각(${workEnd})보다 이른 시각으로 골라 주세요.`;
    if (isHm(nowHm) && at <= minutesOf(nowHm)) return '이미 지난 시각이에요. 지금보다 늦은 시각으로 골라 주세요.';
    return '';
}

/** 숫자 뒤에 붙는 '을/를'. 2·4·5·9처럼 받침이 없으면 '를'입니다. */
export function eulReul(n) {
    return [2, 4, 5, 9].includes(Math.abs(Number(n)) % 10) ? '를' : '을';
}
