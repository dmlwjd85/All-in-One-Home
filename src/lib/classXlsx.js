/**
 * 출결·기록 엑셀(.xlsx) 내려받기에 들어갈 표를 만듭니다. 파일로 묶는 일은 neisXlsx.js 가 합니다.
 * 화면 없이 node 로도 돌아갑니다(scripts/check-class-xlsx.mjs). 첫 화면 묶음에 넣지 않도록 화면에서는 늦게 불러옵니다.
 */
import { NEIS_XLSX_TYPE, xlsxBookBytes } from './neisXlsx.js';
import { isSensitiveText } from './sensitive.js';

export const XLSX_TYPE = NEIS_XLSX_TYPE;
export const ATTEND_STATUSES = ['결석', '지각', '조퇴', '결과'];
export const ATTEND_REASONS = ['질병', '미인정', '출석인정', '기타'];
const RECORD_KINDS = ['관찰', '상담', '보호자', '칭찬'];
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function weekday(ymd) {
    const d = new Date(`${ymd}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? '' : WEEK[d.getUTCDay()];
}

/** 2026-11-03 → 11/3(화) */
export function dayLabel(ymd) {
    const m = String(ymd || '').match(/^\d{4}-(\d{2})-(\d{2})$/);
    return m ? `${Number(m[1])}/${Number(m[2])}(${weekday(ymd)})` : String(ymd || '');
}

function byNo(a, b) {
    return (Number(a?.no) || 999) - (Number(b?.no) || 999) || String(a?.name || '').localeCompare(String(b?.name || ''), 'ko');
}

function studentLabel(student) {
    if (!student) return '학생 미정';
    return student.active === false ? `${student.name} (지난 명단)` : student.name;
}

/** 표 칸: 사유가 있으면 '질병결석'처럼, 없으면 '결석'. */
function markText(row) {
    return `${row.reason || ''}${row.status}`;
}

/**
 * 출결 표.
 * students: 지난 명단까지 모두. 지금 반 학생은 모두 넣고, 지난 명단 학생은 기간 안에 출결이 있을 때만 넣습니다.
 * days: 열로 쓸 날짜(수업일). 기간 안에 표시가 있는 날은 수업일이 아니어도 더합니다.
 * includeLocal: 이 기기에만 두는 민감한 출결 메모(건강·연락처 등)를 '출결 목록' 시트 메모 칸에 넣을지. 빼면 그 칸을 비웁니다.
 * 돌려주는 값: { sheets, count(표시 수), localCount(이 기기에만 둔 메모가 든 표시 수) }
 */
export function attendSheets({ students = [], attendance = [], from, to, days = [], includeLocal = true }) {
    const inRange = (attendance || []).filter((row) => row?.date >= from && row?.date <= to && ATTEND_STATUSES.includes(row.status));
    const marked = new Set(inRange.map((row) => row.sid));
    const people = (students || []).filter((s) => s.active !== false || marked.has(s.id)).sort(byNo);
    const known = new Set(people.map((s) => s.id));
    /* 명단에 없는 아이디(지운 학생)의 표시도 빠뜨리지 않습니다. */
    for (const sid of marked) if (!known.has(sid)) { people.push({ id: sid, no: '', name: '', active: false, unknown: true }); known.add(sid); }
    const cols = [...new Set([...(days || []).filter((d) => d >= from && d <= to), ...inRange.map((row) => row.date)])].sort();
    const at = new Map(inRange.map((row) => [`${row.sid}|${row.date}`, row]));
    const label = (s) => (s.unknown ? '학생 미정' : studentLabel(s));

    const grid = [['번호', '이름', ...cols.map(dayLabel), ...ATTEND_STATUSES, '서류 받음', '서류 아직']];
    const sum = [['번호', '이름', ...ATTEND_STATUSES.map((s) => `${s} 계`), ...ATTEND_STATUSES.flatMap((s) => ATTEND_REASONS.map((r) => `${s}(${r})`)), '서류 받음', '서류 아직']];
    for (const s of people) {
        const mine = inRange.filter((row) => row.sid === s.id);
        const count = (status, reason) => mine.filter((row) => row.status === status && (reason == null || (row.reason || '기타') === reason)).length;
        const paperYes = mine.filter((row) => row.paper).length;
        const no = s.no === '' || s.no == null ? '' : String(s.no);
        grid.push([no, label(s), ...cols.map((d) => { const row = at.get(`${s.id}|${d}`); return row ? markText(row) : ''; }), ...ATTEND_STATUSES.map((st) => count(st)), paperYes, mine.length - paperYes]);
        sum.push([no, label(s), ...ATTEND_STATUSES.map((st) => count(st)), ...ATTEND_STATUSES.flatMap((st) => ATTEND_REASONS.map((r) => count(st, r))), paperYes, mine.length - paperYes]);
    }
    const byId = new Map(people.map((s) => [s.id, s]));
    const noteText = (note) => (!note ? '' : (!includeLocal && isSensitiveText(note) ? '' : note));
    const list = [['날짜', '요일', '번호', '이름', '상태', '사유', '교시', '서류', '메모']];
    [...inRange].sort((a, b) => String(a.date).localeCompare(String(b.date)) || byNo(byId.get(a.sid), byId.get(b.sid))).forEach((row) => {
        const s = byId.get(row.sid);
        list.push([row.date, weekday(row.date), s?.no == null || s?.no === '' ? '' : String(s.no), label(s || { unknown: true }), row.status, row.reason || '', row.period ? `${row.period}교시` : '', row.paper ? '받음' : '아직', noteText(row.note)]);
    });
    return {
        sheets: [
            { name: '출결표', rows: grid, widths: [6, 11, ...cols.map(() => 9), 6, 6, 6, 6, 8, 8], freezeCols: 2 },
            { name: '학생별 합계', rows: sum, widths: [6, 11, ...ATTEND_STATUSES.map(() => 7), ...ATTEND_STATUSES.flatMap(() => ATTEND_REASONS.map(() => 11)), 8, 8], freezeCols: 2 },
            { name: '출결 목록', rows: list, widths: [11, 5, 6, 11, 6, 9, 7, 6, 40] },
        ],
        count: inRange.length,
        days: cols.length,
        localCount: inRange.filter((row) => row.note && isSensitiveText(row.note)).length,
    };
}

function neisMark(row) {
    if (!row.neis) return '';
    return row.neisMoved ? '옮김' : '옮길 것';
}

/**
 * 기록(누가기록) 표. records 는 이 기기에만 둔 기록까지 합친 목록(joinedRecords)입니다.
 * sid 를 주면 그 학생 기록만, 날짜순. 없으면 반 전체를 번호·날짜순으로, 학생별 건수 시트도 붙입니다.
 * 돌려주는 값: { sheets, count, localCount(이 기기에만 둔 기록 수) }
 */
export function recordSheets({ students = [], records = [], sid = '', includeLocal = true }) {
    const byId = new Map((students || []).map((s) => [s.id, s]));
    const picked = (records || []).filter((row) => row && (!sid || row.sid === sid) && (includeLocal || !row.localOnly));
    const order = (a, b) => (sid ? 0 : byNo(byId.get(a.sid), byId.get(b.sid)))
        || String(a.date || '').localeCompare(String(b.date || ''))
        || String(a.at || '').localeCompare(String(b.at || ''));
    const rows = [['날짜', '번호', '이름', '종류', '태그', '내용', '나이스', '다시 볼 날', '저장한 곳']];
    [...picked].sort(order).forEach((row) => {
        const s = byId.get(row.sid);
        rows.push([
            row.date || '',
            s?.no != null ? String(s.no) : '',
            studentLabel(s),
            row.kind || '',
            (row.tags || []).join(' · '),
            row.text || '',
            neisMark(row),
            row.follow || '',
            row.localOnly ? '이 기기에만' : '',
        ]);
    });
    /* 첫 열이 날짜라 번호 칸 숫자 바꾸기는 둘째 열에 맞춥니다: 번호는 숫자로 넣습니다. */
    rows.forEach((cells, r) => { if (r > 0 && /^\d{1,3}$/.test(cells[1])) cells[1] = Number(cells[1]); });
    const sheets = [{ name: sid ? `${byId.get(sid)?.no ?? ''}번 ${byId.get(sid)?.name || '학생'} 기록`.trim() : '기록', rows, widths: [11, 6, 11, 7, 14, 60, 8, 11, 10] }];
    if (!sid) {
        const counts = [['번호', '이름', ...RECORD_KINDS, '계', '나이스 옮길 것']];
        const sids = [...new Set(picked.map((row) => row.sid || ''))];
        const people = sids.map((id) => byId.get(id) || { id, no: null, name: '', unknown: true }).sort(byNo);
        for (const s of people) {
            const mine = picked.filter((row) => (row.sid || '') === s.id);
            counts.push([s.no != null ? String(s.no) : '', s.unknown ? '학생 미정' : studentLabel(s), ...RECORD_KINDS.map((k) => mine.filter((row) => row.kind === k).length), mine.length, mine.filter((row) => row.neis && !row.neisMoved).length]);
        }
        sheets.push({ name: '학생별 건수', rows: counts, widths: [6, 11, 7, 7, 7, 7, 6, 12], freezeCols: 2 });
    }
    return { sheets, count: picked.length, localCount: picked.filter((row) => row.localOnly).length };
}

export function sheetBytes(sheets) {
    return xlsxBookBytes(sheets);
}

/** 파일 이름에 못 쓰는 글자를 뺍니다. */
export function fileSafe(text) {
    return String(text || '').replace(/[\\/:*?"<>|\s]+/g, '').slice(0, 40) || '파일';
}
