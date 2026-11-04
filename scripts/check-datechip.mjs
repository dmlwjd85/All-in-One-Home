/* 날짜 칩(B1)·주간 목록(A1) 검사. 화면 없이 돌아갑니다. */
import { readFileSync } from 'node:fs';
import { readEventChips } from '../src/lib/dateChips.js';
import { detailRows } from '../src/lib/detail.js';
import { toCloudRow } from '../src/lib/cloudShape.js';
import { weekRows } from '../src/lib/weekRows.js';
import { saveQuick, snapshot, useVaultsForTest } from '../src/lib/db.js';

let bad = 0;
const check = (ok, msg) => { if (!ok) { bad += 1; console.error(`✗ ${msg}`); } };
const now = new Date('2026-11-04T09:00:00+09:00');

const a = readEventChips('내일 3교시 공개수업', { now });
check(a.title === '공개수업', `제목에 날짜 낱말이 남았어요: ${a.title}`);
check(a.date === '2026-11-05' && a.period === 3 && a.time === '10:30', '내일·3교시가 날짜·시각으로 안 갔어요');
check(a.raw === '내일 3교시 공개수업', '원문이 보관되지 않았어요');
check(a.chips.map((c) => c.label).join('|') === '📅 11/5(목)|⏰ 3교시 10:30', `칩 글자: ${a.chips.map((c) => c.label)}`);
check(!a.warning, '헷갈리지 않는 글에 경고가 떴어요');

const b = readEventChips('모레 학년 협의회', { now });
check(b.title === '학년 협의회' && b.date === '2026-11-06', '모레 처리');
const c = readEventChips('내일 오후 3시 교직원 회의', { now });
check(c.title === '교직원 회의' && c.time === '15:00' && c.period === 0, '오후 3시 처리');
const d = readEventChips('내일에 3시 반 상담', { now });
check(d.title === '상담' && d.time === '15:30', `조사 '에'·'반' 처리: ${d.title} ${d.time}`);

const off = readEventChips('내일 3교시 공개수업', { now, off: [a.chips[0].id] });
check(off.title === '내일 공개수업' && off.date === '' && off.period === 3, '칩을 해제하면 낱말이 글에 남고 날짜는 안 바뀌어야 해요');
const allOff = readEventChips('내일 3교시 공개수업', { now, off: a.chips.map((x) => x.id) });
check(allOff.title === '내일 3교시 공개수업' && !allOff.changed, '칩을 모두 빼면 처음 글 그대로');

const two = readEventChips('내일 모레 시험', { now });
check(two.warning.includes('둘 이상'), '날짜가 둘이면 노란 확인 카드');
const wrongDay = readEventChips('11월 5일(수) 체험학습', { now });
check(wrongDay.warning.includes('목요일'), '요일이 틀리면 노란 확인 카드');
const plain = readEventChips('시간표 정리', { now });
check(plain.title === '시간표 정리' && !plain.changed && !plain.chips.length, '날짜 낱말 없는 글은 그대로');
const onlyDate = readEventChips('내일', { now });
check(onlyDate.title === '내일' && onlyDate.warning, '날짜만 적으면 내용을 적으라고 안내');
check(!readEventChips('시험 3시간', { now }).chips.length, "'3시간'은 시각이 아니에요");

/* 자세히 보기: 원문 줄 */
const rows = detailRows('event', { date: '2026-11-05', title: '공개수업', raw: '내일 3교시 공개수업' });
check(rows.some(([k, v]) => k === '처음 적은 글' && v === '내일 3교시 공개수업'), '자세히 보기에 처음 적은 글이 없어요');
check(!detailRows('event', { date: '2026-11-05', title: '회의', raw: '회의' }).some(([k]) => k === '처음 적은 글'), '원문이 제목과 같으면 숨겨요');

/* raw는 클라우드 칸에 올리지 않아요(배포된 규칙이 모르는 칸이라 거절되면 일정이 안 올라감). */
const shaped = toCloudRow('events', { id: 'event1', date: '2026-11-05', title: '공개수업', raw: '내일 3교시 공개수업', kind: '학급', source: 'app' });
check(shaped && !('raw' in shaped.body), 'raw가 클라우드 몸통에 들어갔어요');
const rules = readFileSync('firestore.rules', 'utf8');
check(!/'raw'/.test(rules.slice(rules.indexOf('match /events/'), rules.indexOf('match /tombs/'))), '규칙을 바꾸지 않는 설계입니다');

/* 화면: 고치기 버튼이 줄마다 없고, + 일정 버튼, 주말 접기 */
const line = readFileSync('src/ui/EventLine.jsx', 'utf8');
check(!/className="chip"[^>]*고치기/.test(line), '일정 줄마다 고치기 버튼이 남았어요');
const sched = readFileSync('src/ui/Schedule.jsx', 'utf8');
check(sched.includes('add-event-fab') && sched.includes('+ 일정'), "'+ 일정' 버튼이 없어요");
check(/aria-expanded=\{weekendOpen/.test(sched) && sched.includes('setWeekendOpen((open) => !open)'), '접힌 주말 줄을 눌러 펼치고 접을 수 없어요');

/* 주말 접힘: 동작으로 봅니다. 2026-11-02 주(월) */
const emptyWeek = weekRows('2026-11-02', [], []);
const fold = emptyWeek.at(-1);
check(emptyWeek.length === 6 && fold?.fold === true, `일정 없는 주말이 한 줄로 접히지 않아요(${emptyWeek.length}줄)`);
check(fold?.days?.map((day) => day.date).join() === '2026-11-07,2026-11-08', '접힌 주말을 펼칠 토·일 줄이 없어요');
check(emptyWeek.slice(0, 5).every((row) => !row.fold && row.date), '평일 줄이 빠졌어요');
const satEvent = { id: 'w1', date: '2026-11-07', title: '토요 봉사' };
const busyWeek = weekRows('2026-11-02', [satEvent], [satEvent]);
check(busyWeek.length === 7 && !busyWeek.some((row) => row.fold), '주말에 일정이 있는데 접혔어요');
check(busyWeek[5].events.some((row) => row.id === 'w1'), '토요일 일정이 토요일 줄에 없어요');
const sunEvent = { id: 'w2', date: '2026-11-08', title: '일요 행사' };
check(!weekRows('2026-11-02', [sunEvent], [sunEvent]).some((row) => row.fold), '일요일에 일정이 있는데 접혔어요');

/* saveQuick이 raw를 실제로 기기 줄에 남기는지 봅니다. */
function makeVault() {
    const bag = new Map();
    return {
        async get(key) { return bag.has(key) ? structuredClone(bag.get(key)) : undefined; },
        async set(key, value) { bag.set(key, structuredClone(value)); },
        async remove(key) { bag.delete(key); },
    };
}
useVaultsForTest(makeVault(), makeVault());
const saved = await saveQuick({ kind: '일정', text: '내일 3교시 공개수업', title: '공개수업', raw: '내일 3교시 공개수업', date: '2026-11-05', period: 3, time: '10:30' });
const allEvents = () => [...(snapshot().events || []), ...(snapshot().local?.events || [])];
const savedRow = allEvents().find((row) => row.title === '공개수업');
check(saved?.ok !== false && savedRow, '칩으로 정리한 일정이 저장되지 않았어요');
check(savedRow?.raw === '내일 3교시 공개수업', `saveQuick이 raw를 보관하지 않아요: ${savedRow?.raw}`);
check(savedRow?.date === '2026-11-05', '칩 날짜로 저장되지 않았어요');
await saveQuick({ kind: '일정', text: '학년 회의', title: '학년 회의', raw: '학년 회의', date: '2026-11-05' });
check(!('raw' in (allEvents().find((row) => row.title === '학년 회의') || {})), '제목과 같은 raw는 남기지 않아요');
const cloudOf = toCloudRow('events', savedRow || {});
check(cloudOf && !('raw' in cloudOf.body), 'saveQuick으로 저장한 줄의 raw가 클라우드 몸통에 들어가요');

if (bad) { console.error(`날짜 칩 검사 실패 ${bad}건`); process.exit(1); }
console.log('날짜 칩·주간 목록 검사 통과');
