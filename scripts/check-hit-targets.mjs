/** 버튼이 44px 클래스에 기대고, 작은 체크박스를 쓰지 않는지 봅니다. */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const failures = [];

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, out);
        else if (name.endsWith('.jsx')) out.push(path);
    }
    return out;
}

for (const file of walk(join(root, 'src'))) {
    const text = readFileSync(file, 'utf8');
    if (/<button\b/.test(text) && !file.endsWith(`${join('src', 'ui', 'bits.jsx')}`)) failures.push(`${file}: button 대신 Btn 을 쓰세요.`);
    if (/type=["']checkbox["']/.test(text) || /type=["']radio["']/.test(text)) {
        failures.push(`${file}: 체크박스는 44px 버튼으로 바꾸세요.`);
    }
    const fileInputs = text.match(/<input[^>]*type=["']file["'][^>]*>/g) || [];
    for (const tag of fileInputs) {
        if (!/display:\s*['"]none['"]/.test(tag) && !/display:\s*'none'/.test(tag)) {
            failures.push(`${file}: 파일 입력은 화면 밖으로 넘치지 않게 숨기세요.`);
        }
    }
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('터치 대상 검사를 통과했습니다.');
