/** 웹·태블릿·휴대폰 동기화: 받은 자료를 합칠 때 잃는 것 없이, 고친 쪽이 이기는지 클라우드 없이 확인합니다. */
import { readFileSync } from 'node:fs';
import { absorbCloudForTest, clippedCopy, cloudRejectedMessage, snapshot, subscribeStorageIssue, tellRejectedForTest, useVaultsForTest } from '../src/lib/db.js';
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
    const flushBody = dbSrc.slice(dbSrc.indexOf('export async function flushCloud()'), dbSrc.indexOf('export async function flushCloud()') + 800);
    check(/tellRejected\(result\.rejected\)/.test(flushBody), 'flushCloud가 거절을 알리지 않습니다.');
    check(/tellStorageIssue\(cloudRejectedMessage\(keys\)\)/.test(dbSrc), '거절 알림이 화면 알림으로 가지 않습니다.');
    check(cloudRejectedMessage(['notes/meet-a', 'todos/t1']).includes('기록 2개'), '거절 알림 문구가 다릅니다.');
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('check-sync: 기기끼리 합치기 통과');
