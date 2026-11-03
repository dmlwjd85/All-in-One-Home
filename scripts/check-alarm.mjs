/* PR #60: 홈 안내 문구·할 일 알림·할 일 시각 동기화 모양 검사(화면 없이). */
import { readFileSync } from 'node:fs';
import { HOME_TIPS, allHomeTips, pickHomeTip } from '../src/lib/homeTips.js';
import { alarmKey, dueAlarms, dueChoices, markFired, readFired, shiftTime } from '../src/lib/todoAlarm.js';
import { fromCloudRow, toCloudRow, todoBodyWithoutTime } from '../src/lib/cloudShape.js';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

/* 3. 안내 문구 30개 이상, 겹치지 않고, 날짜마다 돌며, 상황마다 다른 묶음. */
const tips = allHomeTips();
check(tips.length >= 30, `안내 문구가 30개보다 적습니다: ${tips.length}`);
check(new Set(tips).size === tips.length, '같은 안내 문구가 두 번 있습니다.');
check(tips.every((t) => /[가-힣]/.test(t) && t.length <= 60), '한국어가 아니거나 너무 긴 안내 문구가 있습니다.');
check(pickHomeTip({ ymd: '2026-11-04', hm: '08:00', checked: false, weekday: 3 }).group === 'attend', '출결 전 아침에 출결 안내가 아닙니다.');
check(pickHomeTip({ ymd: '2026-11-04', hm: '13:00', checked: true, left: 2, weekday: 3 }).group === 'todo', '할 일이 남은 오후에 할 일 안내가 아닙니다.');
check(pickHomeTip({ ymd: '2026-11-06', hm: '10:00', checked: true, weekday: 5 }).group === 'friday', '금요일 안내가 아닙니다.');
check(pickHomeTip({ ymd: '2026-11-04', hm: '17:00', checked: true, left: 0, weekday: 3 }).group === 'evening', '퇴근 무렵 안내가 아닙니다.');
check(pickHomeTip({ ymd: '2026-11-07', off: true }).group === 'rest', '쉬는 날 안내가 아닙니다.');
const a = pickHomeTip({ ymd: '2026-11-04', hm: '10:00', checked: true, weekday: 3 });
check(a.text === pickHomeTip({ ymd: '2026-11-04', hm: '10:59', checked: true, weekday: 3 }).text, '같은 날 같은 상황인데 문구가 바뀝니다.');
const days = new Set(Array.from({ length: 14 }, (_, i) => pickHomeTip({ ymd: `2026-11-${String(i + 1).padStart(2, '0')}`, hm: '10:00', checked: true, weekday: 3 }).text));
check(days.size >= 3, `날짜가 바뀌어도 문구가 잘 돌지 않습니다: ${days.size}`);
check(Object.values(HOME_TIPS).every((list) => list.length >= 2), '문구가 하나뿐인 묶음이 있습니다.');
check(!readFileSync('src/ui/Home.jsx', 'utf8').includes("'출결부터 볼까요?'"), '홈에 고정 문구가 남아 있습니다.');
check(!readFileSync('src/ui/Home.jsx', 'utf8').includes('한 주 보기'), "홈에 '한 주 보기'가 남아 있습니다.");

/* 5. 알림: 오늘·시각 지남·안 끝냄·안 울림만. */
const todos = [
    { id: 't1', title: '가정통신문', due: '2026-11-04', time: '09:00', done: false },
    { id: 't2', title: '끝낸 일', due: '2026-11-04', time: '08:00', done: true },
    { id: 't3', title: '내일 일', due: '2026-11-05', time: '08:00', done: false },
    { id: 't4', title: '시각 없음', due: '2026-11-04', done: false },
    { id: 't5', title: '나중 시각', due: '2026-11-04', time: '15:00', done: false },
    { id: 't6', title: '틀린 시각', due: '2026-11-04', time: '9:0', done: false },
];
check(dueAlarms(todos, '2026-11-04', '08:59').length === 0, '시각 전에 울립니다.');
check(dueAlarms(todos, '2026-11-04', '09:00').map((r) => r.id).join() === 't1', `09:00 알림이 다릅니다: ${dueAlarms(todos, '2026-11-04', '09:00').map((r) => r.id)}`);
check(dueAlarms(todos, '2026-11-04', '09:00', { [alarmKey(todos[0])]: '2026-11-04' }).length === 0, '이미 울린 할 일이 또 울립니다.');
check(dueAlarms([{ ...todos[0], time: '09:10' }], '2026-11-04', '09:10', { [alarmKey(todos[0])]: '2026-11-04' }).length === 1, '시각을 고친 할 일이 다시 울리지 않습니다.');
check(dueAlarms(todos, '', '') .length === 0 && dueAlarms(null, '2026-11-04', '10:00').length === 0, '빈 값에서 알림이 납니다.');
const mem = new Map();
const store = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
store.setItem('ssug-gyomu-todo-alarm-fired', JSON.stringify({ 'old|2026-10-01|09:00': '2026-10-01' }));
markFired([todos[0]], '2026-11-04', store);
const fired = readFired(store);
check(fired[alarmKey(todos[0])] && !fired['old|2026-10-01|09:00'], '울린 표시를 남기거나 오래된 표시를 지우지 못합니다.');
check(shiftTime('', 10) === '09:10' && shiftTime('23:50', 30) === '23:55' && shiftTime('00:05', -10) === '00:00', '시각 옮기기가 틀립니다.');
const chips = dueChoices('2026-11-04');
check(chips[0][1] === '2026-11-04' && chips[1][1] === '2026-11-05' && dueChoices('2026-11-02').some(([l, d]) => l === '이번 주 금' && d === '2026-11-06') && !chips.some(([l]) => l === '이번 주 금') && chips.some(([l, d]) => l === '다음 주 월' && d === '2026-11-09'), `날짜 칩이 틀립니다: ${JSON.stringify(chips)}`);

/* 8·5. 할 일 시각 동기화 모양: 시각이 없으면 예전과 같은 지문, 지운 시각만 클라우드 칸을 지움. */
const base = { id: 'todo-1', title: '회수', done: false, due: '2026-11-04', source: 'app' };
const plain = toCloudRow('todos', base);
check(!('time' in plain.body) && !plain.clear.includes('time'), '시각 없는 옛 할 일 모양이 바뀌었습니다(한꺼번에 다시 올라감).');
const timed = toCloudRow('todos', { ...base, time: '09:30' });
check(timed.body.time === '09:30', '할 일 시각을 올리지 않습니다.');
check(!('time' in toCloudRow('todos', { ...base, time: '25:00' }).body), '틀린 시각을 올립니다.');
check(toCloudRow('todos', { ...base, time: '' }).clear.includes('time'), '지운 시각을 클라우드에서 지우지 않습니다.');
check(!('time' in todoBodyWithoutTime(timed.body)) && todoBodyWithoutTime(plain.body) === null, '규칙 거절 때 시각만 빼는 모양이 틀립니다.');
const back = fromCloudRow('todos', 'todo-1', { title: '회수', done: false, due: '2026-11-04', time: '09:30' });
check(back.time === '09:30', '받은 할 일에 시각이 없습니다.');
check(!('time' in fromCloudRow('todos', 'todo-1', { title: '회수', done: false })), '시각 없는 할 일을 받을 때 time 칸이 생깁니다(고친 것으로 잘못 표시).');

const rules = readFileSync('firestore.rules', 'utf8');
check(/'due', 'time', 'got'/.test(rules) && rules.includes("(!('time' in d()) || hm(d().time))"), '규칙에 할 일 time 칸이 없습니다.');
check(readFileSync('src/ui/QuickBar.jsx', 'utf8').includes('>회의록 작성</Btn>'), "쨈 팝업에 '회의록 작성'이 없습니다.");

if (failures.length) {
    for (const f of failures) console.error(`실패: ${f}`);
    process.exit(1);
}
console.log('check:alarm 통과');
