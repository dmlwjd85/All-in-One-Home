/**
 * N9(검수 변이): 🔒 이 기기에만 둔 할 일이 있으면 할 일 화면에 그 뜻을 알리는 안내(LockNote)가 보여야 하고, 없으면 안 보여야 합니다.
 * 진짜 Tasks.jsx를 esbuild로 묶어 react-dom/server로 그려 봅니다.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = mkdtempSync(join(root, '.locknote-'));
const entry = join(dir, 'entry.jsx');
writeFileSync(entry, `
import { renderToStaticMarkup } from 'react-dom/server';
import { Tasks } from '${root}src/ui/Tasks.jsx';
import { Ui as UiContext } from '${root}src/ui/context.jsx';
export function draw(data) {
    const ui = { data, clock: { ymd: '2026-10-31' }, showToast() {}, go() {} };
    return renderToStaticMarkup(<UiContext.Provider value={ui}><Tasks /></UiContext.Provider>);
}
`);
const out = join(dir, 'out.mjs');
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', packages: 'external', outfile: out, jsx: 'automatic', loader: { '.js': 'jsx', '.png': 'empty', '.svg': 'empty', '.css': 'empty', '.mp3': 'empty', '.wav': 'empty' }, define: { 'import.meta.env': '{}' }, logLevel: 'error' });
const { draw } = await import(out);
const base = { todos: [{ id: 'a', title: '클라우드 할 일', done: false }], notes: [], inbox: [], records: [], local: { todos: [], notes: [], records: [] } };
const failures = [];
const withLock = draw({ ...base, local: { ...base.local, todos: [{ id: 'b', title: '보건실 약 받기', done: false }] } });
if (!withLock.includes('🔒 표시는 이 기기에만 있는 기록이에요')) failures.push('🔒 할 일이 있는데 안내(LockNote)가 보이지 않습니다.');
if (draw(base).includes('🔒 표시는 이 기기에만')) failures.push('🔒 할 일이 없는데 안내가 보입니다.');
rmSync(dir, { recursive: true, force: true });
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('check:locknote 통과');
