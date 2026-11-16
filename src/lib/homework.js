/** 과제 체크. 과제 한 건이 메모 문서 하나입니다.
    옛 할 일·메모 화면은 '회의' 태그를 메모로 읽지 않으므로 그 태그를 붙입니다.
    제출은 문서 안의 학생별 맵이고, 합칠 때는 학생마다 나중에 고친 쪽이 이깁니다.
    Firestore 규칙과 저장 키는 바꾸지 않습니다. */
import { isValidYmd } from './date.js';

export const HW_TAG = '과제';
/** 옛 메모 목록이 회의록으로 보고 빼 두는 태그. 값은 minutes.js 의 '회의' 와 같습니다. */
export const HW_HIDE_TAG = '회의';
export const HW_MARK = '@@HW1';
export const HW_TITLE_MAX = 60;
const LEGACY_TEXT = '과제';

export function isHomework(row) {
    if (!row || !/^hw-/.test(String(row.id || ''))) return false;
    const tags = Array.isArray(row.tags) ? row.tags : [];
    return tags.includes(HW_TAG) || tags.includes(HW_HIDE_TAG) || String(row.text || '').includes(HW_MARK) || String(row.text || '') === LEGACY_TEXT;
}

/** 예전 판이 학생마다 만들던 제출 메모. 새 판은 과제 문서 안으로 옮긴 뒤 지웁니다. */
export function isHomeworkCheck(row) {
    return Boolean(row && /^hx-/.test(String(row.id || '')) && Array.isArray(row.tags) && row.tags.includes('제출'));
}

export function isHomeworkNote(row) {
    return isHomework(row) || isHomeworkCheck(row);
}

export function homeworkTitle(row) {
    const title = String(row?.title || '').trim();
    return title || '이름 없는 과제';
}

export function homeworkBody({ made = 0, metaAt = 0, roster = [], checks = {} } = {}) {
    const pack = {
        v: 1,
        made: Number(made) || 0,
        metaAt: Number(metaAt) || 0,
        roster: (roster || []).map(String),
        checks: {},
    };
    for (const [sid, item] of Object.entries(checks || {})) {
        if (!sid) continue;
        pack.checks[sid] = { at: Number(item?.at) || 0, on: item?.on ? 1 : 0 };
    }
    return `과제 체크 기록이에요. 과제 체크 화면에서 봐요.\n${HW_MARK}\n${JSON.stringify(pack)}`;
}

export function readHomeworkPack(row) {
    const text = String(row?.text || '');
    const at = text.indexOf(HW_MARK);
    if (at < 0) return null;
    try {
        const pack = JSON.parse(text.slice(at + HW_MARK.length).trim());
        if (!pack || pack.v !== 1 || typeof pack !== 'object') return null;
        const checks = {};
        for (const [sid, item] of Object.entries(pack.checks || {})) {
            if (!sid || !item || typeof item !== 'object') continue;
            checks[sid] = { at: Number(item.at) || 0, on: item.on ? 1 : 0 };
        }
        return {
            made: Number(pack.made) || 0,
            metaAt: Number(pack.metaAt) || 0,
            roster: Array.isArray(pack.roster) ? pack.roster.map(String).filter(Boolean) : [],
            checks,
        };
    } catch {
        return null;
    }
}

export function packOf(row) {
    const parsed = readHomeworkPack(row);
    if (parsed) return parsed;
    const at = Number(row?.editAt) || 0;
    return { made: at, metaAt: at, roster: [], checks: {} };
}

/** 제목·마감일·명단 스냅샷은 나중에 고친 쪽, 제출은 학생마다 나중에 고친 쪽. */
export function mergeHomeworkRows(localRow, remoteRow) {
    const left = packOf(localRow);
    const right = packOf(remoteRow);
    const checks = { ...left.checks };
    for (const [sid, item] of Object.entries(right.checks || {})) {
        const prev = checks[sid];
        if (!prev || Number(item.at) > Number(prev.at)) checks[sid] = { at: Number(item.at) || 0, on: item.on ? 1 : 0 };
    }
    const useRight = Number(right.metaAt) > Number(left.metaAt);
    const meta = useRight ? right : left;
    const metaRow = useRight ? remoteRow : localRow;
    const madeCandidates = [left.made, right.made].filter((value) => value > 0);
    const made = madeCandidates.length ? Math.min(...madeCandidates) : (meta.made || 0);
    return {
        ...localRow,
        title: String(metaRow?.title || localRow?.title || '').trim().slice(0, HW_TITLE_MAX),
        date: metaRow?.date || localRow?.date || '',
        text: homeworkBody({ ...meta, made, checks, metaAt: Math.max(Number(left.metaAt) || 0, Number(right.metaAt) || 0) }),
        tags: [HW_HIDE_TAG, HW_TAG],
        pinned: false,
        source: localRow?.source || remoteRow?.source || 'app',
    };
}

export function assignmentNote({ id, title, date, roster = [], made = 0 }) {
    const at = Number(made) || 0;
    const cleanTitle = String(title || '').trim().slice(0, HW_TITLE_MAX);
    return {
        id,
        title: cleanTitle,
        date,
        text: homeworkBody({ made: at, metaAt: at, roster, checks: {} }),
        tags: [HW_HIDE_TAG, HW_TAG],
        pinned: false,
        source: 'app',
    };
}

export function homeworkProblem(title, date) {
    if (!String(title || '').trim()) return '과제 이름을 적어 주세요.';
    if (String(title).trim().length > HW_TITLE_MAX) return `이름은 ${HW_TITLE_MAX}자까지예요.`;
    if (!isValidYmd(date)) return '마감일을 골라 주세요.';
    return '';
}

export function homeworkAssignments(notes) {
    return (notes || []).filter(isHomework).sort((a, b) => {
        const made = (packOf(b).made || 0) - (packOf(a).made || 0);
        if (made) return made;
        return String(b.id).localeCompare(String(a.id));
    });
}

export function homeworkRoster(row, students) {
    const pack = packOf(row);
    if (pack.roster.length) return pack.roster;
    return (students || []).map((student) => student?.id).filter(Boolean);
}

export function homeworkProgress(row, students) {
    const roster = homeworkRoster(row, students);
    const checks = packOf(row).checks;
    const submitted = roster.filter((id) => checks[id]?.on).length;
    return { submitted, total: roster.length };
}

export function homeworkProgressLabel({ submitted = 0, total = 0 } = {}) {
    return `제출 ${submitted}/${total}`;
}

export function homeworkOverdue(date, today) {
    return Boolean(date && today && date < today);
}

/** 검색어가 있으면 지난 과제도 찾고, 없으면 지난 과제는 접어 둡니다. */
export function visibleHomework(notes, { today = '', query = '', showPast = false } = {}) {
    const rows = homeworkAssignments(notes);
    const q = String(query || '').trim();
    if (q) return rows.filter((row) => homeworkTitle(row).includes(q));
    if (showPast) return rows;
    return rows.filter((row) => !row.date || row.date >= today);
}

export function pastHomework(notes, today) {
    return homeworkAssignments(notes).filter((row) => row.date && today && row.date < today);
}

/**
 * 학생마다 나뉘어 있던 옛 제출 메모를 과제 문서 안으로 옮깁니다.
 * 과제가 이미 지워진 제출 메모는 되살리지 않고 빼 둡니다.
 */
export function foldHomeworkLists(cloudNotes = [], localNotes = []) {
    const tagged = [
        ...(cloudNotes || []).map((row) => ({ row, local: false })),
        ...(localNotes || []).map((row) => ({ row, local: true })),
    ];
    const removed = [];
    const extras = new Map();
    for (const item of tagged) {
        if (!isHomeworkCheck(item.row)) continue;
        removed.push(item.row);
        const assign = String(item.row.title || '');
        const sid = String(item.row.text || '').trim();
        if (!assign || !sid) continue;
        const bag = extras.get(assign) || [];
        bag.push({ sid, at: Number(item.row.editAt) || 0, on: 1 });
        extras.set(assign, bag);
    }
    const cloud = [];
    const local = [];
    let changed = removed.length > 0;
    for (const item of tagged) {
        if (isHomeworkCheck(item.row)) continue;
        let row = item.row;
        if (isHomework(row)) {
            const pack = packOf(row);
            for (const extra of extras.get(row.id) || []) {
                const prev = pack.checks[extra.sid];
                if (!prev || extra.at >= Number(prev.at)) pack.checks[extra.sid] = { at: extra.at, on: 1 };
            }
            extras.delete(row.id);
            const next = {
                ...row,
                text: homeworkBody(pack),
                tags: [HW_HIDE_TAG, HW_TAG],
                pinned: false,
                source: row.source || 'app',
            };
            if (next.text !== row.text || JSON.stringify(next.tags) !== JSON.stringify(row.tags || [])) changed = true;
            row = next;
        }
        (item.local ? local : cloud).push(row);
    }
    return { cloud, local, removed, changed };
}

export function withCheck(row, sid, on, at) {
    const pack = packOf(row);
    pack.checks[sid] = { at: Number(at) || 0, on: on ? 1 : 0 };
    return {
        ...row,
        text: homeworkBody(pack),
        tags: [HW_HIDE_TAG, HW_TAG],
        pinned: false,
    };
}

export function withAllSubmitted(row, sids, at) {
    const pack = packOf(row);
    const stamp = Number(at) || 0;
    for (const sid of sids || []) {
        if (!sid || pack.checks[sid]?.on) continue;
        pack.checks[sid] = { at: stamp, on: 1 };
    }
    return { ...row, text: homeworkBody(pack), tags: [HW_HIDE_TAG, HW_TAG], pinned: false };
}

export function withMeta(row, { title, date, at }) {
    const pack = packOf(row);
    pack.metaAt = Number(at) || pack.metaAt || 0;
    return {
        ...row,
        title: title != null ? String(title).trim().slice(0, HW_TITLE_MAX) : row.title,
        date: date != null ? date : row.date,
        text: homeworkBody(pack),
        tags: [HW_HIDE_TAG, HW_TAG],
        pinned: false,
    };
}
