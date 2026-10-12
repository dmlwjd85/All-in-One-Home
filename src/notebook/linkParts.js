/** PDF 링크를 화면 흐름(헤더 / 본문)으로 나눕니다. 절대좌표 핫스팟은 쓰지 않습니다. */

const HEADER_TOP = 70;

export function partitionLinks(pageRec) {
    const header = [];
    const seen = new Set();
    const pushHeader = (link) => {
        if (!link || seen.has(link.to)) return;
        seen.add(link.to);
        header.push(link);
    };
    for (const link of pageRec?.topNav || []) pushHeader(link);
    const body = [];
    for (const link of pageRec?.links || []) {
        if (link.rect[1] < HEADER_TOP) pushHeader(link);
        else body.push(link);
    }
    header.sort((a, b) => a.rect[0] - b.rect[0]);
    return { header, body };
}

/** 월간 달력: 날짜 번호 → 주간 쪽. 좁은 'N주' 칸은 같은 목적지를 날짜가 이미 가집니다. */
export function monthDayMap(links) {
    const days = new Map();
    const extras = [];
    for (const link of links) {
        const w = link.rect[2] - link.rect[0];
        const label = String(link.label || '').trim();
        if (w < 50) continue;
        const m = label.match(/^(\d{1,2})(?:\s|$)/);
        const day = m ? Number(m[1]) : 0;
        if (day >= 1 && day <= 31 && w < 180 && link.rect[1] < 740) {
            if (!days.has(day)) days.set(day, link.to);
            continue;
        }
        extras.push(link);
    }
    extras.sort((a, b) => a.rect[0] - b.rect[0] || a.rect[1] - b.rect[1]);
    return { days, extras };
}

export function numberedLinks(links) {
    return (links || []).filter((link) => /^\d{1,2}$/.test(String(link.label || '').trim()));
}
