import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { SECTION_RANGES } from './src/notebook/sections.js';

/** Vite 빌드 매니페스트의 해시 파일과 index.html이 가리키는 정적 파일을 프리캐시 목록으로 씁니다. */
function precacheFromBuild() {
    return {
        name: 'precache-from-build',
        apply: 'build',
        closeBundle() {
            const dist = resolve('dist');
            const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
            const files = new Set(['./', './index.html']);
            const add = (value) => {
                if (typeof value !== 'string' || !value) return;
                files.add(`./${value.replace(/^\.\//, '')}`);
            };
            for (const entry of Object.values(manifest)) {
                if (!entry || typeof entry !== 'object') continue;
                add(entry.file);
                for (const css of entry.css || []) add(css);
                for (const asset of entry.assets || []) add(asset);
            }
            const html = readFileSync(resolve(dist, 'index.html'), 'utf8');
            for (const match of html.matchAll(/(?:href|src)="(\.\/[^"]+)"/g)) add(match[1]);
            try {
                const webmanifest = JSON.parse(readFileSync(resolve(dist, 'manifest.webmanifest'), 'utf8'));
                for (const icon of webmanifest.icons || []) add(icon.src);
            } catch {
                /* 매니페스트가 없으면 아이콘은 index.html 링크만 넣습니다. */
            }
            for (const rel of [...files]) {
                if (!rel.endsWith('.css')) continue;
                let css = '';
                try {
                    css = readFileSync(resolve(dist, rel.replace(/^\.\//, '')), 'utf8');
                } catch {
                    continue;
                }
                for (const match of css.matchAll(/url\((?:'|")?([^)'"]+)(?:'|")?\)/g)) {
                    const raw = match[1];
                    if (raw.startsWith('data:') || raw.startsWith('#') || raw.includes('%23')) continue;
                    const joined = new URL(raw, `https://assets.local/${rel.replace(/^\.\//, '')}`).pathname;
                    const relPath = `.${joined}`;
                    const disk = resolve(dist, relPath.replace(/^\.\//, ''));
                    if (existsSync(disk) && statSync(disk).isFile()) add(relPath);
                }
            }
            const list = [...files].sort();
            writeFileSync(resolve(dist, 'precache-manifest.js'), `self.__NB_PRECACHE__ = ${JSON.stringify(list)};\n`);
        },
    };
}

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
        plugins: [react(), notebookSplit(), precacheFromBuild()],
        base,
        build: {
            manifest: true,
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (
                            id.includes('node_modules/react-dom')
                            || id.includes('node_modules/react/')
                            || id.includes('node_modules/scheduler')
                        ) return 'react';
                        if (id.includes('node_modules/lucide-react')) return 'icons';
                        return undefined;
                    },
                },
            },
        },
    };
});
