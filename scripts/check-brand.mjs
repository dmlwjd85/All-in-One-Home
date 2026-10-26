/**
 * 화면에 보이는 파일에 예전 브랜드 글자가 남으면 실패합니다.
 * 검사 대상: src, public(매니페스트 포함), index.html
 * 글자: 쓱, 잼, JAM(대소문자 무시, 낱말로만)
 * 저장 키처럼 남겨야 하는 경우는 ALLOW 에만 적습니다.
 */
import { readdir, readFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';

const TEXT_EXT = new Set(['.js', '.jsx', '.mjs', '.cjs', '.css', '.html', '.svg', '.json', '.webmanifest', '.txt', '.md']);
const ROOTS = ['src', 'public'];
const EXTRA = ['index.html'];
const APP_NAME = '쨈, 적 교무수첩';

/**
 * file: 저장소 기준 경로
 * contains: 그 줄에 그대로 있는 조각. 이 조각이 있는 줄만 넘깁니다.
 * why: 왜 화면에 안 보이는 키인지
 */
const ALLOW = [
    // 지금 화면 파일의 저장 키(ssug-gyomu 등)에는 쓱·잼·JAM 이 없습니다.
    // 키를 바꾸지 못한 채 그 글자가 꼭 남아야 하면 여기에만 추가합니다.
];

const BANNED = [
    { name: '쓱', re: /쓱/g },
    { name: '잼', re: /잼/g },
    { name: 'JAM', re: /\bJAM\b/gi },
];

async function filesIn(dir, out) {
    let entries = [];
    try {
        entries = await readdir(dir, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return;
        throw error;
    }
    for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            await filesIn(path, out);
            continue;
        }
        if (TEXT_EXT.has(extname(entry.name))) out.push(path);
    }
}

function allowed(file, line) {
    return ALLOW.some((item) => item.file === file && line.includes(item.contains));
}

const paths = [...EXTRA];
for (const root of ROOTS) await filesIn(root, paths);

const failures = [];
for (const path of paths) {
    const file = relative('.', path);
    const text = await readFile(path, 'utf8');
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
        if (allowed(file, line)) return;
        for (const rule of BANNED) {
            rule.re.lastIndex = 0;
            if (rule.re.test(line)) failures.push(`${file}:${index + 1} 에 '${rule.name}' 이 남아 있습니다.`);
        }
    });
}

const manifest = JSON.parse(await readFile('public/manifest.webmanifest', 'utf8'));
if (manifest.name !== APP_NAME) failures.push(`매니페스트 name 이 '${APP_NAME}' 이 아닙니다.`);
if (manifest.short_name !== APP_NAME) failures.push(`매니페스트 short_name 이 '${APP_NAME}' 이 아닙니다.`);
if ([...APP_NAME].length > 12) failures.push('short_name 이 12자를 넘습니다. 줄일지 보고해야 합니다.');

const index = await readFile('index.html', 'utf8');
if (!index.includes(`<title>${APP_NAME}</title>`)) failures.push('index.html title 이 앱 이름과 다릅니다.');
if (!index.includes(`apple-mobile-web-app-title" content="${APP_NAME}"`)) failures.push('애플 홈 화면 이름이 앱 이름과 다릅니다.');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log(`브랜드 글자 확인: 화면 파일 ${paths.length}개, 예외 ${ALLOW.length}개, 앱 이름 '${APP_NAME}' (${[...APP_NAME].length}자)`);
