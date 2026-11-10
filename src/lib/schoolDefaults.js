/**
 * 기본 환경 추천값(항목 16). 모두 '보기 + 한 번 눌러 적용'용이며, 저장된 값을 몰래 바꾸지 않습니다.
 *  - 출퇴근: 출근 08:30, 퇴근 16:30
 *  - 초등 기본 종 시각: 40분 수업, 쉬는 시간 10분, 2교시 뒤 중간놀이 20분, 4교시 뒤 점심 50분
 *  - 초등 시간표 예시: 학교·학년마다 다르므로 '예시'로만 보여 주고, 비어 있는 칸만 채웁니다.
 */
import { isHm } from './period.js';

export const SUGGESTED_WORK = Object.freeze({ workStart: '08:30', workEnd: '16:30' });

/** 초등 기본 종 시각(1~8교시 시작). 1교시 09:00. */
export const ELEMENTARY_BELLS = Object.freeze(['09:00', '09:50', '10:50', '11:40', '13:10', '14:00', '14:50', '15:40']);

/** 종 시각 안내 한 줄. 예: 1교시 09:00–09:40 */
export function bellRows(starts = ELEMENTARY_BELLS, length = 40) {
    return starts.slice(0, 6).map((start, index) => {
        const [h, m] = start.split(':').map(Number);
        const end = h * 60 + m + length;
        return { n: index + 1, start, end: `${String(Math.floor(end / 60)).padStart(2, '0')}:${String(end % 60).padStart(2, '0')}` };
    });
}

/** 초등 중학년 시간표 예시(월~금, 6교시까지). */
export const ELEMENTARY_SAMPLE = Object.freeze({
    mon: { p1: '국어', p2: '수학', p3: '사회', p4: '과학', p5: '체육', p6: '창체' },
    tue: { p1: '수학', p2: '국어', p3: '영어', p4: '음악', p5: '도덕' },
    wed: { p1: '국어', p2: '과학', p3: '수학', p4: '체육', p5: '미술', p6: '미술' },
    thu: { p1: '사회', p2: '국어', p3: '수학', p4: '영어', p5: '체육', p6: '창체' },
    fri: { p1: '과학', p2: '국어', p3: '음악', p4: '수학', p5: '사회' },
});

/** 출퇴근 추천을 보여 줄지: 두 칸이 모두 비어 있을 때만. 하나라도 정했으면 사용자 값이므로 추천하지 않습니다. */
export function needsWorkSuggestion(local) {
    return !isHm(local?.workStart) && !isHm(local?.workEnd);
}

/** 추천 출퇴근을 적용할 patch. 이미 값이 있으면 null(덮어쓰지 않음). */
export function workSuggestionPatch(local) {
    if (!needsWorkSuggestion(local)) return null;
    return { workStart: SUGGESTED_WORK.workStart, workEnd: SUGGESTED_WORK.workEnd };
}

/** 요일 시간표가 하나도 없는지(1~10교시 모두 빈 칸). 예시는 이때만 권합니다. */
export function timetableEmpty(timetable, extra = {}) {
    for (const day of ['mon', 'tue', 'wed', 'thu', 'fri']) {
        const row = { ...(timetable?.[day] || {}), ...(extra?.[day] || {}) };
        for (let n = 1; n <= 10; n += 1) if (String(row[`p${n}`] || '').trim()) return false;
    }
    return true;
}

/**
 * 예시 시간표에서 채울 칸 목록. 이미 과목이 있는 칸은 절대 건드리지 않습니다.
 * 돌려줌: [{ day, period, subject }]
 */
export function sampleFillCells(timetable, sample = ELEMENTARY_SAMPLE) {
    const out = [];
    for (const [day, row] of Object.entries(sample)) {
        for (const [key, subject] of Object.entries(row)) {
            const period = Number(key.slice(1));
            if (String(timetable?.[day]?.[key] || '').trim()) continue;
            out.push({ day, period, subject });
        }
    }
    return out;
}

/** 종 시각 예시를 쓸지: 저장된 교시 시작이 앱 처음 값과 같을 때(사용자가 고친 적 없음)만 권합니다. */
export function bellsLookDefault(starts, defaults) {
    return Array.isArray(starts) && Array.isArray(defaults) && starts.slice(0, 8).join() === defaults.slice(0, 8).join();
}
