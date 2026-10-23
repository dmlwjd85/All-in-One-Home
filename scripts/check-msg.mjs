/** 학교 메시지 예문을 읽고 유형·날짜·시각·제목 정확도를 확인합니다. */
import { readFileSync, writeFileSync } from 'node:fs';
import { gradeMessages, leakedAbsenceDates, parseSchoolMessages, silentOtherAbsence, silentPostponement } from '../src/lib/msgParse.js';
import { findDates } from '../src/lib/parse.js';
import { MSG_NOW, MSG_SAMPLES } from '../src/lib/msgSamples.js';
import { MSG_HOLDOUT } from '../src/lib/msgHoldout.js';
import { MSG_BLIND } from '../src/lib/msgBlind.js';
import { MSG_FRESH } from '../src/lib/msgFresh.js';
import { MSG_UNSEEN } from '../src/lib/msgUnseen.js';
import { MSG_YEAR } from '../src/lib/msgYear.js';
import { MSG_MOVE } from '../src/lib/msgMove.js';
import { MSG_SHIFT } from '../src/lib/msgShift.js';
import { MSG_DOUBT } from '../src/lib/msgDoubt.js';
import { endTimeUploadBlocked, noteEndTimeRejected, prepareEventWrite, resetEndTimeUpload } from '../src/lib/cloud.js';
import { eventBodyWithoutEndTime, toCloudRow } from '../src/lib/cloudShape.js';
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
must('쉼표 교시', '김교사 출장으로 5,6교시 보결 부탁드립니다', qaNow, (items) => items.length === 1 && items[0].time === '13:10' && items[0].period === 5 && items[0].periodEnd === 6 && items[0].title === '5,6교시 보결');
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
must('명시 연도', '2027년 3월 4일 봄철 돌봄교실 운영 계획서 제출', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2027-03-04' && items[0].title.includes('계획서'));
must('노란 빼 둠', '어제 체육대회 다들 수고 많으셨습니다!', qaNow, (items) => items.length === 1 && items[0].low === true && items[0].include === false);
must('상담 마감', '2차 상담 신청은 다음주 화요일까지 받습니다.', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-27' && items[0].title.includes('상담'));
must('종업식', '2027-02-12 종업식', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2027-02-12');
must('방학식', '2026년 12월 23일(수) 방학식', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-12-23' && items[0].title.includes('방학식'));
must('미운행', '11월 2일(월) 셔틀버스 미운행합니다', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-02' && items[0].title.includes('미운행'));
must('상담 회신 제목', '하준이 담임 상담 요청 들어왔어요. 내일까지 가능한 시간 알려주세요.', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-23' && items[0].title.includes('하준') && items[0].title.includes('상담') && items[0].title.includes('회신'));
must('두 자리 연도', '27.1.11 겨울 영재캠프 운영', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2027-01-11' && !/\d/.test(items[0].title));
must('두 자리 마감', '27.02.03까지 학생 생활기록부 최종 점검', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2027-02-03' && !/\d/.test(items[0].title));
must('학년도', '2027학년도 학부모총회 3월 18일(목) 오후 2시', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2027-03-18' && items[0].time === '14:00' && !items[0].warning && !items[0].title.includes('학년도'));
must('지난 참고', '2025년 11월 3일 학교폭력 실태조사 결과 공유합니다. 참고만 해주세요.', qaNow, (items) => items.length === 1 && items[0].date === '2025-11-03' && items[0].low === true && items[0].include === false);
must('개강', '2027. 1. 4.(월) 방학 중 방과후학교 개강', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2027-01-04' && items[0].time === '' && items[0].title.includes('개강'));
must('휴무', '2027년 1월 1일 신정 휴무', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].eventKind === '휴일' && items[0].date === '2027-01-01');
must('수업 연기', '방과후 축구반 10/29(목) 수업은 11/5(목)로 연기됩니다.', qaNow, (items) => items.filter((item) => item.include !== false).length === 1 && items.some((item) => item.include !== false && item.kind === '일정' && item.date === '2026-11-05' && item.title === '방과후 축구반 수업') && items.some((item) => item.date === '2026-10-29' && item.include === false && item.low === true));
must('상담 변경', '윤서 어머님 상담 10/27 → 10/28(수) 15:30으로 변경', qaNow, (items) => items.filter((item) => item.include !== false).length === 1 && items.some((item) => item.include !== false && item.kind === '일정' && item.date === '2026-10-28' && item.time === '15:30' && item.title === '윤서 어머님 상담') && items.some((item) => item.date === '2026-10-27' && item.include === false));
must('끝 월 생략', '12월 8일(화)~10일(목)', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-12-08' && items[0].end === '2026-12-10');
must('결혼 잡담', '다음달 7일에 저 결혼해요!! 청첩장 드릴게요 ㅎㅎ', qaNow, (items) => items.length === 1 && items[0].date === '2026-11-07' && items[0].include === false && items[0].low === true);
must('탑재 마감', '10월 30일 17:00까지 수행평가 계획 탑재', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-30' && items[0].time === '17:00' && items[0].title.includes('탑재'));
must('검사 차례', '11월 2일 1차, 11월 16일 2차 독서기록장 검사', qaNow, (items) => items.length === 2 && items.every((item) => item.kind === '일정' && item.include !== false) && items[0].date === '2026-11-02' && items[0].title === '독서기록장 검사 1차' && items[1].date === '2026-11-16' && items[1].title === '독서기록장 검사 2차');
must('이번 달 말', '이번 달 말까지 가정통신문 회신 바랍니다', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-31' && items[0].title === '가정통신문 회신' && items[0].include !== false && !/대략/.test(items[0].warning || ''));
must('다음 달 초', '다음 달 초 교직원 연수', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-01' && items[0].title === '교직원 연수' && items[0].include === false && /대략/.test(items[0].warning));
must('앞당김', '10/29(목)에서 10/27(화) 15:00로 앞당겨졌습니다', qaNow, (items) => items.filter((item) => item.include !== false).length === 1 && items.some((item) => item.include !== false && item.kind === '일정' && item.date === '2026-10-27' && item.time === '15:00') && items.some((item) => item.date === '2026-10-29' && item.include === false && item.low === true));
must('요일 이동', '다음주 월요일에서 수요일로', qaNow, (items) => items.filter((item) => item.include !== false).length === 1 && items.some((item) => item.include !== false && item.date === '2026-10-28') && items.some((item) => item.date === '2026-10-26' && item.include === false));
must('기간 이동', '11/16~11/20에서 11/23~11/27로', qaNow, (items) => items.some((item) => item.include !== false && item.kind === '일정' && item.date === '2026-11-23' && item.end === '2026-11-27') && items.some((item) => item.date === '2026-11-16' && item.end === '2026-11-20' && item.include === false));
must('월 없는 기간', '25~27일 학년 연구실 공사', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-25' && items[0].end === '2026-10-27' && items[0].title === '학년 연구실 공사' && !/\d/.test(items[0].title));
must('취소', '10/30 현장체험학습이 취소되었습니다', qaNow, (items) => items.length === 1 && items[0].include === false && items[0].low === true && items[0].date === '2026-10-30');
must('시간 마감', '다음 달 말까지 연수 30시간 이수 확인', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-11-30' && items[0].title.includes('30시간') && items[0].title.includes('연수') && items[0].include !== false && !/대략/.test(items[0].warning || ''));
must('촬영 일정', '다음 달 초 학급 사진 촬영', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-01' && items[0].title === '학급 사진 촬영' && items[0].include === false && /대략/.test(items[0].warning));
must('이번 달 중', '이번 달 중으로 안전교육 이수 확인', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-31' && items[0].include !== false && !items[0].title.includes('중으로') && !/대략/.test(items[0].warning || ''));
must('시각 이동', '내일 교직원 회의는 15:40에서 16:10으로 변경', qaNow, (items) => items.filter((item) => item.include !== false).length === 1 && items.some((item) => item.include !== false && item.kind === '일정' && item.date === '2026-10-23' && item.time === '16:10' && item.title.includes('회의')));
must('아니라', '10/30(금)이 아니라 10/31(토)입니다. 정정', qaNow, (items) => items.filter((item) => item.include !== false).length === 1 && items.some((item) => item.include !== false && item.date === '2026-10-31') && items.some((item) => item.date === '2026-10-30' && item.include === false));
must('기한 연장', '독서록 제출 기한이 10/23에서 10/30으로 연장', qaNow, (items) => items.filter((item) => item.include !== false).length === 1 && items.some((item) => item.include !== false && item.kind === '할 일' && item.date === '2026-10-30' && item.title.includes('독서록') && item.title.includes('제출')));
must('예선 본선', '예선 11/9(월), 본선 11/16(월)', qaNow, (items) => items.filter((item) => item.include !== false && item.kind === '일정').length === 2 && items.some((item) => item.date === '2026-11-09' && item.title.includes('예선')) && items.some((item) => item.date === '2026-11-16' && item.title.includes('본선')));
must('작년', '작년 10/30 현장학습 사진입니다', qaNow, (items) => items.length >= 1 && items.every((item) => item.include === false && item.low === true) && items.some((item) => item.date === '2025-10-30'));
must('대체', '10/30 소풍은 취소되고 11/6 박물관 견학으로 대체', qaNow, (items) => items.some((item) => item.date === '2026-10-30' && item.include === false) && items.some((item) => item.include !== false && item.kind === '일정' && item.date === '2026-11-06' && item.title.includes('견학')));
must('모호한 두 날짜', '학예회 11/2(월) 상담 11/6(금)', qaNow, (items) => items.length === 2 && items.every((item) => item.include === false && item.low === true) && items.some((item) => item.date === '2026-11-02') && items.some((item) => item.date === '2026-11-06'));
must('대회', '11/12(목) 과학탐구대회', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-12' && items[0].include !== false);
must('5교시', '내일 영어는 5교시 그대로입니다', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].period === 5 && items[0].time === '13:10' && items[0].title.includes('영어'));
must('시각 범위', '10/30(금) 오후 2시~4시 학부모 진로 특강 (강당)', qaNow, (items) => items.length === 1 && items[0].include !== false && items[0].date === '2026-10-30' && items[0].time === '14:00' && items[0].endTime === '16:00' && String(items[0].memo).includes('강당') && items[0].title.includes('특강') && !items[0].title.includes('강당'));
must('시각 물결', '13:00~16:00 교육과정 워크숍', qaNow, (items) => items.length === 1 && items[0].time === '13:00' && items[0].endTime === '16:00' && items[0].title.includes('워크숍'));
must('시각 줄표', '13:00-16:00 교육과정 워크숍', qaNow, (items) => items.length === 1 && items[0].time === '13:00' && items[0].endTime === '16:00' && items[0].title.includes('워크숍'));
must('시각 부터까지', '13:00부터 16:00까지 교육과정 워크숍', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].time === '13:00' && items[0].endTime === '16:00' && items[0].title.includes('워크숍'));
must('오전 오후 범위', '10/30(금) 오전 10시~오후 1시 학부모 연수', qaNow, (items) => items.length === 1 && items[0].include !== false && items[0].date === '2026-10-30' && items[0].time === '10:00' && items[0].endTime === '13:00' && items[0].title.includes('연수'));
must('시 범위 상속', '10/30(금) 2시~4시 학부모 연수', qaNow, (items) => items.length === 1 && items[0].date === '2026-10-30' && items[0].time === '14:00' && items[0].endTime === '16:00' && items[0].title.includes('연수'));
must('박람회 범위', '10/30(금) 오전 10시~오후 1시 진로 박람회', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].include !== false && items[0].low === false && items[0].date === '2026-10-30' && items[0].time === '10:00' && items[0].endTime === '13:00' && items[0].title.includes('박람회'));
must('시각 부터까지 일정', '10/30(금) 오전 10시부터 오후 1시까지 진로 박람회', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].include !== false && items[0].date === '2026-10-30' && items[0].time === '10:00' && items[0].endTime === '13:00' && items[0].title.includes('박람회'));
must('제출 마감', '10/30(금)까지 독서록 제출', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].include !== false && items[0].date === '2026-10-30' && items[0].title.includes('독서록') && items[0].title.includes('제출') && !items[0].endTime);
must('금요일 마감', '금요일까지 제출', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].include !== false && items[0].date === '2026-10-23' && items[0].title.includes('제출') && !items[0].endTime);
const fridayClock = new Date('2026-10-23T09:00:00+09:00');
const noDa = (title) => !/^다(?:\s|$)/.test(title);
const noTimeWords = (title) => !/오전|오후|\d\s*시|요일/.test(title);
const noO = (title) => !title.includes('오는') && !/^오(?:\s|$)/.test(title);
const weekdayDeadlines = [
    ['금요일까지 학급 운영비 영수증 제출해 주세요.', '2026-10-23', '', '학급 운영비', qaNow],
    ['금요일까지 제출', '2026-10-23', '', '제출', qaNow],
    ['월요일까지 가정통신문 회신해 주세요.', '2026-10-26', '', '회신', qaNow],
    ['목요일까지 영수증 제출', '2026-10-22', '', '영수증', qaNow],
    ['일요일까지 설문 회신', '2026-10-25', '', '설문', qaNow],
    ['토요일까지 계획 작성해 주세요', '2026-10-24', '', '작성', qaNow],
    ['수요일까지 자료 업로드', '2026-10-28', '', '업로드', qaNow],
    ['금요일 마감 학급 운영비 영수증 제출', '2026-10-23', '', '영수증', qaNow],
    ['목요일 마감으로 학급비 제출해 주세요', '2026-10-22', '', '학급비', qaNow],
    ['금요일까지 학급 운영비 영수증 제출해 주세요.', '2026-10-23', '', '영수증', fridayClock],
    ['다다음주 금요일까지 학급 운영비 영수증 제출해 주세요.', '2026-11-06', '', '학급 운영비', qaNow, noDa],
    ['다다음 주 금요일까지 제출', '2026-11-06', '', '제출', qaNow, noDa],
    ['목요일 오후 3시까지 학급 운영비 영수증 제출해 주세요.', '2026-10-22', '15:00', '영수증', qaNow, noTimeWords],
    ['금요일 오후 5시까지 보고서 제출', '2026-10-23', '17:00', '보고서', qaNow, noTimeWords],
    ['금요일 오후 5시까지', '2026-10-23', '17:00', '', qaNow, noTimeWords],
    ['월요일 오전까지 설문 제출', '2026-10-26', '12:00', '설문', qaNow, noTimeWords],
    ['월요일 오전까지', '2026-10-26', '12:00', '', qaNow, noTimeWords],
    ['(금)까지 영수증 제출', '2026-10-23', '', '영수증', qaNow, noTimeWords],
    ['(금)까지', '2026-10-23', '', '', qaNow, noTimeWords],
    ['오는 수요일까지 학급 운영비 영수증 제출해 주세요.', '2026-10-28', '', '학급 운영비', qaNow, noO],
    ['오는 수요일까지 제출', '2026-10-28', '', '제출', qaNow, noO],
];
let deadlineOk = 0;
weekdayDeadlines.forEach(([text, date, time, word, now, clean]) => {
    const items = parseSchoolMessages(text, { now }).items;
    const title = items[0]?.title || '';
    const hit = items.length === 1
        && items[0].kind === '할 일'
        && items[0].include !== false
        && !items[0].warning
        && items[0].date === date
        && (time ? items[0].time === time : !items[0].time)
        && (word ? title.includes(word) : true)
        && (!clean || clean(title))
        && !items[0].endTime;
    if (hit) deadlineOk += 1;
    else {
        console.error('요일 마감', text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, time: item.time, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
});
if (deadlineOk !== weekdayDeadlines.length) {
    console.error(`요일 마감 ${deadlineOk}/${weekdayDeadlines.length}`);
    process.exit(1);
}
console.log(`요일 마감 ${deadlineOk}/${weekdayDeadlines.length}`);

const quiet = (items) => items.some((item) => item.include !== false && !item.warning);
const r29Cases = [
    ['Y15 지난해', '지난해 11월 5일 현장학습', (items) => items.length === 1 && items[0].date === '2025-11-05' && items[0].include === false && items[0].low === true && /지난/.test(items[0].warning) && !quiet(items)],
    ['Y15 지난 해', '지난 해 11월 5일 현장학습', (items) => items.length === 1 && items[0].date === '2025-11-05' && items[0].include === false && /지난/.test(items[0].warning)],
    ['Y15 지난 11월', '지난 11월 5일 현장학습', (items) => items.length === 1 && items[0].date === '2025-11-05' && items[0].include === false && items[0].title === '현장학습' && /지난/.test(items[0].warning)],
    ['Y15 지난 1월', '지난 1월 8일 시업식', (items) => items.length === 1 && items[0].date === '2026-01-08' && items[0].include === false && /지난/.test(items[0].warning)],
    ['Y15 지난 9월', '지난 9월 15일 현장학습', (items) => items.length === 1 && items[0].date === '2026-09-15' && items[0].include === false && /지난 날짜/.test(items[0].warning)],
    ['Y15 지난달', '지난달 15일 현장학습', (items) => items.length === 1 && items[0].date === '2026-09-15' && items[0].include === false && items[0].title === '현장학습' && /지난 날짜/.test(items[0].warning)],
    ['Y15 지난 달', '지난 달 15일 현장학습', (items) => items.length === 1 && items[0].date === '2026-09-15' && items[0].include === false],
    ['Y15 재작년', '재작년 5월 8일 현장학습', (items) => items.length === 1 && items[0].date === '2024-05-08' && items[0].include === false && /지난/.test(items[0].warning)],
    ['Y15 올해 11월', '11월 5일 현장학습', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-05' && items[0].include !== false && !items[0].warning],
    ['Z6 인가요', '10/30 협의회인가요?', (items) => items.length === 1 && items[0].date === '2026-10-30' && items[0].include === false && /질문/.test(items[0].warning) && !quiet(items)],
    ['Z6 할까요', '10/30 소풍 할까요?', (items) => items.length === 1 && items[0].include === false && /질문/.test(items[0].warning)],
    ['Z6 되나요', '10/30 견학 되나요?', (items) => items.length === 1 && items[0].date === '2026-10-30' && items[0].include === false && /질문/.test(items[0].warning)],
    ['Z6 요일 질문', '금요일 오후 3시 학년 협의회인가요?', (items) => items.length === 1 && items[0].date === '2026-10-23' && items[0].time === '15:00' && items[0].include === false && /질문/.test(items[0].warning)],
    ['Z7 안 합니다', '10/30 체육대회 안 합니다', (items) => items.length === 1 && items[0].date === '2026-10-30' && items[0].include === false && /열리지 않는/.test(items[0].warning) && !quiet(items)],
    ['Z7 미실시', '10/30 체육대회는 미실시', (items) => items.length === 1 && items[0].include === false && /열리지 않는/.test(items[0].warning)],
    ['Z7 행사 없습니다', '10/30 행사가 없습니다', (items) => items.length === 1 && items[0].include === false && /열리지 않는/.test(items[0].warning)],
    ['Z7 소풍 없습니다', '10/30 소풍은 없습니다', (items) => items.length === 1 && items[0].include === false && /열리지 않는/.test(items[0].warning)],
    ['Z7 운행 유지', '차주 수요일 통학차량 운행이 없습니다', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-28' && items[0].include !== false && items[0].title.includes('통학')],
    ['Z7 조회 유지', '11/6(금) 전교 조회는 없습니다.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-06' && items[0].include !== false && items[0].title.includes('조회')],
    ['Z7 대체 유지', '10/30 소풍은 취소되고 11/6 박물관 견학으로 대체', (items) => items.some((item) => item.date === '2026-10-30' && item.include === false) && items.some((item) => item.include !== false && item.kind === '일정' && item.date === '2026-11-06' && item.title.includes('견학'))],
    ['잠정은 문구로 빼지 않음', '잠정 10/30 체육대회', (items) => items.length === 1 && items[0].date === '2026-10-30' && items[0].include !== false && !/확신/.test(items[0].warning || '')],
    ['미정은 문구로 빼지 않음', '미정으로 10/30 소풍', (items) => items.length === 1 && items[0].include !== false && !/확신/.test(items[0].warning || '')],
    ['아마도은 문구로 빼지 않음', '아마도 10/30 협의회', (items) => items.length === 1 && items[0].include !== false && !/확신/.test(items[0].warning || '')],
    ['미확정은 문구로 빼지 않음', '미확정 10/30 대회', (items) => items.length === 1 && items[0].include !== false && !/확신/.test(items[0].warning || '')],
    ['경계 아닌 대회', '10/30 체육대회', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-30' && items[0].include !== false && !items[0].warning],
    ['지난주 금요일', '지난주 금요일까지 학급 운영비 영수증 제출해 주세요.', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-16' && items[0].include === false && /지난 날짜/.test(items[0].warning) && items[0].title.includes('영수증') && !/지난주|저번주|금요일/.test(items[0].title)],
    ['저번주 금요일', '저번주 금요일까지 제출', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-16' && items[0].include === false && /지난 날짜/.test(items[0].warning) && !/저번/.test(items[0].title)],
    ['지난 주 금요일', '지난 주 금요일까지 제출', (items) => items.length === 1 && items[0].date === '2026-10-16' && items[0].include === false && /지난 날짜/.test(items[0].warning)],
    ['저번 주 금요일', '저번 주 금요일까지', (items) => items.length === 1 && items[0].date === '2026-10-16' && items[0].include === false && /지난 날짜/.test(items[0].warning)],
    ['다음주 유지', '다음주 금요일까지 제출', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-30' && items[0].include !== false && !items[0].warning],
    ['금요일 협의회', '금요일 오후 3시 학년 협의회', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-23' && items[0].time === '15:00' && items[0].include !== false && items[0].title === '학년 협의회' && !items[0].warning],
    ['월요일 회의', '월요일 오전 학년 회의', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-26' && items[0].time === '' && items[0].include !== false && items[0].title === '학년 회의' && !items[0].warning],
    ['당일 금요일 협의회', '금요일 오후 3시 학년 협의회', (items) => items.length === 1 && items[0].date === '2026-10-23' && items[0].time === '15:00' && items[0].include !== false && items[0].title === '학년 협의회'],
];
let r29Ok = 0;
r29Cases.forEach(([label, text, ok], index) => {
    const now = label.startsWith('당일') ? fridayClock : qaNow;
    const items = parseSchoolMessages(text, { now }).items;
    if (ok(items)) r29Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, time: item.time, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
    if (index === r29Cases.length - 1 && r29Ok !== r29Cases.length) {
        console.error(`무음 오류와 요일 ${r29Ok}/${r29Cases.length}`);
        process.exit(1);
    }
});
console.log(`무음 오류와 요일 ${r29Ok}/${r29Cases.length}`);

const quietCard = (items) => items.some((item) => item.include !== false && !item.warning);
const yellowDated = (items, date) => items.some((item) => item.date === date && item.include === false && item.low === true);
const r30Cases = [
    ['질문 있나요', '선생님 내일 회의 있나요?', (items) => items.length === 1 && items[0].date === '2026-10-23' && items[0].include === false && /질문/.test(items[0].warning) && !quietCard(items)],
    ['질문 쓰시나요', '이 서류 내일까지 쓰시나요', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-23' && items[0].include === false && /질문/.test(items[0].warning) && items[0].title.includes('서류')],
    ['질문 열나요', '11/6 행사 열나요?', (items) => items.length === 1 && items[0].date === '2026-11-06' && items[0].include === false && /질문/.test(items[0].warning) && !quietCard(items)],
    ['질문 건가요', '금요일 협의회 가실 건가요', (items) => items.length >= 1 && items.every((item) => item.include === false) && items.some((item) => /질문/.test(item.warning))],
    ['부정 진행하지', '체육대회는 진행하지 않습니다. 10/30', (items) => yellowDated(items, '2026-10-30') && items.every((item) => item.include === false) && items.some((item) => item.title.includes('체육대회')) && !quietCard(items)],
    ['부정 하지 않습니다', '10/30 체육대회는 하지 않습니다', (items) => items.length === 1 && items[0].date === '2026-10-30' && items[0].include === false && /열리지 않는/.test(items[0].warning)],
    ['부정 없어요', '10/30 소풍은 없어요', (items) => items.length === 1 && items[0].date === '2026-10-30' && items[0].include === false && /열리지 않는/.test(items[0].warning) && items[0].title.includes('소풍')],
    ['부정 않고 제출', '내일까지 늦지 않게 제출해 주세요', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-23' && items[0].include !== false && !/열리지/.test(items[0].warning || '')],
    ['조회 없습니다', '오늘 7시 조회는 없습니다', (items) => items.length === 1 && items[0].kind === '일정' && items[0].include !== false && items[0].title.includes('조회')],
    ['스쿨버스 없습니다', '차주 월요일 스쿨버스 운행이 없습니다.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-26' && items[0].include !== false && items[0].title.includes('스쿨버스')],
    ['작년과 올해', '작년 학예회는 11/10, 올해는 11/20', (items) => yellowDated(items, '2025-11-10') && items.some((item) => item.date === '2026-11-20' && item.include !== false && item.title.includes('학예회')) && !items.some((item) => item.date === '2026-11-10' && item.include !== false)],
    ['지난해 비인접', '지난해 현장학습은 11월 5일에 갔습니다', (items) => yellowDated(items, '2025-11-05') && items.length === 1 && items[0].include === false && items[0].title.includes('현장학습') && /지난/.test(items[0].warning || '')],
    ['작년에는', '작년에는 10/30 소풍이었습니다', (items) => yellowDated(items, '2025-10-30') && items.every((item) => item.include === false) && items.some((item) => item.title.includes('소풍'))],
    ['작년 다음 문장', '작년 학예회 사진입니다. 11/10에 찍었습니다', (items) => items.some((item) => item.date === '2026-11-10' && item.include !== false) && !items.some((item) => String(item.date).startsWith('2025'))],
    ['올해만', '올해 학예회는 11/20입니다', (items) => items.length === 1 && items[0].date === '2026-11-20' && items[0].include !== false && items[0].title.includes('학예회') && !/지난/.test(items[0].warning || '')],
    ['다음 달 중순', '다음 달 중순 체육대회', (items) => items.length === 1 && items[0].date === '2026-11-15' && items[0].include === false && /대략/.test(items[0].warning) && items[0].title.includes('체육대회') && !items[0].title.includes('순')],
    ['다음 달 말 학예회', '다음 달 말 학예회', (items) => items.length === 1 && items[0].date === '2026-11-30' && items[0].include === false && /대략/.test(items[0].warning) && items[0].title.includes('학예회')],
    ['일경', '10월 30일경 소풍', (items) => items.length === 1 && items[0].date === '2026-10-30' && items[0].include === false && /대략/.test(items[0].warning) && items[0].title.includes('소풍') && !items[0].title.includes('경')],
    ['쯤', '11/20쯤 현장학습', (items) => items.length === 1 && items[0].date === '2026-11-20' && items[0].include === false && /대략/.test(items[0].warning) && items[0].title.includes('현장학습') && !items[0].title.includes('쯤')],
    ['경주 유지', '수학여행\n11/4~11/6\n장소: 경주 일대', (items) => items.length === 1 && items[0].include !== false && items[0].memo.includes('경주') && !/대략/.test(items[0].warning || '')],
    ['오늘 중으로', '서연이 아버님께 오늘 중으로 전화 상담 부탁드려요', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-22' && items[0].include !== false && !/대략/.test(items[0].warning || '')],
    ['였던 설문', '지난주 수요일까지였던 설문', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-14' && items[0].include === false && items[0].title === '설문' && !/였던|수요일/.test(items[0].title)],
    ['설문 기간', '11월 2일(월)~11월 6일(금)까지 설문 제출', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-11-06' && items[0].include !== false && items[0].title.includes('설문') && items[0].title.includes('제출')],
    ['마지막 날', '11/2~11/6 학부모 상담주간 회신은 마지막 날까지', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-11-06' && items[0].include !== false && items[0].title.includes('회신') && !/마지막|부터/.test(items[0].title)],
    ['상담 기간과 제출', '상담은 11/2부터 11/6까지입니다. 설문 제출은 11/6까지', (items) => items.some((item) => item.kind === '일정' && item.date === '2026-11-02' && item.end === '2026-11-06' && item.include !== false && item.title.includes('상담') && !item.title.includes('설문') && !item.title.includes('부터')) && items.some((item) => item.kind === '할 일' && item.date === '2026-11-06' && item.include !== false && item.title.includes('설문') && item.title.includes('제출'))],
    ['기간 끝 제출', '11/3~11/7 현장학습 준비물은 11/7까지 제출', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-11-07' && items[0].include !== false && items[0].title.includes('준비물') && items[0].title.includes('제출')],
    ['화요일 2교시', '화요일 2교시', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-27' && items[0].time === '09:40' && items[0].period === 2 && items[0].include !== false],
    ['화요일 2교시 영어', '화요일 2교시 영어', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-27' && items[0].time === '09:40' && items[0].period === 2 && items[0].include !== false && items[0].title.includes('영어')],
    ['화요일 2교시 회의', '화요일 2교시 학급 회의', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-27' && items[0].time === '09:40' && items[0].period === 2 && items[0].include !== false && items[0].title === '학급 회의'],
];
let r30Ok = 0;
r30Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r30Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, period: item.period, title: item.title, include: item.include, low: item.low, warning: item.warning, memo: item.memo,
        }))));
    }
});
if (r30Ok !== r30Cases.length) {
    console.error(`원문 원칙 ${r30Ok}/${r30Cases.length}`);
    process.exit(1);
}
console.log(`원문 원칙 ${r30Ok}/${r30Cases.length}`);

const included = (items) => items.filter((item) => item.include !== false);
const r31Cases = [
    ['Y15', '작년에는 11/10이었는데 올해 학예회는 11/19(목)입니다.', (items) => yellowDated(items, '2025-11-10') && included(items).some((item) => item.kind === '일정' && item.date === '2026-11-19' && item.title === '학예회') && !included(items).some((item) => item.date === '2026-11-10') && !items.some((item) => /이었|올해/.test(item.title))],
    ['Z6', '다음주 목요일에 다들 연차 쓰시나요?', (items) => items.length >= 1 && items.every((item) => item.include === false) && items.some((item) => /질문/.test(item.warning)) && !quietCard(items)],
    ['Z7', '11월 11일(수) 빼빼로데이 행사는 하지 않습니다. 학생 지도 부탁드려요.', (items) => yellowDated(items, '2026-11-11') && items.every((item) => item.include === false) && !quietCard(items)],
    ['N9', '교원능력개발평가 참여 기간 11. 2.(월) ~ 11. 13.(금)까지이니 꼭 참여 부탁드립니다.', (items) => items.some((item) => item.kind === '일정' && item.date === '2026-11-02' && item.end === '2026-11-13' && item.include !== false && item.title === '교원능력개발평가 참여') && items.some((item) => item.kind === '할 일' && item.date === '2026-11-13' && item.include !== false && item.title === '교원능력개발평가 참여') && !items.some((item) => /이니/.test(item.title))],
    ['X8', '다음 달 초에 학급 사진 촬영 예정이에요.', (items) => items.length === 1 && items[0].date === '2026-11-01' && items[0].include === false && /대략/.test(items[0].warning) && items[0].title === '학급 사진 촬영'],
    ['지난해 올해', '지난해에는 11월 5일이었고 올해 운동회는 11월 12일(목)입니다.', (items) => yellowDated(items, '2025-11-05') && included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-12' && included(items)[0].title === '운동회' && !included(items).some((item) => item.date === '2025-11-05')],
    ['실태조사 기간', '학교폭력 실태조사 기간 11. 9.(월) ~ 11. 20.(금)까지이니 학생 참여 독려 바랍니다.', (items) => items.some((item) => item.kind === '일정' && item.date === '2026-11-09' && item.end === '2026-11-20' && item.include !== false && item.title === '학교폭력 실태조사') && items.some((item) => item.kind === '할 일' && item.date === '2026-11-20' && item.include !== false) && !items.some((item) => /이니/.test(item.title))],
    ['설문 까지이니', '설문 응답 기간은 10/26~10/30까지이니 꼭 참여해 주세요.', (items) => items.some((item) => item.kind === '일정' && item.date === '2026-10-26' && item.end === '2026-10-30' && item.include !== false && item.title === '설문 응답') && items.some((item) => item.kind === '할 일' && item.date === '2026-10-30' && item.include !== false && item.title.includes('설문')) && !items.some((item) => /이니/.test(item.title))],
    ['F1', '11/12(목) 운동회는 열지 않기로 했습니다.', (items) => items.length === 1 && items[0].date === '2026-11-12' && items[0].include === false && /열리지 않는/.test(items[0].warning) && !quietCard(items)],
    ['F3', '11/12(목) 운동회는 취소 없이 예정대로 진행합니다.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-12' && items[0].include !== false && items[0].title.includes('운동회') && !/취소/.test(items[0].warning || '')],
    ['F4', '우천 시에도 연기하지 않고 11/13(금) 현장체험학습 진행합니다.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-13' && items[0].include !== false && items[0].title.includes('현장체험학습') && !/않고/.test(items[0].title)],
    ['Q3', '11/3(화)까지 서류 제출 잊지 않으셨죠? 꼭 내 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-03' && included(items)[0].title.includes('서류') && included(items)[0].title.includes('제출') && !/질문/.test(included(items)[0].warning || '')],
    ['Y3', '작년처럼 11/20(금) 교내 체육대회 엽니다.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-20' && items[0].include !== false && items[0].title.includes('체육대회') && !/지난/.test(items[0].warning || '')],
    ['Y2', '올해는 11/12(목)에 학예회를 합니다.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-12' && items[0].include !== false && items[0].title === '학예회'],
    ['A4', '11월 초인 11/2(월)에 교육과정 설명회 합니다.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-02' && items[0].include !== false && items[0].title === '교육과정 설명회'],
    ['F6', '11/10(화) 학부모 상담 주간, 결석 없이 참여 부탁드립니다.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-10' && items[0].include !== false && items[0].title.includes('상담') && !/없이/.test(items[0].title)],
    ['Y1', '작년과 달리 올해 졸업식은 2027년 1월 8일(금)입니다.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2027-01-08' && items[0].include !== false && items[0].title === '졸업식'],
    ['D1', '독서 감상문 공모 기간 11. 2.(월) ~ 11. 13.(금)까지이니 작품 제출 부탁드립니다.', (items) => items.some((item) => item.kind === '일정' && item.date === '2026-11-02' && item.end === '2026-11-13' && item.include !== false) && items.some((item) => item.kind === '할 일' && item.date === '2026-11-13' && item.include !== false && item.title === '독서 감상문 작품 제출')],
    ['D2', '학부모 만족도 조사 10/26(월)~10/30(금), 기간 내 응답 부탁드립니다.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-26' && items[0].end === '2026-10-30' && items[0].include !== false && items[0].title === '학부모 만족도 조사'],
    ['W6', '이번 달 말까지 학급문고 정리 부탁드려요', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-31' && items[0].include !== false && items[0].title.includes('학급문고') && !/대략/.test(items[0].warning || '')],
    ['X10', '다음 달 말까지 연수 30시간 이수 확인', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-11-30' && items[0].include !== false && !/대략/.test(items[0].warning || '')],
    ['Y16', '매주 수요일 7교시 동아리 활동 (11월부터)', (items) => !items.some((item) => item.include !== false) && !items.some((item) => item.date === '2026-10-28' && item.include !== false)],
    ['통과 작년에도', '작년에도 11/19에 했었죠.', (items) => yellowDated(items, '2025-11-19') && !quietCard(items)],
    ['통과 회식', '다음주 금요일 회식 가시는 분 계신가요?', (items) => items.every((item) => item.include === false) && items.some((item) => /질문/.test(item.warning))],
    ['통과 출장 있나요', '11/6(금) 출장 가시는 분 있나요?', (items) => items.every((item) => item.include === false) && items.some((item) => item.date === '2026-11-06' && /질문/.test(item.warning))],
    ['통과 연수 있나요', '다음주 월요일에 연수 있나요?', (items) => items.every((item) => item.include === false) && items.some((item) => /질문/.test(item.warning))],
    ['통과 진행하지', '11월 13일(금) 학부모 공개수업은 진행하지 않습니다.', (items) => items.length === 1 && items[0].date === '2026-11-13' && items[0].include === false && /열리지 않는/.test(items[0].warning)],
    ['통과 취소', '11/20(금) 체육대회는 취소되었습니다.', (items) => items.length === 1 && items[0].date === '2026-11-20' && items[0].include === false && /취소/.test(items[0].warning)],
    ['통과 몇 시', '11/5(목) 학년 회의 몇 시에 하나요?', (items) => items.every((item) => item.include === false) && items.some((item) => /질문/.test(item.warning))],
    ['통과 신청', '다음주 화요일 출장 신청하셨어요?', (items) => items.every((item) => item.include === false) && items.some((item) => /질문/.test(item.warning))],
    ['통과 없습니다', '다음주 금요일 방과후 수업 없습니다.', (items) => items.length === 1 && items[0].date === '2026-10-30' && items[0].include === false],
    ['통과 작년 사진', '작년 11/20 체육대회 사진 공유합니다.', (items) => yellowDated(items, '2025-11-20') && !quietCard(items)],
    ['통과 중순쑤', '11월 중순쑤 학부모 공개수업 예정입니다.', (items) => items.every((item) => item.include === false) && !items.some((item) => item.date === '2026-11-15' && item.include !== false)],
    ['통과 11월 말', '11월 말 학급 문집 발간 예정', (items) => items.length === 1 && items[0].date === '2026-11-30' && items[0].include === false && /대략/.test(items[0].warning) && items[0].title.includes('문집')],
    ['통과 중순', '다음 달 중순에 수업 공개가 있어요.', (items) => items.length === 1 && items[0].date === '2026-11-15' && items[0].include === false && /대략/.test(items[0].warning)],
    ['통과 작년 올해', '작년 학예회는 11/10, 올해는 11/19(목) 강당에서 합니다.', (items) => yellowDated(items, '2025-11-10') && included(items).some((item) => item.kind === '일정' && item.date === '2026-11-19' && item.title.includes('학예회')) && !included(items).some((item) => item.date === '2026-11-10')],
    ['통과 아시죠', '다들 아시죠? 11월 6일(금) 오후 2시 학부모 총회입니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-06' && item.time === '14:00' && item.title.includes('총회')) && !included(items).some((item) => /질문/.test(item.warning || ''))],
    ['통과 연수 안내', '문의 사항은 교무실로 연락 주세요. 11/9(월) 교직원 연수 15:00 시청각실', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-09' && item.time === '15:00' && item.title.includes('연수'))],
    ['통과 빠짐없이', '11/4(수)까지 빠짐없이 제출해 주세요. 늦지 않게 부탁드려요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-04' && included(items)[0].title.includes('제출') && !/열리지/.test(included(items)[0].warning || '')],
    ['통과 다음 달 3일', '다음 달 3일(화) 교직원 연수 있습니다.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-03' && items[0].include !== false && items[0].title.includes('연수')],
    ['통과 다음 달 10일', '다음 달 10일까지 연수 이수증 제출', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-11-10' && items[0].include !== false && items[0].title.includes('제출')],
    ['통과 화요일 2교시', '화요일 2교시 공개수업', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-27' && items[0].time === '09:40' && items[0].period === 2 && items[0].include !== false && items[0].title.includes('공개수업')],
    ['통과 금요일 4교시', '금요일 4교시 학급 회의', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-23' && items[0].time === '11:20' && items[0].period === 4 && items[0].include !== false && items[0].title === '학급 회의'],
    ['통과 5~6교시', '다음주 수요일 5~6교시 성교육', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-28' && items[0].time === '13:10' && items[0].include !== false && items[0].title.includes('성교육')],
    ['통과 3교시', '11/3(화) 3교시 수업 공개', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-03' && items[0].time === '10:30' && items[0].period === 3 && items[0].include !== false],
    ['통과 신청 기간', '방과후 신청 기간: 11월 2일 ~ 11월 6일까지 신청서 제출', (items) => items.some((item) => item.kind === '할 일' && item.date === '2026-11-06' && item.include !== false && item.title.includes('제출'))],
    ['통과 독서주간', '11/16(월)~11/20(금) 독서주간 운영', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-16' && items[0].end === '2026-11-20' && items[0].include !== false],
    ['통과 빼빼로', '11월 11일 빼빼로데이 행사가 있습니다. 학생 지도 부탁드려요.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-11' && item.title.includes('빼빼로')) && !included(items).some((item) => item.kind === '할 일')],
];
let r31Ok = 0;
r31Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r31Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, period: item.period, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
});
if (r31Ok !== r31Cases.length) {
    console.error(`r31 원문 ${r31Ok}/${r31Cases.length}`);
    process.exit(1);
}
console.log(`r31 원문 ${r31Ok}/${r31Cases.length}`);

const r32Cases = [
    ['열리지 못하게', '11월 6일(금) 학년 체육대회는 열리지 못하게 되었습니다.', (items) => items.length === 1 && items[0].date === '2026-11-06' && items[0].include === false && items[0].low === true && /열리지 않는/.test(items[0].warning) && !quietCard(items)],
    ['제주 잡담', '저 10/24~10/25 제주도 가요~ 귤 사올게요', (items) => items.length >= 1 && items.every((item) => item.include === false) && items.some((item) => item.date === '2026-10-24' && /업무로 볼 말이 없어/.test(item.warning)) && !quietCard(items)],
    ['무산', '11월 6일(금) 학년 체육대회는 무산되었습니다.', (items) => items.length === 1 && items[0].date === '2026-11-06' && items[0].include === false && /열리지 않는/.test(items[0].warning)],
    ['날짜 없는 연기', '11월 6일(금) 학년 체육대회는 연기되었습니다.', (items) => items.length === 1 && items[0].date === '2026-11-06' && items[0].include === false && /열리지 않는/.test(items[0].warning)],
    ['잊지 못하게', '내일까지 잊지 못하게 제출해 주세요', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-10-23' && included(items)[0].title.includes('제출') && !/열리지/.test(included(items)[0].warning || '')],
    ['이달 말일', '이달 말일까지 학급 일지 제출', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-31' && items[0].include !== false && items[0].title.includes('학급 일지') && !/대략/.test(items[0].warning || '')],
    ['11월 말일', '11월 말일까지 독후감 제출', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-11-30' && items[0].include !== false && items[0].title.includes('독후감') && !/대략/.test(items[0].warning || '')],
    ['작년 담임', '작년 담임 선생님들께서는 11/6(금)까지 자료를 제출해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-06' && included(items)[0].title.includes('제출') && !items.some((item) => item.date.startsWith('2025'))],
    ['작년 날짜', '작년 11/6(금)까지 자료를 제출해 주세요.', (items) => yellowDated(items, '2025-11-06') && !quietCard(items)],
];
let r32Ok = 0;
r32Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r32Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
});
if (r32Ok !== r32Cases.length) {
    console.error(`r32 원문 ${r32Ok}/${r32Cases.length}`);
    process.exit(1);
}
console.log(`r32 원문 ${r32Ok}/${r32Cases.length}`);

const r33Cases = [
    ['열리지 못합니다', '11월 20일(금) 교직원 체육대회가 열리지 못합니다.', (items) => items.length === 1 && items[0].date === '2026-11-20' && items[0].include === false && /열리지 않는/.test(items[0].warning) && !quietCard(items)],
    ['진행이 어렵', '다음주 화요일 현장학습은 진행이 어렵게 되었습니다.', (items) => items.length === 1 && items[0].date === '2026-10-27' && items[0].include === false && /열리지 않는/.test(items[0].warning) && items[0].title.includes('현장학습')],
    ['하지 못하게 됐어요', '11/6(금) 운동회는 하지 못하게 됐어요.', (items) => items.length === 1 && items[0].date === '2026-11-06' && items[0].include === false && /열리지 않는/.test(items[0].warning)],
    ['취소하지 않습니다', '비가 와도 취소하지 않습니다. 11/14(토) 학교 축제 그대로 합니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-14' && included(items)[0].title.includes('축제') && !items.some((item) => !item.date) && !/취소된/.test(included(items)[0].warning || '')],
    ['빠짐없이 열립니다', '11/14(토) 학교 축제는 빠짐없이 열립니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-14' && included(items)[0].title.includes('축제')],
    ['그대로 열립니다', '11/14(토) 학교 축제는 그대로 열립니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-14'],
    ['빠지지 말고', '11/5(목) 교직원 연수는 빠지지 말고 참석해 주세요.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-05' && items[0].include !== false && items[0].title.includes('연수')],
    ['잊지 못하게 유지', '내일까지 잊지 못하게 제출해 주세요', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-10-23' && included(items)[0].title.includes('제출')],
    ['못 오시는 회신', '11/4(수)까지 못 오시는 학부모님은 회신', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-04' && included(items)[0].title.includes('회신') && !/열리지/.test(included(items)[0].warning || '')],
    ['본인 연차', '저 11/2~11/3 연차예요. 급한 일은 학년부장님께 부탁드려요.', (items) => items.length >= 1 && items.every((item) => item.include === false) && items.some((item) => item.date === '2026-11-02' && item.end === '2026-11-03' && /업무로 볼 말이 없어/.test(item.warning)) && !quietCard(items)],
    ['교감 출장', '11/4(수) 교감 선생님 출장, 결재는 교장실로', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-04' && included(items)[0].title.includes('출장')],
    ['수학여행 유지', '6학년 수학여행 11/4~11/6', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-04' && included(items)[0].end === '2026-11-06' && included(items)[0].title.includes('수학여행')],
    ['작년 담당 선생님', '작년 6학년 담당 선생님은 11/10(화)까지 졸업생 자료 넘겨 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-10' && !items.some((item) => String(item.date).startsWith('2025'))],
    ['작년 담당자', '작년 학급 회계 담당자는 10/30(금)까지 정산서 제출 바랍니다.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-10-30' && included(items)[0].title.includes('정산서')],
    ['작년 자료', '작년 자료 참고해서 11/16(월)까지 계획서 내 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-16' && included(items)[0].title.includes('계획서')],
    ['작년엔 제목', '작년엔 11/13이었는데 올해 수능 감독 회의는 11/12(목) 오후 4시입니다.', (items) => yellowDated(items, '2025-11-13') && included(items).some((item) => item.kind === '일정' && item.date === '2026-11-12' && item.time === '16:00' && item.title === '수능 감독 회의') && !items.some((item) => /엔/.test(item.title))],
    ['마지막 날', '이번 달 마지막 날까지 출장 복명서 제출', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-31' && items[0].include !== false && items[0].title.includes('복명서') && items[0].title.includes('제출') && !/대략/.test(items[0].warning || '')],
    ['이니 원고', '독후감 대회 접수 기간 11/2(월)~11/6(금)이니 원고 내 주세요.', (items) => items.some((item) => item.kind === '일정' && item.date === '2026-11-02' && item.end === '2026-11-06' && item.include !== false) && items.some((item) => item.kind === '할 일' && item.date === '2026-11-06' && item.include !== false && item.title === '원고 제출')],
];
let r33Ok = 0;
r33Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r33Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
});
if (r33Ok !== r33Cases.length) {
    console.error(`r33 원문 ${r33Ok}/${r33Cases.length}`);
    process.exit(1);
}
console.log(`r33 원문 ${r33Ok}/${r33Cases.length}`);

const thisYear = (items, date) => included(items).some((item) => item.date === date) && !items.some((item) => String(item.date).startsWith('2025') || String(item.date).startsWith('2024'));
const keptOut = (items) => items.length >= 1 && items.every((item) => item.include === false) && !quietCard(items);
const r34Cases = [
    ['작년 수상 명단', '작년 수상 학생 명단 11/10(화)까지 제출해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-10' && included(items)[0].title.includes('제출')],
    ['작년 행사 사진', '작년 행사 사진 11/5(목)까지 올려 주세요.', (items) => thisYear(items, '2026-11-05') && included(items)[0].kind === '할 일'],
    ['작년 졸업 앨범', '작년 졸업생 앨범 11/13(금) 배부합니다.', (items) => thisYear(items, '2026-11-13') && included(items).some((item) => item.title.includes('앨범'))],
    ['작년보다 일찍', '작년보다 일찍, 11/6(금)까지 학급 문집 원고 제출 바랍니다.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-06' && included(items)[0].title.includes('문집')],
    ['작년 비품', '작년 학급 비품 목록 10/30(금)까지 정리해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-10-30' && included(items)[0].title.includes('비품')],
    ['작년 결과 보고서', '작년 결과 보고서 바탕으로 11/16(월)까지 계획서 작성', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-16' && included(items)[0].title.includes('계획서')],
    ['작년 공유회', '작년 우수 사례 공유회 11/19(목) 오후 3시', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-19' && included(items)[0].time === '15:00' && included(items)[0].title.includes('공유회')],
    ['작년의 교훈', '작년의 교훈을 살려 11/4(수)까지 안전 점검표 제출', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-04' && included(items)[0].title.includes('점검')],
    ['작년 문집 원고', '작년 학급 문집 11/2(월)까지 원고를 모아 주세요.', (items) => thisYear(items, '2026-11-02')],
    ['지난해 합창', '지난해 교내 합창 11/18(수) 오후 2시 연습', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-18' && item.time === '14:00' && item.title.includes('합창'))],
    ['재작년 수상 기록', '재작년 수상 기록 11/6(금)까지 정리 바랍니다.', (items) => thisYear(items, '2026-11-06') && included(items).some((item) => item.title.includes('정리'))],
    ['작년보다 회신', '작년보다 하루 일찍 11/12(목)까지 가정통신문 회신', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-12' && included(items)[0].title.includes('회신')],
    ['바로 작년 소풍', '작년 11월 10일 소풍이었습니다.', (items) => yellowDated(items, '2025-11-10') && keptOut(items)],
    ['바로 작년에', '작년에 11/4(수) 현장학습 사진입니다.', (items) => yellowDated(items, '2025-11-04') && keptOut(items)],
    ['바로 지난해에는', '지난해에는 10/28 공개수업이었습니다.', (items) => yellowDated(items, '2025-10-28') && keptOut(items)],
    ['바로 재작년', '재작년 11/6 운동회 사진 공유합니다.', (items) => yellowDated(items, '2024-11-06') && keptOut(items)],
    ['바로 작년에는 소풍', '작년에는 10/30 소풍이었습니다', (items) => yellowDated(items, '2025-10-30') && keptOut(items)],
    ['바로 작년에도', '작년에도 11/19에 했었죠.', (items) => yellowDated(items, '2025-11-19') && keptOut(items)],
    ['바로 지난해 날짜', '지난해 11월 5일 현장학습', (items) => yellowDated(items, '2025-11-05') && keptOut(items)],
    ['바로 재작년 봄', '재작년 5월 8일 현장학습', (items) => yellowDated(items, '2024-05-08') && keptOut(items)],
    ['바로 작년 사진', '작년 10/30 현장학습 사진입니다', (items) => yellowDated(items, '2025-10-30') && keptOut(items)],
    ['바로 작년 체육', '작년 11/20 체육대회 사진 공유합니다.', (items) => yellowDated(items, '2025-11-20') && keptOut(items)],
    ['바로 작년 마감', '작년 11/6(금)까지 자료를 제출해 주세요.', (items) => yellowDated(items, '2025-11-06') && keptOut(items)],
    ['바로 작년엔', '작년엔 11/13이었는데 올해 수능 감독 회의는 11/12(목) 오후 4시입니다.', (items) => yellowDated(items, '2025-11-13') && included(items).some((item) => item.date === '2026-11-12' && item.title === '수능 감독 회의')],
    ['불참 회신', '참석하지 못하시는 분은 11/5(목)까지 회신 부탁드립니다.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-05' && included(items)[0].title.includes('회신') && !/열리지/.test(included(items)[0].warning || '')],
    ['불참 않습니다', '참석하지 않으시는 분은 11/6(금)까지 회신해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-06' && included(items)[0].title.includes('회신')],
    ['출석 못', '출석하지 못하시는 선생님은 11/3(화)까지 회신 바랍니다.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-03' && included(items)[0].title.includes('회신')],
    ['참가 못', '참가하지 못하시는 학부모는 11/10(화)까지 연락 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-10'],
    ['오시지 못', '오시지 못하는 분은 11/12(목)까지 회신해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-12' && included(items)[0].title.includes('회신')],
    ['불참 분', '불참하시는 분은 11/7(토)까지 회신 부탁드립니다.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-07' && included(items)[0].title.includes('회신')],
    ['잊지 못하게 유지', '내일까지 잊지 못하게 제출해 주세요', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-10-23'],
    ['빠지지 말고 유지', '11/5(목) 교직원 연수는 빠지지 말고 참석해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-05'],
    ['빠짐없이 유지', '11/14(토) 학교 축제는 빠짐없이 열립니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-14'],
    ['취소하지 않습니다 유지', '비가 와도 취소하지 않습니다. 11/14(토) 학교 축제 그대로 합니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-14' && item.title.includes('축제'))],
    ['못 오시는 회신 유지', '11/4(수)까지 못 오시는 학부모님은 회신', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-04' && included(items)[0].title.includes('회신')],
    ['조회 없습니다 유지', '11/6(금) 전교 조회는 없습니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-06'],
    ['실시하지 못', '11/18(수) 학예회는 실시하지 못합니다.', (items) => yellowDated(items, '2026-11-18') && keptOut(items)],
    ['개최하지 못', '11/9(월) 현장체험학습은 개최하지 못하게 되었습니다.', (items) => yellowDated(items, '2026-11-09') && keptOut(items)],
    ['진행이 어렵습니다', '11/17(화) 학부모 설명회는 진행이 어렵습니다.', (items) => yellowDated(items, '2026-11-17') && keptOut(items)],
    ['진행하지 않기로', '11/3(화) 공개수업은 진행하지 않기로 했습니다.', (items) => yellowDated(items, '2026-11-03') && keptOut(items)],
    ['무산입니다', '10/30(금) 소풍은 무산입니다.', (items) => yellowDated(items, '2026-10-30') && keptOut(items)],
    ['열리지 않습니다', '11/21(토) 입학설명회는 열리지 않습니다.', (items) => yellowDated(items, '2026-11-21') && keptOut(items)],
    ['하지 못하게', '11/6(금) 운동회는 하지 못하게 됐어요.', (items) => yellowDated(items, '2026-11-06') && keptOut(items)],
    ['열리지 못합니다', '11월 20일(금) 교직원 체육대회가 열리지 못합니다.', (items) => yellowDated(items, '2026-11-20') && keptOut(items)],
    ['열리지 못하게', '11월 6일(금) 학년 체육대회는 열리지 못하게 되었습니다.', (items) => yellowDated(items, '2026-11-06') && keptOut(items)],
    ['취소되었습니다', '11/20(금) 체육대회는 취소되었습니다.', (items) => yellowDated(items, '2026-11-20') && keptOut(items)],
    ['안 합니다', '10/30 체육대회 안 합니다', (items) => yellowDated(items, '2026-10-30') && keptOut(items)],
    ['진행이 어렵게', '다음주 화요일 현장학습은 진행이 어렵게 되었습니다.', (items) => yellowDated(items, '2026-10-27') && keptOut(items)],
    ['휴가 마감 안내', '제가 안내드린 11/4(수) 휴가 신청 마감일 잊지 마세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-04' && !/업무로 볼 말/.test(included(items)[0].warning || '')],
    ['출장 연수 신청', '저도 참석하는 11/11(수) 출장 연수, 신청 11/3(화)까지예요.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-11' && item.title === '연수') && included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-03' && item.title === '연수 신청서 제출') && !items.some((item) => item.title === '출장 연수' || /예요/.test(item.title))],
    ['저도 연수', '저도 참석하는 11/5(목) 교직원 연수입니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-05' && included(items)[0].title.includes('연수')],
    ['출장 복명', '제가 올린 11/6(금)까지 출장 복명서 제출해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-06' && included(items)[0].title.includes('복명서')],
    ['인솔', '저는 11/12(목) 현장학습 인솔합니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-12' && included(items)[0].title.includes('현장학습')],
    ['연차 계획', '11/10(화)까지 연차 사용 계획 제출해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-10' && included(items)[0].title.includes('연차')],
    ['병가 대체', '제가 안내한 11/13(금) 병가 대체 수업 시간표 확인해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-13' && !/업무로 볼 말/.test(included(items)[0].warning || '')],
    ['직무 연수', '저도 신청한 11/19(목) 직무 연수입니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-19' && included(items)[0].title.includes('연수')],
    ['교감 출장', '11/4(수) 교감 선생님 출장, 결재는 교장실로', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-04' && included(items)[0].title.includes('출장')],
    ['수학여행', '6학년 수학여행 11/4~11/6', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-04' && included(items)[0].end === '2026-11-06'],
    ['휴가 신청서', '제가 공유한 11/6(금)까지 휴가 신청서 제출해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-06' && included(items)[0].title.includes('신청서')],
    ['듣는 연수', '저도 듣는 11/20(금) 오후 2시 직무 연수', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-20' && item.time === '14:00' && item.title.includes('연수'))],
    ['본인 병가', '제가 11/6(금) 병가예요.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-06' && included(items)[0].title === '병가'],
    ['본인 휴가', '저는 11/9(월) 휴가입니다.', (items) => keptOut(items) && items.some((item) => item.date === '2026-11-09')],
    ['본인 조퇴', '저 내일 조퇴예요.', (items) => keptOut(items) && items.some((item) => item.date === '2026-10-23')],
    ['본인 출장', '제가 11/13(금) 출장 갑니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-13' && included(items)[0].title.includes('출장')],
    ['본인 연차 기간', '저는 11/16(월)~11/17(화) 연차입니다.', (items) => keptOut(items) && items.some((item) => item.date === '2026-11-16' && item.end === '2026-11-17')],
    ['본인 여행', '저 11/4(수) 여행 가요.', (items) => keptOut(items) && items.some((item) => item.date === '2026-11-04')],
    ['본인 병가 화요일', '제가 다음주 화요일 병가 갑니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-10-27' && included(items)[0].title === '병가'],
    ['본인 조퇴 금', '저는 10/30(금) 조퇴합니다.', (items) => keptOut(items) && items.some((item) => item.date === '2026-10-30')],
    ['본인 휴가 부탁', '저 11/20(금) 휴가예요. 결재는 학년부에 부탁드려요.', (items) => keptOut(items) && items.some((item) => item.date === '2026-11-20' && /업무로 볼 말/.test(item.warning))],
    ['본인 연차 쓸게', '제가 11/11(수) 연차 쓸게요.', (items) => keptOut(items) && items.some((item) => item.date === '2026-11-11')],
    ['본인 연차 범위', '저 11/2~11/3 연차예요. 급한 일은 학년부장님께 부탁드려요.', (items) => keptOut(items) && items.some((item) => item.date === '2026-11-02' && item.end === '2026-11-03')],
    ['제주 잡담', '저 10/24~10/25 제주도 가요~ 귤 사올게요', (items) => keptOut(items) && items.some((item) => item.date === '2026-10-24' && /업무로 볼 말/.test(item.warning))],
];
const r34Groups = {
    yearIn: r34Cases.slice(0, 12),
    yearOut: r34Cases.slice(12, 24),
    cancelIn: r34Cases.slice(24, 36),
    cancelOut: r34Cases.slice(36, 48),
    selfIn: r34Cases.slice(48, 60),
    selfOut: r34Cases.slice(60, 72),
};
Object.entries(r34Groups).forEach(([name, rows]) => {
    if (rows.length < 10) {
        console.error(`r34 ${name} 변형이 10개보다 적습니다.`);
        process.exit(1);
    }
});
let r34Ok = 0;
r34Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r34Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
});
if (r34Ok !== r34Cases.length) {
    console.error(`r34 원문 ${r34Ok}/${r34Cases.length}`);
    process.exit(1);
}
console.log(`r34 원문 ${r34Ok}/${r34Cases.length}`);

const r35Cases = [
    ['작년 올해 대비', '작년 학예회는 11/10, 올해는 11/19(목) 강당에서 합니다.', (items) => yellowDated(items, '2025-11-10') && included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-19' && included(items)[0].title.includes('학예회')],
    ['작년 학예회 과거', '작년 학예회는 11/10 강당에서 했습니다.', (items) => yellowDated(items, '2025-11-10') && included(items).length === 0],
    ['본인 휴가라서', '제가 11/11(수) 휴가라서 회의 자료는 미리 올려 둘게요.', (items) => items.some((item) => item.date === '2026-11-11' && item.include === false) && included(items).length === 0],
    ['본인 연차 쓰는', '제가 연차 쓰는 11/20(금)에는 교감 선생님이 대신 진행하십니다.', (items) => items.some((item) => item.date === '2026-11-20' && item.include === false) && included(items).length === 0],
    ['본인 출장이라', '제가 다음주 화요일 출장이라 수업 교환 부탁드려요.', (items) => items.some((item) => item.date === '2026-10-27' && item.include === false) && included(items).length === 0],
    ['복명서 공유', '제가 11/5(목) 출장 복명서 양식 공유드렸어요. 11/9(월)까지 제출 바랍니다.', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-11-09' && items[0].include !== false && items[0].title.includes('복명서') && items[0].title.includes('제출') && !items.some((item) => item.date === '2026-11-05')],
    ['안내 마감 유지', '제가 안내드린 11/4(수) 휴가 신청 마감일 잊지 마세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-04' && included(items)[0].title === '휴가 신청 마감' && !/제가|안내|잊지/.test(included(items)[0].title)],
    ['출장 연수 유지', '저도 참석하는 11/11(수) 출장 연수, 신청 11/3(화)까지예요.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-11' && item.title === '연수') && included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-03' && item.title === '연수 신청서 제출') && !items.some((item) => item.title === '출장 연수')],
    ['작년보다 박람회', '작년보다 인원이 늘어 11/12(목) 진로 박람회는 체육관에서 합니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-12' && included(items)[0].title === '진로 박람회'],
];
let r35Ok = 0;
r35Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r35Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
});
if (r35Ok !== r35Cases.length) {
    console.error(`r35 원문 ${r35Ok}/${r35Cases.length}`);
    process.exit(1);
}
console.log(`r35 원문 ${r35Ok}/${r35Cases.length}`);

const pastOut = (items, date) => yellowDated(items, date) && keptOut(items);
const absentOn = (items, date) => items.some((item) => item.date === date && item.include === false) && included(items).length === 0;
const fairPair = (items, eventDate, dueDate, eventTitle, dueTitle) => included(items).some((item) => item.kind === '일정' && item.date === eventDate && item.title === eventTitle)
    && included(items).some((item) => item.kind === '할 일' && item.date === dueDate && item.title === dueTitle)
    && !items.some((item) => String(item.date || '').startsWith('2025') || String(item.date || '').startsWith('2024'));
const r36Cases = [
    ['작년 체육대회', '작년 체육대회는 11/6에 운동장에서 열었습니다.', (items) => pastOut(items, '2025-11-06')],
    ['지난해 독서 축제', '지난해 독서 축제는 11/13 도서관에서 진행됐어요.', (items) => pastOut(items, '2025-11-13')],
    ['작년 총회 자료', '작년 2학기 학부모 총회 11/3 자료 참고하세요.', (items) => pastOut(items, '2025-11-03')],
    ['작년 수련회 사진', '작년 우리 학년 수련회 11/9 사진 올립니다.', (items) => pastOut(items, '2025-11-09')],
    ['지난해 운동회', '지난해 운동회는 10/30에 운동장에서 열렸어요.', (items) => pastOut(items, '2025-10-30')],
    ['작년 학예회 진행', '작년 학예회는 11/19 강당에서 진행되었습니다.', (items) => pastOut(items, '2025-11-19')],
    ['지난해 사진 참고', '지난해 현장학습 11/5 사진은 참고하세요.', (items) => pastOut(items, '2025-11-05')],
    ['작년 축제 사진', '작년 축제 사진은 11/12에 올립니다.', (items) => included(items).some((item) => item.date === '2026-11-12') && !items.some((item) => String(item.date).startsWith('2025'))],
    ['재작년 수련회', '재작년 수련회는 5/8에 다녀왔습니다.', (items) => pastOut(items, '2024-05-08')],
    ['지난 해 설명회', '지난 해 입학 설명회는 11/21에 강당에서 열렸습니다.', (items) => pastOut(items, '2025-11-21')],
    ['올해 제출 유지', '지난해 안전 점검 결과를 11/24(화)까지 제출 바랍니다.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-24' && included(items)[0].title.includes('점검')],
    ['시각 유지', '작년 교내 합창 연습은 11/18(수) 오후 2시입니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-18' && item.time === '14:00' && item.include !== false)],
    ['본인 연가라', '저는 11/12(목) 연가라 그날 협의회는 빠집니다.', (items) => absentOn(items, '2026-11-12')],
    ['본인 출장 이어서', '제가 11/6(금) 출장이어서 결재는 월요일에 할게요.', (items) => absentOn(items, '2026-11-06')],
    ['본인 연가입니다', '저는 11/20(금) 연가입니다. 그날은 비웁니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-20' && included(items)[0].title === '연가'],
    ['본인 외출이라', '제가 10/30(금) 외출이라 수업은 바꿔 두었습니다.', (items) => absentOn(items, '2026-10-30')],
    ['본인 공가여서', '저 11/4(수) 공가여서 결재는 내일 할게요.', (items) => absentOn(items, '2026-11-04')],
    ['본인 병가인', '저는 11/18(수) 병가인 날이라 협의회에 못 갑니다.', (items) => absentOn(items, '2026-11-18')],
    ['본인 조퇴라서', '제가 다음주 월요일 조퇴라서 오후 회의는 빠질게요.', (items) => absentOn(items, '2026-10-26')],
    ['본인 연가 이라서', '저는 11/27(금) 연가이라서 당직을 비웁니다.', (items) => absentOn(items, '2026-11-27')],
    ['외출 신청 유지', '제가 안내드린 11/17(화) 외출 신청 마감 잊지 마세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-17' && included(items)[0].title.includes('외출 신청') && !/제가|안내|잊지/.test(included(items)[0].title)],
    ['박람회 참가', '작년보다 규모가 커진 11/26(목) 진로 박람회 참가 신청 11/20(금)까지.', (items) => fairPair(items, '2026-11-26', '2026-11-20', '진로 박람회', '진로 박람회 참가 신청')],
    ['과학 박람회', '지난해보다 커진 11/27(금) 과학 박람회 참가 신청 11/18(수)까지 받습니다.', (items) => fairPair(items, '2026-11-27', '2026-11-18', '과학 박람회', '과학 박람회 참가 신청')],
    ['설명회 신청은', '11/24(화) 학부모 설명회 참가 신청은 11/13(금)까지입니다.', (items) => fairPair(items, '2026-11-24', '2026-11-13', '학부모 설명회', '학부모 설명회 참가 신청')],
    ['박람회 접수', '재작년보다 붐비던 11/19(목) 진로 박람회 접수 11/12(목)까지 바랍니다.', (items) => fairPair(items, '2026-11-19', '2026-11-12', '진로 박람회', '진로 박람회 접수')],
    ['축제 신청을', '작년처럼 11/21(토) 독서 축제 참가 신청을 11/14(토)까지 해 주세요.', (items) => fairPair(items, '2026-11-21', '2026-11-14', '독서 축제', '독서 축제 참가 신청')],
    ['참여 신청', '11/28(토) 체험 박람회 참여 신청 11/17(화)까지예요.', (items) => fairPair(items, '2026-11-28', '2026-11-17', '체험 박람회', '체험 박람회 참여 신청')],
];
const r36Groups = {
    past: r36Cases.slice(0, 12),
    absence: r36Cases.slice(12, 21),
    fair: r36Cases.slice(21),
};
Object.entries(r36Groups).forEach(([name, rows]) => {
    const floor = name === 'fair' ? 6 : 7;
    if (rows.length < floor) {
        console.error(`r36 ${name} 변형이 ${floor}개보다 적습니다.`);
        process.exit(1);
    }
});
let r36Ok = 0;
r36Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r36Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
});
if (r36Ok !== r36Cases.length) {
    console.error(`r36 원문 ${r36Ok}/${r36Cases.length}`);
    process.exit(1);
}
console.log(`r36 원문 ${r36Ok}/${r36Cases.length}`);

const keptThisYear = (items, date) => included(items).some((item) => item.kind === '일정' && item.date === date) && !items.some((item) => String(item.date || '').startsWith('2025') || String(item.date || '').startsWith('2024'));
const daySpan = (items, date, end, title) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === date && included(items)[0].end === end && included(items)[0].title.includes(title);
const r37Cases = [
    ['영상 봅니다', '작년 학예회 영상은 11/10(화) 학년 회의에서 같이 봅니다.', (items) => keptThisYear(items, '2026-11-10')],
    ['결과 공유합니다', '작년도 학교폭력 실태조사 결과는 11/4(수) 회의에서 공유합니다.', (items) => keptThisYear(items, '2026-11-04')],
    ['강연 교시입니다', '작년 졸업생 초청 강연 11/26(목) 5교시입니다.', (items) => keptThisYear(items, '2026-11-26')],
    ['명단 확인합니다', '작년 수상자 명단은 11/16(월) 회의 때 확인합니다.', (items) => keptThisYear(items, '2026-11-16')],
    ['체험학습 갑니다', '작년에 못 간 체험학습을 11/19(목)에 갑니다.', (items) => keptThisYear(items, '2026-11-19')],
    ['멘토링 진행합니다', '작년 졸업생 멘토링 11/25(수) 6교시에 진행합니다.', (items) => keptThisYear(items, '2026-11-25')],
    ['협의회 합니다', '작년 담임 선생님들과 11/12(목) 협의회 합니다.', (items) => keptThisYear(items, '2026-11-12')],
    ['영상 봐요', '지난해 학예회 영상을 11/17(화) 학년 회의에서 봐요.', (items) => keptThisYear(items, '2026-11-17')],
    ['결과 공유해요', '재작년 실태조사 결과는 11/6(금) 직원 회의에서 공유해요.', (items) => keptThisYear(items, '2026-11-06')],
    ['강연 교시', '작년 졸업생 강연은 11/27(금) 3교시입니다.', (items) => keptThisYear(items, '2026-11-27')],
    ['명단 확인해요', '지난해 수상자 명단을 11/20(금) 회의 때 확인해요.', (items) => keptThisYear(items, '2026-11-20')],
    ['현장학습 갑니다', '작년에 못 본 현장학습을 11/13(금)에 갑니다.', (items) => keptThisYear(items, '2026-11-13')],
    ['조퇴하고', '저는 11/9(월) 조퇴하고 병원 갑니다.', (items) => absentOn(items, '2026-11-09')],
    ['휴가니까', '저 다음주 수요일 휴가니까 급한 건 미리 주세요.', (items) => absentOn(items, '2026-10-28')],
    ['연가하고', '제가 11/13(금) 연가하고 집에 있습니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-13' && included(items)[0].title === '연가'],
    ['병가고', '저는 11/18(수) 병가고 오전에 쉽니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-18' && included(items)[0].title === '병가'],
    ['외출이니까', '제가 11/11(수) 외출이니까 오후에 돌아옵니다.', (items) => absentOn(items, '2026-11-11')],
    ['공가라서요', '저 11/4(수) 공가라서요.', (items) => absentOn(items, '2026-11-04')],
    ['조퇴니', '저는 11/25(수) 조퇴니 수업은 바꿉니다.', (items) => absentOn(items, '2026-11-25')],
    ['경시 마감', '11/27(금) 수학 경시대회 참가 접수 11/13(금) 마감.', (items) => fairPair(items, '2026-11-27', '2026-11-13', '수학 경시대회', '수학 경시대회 참가 접수')],
    ['과학 경시 마감', '11/26(목) 과학 경시대회 참가 접수는 11/12(목) 마감입니다.', (items) => fairPair(items, '2026-11-26', '2026-11-12', '과학 경시대회', '과학 경시대회 참가 접수')],
    ['독서 접수 마감', '11/21(토) 독서 대회 접수 마감은 11/14(토)입니다.', (items) => fairPair(items, '2026-11-21', '2026-11-14', '독서 대회', '독서 대회 접수')],
    ['까지 접수', '11/19(목) 영어 말하기 대회 11/6(금)까지 접수.', (items) => fairPair(items, '2026-11-19', '2026-11-06', '영어 말하기 대회', '영어 말하기 대회 접수')],
    ['경시 신청 마감', '11/28(토) 수학 경시대회 신청 11/18(수) 마감.', (items) => fairPair(items, '2026-11-28', '2026-11-18', '수학 경시대회', '수학 경시대회 신청')],
    ['박람회 접수 마감', '11/24(화) 체험 박람회 참가 접수 11/10(화) 마감.', (items) => fairPair(items, '2026-11-24', '2026-11-10', '체험 박람회', '체험 박람회 참가 접수')],
    ['이틀 체육대회', '11/2(월)과 11/3(화) 이틀간 교내 체육대회를 합니다.', (items) => daySpan(items, '2026-11-02', '2026-11-03', '교내 체육대회') && included(items)[0].title === '교내 체육대회'],
    ['이틀 과학 축제', '11/5(목)와 11/6(금) 이틀간 과학 축제를 합니다.', (items) => daySpan(items, '2026-11-05', '2026-11-06', '과학 축제')],
    ['이틀 학예회', '11/9(월)과 11/10(화) 이틀 동안 학예회를 엽니다.', (items) => daySpan(items, '2026-11-09', '2026-11-10', '학예회')],
    ['양일 독서', '11/16(월)과 11/17(화) 양일간 독서 행사를 진행합니다.', (items) => daySpan(items, '2026-11-16', '2026-11-17', '독서 행사')],
    ['이틀 현장학습', '11/19(목)와 11/20(금) 이틀간 현장학습을 갑니다.', (items) => daySpan(items, '2026-11-19', '2026-11-20', '현장학습')],
    ['이틀 체육 합니다', '11/26(목)과 11/27(금) 이틀간 교내 체육대회 합니다.', (items) => daySpan(items, '2026-11-26', '2026-11-27', '교내 체육대회')],
];
const r37Groups = {
    tense: r37Cases.slice(0, 12),
    absence: r37Cases.slice(12, 19),
    deadline: r37Cases.slice(19, 25),
    span: r37Cases.slice(25),
};
Object.entries(r37Groups).forEach(([name, rows]) => {
    if (rows.length < 6) {
        console.error(`r37 ${name} 변형이 6개보다 적습니다.`);
        process.exit(1);
    }
});
let r37Ok = 0;
r37Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r37Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
});
if (r37Ok !== r37Cases.length) {
    console.error(`r37 원문 ${r37Ok}/${r37Cases.length}`);
    process.exit(1);
}
console.log(`r37 원문 ${r37Ok}/${r37Cases.length}`);

const yellowCard = (items, date) => items.some((item) => item.date === date && item.include === false && item.low === true && item.warning);
const dueTodo = (items, date, title) => included(items).some((item) => item.kind === '할 일' && item.date === date && item.title === title);
const sameEvents = (items, dates, title) => dates.every((date) => included(items).some((item) => item.kind === '일정' && item.date === date && item.title === title && !item.title.includes('일정')))
    && included(items).filter((item) => item.title === title).length === dates.length;
const r38Cases = [
    ['영상 링크 첨부', '지난해 학예회(11/18) 영상 링크 첨부합니다.', (items) => pastOut(items, '2025-11-18')],
    ['영상입니다', '작년 학예회(11/12) 영상입니다.', (items) => pastOut(items, '2025-11-12')],
    ['작년처럼 했어요', '작년처럼 11/11 강당에서 했어요.', (items) => pastOut(items, '2025-11-11')],
    ['짧은 학예회', '작년 학예회 11/11.', (items) => yellowCard(items, '2026-11-11') && included(items).length === 0],
    ['공유회 시각 유지', '작년 우수 사례 공유회 11/19(목) 오후 3시', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-19' && included(items)[0].time === '15:00'],
    ['강연 교시 유지', '작년 졸업생 초청 강연 11/26(목) 5교시입니다.', (items) => keptThisYear(items, '2026-11-26')],
    ['사진첩 첨부', '지난해 축제(11/6) 사진첩을 첨부합니다.', (items) => pastOut(items, '2025-11-06')],
    ['자료집입니다', '작년 수련회(11/9) 자료집입니다.', (items) => pastOut(items, '2025-11-09')],
    ['파일 링크', '재작년 학예회(5/8) 파일 링크입니다.', (items) => pastOut(items, '2024-05-08')],
    ['작년보다 했어요', '작년보다 11/13 체육관에서 했어요.', (items) => pastOut(items, '2025-11-13')],
    ['작년처럼 합니다', '작년처럼 11/19 강당에서 합니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-19' && !String(included(items)[0].title).includes('일정')],
    ['짧은 축제', '작년 축제 11/21.', (items) => yellowCard(items, '2026-11-21') && included(items).length === 0],
    ['신청 마감', '신청 마감 11/16', (items) => dueTodo(items, '2026-11-16', '신청 마감')],
    ['마감 앞', '마감 11/16', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-16' && included(items)[0].title.includes('마감')],
    ['마감 뒤', '11/16 마감', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-16' && included(items)[0].title.includes('마감')],
    ['까지 접수', '11/16까지 접수', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-16' && included(items)[0].title.includes('접수')],
    ['설문 마감 안내', '11/20(금) 마감인 설문은 11/13(금)에 안내합니다.', (items) => dueTodo(items, '2026-11-20', '설문 마감') && included(items).some((item) => item.kind === '일정' && item.date === '2026-11-13' && item.title === '설문 안내')],
    ['체험 신청 마감', '체험학습 신청 마감 11/18(수)입니다.', (items) => included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-18' && item.title.includes('신청') && item.title.includes('마감'))],
    ['독후감 마감', '독후감 마감은 11/6(금)입니다.', (items) => included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-06' && item.title.includes('독후감') && item.title.includes('마감'))],
    ['참가 접수', '11/27(금)까지 참가 접수합니다.', (items) => included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-27' && item.title.includes('접수'))],
    ['가정통신문 안내', '11/25(수) 마감인 가정통신문은 11/18(수)에 안내합니다.', (items) => dueTodo(items, '2026-11-25', '가정통신문 마감') && included(items).some((item) => item.kind === '일정' && item.date === '2026-11-18' && item.title === '가정통신문 안내')],
    ['남의 출장 마감', '김 선생님은 11/9(월) 출장이고 회신 마감은 11/13(금)입니다.', (items) => dueTodo(items, '2026-11-13', '회신 마감') && !items.some((item) => item.date === '2026-11-09')],
    ['남의 연차 마감', '박 선생님은 11/4(수) 연차이고 설문 마감은 11/11(수)입니다.', (items) => dueTodo(items, '2026-11-11', '설문 마감') && !items.some((item) => item.date === '2026-11-04')],
    ['점 수련회', '11/5(목)·11/6(금) 이틀간 수련회를 갑니다.', (items) => daySpan(items, '2026-11-05', '2026-11-06', '수련회') && included(items)[0].title === '수련회'],
    ['쉼표 수학여행', '11/9(월), 11/10(화) 이틀간 수학여행을 갑니다.', (items) => daySpan(items, '2026-11-09', '2026-11-10', '수학여행') && !included(items)[0].title.includes('일정')],
    ['와 학예회', '11/16(월)와 11/17(화) 양일간 학예회를 합니다.', (items) => daySpan(items, '2026-11-16', '2026-11-17', '학예회') && !included(items)[0].title.includes('일정')],
    ['점 체험학습', '11/19(목)·11/21(토) 3일간 체험학습을 갑니다.', (items) => daySpan(items, '2026-11-19', '2026-11-21', '체험학습') && included(items)[0].title === '체험학습'],
    ['두 차례 연수', '11/12(목)과 11/19(목) 두 차례 연수를 합니다.', (items) => sameEvents(items, ['2026-11-12', '2026-11-19'], '연수')],
    ['두 차례 공개수업', '11/6(금)과 11/13(금) 두 차례 공개수업을 합니다.', (items) => sameEvents(items, ['2026-11-06', '2026-11-13'], '공개수업')],
    ['각각 협의회', '11/4(수), 11/18(수) 각각 협의회를 합니다.', (items) => sameEvents(items, ['2026-11-04', '2026-11-18'], '협의회')],
    ['두 차례 설명회', '11/20(금)과 11/27(금) 두 차례 설명회를 합니다.', (items) => sameEvents(items, ['2026-11-20', '2026-11-27'], '설명회')],
];
const r38Groups = {
    year: r38Cases.slice(0, 12),
    due: r38Cases.slice(12, 23),
    span: r38Cases.slice(23, 30),
};
Object.entries(r38Groups).forEach(([name, rows]) => {
    if (rows.length < 6) {
        console.error(`r38 ${name} 변형이 6개보다 적습니다.`);
        process.exit(1);
    }
});
let r38Ok = 0;
r38Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r38Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
});
if (r38Ok !== r38Cases.length) {
    console.error(`r38 원문 ${r38Ok}/${r38Cases.length}`);
    process.exit(1);
}
console.log(`r38 원문 ${r38Ok}/${r38Cases.length}`);

const noDate = (items, date) => !items.some((item) => item.date === date);
const closedCard = (items) => included(items).length === 0 && items.length === 1 && items[0].include === false && items[0].low === true && items[0].warning;
const eventOn = (items, date, title) => included(items).some((item) => item.kind === '일정' && item.date === date && item.title === title);
const r39Cases = [
    ['H1 대회 마감', '11/26(목) 과학 탐구 대회, 신청 마감 11/16(월).', (items) => eventOn(items, '2026-11-26', '과학 탐구 대회') && dueTodo(items, '2026-11-16', '과학 탐구 대회 신청 마감')],
    ['H2 마감은', '11/27(금) 독서 대회, 신청 마감은 11/13(금)입니다.', (items) => eventOn(items, '2026-11-27', '독서 대회') && dueTodo(items, '2026-11-13', '독서 대회 신청 마감')],
    ['K3 접수 마감', '접수는 11/9(월) 마감, 발표는 11/16(월)입니다.', (items) => dueTodo(items, '2026-11-09', '접수 마감') && eventOn(items, '2026-11-16', '발표')],
    ['K4 시각 마감', '11/20(금) 18시 마감, 결과 발표 11/27(금).', (items) => included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-20' && item.time === '18:00' && item.title === '18시 마감') && eventOn(items, '2026-11-27', '결과 발표') && !included(items).some((item) => item.title === '결과 발표 마감' || item.title === '마감')],
    ['K6 마감됨', '11/25(수) 학부모 연수는 마감되었습니다.', (items) => closedCard(items)],
    ['참가 신청 마감', '11/19(목) 영어 말하기 대회, 참가 신청 마감 11/6(금).', (items) => eventOn(items, '2026-11-19', '영어 말하기 대회') && dueTodo(items, '2026-11-06', '영어 말하기 대회 참가 신청 마감')],
    ['접수 발표', '접수는 11/6(금) 마감, 발표는 11/13(금)입니다.', (items) => dueTodo(items, '2026-11-06', '접수 마감') && eventOn(items, '2026-11-13', '발표')],
    ['15시 마감', '11/18(수) 15시 마감, 결과 발표 11/25(수).', (items) => included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-18' && item.time === '15:00' && item.title === '15시 마감') && eventOn(items, '2026-11-25', '결과 발표') && !included(items).some((item) => item.title === '결과 발표 마감' || item.title === '마감')],
    ['마감됐습니다', '11/12(목) 현장학습은 마감됐습니다.', (items) => closedCard(items)],
    ['독후감 신청', '독후감 신청 마감은 11/9(월)입니다.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-09' && included(items)[0].title.includes('독후감') && included(items)[0].title.includes('신청') && included(items)[0].title.includes('마감')],
    ['마감은 단독', '마감은 11/16(월)입니다.', (items) => dueTodo(items, '2026-11-16', '마감')],
    ['G4 부장 출장', '부장님이 11/12(목) 출장 가니까 보고서는 11/11(수)까지 주세요.', (items) => dueTodo(items, '2026-11-11', '보고서 제출') && items.length === 1 && noDate(items, '2026-11-12')],
    ['B7 교감 출장', '11/4(수) 교감 선생님 출장, 결재 마감 11/6(금).', (items) => dueTodo(items, '2026-11-06', '결재 마감') && items.length === 1 && noDate(items, '2026-11-04')],
    ['담임 조퇴', '11/12(목) 담임 선생님 조퇴, 알림장 11/11(수)까지 제출', (items) => dueTodo(items, '2026-11-11', '알림장 제출') && items.length === 1 && noDate(items, '2026-11-12')],
    ['선생님 휴가', '김 선생님은 11/18(수) 휴가니까 회신은 11/17(화)까지 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-17' && included(items)[0].title.includes('회신') && noDate(items, '2026-11-18')],
    ['부장 연차', '박 부장님은 11/20(금) 연차이고 계획서 마감은 11/19(목)입니다.', (items) => dueTodo(items, '2026-11-19', '계획서 마감') && items.length === 1 && noDate(items, '2026-11-20')],
    ['교감 연가', '교감 선생님은 11/5(목) 연가이고 제출은 11/4(수)까지입니다.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-04' && included(items)[0].title.includes('제출') && noDate(items, '2026-11-05')],
    ['출장 연수 유지', '저도 참석하는 11/11(수) 출장 연수, 신청 11/3(화)까지예요.', (items) => eventOn(items, '2026-11-11', '연수') && dueTodo(items, '2026-11-03', '연수 신청서 제출') && !items.some((item) => item.title === '출장 연수')],
    ['N4 녹화본', '작년 학예회 11/18 녹화본 보내드립니다.', (items) => pastOut(items, '2025-11-18')],
    ['N10 영상 삭제', '작년 학예회 영상은 11/10(화)까지 삭제해 주세요.', (items) => dueTodo(items, '2026-11-10', '작년 학예회 영상 삭제')],
    ['강당 녹화', '작년 축제 11/6 강당 녹화 올립니다.', (items) => pastOut(items, '2025-11-06')],
    ['결과물', '지난해 수련회 11/9 결과물입니다.', (items) => pastOut(items, '2025-11-09')],
    ['사진 첨부', '작년 학예회 11/13 사진 첨부합니다.', (items) => pastOut(items, '2025-11-13')],
    ['재작년 영상', '재작년 학예회 5/8 영상 파일입니다.', (items) => pastOut(items, '2024-05-08')],
    ['사진 제출', '작년 학예회 사진은 11/16(월)까지 제출해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-16' && included(items)[0].title.includes('사진') && included(items)[0].title.includes('제출')],
    ['M1 연수', '11/5, 11/12, 11/19 연수를 합니다.', (items) => sameEvents(items, ['2026-11-05', '2026-11-12', '2026-11-19'], '연수')],
    ['또는 연수', '11/5(목) 또는 11/12(목) 또는 11/19(목) 연수입니다.', (items) => sameEvents(items, ['2026-11-05', '2026-11-12', '2026-11-19'], '연수') && !items.some((item) => item.title === '또는')],
    ['대회 임박', '11/16(월) 대회 임박', (items) => eventOn(items, '2026-11-16', '대회') && !items.some((item) => /임박/.test(item.title))],
    ['탐구 임박', '과학 탐구 대회 11/16(월) 임박입니다.', (items) => eventOn(items, '2026-11-16', '과학 탐구 대회')],
    ['다가옴', '11/20(금) 현장학습이 다가옵니다.', (items) => eventOn(items, '2026-11-20', '현장학습') && !items.some((item) => /다가/.test(item.title))],
];
const r39Groups = {
    magam: r39Cases.slice(0, 11),
    absence: r39Cases.slice(11, 18),
    material: r39Cases.slice(18, 25),
    title: r39Cases.slice(25),
};
Object.entries(r39Groups).forEach(([name, rows]) => {
    if (rows.length < 5) {
        console.error(`r39 ${name} 변형이 5개보다 적습니다.`);
        process.exit(1);
    }
});
let r39Ok = 0;
r39Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r39Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
});
if (r39Ok !== r39Cases.length) {
    console.error(`r39 원문 ${r39Ok}/${r39Cases.length}`);
    process.exit(1);
}
console.log(`r39 원문 ${r39Ok}/${r39Cases.length}`);

const oneYellow = (items) => included(items).length === 0 && items.length === 1 && items[0].include === false && items[0].low === true;
const yellowDays = (items, dates) => included(items).length === 0 && dates.every((date) => yellowCard(items, date));
const r40Cases = [
    ['A9 마감 회의', '11/13(금) 2학기 마감 회의를 엽니다.', (items) => eventOn(items, '2026-11-13', '2학기 마감 회의')],
    ['A10 마감 리허설', '11/27(금) 학년말 마감 행사 리허설 있습니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-27' && included(items)[0].title.includes('마감') && included(items)[0].title.includes('리허설')],
    ['A11 마감 연수', '11/16(월) 마감 시간 안내 연수가 있습니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-16' && included(items)[0].title.includes('연수')],
    ['마감 협의회', '11/18(수) 1학기 마감 협의회를 엽니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-18' && item.title.includes('협의회')) && !included(items).some((item) => item.kind === '할 일')],
    ['마감 설명회', '11/20(금) 마감 설명회가 있습니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-20' && item.title.includes('설명회')) && !included(items).some((item) => item.kind === '할 일')],
    ['학기말 마감 연수', '11/25(수) 학기말 마감 연수가 있습니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-25' && item.title.includes('연수')) && !included(items).some((item) => item.kind === '할 일')],
    ['마감 행사 리허설', '11/6(금) 마감 행사 리허설을 합니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-06' && item.title.includes('리허설')) && !included(items).some((item) => item.kind === '할 일')],
    ['마감 전시회', '11/12(목) 학년 마감 전시회가 있습니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-12' && item.title.includes('전시회')) && !included(items).some((item) => item.kind === '할 일')],
    ['신청 마감 유지', '과학 독서 대회 신청 마감은 11/9(월)입니다.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-09' && included(items)[0].title.includes('신청') && included(items)[0].title.includes('마감')],
    ['시각 마감 유지', '11/19(목) 18시 마감입니다.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-19' && included(items)[0].time === '18:00' && included(items)[0].title.includes('마감')],
    ['접수 마감 유지', '접수는 11/11(수) 마감입니다.', (items) => dueTodo(items, '2026-11-11', '접수 마감')],
    ['B3 부재 서류', '행정실장님 11/9(월)~11/10(화) 부재, 서류는 11/6(금)까지 내 주세요.', (items) => dueTodo(items, '2026-11-06', '서류 제출') && items.length === 1 && noDate(items, '2026-11-09') && noDate(items, '2026-11-10')],
    ['B5 병가', '교무부장님 11/24(화) 병가입니다.', (items) => items.length === 0],
    ['담임 외출', '담임 선생님 11/16(월) 외출, 회신은 11/13(금)까지 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-13' && included(items)[0].title.includes('회신') && noDate(items, '2026-11-16')],
    ['학년부장 부재', '학년부장님 11/18(수)~11/19(목) 부재, 계획서는 11/17(화)까지 내 주세요.', (items) => dueTodo(items, '2026-11-17', '계획서 제출') && items.length === 1 && noDate(items, '2026-11-18')],
    ['연구부장 병가', '연구부장님 11/25(수) 병가입니다.', (items) => items.length === 0],
    ['실장 연가', '행정실장님 11/6(금) 연가, 설문은 11/5(목)까지 제출해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-05' && included(items)[0].title.includes('설문') && noDate(items, '2026-11-06')],
    ['교무부장 휴가', '교무부장님 11/11(수) 휴가입니다.', (items) => items.length === 0],
    ['실장 출장 결재', '행정실장님 11/20(금) 출장, 결재는 11/19(목)까지 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-19' && included(items)[0].title.includes('결재') && noDate(items, '2026-11-20')],
    ['M6 중 하루', '11/12(목) 또는 11/13(금) 중 하루 체험학습 갑니다.', (items) => yellowDays(items, ['2026-11-12', '2026-11-13'])],
    ['F3 작년 양식', '11/16(월) 협의회 자료는 작년 양식을 씁니다.', (items) => eventOn(items, '2026-11-16', '협의회') && !items.some((item) => String(item.date || '').startsWith('2025'))],
    ['또는 중 하나', '11/19(목) 또는 11/20(금) 중 하나 현장학습 갑니다.', (items) => yellowDays(items, ['2026-11-19', '2026-11-20'])],
    ['또는 소풍', '11/5(목) 또는 11/6(금) 중 하루 소풍 갑니다.', (items) => yellowDays(items, ['2026-11-05', '2026-11-06'])],
    ['또는 공개수업', '11/24(화) 또는 11/25(수) 중 하루 공개수업입니다.', (items) => yellowDays(items, ['2026-11-24', '2026-11-25'])],
    ['또는 체험', '11/9(월) 또는 11/10(화) 중 하나 체험학습입니다.', (items) => yellowDays(items, ['2026-11-09', '2026-11-10'])],
    ['또는 설명회', '11/26(목) 또는 11/27(금) 중 하루 설명회 갑니다.', (items) => yellowDays(items, ['2026-11-26', '2026-11-27'])],
    ['작년 서식', '11/18(수) 연수 자료는 작년 서식을 사용합니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-18' && item.title.includes('연수')) && !items.some((item) => String(item.date || '').startsWith('2025'))],
    ['지난해 양식', '11/13(금) 협의회 자료는 지난해 양식으로 준비합니다.', (items) => eventOn(items, '2026-11-13', '협의회') && !items.some((item) => String(item.date || '').startsWith('2025'))],
    ['작년 형식', '11/20(금) 설명회 자료는 작년 형식을 씁니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-20' && item.title.includes('설명회')) && !items.some((item) => String(item.date || '').startsWith('2025'))],
    ['재작년 양식', '11/4(수) 협의회 자료는 재작년 양식을 씁니다.', (items) => eventOn(items, '2026-11-04', '협의회') && !items.some((item) => /^202[45]-/.test(item.date || ''))],
    ['상담 양식', '11/11(수) 상담 자료는 작년 양식을 사용합니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-11' && item.title.includes('상담')) && !items.some((item) => String(item.date || '').startsWith('2025'))],
    ['T4 신청만', '신청은 11/12(목)까지.', (items) => oneYellow(items) && items[0].date === '2026-11-12'],
    ['T3 일정 있습니다', '11/9(월) 일정 있습니다.', (items) => oneYellow(items) && items[0].date === '2026-11-09'],
    ['K4 제목', '11/20(금) 18시 마감, 결과 발표 11/27(금).', (items) => included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-20' && item.time === '18:00' && item.title === '18시 마감') && eventOn(items, '2026-11-27', '결과 발표') && !included(items).some((item) => item.title === '결과 발표 마감' || item.title === '마감')],
    ['B7 결재 마감', '11/4(수) 교감 선생님 출장, 결재 마감 11/6(금).', (items) => dueTodo(items, '2026-11-06', '결재 마감') && items.length === 1 && noDate(items, '2026-11-04') && items[0].title !== '마감'],
    ['E6 회신 마감', '김 선생님은 11/9(월) 출장이고 회신 마감은 11/13(금)입니다.', (items) => dueTodo(items, '2026-11-13', '회신 마감') && noDate(items, '2026-11-09') && !included(items).some((item) => item.title === '마감' || item.title === '회신')],
    ['B1 신청만', '부장님 11/10(화) 출장, 신청은 11/11(수)까지.', (items) => dueTodo(items, '2026-11-11', '신청') && items.length === 1 && noDate(items, '2026-11-10') && items.every((item) => item.include !== false)],
    ['있습니다만', '11/17(화) 있습니다.', (items) => oneYellow(items) && items[0].date === '2026-11-17'],
    ['학예회 마감', '11/24(화) 18시 마감, 학예회 11/27(금).', (items) => included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-24' && item.time === '18:00' && item.title === '18시 마감') && eventOn(items, '2026-11-27', '학예회') && !included(items).some((item) => item.title === '학예회 마감' || item.title === '마감')],
    ['체험 신청', '체험학습 신청은 11/12(목)까지.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-12' && included(items)[0].title.includes('체험학습') && included(items)[0].title.includes('신청')],
    ['갑니다만', '11/20(금) 갑니다.', (items) => oneYellow(items) && items[0].date === '2026-11-20'],
    ['엽니다만', '11/6(금) 엽니다.', (items) => oneYellow(items) && items[0].date === '2026-11-06'],
    ['B6 회의', '교무부장님 11/12(목) 병가, 11/13(금) 교직원 회의를 합니다.', (items) => eventOn(items, '2026-11-13', '교직원 회의') && items.length === 1 && noDate(items, '2026-11-12')],
    ['B10 내 출장', '저는 11/19(목) 출장 갑니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-19' && included(items)[0].title.includes('출장')],
    ['C11 전시회', '11/20(금) 결과물 전시회가 있습니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-20' && included(items)[0].title.includes('전시회') && !String(included(items)[0].date).startsWith('2025')],
    ['C12 녹화 공유', '올해 학예회 녹화본은 11/10(화)까지 공유해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-10' && /녹화|학예회|공유/.test(included(items)[0].title)],
    ['외출 회의', '담임 선생님 11/18(수) 외출, 11/19(목) 학년 회의가 있습니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-19' && item.title.includes('회의')) && noDate(items, '2026-11-18') && !included(items).some((item) => item.date === '2026-11-18')],
    ['제가 출장', '제가 11/26(목) 출장 갑니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-26' && included(items)[0].title.includes('출장')],
    ['과학 전시회', '11/27(금) 과학 결과물 전시회를 엽니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-27' && item.title.includes('전시회'))],
    ['녹화본 공유', '11/18(수) 학예회 녹화본을 공유합니다.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-18' && included(items)[0].include !== false],
    ['올해 녹화', '올해 축제 녹화는 11/13(금)까지 공유해 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-13'],
    ['본인 연차', '저는 11/25(수) 연차입니다.', (items) => included(items).length === 0 && items.some((item) => item.date === '2026-11-25' && item.include === false)],
    ['내 출장 유지', '저는 11/27(금) 출장 갑니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-27' && included(items)[0].title.includes('출장')],
    ['전시회 유지', '11/4(수) 결과물 전시회가 있습니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-04' && included(items)[0].title.includes('전시회')],
];
const r40Groups = {
    magam: r40Cases.slice(0, 11),
    absence: r40Cases.slice(11, 19),
    choice: r40Cases.slice(19, 25),
    form: r40Cases.slice(25, 30),
    title: r40Cases.slice(30, 41),
    minor: r40Cases.slice(41),
};
Object.entries(r40Groups).forEach(([name, rows]) => {
    if (rows.length < 5) {
        console.error(`r40 ${name} 변형이 5개보다 적습니다.`);
        process.exit(1);
    }
});
let r40Ok = 0;
r40Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r40Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
});
if (r40Ok !== r40Cases.length) {
    console.error(`r40 원문 ${r40Ok}/${r40Cases.length}`);
    process.exit(1);
}
console.log(`r40 원문 ${r40Ok}/${r40Cases.length}`);

const noWarn = (items) => included(items).length > 0 && included(items).every((item) => !item.warning);
const r41Cases = [
    ['마감 점검 회의', '11/13(금) 마감 점검 회의를 엽니다.', (items) => eventOn(items, '2026-11-13', '마감 점검 회의') && noWarn(items) && !included(items).some((item) => item.kind === '할 일')],
    ['출장 보고회', '11/20(금) 출장 보고회가 있습니다.', (items) => eventOn(items, '2026-11-20', '출장 보고회') && noWarn(items)],
    ['출장 복명 회의', '11/18(수) 출장 복명 회의를 합니다.', (items) => eventOn(items, '2026-11-18', '출장 복명 회의') && noWarn(items)],
    ['출장 결과 보고회', '11/19(목) 출장 결과 보고회가 있습니다.', (items) => eventOn(items, '2026-11-19', '출장 결과 보고회') && noWarn(items)],
    ['부재 대체 회의', '11/12(목) 부재 시 대체 업무 회의를 엽니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-12' && included(items)[0].title === '부재 시 대체 업무 회의' && !included(items)[0].warning],
    ['결과물 발표회', '11/27(금) 결과물 발표회가 있습니다.', (items) => eventOn(items, '2026-11-27', '결과물 발표회') && noWarn(items) && !items.some((item) => String(item.date).startsWith('2025'))],
    ['선생님 출장 보고회', '김 선생님 11/16(월) 출장 보고회에 참석합니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-16' && included(items)[0].title.includes('출장 보고회') && !included(items)[0].warning],
    ['학년 마감 점검', '11/25(수) 학년 마감 점검 회의가 있습니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-25' && item.title.includes('마감 점검 회의')) && noWarn(items)],
    ['강당 복명 회의', '11/6(금) 출장 복명 회의가 강당에서 있습니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-06' && item.title.includes('출장 복명 회의')) && noWarn(items)],
    ['과학 발표회', '11/24(화) 과학 결과물 발표회를 엽니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-24' && item.title.includes('결과물 발표회')) && noWarn(items)],
    ['교무부장 병가', '교무부장님 11/24(화) 병가입니다.', (items) => items.length === 0],
    ['담임 연가', '담임 선생님 11/17(화) 연가입니다.', (items) => items.length === 0],
    ['실장 출장', '행정실장님 11/20(금) 출장입니다.', (items) => items.length === 0],
    ['학년부장 휴가', '학년부장님 11/11(수) 휴가입니다.', (items) => items.length === 0],
    ['박 선생님 조퇴', '박 선생님 11/6(금) 조퇴입니다.', (items) => items.length === 0],
    ['교감 외출', '교감 선생님 11/13(금) 외출입니다.', (items) => items.length === 0],
    ['부재 서류만', '행정실장님 11/9(월) 부재, 서류는 11/5(목)까지 내 주세요.', (items) => dueTodo(items, '2026-11-05', '서류 제출') && items.length === 1 && noDate(items, '2026-11-09')],
    ['출장 회신만', '교무부장님 11/18(수) 출장, 회신은 11/17(화)까지 주세요.', (items) => included(items).length === 1 && included(items)[0].kind === '할 일' && included(items)[0].date === '2026-11-17' && included(items)[0].title.includes('회신') && noDate(items, '2026-11-18')],
    ['병가 회의만', '연구부장님 11/25(수) 병가, 11/26(목) 연구 회의를 합니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-26' && item.title.includes('회의')) && noDate(items, '2026-11-25') && items.length === 1],
    ['B2 병가', '저 11/16 병가 냅니다', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-16' && included(items)[0].title === '병가' && !included(items)[0].warning],
    ['B10 내 출장', '저는 11/19(목) 출장 갑니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-19' && included(items)[0].title === '출장'],
    ['주어 없는 병가', '11/17(화) 병가 냅니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-17' && included(items)[0].title === '병가'],
    ['주어 없는 연가', '11/18(수) 연가입니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-18' && included(items)[0].title === '연가'],
    ['제가 출장', '제가 11/26(목) 출장 갑니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-26' && included(items)[0].title === '출장'],
    ['연가 냅니다', '저 11/20(금) 연가 냅니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-20' && included(items)[0].title === '연가'],
    ['주어 없는 출장', '11/13(금) 출장 갑니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-13' && included(items)[0].title === '출장'],
    ['A2 성적', '성적 마감 회의는 11/20(금), 성적 입력 마감은 11/18(수)입니다.', (items) => eventOn(items, '2026-11-20', '성적 마감 회의') && dueTodo(items, '2026-11-18', '성적 입력 마감')],
    ['상담 마감 회의', '상담 마감 회의는 11/13(금), 상담 기록 마감은 11/11(수)입니다.', (items) => eventOn(items, '2026-11-13', '상담 마감 회의') && dueTodo(items, '2026-11-11', '상담 기록 마감')],
    ['K4 같은 절', '11/20(금) 18시 마감, 결과 발표 11/27(금).', (items) => included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-20' && item.time === '18:00' && item.title === '18시 마감') && eventOn(items, '2026-11-27', '결과 발표') && !items.some((item) => item.title === '결과 발표 마감' || item.title === '마감')],
    ['체험 마감 회의', '체험 마감 회의는 11/27(금), 체험 일지 마감은 11/25(수)입니다.', (items) => eventOn(items, '2026-11-27', '체험 마감 회의') && dueTodo(items, '2026-11-25', '체험 일지 마감')],
    ['E6 행사명 없음', '작년엔 11/10에 했습니다만 올해는 11/17(화)에 합니다.', (items) => yellowCard(items, '2025-11-10') && yellowCard(items, '2026-11-17') && included(items).length === 0 && !items.some((item) => /^(?:올해|작년|이번|다음)$/.test(String(item.title || '').replace(/\s+/g, '')))],
    ['올해만 합니다', '올해는 11/20(금)에 합니다.', (items) => oneYellow(items) && items[0].date === '2026-11-20' && items[0].title !== '일정'],
    ['기간 일정', '12월 8일(화)~10일(목)', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-12-08' && included(items)[0].end === '2026-12-10' && included(items)[0].title === '일정'],
    ['독서 마감 회의', '독서 마감 회의는 11/6(금), 독후감 마감은 11/4(수)입니다.', (items) => eventOn(items, '2026-11-06', '독서 마감 회의') && dueTodo(items, '2026-11-04', '독후감 마감')],
    ['C3 녹화 괄호', '작년 공개수업 녹화(11/17) 보세요.', (items) => yellowCard(items, '2025-11-17') && !included(items).some((item) => String(item.date).startsWith('2026'))],
    ['학예회 영상 괄호', '작년 학예회 영상(11/12) 보세요.', (items) => yellowCard(items, '2025-11-12') && included(items).length === 0],
    ['축제 사진 괄호', '지난해 축제 사진(11/6) 보세요.', (items) => yellowCard(items, '2025-11-06') && included(items).length === 0],
    ['수련회 자료 괄호', '재작년 수련회 자료(5/8) 보세요.', (items) => yellowCard(items, '2024-05-08') && included(items).length === 0],
    ['녹화본 괄호', '작년 공개수업 녹화본(11/18) 보세요.', (items) => yellowCard(items, '2025-11-18') && included(items).length === 0],
    ['파일 괄호', '작년 설명회 파일(11/19) 보세요.', (items) => yellowCard(items, '2025-11-19') && included(items).length === 0],
    ['화요일 보고회', '11/3(화) 출장 보고회가 있습니다.', (items) => eventOn(items, '2026-11-03', '출장 보고회') && noWarn(items)],
    ['목요일 점검', '11/5(목) 마감 점검 회의가 있습니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-05' && item.title.includes('마감 점검 회의')) && noWarn(items)],
    ['화요일 결과 보고', '11/10(화) 출장 결과 보고회를 합니다.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-10' && item.title.includes('출장 결과 보고회')) && noWarn(items)],
    ['수요일 병가', '저 11/4(수) 병가 냅니다.', (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-04' && included(items)[0].title === '병가'],
    ['토요일 발표회', '11/21(토) 결과물 발표회가 있습니다.', (items) => eventOn(items, '2026-11-21', '결과물 발표회') && noWarn(items)],
];
const r41Groups = {
    event: r41Cases.slice(0, 10),
    absence: r41Cases.slice(10, 19),
    mine: r41Cases.slice(19, 26),
    title: r41Cases.slice(26, 34),
    past: r41Cases.slice(34, 40),
    keep: r41Cases.slice(40),
};
Object.entries(r41Groups).forEach(([name, rows]) => {
    if (rows.length < 5) {
        console.error(`r41 ${name} 변형이 5개보다 적습니다.`);
        process.exit(1);
    }
});
let r41Ok = 0;
r41Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r41Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low, warning: item.warning,
        }))));
    }
});
if (r41Ok !== r41Cases.length) {
    console.error(`r41 원문 ${r41Ok}/${r41Cases.length}`);
    process.exit(1);
}
console.log(`r41 원문 ${r41Ok}/${r41Cases.length}`);

const includedPair = (items) => {
    const rows = included(items);
    return [rows.filter((item) => item.kind === '할 일').length, rows.filter((item) => item.kind === '일정').length];
};
const noPersonCard = (items) => !items.some((item) => /^(?:교감(?:\s*선생님)?|부장님|교무부장님|담임(?:\s*선생님)?|행정실장님|학년부장님|연구부장님)$/.test(String(item.title || '').trim()));
const counted = (todo, event, ok) => (items) => {
    const [gotTodo, gotEvent] = includedPair(items);
    return gotTodo === todo && gotEvent === event && ok(items);
};
const r42Cases = [
    ['서류 이니', '교감 선생님 11/12(목) 출장이니 서류는 11/11(수)까지 내 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-11', '서류 제출') && items.length === 1 && noDate(items, '2026-11-12') && noPersonCard(items))],
    ['결재 이라', '부장님 11/12(목) 출장이라 결재 마감은 11/13(금)입니다.', counted(1, 0, (items) => dueTodo(items, '2026-11-13', '결재 마감') && noDate(items, '2026-11-12') && noPersonCard(items))],
    ['회의 이니', '교감 선생님 11/12(목) 출장이니 11/13(금) 교직원 회의를 합니다.', counted(0, 1, (items) => eventOn(items, '2026-11-13', '교직원 회의') && items.length === 1 && noDate(items, '2026-11-12') && noPersonCard(items))],
    ['회의 라서', '교무부장님 11/12(목) 병가라서 11/13(금) 교직원 회의를 합니다.', counted(0, 1, (items) => eventOn(items, '2026-11-13', '교직원 회의') && noDate(items, '2026-11-12') && noPersonCard(items))],
    ['알림장 이니', '담임 선생님 11/16(월) 외출이니 알림장은 11/13(금)까지 내 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-13', '알림장 제출') && noDate(items, '2026-11-16') && noPersonCard(items))],
    ['보고서 라서', '김 선생님 11/18(수) 연가라서 보고서는 11/17(화)까지 제출해 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-17', '보고서 제출') && noDate(items, '2026-11-18') && noPersonCard(items))],
    ['설문 라', '행정실장님 11/6(금) 부재라 설문은 11/5(목)까지 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-05', '설문 제출') && noDate(items, '2026-11-06') && noPersonCard(items))],
    ['연구 회의 니', '연구부장님 11/25(수) 휴가니 11/26(목) 연구 회의를 합니다.', counted(0, 1, (items) => eventOn(items, '2026-11-26', '연구 회의') && noDate(items, '2026-11-25') && noPersonCard(items))],
    ['가정통신문 이라', '학년부장님 11/4(수) 출장이라 가정통신문은 11/3(화)까지 내 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-03', '가정통신문 제출') && noDate(items, '2026-11-04') && noPersonCard(items))],
    ['P1 미룹니다', '부장님 11/12(목) 출장이라 회의 미룹니다.', counted(0, 0, (items) => oneYellow(items) && noPersonCard(items))],
    ['P4 참석 못', '11/20(금) 교무부장님 출장, 보고회 참석 못 하십니다.', counted(0, 0, (items) => items.length === 1 && items[0].include === false && items[0].kind === '일정' && noPersonCard(items))],
    ['협의회 취소', '교감 선생님 11/18(수) 출장이니 협의회는 취소합니다.', counted(0, 0, (items) => items.length === 1 && items[0].include === false && items[0].kind === '일정' && noPersonCard(items))],
    ['회의 참석 못', '부장님 11/10(화) 병가라서 회의 참석 못 하십니다.', counted(0, 0, (items) => items.length === 1 && items[0].include === false && items[0].kind === '일정' && noPersonCard(items))],
    ['설명회 미룸', '담임 선생님 11/13(금) 조퇴라 설명회는 미룹니다.', counted(0, 0, (items) => oneYellow(items) && noPersonCard(items))],
    ['보고회 참석 못', '교무부장님 11/12(목) 출장, 11/13(금) 보고회는 참석 못 하십니다.', counted(0, 0, (items) => items.length === 1 && items[0].include === false && items[0].date === '2026-11-13' && noDate(items, '2026-11-12') && noPersonCard(items))],
    ['상담 미룸', '박 선생님 11/20(금) 외출이라 상담은 11/19(목)로 미룹니다.', counted(0, 1, (items) => eventOn(items, '2026-11-19', '상담') && items.length === 1 && noDate(items, '2026-11-20') && noPersonCard(items))],
    ['보고회 유지', '김 선생님 11/16(월) 출장 보고회에 참석합니다.', counted(0, 1, (items) => included(items).length === 1 && included(items)[0].title.includes('출장 보고회') && !included(items)[0].warning)],
    ['K4 같은 절', '11/20(금) 18시 마감, 결과 발표 11/27(금).', counted(1, 1, (items) => included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-20' && item.time === '18:00' && item.title === '18시 마감') && eventOn(items, '2026-11-27', '결과 발표') && !items.some((item) => item.title === '마감' || item.title === '결과 발표 마감'))],
    ['15시 같은 절', '11/18(수) 15시 마감, 결과 발표 11/25(수).', counted(1, 1, (items) => included(items).some((item) => item.title === '15시 마감' && item.time === '15:00') && eventOn(items, '2026-11-25', '결과 발표') && !items.some((item) => item.title === '마감' || item.title === '결과 발표 마감'))],
    ['학예회 시각', '11/24(화) 18시 마감, 학예회 11/27(금).', counted(1, 1, (items) => included(items).some((item) => item.title === '18시 마감') && eventOn(items, '2026-11-27', '학예회') && !items.some((item) => item.title === '학예회 마감' || item.title === '마감'))],
    ['마감은 단독', '마감은 11/16(월)입니다.', counted(1, 0, (items) => dueTodo(items, '2026-11-16', '마감'))],
    ['시각만 마감', '11/19(목) 18시 마감입니다.', counted(1, 0, (items) => included(items).length === 1 && included(items)[0].title === '18시 마감' && included(items)[0].time === '18:00')],
    ['A5 연수 내용', '11/11(수) 출장 연수입니다. 내용은 인공지능 활용입니다.', counted(0, 1, (items) => eventOn(items, '2026-11-11', '인공지능 활용') && !items.some((item) => item.title === '출장 연수'))],
    ['A5 주제', '11/11(수) 출장 연수입니다. 주제는 디지털 역량입니다.', counted(0, 1, (items) => eventOn(items, '2026-11-11', '디지털 역량') && !items.some((item) => item.title === '출장 연수'))],
    ['A5 연수 내용 구', '11/19(목) 출장 연수입니다. 연수 내용은 학교폭력 예방입니다.', counted(0, 1, (items) => eventOn(items, '2026-11-19', '학교폭력 예방'))],
    ['A5 괄호', '저도 참석하는 11/11(수) 출장 연수(생성형 인공지능), 신청 11/3(화)까지예요.', counted(1, 1, (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-11' && item.title.includes('생성형 인공지능')) && included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-03' && item.title.includes('신청') && item.title.includes('생성형 인공지능')))],
    ['출장 연수 유지', '저도 참석하는 11/11(수) 출장 연수, 신청 11/3(화)까지예요.', counted(1, 1, (items) => eventOn(items, '2026-11-11', '연수') && dueTodo(items, '2026-11-03', '연수 신청서 제출') && !items.some((item) => item.title === '출장 연수'))],
    ['E6 경미', '작년엔 11/10에 했습니다만 올해는 11/17(화)에 합니다.', counted(0, 0, (items) => yellowCard(items, '2025-11-10') && yellowCard(items, '2026-11-17') && included(items).length === 0 && !items.some((item) => /^(?:올해|작년|이번|다음)$/.test(String(item.title || '').replace(/\s+/g, ''))))],
    ['B10 경미', '저는 11/19(목) 출장 갑니다.', counted(0, 1, (items) => included(items).length === 1 && included(items)[0].title === '출장' && included(items)[0].date === '2026-11-19' && !included(items)[0].warning && items.every((item) => item.include !== false))],
    ['v41 B1 신청', '부장님 11/10(화) 출장, 신청은 11/11(수)까지.', counted(1, 0, (items) => dueTodo(items, '2026-11-11', '신청') && items.length === 1 && noDate(items, '2026-11-10') && noPersonCard(items) && items.every((item) => item.include !== false))],
    ['올해만 경미', '올해는 11/20(금)에 합니다.', counted(0, 0, (items) => items.length === 1 && items[0].include === false && items[0].kind !== '일정' && items[0].title !== '일정')],
    ['병가 유지', '저 11/16 병가 냅니다', counted(0, 1, (items) => included(items).length === 1 && included(items)[0].title === '병가' && included(items)[0].date === '2026-11-16')],
    ['순수 병가', '교무부장님 11/24(화) 병가입니다.', counted(0, 0, (items) => items.length === 0)],
    ['P2 회의', '교감 선생님 11/12(목) 출장이니 11/13(금) 교직원 회의를 합니다.', counted(0, 1, (items) => eventOn(items, '2026-11-13', '교직원 회의') && noPersonCard(items))],
    ['P5 마감', '부장님 11/12(목) 출장이라 결재 마감은 11/13(금)입니다.', counted(1, 0, (items) => dueTodo(items, '2026-11-13', '결재 마감') && noPersonCard(items))],
    ['S1 회의', '교무부장님 11/12(목) 병가라서 11/13(금) 교직원 회의를 합니다.', counted(0, 1, (items) => eventOn(items, '2026-11-13', '교직원 회의') && noPersonCard(items))],
];
const r42Groups = {
    keep: r42Cases.slice(0, 9),
    negated: r42Cases.slice(9, 16),
    title: r42Cases.slice(16, 27),
    minor: r42Cases.slice(27),
};
Object.entries(r42Groups).forEach(([name, rows]) => {
    if (rows.length < 5) {
        console.error(`r42 ${name} 변형이 5개보다 적습니다.`);
        process.exit(1);
    }
});
let r42Ok = 0;
r42Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r42Ok += 1;
    else {
        const [todo, event] = includedPair(items);
        console.error(label, text, `할일 ${todo} 일정 ${event}`, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, time: item.time, title: item.title, include: item.include, warning: item.warning,
        }))));
    }
});
if (r42Ok !== r42Cases.length) {
    console.error(`r42 원문 ${r42Ok}/${r42Cases.length}`);
    process.exit(1);
}
console.log(`r42 원문 ${r42Ok}/${r42Cases.length}`);

const oneOrNone = (items) => items.length === 0 || (items.length === 1 && items[0].include === false);
const r43Cases = [
    ['v40 B1 출장이시니', '교장선생님께서 11/12(목) 출장이시니 결재는 11/11(수)까지 부탁드립니다.', counted(1, 0, (items) => included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-11' && item.title.includes('결재')) && items.length === 1 && noDate(items, '2026-11-12') && noPersonCard(items))],
    ['U2 휴가이시니', '행정실장님께서 11/23(월) 휴가이시니 영수증은 11/20(금)까지 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-20', '영수증 제출') && items.length === 1 && noDate(items, '2026-11-23') && noPersonCard(items))],
    ['출장이셔서', '교감 선생님께서 11/12(목) 출장이셔서 서류는 11/11(수)까지 내 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-11', '서류 제출') && noDate(items, '2026-11-12') && noPersonCard(items))],
    ['가시니', '부장님께서 11/18(수) 출장 가시니 보고서는 11/17(화)까지 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-17', '보고서 제출') && noDate(items, '2026-11-18') && noPersonCard(items))],
    ['하셔서 회의', '교무부장님께서 11/20(금) 병가 하셔서 회의는 11/21(토)에 합니다.', counted(0, 1, (items) => eventOn(items, '2026-11-21', '회의') && noDate(items, '2026-11-20') && noPersonCard(items))],
    ['하시니 설문', '학년부장님께서 11/6(금) 외출하시니 설문은 11/5(목)까지 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-05', '설문 제출') && noDate(items, '2026-11-06') && noPersonCard(items))],
    ['U4 연수라', '영양 선생님이 11/13(금) 연수라 급식 신청은 11/12(목)까지 내 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-12', '급식 신청') && items.length === 1 && noDate(items, '2026-11-13') && noPersonCard(items))],
    ['Y1 연수입니다', '교무부장님 11/30(월) 연수입니다.', counted(0, 0, (items) => items.length === 0)],
    ['부장 연수라', '연구부장님 11/25(수) 연수라 자료는 11/24(화)까지 제출해 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-24', '자료 제출') && noDate(items, '2026-11-25') && noPersonCard(items))],
    ['담임 연수이시니', '담임 선생님께서 11/18(수) 연수이시니 알림장은 11/17(화)까지 내 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-17', '알림장 제출') && noDate(items, '2026-11-18') && noPersonCard(items))],
    ['순수 연수', '행정실장님 11/4(수) 연수입니다.', counted(0, 0, (items) => items.length === 0)],
    ['내 연수', '저는 11/19(목) 연수입니다.', counted(0, 1, (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-19' && included(items)[0].title.includes('연수'))],
    ['W5 다음에', '11/24(화) 교무부장님 출장으로 협의회는 다음에 하겠습니다.', counted(0, 0, (items) => oneYellow(items) && noPersonCard(items))],
    ['다음에 합니다', '11/18(수) 보고회는 다음에 합니다.', counted(0, 0, (items) => oneOrNone(items) && !included(items).some((item) => item.date === '2026-11-18'))],
    ['추후', '11/24(화) 협의회는 추후 하겠습니다.', counted(0, 0, (items) => oneOrNone(items) && items.every((item) => item.title === '협의회'))],
    ['연기', '11/20(금) 설명회는 연기합니다.', counted(0, 0, (items) => oneOrNone(items) && !included(items).length)],
    ['새 날짜 미룸', '부장님 11/12(목) 출장, 회의는 11/20(금)로 미룹니다.', counted(0, 1, (items) => eventOn(items, '2026-11-20', '회의') && noDate(items, '2026-11-12') && noPersonCard(items))],
    ['추후 날짜', '협의회는 다음에 합니다. 날짜는 11/27(금)입니다.', counted(0, 1, (items) => eventOn(items, '2026-11-27', '협의회'))],
    ['A5 연수 이름', '저도 참석하는 11/11(수) 출장 연수, 신청 11/3(화)까지예요.', counted(1, 1, (items) => eventOn(items, '2026-11-11', '연수') && dueTodo(items, '2026-11-03', '연수 신청서 제출') && !items.some((item) => item.title === '출장 연수'))],
    ['A5 내용 유지', '11/11(수) 출장 연수입니다. 내용은 인공지능 활용입니다.', counted(0, 1, (items) => eventOn(items, '2026-11-11', '인공지능 활용'))],
    ['A5 괄호 이름', '저도 참석하는 11/11(수) 출장 연수(생성형 인공지능), 신청 11/3(화)까지예요.', counted(1, 1, (items) => eventOn(items, '2026-11-11', '생성형 인공지능') && dueTodo(items, '2026-11-03', '생성형 인공지능 신청'))],
    ['A5 주제 유지', '11/11(수) 출장 연수입니다. 주제는 디지털 역량입니다.', counted(0, 1, (items) => eventOn(items, '2026-11-11', '디지털 역량'))],
    ['Z2 개강', '방과후 신청은 11/13(금) 마감, 11/16(월) 개강.', counted(1, 1, (items) => dueTodo(items, '2026-11-13', '방과후 신청 마감') && eventOn(items, '2026-11-16', '방과후 개강'))],
    ['돌봄 개강', '돌봄 신청은 11/6(금) 마감, 11/9(월) 개강.', counted(1, 1, (items) => dueTodo(items, '2026-11-06', '돌봄 신청 마감') && eventOn(items, '2026-11-09', '돌봄 개강'))],
    ['S1 내 연가', '저는 11/19(목) 연가라 서류는 11/18(수)까지 내 주세요.', counted(1, 1, (items) => eventOn(items, '2026-11-19', '연가') && dueTodo(items, '2026-11-18', '서류 제출') && items.every((item) => item.include !== false))],
    ['X1 내 출장 회의', '제가 11/12(목) 출장이라 11/13(금) 교직원 회의를 합니다.', counted(0, 2, (items) => eventOn(items, '2026-11-12', '출장') && eventOn(items, '2026-11-13', '교직원 회의') && items.every((item) => item.include !== false))],
    ['X2 내 연가 제출', '저 11/16(월) 연가이고 가정통신문은 11/13(금)까지 제출해 주세요.', counted(1, 1, (items) => eventOn(items, '2026-11-16', '연가') && dueTodo(items, '2026-11-13', '가정통신문 제출'))],
    ['X3 내 출장 협의회', '저는 11/19(목) 출장이고 11/20(금) 협의회를 합니다.', counted(0, 2, (items) => eventOn(items, '2026-11-19', '출장') && eventOn(items, '2026-11-20', '협의회'))],
    ['X5 내 병가 마감', '제가 11/6(금) 병가라 결재는 11/5(목)까지 부탁드립니다.', counted(1, 1, (items) => eventOn(items, '2026-11-06', '병가') && included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-05' && item.title.includes('결재')) && items.every((item) => item.include !== false))],
    ['U9 내 출장 보고', '저는 11/18(수) 출장이라 보고서는 11/17(화)까지 주세요.', counted(1, 1, (items) => eventOn(items, '2026-11-18', '출장') && dueTodo(items, '2026-11-17', '보고서 제출'))],
    ['B10 내 출장', '저는 11/19(목) 출장 갑니다.', counted(0, 1, (items) => eventOn(items, '2026-11-19', '출장') && items.length === 1)],
    ['E6 두 날짜', '작년엔 11/10에 했습니다만 올해는 11/17(화)에 합니다.', counted(0, 0, (items) => yellowCard(items, '2025-11-10') && yellowCard(items, '2026-11-17') && included(items).length === 0 && !items.some((item) => /^(?:올해|작년|이번|다음)$/.test(String(item.title || '').replace(/\s+/g, ''))))],
];
const r43Groups = {
    honorific: r43Cases.slice(0, 6),
    training: r43Cases.slice(6, 12),
    postpone: r43Cases.slice(12, 18),
    title: r43Cases.slice(18, 24),
    mine: r43Cases.slice(24),
};
Object.entries(r43Groups).forEach(([name, rows]) => {
    if (rows.length < 5) {
        console.error(`r43 ${name} 변형이 5개보다 적습니다.`);
        process.exit(1);
    }
});
let r43Ok = 0;
r43Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r43Ok += 1;
    else {
        const [todo, event] = includedPair(items);
        console.error(label, text, `할일 ${todo} 일정 ${event}`, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, time: item.time, title: item.title, include: item.include, warning: item.warning,
        }))));
    }
});
if (r43Ok !== r43Cases.length) {
    console.error(`r43 원문 ${r43Ok}/${r43Cases.length}`);
    process.exit(1);
}
console.log(`r43 원문 ${r43Ok}/${r43Cases.length}`);

const noTimeTitle = (items) => !items.some((item) => /^(?:올해|작년|이번|다음|이번주|다음주|다다음주)(?:는|은)?(?:입니다|해요|합니다|했어요|했습니다|이에요|예요|에요)?$/.test(String(item.title || '').replace(/\s+/g, '')));
const r44Cases = [
    ['H2 내셔서', '교감 선생님께서 11/25(수) 연가 내셔서 결재는 11/24(화)까지 받으세요.', counted(1, 0, (items) => included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-24' && item.title.includes('결재')) && items.length === 1 && noDate(items, '2026-11-25') && noPersonCard(items))],
    ['H5 가시므로', '연구부장님께서 11/26(목) 연수 가시므로 계획서는 11/25(수)까지 제출해 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-25', '계획서 제출') && items.length === 1 && noDate(items, '2026-11-26') && noPersonCard(items))],
    ['가시기에', '교무부장님께서 11/18(수) 출장 가시기에 서류는 11/17(화)까지 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-17', '서류 제출') && noDate(items, '2026-11-18') && noPersonCard(items))],
    ['내셔서요', '행정실장님께서 11/13(금) 휴가 내셔서요 영수증은 11/12(목)까지 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-12', '영수증 제출') && noDate(items, '2026-11-13') && noPersonCard(items))],
    ['가셔서', '학년부장님께서 11/6(금) 조퇴 가셔서 알림장은 11/5(목)까지 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-05', '알림장 제출') && noDate(items, '2026-11-06') && noPersonCard(items))],
    ['출장 가시므로', '행정실장님께서 11/20(금) 출장 가시므로 결재는 11/19(목)까지 받으세요.', counted(1, 0, (items) => included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-19' && item.title.includes('결재')) && noDate(items, '2026-11-20') && noPersonCard(items))],
    ['v40 B8 공유회', '11/20(금) 교감 선생님 연수 결과 공유회에 참석해 주세요.', counted(0, 1, (items) => included(items).length === 1 && included(items)[0].kind === '일정' && included(items)[0].date === '2026-11-20' && included(items)[0].title.includes('공유회'))],
    ['v35 C1 사유서', '11/5(목) 연수에 참석하지 못하시는 선생님은 사유서 11/4(수)까지 내 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-04', '사유서 제출') && items.length === 1 && noDate(items, '2026-11-05'))],
    ['공유회 부장', '11/27(금) 연구부장님 연수 결과 공유회에 참석해 주세요.', counted(0, 1, (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-27' && item.title.includes('공유회')) && noPersonCard(items))],
    ['일반 직무 연수', '11/12(목) 직무 연수에 참석하지 못하시는 선생님은 사유서 11/11(수)까지 내 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-11', '사유서 제출') && items.length === 1 && noDate(items, '2026-11-12'))],
    ['교직원 연수 유지', '11/5(목) 교직원 연수는 빠지지 말고 참석해 주세요.', counted(0, 1, (items) => included(items).length === 1 && included(items)[0].date === '2026-11-05' && included(items)[0].title.includes('연수'))],
    ['직무 가십니다', '11/27(금) 교무부장님 직무 연수 가십니다.', counted(0, 0, (items) => items.length === 0)],
    ['원격 받으십니다', '연구부장님께서 11/20(금) 원격 연수 받으십니다.', counted(0, 0, (items) => items.length === 0)],
    ['안 계십니다', '실무사님 11/12(목) 연수라 안 계십니다.', counted(0, 0, (items) => items.length === 0)],
    ['영양 가십니다', '영양 선생님이 11/6(금) 연수 가십니다.', counted(0, 0, (items) => items.length === 0)],
    ['담임 받으십니다', '담임 선생님께서 11/18(수) 원격 연수 받으십니다.', counted(0, 0, (items) => items.length === 0)],
    ['운영위 미룸', '11/20(금) 운영위원회 미룸.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-20')],
    ['보고회 미룹니다', '11/18(수) 보고회는 미룹니다.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-18')],
    ['설명회 미룸', '11/13(금) 설명회 미룸.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-13')],
    ['협의회 미룸', '11/25(수) 협의회 미룸.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-25')],
    ['미룸 새 날짜', '부장님 11/12(목) 출장, 회의는 11/20(금)로 미룹니다.', counted(0, 1, (items) => eventOn(items, '2026-11-20', '회의') && noDate(items, '2026-11-12') && !included(items).some((item) => item.kind === '할 일'))],
    ['미룸 날짜', '설명회는 미룹니다. 날짜는 11/27(금)입니다.', counted(0, 1, (items) => eventOn(items, '2026-11-27', '설명회'))],
    ['H6 총회', '교장선생님께서 11/17(화) 학부모 총회에 참석하십니다. 모두 참석해 주세요.', counted(0, 1, (items) => eventOn(items, '2026-11-17', '학부모 총회'))],
    ['교감 총회', '교감 선생님께서 11/20(금) 학부모 총회에 참석하십니다. 모두 참석해 주세요.', counted(0, 1, (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-20' && item.title.includes('학부모 총회')))],
    ['설명회 참석', '교장선생님께서 11/6(금) 학부모 설명회에 참석하십니다. 모두 참석해 주세요.', counted(0, 1, (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-06' && item.title.includes('설명회')))],
    ['회의 참석', '연구부장님께서 11/12(목) 교직원 회의에 참석하십니다. 모두 참석해 주세요.', counted(0, 1, (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-12' && item.title.includes('회의')))],
    ['학예회 참석', '교무부장님께서 11/19(목) 학예회에 참석하십니다. 모두 참석해 주세요.', counted(0, 1, (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-19' && item.title.includes('학예회')))],
    ['A5 신청서', '저도 참석하는 11/11(수) 출장 연수, 신청 11/3(화)까지예요.', counted(1, 1, (items) => eventOn(items, '2026-11-11', '연수') && dueTodo(items, '2026-11-03', '연수 신청서 제출') && items.some((item) => item.kind === '할 일' && item.title.includes('신청서')))],
    ['E6 노란', '작년엔 11/10에 했습니다만 올해는 11/17(화)에 합니다.', counted(0, 0, (items) => yellowCard(items, '2025-11-10') && yellowCard(items, '2026-11-17') && noTimeTitle(items))],
    ['A5 내용', '11/11(수) 출장 연수입니다. 내용은 인공지능 활용입니다.', counted(0, 1, (items) => eventOn(items, '2026-11-11', '인공지능 활용'))],
    ['A5 괄호', '저도 참석하는 11/11(수) 출장 연수(생성형 인공지능), 신청 11/3(화)까지예요.', counted(1, 1, (items) => eventOn(items, '2026-11-11', '생성형 인공지능') && included(items).some((item) => item.kind === '할 일' && item.date === '2026-11-03' && item.title.includes('생성형 인공지능') && item.title.includes('신청')))],
    ['올해만 시간어', '올해는 11/20(금)에 합니다.', counted(0, 0, (items) => items.length === 1 && items[0].include === false && noTimeTitle(items))],
    ['v41 B1 신청', '부장님 11/10(화) 출장, 신청은 11/11(수)까지.', counted(1, 0, (items) => dueTodo(items, '2026-11-11', '신청') && items.length === 1 && noDate(items, '2026-11-10'))],
    ['병가 신청', '교감 선생님 11/6(금) 병가, 신청은 11/11(수)까지.', counted(1, 0, (items) => dueTodo(items, '2026-11-11', '신청') && noDate(items, '2026-11-06'))],
    ['부재 신청', '행정실장님 11/4(수) 부재, 신청은 11/11(수)까지.', counted(1, 0, (items) => dueTodo(items, '2026-11-11', '신청') && noDate(items, '2026-11-04'))],
    ['연가 신청', '연구부장님 11/13(금) 연가, 신청은 11/11(수)까지.', counted(1, 0, (items) => dueTodo(items, '2026-11-11', '신청') && noDate(items, '2026-11-13'))],
    ['외출 신청', '학년부장님 11/18(수) 외출, 신청은 11/11(수)까지.', counted(1, 0, (items) => dueTodo(items, '2026-11-11', '신청') && noDate(items, '2026-11-18'))],
];
const r44Groups = {
    link: r44Cases.slice(0, 6),
    keep: r44Cases.slice(6, 11),
    train: r44Cases.slice(11, 16),
    move: r44Cases.slice(16, 22),
    attend: r44Cases.slice(22, 27),
    title: r44Cases.slice(27, 32),
    due: r44Cases.slice(32),
};
Object.entries(r44Groups).forEach(([name, rows]) => {
    if (rows.length < 5) {
        console.error(`r44 ${name} 변형이 5개보다 적습니다.`);
        process.exit(1);
    }
});
let r44Ok = 0;
r44Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r44Ok += 1;
    else {
        const [todo, event] = includedPair(items);
        console.error(label, text, `할일 ${todo} 일정 ${event}`, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, time: item.time, title: item.title, include: item.include, warning: item.warning,
        }))));
    }
});
if (r44Ok !== r44Cases.length) {
    console.error(`r44 원문 ${r44Ok}/${r44Cases.length}`);
    process.exit(1);
}
console.log(`r44 원문 ${r44Ok}/${r44Cases.length}`);

const opened = (items, date, word) => included(items).some((item) => item.kind === '일정' && item.date === date && item.title.includes(word));
const r45Cases = [
    ['v41 B10 전달', '11/17(화) 교장선생님 연수 전달 연수 있습니다.', counted(0, 1, (items) => opened(items, '2026-11-17', '연수') && items.every((item) => item.include !== false))],
    ['O6 전달', '11/19(목) 교감 선생님 연수 전달 연수가 있습니다.', counted(0, 1, (items) => opened(items, '2026-11-19', '전달'))],
    ['H4 가시는데', '행정실장님께서 11/20(금) 휴가 가시는데 영수증은 11/19(목)까지 내 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-19', '영수증 제출') && items.length === 1 && noDate(items, '2026-11-20'))],
    ['내시는데', '교무부장님께서 11/13(금) 연가 내시는데 서류는 11/12(목)까지 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-12', '서류 제출') && noDate(items, '2026-11-13'))],
    ['하시는데', '학년부장님께서 11/6(금) 조퇴하시는데 알림장은 11/5(목)까지 내 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-05', '알림장 제출') && noDate(items, '2026-11-06'))],
    ['오시는데', '연구부장님께서 11/25(수) 출장 오시는데 설문은 11/24(화)까지 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-24', '설문 제출') && noDate(items, '2026-11-25'))],
    ['연수인데', '영양 선생님이 11/18(수) 연수인데 급식 신청은 11/17(화)까지 내 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-17', '급식 신청') && items.length === 1 && noDate(items, '2026-11-18'))],
    ['H6 진행', '교장선생님께서 11/18(수) 학부모 연수를 직접 진행하십니다.', counted(0, 1, (items) => eventOn(items, '2026-11-18', '학부모 연수'))],
    ['설명회 진행', '교감 선생님께서 11/6(금) 학부모 설명회를 직접 진행하십니다.', counted(0, 1, (items) => opened(items, '2026-11-06', '설명회'))],
    ['E4 공유 회의', '11/20(금) 보건 선생님 연수 내용 공유 회의를 합니다.', counted(0, 1, (items) => opened(items, '2026-11-20', '회의'))],
    ['연수 보고회', '11/27(금) 연구부장님 연수 결과 보고회를 합니다.', counted(0, 1, (items) => opened(items, '2026-11-27', '보고회'))],
    ['O7 참석', '교감 선생님이 진행하는 11/24(화) 교직원 연수에 참석해 주세요.', counted(0, 1, (items) => eventOn(items, '2026-11-24', '교직원 연수'))],
    ['직무 참석', '11/12(목) 교무부장님이 진행하는 직무 연수에 참석해 주세요.', counted(0, 1, (items) => opened(items, '2026-11-12', '직무 연수'))],
    ['D6 연기된', '11/12(목) 연기된 운영위원회를 엽니다.', counted(0, 1, (items) => eventOn(items, '2026-11-12', '운영위원회'))],
    ['연기된 회의', '11/19(목) 연기된 교직원 회의를 엽니다.', counted(0, 1, (items) => opened(items, '2026-11-19', '회의'))],
    ['미뤄진 회의', '11/18(수) 미뤄진 회의를 합니다.', counted(0, 1, (items) => eventOn(items, '2026-11-18', '회의') && !included(items).some((item) => item.kind === '할 일'))],
    ['T4 이번 주', '이번 주는 11/13(금)입니다.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-13' && noTimeTitle(items))],
    ['T6 다음 주', '다음 주 11/16(월)에 해요.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-16' && noTimeTitle(items))],
    ['이번 주만', '이번 주는 11/20(금)에 합니다.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-20' && noTimeTitle(items))],
    ['A5 신청서', '저도 참석하는 11/11(수) 출장 연수, 신청 11/3(화)까지예요.', counted(1, 1, (items) => eventOn(items, '2026-11-11', '연수') && dueTodo(items, '2026-11-03', '연수 신청서 제출'))],
    ['가시므로 유지', '연구부장님께서 11/26(목) 연수 가시므로 계획서는 11/25(수)까지 제출해 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-25', '계획서 제출') && noDate(items, '2026-11-26'))],
    ['X3 유지', '저는 11/19(목) 출장이고 11/20(금) 협의회를 합니다.', counted(0, 2, (items) => eventOn(items, '2026-11-19', '출장') && eventOn(items, '2026-11-20', '협의회'))],
    ['B10 유지', '저는 11/19(목) 출장 갑니다.', counted(0, 1, (items) => eventOn(items, '2026-11-19', '출장'))],
    ['O3 부재중', '연구부장님 11/23(월) 직무 연수라 부재중입니다.', counted(0, 0, (items) => items.length === 0)],
    ['D4 다음으로', '11/26(목) 연수는 다음으로 미룹니다.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-26' && items[0].kind === '일정')],
    ['가십니다', '11/27(금) 교무부장님 직무 연수 가십니다.', counted(0, 0, (items) => items.length === 0)],
    ['받으십니다', '연구부장님께서 11/20(금) 원격 연수 받으십니다.', counted(0, 0, (items) => items.length === 0)],
    ['안 계십니다', '실무사님 11/12(목) 연수라 안 계십니다.', counted(0, 0, (items) => items.length === 0)],
    ['U7 미뤘습니다', '11/18(수) 간담회를 미뤘습니다.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-18' && items[0].kind === '일정')],
    ['U10 미뤘어요', '11/20(금) 회의를 미뤘어요.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-20' && items[0].kind === '일정')],
    ['운영위 미뤘다', '11/12(목) 운영위는 미뤘습니다.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-12')],
    ['다음으로 미뤘다', '11/25(수) 협의회를 다음으로 미뤘습니다.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-25')],
    ['병가 가시는데', '학년부장님께서 11/10(화) 병가 가시는데 가정통신문은 11/9(월)까지 내 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-09', '가정통신문 제출') && items.length === 1 && noDate(items, '2026-11-10'))],
    ['안전 연수 진행', '교장선생님께서 11/27(금) 안전 연수를 직접 진행하십니다.', counted(0, 1, (items) => eventOn(items, '2026-11-27', '안전 연수'))],
    ['학년 공유 회의', '11/13(금) 학년부장님 연수 내용 공유 회의를 합니다.', counted(0, 1, (items) => opened(items, '2026-11-13', '회의'))],
    ['설문 가시므로', '보건 선생님께서 11/24(화) 연수 가시므로 설문은 11/23(월)까지 제출해 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-23', '설문 제출') && noDate(items, '2026-11-24'))],
    ['미뤄진 설명회', '11/6(금) 미뤄진 설명회를 엽니다.', counted(0, 1, (items) => eventOn(items, '2026-11-06', '설명회'))],
    ['다음 주 이에요', '다음 주는 11/23(월)이에요.', counted(0, 0, (items) => oneYellow(items) && items[0].date === '2026-11-23' && noTimeTitle(items))],
];
if (r45Cases.length < 20) {
    console.error('r45 변형이 20개보다 적습니다.');
    process.exit(1);
}
let r45Ok = 0;
let r45Loss = 0;
r45Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (!items.length && !silentOtherAbsence(text, qaNow) && !silentPostponement(text, qaNow)) {
        r45Loss += 1;
        console.error('경고 없는 소실', label, text);
    }
    if (ok(items)) r45Ok += 1;
    else {
        const [todo, event] = includedPair(items);
        console.error(label, text, `할일 ${todo} 일정 ${event}`, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, time: item.time, title: item.title, include: item.include, warning: item.warning,
        }))));
    }
});
if (r45Loss || r45Ok !== r45Cases.length) {
    console.error(`r45 원문 ${r45Ok}/${r45Cases.length}, 소실 ${r45Loss}`);
    process.exit(1);
}
console.log(`r45 원문 ${r45Ok}/${r45Cases.length}, 경고 없는 소실 0`);

const yellowOne = (items) => oneYellow(items);
const r46Cases = [
    ['출장 중', '교장선생님께서 11/26(목) 출장 중이십니다.', (items) => items.length === 0],
    ['병가 내셨', '박 선생님이 11/25(수) 병가 내셨습니다.', (items) => items.length === 0],
    ['출장 다녀오', '교감 선생님 11/17(화) 출장 다녀오십니다.', (items) => items.length === 0],
    ['연가 세요', '실무사님 11/20(금) 연가세요.', (items) => items.length === 0],
    ['연수 다녀오 범위', '김 선생님이 11/16(월)~11/17(화) 연수 다녀오세요.', (items) => items.length === 0],
    ['연수 출장', '교감 선생님 11/26(목)~11/27(금) 연수 출장 가십니다.', (items) => items.length === 0],
    ['연가이십니다', '행정실장님 11/24(화) 연가이십니다.', (items) => items.length === 0],
    ['연수 가세요', '11/16(월) 보건 선생님 연수 가세요.', (items) => items.length === 0 || yellowOne(items)],
    ['원격 듣습니다', '11/30(월) 영양 선생님 원격 연수 듣습니다.', (items) => items.length === 0 || yellowOne(items)],
    ['은 연가입니다', '11/24(화)은 교장선생님 연가입니다.', (items) => items.length === 0 || yellowOne(items)],
    ['R3 공유회', '11/25(수) 연구부장님 연수라 연수 결과 공유회는 11/26(목)에 합니다.', counted(0, 1, (items) => eventOn(items, '2026-11-26', '연수 결과 공유회') && noDate(items, '2026-11-25') && items.length === 1)],
    ['6학년 부장님', '6학년 부장님께서 11/12(목) 연수라서 학년 회의는 11/13(금)에 합니다.', counted(0, 1, (items) => eventOn(items, '2026-11-13', '학년 회의') && noDate(items, '2026-11-12') && items.length === 1)],
    ['교무 가셔서', '교무부장님께서 11/13(금) 출장 가셔서 교직원 회의는 11/16(월)에 합니다.', counted(0, 1, (items) => eventOn(items, '2026-11-16', '교직원 회의') && noDate(items, '2026-11-13') && items.length === 1)],
    ['부장 병가라서', '부장님께서 11/16(월) 병가라서 부서 회의는 11/17(화)에 합니다.', counted(0, 1, (items) => eventOn(items, '2026-11-17', '부서 회의') && noDate(items, '2026-11-16') && items.length === 1)],
    ['교감 시니', '교감 선생님께서 11/13(금) 휴가시니 협의회는 11/16(월)에 합니다.', counted(0, 1, (items) => eventOn(items, '2026-11-16', '협의회') && noDate(items, '2026-11-13') && items.length === 1)],
    ['교무 30 연수라', '교무부장님께서 11/30(월) 연수라 운영 회의는 12/1(화)에 합니다.', counted(0, 1, (items) => eventOn(items, '2026-12-01', '운영 회의') && noDate(items, '2026-11-30') && items.length === 1)],
    ['결재 미리', '11/20(금)은 교장선생님 출장이시니 결재 요청은 미리 해 주세요.', counted(0, 0, (items) => items.length === 1 && items[0].include === false && items[0].title === '결재' && items[0].date === '2026-11-20')],
    ['출장 관련 서류', '11/19(목) 교감 선생님 출장 관련 서류를 정리해 주세요.', counted(1, 0, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-11-19')],
    ['D4 노란', '11/26(목) 연수는 다음으로 미룹니다.', counted(0, 0, (items) => yellowOne(items) && items[0].kind === '일정' && items[0].date === '2026-11-26')],
    ['추후 공지', '11/18(수) 설명회는 추후 공지로 미루겠습니다.', counted(0, 0, (items) => yellowOne(items) && items[0].date === '2026-11-18' && items[0].title.includes('설명회'))],
    ['다음 날', '제가 11/16(월) 병가라서 학년 회의는 다음 날로 미룹니다.', counted(0, 1, (items) => eventOn(items, '2026-11-17', '학년 회의') && noDate(items, '2026-11-16'))],
    ['W5 노란', '11/24(화) 교무부장님 출장으로 협의회는 다음에 하겠습니다.', counted(0, 0, (items) => yellowOne(items) && items[0].date === '2026-11-24')],
    ['U7 노란', '11/18(수) 간담회를 미뤘습니다.', counted(0, 0, (items) => yellowOne(items) && items[0].kind === '일정')],
    ['U10 노란', '11/20(금) 회의를 미뤘어요.', counted(0, 0, (items) => yellowOne(items) && items[0].kind === '일정')],
    ['운영위 미룸 노란', '11/20(금) 운영위원회 미룸.', counted(0, 0, (items) => yellowOne(items) && items[0].title.includes('운영위원회'))],
    ['미뤄습니다', '11/18(수) 간담회를 미뤄습니다.', counted(0, 0, (items) => yellowOne(items) && items[0].date === '2026-11-18' && items[0].kind === '일정')],
    ['우천', '11/20(금) 체육대회인데 우천 시 11/23(월)로 미룹니다.', counted(0, 1, (items) => eventOn(items, '2026-11-20', '체육대회') && noDate(items, '2026-11-23') && items.length === 1)],
    ['품의 제목', '교장선생님께서 지도하시므로 학부모 공개수업 품의는 11/13(금)까지 부탁드립니다.', counted(1, 0, (items) => dueTodo(items, '2026-11-13', '품의'))],
    ['결재 이번 주', '결재는 이번 주 내 11/13(금)까지 해 주세요.', counted(1, 0, (items) => dueTodo(items, '2026-11-13', '결재'))],
    ['날짜만', '이번 주는 11/13(금)입니다.', counted(0, 0, (items) => yellowOne(items) && items[0].title === '날짜만 있음')],
    ['A5 신청서', '저도 참석하는 11/11(수) 출장 연수, 신청 11/3(화)까지예요.', counted(1, 1, (items) => eventOn(items, '2026-11-11', '연수') && dueTodo(items, '2026-11-03', '연수 신청서 제출'))],
];
const r46People = [
    ['교장선생님께서', '11/26(목)'],
    ['박 선생님이', '11/25(수)'],
    ['교감 선생님', '11/17(화)'],
    ['실무사님', '11/20(금)'],
    ['행정실장님', '11/24(화)'],
    ['영양 선생님', '11/30(월)'],
];
const r46Leaves = ['출장', '연가', '병가', '휴가', '연수', '원격 연수'];
const r46Ends = ['중이십니다.', '다녀오십니다.', '이십니다.', '가십니다.', '입니다.', '가세요.'];
let r46Var = 0;
r46People.forEach(([person, day]) => {
    r46Leaves.forEach((leave) => {
        const end = r46Ends[r46Var % r46Ends.length];
        r46Var += 1;
        r46Cases.push([`변형 ${r46Var} ${leave}`, `${person} ${day} ${leave} ${end}`, (items) => items.length === 0]);
    });
});
if (r46Var < 30) {
    console.error('r46 변형이 30개보다 적습니다.');
    process.exit(1);
}
let r46Ok = 0;
r46Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r46Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, title: item.title, include: item.include,
        }))));
    }
});
if (r46Ok !== r46Cases.length) {
    console.error(`r46 원문 ${r46Ok}/${r46Cases.length}`);
    process.exit(1);
}
console.log(`r46 원문 ${r46Ok}/${r46Cases.length}, 변형 ${r46Var}`);

const r47Schedule = (items, date, title) => items.length === 1 && items[0].kind === '일정' && items[0].include !== false && items[0].date === date && items[0].title.includes(title);
const r47Cases = [
    ['A2 외출', '교감 선생님 11/20(금) 오후 외출이십니다.', (items) => items.length === 0],
    ['A3 공가', '행정실장님께서 11/24(화) 공가 쓰십니다.', (items) => items.length === 0],
    ['A6 파견', '교육지원청 파견으로 연구부장님께서 11/17(화) 안 계십니다.', (items) => items.length === 0],
    ['A8 육아시간', '최 선생님께서 11/16(월) 육아시간 쓰십니다.', (items) => items.length === 0],
    ['B5 행사', '과학 부장님 11/27(금) 연수라 과학의 날 행사는 11/30(월)에 엽니다.', (items) => r47Schedule(items, '2026-11-30', '행사') && noDate(items, '2026-11-27')],
    ['B2 협의', '김 선생님께서 11/20(금) 외출하셔서 학년 협의는 11/23(월)에 합니다.', (items) => r47Schedule(items, '2026-11-23', '학년 협의') && noDate(items, '2026-11-20')],
    ['U7 바꿉니다', '교장선생님 11/16(월) 연가라 운영위원회는 11/17(화)로 바꿉니다.', (items) => r47Schedule(items, '2026-11-17', '운영위원회') && noDate(items, '2026-11-16')],
    ['U10 옮겨요', '과학 선생님 11/18(수) 병가라 실험 수업은 11/19(목)로 옮겨요.', (items) => r47Schedule(items, '2026-11-19', '실험 수업') && noDate(items, '2026-11-18')],
    ['B3 건강기록부', '보건교사님께서 11/24(화) 공가 쓰시므로 건강기록부는 11/23(월)까지 주세요.', (items) => items.length === 1 && dueTodo(items, '2026-11-23', '건강기록부 제출') && noDate(items, '2026-11-24')],
    ['E3 오세요', '11/24(화) 교감 선생님 주관 연수 결과 보고회에 오세요.', (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-24' && items[0].title.includes('보고회') && !/오세요|에$/.test(items[0].title)],
    ['C2 조퇴', '제가 11/20(금) 조퇴라 보충수업 11/19(목)까지 바꿔 주세요.', (items) => items.length === 1 && items[0].kind === '할 일' && items[0].include !== false && items[0].date === '2026-11-19' && items[0].title.includes('보충수업')],
    ['공가 협의', '과학 부장님 11/18(수) 공가라 학년 협의는 11/19(목)에 합니다.', (items) => r47Schedule(items, '2026-11-19', '학년 협의') && noDate(items, '2026-11-18')],
    ['파견 회의', '연구부장님께서 11/12(목) 파견이라 교직원 회의는 11/13(금)에 합니다.', (items) => r47Schedule(items, '2026-11-13', '교직원 회의') && noDate(items, '2026-11-12')],
    ['반차 옮겨', '담임 선생님 11/25(수) 반차라 돌봄 수업은 11/26(목)로 옮겨요.', (items) => r47Schedule(items, '2026-11-26', '돌봄 수업') && noDate(items, '2026-11-25')],
];
const r47People = [
    ['교감 선생님', '11/20(금)'],
    ['행정실장님께서', '11/24(화)'],
    ['과학 부장님', '11/27(금)'],
    ['최 선생님께서', '11/16(월)'],
    ['보건교사님께서', '11/23(월)'],
    ['연구부장님께서', '11/17(화)'],
];
const r47Leaves = ['공가', '파견', '육아시간', '반차', '경조사', '건강검진'];
const r47Ends = ['쓰십니다.', '이십니다.', '하십니다.', '가십니다.', '세요.', '안 계십니다.'];
let r47Var = 0;
r47People.forEach(([person, day]) => {
    r47Leaves.forEach((leave) => {
        const end = r47Ends[r47Var % r47Ends.length];
        r47Var += 1;
        r47Cases.push([`변형 ${r47Var} ${leave}`, `${person} ${day} ${leave} ${end}`, (items) => items.length === 0]);
    });
});
if (r47Var < 30) {
    console.error('r47 변형이 30개보다 적습니다.');
    process.exit(1);
}
let r47Ok = 0;
r47Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r47Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, title: item.title, include: item.include,
        }))));
    }
});
if (r47Ok !== r47Cases.length) {
    console.error(`r47 원문 ${r47Ok}/${r47Cases.length}`);
    process.exit(1);
}
console.log(`r47 원문 ${r47Ok}/${r47Cases.length}, 변형 ${r47Var}`);

function dirtyTitle(title) {
    const t = String(title || '').trim();
    if (/^(?:저는|제가)/.test(t)) return true;
    if (/(?:^|\s)(?:협조|오시기|보내|내|주|부탁)$/.test(t)) return true;
    if (/으$/.test(t)) return true;
    return /[가-힣]{2,}(?:으로|로|에|를|을)$/.test(t);
}
const r48Todo = (items, date, title) => items.length === 1 && items[0].kind === '할 일' && items[0].include !== false && items[0].date === date && items[0].title === title && !dirtyTitle(items[0].title);
const r48Event = (items, date, title) => items.length === 1 && items[0].kind === '일정' && items[0].include !== false && items[0].date === date && items[0].title === title && !dirtyTitle(items[0].title);
const r48Name = (items, title) => items.length === 1 && items[0].title === title && !dirtyTitle(items[0].title);
const r48Cases = [
    ['휴직 부터', '1학년 2반 담임 선생님께서 11/16(월)부터 휴직하십니다.', (items) => items.length === 0],
    ['지도 공개수업', '교장선생님께서 11/18(수) 직접 지도하시므로 학부모 공개수업에 참석해 주세요.', (items) => r48Event(items, '2026-11-18', '학부모 공개수업')],
    ['당직휴무 출석부', '교무부장님께서 11/19(목) 당직휴무이신데 출석부는 11/18(수)까지 내 주세요.', (items) => r48Todo(items, '2026-11-18', '출석부 제출') && noDate(items, '2026-11-19')],
    ['상담 주간', '학부모 상담 주간 운영에 협조 바랍니다', (items) => r48Name(items, '학부모 상담 주간')],
    ['체육 행사', '교직원 체육 행사에 오시기 바랍니다', (items) => r48Name(items, '교직원 체육 행사')],
    ['안전 점검표', '안전 점검표를 11/18(수)까지 보내 주세요', (items) => r48Todo(items, '2026-11-18', '안전 점검표 제출')],
    ['v35 교무실로', '문의 사항은 교무실로 연락 주세요. 11/9(월) 교직원 연수 15:00 시청각실', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-09' && item.time === '15:00' && item.title.includes('연수')) && items.every((item) => !item.title.includes('교무실로') && !dirtyTitle(item.title))],
    ['재택근무', '저는 11/19(목) 재택근무입니다.', (items) => r48Event(items, '2026-11-19', '재택근무')],
    ['검진 보결', '제가 11/20(금) 검진이라 1교시 보결 부탁드립니다.', (items) => r48Event(items, '2026-11-20', '1교시 보결')],
    ['A5 신청서 제출', '저도 참석하는 11/11(수) 출장 연수, 신청 11/3(화)까지예요.', (items) => included(items).some((item) => item.kind === '일정' && item.date === '2026-11-11' && item.title === '연수') && dueTodo(items, '2026-11-03', '연수 신청서 제출') && items.every((item) => !dirtyTitle(item.title))],
];
const r48Absence = [
    ['2학년 3반 담임 선생님께서', '11/17(화)', '휴직이십니다.'],
    ['3학년 1반 과학 선생님께서', '11/18(수)', '병가 가십니다.'],
    ['4학년 2반 국어 선생님', '11/19(목)', '연가이십니다.'],
    ['5학년 1반 보건교사님께서', '11/20(금)', '공가 쓰십니다.'],
    ['6학년 3반 부장님께서', '11/23(월)', '파견 가십니다.'],
    ['1학년 5반 행정실장님께서', '11/24(화)', '육아시간 쓰십니다.'],
];
r48Absence.forEach(([person, day, end], index) => {
    r48Cases.push([`변형 부재 ${index + 1}`, `${person} ${day}부터 ${end}`, (items) => items.length === 0]);
});
const r48Hosted = [
    ['교감 선생님께서 11/19(목) 진행하시므로 교직원 연수에 참석해 주세요.', '2026-11-19', '교직원 연수'],
    ['연구부장님께서 11/20(금) 직접 지도하시니 과학 발표회에 참석해 주세요.', '2026-11-20', '과학 발표회'],
    ['학년부장님께서 11/24(화) 진행하시므로 학부모 총회에 참석해 주세요.', '2026-11-24', '학부모 총회'],
    ['교장선생님께서 11/25(수) 지도하시므로 조회 행사에 참석해 주세요.', '2026-11-25', '조회 행사'],
];
r48Hosted.forEach(([text, date, title], index) => {
    r48Cases.push([`변형 일정 ${index + 1}`, text, (items) => r48Event(items, date, title)]);
});
const r48Titles = [
    ['학급 회의 운영에 협조 바랍니다', '', '학급 회의'],
    ['현장학습 행사에 오시기 바랍니다', '', '현장학습 행사'],
    ['독서 주간 운영에 협조 바랍니다', '', '독서 주간'],
    ['가정통신문을 11/19(목)까지 보내 주세요', '2026-11-19', '가정통신문 제출'],
    ['계획서를 11/20(금)까지 내 주세요', '2026-11-20', '계획서 제출'],
    ['동의서를 11/16(월)까지 보내 주세요', '2026-11-16', '동의서 제출'],
    ['설문지를 11/27(금)까지 보내 주세요', '2026-11-27', '설문지 제출'],
    ['교무부장님께서 11/23(월) 당직휴무이신데 회의록은 11/20(금)까지 내 주세요.', '2026-11-20', '회의록 제출'],
    ['행정실장님께서 11/25(수) 공가이신데 영수증은 11/24(화)까지 보내 주세요.', '2026-11-24', '영수증 제출'],
    ['연구부장님께서 11/26(목) 반차이신데 출장 복명서는 11/25(수)까지 내 주세요.', '2026-11-25', '출장 복명서 제출'],
];
r48Titles.forEach(([text, date, title], index) => {
    r48Cases.push([`변형 제목 ${index + 1}`, text, (items) => (date ? r48Todo(items, date, title) : r48Name(items, title))]);
});
const r48Own = [
    ['저는 11/26(목) 재택근무입니다.', '2026-11-26', '재택근무'],
    ['저는 11/27(금) 재택근무입니다.', '2026-11-27', '재택근무'],
    ['제가 11/23(월) 검진이라 2교시 보결 부탁드립니다.', '2026-11-23', '2교시 보결'],
    ['제가 11/25(수) 조퇴라 3교시 보결 부탁드립니다.', '2026-11-25', '3교시 보결'],
    ['제가 11/30(월) 외출이라 4교시 보결 부탁드립니다.', '2026-11-30', '4교시 보결'],
];
r48Own.forEach(([text, date, title], index) => {
    r48Cases.push([`변형 본인 ${index + 1}`, text, (items) => r48Event(items, date, title)]);
});
const r48Var = r48Cases.length - 10;
if (r48Var < 20) {
    console.error('r48 변형이 20개보다 적습니다.');
    process.exit(1);
}
let r48Ok = 0;
r48Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r48Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, title: item.title, include: item.include,
        }))));
    }
});
if (r48Ok !== r48Cases.length) {
    console.error(`r48 원문 ${r48Ok}/${r48Cases.length}`);
    process.exit(1);
}
console.log(`r48 원문 ${r48Ok}/${r48Cases.length}, 변형 ${r48Var}`);

const r49One = (items, title, extra = () => true) => items.length === 1 && items[0].title === title && !dirtyTitle(items[0].title) && extra(items[0]);
const r49Has = (items, date, title) => items.some((item) => item.date === date && item.title === title) && items.every((item) => !dirtyTitle(item.title));
const r49Cases = [
    ['쉼표 보결', '김교사 출장으로 5,6교시 보결 부탁드립니다', (items) => r49One(items, '5,6교시 보결', (item) => item.period === 5 && item.periodEnd === 6)],
    ['연수 보결', '11/20(금) 이선생님 연수로 3교시 보결 부탁드립니다.', (items) => r49One(items, '3교시 보결', (item) => item.kind === '일정' && item.date === '2026-11-20' && item.include !== false)],
    ['장소 3층', '11/2(월) 협의회 장소가 3층으로 바뀌었습니다.', (items) => r49One(items, '협의회 장소 3층', (item) => item.kind === '일정' && item.date === '2026-11-02' && item.include !== false)],
    ['양식 복명서', '제가 보낸 11/5(목) 출장 복명서 양식으로 11/9(월)까지 제출해 주세요.', (items) => r49Has(items, '2026-11-09', '출장 복명서 제출')],
    ['기한 내', '기한 내 제출하지 못한 분은 10/30(금)까지 다시 올려 주세요.', (items) => r49One(items, '다시 올리기', (item) => item.kind === '할 일' && item.date === '2026-10-30' && item.include !== false && !/제출/.test(item.title))],
    ['결과물', '지난해 과학전람회(11/10) 결과물 보내 드려요.', (items) => r49One(items, '과학전람회 결과물', (item) => item.include === false && item.date === '2025-11-10' && !/제출/.test(item.title))],
    ['A5 원문', '제가 11/10(화) 출장 연수 신청서 모아서 냅니다. 11/6(금)까지 주세요.', (items) => dueTodo(items, '2026-11-06', '연수 신청서 제출') && items.every((item) => !dirtyTitle(item.title))],
];
[
    ['박교사 병가로 1,2교시 보결 부탁드립니다', '', '1,2교시 보결'],
    ['11/18(수) 김선생님 연가로 4교시 보결 부탁드립니다.', '2026-11-18', '4교시 보결'],
    ['최교사 공가로 2교시 보결 부탁드립니다', '', '2교시 보결'],
    ['11/23(월) 학년부장님 출장으로 5~6교시 보결 부탁드립니다.', '2026-11-23', '5~6교시 보결'],
    ['11/25(수) 행정실장님 외출로 6교시 보결 부탁드립니다.', '2026-11-25', '6교시 보결'],
    ['11/27(금) 연구부장님 반차로 1교시 보결 부탁드립니다.', '2026-11-27', '1교시 보결'],
].forEach(([text, date, title], index) => {
    r49Cases.push([`변형 보결 ${index + 1}`, text, (items) => r49One(items, title, (item) => item.kind === '일정' && (date ? item.date === date : true))]);
});
[
    ['11/4(수) 교직원 회의 장소가 강당으로 바뀌었습니다.', '2026-11-04', '교직원 회의 장소 강당'],
    ['11/6(금) 연수 장소가 과학실로 바뀌었습니다.', '2026-11-06', '연수 장소 과학실'],
    ['11/9(월) 상담 장소가 도서관으로 바뀌어요.', '2026-11-09', '상담 장소 도서관'],
    ['11/12(목) 학년 회의 장소가 2층으로 바뀌었습니다.', '2026-11-12', '학년 회의 장소 2층'],
    ['11/19(목) 설명회 장소가 시청각실로 바뀌었습니다.', '2026-11-19', '설명회 장소 시청각실'],
].forEach(([text, date, title], index) => {
    r49Cases.push([`변형 장소 ${index + 1}`, text, (items) => r49One(items, title, (item) => item.kind === '일정' && item.date === date && item.include !== false)]);
});
[
    ['제가 보낸 11/12(목) 체험학습 계획서 양식으로 11/16(월)까지 제출해 주세요.', '2026-11-16', '체험학습 계획서 제출'],
    ['제가 보낸 11/18(수) 가정통신문 양식으로 11/17(화)까지 제출해 주세요.', '2026-11-17', '가정통신문 제출'],
].forEach(([text, date, title], index) => {
    r49Cases.push([`변형 양식 ${index + 1}`, text, (items) => r49Has(items, date, title)]);
});
[
    ['기한 내 제출하지 못한 분은 11/3(화)까지 다시 올려 주세요.', '2026-11-03'],
    ['기한 내 제출하지 못한 분은 11/6(금)까지 다시 올려 주세요.', '2026-11-06'],
].forEach(([text, date], index) => {
    r49Cases.push([`변형 기한 ${index + 1}`, text, (items) => r49One(items, '다시 올리기', (item) => item.kind === '할 일' && item.date === date && item.include !== false)]);
});
[
    ['작년 학예회(11/12) 사진 보내 드려요.', '2025-11-12', '학예회 사진'],
    ['지난해 축제(11/18) 영상 보내 드려요.', '2025-11-18', '축제 영상'],
    ['재작년 운동회(11/8) 녹화본 보내 드려요.', '2024-11-08', '운동회 녹화본'],
].forEach(([text, date, title], index) => {
    r49Cases.push([`변형 자료 ${index + 1}`, text, (items) => r49One(items, title, (item) => item.include === false && item.date === date && !/제출/.test(item.title))]);
});
[
    ['제가 11/13(금) 출장 연수 신청서 모아서 냅니다. 11/11(수)까지 주세요.', '2026-11-11'],
    ['제가 11/17(화) 출장 연수 신청서 모아서 냅니다. 11/13(금)까지 주세요.', '2026-11-13'],
].forEach(([text, date], index) => {
    r49Cases.push([`변형 신청서 ${index + 1}`, text, (items) => dueTodo(items, date, '연수 신청서 제출') && items.every((item) => !dirtyTitle(item.title))]);
});
const r49Var = r49Cases.length - 7;
if (r49Var < 15) {
    console.error('r49 변형이 15개보다 적습니다.');
    process.exit(1);
}
let r49Ok = 0;
r49Cases.forEach(([label, text, ok]) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    if (ok(items)) r49Ok += 1;
    else {
        console.error(label, text, JSON.stringify(items.map((item) => ({
            kind: item.kind, date: item.date, title: item.title, include: item.include,
        }))));
    }
});
if (r49Ok !== r49Cases.length) {
    console.error(`r49 원문 ${r49Ok}/${r49Cases.length}`);
    process.exit(1);
}
console.log(`r49 원문 ${r49Ok}/${r49Cases.length}, 변형 ${r49Var}`);

const includeCountRows = [
    ['r34', r34Cases], ['r35', r35Cases], ['r36', r36Cases], ['r37', r37Cases], ['r38', r38Cases],
    ['r39', r39Cases], ['r40', r40Cases], ['r41', r41Cases], ['r42', r42Cases], ['r43', r43Cases], ['r44', r44Cases], ['r45', r45Cases], ['r46', r46Cases], ['r47', r47Cases], ['r48', r48Cases], ['r49', r49Cases],
];
const includeCountPath = new URL('./include-counts.json', import.meta.url);
const includeCountNow = {};
includeCountRows.forEach(([name, rows]) => {
    rows.forEach(([label, text]) => {
        const [todo, event] = includedPair(parseSchoolMessages(text, { now: qaNow }).items);
        includeCountNow[`${name}\t${label}\t${text}`] = [todo, event];
    });
});
if (process.env.RECORD_COUNTS === '1') {
    writeFileSync(includeCountPath, `${JSON.stringify(includeCountNow, null, 2)}\n`);
    console.log(`include 개수 ${Object.keys(includeCountNow).length}개를 기록했습니다.`);
} else {
    const savedCounts = JSON.parse(readFileSync(includeCountPath, 'utf8'));
    let countMiss = 0;
    Object.entries(includeCountNow).forEach(([key, pair]) => {
        const expected = savedCounts[key];
        if (!expected || expected[0] !== pair[0] || expected[1] !== pair[1]) {
            countMiss += 1;
            console.error('include 개수가 기대와 다릅니다.', key.split('\t')[1], `할 일 ${pair[0]} 일정 ${pair[1]}`, expected ? `기대 할 일 ${expected[0]} 일정 ${expected[1]}` : '기대값 없음');
        }
    });
    if (countMiss || Object.keys(savedCounts).length !== Object.keys(includeCountNow).length) {
        console.error('문장마다 include된 할 일·일정 개수를 확인하지 못했습니다.');
        process.exit(1);
    }
    console.log(`include 개수 ${Object.keys(includeCountNow).length}문장 확인`);
}

function bundleYellow(cases) {
    let cards = 0;
    let yellow = 0;
    let yellowSentences = 0;
    cases.forEach((row) => {
        const items = parseSchoolMessages(row[1], { now: qaNow }).items;
        let saw = false;
        items.forEach((item) => {
            cards += 1;
            if (item.include === false) {
                yellow += 1;
                saw = true;
            }
        });
        if (saw) yellowSentences += 1;
    });
    const pct = cards ? Math.round((yellow / cards) * 1000) / 10 : 0;
    const sentencePct = cases.length ? Math.round((yellow / cases.length) * 1000) / 10 : 0;
    const sentenceHitPct = cases.length ? Math.round((yellowSentences / cases.length) * 1000) / 10 : 0;
    return { cards, yellow, pct, sentences: cases.length, yellowSentences, sentencePct, sentenceHitPct };
}
const v40Bundle = bundleYellow(r40Cases);
const v41Bundle = bundleYellow(r41Cases);
console.log(`v40 묶음 노란 카드 ${v40Bundle.yellow}/${v40Bundle.cards} (${v40Bundle.pct}%), 문장당 ${v40Bundle.yellow}/${v40Bundle.sentences} (${v40Bundle.sentencePct}%), 노란 문장 ${v40Bundle.yellowSentences}/${v40Bundle.sentences} (${v40Bundle.sentenceHitPct}%)`);
console.log(`v41 묶음 노란 카드 ${v41Bundle.yellow}/${v41Bundle.cards} (${v41Bundle.pct}%), 문장당 ${v41Bundle.yellow}/${v41Bundle.sentences} (${v41Bundle.sentencePct}%), 노란 문장 ${v41Bundle.yellowSentences}/${v41Bundle.sentences} (${v41Bundle.sentenceHitPct}%)`);
// 측정값은 v40 30.5/33.3/22.2, v41 20/20/17.8입니다. 상한은 거기에 2%p를 더한 여유입니다.
// 문장별 include 개수가 소실을 잡으므로 카드 분모만 줄여 비율을 통과할 수 없습니다.
const yellowCap = {
    v40Card: 32.5,
    v40Sentence: 35.3,
    v40Hit: 24.2,
    v41Card: 22,
    v41Sentence: 22,
    v41Hit: 19.8,
};
if (v40Bundle.pct > yellowCap.v40Card || v40Bundle.sentencePct > yellowCap.v40Sentence || v40Bundle.sentenceHitPct > yellowCap.v40Hit
    || v41Bundle.pct > yellowCap.v41Card || v41Bundle.sentencePct > yellowCap.v41Sentence || v41Bundle.sentenceHitPct > yellowCap.v41Hit) {
    console.error('v40·v41 묶음 노란 카드 비율 상한');
    process.exit(1);
}

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
const fair = parseSchoolMessages('10/30(금) 오전 10시~오후 1시 진로 박람회', { now: qaNow });
const fairSave = await saveParsed(fair.items, qaNow);
const fairRow = snapshot().events.find((row) => String(row.title).includes('박람회'));
const fairCloud = toCloudRow('events', fairRow || {});
const fairFallback = eventBodyWithoutEndTime(fairCloud?.body);
if (!fairSave.ok || fair.items[0]?.kind !== '일정' || fair.items[0]?.include === false || !fairRow || fairRow.time !== '10:00' || fairRow.endTime !== '13:00' || fairCloud?.body?.time !== '10:00' || fairCloud?.body?.endTime !== '13:00' || !fairFallback || fairFallback.endTime || fairFallback.time !== '10:00' || !String(fairFallback.memo || '').includes('13:00까지')) {
    console.error('끝 시각이 클라우드 일정에 실리거나, 거절 시 메모로 돌아가지 않습니다.', fair.items, fairRow, fairCloud, fairFallback);
    process.exit(1);
}
const plain = snapshot().events.find((row) => row.title === '수학여행');
if (!plain || plain.endTime) {
    console.error('끝 시각이 없는 기존 일정에 endTime이 생겼습니다.');
    process.exit(1);
}
resetEndTimeUpload();
const spanCloud = toCloudRow('events', {
    id: 'span1', date: '2026-10-30', title: '학부모 진로 특강', time: '14:00', endTime: '16:00', kind: '학급', memo: '강당', source: 'msg',
});
const firstPlan = prepareEventWrite(spanCloud.body);
noteEndTimeRejected();
const memoPlan = prepareEventWrite(spanCloud.body);
const againPlan = prepareEventWrite(spanCloud.body);
resetEndTimeUpload();
const restarted = prepareEventWrite(spanCloud.body);
if (!firstPlan.retryWithoutEndTime || firstPlan.body.endTime !== '16:00' || endTimeUploadBlocked() || memoPlan.retryWithoutEndTime || memoPlan.body.endTime || !String(memoPlan.body.memo).includes('강당') || !String(memoPlan.body.memo).includes('16:00까지') || JSON.stringify(againPlan.body) !== JSON.stringify(memoPlan.body) || restarted.body.endTime !== '16:00' || !restarted.retryWithoutEndTime || endTimeUploadBlocked()) {
    console.error('끝 시각 거절을 기억하지 못했거나, 다시 시작해도 재시도하지 않습니다.', firstPlan, memoPlan, restarted);
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

const unseen = { n: 0, ok: 0, miss: [] };
MSG_UNSEEN.forEach((row) => {
    const items = parseSchoolMessages(row.text, { now: MSG_NOW }).items;
    unseen.n += 1;
    if (row.ok(items)) unseen.ok += 1;
    else {
        unseen.miss.push({
            id: row.id,
            got: items.map((item) => ({
                kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low,
            })),
        });
    }
});
const unseenPct = unseen.n ? Math.round((unseen.ok / unseen.n) * 1000) / 10 : 0;
console.log(`이번 규칙 뒤 한 번만 본 예문 ${unseen.ok}/${unseen.n} (${unseenPct}%)`);
if (unseen.miss.length) console.log(JSON.stringify(unseen.miss, null, 2));

const year = { n: 0, ok: 0, miss: [] };
MSG_YEAR.forEach((row) => {
    const items = parseSchoolMessages(row.text, { now: MSG_NOW }).items;
    year.n += 1;
    if (row.ok(items)) year.ok += 1;
    else {
        year.miss.push({
            id: row.id,
            got: items.map((item) => ({
                kind: item.kind, date: item.date, time: item.time, title: item.title, include: item.include, low: item.low, eventKind: item.eventKind, warning: item.warning,
            })),
        });
    }
});
const yearPct = year.n ? Math.round((year.ok / year.n) * 1000) / 10 : 0;
console.log(`연도 표기를 섞어 한 번만 본 예문 ${year.ok}/${year.n} (${yearPct}%)`);
if (year.miss.length) console.log(JSON.stringify(year.miss, null, 2));

const move = { n: 0, ok: 0, miss: [] };
MSG_MOVE.forEach((row) => {
    const items = parseSchoolMessages(row.text, { now: MSG_NOW }).items;
    move.n += 1;
    if (row.ok(items)) move.ok += 1;
    else {
        move.miss.push({
            id: row.id,
            got: items.map((item) => ({
                kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low,
            })),
        });
    }
});
const movePct = move.n ? Math.round((move.ok / move.n) * 1000) / 10 : 0;
console.log(`날짜 이동과 상대 날짜를 한 번만 본 예문 ${move.ok}/${move.n} (${movePct}%)`);
if (move.miss.length) console.log(JSON.stringify(move.miss, null, 2));

const shift = { n: 0, ok: 0, miss: [] };
MSG_SHIFT.forEach((row) => {
    const items = parseSchoolMessages(row.text, { now: MSG_NOW }).items;
    shift.n += 1;
    if (row.ok(items)) shift.ok += 1;
    else {
        shift.miss.push({
            id: row.id,
            got: items.map((item) => ({
                kind: item.kind, date: item.date, end: item.end, time: item.time, title: item.title, include: item.include, low: item.low,
            })),
        });
    }
});
const shiftPct = shift.n ? Math.round((shift.ok / shift.n) * 1000) / 10 : 0;
console.log(`날짜를 옮기는 말을 섞어 한 번만 본 예문 ${shift.ok}/${shift.n} (${shiftPct}%)`);
if (shift.miss.length) console.log(JSON.stringify(shift.miss, null, 2));

const doubt = { n: 0, ok: 0, silent: 0, miss: [] };
MSG_DOUBT.forEach((row) => {
    const items = parseSchoolMessages(row.text, { now: MSG_NOW }).items;
    doubt.n += 1;
    if (row.ok(items)) doubt.ok += 1;
    else {
        doubt.miss.push({
            id: row.id,
            got: items.map((item) => ({
                kind: item.kind, date: item.date, end: item.end, time: item.time, period: item.period, title: item.title, include: item.include, low: item.low,
            })),
        });
    }
    if (row.silent(items)) doubt.silent += 1;
});
const doubtPct = doubt.n ? Math.round((doubt.ok / doubt.n) * 1000) / 10 : 0;
console.log(`모호하면 빼 두는 규칙을 한 번만 본 예문 ${doubt.ok}/${doubt.n} (${doubtPct}%)`);
console.log(`그중 조용히 틀린 문장 ${doubt.silent}개`);
if (doubt.miss.length) console.log(JSON.stringify(doubt.miss, null, 2));
if (doubt.silent > 0 || doubt.ok < 21) {
    console.error('모호 예문이 21/22보다 낮거나 무음 오류가 있습니다.');
    process.exit(1);
}

function countYellow(rows, now) {
    let cards = 0;
    let yellow = 0;
    rows.forEach((row) => {
        parseSchoolMessages(row.text, { now }).items.forEach((item) => {
            cards += 1;
            if (item.include === false) yellow += 1;
        });
    });
    return { cards, yellow };
}
const yellowBuckets = [
    ['예문', MSG_SAMPLES],
    ['확인', MSG_HOLDOUT],
    ['보지 않은', MSG_BLIND],
    ['새로 둔', MSG_FRESH],
    ['한 번만', MSG_UNSEEN],
    ['연도', MSG_YEAR],
    ['이동', MSG_MOVE],
    ['옮김', MSG_SHIFT],
    ['모호', MSG_DOUBT],
];
let yellowCards = 0;
let yellowAll = 0;
yellowBuckets.forEach(([name, rows]) => {
    const counted = countYellow(rows, MSG_NOW);
    yellowCards += counted.cards;
    yellowAll += counted.yellow;
    const pct = counted.cards ? Math.round((counted.yellow / counted.cards) * 1000) / 10 : 0;
    console.log(`노란 카드 ${name} ${counted.yellow}/${counted.cards} (${pct}%)`);
});
const yellowPct = yellowCards ? Math.round((yellowAll / yellowCards) * 1000) / 10 : 0;
console.log(`노란 카드 전체 ${yellowAll}/${yellowCards} (${yellowPct}%)`);
if (yellowPct > 30) {
    console.error('노란 카드 비율이 30%를 넘습니다.');
    process.exit(1);
}

function messageSentences(text) {
    const src = String(text || '').trim();
    if (!src) return [];
    const parts = [];
    let start = 0;
    for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        if (!/[.!?。！？\n]/.test(ch)) continue;
        if ((ch === '.' || ch === '。') && /\d/.test(src[i - 1] || '')) continue;
        const chunk = src.slice(start, i + 1).trim();
        if (chunk) parts.push(chunk);
        start = i + 1;
    }
    const tail = src.slice(start).trim();
    if (tail) parts.push(tail);
    return parts;
}
const invariantTexts = [
    ...MSG_SAMPLES,
    ...MSG_HOLDOUT,
    ...MSG_BLIND,
    ...MSG_FRESH,
    ...MSG_UNSEEN,
    ...MSG_YEAR,
    ...MSG_MOVE,
    ...MSG_SHIFT,
    ...MSG_DOUBT,
].map((row) => row.text);
[
    r31Cases, r32Cases, r33Cases, r34Cases, r35Cases, r36Cases, r37Cases, r38Cases, r39Cases, r40Cases, r41Cases, r42Cases, r43Cases, r44Cases, r45Cases, r46Cases, r47Cases, r48Cases, r49Cases,
].forEach((rows) => rows.forEach((row) => invariantTexts.push(row[1])));
let datedSentences = 0;
let emptySentences = 0;
invariantTexts.forEach((text) => {
    messageSentences(text).forEach((sentence) => {
        if (!findDates(sentence, qaNow).length && !findDates(sentence, MSG_NOW).length) return;
        datedSentences += 1;
        const now = findDates(sentence, qaNow).length ? qaNow : MSG_NOW;
        if (!parseSchoolMessages(sentence, { now }).items.length) {
            if (silentOtherAbsence(sentence, now)) return;
            emptySentences += 1;
            console.error('날짜가 있는데 직함의 부재·연수 서술도 아닌데 카드가 없습니다.', sentence);
        }
    });
});
console.log(`날짜 있는 문장 ${datedSentences}개 중 빈 결과 ${emptySentences}개`);
if (!datedSentences || emptySentences) {
    console.error('날짜가 있는 문장은 최소한 노란 카드가 있어야 합니다.');
    process.exit(1);
}
const coreTexts = [
    ...MSG_SAMPLES,
    ...MSG_HOLDOUT,
    ...MSG_BLIND,
    ...MSG_FRESH,
    ...MSG_UNSEEN,
    ...MSG_YEAR,
    ...MSG_MOVE,
    ...MSG_SHIFT,
    ...MSG_DOUBT,
].map((row) => row.text);
[r31Cases, r32Cases, r33Cases, r34Cases, r35Cases, r36Cases, r37Cases, r38Cases, r39Cases].forEach((rows) => {
    rows.forEach((row) => coreTexts.push(row[1]));
});
let coreDated = 0;
let coreEmpty = 0;
coreTexts.forEach((text) => {
    messageSentences(text).forEach((sentence) => {
        if (!findDates(sentence, qaNow).length && !findDates(sentence, MSG_NOW).length) return;
        coreDated += 1;
        const now = findDates(sentence, qaNow).length ? qaNow : MSG_NOW;
        if (!parseSchoolMessages(sentence, { now }).items.length) {
            coreEmpty += 1;
            console.error('불변식 문장에 항목이 없습니다.', sentence);
        }
    });
});
console.log(`불변식 문장 ${coreDated}개 중 빈 결과 ${coreEmpty}개`);
if (coreEmpty) {
    console.error('날짜가 있는 불변식 문장은 항목이 있어야 합니다.');
    process.exit(1);
}
function barePostponement(text) {
    const src = String(text || '');
    if (/우천|미루지\s*않|연기(?:하지\s*않|\s*없이)|다음\s*날/.test(src)) return false;
    if (/(?:\d|[)）])\s*(?:으로|로)\s*(?:미룹|미뤄|미루|연기)/.test(src) && findDates(src, qaNow).length >= 2) return false;
    if (/날짜는\s*\d/.test(src) && /미룹|미뤄|다음에|추후/.test(src)) return false;
    return /(?:미룹|미뤄|미루었|미뤘|미룸|(?<![가-힣])미루|다음에\s*(?:하겠|합니|해요|하십)|추후|다음\s*으로|(?<![가-힣])연기(?!된|한))/.test(src);
}
function duplicateTarget(items) {
    for (let i = 0; i < items.length; i += 1) {
        for (let j = i + 1; j < items.length; j += 1) {
            const left = items[i];
            const right = items[j];
            if ((left.date || '') !== (right.date || '') || (left.time || '') !== (right.time || '') || (left.end || '') !== (right.end || '')) continue;
            const a = String(left.title || '').replace(/\s+/g, '');
            const b = String(right.title || '').replace(/\s+/g, '');
            if (!a || !b || a.length < 2 || b.length < 2) continue;
            if (a === b || a.includes(b) || b.includes(a)) return true;
        }
    }
    return false;
}
let leaked = 0;
let postponedEmpty = 0;
let duplicated = 0;
invariantTexts.forEach((text) => {
    const items = parseSchoolMessages(text, { now: qaNow }).items;
    const absent = new Set(leakedAbsenceDates(text, qaNow));
    if (items.some((item) => item.include !== false && absent.has(item.date))) {
        leaked += 1;
        console.error('남의 부재 날짜가 넣는 카드에 있습니다.', text);
    }
    if (barePostponement(text) && findDates(text, qaNow).length && !items.length) {
        postponedEmpty += 1;
        console.error('미룸 문장에 카드가 없습니다.', text);
    }
    if (duplicateTarget(items)) {
        duplicated += 1;
        console.error('같은 날짜·같은 대상 카드가 두 장입니다.', text, JSON.stringify(items.map((item) => ({ date: item.date, time: item.time, title: item.title }))));
    }
});
if (leaked || postponedEmpty || duplicated) {
    console.error(`부재 날짜 ${leaked}, 미룸 0장 ${postponedEmpty}, 중복 ${duplicated}`);
    process.exit(1);
}
console.log('남의 부재 날짜는 넣지 않고, 미룸은 카드가 있으며, 같은 날짜의 같은 대상은 한 장입니다.');
const bareTitle = /^(?:일정|또는|신청|마감은|있습니다|합니다|해요|갑니다|엽니다|봅니다|봐요|드립니다|주세요|마감)$/;
const eventNoun = /연수|대회|학예회|설명회|박람회|축제|체험학습|현장학습|수련회|협의회|공개수업|체육대회|운동회|발표회|강연|발표/;
let bareIncluded = 0;
invariantTexts.forEach((text) => {
    if (!eventNoun.test(text)) return;
    const now = findDates(text, qaNow).length ? qaNow : MSG_NOW;
    parseSchoolMessages(text, { now }).items.forEach((item) => {
        if (item.include === false) return;
        const compact = String(item.title || '').replace(/\s+/g, '');
        if (!bareTitle.test(compact) && !/^(?:할 일)$/.test(String(item.title || '').trim())) return;
        if (compact === '마감' && !eventNoun.test(String(item.raw || ''))) return;
        bareIncluded += 1;
        console.error('넣은 제목이 행사명이 아닙니다.', item.title, text);
    });
});
if (bareIncluded) {
    console.error(`말만 남은 제목 ${bareIncluded}개`);
    process.exit(1);
}
console.log('넣은 항목의 제목에 일정·또는·신청·마감·있습니다·동사 어미가 홀로 남지 않습니다.');
let dirtyTitles = 0;
invariantTexts.forEach((text) => {
    const now = findDates(text, qaNow).length ? qaNow : MSG_NOW;
    parseSchoolMessages(text, { now }).items.forEach((item) => {
        if (!dirtyTitle(item.title)) return;
        dirtyTitles += 1;
        console.error('제목이 조사·요청어로 끝나거나 저는·제가로 시작하거나 으로 끝납니다.', item.title, text);
    });
});
if (dirtyTitles) {
    console.error(`정리되지 않은 제목 ${dirtyTitles}개`);
    process.exit(1);
}
console.log('제목이 조사·요청어로 끝나거나 저는·제가로 시작하거나 으로 끝나지 않습니다.');
const timeOnlyTitle = /^(?:올해|작년|이번|다음|이번주|다음주|다다음주)(?:는|은)?(?:입니다|해요|합니다|했어요|했습니다|이에요|예요|에요)?$/;
let timeTitles = 0;
invariantTexts.forEach((text) => {
    const now = findDates(text, qaNow).length ? qaNow : MSG_NOW;
    parseSchoolMessages(text, { now }).items.forEach((item) => {
        const compact = String(item.title || '').replace(/\s+/g, '');
        if (!timeOnlyTitle.test(compact)) return;
        timeTitles += 1;
        console.error('시간어만 남은 제목', item.title, text);
    });
});
if (timeTitles) {
    console.error(`시간어 제목 ${timeTitles}개`);
    process.exit(1);
}
console.log('넣은 제목과 노란 카드에 올해·작년·이번·다음·이번 주·다음 주만 남지 않습니다.');
