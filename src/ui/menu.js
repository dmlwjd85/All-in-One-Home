/** 왼쪽 메뉴와 휴대폰 메뉴가 같이 씁니다. */
export const MENU = [
    ['오늘', '#/today'],
    ['출결', '#/attend'],
    ['학생 기록', '#/students'],
    ['일정·시간표', '#/schedule'],
    ['할 일·메모', '#/todo'],
    ['회의록', '#/minutes'],
    ['알림장', '#/notice'],
    ['나이스 모아 보기', '#/students/neis'],
    ['설정', '#/settings'],
];

/** 출결을 `#/attend`로만 열면 라우터가 곧 `#/attend/날짜`로 주소를 갈아끼웁니다.
    메뉴가 주소 글자만 비교하면 출결이 한 번도 켜지지 않고,
    그 갈아끼우기는 hashchange를 내지 않아 홈 화면 앱에서는 본문까지 그대로일 수 있습니다.
    메뉴에서는 오늘 날짜가 붙은 주소로 한 번에 엽니다. */
export function menuTarget(href, ymd) {
    if (href === '#/attend') return `#/attend/${ymd}`;
    return href;
}

export function menuSelected(routeName, href) {
    if (href === '#/today') return routeName === 'today';
    if (href === '#/attend') return routeName === 'attend';
    if (href === '#/students') return routeName === 'students' || routeName === 'student';
    if (href === '#/students/neis') return routeName === 'neis';
    if (href === '#/schedule') return routeName === 'schedule' || routeName === 'day';
    if (href === '#/todo') return routeName === 'todo';
    if (href === '#/notice') return routeName === 'notice';
    if (href === '#/minutes') return routeName === 'minutes';
    if (href === '#/settings') return routeName === 'settings' || routeName === 'legacy' || routeName === 'roster';
    return false;
}

export function tabSelected(label, routeName) {
    if (label === '오늘') return routeName === 'today';
    if (label === '할 일') return routeName === 'todo';
    if (label === '기록') return routeName === 'students' || routeName === 'student' || routeName === 'neis';
    if (label === '일정') return routeName === 'schedule' || routeName === 'day';
    return false;
}
