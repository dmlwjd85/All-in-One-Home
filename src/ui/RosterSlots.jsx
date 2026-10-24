import { parseRoster } from '../lib/roster.js';

export const ROSTER_SLOTS = 32;

export function slotsFromStudents(students) {
    const nums = (students || []).map((row) => Number(row.no) || 0);
    const count = Math.max(ROSTER_SLOTS, ...nums, 0);
    const names = Array.from({ length: count }, () => '');
    for (const row of students || []) {
        const no = Number(row.no);
        if (no >= 1 && no <= names.length) names[no - 1] = row.name || '';
    }
    return names;
}

export function rosterTextFromSlots(names) {
    const lines = [];
    (names || []).forEach((name, index) => {
        const trimmed = String(name || '').trim();
        if (trimmed) lines.push(`${index + 1} ${trimmed}`);
    });
    return lines.join('\n');
}

/** 붙여 넣은 줄을 번호 칸에 채웁니다. 비어 있는 번호는 그대로 둡니다. */
export function fillSlotsFromText(names, text) {
    const parsed = parseRoster(text);
    const next = (names || []).slice();
    while (next.length < ROSTER_SLOTS) next.push('');
    let max = next.length;
    for (const row of parsed.students) max = Math.max(max, row.no);
    while (next.length < max) next.push('');
    for (const row of parsed.students) {
        if (row.no >= 1 && row.no <= next.length) next[row.no - 1] = row.name;
    }
    return { names: next, errors: parsed.errors };
}

export function RosterSlots({ names, onChange }) {
    return (
        <div className="roster-grid" role="group" aria-label="명단">
            {names.map((name, index) => {
                const no = index + 1;
                return (
                    <label key={no} className="roster-slot">
                        <span className="num">{no}</span>
                        <input
                            className="field"
                            aria-label={`${no}번 이름`}
                            value={name}
                            placeholder="이름"
                            onChange={(event) => {
                                const next = names.slice();
                                next[index] = event.target.value;
                                onChange(next);
                            }}
                        />
                    </label>
                );
            })}
        </div>
    );
}
