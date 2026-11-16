/** 되돌리기가 그대로 적용되면 원래 알림을 닫습니다. 다른 기기 변경으로 건너뛰면 새 안내를 남겨 둡니다. */
export function finishUndoToast(result, clear) {
    if (result === true) clear();
}
