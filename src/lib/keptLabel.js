/* 설정 › 계정 › 보관함(PR #66) 이름표. 화면과 검사가 같이 씁니다. */
const KEPT_KIND = { events: '일정', notes: '회의록·메모', attendance: '출결', timetable: '시간표' };
const KEPT_DAY = { mon: '월', tue: '화', wed: '수', thu: '목', fri: '금' };
const KEPT_TEXT_MAX = 40;
/** 길면 잘라 '…'을 붙입니다. */
export function keptClip(text, max = KEPT_TEXT_MAX) {
    const chars = [...String(text || '')];
    return chars.length > max ? `${chars.slice(0, max).join('')}…` : chars.join('');
}
/** 보관함 한 줄의 값 설명(종류 없이). 지금 값도 같은 모양으로 씁니다. */
export function keptValue(kind, id, row, students = []) {
    if (!row || typeof row !== 'object') return '없음';
    if (kind === 'events') return keptClip(row.title) || '(제목 없음)';
    if (kind === 'notes') return keptClip(row.title || row.text) || '(내용 없음)';
    if (kind === 'attendance') {
        const who = students.find((st) => String(st.id) === String(row.sid))?.name || row.sid || '';
        return `${row.date || ''} · ${who} · ${row.status || ''}`;
    }
    if (kind === 'timetable') {
        const periods = Object.keys(row).filter((key) => /^p\d+$/.test(key) && row[key]).sort((x, y) => Number(x.slice(1)) - Number(y.slice(1)));
        return `${KEPT_DAY[id] || id} · ${periods.map((key) => `${key.slice(1)}교시 ${row[key]}`).join(', ') || '비어 있음'}`;
    }
    return '';
}
export function keptLabel(k, students = []) {
    return `${KEPT_KIND[k?.kind] || '기록'} · ${keptValue(k?.kind, k?.id, k?.row, students)}`;
}
/** 되돌리면 바뀔 지금 줄. 일정·회의록·출결은 같은 id, 시간표는 같은 요일. */
export function keptNow(k, data) {
    if (k?.kind === 'timetable') return data?.timetable?.[k.id] || null;
    return (data?.[k?.kind] || []).find((row) => String(row?.id) === String(k?.id)) || null;
}
