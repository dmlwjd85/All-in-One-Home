import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
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

/**
 * 글자 인식(급식표·일정표 사진 읽기)에 쓰는 프로그램 파일을 public/ocr/ 로 옮겨 앱과 같은 주소에서 받게 합니다.
 * 다른 회사 서버(CDN)에서 받지 않으므로 학교 망에서 막혀도 되고, 받은 코드가 바뀔 걱정도 없습니다.
 * 한국어 자료(kor.traineddata.gz)는 저장소에 들어 있고, 여기서는 설치된 꾸러미의 작업자·코어만 옮깁니다.
 */
export const OCR_FILES = [
    ['node_modules/tesseract.js/dist/worker.min.js', 'worker.min.js'],
    ['node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js'],
    ['node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'],
];

/** 변이 검사가 저장소 안의 임시 폴더에서 빌드해도, 위의 node_modules 를 찾습니다. */
function findUp(rel) {
    let dir = process.cwd();
    for (let i = 0; i < 8; i += 1) {
        const candidate = resolve(dir, rel);
        if (existsSync(candidate)) return candidate;
        const parent = resolve(dir, '..');
        if (parent === dir) break;
        dir = parent;
    }
    return '';
}

/**
 * PDF 읽기(pdf.js)와 한글 글꼴 표(cmap)를 public/pdf/ 로 옮겨 앱과 같은 주소에서 받게 합니다.
 * pdf.js 는 묶음에 넣지 않습니다(요즘 문법이라 빌드 대상에 맞춰 바꾸지 못함). PDF 를 고를 때만 받습니다.
 */
export const PDF_FILES = [
    ['node_modules/pdfjs-dist/legacy/build/pdf.min.mjs', 'pdf.min.mjs'],
    ['node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs', 'pdf.worker.min.mjs'],
];
function copyPdfFiles() {
    return {
        name: 'copy-pdf-files',
        buildStart() {
            mkdirSync(resolve('public/pdf/cmaps'), { recursive: true });
            for (const [from, to] of PDF_FILES) {
                const src = findUp(from);
                if (!src) throw new Error(`PDF 읽기 파일이 없습니다: ${from} (npm install 을 먼저 해 주세요)`);
                copyFileSync(src, resolve('public/pdf', to));
            }
            const maps = findUp('node_modules/pdfjs-dist/cmaps');
            if (!maps) throw new Error('PDF 읽기 파일이 없습니다: node_modules/pdfjs-dist/cmaps');
            for (const name of readdirSync(maps)) {
                if (/\.bcmap$/.test(name) && /KS|Korea|UCS2|UTF16|UTF8/.test(name)) copyFileSync(resolve(maps, name), resolve('public/pdf/cmaps', name));
            }
        },
    };
}

function copyOcrFiles() {
    return {
        name: 'copy-ocr-files',
        buildStart() {
            mkdirSync(resolve('public/ocr'), { recursive: true });
            for (const [from, to] of OCR_FILES) {
                const src = findUp(from);
                if (!src) throw new Error(`글자 인식 파일이 없습니다: ${from} (npm install 을 먼저 해 주세요)`);
                copyFileSync(src, resolve('public/ocr', to));
            }
        },
    };
}

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const base = env.VITE_BASE || './';
    return {
        plugins: [copyOcrFiles(), copyPdfFiles(), react(), precacheFromBuild()],
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
