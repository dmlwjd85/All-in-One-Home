/** 에뮬레이터에서 건강·보건·보호자 연락처·주소가 든 글(태그 포함)이 거절되는지, 끝 시각이 두 기기에 남는지 확인합니다. 비밀 값은 쓰지 않습니다. */
import { readFileSync } from 'node:fs';
import { assertFails, assertSucceeds, initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { eventBodyWithoutEndTime, fromCloudRow, fromCloudSettings, toCloudRow, toCloudSettings } from '../src/lib/cloudShape.js';
import { eventClock } from '../src/lib/date.js';
import { rulesSafeTextBody } from '../src/lib/sensitive.js';
import { toGoalDoc } from '../src/lib/todoAchieve.js';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');

function ruleBlock(source, startMark, endMark) {
    const start = source.indexOf(startMark);
    const end = source.indexOf(endMark);
    if (start < 0 || end <= start) return '';
    return source.slice(start, end);
}

/** 예전 배포본은 일정에만 endTime이 없었습니다. 정리함 규칙의 endTime은 그대로 둡니다. */
function rulesWithoutEventEndTime(source) {
    const block = ruleBlock(source, 'match /events/{eid}', 'match /todos/{tid}');
    if (!block) return source;
    const stripped = block
        .replace(", 'endTime'", '')
        .replace("\n          && (!('endTime' in d()) || hm(d().endTime))", '');
    const start = source.indexOf('match /events/{eid}');
    const end = source.indexOf('match /todos/{tid}');
    return source.slice(0, start) + stripped + source.slice(end);
}
/* 규칙의 safeText 본문을 꺼내 앱(sensitive.js)이 만든 본문과 글자 그대로 견줍니다. 연락처·주소 꼴도 함께 견줍니다. */
const safeMatch = rules.match(/function safeText\(v\) \{ return !v\.matches\('([^']*)'\); \}/);
if (!safeMatch || safeMatch[1] !== rulesSafeTextBody()) {
    console.error('규칙의 safeText가 앱 민감 낱말·연락처·주소 꼴(src/lib/sensitive.js rulesSafeTextBody)과 다릅니다.');
    process.exit(1);
}

const hostEnv = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8088';
const [host, portText] = hostEnv.split(':');
const testEnv = await initializeTestEnvironment({
    projectId: 'demo-ssug-rules',
    firestore: {
        rules,
        host,
        port: Number(portText),
    },
});

const db = testEnv.authenticatedContext('teacher-a').firestore();
const failures = [];

async function expectDeny(label, write) {
    try {
        await assertFails(write());
    } catch (error) {
        failures.push(`${label} 쓰기가 거절되지 않았습니다. ${error?.message || error}`);
    }
}

async function expectAllow(label, write) {
    try {
        await assertSucceeds(write());
    } catch (error) {
        failures.push(`${label} 쓰기가 거절되었습니다. ${error?.message || error}`);
    }
}

async function expectBlocked(label, op) {
    try {
        await assertFails(op());
    } catch (error) {
        failures.push(`${label} 요청이 거절되지 않았습니다. ${error?.message || error}`);
    }
}

const SETTINGS_PROFILE = {
    settingsAt: 1767225600000,
    ttEdited: ['2026-04-01'],
    periodStarts: ['09:00', '09:50', '10:50', '11:40', '13:20', '14:10', '15:00', '15:50'],
    academic: { 2026: { firstStart: '2026-03-03', firstEnd: '2026-07-21', secondStart: '2026-08-18', secondEnd: '2027-02-10', offDays: ['2026-05-04'] } },
};
const SETTINGS_LOCAL = { level: '중', count: 7, lengths: [45], extraStarts: ['16:40', '17:30'], locks: [9], cellLocks: ['mon-9'], workStart: '08:20', workEnd: '16:40', extra: { mon: { p9: '방과후' } } };

/** 설정 문서 검사 묶음. 규칙을 일부러 망가뜨린 판(아래 돌연변이)에서도 돌려, 하나라도 잡는지 봅니다. */
async function settingsSuite(env) {
    const out = [];
    const deny = async (label, op) => { try { await assertFails(op()); } catch (error) { out.push(`${label} 요청이 거절되지 않았습니다. ${error?.message || error}`); } };
    const allow = async (label, op) => { try { await assertSucceeds(op()); } catch (error) { out.push(`${label} 쓰기가 거절되었습니다. ${error?.message || error}`); } };
    const phone = env.authenticatedContext('teacher-sync').firestore();
    const pc = env.authenticatedContext('teacher-sync').firestore();
    const other = env.authenticatedContext('teacher-b').firestore();
    const ref = (fs, name = 'device') => doc(fs, `users/teacher-sync/settings/${name}`);
    const shaped = toCloudSettings({ profile: SETTINGS_PROFILE }, SETTINGS_LOCAL);
    const body = shaped.body;
    await allow('기기 설정 올리기', () => setDoc(ref(phone), body));
    const snap = await getDoc(ref(pc));
    const back = snap.exists() ? fromCloudSettings(snap.data()) : null;
    if (!back || back.periodLocal.extra?.mon?.p9 !== '방과후' || back.academic?.['2026']?.firstEnd !== '2026-07-21' || back.periodLocal.count !== 7 || back.ats?.academic !== 1767225600000) {
        out.push(`다른 기기에서 설정을 그대로 읽지 못했습니다. ${JSON.stringify(back)}`);
    }
    const pl = (patch) => ({ ...body, periodLocal: { ...body.periodLocal, ...patch } });
    const ac = (row) => ({ ...body, academic: { 2026: { ...body.academic['2026'], ...row } } });
    await deny('남의 설정 읽기', () => getDoc(ref(other)));
    await deny('남의 설정 쓰기', () => setDoc(ref(other), body));
    await deny('다른 이름의 설정 문서', () => setDoc(ref(phone, 'other'), body));
    await deny('모르는 칸이 든 설정', () => setDoc(ref(phone), { ...body, leave: '14:00' }));
    const { at: _at, ...noAt } = body;
    await deny('시각 없는 설정', () => setDoc(ref(phone), noAt));
    await deny('시각 0인 설정', () => setDoc(ref(phone), { ...body, at: 0 }));
    await deny('글자 시각', () => setDoc(ref(phone), { ...body, at: '1' }));
    await deny('칸 시각에 모르는 칸', () => setDoc(ref(phone), { ...body, ats: { ...body.ats, memo: 1 } }));
    const { ats: _ats, ...noAts } = body;
    await deny('칸 시각 없는 설정', () => setDoc(ref(phone), noAts));
    await deny('칸 시각이 글자', () => setDoc(ref(phone), { ...body, ats: { ...body.ats, academic: 'x' } }));
    /* 출퇴근 칸 시각(work): 새 앱은 올리고 예전 앱은 빼고 올립니다. 둘 다 받고, 글자·음수는 거절합니다. */
    const { work: _work, ...oldAts } = body.ats;
    await allow('출퇴근 칸 시각이 없는 예전 설정', () => setDoc(ref(phone), { ...body, ats: oldAts }));
    await allow('출퇴근 칸 시각이 있는 설정', () => setDoc(ref(phone), { ...body, ats: { ...oldAts, work: 1767225600000 } }));
    await deny('출퇴근 칸 시각이 글자', () => setDoc(ref(phone), { ...body, ats: { ...body.ats, work: 'x' } }));
    await deny('출퇴근 칸 시각이 음수', () => setDoc(ref(phone), { ...body, ats: { ...body.ats, work: -1 } }));
    await deny('교시 설정 모르는 칸', () => setDoc(ref(phone), pl({ memo: '가' })));
    await deny('교시 수 글자', () => setDoc(ref(phone), pl({ count: 'zzz' })));
    await deny('교시 수 11', () => setDoc(ref(phone), pl({ count: 11 })));
    await deny('학교급 모름', () => setDoc(ref(phone), pl({ level: '대' })));
    await deny('교시 길이 글자', () => setDoc(ref(phone), pl({ lengths: 'a'.repeat(3000) })));
    await deny('교시 길이 목록(글자 아님)', () => setDoc(ref(phone), pl({ lengths: ['a'.repeat(3000)] })));
    await deny('교시 길이 121분', () => setDoc(ref(phone), pl({ lengths: '45,121' })));
    await deny('교시 길이 11개', () => setDoc(ref(phone), pl({ lengths: Array(11).fill(40).join(',') })));
    await deny('고정 교시 글자', () => setDoc(ref(phone), pl({ locks: '학생' })));
    await deny('9교시 시작 글자', () => setDoc(ref(phone), pl({ extraStarts: ['방과후 상담'] })));
    await deny('잠근 칸 글자', () => setDoc(ref(phone), pl({ cellLocks: '학생 이름' })));
    await deny('출근 시각 글자', () => setDoc(ref(phone), pl({ workStart: '아침' })));
    await deny('9교시 요일 sat', () => setDoc(ref(phone), pl({ extra: 'sat-p9=방과후' })));
    await deny('9교시 note 칸', () => setDoc(ref(phone), pl({ extra: 'mon-note=가' })));
    await deny('9교시 5000자', () => setDoc(ref(phone), pl({ extra: `mon-p9=${'가'.repeat(5000)}` })));
    await deny('9교시 맵 모양', () => setDoc(ref(phone), pl({ extra: { mon: { p9: '방과후' } } })));
    await deny('9교시 숫자', () => setDoc(ref(phone), pl({ extra: 3 })));
    await deny('9교시 21칸', () => setDoc(ref(phone), pl({ extra: Array(21).fill('mon-p9=가').join('|') })));
    await deny('잠근 칸 목록', () => setDoc(ref(phone), pl({ cellLocks: ['mon-9'] })));
    await deny('9교시 = 로 숨김', () => setDoc(ref(phone), pl({ extra: 'mon-p9=a=b' })));
    await deny('9교시 민감 낱말', () => setDoc(ref(phone), pl({ extra: 'mon-p9=보건 상담' })));
    await deny('교시 시작 글자', () => setDoc(ref(phone), { ...body, periodStarts: ['학생 상담'] }));
    await deny('교시 시작 9개', () => setDoc(ref(phone), { ...body, periodStarts: Array(9).fill('09:00') }));
    await deny('고친 날 글자', () => setDoc(ref(phone), { ...body, ttEdited: ['학생 이름 상담'] }));
    await deny('고친 날 쉼표 끼움', () => setDoc(ref(phone), { ...body, ttEdited: ['2026-04-01,2026-04-02'] }));
    await deny('고친 날 401개', () => setDoc(ref(phone), { ...toCloudSettings({ profile: { settingsAt: 1767225600000 } }, {}).body, ttEdited: Array(401).fill('2026-04-01') }));
    await deny('학사일정 memo', () => setDoc(ref(phone), ac({ memo: '가' })));
    await deny('학사일정 날짜 글자', () => setDoc(ref(phone), ac({ firstEnd: '여름 전' })));
    await deny('학사일정 쉬는 날 글자', () => setDoc(ref(phone), ac({ offDays: ['건강 검진'] })));
    await deny('학사일정 쉬는 날 41개', () => setDoc(ref(phone), ac({ offDays: Array(41).fill('2026-05-04') })));
    await deny('학사일정 연도 아님', () => setDoc(ref(phone), { ...body, academic: { memo: {} } }));
    await deny('학사일정 다섯째 칸에 숨긴 글자', () => setDoc(ref(phone), { ...body, academic: { 2024: {}, 2025: {}, 2026: {}, 2027: {}, zz: { memo: '학생 상담' } } }));
    /* 크기 제한만 보도록 다른 칸은 가볍게(계산 한도에 걸려 우연히 거절되지 않게). */
    const light = toCloudSettings({ profile: { settingsAt: 1767225600000 } }, {}).body;
    /* 실제로 쓸 수 있는 가장 큰 설정도 규칙 계산 한도(1000) 안에서 통과해야 합니다. */
    const days = (y, n) => Array.from({ length: n }, (_, i) => `${y}-${String(1 + (i % 12)).padStart(2, '0')}-${String(1 + Math.floor(i / 12)).padStart(2, '0')}`);
    const fullYear = (y) => ({ firstStart: `${y}-03-02`, firstEnd: `${y}-07-21`, secondStart: `${y}-08-18`, winterStart: `${y}-12-31`, winterBack: `${y + 1}-02-02`, secondEnd: `${y + 1}-02-10`, offDays: days(y, 40) });
    const biggest = toCloudSettings({ profile: {
        settingsAt: 1767225600000, ttEdited: days(2026, 400).map((d, i) => d.replace('2026', String(2024 + (i % 4)))).filter((v, i, l) => l.indexOf(v) === i),
        periodStarts: SETTINGS_PROFILE.periodStarts,
        academic: { 2025: fullYear(2025), 2026: fullYear(2026), 2027: fullYear(2027), 2028: fullYear(2028) },
    } }, { ...SETTINGS_LOCAL, count: 10, lengths: Array(10).fill(45), locks: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], cellLocks: ['mon', 'tue', 'wed', 'thu', 'fri'].flatMap((d) => Array.from({ length: 10 }, (_, i) => `${d}-${i + 1}`)),
        extra: Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri'].map((d) => [d, { p9: '방과후 영어', p10: '보충 수학', s9: '3-1', s10: '3-2' }])) }).body;
    if (biggest.academic['2026']?.winterBack !== '2027-02-02') out.push('가장 큰 설정에 겨울 방학식·개학일이 빠졌습니다.');
    if (Object.keys(biggest.academic).length !== 4 || biggest.periodLocal.cellLocks.split(',').length !== 50) out.push('가장 큰 설정 모양을 만들지 못했습니다.');
    await allow('가장 큰 설정', () => setDoc(ref(phone), biggest));
    await allow('가벼운 설정', () => setDoc(ref(phone), light));
    await deny('겨울 개학일에 날짜 아닌 글자', () => setDoc(ref(phone), { ...light, academic: { 2026: { winterBack: '학생 상담' } } }));
    await deny('겨울 방학식에 숫자', () => setDoc(ref(phone), { ...light, academic: { 2026: { winterStart: 20261231 } } }));
    await deny('학사일정 모르는 칸', () => setDoc(ref(phone), { ...light, academic: { 2026: { springStart: '2027-02-11' } } }));
    await allow('겨울 방학식·개학일만 있는 학년도', () => setDoc(ref(phone), { ...light, academic: { 2026: { winterStart: '2026-12-31', winterBack: '2027-02-02' } } }));
    await deny('학사일정 5개 학년도', () => setDoc(ref(phone), { ...light, academic: { 2024: {}, 2025: {}, 2026: {}, 2027: {}, 2028: {} } }));
    /* 이스케이프: '|'·'=' 가 든 과목명이 그대로 왕복되고, 크기 한도(1000)를 넘으면 거절됩니다. */
    const esc = toCloudSettings({ profile: SETTINGS_PROFILE }, { ...SETTINGS_LOCAL, extra: { mon: { p9: 'A|B반' }, tue: { p10: '1=1반' }, wed: { s9: '100%' } } }).body;
    await allow('9교시 | = % 과목명', () => setDoc(ref(phone), esc));
    const escBack = fromCloudSettings((await getDoc(ref(pc))).data() || {}).periodLocal.extra;
    if (escBack?.mon?.p9 !== 'A|B반' || escBack?.tue?.p10 !== '1=1반' || escBack?.wed?.s9 !== '100%') out.push(`이스케이프한 과목명이 그대로 돌아오지 않았습니다. ${JSON.stringify(escBack)}`);
    await deny('9교시 날 % 글자', () => setDoc(ref(phone), pl({ extra: 'mon-p9=100%' })));
    const fat = Array.from({ length: 20 }, (_, i) => `${['mon', 'tue', 'wed', 'thu', 'fri'][i % 5]}-${['p9', 'p10', 's9', 's10'][Math.floor(i / 5)]}=${'%7C'.repeat(20)}`).join('|');
    if (fat.length <= 1000) out.push('크기 한도 검사용 글자가 1000자를 넘지 않습니다.');
    await deny('9교시 1000자 넘음', () => setDoc(ref(phone), { ...light, periodLocal: { ...light.periodLocal, extra: fat } }));
    await deny('학사일정 넷째 학년도 값', () => setDoc(ref(phone), { ...light, academic: { 2024: {}, 2025: {}, 2026: {}, 2027: { memo: '학생 상담' } } }));
    await deny('updatedAt 글자', () => setDoc(ref(phone), { ...body, updatedAt: '학생 상담' }));
    await allow('빈 9교시 설정', () => setDoc(ref(phone), pl({ extra: '', lengths: '', locks: '', cellLocks: '', workStart: '', workEnd: '' })));
    /* 날짜별 시간표 9·10교시 */
    const tt = (fs, row) => setDoc(doc(fs, 'users/teacher-sync/timetable/2026-10-28'), row);
    const ttRow = toCloudRow('timetable', { id: '2026-10-28', p1: '국어', p9: '방과후', s10: '보충' });
    await allow('날짜별 9·10교시', () => tt(phone, ttRow.body));
    const ttSnap = await getDoc(doc(pc, 'users/teacher-sync/timetable/2026-10-28'));
    if (ttSnap.data()?.p9 !== '방과후' || ttSnap.data()?.s10 !== '보충') out.push('날짜별 9·10교시가 다른 기기에서 읽히지 않습니다.');
    await deny('날짜별 9교시 민감 낱말', () => tt(phone, { ...ttRow.body, p9: '투약 확인' }));
    await deny('날짜별 10교시 21자', () => tt(phone, { ...ttRow.body, p10: '가'.repeat(21) }));
    await deny('날짜별 11교시', () => tt(phone, { ...ttRow.body, p11: '가' }));
    return out;
}

/** 하단 탭바 배치(settings/tabbar) 검사 묶음: 본인 읽기·쓰기만, 남의 uid·다른 경로·잘못된 모양은 거절. */
async function tabbarSuite(env) {
    const out = [];
    const deny = async (label, op) => { try { await assertFails(op()); } catch (error) { out.push(`탭바: ${label} 요청이 거절되지 않았습니다. ${error?.message || error}`); } };
    const allow = async (label, op) => { try { await assertSucceeds(op()); } catch (error) { out.push(`탭바: ${label} 요청이 거절되었습니다. ${error?.message || error}`); } };
    const me = env.authenticatedContext('teacher-tab').firestore();
    const other = env.authenticatedContext('teacher-tab-b').firestore();
    const guest = env.unauthenticatedContext().firestore();
    const ref = (fs, path = 'users/teacher-tab/settings/tabbar') => doc(fs, path);
    const order = ['minutes', 'todo', 'attend', 'schedule', 'students', 'more'];
    const body = (patch = {}) => ({ order, at: Date.now(), updatedAt: serverTimestamp(), ...patch });
    await allow('본인 쓰기', () => setDoc(ref(me), body()));
    await allow('본인 읽기', () => getDoc(ref(me)));
    await allow('본인 다시 쓰기', () => setDoc(ref(me), body({ order: [...order].reverse() })));
    await deny('남의 uid 읽기', () => getDoc(ref(other)));
    await deny('남의 uid 쓰기', () => setDoc(ref(other), body()));
    await deny('로그인 없이 읽기', () => getDoc(ref(guest)));
    await deny('로그인 없이 쓰기', () => setDoc(ref(guest), body()));
    await deny('다른 이름의 설정 문서', () => setDoc(ref(me, 'users/teacher-tab/settings/tabbar2'), body()));
    await deny('다른 컬렉션', () => setDoc(ref(me, 'users/teacher-tab/tabbar/main'), body()));
    await deny('users 밖 경로', () => setDoc(ref(me, 'tabbar/teacher-tab'), body()));
    await deny('모르는 칸', () => setDoc(ref(me), body({ extra: 1 })));
    await deny('5칸', () => setDoc(ref(me), body({ order: order.slice(0, 5) })));
    await deny('겹친 칸', () => setDoc(ref(me), body({ order: ['todo', 'todo', 'attend', 'schedule', 'students', 'more'] })));
    await deny('모르는 탭', () => setDoc(ref(me), body({ order: ['hack', 'todo', 'attend', 'schedule', 'students', 'more'] })));
    await deny('「더」 없음', () => setDoc(ref(me), body({ order: ['today', 'todo', 'attend', 'schedule', 'students', 'minutes'] })));
    await deny('미래 시각', () => setDoc(ref(me), body({ at: Date.now() + 3600 * 1000 })));
    await deny('시각 0', () => setDoc(ref(me), body({ at: 0 })));
    await deny('글자 시각', () => setDoc(ref(me), body({ at: '1' })));
    await deny('서버 시각 아닌 updatedAt', () => setDoc(ref(me), body({ updatedAt: 1 })));
    await deny('남의 uid 삭제', () => deleteDoc(ref(other)));
    await allow('본인 삭제', () => deleteDoc(ref(me)));
    return out;
}

/** 할 일 하루 목표·달성 기록(settings/goal, PR C) 검사 묶음. 앱이 만드는 모양 그대로(toGoalDoc) 받고, 모양이 틀리면 거절. */
async function goalSuite(env) {
    const out = [];
    const deny = async (label, op) => { try { await assertFails(op()); } catch (error) { out.push(`목표: ${label} 요청이 거절되지 않았습니다. ${error?.message || error}`); } };
    const allow = async (label, op) => { try { await assertSucceeds(op()); } catch (error) { out.push(`목표: ${label} 요청이 거절되었습니다. ${error?.message || error}`); } };
    const me = env.authenticatedContext('teacher-goal').firestore();
    const other = env.authenticatedContext('teacher-goal-b').firestore();
    const ref = (fs, path = 'users/teacher-goal/settings/goal') => doc(fs, path);
    const shaped = toGoalDoc({ n: 3, nAt: Date.now() - 1000, days: { '2026-11-09': { c: 3, g: 3, at: Date.now() - 500 }, '2026-11-08': { c: 1, g: 3, at: Date.now() - 900 } } });
    const body = (patch = {}) => ({ ...shaped, updatedAt: serverTimestamp(), ...patch });
    const many = Array.from({ length: 400 }, (_, i) => { const d = new Date(Date.UTC(2026, 0, 1) + i * 86400000).toISOString().slice(0, 10); return `${d}~10~10~${1762650000000 + i}`; }).join('|');
    await allow('앱 모양 쓰기', () => setDoc(ref(me), body()));
    await allow('본인 읽기', () => getDoc(ref(me)));
    await allow('목표 끔(0)·빈 기록', () => setDoc(ref(me), body({ n: 0, days: '' })));
    await allow('400일 기록', () => setDoc(ref(me), body({ days: many })));
    await deny('401일 기록', () => setDoc(ref(me), body({ days: `${many}|2027-02-05~1~1~1` })));
    await deny('남의 uid 쓰기', () => setDoc(ref(other), body()));
    await deny('남의 uid 읽기', () => getDoc(ref(other)));
    await deny('목표 21개', () => setDoc(ref(me), body({ n: 21 })));
    await deny('목표 음수', () => setDoc(ref(me), body({ n: -1 })));
    await deny('목표 글자', () => setDoc(ref(me), body({ n: '3' })));
    await deny('미래 목표 시각', () => setDoc(ref(me), body({ nAt: Date.now() + 3600 * 1000 })));
    await deny('모르는 칸', () => setDoc(ref(me), body({ extra: 1 })));
    await deny('updatedAt 없음', () => setDoc(ref(me), { ...shaped }));
    await deny('서버 시각 아닌 updatedAt', () => setDoc(ref(me), body({ updatedAt: 1 })));
    await deny('없는 날짜', () => setDoc(ref(me), body({ days: '2026-13-01~3~3~1' })));
    await deny('목표 0인 날짜 기록', () => setDoc(ref(me), body({ days: '2026-11-09~3~0~1' })));
    await deny('기록 끝 쉼표 숨기기', () => setDoc(ref(me), body({ days: '2026-11-09~3~3~1|' })));
    await deny('기록에 글 숨기기', () => setDoc(ref(me), body({ days: '2026-11-09~3~3~1 학폭' })));
    await deny('기록 목록', () => setDoc(ref(me), body({ days: ['2026-11-09~3~3~1'] })));
    await deny('기록 너무 김', () => setDoc(ref(me), body({ days: 'x'.repeat(12401) })));
    await allow('본인 삭제', () => deleteDoc(ref(me)));
    return out;
}

/** 할 일 중요도·끝낸 날(PR C): 앱이 올리는 모양은 받고, 틀린 값은 거절. */
async function todoAchieveSuite(env) {
    const out = [];
    const deny = async (label, op) => { try { await assertFails(op()); } catch (error) { out.push(`할 일 중요도: ${label} 요청이 거절되지 않았습니다. ${error?.message || error}`); } };
    const allow = async (label, op) => { try { await assertSucceeds(op()); } catch (error) { out.push(`할 일 중요도: ${label} 요청이 거절되었습니다. ${error?.message || error}`); } };
    const me = env.authenticatedContext('teacher-pri').firestore();
    const shaped = toCloudRow('todos', { id: 'pri1', title: '가정통신문 출력', done: true, doneOn: '2026-11-09', doneHm: '09:12', pri: 3, source: 'app' });
    if (!shaped || shaped.body.pri !== 3 || shaped.body.doneOn !== '2026-11-09' || shaped.body.doneHm !== '09:12') out.push('할 일 중요도: 앱 모양에 pri·doneOn·doneHm이 없습니다.');
    const body = (patch = {}) => ({ ...shaped.body, ...patch });
    const ref = (id = 'pri1') => doc(me, `users/teacher-pri/todos/${id}`);
    await allow('앱 모양 쓰기', () => setDoc(ref(), body()));
    await allow('낮음', () => setDoc(ref('pri2'), body({ pri: 1 })));
    await allow('중요도 없는 옛 모양', () => setDoc(ref('pri3'), { title: '옛 할 일', done: false, source: 'app' }));
    await deny('중요도 4', () => setDoc(ref('pri4'), body({ pri: 4 })));
    await deny('중요도 0', () => setDoc(ref('pri5'), body({ pri: 0 })));
    await deny('중요도 글자', () => setDoc(ref('pri6'), body({ pri: '높음' })));
    await deny('끝낸 날 글자', () => setDoc(ref('pri7'), body({ doneOn: '오늘' })));
    await deny('없는 끝낸 날', () => setDoc(ref('pri8'), body({ doneOn: '2026-02-30' })));
    await deny('끝낸 시각 25시', () => setDoc(ref('pri9'), body({ doneHm: '25:00' })));
    const undone = toCloudRow('todos', { id: 'pri1', title: '가정통신문 출력', done: false, doneOn: '', doneHm: '', pri: 3, source: 'app' });
    if (!undone || 'doneOn' in undone.body || !undone.clear.includes('doneOn') || !undone.clear.includes('doneHm')) out.push('할 일 중요도: 체크를 풀면 끝낸 날 칸을 지우라고 알리지 않습니다.');
    return out;
}

/* 규칙 돌연변이: 설정 검사를 하나씩 풀어 본 판에서 위 묶음이 실패해야 합니다(검사가 빈말이 아닌지). */
const RULE_MUTANTS = [
    ['읽기 열기', "allow read, delete: if isOwner(uid) && key in ['device', 'leave', 'tabbar'];", 'allow read, delete: if true;'],
    ['목표 읽기 열기', "match /settings/goal {\n        allow read, delete: if isOwner(uid);", "match /settings/goal {\n        allow read, delete: if true;"],
    ['목표 개수 상한 빼기', "&& g.n is int && g.n >= 0 && g.n <= 20", "&& g.n is int"],
    ['목표 미래 시각 빼기', "&& g.nAt <= request.time.toMillis() + 300000", ''],
    ['목표 키 제한 빼기', "&& g.keys().hasOnly(['n', 'nAt', 'days', 'updatedAt'])", ''],
    ['목표 날짜 기록 모양 빼기', "&& g.days.matches('^(20[2-9]", "&& g.days.matches('(?s).*') || g.days.matches('^(20[2-9]"],
    ['탭바 겹침 검사 빼기', "&& t.order.toSet().size() == 6", ''],
    ['탭바 탭 이름 빼기', "&& t.order.hasOnly(['today', 'todo', 'attend', 'schedule', 'students', 'more', 'minutes', 'notice', 'neis', 'settings'])", ''],
    ['탭바 미래 시각 빼기', "&& t.at <= request.time.toMillis() + 300000", ''],
    ['탭바 키 제한 빼기', "&& t.keys().hasOnly(['order', 'at', 'updatedAt'])", ''],
    ['at 검사 빼기', "&& v.at is int && v.at > 0 && v.at <= 4102444800000", ''],
    ['periodLocal 키 제한 빼기', "&& p.keys().hasOnly(['level', 'count', 'lengths', 'extraStarts', 'locks', 'cellLocks', 'workStart', 'workEnd', 'extra'])\n", '\n'],
    ['extra 칸 이름 제한 빼기', "e.matches('^((mon|tue|wed|thu|fri)-[ps](9|10)=([^|=%]|%(25|7C|3D)){0,20}([|](mon|tue|wed|thu|fri)-[ps](9|10)=([^|=%]|%(25|7C|3D)){0,20}){0,19})?$')", "e.matches('(?s).*')"],
    ['R_extraSize', "e is string && e.size() <= 1000", 'e is string'],
    ['R_acadAt3', "&& acadAt(a, 0) && acadAt(a, 1) && acadAt(a, 2) && acadAt(a, 3);", '&& acadAt(a, 0) && acadAt(a, 1) && acadAt(a, 2);'],
    ['R_updatedAt', "&& (!('updatedAt' in v) || v.updatedAt is timestamp);", ';'],
    ['ttEdited 크기 빼기', "joinedOk(v.ttEdited, 400,", 'joinedOk(v.ttEdited, 100000,'],
    ['칸 시각 검사 빼기', "&& setAtsOk(v.ats)", ''],
    ['출퇴근 칸 시각 검사 빼기', "&& (!('work' in a) || atOk(a.work));", ';'],
    ['출퇴근 칸 시각 받지 않기', "'academic', 'work'])", "'academic'])"],
    ['academic 크기 빼기', "a is map && a.size() <= 4", 'a is map'],
    ['academic 값 검사 빼기', "y.matches('^20(2[4-9]|3[0-5])$') && acadYearOk(a[y]);", "y.matches('^20(2[4-9]|3[0-5])$');"],
    ['academic 연도 이름 빼기', "y.matches('^20(2[4-9]|3[0-5])$') && acadYearOk", 'acadYearOk'],
    ['9교시 과목 검사 빼기', "function subjOk(m, k) { return !(k in m) || (str(m[k], 0, 20) && safeText(m[k])); }", 'function subjOk(m, k) { return true; }'],
    ['교시 수 검사 빼기', "&& p.count is int && p.count >= 1 && p.count <= 10", ''],
    ['교시 길이 검사 빼기', "csvOk(p.lengths, '^(([0-9]", "csvOk('', '^(([0-9]"],
];
async function rulesMutantCheck() {
    const out = [];
    let n = 0;
    for (const [label, from, to] of RULE_MUTANTS) {
        n += 1;
        if (!rules.includes(from)) { out.push(`규칙 돌연변이 "${label}"의 원문을 규칙에서 찾지 못했습니다.`); continue; }
        const env = await initializeTestEnvironment({ projectId: `demo-ssug-mut-${n}`, firestore: { rules: rules.replace(from, () => to), host, port: Number(portText) } });
        try {
            const found = [...await settingsSuite(env), ...await tabbarSuite(env), ...await goalSuite(env)];
            if (!found.length) out.push(`규칙 돌연변이 "${label}"을(를) 검사가 잡지 못했습니다.`);
        } finally {
            await env.cleanup();
        }
    }
    return out;
}

try {
    await expectDeny('학생 메모 건강', () => setDoc(doc(db, 'users/teacher-a/students/s3'), { no: 3, name: '박서준', memo: '건강 특이' }));
    await expectDeny('학생 메모 보건', () => setDoc(doc(db, 'users/teacher-a/students/s5'), { no: 5, name: '강민우', memo: '보건실' }));
    await expectAllow('학생 메모 반장', () => setDoc(doc(db, 'users/teacher-a/students/s4'), { no: 4, name: '윤채원', memo: '반장' }));
    await expectAllow('학생 51번(남녀 나눈 번호)', () => setDoc(doc(db, 'users/teacher-a/students/s51'), { no: 51, name: '서하린' }));
    await expectAllow('학생 99번', () => setDoc(doc(db, 'users/teacher-a/students/s99'), { no: 99, name: '문도윤' }));
    await expectDeny('학생 100번', () => setDoc(doc(db, 'users/teacher-a/students/s100'), { no: 100, name: '문서윤' }));
    await expectDeny('기록 건강', () => setDoc(doc(db, 'users/teacher-a/records/r1'), {
        date: '2026-10-19', kind: 'observe', text: '건강 특이', source: 'app',
    }));
    await expectDeny('기록 보건', () => setDoc(doc(db, 'users/teacher-a/records/r2'), {
        date: '2026-10-19', kind: 'counsel', text: '보건 상담', source: 'app',
    }));
    await expectAllow('평범한 기록', () => setDoc(doc(db, 'users/teacher-a/records/r3'), {
        date: '2026-10-19', kind: 'observe', text: '발표를 끝까지 했어요', source: 'app',
    }));
    // 보호자 연락처·주소와 태그(RE2 쪽에서도 앱과 같은 뜻인지)
    await expectDeny('기록 휴대폰 번호', () => setDoc(doc(db, 'users/teacher-a/records/rc1'), {
        date: '2026-10-19', kind: 'parent', text: '어머니 010-1234-5678', source: 'app',
    }));
    await expectDeny('기록 붙여 쓴 휴대폰 번호', () => setDoc(doc(db, 'users/teacher-a/records/rc2'), {
        date: '2026-10-19', kind: 'parent', text: '01012345678로 연락', source: 'app',
    }));
    await expectDeny('출결 메모 일반 전화', () => setDoc(doc(db, 'users/teacher-a/attendance/2026-10-19_s3'), {
        date: '2026-10-19', sid: 's3', status: 'absent', note: '집 02-123-4567',
    }));
    await expectAllow('출결 메모 시각', () => setDoc(doc(db, 'users/teacher-a/attendance/2026-10-19_s4'), {
        date: '2026-10-19', sid: 's4', status: 'late', note: '09:10 도착, 1교시 뒤',
    }));
    await expectDeny('학생 메모 동·호', () => setDoc(doc(db, 'users/teacher-a/students/s6'), { no: 6, name: '정다은', memo: '101동 1203호' }));
    await expectDeny('기록 도로명 주소', () => setDoc(doc(db, 'users/teacher-a/records/rc3'), {
        date: '2026-10-19', kind: 'parent', text: '중앙로12번길 34 이사', source: 'app',
    }));
    await expectAllow('기록 날짜·교시·점수', () => setDoc(doc(db, 'users/teacher-a/records/rc4'), {
        date: '2026-10-19', kind: 'observe', text: '2026-10-19 3교시 수학 85점, 3동 견학', source: 'app',
    }));
    await expectDeny('기록 태그 건강검진', () => setDoc(doc(db, 'users/teacher-a/records/rc5'), {
        date: '2026-10-19', kind: 'observe', text: '줄넘기 연습', tags: ['건강검진'], source: 'app',
    }));
    await expectDeny('회의록 태그 민원전화', () => setDoc(doc(db, 'users/teacher-a/notes/notetag01'), {
        text: '협의 안건', tags: ['회의', '민원전화'], source: 'app',
    }));
    await expectAllow('기록 평범한 태그', () => setDoc(doc(db, 'users/teacher-a/records/rc6'), {
        date: '2026-10-19', kind: 'observe', text: '줄넘기 연습', tags: ['체육', '칭찬'], source: 'app',
    }));
    await expectDeny('기록 태그가 리스트 아님', () => setDoc(doc(db, 'users/teacher-a/records/rc7'), {
        date: '2026-10-19', kind: 'observe', text: '줄넘기 연습', tags: '체육', source: 'app',
    }));
    await expectDeny('기록 태그에 숫자', () => setDoc(doc(db, 'users/teacher-a/records/rc8'), {
        date: '2026-10-19', kind: 'observe', text: '줄넘기 연습', tags: ['체육', 3], source: 'app',
    }));
    const inboxRow = toCloudRow('inbox', {
        id: 'msgabcdef12',
        kind: '할 일',
        title: '체험학습 동의서',
        date: '2026-12-31',
        warning: '저장하면 임시보관함에 들어가요.',
        source: 'msg',
    });
    if (!inboxRow || inboxRow.body.kind !== 'todo' || inboxRow.body.date !== '2026-12-31' || inboxRow.body.source !== 'app') {
        failures.push(`정리함 클라우드 모양이 아닙니다. ${JSON.stringify(inboxRow)}`);
    } else {
        await expectAllow('정리함', () => setDoc(doc(db, 'users/teacher-a/inbox/msgabcdef12'), inboxRow.body));
        await expectDeny('정리함 건강', () => setDoc(doc(db, 'users/teacher-a/inbox/msghealth01'), {
            title: '건강 조심', kind: 'todo', source: 'app', warning: '건강',
        }));
        await expectDeny('정리함 제목만 건강', () => setDoc(doc(db, 'users/teacher-a/inbox/msghealth02'), {
            title: '건강 조심', kind: 'todo', source: 'app', warning: '저장하면 임시보관함에 들어가요.',
        }));
        await expectDeny('정리함 안내만 건강', () => setDoc(doc(db, 'users/teacher-a/inbox/msghealth03'), {
            title: '체험학습 동의서', kind: 'todo', source: 'app', warning: '건강',
        }));
        const back = fromCloudRow('inbox', 'msgabcdef12', inboxRow.body);
        if (!back || back.kind !== '할 일' || back.date !== '2026-12-31' || back.title !== '체험학습 동의서') {
            failures.push(`정리함을 다시 읽지 못했습니다. ${JSON.stringify(back)}`);
        }
        const other = testEnv.authenticatedContext('teacher-b').firestore();
        const guest = testEnv.unauthenticatedContext().firestore();
        const inboxPath = 'users/teacher-a/inbox/msgabcdef12';
        await expectBlocked('정리함 소유자', () => setDoc(doc(db, 'users/teacher-b/inbox/msgabcdef12'), inboxRow.body));
        await expectBlocked('다른 사람 정리함 읽기', () => getDoc(doc(other, inboxPath)));
        await expectBlocked('다른 사람 정리함 삭제', () => deleteDoc(doc(other, inboxPath)));
        await expectBlocked('로그인 없이 정리함 읽기', () => getDoc(doc(guest, inboxPath)));
        const kept = await getDoc(doc(db, inboxPath));
        if (!kept.exists()) failures.push('다른 사람의 삭제가 정리함을 지웠습니다.');
        const inboxBase = { title: '체험학습 동의서', kind: 'todo', source: 'app' };
        await expectDeny('정리함 kind', () => setDoc(doc(db, 'users/teacher-a/inbox/badkind01'), { ...inboxBase, kind: 'note' }));
        await expectDeny('정리함 title', () => setDoc(doc(db, 'users/teacher-a/inbox/badtitle1'), { ...inboxBase, title: '가'.repeat(101) }));
        await expectDeny('정리함 warning', () => setDoc(doc(db, 'users/teacher-a/inbox/badwarn01'), { ...inboxBase, warning: '가'.repeat(121) }));
        await expectDeny('정리함 source', () => setDoc(doc(db, 'users/teacher-a/inbox/badsource'), { ...inboxBase, source: 'msg' }));
        await expectDeny('정리함 endTime', () => setDoc(doc(db, 'users/teacher-a/inbox/badendtim'), { ...inboxBase, endTime: '16:00까지' }));
    }
    /* 회의록(메모 + '회의' 태그): 여러 줄 본문·제목·참석자가 다른 기기에서 그대로 읽히고, 옛 회의록 모양도 계속 받습니다. */
    {
        const pcA = testEnv.authenticatedContext('teacher-a').firestore();
        const longBody = Array.from({ length: 600 }, (_, i) => `${i + 1}. 안건을 이야기했습니다. 다음 주까지 정리합니다.`).join('\n');
        const meet = toCloudRow('notes', { id: 'meet-1761600000000', title: '학년 협의회', attendees: '김선생, 이선생', date: '2026-10-28', text: longBody, tags: ['회의', '학년회의'], pinned: false, source: 'app' });
        if (!meet || meet.body.text.length < 15000) failures.push('긴 회의록 본문을 올릴 모양으로 만들지 못했습니다.');
        await expectAllow('긴 회의록', () => setDoc(doc(db, `users/teacher-a/notes/${meet.id}`), meet.body));
        const back = fromCloudRow('notes', meet.id, (await getDoc(doc(pcA, `users/teacher-a/notes/${meet.id}`))).data() || {});
        if (back?.text !== longBody || back?.title !== '학년 협의회' || back?.attendees !== '김선생, 이선생' || back?.date !== '2026-10-28') failures.push(`회의록이 다른 기기에서 그대로 읽히지 않습니다. ${JSON.stringify({ ...back, text: back?.text?.length })}`);
        const old = toCloudRow('notes', { id: 'meet-1761500000000', text: '학년회의 14:00 체험학습 안내', date: '2026-10-20', tags: ['회의', '학년회의'], pinned: false, source: 'app' });
        await expectAllow('옛 회의록 모양', () => setDoc(doc(db, `users/teacher-a/notes/${old.id}`), old.body));
        const nb = meet.body;
        await expectDeny('회의록 본문 20001자', () => setDoc(doc(db, 'users/teacher-a/notes/meetbig01'), { ...nb, text: '가'.repeat(20001) }));
        await expectDeny('회의록 제목 61자', () => setDoc(doc(db, 'users/teacher-a/notes/meetbig02'), { ...nb, title: '가'.repeat(61) }));
        await expectDeny('회의록 제목 숫자', () => setDoc(doc(db, 'users/teacher-a/notes/meetbig03'), { ...nb, title: 3 }));
        await expectDeny('회의록 참석자 201자', () => setDoc(doc(db, 'users/teacher-a/notes/meetbig04'), { ...nb, attendees: '가'.repeat(201) }));
        await expectDeny('회의록 참석자 목록', () => setDoc(doc(db, 'users/teacher-a/notes/meetbig05'), { ...nb, attendees: ['김선생'] }));
        await expectDeny('회의록 제목 민감 낱말', () => setDoc(doc(db, 'users/teacher-a/notes/meetbig06'), { ...nb, title: '학폭 협의' }));
        await expectDeny('회의록 참석자 민감 낱말', () => setDoc(doc(db, 'users/teacher-a/notes/meetbig07'), { ...nb, attendees: '보건 선생님' }));
        await expectDeny('회의록 본문 민감 낱말', () => setDoc(doc(db, 'users/teacher-a/notes/meetbig08'), { ...nb, text: `${longBody}\n민원 처리` }));
        await expectDeny('회의록 모르는 칸', () => setDoc(doc(db, 'users/teacher-a/notes/meetbig09'), { ...nb, place: '교무실' }));
        await expectDeny('회의록 빈 본문', () => setDoc(doc(db, 'users/teacher-a/notes/meetbig10'), { ...nb, text: '' }));
        await expectDeny('회의록 날짜 글자', () => setDoc(doc(db, 'users/teacher-a/notes/meetbig11'), { ...nb, date: '다음 주' }));
        if (toCloudRow('notes', { id: 'meet-2', title: '협의', attendees: '보건 선생님', text: '안건', tags: ['회의'], source: 'app' })) failures.push('민감한 참석자가 든 회의록을 올리려 합니다.');
    }
    const stranger = testEnv.unauthenticatedContext().firestore();
    await expectDeny('로그인 없이', () => setDoc(doc(stranger, 'users/teacher-a/students/s9'), { no: 9, name: '장하람' }));

    /* 기기끼리 같이 쓰는 설정: 휴대폰에서 올린 9교시·학사일정이 PC에서 그대로 읽히는지, 안쪽 값도 막는지. */
    failures.push(...await settingsSuite(testEnv));
    failures.push(...await tabbarSuite(testEnv));
    failures.push(...await goalSuite(testEnv));
    failures.push(...await todoAchieveSuite(testEnv));

    const uid = 'teacher-span';
    const deviceA = testEnv.authenticatedContext(uid).firestore();
    const deviceB = testEnv.authenticatedContext(uid).firestore();
    const ranged = toCloudRow('events', {
        id: 'span1',
        date: '2026-10-30',
        title: '학부모 진로 특강',
        time: '14:00',
        endTime: '16:00',
        kind: '학급',
        memo: '강당',
        source: 'msg',
    });
    const plain = toCloudRow('events', {
        id: 'plain1',
        date: '2026-10-23',
        title: '과학관 현장체험학습',
        time: '08:50',
        kind: '학급',
        source: 'app',
    });
    if (!ranged?.body?.endTime || plain?.body?.endTime) {
        failures.push('올리는 일정 모양에 끝 시각이 빠지거나, 끝 시각이 없는 일정에 생겼습니다.');
    } else {
        await expectAllow('끝 시각 있는 일정', () => setDoc(doc(deviceA, `users/${uid}/events/${ranged.id}`), ranged.body));
        await expectAllow('끝 시각 없는 일정', () => setDoc(doc(deviceA, `users/${uid}/events/${plain.id}`), plain.body));
        await expectDeny('잘못된 끝 시각', () => setDoc(doc(deviceA, `users/${uid}/events/bad1`), {
            date: '2026-10-30', title: '워크숍', time: '13:00', endTime: '16:00까지', kind: 'class', source: 'app',
        }));
        /* PR #62 r4 2번(R4): 일정 시작 시각(time)도 HH:MM만 받습니다. 규칙을 느슨하게 하면 이 검사가 실패합니다. */
        for (const [i, bad] of ['25:00', '9:05', '09:60', '0930', '09:30 ', '아침', 930, ''].entries()) {
            await expectDeny(`잘못된 시작 시각 ${JSON.stringify(bad)}`, () => setDoc(doc(deviceA, `users/${uid}/events/badtime${i}`), {
                date: '2026-10-30', title: '워크숍', time: bad, kind: 'class', source: 'app',
            }));
        }
        await expectDeny('잘못된 끝 시각(24:00)', () => setDoc(doc(deviceA, `users/${uid}/events/badend2`), {
            date: '2026-10-30', title: '워크숍', time: '13:00', endTime: '24:00', kind: 'class', source: 'app',
        }));
        await expectAllow('바른 시작 시각(00:00·23:59)', () => setDoc(doc(deviceA, `users/${uid}/events/goodtime`), {
            date: '2026-10-30', title: '워크숍', time: '00:00', endTime: '23:59', kind: 'class', source: 'app',
        }));
        const pulled = [];
        for (const id of [ranged.id, plain.id]) {
            const snap = await getDoc(doc(deviceB, `users/${uid}/events/${id}`));
            const row = snap.exists() ? fromCloudRow('events', snap.id, snap.data()) : null;
            if (row) pulled.push(row);
        }
        const emptyStore = [];
        const merged = new Map(emptyStore.map((row) => [String(row.id), row]));
        pulled.forEach((row) => {
            if (!row?.id || merged.has(String(row.id))) return;
            merged.set(String(row.id), row);
        });
        const onSecond = [...merged.values()];
        const spanRow = onSecond.find((row) => row.id === ranged.id);
        const plainRow = onSecond.find((row) => row.id === plain.id);
        if (!spanRow || eventClock(spanRow) !== '14:00–16:00' || spanRow.memo !== '강당') {
            failures.push(`빈 저장소에서 14:00–16:00이 유지되지 않았습니다. ${JSON.stringify(spanRow)}`);
        }
        if (!plainRow || plainRow.endTime || eventClock(plainRow) !== '08:50') {
            failures.push(`끝 시각이 없는 기존 일정이 빈 저장소에서 달라졌습니다. ${JSON.stringify(plainRow)}`);
        }
    }

    const oldRules = rulesWithoutEventEndTime(rules);
    const eventsBlock = ruleBlock(oldRules, 'match /events/{eid}', 'match /todos/{tid}');
    const inboxBlock = ruleBlock(oldRules, 'match /inbox/{iid}', 'match /notes/{nid}');
    if (!eventsBlock || eventsBlock.includes('endTime') || !inboxBlock.includes('endTime')) {
        failures.push('예전 규칙에서 endTime을 빼지 못했습니다.');
    } else {
        const oldEnv = await initializeTestEnvironment({
            projectId: 'demo-ssug-rules-old',
            firestore: { rules: oldRules, host, port: Number(portText) },
        });
        try {
            const oldA = oldEnv.authenticatedContext(uid).firestore();
            const oldB = oldEnv.authenticatedContext(uid).firestore();
            const blocked = toCloudRow('events', {
                id: 'span1',
                date: '2026-10-30',
                title: '학부모 진로 특강',
                time: '14:00',
                endTime: '16:00',
                kind: '학급',
                memo: '강당',
                source: 'msg',
            });
            const fallback = eventBodyWithoutEndTime(blocked.body);
            await expectDeny('예전 규칙의 끝 시각', () => setDoc(doc(oldA, `users/${uid}/events/${blocked.id}`), blocked.body));
            if (!fallback || fallback.endTime) {
                failures.push('거절된 일정에서 끝 시각을 빼지 못했습니다.');
            } else {
                await expectAllow('예전 규칙의 메모 재시도', () => setDoc(doc(oldA, `users/${uid}/events/${blocked.id}`), fallback));
                const snap = await getDoc(doc(oldB, `users/${uid}/events/${blocked.id}`));
                const row = snap.exists() ? fromCloudRow('events', snap.id, snap.data()) : null;
                if (!row || row.endTime || row.time !== '14:00' || !String(row.memo).includes('16:00까지') || !String(row.memo).includes('강당')) {
                    failures.push(`예전 규칙에서 다시 올린 일정이 다른 기기에 남지 않았습니다. ${JSON.stringify(row)}`);
                }
            }
        } finally {
            await oldEnv.cleanup();
        }
    }
    /* 출결 고치기: 병합 쓰기에서 비운 사유·메모가 클라우드에 남아 다음 받기에서 되돌아오지 않아야 합니다. */
    {
        const put = async (row) => {
            const shaped = toCloudRow('attendance', row);
            const body = { ...shaped.body };
            (shaped.clear || []).forEach((key) => { body[key] = deleteField(); });
            await setDoc(doc(db, `users/teacher-a/attendance/${shaped.id}`), body, { merge: true });
            return shaped.id;
        };
        const row = { id: '2026-10-27_att1', date: '2026-10-27', sid: 'att1', status: '결석', reason: '질병', note: '병원 진료', period: 3, paper: true, source: 'app' };
        const aid = await put(row);
        await put({ ...row, status: '지각', reason: '', note: '', period: '' });
        const back = fromCloudRow('attendance', aid, (await getDoc(doc(db, `users/teacher-a/attendance/${aid}`))).data() || {});
        if (back.status !== '지각' || back.reason !== '' || back.note !== '' || back.period !== '') {
            failures.push(`고친 출결의 비운 칸이 클라우드에 남았습니다: ${JSON.stringify(back)}`);
        }
        await deleteDoc(doc(db, `users/teacher-a/attendance/${aid}`));
        if ((await getDoc(doc(db, `users/teacher-a/attendance/${aid}`))).exists()) failures.push('출석으로 되돌린 출결 문서를 지우지 못했습니다.');
    }
    /* 할 일 알림 시각(PR #60·#62): 'HH:MM'만 받고 잘못된 값은 거릅니다. 새 문서라 hlc 없이도 받습니다. */
    {
        const todoDoc = (n) => doc(db, `users/teacher-a/todos/time-${n}`);
        const body = (time) => ({ title: '알림 시각 검사', done: false, due: '2026-11-04', source: 'app', time });
        let n = 0;
        for (const bad of ['9:30', '24:00', '09:60', '', '09:30:00', 930, null, ' 09:30']) {
            n += 1;
            await expectDeny(`할 일 time ${JSON.stringify(bad)}`, () => setDoc(todoDoc(n), body(bad)));
        }
        for (const ok of ['00:00', '09:30', '23:59']) {
            n += 1;
            await expectAllow(`할 일 time ${ok}`, () => setDoc(todoDoc(n), body(ok)));
        }
        await expectAllow('time 없는 할 일', () => setDoc(todoDoc('none'), { title: '시각 없는 할 일', done: false, source: 'app' }));
    }
} finally {
    await testEnv.cleanup();
}
failures.push(...await rulesMutantCheck());

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('에뮬레이터에서 건강·보건·연락처·주소 쓰기를 거절했고, 같은 계정의 빈 저장소에 14:00–16:00이 남았습니다.');
