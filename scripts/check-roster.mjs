/**
 * 명렬 붙여넣기와 새 명단 맞추기를 확인합니다(바깥 패키지 없이 node 로 돕니다).
 * 1) 엑셀·한글 표·나이스 화면 복사, 한 줄 한 명, 성별 칸, 띄운 번호(1~15, 51~), 60명.
 * 2) 겹친 번호·빈 이름·못 읽은 줄은 미리보기 문제로 나오는지.
 * 3) 새 학년도: 같은 번호라도 이름이 다르면 새 아이디이고 메모·생일을 물려받지 않는지. 지난 학생은 지우지 않고 지난 명단으로 남는지.
 */
import { activeStudents, MAX_STUDENTS, parseRoster, planRoster, readRosterText, rosterView, suggestKeep } from '../src/lib/roster.js';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const pick = (read) => read.rows.map((r) => `${r.no}:${r.name}${r.sex ? `:${r.sex}` : ''}`).join(',');

/* ---------- 읽기 ---------- */
{
    const r = readRosterText('1 김가나\n2. 이다라\n3) 박마바\n4번 최사아\n자차카');
    check(pick(r) === '1:김가나,2:이다라,3:박마바,4:최사아,5:자차카', `한 줄 한 명: ${pick(r)}`);
    check(!r.blocking && !r.problems.length, '한 줄 한 명에서 문제가 나왔습니다.');
}
{
    const r = readRosterText('김가나\n이다라\n박마바');
    check(pick(r) === '1:김가나,2:이다라,3:박마바', `번호 없이: ${pick(r)}`);
}
{
    /* 엑셀에서 복사: 머리글 + 탭, 성별·생년월일 칸 */
    const text = '번호\t이름\t성별\t생년월일\n1\t김가나\t남\t2015.03.02\n2\t이다라\t여\t2015.07.11\n51\t박마바\t여\t2015.01.20\n';
    const r = readRosterText(text);
    check(pick(r) === '1:김가나:남,2:이다라:여,51:박마바:여', `엑셀 복사: ${pick(r)}`);
    check(r.overCloud, '51번이 클라우드 범위 밖으로 표시되지 않았습니다.');
}
{
    /* 나이스 화면: 학년·반·번호·성명·성별 */
    const text = '학년\t반\t번호\t성명\t성별\n3\t2\t1\t김가나\t남자\n3\t2\t2\t이다라\t여자\n3\t2\t21\t박마바\t여자';
    const r = readRosterText(text);
    check(pick(r) === '1:김가나:남,2:이다라:여,21:박마바:여', `나이스 복사: ${pick(r)}`);
}
{
    /* 머리글 없는 나이스 줄: 학년·반·번호가 이어짐 → 이름 바로 앞 숫자 */
    const r = readRosterText('3\t2\t15\t김가나\t남\n3\t2\t16\t이다라\t여');
    check(pick(r) === '15:김가나:남,16:이다라:여', `머리글 없는 나이스: ${pick(r)}`);
}
{
    /* 한글 표: 여러 칸 띄어쓰기, 한 줄에 두 명 */
    const r = readRosterText('1   김가나      21   이다라\n2   박마바      22   최사아');
    check(pick(r) === '1:김가나,2:박마바,21:이다라,22:최사아', `한글 표 두 명씩: ${pick(r)}`);
}
{
    /* 띄어쓰기 한 칸: 복성은 한 사람, 세 글자 둘은 두 사람 */
    const r = readRosterText('1 남궁 민수\n2 김가나 남\n3 여 이다라');
    check(pick(r) === '1:남궁민수,2:김가나:남,3:이다라:여', `띄어쓰기·성별: ${pick(r)}`);
    const paren = readRosterText('1.김가나\n2.이다라(여)\n3 박마바 (남)\nKim Minsu');
    check(pick(paren) === '1:김가나,2:이다라:여,3:박마바:남,4:Kim Minsu', `붙은 번호·괄호 성별·영문: ${pick(paren)}`);
    const two = readRosterText('김가나 이다라');
    check(pick(two) === '1:김가나,2:이다라', `한 줄 두 사람: ${pick(two)}`);
}
{
    /* 남학생 1~15, 여학생 51~ 처럼 띄운 번호와 구분 줄 */
    const boys = Array.from({ length: 15 }, (_, i) => `${i + 1}\t남${String.fromCharCode(0xac00 + i * 30)}수`).join('\n');
    const girls = Array.from({ length: 12 }, (_, i) => `${i + 51}\t여${String.fromCharCode(0xb098 + i * 30)}희`).join('\n');
    const r = readRosterText(`남학생\n${boys}\n\n여학생\n${girls}`);
    check(r.count === 27 && r.rows[15]?.no === 51 && !r.blocking, `띄운 번호: ${r.count}명 ${r.rows[15]?.no}`);
    check(!r.problems.length, `띄운 번호에서 문제: ${r.problems.map((p) => p.text).join(' / ')}`);
}
{
    /* 1~15, 21~35, 41~50 */
    const rows = [];
    for (const [a, b] of [[1, 15], [21, 35], [41, 50]]) for (let n = a; n <= b; n += 1) rows.push(`${n} 학생${String.fromCharCode(0xac00 + n * 7)}`);
    const r = readRosterText(rows.join('\n'));
    check(r.count === 40 && r.rows.map((x) => x.no).join() === [...Array.from({ length: 15 }, (_, i) => i + 1), ...Array.from({ length: 15 }, (_, i) => i + 21), ...Array.from({ length: 10 }, (_, i) => i + 41)].join(), '1~15·21~35·41~50 번호가 바뀌었습니다.');
}
{
    /* 60명까지, 61명은 막음 */
    const make = (n) => Array.from({ length: n }, (_, i) => `${i + 1}\t학${String.fromCharCode(0xac00 + i * 11)}${String.fromCharCode(0xb000 + i)}`).join('\n');
    const ok = readRosterText(make(MAX_STUDENTS));
    check(ok.count === 60 && !ok.blocking, `60명이 들어가지 않습니다: ${ok.count} ${ok.problems.map((p) => p.text)}`);
    const over = readRosterText(make(61));
    check(over.blocking && over.problems.some((p) => p.kind === 'many'), '61명을 막지 않습니다.');
}
{
    /* 겹친 번호·빈 이름·못 읽은 줄 */
    const r = readRosterText('1 김가나\n1 이다라\n2\n3\t\t남\n☆☆☆ 2023-01-01\n4 박마바');
    check(r.blocking && r.problems.some((p) => p.kind === 'dup' && p.no === 1), '겹친 번호를 막지 않습니다.');
    check(r.rows.filter((row) => row.dup).length === 2, '겹친 두 줄이 표시되지 않았습니다.');
    check(r.problems.filter((p) => p.kind === 'empty').map((p) => p.no).join() === '2,3', `빈 이름: ${r.problems.filter((p) => p.kind === 'empty').map((p) => p.no)}`);
    check(r.problems.some((p) => p.kind === 'skip'), '못 읽은 줄이 표시되지 않았습니다.');
    check(r.rows.some((row) => row.no === 4 && row.name === '박마바'), '문제 줄 뒤 학생을 놓쳤습니다.');
    const plain = parseRoster('1 김가나\n1 이다라');
    check(plain.students.length === 1 && plain.students[0].name === '김가나' && plain.errors.length, '예전 parseRoster 모양이 달라졌습니다.');
}
{
    /* 번호 범위 */
    const r = readRosterText('100 김가나\n99 이다라');
    check(pick(r) === '99:이다라' && r.problems.some((p) => p.kind === 'range'), `번호 범위: ${pick(r)}`);
    const back = parseRoster('12 이하은\n황보람');
    check(back.students.some((row) => row.no === 12 && row.name === '이하은') && back.students.some((row) => row.no === 13 && row.name === '황보람'), '예전 검사(check-quality) 예시를 못 읽습니다.');
}

/* ---------- 새 명단 맞추기 ---------- */
let seq = 0;
const makeId = (no) => `s${no}-t${(seq += 1)}`;
const lastYear = [
    { id: 's1', no: 1, name: '김가나', sex: '남', birthday: '03-02', active: true, memo: '수학 좋아함', source: 'app' },
    { id: 's2', no: 2, name: '이다라', sex: '여', birthday: '07-11', active: true, memo: '발표 잘함', source: 'app' },
    { id: 's3', no: 3, name: '박마바', sex: '', birthday: '', active: true, memo: '', source: 'app' },
];
{
    /* 새 학년도: 이름이 모두 다름 */
    const plan = planRoster(lastYear, [{ no: 1, name: '정하늘' }, { no: 2, name: '오바다' }, { no: 3, name: '박마바' }], { makeId });
    const now = activeStudents(plan.students);
    check(now.length === 3, '지금 반 학생 수가 다릅니다.');
    check(now[0].id !== 's1' && now[0].memo === '' && now[0].birthday === '', `1번 새 학생이 작년 1번을 이어받았습니다: ${JSON.stringify(now[0])}`);
    check(now[1].id !== 's2' && now[1].memo === '' && now[1].birthday === '', '2번 새 학생이 작년 메모·생일을 받았습니다.');
    check(now[2].id === 's3', '이름이 같은 3번의 아이디가 바뀌었습니다.');
    const gone = plan.students.filter((row) => row.active === false);
    check(gone.length === 2 && gone.some((row) => row.id === 's1' && row.memo === '수학 좋아함'), '지난 학생을 지우거나 메모를 잃었습니다.');
    check(plan.changes.filter((c) => c.kind === 'changed').length === 2 && plan.changes.filter((c) => c.kind === 'gone').length === 2, `바뀜 표시: ${JSON.stringify(plan.changes)}`);
    check(suggestKeep(plan.changes).length === 0, '새 학년도인데 이어 가기를 골라 두었습니다.');
    const view = rosterView({ students: plan.students });
    check(view.students.length === 3 && view.allStudents.length === 5, '화면 자료가 지난 학생을 숨기지 않습니다.');
    /* 다시 같은 명단으로 넣어도 아이디가 그대로 */
    const again = planRoster(plan.students, [{ no: 1, name: '정하늘' }, { no: 2, name: '오바다' }, { no: 3, name: '박마바' }], { makeId });
    check(activeStudents(again.students).map((r) => r.id).join() === now.map((r) => r.id).join(), '같은 명단을 다시 넣었더니 아이디가 바뀌었습니다.');
    check(again.students.length === 5, '지난 학생이 늘거나 줄었습니다.');
    /* 지난 명단 학생을 다시 넣으면 예전 아이디로 */
    const back = planRoster(plan.students, [{ no: 1, name: '김가나' }], { makeId });
    check(activeStudents(back.students)[0]?.id === 's1' && activeStudents(back.students)[0]?.memo === '수학 좋아함', '지난 명단 학생을 다시 넣었는데 예전 기록과 이어지지 않습니다.');
}
{
    /* 한 명 오타 고침: 이어 가기를 골라 두고, keep 이면 아이디 유지 */
    const plan = planRoster(lastYear, [{ no: 1, name: '김가난' }, { no: 2, name: '이다라' }, { no: 3, name: '박마바' }], { makeId });
    check(suggestKeep(plan.changes).join() === '1', `오타 고침 추천: ${suggestKeep(plan.changes)}`);
    const kept = planRoster(lastYear, [{ no: 1, name: '김가난' }, { no: 2, name: '이다라' }, { no: 3, name: '박마바' }], { keep: [1], makeId });
    check(kept.students[0].id === 's1' && kept.students[0].name === '김가난' && kept.students[0].memo === '수학 좋아함', '이름만 고친 학생의 기록이 끊겼습니다.');
    check(kept.changes.some((c) => c.kind === 'renamed'), '이름만 고침 표시가 없습니다.');
    check(kept.students.length === 3, '이름만 고쳤는데 지난 학생이 생겼습니다.');
}
{
    /* 처음 명단: s번호 */
    const plan = planRoster([], [{ no: 1, name: '김가나' }, { no: 51, name: '이다라' }]);
    check(plan.students.map((r) => r.id).join() === 's1,s51', `처음 아이디: ${plan.students.map((r) => r.id)}`);
    /* 아이디 모양은 클라우드 규칙(영문·숫자·-_ 40자)에 맞아야 합니다. */
    const real = planRoster(lastYear, [{ no: 1, name: '새학생' }]);
    check(/^[A-Za-z0-9_-]{1,40}$/.test(real.students[0].id) && real.students[0].id !== 's1', `새 아이디 모양: ${real.students[0].id}`);
}

/* ---------- 저장(db.js): 새 학년도 명단이 작년 기록·출결을 이어받지 않고, 지우지도 않는지 ---------- */
{
    const { replaceRoster, saveQuick, setAttendance, snapshot, useVaultsForTest } = await import('../src/lib/db.js');
    const vault = () => {
        const bag = new Map();
        return {
            async get(key) { return bag.has(key) ? structuredClone(bag.get(key)) : undefined; },
            async set(key, value) { bag.set(key, structuredClone(value)); },
            async remove(key) { bag.delete(key); },
        };
    };
    useVaultsForTest(vault(), vault(), vault());
    await replaceRoster('1 김가나\n2 이다라\n3 박마바');
    const before = snapshot().students.map((row) => row.id).join();
    check(before === 's1,s2,s3', `처음 명단 아이디: ${before}`);
    await saveQuick({ text: '작년 3번 발표 기록', kind: '관찰', no: 3, date: '2026-03-10' });
    await setAttendance('2026-03-10', 's3', '결석', { reason: '질병', paper: true });
    const saved = await replaceRoster([{ no: 1, name: '김가나' }, { no: 2, name: '오바다' }, { no: 3, name: '정하늘' }, { no: 51, name: '한여름' }]);
    const all = snapshot().students;
    const now = activeStudents(all);
    check(now.map((row) => `${row.no}:${row.name}`).join() === '1:김가나,2:오바다,3:정하늘,51:한여름', `새 명단: ${now.map((row) => `${row.no}:${row.name}`)}`);
    check(now[0].id === 's1', '이름이 같은 1번의 아이디가 바뀌었습니다.');
    check(now[2].id !== 's3', '새 3번이 작년 3번 아이디를 받았습니다.');
    check(all.some((row) => row.id === 's3' && row.active === false && row.name === '박마바'), '작년 3번이 지난 명단으로 남지 않았습니다.');
    check(snapshot().records.some((row) => row.sid === 's3' && row.text.includes('작년 3번')), '작년 기록이 지워졌습니다.');
    check(snapshot().attendance.some((row) => row.sid === 's3'), '작년 출결이 지워졌습니다.');
    check(!snapshot().attendance.some((row) => row.sid === now[2].id), '새 3번이 작년 출결을 이어받았습니다.');
    check(saved.changes?.some((c) => c.no === 3 && c.kind === 'changed'), '바뀜 목록이 돌아오지 않았습니다.');
    check(snapshot().profile.classSize === 4, `반 인원: ${snapshot().profile.classSize}`);
    /* 빠른 입력 번호는 지금 반 3번에게 붙습니다(지난 명단 3번 아님). */
    await saveQuick({ text: '새 3번 첫 기록', kind: '관찰', no: 3, date: '2026-11-12' });
    const fresh = snapshot().records.find((row) => row.text.includes('새 3번'));
    check(fresh?.sid === now[2].id, `새 기록이 지난 명단 학생에게 붙었습니다: ${fresh?.sid}`);
}

if (failures.length) {
    console.error(`명렬 검사 실패 ${failures.length}개`);
    failures.forEach((f) => console.error(`- ${f}`));
    process.exit(1);
}
console.log('명렬 붙여넣기·새 명단 맞추기 검사 통과');
