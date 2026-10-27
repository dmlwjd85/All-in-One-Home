/** 9·10교시, 수업 길이, 잠금, 출퇴근·조퇴, 퇴근 타이머, 10교시 읽기를 확인합니다. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const failures = [];
let passed = 0;
function check(ok, message) {
    if (ok) passed += 1;
    else failures.push(message);
}

/* 이 기기 저장소를 흉내 냅니다. */
const bag = new Map();
globalThis.localStorage = {
    getItem: (key) => (bag.has(key) ? bag.get(key) : null),
    setItem: (key, value) => bag.set(key, String(value)),
    removeItem: (key) => bag.delete(key),
};

const { DEFAULT_PERIODS, eulReul, leaveProblem, periodStatus, workTimer } = await import('../src/lib/period.js');
const local = await import('../src/lib/periodLocal.js');
const { detectWhen, parseSchoolMessages } = await import('../src/lib/msgParse.js');
const { toCloudRow } = await import('../src/lib/cloudShape.js');
const db = await import('../src/lib/db.js');

const six = ['국어', '수학', '사회', '과학', '체육', '음악'];
const opts = { last: 6, workStart: '08:30', workEnd: '16:40' };

/* 예전 호출은 그대로입니다. */
const old = periodStatus('08:42', DEFAULT_PERIODS, ['국어', '수학']);
check(old.minutes === 18 && old.text === '1교시 국어까지 18분', `예전 호출이 바뀌었습니다: ${old.text}`);
check(DEFAULT_PERIODS.length === 8 && DEFAULT_PERIODS[4] === '13:10', '기본 교시 시각 8개가 바뀌었습니다.');

/* 점심시간은 4교시 중이 아닙니다. */
const lunch = periodStatus('12:30', DEFAULT_PERIODS, six, opts);
check(lunch.phase === 'lunch' && lunch.text.startsWith('점심시간이에요') && !lunch.text.includes('4교시 중'), `점심시간 문구가 틀립니다: ${lunch.text}`);
check(lunch.text.includes('5교시 체육까지 40분'), `점심 뒤 다음 교시가 없습니다: ${lunch.text}`);
const fourth = periodStatus('11:50', DEFAULT_PERIODS, six, opts);
check(fourth.text === '4교시 과학 중이에요', `4교시 수업 중 문구가 틀립니다: ${fourth.text}`);

/* 마지막 교시 뒤부터 퇴근 전까지 방과후입니다. */
const after = periodStatus('15:30', DEFAULT_PERIODS, six, opts);
check(after.text === '방과후 시간이에요.' && after.phase === 'afterschool', `15:30 방과후 문구가 틀립니다: ${after.text}`);
check(!after.text.includes('7교시') && !after.text.includes('8교시'), '6교시 날에 7·8교시가 나옵니다.');
const sixth = periodStatus('14:20', DEFAULT_PERIODS, six, opts);
check(sixth.text === '6교시 음악 중이에요', `6교시 문구가 틀립니다: ${sixth.text}`);
const gone = periodStatus('16:41', DEFAULT_PERIODS, six, opts);
check(gone.text === '퇴근 시간이 지났어요.', `퇴근 뒤 문구가 틀립니다: ${gone.text}`);
const early = periodStatus('08:10', DEFAULT_PERIODS, six, opts);
check(early.text === '출근 전이에요.', `출근 전 문구가 틀립니다: ${early.text}`);
const noWork = periodStatus('15:30', DEFAULT_PERIODS, six, { last: 6 });
check(noWork.text === '방과후 시간이에요.', `퇴근 시각이 없을 때 방과후가 아닙니다: ${noWork.text}`);
const night = periodStatus('20:00', DEFAULT_PERIODS, six, { last: 6 });
check(night.text === '오늘 수업이 끝났어요.', `저녁 문구가 틀립니다: ${night.text}`);

/* 조퇴가 있으면 방과후·퇴근 문구도 조퇴 시각을 따릅니다. */
const leaveOpts = { ...opts, workEnd: '14:40', endLabel: '조퇴' };
check(periodStatus('14:41', DEFAULT_PERIODS, six, leaveOpts).text === '조퇴 시간이 지났어요.', '조퇴 뒤 문구가 틀립니다.');
check(periodStatus('14:20', DEFAULT_PERIODS, six, leaveOpts).text === '6교시 음악 중이에요', '조퇴 전 수업 문구가 틀립니다.');

/* 수업 길이와 잠금 */
const starts2 = ['09:00', '09:50'];
check(periodStatus('09:44', starts2, ['국어', '수학'], { lengths: [45, 45] }).text === '1교시 국어 중이에요', '45분 수업이 45분 동안 이어지지 않습니다.');
check(periodStatus('09:44', starts2, ['국어', '수학'], { lengths: [40, 40] }).text === '2교시 수학까지 6분', '40분 수업 뒤 쉬는 시간이 아닙니다.');
check(periodStatus('09:44', starts2, ['국어', '수학']).text === '2교시 수학까지 6분', '길이를 정하지 않은 수업이 40분이 아닙니다.');
const skipped = periodStatus('09:10', DEFAULT_PERIODS, six, { ...opts, skip: [1] });
check(skipped.index === 1 && skipped.text.startsWith('2교시'), `잠근 1교시가 빠지지 않습니다: ${skipped.text}`);

/* 퇴근 타이머 */
const at = (hm, s = 0) => { const [h, m] = hm.split(':').map(Number); return h * 3600 + m * 60 + s; };
const work = { workStart: '08:30', workEnd: '16:40' };
check(workTimer(at('15:28'), work).text === '퇴근까지 1시간 12분', `1시간 12분이 아닙니다: ${workTimer(at('15:28'), work).text}`);
check(workTimer(at('15:40'), work).text === '퇴근까지 1시간', `딱 1시간이 아닙니다: ${workTimer(at('15:40'), work).text}`);
check(workTimer(at('16:00'), work).text === '퇴근까지 40분', '40분이 아닙니다.');
const five = workTimer(at('16:35'), work);
check(five.text === '퇴근까지 5분 00초' && five.seconds === true, `5분 남음이 분·초가 아닙니다: ${five.text}`);
check(workTimer(at('16:30'), work).text === '퇴근까지 10분 00초', '딱 10분 남았을 때 초가 없습니다.');
check(workTimer(at('16:29', 59), work).text === '퇴근까지 11분' && !workTimer(at('16:29', 59), work).seconds, '10분 넘게 남았는데 초가 나옵니다.');
check(workTimer(at('16:39', 15), work).text === '퇴근까지 45초', '1분 안쪽이 초만 나오지 않습니다.');
const done = workTimer(at('16:40'), work);
check(done.show && done.done && done.text === '퇴근 시간이 지났어요', `지남 문구가 틀립니다: ${done.text}`);
check(!workTimer(at('08:00'), work).show, '출근 전에 타이머가 보입니다.');
check(!workTimer(at('15:00'), { workStart: '08:30', workEnd: '' }).show, '퇴근 시각이 없는데 타이머가 보입니다.');
check(Math.abs(workTimer(at('12:35'), work).progress - 0.5) < 0.001, '진행 막대가 출근~퇴근 가운데가 아닙니다.');
const leave = workTimer(at('14:00'), { ...work, leave: '14:40' });
check(leave.text === '조퇴까지 40분' && leave.label === '조퇴', `조퇴 타이머가 틀립니다: ${leave.text}`);
check(Math.abs(leave.progress - (330 / 370)) < 0.001, '조퇴 날 진행 막대가 조퇴 시각을 따르지 않습니다.');
check(workTimer(at('14:41'), { ...work, leave: '14:40' }).text === '조퇴 시간이 지났어요', '조퇴 지남 문구가 틀립니다.');

/* 잠긴 교시는 빈 시간일 뿐 점심이 아닙니다. 점심은 4교시가 끝난 뒤부터입니다. */
const lock3 = periodStatus('10:20', DEFAULT_PERIODS, six, { ...opts, skip: [3] });
check(lock3.phase !== 'lunch' && lock3.text === '4교시 과학까지 60분', `3교시를 잠근 10:20이 점심으로 나옵니다: ${lock3.text}`);
const friCell = periodStatus('09:40', DEFAULT_PERIODS, six, { ...opts, skip: [2] });
check(friCell.phase !== 'lunch' && friCell.text === '3교시 사회까지 50분', `금 2교시 칸을 잠근 09:40이 점심으로 나옵니다: ${friCell.text}`);
const lock4 = periodStatus('11:30', DEFAULT_PERIODS, six, { ...opts, skip: [4] });
check(lock4.phase !== 'lunch' && !lock4.text.includes('점심'), `4교시를 잠근 11:30이 점심으로 나옵니다: ${lock4.text}`);
check(periodStatus('12:10', DEFAULT_PERIODS, six, { ...opts, skip: [4] }).phase === 'lunch', '4교시를 잠가도 12:10은 점심이어야 합니다.');
check(periodStatus('12:00', DEFAULT_PERIODS, six, opts).phase === 'lunch' && periodStatus('11:59', DEFAULT_PERIODS, six, opts).text === '4교시 과학 중이에요', '점심 시작 경계가 틀립니다.');
check(periodStatus('13:10', DEFAULT_PERIODS, six, opts).text === '5교시 체육 중이에요', '점심 끝 경계가 틀립니다.');
/* 4교시 날은 점심이 끝난 뒤에 방과후입니다. */
const four = six.slice(0, 4);
check(periodStatus('12:00', DEFAULT_PERIODS, four, { ...opts, last: 4 }).phase === 'lunch', '4교시 날 12:00이 점심이 아닙니다.');
check(periodStatus('12:40', DEFAULT_PERIODS, four, { ...opts, last: 4 }).phase === 'lunch', '4교시 날 점심 중에 방과후가 나옵니다.');
check(periodStatus('13:10', DEFAULT_PERIODS, four, { ...opts, last: 4 }).text === '방과후 시간이에요.', '4교시 날 점심 뒤가 방과후가 아닙니다.');

/* 딱 맞는 분 경계 */
check(periodStatus('09:00', DEFAULT_PERIODS, six, opts).text === '1교시 국어 중이에요', '09:00 정각이 1교시 중이 아닙니다.');
check(periodStatus('08:59', DEFAULT_PERIODS, six, opts).text === '1교시 국어까지 1분', '08:59가 1교시 전이 아닙니다.');
check(periodStatus('09:40', DEFAULT_PERIODS, six, opts).text === '2교시 수학 중이에요', '09:40 정각에 1교시가 끝나지 않습니다.');
check(periodStatus('09:39', DEFAULT_PERIODS, six, opts).text === '1교시 국어 중이에요', '09:39에 1교시가 끝납니다.');
check(periodStatus('16:40', DEFAULT_PERIODS, six, opts).text === '퇴근 시간이 지났어요.', '16:40 정각이 퇴근이 아닙니다.');
check(periodStatus('16:39', DEFAULT_PERIODS, six, opts).text === '방과후 시간이에요.', '16:39에 벌써 퇴근입니다.');
check(workTimer(at('08:30'), work).show && !workTimer(at('08:29', 59), work).show, '출근 정각에 타이머가 숨거나 출근 전에 보입니다.');
check(!workTimer(at('10:00'), { workStart: '', workEnd: '16:40' }).show, '출근 시각이 없는데 타이머가 보입니다.');

/* 9·10교시까지 쓰는 날 */
const tenLocal = { ...local.defaultPeriodLocal(), count: 10 };
const tenRow = { p1: '국어', p9: '보충', p10: '자습' };
const tenLabels = Array.from({ length: 10 }, (_, i) => tenRow[`p${i + 1}`] || '');
check(local.lastPeriod(tenRow, tenLocal, 'mon') === 10, '10교시가 마지막 교시가 아닙니다.');
const tenNow = periodStatus('17:30', local.allStarts(DEFAULT_PERIODS, tenLocal), tenLabels, { last: local.lastPeriod(tenRow, tenLocal, 'mon'), workStart: '08:30', workEnd: '18:30' });
check(tenNow.text === '10교시 자습 중이에요', `10교시 중 문구가 틀립니다: ${tenNow.text}`);

/* 과목이 있는 교시는 교시 수를 줄여도 쓰는 교시입니다. */
const sevenTable = { mon: { id: 'mon', p1: '국어', p6: '음악', p7: '동아리' } };
const sixLocal = { ...local.defaultPeriodLocal(), count: 6 };
check(local.usedCount(sevenTable, sixLocal) === 7 && local.withUsedCount(sevenTable, sixLocal).count === 7 && sixLocal.count === 6, '7교시 과목이 있는데 6교시까지만 셉니다.');
check(local.usedCount({ mon: { p1: '국어' } }, sixLocal) === 6 && local.withUsedCount({}, sixLocal) === sixLocal, '과목이 없는데 교시 수가 바뀝니다.');
check(local.usedCount({}, { ...sixLocal, extra: { tue: { p9: '보충' } } }) === 9, '이 기기의 9교시 과목을 세지 않습니다.');
const used = local.withUsedCount(sevenTable, sixLocal);
const sevenRow = local.tableRow(sevenTable, 'mon', used);
const sevenLabels = Array.from({ length: used.count }, (_, i) => sevenRow[`p${i + 1}`] || '');
const sevenNow = periodStatus('14:55', local.allStarts(DEFAULT_PERIODS, used), sevenLabels, { last: local.lastPeriod(sevenRow, used, 'mon'), workStart: '08:30', workEnd: '16:40' });
check(sevenNow.text === '7교시 동아리 중이에요', `교시 수 6인데 7교시 과목이 있을 때 문구가 틀립니다: ${sevenNow.text}`);

/* 조퇴 시각은 출근 뒤, 퇴근 전, 지금 뒤만 됩니다. */
const wk = { workStart: '08:30', workEnd: '16:40' };
check(leaveProblem('14:30', '10:00', wk) === '', '알맞은 조퇴 시각을 막습니다.');
check(leaveProblem('08:00', '07:50', wk).includes('출근 시각(08:30)보다 늦은'), '출근 전 조퇴를 막지 않습니다.');
check(leaveProblem('17:00', '10:00', wk).includes('퇴근 시각(16:40)보다 이른') && leaveProblem('16:40', '10:00', wk) !== '', '퇴근 뒤 조퇴를 막지 않습니다.');
check(leaveProblem('09:00', '10:00', wk).startsWith('이미 지난 시각') && leaveProblem('10:00', '10:00', wk) !== '' && leaveProblem('10:01', '10:00', wk) === '', '지난 시각 조퇴를 막지 않습니다.');
check(leaveProblem('', '10:00', wk).includes('14:30처럼'), '빈 조퇴 시각을 막지 않습니다.');

/* 숫자 뒤 조사 */
check([1, 3, 6, 7, 8, 10].every((n) => eulReul(n) === '을') && [2, 4, 5, 9].every((n) => eulReul(n) === '를'), '숫자 뒤 을/를이 틀립니다.');

/* 이 기기 저장: 조퇴는 그날만, 취소 가능 */
local.setLeave('2026-10-27', '14:40');
check(local.leaveFor('2026-10-27') === '14:40', '오늘 조퇴를 저장하지 못했습니다.');
check(local.leaveFor('2026-10-28') === '', '다음 날에도 조퇴가 남아 있습니다.');
check(bag.has(local.LEAVE_KEY) && local.LEAVE_KEY === 'ssug-gyomu-leave-early', '조퇴가 새 키에 저장되지 않습니다.');
local.setLeave('2026-10-27', '');
check(local.leaveFor('2026-10-27') === '', '조퇴를 취소하지 못했습니다.');
local.setLeave('2026-10-27', '14:40');
local.setLeave('2026-10-28', '15:00');
check(local.leaveFor('2026-10-27') === '' && local.leaveFor('2026-10-28') === '15:00', '지난 날 조퇴가 쌓입니다.');

/* 교시 설정 */
check(local.allLengths({ ...local.defaultPeriodLocal(), level: '중' }).every((n) => n === 45), '중학교 기본 길이가 45분이 아닙니다.');
check(local.allLengths({ ...local.defaultPeriodLocal(), level: '고' })[0] === 50, '고등학교 기본 길이가 50분이 아닙니다.');
check(local.allLengths({ ...local.defaultPeriodLocal(), level: '초', lengths: [0, 35] })[1] === 35, '교시별 길이를 고칠 수 없습니다.');
const ten = local.allStarts(DEFAULT_PERIODS, local.defaultPeriodLocal());
check(ten.length === 10 && ten[8] === '16:30' && ten[9] === '17:20', '9·10교시 시작 시각이 없습니다.');
const lockState = { ...local.defaultPeriodLocal(), count: 7, locks: [7], cellLocks: ['mon-3'] };
check(local.isLocked(lockState, 'tue', 7) && local.isLocked(lockState, 'mon', 3) && !local.isLocked(lockState, 'tue', 3), '교시·칸 잠금이 틀립니다.');
check(local.lastPeriod({ p1: '국어', p6: '음악', p7: '동아리' }, lockState, 'mon') === 6, '잠긴 7교시가 마지막 교시가 됩니다.');
local.patchPeriodLocal({ workEnd: '16:40' });
check(JSON.parse(bag.get(local.PERIOD_LOCAL_KEY)).workEnd === '16:40' && local.PERIOD_LOCAL_KEY === 'ssug-gyomu-period-local', '설정이 새 키에 저장되지 않습니다.');

/* 공용 PC 에서는 메모리에만 둡니다. */
bag.clear();
bag.set('ssug-gyomu-shared', '1');
local.patchPeriodLocal({ workEnd: '17:00' });
local.setLeave('2026-10-27', '15:00');
check(!bag.has(local.PERIOD_LOCAL_KEY) && !bag.has(local.LEAVE_KEY), '공용 PC 에서 이 기기에 저장합니다.');
check(local.readPeriodLocal().workEnd === '17:00' && local.leaveFor('2026-10-27') === '15:00', '공용 PC 에서 메모리 값을 읽지 못합니다.');
bag.clear();

/* 9·10교시는 서버로 보내지 않습니다. */
await db.boot('');
await db.setTimetable('mon', 9, '보충');
await db.setTimetable('mon', 2, '수학');
const snap = db.snapshot();
check(!('p9' in (snap.timetable.mon || {})) && snap.timetable.mon?.p2 === '수학', '9교시가 계정 시간표에 들어갑니다.');
check(local.readPeriodLocal().extra.mon?.p9 === '보충' && local.tableRow(snap.timetable, 'mon').p9 === '보충', '9교시를 이 기기에 저장하지 못했습니다.');
const cloud = toCloudRow('timetable', { id: 'mon', p2: '수학', p9: '보충', p10: '자습' });
check(cloud && !JSON.stringify(cloud).includes('보충') && !JSON.stringify(cloud).includes('자습'), '9·10교시가 서버 모양에 들어갑니다.');

/* 10교시를 1교시로 읽지 않습니다. 한 자리 교시는 그대로입니다. */
const starts10 = ten;
const w10 = detectWhen('내일 10교시 동아리', starts10);
check(w10.period === 10 && w10.hm === '17:20', `10교시를 읽지 못합니다: ${JSON.stringify(w10)}`);
const r910 = detectWhen('9~10교시 자율학습', starts10);
check(r910.period === 9 && r910.periodEnd === 10, `9~10교시 범위를 읽지 못합니다: ${JSON.stringify(r910)}`);
check(detectWhen('내일 10교시 동아리').period === 0, '8교시 시각표에서 10교시를 1교시로 읽습니다.');
check(detectWhen('내일 3교시 체육').period === 3 && detectWhen('1교시 국어').hm === '09:00', '한 자리 교시가 바뀌었습니다.');
check(detectWhen('8교시 방과후').period === 8 && detectWhen('8교시 방과후').hm === '15:40', `8교시를 읽지 못합니다: ${JSON.stringify(detectWhen('8교시 방과후'))}`);
check(detectWhen('9교시 보충', starts10).period === 9 && detectWhen('9교시 보충', starts10).hm === '16:30', '9교시를 1~10교시처럼 읽지 못합니다.');
check(detectWhen('7교시 동아리').period === 7 && detectWhen('9교시 보충').period === 0, '시작 시각이 없는 교시를 읽습니다.');
const items = parseSchoolMessages('내일 10교시 보충수업', { now: new Date('2026-10-27T09:00:00+09:00'), periods: starts10 }).items;
check(items.length === 1 && items[0].title === '보충수업' && items[0].time === '17:20', `10교시 일정 이름이 틀립니다: ${JSON.stringify(items.map((row) => [row.title, row.time]))}`);
const plain = parseSchoolMessages('내일 10교시 보충수업', { now: new Date('2026-10-27T09:00:00+09:00') }).items;
check(!plain.some((row) => /^1\s/.test(row.title)), '10교시의 1이 일정 이름에 남습니다.');

/* 화면: 타이머는 홈 카드, 휴일엔 숨김, 백그라운드에서 멈춤 */
const read = (rel) => readFileSync(join(root, rel), 'utf8');
const timerSrc = read('src/ui/WorkTimer.jsx');
const homeSrc = read('src/ui/Home.jsx');
check(/visibilitychange/.test(timerSrc) && /document\.hidden\) return/.test(timerSrc) && /if \(document\.hidden\) clearTimeout/.test(timerSrc), '탭이 가려져도 타이머가 멈추지 않습니다.');
check(/fast \? 1000 - \(Date\.now\(\) % 1000\) : 60000 - \(Date\.now\(\) % 60000\)/.test(timerSrc), '1분·1초 갱신이 정각에 맞춰지지 않습니다.');
check(/useWorkClock\(fast\)/.test(homeSrc) && !/clock[,}][^\n]*= useUi\(\)/.test(homeSrc) && /now=\{clock\}/.test(homeSrc) && !/useWorkClock\(/.test(timerSrc.slice(timerSrc.indexOf('export function WorkTimer'))), '홈 문구와 타이머가 다른 시계를 씁니다.');
check(/leaveProblem\(draft, now\.hm/.test(timerSrc), '조퇴 시각을 확인하지 않습니다.');
const scheduleSrc = read('src/ui/Schedule.jsx');
check(/aria-pressed=\{editLocked\}/.test(scheduleSrc) && /칸 잠금 풀기/.test(scheduleSrc) && /칸 잠그기/.test(scheduleSrc) && /onClick=\{\(\) => lockCell\(edit\.day, edit\.period\)\}/.test(scheduleSrc), '키보드로 칸을 잠글 버튼이 없습니다.');
check(!/잠긴 칸이에요/.test(scheduleSrc) && /\$\{locked \? '잠김'/.test(scheduleSrc), '잠긴 칸을 키보드로 열 수 없거나 읽어 주지 않습니다.');
check(/\$\{period\}\$\{eulReul\(period\)\}/.test(scheduleSrc) && !/\$\{period\}을/.test(scheduleSrc), "'5을'처럼 조사가 틀립니다.");
const settingsSrc = read('src/ui/TimetableSettings.jsx');
check(/if \(custom && !window\.confirm\(/.test(settingsSrc), '학교급을 바꿀 때 고친 길이를 묻지 않습니다.');
check(/if \(workEnd && !workStart\)/.test(settingsSrc), '출근 시각 없이 퇴근 시각만 저장됩니다.');
check(/withUsedCount\(data\.timetable/.test(homeSrc) && /withUsedCount\(data\.timetable/.test(scheduleSrc) && /withUsedCount\(data\.timetable/.test(read('src/ui/Day.jsx')), '과목이 있는 교시를 숨기는 화면이 있습니다.');
check(/slots\.some\(\(slot\) => slot\.label\) \? slots\.filter/.test(homeSrc) && /🔒/.test(homeSrc) && !/if \(isLocked\(local, day, index \+ 1\)\) return null/.test(homeSrc), '홈 시간표에 빈 교시가 남거나 잠긴 교시가 안 보입니다.');
check(/!todayRest\.off && \(local\.workEnd \|\| leave\)/.test(homeSrc), '주말·휴일에도 타이머가 보입니다.');
check(homeSrc.indexOf('{timer}') > homeSrc.indexOf('home-hero') && homeSrc.indexOf('{timer}') < homeSrc.indexOf('home-quick'), '타이머 카드가 홈 첫 화면 위쪽에 없습니다.');
const css = read('src/index.css');
check(/\.home-grid\.has-leave \.home-leave \{ grid-column: 3; grid-row: 1; \}/.test(css), '넓은 화면에서 타이머가 오른쪽 위에 없습니다.');
check(/\.tt-settings \{ max-width: 640px;/.test(css), '시간표 설정이 넓은 화면에서 옆으로 늘어납니다.');
check(/\.tt-row strong \{ white-space: nowrap;/.test(css), "좁은 화면에서 '10교시'가 줄바꿈됩니다.");

const allText = ['src/lib/period.js', 'src/lib/periodLocal.js', 'src/ui/WorkTimer.jsx', 'src/ui/TimetableSettings.jsx'].map(read).join('\n');
check(!/쓱|잼|JAM|콕/.test(allText), '금지 표기가 들어 있습니다.');

if (failures.length) {
    console.error(failures.map((line) => `실패: ${line}`).join('\n'));
    console.error(`${passed}개 통과, ${failures.length}개 실패`);
    process.exit(1);
}
console.log(`시간표·퇴근 타이머 검사를 통과했습니다. (${passed}개)`);
process.exit(0);
