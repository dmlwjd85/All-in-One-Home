/** 과제 체크: 메모 문서로 저장하고, 출결 다음 메뉴에 두며, 기기 합치기는 메모 규칙을 따릅니다. */
import { readFileSync } from 'node:fs';
import { MENU, menuSelected } from '../src/ui/menu.js';
import { resolveHash } from '../src/lib/routes.js';
import { isMinutes } from '../src/lib/minutes.js';
import { isTap } from '../src/ui/tapGuard.js';
import { fingerprint } from '../src/lib/cloud.js';
import { fromCloudRow, toCloudRow } from '../src/lib/cloudShape.js';
import { pruneDeletedElsewhere } from '../src/lib/syncMerge.js';
import {
    assignmentRow, checkRow, homeworkAssignments, homeworkCheckId, homeworkProblem, homeworkProgress, homeworkProgressLabel,
    isHomework, isHomeworkCheck, isHomeworkNote, submittedIds,
} from '../src/lib/homework.js';
import {
    absorbCloudForTest, addHomework, queuedCloudKeys, removeHomework, renameHomework, resetClockForTest, setHomeworkDate,
    snapshot, submitAllHomework, toggleHomeworkSubmit, useAuthForTest, useVaultsForTest,
} from '../src/lib/db.js';

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const vault = () => {
    const map = new Map();
    return { get: async (key) => map.get(key), set: async (key, value) => { map.set(key, value); }, remove: async (key) => { map.delete(key); }, map };
};
const mainVault = vault();
const localVault = vault();
useVaultsForTest(mainVault, localVault, vault());
resetClockForTest({ measured: true });
useAuthForTest('teacher-hw');

const mark = (row) => {
    const shaped = toCloudRow('notes', row);
    return [`notes/${shaped.id}`, fingerprint(shaped.body, shaped.clear || [])];
};

/* 메뉴·주소·플러스. 출결 바로 다음입니다. */
const labels = MENU.map((row) => row[0]);
check(labels[labels.indexOf('출결') + 1] === '과제 체크', `메뉴에서 과제 체크가 출결 다음이 아닙니다: ${labels.join('|')}`);
check(menuSelected('homework', '#/homework') && !menuSelected('attend', '#/homework'), '과제 체크 화면에서 메뉴가 켜지지 않습니다.');
const opened = resolveHash('#/homework', '2026-11-16');
check(opened.name === 'homework' && opened.params.id === '' && opened.replace === '', '과제 체크 주소가 열리지 않습니다.');
const one = resolveHash('#/homework/hw-read1', '2026-11-16');
check(one.name === 'homework' && one.params.id === 'hw-read1' && one.replace === '', '과제 한 건 주소가 열리지 않습니다.');
const actions = readFileSync(new URL('../src/ui/actions.js', import.meta.url), 'utf8');
check(/FREQUENT_ACTION_IDS = \['attend', 'homework'/.test(actions), '쨈 메뉴에서 과제 체크가 출결 다음이 아닙니다.');

/* 모양. 기존 notes 규칙 칸만 씁니다. */
check(homeworkProblem('', '2026-11-16') && homeworkProblem('독서록', '2026-02-31'), '빈 이름·없는 날짜를 그냥 받습니다.');
check(!homeworkProblem('독서록', '2026-11-16'), '바른 과제를 거절합니다.');
const hw = assignmentRow({ id: 'hw-read1', title: '  독서록  ', date: '2026-11-16' });
const shaped = toCloudRow('notes', hw);
check(shaped?.id === 'hw-read1' && shaped.body.text === '과제' && shaped.body.title === '독서록' && shaped.body.date === '2026-11-16' && shaped.body.tags?.[0] === '과제', `과제 메모 모양이 아닙니다: ${JSON.stringify(shaped)}`);
const back = fromCloudRow('notes', shaped.id, shaped.body);
check(isHomework(back) && back.title === '독서록' && !isMinutes(back) && !isHomework({ id: 'note-1', text: '과제', tags: [] }), '받아 온 과제를 과제 체크로 알아보지 못하거나 일반 메모로 봅니다.');
const markId = homeworkCheckId('hw-read1', 's12');
check(markId === homeworkCheckId('hw-read1', 's12') && /^[A-Za-z0-9_-]{1,40}$/.test(markId), `제출 문서 아이디가 규칙에 맞지 않습니다: ${markId}`);
const upCheck = toCloudRow('notes', checkRow('hw-read1', 's12'));
const downCheck = fromCloudRow('notes', upCheck.id, upCheck.body);
check(isHomeworkCheck(downCheck) && downCheck.text === 's12' && downCheck.title === 'hw-read1', `제출 표시가 메모로 돌아오지 않습니다: ${JSON.stringify(downCheck)}`);

/* 저장은 메모 칸이고, 끄기 전에 기기에 남습니다. 민감한 제목은 이 기기에만 둡니다. */
const added = await addHomework('독서록', '2026-11-16', 'hw-read1');
check(added.ok && added.id === 'hw-read1' && !added.sensitive, `과제를 추가하지 못했습니다: ${JSON.stringify(added)}`);
const stored = await mainVault.get('state');
check(stored?.notes?.some((row) => row.id === 'hw-read1' && row.title === '독서록'), '껐다 켤 저장소에 과제가 없습니다.');
await toggleHomeworkSubmit('hw-read1', 's1');
await toggleHomeworkSubmit('hw-read1', 's1');
await toggleHomeworkSubmit('hw-read1', 's1');
check(submittedIds(snapshot().notes, 'hw-read1').has('s1') && snapshot().notes.filter((row) => row.text === 's1').length === 1, '제출을 두 번 눌렀다 한 번 더 눌러도 한 줄로 남지 않습니다.');
const students = [{ id: 's1' }, { id: 's2' }, { id: 's3' }];
check(homeworkProgressLabel(homeworkProgress(snapshot().notes, 'hw-read1', students)) === '제출 1/3', `진행 표시가 다릅니다: ${homeworkProgressLabel(homeworkProgress(snapshot().notes, 'hw-read1', students))}`);
await submitAllHomework('hw-read1', students.map((student) => student.id));
check(homeworkProgress(snapshot().notes, 'hw-read1', students).submitted === 3, '모두 제출이 명단 전체를 표시하지 않습니다.');
await setHomeworkDate('hw-read1', '2026-11-20');
check(snapshot().notes.find((row) => row.id === 'hw-read1')?.date === '2026-11-20', '마감일이 바뀌지 않습니다.');

const pushed = snapshot().notes.find((row) => row.id === 'hw-read1');
const pushedHash = mark(pushed);
await renameHomework('hw-read1', '독서 기록');
const mine = snapshot().notes.find((row) => row.id === 'hw-read1');
check(mine?.title === '독서 기록' && mine.editAt > pushed.editAt, '이름 바꾸기에 고친 시각이 없습니다.');
const onlyThere = checkRow('hw-read1', 's9');
await absorbCloudForTest({
    notes: [
        { id: 'hw-read1', title: '다른 기기 이름', text: '과제', date: '2026-11-18', tags: ['과제'], pinned: false, source: 'app' },
        onlyThere,
    ],
    ats: { notes: { 'hw-read1': mine.editAt + 5000, [onlyThere.id]: mine.editAt + 5000 } },
    ids: { notes: ['hw-read1', ...snapshot().notes.filter(isHomeworkCheck).map((row) => row.id), onlyThere.id] },
}, { [pushedHash[0]]: pushedHash[1] });
const merged = snapshot().notes.find((row) => row.id === 'hw-read1');
check(merged?.title === '다른 기기 이름' && merged.date === '2026-11-18', `나중에 고친 기기 이름이 이기지 않습니다: ${JSON.stringify(merged)}`);
check(submittedIds(snapshot().notes, 'hw-read1').has('s9') && submittedIds(snapshot().notes, 'hw-read1').has('s1'), `한 기기에만 있는 제출이 빠졌습니다: ${[...submittedIds(snapshot().notes, 'hw-read1')].join(',')}`);

const earlier = snapshot().notes.find((row) => row.id === 'hw-read1');
await renameHomework('hw-read1', '이 기기 이름');
const localName = snapshot().notes.find((row) => row.id === 'hw-read1');
const localHash = mark(earlier);
await absorbCloudForTest({
    notes: [{ id: 'hw-read1', title: '늦은 옛 이름', text: '과제', date: '2026-11-18', tags: ['과제'], pinned: false, source: 'app' }],
    ats: { notes: { 'hw-read1': localName.editAt - 5000 } },
    ids: { notes: snapshot().notes.filter((row) => isHomework(row) || isHomeworkCheck(row)).map((row) => row.id) },
}, { [localHash[0]]: localHash[1] });
check(snapshot().notes.find((row) => row.id === 'hw-read1')?.title === '이 기기 이름', '더 일찍 고친 다른 기기 이름이 이 기기를 덮었습니다.');

const gone = snapshot().notes.find((row) => isHomeworkCheck(row) && row.text === 's1');
const keep = snapshot().notes.find((row) => isHomeworkCheck(row) && row.text === 's2');
const fresh = { ...keep, text: 's2' };
const draft = { notes: [gone, { ...keep, text: 's2', title: keep.title }] };
const hashes = Object.fromEntries([mark(gone)]);
pruneDeletedElsewhere(draft, { ids: { notes: [keep.id] }, tombs: { notes: { [gone.id]: (gone.editAt || 0) + 10 } } }, hashes);
check(!draft.notes.some((row) => row.id === gone.id) && draft.notes.some((row) => row.id === keep.id), '다른 기기에서 지운 제출만 지워지지 않습니다.');
const edited = { notes: [{ ...gone, text: 's1' }] };
pruneDeletedElsewhere(edited, { ids: { notes: [] }, tombs: { notes: { [gone.id]: (gone.editAt || 0) - 10 } } }, {});
check(edited.notes.length === 1, '아직 안 올린 제출을 다른 기기 삭제라고 지웠습니다.');
const lateTomb = { notes: [{ ...gone, editAt: 100 }] };
pruneDeletedElsewhere(lateTomb, { ids: { notes: [] }, tombs: { notes: { [gone.id]: 500 } } }, { [mark(fresh)[0]]: '다른해시' });
check(lateTomb.notes.length === 0, '이 기기보다 나중에 지운 제출이 남습니다.');

await removeHomework('hw-read1');
check(!homeworkAssignments(snapshot().notes).some((row) => row.id === 'hw-read1'), '지운 과제가 목록에 남습니다.');
const queued = queuedCloudKeys();
check(queued.includes('notes/hw-read1') && queued.includes(`notes/${homeworkCheckId('hw-read1', 's1')}`), `지운 과제·제출의 클라우드 삭제가 없습니다: ${queued.filter((key) => key.includes('hw-read1')).join(',')}`);

const secret = await addHomework('알레르기 간식', '2026-11-20', 'hw-secret');
check(secret.sensitive && !snapshot().notes.some((row) => row.id === 'hw-secret') && snapshot().local.notes.some((row) => row.id === 'hw-secret'), '민감한 과제 이름이 클라우드 칸으로 갑니다.');
await toggleHomeworkSubmit('hw-secret', 's4');
const secretCheck = [...snapshot().notes, ...snapshot().local.notes].find((row) => row.text === 's4');
check(secretCheck && snapshot().local.notes.some((row) => row.id === secretCheck.id) && !snapshot().notes.some((row) => row.id === secretCheck.id), '민감한 과제의 제출 표시가 클라우드 칸으로 갑니다.');
check(toCloudRow('notes', snapshot().local.notes.find((row) => row.id === 'hw-secret')) == null, '민감한 과제 이름을 메모 문서로 올립니다.');

check(!isTap({ x: 0, y: 0 }, { x: 1, y: 1 }, { scrolled: true }) && isTap({ x: 0, y: 0 }, { x: 2, y: 3 }) && !isTap({ x: 0, y: 0 }, { x: 0, y: 40 }), '스크롤과 탭을 가리지 못합니다.');
const ui = readFileSync(new URL('../src/ui/Homework.jsx', import.meta.url), 'utf8');
const tasks = readFileSync(new URL('../src/ui/Tasks.jsx', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
check(ui.includes('모두 제출') && ui.includes('미제출만') && ui.includes('이름 바꾸기') && ui.includes('지우기') && ui.includes('data-tap-guard="1"'), '화면에 제출·이름·지우기·탭 가드가 없습니다.');
check(tasks.includes('isHomeworkNote'), '과제 체크가 메모 목록에 섞입니다.');
check(rules.includes('match /notes/{nid}') && !/match\s+\/homework/.test(rules), 'Firestore 규칙에 과제 컬렉션을 추가했습니다.');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v94'") && !sw.includes('shell-v91'), '서비스 워커 판이 v94가 아닙니다.');
check(isHomeworkNote(hw) && !isHomeworkNote({ id: 'meet-1', tags: ['회의'], text: '본문' }), '과제와 회의록 표시가 섞입니다.');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('과제 체크 검사를 통과했습니다.');
