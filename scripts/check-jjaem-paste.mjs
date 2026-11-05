/* 시안 A: 쨈 날짜 칩·시각 알람 검사(화면 없이). */
import { readFileSync } from 'node:fs';
import { jjaemDateChip, readJjaemPaste, findTimeSpans } from '../src/lib/jjaemPaste.js';
import { saveQuick, snapshot, useVaultsForTest } from '../src/lib/db.js';

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

const todo = await saveQuick({ kind: '할 일', text: '내일 3시 수행평가 채점' }, now);
const todos = [...(snapshot().todos || []), ...(snapshot().local?.todos || [])];
const todoRow = todos.find((row) => String(row.title || '').includes('수행평가'));
check(todo?.ok && todoRow?.title === '수행평가 채점' && todoRow?.due === '2026-11-06' && todoRow?.time === '15:00', `할 일 알람: ${JSON.stringify(todoRow)}`);
check(String(todo?.message || '').includes('15:00'), `할 일 안내: ${todo?.message}`);

const ev = await saveQuick({ kind: '일정', text: '모레 4시 공개수업' }, now);
const events = [...(snapshot().events || []), ...(snapshot().local?.events || [])];
const evRow = events.find((row) => String(row.title || '').includes('공개수업'));
check(ev?.ok && evRow?.title === '공개수업' && evRow?.date === '2026-11-07' && evRow?.time === '16:00', `일정 저장: ${JSON.stringify(evRow)}`);

const sw = readFileSync('public/sw.js', 'utf8');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v64'"), 'SW 판이 v64가 아닙니다');
const todoUi = readFileSync('src/ui/TodoAlarm.jsx', 'utf8');
check(todoUi.includes('todo-alarm-bell') && todoUi.includes('todo-alarm-head'), '알림 노란 카드 머리가 없습니다');
const css = readFileSync('src/index.css', 'utf8');
check(css.includes('.jjaem-date-chip') && css.includes('#e8f3ff') && css.includes('#fff7e8'), '시안 A 칩·알람 색이 없습니다');
const students = readFileSync('src/ui/Students.jsx', 'utf8');
check(students.includes('DateChip'), '학생 기록에 날짜 칩이 없습니다');

if (bad) { console.error(`시안 A 검사 실패 ${bad}건`); process.exit(1); }
console.log('시안 A 쨈 날짜 칩·알람 검사 통과');
