/**
 * 보이는 크롬·바로가기와 같은 규칙으로 목적지를 고릅니다.
 * PDF rect는 분류(위쪽/본문)에만 쓰고, 클릭 상자에는 쓰지 않습니다.
 */
import { DEST_LABEL, destLabel } from './labels.js';
import { TOP_NAV_Y } from './layout.js';

/** 1번 학생 카드 159쪽, 2번 161쪽 … */
export function studentCardPage(n) {
    return 157 + Number(n) * 2;
}

/** 1번 누가기록 160쪽, 2번 162쪽 … */
export function studentWhoPage(n) {
    return 158 + Number(n) * 2;
}

export function monthPage(month, year = 2026) {
    const m = Number(month);
    if (year === 2027 && m === 1) return 44;
    if (year === 2027 && m === 2) return 45;
    if (m >= 3 && m <= 12) return 31 + m;
    if (m === 1) return 44;
    if (m === 2) return 45;
    return 34;
}

export function isTopLink(link) {
    const y1 = link?.rect?.[3];
    return Number.isFinite(y1) && y1 <= TOP_NAV_Y;
}

export function topLinks(pageRec) {
    const raw = [
        ...(pageRec?.topNav || []),
        ...(pageRec?.links || []).filter(isTopLink),
    ];
    raw.sort((a, b) => (a.rect?.[0] ?? 0) - (b.rect?.[0] ?? 0));
    const seen = new Set();
    const out = [];
    for (const link of raw) {
        const key = `${link.to}:${link.label || ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push(link);
    }
    return out;
}

export function bodyLinks(pageRec) {
    return (pageRec?.links || []).filter((link) => !isTopLink(link));
}

const TOP_ALIAS = {
    2: '홈',
    9: '태그',
    32: '연간',
    33: '학사',
    46: '주간',
    99: '하루',
    140: '학급',
    154: '명렬',
    155: '조사',
    157: '건강',
    223: '짧은기록',
    231: '출결',
    256: '상담',
    335: '수업',
    350: '단원',
    404: '업무',
    405: '기한',
    411: '할 일',
    417: '회의',
    458: '전달',
    468: '예산',
    495: '쓰',
    516: '공책',
    559: '칠판',
    563: '스티커',
};

export function chromeTopLabel(link, pageNo, pages) {
    if (link.label) return link.label;
    if (link.to === pageNo + 1) return '다음';
    if (link.to === pageNo - 1) return '이전';
    if (link.to === pageNo) return '이 쪽';
    if (TOP_ALIAS[link.to]) return TOP_ALIAS[link.to];
    if (DEST_LABEL[link.to]) return DEST_LABEL[link.to];
    return destLabel(link.to, pages);
}

/** 월간 칸의 날짜 → 그 주 쪽. 'n 주' 거터는 빼고 날짜 라벨만 봅니다. */
export function weekPageForDay(links, day) {
    const n = Number(day);
    if (!Number.isFinite(n)) return null;
    const re = new RegExp(`^${n}(?:\\D|$)`);
    const cands = (links || []).filter((link) => {
        if (link.to < 47 || link.to > 98) return false;
        const lab = String(link.label || '').trim();
        if (/주/.test(lab) && !/절|대체|휴/.test(lab)) return false;
        return re.test(lab);
    });
    if (!cands.length) return null;
    cands.sort((a, b) => (a.rect[3] - a.rect[1]) - (b.rect[3] - b.rect[1]));
    return cands[0].to;
}

export function monthAttendLinks(links) {
    return (links || []).filter((link) => link.to >= 232 && link.to <= 255);
}

export function destForStudentNumber(links, n, fallback = 'card') {
    const lab = String(n);
    const hit = (links || []).find((link) => String(link.label || '').trim() === lab);
    if (hit) return hit.to;
    return fallback === 'who' ? studentWhoPage(n) : studentCardPage(n);
}

export function shortcutLabel(link, pages) {
    return link.label || destLabel(link.to, pages);
}
