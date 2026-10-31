import { addDaysYmd, dayKeyFromYmd, fromYmd, startOfWeekMon, weekdayKo } from './date.js';
import { DEFAULT_PERIODS } from './period.js';

export const DEMO_NAMES = [
    '김하늘', '오지호', '박서준', '윤채원', '강민우', '서예린', '최도윤', '임수빈', '장하람', '송유찬',
    '문가은', '이하은', '배준서', '신아린', '정유나', '홍시우', '조은별', '권태오', '한서아', '남궁별',
    '한지우', '류다온', '백승민', '양소율', '고은찬', '노해인', '황보람',
];

const WEEK = {
    mon: ['국어', '수학', '사회', '체육', '과학', '창체'],
    tue: ['수학', '국어', '과학', '음악', '사회', '영어'],
    wed: ['국어', '수학', '미술', '사회', '체육', '창체'],
    thu: ['과학', '국어', '수학', '사회', '영어', '실과'],
    fri: ['국어', '수학', '도덕', '체육', '사회', '창체'],
};

function table() {
    const out = {};
    for (const [day, subjects] of Object.entries(WEEK)) {
        out[day] = {};
        subjects.forEach((subject, index) => {
            out[day][`p${index + 1}`] = subject;
        });
        out[day].s4 = '전담';
    }
    return out;
}

function weekend(ymd) {
    const day = fromYmd(ymd).getDay();
    return day === 0 || day === 6;
}

/** 기준 시각 이후, 출발 시각이 지나지 않은 가장 가까운 평일. */
export function nextOpenWeekday(today, hm = '00:00', at = '08:50') {
    let cursor = today;
    if (weekend(today) || String(hm || '00:00') >= at) cursor = addDaysYmd(today, 1);
    while (weekend(cursor)) cursor = addDaysYmd(cursor, 1);
    return cursor;
}

/** 체험보다 앞선 동의서 마감. 오늘이 체험보다 전이면 오늘, 아니면 직전 평일. */
export function consentBefore(today, trip) {
    let due = today < trip ? today : addDaysYmd(trip, -1);
    while (weekend(due) || due >= trip) due = addDaysYmd(due, -1);
    return due;
}

/** 데모 홈에서 퇴근 타이머가 보이도록 쓰는 출퇴근 시각입니다. 이 기기 설정(localStorage)이나 서버에는 쓰지 않습니다. */
export const DEMO_WORK = { workStart: '08:40', workEnd: '16:40' };

/** 목업과 같은 6학년 3반. 날짜는 오늘을 기준으로 잡습니다. */
export function buildDemo(clock) {
    const today = clock.ymd;
    const tomorrow = addDaysYmd(today, 1);
    const trip = nextOpenWeekday(today, clock.hm || '00:00', '08:50');
    const consentDue = consentBefore(today, trip);
    const consult = addDaysYmd(today, 4);
    const friday = addDaysYmd(startOfWeekMon(today), 4);
    const students = DEMO_NAMES.map((name, index) => ({
        id: `s${index + 1}`,
        no: index + 1,
        name,
        sex: '',
        birthday: index === 11 ? '04-12' : '',
        active: true,
        memo: '',
        source: 'demo',
    }));
    const records = [];
    const push = (row) => records.push({ source: 'demo', tags: [], neis: false, follow: '', ...row });
    push({
        id: 'demo-haeun-today',
        date: today,
        kind: '관찰',
        sid: 's12',
        text: '모둠 활동에서 친구 의견을 먼저 들어 주고, 마지막 정리까지 맡았어요.',
        tags: ['학습'],
        neis: true,
        at: `${today}T09:35:00`,
    });
    for (let i = 0; i < 5; i += 1) {
        push({
            id: `demo-haeun-ob-${i}`,
            date: addDaysYmd(today, -2 - i),
            kind: '관찰',
            sid: 's12',
            text: i % 2 ? '책 소개를 또박또박 했어요.' : '모둠에서 역할을 나눠 주었어요.',
            tags: [i % 2 ? '학습' : '교우'],
            neis: true,
            at: `${addDaysYmd(today, -2 - i)}T10:00:00`,
        });
    }
    for (let i = 0; i < 6; i += 1) {
        push({
            id: `demo-haeun-pr-${i}`,
            date: addDaysYmd(today, -8 - i),
            kind: '칭찬',
            sid: 's12',
            text: '친구 자리를 정리해 주고 조용히 기다렸어요.',
            neis: i < 3,
            at: `${addDaysYmd(today, -8 - i)}T15:00:00`,
        });
    }
    push({
        id: 'demo-haeun-c1',
        date: addDaysYmd(today, -6),
        kind: '상담',
        sid: 's12',
        text: '발표가 떨린다고 했어요. 다음 시간에 짧게 먼저 시켜 보기로 했어요.',
        tags: ['학습'],
        at: `${addDaysYmd(today, -6)}T13:10:00`,
    });
    push({
        id: 'demo-haeun-c2',
        date: addDaysYmd(today, -12),
        kind: '상담',
        sid: 's12',
        text: '쉬는 시간에 혼자 있는 날이 있어 같이 이야기했어요.',
        tags: ['교우'],
        follow: today,
        at: `${addDaysYmd(today, -12)}T13:20:00`,
    });
    push({
        id: 'demo-park',
        date: addDaysYmd(today, -1),
        kind: '관찰',
        sid: 's3',
        text: '어제 목이 아프다고 했어요.',
        tags: ['생활'],
        at: `${addDaysYmd(today, -1)}T09:10:00`,
    });
    push({
        id: 'demo-choi',
        date: addDaysYmd(today, -1),
        kind: '관찰',
        sid: 's7',
        text: '실험 기구를 친구와 나누어 썼어요.',
        tags: ['학습'],
        neis: true,
        at: `${addDaysYmd(today, -1)}T11:00:00`,
    });
    push({
        id: 'demo-han',
        date: addDaysYmd(today, -3),
        kind: '상담',
        sid: 's21',
        text: '자리 바꾸기 전에 의견을 물어보기로 했어요.',
        tags: ['교우'],
        at: `${addDaysYmd(today, -3)}T12:40:00`,
    });

    return {
        profile: {
            className: '6학년 3반',
            schoolYear: 2026,
            classSize: 27,
            periodStarts: [...DEFAULT_PERIODS],
            theme: 'system',
            sharedPc: false,
            started: true,
            guest: true,
            migratedAt: null,
            migration: null,
            demo: true,
            checkedDates: [today],
            migrateLater: false,
        },
        students,
        attendance: [
            { id: `${today}_s3`, date: today, sid: 's3', status: '결석', reason: '질병', note: '감기', paper: false, source: 'demo' },
            { id: `${today}_s15`, date: today, sid: 's15', status: '지각', reason: '', note: '', paper: false, source: 'demo' },
        ],
        records,
        events: [
            { id: 'demo-trip', date: trip, time: '08:50', title: '과학관 현장체험학습', kind: '학급', memo: '8:50 출발 · 도시락, 물, 편한 신발', source: 'demo' },
            { id: 'demo-consult', date: consult, time: '11:20', title: '학부모 상담 2가정', kind: '학급', memo: '4교시 체육 전담 시간', source: 'demo' },
        ],
        todos: [
            { id: 'demo-consent', title: '현장체험학습 동의서 걷기', done: false, due: consentDue, got: 22, of: 27, pendingNos: [23, 24, 25, 26, 27], source: 'demo' },
            { id: 'demo-neis', title: '국어 수행평가 나이스 입력', done: false, due: friday, source: 'demo' },
            { id: 'demo-done', title: '상담 주간 안내 알림장 올리기', done: true, due: today, source: 'demo' },
        ],
        /* #38 쨈 흐름으로 남긴 옛 회의록 모양(제목·참석자 없음). 회의록 화면에서 그대로 보여야 합니다. */
        notes: [
            { id: 'meet-demo-old', text: '학년회의 14:00 현장체험학습 안전 교육 안내', date: addDaysYmd(today, -3), tags: ['회의', '학년회의'], pinned: false, source: 'demo' },
        ],
        notices: [
            { id: tomorrow, date: tomorrow, text: `실내화 가방 챙기기, ${weekdayKo(trip)}요일 도시락 준비`, source: 'demo', at: `${today}T08:20:00` },
        ],
        timetable: table(),
        legacyPages: [],
        local: { records: [], notes: [], events: [], todos: [], notices: [], contacts: [], pages: [], backup: null },
        dayKey: dayKeyFromYmd(today),
    };
}
