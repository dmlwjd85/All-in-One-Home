/** 건강·민원·학폭 쪽은 이 기기에만 둡니다. Firestore로 올리지 않습니다. */
export function isLocalOnlyPage(page) {
    const n = Number(page);
    if (n === 157 || n === 158) return true;
    if (n >= 19 && n <= 22) return true;
    if (n >= 323 && n <= 334) return true;
    return false;
}
