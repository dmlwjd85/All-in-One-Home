/** 2026-10-21(수) 기준으로 읽어야 하는 학교 메시지. */
export const MSG_NOW = new Date('2026-10-21T09:00:00+09:00');

const T = '2026-10-21';
const D1 = '2026-10-22';
const D2 = '2026-10-23';
const D3 = '2026-10-24';
const MON = '2026-10-19';
const NEXT_MON = '2026-10-26';
const NEXT_TUE = '2026-10-27';
const NEXT_WED = '2026-10-28';
const NEXT_THU = '2026-10-29';
const NEXT_FRI = '2026-10-30';
const SAT = '2026-10-31';

export const MSG_SAMPLES = [
    { text: '10/28(수) 오후 2시 교직원 회의. 장소: 교무실', items: [{ kind: '일정', date: '2026-10-28', time: '14:00', title: '교직원 회의', memo: '교무실', eventKind: '학교', sensitive: false }] },
    { text: '10/28(화) 공개수업', items: [{ kind: '일정', date: '2026-10-28', time: '', title: '공개수업', low: true, eventKind: '학급' }] },
    { text: '10.28. 현장체험학습 동의서 제출 바랍니다', items: [{ kind: '할 일', date: '2026-10-28', time: '', title: '현장체험학습 동의서 제출' }] },
    { text: '10월 28일 5교시 공개수업', items: [{ kind: '일정', date: '2026-10-28', time: '13:10', title: '공개수업', memo: '5교시', eventKind: '학급' }] },
    { text: '28일(수)까지 가정통신문 회신', items: [{ kind: '할 일', date: '2026-10-28', time: '', title: '가정통신문 회신' }] },
    { text: '28일(화) 학부모 협의회', items: [{ kind: '일정', date: '2026-10-28', time: '', title: '학부모 협의회', low: true, eventKind: '학교' }] },
    { text: '오늘 3교시까지 수행평가 입력', items: [{ kind: '할 일', date: T, time: '10:30', title: '수행평가 입력' }] },
    { text: '내일 오전 9시 연수. 장소: 시청각실', items: [{ kind: '일정', date: D1, time: '09:00', title: '연수', memo: '시청각실', eventKind: '학교' }] },
    { text: '모레 방과후 학부모 상담', items: [{ kind: '일정', date: D2, time: '16:00', title: '학부모 상담', eventKind: '학급' }] },
    { text: '글피 14:30 출장', items: [{ kind: '일정', date: D3, time: '14:30', title: '출장', eventKind: '학교' }] },
    { text: '이번 주 금요일 협의회', items: [{ kind: '일정', date: D2, time: '', title: '협의회', eventKind: '학교' }] },
    { text: '다음 주 월요일 공개수업', items: [{ kind: '일정', date: NEXT_MON, time: '', title: '공개수업', eventKind: '학급' }] },
    { text: '금주 목요일까지 독서기록장 제출', items: [{ kind: '할 일', date: D1, time: '', title: '독서기록장 제출' }] },
    { text: '차주 화요일 행사', items: [{ kind: '일정', date: NEXT_TUE, time: '', title: '행사', eventKind: '학급' }] },
    { text: '2시 반 회의', items: [{ kind: '일정', date: '', time: '14:30', title: '회의', low: true, eventKind: '학급' }] },
    { text: '내일 5~6교시 학예회 행사', items: [{ kind: '일정', date: D1, time: '13:10', title: '학예회 행사', memo: '5~6교시', eventKind: '학급' }] },
    { text: '오후 4시 30분 학년 회의 장소: 과학실', items: [{ kind: '일정', date: '', time: '16:30', title: '학년 회의', memo: '과학실', low: true, eventKind: '학급' }] },
    { text: '11/3(화)까지 독후감 업로드', items: [{ kind: '할 일', date: '2026-11-03', time: '', title: '독후감 업로드' }] },
    { text: '2026-11-04 오전 10시 30분 교직원 연수', items: [{ kind: '일정', date: '2026-11-04', time: '10:30', title: '교직원 연수', eventKind: '학교' }] },
    { text: '오늘 점심시간 급식 지도 확인 바랍니다', items: [{ kind: '할 일', date: T, time: '12:10', title: '급식 지도' }] },
    { text: '내일 3교시 공개수업 참관록을 작성해 주세요', items: [
        { kind: '일정', date: D1, time: '10:30', title: '공개수업', memo: '3교시' },
        { kind: '할 일', date: D1, time: '10:30', title: '참관록 작성', memo: '3교시' },
    ] },
    { text: '10/28(수) 교직원 회의 자료 제출 바랍니다', items: [
        { kind: '일정', date: '2026-10-28', time: '', title: '교직원 회의', eventKind: '학교' },
        { kind: '할 일', date: '2026-10-28', time: '', title: '자료 제출' },
    ] },
    { text: '안녕하세요.\n1. 10/28(수) 교직원 회의\n2. 11/3까지 독후감 제출\n김교사 드림', items: [
        { kind: '일정', date: '2026-10-28', time: '', title: '교직원 회의' },
        { kind: '할 일', date: '2026-11-03', time: '', title: '독후감 제출' },
    ] },
    { text: '① 내일 알림장 작성 ② 모레 현장학습 행사', items: [
        { kind: '할 일', date: D1, time: '', title: '알림장 작성' },
        { kind: '일정', date: D2, time: '', title: '현장학습 행사' },
    ] },
    { text: '내일까지 나이스 입력 바랍니다', items: [{ kind: '할 일', date: D1, time: '', title: '나이스 입력' }] },
    { text: '다음 주 수요일 출장', items: [{ kind: '일정', date: NEXT_WED, time: '', title: '출장', eventKind: '학교' }] },
    { text: '이번주 월요일 협의회', items: [{ kind: '일정', date: MON, time: '', title: '협의회', eventKind: '학교' }] },
    { text: '※ 모레까지 준비물 회신', items: [{ kind: '할 일', date: D2, time: '', title: '준비물 회신' }] },
    { text: '- 오늘 방과후 돌봄 회의', items: [{ kind: '일정', date: T, time: '16:00', title: '돌봄 회의', eventKind: '학급' }] },
    { text: '10월 30일(금) 2교시 공개수업', items: [{ kind: '일정', date: '2026-10-30', time: '09:40', title: '공개수업', memo: '2교시' }] },
    { text: '31일(토) 운동회 행사', items: [{ kind: '일정', date: SAT, time: '', title: '운동회 행사' }] },
    { text: '3일(화)까지 설문 회신', items: [{ kind: '할 일', date: '2026-11-03', time: '', title: '설문 회신' }] },
    { text: '3일(수) 현장학습', items: [{ kind: '할 일', date: '2026-11-03', time: '', title: '현장학습', low: true }] },
    { text: '내일 14:00 과학실에서 교과 협의회', items: [{ kind: '일정', date: D1, time: '14:00', title: '교과 협의회', memo: '과학실', eventKind: '학교' }] },
    { text: '오늘 1시 회의', items: [{ kind: '일정', date: T, time: '13:00', title: '회의', low: true }] },
    { text: '오늘 7시 조회는 없습니다', items: [{ kind: '일정', date: T, time: '07:00', title: '조회' }] },
    { text: '건강 조사 내일까지 제출', items: [{ kind: '할 일', date: D1, time: '', title: '건강 조사 제출', sensitive: true }] },
    { text: '학폭 사안 회의를 내일 오후 3시에 합니다. 장소: 상담실', items: [{ kind: '일정', date: D1, time: '15:00', title: '학폭 사안 회의', memo: '상담실', sensitive: true, eventKind: '학급' }] },
    { text: '보건실 방문 학생 명단 오늘까지 입력', items: [{ kind: '할 일', date: T, time: '', title: '보건실 방문 학생 명단 입력', sensitive: true }] },
    { text: '분리급식 학생 확인 바랍니다', items: [{ kind: '할 일', date: '', time: '', title: '분리급식 학생', sensitive: true, low: true }] },
    { text: '수고하셨습니다.\n○ 차주 금요일 학예회 행사\n○ 10/30까지 의상 제출', items: [
        { kind: '일정', date: NEXT_FRI, time: '', title: '학예회 행사' },
        { kind: '할 일', date: '2026-10-30', time: '', title: '의상 제출' },
    ] },
    { text: '2026. 11. 2. 오전 11시 공개수업', items: [{ kind: '일정', date: '2026-11-02', time: '11:00', title: '공개수업' }] },
    { text: '12시 반 점심시간 회의', items: [{ kind: '일정', date: '', time: '12:30', title: '회의', low: true }] },
    { text: '6교시 운동장에서 체육대회 행사', items: [{ kind: '일정', date: '', time: '14:00', title: '체육대회 행사', memo: '운동장 · 6교시', low: true }] },
    { text: '내일까지 회신 바랍니다', items: [{ kind: '할 일', date: D1, time: '', title: '회신' }] },
    { text: '다음주 목요일 연수 자료 작성해 주세요', items: [
        { kind: '일정', date: NEXT_THU, time: '', title: '연수', eventKind: '학교' },
        { kind: '할 일', date: NEXT_THU, time: '', title: '자료 작성' },
    ] },
    { text: '금주 금요일 5교시 협의회에서 안건을 제출합니다', items: [
        { kind: '일정', date: D2, time: '13:10', title: '협의회', memo: '5교시', eventKind: '학교' },
        { kind: '할 일', date: D2, time: '13:10', title: '안건 제출', memo: '5교시' },
    ] },
    { text: '오늘 오후 2시까지 사진 업로드', items: [{ kind: '할 일', date: T, time: '14:00', title: '사진 업로드' }] },
    { text: '10/27(화) 전교생 행사', items: [{ kind: '일정', date: NEXT_TUE, time: '', title: '전교생 행사' }] },
    { text: '10/27(월) 행사', items: [{ kind: '일정', date: NEXT_TUE, time: '', title: '행사', low: true }] },
    { text: '선생님, 안내드립니다.\n내일 8시 40분 조회 회의', items: [{ kind: '일정', date: D1, time: '08:40', title: '조회 회의' }] },
    { text: '모레 1~2교시 공개수업', items: [{ kind: '일정', date: D2, time: '09:00', title: '공개수업', memo: '1~2교시' }] },
    { text: '오늘 결과 학생 조퇴 시간 14:30 확인 바랍니다', items: [{ kind: '할 일', date: T, time: '14:30', title: '결과 학생 조퇴 시간' }] },
    { text: '차주 월요일까지 가정통신문 회신 장소: 교실', items: [{ kind: '할 일', date: NEXT_MON, time: '', title: '가정통신문 회신', memo: '교실' }] },
    { text: '이번 주 토요일 운동장에서 바자회 행사', items: [{ kind: '일정', date: D3, time: '', title: '바자회 행사', memo: '운동장' }] },
    { text: '내일 오후 1시 학부모회의', items: [{ kind: '일정', date: D1, time: '13:00', title: '학부모회의' }] },
    { text: '글피까지 안전교육 이수증 제출', items: [{ kind: '할 일', date: D3, time: '', title: '안전교육 이수증 제출' }] },
    { text: '10월 21일 오늘 교직원 회의', items: [{ kind: '일정', date: T, time: '', title: '교직원 회의', eventKind: '학교' }] },
    { text: '1) 오늘 방과후 연수\n2) 내일까지 보고서 작성\n3) 모레 3교시 공개수업', items: [
        { kind: '일정', date: T, time: '16:00', title: '연수', eventKind: '학교' },
        { kind: '할 일', date: D1, time: '', title: '보고서 작성' },
        { kind: '일정', date: D2, time: '10:30', title: '공개수업', memo: '3교시' },
    ] },
    { text: '민원 전화 내용 내일 상담 기록 작성', items: [{ kind: '할 일', date: D1, time: '', title: '민원 전화 내용 상담 기록 작성', sensitive: true }] },
    { text: '내일 오전 11시 20분 음악실에서 협의회', items: [{ kind: '일정', date: D1, time: '11:20', title: '협의회', memo: '음악실', eventKind: '학교' }] },
    { text: '모레 6시 방과후 행사', items: [{ kind: '일정', date: D2, time: '18:00', title: '행사', low: true }] },
    { text: '[안내] 1. 10월 30일(금) 3~4교시 학급 사진 촬영이 있습니다. 장소: 강당', items: [{ kind: '일정', date: '2026-10-30', time: '10:30', title: '학급 사진 촬영', memo: '강당 · 3~4교시', eventKind: '학급', low: false, include: true }] },
    { text: '11월 12일까지 공개수업 지도안 제출', items: [{ kind: '할 일', date: '2026-11-12', time: '', title: '공개수업 지도안 제출', include: true }] },
    { text: '가정통신문\n학부모 상담주간: 11월 2일(월)~11월 6일(금)', items: [{ kind: '일정', date: '2026-11-02', end: '2026-11-06', time: '', title: '학부모 상담주간', eventKind: '학급', low: false, include: true }] },
    { text: '김교사 출장으로 5,6교시 보결 부탁드립니다', items: [{ kind: '일정', date: '', time: '13:10', title: '김교사 출장으로 보결', memo: '5~6교시', eventKind: '학교', low: true, include: true }] },
    { text: '선생님들 항상 수고 많으십니다. 날씨가 추우니 건강 조심하세요.', items: [{ kind: '할 일', date: '', time: '', title: '선생님들 항상 수고 많으 날씨가 추우니 건강 조심', include: false, low: true, sensitive: true }] },
    { text: '11월 3일까지 방과후 신청서 회수 후 제출', items: [{ kind: '할 일', date: '2026-11-03', time: '', title: '방과후 신청서 회수 후 제출' }] },
    { text: '내일 오후 2시 교무회의', items: [{ kind: '일정', date: D1, time: '14:00', title: '교무회의', eventKind: '학교', low: false }] },
    { text: '1. 10.28. 교직원 회의\n2. 11월 3일까지 독후감 제출', items: [
        { kind: '일정', date: '2026-10-28', time: '', title: '교직원 회의', eventKind: '학교' },
        { kind: '할 일', date: '2026-11-03', time: '', title: '독후감 제출' },
    ] },
    { text: '3·4교시 학급 회의', items: [{ kind: '일정', date: '', time: '10:30', title: '학급 회의', memo: '3~4교시', eventKind: '학급', low: true }] },
    { text: '다음 주 금요일까지 수행평가 입력', items: [{ kind: '할 일', date: NEXT_FRI, time: '', title: '수행평가 입력' }] },
    { text: '10/28(수) 14:30 협의회', items: [{ kind: '일정', date: '2026-10-28', time: '14:30', title: '협의회', eventKind: '학교' }] },
    { text: '내일 3교시 영어 듣기평가', items: [{ kind: '일정', date: D1, time: '10:30', title: '영어 듣기평가', memo: '3교시' }] },
    { text: '[공지] 1. 내일 조회 회의', items: [{ kind: '일정', date: D1, time: '', title: '조회 회의', eventKind: '학급' }] },
    { text: '5, 6교시 전담 보결', items: [{ kind: '일정', date: '', time: '13:10', title: '전담 보결', memo: '5~6교시', low: true }] },
    { text: '12월 14일~12월 18일 평가 주간', items: [{ kind: '일정', date: '2026-12-14', end: '2026-12-18', time: '', title: '평가 주간', low: false }] },
    { text: '모레 방과후 돌봄은 그대로입니다', items: [{ kind: '일정', date: D2, time: '16:00', title: '돌봄은 그대로' }] },
    { text: '11월 2일(월)~11월 6일(금)까지 상담 희망 시간 회신', items: [{ kind: '할 일', date: '2026-11-06', time: '', title: '상담 희망 시간 회신' }] },
    { text: '제1회 학급 회의는 10월 28일입니다', items: [{ kind: '일정', date: '2026-10-28', time: '', title: '제1회 학급 회의', eventKind: '학급' }] },
];
