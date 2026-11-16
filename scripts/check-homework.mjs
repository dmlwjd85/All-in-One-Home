/** 과제 체크: 노트와 다른 컬렉션, 학생별 칸 합치기, 옛 hw-/hx- 를 옮긴 뒤 노트에서 지움. */
import { readFileSync } from 'node:fs';
import { MENU, menuSelected } from '../src/ui/menu.js';
import { resolveHash } from '../src/lib/routes.js';
import { isMinutes, minutesList } from '../src/lib/minutes.js';
import { isTap } from '../src/ui/tapGuard.js';
import {
    foldLegacyIntoHomework, homeworkAssignments, homeworkFromDoc, homeworkOverdue, homeworkPatch,
    homeworkProgress, homeworkProgressLabel, homeworkTitle, isHomeworkNote, mergeHomework, newHomework,
    pastHomework, visibleHomework,
} from '../src/lib/homework.js';
import { buildExport } from '../src/lib/backup.js';
import {
    addHomework, addHomeworkStudent, importText, removeHomework, resetClockForTest, snapshot, submitAllHomework,
    toggleHomeworkSubmit, undo, useAuthForTest, useVaultsForTest,
} from '../src/lib/db.js';
import { homeworkWatchOnError } from '../src/lib/cloud.js';
import { useWatchTimingForTest, watchRetryDue } from '../src/lib/db.js';
import { chipState, resetSyncStatusForTest, syncEnd } from '../src/lib/syncStatus.js';

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const vault = () => {
    const map = new Map();
    return { get: async (key) => map.get(key), set: async (key, value) => { map.set(key, value); }, remove: async (key) => { map.delete(key); }, map };
};
useVaultsForTest(vault(), vault(), vault());
resetClockForTest({ measured: true });
useAuthForTest('teacher-hw');

const labels = MENU.map((row) => row[0]);
check(labels[labels.indexOf('출결') + 1] === '과제 체크', `메뉴에서 과제 체크가 출결 다음이 아닙니다: ${labels.join('|')}`);
check(menuSelected('homework', '#/homework') && resolveHash('#/homework/hw-read1', '2026-11-16').params.id === 'hw-read1', '과제 체크 주소가 열리지 않습니다.');
const actions = readFileSync(new URL('../src/ui/actions.js', import.meta.url), 'utf8');
check(/FREQUENT_ACTION_IDS = \['attend', 'homework'/.test(actions), '쨈 메뉴에서 과제 체크가 출결 다음이 아닙니다.');

const legacyHw = { id: 'hw-read1', title: '독서록', text: '과제 체크 기록이에요. 과제 체크 화면에서 봐요.\n@@HW1\n{"v":1,"made":40,"metaAt":40,"roster":["s1","s2","s3"],"checks":{"s2":{"at":30,"on":1}}}', date: '2026-11-16', tags: ['회의', '과제'], pinned: false, source: 'app', editAt: 40 };
const legacyCheck = { id: 'hx-hw-read1-s1', title: 'hw-read1', text: 's1', tags: ['제출'], pinned: false, source: 'app', editAt: 50 };
const folded = foldLegacyIntoHomework([legacyHw, legacyCheck, { id: 'note-9', text: '준비물', tags: [], pinned: true, source: 'app' }], [], [], []);
check(folded.cloud.length === 1 && folded.cloud[0].id === 'note-9', '과제를 옮긴 뒤 일반 메모가 빠집니다.');
check(folded.removed.some((row) => row.id === legacyCheck.id) && folded.removed.some((row) => row.id === 'hw-read1'), '옛 hw-/hx- 를 노트에서 빼지 않습니다.');
const moved = folded.homework[0];
check(moved?.checks?.s1?.on === 1 && moved?.checks?.s2?.on === 1 && !moved.tags && !String(moved.text || '').includes('회의'), `옮긴 과제에 제출이 없거나 회의 태그가 남습니다: ${JSON.stringify(moved)}`);
const memoList = folded.cloud.filter((row) => !isMinutes(row) && !isHomeworkNote(row));
check(memoList.length === 1, '옛 메모 목록에 과제가 남습니다.');
check(!minutesList([{ ...legacyHw }, { id: 'meet-1', tags: ['회의'], text: '본문', title: '회의', date: '2026-11-01' }]).some((row) => row.id === 'hw-read1'), '새 판 회의록 목록에 과제가 섞입니다.');

const broken = foldLegacyIntoHomework(
    [
        { id: 'hw-read1', title: '고친 제목', text: '선생님이 지운 본문', tags: ['회의'], date: '2026-11-16', editAt: 80 },
        { id: 'hx-hw-read1-s5', title: 'hw-read1', text: 's5', tags: ['제출'], editAt: 90 },
    ],
    [],
    [moved],
    [],
);
check(broken.cloud.some((row) => row.text === '선생님이 지운 본문'), '본문을 못 읽은 과제 노트를 지웁니다.');
check(broken.homework[0].checks.s1.on === 1 && broken.homework[0].checks.s5.on === 1, '확인 전 제출 노트 s5를 버렸습니다.');
check(broken.removed.some((row) => row.id === 'hx-hw-read1-s5') && !broken.removed.some((row) => row.text === '선생님이 지운 본문'), '들어간 제출만 지울 목록에 두지 않습니다.');

const orphan = foldLegacyIntoHomework([legacyCheck], [], [], []);
check(orphan.homework.length === 0 && orphan.cloud.some((row) => row.id === legacyCheck.id) && !orphan.removed.length, '확인되지 않은 제출 노트를 지웁니다.');

const base = newHomework({ id: 'hw-live', title: '독서록', date: '2026-11-16', roster: ['s1', 's2', 's3'], made: 100 });
base.checks = { s1: { at: 110, on: 1 } };
const remoteOnly = { ...base, checks: { s2: { at: 120, on: 1 } }, editAt: 120 };
const merged = mergeHomework(base, remoteOnly);
check(merged.checks.s1.on === 1 && merged.checks.s2.on === 1, '학생별 합치기가 한쪽 체크를 지웁니다.');
const patch = homeworkPatch(base, merged);
check(patch && patch['checks.s2'] === '1~120' && !patch.checks, `제출 맵 전체를 덮어씁니다: ${JSON.stringify(patch)}`);
const deleted = { ...merged, gone: 200 };
const olderCheck = mergeHomework(deleted, { ...deleted, gone: 0, checks: { ...deleted.checks, s9: { at: 150, on: 1 } } });
check(olderCheck.gone === 200, '지운 시각보다 이른 체크로 과제가 되살아납니다.');
const newerCheck = mergeHomework(deleted, { ...deleted, gone: 0, checks: { ...deleted.checks, s9: { at: 250, on: 1 } } });
check(newerCheck.gone === 200 && newerCheck.checks.s1.on === 1, '지운 뒤의 체크만으로 과제가 되살아납니다.');
const restored = mergeHomework(deleted, { ...deleted, gone: 0, metaAt: 300 });
check(restored.gone === 0, '이름을 되돌린 과제가 지운 채로 남습니다.');
const cloudRow = homeworkFromDoc('hw-live', { title: '독서록', date: '2026-11-16', made: 100, metaAt: 100, gone: 0, roster: ['s1'], checks: { s1: '1~110' } });
check(cloudRow.checks.s1.on === 1 && cloudRow.roster[0] === 's1', '클라우드 문서를 읽지 못합니다.');

const added = await addHomework('독서록', '2026-11-16', 'hw-read1', ['s1', 's2', 's3']);
check(added.ok && snapshot().notes.length === 0 && snapshot().homework.length === 1, '과제를 노트에 저장합니다.');
check(!snapshot().homework[0].tags, '새 과제에 회의 태그를 붙입니다.');
await toggleHomeworkSubmit('hw-read1', 's1');
await toggleHomeworkSubmit('hw-read1', 's2');
check(homeworkProgress(snapshot().homework[0], [{ id: 's9' }]).total === 3, '지난 과제 수를 지금 명단으로 다시 셉니다.');
check(homeworkProgressLabel(homeworkProgress(snapshot().homework[0], [])) === '제출 2/3', '제출 수가 스냅샷과 다릅니다.');
await addHomework('나중에 만든 과제', '2026-11-10', 'hw-new', ['s1']);
check(homeworkAssignments(snapshot().homework)[0].id === 'hw-new', '새 과제가 목록 맨 위가 아닙니다.');
check(homeworkOverdue('2026-11-10', '2026-11-16') && pastHomework(snapshot().homework, '2026-11-16').some((row) => row.id === 'hw-new'), '마감이 지난 과제를 지나간 것으로 보지 않습니다.');
check(visibleHomework(snapshot().homework, { today: '2026-11-16' }).every((row) => row.id !== 'hw-new'), '지난 과제를 기본 목록에 펼칩니다.');
const before = homeworkProgress(snapshot().homework.find((row) => row.id === 'hw-read1'), []);
await addHomeworkStudent('hw-read1', 's9');
const after = snapshot().homework.find((row) => row.id === 'hw-read1');
check(after.roster.includes('s9') && homeworkProgress(after, []).submitted === before.submitted && homeworkProgress(after, []).total === before.total + 1, '전입생을 명단에 더하면 기존 제출 수가 바뀝니다.');
await submitAllHomework('hw-read1', after.roster);
check(homeworkProgress(snapshot().homework.find((row) => row.id === 'hw-read1'), []).submitted === 4, '모두 제출이 더한 학생을 채우지 않습니다.');
await removeHomework('hw-read1');
const gone = snapshot().homework.find((row) => row.id === 'hw-read1');
check(gone && Number(gone.gone) > 0 && gone.checks.s1.on === 1 && !homeworkAssignments(snapshot().homework).some((row) => row.id === 'hw-read1'), '지우기가 제출을 없애거나 목록에 남깁니다.');

const ui = readFileSync(new URL('../src/ui/Homework.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
check(ui.includes('명단에 추가') && ui.includes('onClick') && ui.includes('마감일'), '화면 문구·클릭이 빠졌습니다.');
check(css.includes('grid-template-columns: repeat(auto-fill') && /\.hero-actions \{[^}]*flex-wrap:\s*wrap/.test(css) && /\.hero-kicker \{[^}]*min-width:\s*min\(100%, 12em\)/.test(css), '홈 버튼 줄바꿈이나 안내 최소 너비가 없습니다.');
check(rules.includes('match /homework/{hid}') && rules.includes("match /notes/{nid}") && !rules.includes("allow read, write: if true"), '과제 규칙이 없거나 기존 규칙을 느슨하게 열었습니다.');
check(isTap({ x: 0, y: 0 }, { x: 1, y: 1 }, { scrolled: true }) === false, '스크롤을 탭으로 봅니다.');
check(homeworkTitle(gone) === '독서록', '지운 과제의 제목이 없습니다.');

const exported = buildExport(snapshot(), { at: '2026-11-16T00:00:00.000Z' });
check(exported.homework?.some((row) => row.id === 'hw-new') && !JSON.stringify(exported).includes('sourceNotes'), '백업에 과제가 없거나 원본 노트가 섞입니다.');
const oldBackup = { ...exported };
delete oldBackup.homework;
const kept = await importText(JSON.stringify(oldBackup), 'replace');
check(kept.ok && snapshot().homework.some((row) => row.id === 'hw-new'), `예전 백업이 과제를 지웁니다: ${JSON.stringify(kept)}`);
const brought = await importText(JSON.stringify({ ...exported, homework: [{ id: 'hw-back', title: '복원과제', date: '2026-11-20', made: 9, metaAt: 9, roster: ['s1'], checks: { s1: { at: 9, on: 1 } }, gone: 0 }] }), 'replace');
check(brought.ok && snapshot().homework.some((row) => row.title === '복원과제'), '백업을 되돌리면 과제가 돌아오지 않습니다.');
await addHomework('되돌릴 과제', '2026-11-16', 'hw-undo', ['s1', 's2']);
await toggleHomeworkSubmit('hw-undo', 's1');
const stamped = snapshot().homework.find((row) => row.id === 'hw-undo');
await undo();
const undone = snapshot().homework.find((row) => row.id === 'hw-undo');
check(undone?.checks?.s1?.on === 0 && undone.checks.s1.at > stamped.checks.s1.at, '되돌리기가 체크를 새 시각으로 끄지 않습니다.');
check(mergeHomework(undone, stamped).checks.s1.on === 0, '되돌린 체크가 클라우드의 더 나중 시각에 밀립니다.');
await removeHomework('hw-undo');
const removed = snapshot().homework.find((row) => row.id === 'hw-undo');
await undo();
const back = snapshot().homework.find((row) => row.id === 'hw-undo');
check(!Number(back?.gone) && back.metaAt > removed.gone, '지우기 되돌리기가 새 시각으로 풀리지 않습니다.');
check(mergeHomework(back, removed).gone === 0, '지운 클라우드 시각이 되돌리기를 이깁니다.');
check(homeworkWatchOnError({ code: 'permission-denied' }) === 'skip' && homeworkWatchOnError({ code: 'unavailable' }) === 'retry', '오프라인 오류에도 과제 감시를 끕니다.');
useWatchTimingForTest({ retry: 1000 });
check(watchRetryDue({ error: '', homeworkSkipped: true, startedAt: Date.now() - 5000 }, Date.now()), '규칙이 바뀌기 전 탭이 감시를 다시 켜지 않습니다.');
check(!watchRetryDue({ error: '', homeworkSkipped: false, startedAt: 0 }, Date.now()), '정상 감시를 다시 켭니다.');
useWatchTimingForTest(null);
check(/\.tap\.primary-btn\.block[^{]*\{[^}]*align-items:\s*center/.test(css), '추가 버튼 글자가 세로 가운데가 아닙니다.');

resetSyncStatusForTest();
syncEnd({ ok: false, homeworkLocal: true });
check(chipState({ cloudReady: true, signedIn: true, online: true })?.label === '과제는 아직 이 기기에만 있어요', '거절된 과제가 동기화됨으로 보입니다.');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('과제 체크 검사를 통과했습니다.');
