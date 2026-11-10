/** PR E 변이 검사: 핵심 규칙을 하나씩 망가뜨린 사본에서 check-input-e가 실패해야 합니다. */
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MUTANTS = [
    ['E1 마감 10분 전 → 0분', 'src/lib/timePhrase.js', 'export const BEFORE_LEAD_MIN = 10;', 'export const BEFORE_LEAD_MIN = 0;'],
    ['E2 조퇴 무시', 'src/lib/timePhrase.js', "if (today && isHm(ctx.leave))", 'if (false)'],
    ['E3 조퇴를 다른 날에도 씀', 'src/lib/timePhrase.js', "if (today && isHm(ctx.leave))", 'if (isHm(ctx.leave))'],
    ['E4 퇴근 미설정에 추천값을 몰래 씀', 'src/lib/timePhrase.js', "return { boundary: '', basis: '', missing: 'workEnd', suggest: SUGGEST_WORK.workEnd };", "return { boundary: SUGGEST_WORK.workEnd, basis: '추천' };"],
    ['E5 지난 시각 확인 없음', 'src/lib/timePhrase.js', 'const late = Boolean(', 'const late = false && Boolean('],
    ['E6 내일 아침 날짜 안 옮김', 'src/lib/timePhrase.js', "{ kind: 'morning', edge: 'at', dayShift: 1,", "{ kind: 'morning', edge: 'at', dayShift: 0,"],
    ['E7 점심 기준 교시 바뀜', 'src/lib/timePhrase.js', 'const LUNCH_AFTER_PERIOD = 4;', 'const LUNCH_AFTER_PERIOD = 3;'],
    ['E8 수업 끝을 시작으로', 'src/lib/timePhrase.js', 'const at = last ? periodEnd(ctx, last) :', 'const at = last ? ctx.starts?.[last - 1] :'],
    ['E9 교시 범위 규칙 제거', 'src/lib/timePhrase.js', "{ kind: 'period', edge: 'at', re: /(?<!\\d)(10|[1-9])\\s*[~～\\-–—]", "{ kind: 'period', edge: 'at', re: /(?!)(10|[1-9])\\s*[~～\\-–—]"],
    ['E10 취소가 변경보다 뒤', 'src/lib/timePhrase.js', "    ['cancel',", "    ['zcancel',"],
    ['E11 마지막 마디 대신 전체', 'src/lib/timePhrase.js', 'const src = lastClause(text);', 'const src = String(text || "");'],
    ['E12 메시지 카드 시각 덮어씀', 'src/lib/timePhrase.js', "if (!item || item.time || !(item.kind", "if (!item || !(item.kind"],
    ['E13 메시지 노란 카드 안 만듦', 'src/lib/timePhrase.js', '                low: true,\n                include: false,', '                low: false,\n                include: true,'],
    ['E14 어간 겹침 규칙 제거', 'src/lib/timePhrase.js', 'if (kept.some((k) => hit.index < k.end && k.index < hit.end)) continue;', ''],
    ['E15 완료 어미를 메모로 안 봄', 'src/ui/quickMatch.js', "if (ending === 'done') return '메모';", ''],
    ['E16 취소 어미도 추천', 'src/ui/quickMatch.js', "if (ending === 'cancel' || ending === 'negate') return '';", ''],
    ['E17 새 설치 기본 키 없음', 'src/ui/hotkeys.js', "{ id: 'today', label: '오늘', group: '이동', fallback: 't' },", "{ id: 'today', label: '오늘', group: '이동', fallback: '' },"],
    ['E18 쓰던 기기도 새 기본', 'src/ui/hotkeys.js', "const seed = started || saved ? 'legacy' : 'fresh';", "const seed = 'fresh';"],
    ['E19 판1 저장값에 새 기본 섞음', 'src/ui/hotkeys.js', 'const base = defaultHotkeys({ legacy: saved._v !== STORE_VERSION });', 'const base = defaultHotkeys();'],
    ['E20 초기화가 예전 기본으로', 'src/ui/hotkeys.js', "    writeSeed('fresh', storage);\n    notifyHotkeys();\n    return defaultHotkeys();", '    notifyHotkeys();\n    return defaultHotkeys();'],
    ['E21 표시를 매번 다시 정함', 'src/ui/hotkeys.js', "if (readSeed(storage)) return '';", ''],
    ['E22 모달 감지 없음', 'src/ui/hotkeys.js', "return Boolean(doc?.querySelector?.('[aria-modal=\"true\"], .sheet-back'));", 'return false;'],
    ['E23 추천값이 기존 값 덮어씀', 'src/lib/schoolDefaults.js', 'if (!needsWorkSuggestion(local)) return null;', ''],
    ['E24 추천 조건 느슨', 'src/lib/schoolDefaults.js', 'return !isHm(local?.workStart) && !isHm(local?.workEnd);', 'return !isHm(local?.workStart) || !isHm(local?.workEnd);'],
    ['E25 예시가 있는 칸 덮어씀', 'src/lib/schoolDefaults.js', "if (String(timetable?.[day]?.[key] || '').trim()) continue;", ''],
    ['E26 / 키가 발라 두기 시트', 'src/App.jsx', '            pressJamButton();\n            return;', '            setPlus(true);\n            return;'],
    ['E33 콜론 시각 못 읽음', 'src/lib/jjaemPaste.js', '(\\\\d{1,2}):([0-5]\\\\d)(?![\\\\d:])`, \'g\'))) {\n        const hour', '(\\\\d{1,2})::([0-5]\\\\d)(?![\\\\d:])`, \'g\'))) {\n        const hour'],
    ['E34 모레 아침 출근 시각 없음', 'src/lib/timePhrase.js', "dayShift: 2, re: /모레", "dayShift: 2, re: /모모레"],
    ['E35 자정까지가 0시', 'src/lib/jjaemPaste.js', 'push(m.index, m[0], 23, 59);', 'push(m.index, m[0], 0, 0);'],
    ['E36 한글 시 못 읽음', 'src/lib/jjaemPaste.js', '[KO_HOUR_RE, ', '[\'없음\', '],
    ['E31 / 키 키캡 눌림 없음', 'src/App.jsx', '        pressDown(btn);\n', ''],
    ['E32 / 키 딸깍 소리 없음', 'src/App.jsx', "        if (!feel) playKey('down');\n", ''],
    ['E27 모달 중에도 단축키', 'src/App.jsx', 'modalOpen() || quickOpenRef.current', 'false'],
    ['E28 마감됨이 눌린 모양 아님', 'src/index.css', '    color: var(--accent);\n    box-shadow: var(--neo-inset-deep);\n    transform: translateY(1px);', '    color: var(--accent);\n    box-shadow: var(--neo-raise-sm);\n    transform: translateY(1px);'],
    ['E29 aria-pressed 고정', 'src/ui/Attend.jsx', "aria-pressed={closed ? 'true' : 'false'}", "aria-pressed=\"false\""],
    ['E30 시계 시각보다 시간구 우선', 'src/ui/QuickBar.jsx', 'if (pre.time) return null;', ''],
];

let survived = 0;
for (const [name, rel, from, to] of MUTANTS) {
    const dir = mkdtempSync(join(tmpdir(), 'aio-e-mut-'));
    try {
        cpSync(resolve(root, 'src'), join(dir, 'src'), { recursive: true });
        const file = join(dir, rel);
        const text = readFileSync(file, 'utf8');
        if (!text.includes(from)) { console.error(`✗ ${name}: 바꿀 곳을 못 찾음`); survived += 1; continue; }
        writeFileSync(file, text.replace(from, to));
        const run = spawnSync(process.execPath, [resolve(root, 'scripts/check-input-e.mjs')], { env: { ...process.env, E_ROOT: dir }, encoding: 'utf8' });
        if (run.status === 0) { console.error(`✗ ${name}: 살아남음`); survived += 1; } else console.log(`✓ ${name}: 잡힘`);
    } finally {
        rmSync(dir, { recursive: true, force: true });
    }
}
if (survived) { console.error(`PR E 변이 ${survived}/${MUTANTS.length}개가 살아남았습니다.`); process.exit(1); }
console.log(`PR E 변이 ${MUTANTS.length}/${MUTANTS.length}개를 모두 잡았습니다.`);
