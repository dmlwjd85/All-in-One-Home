/** 평점관 r4 P2-1·P2-2 변이 검사: 고친 곳을 하나씩 되돌린 사본에서 check-nice-datechip이 실패해야 합니다. */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUTANTS = [
    ['C1 날짜 칩을 빼도 고른 날 대신 빈 날짜', 'src/lib/dateChips.js', "date: chipRead.date || (dateOff ? fallbackDate : ''),", "date: chipRead.date || '',"],
    ['C2 칩 저장값 제목을 글에서 다시 읽음', 'src/lib/dateChips.js', "title: offAny ? chipRead.title : '',", "title: offAny ? chipRead.raw.replace(/내일\\s*/, '') : '',"],
    ['C3 QuickBar가 paste.date로 돌아감', 'src/ui/QuickBar.jsx', 'const saved = ahead ? chipSave(chip, chipOff, dateYmd, ampmFlip) : null;', 'const saved = null;'],
    ['C5 QuickSheet 할 일 제목·날짜 칩 무시', 'src/ui/QuickSheet.jsx', "...(kind === '할 일' && chipped ? {", "...(kind === '할 일' && false ? {"],
    ['C6 할 일 화면이 글 날짜로', 'src/ui/Tasks.jsx', 'const saved = chipSave(chip, chipOff, clock.ymd, ampmFlip);', 'const saved = null;'],
    ['C7 FlowSheet가 글 날짜로', 'src/ui/FlowSheet.jsx', 'chipSave(chipRead, chipOff, date || clock.ymd, ampmFlip)', 'chipSave(chipRead, [], date || clock.ymd, ampmFlip)'],
    ['C8 메시지 칩이 제목·날짜 덮어씀', 'src/lib/dateChips.js', "        const next = { ...item, time: flips.get(item.time) };", "        const next = { ...item, time: flips.get(item.time), title: chipRead.title, date: chipRead.date || item.date };"],
    ['C9 메시지 기간 항목에도 칩', 'src/lib/dateChips.js', "if (!item || item.end || !item.time || !flips.has(item.time)) return item;", "if (!item || !item.time || !flips.has(item.time)) return item;"],
    ['C10 + 화면 기간 항목에도 칩', 'src/lib/dateChips.js', '        if (!item || item.end) return item;\n', ''],
    ['C11 MsgSheet가 다시 칩 빼기 적용', 'src/ui/MsgSheet.jsx', 'applyChipAmpm(parsed.items, chip, ampmFlip)', 'applyLiveChips(parsed.items, chip, { off: chipOff, ampmFlip })'],
    ['C12 MsgSheet 칩이 빼기 단추', 'src/ui/MsgSheet.jsx', '                            ampmOnly\n', ''],
    ['Q1 칩을 안 건드려도 칩 값 저장', 'src/lib/dateChips.js', 'if (!offAny && !flipAny) return null;', 'if (!offAny && !flipAny && !chipRead.changed) return null;'],
    ['Q2 오전↔오후만 고쳐도 제목을 칩으로', 'src/lib/dateChips.js', "title: offAny ? chipRead.title : '',", 'title: chipRead.title,'],
];

let survived = 0;
for (const [name, rel, from, to] of MUTANTS) {
    const dir = mkdtempSync(join(tmpdir(), 'aio-r4-chip-'));
    try {
        cpSync(resolve(root, 'src'), join(dir, 'src'), { recursive: true });
        mkdirSync(join(dir, 'scripts'));
        mkdirSync(join(dir, 'public'));
        cpSync(resolve(root, 'scripts/check-nice-datechip.mjs'), join(dir, 'scripts/check-nice-datechip.mjs'));
        cpSync(resolve(root, 'public/sw.js'), join(dir, 'public/sw.js'));
        const file = join(dir, rel);
        const text = readFileSync(file, 'utf8');
        if (!text.includes(from)) { console.error(`✗ ${name}: 바꿀 곳을 못 찾음`); survived += 1; continue; }
        writeFileSync(file, text.replace(from, to));
        const run = spawnSync(process.execPath, [join(dir, 'scripts/check-nice-datechip.mjs')], { cwd: dir, encoding: 'utf8' });
        if (run.status === 0) { console.error(`✗ ${name}: 살아남음`); survived += 1; } else console.log(`✓ ${name}: 잡힘`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
if (survived) { console.error(`r4 칩 변이 ${survived}/${MUTANTS.length}개가 살아남았습니다.`); process.exit(1); }
console.log(`r4 칩 변이 ${MUTANTS.length}/${MUTANTS.length}개를 모두 잡았습니다.`);
