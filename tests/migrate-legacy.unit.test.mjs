import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseMigrateArgs } from '../scripts/migrate-legacy-lib.mjs';

test('이전 스크립트는 uid 와 dry-run 을 받습니다', () => {
    const args = parseMigrateArgs(['--uid', 'teacher-1', '--dry-run', '--app-id', 'home-note-app']);
    assert.equal(args.uid, 'teacher-1');
    assert.equal(args.dryRun, true);
    assert.equal(args.appId, 'home-note-app');
    assert.equal(parseMigrateArgs(['--uid=abc', '--project=sambong-world-2026']).project, 'sambong-world-2026');
    assert.equal(parseMigrateArgs([]).uid, '');
});
