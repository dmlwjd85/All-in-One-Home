/** 수업 도구(타이머·제비뽑기·돌림판·학급투표·판서)의 계산만 모았습니다. 화면은 ui/ClassTools.jsx.
    모든 값은 이 기기에만 둡니다(키 ssug-gyomu-tools). 학생 기록·클라우드에는 넣지 않습니다.
    삼봉월드 수업도구(타이머 세 모양·제비뽑기 순차/한번에·빼기/다시 넣기·돌림판 2~24칸·판서 분필)를 참고했고,
    학급투표는 학생 기기 없이 교사 기기 하나로 하도록 '손들기 세기'와 '돌려 가며 비밀 투표' 두 가지로 바꿨습니다. */

export const TOOLS_KEY = 'ssug-gyomu-tools';
export const TOOL_IDS = ['timer', 'lottery', 'wheel', 'vote', 'board'];
export const TOOL_INFO = {
    timer: { label: '타이머', hint: '숫자·원판·모래시계', icon: '⏱️' },
    lottery: { label: '제비뽑기', hint: '명단에서 한 명씩 또는 한꺼번에', icon: '🎫' },
    wheel: { label: '돌림판', hint: '우리 반 명단 또는 직접 적은 것 중에서', icon: '🎡' },
    vote: { label: '학급투표', hint: '손들기 세기·돌려 가며 비밀 투표', icon: '🗳️' },
    board: { label: '판서', hint: '분필·형광펜·지우개, 칠판 세 가지', icon: '🖍️' },
};

export const TIMER_PRESETS = [1, 3, 5, 10, 15];
export const TIMER_STYLES = [['digital', '숫자'], ['dial', '원판'], ['sand', '모래시계']];
export const TIMER_MAX_SEC = 180 * 60;

/** 남은 초를 'MM:SS'(한 시간 넘으면 'H:MM:SS')로. */
export function formatClock(sec) {
    const s = Math.max(0, Math.ceil(Number(sec) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const r = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(r).padStart(2, '0');
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export function clampTimer(sec) {
    const n = Math.round(Number(sec) || 0);
    return Math.max(0, Math.min(TIMER_MAX_SEC, n));
}

/** 0~1 사이 난수 함수 하나로 무작위 정수(0 ≤ n < max). 검사에서는 정해진 순서를 넣습니다. */
function randInt(max, rand = Math.random) {
    return Math.min(max - 1, Math.floor(rand() * max));
}

/** 제비뽑기: pool 에서 count 명. remove 면 뽑힌 사람을 빼고(중복 없음), 아니면 다시 넣어(중복 가능) 뽑습니다. */
export function drawLots(pool, count, { remove = true, rand = Math.random } = {}) {
    const list = Array.isArray(pool) ? pool.filter((item) => item != null && item !== '') : [];
    const want = Math.max(0, Math.floor(Number(count) || 0));
    const out = [];
    let left = [...list];
    for (let i = 0; i < want; i += 1) {
        const from = remove ? left : list;
        if (!from.length) break;
        const pick = from[randInt(from.length, rand)];
        out.push(pick);
        if (remove) left = left.filter((item) => item !== pick);
    }
    return out;
}

/** 명단 → 제비·돌림판 이름표. 이름이 없으면 번호만. */
export function rosterLabels(students) {
    return (Array.isArray(students) ? students : [])
        .filter((row) => row && (row.name || row.no))
        .map((row) => ({ id: String(row.no || row.name), label: row.name ? `${row.no ? `${row.no} ` : ''}${row.name}` : `${row.no}번` }));
}

export const WHEEL_MIN = 2;
export const WHEEL_MAX = 40; /* 학급 명단 전체(최대 40명)가 들어가게 */
export const WHEEL_SAMPLE = ['칭찬 한마디', '노래 한 소절', '다음 발표', '박수 세 번', '퀴즈 내기', '통과!'];

/** 돌림판 칸 글자를 다듬습니다: 앞뒤 빈칸 지우기, 빈 칸 빼기, 40칸·칸마다 14자까지. */
export function cleanWheel(items) {
    return (Array.isArray(items) ? items : [])
        .map((text) => Array.from(String(text ?? '').replace(/\s+/g, ' ').trim()).slice(0, 14).join(''))
        .filter(Boolean)
        .slice(0, WHEEL_MAX);
}

/** 돌림판 돌리기: 당첨 칸과, 바늘(맨 위)이 그 칸 가운데쯤 오도록 돌 각도(도, 시계 방향).
    now 는 지금 돌아가 있는 각도. 최소 5바퀴 더 돌고, 칸 가장자리에 걸리지 않게 칸 안쪽 70% 안에서 멈춥니다. */
export function spinWheel(count, now = 0, rand = Math.random) {
    const n = Math.max(1, Math.floor(count) || 1);
    const index = randInt(n, rand);
    const seg = 360 / n;
    const inside = (rand() - 0.5) * seg * 0.7;
    /* 칸 i 의 가운데는 그림에서 (i + 0.5) * seg 도. 바늘이 위(0도)에 오려면 판을 -(가운데) 만큼 돌립니다. */
    const target = (360 - ((index + 0.5) * seg + inside)) % 360;
    const base = Math.ceil(now / 360) * 360;
    const turns = 5 + randInt(3, rand);
    return { index, angle: base + turns * 360 + ((target + 360) % 360) };
}

/** 지금 각도에서 바늘(맨 위)이 가리키는 칸. */
export function wheelIndexAt(angle, count) {
    const n = Math.max(1, Math.floor(count) || 1);
    const seg = 360 / n;
    const a = ((360 - (((Number(angle) || 0) % 360) + 360) % 360) + 360) % 360;
    return Math.min(n - 1, Math.floor(a / seg));
}

export const VOTE_MIN = 2;
export const VOTE_MAX = 8;

export function newVote(title = '', options = ['', '']) {
    return { title, options: options.slice(0, VOTE_MAX), counts: options.slice(0, VOTE_MAX).map(() => 0), mode: 'hands', phase: 'setup', ballots: 0 };
}

/** 선택지 다듬기: 빈 칸 빼고 2~8개. 같은 글자가 둘이면 안 됩니다. */
export function checkVote(vote) {
    const options = (vote?.options || []).map((text) => String(text || '').trim());
    const filled = options.filter(Boolean);
    if (filled.length < VOTE_MIN) return { ok: false, reason: '선택지를 두 개 이상 적어 주세요.' };
    if (new Set(filled).size !== filled.length) return { ok: false, reason: '같은 선택지가 두 번 있어요.' };
    return { ok: true, options: filled };
}

/** 표 하나 더하기(손들기 세기·비밀 투표 모두). 음수는 막습니다. */
export function addVote(vote, index, delta = 1) {
    const counts = [...(vote.counts || [])];
    if (index < 0 || index >= counts.length) return vote;
    counts[index] = Math.max(0, (counts[index] || 0) + delta);
    const ballots = Math.max(0, (vote.ballots || 0) + (vote.mode === 'secret' ? Math.sign(delta) : 0));
    return { ...vote, counts, ballots };
}

/** 개표 결과: 표 많은 순, 같은 표면 원래 순서. 1등이 여럿이면 tie. */
export function voteResult(vote) {
    const rows = (vote.options || []).map((label, i) => ({ label, count: vote.counts?.[i] || 0, i }));
    const total = rows.reduce((sum, row) => sum + row.count, 0);
    const sorted = [...rows].sort((a, b) => b.count - a.count || a.i - b.i);
    const top = sorted[0]?.count || 0;
    const winners = top > 0 ? sorted.filter((row) => row.count === top) : [];
    return { rows: sorted.map((row) => ({ ...row, share: total ? row.count / total : 0 })), total, winners, tie: winners.length > 1 };
}

export const BOARD_COLORS = [['#F8FAFC', '흰 분필'], ['#FDE047', '노랑'], ['#F9A8D4', '분홍'], ['#7DD3FC', '하늘'], ['#BEF264', '연두'], ['#FDBA74', '주황']];
export const BOARD_INKS = [['#1F2933', '검정'], ['#2563EB', '파랑'], ['#DC2626', '빨강'], ['#16A34A', '초록']];
export const BOARD_SIZES = [['가늘게', 3], ['보통', 6], ['굵게', 12]];
export const BOARD_BACKS = [['green', '초록 칠판'], ['black', '검은 칠판'], ['white', '화이트보드']];

/** 이 기기에 둔 도구 설정 읽기·쓰기. 깨진 값이면 빈 것으로. */
export function loadTools(storage) {
    try {
        const raw = (storage || (typeof localStorage === 'undefined' ? null : localStorage))?.getItem?.(TOOLS_KEY);
        const value = raw ? JSON.parse(raw) : {};
        return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
        return {};
    }
}

export function saveTools(patch, storage) {
    const store = storage || (typeof localStorage === 'undefined' ? null : localStorage);
    const next = { ...loadTools(store), ...patch };
    try {
        store?.setItem?.(TOOLS_KEY, JSON.stringify(next));
    } catch {
        /* 저장이 막혀도 지금 화면에서는 그대로 씁니다. */
    }
    return next;
}
