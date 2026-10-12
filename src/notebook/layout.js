/**
 * 웹 수첩 크롬·본문 한곳 수치.
 * 탭을 넓혀도 히트 영역이 같이 움직이도록, PDF 픽셀 좌표는 쓰지 않습니다.
 */

export const PDF_PAGE_W = 1180;
export const PDF_PAGE_H = 820;

/** 웹 캔버스. 좌우 탭을 넓힌 만큼 용지도 조금 넓힙니다. */
export const PAGE_W = 1280;
export const PAGE_H = 820;

/** 왼쪽·오른쪽 탭 너비. 데스크톱에서 두 글자가 읽히게 둡니다. */
export const TAB_W = 80;
export const TAB_GAP = 6;
export const TAB_TOP = 16;
export const TAB_BOTTOM = 24;
export const TAB_MIN = 44;

export const TOP_NAV_H = 52;
export const TOP_NAV_Y = 80;
export const BODY_GUTTER = 12;
export const BODY_LEFT = TAB_W + BODY_GUTTER;
export const BODY_RIGHT = TAB_W + BODY_GUTTER;
export const BODY_TOP = TOP_NAV_H + 18;
export const BODY_BOTTOM = 28;

export function tabStackHeight(count) {
    const inner = PAGE_H - TAB_TOP - TAB_BOTTOM;
    const gaps = TAB_GAP * Math.max(0, count - 1);
    return (inner - gaps) / Math.max(1, count);
}

export function layoutVars() {
    return {
        '--nb-page-w': `${PAGE_W}px`,
        '--nb-page-h': `${PAGE_H}px`,
        '--nb-tab-w': `${TAB_W}px`,
        '--nb-tab-gap': `${TAB_GAP}px`,
        '--nb-tab-top': `${TAB_TOP}px`,
        '--nb-tab-bottom': `${TAB_BOTTOM}px`,
        '--nb-topnav-h': `${TOP_NAV_H}px`,
        '--nb-body-left': `${BODY_LEFT}px`,
        '--nb-body-right': `${BODY_RIGHT}px`,
        '--nb-body-top': `${BODY_TOP}px`,
        '--nb-body-bottom': `${BODY_BOTTOM}px`,
    };
}
