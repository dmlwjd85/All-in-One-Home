/** 기기 사이 동기화: 최근 것 고르기, 지우기 대기열 저장·재시도, 다시 볼 때 받아오기, 동기화 칩을 확인합니다. */
import {
    FORGET_LIMIT, FORGET_MAX_AGE_MS, REFRESH_GAP_MS, diffCloudRows, drainQueue, forgottenIds, mergeBucket, mergeTimetable,
    normalizeQueue, queueAdd, queueDropPresent, remoteWins, shouldRefresh, stampList, stampTimetable, timeOf,
    FUTURE_SLACK_MS, clampFutureStamps, estimateOffset, movedToLocal, pushDecision, stampAfter, takeRemote, uploadTime,
} from '../src/lib/sync.js';
import { chipState, resetSyncStatusForTest, syncBegin, syncEnd, syncQueued, syncStatus, syncAuthKnown, agoLabel } from '../src/lib/syncStatus.js';
import { toCloudRow } from '../src/lib/cloudShape.js';
import {
    boot, cycleAttendance, finishSetup, removeItem, setAttendance, setAuth, snapshot, syncMetaForTest, undo, update, useMemoryOnlyForTest, useVaultsForTest,
} from '../src/lib/db.js';

import { readFileSync } from 'node:fs';

const failures = [];
let count = 0;
function check(ok, message) {
    count += 1;
    if (!ok) failures.push(message);
}

const T = (text) => new Date(text).toISOString();
const since = Date.parse('2026-10-27T09:00:00+09:00');

/* ---------- 최근 것 고르기 ---------- */
check(remoteWins({ updatedAt: T('2026-10-27T10:00:00+09:00') }, { updatedAt: T('2026-10-27T11:00:00+09:00') }), '클라우드가 더 최근인데 이 기기 것을 남겼습니다.');
check(!remoteWins({ updatedAt: T('2026-10-27T12:00:00+09:00') }, { updatedAt: T('2026-10-27T11:00:00+09:00') }), '이 기기가 더 최근인데 클라우드 것을 가져왔습니다.');
check(!remoteWins({ updatedAt: T('2026-10-27T11:00:00+09:00') }, { updatedAt: T('2026-10-27T11:00:00+09:00') }), '시각이 같으면 이 기기 것을 남겨야 합니다.');
check(!remoteWins({ updatedAt: T('2026-10-27T11:00:00+09:00') }, { updatedAt: '' }), '클라우드에 시각이 없는데 덮었습니다.');
check(!remoteWins({}, { updatedAt: T('2026-10-27T08:00:00+09:00') }, { since }), '옛 기록(시각 없음)이 새 방식 전 클라우드 것에 덮였습니다.');
check(remoteWins({}, { updatedAt: T('2026-10-27T10:00:00+09:00') }, { since }), '새 방식 뒤에 다른 기기에서 고친 것을 못 받았습니다.');
check(!remoteWins({}, { updatedAt: T('2026-10-27T10:00:00+09:00') }), '기준 시각이 없으면 옛 기록을 지켜야 합니다.');
check(remoteWins({}, { updatedAt: T('2026-10-27T08:00:00+09:00') }, { since, clean: true }), '마지막으로 올린 그대로인 옛 기록은 클라우드 것을 받아야 합니다.');
check(timeOf({ toMillis: () => 5 }) === 5 && timeOf({ seconds: 2, nanoseconds: 0 }) === 2000 && timeOf('엉터리') === 0, 'Timestamp·잘못된 값 처리가 다릅니다.');

{
    const local = [
        { id: 'r1', kind: '관찰', date: '2026-10-27', text: '이 기기 옛 글', updatedAt: T('2026-10-27T10:00:00+09:00'), source: 'legacy' },
        { id: 'r2', kind: '관찰', date: '2026-10-27', text: '이 기기가 최근', updatedAt: T('2026-10-27T12:00:00+09:00') },
        { id: 'r3', kind: '관찰', date: '2026-10-27', text: '시각 없는 옛 기록' },
        { id: 'r4', kind: '관찰', date: '2026-10-27', text: '다른 기기에서 지운 것', updatedAt: T('2026-10-27T09:30:00+09:00') },
        { id: 'r5', kind: '관찰', date: '2026-10-27', text: '아직 안 올린 새 기록', updatedAt: T('2026-10-27T12:30:00+09:00') },
    ];
    const remote = [
        { id: 'r1', kind: '관찰', date: '2026-10-27', text: '폰에서 고친 글', updatedAt: T('2026-10-27T11:00:00+09:00') },
        { id: 'r2', kind: '관찰', date: '2026-10-27', text: '폰 옛 글', updatedAt: T('2026-10-27T11:00:00+09:00') },
        { id: 'r3', kind: '관찰', date: '2026-10-27', text: '예전 클라우드 글', updatedAt: T('2026-10-20T11:00:00+09:00') },
        { id: 'r6', kind: '관찰', date: '2026-10-27', text: '폰에서 새로 적음', updatedAt: T('2026-10-27T11:30:00+09:00') },
        { id: 'r7', kind: '관찰', date: '2026-10-27', text: '이 기기에서 지우는 중', updatedAt: T('2026-10-27T11:30:00+09:00') },
    ];
    const seen = new Set(['records/r1', 'records/r2', 'records/r3', 'records/r4', 'records/r7']);
    const merged = mergeBucket('records', local, remote, { since, forgotten: new Set(['r7']), seen, fromServer: true });
    const byId = Object.fromEntries(merged.rows.map((row) => [row.id, row]));
    check(byId.r1?.text === '폰에서 고친 글' && byId.r1.source === 'legacy', `더 최근 클라우드 글을 못 받았거나 출처 표시가 바뀌었습니다: ${JSON.stringify(byId.r1)}`);
    check(byId.r2?.text === '이 기기가 최근', '이 기기의 최근 글이 덮였습니다.');
    check(byId.r3?.text === '시각 없는 옛 기록', '시각 없는 옛 기록이 예전 클라우드 글에 덮였습니다.');
    check(!byId.r4 && merged.removed.some((row) => row.id === 'r4'), '다른 기기에서 지운 기록이 남았습니다.');
    check(byId.r5?.text === '아직 안 올린 새 기록', '아직 안 올린 새 기록이 지워졌습니다.');
    check(byId.r6?.text === '폰에서 새로 적음', '폰에서 새로 적은 기록을 못 받았습니다.');
    check(!byId.r7, '지우기 대기열에 있는 기록이 되살아났습니다.');
    check(merged.taken.map((row) => row.id).sort().join() === 'r1,r6', `받아 온 줄 목록이 다릅니다: ${merged.taken.map((row) => row.id)}`);

    const cached = mergeBucket('records', local, remote, { since, seen, fromServer: false });
    check(cached.rows.some((row) => row.id === 'r4') && !cached.removed.length, '캐시만 본 결과로 기록을 지웠습니다.');
    const unseen = mergeBucket('records', local, remote, { since, seen: new Set(), fromServer: true });
    check(unseen.rows.some((row) => row.id === 'r4'), '본 적 없는 기록을 다른 기기에서 지운 것으로 봤습니다.');
}

{
    const memo = '알레르기 약 챙기기';
    const localSensitive = { id: 'sensitive-1', title: '보건실 투약 확인' };
    const merged = mergeBucket('todos', [localSensitive], [], { seen: new Set(['todos/sensitive-1']), fromServer: true });
    check(merged.rows.length === 1, '이 기기 전용(민감) 줄을 다른 기기에서 지운 것으로 봤습니다.');
    const student = mergeBucket('students', [{ id: 's1', no: 1, name: '가', memo }], [{ id: 's1', no: 1, name: '가나', memo: '', updatedAt: T('2026-10-27T11:00:00+09:00') }], { since, isClean: () => true });
    check(student.rows[0].name === '가나' && student.rows[0].memo === memo, '학생 이름을 받으면서 이 기기 민감 메모를 지웠습니다.');
    const attend = mergeBucket('attendance', [{ id: 'local-x', date: '2026-10-27', sid: 's1', status: '결석', updatedAt: T('2026-10-27T10:00:00+09:00') }], [{ id: '2026-10-27_s1', date: '2026-10-27', sid: 's1', status: '지각', updatedAt: T('2026-10-27T11:00:00+09:00') }], { since });
    check(attend.rows.length === 1 && attend.rows[0].status === '지각' && attend.rows[0].id === 'local-x', `출결을 날짜_학생 키로 못 맞췄습니다: ${JSON.stringify(attend.rows)}`);
}

{
    const now = T('2026-10-27T13:00:00+09:00');
    const prev = [{ id: 'a', text: '그대로', updatedAt: 'x' }, { id: 'b', text: '고치기 전', updatedAt: 'y' }];
    const next = stampList(prev, [{ id: 'a', text: '그대로', updatedAt: 'x' }, { id: 'b', text: '고친 뒤', updatedAt: 'y' }, { id: 'c', text: '새 줄' }, { id: 'd', text: '받아 온 줄', updatedAt: '' }], now);
    check(next[0].updatedAt === 'x', '안 바뀐 줄의 시각을 바꿨습니다.');
    check(next[1].updatedAt === now, '고친 줄에 시각을 안 찍었습니다.');
    check(next[2].updatedAt === now, '새 줄에 시각을 안 찍었습니다.');
    check(next[3].updatedAt === '', '받아 온 줄(시각 칸 있음)에 새 시각을 찍었습니다.');
    const forced = stampList([{ id: 'a', text: '지금', updatedAt: 'z' }], [{ id: 'a', text: '되돌림', updatedAt: 'x' }, { id: 'e', text: '되살림', updatedAt: 'w' }], now, { force: true });
    check(forced[0].updatedAt === now && forced[1].updatedAt === now, '되돌린 줄을 방금 고친 것으로 찍지 않았습니다.');
    check(!toCloudRow('records', { id: 'r', kind: '관찰', text: '그냥 메모', date: '2026-10-27', updatedAt: now })?.body?.updatedAt, '기기용 updatedAt 문자열이 클라우드 본문에 그대로 들어갑니다.');

    const stamps = stampTimetable({ 월: { 1: '국어' } }, { 월: { 1: '수학' }, 화: { 1: '과학' } }, {}, now);
    check(stamps.월 === now && stamps.화 === now, '시간표 고친 요일에 시각이 없습니다.');
    const table = mergeTimetable({ 월: { 1: '수학' }, 수: {} }, { 월: { 1: '국어' }, 수: { 1: '음악' } }, { 월: now }, { 월: T('2026-10-27T11:00:00+09:00') }, { since });
    check(table.table.월[1] === '수학' && table.table.수[1] === '음악', `시간표 합치기가 다릅니다: ${JSON.stringify(table.table)}`);
}

{
    const before = { attendance: [{ id: '2026-10-27_s1', date: '2026-10-27', sid: 's1', status: '결석' }], students: [{ id: 's1' }, { id: 'demo', source: 'demo' }] };
    const after = { attendance: [], students: [] };
    const { gone } = diffCloudRows(before, after);
    check(gone.some((item) => item.name === 'attendance' && item.id === '2026-10-27_s1'), '출석으로 되돌린 출결이 지울 목록에 없습니다.');
    check(gone.some((item) => item.name === 'students' && item.id === 's1') && !gone.some((item) => item.id === 'demo'), '학생 지움 또는 예시 줄 처리가 다릅니다.');
}

/* ---------- 지우기 대기열 ---------- */
{
    const now = Date.parse('2026-10-27T12:00:00+09:00');
    let queue = queueAdd([], [{ name: 'records', id: 'r1' }, { name: 'records', id: 'r1' }], 'u1', now);
    check(queue.length === 1, '같은 문서를 대기열에 두 번 넣었습니다.');
    check(queueAdd([], [{ name: 'records', id: 'r1' }], '', now).length === 0, '로그인 없이 대기열에 넣었습니다.');
    queue = queueAdd(queue, [{ name: 'attendance', id: '2026-10-27_s1' }], 'u1', now);
    check(forgottenIds(queue, 'u1').attendance?.has('2026-10-27_s1') && !forgottenIds(queue, 'u2').records, '계정별 대기열 id가 다릅니다.');
    check(queueDropPresent(queue, new Set(['attendance/2026-10-27_s1']), 'u1').length === 1, '다시 생긴 줄을 대기열에서 못 뺐습니다.');
    check(normalizeQueue([{ uid: 'u1', name: 'records', id: 'old', at: now - FORGET_MAX_AGE_MS - 1 }], now).length === 0, '너무 오래된 대기열 항목이 남았습니다.');
    check(normalizeQueue(Array.from({ length: FORGET_LIMIT + 20 }, (_, i) => ({ uid: 'u1', name: 'records', id: `r${i}`, at: now })), now).length === FORGET_LIMIT, '대기열 개수 제한이 다릅니다.');
    check(normalizeQueue('망가진 값').length === 0 && normalizeQueue([null, { uid: 'u1' }]).length === 0, '망가진 대기열을 걸러 내지 못했습니다.');

    let calls = 0;
    const flaky = async (name, id) => {
        calls += 1;
        if (id === 'r1' && calls <= 2) throw new Error('unavailable');
        return { ok: true };
    };
    const first = await drainQueue(queue, 'u1', flaky);
    check(first.done.length === 1 && first.left.length === 1 && first.left[0].id === 'r1', `실패한 지우기가 대기열에 안 남았습니다: ${JSON.stringify(first.left)}`);
    const second = await drainQueue(first.left, 'u1', flaky);
    check(second.done.length === 1 && second.left.length === 0, '다시 시도한 지우기가 안 끝났습니다.');
    const slow = await drainQueue(queue, 'u1', () => new Promise(() => {}), { timeoutMs: 20 });
    check(slow.done.length === 0 && slow.left.length === 2, '응답 없는 지우기를 끝난 것으로 봤습니다.');
    const denied = await drainQueue(queue, 'u1', async () => ({ ok: false }));
    check(denied.left.length === 2, '실패 응답을 끝난 것으로 봤습니다.');
    const other = await drainQueue(queue, 'u2', async () => ({ ok: true }));
    check(other.done.length === 0 && other.left.length === 2, '다른 계정 대기열을 지웠습니다.');
}

/* ---------- 다시 볼 때 받아오기 ---------- */
{
    const now = 1_000_000;
    check(shouldRefresh({ reason: 'visible', now, lastAt: 0 }), '처음 다시 볼 때 안 받아옵니다.');
    check(!shouldRefresh({ reason: 'focus', now, lastAt: now - REFRESH_GAP_MS + 1 }), '30초 안에 또 받아옵니다.');
    check(shouldRefresh({ reason: 'focus', now, lastAt: now - REFRESH_GAP_MS }), '30초가 지났는데 안 받아옵니다.');
    check(shouldRefresh({ reason: 'online', now, lastAt: now - 1 }), '인터넷이 돌아왔는데 바로 안 받아옵니다.');
    check(!shouldRefresh({ reason: 'visible', now, lastAt: 0, hidden: true }), '숨은 화면에서 받아옵니다.');
}

/* ---------- 2차 검수: 받아오기·시각 찍기·시계 차이·올리기 판단 ---------- */
{
    const t1 = T('2026-10-27T10:00:00+09:00');
    const t2 = T('2026-10-27T11:00:00+09:00');
    // 받아 와도 이 기기 출처(source)는 남습니다.
    const got = mergeBucket('records', [{ id: 'q1', kind: '관찰', date: '2026-10-27', text: '옛 글', source: 'legacy', updatedAt: t1 }], [{ id: 'q1', kind: '관찰', date: '2026-10-27', text: '새 글', source: 'app', updatedAt: t2 }]);
    check(got.rows[0].text === '새 글' && got.rows[0].source === 'legacy', `받아오면서 출처가 바뀌었습니다: ${JSON.stringify(got.rows[0])}`);

    // 민감한 메모가 있어 이 기기에만 있던 출결 메모·사유는 다른 기기가 상태를 고쳐도 남습니다.
    const att = { id: '2026-10-27_s1', date: '2026-10-27', sid: 's1', status: '결석', reason: '질병', note: '보건실 다녀옴', updatedAt: t1 };
    const fromB = { id: '2026-10-27_s1', date: '2026-10-27', sid: 's1', status: '지각', reason: '', period: '', paper: false, note: '', source: 'app', updatedAt: t2 };
    const merged = mergeBucket('attendance', [att], [fromB]).rows[0];
    check(merged.status === '지각' && merged.note === '보건실 다녀옴' && merged.reason === '질병', `받아오면서 이 기기 출결 메모·사유가 지워졌습니다: ${JSON.stringify(merged)}`);
    // 클라우드까지 갔던 메모를 다른 기기에서 지웠으면 지운 쪽을 따릅니다.
    const plain = { ...att, note: '늦잠', reason: '' };
    check(mergeBucket('attendance', [plain], [fromB]).rows[0].note === '', '다른 기기에서 지운 메모가 되살아났습니다.');
    check(takeRemote('todos', { id: 'x', title: '가', due: '2026-10-28' }, { id: 'x', title: '나', due: '' }).due === '', '클라우드로 가는 칸을 비운 고침이 무시됐습니다.');
    check(got.kept.length === 0, '클라우드가 더 최근인데 다시 올리라고 했습니다.');
    const keptRun = mergeBucket('records', [{ id: 'q2', kind: '관찰', date: '2026-10-27', text: '이 기기 최근', updatedAt: t2 }], [{ id: 'q2', kind: '관찰', date: '2026-10-27', text: '클라우드 옛 글', updatedAt: t1 }]);
    check(keptRun.kept.some((row) => row.id === 'q2'), '이 기기가 더 최근인데 다시 올리라고 하지 않았습니다(두 기기가 계속 다를 수 있음).');

    // 시각 찍기
    const prev = [{ id: 'a', text: '가', updatedAt: t1 }];
    check(stampList(prev, [{ id: 'a', text: '나' }], t2)[0].updatedAt === t2, '새 객체로 저장한 고침에 시각이 안 찍혔습니다.');
    check(stampList(prev, [{ text: '가', id: 'a' }], t2)[0].updatedAt === t1, '내용이 같은 새 객체가 시각을 잃었거나 새로 찍혔습니다.');
    const later = T('2026-10-27T10:30:00+09:00');
    check(stampList(prev, [{ id: 'a', text: '다', updatedAt: later }], t2)[0].updatedAt === later, '받아 온 줄의 시각을 지금으로 덮었습니다.');
    check(stampList(prev, [{ id: 'a', text: '가', updatedAt: '' }], t2, { force: true })[0].updatedAt === t1, '되돌린 줄이 내용이 같은데 새 시각을 받았습니다.');
    check(stampList(prev, [{ id: 'a', text: '라' }], t2, { force: true })[0].updatedAt === t2, '되돌려 내용이 달라진 줄에 시각이 안 찍혔습니다.');
    // 늦은 시계: 받은 시각보다 앞선 시각을 찍지 않습니다.
    check(stampAfter(t1, t2) === new Date(Date.parse(t2) + 1).toISOString() && stampAfter(t2, t1) === t2, '고친 시각이 앞서 찍힌 시각보다 앞섭니다.');
    check(stampList([{ id: 'a', text: '가', updatedAt: t2 }], [{ id: 'a', text: '나' }], t1)[0].updatedAt > t2, '시계가 늦은 기기의 고침이 받은 것보다 옛 것으로 찍혔습니다.');

    // 시계 차이(크리스티안 방식)
    check(estimateOffset({ sentAt: 1000, receivedAt: 1200, serverAt: 601100 }) === 600000, '시계 차이를 잘못 쟀습니다.');
    check(estimateOffset({ sentAt: 0, receivedAt: 6000, serverAt: 9000 }) === null, '왕복이 너무 긴 측정을 버리지 않았습니다.');
    check(estimateOffset({ sentAt: 0, receivedAt: 10, serverAt: null }) === null, '서버 시각이 없는데 차이를 정했습니다.');
    const serverNow = Date.parse('2026-10-27T12:00:00+09:00');
    check(uploadTime(serverNow + 10 * 60 * 1000, serverNow) === serverNow, '10분 앞선 기기 시각을 그대로 올렸습니다.');
    check(uploadTime(serverNow + FUTURE_SLACK_MS - 1, serverNow) === serverNow + FUTURE_SLACK_MS - 1, '1분 안쪽 시각을 바꿨습니다.');
    check(uploadTime(serverNow - 3600_000, serverNow) === serverNow - 3600_000, '고친 시각 대신 서버 지금 시각을 올렸습니다.');
    check(uploadTime('', serverNow) === serverNow, '시각 없는 줄에 서버 시각을 안 넣었습니다.');
    const list = [{ id: 'f', updatedAt: new Date(serverNow + 600_000).toISOString() }, { id: 'g', updatedAt: t1 }];
    const clamped = clampFutureStamps(list, serverNow);
    check(clamped[0].updatedAt === new Date(serverNow).toISOString() && clamped[1] === list[1], '앞날 시각을 지금으로 당기지 않았습니다.');
    check(clampFutureStamps([list[1]], serverNow).length === 1 && clampFutureStamps(list.slice(1), serverNow)[0] === list[1], '바뀐 게 없는데 새 목록을 만들었습니다.');

    // 올리기 전 서버 판 보기
    check(pushDecision({ exists: true, serverMs: 20, localMs: 10 }) === 'stale', '서버가 더 최근인데 덮어썼습니다.');
    check(pushDecision({ exists: true, serverMs: 10, localMs: 10 }) === 'write' && pushDecision({ exists: true, serverMs: 0, localMs: 10 }) === 'write', '이 기기 것이 같거나 최근인데 안 올렸습니다.');
    check(pushDecision({ exists: false, seen: true }) === 'gone' && pushDecision({ exists: false, seen: false }) === 'write', '서버에서 지운 것과 새 문서를 구분하지 못했습니다.');

    // 이 기기 전용으로 옮겨 간 줄
    const before = { records: [{ id: 'm1', kind: '관찰', date: '2026-10-27', text: '보통 글' }], local: { records: [] } };
    const after = { records: [], local: { records: [{ id: 'm1', kind: '관찰', date: '2026-10-27', text: '보건 상담' }] } };
    check(movedToLocal(before, after).some((item) => item.name === 'records' && item.id === 'm1'), '이 기기 전용으로 옮긴 줄을 찾지 못했습니다.');
    check(!movedToLocal(before, { records: [], local: { records: [] } }).length, '그냥 지운 줄을 옮긴 것으로 봤습니다.');
    check(!movedToLocal(before, { records: [], local: { records: [{ id: 'm9', kind: '관찰', date: '2026-10-27', text: '다른 글' }] } }).length, '이 기기 칸에 다른 글만 있는데 지운 줄을 옮긴 것으로 봤습니다.');

    // 로그인 계정이 없으면 대기열에 넣지 않습니다.
    check(queueAdd([], [{ name: 'records', id: 'x' }], '').length === 0, '계정 없이 대기열에 넣었습니다.');
}

/* ---------- 동기화 칩 ---------- */
{
    resetSyncStatusForTest();
    const now = Date.parse('2026-10-27T12:00:00+09:00');
    check(chipState({ cloudReady: false, signedIn: true, online: true, now }) === null, '클라우드 설정이 없는데 칩이 보입니다.');
    const wait = chipState({ cloudReady: true, signedIn: false, online: true, now });
    check(wait?.kind === 'wait' && wait.label === '', '로그인 확인 전에는 글 없는 빈 자리만 잡아야 합니다(늦게 나타나 화면이 밀리지 않게).');
    syncAuthKnown();
    check(chipState({ cloudReady: true, signedIn: false, online: true, now })?.label === '로그인이 필요해요', '로그인 필요 칩이 다릅니다.');
    check(chipState({ cloudReady: true, signedIn: true, online: false, now })?.label === '연결 기다리는 중', '오프라인 칩이 다릅니다.');
    check(!chipState({ cloudReady: true, signedIn: true, online: false, now }).label.includes('끊겼'), '오프라인 칩이 배너와 같은 말을 합니다.');
    check(chipState({ cloudReady: true, signedIn: false, guest: true, online: true, now })?.kind === 'local', '이 기기에서만 쓰는 사람에게 로그인 재촉 칩이 보입니다.');
    check(chipState({ cloudReady: true, signedIn: false, guest: true, online: true, now }).label === '이 기기에만 저장', '이 기기에만 저장 칩 문구가 다릅니다.');
    syncBegin();
    check(chipState({ cloudReady: true, signedIn: true, online: true, now })?.label === '동기화 중', '올리는 중 칩이 다릅니다.');
    syncEnd({ ok: true, at: now - 3 * 60 * 1000 });
    const done = chipState({ cloudReady: true, signedIn: true, online: true, now });
    check(done?.label === '동기화됨' && done.hint.includes('3분 전'), `동기화됨 칩이 다릅니다: ${JSON.stringify(done)}`);
    syncQueued(2);
    check(chipState({ cloudReady: true, signedIn: true, online: true, now })?.kind === 'syncing', '지우기 대기열이 남았는데 동기화됨으로 보입니다.');
    syncQueued(0);
    syncBegin();
    syncEnd({ ok: false, pending: 1 });
    const bad = chipState({ cloudReady: true, signedIn: true, online: true, now });
    check(bad?.kind === 'error' && bad.retry && syncStatus().failed, `실패한 뒤 오류 칩이 안 보입니다: ${JSON.stringify(bad)}`);
    syncBegin();
    check(chipState({ cloudReady: true, signedIn: true, online: true, now })?.kind === 'syncing', '다시 맞추는 동안에는 동기화 중이어야 합니다.');
    syncEnd({ ok: true, at: now });
    check(chipState({ cloudReady: true, signedIn: true, online: true, now })?.kind === 'synced', '다시 맞춘 뒤 동기화됨으로 안 돌아옵니다.');
    check(agoLabel(now - 10_000, now) === '방금' && agoLabel(now - 2 * 3600_000, now) === '2시간 전', '시간 문구가 다릅니다.');
    const words = ['연결 기다리는 중', '로그인이 필요해요', '이 기기에만 저장', '동기화하지 못했어요', '동기화 중', '동기화됨'];
    check(words.every((word) => /^[가-힣 ]+$/.test(word)), '칩 문구에 한글 말고 다른 글자가 섞였습니다.');
}

/* ---------- db: 대기열이 IndexedDB(ssug-gyomu)에 남고 다시 열어도 이어지는지 ---------- */
{
    function makeVault() {
        const bag = new Map();
        return {
            bag,
            async get(key) { return bag.has(key) ? structuredClone(bag.get(key)) : undefined; },
            async set(key, value) { bag.set(key, structuredClone(value)); },
            async remove(key) { bag.delete(key); },
        };
    }
    const main = makeVault();
    const local = makeVault();
    const inbox = makeVault();
    useVaultsForTest(main, local, inbox);
    await boot('');
    const firstSince = syncMetaForTest().since;
    check(firstSince > 0 && main.bag.get('syncSince') === firstSince, '처음 연 시각(syncSince)을 저장하지 않았습니다.');
    await finishSetup({ className: '6학년 3반', rosterText: '1 가나\n2 다라' });
    const [s1, s2] = snapshot().students;
    check(Boolean(s1?.updatedAt), '새 학생에 고친 시각이 없습니다.');

    // 로그인 전에 지운 건 대기열에 넣지 않습니다(어느 계정 것인지 모름).
    await setAttendance('2026-10-27', s1.id, '결석');
    await setAttendance('2026-10-27', s1.id, '출석');
    check(!syncMetaForTest().queue.length, '로그인 전 지움이 대기열에 들어갔습니다.');

    await setAuth({ uid: 'teacher-1', name: '' });
    await setAttendance('2026-10-27', s1.id, '결석');
    check(snapshot().attendance.some((row) => row.id === `2026-10-27_${s1.id}` && row.updatedAt), '결석 표시에 고친 시각이 없습니다.');
    await setAttendance('2026-10-27', s1.id, '출석');
    const saved = main.bag.get('cloudForget') || [];
    check(saved.some((item) => item.uid === 'teacher-1' && item.name === 'attendance' && item.id === `2026-10-27_${s1.id}`), `출석으로 되돌린 게 저장된 대기열에 없습니다: ${JSON.stringify(saved)}`);

    await setAttendance('2026-10-27', s1.id, '지각');
    check(!syncMetaForTest().queue.some((item) => item.name === 'attendance'), '다시 표시한 출결이 대기열에 남았습니다.');
    // 순환 버튼으로 출석까지 돌려도 대기열에 들어가야 합니다.
    for (let i = 0; i < 6 && snapshot().attendance.some((row) => row.id === `2026-10-27_${s1.id}`); i += 1) await cycleAttendance('2026-10-27', s1.id);
    check(syncMetaForTest().queue.some((item) => item.name === 'attendance'), '순환 버튼으로 출석이 된 출결이 대기열에 없습니다.');

    await removeItem('students', s2.id);
    check(syncMetaForTest().queue.some((item) => item.name === 'students' && item.id === s2.id), '지운 학생이 대기열에 없습니다.');
    await undo();
    check(snapshot().students.some((row) => row.id === s2.id), '되돌리기로 학생이 안 돌아왔습니다.');
    check(!syncMetaForTest().queue.some((item) => item.name === 'students' && item.id === s2.id), '되돌린 학생이 대기열에 남아 클라우드에서 지워질 뻔했습니다.');
    const back = snapshot().students.find((row) => row.id === s2.id);
    check(timeOf(back.updatedAt) >= Date.now() - 60_000, '되돌린 학생이 방금 고친 것으로 안 찍혔습니다(다른 기기 옛 것에 덮일 수 있음).');

    // 클라우드에서 본 적 있는 출결(로그인이 돌아오기 전에 지울 것)
    await setAttendance('2026-10-25', s1.id, '결석');
    main.bag.set('cloudSeen', { uid: 'teacher-1', keys: [`attendance/2026-10-25_${s1.id}`] });

    // 다시 열어도 대기열과 기준 시각이 이어집니다.
    const queueBefore = JSON.stringify(syncMetaForTest().queue);
    await boot('');
    check(JSON.stringify(syncMetaForTest().queue) === queueBefore && queueBefore.includes('attendance'), '앱을 다시 열었더니 지우기 대기열이 사라졌습니다.');
    check(syncMetaForTest().since === firstSince, '다시 열 때 기준 시각이 바뀌었습니다.');

    // 로그인이 돌아오기 전: 마지막으로 맞춘 계정에서 본 문서만 그 계정 대기열에 넣습니다.
    await setAttendance('2026-10-25', s1.id, '출석');
    check(syncMetaForTest().queue.some((item) => item.uid === 'teacher-1' && item.id === `2026-10-25_${s1.id}`), '로그인 복원 전에 지운, 클라우드에 있던 출결이 대기열에 없습니다.');
    await setAttendance('2026-10-24', s1.id, '결석');
    await setAttendance('2026-10-24', s1.id, '출석');
    check(!syncMetaForTest().queue.some((item) => item.id === `2026-10-24_${s1.id}`), '클라우드에서 본 적 없는 출결을 로그인 전에 대기열에 넣었습니다.');
    await setAuth({ uid: 'teacher-1', name: '' });

    // 대기열 저장이 실패하면 지운 것도 되돌립니다(화면과 저장이 어긋나지 않게).
    const keep = snapshot().attendance.length;
    await setAttendance('2026-10-26', s1.id, '결석');
    const realSet = main.set;
    main.set = async (key, value) => { if (key === 'cloudForget') throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); return realSet(key, value); };
    const failed = await setAttendance('2026-10-26', s1.id, '출석');
    main.set = realSet;
    check(failed?.storageFailed && snapshot().attendance.length === keep + 1, '대기열 저장 실패 뒤에도 출결이 지워진 채 남았습니다.');

    // clearAll·가져오기 같은 '이 기기만 비우기'는 대기열에 넣지 않습니다.
    const before = syncMetaForTest().queue.length;
    await update((draft) => { draft.records = []; return draft; });
    check(syncMetaForTest().queue.length === before, '사용자가 지우지 않은 변경이 대기열에 들어갔습니다.');
}

/* ---------- db 2차 검수: 이 기기 전용으로 옮김, 같은 id 짝, 공용 컴퓨터 대기열 ---------- */
{
    function makeVault() {
        const bag = new Map();
        return {
            bag,
            async get(key) { return bag.has(key) ? structuredClone(bag.get(key)) : undefined; },
            async set(key, value) { bag.set(key, structuredClone(value)); },
            async remove(key) { bag.delete(key); },
        };
    }
    const main = makeVault();
    useVaultsForTest(main, makeVault(), makeVault());
    await boot('');
    await finishSetup({ className: '6학년 3반', rosterText: '1 가나' });
    await setAuth({ uid: 'teacher-2', name: '' });
    const row = { id: 'mv1', kind: '관찰', date: '2026-10-27', text: '보통 관찰', source: 'app' };
    await update((draft) => { draft.records = [...draft.records, row]; return draft; });
    // 민감한 말을 넣어 이 기기 전용으로 옮기면 클라우드 판도 지워야 합니다(안 그러면 다른 기기에서 옛 글이 살아남).
    await update((draft) => {
        draft.records = draft.records.filter((item) => item.id !== 'mv1');
        draft.local.records = [...draft.local.records, { ...row, text: '보건 상담' }];
        return draft;
    });
    check(syncMetaForTest().queue.some((item) => item.name === 'records' && item.id === 'mv1'), '이 기기 전용으로 옮긴 글이 지우기 대기열에 없습니다.');

    // 사용자가 지운 게 아닌 변경(가져오기·이 기기 비우기)은 클라우드 글을 지우지 않습니다.
    await update((draft) => { draft.records = [...draft.records, { id: 'cl1', kind: '관찰', date: '2026-10-27', text: '남길 글', source: 'app' }]; return draft; });
    await update((draft) => { draft.records = []; return draft; });
    check(!syncMetaForTest().queue.some((item) => item.id === 'cl1'), '지우기가 아닌 변경인데 클라우드 글을 지우기 대기열에 넣었습니다.');

    // 같은 id가 클라우드 칸과 이 기기 칸에 함께 있으면, 누른 쪽만 지웁니다.
    await update((draft) => {
        draft.todos = [...draft.todos, { id: 'tw', title: '클라우드 할 일', done: false }];
        draft.local.todos = [...(draft.local.todos || []), { id: 'tw', title: '보건 서류', done: false }];
        return draft;
    });
    await removeItem('todos', 'tw', { local: true });
    check(snapshot().todos.some((item) => item.id === 'tw') && !snapshot().local.todos.some((item) => item.id === 'tw'), '이 기기 할 일을 지웠는데 같은 id 클라우드 할 일까지 지워졌습니다.');
    await removeItem('todos', 'tw', { local: false });
    check(!snapshot().todos.some((item) => item.id === 'tw'), '클라우드 할 일이 안 지워졌습니다.');

    // 공용 컴퓨터: 지우기 대기열은 이 기기 저장소(IndexedDB)에 쓰지 않습니다.
    const savedBefore = JSON.stringify(main.bag.get('cloudForget') || []);
    useMemoryOnlyForTest(true);
    await update((draft) => { draft.notes = [...draft.notes, { id: 'sh1', text: '공용 메모', pinned: false }]; return draft; });
    await removeItem('notes', 'sh1');
    check(syncMetaForTest().queue.some((item) => item.id === 'sh1'), '공용 컴퓨터에서 지운 메모가 대기열에 없습니다.');
    check(JSON.stringify(main.bag.get('cloudForget') || []) === savedBefore, '공용 컴퓨터인데 지우기 대기열을 이 기기 저장소에 남겼습니다.');
    useMemoryOnlyForTest(false);
}

/* ---------- 올리기 코드가 서버 기준 시각과 거래(transaction) 판단을 쓰는지 ---------- */
{
    const cloudSrc = readFileSync(new URL('../src/lib/cloud.js', import.meta.url), 'utf8');
    check(/Timestamp\.fromMillis\(uploadTime\(value, serverNow\(\)\)\)/.test(cloudSrc), '올릴 때 고친 시각을 서버 기준으로 거르지 않습니다(앞선 시계가 늘 이김).');
    check(/runTransaction\(/.test(cloudSrc) && /pushDecision\(/.test(cloudSrc), '시각 있는 줄을 서버 판을 보지 않고 덮어씁니다.');
}

if (failures.length) {
    console.error(`동기화 검사 ${failures.length}개 실패 (전체 ${count}개)`);
    failures.forEach((item) => console.error(`- ${item}`));
    process.exit(1);
}
console.log(`동기화 검사 ${count}개 통과`);
