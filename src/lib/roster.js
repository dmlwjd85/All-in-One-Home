/** 명단 붙여 넣기. 한 줄에 한 명. "12 이하은", "12번 이하은", "이하은" 모두 받습니다. */
export function parseRoster(text) {
    const students = [];
    const errors = [];
    const lines = String(text || '').split(/\r?\n/);
    let nextNo = 1;
    for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;
        if (/^(번호|이름|학생)/.test(line) && !/\d/.test(line)) continue;
        const match = line.match(/^(?:(\d{1,2})\s*(?:번|[.)])?\s+)?([가-힣A-Za-z][가-힣A-Za-z\s]{0,18}?)(?:\s+(남|여))?$/);
        if (!match) {
            errors.push(`알아보기 어려운 줄이 있어요: ${line.slice(0, 20)}`);
            continue;
        }
        const no = match[1] ? Number(match[1]) : nextNo;
        const name = match[2].replace(/\s+/g, '').slice(0, 20);
        if (!name) continue;
        if (no < 1 || no > 50) {
            errors.push('번호는 1번부터 50번까지예요.');
            continue;
        }
        if (students.some((row) => row.no === no)) {
            errors.push(`${no}번이 두 번 나왔어요.`);
            continue;
        }
        students.push({ no, name, sex: match[3] || '' });
        nextNo = Math.max(nextNo, no + 1);
    }
    students.sort((a, b) => a.no - b.no);
    return { students, errors };
}
