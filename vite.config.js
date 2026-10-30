import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/** 빌드 결과의 정적 파일을 서비스 워커 프리캐시 목록으로 만듭니다. */
function precacheFromBuild() {
    return {
        name: 'precache-from-build',
        apply: 'build',
        closeBundle() {
            const dist = resolve('dist');
            const manifest = JSON.parse(readFileSync(resolve(dist, '.vite/manifest.json'), 'utf8'));
            const files = new Set(['./', './index.html', './sw.js']);
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
                /* 아이콘은 문서 링크만 넣습니다. */
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
                    if (/\.ext\.woff2$/.test(raw)) continue; /* 드문 글자(.ext)는 미리 받지 않고, 화면에 나올 때 받아 런타임 저장합니다. */
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

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const base = env.VITE_BASE || './';
    return {
        plugins: [react(), precacheFromBuild()],
        base,
        build: {
            manifest: true,
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') || id.includes('node_modules/scheduler')) return 'react';
                        if (id.includes('node_modules/firebase')) return 'firebase';
                        return undefined;
                    },
                },
            },
        },
    };
});
