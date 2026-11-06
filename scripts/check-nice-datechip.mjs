/* 나이스·설정 두 칸(시안 A)과 실시간 날짜·시각 칩(기간 비변환·오전오후 고침) 검사. */
import { readFileSync } from 'node:fs';
import { applyLiveChips, readEventChips } from '../src/lib/dateChips.js';
import { findDates } from '../src/lib/parse.js';

let bad = 0;
const check = (ok, msg) => { if (!ok) { bad += 1; console.error(`✗ ${msg}`); } };
const now = new Date('2026-11-06T12:00:00+09:00');

check(!findDates('3일 동안 체험학습', now).length, '「3일 동안」을 날짜로 바꿨어요');
check(!findDates('3일간 현장학습', now).length, '「3일간」을 날짜로 바꿨어요');
check(findDates('3일 운동회', now)[0]?.ymd === '2026-12-03', '맨날 「3일」은 날짜로 남아야 해요');

const live = readEventChips('내일 3시 학년 회의', { now });
check(live.date === '2026-11-07' && live.time === '15:00', `실시간 칩 기본값: ${live.date} ${live.time}`);
check(live.chips.some((c) => c.type === 'time' && c.ambiguous), '애매한 3시에 ambiguous가 없어요');
const flipped = readEventChips('내일 3시 학년 회의', { now, ampmFlip: ['t3'] });
check(flipped.time === '03:00', `오전↔오후 고침 실패: ${flipped.time}`);
const cleared = readEventChips('', { now });
check(!cleared.chips.length && !cleared.changed, '빈 글에도 칩이 남아요');

const dur = readEventChips('3일 동안 체험학습 준비', { now });
check(!dur.date && dur.title.includes('3일 동안'), `기간 칩 오변환: date=${dur.date} title=${dur.title}`);

const css = readFileSync('src/index.css', 'utf8');
check(css.includes('.neis-split') && css.includes('.settings-menu'), '나이스·설정 두 칸 CSS가 없어요');
check(/@media \(min-width: 900px\)[\s\S]*?\.settings-menu\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2/.test(css), '설정 두 칸 그리드가 없어요');
check(/@media \(min-width: 900px\)[\s\S]*?\.neis-split\s*\{[\s\S]*?grid-template-columns:/.test(css), '나이스 두 칸 그리드가 없어요');

const students = readFileSync('src/ui/Students.jsx', 'utf8');
check(students.includes('neis-split') && students.includes('neis-list') && students.includes('neis-detail'), '나이스 목록·상세 마크업이 없어요');

const flow = readFileSync('src/ui/FlowSheet.jsx', 'utf8');
check(flow.includes('LiveEventChips') && flow.includes('ampmFlip'), 'FlowSheet 실시간 칩이 없어요');
const quick = readFileSync('src/ui/QuickSheet.jsx', 'utf8');
check(quick.includes('LiveEventChips'), 'QuickSheet 실시간 칩이 없어요');
const plus = readFileSync('src/ui/PlusSheet.jsx', 'utf8');
check(plus.includes('LiveEventChips') && plus.includes('applyLiveChips'), 'PlusSheet 실시간 칩·저장 맞춤이 없어요');
const msg = readFileSync('src/ui/MsgSheet.jsx', 'utf8');
check(msg.includes('LiveEventChips') && msg.includes('applyLiveChips'), 'MsgSheet 실시간 칩·파서 합침이 없어요');
const bar = readFileSync('src/ui/QuickBar.jsx', 'utf8');
check(bar.includes('LiveEventChips') && bar.includes('chip.time'), 'QuickBar 실시간 칩이 없어요');
const tasks = readFileSync('src/ui/Tasks.jsx', 'utf8');
check(tasks.includes('LiveEventChips') && tasks.includes('todoChipRead'), '할 일 상단 실시간 칩이 없어요');
const liveUi = readFileSync('src/ui/LiveEventChips.jsx', 'utf8');
check(liveUi.includes('오전↔오후') && liveUi.includes('data-live-chips'), 'LiveEventChips 오전오후 고침이 없어요');

/* 변이: 칩 시각과 저장값이 어긋나면 안 됩니다(오전↔오후). */
const draft = [{ id: 'x', kind: '일정', title: '학년 회의', date: '2026-11-07', time: '15:00' }];
const synced = applyLiveChips(draft, flipped);
check(synced[0].time === '03:00', `칩≠저장값 변이: ${synced[0].time}`);
check(bar.includes('body.time = chip.time') || bar.includes('chip.time'), 'QuickBar가 칩 시각을 저장에 안 넣어요');

const sw = readFileSync('public/sw.js', 'utf8');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v71'"), 'SW가 v71이 아닙니다');

if (bad) {
    console.error(`나이스·날짜칩 검사 실패 ${bad}건`);
    process.exit(1);
}
console.log('나이스·날짜칩 검사 통과');
