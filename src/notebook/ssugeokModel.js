import { TAGS } from './labels.js';

/** 건강·민원·학폭은 클라우드로 올리지 않습니다. */
const SENSITIVE_RE = /건강|보건|알레르기|투약|복약|분리\s*급식|민원|학폭|학교폭력/;
const SENSITIVE_TAGS = new Set(['보건', '건강', '학폭', '민원', '알레르기']);

export function whoPage(studentNo) {
    return 158 + Number(studentNo) * 2;
}

export function counselPage(studentNo) {
    return 256 + Number(studentNo);
}

export function parentPage(studentNo) {
    return 288 + Number(studentNo);
}

export function isSensitiveText(text, tags = []) {
    if (SENSITIVE_RE.test(String(text || ''))) return true;
    return tags.some((tag) => SENSITIVE_TAGS.has(tag));
}

function pad(n) {
    return String(n).padStart(2, '0');
}

function ymd(date) {
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** 본문에서 날짜를 하나 고릅니다. 월만 있으면 2026학년도(3월~다음해 2월)로 봅니다. */
export function detectDate(text, now = new Date()) {
    const raw = String(text || '');
    if (raw.includes('모레')) {
        const d = new Date(now);
        d.setDate(d.getDate() + 2);
        return ymd(d);
    }
    if (raw.includes('내일')) {
        const d = new Date(now);
        d.setDate(d.getDate() + 1);
        return ymd(d);
    }
    if (raw.includes('오늘')) return ymd(now);
    const full = raw.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
    if (full) return `${full[1]}-${pad(full[2])}-${pad(full[3])}`;
    const korean = raw.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    const slash = raw.match(/(?:^|\s)(\d{1,2})\s*\/\s*(\d{1,2})(?:\s|$)/);
    const hit = korean || slash;
    if (!hit) return null;
    const month = Number(hit[1]);
    const day = Number(hit[2]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const year = month >= 3 ? 2026 : 2027;
    return `${year}-${pad(month)}-${pad(day)}`;
}

export function parseNote(text) {
    const raw = String(text || '');
    const tags = [...raw.matchAll(/#([0-9A-Za-z가-힣_]+)/g)].map((m) => m[1]);
    const at = raw.match(/@(\d{1,2})/);
    const studentNo = at ? Number(at[1]) : null;
    const safeNo = studentNo >= 1 && studentNo <= 32 ? studentNo : null;
    return {
        tags,
        studentNo: safeNo,
        detectedDate: detectDate(raw),
        sensitive: isSensitiveText(raw, tags),
    };
}

function pack(destId, parsed, reason) {
    const base = {
        who: { label: '누가기록', tone: 'butter', needsStudent: true },
        counsel: { label: '상담기록', tone: 'mint', needsStudent: true },
        parent: { label: '보호자 상담', tone: 'mint', needsStudent: true },
        attend: { label: '출결', tone: 'mint', needsStudent: false, page: 231 },
        todo: { label: '업무 할 일', tone: 'lavender', needsStudent: false, page: 411 },
        deadline: { label: '기한 있는 일', tone: 'lavender', needsStudent: false, page: 405 },
        meeting: { label: '회의록', tone: 'lavender', needsStudent: false, page: 417 },
        progress: { label: '수업 · 진도', tone: 'lavender', needsStudent: false, page: 336 },
        budget: { label: '예산', tone: 'lavender', needsStudent: false, page: 468 },
        special: { label: '특별한 하루', tone: 'peach', needsStudent: false, page: 99 },
        tag: { label: '태그', tone: 'butter', needsStudent: false, page: 9 },
    }[destId];
    let page = base.page;
    if (destId === 'who') page = parsed.studentNo ? whoPage(parsed.studentNo) : 154;
    if (destId === 'counsel') page = parsed.studentNo ? counselPage(parsed.studentNo) : 256;
    if (destId === 'parent') page = parsed.studentNo ? parentPage(parsed.studentNo) : 256;
    const label = parsed.studentNo && base.needsStudent
        ? `${parsed.studentNo}번 ${base.label}`
        : base.label;
    return { destId, page, label, tone: base.tone, reason, needsStudent: base.needsStudent };
}

/** 키워드·태그·@번호로 옮길 곳을 고릅니다. 자동으로 옮기지는 않습니다. */
export function suggestDestination(text, parsed) {
    const tags = parsed?.tags || [];
    if (tags.includes('행발') || /누가|관찰|행발/.test(text)) return pack('who', parsed, '#행발 · 누가기록');
    if (tags.includes('상담') || /상담|면담/.test(text)) return pack('counsel', parsed, '상담 이야기');
    if (tags.includes('학부모') || /보호자|학부모/.test(text)) return pack('parent', parsed, '보호자 상담');
    if (/출결|결석|지각|조퇴/.test(text) || tags.includes('출결')) return pack('attend', parsed, '출결');
    if (/기한|마감|제출/.test(text) || tags.includes('마감')) return pack('deadline', parsed, '기한이 있어요');
    if (/회의/.test(text) || tags.includes('회의')) return pack('meeting', parsed, '회의');
    if (/예산|품의|구입/.test(text) || tags.includes('예산')) return pack('budget', parsed, '예산');
    if (/진도|수업|단원/.test(text) || tags.includes('수업') || tags.includes('평가')) return pack('progress', parsed, '수업');
    if (/할\s*일|업무/.test(text)) return pack('todo', parsed, '할 일');
    if (/행사|체험|특별한\s*하루/.test(text) || tags.includes('행사')) return pack('special', parsed, '특별한 하루');
    const sensitiveTag = /민원/.test(text) ? '민원'
        : /학폭|학교폭력/.test(text) ? '학폭'
            : /보건|알레르기|투약|복약|건강/.test(text) ? '보건'
                : '';
    if (sensitiveTag) {
        const known = TAGS.find((t) => t.id === sensitiveTag);
        if (known) {
            return {
                destId: 'tag',
                page: known.page,
                label: `#${sensitiveTag}`,
                tone: 'butter',
                reason: '이 기기에만 두는 기록',
                needsStudent: false,
            };
        }
    }
    for (const tag of tags) {
        const known = TAGS.find((t) => t.id === tag);
        if (known) {
            return {
                destId: 'tag',
                page: known.page,
                label: `#${tag}`,
                tone: 'butter',
                reason: '태그 색인',
                needsStudent: false,
            };
        }
    }
    return pack('todo', parsed, '일단 업무 할 일에 두기');
}

export function noteStatus(note) {
    if (note?.status === 'sorted' || note?.status === 'archived') return note.status;
    return 'inbox';
}

export function presentNote(note) {
    const parsed = parseNote(note?.text || '');
    const tags = Array.isArray(note?.tags) && note.tags.length ? note.tags : parsed.tags;
    const studentNo = note?.studentNo ?? parsed.studentNo;
    const detectedDate = note?.detectedDate ?? parsed.detectedDate;
    const sensitive = Boolean(note?.sensitive) || isSensitiveText(note?.text, tags);
    const parsedFull = { tags, studentNo, detectedDate, sensitive };
    const suggestion = note?.suggestion?.destId
        ? note.suggestion
        : suggestDestination(note?.text || '', parsedFull);
    return {
        ...note,
        tags,
        studentNo,
        detectedDate,
        sensitive,
        suggestion,
        status: noteStatus(note),
    };
}

/** 옮기기 직전에 고른 번호로 쪽을 다시 잡습니다. */
export function placeSuggestion(suggestion, studentNo) {
    if (!suggestion) return suggestion;
    const no = Number(studentNo);
    if (!suggestion.needsStudent || !(no >= 1 && no <= 32)) return suggestion;
    const page = suggestion.destId === 'counsel'
        ? counselPage(no)
        : suggestion.destId === 'parent'
            ? parentPage(no)
            : whoPage(no);
    const base = String(suggestion.label || '').replace(/^\d+번\s*/, '');
    return { ...suggestion, page, label: `${no}번 ${base}` };
}

export function destinationFor(destId, parsed) {
    return pack(destId, parsed || {}, '직접 고름');
}

export function formatStamp(iso) {
    let d;
    if (iso && typeof iso.toDate === 'function') d = iso.toDate();
    else if (iso && typeof iso.seconds === 'number') d = new Date(iso.seconds * 1000);
    else d = new Date(iso || '');
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const QUIET_DAYS = 21;

function stampOf(note) {
    return note?.placement?.sortedAt || note?.createdAt || '';
}

/** 최근 누가기록이 없는 번호. 아무도 없으면 빈 배열(안내 문구만). */
export function quietStudents(notes, pageNotesByStudent = {}) {
    const last = new Map();
    const mark = (no, iso) => {
        if (!no || !iso) return;
        const prev = last.get(no);
        if (!prev || String(iso) > String(prev)) last.set(no, iso);
    };
    for (const note of notes || []) {
        if (noteStatus(note) === 'archived') continue;
        const toWho = note?.placement?.destId === 'who' || (note?.tags || []).includes('행발');
        if (!toWho || noteStatus(note) !== 'sorted') continue;
        mark(note.studentNo, stampOf(note));
    }
    for (const [no, list] of Object.entries(pageNotesByStudent)) {
        for (const item of list || []) mark(Number(no), item.sortedAt || item.date || '');
    }
    if (last.size === 0) return [];
    const cutoff = Date.now() - QUIET_DAYS * 86400000;
    const quiet = [];
    for (let n = 1; n <= 32; n += 1) {
        const iso = last.get(n);
        const time = iso ? Date.parse(iso.length === 10 ? `${iso}T12:00:00` : iso) : NaN;
        if (!iso || Number.isNaN(time) || time < cutoff) quiet.push(n);
    }
    return quiet;
}
