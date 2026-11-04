/* 회의록 → 일정·할 일 자동 등록, 2단 배치, 날짜 팝업 검사. 변이(일부러 망가뜨린 코드)도 잡는지 함께 봅니다. */
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, rmSync, cpSync } from 'node:fs';
import { flowSuite } from './minutes-flow.mjs';
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
    const { minutesNow, minutesCandidates, freshCandidates, linkedId, minutesOf, minutesKey, readMinutesLinks, rememberMinutesLinks, forgetMinutesLinks } = mod;
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
    /* 상대 날짜는 회의록 날짜 기준(QA 1번): 11/20 회의의 '내일까지'는 11/21 */
    const past = minutesCandidates('- 내일까지 가정통신문 제출', 'meet-1761600000002', { now: minutesNow('2026-11-20', now) });
    ok(past.auto[0]?.date === '2026-11-21', `'내일'을 회의록 날짜가 아니라 오늘 기준으로 셉니다: ${past.auto[0]?.date}`);
    ok(minutesNow('', now) === now && minutesNow('2026-13-40x', now) === now, '날짜가 없을 때 지금을 기준으로 쓰지 않습니다.');
    const agenda = minutesCandidates('안건\n- 체험학습 장소 정하기\n\n결정\n- 과학관', 'meet-1761600000001', { now });
    ok(!agenda.auto.length && !agenda.ask.length, `안건 칸의 논의거리를 할 일로 묻습니다: ${JSON.stringify(agenda.ask.map((i) => i.title))}`);
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
    /* r2 6번: 날짜가 줄 끝에 있어도 제목이 '할 일'이 되지 않습니다. */
    const tail = minutesCandidates('- 내일까지 가정통신문 제출 2026-11-20', 'meet-t', { now });
    const tailItems = [...tail.auto, ...tail.ask];
    ok(tailItems.length === 1 && tailItems[0].title === '가정통신문 제출', `줄 끝 날짜 제목이 틀립니다: ${JSON.stringify(tailItems.map((i) => i.title))}`);
    ok(mod.titleFromLine('2026-11-20 학부모 상담 준비') === '학부모 상담 준비', `titleFromLine: ${mod.titleFromLine('2026-11-20 학부모 상담 준비')}`);
    /* 고친 줄 정리 도우미 */
    const pv = { text: '할 일\n- 2030-01-20까지 출결 서류 제출\n- 2030-01-21까지 상담 정리', date: '2030-01-10' };
    const nx = { text: '할 일\n- 2030-01-22까지 출결 서류 제출\n- 2030-01-21까지 상담 정리', date: '2030-01-10' };
    const gone = mod.vanishedCandidates(pv, nx, 'meet-v');
    ok(gone.length === 1 && gone[0].date === '2030-01-20', `사라진 줄 찾기가 틀립니다: ${JSON.stringify(gone.map((i) => i.date))}`);
    ok(mod.vanishedCandidates(pv, pv, 'meet-v').length === 0, '본문이 같은데 사라진 줄이 있다고 합니다.');
    const row = { id: gone[0]?.id, title: gone[0]?.title, due: gone[0]?.date, done: false };
    ok(mod.untouchedSince(gone[0], row, 'todos'), '손대지 않은 항목을 고친 것으로 봅니다.');
    ok(!mod.untouchedSince(gone[0], { ...row, title: '바꾼 제목' }, 'todos') && !mod.untouchedSince(gone[0], { ...row, done: true }, 'todos') && !mod.untouchedSince(gone[0], { ...row, due: '2030-02-01' }, 'todos'), '사용자가 고친 항목을 손대지 않은 것으로 봅니다.');
    /* 미룬 등록·묘비 대기열 */
    const ps = memStore();
    mod.setMinutesPending('meet-p', [{ id: 'mt-a' }], ps);
    mod.queueMinutesTombs(['mt-b', 'mt-c', 'mt-b'], ps);
    ok(mod.readMinutesPending(ps)['meet-p']?.length === 1 && mod.readMinutesTombQueue(ps).join() === 'mt-b,mt-c', '미룬 등록·묘비 대기열을 기억하지 못합니다.');
    mod.dropMinutesTombs(['mt-b'], ps); mod.setMinutesPending('meet-p', null, ps);
    ok(mod.readMinutesTombQueue(ps).join() === 'mt-c' && !mod.readMinutesPending(ps)['meet-p'], '대기열에서 빼지 못합니다.');
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
    ok(/registerMinutes\(\{/.test(ui) && /finishMinutesAsk\(asking\.id/.test(ui) && /CaptureCard/.test(ui), '회의록 화면이 저장 흐름(registerMinutes·finishMinutesAsk)을 쓰지 않습니다.');
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
    ['M7 할 일 머리 무시', 'if (TODO_HEAD.test(line)) { inTodo = true; inOther = false; continue; }', 'if (TODO_HEAD.test(line)) { inOther = false; continue; }'],
    ['M11 안건 칸 구분 무시', 'const cue = inTodo || (!inOther && TODO_CUE.test(line));', 'const cue = inTodo || TODO_CUE.test(line);'],
    ['M8 기억이 임시 저장을 덮음', 'const all = JSON.parse(store?.getItem(MINUTES_DRAFT_KEY) || \'{}\') || {};\n        const links', 'const all = {};\n        const links'],
    ['M9 연결 찾기 아무거나', "if (!id.startsWith(MINUTES_LINK_PREFIX)) return null;", ''],
    ['M12 회의록 날짜 무시', "if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(ymd || ''))) return fallback;", 'return fallback;'],
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
/* 저장 흐름 변이: src 전체를 저장소 안 임시 폴더에 복사해 고친 뒤 db.js 를 실제로 돌립니다(소스 맞추기 아님). */
const flowBase = await flowSuite(pathToFileURL(join(root, 'src/lib/db.js')).href);
failures.push(...flowBase.map((m) => `저장 흐름: ${m}`));
const FLOW_MUT = [
    ['U3 저장 때 등록 안 함', 'db.js', 'const put = await saveParsed(found.auto);', 'const put = { count: 0 };'],
    ['U5 오늘 기준 상대 날짜', 'db.js', 'minutesCandidates(text, id, { ...opts, now: minutesNow(date) })', 'minutesCandidates(text, id, { ...opts, now: new Date() })'],
    ['U6 다른 기기 묘비 무시', 'db.js', 'found.auto = found.auto.filter((item) => !check.known.has(item.id));', ''],
    ['U7 뺀 결정 안 남김', 'db.js', 'markMinutesDeclined(items.map((item) => item.id).filter((id) => !chosenIds.has(id)))', 'Promise.resolve(0)'],
    ['P1 확인 실패를 빈 집합으로', 'db.js', "if (!out || typeof out !== 'object') return { known: new Set(), sure: false };", "if (!out || typeof out !== 'object') return { known: new Set(), sure: true };"],
    ['Q1 뺀 결정 대기열 없음', 'db.js', '    queueMinutesTombs(ids);\n    return flushMinutesTombs();', '    return Promise.resolve(cloudApi.tomb(state.auth.uid, ids)).then((d) => d.length).catch(() => 0);'],
    ['T1 고친 항목도 지움', 'db.js', 'if (!hit || !untouchedSince(item, hit.row, hit.bucket)) continue;', 'if (!hit) continue;'],
    ['T2 고친 줄 정리 안 함', 'db.js', 'const tidied = await tidyEditedMinutes(id, prev, { text, date }, opts);', 'const tidied = 0;'],
    ['S1 미룬 등록 다시 안 함', 'db.js', "        const check = await minutesCloudCheck(fresh.map((item) => item.id));\n        if (!check.sure) continue;", '        continue;'],
];
const mutRoot = join(root, `.minutes-mut-${process.pid}`);
let k = 0;
for (const [name, file, from, to] of FLOW_MUT) {
    k += 1;
    const src = readFileSync(join(root, 'src/lib', file), 'utf8');
    if (!src.includes(from)) { failures.push(`변이 ${name}: 바꿀 코드를 찾지 못했습니다(검사를 고쳐 주세요).`); continue; }
    const dirK = join(mutRoot, String(k));
    cpSync(join(root, 'src'), join(dirK, 'src'), { recursive: true });
    writeFileSync(join(dirK, 'src/lib', file), src.replace(from, to));
    let caught;
    try { caught = (await flowSuite(pathToFileURL(join(dirK, 'src/lib/db.js')).href)).length > 0; } catch { caught = true; }
    if (!caught) { missed += 1; failures.push(`변이 ${name} 이(가) 살아남았습니다.`); }
}
rmSync(mutRoot, { recursive: true, force: true });
rmSync(dir, { recursive: true, force: true });
const total = mutants.length + FLOW_MUT.length;
if (failures.length) {
    console.error(`회의록 검사 실패 ${failures.length}건:\n- ${failures.join('\n- ')}`);
    process.exit(1);
}
console.log(`회의록 검사 통과 · 변이 ${total - missed}/${total} 검출`);
