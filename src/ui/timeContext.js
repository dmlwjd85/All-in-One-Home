import { dayKeyFromYmd, seoulParts } from '../lib/date.js';
import { allLengths, allStarts, lastPeriod, leaveFor, readPeriodLocal } from '../lib/periodLocal.js';
import { tableForDateWithLocal } from '../lib/semester.js';

/**
 * 시간구('퇴근 전까지', '수업 끝나고' …)를 풀 때 쓰는 오늘의 기준값. 저장값만 읽고 아무것도 쓰지 않습니다.
 * 출퇴근이 비어 있으면 빈 값 그대로 둡니다(추천값으로 채우지 않습니다). 데모 화면의 보여 주기용 출퇴근도 쓰지 않습니다.
 */
export function timeContext(data, now = new Date(), local = readPeriodLocal()) {
    const clock = seoulParts(now);
    const ymd = clock.ymd;
    let last = 0;
    try {
        const table = tableForDateWithLocal(data, ymd, local);
        last = lastPeriod(table, local, dayKeyFromYmd(ymd));
    } catch {
        last = local.count || 0;
    }
    return {
        today: ymd,
        hm: clock.hm,
        workStart: local.workStart || '',
        workEnd: local.workEnd || '',
        leave: leaveFor(ymd),
        starts: allStarts(data?.profile?.periodStarts, local),
        lengths: allLengths(local),
        lastPeriod: last,
    };
}
