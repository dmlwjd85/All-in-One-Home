import { addDaysYmd, isValidYmd, seoulYmd } from './date.js';
import { isSensitiveText } from './sensitive.js';

function pad(n) {
    return String(n).padStart(2, '0');
}

/** 본문에서 날짜를 하나 고릅니다. 월·일만 있으면 3월~다음 해 2월 학년도로 봅니다. */
export function detectDate(text, now = new Date()) {
    const raw = String(text || '');
    const today = seoulYmd(now);
    const full = raw.match(/(\d{4})\s*[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})/);
    if (full) {
        const ymd = `${full[1]}-${pad(full[2])}-${pad(full[3])}`;
        return isValidYmd(ymd) ? ymd : null;
    }
    const korean = raw.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);
    const slash = raw.match(/(?:^|[\s,.(])(\d{1,2})\s*\/\s*(\d{1,2})(?=$|[\s,.)])/);
    const hit = korean || slash;
    if (hit) {
        const month = Number(hit[1]);
        const day = Number(hit[2]);
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
            const fixed = fixSchoolYear(month, day, today);
            if (isValidYmd(fixed)) return fixed;
        }
    }
    if (raw.includes('모레')) return addDaysYmd(today, 2);
    if (raw.includes('내일')) return addDaysYmd(today, 1);
    if (raw.includes('오늘')) return today;
    return null;
}

function fixSchoolYear(month, day, today) {
    const year = Number(today.slice(0, 4));
    const thisMonth = Number(today.slice(5, 7));
    let y = year;
    if (thisMonth >= 3) y = month >= 3 ? year : year + 1;
    else y = month >= 3 ? year - 1 : year;
    return `${y}-${pad(month)}-${pad(day)}`;
}

export function parseNote(text, now = new Date()) {
    const raw = String(text || '');
    const tags = [...raw.matchAll(/#([0-9A-Za-z가-힣_]{1,12})/g)].map((m) => m[1]).slice(0, 10);
    const at = raw.match(/@(\d{1,2})/);
    const studentNo = at ? Number(at[1]) : null;
    const safeNo = studentNo >= 1 && studentNo <= 50 ? studentNo : null;
    return {
        tags,
        studentNo: safeNo,
        detectedDate: detectDate(raw, now),
        sensitive: isSensitiveText(raw, tags),
    };
}

export function stripTokens(text) {
    return String(text || '')
        .replace(/@[0-9]{1,2}/g, '')
        .replace(/#([0-9A-Za-z가-힣_]+)/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}
