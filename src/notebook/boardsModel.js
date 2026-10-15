/** 기한·제출·칭찬 보드에서 같이 쓰는 계산. 화면과 저장은 여기 두지 않습니다. */

export function daysUntil(ymd, now = new Date()) {
    if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
    const target = new Date(`${ymd}T12:00:00`);
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12);
    return Math.round((target - today) / 86400000);
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function ddayBadge(diff) {
    if (diff === null || Number.isNaN(diff)) return null;
    if (diff === 0) return { kind: 'day', text: '당일' };
    if (diff > 0 && diff <= 3) return { kind: 'soon', text: `${diff}일 남음` };
    if (diff < 0) return { kind: 'late', text: `${-diff}일 지남` };
    return { kind: 'later', text: `${diff}일 남음` };
}

export function formatCardDate(ymd) {
    if (!ymd) return '날짜 없음';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return ymd;
    const [year, month, day] = ymd.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return ymd;
    return `${month}월 ${day}일 (${WEEKDAYS[date.getDay()]})`;
}

export function parseKoDate(text, now = new Date()) {
    const raw = String(text || '').trim();
    if (!raw) return '';
    const build = (year, month, day) => {
        if (month < 1 || month > 12 || day < 1 || day > 31) return null;
        const date = new Date(year, month - 1, day);
        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
        return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    };
    let match = raw.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (match) return build(Number(match[1]), Number(match[2]), Number(match[3]));
    match = raw.match(/^(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if (match) return build(Number(match[1]), Number(match[2]), Number(match[3]));
    match = raw.match(/^(\d{1,2})\s*월\s*(\d{1,2})/);
    if (match) return build(now.getFullYear(), Number(match[1]), Number(match[2]));
    return null;
}

export function calendarMarks(ymd, items) {
    return (items || []).filter((item) => item.deadline === ymd && item.status !== 'done');
}

/** 주간 범위에 들어오는 기한. 저장은 하지 않고, 이미 있는 카드·줄만 고릅니다. */
export function deadlinesInRange(items, start, end) {
    if (!start || !end) return [];
    return (items || [])
        .filter((item) => {
            const ymd = String(item?.deadline || '');
            return /^\d{4}-\d{2}-\d{2}$/.test(ymd) && ymd >= start && ymd <= end;
        })
        .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)) || String(a.title || '').localeCompare(String(b.title || ''), 'ko'));
}

export function missingNumbers(submitted, size = 32) {
    const have = new Set(submitted || []);
    const missing = [];
    for (let n = 1; n <= size; n += 1) {
        if (!have.has(n)) missing.push(n);
    }
    return missing;
}

export function alimSentence(title, missing) {
    const name = String(title || '제출물').trim() || '제출물';
    if (!missing.length) return `${name}은 모두 냈어요.`;
    return `${name} 안 낸 번호: ${missing.join(', ')}번. 내일까지 챙겨 주세요.`;
}

export function praiseStats(counts, goal, size = 32) {
    const safeGoal = Math.max(1, Number(goal) || 1);
    let total = 0;
    let reached = 0;
    for (let n = 1; n <= size; n += 1) {
        const count = Number(counts?.[n] || counts?.[String(n)] || 0);
        total += count;
        if (count >= safeGoal) reached += 1;
    }
    const max = safeGoal * size;
    return {
        goal: safeGoal,
        total,
        reached,
        max,
        percent: Math.max(0, Math.min(100, Math.round((total / max) * 100))),
    };
}
