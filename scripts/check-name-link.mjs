/* 본문 속 학생 이름 연결·여러 학생 묶음 기록·학생별 모아 보기 검사(화면 없이, 패키지 없이). */
import { readFileSync } from 'node:fs';
import { findStudentNames, linkedSids, givenOf, hasBatchim, groupOfId, groupRecordId, newGroupId, groupMates } from '../src/lib/nameLink.js';
import { filterLog, periodBounds, schoolYearOf, sortLog, studentLogText } from '../src/lib/studentLog.js';
import { linkedNosFor, suggestKind } from '../src/ui/quickMatch.js';
import { finishSetup, saveQuick, snapshot, update, useVaultsForTest } from '../src/lib/db.js';

let bad = 0;
let count = 0;
const check = (ok, msg) => { count += 1; if (!ok) { bad += 1; console.error(`✗ ${msg}`); } };

const roster = [
    [1, '김가나'], [2, '이하윤'], [3, '박하늘'], [4, '최민'], [5, '정도윤'], [6, '김서연'], [7, '이서연'],
    [8, '한지우'], [9, '오지우'], [10, '남궁민수'], [11, '윤나라'], [12, '강보람'], [13, '조은비'], [14, 'Anna'],
].map(([no, name]) => ({ id: `s${no}`, no, name }));

const names = (text) => findStudentNames(text, roster);
const autoNames = (text) => names(text).filter((hit) => hit.auto).map((hit) => hit.name);
const shown = (text) => names(text).map((hit) => hit.name);

/* 기본 도구 */
check(hasBatchim('윤') && !hasBatchim('나') && !hasBatchim('a'), '받침 판별');
check(givenOf('김가나') === '가나' && givenOf('남궁민수') === '민수' && givenOf('최민') === '최민' && givenOf('김민') === '김민', `성 뺀 이름: ${givenOf('남궁민수')}`);

/* 1. 성 포함·성 뺀 이름·조사·호칭 */
const autoCases = [
    ['김가나가 발표를 잘했어요', '김가나'],
    ['김가나 오늘 결석', '김가나'],
    ['가나가 친구를 도왔어요', '김가나'],
    ['가나는 오늘 기분이 좋아요', '김가나'],
    ['가나랑 같이 청소했어요', '김가나'],
    ['가나를 칭찬했어요', '김가나'],
    ['가나야 고마워', '김가나'],
    ['가나한테 연필을 빌려줬어요', '김가나'],
    ['가나랑은 다르게', '김가나'],
    ['하윤이가 울었어요', '이하윤'],
    ['하윤이는 일찍 왔어요', '이하윤'],
    ['하윤이랑 놀았어요', '이하윤'],
    ['하윤이 오늘 발표', '이하윤'],
    ['하윤은 차분해요', '이하윤'],
    ['하윤아, 이리 와', '이하윤'],
    ['이하윤이가 도왔어요', '이하윤'],
    ['하윤이한테는 말했어요', '이하윤'],
    ['(도윤) 줄넘기 100개', '정도윤'],
    ['민수가 우유를 쏟았어요', '남궁민수'],
    ['남궁민수 칭찬', '남궁민수'],
    ['Anna helped 가나', 'Anna'],
];
for (const [text, want] of autoCases) check(autoNames(text).includes(want), `자동 연결해야 함: 「${text}」 → ${want} (찾음: ${JSON.stringify(names(text).map((h) => [h.name, h.auto, h.why]))})`);

/* 이름이 아닌 낱말·다른 낱말 속 글자는 찾지 않습니다. */
const noneCases = [
    '가나다라 순서로 줄 서기',
    '가나초등학교 방문',
    '우리나라 지도 그리기',
    '도윤리 마을',
    '하윤서 책 반납',
    '민원 전화',
    '최민수 선생님께 연락',
    '보라색 크레파스',
];
for (const text of noneCases) check(!autoNames(text).length, `자동 연결하면 안 됨: 「${text}」 → ${JSON.stringify(names(text).map((h) => [h.name, h.form]))}`);
check(!shown('가나다라 순서로 줄 서기').length && !shown('우리나라 지도').length, '낱말 속 이름은 칩도 없어야 함');

/* 2. 오탐 줄이기 */
// 한 글자 이름(최민 → '민')은 이름만으로 자동 연결하지 않고, '민이가'처럼 호칭이 붙을 때만 칩을 보여 줍니다.
check(!shown('민 선생님과 상담').length, "한 글자 '민'만으로 칩이 뜨면 안 됨");
const min = names('민이가 늦었어요').find((h) => h.name === '최민');
check(min && !min.auto && min.why === 'short', `한 글자 이름 + 호칭은 칩만: ${JSON.stringify(min)}`);
check(autoNames('최민이 늦었어요').includes('최민'), '두 글자 성명 전체는 자동 연결');
// 일반 낱말과 겹치는 이름: 칩만, 자동 확정 안 함.
for (const [text, who] of [['하늘이 맑아요', '박하늘'], ['나라를 지키는 사람들', '윤나라'], ['보람이 있었어요', '강보람']]) {
    const hit = names(text).find((h) => h.name === who);
    check(hit && !hit.auto && hit.why === 'word', `낱말 겹침은 칩만: 「${text}」 ${JSON.stringify(hit)}`);
}
check(autoNames('박하늘이 발표했어요').includes('박하늘'), '낱말 겹침 이름도 성까지 쓰면 자동 연결');
check(suggestKind('하늘이 맑아요', roster) !== '관찰', '낱말 겹침만으로 관찰 강조하면 안 됨');
// 같은 이름 학생: 번호를 붙여 고르게.
const sy = names('서연이가 그림을 그렸어요');
check(sy.length === 2 && sy.every((h) => !h.auto && h.why === 'same'), `같은 성 뺀 이름 둘: ${JSON.stringify(sy)}`);
check(sy.map((h) => h.label).join('|') === '6번 김서연|7번 이서연', `번호 붙인 이름: ${sy.map((h) => h.label)}`);
check(autoNames('김서연이 그림을 그렸어요').join() === '김서연', '성까지 쓰면 그 학생만 자동 연결');
const dupRoster = [...roster, { id: 's20', no: 20, name: '김가나' }];
const dup = findStudentNames('김가나가 웃었어요', dupRoster);
check(dup.length === 2 && dup.every((h) => !h.auto && h.why === 'same') && dup[0].label === '1번 김가나' && dup[1].label === '20번 김가나', `같은 성명 둘: ${JSON.stringify(dup)}`);
check(names('지우가 왔어요').every((h) => h.why === 'same'), '지우 둘');
// 성 없이 '도윤'으로 올린 학생이 있으면, '도윤이가'는 그 학생이고 '정도윤'의 성 뺀 이름으로 겹쳐 읽지 않습니다.
const plain = findStudentNames('도윤이가 왔어요', [...roster, { id: 's21', no: 21, name: '도윤' }]);
check(plain.length === 1 && plain[0].name === '도윤' && plain[0].auto, `성 없는 이름이 먼저: ${JSON.stringify(plain)}`);

/* 3. 여러 학생 */
const many = names('가나랑 하윤이가 다퉜어요. 도윤이가 말렸어요');
check(many.map((h) => h.name).join() === '김가나,이하윤,정도윤' && many.every((h) => h.auto), `여러 학생(글 순서): ${many.map((h) => h.name)}`);
check(linkedSids(many, {}).join() === 's1,s2,s5', '자동 연결 셋');
check(linkedSids(many, { s2: false }).join() === 's1,s5', '칩으로 해제');
check(linkedSids(names('서연이가 울었어요'), { s7: true }).join() === 's7', '같은 이름은 고른 쪽만');
check(linkedSids(names('하늘이 맑아요'), {}).length === 0 && linkedSids(names('하늘이 맑아요'), { s3: true }).join() === 's3', '낱말 겹침은 눌러야 연결');

/* 빠른 입력 연결 번호 */
check(linkedNosFor('가나랑 하윤이가 다퉜어요', roster).join() === '1,2', '빠른 입력 번호 둘');
check(linkedNosFor('가나랑 하윤이가 다퉜어요', roster, { s1: false }).join() === '2', '해제한 학생 빼기');
check(linkedNosFor('김가나 결석', roster, { s1: false }).length === 0, '해제하면 예전 규칙(성명 일치)으로 되살리지 않음');
check(linkedNosFor('발표 잘함', roster, {}, { id: 's8', no: 8, name: '한지우' }).join() === '8', '이름 후보에서 고른 학생');
check(linkedNosFor('서연이 그림', roster, {}).length === 0, '같은 이름은 자동 연결 안 함');
check(suggestKind('가나가 발표를 잘했어요', roster) === '관찰', '성 뺀 이름도 관찰 강조');
check(suggestKind('김가나 발표', roster) === '관찰', '성명 관찰 강조(예전 그대로)');

/* 묶음 아이디 */
const gid = newGroupId(Date.UTC(2026, 10, 12), () => 0.123456789);
const rid = groupRecordId(gid, 39);
check(/^[A-Za-z0-9_-]{1,40}$/.test(rid), `규칙 id 모양: ${rid}`);
check(groupOfId(rid) === gid && groupOfId('rec-abc-12345') === '' && groupOfId('') === '', '묶음 아이디 꺼내기');
check(groupMates({ id: `${gid}-1`, sid: 's1' }, [{ id: `${gid}-1`, sid: 's1' }, { id: `${gid}-2`, sid: 's2' }, { id: 'rec-x', sid: 's3' }]).join() === 's2', '같은 묶음 학생');

/* saveQuick: 학생마다 기록 하나씩, 묶음 아이디로 연결. 클라우드 칸은 그대로. */
function makeVault() {
    const bag = new Map();
    return {
        async get(key) { return bag.has(key) ? structuredClone(bag.get(key)) : undefined; },
        async set(key, value) { bag.set(key, structuredClone(value)); },
        async remove(key) { bag.delete(key); },
    };
}
useVaultsForTest(makeVault(), makeVault());
await finishSetup({ className: '3학년 2반', rosterText: roster.filter((r) => /[가-힣]/.test(r.name)).map((r) => `${r.no} ${r.name}`).join('\n') });
const now = new Date('2026-11-12T10:00:00+09:00');
const one = await saveQuick({ kind: '관찰', text: '가나가 발표를 잘했어요', no: 1 }, now);
check(one.ok && one.message === '김가나 기록에 넣었어요.', `한 명 저장: ${one.message}`);
const before = snapshot().records.length;
const two = await saveQuick({ kind: '관찰', text: '가나랑 하윤이가 다퉜어요', no: 1, nos: [1, 2] }, now);
const added = snapshot().records.slice(0, 0).length + snapshot().records.length - before;
check(two.ok && added === 2, `두 명 저장 → 기록 둘: ${added} ${two.message}`);
check(two.message === '김가나, 이하윤 기록에 하나씩 넣었어요.', `두 명 안내: ${two.message}`);
const pair = snapshot().records.filter((r) => r.text === '가나랑 하윤이가 다퉜어요');
check(pair.length === 2 && new Set(pair.map((r) => r.sid)).size === 2 && pair.every((r) => groupOfId(r.id)) && groupOfId(pair[0].id) === groupOfId(pair[1].id), `묶음: ${JSON.stringify(pair.map((r) => [r.id, r.sid]))}`);
check(pair.every((r) => Object.keys(r).every((k) => ['id', 'date', 'kind', 'sid', 'text', 'tags', 'neis', 'follow', 'source', 'at'].includes(k))), `새 칸 없음: ${Object.keys(pair[0])}`);
const three = await saveQuick({ kind: '관찰', text: '@5 모둠 발표 준비 @', no: 0, nos: [1, 2] }, now);
check(three.ok && snapshot().records.filter((r) => r.text.includes('모둠 발표 준비')).length === 3, `@번호도 함께: ${three.message}`);
const onlyOne = await saveQuick({ kind: '상담', text: '하윤이 상담', no: 0, nos: [2, 2, 99] }, now);
check(onlyOne.message === '이하윤 기록에 넣었어요.' && !groupOfId(snapshot().records.find((r) => r.text === '하윤이 상담')?.id), `겹친 번호·없는 번호: ${onlyOne.message}`);
const sens = await saveQuick({ kind: '관찰', text: '가나랑 하윤이 알레르기 확인', no: 1, nos: [1, 2] }, now);
check(sens.ok && snapshot().local.records.filter((r) => r.text.includes('알레르기')).length === 2 && !snapshot().records.some((r) => r.text.includes('알레르기')), '민감한 묶음 기록은 둘 다 이 기기에만');

/* 다른 기기에서 명단을 바꾼 뒤 배열 앞쪽에 지난 명단 학생이 오는 경우: 같은 번호라도 지금 반 학생에게만 붙입니다. */
await update((draft) => {
    const old = draft.students.find((r) => r.id === 's2');
    const rest = draft.students.filter((r) => r.id !== 's2');
    draft.students = [rest[0], { ...old, active: false }, ...rest.slice(1), { id: 's2-new1', no: 2, name: '박민지', sex: '', birthday: '', active: true, memo: '', source: 'app' }];
    return draft;
});
const movedOne = await saveQuick({ kind: '관찰', text: '민지 발표 잘함', no: 0, nos: [2] }, now);
const movedRow = snapshot().records.find((r) => r.text === '민지 발표 잘함');
check(movedRow?.sid === 's2-new1' && movedOne.message === '박민지 기록에 넣었어요.', `한 명 묶음은 지금 반 학생: ${movedRow?.sid} ${movedOne.message}`);
const movedTwo = await saveQuick({ kind: '관찰', text: '가나랑 민지 청소', no: 1, nos: [1, 2] }, now);
const movedPair = snapshot().records.filter((r) => r.text === '가나랑 민지 청소').map((r) => r.sid).sort().join();
check(movedPair === 's1,s2-new1' && movedTwo.message === '김가나, 박민지 기록에 하나씩 넣었어요.', `여러 명 묶음은 지금 반 학생: ${movedPair} ${movedTwo.message}`);
const movedNo = await saveQuick({ kind: '관찰', text: '@2 줄넘기', no: 0 }, now);
check(snapshot().records.find((r) => r.text.includes('줄넘기'))?.sid === 's2-new1', `번호 하나도 지금 반 학생: ${movedNo.message}`);

/* 클라우드 모양: sid 하나짜리 기록 그대로 */
const { toCloudRow } = await import('../src/lib/cloudShape.js');
const cloud = pair.map((r) => toCloudRow('records', r));
check(cloud.every((c) => c && c.id && /^[A-Za-z0-9_-]{1,40}$/.test(c.id) && c.body.sid && Object.keys(c.body).every((k) => ['date', 'kind', 'sid', 'text', 'tags', 'neis', 'follow', 'minutes', 'source'].includes(k))), `클라우드 기록 모양: ${JSON.stringify(cloud)}`);

/* 4. 학생별 모아 보기 */
check(schoolYearOf('2027-02-10') === 2026 && schoolYearOf('2026-03-02') === 2026, '학년도');
check(JSON.stringify(periodBounds('first', '2026-11-12')) === '{"from":"2026-03-01","to":"2026-08-16"}', `1학기: ${JSON.stringify(periodBounds('first', '2026-11-12'))}`);
check(JSON.stringify(periodBounds('second', '2026-11-12', { secondStart: '2026-08-20' })) === '{"from":"2026-08-20","to":"2027-02-28"}', '2학기(학사일정)');
check(periodBounds('year', '2027-01-05').from === '2026-03-01' && periodBounds('year', '2028-01-05').to === '2028-02-29', '올해 = 학년도, 윤년');
check(periodBounds('all', '2026-11-12') === null, '모든 날');
const log = [
    { id: 'a', date: '2026-03-04', kind: '관찰', text: '발표를 끝까지 했어요.' },
    { id: 'b', date: '2026-11-02', kind: '칭찬', text: '모둠 정리를\n도왔어요.', at: '2026-11-02T01:00:00Z' },
    { id: 'c', date: '2026-11-02', kind: '상담', text: '교우 관계 이야기', at: '2026-11-02T00:00:00Z' },
    { id: 'd', date: '2026-09-10', kind: '보호자', text: '전화 상담' },
    { id: 'e', date: '2026-02-20', kind: '관찰', text: '지난 학년' },
];
const ids = (rows) => rows.map((r) => r.id).join('');
check(ids(sortLog(log, 'old')) === 'eadcb', `오래된 순: ${ids(sortLog(log, 'old'))}`);
check(ids(sortLog(log, 'new')) === 'bcdae', `최근 순: ${ids(sortLog(log, 'new'))}`);
check(ids(filterLog(log, { kind: '칭찬' })) === 'b', '종류: 칭찬만');
check(ids(filterLog(log, { kind: '관찰' })) === 'ae', '종류: 관찰은 칭찬을 섞지 않음');
check(ids(filterLog(log, { period: 'month', today: '2026-11-12' })) === 'bc', '이번 달');
check(ids(filterLog(log, { period: 'first', today: '2026-11-12' })) === 'a', '1학기');
check(ids(filterLog(log, { period: 'second', today: '2026-11-12' })) === 'bcd', '2학기');
check(ids(filterLog(log, { period: 'year', today: '2026-11-12' })) === 'abcd', '올해');
check(ids(filterLog(log, { kind: '관찰', period: 'year', today: '2026-11-12' })) === 'a', '종류 + 기간');
const text = studentLogText({ no: 3, name: '김가나' }, filterLog(log, { period: 'year', today: '2026-11-12' }), { periodLabel: '올해', kindLabel: '전체', mates: (row) => (row.id === 'b' ? ['이하윤'] : []) });
const wantText = [
    '3번 김가나 기록 · 올해 · 4개',
    '2026-03-04 (관찰) 발표를 끝까지 했어요.',
    '2026-09-10 (보호자) 전화 상담',
    '2026-11-02 (상담) 교우 관계 이야기',
    '2026-11-02 (칭찬) 모둠 정리를\n    도왔어요. [함께: 이하윤]',
].join('\n');
check(text === wantText, `복사 글:\n${text}`);

/* 화면 연결(소스 확인) */
const quickBar = readFileSync('src/ui/QuickBar.jsx', 'utf8');
check(quickBar.includes('findStudentNames(live, students)') && quickBar.includes('data-quick-links') && quickBar.includes('body.nos = nos'), '빠른 입력에 이름 칩·여러 학생 저장');
const flow = readFileSync('src/ui/FlowSheet.jsx', 'utf8');
check(flow.includes('findStudentNames(text, data.students)') && flow.includes('nos: others'), '학생 기록 입력에 이름 칩');
const studentsJsx = readFileSync('src/ui/Students.jsx', 'utf8');
check(/const matesOf = [^\n]*\n\s*const mate = \(data\.allStudents \|\| data\.students\)\.find/.test(studentsJsx) && studentsJsx.includes('(지난 명단)'), "함께: 이름을 지난 명단 학생까지 찾고 '(지난 명단)'을 붙이지 않습니다.");
const attendJsx = readFileSync('src/ui/Attend.jsx', 'utf8');
check(attendJsx.includes('pastStudents={pastStudents}') && attendJsx.includes('(지난 명단)') && attendJsx.includes('const everyone = data.allStudents || data.students;'), '출결 월표·사유 목록이 지난 명단 학생 이름을 찾지 않습니다.');
check(studentsJsx.includes('LOG_PERIODS.map') && studentsJsx.includes('studentLogText(') && studentsJsx.includes('이 학생 기록 복사'), '학생 화면 모아 보기·복사');
check(readFileSync('firestore.rules', 'utf8').includes("d().keys().hasOnly(['date', 'kind', 'sid', 'text', 'tags', 'neis', 'follow', 'minutes', 'source', 'createdAt', 'updatedAt'])"), '기록 규칙 그대로');

if (bad) {
    console.error(`이름 연결 검사 ${bad}/${count}개 실패`);
    process.exit(1);
}
console.log(`이름 연결·묶음 기록·모아 보기 검사 통과 (${count}개)`);
