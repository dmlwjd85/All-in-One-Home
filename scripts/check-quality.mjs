import { readFileSync } from 'node:fs';
import { BACKUP_LISTS, BACKUP_RECORD, validateBackup } from '../src/lib/backup.js';
import { fitCanvas, PAGE_H } from '../src/notebook/layout.js';
import { monthPage } from '../src/notebook/nav.js';
import { isLocalOnlyPage } from '../src/notebook/localPages.js';
import { SECTION_RANGES, sectionForPage } from '../src/notebook/sections.js';
import { sumBudget } from '../src/notebook/budget.js';

const errors = [];
const ok = (cond, msg) => { if (!cond) errors.push(msg); };

ok(PAGE_H === 820, '용지 높이');
ok(monthPage(3, 2026) === 34, '3월');
ok(monthPage(1, 2027) === 44, '1월');
ok(monthPage(2, 2027) === 45, '2월');
ok(monthPage(0) === null, '0월은 이동하지 않음');
ok(monthPage(13) === null, '13월은 이동하지 않음');
ok(monthPage(1.5) === null, '소수 달은 이동하지 않음');
ok(monthPage('3월') === null, '글자 달은 이동하지 않음');

for (const [w, h] of [[1920, 1080], [1366, 768], [1180, 820], [1024, 768]]) {
    const box = fitCanvas(w - 16, h - 64);
    const ratio = box.width / box.height;
    ok(box.width <= w && box.height <= h - 48, `${w}x${h}가 화면을 넘음 ${box.width}x${box.height}`);
    ok(Math.abs(ratio - 16 / 9) < 0.02, `${w}x${h} 비율 ${ratio}`);
}
ok(fitCanvas(0, 100).width === 0, '빈 화면');

const localOnly = [];
for (let page = 1; page <= 580; page += 1) if (isLocalOnlyPage(page)) localOnly.push(page);
ok(JSON.stringify(localOnly) === JSON.stringify([19, 20, 21, 22, 157, 158, 323, 324, 325, 326, 327, 328, 329, 330, 331, 332, 333, 334]), `로컬 전용 쪽 ${localOnly}`);

let cursor = 1;
for (const [name, from, to] of SECTION_RANGES) {
    ok(from === cursor, `${name} 시작 ${from}`);
    ok(sectionForPage(from) === name && sectionForPage(to) === name, name);
    cursor = to + 1;
}
ok(cursor === 581, `마지막 쪽 ${cursor - 1}`);

const sum = sumBudget((page) => ({ budget: page === 470 ? '1,000원' : '0', used: page === 470 ? '250' : '' }));
ok(sum.budget === 1000 && sum.used === 250 && sum.left === 750 && sum.rows.length === 14, `예산 합계 ${sum.budget}/${sum.used}`);

const good = validateBackup(JSON.stringify({
    exportedAt: '2026-03-01T00:00:00.000Z',
    inbox: [{ id: 'a', text: '안녕' }],
    praiseBoard: { goal: 3 },
    notebookFields: { 154: { name1: '김가람' } },
    ssugeokSensitive: [],
}));
ok(good.ok && good.counts.inbox === 1 && good.counts.notebookFields === 1, `정상 백업 ${good.errors}`);
ok(!validateBackup('[]').ok, '배열 거부');
ok(!validateBackup('{').ok, '깨진 JSON');
ok(!validateBackup(JSON.stringify({ inbox: { bad: true } })).ok, '목록 형식');
ok(!validateBackup(JSON.stringify({ notebookFields: { 999: {} } })).ok, '쪽 범위');
ok(!validateBackup('x'.repeat(8 * 1024 * 1024 + 1)).ok, '용량');

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const lists = [...app.matchAll(/useSharedList\(\s*'([^']+)'/g)].map((m) => m[1]).sort();
const records = [...app.matchAll(/useSharedRecord\(\s*'([^']+)'/g)].map((m) => m[1]);
ok(JSON.stringify(lists) === JSON.stringify(Object.values(BACKUP_LISTS).sort()), '백업 목록 이름이 화면 컬렉션과 같음');
ok(records.length === 1 && records[0] === BACKUP_RECORD, '칭찬 보드 이름');

if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('quality 검사 통과');
