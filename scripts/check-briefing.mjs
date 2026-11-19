/** 아침 브리핑: 언제 뜨는지, 무엇을 어떤 차례로 권하는지. */
import { readFileSync } from 'node:fs';
import { BRIEF_KEY, BRIEF_MAX_STEPS, briefEnabled, buildBriefing, greeting, markBriefSeen, rankTodos, setBriefEnabled, shouldShowBrief } from '../src/lib/briefing.js';

const root = new URL('..', import.meta.url).pathname;
const src = (p) => readFileSync(`${root}/${p}`, 'utf8');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const store = () => { const bag = new Map(); return { bag, getItem: (k) => (bag.has(k) ? bag.get(k) : null), setItem: (k, v) => bag.set(k, String(v)) }; };

/* 언제 뜨나 */
const st = store();
check(!shouldShowBrief({ ymd: '2026-11-19', hm: '07:59' }, st), '8시 전에는 뜨지 않습니다.');
check(shouldShowBrief({ ymd: '2026-11-19', hm: '08:00' }, st) && shouldShowBrief({ ymd: '2026-11-19', hm: '13:20' }, st), '8시 뒤 처음 열면 떠야 합니다(늦게 열어도).');
check(!shouldShowBrief({ ymd: '2026-11-19', hm: '09:00', rest: true }, st), '쉬는 날에는 뜨지 않습니다.');
check(!shouldShowBrief({ ymd: '2026-11-19', hm: '09:00', started: false }, st), '시작 전(첫 설정 중)에는 뜨지 않습니다.');
markBriefSeen('2026-11-19', st);
check(!shouldShowBrief({ ymd: '2026-11-19', hm: '15:00' }, st), '하루에 한 번만 뜹니다.');
check(shouldShowBrief({ ymd: '2026-11-20', hm: '08:10' }, st), '다음 날에는 다시 뜹니다.');
setBriefEnabled(false, st);
check(!briefEnabled(st) && !shouldShowBrief({ ymd: '2026-11-20', hm: '08:10' }, st), '끄면 뜨지 않습니다.');
setBriefEnabled(true, st);
check(shouldShowBrief({ ymd: '2026-11-20', hm: '08:10' }, st) && [...st.bag.keys()].join() === BRIEF_KEY, '다시 켜면 뜨고, 이 기기 키 하나만 씁니다.');
st.bag.set(BRIEF_KEY, '{깨짐');
check(shouldShowBrief({ ymd: '2026-11-20', hm: '08:10' }, st), '깨진 저장값이면 켜진 것으로 봅니다.');
check(greeting('08:10', '목').startsWith('좋은 아침') && greeting('13:00', '목').startsWith('오후') && greeting('18:00', '').endsWith('.'), '시간대 인사');

/* 할 일 차례 */
const todos = [
    { id: 'a', title: '나중 일', done: false },
    { id: 'b', title: '내일 마감', done: false, due: '2026-11-20' },
    { id: 'c', title: '중요', done: false, pri: 3 },
    { id: 'd', title: '오늘 마감', done: false, due: '2026-11-19', pendingNos: [3, 7] },
    { id: 'e', title: '지난 마감', done: false, due: '2026-11-17' },
    { id: 'f', title: '끝낸 일', done: true, due: '2026-11-18' },
    { id: 'g', title: '  ', done: false },
];
check(rankTodos(todos, '2026-11-19', '2026-11-20').map((r) => r.id).join('') === 'edcba', `할 일 차례: ${rankTodos(todos, '2026-11-19', '2026-11-20').map((r) => r.id).join('')}`);

/* 브리핑 */
const periods = [
    { n: 1, label: '국어', start: '09:00', length: 40, specialist: '', locked: false },
    { n: 2, label: '수학', start: '09:50', length: 40, specialist: '', locked: false },
    { n: 3, label: '', start: '10:40', length: 40, specialist: '', locked: false },
    { n: 4, label: '체육', start: '11:30', length: 40, specialist: '전담', locked: false },
];
const base = {
    ymd: '2026-11-19', tomorrow: '2026-11-20', hm: '08:20', weekday: '목', checked: false, periods,
    events: [{ id: 'e1', date: '2026-11-19', time: '14:00', title: '학년 회의', memo: '3층 협의실' }],
    tomorrowEvents: [{ id: 'e2', date: '2026-11-20', time: '08:50', title: '현장체험학습', memo: '도시락' }],
    todos, homework: [{ id: 'h1', title: '독서록', date: '2026-11-19', submitted: 20, total: 27 }, { id: 'h2', title: '다 냄', date: '2026-11-18', submitted: 27, total: 27 }],
    allergy: [{ no: '3', name: '박서준' }], follows: [], birthdays: [], absent: [{ no: '15', name: '정유나', status: '지각' }], noticeTomorrow: false,
};
const brief = buildBriefing(base);
const ids = brief.steps.map((s) => s.id);
check(brief.steps.length === BRIEF_MAX_STEPS && brief.more > 0, `한 화면에 ${BRIEF_MAX_STEPS}가지까지만: ${ids}`);
check(ids[0] === 'allergy' && ids[1] === 'attend', `알레르기·출결이 먼저여야 합니다: ${ids}`);
check(brief.steps[1].title.includes('1교시(09:00) 전에') && brief.steps[1].sub.includes('15번 정유나 지각') && brief.steps[1].href === '#/attend/2026-11-19', `출결 권유: ${JSON.stringify(brief.steps[1])}`);
check(ids.includes('event-e1') && ids.includes('todo-e') && ids.indexOf('todo-e') < ids.indexOf('todo-d'), `일정·급한 할 일: ${ids}`);
check(brief.steps.find((s) => s.id === 'todo-e').sub.includes('마감이 지났어요'), '마감 지난 일의 까닭');
check(brief.summary === '수업 3교시 · 일정 1개 · 할 일 5개(급한 것 2)', `요약: ${brief.summary}`);
check(brief.agenda.map((a) => a.time).join() === '09:00,09:50,11:30,14:00' && brief.agenda[2].text.includes('전담') && brief.agenda[3].kind === 'event', `오늘 흐름: ${JSON.stringify(brief.agenda)}`);
/* 덜 붐비는 날: 전담 시간에 다음 할 일 권하기, 과제, 내일 준비 */
const light = buildBriefing({ ...base, allergy: [], checked: true, events: [], todos: [{ id: 'n', title: '수행평가 나이스 입력', done: false, due: '2026-11-21' }] });
const lid = light.steps.map((s) => s.id);
check(lid.join() === 'hw-h1,slot-n,tmr-e2', `가벼운 날 차례: ${lid}`);
check(light.steps[1].title.includes('4교시 체육(전담) 시간에') && light.steps[1].sub.includes('11:30~12:10'), `전담 시간 권유: ${JSON.stringify(light.steps[1])}`);
check(light.steps[0].sub.includes('7명') && light.steps[0].href === '#/homework/h1', '과제 걷기 권유');
check(light.steps[2].href === '#/notice' && light.steps[2].sub.includes('알림장'), '내일 준비: 알림장이 비었으면 알림장으로');
/* 전담 시간이 이미 지났으면 권하지 않음, 수업 중 표시 */
const late = buildBriefing({ ...base, hm: '13:00', allergy: [], checked: true, events: [], homework: [], tomorrowEvents: [], noticeTomorrow: true, todos: [{ id: 'n', title: '수행평가', done: false }] });
check(late.steps.map((s) => s.id).join() === 'todo-n' && late.agenda.every((a) => a.past), `지난 전담 시간은 권하지 않습니다: ${late.steps.map((s) => s.id)}`);
check(buildBriefing({ ...base, hm: '09:10' }).agenda[0].now === true, '지금 수업 표시');
/* 아무 일도 없는 날 */
const calm = buildBriefing({ ymd: '2026-11-19', tomorrow: '2026-11-20', hm: '08:30', weekday: '목', checked: true, periods, events: [], tomorrowEvents: [], todos: [], homework: [], noticeTomorrow: true });
check(calm.calm && calm.steps.length === 0 && calm.summary === '수업 3교시 · 일정 없음 · 할 일 없음', `한가한 날: ${calm.summary}`);

/* 화면 연결 */
const ui = src('src/ui/MorningBrief.jsx');
const app = src('src/App.jsx');
check(/<MorningBrief busy=\{locked \|\| route\.name === 'start'\} \/>/.test(app) && /id === 'brief'/.test(app), '앱에 아침 브리핑이 붙어 있지 않습니다.');
check(/role="dialog" aria-modal="true" aria-label="오늘 브리핑"/.test(ui) && /markBriefSeen\(clock\.ymd\)/.test(ui) && /navigator\.webdriver/.test(ui) && /get\('brief'\) === '1'/.test(ui), '브리핑 팝업·하루 한 번 표시·자동 검사 예외');
check(/querySelector\('\[aria-modal="true"\], \.sheet-back, \.quick-bar\.is-open'\)/.test(ui), '다른 창이 떠 있으면 기다려야 합니다.');
check(/data-role="brief-toggle"/.test(src('src/ui/TodoSettings.jsx')) && /data-role="brief-now"/.test(src('src/ui/TodoSettings.jsx')), '설정에 아침 브리핑 켜기·끄기가 없습니다.');
check(/\{ id: 'brief', label: '오늘 브리핑', group: '동작', fallback: 'b' \}/.test(src('src/ui/hotkeys.js')), '오늘 브리핑 단축키가 없습니다.');
check(/\.brief-pop \.brief-step \{\s*display: grid;/.test(src('src/ui/brief.css')), '브리핑 줄 배치가 .block(display:block)에 덮입니다.');
check(!/briefing|ssug-gyomu-brief/.test(src('src/lib/db.js')), '브리핑 표시는 기록·클라우드에 넣지 않습니다.');

if (failures.length) {
    console.error(`아침 브리핑 검사 실패 ${failures.length}건`);
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
}
console.log('아침 브리핑 검사를 통과했습니다.');
