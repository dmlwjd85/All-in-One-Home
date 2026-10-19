/** 새 앱이 예전 공개 경로와 원본 키에 쓰지 않는지 봅니다. */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const failures = [];

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist' || name === '.git') continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (/\.(js|jsx|mjs|py|html|json)$/.test(name)) out.push(path);
    }
    return out;
}

const bannedFiles = [
    'src/lib/store.js',
    'src/lib/utils.js',
    'src/lib/ssugeok.js',
    'src/lib/saveNotice.js',
    'src/notebook/data/notebook.json',
    'src/data/notebook.json',
];
for (const rel of bannedFiles) {
    if (existsSync(join(root, rel))) failures.push(`예전 파일 이 남아 있습니다: ${rel}`);
}
if (!existsSync(join(root, 'firestore.rules'))) failures.push('firestore.rules 가 없습니다.');

const publicMarker = ['artifacts', 'home-note-app', 'public', 'data'].join('/');
const publicTuple = ["'artifacts'", "'home-note-app'", "'public'", "'data'"].join(', ');

for (const file of walk(root)) {
    const rel = file.slice(root.length + 1);
    if (rel.startsWith('scripts/check-')) continue;
    const text = readFileSync(file, 'utf8');
    if (/localStorage\.setItem\(\s*['"`]homenote_/.test(text) || /localStorage\.setItem\(\s*`homenote_/.test(text)) {
        failures.push(`${rel}: 예전 키에 씁니다.`);
    }
    if (/AIza[0-9A-Za-z_-]{10,}/.test(text)) failures.push(`${rel}: 파이어베이스 키가 들어 있습니다.`);
    const publicWrite = text.includes(publicTuple) || text.includes(publicMarker);
    if (publicWrite && !rel.endsWith('src/lib/legacyPublic.js') && !rel.endsWith('firestore.rules') && !rel.startsWith('docs/') && !rel.endsWith('README.md')) {
        failures.push(`${rel}: 공개 경로를 새 저장소처럼 씁니다.`);
    }
}

const legacy = readFileSync(join(root, 'src/lib/legacyPublic.js'), 'utf8');
if (!legacy.includes("phrase !== CONFIRM_PHRASE") && !legacy.includes('phrase !== CONFIRM_PHRASE')) {
    failures.push('공개 경로 삭제가 확인 문장 없이 열릴 수 있습니다.');
}
if (!legacy.includes('지우기')) failures.push('공개 경로 확인 문장이 없습니다.');

const firebase = readFileSync(join(root, 'src/firebase.js'), 'utf8');
if (!firebase.includes('sambong-world-2026')) failures.push('새 설정이 예전 프로젝트를 거절하지 않습니다.');
if (/apiKey\s*:\s*['"][^'"]+['"]/.test(firebase)) failures.push('firebase.js 에 키 값이 있습니다.');

const rules = readFileSync(join(root, 'firestore.rules'), 'utf8');
if (!rules.includes("rules_version = '2'")) failures.push('보안 규칙 버전이 없습니다.');
if (!rules.includes('match /users/{uid}')) failures.push('사용자 경로 규칙이 없습니다.');
if (/match\s+\/\{document=\*\*\}/.test(rules)) failures.push('와일드카드 일치가 있습니다.');
if (/allow\s+read\s*,\s*write\s*:\s*if\s+true/.test(rules)) failures.push('전체 허용이 있습니다.');

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('저장 경로 검사를 통과했습니다.');
