/** 학교 메시지 예문을 읽고 유형·날짜·시각·제목 정확도를 확인합니다. */
import { gradeMessages, parseSchoolMessages } from '../src/lib/msgParse.js';
import { MSG_NOW, MSG_SAMPLES } from '../src/lib/msgSamples.js';
import { toCloudRow } from '../src/lib/cloudShape.js';
import { clearAll, saveParsed, snapshot } from '../src/lib/db.js';

const grade = gradeMessages(MSG_SAMPLES, MSG_NOW);
const lines = [
    `예문 ${MSG_SAMPLES.length}개, 항목 ${grade.total}개`,
    `유형 ${grade.kind}%`,
    `날짜 ${grade.date}%`,
    `시각 ${grade.time}%`,
    `제목 ${grade.title}%`,
];
console.log(lines.join('\n'));
if (MSG_SAMPLES.length < 50) {
    console.error('예문이 50개보다 적습니다.');
    process.exit(1);
}
if (grade.misses.length || grade.kind < 100 || grade.date < 100 || grade.time < 100 || grade.title < 100) {
    console.error(JSON.stringify(grade.misses.slice(0, 12), null, 2));
    process.exit(1);
}

const again = parseSchoolMessages(MSG_SAMPLES[20].text, { now: MSG_NOW });
const once = parseSchoolMessages(MSG_SAMPLES[20].text, { now: MSG_NOW });
if (once.items.map((item) => item.id).join() !== again.items.map((item) => item.id).join()) {
    console.error('같은 메시지를 두 번 읽으면 아이디가 달라집니다.');
    process.exit(1);
}

const shaped = toCloudRow('todos', { id: 'msgabcd1234', title: '동의서 제출', done: false, due: '2026-10-28', source: 'msg' });
if (shaped?.body?.source !== 'app') {
    console.error('메시지 출처가 클라우드 규칙 밖으로 나갑니다.');
    process.exit(1);
}

await clearAll();
const sample = parseSchoolMessages('내일까지 준비물 제출\n내일 3교시 공개수업\n건강 조사 내일까지 입력', { now: MSG_NOW });
const first = await saveParsed(sample.items, MSG_NOW);
if (!first.ok || first.count < 2) {
    console.error(`등록이 비었습니다: ${first.message}`);
    process.exit(1);
}
const state = snapshot();
const todo = [...state.todos, ...state.local.todos].find((row) => row.title.includes('준비물'));
const event = [...state.events, ...state.local.events].find((row) => row.title.includes('공개수업'));
const secret = [...state.local.todos, ...state.local.events].find((row) => String(row.title).includes('건강'));
if (!todo || todo.source !== 'msg' || todo.due !== '2026-10-22') {
    console.error('할 일이 기존 칸에 msg로 들어가지 않았습니다.');
    process.exit(1);
}
if (!event || event.source !== 'msg' || event.time !== '10:30') {
    console.error('일정이 기존 칸에 들어가지 않았습니다.');
    process.exit(1);
}
if (!secret || secret.source !== 'msg') {
    console.error('민감 메시지가 이 기기 칸으로 가지 않았습니다.');
    process.exit(1);
}
if (state.todos.some((row) => String(row.title).includes('건강')) || state.events.some((row) => String(row.title).includes('건강'))) {
    console.error('민감 메시지가 클라우드로 갈 칸에 있습니다.');
    process.exit(1);
}
const second = await saveParsed(sample.items, MSG_NOW);
if (second.ok) {
    console.error('같은 메시지를 다시 등록했습니다.');
    process.exit(1);
}
console.log('저장 경로와 중복 방지도 확인했습니다.');
