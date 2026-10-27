/** 자세히 보기 팝업, 학기 시간표 채우기, 그날 시간표, 스크롤 탭 방지 검사. */
import { readFileSync } from 'node:fs';
import { detailRows } from '../src/lib/detail.js';
import { planTermFill, schoolDays, tableForDate, termDays, termRange } from '../src/lib/semester.js';
import { isTap, tapHandlers, TAP_SLOP } from '../src/ui/tapGuard.js';

let failed = 0;
function check(ok, message) {
    if (!ok) { failed += 1; console.error(`✗ ${message}`); }
}

/* 1. 자세히 보기 */
const ev = detailRows('event', { title: '아주 긴 현장체험학습 안내와 준비물 확인', date: '2026-05-11', end: '2026-05-13', time: '09:00', endTime: '15:00', memo: '도시락, 물, 우비' });
check(ev.some(([k, v]) => k === '기간' && v === '3일'), '일정 기간이 없습니다.');
check(ev.some(([k, v]) => k === '시간' && v === '09:00–15:00'), '일정 시간이 없습니다.');
check(ev.some(([k, v]) => k === '메모' && v.includes('우비')), '일정 메모가 없습니다.');
const todo = detailRows('todo', { title: '가정통신문', due: '2026-05-12', done: false, of: 25, got: 20 });
check(todo.some(([k]) => k === '마감') && todo.some(([k, v]) => k === '받기' && v === '25명 중 20명'), '할 일 자세히가 모자랍니다.');
const tasks = readFileSync('src/ui/Tasks.jsx', 'utf8');
check(tasks.includes('todo-check') && tasks.includes('isClipped(title)') && tasks.includes('toggleTodo(row.id)'), '할 일 체크 칸과 잘린 제목 팝업이 나뉘지 않았습니다.');
const home = readFileSync('src/ui/Home.jsx', 'utf8');
check(home.includes('data-home-todo') && home.includes('data-home-event') && home.includes('<DetailSheet'), '홈 할 일·일정에서 팝업이 열리지 않습니다.');

/* 2. 학기 채우기 */
const first = termRange('first', 2026, []);
check(first.from === '2026-03-02' && first.to === '2026-07-24' && first.source === '기본값', '1학기 기본 범위가 다릅니다.');
const second = termRange('second', 2026, []);
check(second.from === '2026-08-17' && second.to === '2027-02-12', '2학기 기본 범위가 다릅니다.');
const year = termRange('year', 2026, []);
check(year.from === '2026-03-02' && year.to === '2027-02-12', '1년 범위가 다릅니다.');
const marked = termRange('first', 2026, [{ date: '2026-07-21', title: '여름방학식' }, { date: '2026-08-20', title: '2학기 개학' }]);
check(marked.to === '2026-07-21' && marked.source === '학사일정', '학사일정의 방학식을 쓰지 않았습니다.');
check(termRange('second', 2026, [{ date: '2026-08-20', title: '2학기 개학' }]).from === '2026-08-20', '학사일정의 개학을 쓰지 않았습니다.');
const days = schoolDays('2026-05-01', '2026-05-08', [{ date: '2026-05-07', title: '재량휴업일' }]);
check(!days.includes('2026-05-02') && !days.includes('2026-05-03'), '주말을 빼지 않았습니다.');
check(!days.includes('2026-05-05'), '어린이날(공휴일)을 빼지 않았습니다.');
check(!days.includes('2026-05-07'), '학사일정 휴업일을 빼지 않았습니다.');
check(days.includes('2026-05-04') && days.includes('2026-05-06') && days.includes('2026-05-08'), '수업일이 빠졌습니다.');
const all = schoolDays(first.from, first.to, []);
check(all.length > 90 && all.length < 105, `1학기 수업일 수가 이상합니다(${all.length}).`);
const base = { mon: { p1: '국어', s4: '전담', p4: '영어' }, tue: { p1: '수학' } };
const plan = planTermFill(base, ['2026-05-04', '2026-05-05', '2026-05-11'], { edited: ['2026-05-11'], keepEdited: true });
check(plan.rows['2026-05-04']?.p1 === '국어' && plan.rows['2026-05-04']?.s4 === '전담', '요일 시간표가 날짜로 안 들어갑니다.');
check(plan.rows['2026-05-05']?.p1 === '수학', '화요일 시간표가 안 들어갑니다.');

const june = schoolDays('2026-06-01', '2026-06-05', []);
check(!june.includes('2026-06-03') && june.includes('2026-06-02') && june.includes('2026-06-04'), '6/3 지방선거일이 학기 채우기에서 빠지지 않습니다.');
check(!all.includes('2026-06-03'), '1학기 채우기에 6/3 선거일이 들어갔습니다.');
check(all[0] === '2026-03-03', `1학기 첫 수업일이 3/3이 아닙니다(${all[0]}).`);
check(schoolDays(second.from, second.to, [])[0] === '2026-08-18', '2학기 첫 수업일이 8/18이 아닙니다.');
const yearDays = termDays('year', 2026, []);
check(yearDays.length === termDays('first', 2026, []).length + termDays('second', 2026, []).length && !yearDays.includes('2026-08-03'), '1년 채우기에 여름방학이 들어갔습니다.');
const termUi = readFileSync('src/ui/TermFill.jsx', 'utf8');
check(termUi.includes('shortDate(from)') && termUi.includes('days[0]'), '타일에 실제 첫 수업일을 보여 주지 않습니다.');
const eventLine = readFileSync('src/ui/EventLine.jsx', 'utf8');
check(eventLine.includes('<DetailSheet') && eventLine.includes('고치기'), '일정 탭 목록에서 자세히 팝업이 안 열리거나 고치기가 사라졌습니다.');

/* 3. 그날 고치기 */
check(!plan.rows['2026-05-11'] && plan.kept.includes('2026-05-11'), '고친 날을 덮어썼습니다.');
const over = planTermFill(base, ['2026-05-11'], { edited: ['2026-05-11'], keepEdited: false });
check(over.rows['2026-05-11']?.p1 === '국어', '덮어쓰기를 골랐는데 안 덮었습니다.');
const data = { profile: { ttEdited: ['2026-05-11'] }, timetable: { ...base, '2026-05-11': { p1: '체육' }, '2026-05-18': {} } };
check(tableForDate(data, '2026-05-11').p1 === '체육', '그날 시간표를 먼저 쓰지 않습니다.');
check(tableForDate(data, '2026-05-18').p1 === '국어', '빈 날짜 줄이면 기본으로 돌아가야 합니다.');
check(tableForDate(data, '2026-05-25').p1 === '국어', '날짜 줄이 없으면 요일 시간표를 써야 합니다.');
const db = readFileSync('src/lib/db.js', 'utf8');
check(db.includes('export async function setDayTimetable') && db.includes('ttEdited') && db.includes('export async function applyTermTimetable'), '그날 시간표 저장이 없습니다.');
check(readFileSync('src/ui/TermFill.jsx', 'utf8').includes('고친 날은 그대로'), '고친 날 덮어쓰기 전에 묻지 않습니다.');

/* 4. 스크롤 탭 방지 */
check(TAP_SLOP === 10, '탭 허용 거리가 10px가 아닙니다.');
check(isTap({ x: 0, y: 0 }, { x: 3, y: 6 }), '작게 흔들린 탭을 놓쳤습니다.');
check(!isTap({ x: 0, y: 0 }, { x: 0, y: 12 }), '12px 끌기를 탭으로 봤습니다.');
check(!isTap({ x: 0, y: 0 }, { x: 0, y: 2 }, { scrolled: true }), '스크롤 중 탭을 받았습니다.');
let picked = 0;
let heard = 0;
const h = tapHandlers({ onDown: () => { heard += 1; }, onTap: () => { picked += 1; } });
h.onPointerDown({ button: 0, clientX: 10, clientY: 10 });
check(heard === 1 && picked === 0, '누르자마자 설정이 바뀌거나 소리가 없습니다.');
h.onPointerMove({ clientX: 10, clientY: 40 });
h.onPointerUp({ clientX: 10, clientY: 40 });
check(picked === 0, '스크롤로 지나간 칩이 골라졌습니다.');
h.onPointerDown({ button: 0, clientX: 10, clientY: 10 });
h.onPointerUp({ clientX: 12, clientY: 13 });
check(picked === 1, '제대로 누른 칩이 골라지지 않았습니다.');
h.onPointerDown({ button: 0, clientX: 10, clientY: 10 });
h.onPointerCancel();
h.onPointerUp({ clientX: 10, clientY: 10 });
check(picked === 1, '취소된 누름이 골라졌습니다.');
const settings = readFileSync('src/ui/Settings.jsx', 'utf8');
const keyPick = settings.slice(settings.indexOf('function KeyPick('), settings.indexOf('export function Settings()'));
check(keyPick.includes('tapHandlers') && !/onPointerDown=\{[^}]*onPick/.test(keyPick), 'KeyPick이 pointerdown에서 바로 고릅니다.');
const ui = ['Settings', 'Home', 'Tasks', 'Day', 'Schedule', 'TermFill', 'DayTimetable', 'DetailSheet'].map((name) => readFileSync(`src/ui/${name}.jsx`, 'utf8')).join('\n');
check(!/onTouchStart=/.test(ui) && !/onPointerDown=\{\(\)\s*=>\s*set/.test(ui), 'touchstart/pointerdown에서 바로 바꾸는 곳이 남았습니다.');
check(!/<select/.test(ui), '드롭다운이 들어갔습니다.');

/* 캐시 판 */
check(readFileSync('public/sw.js', 'utf8').includes("ssug-gyomu-shell-v27"), '서비스 워커가 v27이 아닙니다.');

if (failed) { console.error(`check-five: ${failed}개 실패`); process.exit(1); }
console.log('check-five: 통과');
