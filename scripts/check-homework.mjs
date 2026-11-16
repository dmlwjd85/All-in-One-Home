/** 과제 체크: 과제마다 메모 하나, 옛 메모 목록에는 안 보이고, 학생별로 나중에 고친 쪽이 이깁니다. */
import { readFileSync } from 'node:fs';
import { MENU, menuSelected } from '../src/ui/menu.js';
import { resolveHash } from '../src/lib/routes.js';
import { isMinutes, minutesList } from '../src/lib/minutes.js';
import { isTap } from '../src/ui/tapGuard.js';
import { fingerprint } from '../src/lib/cloud.js';
import { fromCloudRow, toCloudRow } from '../src/lib/cloudShape.js';
import {
    assignmentNote, foldHomeworkLists, homeworkAssignments, homeworkBody, homeworkOverdue, homeworkProgress,
    homeworkProgressLabel, isHomework, isHomeworkCheck, isHomeworkNote, mergeHomeworkRows, pastHomework,
    readHomeworkPack, visibleHomework,
} from '../src/lib/homework.js';
import {
    absorbCloudForTest, addHomework, queuedCloudKeys, removeHomework, resetClockForTest, setHomeworkDate,
    snapshot, submitAllHomework, toggleHomeworkSubmit, useAuthForTest, useVaultsForTest,
} from '../src/lib/db.js';

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
const vault = () => {
    const map = new Map();
    return { get: async (key) => map.get(key), set: async (key, value) => { map.set(key, value); }, remove: async (key) => { map.delete(key); }, map };
};
const mainVault = vault();
useVaultsForTest(mainVault, vault(), vault());
resetClockForTest({ measured: true });
useAuthForTest('teacher-hw');

const labels = MENU.map((row) => row[0]);
check(labels[labels.indexOf('출결') + 1] === '과제 체크', `메뉴에서 과제 체크가 출결 다음이 아닙니다: ${labels.join('|')}`);
check(menuSelected('homework', '#/homework') && resolveHash('#/homework/hw-read1', '2026-11-16').params.id === 'hw-read1', '과제 체크 주소가 열리지 않습니다.');
const actions = readFileSync(new URL('../src/ui/actions.js', import.meta.url), 'utf8');
check(/FREQUENT_ACTION_IDS = \['attend', 'homework'/.test(actions), '쨈 메뉴에서 과제 체크가 출결 다음이 아닙니다.');

const row = assignmentNote({ id: 'hw-read1', title: '독서록', date: '2026-11-16', roster: ['s1', 's2', 's3'], made: 100 });
const shaped = toCloudRow('notes', row);
check(shaped?.body?.tags?.includes('회의') && shaped.body.tags.includes('과제') && shaped.body.text.includes('@@HW1'), `과제 문서 모양이 아닙니다: ${JSON.stringify(shaped?.body)}`);
const back = fromCloudRow('notes', shaped.id, shaped.body);
check(isHomework(back) && isMinutes(back) && !isHomeworkNote({ id: 'note-1', text: '과제', tags: [] }), '받아 온 과제를 알아보지 못하거나 일반 메모로 봅니다.');
check(!minutesList([back, { id: 'meet-1', tags: ['회의'], text: '본문', title: '회의', date: '2026-11-01' }]).some((item) => item.id === 'hw-read1'), '과제 문서가 회의록 목록에 섞입니다.');
check(minutesList([{ id: 'note-1', text: '그냥 메모', tags: [], title: '' }]).length === 0, '일반 메모를 회의록으로 봅니다.');

/* 옛 메모 목록은 회의 태그를 빼므로, 학생 id 조각이 카드로 보이지 않습니다. */
const legacyCheck = { id: 'hx-hw-read1-s1', title: 'hw-read1', text: 's1', tags: ['제출'], pinned: false, source: 'app', editAt: 50 };
const legacyHw = { id: 'hw-read1', title: '독서록', text: '과제', date: '2026-11-16', tags: ['과제'], pinned: false, source: 'app', editAt: 40 };
check(!isMinutes(legacyCheck) && isHomeworkCheck(legacyCheck), '옛 제출 메모를 회의록으로 잘못 봅니다.');
const folded = foldHomeworkLists([legacyHw, legacyCheck], []);
check(folded.removed.some((item) => item.id === legacyCheck.id) && !folded.cloud.some(isHomeworkCheck), '옛 제출 메모를 빼지 않습니다.');
const packed = readHomeworkPack(folded.cloud[0]);
check(packed?.checks?.s1?.on === 1 && folded.cloud[0].tags.includes('회의'), `옛 제출이 과제 문서에 들어가지 않습니다: ${JSON.stringify(packed)}`);
const orphan = foldHomeworkLists([legacyCheck], []);
check(orphan.removed.length === 1 && orphan.cloud.length === 0, '지운 과제의 제출 메모를 되살립니다.');
const again = foldHomeworkLists(folded.cloud, []);
check(!again.changed, '이미 옮긴 과제 문서를 매번 다시 고칩니다.');

const memoList = [folded.cloud[0], { id: 'note-9', text: '준비물', tags: [], pinned: true, source: 'app' }].filter((item) => !isMinutes(item) && !isHomeworkNote(item));
check(memoList.length === 1 && memoList[0].id === 'note-9', '옛 메모 목록에 과제 기록이 남습니다.');

const added = await addHomework('독서록', '2026-11-16', 'hw-read1', ['s1', 's2', 's3']);
check(added.ok && snapshot().notes.filter(isHomeworkCheck).length === 0, '학생마다 문서를 만듭니다.');
await toggleHomeworkSubmit('hw-read1', 's1');
await toggleHomeworkSubmit('hw-read1', 's2');
check(homeworkProgress(snapshot().notes[0], [{ id: 's9' }]).total === 3, '지난 과제 수를 지금 명단으로 다시 셉니다.');
check(homeworkProgressLabel(homeworkProgress(snapshot().notes[0], [])) === '제출 2/3', '제출 수가 스냅샷과 다릅니다.');
const first = snapshot().notes.find((item) => item.id === 'hw-read1');
await addHomework('나중에 만든 과제', '2026-11-10', 'hw-new', ['s1']);
check(homeworkAssignments(snapshot().notes)[0].id === 'hw-new', '새 과제가 목록 맨 위가 아닙니다.');
check(homeworkOverdue('2026-11-10', '2026-11-16') && pastHomework(snapshot().notes, '2026-11-16').some((item) => item.id === 'hw-new'), '마감이 지난 과제를 지나간 것으로 보지 않습니다.');
check(visibleHomework(snapshot().notes, { today: '2026-11-16' }).every((item) => item.id !== 'hw-new'), '지난 과제를 기본 목록에 펼칩니다.');
check(visibleHomework(snapshot().notes, { today: '2026-11-16', query: '나중에' }).some((item) => item.id === 'hw-new'), '찾기로 지난 과제가 나오지 않습니다.');

const localPack = readHomeworkPack(first);
const remote = mergeHomeworkRows(first, {
    ...first,
    title: '다른 이름',
    date: '2026-11-20',
    text: homeworkBody({
        made: localPack.made,
        metaAt: localPack.metaAt + 5,
        roster: ['s1', 's2', 's3'],
        checks: { s3: { at: (localPack.checks.s1?.at || 0) + 9, on: 1 }, s1: { at: 1, on: 0 } },
    }),
});
const remotePack = readHomeworkPack(remote);
check(remote.title === '다른 이름' && remote.date === '2026-11-20' && remotePack.checks.s1.on === 1 && remotePack.checks.s3.on === 1, `학생별 합치기가 틀립니다: ${JSON.stringify(remotePack)}`);

await absorbCloudForTest({
    notes: [fromCloudRow('notes', 'hw-read1', toCloudRow('notes', remote).body)],
    ats: { notes: { 'hw-read1': (first.editAt || 0) + 20 } },
    ids: { notes: ['hw-read1', 'hw-new'] },
}, { [`notes/hw-read1`]: fingerprint(toCloudRow('notes', first).body, toCloudRow('notes', first).clear || []) });
const merged = readHomeworkPack(snapshot().notes.find((item) => item.id === 'hw-read1'));
check(merged?.checks?.s1?.on === 1 && merged?.checks?.s2?.on === 1 && merged?.checks?.s3?.on === 1, `받아 온 뒤 학생 제출이 빠졌습니다: ${JSON.stringify(merged?.checks)}`);

await setHomeworkDate('hw-read1', '2026-11-18');
await submitAllHomework('hw-read1', ['s1', 's2', 's3']);
check(homeworkProgress(snapshot().notes.find((item) => item.id === 'hw-read1'), []).submitted === 3, '모두 제출이 스냅샷을 채우지 않습니다.');
await removeHomework('hw-read1');
check(!snapshot().notes.some((item) => item.id === 'hw-read1') && queuedCloudKeys().includes('notes/hw-read1'), '지운 과제의 클라우드 문서가 안 지워집니다.');
check(!snapshot().notes.some(isHomeworkCheck), '지운 과제 옆에 제출 조각이 남습니다.');

const ui = readFileSync(new URL('../src/ui/Homework.jsx', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
check(ui.includes('onClick') && ui.includes('data-tap-guard="1"') && ui.includes('지난 과제') && ui.includes('과제 찾기') && ui.includes('마감일'), '화면 문구·클릭·찾기가 빠졌습니다.');
check(!ui.includes('>날짜<'), '마감일을 날짜라고 부릅니다.');
check(css.includes('grid-template-columns: repeat(auto-fill') && /\.hero-actions \.hero-action \{[^}]*width:\s*auto/.test(css) && /\.hw-date-toggle \{[^}]*[^-]width:\s*auto/.test(css), '명단 격자나 버튼 너비가 글자에 맞지 않습니다.');
check(isTap({ x: 0, y: 0 }, { x: 1, y: 1 }, { scrolled: true }) === false, '스크롤을 탭으로 봅니다.');
const sw = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
check(sw.includes("const CACHE = 'ssug-gyomu-shell-v94'") && rules.includes('match /notes/{nid}') && !/match\s+\/homework/.test(rules), '규칙이나 캐시 판이 바뀌었습니다.');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('과제 체크 검사를 통과했습니다.');
