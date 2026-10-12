import assert from 'node:assert/strict';
import { test } from 'node:test';
import { backupKeysCoverCloudLists, deviceOnlyBackupKeys, parseBackup, splitInbox } from '../src/lib/backupFormat.js';
import { LIST_COLLECTIONS } from '../src/lib/collections.js';

test('백업 키가 계정 컬렉션을 빠짐없이 덮습니다', () => {
    assert.equal(backupKeysCoverCloudLists(), true);
    assert.equal(deviceOnlyBackupKeys().includes('counselNotes'), true);
    for (const name of ['teacherTodos', 'counselNotes', 'notebookFields']) {
        assert.ok(name === 'notebookFields' || LIST_COLLECTIONS.includes(name));
    }
});

test('상담이 섞인 받은함은 기기 전용으로 갈라집니다', () => {
    const parts = splitInbox([
        { id: 'a', text: '공문 제출' },
        { id: 'b', text: '#상담 오늘 면담' },
        { id: 'c', text: '기록', placement: { destId: 'parent', page: 289 } },
    ]);
    assert.deepEqual(parts.cloud.map((row) => row.id), ['a']);
    assert.deepEqual(parts.device.map((row) => row.id), ['b', 'c']);
});

test('잘못된 JSON 은 거절합니다', () => {
    assert.equal(parseBackup('[').ok, false);
    assert.equal(parseBackup('[]').ok, false);
    assert.equal(parseBackup('{"inbox":{}}').ok, false);
    assert.equal(parseBackup('{"notebookFields":{"0":{}}}').ok, false);
    assert.equal(parseBackup('{"exportedAt":"2026-01-01"}').ok, false);
});

test('올바른 백업은 건수를 미리 보여 줍니다', () => {
    const parsed = parseBackup(JSON.stringify({
        exportedAt: '2026-10-12T00:00:00.000Z',
        todos: [{ id: 't1', text: '인쇄' }],
        inbox: [{ id: 'i1', text: '회의' }, { id: 'i2', text: '상담 기록' }],
        counselNotes: [{ id: 'c1', student: '1번', text: '면담' }],
        ssugeokSensitive: [{ id: 's1', text: '알레르기' }],
        notebookFields: { 157: { h1: '땅콩' }, 10: { note: '관찰' } },
        praiseBoard: { goal: 10 },
    }));
    assert.equal(parsed.ok, true);
    const byKey = Object.fromEntries(parsed.preview.map((row) => [row.key, row]));
    assert.equal(byKey.todos.count, 1);
    assert.equal(byKey.inbox.count, 1);
    assert.equal(byKey.counselNotes.count, 1);
    assert.equal(byKey.counselNotes.deviceOnly, true);
    assert.equal(byKey.ssugeokSensitive.deviceOnly, true);
    assert.equal(byKey.ssugeokSensitive.count, 2);
    assert.equal(byKey.notebookFields.count, 2);
    assert.equal(byKey.praiseBoard.count, 1);
});
