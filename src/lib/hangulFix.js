/**
 * 글자 인식이 닮은 글자로 잘못 읽은 메뉴 이름을 낱말 목록에 맞춰 바로잡습니다.
 *
 * 방법: 이름을 목록 낱말들의 이어 붙임으로 풀이합니다. 낱말과 글자 수가 같은 조각은
 * 초성·중성·종성이 몇 군데 다른지 세어, 조금만 다르면 그 낱말로 봅니다('짝두기' → '깍두기', '새우부음밥' → '새우' + '볶음밥').
 *
 * 함부로 고치지 않으려고 지키는 것
 *  - 이름 전체가 목록 낱말로 풀릴 때만 고칩니다. 모르는 글자가 하나라도 남으면 그대로 둡니다('가자미구이'를 '감자…'로 바꾸지 않음).
 *  - 고친 자리 수가 이름 길이에 견주어 적을 때만 고칩니다(두 글자 이름은 한 군데, 세 글자는 두 군데, 그 위는 세 군데까지).
 *  - 닮은 낱자끼리 바뀐 것만 고칩니다(ㅁ↔ㅇ, ㅉ↔ㄲ, ㅜ↔ㅗ …). '녹두밥'을 '호두밥'으로, '쌀국수'를 '칼국수'로 바꾸지 않습니다.
 *  - 한 글자 낱말(국·밥·귤)은 그대로 맞을 때만 씁니다.
 *  - 같은 값으로 다른 이름이 둘 나오면(어느 쪽인지 모르면) 그대로 둡니다.
 */
import { MEAL_WORDS } from './mealWords.js';

const BASE = 0xac00;

/** 한글 한 글자를 [초성, 중성, 종성] 번호로. 한글 음절이 아니면 null. */
export function jamoOf(ch) {
    const code = String(ch || '').charCodeAt(0) - BASE;
    if (!(code >= 0 && code < 11172)) return null;
    return [Math.floor(code / 588), Math.floor((code % 588) / 28), code % 28];
}

const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ' ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ';

/* 글자 인식이 실제로 헷갈리는 닮은 낱자 묶음. 이 묶음 안에서 바뀐 것만 '잘못 읽음'으로 봅니다.
 * 닮지 않은 낱자가 다르면(녹두 ↔ 호두, 쌀 ↔ 칼) 다른 낱말이므로 고치지 않습니다. */
function pairs(alphabet, groups) {
    const set = new Set();
    for (const group of groups) {
        for (const a of group) for (const b of group) if (a !== b) set.add(alphabet.indexOf(a) * 64 + alphabet.indexOf(b));
    }
    return set;
}
const CHO_NEAR = pairs(CHO, ['ㄱㄲㅋ', 'ㄷㄸㅌ', 'ㅂㅃㅍ', 'ㅁㅂ', 'ㅁㅇ', 'ㅇㅎ', 'ㅅㅆㅈㅉㅊ', 'ㄲㅉ']);
const JUNG_NEAR = pairs(JUNG, ['ㅏㅑ', 'ㅓㅕ', 'ㅏㅣ', 'ㅓㅣ', 'ㅐㅔㅒㅖ', 'ㅏㅐ', 'ㅓㅔ', 'ㅓㅐ', 'ㅗㅛㅜㅠㅡ', 'ㅘㅙㅚ', 'ㅝㅞㅟ', 'ㅡㅢ', 'ㅣㅢ']);
const JONG_NEAR = pairs(JONG, ['ㄱㄲㅋㄳ', 'ㅁㅇㅂ', 'ㄹㅁㅂ', 'ㅇㅎ', 'ㅅㅆㅈㅊ', 'ㄴㄹㄷㅌ', 'ㄹㄺㄻㄼ', 'ㄴㄵㄶ']);

/** 두 글자가 닮은 낱자 몇 군데로 다른지. 닮지 않은 낱자가 다르면 9(다른 글자). */
function syllableDiff(a, b) {
    if (a === b) return 0;
    const x = jamoOf(a);
    const y = jamoOf(b);
    if (!x || !y) return 9;
    let diff = 0;
    if (x[0] !== y[0]) { if (!CHO_NEAR.has(x[0] * 64 + y[0])) return 9; diff += 1; }
    if (x[1] !== y[1]) { if (!JUNG_NEAR.has(x[1] * 64 + y[1])) return 9; diff += 1; }
    if (x[2] !== y[2]) { if (!JONG_NEAR.has(x[2] * 64 + y[2])) return 9; diff += 1; }
    return diff;
}

const byLength = new Map();
for (const word of MEAL_WORDS) {
    const list = byLength.get(word.length) || [];
    list.push(word);
    byLength.set(word.length, list);
}
const KNOWN = new Set(MEAL_WORDS);

function maxEdits(length) {
    if (length <= 1) return 0;
    if (length === 2) return 1;
    if (length === 3) return 2;
    return 3;
}

/** 한글만 이어진 이름 하나를 풀이합니다. 돌려줌: { text, edits } 또는 null(고칠 수 없음·고칠 필요 없음). */
function solve(run) {
    const n = run.length;
    if (n < 2 || n > 12) return null;
    /* best[i]: 앞 i 글자를 낱말로 푼 가장 싼 값. ties: 같은 값으로 나온 서로 다른 글(둘이면 모호). */
    const best = Array.from({ length: n + 1 }, () => null);
    best[0] = { cost: 0, text: '', parts: 0, ties: new Set(['']) };
    for (let i = 0; i < n; i += 1) {
        const from = best[i];
        if (!from) continue;
        for (let len = 1; len <= Math.min(7, n - i); len += 1) {
            const words = byLength.get(len);
            if (!words) continue;
            const piece = run.slice(i, i + len);
            for (const word of words) {
                let diff = 0;
                let changed = 0;
                for (let k = 0; k < len && diff <= 3; k += 1) {
                    const d = syllableDiff(piece[k], word[k]);
                    diff += d;
                    if (d) changed += 1;
                }
                /* 한 낱말 안에서 바뀐 글자는 절반까지만('고기'를 '쿠키'로 바꾸지 않음). */
                if (diff > 3 || changed > Math.floor(len / 2)) continue;
                /* 낱말을 잘게 쪼갤수록 우연히 맞기 쉬우므로 조각마다 아주 작은 값을 더합니다. */
                const cost = from.cost + diff + 0.01;
                const text = from.text + word;
                const cur = best[i + len];
                if (!cur || cost < cur.cost - 1e-9) best[i + len] = { cost, text, parts: from.parts + 1, ties: new Set([text]) };
                else if (Math.abs(cost - cur.cost) < 1e-9) cur.ties.add(text);
            }
        }
    }
    const end = best[n];
    if (!end) return null;
    const edits = Math.round(end.cost - end.parts * 0.01);
    if (edits === 0 || edits > maxEdits(n)) return null;
    if (end.ties.size > 1) return null;
    return { text: end.text, edits };
}

/**
 * 메뉴 이름 하나를 바로잡습니다. 한글이 아닌 글자(&, /, 숫자, 괄호)는 그대로 두고 한글 덩어리만 봅니다.
 * 돌려줌: { name, fixed, from } — fixed 가 true 면 from 이 읽힌 그대로의 글입니다.
 */
export function fixMenuName(name) {
    const src = String(name || '');
    let changed = false;
    const out = src.replace(/[가-힣]+/g, (run) => {
        if (KNOWN.has(run)) return run;
        const hit = solve(run);
        if (!hit) return run;
        changed = true;
        return hit.text;
    });
    return changed ? { name: out, fixed: true, from: src } : { name: src, fixed: false, from: '' };
}

/** 목록 낱말만으로 그대로 풀리는 이름인지(읽은 글을 믿어도 되는지 가늠할 때 씁니다). */
export function isKnownMenu(name) {
    const runs = String(name || '').match(/[가-힣]+/g) || [];
    if (!runs.length) return false;
    return runs.every((run) => {
        if (KNOWN.has(run)) return true;
        const n = run.length;
        const ok = Array(n + 1).fill(false);
        ok[0] = true;
        for (let i = 0; i < n; i += 1) {
            if (!ok[i]) continue;
            for (let len = 1; len <= Math.min(7, n - i); len += 1) if (KNOWN.has(run.slice(i, i + len))) ok[i + len] = true;
        }
        return ok[n];
    });
}
