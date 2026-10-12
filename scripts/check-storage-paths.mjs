/**
 * localStorage 키와 Firestore 경로가 main과 같은지 확인합니다.
 * 사용자별 경로나 새 키를 넣으면 실패합니다.
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function walk(dir, acc = []) {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue;
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full, acc);
        else if (/\.(js|jsx|mjs)$/.test(name)) acc.push(full);
    }
    return acc;
}

function gitFiles() {
    const list = execSync('git ls-tree -r --name-only main', { cwd: root, encoding: 'utf8' })
        .split('\n')
        .filter((name) => name.startsWith('src/') && /\.(js|jsx)$/.test(name));
    const map = {};
    for (const name of list) {
        map[name] = execSync(`git show main:${name}`, { cwd: root, encoding: 'utf8' });
    }
    return map;
}

function tokensOf(sources) {
    const tokens = new Set();
    const collections = [];
    const records = [];
    let pathHits = 0;
    const text = Object.values(sources).join('\n');
    for (const match of text.matchAll(/homenote_[A-Za-z0-9_]+/g)) tokens.add(match[0]);
    for (const src of Object.values(sources)) {
        for (const match of src.matchAll(/useSharedList\(\s*'([^']+)'/g)) collections.push(match[1]);
        for (const match of src.matchAll(/useSharedRecord\(\s*'([^']+)'/g)) records.push(match[1]);
        pathHits += [...src.matchAll(/'artifacts'\s*,\s*appId\s*,\s*'public'\s*,\s*'data'/g)].length;
    }
    return {
        tokens: [...tokens].sort(),
        collections: collections.sort(),
        records: records.sort(),
        pathHits,
    };
}

const mainMap = gitFiles();
const workFiles = walk(join(root, 'src'));
const workMap = {};
for (const file of workFiles) {
    const rel = file.slice(root.length).replace(/^[/\\]/, '');
    workMap[rel] = readFileSync(file, 'utf8');
}

const mainInfo = tokensOf(mainMap);
const workInfo = tokensOf(workMap);
const errors = [];
const same = (a, b, label) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) errors.push(`${label}\nmain ${JSON.stringify(a)}\nwork ${JSON.stringify(b)}`);
};

same(mainInfo.tokens, workInfo.tokens, 'localStorage 키 토큰');
same(mainInfo.collections, workInfo.collections, 'Firestore 목록 이름');
same(mainInfo.records, workInfo.records, 'Firestore 문서 이름');

if (!workInfo.pathHits) errors.push('Firestore 경로 artifacts/appId/public/data 가 없습니다.');
const joined = Object.values(workMap).join('\n');
if (/firestore\.rules|per-user|doc\(\s*db\s*,\s*'users'|collection\(\s*db\s*,\s*'users'/.test(joined)) {
    errors.push('사용자별 Firestore 경로가 들어 있습니다.');
}
if (!joined.includes('homenote_v2_notebookFields_p')) errors.push('쪽 칸 키가 없습니다.');
if (!joined.includes('homenote_v2_ssugeokSensitive')) errors.push('민감 메모 키가 없습니다.');
if (!joined.includes("'board'")) errors.push('board 문서 이름이 없습니다.');
if (!joined.includes("'notebookFields'") || !joined.includes('`p${page}`')) errors.push('notebookFields/p쪽 문서 모양이 없습니다.');

const rules = join(root, 'firestore.rules');
try {
    statSync(rules);
    errors.push('firestore.rules 파일이 있습니다.');
} catch {
    /* main과 같이 규칙 파일은 없습니다. */
}

console.log(JSON.stringify({
    tokens: workInfo.tokens,
    collections: workInfo.collections,
    records: workInfo.records,
    pathHits: workInfo.pathHits,
    mainPathHits: mainInfo.pathHits,
}, null, 2));

if (errors.length) {
    console.error(errors.join('\n'));
    process.exit(1);
}
console.log('storage 경로 검사 통과');
