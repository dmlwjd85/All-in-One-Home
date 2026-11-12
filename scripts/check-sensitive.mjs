/**
 * 민감 낱말·보호자 연락처·주소 차단을 확인합니다. 외부 패키지 없이 node 만으로 돕니다.
 *  1) 맞아야 할 글(미탐 사례)과 맞으면 안 되는 글(오탐 사례)
 *  2) 분해형 한글(NFD)·폭 없는 문자·전각 숫자, 태그
 *  3) 규칙(firestore.rules)의 safeText 본문이 앱과 글자 그대로 같은지, RE2 와 뜻이 다른 문법을 쓰지 않았는지,
 *     규칙 본문을 '전체 맞춤'으로 돌렸을 때 앱보다 넓게 거절하지 않는지(앱이 올린 글을 규칙이 거절하지 않는지)
 *  4) 클라우드로 보낼 모양(toCloudRow)과 받아 올 때(takeRemote) 민감 메모가 이 기기에 남는지
 */
import { readFileSync } from 'node:fs';
import { CONTACT_PATTERNS, isSensitiveText, rulesSafeTextBody, sensitiveCheckCopy } from '../src/lib/sensitive.js';
import { toCloudRow } from '../src/lib/cloudShape.js';
import { takeRemote } from '../src/lib/db.js';

const failures = [];
function check(ok, message) {
    if (!ok) failures.push(message);
}

/* 1) 미탐 사례: 아래는 모두 민감으로 봐야 합니다. */
const MUST_HIT = [
    '어머니 010-1234-5678',
    '01012345678로 연락 주세요',
    '아버지 010.1234.5678',
    '010 1234 5678',
    '011-123-4567',
    '집 전화 02-123-4567',
    '031-1234-5678 (할머니 댁)',
    '070-1234-5678',
    '101동 1203호',
    '101동1203호로 이사',
    '101 동 1203 호',
    '101-1203호',
    '푸른아파트 103동',
    '중앙로12번길 34',
    '백범로 31길 21',
    '산골마을 123-4번지',
    '45번지',
    '알레르기 없는 간식',
    '보건실 메모',
    '분리 급식',
    '분리급식',
];
/* 오탐 사례: 숫자가 많아도 연락처·주소가 아닌 글은 올라가야 합니다. */
const MUST_PASS = [
    '2026-10-19 3교시 수학',
    '3동 견학',
    '체육관 3동 앞에 모여요',
    '수학 85점, 국어 90점',
    '1교시 09:00-09:40',
    '2학년 3반 12번',
    '10월 19일 1012명 참가',
    '저장 시각 1767225600000',
    '앞으로 3번 더 연습',
    '20261019',
    '010',
    '버스 2호차 탑승',
    '3-1반 발표',
    '2026.10.19',
    '10-19 체험학습',
    '번호 12 34 56',
    '발표를 끝까지 했어요',
    '학년회의 14:00 체험학습 안내',
    '교과서 120-135쪽',
];
for (const text of MUST_HIT) check(isSensitiveText(text), `민감으로 봐야 하는데 놓쳤습니다: ${text}`);
for (const text of MUST_PASS) check(!isSensitiveText(text), `평범한 글을 민감으로 봤습니다: ${text}`);

/* 2) 비켜 가기: 분해형 한글, 폭 없는 문자, 전각 숫자 */
check(isSensitiveText('건강 상담'.normalize('NFD')), '분해형 한글(NFD) 건강을 놓쳤습니다.');
check(isSensitiveText('학​폭'), '폭 없는 빈칸(U+200B)이 낀 학폭을 놓쳤습니다.');
check(isSensitiveText('민‌원') && isSensitiveText('민‍원') && isSensitiveText('민﻿원'), '폭 없는 문자(U+200C·U+200D·U+FEFF)가 낀 민원을 놓쳤습니다.');
check(isSensitiveText('010​-1234-5678'), '폭 없는 문자가 낀 휴대폰 번호를 놓쳤습니다.');
check(isSensitiveText('０１０－１２３４－５６７８'), '전각 숫자 휴대폰 번호를 놓쳤습니다.');
check(sensitiveCheckCopy('건강'.normalize('NFD')) === '건강', '검사용 사본이 합친 꼴(NFC)이 아닙니다.');

/* 태그: 목록 낱말과 똑같지 않아도 본문과 같은 정규식으로 봅니다. */
check(isSensitiveText('', ['건강검진']), '건강검진 태그를 놓쳤습니다.');
check(isSensitiveText('', ['#보건실']), '#보건실 태그를 놓쳤습니다.');
check(isSensitiveText('줄넘기', ['체육', '민원전화']), '민원전화 태그를 놓쳤습니다.');
check(isSensitiveText('', ['건강'.normalize('NFD')]), '분해형 한글 태그를 놓쳤습니다.');
check(!isSensitiveText('줄넘기 연습', ['체육', '칭찬', '#학습']), '평범한 태그를 민감으로 봤습니다.');
check(!isSensitiveText('글', null) && !isSensitiveText('글', '건강'), '태그가 리스트가 아닐 때 깨지거나 엉뚱하게 봅니다.');

/* 3) 규칙 본문 */
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const body = rulesSafeTextBody();
const safeMatch = rules.match(/function safeText\(v\) \{ return !v\.matches\('([^']*)'\); \}/);
check(safeMatch && safeMatch[1] === body, '규칙의 safeText 본문이 src/lib/sensitive.js rulesSafeTextBody() 와 다릅니다.');
/* RE2 와 자바스크립트가 다르게 읽을 문법(역슬래시, 앞뒤 살피기, 이름 붙은 묶음, 되돌아 가리키기)을 쓰지 않습니다. 규칙 문자열 안 역슬래시도 피합니다. */
for (const pattern of CONTACT_PATTERNS) {
    check(!/[\\']|\(\?[=!<]|\(\?P?</.test(pattern), `연락처·주소 꼴에 RE2와 뜻이 다를 수 있는 문법이 있습니다: ${pattern}`);
}
check(body.startsWith('(?s).*(') && body.endsWith(').*'), '규칙 본문 꼴이 (?s).*( … ).* 가 아닙니다.');
/* RE2 matches() 는 글 전체를 맞춥니다. 자바스크립트에서는 s 플래그와 ^…$ 로 흉내 냅니다. */
const ruleRe = new RegExp(`^${body.slice('(?s)'.length)}$`, 's');
for (const text of MUST_HIT) check(ruleRe.test(text), `규칙이 민감한 글을 거절하지 않습니다: ${text}`);
for (const text of [...MUST_PASS, '첫 줄\n두째 줄 3교시']) check(!ruleRe.test(text), `규칙이 평범한 글을 거절합니다: ${text}`);
check(ruleRe.test('메모\n어머니 010-1234-5678\n끝'), '규칙이 여러 줄 글 가운데 번호를 놓칩니다.');
check(ruleRe.test('010-1234-5678'), '규칙이 번호만 있는 글을 놓칩니다.');
/* 규칙이 거절하는 글은 앱도 반드시 민감으로 봐야 합니다(앱이 올렸다가 거절되지 않게). 원문·사본 둘 다 봅니다. */
const tricky = ['010-1234-5678​9', '건강'.normalize('NFD'), '０１０-1234-5678', '101동​1203호', 'ⓐ 1동 2호'];
for (const text of [...MUST_HIT, ...MUST_PASS, ...tricky]) {
    if (ruleRe.test(text)) check(isSensitiveText(text), `규칙은 거절하는데 앱은 올리려 합니다: ${JSON.stringify(text)}`);
}
/* 태그 규칙: tagsOk(리스트·글자 확인) 뒤에 join 합니다. 기록·회의록 두 곳 모두 씁니다. */
check(/function tagsSafe\(t\) \{ return tagsOk\(t\) && safeText\(t\.join\(' '\)\); \}/.test(rules), '규칙 tagsSafe 가 tagsOk 다음에 safeText(t.join(\' \')) 를 보지 않습니다.');
check((rules.match(/\(!\('tags' in d\(\)\) \|\| tagsSafe\(d\(\)\.tags\)\)/g) || []).length === 2, '기록·회의록 태그 규칙이 tagsSafe 를 쓰지 않습니다.');
check(!/\|\| tagsOk\(d\(\)\.tags\)\)/.test(rules), '태그를 tagsOk 로만 보는 규칙이 남아 있습니다.');
check(ruleRe.test(['체육', '건강검진'].join(' ')) && !ruleRe.test(['체육', '칭찬'].join(' ')), '태그를 이어 붙인 글을 규칙이 다르게 봅니다.');

/* 4) 클라우드 모양 */
const att = (note) => toCloudRow('attendance', { date: '2026-10-19', sid: 's3', status: '결석', reason: '기타', note, paper: false, source: 'app' });
const secret = att('보호자 010-1234-5678 연락 옴');
check(secret && secret.body.status === 'absent' && secret.body.reason === 'other', '민감 메모가 든 출결의 상태·사유를 올리지 않습니다.');
check(secret && !('note' in secret.body) && secret.clear.includes('note'), '민감 메모가 든 출결이 메모를 올리거나, 클라우드의 옛 메모를 지우지 않습니다.');
const health = att('건강 검진 결과 상담');
check(health && !('note' in health.body) && health.clear.includes('note'), '건강 메모가 든 출결이 메모를 올립니다.');
const plain = att('늦잠');
check(plain && plain.body.note === '늦잠' && !plain.clear.includes('note'), '평범한 출결 메모를 올리지 않습니다.');
/* 100자로 자르면 번호 끝이 글 끝이 되어 규칙에 걸리는 경우: 자른 글도 봅니다. */
const edge = att(`${'가'.repeat(87)}010-1234-56789`);
check(edge && !('note' in edge.body), '잘라 올릴 메모가 규칙에 걸리는데 올리려 합니다.');
check(!toCloudRow('records', { id: 'r1', date: '2026-10-19', kind: '보호자', text: '어머니 010-1234-5678', source: 'app' }), '연락처가 든 기록을 올리려 합니다.');
check(!toCloudRow('records', { id: 'r2', date: '2026-10-19', kind: '관찰', text: '줄넘기', tags: ['건강검진'], source: 'app' }), '건강검진 태그 기록을 올리려 합니다.');
check(Boolean(toCloudRow('records', { id: 'r3', date: '2026-10-19', kind: '관찰', text: '3교시 85점, 3동 견학', tags: ['체육'], source: 'app' })), '평범한 기록을 올리지 않습니다.');
check(!toCloudRow('notes', { id: 'n1', text: '협의', tags: ['회의', '민원전화'], source: 'app' }), '민원전화 태그 회의록을 올리려 합니다.');
const student = toCloudRow('students', { id: 's6', no: 6, name: '정다은', memo: '101동 1203호', source: 'app' });
check(student && !('memo' in student.body) && student.clear.includes('memo') && student.body.name === '정다은', '주소가 든 학생 메모를 올리거나 지우지 않습니다.');
check(!toCloudRow('inbox', { id: 'msgabc123', kind: '할 일', title: '동의서', warning: '건강 관련', source: 'msg' }), '정리함 안내(warning)의 민감 낱말을 놓칩니다.');
const table = toCloudRow('timetable', { id: 'mon', p3: '보건', p4: '국어' });
check(table && table.body.p3 === '보건', '1~8교시 보건 수업을 시간표에서 뺐습니다.');

/* 받아 오기: 클라우드에는 메모가 비어 있어도 이 기기의 민감 메모는 남습니다. 평범한 메모는 클라우드 값을 받습니다. */
const mine = { id: '2026-10-19_s3', date: '2026-10-19', sid: 's3', status: '결석', reason: '기타', note: '어머니 010-1234-5678', paper: false, source: 'app' };
const theirs = { id: '2026-10-19_s3', date: '2026-10-19', sid: 's3', status: '지각', reason: '기타', period: '', paper: false, note: '', source: 'app' };
const taken = takeRemote('attendance', mine, theirs);
check(taken.note === mine.note && taken.status === '지각', `받아 올 때 민감 출결 메모가 지워졌거나 상태를 못 받았습니다: ${JSON.stringify(taken)}`);
check(takeRemote('attendance', { ...mine, note: '늦잠' }, theirs).note === '', '평범한 출결 메모를 다른 기기에서 비운 값을 받지 않습니다.');
check(takeRemote('attendance', mine, { ...theirs, note: '다른 기기 메모' }).note === '다른 기기 메모', '다른 기기가 새로 적은 출결 메모를 받지 않습니다.');
check(takeRemote('students', { id: 's6', no: 6, name: '정다은', memo: '보건실 자주 감' }, { id: 's6', no: 6, name: '정다은', memo: '' }).memo === '보건실 자주 감', '받아 올 때 민감 학생 메모가 지워졌습니다.');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log(`민감 검사를 통과했습니다. 미탐 사례 ${MUST_HIT.length}개, 오탐 사례 ${MUST_PASS.length}개.`);
