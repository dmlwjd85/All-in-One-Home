/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx}'],
    theme: {
        extend: {
            colors: {
                ink: {
                    50: '#f8f6f2',
                    100: '#f1ece3',
                    200: '#e4d9c8',
                    700: '#4a4036',
                    800: '#2c241c',
                    900: '#1a1612',
                },
            },
            fontFamily: {
                sans: ['"Pretendard Variable"', 'Pretendard', '"Noto Sans KR"', 'system-ui', 'sans-serif'],
                serif: ['"Nanum Myeongjo"', 'Georgia', 'serif'],
            },
            minHeight: {
                tap: '44px',
            },
            minWidth: {
                tap: '44px',
            },
        },
    },
    plugins: [],
};
