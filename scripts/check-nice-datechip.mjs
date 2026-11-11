/* 나이스·설정 두 칸(시안 A)과 실시간 날짜·시각 칩(기간 비변환·오전오후 고침) 검사. */
import { readFileSync } from 'node:fs';
import { applyLiveChips, readEventChips } from '../src/lib/dateChips.js';
import { findDates } from '../src/lib/parse.js';
import { readJjaemPaste } from '../src/lib/jjaemPaste.js';
import { parseSchoolMessages } from '../src/lib/msgParse.js';
import { captureDrafts } from '../src/ui/capture.js';

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

/* 화면 연결(+ 화면 제목, 메시지 한 건·여러 건, 빠른 입력·할 일 칩 시각 저장, 나이스 목록 선택, 설정 버튼 너비)은
   check:nice-datechip-browser가 실제 화면과 저장값으로 봅니다. 여기서는 칩→저장 맞춤 함수(applyLiveChips)의 동작을 봅니다. */

/* 변이: 칩 시각과 저장값이 어긋나면 안 됩니다(오전↔오후). 고침 목록이 없으면 손대지 않습니다. */
const draft = [{ id: 'x', kind: '일정', title: '학년 회의', date: '2026-11-07', time: '15:00' }];
const synced = applyLiveChips(draft, flipped, { ampmFlip: ['t3'] });
check(synced[0].time === '03:00' && synced[0].title === '학년 회의', `칩≠저장값 변이: ${synced[0].time} ${synced[0].title}`);
check(applyLiveChips(draft, flipped) === draft, '칩을 안 건드렸는데(고침 목록 없음) 저장 목록을 바꿔요');

/* 칩을 안 건드리면 파서 값(제목·날짜·기간·시각) 그대로. 고쳐도 제목·기간은 파서 값. */
const n11 = new Date('2026-11-11T09:00:00+09:00');
const flow = (text, read, off = [], flip = []) => {
    const items = read(text);
    const chip = readEventChips(text, { now: n11, off, ampmFlip: flip });
    return items.length === 1 ? applyLiveChips(items, chip, { off, ampmFlip: flip }) : items;
};
const plusRead = (text) => captureDrafts(text, { now: n11 });
const msgRead = (text) => parseSchoolMessages(text, { now: n11 }).items;
const NOTICE = '[알림] 내일 3시 학년 회의가 있습니다. 참석 바랍니다.';
const TRIP = '11월 18일~11월 20일 수학여행';
for (const [name, read] of [['+ 화면', plusRead], ['메시지', msgRead]]) {
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    check(same(flow(NOTICE, read), read(NOTICE)), `${name}: 칩을 안 건드렸는데 파서 값이 바뀌어요`);
    check(same(flow(TRIP, read), read(TRIP)), `${name}: 칩을 안 건드렸는데 기간이 바뀌어요`);
    const t = readEventChips(NOTICE, { now: n11 }).chips.find((c) => c.ambiguous);
    const f = flow(NOTICE, read, [], [t.id])[0];
    check(f.title === '학년 회의' && f.time === '03:00' && f.date === '2026-11-12', `${name}: 오전↔오후 뒤 제목·시각 ${f.title} ${f.date} ${f.time}`);
    const o = flow(NOTICE, read, [t.id])[0];
    check(o.title === '학년 회의' && !o.time, `${name}: 시각 칩을 빼도 시각이 남거나 제목이 바뀌어요: ${o.title} ${o.time}`);
    const d = readEventChips(TRIP, { now: n11 }).chips.find((c) => c.type === 'date');
    const r = flow(TRIP, read, [d.id])[0];
    check(r.title === '수학여행' && r.date === '2026-11-18' && r.end === '2026-11-20', `${name}: 시작 날짜 칩을 빼면 기간이 망가져요: ${r.title} ${r.date}~${r.end}`);
}
/* 오전↔오후를 직접 정하면 '오후로 봤어요' 안내를 지웁니다. */
{
    const t = readEventChips(NOTICE, { now: n11 }).chips.find((c) => c.ambiguous);
    const f = flow(NOTICE, msgRead, [], [t.id])[0];
    check(!String(f.warning || '').includes('오후로 봤어요'), `메시지: 오전↔오후를 고쳤는데 '오후로 봤어요'가 남아요: ${f.warning}`);
}

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

const sw = readFileSync('public/sw.js', 'utf8');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v78'"), 'SW가 v78이 아닙니다');

if (bad) {
    console.error(`나이스·날짜칩 검사 실패 ${bad}건`);
    process.exit(1);
}
console.log('나이스·날짜칩 검사 통과');
