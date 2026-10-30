/** 자세히 보기 팝업, 학기 시간표 채우기, 그날 시간표, 스크롤 탭 방지 검사. */
import { readFileSync } from 'node:fs';
import { detailRows } from '../src/lib/detail.js';
import { planTermFill, schoolDays, tableForDate, tableForDateWithLocal, termDays, termRange } from '../src/lib/semester.js';
import { academicOffEvents, academicProblem, cleanAcademic, setAcademicSource } from '../src/lib/academic.js';
import { restInfo } from '../src/lib/daymark.js';
import { fromCloudSettings, toCloudSettings } from '../src/lib/cloudShape.js';
import { joinSummary, recentSummary } from '../src/lib/foldSummary.js';
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

/* 그날 시간표 + 이 기기 9·10교시(tableForDateWithLocal) */
{
    const local = { extra: { mon: { p9: '방과후', s9: '전담' } } };
    const base = { timetable: { mon: { p1: '국어', p2: '수학' } }, profile: { ttEdited: [] } };
    const mon = tableForDateWithLocal(base, '2026-10-26', local);
    check(mon.p1 === '국어' && mon.p9 === '방과후' && mon.s9 === '전담', `요일 줄에 9교시가 붙지 않았습니다: ${JSON.stringify(mon)}`);
    const own = tableForDateWithLocal({ ...base, timetable: { ...base.timetable, '2026-10-26': { p1: '체육' } } }, '2026-10-26', local);
    check(own.p1 === '체육' && !own.p2 && own.p9 === '방과후', `그날 줄이 요일 줄보다 먼저가 아니거나 9교시가 빠졌습니다: ${JSON.stringify(own)}`);
    const clash = tableForDateWithLocal({ ...base, timetable: { ...base.timetable, '2026-10-26': { p9: '보충' } } }, '2026-10-26', local);
    check(clash.p9 === '보충', '그날 따로 적은 9교시가 이 기기 값에 덮였습니다.');
    const emptyEdited = tableForDateWithLocal({ timetable: { mon: { p1: '국어' }, '2026-10-26': {} }, profile: { ttEdited: ['2026-10-26'] } }, '2026-10-26', {});
    check(!emptyEdited.p1, '그날 비워 둔(고친) 날에 요일 시간표가 다시 들어갔습니다.');
    const tue = tableForDateWithLocal(base, '2026-10-27', local);
    check(!tue.p9 && !tue.p1, '다른 요일에 월요일 9교시가 붙었습니다.');
    check(Object.keys(tableForDateWithLocal({}, '2026-10-26', undefined)).length === 0, '빈 자료에서 오류 없이 빈 줄이 나오지 않습니다.');
}

/* 학사일정: 설정에 넣은 날이 학기 타일·수업일·휴일에 반영 */
{
    const academic = cleanAcademic({ 2026: { firstStart: '2026-03-03', firstEnd: '2026-07-21', secondStart: '2026-08-18', secondEnd: '2027-02-10', offDays: ['2026-05-04', '2026-05-04', 'x'] }, abc: { firstStart: '2026-03-03' } });
    check(!academic.abc && academic['2026'].offDays.length === 1, `학사일정 정리가 이상합니다: ${JSON.stringify(academic)}`);
    const f = termRange('first', 2026, [], academic);
    const s2 = termRange('second', 2026, [], academic);
    check(f.from === '2026-03-03' && f.to === '2026-07-21' && f.source === '우리 학교', `학사일정 1학기 범위가 다릅니다: ${JSON.stringify(f)}`);
    check(s2.from === '2026-08-18' && s2.to === '2027-02-10', `학사일정 2학기 범위가 다릅니다: ${JSON.stringify(s2)}`);
    const marked2 = termRange('first', 2026, [{ date: '2026-07-17', title: '여름방학식' }], academic);
    check(marked2.to === '2026-07-21', '설정 학사일정보다 일정 글자를 먼저 썼습니다.');
    const offs = academicOffEvents(academic);
    check(offs.some((row) => row.title === '재량휴업일' && row.date === '2026-05-04'), '재량휴업일이 휴일로 바뀌지 않았습니다.');
    check(offs.some((row) => row.title === '여름방학' && row.date === '2026-07-22' && row.end === '2026-08-17'), `여름방학 기간이 다릅니다: ${JSON.stringify(offs)}`);
    check(offs.some((row) => row.title === '겨울방학' && row.date === '2027-02-11' && row.end === '2027-02-28'), '종업식 뒤 겨울방학이 없습니다.');
    setAcademicSource(academic);
    check(restInfo('2026-05-04', []).off && restInfo('2026-05-04', []).label === '재량휴업일', '재량휴업일이 휴일 표시에 없습니다.');
    check(restInfo('2026-08-03', []).off, '여름방학 날이 휴일 표시에 없습니다.');
    check(!restInfo('2026-08-18', []).off, '2학기 개학일이 휴일로 나옵니다.');
    const yearDays = termDays('year', 2026, []);
    check(yearDays[0] === '2026-03-03' && !yearDays.includes('2026-05-04') && !yearDays.includes('2026-08-03') && yearDays.includes('2026-08-18') && yearDays[yearDays.length - 1] === '2027-02-10', '1년 수업일에 학사일정이 반영되지 않았습니다.');
    setAcademicSource({});
    check(academicProblem({ firstStart: '2026-07-01', firstEnd: '2026-03-01' }).includes('뒤여야'), '날짜 순서가 거꾸로여도 막지 않습니다.');
    check(academicProblem(academic['2026']) === '', '바른 학사일정을 막습니다.');
    const ac = readFileSync('src/ui/AcademicSettings.jsx', 'utf8');
    check(!/<select|type="date"|type=\{?"date/.test(ac) && ac.includes('monthCells') && ac.includes('onClick={() => tapDay'), '학사일정 입력이 한 번 누르는 달력이 아닙니다.');
}

/* 기기끼리 같이 쓰는 설정(settings/device) 모양 */
{
    const shaped = toCloudSettings({ profile: { settingsAt: 5, ttEdited: ['2026-04-01', 'bad'], periodStarts: ['09:00', '9시'], academic: { 2026: { firstStart: '2026-03-03', offDays: ['2026-05-04'] } } } },
        { syncAt: 9, level: '중', count: 7, lengths: [45], extraStarts: ['16:40'], locks: [9], cellLocks: ['mon-9', 'bad'], workStart: '08:20', workEnd: '', extra: { mon: { p9: '방과후', p3: '국어', x: 1 }, sat: { p9: '?' } } });
    const body = shaped.body;
    check(body.at === 9 && body.ttEdited.length === 1 && body.periodStarts.length === 1, `설정 시각·목록 정리가 이상합니다: ${JSON.stringify(body)}`);
    check(body.periodLocal.extra === 'mon-p9=방과후', '9·10교시 밖 칸이나 주말이 올라갑니다.');
    check(!('leave' in body) && !JSON.stringify(body).includes('leave-early'), '오늘 조퇴 시각이 올라갑니다.');
    const back = fromCloudSettings(JSON.parse(JSON.stringify(body)));
    check(back?.at === 9 && back.periodLocal.count === 7 && back.academic['2026'].firstStart === '2026-03-03', '받은 설정을 되살리지 못했습니다.');
    check(fromCloudSettings({}) === null, '빈 설정 문서를 받아들였습니다.');
    const sensitive = toCloudSettings({ profile: {} }, { extra: { mon: { p9: '민준 학폭 상담' } } }).body;
    check(sensitive.periodLocal.extra === '', '민감한 9교시 글이 올라갑니다.');
}

/* 최근 항목 요약: 빈 조각이면 끝에 ' · '가 남지 않습니다. */
check(recentSummary({ title: '관찰', text: '' }) === '관찰', `최근 요약 끝에 구분 글자가 남습니다: ${recentSummary({ title: '관찰', text: '' })}`);
check(recentSummary({ title: '관찰', text: '   ' }) === '관찰', '공백뿐인 내용이 요약에 남습니다.');
check(recentSummary({ title: '관찰', text: '발표' }) === '관찰 · 발표', '최근 요약이 제목 · 내용 모양이 아닙니다.');
check(recentSummary({ title: '', text: '' }) === '아직 기록이 없어요' && recentSummary(undefined) === '아직 기록이 없어요', '빈 최근 요약이 비어 보입니다.');
check(joinSummary(['a', null, '']) === 'a', '빈 조각을 빼지 않습니다.');

/* 캐시 판 */
check(readFileSync('public/sw.js', 'utf8').includes("ssug-gyomu-shell-v48"), '서비스 워커가 v48이 아닙니다.');

if (failed) { console.error(`check-five: ${failed}개 실패`); process.exit(1); }
console.log('check-five: 통과');
