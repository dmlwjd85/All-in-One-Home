/** 화면 모드와 하단 용기 맛. 화면 글자에는 맛 이름을 쓰지 않습니다. */

export const FLAVOR_IDS = ['strawberry', 'grape', 'blueberry', 'marmalade', 'apple', 'kiwi'];

export const FLAVOR_LABELS = {
    strawberry: '딸기',
    grape: '포도',
    blueberry: '블루베리',
    marmalade: '오렌지 마멀레이드',
    apple: '사과',
    kiwi: '키위',
};

/** 이 수첩의 포인트는 밝기·어둡기 모두 로즈라 둘 다 딸기입니다. */
export const THEME_FLAVOR = {
    light: 'strawberry',
    dark: 'strawberry',
};

export const SEAL_FILL = {
    light: '#C4384E',
    dark: '#E56B84',
};

export function flavorForDark(isDark) {
    return isDark ? THEME_FLAVOR.dark : THEME_FLAVOR.light;
}
