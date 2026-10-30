/** 오늘 화면 접는 카드의 한 줄 요약: 빈 조각은 빼고 ' · ' 로 잇습니다(끝에 ' · '가 남지 않게). */
export function joinSummary(parts, empty = '') {
    return parts.map((v) => String(v ?? '').trim()).filter(Boolean).join(' · ') || empty;
}

export function recentSummary(item) {
    return item ? joinSummary([item.title, item.text], '아직 기록이 없어요') : '아직 기록이 없어요';
}
