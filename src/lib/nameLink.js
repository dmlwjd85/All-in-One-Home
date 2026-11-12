/**
 * 본문 속 학생 이름 찾기와 여러 학생 기록 묶음.
 * 다른 모듈을 부르지 않는 순수 함수만 둡니다. 명단은 넘겨받은 배열만 보고, 네트워크로 보내지 않습니다.
 */

/** 성이 두 글자인 경우. 화면의 givenName(bits.jsx)과 같은 목록입니다. */
const TWO_SURNAMES = ['남궁', '황보', '제갈', '사공', '선우', '독고'];

/**
 * 일반 낱말과 겹치는 이름. 이름만 적혀 있으면 칩은 보여 주되 자동으로 연결하지 않습니다.
 * 성까지 적은 이름('이하늘')은 사람이 분명하므로 자동으로 연결합니다.
 */
export const COMMON_NAME_WORDS = new Set([
    '하늘', '나라', '보람', '바다', '사랑', '기쁨', '슬기', '한결', '가람', '노을', '누리', '마루', '나래',
    '아름', '은혜', '소망', '믿음', '소리', '다솜', '하나', '한별', '새봄', '이슬', '구름', '미래', '희망',
    '보배', '우리', '나리', '단비', '새롬', '초롱', '가을', '여름', '겨울', '봄비', '지혜', '진주', '용기',
    '수영', '지원', '지수', '재원', '수정', '정원', '우주', '한솔', '미소', '나은', '시원', '유리', '진리',
    '은총', '태연', '대한', '민국', '이민', '조은', '다운', '한울', '보미', '샛별', '별님', '푸름', '하람',
    '온유', '은솔', '예술', '정의', '성실', '진실', '평화', '자유', '연주', '수아', '한빛', '가온', '다정',
]);

/** 이름 뒤에 붙을 수 있는 조사·호칭·서술 꼬리. 긴 것부터 맞춥니다. */
const TAILS = [
    '이었어요', '이었다', '이에요', '였어요', '이라고', '에게서', '한테서', '이랑', '에게', '한테', '하고', '처럼',
    '보다', '부터', '까지', '으로', '이나', '만큼', '께서', '라고', '였다', '예요', '에요', '이다', '조차', '마저',
    '가', '이', '는', '은', '를', '을', '랑', '와', '과', '도', '만', '의', '께', '아', '야', '로', '네', '나',
    '요', '씨', '님', '뿐', '래', '구', '고',
].sort((a, b) => b.length - a.length);

const HANGUL_RUN = /[가-힣]+/g;

function isSyllable(ch) {
    const code = String(ch || '').charCodeAt(0);
    return code >= 0xac00 && code <= 0xd7a3;
}

/** 받침이 있는 글자인지. '윤'은 참, '나'는 거짓. */
export function hasBatchim(ch) {
    if (!isSyllable(ch)) return false;
    return (ch.charCodeAt(0) - 0xac00) % 28 !== 0;
}

/** 성을 뺀 이름. 세 글자 이상이면 앞 한 글자(두 글자 성은 두 글자)를 뺍니다. 두 글자 이하는 그대로 둡니다. */
export function givenOf(name) {
    const text = String(name || '').trim();
    if (TWO_SURNAMES.some((item) => text.startsWith(item)) && text.length > 3) return text.slice(2);
    return text.length > 2 ? text.slice(1) : text;
}

/** 조사·호칭 꼬리를 두 개까지 이어서 다 먹을 수 있으면 참입니다('가나랑은', '하윤이한테'). */
function tailOk(rest, depth = 0) {
    if (!rest) return true;
    if (depth >= 2) return false;
    for (const tail of TAILS) {
        if (rest.startsWith(tail) && tailOk(rest.slice(tail.length), depth + 1)) return true;
    }
    return false;
}

/**
 * 한글 덩어리(run)가 word로 시작하고, 남은 꼬리가 조사·호칭뿐이면 참입니다.
 * 받침 있는 이름 뒤 '이'('하윤이가', '하윤이는')도 받습니다.
 */
function wordAt(run, word) {
    if (!word || !run.startsWith(word)) return false;
    const rest = run.slice(word.length);
    if (tailOk(rest)) return true;
    if (hasBatchim(word[word.length - 1]) && rest.startsWith('이')) return tailOk(rest.slice(1));
    return false;
}

/** 한 글자 이름: '민이가', '민아', '수야'처럼 호칭이 붙을 때만 칩으로 보여 줍니다. */
function singleAt(run, word) {
    if (word.length !== 1 || !run.startsWith(word)) return false;
    const rest = run.slice(1);
    if (hasBatchim(word)) return /^(이|아)/.test(rest) && (rest === '아' || tailOk(rest.slice(1)));
    return /^야/.test(rest) && rest === '야';
}

function hangulRuns(text) {
    return [...String(text || '').matchAll(HANGUL_RUN)].map((m) => ({ run: m[0], at: m.index }));
}

/**
 * 본문에 나온 학생을 찾습니다. 돌려줌: [{ sid, no, name, label, form, auto, why }]
 *  - form: 'full'(성 포함) · 'given'(성 뺀 이름) · 'short'(한 글자 이름 + 호칭)
 *  - auto: 고르지 않아도 연결해도 되는지. 거짓이면 칩만 보여 주고, 눌러야 연결합니다.
 *  - why: auto가 거짓인 까닭. 'same'(같은 이름이 둘 이상) · 'word'(일반 낱말과 겹침) · 'short'(한 글자 이름)
 *  - label: 같은 이름이 둘 이상이면 '3번 김가나'처럼 번호를 붙입니다.
 * 차례는 글에 처음 나온 순서입니다.
 */
export function findStudentNames(text, students) {
    const roster = (students || [])
        .map((row) => ({ row, name: String(row?.name || '').replace(/\s+/g, '') }))
        .filter((item) => item.name && item.row?.id);
    if (!roster.length) return [];
    const runs = hangulRuns(text);
    const raw = String(text || '');
    const fullCount = new Map();
    const givenCount = new Map();
    for (const { name } of roster) {
        fullCount.set(name, (fullCount.get(name) || 0) + 1);
        const given = givenOf(name);
        givenCount.set(given, (givenCount.get(given) || 0) + 1);
    }
    /* 성 포함 이름을 먼저 찾고, 그 자리는 성 뺀 이름 찾기에서 건너뜁니다('김가나'를 '이가나'의 '가나'로 읽지 않게). */
    const hits = new Map();
    const fullAt = new Set();
    const note = (item, form, at) => {
        const prev = hits.get(item.row.id);
        const rank = { full: 3, given: 2, short: 1 };
        if (prev && rank[prev.form] >= rank[form]) return;
        hits.set(item.row.id, { item, form, at: prev ? Math.min(prev.at, at) : at });
    };
    for (const item of roster) {
        if (/[^가-힣]/.test(item.name)) {
            /* 한글이 아닌 이름(외국 이름 등)은 앞뒤가 글자가 아닐 때만 찾습니다. */
            const escaped = item.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const m = raw.match(new RegExp(`(^|[^A-Za-z가-힣])${escaped}(?![A-Za-z])`, 'i'));
            if (m && item.name.length >= 2) note(item, 'full', m.index + m[1].length);
            continue;
        }
        if (item.name.length < 2) continue;
        for (const { run, at } of runs) {
            if (wordAt(run, item.name)) { note(item, 'full', at); fullAt.add(at); }
        }
    }
    for (const item of roster) {
        if (/[^가-힣]/.test(item.name)) continue;
        const given = givenOf(item.name);
        /* 두 글자 이름('최민')은 뒤 한 글자가 이름입니다. 한 글자 이름은 호칭이 붙을 때만 칩으로 보여 줍니다. */
        const single = item.name.length === 2 ? item.name.slice(1) : (given.length === 1 ? given : '');
        for (const { run, at } of runs) {
            if (fullAt.has(at)) continue;
            if (given.length >= 2 && given !== item.name && wordAt(run, given)) note(item, 'given', at);
            else if (single && singleAt(run, single)) note(item, 'short', at);
        }
    }
    const out = [];
    for (const { item, form, at } of hits.values()) {
        const given = givenOf(item.name);
        let why = '';
        if (form === 'short') why = 'short';
        else if (form === 'full' && fullCount.get(item.name) > 1) why = 'same';
        else if (form === 'given' && givenCount.get(given) > 1) why = 'same';
        else if (form === 'given' && COMMON_NAME_WORDS.has(given)) why = 'word';
        else if (form === 'full' && item.name.length === 2 && COMMON_NAME_WORDS.has(item.name)) why = 'word';
        const dupName = fullCount.get(item.name) > 1 || (form !== 'full' && givenCount.get(given) > 1);
        out.push({
            sid: item.row.id,
            no: Number(item.row.no) || 0,
            name: item.name,
            label: dupName ? `${item.row.no}번 ${item.name}` : item.name,
            form,
            auto: !why,
            why,
            at,
        });
    }
    return out.sort((a, b) => a.at - b.at || a.no - b.no);
}

/**
 * 연결할 학생 아이디. choice는 { [sid]: true|false } 로, 칩을 눌러 바꾼 값입니다.
 * 누른 적 없으면 auto를 따릅니다. 본문에 없어도 choice가 true인 학생(이름 후보에서 고른 학생)은 넣습니다.
 */
export function linkedSids(found, choice = {}) {
    const out = [];
    for (const hit of found || []) {
        const picked = choice[hit.sid];
        if (picked === true || (picked !== false && hit.auto)) out.push(hit.sid);
    }
    return out;
}

/** 칩 옆 작은 안내. 자동 연결하지 않은 까닭입니다. */
export function whyLabel(why) {
    if (why === 'same') return '같은 이름이 있어요';
    if (why === 'word') return '낱말일 수도 있어요';
    if (why === 'short') return '한 글자 이름';
    return '';
}

/**
 * 묶음 기록. 학생마다 같은 내용의 기록을 하나씩 만들고, 아이디 앞부분을 같게 해 서로 찾습니다.
 * 클라우드 규칙의 records 칸(sid 하나)을 바꾸지 않고, 아이디만으로 다른 기기에서도 묶음이 이어집니다.
 * 아이디 모양: grp-<시각>-<임의 5자>-<순번>. 규칙의 id(영문·숫자·-·_ 40자 이하)에 맞습니다.
 */
export function newGroupId(now = Date.now(), random = Math.random) {
    return `grp-${Number(now).toString(36)}-${random().toString(36).slice(2, 7).padEnd(5, '0')}`;
}

export function groupRecordId(groupId, index) {
    return `${groupId}-${index + 1}`;
}

const GROUP_ID = /^(grp-[a-z0-9]+-[a-z0-9]+)-\d{1,2}$/;

/** 기록 아이디에서 묶음 아이디를 꺼냅니다. 묶음이 아니면 ''. */
export function groupOfId(id) {
    const m = String(id || '').match(GROUP_ID);
    return m ? m[1] : '';
}

/** 같은 묶음의 다른 학생 아이디. 기록 목록(records)은 클라우드·이 기기 것을 합친 목록입니다. */
export function groupMates(row, records) {
    const group = groupOfId(row?.id);
    if (!group) return [];
    const sids = [];
    for (const item of records || []) {
        if (item?.id === row.id || groupOfId(item?.id) !== group) continue;
        if (item.sid && item.sid !== row.sid && !sids.includes(item.sid)) sids.push(item.sid);
    }
    return sids;
}
