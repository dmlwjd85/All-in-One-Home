/** 나이스 모아 보기 CSV·인쇄용 이스케이프. */

/** 엑셀 수식으로 읽힐 위험한 접두만 가립니다. -5·「- 글머리」는 그대로 둡니다. */
function needsCsvFormulaGuard(text) {
    const stripped = String(text).replace(/^[\t\r\n \u00a0]+/, '');
    if (!stripped) return false;
    const ch = stripped[0];
    if ('=@＝＠'.includes(ch)) return true;
    if (ch === '+' || ch === '＋') {
        /* +82·+82-10-…처럼 + 뒤 숫자(전화·국번)는 -5처럼 그대로 둡니다. +=1·+CMD는 가립니다. */
        if (/^[+＋]\d[\d\- ]*$/.test(stripped)) return false;
        return true;
    }
    if (ch === '-' || ch === '－') {
        if (/^[-－]\d+(\.\d+)?$/.test(stripped)) return false;
        if (/^[-－] /.test(stripped)) return false;
        return true;
    }
    return false;
}

export function csvEscape(value) {
    let text = String(value ?? '');
    if (needsCsvFormulaGuard(text)) text = `'${text}`;
    if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
    return text;
}

export function htmlEscape(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}
