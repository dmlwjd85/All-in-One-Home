/**
 * PR E 검사: 출결 마감 단추 · / 키 쨈 빠른 입력 · 문장 역할(시간구·행동 어간·어미) · 기본 단축키 · 기본 환경 추천값.
 * E_ROOT를 주면 그 폴더의 src를 검사합니다(변이 검사에서 바꾼 사본을 넣어 봅니다).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = process.env.E_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = (rel) => import(pathToFileURL(resolve(root, rel)).href);
const src = (rel) => readFileSync(resolve(root, rel), 'utf8');
const failures = [];
let count = 0;
const check = (ok, msg) => { count += 1; if (!ok) failures.push(msg); };
const eq = (got, want, msg) => check(JSON.stringify(got) === JSON.stringify(want), `${msg}: ${JSON.stringify(got)} ≠ ${JSON.stringify(want)}`);

const tp = await load('src/lib/timePhrase.js');
const hk = await load('src/ui/hotkeys.js');
const jp = await load('src/lib/jjaemPaste.js');
const sd = await load('src/lib/schoolDefaults.js');
const qm = await load('src/ui/quickMatch.js');

/* ───── 0. 시계 시각(콜론·숫자·한글·정오·자정) ───── */
const CLOCK_NOW = new Date('2026-11-09T08:00:00+09:00');
const CLOCK_CORPUS = [
    // [문장, 시각, 날짜(빈 칸=날짜 없음), 남는 본문]
    ['15:30 협의회', '15:30', '', '협의회'],
    ['내일 15:30 협의회', '15:30', '2026-11-10', '협의회'],
    ['오전 10:30 학부모 상담', '10:30', '', '학부모 상담'],
    ['오후 3:05 버스 출발', '15:05', '', '버스 출발'],
    ['오후 12:30 급식 점검', '12:30', '', '급식 점검'],
    ['09:00 조회', '09:00', '', '조회'],
    ['8:40 교문 지도', '08:40', '', '교문 지도'],
    ['2:30 보충 수업', '14:30', '', '보충 수업'],
    ['오후 15:30 회의', '15:30', '', '회의'],
    ['3시 반 회의', '15:30', '', '회의'],
    ['15시 제출', '15:00', '', '제출'],
    ['4시 20분 출장', '16:20', '', '출장'],
    ['다음 주 월요일 9시 회의', '09:00', '2026-11-16', '회의'],
    ['오후 세시 회의', '15:00', '', '회의'],
    ['세 시에 상담', '15:00', '', '상담'],
    ['오전 열한 시 공개수업', '11:00', '', '공개수업'],
    ['열두 시 반 급식', '12:30', '', '급식'],
    ['정오에 방송', '12:00', '', '방송'],
    ['자정까지 성적 입력', '23:59', '', '성적 입력'],
    ['밤 12시 서버 점검', '00:00', '', '서버 점검'],
    ['내일 오후 2:00 연수', '14:00', '2026-11-10', '연수'],
    ['오후 3시반 회의', '15:30', '', '회의'],
    ['3시반 회의', '15:30', '', '회의'],
    ['15시 30분 제출', '15:30', '', '제출'],
    ['내일 아침 9시 회의', '09:00', '2026-11-10', '회의'],
    ['내일 저녁 7시 회식', '19:00', '2026-11-10', '회식'],
    ['모레 오전 10:30 공개수업', '10:30', '2026-11-11', '공개수업'],
    ['정오쯤 방송', '12:00', '', '방송'],
    ['자정 전 성적 입력', '23:59', '', '성적 입력'],
    ['자정에 서버 점검', '00:00', '', '서버 점검'],
    ['2학년 1:30 출발', '13:30', '', '2학년 출발'],
    ['10:30 점검', '10:30', '', '점검'],
];
/* 평점관 r79-2 P1-1: 점수 낱말과 닮은 말이 붙어도 진짜 시각은 시각+알림으로 남습니다(낱말 경계). */
CLOCK_CORPUS.push(
    ['행사 준비 15:30 시작', '15:30', '', '행사 준비 시작'],
    ['학급비 16:00까지 걷기', '16:00', '', '학급비 걷기'],
    ['성적 17:00까지 입력', '17:00', '', '성적 입력'],
    ['체육대회 경기 15:00 시작', '15:00', '', '체육대회 경기 시작'],
    ['16:00 패들렛 정리', '16:00', '', '패들렛 정리'],
    ['15:30 승진 심사', '15:30', '', '승진 심사'],
    ['14:00 점호', '14:00', '', '점호'],
    ['회의 14:00으로 지정', '14:00', '', '회의 지정'],
    ['비품 15:00 정리', '15:00', '', '비품 정리'],
    ['경기 결과 15:00 발표', '15:00', '', '경기 결과 발표'],
    /* P2: 전각 콜론, 콜론 뒤 시·분 */
    ['15：30 협의회', '15:30', '', '협의회'],
    ['13:00시 회의', '13:00', '', '회의'],
    ['12:30분에 급식', '12:30', '', '급식'],
);
/* P1-2: 범위(10:30~11:20, 오후 2시~3시)는 한 덩어리로 빼고 time·endTime으로 돌려줍니다. 제목에 「~」가 남지 않습니다. */
for (const [text, time, endTime, body] of [
    ['10:30~11:20 보강 수업', '10:30', '11:20', '보강 수업'],
    ['10:30 ~ 11:20 보강 수업', '10:30', '11:20', '보강 수업'],
    ['10：30～11：20 보강 수업', '10:30', '11:20', '보강 수업'],
    ['오후 2시~3시 연수', '14:00', '15:00', '연수'],
    ['2시-3시 연수', '14:00', '15:00', '연수'],
    ['3시 반~4시 회의', '15:30', '16:00', '회의'],
    ['1:30~3:00 상담', '13:30', '15:00', '상담'],
    ['오전 11:00~12:30 공개수업', '11:00', '12:30', '공개수업'],
    ['오전 9시~오후 1시 체험학습', '09:00', '13:00', '체험학습'],
    ['내일 13:00-14:30 연수', '13:00', '14:30', '연수'],
]) {
    const r = jp.readJjaemPaste(text, { now: CLOCK_NOW, stripTime: true, stripDate: true, future: true });
    eq([r.time, r.endTime, r.body], [time, endTime, body], `시각 범위 ${text}`);
    check(!/[~～\-–—]/.test(r.body), `시각 범위 이음표가 제목에 남음: ${text} → ${r.body}`);
}
/* 평점관 r79-3 ①: 성경 책 이름 뒤 「장:절」은 시각이 아니고 제목에 그대로 남습니다. 「…기」로 끝나는 흔한 낱말·사람 이름은 시각을 지킵니다. */
for (const text of ['요한복음 3:16 읽기', '창세기 1:1 암송', '출애굽기 20:3 묵상', '시편 23:1 묵상', '잠언 3:5 쓰기', '전도서 3:1 낭독', '이사야 40:31 필사', '로마서 8:28 나눔', '고린도전서 13:4 필사', '고린도후서 5:17 읽기', '요한계시록 21:4 읽기', '마태복음 5:9 암송']) {
    const r = jp.readJjaemPaste(text, { now: CLOCK_NOW, stripTime: true, stripDate: true, future: true });
    eq([r.time, r.body], ['', text], `성경 구절은 시각 아님 ${text}`);
}
for (const [text, time, body] of [['일기 15:00 검사', '15:00', '일기 검사'], ['청소기 16:00 점검', '16:00', '청소기 점검'], ['독서 일기 14:30 제출', '14:30', '독서 일기 제출'], ['다니엘 15:00 상담', '15:00', '다니엘 상담'], ['요나 14:00 상담', '14:00', '요나 상담'], ['전기 16:00 점검', '16:00', '전기 점검'], ['동시편 15:00 발표', '15:00', '동시편 발표']]) {
    const r = jp.readJjaemPaste(text, { now: CLOCK_NOW, stripTime: true, stripDate: true, future: true });
    eq([r.time, r.body], [time, body], `성경 책 아님 ${text}`);
}
/* 평점관 r79-3 ②: 밤을 넘기거나 거꾸로 적은 범위는 묶지 않고 제목에 그대로 둡니다(알림은 시작 시각). 「1:30~3:00」은 13:30~15:00 그대로. */
for (const [text, time] of [['23:00~01:00 야간 당직', '23:00'], ['22:30-06:00 숙직', '22:30'], ['오후 11시~1시 당직', '23:00'], ['15:00~14:00 회의', '15:00'], ['22:00~22:00 점검', '22:00']]) {
    const r = jp.readJjaemPaste(text, { now: CLOCK_NOW, stripTime: true, stripDate: true, future: true });
    eq([r.time, r.endTime, r.body], [time, '', text], `밤 넘김·거꾸로 범위는 제목에 남음 ${text}`);
}
{
    const r = jp.readJjaemPaste('1:30~3:00 상담', { now: CLOCK_NOW, stripTime: true, stripDate: true, future: true });
    eq([r.time, r.endTime, r.body], ['13:30', '15:00', '상담'], '1:30~3:00은 13:30~15:00');
}
/* P2: 「오전 12시」는 낮·밤이 갈려 ask=am12로 노란 카드에서 묻습니다. 다른 시각은 묻지 않습니다. */
for (const text of ['오전 12시 마감', '오전 12:00 서버 점검', '오전 12시 반 방송']) eq(jp.readJjaemPaste(text, { now: CLOCK_NOW }).ask, 'am12', `오전 12시 확인 ${text}`);
for (const text of ['오후 12시 급식', '정오 방송', '밤 12시 점검', '12:00 급식', '오전 11시 회의']) eq(jp.readJjaemPaste(text, { now: CLOCK_NOW }).ask, '', `오전 12시 아님 ${text}`);
for (const [text, time, date, body] of CLOCK_CORPUS) {
    const r = jp.readJjaemPaste(text, { now: CLOCK_NOW, stripTime: true, stripDate: true, future: true });
    eq(r.time, time, `시계 시각 ${text}`);
    eq(r.date, date, `시계 날짜 ${text}`);
    eq(r.body, body, `시계 본문 ${text}`);
}
for (const text of ['3시 방향으로 이동', '한시적 운영', '세시 풍속 조사', '2:1로 이김', '네 시간 동안 연수', '시청 방문', '점수 3:2', '1:1 상담', '3:2 비율로 나누기', '점수 10:30', '점수가 10:30', '비율 3:2', '경기 결과 12:10으로 이김', '요한 3:16 낭독', '시편 23:1 봉독', '3:2로 졌다', '2:1 승', '25:23 승', '24:22 패', '3:1로 지고 있음', '10:30 비율', '12:10으로 이김', '21:19로 졌다', '세트 25:23']) {
    eq(jp.findTimeSpans(text).map((s) => s.time), [], `시각 아님 ${text}`);
}

/* ───── 1. 시간구 → 시각 (퇴근·조퇴·시간표 기준) ───── */
const STARTS = ['09:00', '09:50', '10:50', '11:40', '13:10', '14:00', '14:50', '15:40', '16:30', '17:20'];
const LENGTHS = Array(10).fill(40);
const CTX = { today: '2026-11-09', hm: '08:00', workStart: '08:30', workEnd: '16:40', leave: '', starts: STARTS, lengths: LENGTHS, lastPeriod: 6 };
const TIME_CORPUS = [
    // [문장, 시각, 날짜(빈 칸=오늘), 갈래]
    ['퇴근 전까지 공문 회신', '16:30', '', 'workEnd'],
    ['퇴근전까지 출력', '16:30', '', 'workEnd'],
    ['퇴근까지 수합', '16:30', '', 'workEnd'],
    ['퇴근 전에 결재 올리기', '16:30', '', 'workEnd'],
    ['퇴근하기 전까지 메일 보내기', '16:30', '', 'workEnd'],
    ['퇴근 직전 문단속', '16:30', '', 'workEnd'],
    ['퇴근 무렵 전화', '16:40', '', 'workEnd'],
    ['퇴근하고 장보기', '16:40', '', 'workEnd'],
    ['오늘 안에 제출', '16:30', '', 'dayEnd'],
    ['오늘 중으로 회신', '16:30', '', 'dayEnd'],
    ['오늘까지 입력', '16:30', '', 'dayEnd'],
    ['오늘 내로 정리', '16:30', '', 'dayEnd'],
    ['점심 전에 우유 신청', '12:10', '', 'lunch'],
    ['점심 전까지 출력', '12:10', '', 'lunch'],
    ['점심시간 전 복사', '12:10', '', 'lunch'],
    ['점심 먹고 상담', '13:10', '', 'lunch'],
    ['점심시간 끝나고 회의', '13:10', '', 'lunch'],
    ['내일 아침 출력물 챙기기', '08:30', '2026-11-10', 'morning'],
    ['내일 아침에 회신', '08:30', '2026-11-10', 'morning'],
    ['모레 아침 출력물 챙기기', '08:30', '2026-11-11', 'morning'],
    ['모레 아침에 회신', '08:30', '2026-11-11', 'morning'],
    ['점심시간에 상담', '12:20', '', 'lunch'],
    ['점심 때 학부모 전화', '12:20', '', 'lunch'],
    ['수업 끝나고 학부모 전화', '14:40', '', 'classEnd'],
    ['수업 마치고 채점', '14:40', '', 'classEnd'],
    ['수업 끝난 뒤 청소', '14:40', '', 'classEnd'],
    ['하교 후 교실 정리', '14:40', '', 'classEnd'],
    ['하교하면 상담', '14:40', '', 'classEnd'],
    ['3교시에 실험 준비', '10:50', '', 'period'],
    ['5교시 끝나고 채점', '13:50', '', 'period'],
    ['2교시 전까지 복사', '09:40', '', 'period'],
    ['1교시 시작 전 출석 확인', '08:50', '', 'period'],
    ['4교시 쉬는 시간에 전화', '11:40', '', 'period'],
    ['3~4교시 체육', '10:50', '', 'period'],
    ['10교시에 보충', '17:20', '', 'period'],
    ['출근하자마자 메일 확인', '08:30', '', 'workStart'],
    ['출근 전까지 서류 챙기기', '08:20', '', 'workStart'],
];
for (const [text, time, date, kind] of TIME_CORPUS) {
    const res = tp.resolveTimePhrase(text, CTX);
    check(Boolean(res), `시간구를 못 찾음: ${text}`);
    if (!res) continue;
    eq([res.time, res.date, res.kind, res.missing], [time, date || CTX.today, kind, ''], `시간구 ${text}`);
}
/* 「저녁」은 시각을 정하지 않고 노란 카드(18:00 추천)로 묻습니다. 모레·내일은 날짜를 옮깁니다. */
for (const [text, date] of [['모레 저녁 회식', '2026-11-11'], ['모레 저녁에 연락', '2026-11-11'], ['내일 저녁 학부모 전화', '2026-11-10'], ['오늘 저녁에 채점', '2026-11-09'], ['저녁에 메일 확인', '2026-11-09']]) {
    const res = tp.resolveTimePhrase(text, CTX);
    check(Boolean(res), `저녁 시간구를 못 찾음: ${text}`);
    if (!res) continue;
    eq([res.kind, res.date, res.time, res.missing, res.suggestTime], ['evening', date, '', 'vague', '18:00'], `저녁 노란 카드 ${text}`);
    check(/몇 시인지/.test(tp.phraseAskText(res)), `저녁 노란 카드 문구 ${text}`);
}
{
    const [card] = tp.applyTimePhrases([{ kind: '일정', raw: '모레 저녁 학부모 간담회', title: '학부모 간담회', date: '', time: '' }], CTX);
    eq([card.low, card.include, card.time], [true, false, ''], '메시지 붙여넣기: 모레 저녁은 노란 카드');
}
for (const text of ['저녁밥 메뉴', '저녁 메뉴 정하기', '내일 저녁밥 예약', '저녁노을 사진']) {
    eq(tp.findTimePhrases(text).map((s) => s.kind), [], `저녁 시간구 아님 ${text}`);
}
/* 시간구가 아닌 말은 건드리지 않습니다. */
for (const text of ['그냥 메모', '퇴근길 풍경이 예뻤다', '아침밥 메뉴', '13교시', '점심 메뉴 사진', '수업 자료', '3시간 동안 연수', '교시 배정표 정리', '출근부 확인']) {
    check(tp.resolveTimePhrase(text, CTX) === null, `시간구가 아닌데 시각을 정함: ${text} → ${JSON.stringify(tp.resolveTimePhrase(text, CTX))}`);
}
/* 오늘 조퇴가 있으면 퇴근 대신 조퇴 기준. 다른 날은 원래 퇴근. */
const leaveCtx = { ...CTX, leave: '14:30' };
eq(tp.resolveTimePhrase('퇴근 전까지 회신', leaveCtx).time, '14:20', '오늘 조퇴 기준');
check(tp.resolveTimePhrase('퇴근 전까지 회신', leaveCtx).basis.includes('조퇴'), '조퇴 기준 표시');
eq(tp.resolveTimePhrase('오늘 안에 제출', leaveCtx).time, '14:20', '오늘 안에도 조퇴 기준');
eq(tp.resolveTimePhrase('퇴근 전까지 회신', leaveCtx, { date: '2026-11-10' }).time, '16:30', '내일은 조퇴가 아니라 원래 퇴근');
/* 설정이 비면 정하지 않고 노란 카드(missing)와 추천값. */
const noWork = { ...CTX, workStart: '', workEnd: '' };
const miss = tp.resolveTimePhrase('퇴근 전까지 공문 회신', noWork);
eq([miss.time, miss.missing, miss.suggestTime], ['', 'workEnd', '16:20'], '퇴근 미설정은 노란 카드');
const missMorning = tp.resolveTimePhrase('내일 아침 출력', noWork);
eq([missMorning.time, missMorning.missing, missMorning.suggestTime, missMorning.date], ['', 'workStart', '08:30', '2026-11-10'], '출근 미설정은 노란 카드');
check(tp.phraseAskText(miss).includes('퇴근 시각'), '노란 카드 문구에 무엇이 비었는지 없음');
check(tp.resolveTimePhrase('퇴근 전까지', { ...noWork, leave: '14:00' }).time === '13:50', '퇴근이 없어도 오늘 조퇴가 있으면 조퇴 기준');
/* 이미 지난 시각은 late로 확인. */
const late = tp.resolveTimePhrase('퇴근 전까지 회신', { ...CTX, hm: '17:00' });
check(late.late === true && late.time === '16:30', '지난 시각을 확인하지 않음');
check(tp.resolveTimePhrase('퇴근 전까지 회신', { ...CTX, hm: '16:29' }).late === false, '아직 안 지난 시각을 지났다고 봄');
check(tp.resolveTimePhrase('퇴근 전까지 회신', { ...CTX, hm: '17:00' }, { date: '2026-11-10' }).late === false, '다른 날을 지났다고 봄');
check(tp.phraseAskText(late).includes('지났'), '지난 시각 문구');
/* 교시 시각이 없으면 timetable 누락. */
check(tp.resolveTimePhrase('3교시에 실험', { ...CTX, starts: [] }).missing === 'timetable', '교시 시각 없음 처리');
/* 수업 길이를 따라 끝 시각이 바뀝니다. */
eq(tp.resolveTimePhrase('수업 끝나고', { ...CTX, lengths: Array(10).fill(45) }).time, '14:45', '수업 길이 45분');
eq(tp.resolveTimePhrase('수업 끝나고', { ...CTX, lastPeriod: 5 }).time, '13:50', '오늘 마지막 교시 5교시');
eq(tp.BEFORE_LEAD_MIN, 10, '마감 10분 전 알림');

/* ───── 2. 어미 갈래 ───── */
const ENDING_CORPUS = [
    ['회의 취소됐어요', 'cancel'], ['체험학습 취소', 'cancel'], ['내일 행사는 없던 일로', 'cancel'], ['운동회는 진행하지 않습니다', 'cancel'],
    ['시간이 변경되었습니다', 'change'], ['다음 주로 미뤄졌어요', 'change'], ['회의가 3시로 바뀌었어요', 'change'], ['일정이 앞당겨졌습니다', 'change'], ['장소 변경', 'change'], ['연수가 연기됐어요', 'change'],
    ['안 내도 됩니다', 'negate'], ['회신하지 않아도 돼요', 'negate'], ['준비물 필요 없습니다', 'negate'], ['가져오지 마세요', 'negate'],
    ['공문 제출했어요', 'done'], ['출력 완료', 'done'], ['통신문 보냈음', 'done'], ['채점 끝냈다', 'done'], ['상담 마쳤습니다', 'done'],
    ['내일까지 회신 부탁드립니다', 'request'], ['서명해 주세요', 'request'], ['청소하기', 'request'], ['명단 제출 바랍니다', 'request'], ['준비물 챙겨', 'request'], ['꼭 확인해야 해요', 'request'],
    ['상담 예정입니다', 'plan'], ['내일 할게요', 'plan'], ['다음 주에 하려고', 'plan'],
    ['취소 신청서 제출해 주세요', 'request'], ['변경 신청서 내기', 'request'], ['자리 바꾸기', ''], ['가정통신문 제출', ''], ['그냥 적어요', ''],
    ['회의 취소됐대요, 대신 자료 보내 주세요', 'request'], ['자료 보내 주세요, 회의는 취소됐어요', 'cancel'],
];
for (const [text, want] of ENDING_CORPUS) eq(tp.classifyEnding(text), want, `어미 ${text}`);

/* ───── 3. 행동 어간 ───── */
const STEM_CORPUS = [
    ['가정통신문 제출', '제출'], ['공문 회신', '회신'], ['학습지 출력', '출력'], ['보고서 작성하기', '작성'], ['성적 입력', '입력'],
    ['체험학습 기안', '기안'], ['준비물 챙기기', '챙기기'], ['학부모 전화', '연락'], ['동의서 수합', '수합'], ['방과후 신청', '신청'],
    ['우유 신청서 걷기', '수합'], ['학습지 나눠주기', '배부'], ['알림장 보내기', '보내기'], ['도서 반납', '반납'], ['시험지 채점', '채점'],
];
for (const [text, act] of STEM_CORPUS) eq(tp.actionStem(text)?.act, act, `행동 어간 ${text}`);
check(tp.actionStem('오늘 날씨 좋다') === null, '행동이 없는데 어간을 찾음');
const line = tp.analyzeLine('퇴근 전까지 공문 회신 부탁드립니다', CTX);
eq([line.ending, line.stem?.act, line.phrase?.time], ['request', '회신', '16:30'], '한 줄 역할 나누기');

/* ───── 4. 빠른 입력 분류 추천 (기존 기대 + 어미) ───── */
const students = [{ no: 1, id: 's1', name: '민준' }];
const SUGGEST = [
    ['내일 운동회', '일정'], ['금요일 3교시', '일정'], ['3시 회의', '일정'], ['민준이 조용해요', '관찰'], ['가정통신문 제출', '할 일'],
    ['알림장 보내기', '할 일'], ['청소하기', '할 일'], ['그냥 적어요', ''],
    ['퇴근 전까지 공문 회신', '할 일'], ['내일까지 회신 부탁드립니다', '할 일'], ['공문 제출했어요', '메모'], ['회의 취소됐어요', ''],
    ['안 내도 됩니다', ''], ['내일 운동회 취소됐어요', ''], ['내일까지 서류 안 내도 됩니다', ''], ['3시 회의 했음', '메모'], ['수업 끝나고 학년 회의', '일정'], ['점심 전에 우유 신청', '할 일'],
];
for (const [text, want] of SUGGEST) eq(qm.suggestKind(text, students), want, `분류 추천 ${text}`);

/* ───── 5. 메시지 카드에 시간구 시각 채우기 ───── */
const cards = [
    { id: 'a', kind: '할 일', title: '공문 회신', raw: '퇴근 전까지 공문 회신 부탁드립니다', date: '2026-11-09', time: '' },
    { id: 'b', kind: '일정', title: '회의', raw: '3시 회의', date: '2026-11-09', time: '15:00' },
    { id: 'c', kind: '할 일', title: '자료', raw: '3교시에 자료', date: '2026-11-09', time: '' },
    { id: 'd', kind: '메모', title: '퇴근 전까지', raw: '퇴근 전까지', date: '', time: '' },
    { id: 'e', kind: '할 일', title: '회신', raw: '퇴근 전까지 4시 회신', date: '2026-11-09', time: '16:00' },
];
const filled = tp.applyTimePhrases(cards, CTX);
eq(filled[0].time, '16:30', '메시지 할 일에 퇴근 기준 시각');
eq(filled[1], cards[1], '이미 시각이 있는 카드는 그대로');
eq(filled[2], cards[2], 'n교시는 msgParse 몫이라 그대로');
eq(filled[3], cards[3], '할 일·일정이 아니면 그대로');
eq(filled[4], cards[4], '시계 시각이 있으면 시간구로 덮지 않음');
const held = tp.applyTimePhrases(cards, noWork)[0];
check(held.low === true && held.include === false && held.warning.includes('퇴근 시각') && !held.time, '퇴근 미설정 메시지는 노란 카드');
check(cards[0].time === '' && !cards[0].low, '원래 카드 배열을 바꿈');

/* ───── 6. 기본 단축키 ───── */
const store = () => ({ map: new Map(), getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }, setItem(k, v) { this.map.set(k, String(v)); }, removeItem(k) { this.map.delete(k); } });
const fresh = hk.defaultHotkeys();
eq(['plus', 'help', 'today', 'attend', 'schedule', 'todo', 'minutesList', 'memo', 'search'].map((id) => fresh[id]), ['/', '?', 't', 'a', 's', 'd', 'm', 'n', 'f'], '새 설치 기본 단축키');
eq(Object.values(fresh).filter(Boolean).length, new Set(Object.values(fresh).filter(Boolean)).size, '기본 키 겹침 없음');
const legacy = hk.legacyHotkeys();
eq(Object.entries(legacy).filter(([, v]) => v), [['plus', '/'], ['help', '?']], '예전 기본은 / 와 ? 만');
// 새 설치: 시작 전 기기 → fresh
const s1 = store();
eq(hk.seedHotkeys(false, s1), 'fresh', '새 기기 표시');
eq(hk.loadHotkeys(s1).today, 't', '새 기기는 t=오늘');
eq(hk.seedHotkeys(true, s1), '', '표시는 한 번만');
eq(hk.loadHotkeys(s1).today, 't', '시작한 뒤에도 새 기본 유지');
// 기존 사용자(저장 없음, 이미 시작) → legacy
const s2 = store();
eq(hk.seedHotkeys(true, s2), 'legacy', '쓰던 기기 표시');
eq([hk.loadHotkeys(s2).plus, hk.loadHotkeys(s2).today, hk.loadHotkeys(s2).memo], ['/', '', ''], '쓰던 기기는 예전 기본 유지');
// 기존 사용자가 저장한 값(판 1, memo 칸 없음)과 비운 값 유지
const s3 = store();
s3.setItem('ssug-gyomu-hotkeys', JSON.stringify({ plus: '', help: '?', search: '', today: 'h', attend: '', schedule: '', todo: '', minutesList: '', notice: '', students: '', neis: '', settings: '', 'quick:상담': 'a', 'quick:할 일': '', 'quick:일정': '', message: '', minutes: '' }));
eq(hk.seedHotkeys(true, s3), 'legacy', '저장값 있는 기기 표시');
const k3 = hk.loadHotkeys(s3);
eq([k3.plus, k3.today, k3['quick:상담'], k3.attend, k3.memo, k3.help], ['', 'h', 'a', '', '', '?'], '사용자 지정·비운 값 유지, 새 칸도 비움');
// 판 2 저장: 저장한 그대로
const s4 = store();
hk.saveHotkeys({ ...hk.defaultHotkeys(), today: '', memo: 'x' }, s4);
const k4 = hk.loadHotkeys(s4);
eq([k4.today, k4.memo, k4.attend], ['', 'x', 'a'], '판 2 저장값 유지');
check(JSON.parse(s4.getItem('ssug-gyomu-hotkeys'))._v === 2, '저장 판 표시');
// 초기화: 예전 기기도 새 기본
hk.resetHotkeys(s3);
eq([hk.loadHotkeys(s3).today, hk.loadHotkeys(s3).plus, s3.getItem('ssug-gyomu-hotkeys-seed')], ['t', '/', 'fresh'], '기본값으로 되돌리기');
eq(hk.defaultHotkeyRows().map((r) => r.key).join(''), '/?FTASDMN', '단축키 목록 기본 줄');
// 키 처리
check(hk.matchHotkey({ key: 't', target: { tagName: 'BODY' } }, fresh) === 'today', 't 키 오늘');
check(hk.matchHotkey({ key: 'T', target: { tagName: 'BODY' } }, fresh) === 'today', 'Shift+T도 오늘');
check(hk.matchHotkey({ key: 'n', target: { tagName: 'BODY' } }, fresh) === 'memo', 'n 키 메모');
check(hk.matchHotkey({ key: 't', target: { tagName: 'INPUT', getAttribute: () => 'text' } }, fresh) === '', '입력칸 t는 쉼');
check(hk.matchHotkey({ key: '/', isComposing: true, target: { tagName: 'BODY' } }, fresh) === '', '한글 조합 중 / 쉼');
check(hk.matchHotkey({ key: '/', keyCode: 229, target: { tagName: 'BODY' } }, fresh) === '', 'IME 229 / 쉼');
check(hk.matchHotkey({ key: 't', ctrlKey: true, target: { tagName: 'BODY' } }, fresh) === '', 'Ctrl+T는 브라우저 몫');
check(hk.matchHotkey({ key: 't', target: { tagName: 'DIV', isContentEditable: true } }, fresh) === '', '편집 영역 t는 쉼');
check(hk.modalOpen({ querySelector: (q) => (q.includes('aria-modal') ? {} : null) }) === true, '모달 감지');
check(hk.modalOpen({ querySelector: () => null }) === false, '모달 없음');
check(hk.modalOpen(null) === false, '문서 없음');

/* ───── 7. 기본 환경 추천값 ───── */
eq(sd.SUGGESTED_WORK, { workStart: '08:30', workEnd: '16:30' }, '출퇴근 추천값');
check(sd.needsWorkSuggestion({ workStart: '', workEnd: '' }), '빈 출퇴근은 추천');
check(!sd.needsWorkSuggestion({ workStart: '08:10', workEnd: '' }), '하나라도 정했으면 추천 안 함');
check(!sd.needsWorkSuggestion({ workStart: '', workEnd: '17:00' }), '퇴근만 정해도 추천 안 함');
eq(sd.workSuggestionPatch({ workStart: '', workEnd: '' }), { workStart: '08:30', workEnd: '16:30' }, '추천 적용 값');
eq(sd.workSuggestionPatch({ workStart: '09:00', workEnd: '17:00' }), null, '기존 값 덮어쓰지 않음');
eq(sd.ELEMENTARY_BELLS.length, 8, '초등 종 시각 8교시');
eq(sd.bellRows().map((r) => `${r.start}-${r.end}`), ['09:00-09:40', '09:50-10:30', '10:50-11:30', '11:40-12:20', '13:10-13:50', '14:00-14:40'], '초등 종 시각 안내');
check(sd.timetableEmpty({}), '빈 시간표');
check(!sd.timetableEmpty({ wed: { p3: '수학' } }), '과목 있는 시간표');
check(!sd.timetableEmpty({}, { fri: { p9: '방과후' } }), '9교시 과목도 있음으로 봄');
const cells = sd.sampleFillCells({ mon: { p1: '우리반 국어' } });
check(!cells.some((c) => c.day === 'mon' && c.period === 1), '이미 있는 과목 칸은 채우지 않음');
check(cells.length === Object.values(sd.ELEMENTARY_SAMPLE).reduce((n, row) => n + Object.keys(row).length, 0) - 1, '빈 칸만 채움');
check(sd.bellsLookDefault(['09:00', '09:40', '10:30', '11:20', '13:10', '14:00', '14:50', '15:40'], ['09:00', '09:40', '10:30', '11:20', '13:10', '14:00', '14:50', '15:40']), '처음 종 시각 감지');
check(!sd.bellsLookDefault(['08:50', '09:40', '10:30', '11:20', '13:10', '14:00', '14:50', '15:40'], ['09:00', '09:40', '10:30', '11:20', '13:10', '14:00', '14:50', '15:40']), '고친 종 시각은 예시 권하지 않음');

/* ───── 8. 화면 연결(소스) ───── */
const app = src('src/App.jsx');
const runHot = app.slice(app.indexOf('const runHotkey = useCallback'), app.indexOf('}, [clock.ymd, go]);'));
check(/id === 'plus'[\s\S]{0,300}pressJamButton\(\);/.test(runHot), '/ 키가 쨈 버튼 누르기(pressJamButton)를 하지 않음');
const pj = app.slice(app.indexOf('function pressJamButton()'), app.indexOf('function openQuickBar('));
check(/pressDown\(btn\)[\s\S]*btn\.click\(\)[\s\S]*pressUp\(btn\)/.test(pj), '/ 키가 키캡 눌림→클릭→복귀 순서가 아님');
check(/if \(!feel\) playKey\('down'\)/.test(pj) && /if \(!feel\) playKey\('up'\)/.test(pj), '/ 키에 딸깍 소리가 없음');
check(!/keep/.test(app.slice(app.indexOf('function openQuickBar('), app.indexOf('function closeQuickBar('))), '/ 전용 열기 분기(keep)가 남음');
check(!/id === 'plus'[\s\S]{0,120}setPlus\(true\)/.test(runHot), '/ 키가 아직 발라 두기 시트를 엶');
check(/modalOpen\(\) \|\| quickOpenRef\.current/.test(app), '모달·빠른 입력창이 떠 있어도 단축키가 먹음');
check(/seedHotkeys\(Boolean\(data\.profile\?\.started\)\)/.test(app), '새 설치 판단이 없음');
const attend = src('src/ui/Attend.jsx');
check(/aria-pressed=\{closed \? 'true' : 'false'\}/.test(attend) && attend.includes("'마감됨'") && attend.includes("'마감하기'"), '출결 마감 단추 상태 표시');
const css = src('src/index.css');
check(/\.attend-close\.is-closed\s*\{[^}]*box-shadow:\s*var\(--neo-inset-deep\)/.test(css), '마감됨이 눌린 모양이 아님');
check(/\.attend-close\s*\{[^}]*box-shadow:\s*var\(--neo-raise-sm\)/.test(css), '마감하기가 튀어나온 모양이 아님');
check(/\.attend-close\s*\{[^}]*min-height:\s*(4[4-9]|5\d)px/.test(css), '마감 단추 44px 미만');
check(/\.side-menu \.tap\.chip\.block \{[^}]*width: 100%; box-sizing: border-box;/.test(css), '사이드바 메뉴 버튼 너비가 통일되지 않음');
const quick = src('src/ui/QuickBar.jsx');
check(quick.includes('resolveTimePhrase(text, timeContext(data, now)') && quick.includes('quick-ask low-card'), '빠른 입력 시간구·노란 카드 연결 없음');
check(/if \(pre\.time\) return null;/.test(quick), '시계 시각이 시간구보다 먼저가 아님');
const msgSheet = src('src/ui/MsgSheet.jsx');
check(msgSheet.includes('applyTimePhrases(parsed.items, timeContext(data))'), '메시지 붙여넣기 시간구 연결 없음');
const ctxSrc = src('src/ui/timeContext.js');
check(!/patchPeriodLocal|setItem|writeJson/.test(ctxSrc), '기준값 읽기가 저장을 씀');
check(!/SUGGEST|08:30|16:30/.test(ctxSrc), '기준값에 추천값을 섞음');
const tt = src('src/ui/TimetableSettings.jsx');
check(tt.includes('workSuggestionPatch(readPeriodLocal())'), '추천 적용 직전에 저장값을 다시 보지 않음');
const dtt = src('src/ui/DefaultTimetable.jsx');
check(dtt.includes('sampleFillCells(data.timetable') && dtt.includes('window.confirm'), '시간표 예시가 확인 없이 들어감');
for (const rel of ['src/lib/timePhrase.js', 'src/lib/schoolDefaults.js', 'src/ui/timeContext.js']) {
    const text = src(rel);
    check(!/<select|type="range"/.test(text), `${rel} 드롭다운·스크롤 피커`);
}

if (failures.length) {
    console.error(`PR E 검사 실패 ${failures.length}개 / ${count}개`);
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
}
console.log(`PR E 검사 통과 (${count}개)`);
