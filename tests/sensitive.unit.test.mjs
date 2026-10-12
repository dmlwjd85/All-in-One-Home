import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LIST_COLLECTIONS, DEVICE_ONLY_LISTS } from '../src/lib/collections.js';
import { isLocalOnlyPage, isSensitiveNote, isSensitiveText } from '../src/lib/sensitive.js';

const REQUIRED = [
    'teacherTodos',
    'teacherAttend',
    'classRoster',
    'ssugeokInbox',
    'studentNotes',
    'counselNotes',
    'teacherPlans',
    'ledgerTx',
    'ledgerBudgets',
    'teacherLessons',
    'teacherMeets',
    'teacherContacts',
    'teacherTimetable',
    'familyDiary',
    'ddayCards',
    'submissionSheets',
];

test('계정으로 옮기는 컬렉션이 빠지지 않습니다', () => {
    for (const name of REQUIRED) assert.ok(LIST_COLLECTIONS.includes(name), name);
    assert.equal(DEVICE_ONLY_LISTS.has('counselNotes'), true);
    assert.equal(DEVICE_ONLY_LISTS.has('teacherTodos'), false);
});

test('상담·건강·민원·학폭 문장과 태그를 가려냅니다', () => {
    assert.equal(isSensitiveText('#상담 오늘'), true);
    assert.equal(isSensitiveText('보호자 면담'), true);
    assert.equal(isSensitiveText('학부모 전화'), true);
    assert.equal(isSensitiveText('알레르기 간식'), true);
    assert.equal(isSensitiveText('민원 접수'), true);
    assert.equal(isSensitiveText('학교폭력 신고'), true);
    assert.equal(isSensitiveText('공문 제출'), false);
    assert.equal(isSensitiveText('메모', ['상담']), true);
    assert.equal(isSensitiveText('메모', ['학부모']), true);
    assert.equal(isSensitiveText('메모', ['수업']), false);
});

test('상담 쪽과 상담 목적지는 기기 전용입니다', () => {
    assert.equal(isSensitiveNote({ text: '기록', suggestion: { destId: 'counsel', page: 257 } }), true);
    assert.equal(isSensitiveNote({ text: '기록', placement: { destId: 'parent', page: 300 } }), true);
    assert.equal(isSensitiveNote({ text: '기록', placement: { destId: 'todo', page: 411 } }), false);
    assert.equal(isLocalOnlyPage(18), false);
    assert.equal(isLocalOnlyPage(19), true);
    assert.equal(isLocalOnlyPage(22), true);
    assert.equal(isLocalOnlyPage(23), false);
    assert.equal(isLocalOnlyPage(157), true);
    assert.equal(isLocalOnlyPage(158), true);
    assert.equal(isLocalOnlyPage(255), false);
    assert.equal(isLocalOnlyPage(256), true);
    assert.equal(isLocalOnlyPage(257), true);
    assert.equal(isLocalOnlyPage(334), true);
    assert.equal(isLocalOnlyPage(335), false);
});
