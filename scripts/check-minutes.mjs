/* 회의록 → 일정·할 일 자동 등록, 2단 배치, 날짜 팝업 검사. 변이(일부러 망가뜨린 코드)도 잡는지 함께 봅니다. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const now = new Date('2026-11-04T05:00:00Z');
const BODY = `안건
- 체험학습 안전교육 논의
- 11/12(목) 3교시 공개수업
결정한 것
- 축제는 12월에
할 일
- 내일까지 가정통신문 제출
- 김선생님 보고서 작성
- 다음 주 금요일 학년 협의회 15:00`;

function memStore() {
    const m = new Map();
    return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), m };
}

/** 실패 목록을 돌려줍니다(빈 배열이면 통과). */
async function suite(mod, { minutes }) {
    const bad = [];
    const ok = (cond, msg) => { if (!cond) bad.push(msg); };
    const { minutesCandidates, freshCandidates, linkedId, minutesOf, minutesKey, readMinutesLinks, rememberMinutesLinks, forgetMinutesLinks } = mod;
    const r = minutesCandidates(BODY, 'meet-1761600000000', { now, title: '학년회의' });
    const autoTitles = r.auto.map((i) => i.title);
    ok(r.auto.length === 3, `바로 등록 수가 3이 아닙니다: ${JSON.stringify(autoTitles)}`);
    ok(autoTitles.includes('공개수업') && autoTitles.includes('가정통신문 제출') && autoTitles.includes('학년 협의회'), '날짜 있는 줄이 바로 등록 후보가 아닙니다.');
    const pub = r.auto.find((i) => i.title === '공개수업');
    ok(pub?.kind === '일정' && pub?.date === '2026-11-12' && pub?.period === 3, `공개수업 해석이 다릅니다: ${JSON.stringify(pub)}`);
    const home = r.auto.find((i) => i.title === '가정통신문 제출');
    ok(home?.kind === '할 일' && home?.date === '2026-11-05', '내일까지 제출이 할 일(11/5)이 아닙니다.');
    ok(r.ask.length === 1 && r.ask[0].title.includes('보고서') && r.ask[0].low && r.ask[0].kind === '할 일', `흐린 줄이 노란 확인 카드로 가지 않습니다: ${JSON.stringify(r.ask)}`);
    const all = [...r.auto, ...r.ask];
    ok(!all.some((i) => /안전교육|축제|안건/.test(i.title)), '날짜·할 일 신호 없는 논의 줄까지 등록하려 합니다.');
    ok(all.every((i) => /^mt-[A-Za-z0-9_]+-[a-z0-9]{7}$/.test(i.id) && i.id.length <= 40), `등록 id 모양이 규칙(40자, 영숫자)에 맞지 않습니다: ${all.map((i) => i.id)}`);
    ok(all.every((i) => i.memo === '회의록: 학년회의'), '등록 항목에 원래 회의록 표시가 없습니다.');
    const again = minutesCandidates(BODY, 'meet-1761600000000', { now, title: '학년회의' });
    ok(JSON.stringify(again.auto.map((i) => i.id)) === JSON.stringify(r.auto.map((i) => i.id)), '같은 회의록을 다시 저장하면 id 가 달라져 겹쳐 등록됩니다.');
    const other = minutesCandidates(BODY, 'meet-1761600000999', { now });
    ok(!other.auto.some((i) => r.auto.some((j) => j.id === i.id)), '다른 회의록의 같은 줄이 같은 id 라 등록이 막힙니다.');
    const fresh = freshCandidates(again, { registered: [r.auto[0].id], remembered: [r.ask[0].id] });
    ok(fresh.auto.length === 2 && fresh.ask.length === 0, '이미 등록·기억된 항목을 다시 넣으려 합니다.');
    const edited = minutesCandidates(`${BODY}\n- 11/20 학부모 상담 주간 안내 발송`, 'meet-1761600000000', { now });
    const plus = freshCandidates(edited, { registered: r.auto.map((i) => i.id), remembered: r.ask.map((i) => i.id) });
    ok(plus.auto.length + plus.ask.length === 1, `고쳐 저장하면 새 줄 하나만 더해져야 합니다: ${JSON.stringify(plus)}`);
    const rows = [{ id: 'meet-1761600000000', title: '학년회의' }, { id: 'note-x', title: 'x' }];
    ok(minutesOf(r.auto[0].id, rows)?.id === 'meet-1761600000000', '등록 항목에서 원래 회의록을 찾지 못합니다.');
    ok(minutesOf('todo-1', rows) === null && minutesOf('msgabc', rows) === null, '회의록과 상관없는 항목을 회의록에 잇습니다.');
    ok(minutesKey('meet-<x>') !== minutesKey('meet-<y>') && /^h/.test(minutesKey('weird id!')), '이상한 회의록 id 의 열쇠가 겹치거나 규칙에 맞지 않습니다.');
    ok(linkedId('meet-1', 'a  b') === linkedId('meet-1', 'a b'), '띄어쓰기만 다른 줄이 다른 id 가 됩니다.');
    ok(minutesCandidates('', 'meet-1', { now }).auto.length === 0, '빈 본문에서 후보가 나옵니다.');
    const many = Array.from({ length: 80 }, (_, n) => `11/${(n % 20) + 1} 행사 ${n}`).join('\n');
    const capped = minutesCandidates(many, 'meet-1', { now });
    ok(capped.auto.length + capped.ask.length <= 30, '한 번에 너무 많이 등록합니다(30개 제한).');
    const store = memStore();
    store.setItem('ssug-gyomu-minutes-draft', JSON.stringify({ new: { title: '쓰는 중' } }));
    rememberMinutesLinks('meet-1', ['mt-1-aaaaaaa'], store);
    rememberMinutesLinks('meet-1', ['mt-1-aaaaaaa', 'mt-1-bbbbbbb'], store);
    ok(readMinutesLinks('meet-1', store).length === 2, '기억한 등록 id 를 다시 읽지 못합니다.');
    ok(minutes.readMinutesDraft('new', store)?.title === '쓰는 중', '등록 기억이 쓰던 회의록 임시 저장을 지웁니다.');
    forgetMinutesLinks('meet-1', store);
    ok(readMinutesLinks('meet-1', store).length === 0 && minutes.readMinutesDraft('new', store), '회의록을 지워도 기억이 남거나 임시 저장까지 지워집니다.');
    store.setItem('ssug-gyomu-minutes-draft', '{깨짐');
    ok(readMinutesLinks('meet-1', store).length === 0, '깨진 저장에서 멈춥니다.');
    return bad;
}

function uiChecks(ui, css) {
    const bad = [];
    const ok = (cond, msg) => { if (!cond) bad.push(msg); };
    const area = ui.match(/<Area id="minutes-text"[\s\S]*?\/>\n/)?.[0] || '';
    ok(area && !/onKeyDown|onKeyUp|onKeyPress/.test(area), '본문 칸이 Enter 를 가로챕니다.');
    ok(!/<form/.test(ui) && !/<select/.test(ui) && !/type="date"/.test(ui), '회의록에 form·드롭다운·날짜 입력이 있습니다.');
    ok(/date: row\?\.date \|\| clock\.ymd/.test(ui), '새 회의록 날짜가 오늘이 아닙니다.');
    ok(/role="dialog"[^>]*aria-label="회의 날짜 고르기"/.test(ui) && /<DateGrid value=\{date\}[^\n]*setPicking\(false\)/.test(ui), '날짜를 바꿀 때 달력 팝업이 뜨지 않습니다.');
    const top = ui.indexOf('className="minutes-top"');
    ok(top > 0 && top < ui.indexOf('<Area id="minutes-text"') && ui.indexOf('<Area id="minutes-text"') < ui.indexOf('className="minutes-extra"'), '본문 칸이 위쪽(제목·날짜 바로 아래)에 있지 않습니다.');
    ok(/minutesCandidates\(/.test(ui) && /saveParsed\(found\.auto\)/.test(ui), '저장할 때 일정·할 일을 등록하지 않습니다.');
    ok(/CaptureCard/.test(ui) && /setAsking\(\{ id: next\.id, items: found\.ask \}\)/.test(ui), '흐린 줄을 노란 카드로 묻지 않습니다.');
    ok(/rememberMinutesLinks\(asking\.id, asking\.items\.map/.test(ui), '뺀 카드를 기억하지 않아 다시 저장하면 또 묻습니다.');
    ok(/className="minutes-split"/.test(ui) && /grid-template-columns: minmax\(0, 1fr\) minmax\(260px, 340px\)/.test(css), '넓은 화면 2단 배치가 없습니다.');
    ok(/\.minutes-date-btn \{ min-height: 44px/.test(css), '날짜 단추가 44px 보다 작습니다.');
    return bad;
}

const root = resolve('.');
const minutes = await import(pathToFileURL(join(root, 'src/lib/minutes.js')).href);
const base = await suite(await import(pathToFileURL(join(root, 'src/lib/minutesExtract.js')).href), { minutes });
const ui = readFileSync('src/ui/Minutes.jsx', 'utf8');
const css = readFileSync('src/index.css', 'utf8');
const failures = [...base, ...uiChecks(ui, css)];
const detail = readFileSync('src/ui/DetailSheet.jsx', 'utf8');
const tasks = readFileSync('src/ui/Tasks.jsx', 'utf8');
if (!/minutesOf\(row\.id/.test(detail) || !/data-role="detail-minutes"/.test(detail)) failures.push('일정·할 일 자세히에 원래 회의록 단추가 없습니다.');
if (!/minutesOf\(row\.id/.test(tasks)) failures.push('할 일 목록에 회의록 표시가 없습니다.');
const sw = readFileSync('public/sw.js', 'utf8');
if (!sw.includes("const CACHE = 'ssug-gyomu-shell-v59'")) failures.push('서비스 워커가 v59가 아닙니다.');

/* 변이: 일부러 망가뜨린 코드를 이 검사가 잡는지 봅니다. */
const LIB = readFileSync('src/lib/minutesExtract.js', 'utf8');
const mutants = [
    ['M1 날짜 없어도 바로 등록', 'low: Boolean(item.low) || !when,', 'low: Boolean(item.low),'],
    ['M2 신호 없는 줄도 등록', 'if (!when && !cue) return;', ''],
    ['M3 id 에 회의록 열쇠 빠짐', '${MINUTES_LINK_PREFIX}${minutesKey(minutesId)}-', '${MINUTES_LINK_PREFIX}x-'],
    ['M4 id 가 저장마다 바뀜', "hash(`${line.replace(/\\s+/g, ' ').trim()}#${n}`)", "hash(`${line}#${n}#${Math.random()}`)"],
    ['M5 기억 무시', 'const skip = new Set([...registered, ...remembered]);', 'const skip = new Set([...registered]);'],
    ['M6 회의록 표시 없음', "memo: title ? `회의록: ${title}`.slice(0, 80) : '회의록에서',", "memo: '',"],
    ['M7 할 일 머리 무시', 'if (TODO_HEAD.test(line)) { inTodo = true; continue; }', 'if (TODO_HEAD.test(line)) { continue; }'],
    ['M8 기억이 임시 저장을 덮음', 'const all = JSON.parse(store?.getItem(MINUTES_DRAFT_KEY) || \'{}\') || {};\n        const links', 'const all = {};\n        const links'],
    ['M9 연결 찾기 아무거나', "if (!id.startsWith(MINUTES_LINK_PREFIX)) return null;", ''],
    ['M10 개수 제한 없음', 'if (auto.length + ask.length >= MAX_ITEMS) break;', ''],
];
const dir = join(tmpdir(), `minutes-mut-${process.pid}`);
mkdirSync(join(dir, 'src/lib'), { recursive: true });
for (const f of ['msgParse.js', 'period.js', 'minutes.js', 'sensitive.js']) copyFileSync(join(root, 'src/lib', f), join(dir, 'src/lib', f));
let missed = 0;
let n = 0;
for (const [name, from, to] of mutants) {
    n += 1;
    if (!LIB.includes(from)) { failures.push(`변이 ${name}: 바꿀 코드를 찾지 못했습니다(검사를 고쳐 주세요).`); continue; }
    const file = join(dir, 'src/lib', `minutesExtract.m${n}.js`);
    writeFileSync(file, LIB.replace(from, to));
    let caught;
    try { caught = (await suite(await import(pathToFileURL(file).href), { minutes })).length > 0; } catch { caught = true; }
    if (!caught) { missed += 1; failures.push(`변이 ${name} 이(가) 살아남았습니다.`); }
}
const UI_MUT = [
    ['U1 Enter 가로채기', '<Area id="minutes-text"', '<Area id="minutes-text" onKeyDown={() => {}}'],
    ['U2 달력 팝업 없이 칸에 펼침', 'aria-label="회의 날짜 고르기"', 'aria-label="날짜"'],
    ['U3 저장 때 등록 안 함', 'await saveParsed(found.auto)', 'await Promise.resolve(found.auto)'],
    ['U4 2단 없음', 'className="minutes-split"', 'className="minutes"'],
];
for (const [name, from, to] of UI_MUT) {
    if (!ui.includes(from)) { failures.push(`변이 ${name}: 바꿀 코드를 찾지 못했습니다.`); continue; }
    if (!uiChecks(ui.replace(from, to), css).length) { missed += 1; failures.push(`변이 ${name} 이(가) 살아남았습니다.`); }
}
rmSync(dir, { recursive: true, force: true });
const total = mutants.length + UI_MUT.length;
if (failures.length) {
    console.error(`회의록 검사 실패 ${failures.length}건:\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log(`회의록 검사 통과 · 변이 ${total - missed}/${total} 검출`);
