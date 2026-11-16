/** 과제 체크. users/{uid}/homework 문서 하나에 과제와 학생별 제출을 둡니다.
    노트·할 일·회의록이 아니므로 옛 판(v90)의 목록에 나오지 않습니다.
    올릴 때는 바뀐 칸만 고치고, 제출은 학생마다 나중에 고친 쪽이 이깁니다.
    지운 시각이 체크 시각보다 나중이면 지운 쪽이 이깁니다. */
import { isValidYmd } from './date.js';

export const HW_MARK = '@@HW1';
export const HW_TITLE_MAX = 60;
const LEGACY_TEXT = '과제';

export function isHomeworkDoc(row) {
    return Boolean(row && /^hw-/.test(String(row.id || '')) && row.checks && typeof row.checks === 'object' && Array.isArray(row.roster));
}

/** 예전 판이 메모·회의록 문서에 남겨 둔 과제. 새 문서로 옮긴 뒤 노트에서는 지웁니다. */
export function isLegacyHomeworkNote(row) {
    if (!row || !/^hw-/.test(String(row.id || '')) || isHomeworkDoc(row)) return false;
    const tags = Array.isArray(row.tags) ? row.tags : [];
    return tags.includes('과제') || tags.includes('회의') || String(row.text || '').includes(HW_MARK) || String(row.text || '') === LEGACY_TEXT;
}

export function isHomework(row) {
    return isHomeworkDoc(row) || isLegacyHomeworkNote(row);
}

export function isHomeworkCheck(row) {
    return Boolean(row && /^hx-/.test(String(row.id || '')) && Array.isArray(row.tags) && row.tags.includes('제출'));
}

export function isHomeworkNote(row) {
    return isLegacyHomeworkNote(row) || isHomeworkCheck(row);
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
    if (isHomeworkDoc(row)) {
        const checks = {};
        for (const [sid, item] of Object.entries(row.checks || {})) {
            if (!sid || !item) continue;
            checks[sid] = { at: Number(item.at) || 0, on: item.on ? 1 : 0 };
        }
        return {
            made: Number(row.made) || 0,
            metaAt: Number(row.metaAt) || 0,
            roster: row.roster.map(String).filter(Boolean),
            checks,
        };
    }
    const parsed = readHomeworkPack(row);
    if (parsed) return parsed;
    const at = Number(row?.editAt) || 0;
    return { made: at, metaAt: at, roster: [], checks: {} };
}

export function encodeCheck(item) {
    if (!item) return '';
    return `${item.on ? 1 : 0}~${Number(item.at) || 0}`;
}

export function decodeCheck(value) {
    const match = /^([01])~([0-9]{1,13})$/.exec(String(value || ''));
    if (!match) return null;
    return { on: match[1] === '1' ? 1 : 0, at: Number(match[2]) || 0 };
}

export function encodeChecks(checks = {}) {
    const out = {};
    for (const [sid, item] of Object.entries(checks || {})) {
        if (!sid || !item) continue;
        out[sid] = encodeCheck(item);
    }
    return out;
}

export function decodeChecks(raw) {
    const checks = {};
    if (!raw || typeof raw !== 'object') return checks;
    for (const [sid, value] of Object.entries(raw)) {
        const item = decodeCheck(value);
        if (item) checks[sid] = item;
    }
    return checks;
}

export function homeworkFromDoc(id, data = {}) {
    if (!data || typeof data !== 'object') return null;
    const at = typeof data.updatedAt?.toMillis === 'function' ? data.updatedAt.toMillis() : 0;
    return {
        id,
        title: String(data.title || '').trim().slice(0, HW_TITLE_MAX),
        date: String(data.date || ''),
        made: Number(data.made) || 0,
        metaAt: Number(data.metaAt) || 0,
        roster: Array.isArray(data.roster) ? data.roster.map(String).filter(Boolean) : [],
        checks: decodeChecks(data.checks),
        gone: Number(data.gone) || 0,
        editAt: at,
    };
}

/** 제목·마감일은 나중에 고친 쪽, 명단은 양쪽을 합치고, 제출은 학생마다 나중에 고친 쪽. */
export function mergeHomework(local, remote) {
    if (!local) return remote ? { ...remote } : null;
    if (!remote) return { ...local };
    const checks = {};
    for (const [sid, item] of Object.entries(local.checks || {})) checks[sid] = { at: Number(item.at) || 0, on: item.on ? 1 : 0 };
    for (const [sid, item] of Object.entries(remote.checks || {})) {
        const prev = checks[sid];
        const at = Number(item?.at) || 0;
        if (!prev || at > Number(prev.at)) checks[sid] = { at, on: item.on ? 1 : 0 };
    }
    const useRemote = Number(remote.metaAt) > Number(local.metaAt);
    const meta = useRemote ? remote : local;
    const madeCandidates = [Number(local.made) || 0, Number(remote.made) || 0].filter((value) => value > 0);
    const gone = Math.max(Number(local.gone) || 0, Number(remote.gone) || 0);
    return {
        id: local.id || remote.id,
        title: String(meta.title || local.title || remote.title || '').trim().slice(0, HW_TITLE_MAX),
        date: meta.date || local.date || remote.date || '',
        made: madeCandidates.length ? Math.min(...madeCandidates) : 0,
        metaAt: Math.max(Number(local.metaAt) || 0, Number(remote.metaAt) || 0),
        roster: [...new Set([...(local.roster || []), ...(remote.roster || [])].map(String).filter(Boolean))],
        checks,
        /* 체크만으로는 되살리지 않습니다. 이름·마감일·되돌리기처럼 metaAt 이 지운 시각보다 뒤일 때만 살아납니다. */
        gone: gone > 0 && gone >= Math.max(Number(local.metaAt) || 0, Number(remote.metaAt) || 0) ? gone : 0,
        editAt: Math.max(Number(local.editAt) || 0, Number(remote.editAt) || 0),
    };
}

/** 이미 있는 문서는 바뀐 칸만 고칩니다. 제출 맵 전체를 갈아끼우지 않습니다. */
export function homeworkPatch(remote, merged) {
    if (!merged) return null;
    if (!remote) {
        return {
            title: String(merged.title || '').trim().slice(0, HW_TITLE_MAX) || '이름 없는 과제',
            date: merged.date,
            made: Number(merged.made) || 0,
            metaAt: Number(merged.metaAt) || 0,
            roster: [...(merged.roster || [])],
            checks: encodeChecks(merged.checks),
            gone: Number(merged.gone) || 0,
        };
    }
    const patch = {};
    if (String(remote.title || '') !== String(merged.title || '')) patch.title = String(merged.title || '').trim().slice(0, HW_TITLE_MAX) || '이름 없는 과제';
    if (String(remote.date || '') !== String(merged.date || '')) patch.date = merged.date || remote.date;
    if (Number(remote.made) !== Number(merged.made)) patch.made = Number(merged.made) || 0;
    if (Number(remote.metaAt) !== Number(merged.metaAt)) patch.metaAt = Number(merged.metaAt) || 0;
    if (Number(remote.gone) !== Number(merged.gone)) patch.gone = Number(merged.gone) || 0;
    if ((remote.roster || []).join('\n') !== (merged.roster || []).join('\n')) patch.roster = [...(merged.roster || [])];
    for (const [sid, item] of Object.entries(merged.checks || {})) {
        if (encodeCheck(remote.checks?.[sid]) !== encodeCheck(item)) patch[`checks.${sid}`] = encodeCheck(item);
    }
    return Object.keys(patch).length ? patch : null;
}

export function mergeHomeworkRows(localRow, remoteRow) {
    const merged = mergeHomework(docFromLegacy(localRow), docFromLegacy(remoteRow));
    if (isHomeworkDoc(localRow) && isHomeworkDoc(remoteRow)) return merged;
    /* 아직 노트에 있는 옛 과제는 본문만 합칩니다. 받기가 끝나면 노트에서 과제 문서로 옮깁니다. */
    return {
        ...localRow,
        title: merged.title,
        date: merged.date,
        text: homeworkBody(merged),
        tags: Array.isArray(localRow?.tags) && localRow.tags.length ? localRow.tags : ['과제'],
        pinned: false,
        editAt: merged.editAt,
    };
}

function docFromLegacy(row) {
    const pack = packOf(row);
    return {
        id: row?.id,
        title: row?.title || '',
        date: row?.date || '',
        made: pack.made,
        metaAt: pack.metaAt,
        roster: pack.roster,
        checks: pack.checks,
        gone: Number(row?.gone) || 0,
        editAt: Number(row?.editAt) || 0,
    };
}

export function newHomework({ id, title, date, roster = [], made = 0 }) {
    const at = Number(made) || 0;
    return {
        id,
        title: String(title || '').trim().slice(0, HW_TITLE_MAX),
        date,
        made: at,
        metaAt: at,
        roster: [...roster].map(String).filter(Boolean),
        checks: {},
        gone: 0,
        editAt: at,
    };
}

export function homeworkProblem(title, date) {
    if (!String(title || '').trim()) return '과제 이름을 적어 주세요.';
    if (String(title).trim().length > HW_TITLE_MAX) return `이름은 ${HW_TITLE_MAX}자까지예요.`;
    if (!isValidYmd(date)) return '마감일을 골라 주세요.';
    return '';
}

export function homeworkAssignments(rows) {
    return (rows || []).filter((row) => isHomework(row) && !(Number(row.gone) > 0)).sort((a, b) => {
        const made = (packOf(b).made || 0) - (packOf(a).made || 0);
        if (made) return made;
        return String(b.id).localeCompare(String(a.id));
    });
}

export function homeworkRoster(row, students) {
    const roster = packOf(row).roster;
    if (roster.length) return roster;
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

export function visibleHomework(rows, { today = '', query = '', showPast = false } = {}) {
    const list = homeworkAssignments(rows);
    const q = String(query || '').trim();
    if (q) return list.filter((row) => homeworkTitle(row).includes(q));
    if (showPast) return list;
    return list.filter((row) => !row.date || row.date >= today);
}

export function pastHomework(rows, today) {
    return homeworkAssignments(rows).filter((row) => row.date && today && row.date < today);
}

function putHomework(list, row) {
    const index = list.findIndex((item) => item?.id === row.id);
    if (index >= 0) list[index] = mergeHomework(list[index], row);
    else list.push(row);
}

/**
 * 노트에 남아 있는 hw-/hx- 와 회의 태그 과제를 과제 문서로 옮깁니다.
 * 본문을 옛 판이 망가뜨린 경우에는 이미 있는 제출을 비우지 않습니다.
 */
export function foldLegacyIntoHomework(cloudNotes = [], localNotes = [], homework = [], localHomework = []) {
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
    const nextHomework = (homework || []).map((row) => ({ ...row, checks: { ...(row.checks || {}) }, roster: [...(row.roster || [])] }));
    const nextLocal = (localHomework || []).map((row) => ({ ...row, checks: { ...(row.checks || {}) }, roster: [...(row.roster || [])] }));
    let changed = removed.length > 0;
    for (const item of tagged) {
        if (isHomeworkCheck(item.row)) continue;
        if (!isLegacyHomeworkNote(item.row)) {
            (item.local ? local : cloud).push(item.row);
            continue;
        }
        removed.push(item.row);
        changed = true;
        const pack = readHomeworkPack(item.row);
        const bucket = item.local ? nextLocal : nextHomework;
        const existing = bucket.find((row) => row.id === item.row.id) || nextHomework.find((row) => row.id === item.row.id) || nextLocal.find((row) => row.id === item.row.id);
        if (!pack && existing) {
            extras.delete(item.row.id);
            continue;
        }
        const base = pack ? {
            id: item.row.id,
            title: item.row.title || '',
            date: item.row.date || '',
            made: pack.made,
            metaAt: pack.metaAt,
            roster: pack.roster,
            checks: pack.checks,
            gone: 0,
            editAt: Number(item.row.editAt) || 0,
        } : {
            id: item.row.id,
            title: item.row.title || '',
            date: item.row.date || '',
            made: Number(item.row.editAt) || 0,
            metaAt: Number(item.row.editAt) || 0,
            roster: [],
            checks: {},
            gone: 0,
            editAt: Number(item.row.editAt) || 0,
        };
        for (const extra of extras.get(item.row.id) || []) {
            const prev = base.checks[extra.sid];
            if (!prev || extra.at >= Number(prev.at)) base.checks[extra.sid] = { at: extra.at, on: 1 };
        }
        extras.delete(item.row.id);
        putHomework(bucket, base);
    }
    for (const [id, bag] of extras) {
        const row = nextHomework.find((item) => item.id === id) || nextLocal.find((item) => item.id === id);
        if (!row || (Number(row.gone) > 0 && bag.every((extra) => extra.at <= Number(row.gone)))) continue;
        for (const extra of bag) {
            const prev = row.checks[extra.sid];
            if (!prev || extra.at >= Number(prev.at)) row.checks[extra.sid] = { at: extra.at, on: 1 };
        }
        if (Number(row.gone) > 0 && Number(row.metaAt) > Number(row.gone)) row.gone = 0;
        changed = true;
    }
    return { cloud, local, removed, homework: nextHomework, localHomework: nextLocal, changed };
}
