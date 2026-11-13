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
    /* #79 파서와 맞물림: 장:절·점수 콜론 숫자는 시각으로 바로 넣지 않고, 진짜 시각은 그대로 둡니다. */
    const bible = minutesCandidates('할 일\n- 11/12 요한복음 3:16 암송 확인', 'meet-1761600000003', { now });
    const bibleAll = [...bible.auto, ...bible.ask];
    ok(bibleAll.length === 1 && !bibleAll[0].time && bible.ask.length === 1, `「요한복음 3:16」을 시각으로 바로 등록합니다: ${JSON.stringify(bibleAll.map((i) => [i.time, i.low]))}`);
    const real = minutesCandidates('- 11/12 15:30 학년 협의회', 'meet-1761600000004', { now });
    ok(real.auto[0]?.time === '15:30', `진짜 시각(15:30)을 지웠습니다: ${JSON.stringify(real.auto[0])}`);
    /* 시간구: '퇴근 전까지'는 내 퇴근 시각으로, 설정이 비었으면 노란 카드로. */
    const CTX = { today: '2026-11-04', hm: '14:00', workStart: '08:30', workEnd: '16:40', leave: null, starts: [], lengths: [], lastPeriod: 6 };
    const phrase = minutesCandidates('- 11/12 퇴근 전까지 보고서 제출', 'meet-1761600000005', { now, timeCtx: CTX });
    const ph = [...phrase.auto, ...phrase.ask][0];
    ok(ph && ph.time && ph.time <= '16:40', `시간구 '퇴근 전까지'를 시각으로 채우지 않습니다: ${JSON.stringify(ph)}`);
    const noWork = minutesCandidates('- 11/12 퇴근 전까지 보고서 제출', 'meet-1761600000005', { now, timeCtx: { ...CTX, workEnd: '' } });
    ok(noWork.ask.length === 1 && !noWork.ask[0].time, `퇴근 시각이 비었는데 노란 카드로 묻지 않습니다: ${JSON.stringify(noWork)}`);
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
    ok(minutesOf('todo-1', rows) === null && minutesOf('msgabc', rows) === null && minutesOf('ev-1761600000000-abcdefg', rows) === null, '회의록과 상관없는 항목을 회의록에 잇습니다.');
    /* '할 일' 아래 신호·날짜 없는 줄은 바로 등록하지 않고 노란 카드(할 일)로 묻습니다. */
    const plain = minutesCandidates('할 일\n- 운동장 정리', 'meet-1761600000006', { now });
    ok(!plain.auto.length && plain.ask.length === 1 && plain.ask[0].kind === '할 일' && plain.ask[0].low, `할 일 칸의 날짜 없는 줄: ${JSON.stringify(plain)}`);
    /* 평점관 r4 P1: 회의록 시각은 쨈 빠른 입력(#79 findTimeSpans)과 같게 읽습니다. 앞말 없는 1~6시는 오후, 애매한 1~11시는 노란 카드 기본 해제. */
    const r4now = new Date('2026-11-11T00:00:00Z');
    const pick = (line) => { const out = minutesCandidates(line, 'meet-1762800000000', { now: r4now }); return [...out.auto.map((i) => ({ ...i, where: 'auto' })), ...out.ask.map((i) => ({ ...i, where: 'ask' }))]; };
    for (const [line, time, where, include, titleHas] of [
        ['11/14 3:30 학년 협의회', '15:30', 'ask', false, '학년 협의회'],
        ['내일 2:40 상담', '14:40', 'ask', false, '상담'],
        ['11/14 3시 30분 학년 협의회', '15:30', 'ask', false, '학년 협의회'],
        ['11/14 회의 3:30', '15:30', 'ask', false, '회의'],
        ['11/14 오후 3:30 학년 협의회', '15:30', 'auto', true, '학년 협의회'],
        ['11/14 오전 9:30 학년 협의회', '09:30', 'auto', true, '학년 협의회'],
        ['11/14 15:30 학년 협의회', '15:30', 'auto', true, '학년 협의회'],
        ['11/14 저녁 7시 학부모 총회', '19:00', 'auto', true, '학부모 총회'],
        ['11/20 3교시 공개수업', '10:30', 'auto', true, '공개수업'],
        ['마 5:13 말씀 나눔 후 11/20 예배 준비', '', 'ask', false, '마 5:13'],
        ['요한 3:16 묵상', '', 'ask', false, '요한 3:16'],
        ['요한복음 3:16 묵상 11/20', '', 'ask', false, '요한복음 3:16'],
        ['협의회 일정 잡기', '', 'ask', false, '협의회 일정 잡기'],
    ]) {
        const got = pick(line);
        const it = got[0];
        ok(got.length === 1 && it.time === time && it.where === where && (it.include !== false) === include && it.title.includes(titleHas),
            `회의록 시각 「${line}」: 기대 ${JSON.stringify([time, where, include, titleHas])} / 실제 ${JSON.stringify(got.map((i) => [i.time, i.where, i.include, i.title]))}`);
    }
    /* 장:절 안내 문구는 그 줄의 숫자를 보여 줍니다(「마 5:13」에 「3:16」이라 쓰지 않음). */
    const mattWarn = pick('마 5:13 말씀 나눔 후 11/20 예배 준비')[0]?.warning || '';
    ok(mattWarn.includes('「5:13」') && !mattWarn.includes('3:16'), `장:절 안내가 줄의 숫자와 다릅니다: ${mattWarn}`);
    /* 짧은 줄 묻기는 안건·결정 칸에서는 하지 않습니다. */
    const shortAgenda = minutesCandidates('안건\n- 협의회 일정 잡기', 'meet-1762800000001', { now: r4now });
    ok(!shortAgenda.auto.length && !shortAgenda.ask.length, `안건 칸의 짧은 줄을 할 일로 묻습니다: ${JSON.stringify(shortAgenda.ask)}`);
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
    /* 날짜는 접어 둔 달력(누르면 펼치고, 고르면 접힘). 팝업·2단 배치는 넣지 않기로 했습니다(2026-11-14, PR #64 1번안). */
    ok(/data-role="minutes-date-toggle"/.test(ui) && /aria-expanded=\{dateOpen/.test(ui) && /<DateGrid value=\{date\}[^\n]*setDateOpen\(false\)/.test(ui), '날짜 달력이 접혔다 펼쳐지지 않습니다.');
    ok(/registerMinutes\(\{/.test(ui) && /finishMinutesAsk\(asking\.id/.test(ui) && /CaptureCard/.test(ui), '회의록 화면이 저장 흐름(registerMinutes·finishMinutesAsk)을 쓰지 않습니다.');
    ok(/data-role="minutes-kind-toggle"/.test(ui) && /aria-expanded=\{kindOpen/.test(ui) && /setKindOpen\(false\)/.test(ui), '회의 종류 칩이 접혔다 펼쳐지지 않습니다.');
    ok(/data-screen="minutes-ask"/.test(ui) && /모두 빼고 마치기/.test(ui), '노란 카드 확인 화면이 없습니다.');
    ok(/\.minutes-date-toggle \{[^}]*min-height: 44px/.test(css), '날짜 단추가 44px 보다 작습니다.');
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
if (!sw.includes("const CACHE = 'ssug-gyomu-shell-v88'")) failures.push('서비스 워커가 v88이 아닙니다.');

/* 변이: 일부러 망가뜨린 코드를 이 검사가 잡는지 봅니다. */
const LIB = readFileSync('src/lib/minutesExtract.js', 'utf8');
const mutants = [
    ['M1 날짜 없어도 바로 등록', 'low: Boolean(item.low) || !when,', 'low: when && Boolean(item.low),'],
    ['M2 신호 없는 줄도 등록', 'if (!when && !cue && !shortTask && !colonOnly) return;', ''],
    ['M3 id 에 회의록 열쇠 빠짐', '${MINUTES_LINK_PREFIX}${minutesKey(minutesId)}-', '${MINUTES_LINK_PREFIX}x-'],
    ['M4 id 가 저장마다 바뀜', "hash(`${line.replace(/\\s+/g, ' ').trim()}#${n}`)", "hash(`${line}#${n}#${Math.random()}`)"],
    ['M5 기억 무시', 'const skip = new Set([...registered, ...remembered]);', 'const skip = new Set([...registered]);'],
    ['M6 회의록 표시 없음', "memo: title ? `회의록: ${title}`.slice(0, 80) : '회의록에서',", "memo: '',"],
    ['M7 할 일 머리 무시', 'if (TODO_HEAD.test(line)) { inTodo = true; inOther = false; continue; }', 'if (TODO_HEAD.test(line)) { inOther = false; continue; }'],
    ['M11 안건 칸 구분 무시', 'const cue = inTodo || (!inOther && TODO_CUE.test(line));', 'const cue = inTodo || TODO_CUE.test(line);'],
    ['M8 기억이 임시 저장을 덮음', 'const all = JSON.parse(store?.getItem(MINUTES_DRAFT_KEY) || \'{}\') || {};\n        const links', 'const all = {};\n        const links'],
    ['M9 연결 찾기 아무거나', "if (!id.startsWith(MINUTES_LINK_PREFIX)) return null;", ''],
    ['M12 회의록 날짜 무시', "if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(String(ymd || ''))) return fallback;", 'return fallback;'],
    ['M10 개수 제한 없음', 'const MAX_ITEMS = 30;', 'const MAX_ITEMS = 300;'],
    ['R1 메시지 파서 콜론 시각을 그대로(3:30→03:30)', 'const span = item.period ? null : clockSpan(line);', "const span = item.period || !item.time ? null : { time: item.time, word: '15:00' };"],
    ['R2 애매한 시각도 바로 등록', '                        draft.low = true;\n                        draft.include = false;\n                        draft.warning = [draft.warning, `「${span.word}」', '                        draft.warning = [draft.warning, `「${span.word}」'],
    ['R3 애매한 시각 노란 카드 기본 선택', '                        draft.low = true;\n                        draft.include = false;\n                        draft.warning = [draft.warning, `「${span.word}」', '                        draft.low = true;\n                        draft.warning = [draft.warning, `「${span.word}」'],
    ['R4 장:절 줄 기본 선택', "                        draft.low = true;\n                        draft.include = false;\n                        const colonWord", "                        draft.low = true;\n                        const colonWord"],
    ['R8 장:절 안내에 다른 숫자', "[0].replace(/\\s+/g, '');", "[0].replace(/\\s+/g, '') && '3:16';"],
    ['R5 장:절 제목에서 숫자 빠짐', 'draft.title = titleKeepColon(line) || draft.title;', ''],
    ['R6 장:절 줄 버림', 'const colonOnly = !when && !cue && !inOther && Boolean(item.time) && notClockLine(line);', 'const colonOnly = false;'],
    ['R7 짧은 할 일 줄 안 물음', 'const shortTask = !when && !cue && !inOther && SHORT_TASK.test(line) && /\\s/.test(line);', 'const shortTask = false;'],
    ['R8 짧은 할 일 줄 기본 선택', "                draft.low = true;\n                draft.include = false;\n                draft.warning = '날짜 없는 짧은 줄이에요.", "                draft.low = true;\n                draft.warning = '날짜 없는 짧은 줄이에요."],
    ['R9 안건 칸 짧은 줄도 물음', 'const shortTask = !when && !cue && !inOther && SHORT_TASK', 'const shortTask = !when && !cue && SHORT_TASK'],
];
const dir = join(tmpdir(), `minutes-mut-${process.pid}`);
mkdirSync(join(dir, 'src/lib'), { recursive: true });
/* src/lib 전체를 복사합니다(파일이 빠져 import가 깨지면 변이를 「잡았다」고 잘못 세지 않게). */
cpSync(join(root, 'src/lib'), join(dir, 'src/lib'), { recursive: true });
let missed = 0;
let n = 0;
for (const [name, from, to] of mutants) {
    n += 1;
    if (!LIB.includes(from)) { failures.push(`변이 ${name}: 바꿀 코드를 찾지 못했습니다(검사를 고쳐 주세요).`); continue; }
    const file = join(dir, 'src/lib', `minutesExtract.m${n}.js`);
    writeFileSync(file, LIB.replace(from, to));
    let caught;
    let loaded;
    try { loaded = await import(pathToFileURL(file).href); } catch (error) { failures.push(`변이 ${name}: 불러오지 못했습니다(${error.message})`); continue; }
    try { caught = (await suite(loaded, { minutes })).length > 0; } catch { caught = true; }
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
