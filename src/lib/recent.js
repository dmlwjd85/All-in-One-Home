/** 최근 기록 순 학생. QuickSheet와 ＋ 시트가 같은 순서를 씁니다. */
export function recentStudents(students, records, limit = 4) {
    const last = new Map();
    (records || []).forEach((row) => {
        if (row.sid && (!last.has(row.sid) || String(row.at || row.date) > last.get(row.sid))) last.set(row.sid, String(row.at || row.date));
    });
    return [...(students || [])].sort((a, b) => String(last.get(b.id) || '').localeCompare(String(last.get(a.id) || '')) || a.no - b.no).slice(0, limit);
}
