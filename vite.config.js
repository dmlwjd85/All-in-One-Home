import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    // GitHub Pages 하위 경로에서도 JS/CSS가 404 나지 않도록 상대 경로를 기본으로 둡니다.
    const base = env.VITE_BASE || './';
    return {
        plugins: [react()],
        base,
    };
});
