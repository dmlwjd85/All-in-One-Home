/** 학교 메시지 예문을 읽고 유형·날짜·시각·제목 정확도를 확인합니다. */
import { gradeMessages, parseSchoolMessages } from '../src/lib/msgParse.js';
import { MSG_NOW, MSG_SAMPLES } from '../src/lib/msgSamples.js';
import { MSG_HOLDOUT } from '../src/lib/msgHoldout.js';
import { MSG_BLIND } from '../src/lib/msgBlind.js';
import { MSG_FRESH } from '../src/lib/msgFresh.js';
import { toCloudRow } from '../src/lib/cloudShape.js';
import { clearAll, saveParsed, snapshot } from '../src/lib/db.js';
import { planMigration, readLegacyStorage } from '../src/lib/migrate.js';

const grade = gradeMessages(MSG_SAMPLES, MSG_NOW);
const lines = [
    `예문 ${MSG_SAMPLES.length}개, 항목 ${grade.total}개`,
    `유형 ${grade.kind}%`,
    `날짜 ${grade.date}%`,
    `시각 ${grade.time}%`,
    `제목 ${grade.title}%`,
];
console.log(lines.join('\n'));
if (MSG_SAMPLES.length < 50) {
    console.error('예문이 50개보다 적습니다.');
    process.exit(1);
}
if (grade.misses.length || grade.kind < 100 || grade.date < 100 || grade.time < 100 || grade.title < 100) {
    console.error(JSON.stringify(grade.misses.slice(0, 12), null, 2));
    process.exit(1);
}

const again = parseSchoolMessages(MSG_SAMPLES[20].text, { now: MSG_NOW });
const once = parseSchoolMessages(MSG_SAMPLES[20].text, { now: MSG_NOW });
if (once.items.map((item) => item.id).join() !== again.items.map((item) => item.id).join()) {
    console.error('같은 메시지를 두 번 읽으면 아이디가 달라집니다.');
    process.exit(1);
}

const shaped = toCloudRow('todos', { id: 'msgabcd1234', title: '동의서 제출', done: false, due: '2026-10-28', source: 'msg' });
if (shaped?.body?.source !== 'app') {
    console.error('메시지 출처가 클라우드 규칙 밖으로 나갑니다.');
    process.exit(1);
}

await clearAll();
const sample = parseSchoolMessages('내일까지 준비물 제출\n내일 3교시 공개수업\n건강 조사 내일까지 입력', { now: MSG_NOW });
const first = await saveParsed(sample.items, MSG_NOW);
if (!first.ok || first.count < 2) {
    console.error(`등록이 비었습니다: ${first.message}`);
    process.exit(1);
}
const state = snapshot();
const todo = [...state.todos, ...state.local.todos].find((row) => row.title.includes('준비물'));
const event = [...state.events, ...state.local.events].find((row) => row.title.includes('공개수업'));
const secret = [...state.local.todos, ...state.local.events].find((row) => String(row.title).includes('건강'));
if (!todo || todo.source !== 'msg' || todo.due !== '2026-10-22') {
    console.error('할 일이 기존 칸에 msg로 들어가지 않았습니다.');
    process.exit(1);
}
if (!event || event.source !== 'msg' || event.time !== '10:30') {
    console.error('일정이 기존 칸에 들어가지 않았습니다.');
    process.exit(1);
}
if (!secret || secret.source !== 'msg') {
    console.error('민감 메시지가 이 기기 칸으로 가지 않았습니다.');
    process.exit(1);
}
if (state.todos.some((row) => String(row.title).includes('건강')) || state.events.some((row) => String(row.title).includes('건강'))) {
    console.error('민감 메시지가 클라우드로 갈 칸에 있습니다.');
    process.exit(1);
}
const second = await saveParsed(sample.items, MSG_NOW);
if (second.ok) {
    console.error('같은 메시지를 다시 등록했습니다.');
    process.exit(1);
}
console.log('저장 경로와 중복 방지도 확인했습니다.');

const qaNow = new Date('2026-10-22T09:00:00+09:00');
function must(label, text, now, ok) {
    const items = parseSchoolMessages(text, { now }).items;
    if (!ok(items)) {
        console.error(label, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low, eventKind: item.eventKind,
        })), null, 2));
        process.exit(1);
    }
}
must('번호 목록', '[안내] 1. 10월 30일(금) 3~4교시 학급 사진 촬영이 있습니다. 장소: 강당', qaNow, (items) => items.length === 1 && items[0].date === '2026-10-30' && items[0].title === '학급 사진 촬영' && items[0].low === false && items[0].time === '10:30');
must('기한 제출', '11월 12일까지 공개수업 지도안 제출', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].title.includes('공개수업') && items[0].date === '2026-11-12');
must('상담주간', '가정통신문\n학부모 상담주간: 11월 2일(월)~11월 6일(금)', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-02' && items[0].end === '2026-11-06' && items[0].title === '학부모 상담주간');
must('쉼표 교시', '김교사 출장으로 5,6교시 보결 부탁드립니다', qaNow, (items) => items.length === 1 && items[0].time === '13:10' && items[0].period === 5 && items[0].periodEnd === 6 && !items[0].title.includes(' 5'));
must('잡담', '선생님들 항상 수고 많으십니다. 날씨가 추우니 건강 조심하세요.', qaNow, (items) => items.length === 1 && items[0].include === false);
must('방과후 명사', '11월 3일까지 방과후 신청서 회수 후 제출', qaNow, (items) => items.length === 1 && items[0].time === '' && items[0].title.includes('방과후'));
must('교무회의', '내일 오후 2시 교무회의', qaNow, (items) => items.length === 1 && items[0].eventKind === '학교' && items[0].date === '2026-10-23' && items[0].time === '14:00');
must('점심 잡담', '점심 맛있게 드세요', qaNow, (items) => items.length === 1 && items[0].include === false && items[0].time === '12:10' && items[0].date === '');
must('점심 커피', '점심시간에 커피 한잔 하실래요', qaNow, (items) => items.length === 1 && items[0].include === false && items[0].title === '커피 한잔' && !items[0].title.startsWith('에'));
must('시각만', '방과후에 잠깐 쉬어요', qaNow, (items) => items.length === 1 && items[0].include === false && items[0].time === '16:00');
must('수학여행 장소', '수학여행\n11/4~11/6\n장소: 경주 일대', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-04' && items[0].end === '2026-11-06' && items[0].title === '수학여행' && items[0].memo.includes('경주 일대') && !items.some((item) => item.date === '2026-11-03'));
must('박 수', '수학여행 11/4~11/6\n2박 3일\n장소: 경주 일대', qaNow, (items) => items.length === 1 && items[0].date === '2026-11-04' && items[0].end === '2026-11-06' && items[0].memo.includes('경주 일대') && items[0].memo.includes('2박 3일') && !items.some((item) => item.date === '2026-11-03' || item.title.includes('2박')));
must('단원평가', '② 10/28 영어 단원평가', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-28' && items[0].title === '영어 단원평가');
must('시험', '10/28 국어 시험', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].title === '국어 시험');
must('수행 입력', '수행평가 내일까지 입력', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-23' && items[0].title.includes('수행평가'));
must('일시 제목', '일시: 11/4(수)~11/6(금) 수학여행', qaNow, (items) => items.length === 1 && items[0].title === '수학여행' && items[0].date === '2026-11-04' && items[0].end === '2026-11-06');
must('일정 제목', '일정: 11/4 수학여행', qaNow, (items) => items.length === 1 && items[0].title === '수학여행' && items[0].date === '2026-11-04');
must('조사 제목', '다음 주 금요일에 학부모 상담', qaNow, (items) => items.length === 1 && items[0].title === '학부모 상담' && items[0].date === '2026-10-30' && !items[0].title.startsWith('에'));
must('인사 제목', '수고 많으십니다. 커피는 교무실에 있어요', qaNow, (items) => items.length === 1 && items[0].include === false && !items[0].title.includes('많으') && !items[0].title.startsWith('수고'));
must('수학 글자', '11/6 수학여행', qaNow, (items) => items.length === 1 && items[0].title === '수학여행' && items[0].date === '2026-11-06');
must('급식 잡담', '오늘 급식 진짜 맛있네요 ㅎㅎ 다들 점심 맛있게 드세요~', qaNow, (items) => items.length === 1 && items[0].include === false && items[0].time === '12:10');
must('우산 잡담', '오늘 비 온대요 우산 챙기세요 ㅠㅠ', qaNow, (items) => items.length === 1 && items[0].include === false && items[0].date === '2026-10-22');
must('방과후 로봇', '방과후 로봇과학 강사님 11/4(수)부터 교체됩니다', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].time === '' && items[0].title.includes('방과후') && items[0].title.includes('로봇과학') && items[0].date === '2026-11-04');
must('지필 회귀', '[교무부] 2학기 2차 지필평가 11.24(화)~11.26(목) 실시합니다. 문항정보표는 11.13(금)까지 제출 바랍니다.', qaNow, (items) => items.length === 2 && items[0].kind === '일정' && items[0].date === '2026-11-24' && items[0].end === '2026-11-26' && items[0].title.includes('지필평가') && items[1].kind === '할 일' && items[1].date === '2026-11-13' && items[1].title.includes('문항정보표'));
must('생신 잡담', '오늘 3반 선생님 생신이래요 🎂 축하 메시지 한 마디씩!', qaNow, (items) => items.length === 1 && items[0].include === false && items[0].date === '2026-10-22');
must('휴강', '방과후 바이올린반 10/26(월) 휴강입니다.', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-26' && items[0].time === '' && items[0].title.includes('바이올린') && items[0].title.includes('방과후'));
must('안전점검', '[안내] (필독) 11/9(월) 학교 안전점검의 날 운영', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-09' && !items[0].title.includes('안내') && !items[0].title.includes('필독') && items[0].title.includes('안전점검'));
must('전화 상담', '서연이 아버님께 오늘 중으로 전화 상담 부탁드려요', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-22' && items[0].title === '서연이 아버님 전화 상담');
must('선거 한 장', '이번주 목요일 5교시 학급 임원 선거 진행해 주세요.', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-22' && items[0].time === '13:10' && items[0].include !== false);
must('보건 분리', '모레 1~2교시 보건교육 있으니 학생들 교실 대기 부탁드려요', qaNow, (items) => items.filter((item) => item.include !== false).length === 1 && items[0].kind === '일정' && items[0].title === '보건교육' && items[0].date === '2026-10-24' && items[1]?.include === false && items[1]?.low === true);
must('계획서 제출', '2027년 1월 8일(금) 겨울방학 중 돌봄교실 운영 계획서 제출', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2027-01-08' && items[0].title.includes('계획서'));
must('이번주 안', '이번주 안으로 가정통신문 회신 바랍니다', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-23');
must('재량휴업', '11월 16일(월)은 재량휴업일입니다.', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].eventKind === '휴일' && items[0].date === '2026-11-16');
must('체육대회', '1. 10/27 학년 체육대회', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-27' && items[0].title.includes('체육대회'));
must('노선 변경', '통학차량 노선 변경 공지', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].title.includes('노선'));
must('급식 시각', '내일 급식이 11시로 당겨집니다', qaNow, (items) => items.length === 1 && items[0].title === '급식' && !items[0].title.includes('으로') && items[0].time === '11:00');
must('상담 제목', '2차 상담 신청은 11/4부터 받습니다', qaNow, (items) => items.length === 1 && items[0].title === '2차 상담 신청');
must('날짜 없는 추가', '준비물은 11/20(금)까지 제출해 주세요. 빠진 물건은 알려 주세요.', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-11-20');
must('방과후 시간', '내일 방과후 시간에 학부모 상담', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].time === '16:00' && items[0].title === '학부모 상담' && items[0].date === '2026-10-23');
must('방과후에', '방과후에 학급 회의', qaNow, (items) => items.length === 1 && items[0].time === '16:00' && items[0].title === '학급 회의');
must('검진 제목', '검진일: 11/12 교직원 건강검진', qaNow, (items) => items.length === 1 && items[0].title === '교직원 건강검진' && items[0].date === '2026-11-12');
must('동의서 제목', '현장학습 동의서\n11/3까지 제출', qaNow, (items) => items.length === 1 && items[0].title === '현장학습 동의서 제출');
must('요일 제목', '수 학교운영위원회는 11/4입니다', qaNow, (items) => items.length === 1 && items[0].title === '학교운영위원회' && !items[0].title.startsWith('수'));
must('상담 일정', '10/27 학부모 상담 2명', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-27' && items[0].title.includes('상담'));

await clearAll();
const ranged = parseSchoolMessages('가정통신문\n학부모 상담주간: 11월 2일(월)~11월 6일(금)', { now: MSG_NOW });
const savedRange = await saveParsed(ranged.items, MSG_NOW);
const rangedRow = snapshot().events.find((row) => row.title === '학부모 상담주간');
if (!savedRange.ok || !rangedRow || rangedRow.date !== '2026-11-02' || rangedRow.end !== '2026-11-06' || rangedRow.source !== 'msg') {
    console.error('기간 일정이 기존 일정 칸에 들어가지 않았습니다.');
    process.exit(1);
}
const chatter = parseSchoolMessages('선생님들 항상 수고 많으십니다. 날씨가 추우니 건강 조심하세요.', { now: MSG_NOW });
const chatterSave = await saveParsed(chatter.items, MSG_NOW);
if (chatterSave.ok || snapshot().todos.some((row) => String(row.title).includes('수고'))) {
    console.error('잡담이 등록되었습니다.');
    process.exit(1);
}
const lunch = parseSchoolMessages('점심시간에 커피 한잔 하실래요', { now: qaNow });
const lunchSave = await saveParsed(lunch.items, qaNow);
if (lunchSave.ok || snapshot().events.some((row) => row.time === '12:10' && String(row.title).includes('커피'))) {
    console.error('날짜 없는 점심 잡담이 일정으로 등록되었습니다.');
    process.exit(1);
}
const trip = parseSchoolMessages('수학여행 11/4~11/6\n2박 3일\n장소: 경주 일대', { now: qaNow });
const tripSave = await saveParsed(trip.items, qaNow);
const tripRow = snapshot().events.find((row) => row.title === '수학여행');
if (!tripSave.ok || !tripRow || tripRow.date !== '2026-11-04' || tripRow.end !== '2026-11-06' || !String(tripRow.memo).includes('경주 일대') || snapshot().todos.some((row) => row.date === '2026-11-03')) {
    console.error('수학여행 장소가 11월 3일 할 일로 남았습니다.');
    process.exit(1);
}

const legacyRaw = JSON.stringify([{ id: '1', name: '김하늘' }]);
const legacy = {
    length: 1,
    key() { return 'homenote_v2_classRoster'; },
    getItem(key) { return key === 'homenote_v2_classRoster' ? legacyRaw : null; },
};
const bag = readLegacyStorage(legacy);
const plan = planMigration(bag, { titles: {}, now: MSG_NOW });
if (legacy.getItem('homenote_v2_classRoster') !== legacyRaw || !plan.students.some((row) => row.name === '김하늘')) {
    console.error('예전 명단을 그대로 읽지 못했습니다.');
    process.exit(1);
}
console.log('채점 시각 10/22와 예전 명단 읽기도 확인했습니다.');

const hold = { n: 0, ok: 0, by: {} };
MSG_HOLDOUT.forEach((row) => {
    const items = parseSchoolMessages(row.text, { now: MSG_NOW }).items;
    const passed = row.ok(items);
    hold.n += 1;
    hold.by[row.principle] = hold.by[row.principle] || { n: 0, ok: 0 };
    hold.by[row.principle].n += 1;
    if (passed) {
        hold.ok += 1;
        hold.by[row.principle].ok += 1;
    } else {
        console.error('확인 예문', row.principle, row.text, items.map((item) => item.title));
    }
});
const holdPct = Math.round((hold.ok / hold.n) * 1000) / 10;
console.log(`따로 둔 예문 ${hold.ok}/${hold.n} (${holdPct}%) ${Object.entries(hold.by).map(([key, value]) => `${key} ${value.ok}/${value.n}`).join(', ')}`);
if (hold.ok !== hold.n) process.exit(1);

const blind = { n: 0, ok: 0, miss: [] };
MSG_BLIND.forEach((row) => {
    const items = parseSchoolMessages(row.text, { now: MSG_NOW }).items;
    blind.n += 1;
    if (row.ok(items)) blind.ok += 1;
    else {
        blind.miss.push({
            id: row.id,
            got: items.map((item) => ({
                kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include,
            })),
        });
    }
});
const blindPct = blind.n ? Math.round((blind.ok / blind.n) * 1000) / 10 : 0;
console.log(`규칙을 고치는 동안 보지 않은 예문 ${blind.ok}/${blind.n} (${blindPct}%)`);
if (blind.miss.length) console.log(JSON.stringify(blind.miss, null, 2));

const fresh = { n: 0, ok: 0, miss: [] };
MSG_FRESH.forEach((row) => {
    const items = parseSchoolMessages(row.text, { now: MSG_NOW }).items;
    fresh.n += 1;
    if (row.ok(items)) fresh.ok += 1;
    else {
        fresh.miss.push({
            id: row.id,
            got: items.map((item) => ({
                kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, eventKind: item.eventKind,
            })),
        });
    }
});
const freshPct = fresh.n ? Math.round((fresh.ok / fresh.n) * 1000) / 10 : 0;
console.log(`새로 둔 예문 ${fresh.ok}/${fresh.n} (${freshPct}%)`);
if (fresh.miss.length) console.log(JSON.stringify(fresh.miss, null, 2));
