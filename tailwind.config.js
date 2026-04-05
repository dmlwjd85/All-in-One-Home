/** @type {import('tailwindcss').Config} */
export default {
    content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
    theme: {
        extend: {
            colors: {
                paper: { 50: '#1e293b', 100: '#0f172a', 200: '#334155', 800: '#e2e8f0', 900: '#f8fafc' },
                stone: { 50: '#1e293b', 100: '#334155', 200: '#475569', 300: '#64748b', 400: '#94a3b8', 500: '#cbd5e1', 600: '#e2e8f0', 700: '#f1f5f9', 800: '#f8fafc', 900: '#ffffff' },
                white: '#1e293b',
            },
        },
    },
    plugins: [],
};
