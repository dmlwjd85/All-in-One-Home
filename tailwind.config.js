/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx}'],
    darkMode: 'class',
    theme: {
        extend: {
            colors: {
                bg: 'var(--bg)',
                ink: 'var(--ink)',
                'ink-sub': 'var(--ink-sub)',
                primary: 'var(--primary)',
                'on-primary': 'var(--on-primary)',
                solid: 'var(--solid)',
                line: 'var(--line)',
            },
            fontFamily: {
                title: 'var(--font-title)',
                body: 'var(--font-body)',
            },
            borderRadius: {
                sm: '10px',
                md: '16px',
                lg: '24px',
                xl: '28px',
            },
            boxShadow: {
                glass: 'var(--shadow)',
            },
        },
    },
    plugins: [],
};
