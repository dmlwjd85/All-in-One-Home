import { detectDate } from '../lib/parse.js';

/** 분류 강조는 글이 잠깐 멈춘 뒤에만 바꿉니다. */
export const SUGGEST_WAIT = 150;

export const SPEECH_FALLBACK = '키보드의 마이크 버튼으로 받아쓰기를 할 수 있어요.';
export const SPEECH_CLOUD = '음성은 브라우저가 Apple이나 Google 서버로 보낼 수 있어요.';
export const SPEECH_LOCAL = '이 기기 안에서 음성을 글자로 바꿉니다.';

const CHOSEONG = ['ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];

const SCHEDULE = /내일|모레|글피|(?:[월화수목금토일])요일|\d{1,2}\s*시(?!간)|(?<!\d)\d{1,2}\s*[./]\s*\d{1,2}(?!\d)|\d{1,2}\s*교시|\d{1,2}\s*월\s*\d{1,2}\s*일/;
const TASK = /하기|제출|보내기/;

export function choseongOf(text) {
    let out = '';
    for (const ch of String(text || '')) {
        const code = ch.charCodeAt(0);
        if (code >= 0xac00 && code <= 0xd7a3) out += CHOSEONG[Math.floor((code - 0xac00) / 588)];
        else out += ch;
    }
    return out;
}

function trailingToken(text) {
    const match = String(text || '').match(/[가-힣ㄱ-ㅎㅏ-ㅣ]+$/);
    return match ? match[0] : '';
}

/** 명단은 넘겨받은 배열만 봅니다. 네트워크로 보내지 않습니다. */
export function nameCandidates(text, students) {
    const token = trailingToken(text);
    if (!token) return [];
    const choseongQuery = /^[ㄱ-ㅎ]+$/.test(token);
    const hits = [];
    for (const row of students || []) {
        const name = String(row?.name || '').trim();
        if (name.length < 2) continue;
        const matched = choseongQuery ? choseongOf(name).startsWith(token) : name.startsWith(token);
        if (!matched) continue;
        hits.push({ no: row.no, id: row.id, name });
        if (hits.length >= 8) break;
    }
    return hits;
}

function namedStudents(text, students) {
    const raw = String(text || '');
    return (students || []).filter((row) => {
        const name = String(row?.name || '').trim();
        return name.length >= 2 && raw.includes(name);
    });
}

/**
 * 강조만 고릅니다. 저장하지 않습니다.
 * 학생 이름이 있으면 관찰, 날짜·시간이 있으면 일정, 하기·제출·보내기가 있으면 할 일입니다.
 */
export function suggestKind(text, students) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    if (namedStudents(raw, students).length) return '관찰';
    if (SCHEDULE.test(raw)) return '일정';
    if (TASK.test(raw)) return '할 일';
    return '';
}

/** 고른 학생이 글에 남아 있으면 그 번호, 이름 하나뿐이면 그 번호입니다. */
export function studentNoFor(text, students, picked) {
    const raw = String(text || '');
    if (picked && String(picked.name || '').length >= 2 && raw.includes(picked.name)) return Number(picked.no) || 0;
    const hits = namedStudents(raw, students);
    if (hits.length === 1) return Number(hits[0].no) || 0;
    return 0;
}

/**
 * 일정은 글에서 읽힌 날짜를 씁니다. 내일은 일지가 아니라 오늘(한국 시각)의 다음 날입니다.
 * 3시·3교시처럼 시각만 있으면 날짜는 바꾸지 않습니다.
 */
export function quickSaveDate(kind, text, fallback, now = new Date()) {
    if (kind === '일정') {
        const found = detectDate(text, now);
        if (found) return found;
    }
    return fallback;
}
