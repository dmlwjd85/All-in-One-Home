/* 팀즈·달력 표·급식 표 붙여넣기. 화면 없이 읽기만 확인합니다. */
import { readFileSync } from 'node:fs';
import { parseCalGrid } from '../src/lib/calGrid.js';
import { readPasteSchedule } from '../src/lib/teamsPaste.js';
import { decodeMeals, encodeMeals, isMealNote, mealsFromNotes, parseMealTable } from '../src/lib/mealPaste.js';
import { assignWords, cellsToTable, clusterTable, detectGridLines } from '../src/lib/gridDetect.js';
import { saveCalendarEvents, saveMealMonth, snapshot, useVaultsForTest } from '../src/lib/db.js';
import { isSensitiveText } from '../src/lib/sensitive.js';

let bad = 0;
const check = (ok, msg) => { if (!ok) { bad += 1; console.error(`✗ ${msg}`); } };
const now = new Date('2026-11-15T10:00:00+09:00');

const EXPECTED = [
    { date: '2026-11-03', end: '', time: '13:00', endTime: '', title: '동요대회', place: '당진초', person: '', period: 0, periodEnd: 0, allDay: false },
    { date: '2026-11-04', end: '', time: '09:00', endTime: '12:00', title: '연극', place: '', person: '', period: 1, periodEnd: 4, allDay: false },
    { date: '2026-11-05', end: '', time: '09:00', endTime: '12:00', title: '연극', place: '', person: '', period: 1, periodEnd: 4, allDay: false },
    { date: '2026-11-05', end: '', time: '10:00', endTime: '', title: '구강이동진료버스', place: '보건소', person: '', period: 0, periodEnd: 0, allDay: false },
    { date: '2026-11-06', end: '', time: '08:40', endTime: '11:40', title: '당진행복교육한마당', place: '신성대', person: '학교장', period: 0, periodEnd: 0, allDay: false },
    { date: '2026-11-06', end: '', time: '09:00', endTime: '10:20', title: '1학년 집단상담', place: '', person: '', period: 1, periodEnd: 2, allDay: false },
    { date: '2026-11-10', end: '', time: '14:00', endTime: '17:00', title: '학교생활기록부 연수', place: '당진교육지원청', person: '이동기', period: 0, periodEnd: 0, allDay: false },
    { date: '2026-11-11', end: '', time: '14:00', endTime: '', title: '2026 장애공감문화 확산을 위한 교(원)장 장애인식개선 연수 참석', place: '과학교육원', person: '학교장', period: 0, periodEnd: 0, allDay: false },
    { date: '2026-11-11', end: '', time: '', endTime: '', title: '연극', place: '', person: '', period: 0, periodEnd: 0, allDay: true },
    { date: '2026-11-11', end: '', time: '10:00', endTime: '12:00', title: '꿈자랑 끼자랑 학습발표회', place: '체육관', person: '', period: 0, periodEnd: 0, allDay: false },
    { date: '2026-11-11', end: '', time: '13:00', endTime: '16:40', title: '발전소 장학금 전달식', place: '', person: '이동기', period: 0, periodEnd: 0, allDay: false },
    { date: '2026-11-12', end: '2026-11-13', time: '', endTime: '', title: '11월 교육공무직원 교육훈련', place: '충청남도교육청교육연수원', person: '정지은', period: 0, periodEnd: 0, allDay: true },
    { date: '2026-11-13', end: '', time: '09:00', endTime: '10:20', title: '1학년 집단상담', place: '', person: '', period: 1, periodEnd: 2, allDay: false },
    { date: '2026-11-13', end: '', time: '10:30', endTime: '11:10', title: '장애발생이해교육', place: '체육관', person: '', period: 3, periodEnd: 0, allDay: false },
    { date: '2026-11-17', end: '', time: '16:00', endTime: '', title: '학교생활기록부 교내연수', place: '3학년 교실', person: '', period: 0, periodEnd: 0, allDay: false },
    { date: '2026-11-18', end: '', time: '14:30', endTime: '16:30', title: '전학공연수', place: '영어실', person: '', period: 0, periodEnd: 0, allDay: false },
    { date: '2026-11-19', end: '', time: '10:30', endTime: '11:30', title: '입체낭독극 운영', place: '장군이네 떡집', person: '', period: 2, periodEnd: 3, allDay: false },
    { date: '2026-11-20', end: '', time: '09:40', endTime: '10:20', title: '교육활동침해예방공연', place: '체육관', person: '', period: 2, periodEnd: 0, allDay: false },
    { date: '2026-11-25', end: '', time: '14:00', endTime: '', title: '직장내 성희롱성폭력예방교육', place: '상담실', person: '', period: 0, periodEnd: 0, allDay: false },
    { date: '2026-11-25', end: '', time: '', endTime: '', title: '학교먹는물 채수일', place: '본/분교', person: '', period: 0, periodEnd: 0, allDay: true },
];

const sample = readFileSync(new URL('./fixtures/sample-calendar.tsv', import.meta.url), 'utf8');
const grid = parseCalGrid(sample, { today: '2026-11-15' });
check(grid.year === 2026 && grid.month === 11, `연월 ${grid.year}-${grid.month}`);
check(grid.events.length === EXPECTED.length, `일정 수 ${grid.events.length}`);
EXPECTED.forEach((want, index) => {
    const got = grid.events[index] || {};
    const same = want.date === got.date && want.end === (got.end || '') && want.time === (got.time || '') && want.endTime === (got.endTime || '') && want.title === got.title && want.place === (got.place || '') && want.person === (got.person || '') && want.period === (got.period || 0) && want.periodEnd === (got.periodEnd || 0) && want.allDay === got.allDay;
    check(same, `${index + 1} ${want.date} ${want.title} → ${got.date} ${got.time}-${got.endTime} ${got.title}`);
});
const play = grid.events.find((row) => row.date === '2026-11-11' && row.title === '연극');
check(play?.memo?.includes('㉑') && play.memo.includes('리허설'), `원문자 메모 ${play?.memo}`);
check(!grid.events.some((row) => row.date.endsWith('-21') && row.title.includes('㉑')), '원문자를 날짜로 봤어요');
const song = grid.events.find((row) => row.title === '동요대회');
check(song?.time === '13:00' && song.memo.includes('11:45'), `동요 시각 ${song?.time} ${song?.memo}`);

const line = (text) => readPasteSchedule(text, { now }).items[0];
const cases = [
    ['2026년 11월 18일 수요일 오후 3:00 - 오후 4:00 학년 협의회', { date: '2026-11-18', time: '15:00', endTime: '16:00', title: '학년 협의회', ask: false }],
    ['11월 18일 (수) 오후 3:00~4:00 학년회의', { date: '2026-11-18', time: '15:00', endTime: '16:00', title: '학년회의' }],
    ['2026-11-18 15:00 상담', { date: '2026-11-18', time: '15:00', title: '상담' }],
    ['2026. 11. 18.(수) 15:00~16:00 교과협의회', { date: '2026-11-18', time: '15:00', endTime: '16:00', title: '교과협의회' }],
    ['내일 오전 9시 30분 조회', { date: '2026-11-16', time: '09:30', title: '조회' }],
    ['다음 주 화요일 2교시 후 학년회의', { date: '2026-11-17', time: '10:20', title: '학년회의' }],
    ['11/18(수) 14:30 학부모 상담', { date: '2026-11-18', time: '14:30', title: '학부모 상담' }],
    ['11월 18일~20일 현장학습', { date: '2026-11-18', end: '2026-11-20', title: '현장학습', allDay: true }],
    ['11월 18일 종일 연수', { date: '2026-11-18', title: '연수', allDay: true, time: '' }],
    ['PM 3:00 회의', { time: '15:00', title: '회의' }],
    ['AM 9:30 조회', { time: '09:30', title: '조회' }],
    ['3:00 PM 조회', { time: '15:00', title: '조회' }],
];
for (const [text, want] of cases) {
    const got = line(text) || {};
    const ok = Object.entries(want).every(([key, value]) => (got[key] || '') === value || got[key] === value);
    check(ok, `${text} → ${got.date} ${got.time}-${got.endTime} ${got.title} ask=${got.ask}`);
}
const mismatch = line('2026년 11월 18일 목요일 오후 3:00 학년회의');
check(mismatch?.ask && mismatch.date === '2026-11-18' && mismatch.time === '15:00' && /수요일/.test(mismatch.warning), `요일 확인 ${mismatch?.warning}`);
for (const text of ['3학년 2반 현장학습 안내', '27명 중 22명 참석', '30분 동안 회의']) {
    check(readPasteSchedule(text, { now }).items.length === 0, `오인식 ${text}`);
}
const invite = `학년 협의회
2026년 11월 18일 수요일 오후 3:00 - 오후 4:00
장소: 3층 협의실
Microsoft Teams 모임
지금 참가: https://teams.microsoft.com/l/meetup-join/19%3ameeting_xxx
모임 ID: 123 456 789 012
암호: abcXYZ
주최자: 김민수`;
const invited = readPasteSchedule(invite, { now });
check(invited.items.length === 1 && invited.items[0].title === '학년 협의회' && invited.items[0].time === '15:00' && invited.items[0].endTime === '16:00' && invited.items[0].place === '3층 협의실', `초대 ${JSON.stringify(invited.items[0])}`);
check(!JSON.stringify(invited).includes('abcXYZ') && !JSON.stringify(invited).includes('123 456'), '암호·모임 번호가 남았어요');
const list = `다음 주 일정
- 11월 18일 (수) 오후 3:00~4:00 학년회의 장소: 3층 협의실
- 11월 19일 (목) 연수
- 11/20(금) 14:30 상담`;
const many = readPasteSchedule(list, { now });
check(many.items.length === 3 && many.items[0].title === '학년회의' && many.items[1].title === '연수' && many.items[1].allDay && many.items[2].title === '상담' && many.items[2].time === '14:30', `목록 ${many.items.map((item) => item.title).join(',')}`);

const mealText = `16\t17\t18\t19\t20\t21\t22
"현미밥
김치찌개 1.2.5.6
돈가스 1.2.5.6.10
배추김치 9
640kcal"\t"보리밥
된장국 5.6
제육볶음 5.6.10
깍두기 9"\t\t\t\t\t`;
const meal = parseMealTable(mealText, { today: '2026-11-15' });
check(meal.year === 2026 && meal.month === 11, `급식 연월 ${meal.year}-${meal.month}`);
check(meal.days.length === 2 && meal.days[0].date === '2026-11-16' && meal.days[0].items.some((item) => item.name === '김치찌개' && item.codes === '1.2.5.6'), `16일 메뉴 ${JSON.stringify(meal.days[0])}`);
check(meal.days[0].kcal === '640', `열량 ${meal.days[0]?.kcal}`);
check(meal.days[0].items.some((item) => item.name === '배추김치' && item.codes === '9'), '숫자만 있는 번호');
const stored = encodeMeals([{ date: '2026-11-16', items: [{ name: '알레르기 우유', codes: '2.5' }, { name: '현미밥', codes: '' }] }]);
check(!stored.includes('알레르기') && !isSensitiveText(stored) && stored.includes('우유|2.5'), `저장 글 ${stored}`);
const back = decodeMeals(encodeMeals(meal.days));
check(back.length === 2 && back[0].items[1].name === '김치찌개', '급식 왕복');

const width = 40;
const height = 30;
const pixels = new Uint8ClampedArray(width * height * 4);
pixels.fill(255);
function paint(x, y) { const i = (y * width + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = 0; }
for (const y of [2, 16, 28]) for (let x = 2; x < 38; x += 1) paint(x, y);
for (const x of [2, 20, 38]) for (let y = 2; y < 28; y += 1) paint(x, y);
const lines = detectGridLines(pixels, width, height, { ratio: 0.5 });
check(lines.xs.length >= 3 && lines.ys.length >= 3, `선 ${lines.xs} ${lines.ys}`);
const cells = assignWords([{ text: '동요', x: 4, y: 6, x1: 10, y1: 10, conf: 80 }, { text: '잘림', x: 3, y: 18, x1: 8, y1: 22, conf: 20 }], lines.xs, lines.ys);
const table = cellsToTable(cells);
check(table.includes('동요'), `칸 글 ${table}`);
check(cells.some((row) => row.some((cell) => cell.clipped && cell.text.includes('잘림'))), '잘린 칸 표시');
const clustered = clusterTable([
    { text: '16', x: 10, y: 10, x1: 30, y1: 24 },
    { text: '17', x: 80, y: 10, x1: 100, y1: 24 },
    { text: '현미밥', x: 10, y: 40, x1: 50, y1: 54 },
    { text: '보리밥', x: 80, y: 40, x1: 120, y1: 54 },
]);
check(clustered.split('\n')[0].includes('16') && clustered.split('\n')[1].startsWith('현미밥'), `낱말 칸 ${clustered}`);

function makeVault() {
    const bag = new Map();
    return {
        async get(key) { return bag.has(key) ? structuredClone(bag.get(key)) : undefined; },
        async set(key, value) { bag.set(key, structuredClone(value)); },
        async remove(key) { bag.delete(key); },
    };
}
useVaultsForTest(makeVault(), makeVault());
const first = await saveCalendarEvents(grid.events.slice(0, 2).map((item) => ({ ...item, eventKind: '학교' })), now);
const again = await saveCalendarEvents(grid.events.slice(0, 2).map((item) => ({ ...item, eventKind: '학교' })), now);
const events = [...(snapshot().events || []), ...(snapshot().local?.events || [])];
check(first.ok && first.count === 2 && again.skipped === 2 && events.length === 2, `중복 ${first.count}/${again.skipped}/${events.length}`);
const secret = await saveCalendarEvents([{ title: '직장내 성희롱성폭력예방교육', date: '2026-11-25', include: true, eventKind: '학교' }], now);
const localHit = (snapshot().local?.events || []).some((row) => row.title.includes('예방교육'));
const cloudHit = (snapshot().events || []).some((row) => row.title.includes('예방교육'));
check(secret.ok && localHit && !cloudHit, `민감 일정은 이 기기만 ${secret.local} cloud=${cloudHit}`);
const mealSave = await saveMealMonth(2026, 11, meal.days);
const note = [...(snapshot().notes || []), ...(snapshot().local?.notes || [])].find(isMealNote);
check(mealSave.ok && note && mealsFromNotes([note])['2026-11-16']?.items?.length === 4, `급식 저장 ${note?.id}`);

/* 주간 급식표를 주마다 올려도 앞 주가 남고, 달이 넘어가는 주는 두 달로 나뉩니다. */
const weekA = [{ date: '2026-11-23', items: [{ name: '차조밥', codes: '' }] }, { date: '2026-11-24', items: [{ name: '옥수수밥', codes: '' }] }];
const weekB = [{ date: '2026-11-30', items: [{ name: '녹두밥', codes: '' }] }, { date: '2026-12-01', items: [{ name: '현미밥', codes: '' }] }];
const savedA = await saveMealMonth(2026, 11, weekA);
const savedB = await saveMealMonth(2026, 11, weekB);
const mealNotes = [...(snapshot().notes || []), ...(snapshot().local?.notes || [])].filter(isMealNote);
const mealMap = mealsFromNotes(mealNotes);
check(savedA.ok && savedB.ok, `주간 저장 ${savedA.message} / ${savedB.message}`);
check(mealMap['2026-11-16']?.items?.length === 4 && mealMap['2026-11-23'] && mealMap['2026-11-30'], `앞서 넣은 날이 지워짐 ${Object.keys(mealMap).join(',')}`);
check(mealMap['2026-12-01']?.items?.[0]?.name === '현미밥' && mealNotes.some((row) => row.id === 'meal-202612'), `12월로 넘어간 날 ${mealNotes.map((row) => row.id).join(',')}`);
const mealAgain = await saveMealMonth(2026, 11, [{ date: '2026-11-23', items: [{ name: '보리밥', codes: '' }] }]);
const mapAgain = mealsFromNotes([...(snapshot().notes || []), ...(snapshot().local?.notes || [])].filter(isMealNote));
check(mealAgain.ok && mapAgain['2026-11-23']?.items?.[0]?.name === '보리밥' && mapAgain['2026-11-24'], '같은 날을 다시 넣으면 그날만 바뀌어야 합니다');

if (bad) {
    console.error(`붙여넣기 검사 실패 ${bad}`);
    process.exit(1);
}
console.log('붙여넣기 검사를 통과했습니다.');
