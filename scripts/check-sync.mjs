/** 웹·태블릿·휴대폰 동기화: 받은 자료를 합칠 때 잃는 것 없이, 고친 쪽이 이기는지 클라우드 없이 확인합니다. */
import { readFileSync } from 'node:fs';
import { absorbCloudForTest, snapshot, useVaultsForTest } from '../src/lib/db.js';
import { fingerprint } from '../src/lib/cloud.js';
import { toCloudRow, toCloudSettings } from '../src/lib/cloudShape.js';
import { patchPeriodLocal, readPeriodLocal } from '../src/lib/periodLocal.js';

const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };
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
check(out.at === localAt + 1000 && out.periodLocal.extra.tue.p10 === '보충', '받은 설정을 그대로 다시 올릴 모양이 아닙니다.');

/* 3) 다른 기기 설정이 아직 없으면(규칙 배포 전) 아무것도 지우지 않습니다. */
await absorbCloudForTest({ settings: null, todos: [] });
check(snapshot().todos.length === 3 && readPeriodLocal().count === 8, '빈 원격 자료가 이 기기 기록을 지웠습니다.');

/* 4) 저장 키 이름은 그대로입니다. */
const periodSrc = readFileSync('src/lib/periodLocal.js', 'utf8');
check(periodSrc.includes("'ssug-gyomu-period-local'") && periodSrc.includes("'ssug-gyomu-leave-early'"), 'ssug-gyomu 저장 키 이름이 바뀌었습니다.');
const app = readFileSync('src/App.jsx', 'utf8');
check(app.includes('refreshFromCloud'), '앱으로 돌아올 때 다른 기기 기록을 다시 받지 않습니다.');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('check-sync: 기기끼리 합치기 통과');
