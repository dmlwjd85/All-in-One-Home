/* 시안 A: 쨈 날짜 칩·시각 알람 검사(화면 없이). */
import { readFileSync } from 'node:fs';
import { jjaemDateChip, readJjaemPaste, findTimeSpans, alarmTimeLabel } from '../src/lib/jjaemPaste.js';
import { saveQuick, snapshot, useVaultsForTest } from '../src/lib/db.js';
import { quickSaveDate } from '../src/ui/quickMatch.js';

let bad = 0;
const check = (ok, msg) => { if (!ok) { bad += 1; console.error(`✗ ${msg}`); } };
const now = new Date('2026-11-05T10:00:00+09:00');

const chip = jjaemDateChip('2026-11-05', '2026-11-05');
check(chip?.label === '오늘 · 11월 5일' && chip.day === 5, `오늘 칩: ${chip?.label}`);
check(jjaemDateChip('2026-11-06', '2026-11-05')?.label === '내일 · 11월 6일', '내일 칩');
check(jjaemDateChip('2026-11-07', '2026-11-05')?.label === '모레 · 11월 7일', '모레 칩');
check(jjaemDateChip('2026-12-25', '2026-11-05')?.label === '12월 25일', '먼 날짜 칩');

const a = readJjaemPaste('오늘 민준이 체육 시간에 친구를 도와줬어요.', { now, stripTime: false });
check(a.date === '2026-11-05' && a.body === '민준이 체육 시간에 친구를 도와줬어요.', `관찰 본문: ${a.body}`);
check(!a.body.includes('오늘'), '관찰 본문에 오늘이 남아요');

const b = readJjaemPaste('내일 3시 수행평가 채점', { now, stripTime: true });
check(b.date === '2026-11-06' && b.time === '15:00' && b.body === '수행평가 채점', `할 일 파싱: ${JSON.stringify(b)}`);

const c = readJjaemPaste('모레 오후 2시 반 학년 협의회', { now });
check(c.date === '2026-11-07' && c.time === '14:30' && c.body === '학년 협의회', `일정 파싱: ${c.body} ${c.time}`);

check(findTimeSpans('시험 3시간').length === 0, "'3시간'을 시각으로 봤어요");
check(findTimeSpans('3시 회의')[0]?.time === '15:00', '3시를 오후로 안 봤어요');

/* QA1 필수 1: 「N일」만 있고 날짜 조사가 없으면 날짜가 아닙니다. 본문도 그대로 둡니다. */
for (const line of ['3일 동안 결석했어요', '민준이 2일째 지각', '3일간 체험학습', '10일 만에 등교했어요', '결석 3일']) {
    const r = readJjaemPaste(line, { now, stripTime: false, stripDate: 'lead' });
    check(r.date === '' && r.body === line, `날짜 아닌 N일: ${line} → ${r.date} / ${r.body}`);
    const t = readJjaemPaste(line, { now, future: true });
    check(t.date === '' && t.body === line, `할 일 쪽 날짜 아닌 N일: ${line} → ${t.date} / ${t.body}`);
}
check(readJjaemPaste('15일에 학부모 상담', { now, future: true }).date === '2026-11-15', '「15일에」는 날짜예요');
check(readJjaemPaste('3일까지 제출', { now, future: true }).date === '2026-12-03', '「3일까지」는 날짜예요');
check(readJjaemPaste('11월 20일 협의회', { now, future: true }).date === '2026-11-20', '달이 있는 N일은 날짜예요');
/* QA1 필수 2: 조사 은·는·이·도 등을 날짜 낱말과 함께 뺍니다. 기록은 가운데 날짜 낱말을 지우지 않습니다. */
const mid = readJjaemPaste('민준이 오늘은 기분이 좋아요', { now, stripTime: false, stripDate: 'lead' });
check(mid.date === '2026-11-05' && mid.body === '민준이 오늘은 기분이 좋아요', `기록 가운데 날짜: ${mid.body}`);
for (const [line, want] of [['오늘은 기분이 좋아요', '기분이 좋아요'], ['오늘도 발표했어요', '발표했어요'], ['내일이 마감', '마감'], ['내일은 3시 회의', '회의'], ['내일까지는 제출', '제출'], ['오늘의 할 일 정리', '할 일 정리']]) {
    const r = readJjaemPaste(line, { now });
    check(r.body === want, `조사 빼기: ${line} → ${r.body}`);
    check(!/^[은는이가도의]\s/.test(r.body), `조사만 남았어요: ${r.body}`);
}
check(readJjaemPaste('오늘도서관 정리', { now }).body === '도서관 정리', '「오늘도서관」의 도를 조사로 봤어요');
/* 낮음 4: 시각·날짜 경계 */
check(findTimeSpans('저녁 12시 마감')[0]?.time === '00:00', '저녁 12시는 자정이에요');
check(findTimeSpans('밤 12시')[0]?.time === '00:00', '밤 12시는 자정이에요');
check(findTimeSpans('오후 12시 점심')[0]?.time === '12:00', '오후 12시는 낮 12시예요');
check(findTimeSpans('저녁 7시')[0]?.time === '19:00', '저녁 7시는 19시예요');
check(findTimeSpans('24시 마감')[0]?.time === '00:00', '24시는 0시예요');
check(findTimeSpans('3시 59분')[0]?.time === '15:59', '59분은 받아요');
check(findTimeSpans('3시 60분').length === 0 && findTimeSpans('3시 99분').length === 0, '60분 이상은 시각이 아니에요');
check(findTimeSpans('25시').length === 0, '25시는 시각이 아니에요');
const dir = readJjaemPaste('3시 방향 자리로 옮기기', { now });
check(dir.time === '' && dir.body === '3시 방향 자리로 옮기기', `3시 방향: ${dir.time} / ${dir.body}`);
const past = readJjaemPaste('3월 2일 개학 준비', { now, future: true });
check(past.date === '2027-03-02' && past.body === '개학 준비', `지난 3월 2일은 내년: ${past.date}`);
check(readJjaemPaste('11월 3일 회의록 정리', { now, future: true }).date === '2026-11-03', '며칠 전 날짜는 그대로');
check(readJjaemPaste('3월 2일 입학식 때 일', { now, stripTime: false, stripDate: 'lead' }).date === '2026-03-02', '기록의 지난 날짜는 그대로');
const yd = readJjaemPaste('어제 민준이 발표', { now, stripTime: false, stripDate: 'lead' });
check(yd.date === '2026-11-04' && yd.body === '민준이 발표', `어제: ${yd.date} / ${yd.body}`);
const sat = readJjaemPaste('토요일 3시 학부모 모임', { now, future: true });
check(sat.date === '2026-11-07' && sat.time === '15:00' && sat.body === '학부모 모임', `토요일(할 일): ${JSON.stringify(sat)}`);
check(readJjaemPaste('월요일에 민준이 결석', { now, stripTime: false, stripDate: 'lead' }).date === '2026-11-02', '기록의 월요일은 지난 월요일');
check(readJjaemPaste('매주 월요일 회의', { now, future: true }).date === '', '매주 월요일은 하루 날짜가 아니에요');
/* 낮음 2: 알람 글자는 오전/오후와 분까지 */
check(alarmTimeLabel('15:20') === '오후 3시 20분', `알람 글자: ${alarmTimeLabel('15:20')}`);
check(alarmTimeLabel('09:00') === '오전 9시' && alarmTimeLabel('00:00') === '오전 12시' && alarmTimeLabel('12:05') === '오후 12시 5분', '알람 글자 오전/오후');

function makeVault() {
    const bag = new Map();
    return {
        async get(key) { return bag.has(key) ? structuredClone(bag.get(key)) : undefined; },
        async set(key, value) { bag.set(key, structuredClone(value)); },
        async remove(key) { bag.delete(key); },
    };
}
useVaultsForTest(makeVault(), makeVault());

const rec = await saveQuick({ kind: '관찰', text: '오늘 민준이 발표를 잘했어요.', no: 0 }, now);
const records = [...(snapshot().records || []), ...(snapshot().local?.records || [])];
const recRow = records.find((row) => String(row.text || '').includes('발표'));
check(rec?.ok && recRow?.text === '민준이 발표를 잘했어요.' && recRow?.date === '2026-11-05', `관찰 저장: ${recRow?.text} / ${recRow?.date}`);

/* QA1 필수 1: 날짜를 안 넘겨도 「3일 동안」은 오늘·원문 그대로 저장합니다. */
await saveQuick({ kind: '관찰', text: '3일 동안 결석했어요', no: 0 }, now);
await saveQuick({ kind: '관찰', text: '민준이 2일째 지각', no: 0 }, now);
await saveQuick({ kind: '관찰', text: '민준이 오늘은 기분이 좋아요', no: 0 }, now);
const recs2 = [...(snapshot().records || []), ...(snapshot().local?.records || [])];
for (const line of ['3일 동안 결석했어요', '민준이 2일째 지각', '민준이 오늘은 기분이 좋아요']) {
    const row = recs2.find((item) => item.text === line);
    check(row?.date === '2026-11-05', `기록 원문·오늘 날짜: ${line} → ${row?.text} / ${row?.date}`);
}
/* 고른 날(input.date)은 본문 날짜보다 먼저입니다(QuickBar가 넘기는 값). */
await saveQuick({ kind: '관찰', text: '발표 연습을 도왔어요', no: 0, date: '2026-11-03' }, now);
const picked = [...(snapshot().records || []), ...(snapshot().local?.records || [])].find((item) => item.text === '발표 연습을 도왔어요');
check(picked?.date === '2026-11-03', `고른 날 기록: ${picked?.date}`);
await saveQuick({ kind: '관찰', text: '오늘 줄넘기 연습을 했어요', no: 0, date: '2026-11-03' }, now);
const keptDate = [...(snapshot().records || []), ...(snapshot().local?.records || [])].find((item) => String(item.text).includes('줄넘기'));
check(keptDate?.date === '2026-11-03', `넘긴 날짜를 본문 날짜가 덮어썼어요: ${keptDate?.date}`);

const todo = await saveQuick({ kind: '할 일', text: '내일 3시 수행평가 채점' }, now);
const todos = [...(snapshot().todos || []), ...(snapshot().local?.todos || [])];
const todoRow = todos.find((row) => String(row.title || '').includes('수행평가'));
check(todo?.ok && todoRow?.title === '수행평가 채점' && todoRow?.due === '2026-11-06' && todoRow?.time === '15:00', `할 일 알람: ${JSON.stringify(todoRow)}`);
check(String(todo?.message || '').includes('오후 3시'), `할 일 안내: ${todo?.message}`);

const ev = await saveQuick({ kind: '일정', text: '모레 4시 공개수업' }, now);
const events = [...(snapshot().events || []), ...(snapshot().local?.events || [])];
const evRow = events.find((row) => String(row.title || '').includes('공개수업'));
check(ev?.ok && evRow?.title === '공개수업' && evRow?.date === '2026-11-07' && evRow?.time === '16:00', `일정 저장: ${JSON.stringify(evRow)}`);

/* QA2 낮음1: 「밤 12시」 할 일은 다음 날 00:00, 안내는 「오늘 밤 12시」. */
const midnight = await saveQuick({ kind: '할 일', text: '밤 12시 마감' }, now);
const midTodos = [...(snapshot().todos || []), ...(snapshot().local?.todos || [])];
const midRow = midTodos.find((row) => String(row.title || '').includes('마감') && row.time === '00:00');
check(midnight?.ok && midRow?.due === '2026-11-06' && midRow?.time === '00:00', `밤 12시 할 일: ${JSON.stringify(midRow)}`);
check(String(midnight?.message || '').includes('오늘 밤 12시'), `밤 12시 안내: ${midnight?.message}`);

/* QA2 낮음2: 일정 빠른입력도 「N일 동안/째」는 날짜 아님. 「15일 회의」「11월 15일」은 유지. */
check(quickSaveDate('일정', '3일 동안 체험학습', '2026-11-05', now) === '2026-11-05', '일정 「3일 동안」을 날짜로 봤어요');
check(quickSaveDate('일정', '2일째 행사', '2026-11-05', now) === '2026-11-05', '일정 「2일째」를 날짜로 봤어요');
check(quickSaveDate('일정', '15일 회의', '2026-11-05', now) === '2026-11-15', '일정 「15일 회의」는 날짜예요');
check(quickSaveDate('일정', '11월 15일 공개수업', '2026-11-05', now) === '2026-11-15', '일정 「11월 15일」은 날짜예요');
check(quickSaveDate('일정', '내일 운동회', '2026-11-05', now) === '2026-11-06', '일정 「내일」은 날짜예요');

/* QA2 권장: 「N월 N일 동안/째」 변이 + 보조 글 색 */
check(readJjaemPaste('11월 3일 동안 체험학습', { now, future: true }).date === '', '「11월 3일 동안」을 날짜로 봤어요');
check(readJjaemPaste('3월 2일째 지각', { now, future: true }).date === '', '「3월 2일째」를 날짜로 봤어요');
check(readJjaemPaste('11월 15일 협의회', { now, future: true }).date === '2026-11-15', '「11월 15일」은 날짜예요');

const sw = readFileSync('public/sw.js', 'utf8');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v71'"), 'SW 판이 v71가 아닙니다');
const todoUi = readFileSync('src/ui/TodoAlarm.jsx', 'utf8');
check(todoUi.includes('todo-alarm-bell') && todoUi.includes('todo-alarm-head'), '알림 노란 카드 머리가 없습니다');
const css = readFileSync('src/index.css', 'utf8');
check(css.includes('.jjaem-date-chip') && css.includes('#e8f3ff') && css.includes('#fff7e8'), '시안 A 칩·알람 색이 없습니다');
check(/\.todo-alarm-item\s*\{[^}]*flex-wrap:\s*wrap/.test(css), '알람 항목에 flex-wrap: wrap이 없습니다');
check(css.includes('todo-alarm-main') && /flex:\s*1\s+1\s+10em/.test(css), '알람 글 덩어리에 flex: 1 1 10em이 없습니다');
check(/\.todo-alarm-sub\s*\{[^}]*#6f645d/.test(css), '알람 보조 글 색 #6f645d가 없습니다');
check(todoUi.includes('todo-alarm-main'), '알람 카드에 todo-alarm-main이 없습니다');
const students = readFileSync('src/ui/Students.jsx', 'utf8');
check(students.includes('DateChip'), '학생 기록에 날짜 칩이 없습니다');
check(/<DateChip\s+ymd=\{row\.date\}/.test(students), '학생 기록 줄에 DateChip이 쓰이지 않습니다');
check(students.includes('data-role="record-hm"') && students.includes('row.date === clock.ymd'), '오늘 기록 칩 옆 시각이 없습니다');
check((todoUi.match(/지금 울렸어요/g) || []).length === 1, '「지금 울렸어요」는 머리글에만 한 번 둡니다');
check(todoUi.includes('alarmTimeLabel(') && todoUi.includes("'Escape'"), '알람 오전/오후 글자나 Esc 닫기가 없습니다');
const quick = readFileSync('src/ui/QuickBar.jsx', 'utf8');
check(/paste\.date \|\| dateYmd/.test(quick), 'QuickBar가 날짜를 못 읽으면 고른 날을 쓰지 않습니다');
const home = ['src/ui/Home.jsx', 'src/ui/Today.jsx'].map((file) => { try { return readFileSync(file, 'utf8'); } catch { return ''; } }).join('\n');
check(!home.includes('DateChip'), '홈에는 DateChip을 두지 않습니다');
const ci = readFileSync('.github/workflows/deploy-pages.yml', 'utf8');
check(ci.includes('npm run check:jjaem-paste'), 'CI에 check:jjaem-paste가 없습니다');

if (bad) { console.error(`시안 A 검사 실패 ${bad}건`); process.exit(1); }
console.log('시안 A 쨈 날짜 칩·알람 검사 통과');
