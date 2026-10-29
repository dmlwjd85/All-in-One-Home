/** 웹·태블릿·휴대폰 동기화: 받은 자료를 합칠 때 잃는 것 없이, 고친 쪽이 이기는지 클라우드 없이 확인합니다. */
import { readFileSync } from 'node:fs';
import { serverIds, newerThanDelete, guardedDelete, keepCloudDoc, printDigest, stamp as stampBody } from '../src/lib/cloud.js';
import { setAuth, useAuthForTest, forgetQueuedCloudForTest, rememberPulledHashes, absorbCloudForTest, stableHashes, clippedCopy, pruneDeletedElsewhere, reloadCloudForgetForTest, queuedCloudKeys, setAttendance, cycleAttendance, cloudRejectedMessage, snapshot, subscribeStorageIssue, tellRejectedForTest, useVaultsForTest, update, useSignOutForTest, useCloudForTest, flushCloud } from '../src/lib/db.js';
import { fingerprint } from '../src/lib/cloud.js';
import { fromCloudRow, fromCloudSettings, mergeSettings, toCloudRow, toCloudSettings } from '../src/lib/cloudShape.js';
import { patchPeriodLocal, readPeriodLocal } from '../src/lib/periodLocal.js';
import { resolveHash } from '../src/lib/routes.js';
import { MENU, menuSelected } from '../src/ui/menu.js';
import { isMinutes, minutesList, minutesProblem, minutesRow, minutesTitle, readMinutesDraft, writeMinutesDraft } from '../src/lib/minutes.js';

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

/* 9·10교시 과목명의 '|'·'='·'%' 이스케이프 왕복과 옛 글자 읽기 */
{
    const names = { mon: { p9: 'A|B반' }, tue: { p10: '1=1반' }, wed: { s9: '100%' }, thu: { s10: '%7C그대로' } };
    const up = toCloudSettings({ profile: { settingsAt: 1767225600000 } }, { extra: names }).body;
    const text = up.periodLocal.extra;
    check(text.split('|').length === 4 && text.split('|').every((it) => it.split('=').length === 2), `이스케이프 뒤에도 구분 글자가 섞였습니다: ${text}`);
    const back = fromCloudSettings(up).periodLocal.extra;
    check(JSON.stringify(back) === JSON.stringify(names), `이스케이프한 과목명이 그대로 돌아오지 않습니다: ${JSON.stringify(back)}`);
    const old = fromCloudSettings({ ...up, periodLocal: { ...up.periodLocal, extra: 'mon-p9=방과후|tue-p10=보충 50%' } }).periodLocal.extra;
    check(old.mon?.p9 === '방과후' && old.tue?.p10 === '보충 50%', `옛 글자 모양을 읽지 못했습니다: ${JSON.stringify(old)}`);
    const nested = fromCloudSettings({ ...up, periodLocal: { ...up.periodLocal, extra: { mon: { p9: '방과후' } } } }).periodLocal.extra;
    check(nested.mon?.p9 === '방과후', '옛 맵 모양을 읽지 못했습니다.');
    const huge = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, { p9: '|'.repeat(20), p10: '='.repeat(20), s9: '%'.repeat(20), s10: '|'.repeat(20) }]));
    check(toCloudSettings({ profile: { settingsAt: 1767225600000 } }, { extra: huge }).body.periodLocal.extra.length <= 1000, '9교시 글자가 규칙 크기 한도(1000)를 넘습니다.');
}
const vault = () => { const map = new Map(); return { get: async (k) => map.get(k), set: async (k, v) => { map.set(k, v); }, remove: async (k) => { map.delete(k); } }; };
useVaultsForTest(vault(), vault(), vault());

const mark = (name, row) => { const shaped = toCloudRow(name, row); return [`${name}/${shaped.id}`, fingerprint(shaped.body, shaped.clear || [])]; };

/* 1) 이 기기에서 올린 뒤 손대지 않은 할 일 → 다른 기기에서 끝냄 표시를 하면 따라갑니다. */
const pushed = { id: 'todo1', title: '가정통신문 걷기', due: '2026-10-29', done: false, source: 'app' };
const edited = { id: 'todo2', title: '상담 준비', due: '2026-10-30', done: false, source: 'app' };
await absorbCloudForTest({ todos: [pushed, edited] }, {});
const hashes = Object.fromEntries([mark('todos', pushed), mark('todos', { ...edited, title: '상담 준비(옛)' })]);
await absorbCloudForTest({
    todos: [{ ...pushed, done: true }, { ...edited, title: '다른 기기 제목' }, { id: 'todo3', title: '새 할 일', done: false, source: 'app' }],
}, hashes);
const todos = snapshot().todos;
check(todos.find((row) => row.id === 'todo1')?.done === true, '다른 기기에서 끝낸 할 일이 따라오지 않습니다.');
check(todos.find((row) => row.id === 'todo2')?.title === '상담 준비', '이 기기에서 고치고 아직 안 올린 할 일이 다른 기기 값에 덮였습니다.');
check(todos.some((row) => row.id === 'todo3'), '다른 기기에서 새로 만든 할 일이 들어오지 않습니다.');
check(todos.length === 3, `합치는 동안 할 일이 사라지거나 겹쳤습니다(${todos.length}).`);

/* 2) 기기 설정: 더 늦게 고친 쪽이 이기고, 오래된 값은 이 기기 값을 지우지 않습니다. */
patchPeriodLocal({ count: 7, extra: { mon: { p9: '방과후' } } });
const localAt = readPeriodLocal().syncAt;
await absorbCloudForTest({ settings: { at: localAt - 1000, periodLocal: { count: 5, extra: {} }, periodStarts: [], ttEdited: [], academic: {} } });
check(readPeriodLocal().count === 7 && readPeriodLocal().extra.mon?.p9 === '방과후', '오래된 다른 기기 설정이 이 기기 설정을 덮었습니다.');
await absorbCloudForTest({ settings: { at: localAt + 1000, periodLocal: { count: 8, extra: { tue: { p10: '보충' } }, workStart: '08:30' }, periodStarts: ['09:00', '09:50', '10:50', '11:40', '13:20', '14:10', '15:00', '15:50'], ttEdited: ['2026-04-01'], academic: { 2026: { firstStart: '2026-03-03', firstEnd: '2026-07-21' } } } });
const after = readPeriodLocal();
check(after.count === 8 && after.extra.tue?.p10 === '보충' && after.workStart === '08:30', `더 늦게 고친 다른 기기 설정이 오지 않습니다: ${JSON.stringify(after)}`);
check(after.syncAt === localAt + 1000, '받은 설정의 시각을 새 시각으로 바꿔(다시 올림 반복) 버립니다.');
const profile = snapshot().profile;
check(profile.academic?.['2026']?.firstEnd === '2026-07-21' && profile.ttEdited.includes('2026-04-01') && profile.periodStarts[0] === '09:00', '학사일정·고친 날·시작 시각이 다른 기기에서 오지 않습니다.');
const out = toCloudSettings(snapshot(), readPeriodLocal()).body;
check(out.at === localAt + 1000 && out.periodLocal.extra.includes('tue-p10=보충'), '받은 설정을 그대로 다시 올릴 모양이 아닙니다.');

/* 3) 다른 기기 설정이 아직 없으면(규칙 배포 전) 아무것도 지우지 않습니다. */
await absorbCloudForTest({ settings: null, todos: [] });
check(snapshot().todos.length === 3 && readPeriodLocal().count === 8, '빈 원격 자료가 이 기기 기록을 지웠습니다.');

/* 4) 저장 키 이름은 그대로입니다. */
const periodSrc = readFileSync('src/lib/periodLocal.js', 'utf8');
check(periodSrc.includes("'ssug-gyomu-period-local'") && periodSrc.includes("'ssug-gyomu-leave-early'"), 'ssug-gyomu 저장 키 이름이 바뀌었습니다.');
const app = readFileSync('src/App.jsx', 'utf8');
check(app.includes('refreshFromCloud'), '앱으로 돌아올 때 다른 기기 기록을 다시 받지 않습니다.');

/* 5) 칸 단위 합치기: A가 학사일정을, B가 9교시를 고쳐 차례로 올려도 둘 다 남습니다(통째로 덮지 않음). */
{
    const base = 1780000000000;
    const cloud0 = toCloudSettings({ profile: { settingsAts: { periodStarts: base, ttEdited: base, academic: base }, academic: {} } },
        { count: 6, extra: {}, syncAts: { period: base, extra: base } }).body;
    const a = toCloudSettings({ profile: { settingsAts: { periodStarts: base, ttEdited: base, academic: base + 10 }, academic: { 2026: { firstEnd: '2026-07-21' } } } },
        { count: 6, extra: {}, syncAts: { period: base, extra: base } }).body;
    const b = toCloudSettings({ profile: { settingsAts: { periodStarts: base, ttEdited: base, academic: base }, academic: {} } },
        { count: 9, extra: { mon: { p9: '방과후' } }, syncAts: { period: base + 20, extra: base + 20 } }).body;
    const afterA = mergeSettings(a, fromCloudSettings(cloud0));
    const afterB = fromCloudSettings(mergeSettings(b, fromCloudSettings(afterA)));
    check(afterB.academic?.['2026']?.firstEnd === '2026-07-21', 'B가 올리면서 A의 학사일정을 지웠습니다.');
    check(afterB.periodLocal.count === 9 && afterB.periodLocal.extra.mon?.p9 === '방과후', 'B의 9교시 설정이 남지 않았습니다.');
    const afterA2 = fromCloudSettings(mergeSettings(a, afterB));
    check(afterA2.periodLocal.count === 9 && afterA2.academic['2026'].firstEnd === '2026-07-21', 'A가 다시 올리면서 B의 9교시를 지웠습니다.');
    /* 이 기기로 받을 때도 칸마다: 이 기기에서 방금 고친 9교시 과목은 남기고 더 새 학사일정만 받습니다. */
    patchPeriodLocal({ extra: { wed: { p9: '내 방과후' } } });
    const mineAt = readPeriodLocal().syncAts.extra;
    await absorbCloudForTest({ settings: { ...afterB, ats: { ...afterB.ats, extra: mineAt - 5, academic: Date.now() + 5000 }, academic: { 2026: { firstEnd: '2026-07-22' } } } });
    check(readPeriodLocal().extra.wed?.p9 === '내 방과후', '이 기기에서 더 늦게 고친 9교시 과목이 덮였습니다.');
    check(snapshot().profile.academic?.['2026']?.firstEnd === '2026-07-22', '더 새 학사일정이 같은 문서의 다른 칸 때문에 들어오지 않습니다.');
    /* 예전 문서(칸 시각 없음)는 문서 시각을 모든 칸에 씁니다. */
    const legacy = fromCloudSettings({ at: 5, periodLocal: {}, academic: {} });
    check(legacy.ats.academic === 5 && legacy.ats.period === 5, '칸 시각이 없는 예전 설정 문서를 읽지 못합니다.');
}

/* 6) 날짜별 시간표의 9·10교시도 오가고, 민감 낱말은 빠집니다. */
{
    const shaped = toCloudRow('timetable', { id: '2026-10-28', p1: '국어', p9: '방과후', s10: '보충', p10: '보건 상담' });
    check(shaped.body.p9 === '방과후' && shaped.body.s10 === '보충' && !('p10' in shaped.body), `9·10교시 올리는 모양이 틀립니다: ${JSON.stringify(shaped.body)}`);
    const back = fromCloudRow('timetable', '2026-10-28', shaped.body);
    check(JSON.stringify(back).includes('방과후') && JSON.stringify(back).includes('보충'), `9·10교시가 다른 기기에서 읽히지 않습니다: ${JSON.stringify(back)}`);
}

/* 7) 받기에서 설정 문서를 실제로 읽어 넣는지(빠지면 다른 기기 설정이 영영 안 옵니다). */
{
    const cloudSrc = readFileSync('src/lib/cloud.js', 'utf8');
    check(/if \(set\.exists\(\)\) out\.settings = fromCloudSettings\(set\.data\(\)\);/.test(cloudSrc), '받기에서 settings/device 를 읽어 넣지 않습니다.');
    check(/runTransaction[\s\S]{0,400}mergeSettings/.test(cloudSrc), '설정 올리기가 클라우드 값과 칸 단위로 합치지 않고 통째로 덮습니다.');
}

/* 8) 회의록: 여러 줄 본문·제목·참석자 왕복, #38 옛 회의록('meet-…', 제목 없음) 그대로 읽기, 임시 저장. */
{
    const body = '안건\n- 체험학습 장소\n\n결정\n- 다음 주 금요일\r\n할 일\n- 동의서 회수   ';
    const row = minutesRow({ title: ' 학년 협의회 ', date: '2026-10-28', attendees: '김선생, 이선생', text: body, tags: ['학년회의'] }, 1761600000000);
    check(row.id === 'meet-1761600000000' && row.title === '학년 협의회' && row.tags[0] === '회의' && row.tags.includes('학년회의'), `새 회의록 모양이 다릅니다: ${JSON.stringify(row)}`);
    check(row.text.split('\n').length === 7 && !row.text.includes('\r') && row.text.endsWith('동의서 회수'), `회의록 줄바꿈이 보존되지 않습니다: ${JSON.stringify(row.text)}`);
    const up = toCloudRow('notes', row);
    check(up && up.body.title === '학년 협의회' && up.body.attendees === '김선생, 이선생' && up.body.text === row.text, `회의록이 올릴 모양에서 칸을 잃었습니다: ${JSON.stringify(up)}`);
    const back = fromCloudRow('notes', up.id, up.body);
    check(back.text === row.text && back.title === row.title && back.attendees === row.attendees && back.date === row.date && isMinutes(back), `회의록이 다른 기기에서 그대로 오지 않습니다: ${JSON.stringify(back)}`);
    const long = toCloudRow('notes', { ...row, text: '가'.repeat(19000) });
    check(long?.body.text.length === 19000, '긴 회의록 본문(19000자)이 잘렸습니다.');
    const old = { id: 'meet-1761500000000', text: '학년회의 14:00 체험학습 안내', date: '2026-10-20', tags: ['회의', '학년회의'], pinned: false, source: 'app' };
    const oldUp = toCloudRow('notes', old);
    check(oldUp && !('title' in oldUp.body) && !('attendees' in oldUp.body), `옛 회의록에 없는 칸이 붙었습니다: ${JSON.stringify(oldUp?.body)}`);
    const oldBack = fromCloudRow('notes', oldUp.id, oldUp.body);
    check(oldBack.text === old.text && isMinutes(oldBack) && minutesTitle(oldBack) === '학년회의', `옛 회의록을 회의록으로 읽지 못했습니다: ${JSON.stringify(oldBack)}`);
    check(minutesTitle({ text: '\n  첫 줄 제목\n둘째', tags: ['회의'] }) === '첫 줄 제목' && minutesTitle({ id: 'meet-1', text: '' }) === '제목 없는 회의록', '회의록 제목 대신 보여 줄 글이 다릅니다.');
    const edited = minutesRow({ id: old.id, title: '고친 제목', date: old.date, text: `${old.text}\n추가 줄`, tags: old.tags });
    check(edited.id === old.id && edited.tags.join() === '회의,학년회의', `옛 회의록을 고치면 id·회의 종류가 바뀝니다: ${JSON.stringify(edited)}`);
    const list = minutesList([{ id: 'note-1', text: '그냥 메모', tags: [] }, old, row]);
    check(list.length === 2 && list[0].id === row.id, `회의록 목록이 메모를 섞거나 날짜순이 아닙니다: ${JSON.stringify(list.map((it) => it.id))}`);
    check(minutesProblem({ title: '', date: '2026-10-28', text: 'a' }) && minutesProblem({ title: 'a', date: '', text: 'a' }) && minutesProblem({ title: 'a', date: '2026-10-28', text: ' \n ' }) && !minutesProblem({ title: 'a', date: '2026-10-28', text: 'a\nb' }), '회의록 저장 전 확인이 다릅니다.');
    const mem = new Map();
    const store = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    writeMinutesDraft('new', { title: '쓰는 중', text: '첫 줄\n둘째 줄' }, store);
    writeMinutesDraft(old.id, { title: '고치는 중', text: 'x' }, store);
    check(readMinutesDraft('new', store)?.text === '첫 줄\n둘째 줄' && readMinutesDraft(old.id, store)?.title === '고치는 중', '회의록 임시 저장을 다시 읽지 못합니다.');
    writeMinutesDraft('new', null, store);
    check(!readMinutesDraft('new', store) && readMinutesDraft(old.id, store), '임시 저장 하나를 지우면 다른 임시 저장까지 지워집니다.');
    store.setItem('ssug-gyomu-minutes-draft', '{깨짐');
    check(readMinutesDraft('new', store) === null, '깨진 임시 저장에서 멈춥니다.');
    const ui = readFileSync('src/ui/Minutes.jsx', 'utf8');
    const area = ui.match(/<Area id="minutes-text"[\s\S]*?\/>\n/)?.[0] || '';
    check(area && !/onKeyDown|onKeyUp|onKeyPress/.test(area), '회의록 본문 칸이 키를 가로챕니다(Enter는 줄바꿈이어야 합니다).');
    check(!/<form/.test(ui), '회의록 화면에 form이 있어 Enter로 제출될 수 있습니다.');
    const app = readFileSync('src/App.jsx', 'utf8');
    check(!app.includes("setFlow({ id: 'minutes' })"), "회의록이 아직 Enter로 저장되는 예전 흐름(FlowSheet)으로 열립니다.");
}

/* 9) 회의록 주소와 메뉴 */
{
    const t = '2026-10-28';
    const r = (h) => resolveHash(h, t);
    check(r('#/minutes').name === 'minutes' && r('#/minutes').params.mode === 'list', '#/minutes 가 회의록 목록이 아닙니다.');
    check(r('#/minutes/new').params.mode === 'new', '#/minutes/new 가 새 회의록이 아닙니다.');
    check(r('#/minutes/meet-1761600000000').params.mode === 'view' && r('#/minutes/meet-1761600000000').params.id === 'meet-1761600000000', '회의록 보기 주소가 다릅니다.');
    check(r('#/minutes/meet-1/edit').params.mode === 'edit', '회의록 고치기 주소가 다릅니다.');
    check(r('#/minutes/<script>').params.mode === 'list' && r('#/minutes/<script>').replace === '#/minutes', '이상한 회의록 주소를 목록으로 돌리지 않습니다.');
    check(MENU.some(([label, href]) => label === '회의록' && href === '#/minutes') && menuSelected('minutes', '#/minutes'), '메뉴에 회의록이 없습니다.');
}

/* 10) 옛 판(v30)이 2000자로 자른 회의록 본문은 이 기기 본문을 지키고 다시 올립니다. 클라우드 거절은 알립니다. */
{
    const long = Array.from({ length: 120 }, (_, i) => `${i + 1}. 학년 협의 내용 줄입니다`).join('\n');
    check(long.length > 2000, '시험 본문이 2000자를 넘지 않습니다.');
    const meet = { id: 'meet-long1', text: long, title: '학년회의', attendees: '1학년', date: '2026-10-27', tags: ['회의', '학년회의'], pinned: false, source: 'app' };
    const other = { id: 'meet-short1', text: '짧은 회의록 본문', title: '교과협의', date: '2026-10-27', tags: ['회의'], pinned: false, source: 'app' };
    await absorbCloudForTest({ notes: [meet, other] }, {});
    const h = Object.fromEntries([mark('notes', meet), mark('notes', other)]);
    await absorbCloudForTest({ notes: [{ ...meet, text: long.slice(0, 2000) }, { ...other, text: '다른 기기에서 고친 본문' }] }, h);
    const notes = snapshot().notes;
    check(notes.find((r) => r.id === 'meet-long1')?.text === long, '옛 판이 자른 회의록 본문이 이 기기 본문을 덮었습니다.');
    check(!('notes/meet-long1' in h), '잘린 회의록을 다시 올리도록 표시하지 않았습니다.');
    check(notes.find((r) => r.id === 'meet-short1')?.text === '다른 기기에서 고친 본문', '다른 기기에서 고친 짧은 본문이 따라오지 않습니다.');
    check(clippedCopy(long, long.slice(0, 2000)) && !clippedCopy(long, long.slice(0, 1500)) && !clippedCopy(long, long.slice(0, 1999)) && !clippedCopy(long, long.slice(0, 1500) + '끝') && !clippedCopy('짧음', '짧'), '잘린 사본 판별이 다릅니다.');
    const told = [];
    const off = subscribeStorageIssue((m) => told.push(m));
    tellRejectedForTest(['notes/meet-a']);
    tellRejectedForTest(['notes/meet-a']);
    tellRejectedForTest([]);
    off();
    check(told.length === 1 && told[0].includes('회의록 1개'), `클라우드 거절 알림이 다릅니다(${told.join(' / ')}).`);
    /* 거절 수집(cloud.js)과 알림 호출(flushCloud)이 빠지면 실패합니다. */
    const cloudSrc = readFileSync(new URL('../src/lib/cloud.js', import.meta.url), 'utf8');
    const dbSrc = readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8');
    check(/if \(denied\(error\)\) rejected\.push\(key\);/.test(cloudSrc), '클라우드 쓰기 거절을 모으지 않습니다(error).');
    check(/if \(denied\(again\)\) rejected\.push\(key\);/.test(cloudSrc), '클라우드 다시 쓰기 거절을 모으지 않습니다(again).');
    check(/return \{[^}]*\brejected\b[^}]*\};\s*\}\s*$/m.test(cloudSrc), 'pushUserData가 거절 목록을 돌려주지 않습니다.');
    const flushBody = dbSrc.slice(dbSrc.indexOf('async function flushCloudOnce()'), dbSrc.indexOf('async function flushCloudOnce()') + 800);
    check(/tellRejected\(result\.rejected\)/.test(flushBody), 'flushCloud가 거절을 알리지 않습니다.');
    check(/tellStorageIssue\(cloudRejectedMessage\(keys\)\)/.test(dbSrc), '거절 알림이 화면 알림으로 가지 않습니다.');
    check(cloudRejectedMessage(['notes/meet-a', 'todos/t1']).includes('기록 2개'), '거절 알림 문구가 다릅니다.');
}

/* 11) 출결 고치기가 다음 받기에서 되돌아가지 않습니다. */
useAuthForTest('u1');
{
    const base = { id: '2026-10-27_s9', date: '2026-10-27', sid: 's9', status: '결석', reason: '질병', note: '병원', period: '', paper: false, source: 'app' };
    const shaped = toCloudRow('attendance', { ...base, reason: '', note: '' });
    check(['reason', 'note', 'period'].every((k) => (shaped.clear || []).includes(k)), `비운 출결 칸을 클라우드에서 지우지 않습니다: ${JSON.stringify(shaped.clear)}`);
    check(!(toCloudRow('attendance', base).clear || []).includes('reason'), '채운 사유를 지우라고 합니다.');
    /* 클라우드 병합 결과를 흉내 냅니다: 예전 문서 + 새 본문 − 지울 칸 */
    const oldDoc = toCloudRow('attendance', base).body;
    const merged = { ...oldDoc, ...shaped.body };
    (shaped.clear || []).forEach((k) => { delete merged[k]; });
    const edited = { ...base, reason: '', note: '' };
    await absorbCloudForTest({ attendance: [edited] }, {});
    const h = Object.fromEntries([mark('attendance', edited)]);
    await absorbCloudForTest({ attendance: [fromCloudRow('attendance', shaped.id, merged)] }, h);
    const got = snapshot().attendance.find((r) => r.id === base.id);
    check(got && got.reason === '' && got.note === '', `고친 출결이 예전 사유·메모로 돌아왔습니다: ${JSON.stringify(got)}`);
    /* 출석으로 되돌리면 클라우드 문서를 지우도록 줄을 세웁니다. 안 그러면 다음 받기에서 예전 결석이 되살아납니다. */
    await setAttendance('2026-10-27', 's9', '출석');
    check(!snapshot().attendance.some((r) => r.id === base.id), '출석으로 되돌린 줄이 남았습니다.');
    check(queuedCloudKeys().includes('attendance/2026-10-27_s9'), '출석으로 되돌린 출결의 클라우드 삭제가 줄에 없습니다.');
    await setAttendance('2026-10-28', 's9', '지각');
    for (let i = 0; i < 8 && snapshot().attendance.some((r) => r.id === '2026-10-28_s9'); i += 1) await cycleAttendance('2026-10-28', 's9');
    check(!snapshot().attendance.some((r) => r.id === '2026-10-28_s9') && queuedCloudKeys().includes('attendance/2026-10-28_s9'), '눌러 돌리기로 지운 출결의 클라우드 삭제가 줄에 없습니다.');
}

/* 12) 다른 기기에서 지운 출결은 이 기기에서도 지웁니다. 처음 받기·아직 안 올린 줄·올린 뒤 고친 줄은 남깁니다. 지울 대기열은 새로고침 뒤에도 남습니다. */
{
    const row = (sid, extra = {}) => ({ id: `2026-10-20_${sid}`, date: '2026-10-20', sid, status: '결석', reason: '질병', note: '', period: '', paper: false, source: 'app', ...extra });
    const pushedRow = row('p1');
    const editedRow = row('p2', { reason: '기타' });
    const freshRow = row('p3');
    const keptRow = row('p4');
    const hashes = Object.fromEntries([mark('attendance', pushedRow), mark('attendance', row('p2')), mark('attendance', keptRow)]);
    const draft = { attendance: [pushedRow, editedRow, freshRow, keptRow] };
    pruneDeletedElsewhere(draft, { ids: { attendance: [keptRow.id] } }, hashes);
    const left = draft.attendance.map((r) => r.sid).sort().join(',');
    check(left === 'p2,p3,p4', `다른 기기에서 지운 출결 정리가 다릅니다: ${left}`);
    check(!hashes['attendance/2026-10-20_p1'], '지운 출결의 해시가 남았습니다.');
    const first = { attendance: [pushedRow] };
    pruneDeletedElsewhere(first, { ids: { attendance: [] } }, {});
    check(first.attendance.length === 1, '처음 받기(해시 없음)에 로컬 출결을 지웠습니다.');
    const noIds = { attendance: [pushedRow] };
    pruneDeletedElsewhere(noIds, { attendance: [] }, Object.fromEntries([mark('attendance', pushedRow)]));
    check(noIds.attendance.length === 1, '문서 목록 없이 받은 자료로 로컬 출결을 지웠습니다.');

    /* 실제 합치기 경로: 다른 기기가 지운 줄이 사라집니다. */
    await absorbCloudForTest({ attendance: [pushedRow] }, {});
    await absorbCloudForTest({ attendance: [], ids: { attendance: [] } }, Object.fromEntries([mark('attendance', pushedRow)]));
    check(!snapshot().attendance.some((r) => r.id === pushedRow.id), '다른 기기에서 지운 출결이 합치기 뒤에도 남았습니다.');

    /* 지울 대기열: localStorage에 남고, 대기 중인 줄은 받아 와도 되살아나지 않습니다. */
    const mem = new Map();
    globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    await setAttendance('2026-10-21', 'q1', '결석');
    await setAttendance('2026-10-21', 'q1', '출석');
    check((JSON.parse(mem.get('ssug-gyomu-cloud-forget') || '{}').items || []).some((e) => e.u === 'u1' && e.k === 'attendance/2026-10-21_q1'), '지울 대기열이 localStorage에 남지 않습니다.');
    reloadCloudForgetForTest();
    check(queuedCloudKeys().includes('attendance/2026-10-21_q1'), '새로고침 뒤 지울 대기열이 사라졌습니다.');
    await absorbCloudForTest({ attendance: [row('q1', { id: '2026-10-21_q1', date: '2026-10-21' })], ids: { attendance: ['2026-10-21_q1'] } }, {});
    check(!snapshot().attendance.some((r) => r.id === '2026-10-21_q1'), '지우는 중인 출결이 받아 오기로 되살아났습니다.');
    delete globalThis.localStorage;
}

/* 13) 계정 전환·받은 줄 해시·캐시 결과·늦은 삭제 */
{
    const mem = new Map();
    globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    useAuthForTest('u1');
    await setAttendance('2026-10-27', 's1', '결석');
    await setAttendance('2026-10-27', 's1', '출석');
    useAuthForTest('u2');
    reloadCloudForgetForTest();
    check(!queuedCloudKeys().includes('attendance/2026-10-27_s1'), '다른 계정의 지울 대기열이 보입니다.');
    const calls = [];
    const fake = async (uid, bucket, id, opts) => { calls.push({ uid, bucket, id, opts }); return { ok: true }; };
    await forgetQueuedCloudForTest(fake);
    check(!calls.some((c) => c.id === '2026-10-27_s1'), '계정을 바꾸자 다른 계정의 출결을 지웠습니다.');
    const s1 = { id: '2026-10-27_s1', date: '2026-10-27', sid: 's1', status: '결석', reason: '질병', note: '', period: '', paper: false, source: 'app' };
    await absorbCloudForTest({ attendance: [s1], ids: { attendance: [s1.id] } }, {});
    check(snapshot().attendance.some((r) => r.id === s1.id), '다른 계정의 대기열 때문에 이 계정 출결을 받지 못했습니다.');
    useAuthForTest('u1');
    await setAttendance('2026-10-27', 's1', '출석');
    await forgetQueuedCloudForTest(fake);
    const mine = calls.find((c) => c.id === '2026-10-27_s1');
    check(mine?.uid === 'u1' && Number.isFinite(mine?.opts?.notAfter), '원래 계정에서는 지운 시각과 함께 지워야 합니다.');

    /* 로그아웃 뒤 지운 줄은 마지막 계정(u1)에 붙고, 한 번도 로그인 안 했으면 남기지 않습니다. */
    useAuthForTest(null);
    await setAttendance('2026-10-29', 's7', '결석');
    await setAttendance('2026-10-29', 's7', '출석');
    useAuthForTest('u1');
    check(queuedCloudKeys().includes('attendance/2026-10-29_s7'), '로그아웃 상태에서 지운 출결이 마지막 계정 대기열에 없습니다.');
    useAuthForTest('u2');
    check(!queuedCloudKeys().includes('attendance/2026-10-29_s7'), '로그아웃 상태에서 지운 출결이 다른 계정 대기열에 붙었습니다.');
    /* 실제 로그인 경로(setAuth)도 마지막 계정을 기억합니다. */
    await setAuth({ uid: 'u3' });
    await setAuth(null);
    await setAttendance('2026-10-29', 's8', '결석');
    await setAttendance('2026-10-29', 's8', '출석');
    await setAuth({ uid: 'u3' });
    check(queuedCloudKeys().includes('attendance/2026-10-29_s8'), '로그아웃 뒤 지운 출결이 마지막 로그인 계정 대기열에 없습니다.');
    useAuthForTest('u1');
    delete globalThis.localStorage;

    /* 받아 온 줄도 해시를 적어, 다른 기기가 지우면 이 기기에서도 지웁니다. */
    const r2 = { ...s1, id: '2026-10-27_s2', sid: 's2' };
    const hashes = {};
    rememberPulledHashes([r2], [r2], hashes);
    check(Boolean(hashes['attendance/2026-10-27_s2']), '받아 온 출결의 해시를 적지 않았습니다.');
    const fresh = {};
    rememberPulledHashes([{ ...r2, reason: '기타' }], [r2], fresh);
    check(!fresh['attendance/2026-10-27_s2'], '이 기기에서 고친 줄에 받아 온 해시를 적었습니다.');
    const bDraft = { attendance: [r2] };
    pruneDeletedElsewhere(bDraft, { ids: { attendance: [] } }, hashes);
    check(bDraft.attendance.length === 0, '받기만 한 기기에서 다른 기기가 지운 결석이 남았습니다.');

    /* 실제 합치기 경로: 해시 없이 받기만 한 뒤, 다른 기기가 지우면 사라집니다. */
    const r3 = { ...s1, id: '2026-10-27_s3', sid: 's3' };
    const shared = {};
    await absorbCloudForTest({ attendance: [r3], ids: { attendance: [r3.id] } }, shared);
    await absorbCloudForTest({ attendance: [], ids: { attendance: [] } });
    check(!snapshot().attendance.some((r) => r.id === r3.id), '받기만 한 기기에서 지워진 결석이 되살아납니다.');

    /* 캐시 결과는 지우기에 쓰지 않습니다. */
    const fakeSnap = (fromCache) => ({ metadata: { fromCache }, forEach: (fn) => [{ id: 'a' }].forEach(fn) });
    check(serverIds(fakeSnap(true)) === null, '캐시에서 온 결과로 지우기를 하려 합니다.');
    check(serverIds(fakeSnap(false))?.join() === 'a', '서버 결과의 문서 목록이 다릅니다.');

    /* 늦게 동기화된 삭제는 더 최근 수정을 지우지 않습니다. */
    const stamp = (ms) => ({ updatedAt: { toMillis: () => ms } });
    check(newerThanDelete(stamp(2000), 1000) === true, '지운 뒤 고친 문서를 지우려 합니다.');
    check(newerThanDelete(stamp(500), 1000) === false && newerThanDelete(null, 1000) === false, '지운 시각 전 문서는 지워야 합니다.');
}

/* 14) 계정 전환 때 자료 보관·되살림, 늦은 삭제 가드, 예전 대기열 형식 정리 */
{
    const mem = new Map();
    globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    const att = (sid, extra = {}) => ({ id: `2026-10-27_${sid}`, date: '2026-10-27', sid, status: '결석', reason: '질병', note: '', period: '', paper: false, source: 'app', ...extra });
    await setAuth({ uid: 'w1' });
    await absorbCloudForTest({ attendance: [att('k1')], ids: { attendance: [att('k1').id] } }, {});
    await setAttendance('2026-10-27', 'k1', '출석');
    const k1Saved = (JSON.parse(mem.get('ssug-gyomu-cloud-forget') || '{}').items || []).find((e) => e.k === 'attendance/2026-10-27_k1');
    check(/^f[a-z0-9]{1,20}$/.test(k1Saved?.x || ''), `지울 대기열에 마지막 내용 요약이 없거나 내용이 그대로 있습니다: ${JSON.stringify(k1Saved)}`);
    await setAttendance('2026-10-27', 'k2', '결석'); // 아직 안 올린 변경
    await setAuth({ uid: 'w2' });
    check(!snapshot().attendance.some((r) => r.sid === 'k2'), '계정을 바꿨는데 이전 계정의 안 올린 출결이 보입니다.');
    await absorbCloudForTest({ attendance: [att('k1', { status: '지각', reason: '' })], ids: { attendance: [att('k1').id] } });
    await setAttendance('2026-10-27', 'k3', '결석');
    await setAttendance('2026-10-27', 'k3', '출석'); // w2 대기열
    await setAuth({ uid: 'w1' });
    const back = snapshot().attendance;
    check(!back.some((r) => r.sid === 'k1'), `w1로 돌아왔는데 지운 출결/다른 계정 지각이 보입니다: ${JSON.stringify(back.filter((r) => r.sid === 'k1'))}`);
    check(back.some((r) => r.sid === 'k2' && r.status === '결석'), 'w1의 안 올린 출결이 계정 전환 뒤 사라졌습니다.');
    check(queuedCloudKeys().includes('attendance/2026-10-27_k1'), 'w1의 지울 대기열이 계정 전환 뒤 사라졌습니다.');
    const calls = [];
    await forgetQueuedCloudForTest(async (uid, bucket, id, opts) => { calls.push({ uid, id, opts }); return { ok: true }; });
    const k1 = calls.find((c) => c.id === '2026-10-27_k1');
    check(k1?.uid === 'w1' && typeof k1?.opts?.expect === 'string', 'w1에 돌아와 지운 출결을 마지막으로 알던 내용과 함께 지워야 합니다.');
    check(!calls.some((c) => c.id === '2026-10-27_k3'), 'w1에서 w2의 대기열을 처리했습니다.');
    await setAuth({ uid: 'w2' });
    check(snapshot().attendance.some((r) => r.sid === 'k1' && r.status === '지각'), 'w2로 돌아왔는데 w2 출결이 사라졌습니다.');
    check(queuedCloudKeys().includes('attendance/2026-10-27_k3'), 'w2의 지울 대기열이 계정 전환 뒤 사라졌습니다.');
    const savedItems = JSON.parse(mem.get('ssug-gyomu-cloud-forget') || '{}').items || [];
    check(savedItems.every((e) => !e.x || /^f[a-z0-9]{1,20}$/.test(e.x)), `지울 대기열에 출결 내용이 요약 없이 남습니다: ${JSON.stringify(savedItems)}`);

    /* 예전 배열 형식은 저장소에서 지웁니다. */
    mem.set('ssug-gyomu-cloud-forget', JSON.stringify(['attendance/2026-10-27_old']));
    reloadCloudForgetForTest();
    check(!mem.has('ssug-gyomu-cloud-forget'), '예전 형식 대기열이 localStorage에 남았습니다.');
    delete globalThis.localStorage;
    useAuthForTest('u1');

    /* 고친 시각은 서버 시각(serverTimestamp)으로 찍습니다. */
    const fakeFs = { Timestamp: { now: () => 'DEVICE', fromDate: () => 'DEVICE' }, serverTimestamp: () => 'SERVER' };
    const stamped = await stampBody(fakeFs, { a: 1 }, ['updatedAt']);
    check(stamped.updatedAt === 'SERVER', '고친 시각을 기기 시계로 찍습니다.');

    /* 늦은 삭제 가드 */
    const stamp = (ms) => ({ updatedAt: { toMillis: () => ms } });
    check(newerThanDelete(stamp(1000), 1000) === false, '지운 시각과 같은 문서는 지워야 합니다.');
    const run = async (data, opts) => { let deleted = false; const r = await guardedDelete({ get: async () => data, del: async () => { deleted = true; } }, 'events', 'e1', opts); return { deleted, r }; };
    check(!(await run(stamp(2000), { notAfter: 1000 })).deleted, '지운 뒤 고친 문서를 지웠습니다.');
    check((await run(stamp(500), { notAfter: 1000 })).deleted, '지운 시각 전 문서를 지우지 않았습니다.');
    check((await run(null, { notAfter: 1000 })).deleted, '없는 문서 지우기가 멈췄습니다.');
    const a = att('k9');
    const shaped = toCloudRow('attendance', a);
    const expect = printDigest(fingerprint(shaped.body, shaped.clear || []));
    check(!keepCloudDoc('attendance', shaped.id, shaped.body, { expect, notAfter: 0 }), '마지막으로 알던 출결과 같으면 지워야 합니다(시계와 상관없이).');
    const edited = toCloudRow('attendance', { ...a, reason: '기타' });
    check(keepCloudDoc('attendance', shaped.id, { ...edited.body, ...stamp(1) }, { expect, notAfter: 9e15 }), '다른 기기가 고친 출결을 지우려 합니다(시계와 상관없이).');
    let gone = false;
    await guardedDelete({ get: async () => edited.body, del: async () => { gone = true; } }, 'attendance', shaped.id, { expect });
    check(!gone, '내용 확인 없이 고친 출결을 지웠습니다.');
}

/* 13) 휴대폰에서 받아 오는 도중에 고친 출결이 받아 온 옛 값으로 되돌아가지 않습니다(실사이트 v33 '출결 수정이 아예 안 됨'). */
useAuthForTest('u1');
{
    const old = { id: '2026-10-28_m1', date: '2026-10-28', sid: 'm1', status: '결석', reason: '질병', note: '', period: '', paper: false, source: 'app' };
    await absorbCloudForTest({ attendance: [old] }, {});
    const seen = Object.fromEntries([mark('attendance', old)]);
    /* 당기기 시작한 뒤 이 기기에서 지각으로 고치고, 올리기가 당기기보다 먼저 끝나 해시가 새 값이 된 상태 */
    const mine = { ...old, status: '지각', note: '버스 늦음' };
    await setAttendance(mine.date, mine.sid, '지각', { note: '버스 늦음' });
    const now = Object.fromEntries([mark('attendance', snapshot().attendance.find((r) => r.id === old.id))]);
    await absorbCloudForTest({ attendance: [old] }, now, seen);
    const got = snapshot().attendance.find((r) => r.id === old.id);
    check(got?.status === '지각' && got?.note === '버스 늦음', `받아 오는 도중 고친 출결이 옛 값으로 덮였습니다: ${JSON.stringify(got)}`);
    /* 당기는 동안 아무것도 안 고쳤으면 다른 기기 값을 그대로 받습니다. */
    const other = { ...old, id: '2026-10-28_m2', sid: 'm2' };
    await absorbCloudForTest({ attendance: [other] }, {});
    const h2 = Object.fromEntries([mark('attendance', other)]);
    await absorbCloudForTest({ attendance: [{ ...other, status: '조퇴' }] }, h2, { ...h2 });
    check(snapshot().attendance.find((r) => r.id === other.id)?.status === '조퇴', '다른 기기에서 고친 출결을 받지 않습니다.');
    check(Object.keys(stableHashes({ a: '1', b: '1' }, { a: '1', b: '2' })).join() === 'a', 'stableHashes가 바뀐 해시를 빼지 않습니다.');
    check(stableHashes(null, h2) === h2, 'seen이 없으면 지금 해시를 그대로 써야 합니다.');
    const dbSrc2 = readFileSync(new URL('../src/lib/db.js', import.meta.url), 'utf8');
    check(/const seen = \{ \.\.\.cloudHashes \};\s*const remote = await cloudApi\.pull/.test(dbSrc2), '당기기 전에 해시를 찍어 두지 않습니다.');
    const appSrc = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
    check(/pagehide', leave/.test(appSrc) && /visibilityState === 'hidden'\) flushCloud/.test(appSrc), '앱을 닫을 때 바로 올리지 않습니다.');
}

/* 15) 계정 전환 실패 길·해시 바꿔 넣기·기기 전용 자료·임시 회의록·오프라인 수정 뒤 지우기(4차 검수) */
{
    const mem = new Map();
    globalThis.localStorage = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
    const plain = () => { const map = new Map(); return { map, get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };
    const mainV = plain();
    const localV = plain();
    let failAccount = false;
    let failState = false;
    const authSeen = [];
    const mainWrap = { ...mainV, set: async (k, v) => {
        if (String(k).startsWith('account:')) { authSeen.push(snapshot().auth?.uid || null); if (failAccount) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' }); }
        if (k === 'state' && failState) throw Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
        return mainV.set(k, v);
    } };
    useVaultsForTest(mainWrap, localV, plain());
    const row = (sid, extra = {}) => ({ id: `2026-10-29_${sid}`, date: '2026-10-29', sid, status: '결석', reason: '질병', note: '', period: '', paper: false, source: 'app', ...extra });

    await setAuth({ uid: 'x1' });
    await absorbCloudForTest({ attendance: [row('h1')], ids: { attendance: [row('h1').id] } }, {});
    await update((d) => { d.local.records.push({ id: 'sec1', text: 'x1 상담 비밀', date: '2026-10-29' }); return d; });
    mem.set('ssug-gyomu-minutes-draft', JSON.stringify({ new: { title: 'x1 임시 회의록' } }));
    /* S3용: 올린 뒤 이 기기에서만 기타로 고쳐 둡니다(아직 안 올림). */
    await setAttendance('2026-10-29', 'h1', '결석', { reason: '기타' });

    /* S8: 보관하는 동안 로그인 표시는 비어 있어야 합니다. */
    await setAuth({ uid: 'x2' });
    check(authSeen.length && authSeen.every((u) => u === null), `계정 보관 중에 로그인 표시가 남아 있었습니다: ${JSON.stringify(authSeen)}`);
    /* S6: 기기 전용(민감) 자료도 계정 몫으로 나눕니다. 2번: 임시 회의록도. */
    check(!snapshot().local.records.some((r) => r.id === 'sec1'), '다른 계정 화면에 이전 계정의 기기 전용 상담이 보입니다.');
    check(!mem.has('ssug-gyomu-minutes-draft'), '다른 계정 화면에 이전 계정의 임시 회의록이 남았습니다.');
    mem.set('ssug-gyomu-minutes-draft', JSON.stringify({ new: { title: 'x2 임시' } }));
    /* x2 계정에도 같은 id 출결이 다른 내용으로 있습니다(해시가 x2 것으로 바뀜). */
    await absorbCloudForTest({ attendance: [row('h1', { status: '지각', reason: '미인정' })], ids: { attendance: [row('h1').id] } }, {});
    await setAuth({ uid: 'x1' });
    check(snapshot().local.records.some((r) => r.id === 'sec1'), '이전 계정으로 돌아왔는데 기기 전용 상담이 사라졌습니다.');
    check((mem.get('ssug-gyomu-minutes-draft') || '').includes('x1 임시 회의록'), '이전 계정의 임시 회의록이 돌아오지 않았습니다.');
    /* S3: 돌아온 계정의 해시를 되살려야, 지울 때 마지막으로 알던 요약을 붙입니다. */
    await setAttendance('2026-10-29', 'h1', '출석');
    const h1 = (JSON.parse(mem.get('ssug-gyomu-cloud-forget') || '{}').items || []).find((e) => e.u === 'x1' && e.k === 'attendance/2026-10-29_h1');
    check(/^f[a-z0-9]{1,20}$/.test(h1?.x || ''), `계정을 오가고 나서 해시가 돌아오지 않아 지울 때 요약이 없습니다: ${JSON.stringify(h1)}`);
    /* 서버에는 x1이 마지막으로 올린 결석/질병이 있습니다. x1 해시로 지워야 합니다(x2 해시면 남아 되살아납니다). */
    const x1Body = toCloudRow('attendance', row('h1')).body;
    let h1Gone = 0;
    await forgetQueuedCloudForTest(async (uid, bucket, id, opts) => {
        if (id !== row('h1').id) return { ok: true };
        const r = await guardedDelete({ get: async () => x1Body, del: async () => { h1Gone += 1; } }, bucket, id, opts);
        return r;
    });
    check(h1Gone === 1, `계정을 오간 뒤 해시를 되살리지 않아 지운 출결이 서버에 남습니다: ${h1Gone}`);

    /* 4번: 동기화된 결석/질병을 오프라인에서 기타로 고친 뒤 출석으로 되돌리면, 서버에 늦게 도착한 '기타'도 지울 수 있어야 합니다. */
    await absorbCloudForTest({ attendance: [row('o1')], ids: { attendance: [row('o1').id] } }, {});
    await setAttendance('2026-10-29', 'o1', '결석', { reason: '기타' });
    await setAttendance('2026-10-29', 'o1', '출석');
    const late = toCloudRow('attendance', row('o1', { reason: '기타' }));
    const other = toCloudRow('attendance', row('o1', { reason: '기타', note: '다른 기기' }));
    let gone = 0;
    /* 앱을 다시 연 것처럼 대기열을 저장소에서 다시 읽습니다(기타 요약도 저장돼야 합니다). */
    reloadCloudForgetForTest();
    useAuthForTest('x1');
    await forgetQueuedCloudForTest(async (uid, bucket, id, opts) => {
        if (id !== row('o1').id) return { ok: true };
        const r1 = await guardedDelete({ get: async () => late.body, del: async () => { gone += 1; } }, bucket, id, opts);
        const r2 = await guardedDelete({ get: async () => other.body, del: async () => { gone += 10; } }, bucket, id, opts);
        return r1.ok && r2.ok ? { ok: true } : { ok: false };
    });
    check(gone === 1, `오프라인에서 기타로 고친 뒤 출석으로 되돌린 출결이 다시 연결하면 되살아납니다(또는 다른 기기 수정까지 지움): ${gone}`);

    /* 1번·S5: 보관에 실패하면 전환을 멈추고 로그아웃합니다. 이전 계정 자료를 고쳐도 새 계정 몫으로 지우지 않습니다. */
    const issues = [];
    let signedOut = 0;
    useSignOutForTest(async () => { signedOut += 1; });
    const stop = subscribeStorageIssue((m) => issues.push(m));
    failAccount = true;
    await absorbCloudForTest({ attendance: [row('q1')] }, {});
    await setAuth({ uid: 'x3' });
    failAccount = false;
    check(snapshot().auth === null, `보관에 실패했는데 새 계정으로 로그인한 채 남았습니다: ${JSON.stringify(snapshot().auth)}`);
    check(snapshot().local.records.some((r) => r.id === 'sec1') && snapshot().attendance.some((r) => r.sid === 'q1'), '보관에 실패했는데 화면 자료가 바뀌었습니다.');
    check(signedOut === 1, `보관에 실패했는데 로그인 모듈에서 로그아웃하지 않았습니다: ${signedOut}`);
    check(issues.some((m) => m.includes('로그아웃')), `보관 실패를 알리지 않았습니다: ${JSON.stringify(issues)}`);
    await setAttendance('2026-10-29', 'q1', '출석');
    const items = JSON.parse(mem.get('ssug-gyomu-cloud-forget') || '{}').items || [];
    check(!items.some((e) => e.u === 'x3'), `보관 실패 뒤 이전 계정 출결 지우기가 새 계정 몫으로 쌓였습니다: ${JSON.stringify(items.filter((e) => e.u === 'x3'))}`);

    /* S9: 새 자료를 저장하다 실패하면 이전 화면 자료로 되돌립니다. */
    failState = true;
    await setAuth({ uid: 'x4' });
    failState = false;
    check(snapshot().local.records.some((r) => r.id === 'sec1'), '전환 저장에 실패했는데 이전 계정 자료로 되돌리지 않았습니다.');
    check(snapshot().auth?.uid !== 'x4', '전환 저장에 실패했는데 새 계정으로 로그인했습니다.');
    stop?.();

    /* U4: 계정이 없는 예전 대기열 항목은 메모리에도 남기지 않습니다. */
    mem.set('ssug-gyomu-cloud-forget', JSON.stringify({ last: 'x1', items: [{ k: 'attendance/2026-10-29_old', at: 1 }, { u: 'x1', k: 'attendance/2026-10-29_ok', at: 1 }] }));
    reloadCloudForgetForTest();
    useAuthForTest('x1');
    check(!queuedCloudKeys().includes('attendance/2026-10-29_old') && queuedCloudKeys().includes('attendance/2026-10-29_ok'), `계정 없는 예전 대기열 항목을 남겼습니다: ${JSON.stringify(queuedCloudKeys())}`);
    /* 항목 목록 안에 문자열(예전 꼴)이 섞여 있어도 버리고, 다시 쓸 때 계정 없는 항목을 남기지 않습니다. */
    mem.set('ssug-gyomu-cloud-forget', JSON.stringify({ last: 'x1', items: ['attendance/2026-10-29_str', { u: 'x1', k: 'attendance/2026-10-29_ok', at: 1 }] }));
    reloadCloudForgetForTest();
    useAuthForTest('x1');
    await absorbCloudForTest({ attendance: [row('w1')] }, {});
    await setAttendance('2026-10-29', 'w1', '출석');
    const written = JSON.parse(mem.get('ssug-gyomu-cloud-forget') || '{}').items || [];
    check(written.length >= 2 && written.every((e) => e && typeof e === 'object' && typeof e.u === 'string' && typeof e.k === 'string'), `예전 꼴 대기열 항목이 계정 없이 남았습니다: ${JSON.stringify(written)}`);
    mem.set('ssug-gyomu-cloud-forget', JSON.stringify(['attendance/2026-10-29_arr']));
    reloadCloudForgetForTest();
    check(!queuedCloudKeys().includes('attendance/2026-10-29_arr'), '예전 배열 대기열 항목을 메모리에 남겼습니다.');
    useSignOutForTest(null);
    /* 올리기는 차례로: 먼저 시작한 느린 올리기가 나중에 끝나며 새 해시를 옛 해시로 덮지 않습니다. */
    {
        const order = [];
        let n = 0;
        const hv = plain();
        useVaultsForTest(hv, plain(), plain());
        useCloudForTest({
            async push(uid, st, { hashes }) {
                n += 1;
                const me = n;
                order.push(`start${me}`);
                await new Promise((r) => setTimeout(r, me === 1 ? 60 : 0));
                order.push(`end${me}`);
                return { ok: true, hashes: { ...hashes, 'attendance/k': me === 1 ? 'fold' : 'fnew' }, rejected: [] };
            },
            pull: async () => null,
        });
        useAuthForTest('x1');
        const a = flushCloud();
        const b = flushCloud();
        await Promise.all([a, b]);
        await new Promise((r) => setTimeout(r, 10));
        check(order.join() === 'start1,end1,start2,end2', `올리기가 겹쳐 돕니다: ${order.join()}`);
        check(hv.map.get('cloudHashes')?.['attendance/k'] === 'fnew', `늦게 끝난 옛 올리기가 해시를 덮었습니다: ${JSON.stringify(hv.map.get('cloudHashes'))}`);
        useCloudForTest(null);
    }
    delete globalThis.localStorage;
    useVaultsForTest(vault(), vault(), vault());
    useAuthForTest('u1');
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('check-sync: 기기끼리 합치기 통과');
