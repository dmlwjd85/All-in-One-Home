/* PR #60: 홈 안내 문구·할 일 알림·할 일 시각 동기화 모양 검사(화면 없이). */
import { readFileSync } from 'node:fs';
import { HOME_TIPS, allHomeTips, pickHomeTip } from '../src/lib/homeTips.js';
import { alarmKey, dueAlarms, dueChoices, markFired, readFired, shiftTime } from '../src/lib/todoAlarm.js';
import { splitAlarms } from '../src/lib/todoAlarm.js';
import { heldTimesToRetry, heldTodoIds, heldTodoTime, holdTodoTime, releaseTodoTime, settleHoldWithRemote, useHoldRetryForTest } from '../src/lib/todoTimeHold.js';
import { periodStatus, DEFAULT_PERIODS } from '../src/lib/period.js';
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

/* PR #62 검수: 살아남은 뮤턴트와 경미한 문제. */
const mem2 = new Map();
globalThis.localStorage = { getItem: (k) => (mem2.has(k) ? mem2.get(k) : null), setItem: (k, v) => mem2.set(k, String(v)), removeItem: (k) => mem2.delete(k) };
// A5: 지난 날짜(어제) 할 일은 오늘 알림에 들지 않습니다. 내일 할 일도 마찬가지입니다.
check(dueAlarms([{ id: 'y1', title: '어제 일', due: '2026-11-03', time: '09:00', done: false }], '2026-11-04', '10:00', {}).length === 0, 'A5: 지난 날짜 할 일이 오늘 알림으로 울립니다.');
check(dueAlarms([{ id: 'y2', title: '내일 일', due: '2026-11-05', time: '09:00', done: false }], '2026-11-04', '10:00', {}).length === 0, '내일 할 일이 오늘 울립니다.');
check(dueAlarms([{ id: 'y3', title: '오늘 일', due: '2026-11-04', time: '10:00', done: false }], '2026-11-04', '10:00', {}).length === 1, '시각이 된 오늘 할 일이 울리지 않습니다.');
// 6: 앱을 막 열었을 때 이미 지난 알림은 놓친 알림으로만(소리 없음), 열려 있는 동안 15분 안쪽은 울림.
const late = [{ id: 'l1', time: '08:00' }, { id: 'l2', time: '09:59' }];
const onOpen = splitAlarms(late, '10:00', { first: true });
check(onOpen.ring.map((r) => r.id).join() === 'l2' && onOpen.missed.map((r) => r.id).join() === 'l1', `앱을 열 때 지난 알림을 한꺼번에 울립니다: ${JSON.stringify(onOpen)}`);
const live = splitAlarms([{ id: 'm1', time: '09:50' }, { id: 'm2', time: '09:30' }], '10:00');
check(live.ring.map((r) => r.id).join() === 'm1' && live.missed.map((r) => r.id).join() === 'm2', `열려 있을 때 울림·놓침 구분이 틀립니다: ${JSON.stringify(live)}`);
// 5: 자정·새벽처럼 출근이 먼 때는 남은 시간을 세지 않습니다.
for (const hm of ['00:00', '03:10', '05:29']) {
    const t = periodStatus(hm, DEFAULT_PERIODS, 6, { workStart: '08:30', workEnd: '16:30' }).text;
    check(!t.includes('출근까지'), `${hm}에 '출근까지'를 셉니다: ${t}`);
}
check(periodStatus('05:30', DEFAULT_PERIODS, 6, { workStart: '08:30', workEnd: '16:30' }).text === '출근까지 3시간', '출근 3시간 전 문구가 틀립니다.');
// 3·4: 없는 기능(내일로 옮기기)·실제와 다른 단추 글자를 팁에 쓰지 않습니다.
check(!tips.some((t) => /옮겨|몇 개 남음|확인만|연필/.test(t)), `실제와 다른 팁이 있습니다: ${tips.filter((t) => /옮겨|몇 개 남음|확인만|연필/.test(t)).join(' / ')}`);
const src = ['Home.jsx', 'QuickBar.jsx', 'Tasks.jsx', 'Attend.jsx'].map((f) => readFileSync(new URL(`../src/ui/${f}`, import.meta.url), 'utf8')).join('\n');
for (const tip of tips) for (const [, label] of tip.matchAll(/‘([^’]+)’/g)) {
    const real = label.replace('N개', '{left}개');
    check(label === '내일' || src.includes(real), `팁의 단추 글자 '${label}'가 화면에 없습니다.`);
}
// r2 3번: 따옴표 밖에 적은 단추 이름도 봅니다. 화면의 진짜 단추 이름은 늘 ‘’로 감싸고, 그 밖에 '…를 눌러'·'…만 눌러'는 일반 이름(쨈 버튼 등)만 씁니다.
const realButtons = ['출결 하기', '출결 고치기', '마감하기', '마감됨', '일정 보기', '회의록 작성', '메시지·회의록 붙여넣기', '저장'];
const genericTap = new Set(['쨈 버튼', '마이크 버튼', '네모 칸', '칩', '✎', '단추']);
for (const tip of tips) {
    const bare = tip.replace(/‘[^’]*’/g, '‘’');
    for (const name of realButtons) check(!bare.includes(name), `팁이 단추 이름 '${name}'를 따옴표 없이(또는 실제와 다르게) 씁니다: ${tip}`);
    for (const [, what] of bare.matchAll(/([^\s‘’]+(?: [^\s‘’]+)?)(?:을|를|만) (?:눌러|누르)/g)) {
        const plain = what.replace(/^(?:[가-힣]+ )?(?=쨈|마이크|네모|할 일|✎)/, '');
        check(what.endsWith('‘’') || genericTap.has(plain) || [...genericTap].some((g) => what.endsWith(g)), `팁의 '${what}' 누르기가 실제 단추 이름과 맞는지 알 수 없습니다: ${tip}`);
    }
}
check(tips.some((t) => t.includes('‘마감하기’')), '모두 출석인 날 팁이 실제 단추 이름 ‘마감하기’를 쓰지 않습니다.');
// 1: 예전 규칙이 시각을 거절해 시각 없이 올린 할 일은, 내용이 같으면 받을 때 이 기기 시각을 지킵니다.
const { takeRemote } = await import('../src/lib/db.js');
const mine = { id: 'h1', title: '시각 지킬 일', due: '2026-11-04', time: '10:15', done: false };
holdTodoTime('h1', mine);
const sameCloud = fromCloudRow('todos', 'h1', { title: '시각 지킬 일', due: '2026-11-04', done: false });
check(heldTodoTime('h1', sameCloud) === '10:15' && takeRemote('todos', mine, sameCloud).time === '10:15', '예전 규칙에서 시각 없이 올린 할 일을 받을 때 이 기기 시각이 지워집니다.');
const otherEdit = fromCloudRow('todos', 'h1', { title: '다른 기기가 고침', due: '2026-11-04', done: false });
check(!takeRemote('todos', mine, otherEdit).time, '다른 기기가 고친 내용을 받을 때 지킨 시각이 잘못 남습니다.');
releaseTodoTime('h1');
// C2: 다른 기기가 시각을 지웠으면(시각 지킴 기록 없음) 이 기기 시각도 지웁니다.
check(!('time' in takeRemote('todos', mine, sameCloud)), 'C2: 다른 기기에서 지운 시각이 이 기기에 남습니다.');
check(takeRemote('todos', mine, { ...sameCloud, time: '11:00' }).time === '11:00', '받은 시각으로 바꾸지 않습니다.');
// R1: todos 블록 안에서 time을 'HH:MM'(hm)로 검사해야 합니다. 일정 블록의 같은 줄로는 통과하지 않습니다.
const todoBlock = rules.slice(rules.indexOf('match /todos/{tid}'), rules.indexOf('match /inbox/{iid}'));
check(todoBlock.includes("(!('time' in d()) || hm(d().time))") && /'due', 'time', 'got'/.test(todoBlock) && /function hm\(v\) \{ return v is string && v\.matches\('\^\(\[01\]\[0-9\]\|2\[0-3\]\):\[0-5\]\[0-9\]\$'\); \}/.test(rules), 'R1: 할 일 규칙이 time을 HH:MM으로 검사하지 않습니다.');
// r2 1번: 지킨 시각은 다시 올릴 목록에 들고(앱 켠 뒤 첫 번, 그 뒤 10분마다), 내용이 바뀌거나 다른 기기가 이기면 버립니다.
useHoldRetryForTest();
holdTodoTime('r1', { id: 'r1', title: '다시 올릴 일', due: '2026-11-04', time: '09:10', done: false });
holdTodoTime('r2', { id: 'r2', title: '내가 고칠 일', due: '2026-11-04', time: '09:20', done: false });
holdTodoTime('r3', { id: 'r3', title: '다른 기기가 끝낼 일', due: '2026-11-04', time: '09:30', done: false });
const nowTodos = [{ id: 'r1', title: '다시 올릴 일', due: '2026-11-04', time: '09:10', done: false }, { id: 'r2', title: '내가 고친 일', due: '2026-11-04', time: '09:20', done: false }, { id: 'r3', title: '다른 기기가 끝낼 일', due: '2026-11-04', time: '09:30', done: false }];
const first = heldTimesToRetry(nowTodos, 1000);
check(first.join() === 'r1,r3' && !heldTodoIds().includes('r2'), `지킨 시각 다시 올리기 목록이 틀립니다: ${first} / ${heldTodoIds()}`);
check(heldTimesToRetry(nowTodos, 2000).length === 0 && heldTimesToRetry(nowTodos, 1000 + 10 * 60 * 1000).join() === 'r1,r3', '지킨 시각을 너무 자주(또는 다시 안) 올립니다.');
settleHoldWithRemote('r3', { title: '다른 기기가 끝낼 일', due: '2026-11-04', done: true });
settleHoldWithRemote('r1', { title: '다시 올릴 일', due: '2026-11-04', done: false });
check(heldTodoIds().join() === 'r1', `다른 기기가 끝낸 할 일의 지킴 기록이 남거나, 같은 내용인데 버립니다: ${heldTodoIds()}`);
settleHoldWithRemote('r1', { title: '다시 올릴 일', due: '2026-11-04', done: false, time: '12:30' });
check(heldTodoIds().length === 0, '다른 기기가 시각을 넣었는데 지킴 기록이 남았습니다.');
// C1: 할 일 쓰기가 거절되면 시각만 빼고 다시 올리는 길이 cloud.js에 있어야 합니다.
const cloudSrc = readFileSync(new URL('../src/lib/cloud.js', import.meta.url), 'utf8');
check(/name === 'todos' && denied\(error\) \? todoBodyWithoutTime/.test(cloudSrc) && cloudSrc.includes('holdTodoTime(id, shaped.body)'), 'C1: 할 일 시각 거절 때 시각 없이 다시 올리는 길이 없습니다.');

if (failures.length) {
    for (const f of failures) console.error(`실패: ${f}`);
    process.exit(1);
}
console.log('check:alarm 통과');
