import { dayKeyFromYmd } from '../lib/date.js';
import { periodStatus } from '../lib/period.js';
import { allLengths, allStarts, lastPeriod, skipPeriods } from '../lib/periodLocal.js';
import { DEMO_WORK } from '../lib/demo.js';
import { tableForDateWithLocal } from '../lib/semester.js';

/* 맨 위 심지 줄이 홈 카드(Home.jsx)와 같은 값을 보도록, 홈과 똑같은 계산을 둡니다. 홈 쪽을 바꾸면 여기도 함께 바꿔요(check-browser가 두 화면의 남은 시간이 같은지 봅니다). */

/** 데모에서는 출퇴근 시각을 채워 타이머를 보여 줍니다. 이 기기 설정에는 쓰지 않습니다. */
export function workLocal(data, saved) {
    return data.profile.demo && !saved.workStart && !saved.workEnd ? { ...saved, ...DEMO_WORK } : saved;
}

/** 쉬는 날이 아니고 퇴근이나 조퇴 시각이 있으면 타이머를 둡니다(실제로 보일지는 workTimer().show가 정합니다). */
export function timerWanted(todayRest, local, leave) {
    return Boolean(!todayRest.off && (local.workEnd || leave));
}

/** 오늘 시간표와 지금 교시 안내(방과후 문구 포함). */
export function todayPeriod(data, ymd, hm, local, leave) {
    const day = dayKeyFromYmd(ymd);
    const table = tableForDateWithLocal(data, ymd, local);
    const labels = Array.from({ length: local.count }, (_, index) => table[`p${index + 1}`] || '');
    const period = periodStatus(hm, allStarts(data.profile.periodStarts, local), labels, {
        last: lastPeriod(table, local, day),
        skip: skipPeriods(table, local, day),
        lengths: allLengths(local),
        workStart: local.workStart,
        workEnd: leave || local.workEnd,
        endLabel: leave ? '조퇴' : '퇴근',
    });
    return { table, labels, period };
}
