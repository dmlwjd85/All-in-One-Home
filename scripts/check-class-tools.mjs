/** 수업 도구: 계산(타이머 표시·제비뽑기·돌림판·투표)과 화면 연결(경로·메뉴·탭·팝업·전체화면)을 봅니다. */
import { readFileSync } from 'node:fs';
import {
    TOOL_IDS, TOOL_INFO, TOOLS_KEY, addVote, checkVote, clampTimer, cleanWheel, drawLots, formatClock, loadTools, newVote, rosterLabels, saveTools, spinWheel, voteResult, wheelIndexAt,
} from '../src/lib/classTools.js';
import { resolveHash } from '../src/lib/routes.js';
import { MENU, menuSelected } from '../src/ui/menu.js';
import { TAB_POOL, normalizeOrder } from '../src/ui/tabSlots.js';

const root = new URL('..', import.meta.url).pathname;
const src = (p) => readFileSync(`${root}/${p}`, 'utf8');
const failures = [];
const check = (ok, message) => { if (!ok) failures.push(message); };

/* 정해진 난수 순서 */
const seq = (...values) => { let i = 0; return () => values[i++ % values.length]; };

check(TOOL_IDS.join() === 'timer,lottery,wheel,vote,board' && TOOL_IDS.every((id) => TOOL_INFO[id]?.label), '도구 다섯 가지가 다릅니다.');
check(formatClock(0) === '00:00' && formatClock(59.2) === '01:00' && formatClock(300) === '05:00' && formatClock(3725) === '1:02:05', '타이머 표시');
check(clampTimer(-5) === 0 && clampTimer(99999) === 10800 && clampTimer('90') === 90, '타이머 범위(0~180분)');

/* 제비뽑기 */
const pool = ['a', 'b', 'c', 'd'];
const once = drawLots(pool, 4, { remove: true, rand: seq(0.9, 0.9, 0.9, 0.9) });
check(once.length === 4 && new Set(once).size === 4, `뽑힌 사람 빼기면 겹치지 않아야 합니다: ${once}`);
check(drawLots(pool, 9, { remove: true }).length === 4, '빼기면 남은 사람보다 많이 뽑지 않습니다.');
const again = drawLots(pool, 3, { remove: false, rand: seq(0, 0, 0) });
check(again.join() === 'a,a,a', `다시 넣기면 같은 사람이 또 뽑힐 수 있어야 합니다: ${again}`);
check(drawLots([], 3).length === 0 && drawLots(pool, 0).length === 0, '빈 명단·0명');
const labels = rosterLabels([{ no: '1', name: '김하늘' }, { no: '2', name: '' }, null, { no: '', name: '' }]);
check(labels.length === 2 && labels[0].label === '1 김하늘' && labels[1].label === '2번', `명단 이름표: ${JSON.stringify(labels)}`);

/* 돌림판: 멈춘 각도에서 바늘이 가리키는 칸 = 뽑힌 칸 */
for (const n of [2, 3, 6, 7, 24]) {
    for (const r of [0, 0.13, 0.5, 0.77, 0.999]) {
        const turn = spinWheel(n, 123, seq(r, r, r));
        check(wheelIndexAt(turn.angle, n) === turn.index, `돌림판 ${n}칸·${r}: 바늘 ${wheelIndexAt(turn.angle, n)} ≠ 뽑힌 칸 ${turn.index}`);
        check(turn.angle - 123 >= 5 * 360 - 360, `돌림판이 충분히 돌지 않습니다: ${turn.angle}`);
    }
}
check(cleanWheel(['  가  ', '', 'x'.repeat(30), null]).join('|') === `가|${'x'.repeat(14)}`, '돌림판 칸 다듬기');
check(cleanWheel(Array.from({ length: 50 }, (_, i) => `칸${i}`)).length === 40, '돌림판은 40칸까지(학급 명단 전체)');
for (const r of [0, 0.37, 0.999]) { const turn = spinWheel(37, 0, seq(r, r, r)); check(wheelIndexAt(turn.angle, 37) === turn.index, `돌림판 37칸·${r}`); }
check(/data-role="wheel-roster"/.test(src('src/ui/ClassTools.jsx')) && /data-role="wheel-custom"/.test(src('src/ui/ClassTools.jsx')) && /rosterLabels\(students\)\.map\(\(p\) => p\.label\)\.slice\(0, WHEEL_MAX\)/.test(src('src/ui/ClassTools.jsx')), '돌림판은 우리 반 명단 전체와 직접 적은 것 중에서 고를 수 있어야 합니다.');

/* 투표 */
check(!checkVote(newVote('', ['피구', ''])).ok && !checkVote(newVote('', ['피구', '피구'])).ok && checkVote(newVote('', ['피구', ' 발야구 ', ''])).options.join() === '피구,발야구', '투표 선택지 확인');
let v = { ...newVote('놀이', ['피구', '발야구', '술래잡기']), mode: 'secret', phase: 'vote' };
for (const k of [0, 1, 0, 2, 0]) v = addVote(v, k, 1);
check(v.ballots === 5 && v.counts.join() === '3,1,1', `비밀 투표 셈: ${v.counts} / ${v.ballots}`);
check(addVote({ ...v, mode: 'hands' }, 1, -5).counts[1] === 0, '표는 0보다 적어지지 않습니다.');
const res = voteResult(v);
check(res.total === 5 && res.winners.length === 1 && res.winners[0].label === '피구' && !res.tie && Math.abs(res.rows[0].share - 0.6) < 1e-9, '개표 결과');
check(voteResult({ options: ['a', 'b'], counts: [2, 2] }).tie && voteResult({ options: ['a', 'b'], counts: [0, 0] }).winners.length === 0, '동점·빈 투표');

/* 이 기기 저장만 */
const bag = new Map();
const store = { getItem: (k) => (bag.has(k) ? bag.get(k) : null), setItem: (k, val) => bag.set(k, String(val)) };
saveTools({ timer: { total: 180 } }, store);
saveTools({ wheel: { items: ['가', '나'] } }, store);
check(loadTools(store).timer.total === 180 && loadTools(store).wheel.items.length === 2 && [...bag.keys()].join() === TOOLS_KEY, '도구 설정은 이 기기 키 하나에 둡니다.');
bag.set(TOOLS_KEY, '{깨짐');
check(JSON.stringify(loadTools(store)) === '{}', '깨진 저장값은 빈 것으로');
check(!/classTools|ssug-gyomu-tools/.test(src('src/lib/db.js')), '수업 도구 설정은 기록·클라우드에 넣지 않습니다.');

/* 경로·메뉴·탭 */
check(resolveHash('#/tools', '2026-11-19').name === 'tools' && resolveHash('#/tools/wheel', '2026-11-19').params.tool === 'wheel' && resolveHash('#/tools/zzz', '2026-11-19').replace === '#/tools', '수업 도구 주소');
check(MENU.some(([label, href]) => label === '수업 도구' && href === '#/tools') && menuSelected('tools', '#/tools'), '메뉴에 수업 도구가 없습니다.');
check(TAB_POOL.some((tab) => tab.id === 'tools' && tab.href === '#/tools') && normalizeOrder(['tools', 'today', 'todo', 'attend', 'schedule', 'more'])[0] === 'tools', '탭 고르기에 수업 도구가 없습니다.');
check(/t\.order\.hasOnly\(\[[^\]]*'tools'\]\)/.test(src('firestore.rules')), '클라우드 탭 배치 규칙이 도구 탭을 받지 않습니다.');
const tabBar = src('src/ui/TabBar.jsx');
check(/\n\s+tools: <>/.test(tabBar), '도구 탭 아이콘이 없습니다.');

/* 화면: 팝업이 기본, 전체화면 단추, 다섯 도구, 늦게 받기 */
const ui = src('src/ui/ClassTools.jsx');
const app = src('src/App.jsx');
check(/lazy\(\(\) => import\('\.\/ui\/ClassTools\.jsx'\)\)/.test(app) && /route\.name === 'tools'/.test(app), '수업 도구 화면을 처음 열 때만 받아야 합니다.');
check(/role="dialog" aria-modal="true"/.test(ui) && /data-role="tool-full"/.test(ui) && /requestFullscreen/.test(ui) && /fullscreenchange/.test(ui) && /'Escape'/.test(ui), '팝업·전체화면·Esc 닫기');
for (const name of ['TimerTool', 'LotteryTool', 'WheelTool', 'VoteTool', 'BoardTool']) check(new RegExp(`function ${name}\\(`).test(ui), `${name} 이 없습니다.`);
check(/setCover\(true\)/.test(ui) && /다음 사람/.test(ui), '비밀 투표는 누르면 화면을 가려야 합니다.');
check(/touch-action: none/.test(src('src/ui/classTools.css')) && /\.ct-pop\.is-full \{[^}]*inset: 0/.test(src('src/ui/classTools.css')), '판서 터치·전체화면 모양');

if (failures.length) {
    console.error(`수업 도구 검사 실패 ${failures.length}건`);
    for (const f of failures) console.error(`- ${f}`);
    process.exit(1);
}
console.log('수업 도구 검사를 통과했습니다.');
