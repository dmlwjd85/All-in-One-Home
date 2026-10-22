/** 학교 메시지 예문을 읽고 유형·날짜·시각·제목 정확도를 확인합니다. */
import { gradeMessages, parseSchoolMessages } from '../src/lib/msgParse.js';
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
must('이번 달 말', '이번 달 말까지 가정통신문 회신 바랍니다', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-10-31' && items[0].title === '가정통신문 회신' && items[0].include === false && /대략/.test(items[0].warning));
must('다음 달 초', '다음 달 초 교직원 연수', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-11-01' && items[0].title === '교직원 연수' && items[0].include === false && /대략/.test(items[0].warning));
must('앞당김', '10/29(목)에서 10/27(화) 15:00로 앞당겨졌습니다', qaNow, (items) => items.filter((item) => item.include !== false).length === 1 && items.some((item) => item.include !== false && item.kind === '일정' && item.date === '2026-10-27' && item.time === '15:00') && items.some((item) => item.date === '2026-10-29' && item.include === false && item.low === true));
must('요일 이동', '다음주 월요일에서 수요일로', qaNow, (items) => items.filter((item) => item.include !== false).length === 1 && items.some((item) => item.include !== false && item.date === '2026-10-28') && items.some((item) => item.date === '2026-10-26' && item.include === false));
must('기간 이동', '11/16~11/20에서 11/23~11/27로', qaNow, (items) => items.some((item) => item.include !== false && item.kind === '일정' && item.date === '2026-11-23' && item.end === '2026-11-27') && items.some((item) => item.date === '2026-11-16' && item.end === '2026-11-20' && item.include === false));
must('월 없는 기간', '25~27일 학년 연구실 공사', qaNow, (items) => items.length === 1 && items[0].kind === '일정' && items[0].date === '2026-10-25' && items[0].end === '2026-10-27' && items[0].title === '학년 연구실 공사' && !/\d/.test(items[0].title));
must('취소', '10/30 현장체험학습이 취소되었습니다', qaNow, (items) => items.length === 1 && items[0].include === false && items[0].low === true && items[0].date === '2026-10-30');
must('시간 마감', '다음 달 말까지 연수 30시간 이수 확인', qaNow, (items) => items.length === 1 && items[0].kind === '할 일' && items[0].date === '2026-11-30' && items[0].title.includes('30시간') && items[0].title.includes('연수') && items[0].include === false && /대략/.test(items[0].warning));
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
    ['작년과 올해', '작년 학예회는 11/10, 올해는 11/20', (items) => yellowDated(items, '2025-11-10') && items.some((item) => item.date === '2026-11-20' && item.include !== false && item.title.includes('학예회')) && !items.some((item) => item.date === '2026-11-10' && item.include !== false) && !quietCard(items.filter((item) => item.date === '2025-11-10'))],
    ['지난해 비인접', '지난해 현장학습은 11월 5일에 갔습니다', (items) => items.length === 1 && items[0].date === '2025-11-05' && items[0].include === false && items[0].title.includes('현장학습') && /지난/.test(items[0].warning)],
    ['작년에는', '작년에는 10/30 소풍이었습니다', (items) => yellowDated(items, '2025-10-30') && items.every((item) => item.include === false) && items.some((item) => item.title.includes('소풍'))],
    ['작년 다음 문장', '작년 학예회 사진입니다. 11/10에 찍었습니다', (items) => yellowDated(items, '2025-11-10') && !items.some((item) => item.include !== false)],
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
