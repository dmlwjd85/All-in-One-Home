/** 붙여넣기 변이: 규칙을 하나씩 망가뜨리면 check-paste가 실패해야 합니다. */
import { cpSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUTANTS = [
    ['앞 칸 탭을 지움', 'src/lib/monthGrid.js', ".replace(/^\\n+/, '').replace(/\\s+$/, '')", ".replace(/^\\s+/, '').replace(/\\s+$/, '')"],
    ['첫 줄 앞달을 이번 달로', 'src/lib/monthGrid.js', 'if (firstWeek && drops.length)', 'if (false && drops.length)'],
    ['일요일 시작을 월요일로', 'src/lib/monthGrid.js', 'if (weekStart === 0) return col % 7;', 'if (false) return col % 7;'],
    ['웹 표를 못 읽음', 'src/lib/monthGrid.js', "if (!/<table\\b/i.test(src)) return '';", "return ''; if (!/<table\\b/i.test(src)) return '';"],
    ['평범한 메모도 급식표', 'src/lib/mealPaste.js', 'export function looksLikeMealTable(text) {\n    const src', 'export function looksLikeMealTable(text) {\n    return true; const src'],
    ['Teams 낱말만으로 초대', 'src/lib/teamsPaste.js', 'if (/Microsoft Teams\\s*모임/i.test(src) && SECRET.test(src)) return true;', 'if (/Microsoft Teams/i.test(src)) return true;'],
    ['암호 줄을 항상 지움', 'src/lib/teamsPaste.js', 'if (!isTeamsInvite(src)) return src;', ''],
    ['영어 날짜를 안 읽음', 'src/lib/teamsPaste.js', 'export function findEnglishDate(text) {\n    const match', 'export function findEnglishDate(text) {\n    return null; const match'],
    ['PM을 오전으로 둠', 'src/lib/jjaemPaste.js', 'if (m.index <= span.index && span.index + span.length <= m.index + m[0].length) spans.splice(i, 1);', 'continue;'],
    ['빼 둔 일정도 저장', 'src/lib/db.js', 'item && item.include !== false && String(item.title || \'\').trim()', 'item && String(item.title || \'\').trim()'],
    ['이상한 날짜도 저장', 'src/lib/db.js', 'if (!when.ok) { rejected += 1; continue; }', 'if (false) { rejected += 1; continue; }'],
];

let survived = 0;
for (const [name, rel, from, to] of MUTANTS) {
    const dir = mkdtempSync(join(tmpdir(), 'aio-paste-mut-'));
    try {
        cpSync(resolve(root, 'src'), join(dir, 'src'), { recursive: true });
        mkdirSync(join(dir, 'scripts'), { recursive: true });
        cpSync(resolve(root, 'scripts/check-paste.mjs'), join(dir, 'scripts/check-paste.mjs'));
        cpSync(resolve(root, 'scripts/fixtures'), join(dir, 'scripts/fixtures'), { recursive: true });
        const file = join(dir, rel);
        const text = readFileSync(file, 'utf8');
        if (!text.includes(from)) { console.error(`✗ ${name}: 바꿀 곳을 못 찾음`); survived += 1; continue; }
        writeFileSync(file, text.replace(from, to));
        const run = spawnSync(process.execPath, [join(dir, 'scripts/check-paste.mjs')], { encoding: 'utf8' });
        if (run.status === 0) { console.error(`✗ ${name}: 살아남음\n${run.stdout}`); survived += 1; }
        else console.log(`✓ ${name}: 잡힘`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
if (survived) { console.error(`붙여넣기 변이 ${survived}/${MUTANTS.length}개가 살아남았습니다.`); process.exit(1); }
console.log(`붙여넣기 변이 ${MUTANTS.length}/${MUTANTS.length}개를 모두 잡았습니다.`);
