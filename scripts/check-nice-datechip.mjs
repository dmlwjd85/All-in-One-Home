/* 나이스·설정 두 칸(시안 A)과 실시간 날짜·시각 칩(기간 비변환·오전오후 고침) 검사. */
import { readFileSync } from 'node:fs';
import { applyLiveChips, readEventChips } from '../src/lib/dateChips.js';
import { findDates } from '../src/lib/parse.js';
import { readJjaemPaste } from '../src/lib/jjaemPaste.js';

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

/* 칩 = 저장값: 칩은 저장(readJjaemPaste, #79 파서)과 같은 날짜·시각을 보여야 합니다. */
const same = [
    '밤 9시 학부모 상담', '저녁 12시 마감', '15:30 학년 회의', '오전 10:30 공개수업', '요한 3:16 묵상', '시편 23:1 낭송',
    '점수 3:15 입력', '점수 15:00까지 입력', '2시~3시 협의회', '10:30~11:20 연수', '세 시 상담', '오후 세시 회의',
    '금요일 회의', '3월 2일 개학식', '3일 동안 체험학습', '정오 점심 모임', '내일 8시 교직원 회의', '모레 03:00 서버 점검',
    '11월 15일 협의회', '3시 방향 정리', '시험 3시간', '세시 풍속 수업',
];
for (const text of same) {
    for (const future of [true, false]) {
        const chip = readEventChips(text, { now, future });
        const paste = readJjaemPaste(text, { now, future, stripTime: true });
        if (!chip.period) check(chip.time === paste.time, `칩 시각≠저장 시각 「${text}」 future=${future}: 칩 ${chip.time} / 저장 ${paste.time}`);
        /* 기록·메모(future=false)의 요일만 적은 말은 칩으로 띄우지 않고 저장 규칙에 맡깁니다(지난 요일). */
        if (future || !/^[월화수목금토일]요일/.test(text)) check(chip.date === paste.date, `칩 날짜≠저장 날짜 「${text}」 future=${future}: 칩 ${chip.date} / 저장 ${paste.date}`);
    }
}
/* 오전↔오후 뒤집기도 저장과 같게. */
for (const [text, id] of [['내일 3시 학년 회의', 't3'], ['8:30 상담', 't0']]) {
    const chip = readEventChips(text, { now, ampmFlip: [id], future: true });
    const paste = readJjaemPaste(text, { now, ampmFlip: [id], future: true });
    check(chip.time === paste.time, `뒤집은 칩 시각≠저장 「${text}」: ${chip.time} / ${paste.time}`);
}
/* 앞말이 적힌 시각은 오전↔오후 단추가 없습니다. */
check(!readEventChips('밤 9시 상담', { now }).chips.some((c) => c.ambiguous), '「밤 9시」에 오전↔오후 단추가 붙어요');
check(!readEventChips('15:30 회의', { now }).chips.some((c) => c.ambiguous), '「15:30」에 오전↔오후 단추가 붙어요');
check(readEventChips('8:30 상담', { now }).chips.some((c) => c.ambiguous), '「8:30」은 오전↔오후를 고칠 수 있어야 해요');
/* 시각 칩을 빼면 저장도 시각 없이(timeOff). */
const offT = readEventChips('내일 3시 학년 회의', { now, off: ['t3'] });
check(offT.timeOff && !offT.time, `시각 칩을 뺐는데 timeOff가 없어요: ${JSON.stringify({ t: offT.time, o: offT.timeOff })}`);
check(!readEventChips('내일 학년 회의', { now }).timeOff, '시각이 없는 글에 timeOff가 켜졌어요');
check(bar.includes('chip.timeOff') && !bar.includes('chip.changed && !chip.time'), 'QuickBar가 시각 없는 칩을 「시각 없이」로 저장해요(#79 시계 시각이 사라짐)');
/* 메시지 여러 건은 첫 칩으로 덮지 않습니다. */
check(msg.includes('parsed.items.length === 1 && touched ? applyLiveChips') && msg.includes('chipOff.length > 0 || ampmFlip.length > 0'), 'MsgSheet가 메시지 파서 값을 칩으로 덮어써요(여러 건·고치지 않은 칩)');

const sw = readFileSync('public/sw.js', 'utf8');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v78'"), 'SW가 v78이 아닙니다');

if (bad) {
    console.error(`나이스·날짜칩 검사 실패 ${bad}건`);
    process.exit(1);
}
console.log('나이스·날짜칩 검사 통과');
