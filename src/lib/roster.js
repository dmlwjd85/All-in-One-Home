/**
 * 명단(명렬) 읽기와 새 명단 맞추기.
 * - 엑셀·한글 표·나이스 화면에서 복사한 글(탭, 여러 칸 띄어쓰기)과 한 줄에 한 명("12 이하은", "12. 이하은", "이하은")을 모두 받습니다.
 * - 번호가 있으면 그대로(51번처럼 이어지지 않아도) 쓰고, 없으면 앞 번호 다음부터 차례로 매깁니다.
 * - 바깥 라이브러리 없이 node 로도 돌아갑니다(scripts/check-roster.mjs).
 */

/** 한 반에 받는 학생 수와 번호 범위. 남학생 1번·여학생 51번처럼 띄운 번호도 받습니다. */
export const MAX_STUDENTS = 60;
export const MAX_NO = 99;
/** 배포된 클라우드 규칙이 받는 번호 끝. 이보다 큰 번호는 이 기기에만 남습니다. */
export const CLOUD_MAX_NO = 50;

const HEADER_WORDS = new Set([
    '번호', '번', '이름', '성명', '학생', '학생명', '학생이름', '아동명', '성별', '남녀', '생년월일', '생일', '학년', '반', '비고',
    '남학생', '여학생', '남자', '여자', '합계', '계', '명단', '명렬', '명렬표', '학급', '전입', '전출', '연락처', '주소', '보호자',
    '출석번호', '학번', '구분', '순', '순번', '연번',
]);
/* '남자'·'여자'는 성별 칸 값이기도 해서, 머리글 줄로 볼 때만 위 목록을 씁니다. */
const SEX_WORDS = { 남: '남', 여: '여', 남자: '남', 여자: '여', m: '남', f: '여', male: '남', female: '여' };

function sexOf(text) {
    const key = String(text || '').trim().replace(/^[(（]\s*(.*?)\s*[)）]$/, '$1').toLowerCase();
    return SEX_WORDS[key] || '';
}

/** 한 칸이 번호인지: 15, 15번, 15., 15), (15) */
function noOf(text) {
    const m = String(text || '').trim().match(/^\(?(\d{1,3})\)?\s*(?:번|[.)])?$/);
    return m ? Number(m[1]) : null;
}

/** 이름 칸인지. 한글은 띄어쓰기를 빼고 2~20자, 영문은 띄어쓰기를 하나로 둡니다. */
function nameOf(text) {
    let raw = String(text || '').trim().replace(/\s*[(（]\s*(?:남|여|남자|여자)\s*[)）]\s*$/, '');
    if (!raw) return '';
    if (!/^[가-힣A-Za-z][가-힣A-Za-z\s.·'-]*$/.test(raw)) return '';
    if (/[가-힣]/.test(raw)) raw = raw.replace(/\s+/g, '');
    else raw = raw.replace(/\s+/g, ' ');
    if (raw.length < 2 || raw.length > 20) return '';
    if (HEADER_WORDS.has(raw) || sexOf(raw)) return '';
    return raw;
}

/** 한 칸을 나눕니다. "1.김가나", "15번김가나"처럼 붙은 번호도 떼어 냅니다. */
function splitGlued(cell) {
    const m = String(cell).trim().match(/^(\d{1,3})\s*(?:번|[.)])\s*(\S.*)$/);
    const parts = m ? [m[1], m[2]] : [cell];
    /* "이다라(여)"처럼 이름 뒤 괄호 성별도 따로 뗍니다. */
    const tail = parts[parts.length - 1].match(/^(.*\S)\s*[(（]\s*(남|여|남자|여자)\s*[)）]$/);
    if (tail) parts.splice(parts.length - 1, 1, tail[1], tail[2]);
    return parts;
}

function cellsOf(line) {
    let cells;
    let mode;
    if (line.includes('\t')) { cells = line.split('\t'); mode = 'tab'; }
    else if (/ {2,}|　/.test(line.trim())) { cells = line.trim().split(/(?: {2,}|　)+/); mode = 'wide'; }
    else { cells = line.trim().split(/\s+/); mode = 'space'; }
    cells = cells.map((cell) => cell.replace(/ /g, ' ').trim());
    return { mode, cells: cells.flatMap((cell) => (cell ? splitGlued(cell) : [''])).map((cell) => cell.trim()) };
}

function isHeaderRow(cells) {
    const filled = cells.filter(Boolean);
    if (!filled.length) return false;
    const heads = filled.filter((cell) => HEADER_WORDS.has(cell.replace(/\s+/g, '')));
    return heads.length > 0 && heads.length >= filled.length - heads.length && !filled.some((cell) => noOf(cell) != null);
}

function headerColumns(cells) {
    const col = { no: -1, name: -1, sex: -1 };
    cells.forEach((cell, index) => {
        const word = cell.replace(/\s+/g, '');
        if (col.no < 0 && /^(번호|번|출석번호|학번)$/.test(word)) col.no = index;
        if (col.name < 0 && /^(이름|성명|학생|학생명|학생이름|아동명)$/.test(word)) col.name = index;
        if (col.sex < 0 && /^(성별|남녀)$/.test(word)) col.sex = index;
    });
    return col.name >= 0 ? col : null;
}

/** 한 줄에서 (번호, 이름, 성별) 묶음을 찾습니다. 표에서 두 명씩 복사한 줄("1 김가나 21 이다라")도 받습니다. */
function pairsOf(cells, mode) {
    const out = [];
    let pendingNo = null;
    let pendingSex = '';
    let nameParts = [];
    let last = null;
    const flush = () => {
        if (!nameParts.length) return;
        const joined = nameParts.join('');
        /* 띄어 쓴 한 줄: "남궁 민수"는 한 사람, "김가나 이다라"(합쳐 6자 이상)는 두 사람으로 봅니다. */
        const hangul = /[가-힣]/.test(joined);
        const names = mode === 'space' && hangul && nameParts.length > 1 && joined.length > 5 ? nameParts : [hangul ? joined : nameParts.join(' ')];
        names.forEach((name, i) => {
            last = { no: i === 0 ? pendingNo : null, name: nameOf(name) || name, sex: i === 0 ? pendingSex : '' };
            out.push(last);
        });
        pendingNo = null;
        pendingSex = '';
        nameParts = [];
    };
    for (const cell of cells) {
        if (!cell) { if (mode !== 'space') flush(); continue; }
        const no = noOf(cell);
        if (no != null) {
            flush();
            /* 숫자가 이어지면(학년·반·번호) 이름 바로 앞 숫자를 번호로 씁니다. */
            pendingNo = no;
            continue;
        }
        const sex = sexOf(cell);
        if (sex) {
            flush();
            if (last && !last.sex && pendingNo == null) last.sex = sex;
            else pendingSex = sex;
            continue;
        }
        const name = nameOf(cell);
        if (name) {
            if (mode !== 'space') flush();
            nameParts.push(name);
            if (mode !== 'space') flush();
            continue;
        }
        /* 생년월일·전화번호·학년반 같은 칸은 넘깁니다. 붙어 있던 이름은 먼저 끝냅니다. */
        flush();
    }
    flush();
    if (pendingNo != null) out.push({ no: pendingNo, name: '', sex: pendingSex });
    return out;
}

/**
 * 붙여 넣은 글을 읽어 미리보기용으로 돌려줍니다.
 * rows: 넣을 학생(번호순). problems: [{ kind, text, line?, no? }].
 * kind: dup(번호 겹침·막음) · empty(이름 빈 번호·넘김) · skip(못 읽은 줄·넘김) · range(번호 범위 밖·넘김) · many(인원 초과·막음)
 */
export function readRosterText(text) {
    const rows = [];
    const problems = [];
    const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
    let nextNo = 1;
    let cols = null;
    lines.forEach((raw, index) => {
        const line = raw.replace(/\s+$/, '');
        if (!line.trim()) return;
        const { mode, cells } = cellsOf(line);
        if (isHeaderRow(cells)) {
            cols = headerColumns(cells) || cols;
            return;
        }
        let found;
        if (cols && mode !== 'space' && cells.length > cols.name) {
            const name = nameOf(cells[cols.name]);
            const no = cols.no >= 0 ? noOf(cells[cols.no]) : null;
            const sex = cols.sex >= 0 ? sexOf(cells[cols.sex]) : '';
            found = name || no != null ? [{ no, name, sex }] : [];
        } else {
            found = pairsOf(cells, mode);
        }
        if (!found.length) {
            problems.push({ kind: 'skip', line: index + 1, text: `${index + 1}번째 줄은 이름을 찾지 못해 넘겨요: ${line.trim().slice(0, 24)}` });
            return;
        }
        for (const item of found) {
            const no = item.no != null ? item.no : nextNo;
            if (!item.name) {
                problems.push({ kind: 'empty', line: index + 1, no, text: `${no}번은 이름이 비어 있어 넘겨요.` });
                nextNo = Math.max(nextNo, no + 1);
                continue;
            }
            if (no < 1 || no > MAX_NO) {
                problems.push({ kind: 'range', line: index + 1, no, text: `${item.name}: 번호는 1번부터 ${MAX_NO}번까지 받아요.` });
                continue;
            }
            rows.push({ no, name: item.name.slice(0, 20), sex: item.sex || '', line: index + 1 });
            nextNo = Math.max(nextNo, no + 1);
        }
    });
    const seen = new Map();
    for (const row of rows) {
        if (seen.has(row.no)) {
            const first = seen.get(row.no);
            row.dup = true;
            first.dup = true;
            problems.push({ kind: 'dup', no: row.no, line: row.line, text: `${row.no}번이 두 번 나왔어요: ${first.name}, ${row.name}` });
        } else seen.set(row.no, row);
    }
    rows.sort((a, b) => a.no - b.no || a.line - b.line);
    if (seen.size > MAX_STUDENTS) problems.push({ kind: 'many', text: `한 반은 ${MAX_STUDENTS}명까지 넣을 수 있어요. 지금 ${seen.size}명이에요.` });
    const blocking = problems.some((p) => p.kind === 'dup' || p.kind === 'many') || !rows.length;
    return { rows, problems, blocking, count: seen.size, overCloud: rows.some((row) => row.no > CLOUD_MAX_NO) };
}

/** 예전부터 쓰던 모양: 겹친 번호는 앞의 것만 넣고, 문제는 글로 돌려줍니다. */
export function parseRoster(text) {
    const read = readRosterText(text);
    const students = [];
    const taken = new Set();
    for (const row of read.rows) {
        if (taken.has(row.no) || taken.size >= MAX_STUDENTS) continue;
        taken.add(row.no);
        students.push({ no: row.no, name: row.name, sex: row.sex || '' });
    }
    return { students, errors: read.problems.map((p) => p.text) };
}

export function isActiveStudent(row) {
    return Boolean(row) && row.active !== false;
}

/** 지금 반 학생(그만둔·지난 명단 학생 빼고), 번호순. */
export function activeStudents(list) {
    return (list || []).filter(isActiveStudent).sort((a, b) => (Number(a.no) || 0) - (Number(b.no) || 0));
}

const viewCache = new WeakMap();
/**
 * 화면에 넘길 자료: students 는 지금 반 학생만, allStudents 는 지난 명단 학생까지.
 * 지난 명단 학생이 없으면 받은 자료를 그대로 돌려줍니다.
 */
export function rosterView(state) {
    if (!state || !Array.isArray(state.students)) return state;
    if (viewCache.has(state)) return viewCache.get(state);
    const view = state.students.some((row) => !isActiveStudent(row))
        ? { ...state, students: activeStudents(state.students), allStudents: state.students }
        : { ...state, allStudents: state.students };
    viewCache.set(state, view);
    return view;
}

function sameName(a, b) {
    return String(a || '').replace(/\s+/g, '') === String(b || '').replace(/\s+/g, '');
}

/** 글자 하나만 다른지(오타 고침으로 볼 만한지). */
function oneEdit(a, b) {
    const x = String(a || '');
    const y = String(b || '');
    if (Math.abs(x.length - y.length) > 1 || x === y) return false;
    let i = 0;
    while (i < x.length && i < y.length && x[i] === y[i]) i += 1;
    if (x.length === y.length) return x.slice(i + 1) === y.slice(i + 1);
    return x.length > y.length ? x.slice(i + 1) === y.slice(i) : x.slice(i) === y.slice(i + 1);
}

function freshId(no, taken, makeId) {
    if (!taken.has(`s${no}`)) return `s${no}`;
    for (let n = 0; n < 20; n += 1) {
        const id = makeId ? makeId(no, n) : `s${no}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        if (!taken.has(id) && /^[A-Za-z0-9_-]{1,40}$/.test(id)) return id;
    }
    return `s${no}-${taken.size}${Date.now().toString(36)}`;
}

/**
 * 지금 학생 목록에 새 명단을 맞춥니다(순수 함수).
 * - 같은 번호·같은 이름: 아이디·메모·생일을 그대로 둡니다.
 * - 같은 번호인데 이름이 다름: 새 아이디(새 학생). 메모·생일은 물려주지 않습니다. keep 에 그 번호가 있으면 이름만 고친 같은 학생으로 봅니다.
 * - 새 명단에 없는 학생: 지우지 않고 지난 명단(active: false)으로 남깁니다. 그래야 기록·출결이 이름과 함께 남고, 클라우드에서 다시 살아나지 않습니다.
 * 돌려주는 값: { students(저장할 전체), changes: [{ no, name, before, kind }] }
 *   kind: same · renamed(이름만 고침, 이어 감) · new(새 번호) · changed(같은 번호 다른 학생) · back(지난 명단에서 다시) · gone(지난 명단으로)
 */
export function planRoster(current, incoming, { keep = [], makeId = null } = {}) {
    const all = (current || []).filter((row) => row && row.id != null);
    const keepSet = new Set((keep || []).map(Number));
    const activeByNo = new Map();
    for (const row of activeStudents(all)) if (!activeByNo.has(Number(row.no))) activeByNo.set(Number(row.no), row);
    const taken = new Set(all.map((row) => String(row.id)));
    const used = new Set();
    const changes = [];
    const next = [];
    for (const row of [...(incoming || [])].sort((a, b) => a.no - b.no)) {
        const no = Number(row.no);
        const old = activeByNo.get(no);
        if (old && !used.has(old.id) && (sameName(old.name, row.name) || keepSet.has(no))) {
            used.add(old.id);
            next.push({ ...old, no, name: row.name, sex: row.sex || old.sex || '', active: true });
            changes.push({ no, name: row.name, before: old.name, kind: sameName(old.name, row.name) ? 'same' : 'renamed' });
            continue;
        }
        /* 지난 명단에 같은 번호·같은 이름이 있으면 그 학생을 다시 씁니다(실수로 뺐다가 다시 넣은 경우). */
        const back = all.find((item) => !isActiveStudent(item) && !used.has(item.id) && Number(item.no) === no && sameName(item.name, row.name));
        if (back) {
            used.add(back.id);
            next.push({ ...back, name: row.name, sex: row.sex || back.sex || '', active: true });
            changes.push({ no, name: row.name, before: '', kind: 'back' });
            continue;
        }
        const id = freshId(no, taken, makeId);
        taken.add(id);
        next.push({ id, no, name: row.name, sex: row.sex || '', birthday: '', active: true, memo: '', source: 'app' });
        changes.push({ no, name: row.name, before: old ? old.name : '', kind: old ? 'changed' : 'new', typo: Boolean(old && oneEdit(old.name, row.name)) });
    }
    const rest = all.filter((row) => !used.has(row.id)).map((row) => {
        if (!isActiveStudent(row)) return row;
        changes.push({ no: Number(row.no), name: row.name, before: row.name, kind: 'gone' });
        return { ...row, active: false };
    });
    changes.sort((a, b) => a.no - b.no || (a.kind === 'gone') - (b.kind === 'gone'));
    return { students: [...next, ...rest], changes };
}

/**
 * 이름이 바뀐 번호 가운데 '이름만 고친 같은 학생'으로 미리 골라 둘 번호.
 * 대부분의 이름이 그대로이고(명단 일부 고침), 글자 하나만 다를 때만 고릅니다. 새 학년도 명단처럼 거의 다 바뀌면 고르지 않습니다.
 */
export function suggestKeep(changes) {
    const matched = (changes || []).filter((c) => c.kind === 'same' || c.kind === 'changed' || c.kind === 'renamed');
    const same = matched.filter((c) => c.kind === 'same').length;
    if (!matched.length || same * 2 < matched.length) return [];
    return matched.filter((c) => c.kind === 'changed' && c.typo).map((c) => c.no);
}
