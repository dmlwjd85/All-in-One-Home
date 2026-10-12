import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { SECTION_RANGES } from './src/notebook/sections.js';

function notebookSplit() {
    let notebook = null;
    const load = () => {
        if (!notebook) {
            notebook = JSON.parse(readFileSync(resolve('src/notebook/data/notebook.json'), 'utf8'));
        }
        return notebook;
    };
    return {
        name: 'notebook-split',
        resolveId(id) {
            if (id === 'virtual:notebook-catalog') return '\0virtual:notebook-catalog';
            if (id.startsWith('virtual:notebook-section/')) return `\0${id}`;
            return null;
        },
        load(id) {
            if (id === '\0virtual:notebook-catalog') {
                const data = load();
                const catalog = {
                    pageCount: data.pageCount,
                    chrome: data.chrome,
                    pages: data.pages.map((page) => ({
                        n: page.n,
                        type: page.type,
                        title: page.title,
                        extra: page.extra || {},
                    })),
                };
                return `export default ${JSON.stringify(catalog)}`;
            }
            const match = id.match(/^\0virtual:notebook-section\/([a-z]+)$/);
            if (!match) return null;
            const range = SECTION_RANGES.find(([name]) => name === match[1]);
            const data = load();
            const pages = range
                ? data.pages.filter((page) => page.n >= range[1] && page.n <= range[2])
                : [];
            return `export default ${JSON.stringify(pages)}`;
        },
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    // GitHub Pages 하위 경로에서도 JS/CSS가 404 나지 않도록 상대 경로를 기본으로 둡니다.
    const base = env.VITE_BASE || './';
    return {
        plugins: [react(), notebookSplit()],
        base,
    };
});
