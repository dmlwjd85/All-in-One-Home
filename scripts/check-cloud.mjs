/** 주입된 웹 설정으로 프로젝트에 닿는지만 봅니다. 설정 값은 출력하지 않습니다. */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deleteApp, initializeApp } from 'firebase/app';
import { doc, getDoc, getFirestore, terminate } from 'firebase/firestore';

const raw = process.env.VITE_FIREBASE_CONFIG || '';
if (!raw.trim()) {
    console.error('환경 변수가 비어 있습니다.');
    process.exit(1);
}
let config;
try {
    config = JSON.parse(raw);
} catch {
    console.error('웹 설정 JSON을 읽지 못했습니다.');
    process.exit(1);
}
if (config.projectId !== 'ssug-gyomu') {
    console.error('프로젝트 이름이 다릅니다.');
    process.exit(1);
}
if (!config.apiKey || !config.appId || !config.authDomain) {
    console.error('웹 설정 칸이 비어 있습니다.');
    process.exit(1);
}

const app = initializeApp(config, 'ssug-probe');
const db = getFirestore(app);
try {
    await getDoc(doc(db, 'users', 'probe-not-signed-in'));
    console.error('로그인하지 않았는데 읽기가 통과했습니다.');
    process.exit(1);
} catch (error) {
    const code = String(error?.code || '');
    if (!code.includes('permission-denied') && !code.includes('unauthenticated')) {
        console.error(`읽기 거절을 확인하지 못했습니다. 코드: ${code || '없음'}`);
        process.exit(1);
    }
}
await terminate(db).catch(() => {});
await deleteApp(app).catch(() => {});

const out = mkdtempSync(join(tmpdir(), 'ssug-gyomu-'));
const build = spawnSync('npx', ['vite', 'build', '--outDir', out], {
    env: { ...process.env, VITE_BASE: './' },
    encoding: 'utf8',
});
const log = `${build.stdout || ''}${build.stderr || ''}`;
if (log.includes(config.apiKey) || log.includes(config.appId)) {
    rmSync(out, { recursive: true, force: true });
    console.error('빌드 로그에 설정이 찍혀 중단했습니다. 로그는 남기지 않습니다.');
    process.exit(1);
}
if (build.status !== 0) {
    rmSync(out, { recursive: true, force: true });
    console.error('설정이 들어간 빌드가 실패했습니다.');
    process.exit(1);
}
let bundled = false;
const walk = (dir) => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, name.name);
        if (name.isDirectory()) walk(path);
        else if (name.name.endsWith('.js')) {
            const text = readFileSync(path, 'utf8');
            if (text.includes(config.projectId) && text.includes(config.apiKey)) bundled = true;
        }
    }
};
walk(out);
rmSync(out, { recursive: true, force: true });
if (!bundled) {
    console.error('빌드 결과에 웹 설정이 들어가지 않았습니다.');
    process.exit(1);
}
console.log('로그인 없이 읽기는 거절됐습니다. 빌드에는 ssug-gyomu 설정이 들어갔습니다. 값은 출력하지 않았습니다.');
