/** 화면에서 쓰는 주소가 라우터에 연결되어 있는지 봅니다. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { resolveHash } from '../src/lib/routes.js';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const today = '2026-10-19';
const failures = [];

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name === 'dist') continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (/\.(js|jsx)$/.test(name)) out.push(path);
    }
    return out;
}

const must = [
    ['#/today', 'today'],
    ['#/attend', 'attend'],
    ['#/attend/2026-10-19', 'attend'],
    ['#/students', 'students'],
    ['#/students/12', 'student'],
    ['#/students/neis', 'neis'],
    ['#/schedule', 'schedule'],
    ['#/todo', 'todo'],
    ['#/notice', 'notice'],
    ['#/notice/2026-10-20', 'notice'],
    ['#/settings', 'settings'],
    ['#/legacy/47', 'legacy'],
    ['#/write', 'today'],
    ['#/cards/3', 'student'],
    ['#p154', 'students'],
    ['#p496', 'today'],
    ['#p141', 'schedule'],
    ['#p404', 'todo'],
];

for (const [hash, name] of must) {
    const route = resolveHash(hash, today);
    if (route.name !== name) failures.push(`${hash} 는 ${name} 이어야 하는데 ${route.name} 입니다.`);
}
if (!resolveHash('#/write', today).openQuick) failures.push('쓰기 주소에서 콕, 적이 열리지 않습니다.');
if (!resolveHash('#p496', today).openQuick) failures.push('496쪽에서 콕, 적이 열리지 않습니다.');
const unknown = resolveHash('#/없는화면', today);
if (!unknown.notice) failures.push('없는 주소 안내가 없습니다.');
if (resolveHash('#/students/99', today).notice === '' && resolveHash('#/students/99', today).name === 'student') {
    failures.push('없는 번호가 학생 화면으로 들어갑니다.');
}

const hashes = new Set();
for (const file of walk(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(/#\/[a-z][a-z0-9/_-]*/g)) hashes.add(match[0]);
}
for (const hash of hashes) {
    if (hash.includes('${')) continue;
    const route = resolveHash(hash, today);
    if (route.notice && route.name === 'today' && hash !== '#/today') {
        failures.push(`화면 주소 ${hash} 가 라우터에 없습니다.`);
    }
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log(`주소 ${must.length + hashes.size}개를 확인했습니다.`);
