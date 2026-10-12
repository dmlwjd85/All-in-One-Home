/**
 * 예전 공유 기록을 한 계정의 공간으로 복사합니다. 원본은 지우지 않습니다.
 *
 * 서비스 계정 키를 준비한 뒤, 프로젝트 소유자가 로컬에서 실행합니다.
 *
 *   export GOOGLE_APPLICATION_CREDENTIALS=/절대경로/service-account.json
 *   node scripts/migrate-legacy.mjs --uid 대상UID --dry-run
 *   node scripts/migrate-legacy.mjs --uid 대상UID
 *
 * uid 는 Firebase Authentication 사용자 UID 입니다.
 * --project 를 생략하면 sambong-world-2026 을 씁니다.
 * --app-id 를 생략하면 home-note-app 을 씁니다.
 */
import { applicationDefault, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { migrateLegacy, parseMigrateArgs } from './migrate-legacy-lib.mjs';

const args = parseMigrateArgs(process.argv.slice(2));
if (!args.uid) {
    console.error('대상 uid 가 필요합니다. 예: node scripts/migrate-legacy.mjs --uid UID --dry-run');
    process.exit(1);
}

const projectId = args.project || process.env.GCLOUD_PROJECT || 'sambong-world-2026';
const options = { projectId };
if (!process.env.FIRESTORE_EMULATOR_HOST) {
    options.credential = applicationDefault();
}
initializeApp(options);

const result = await migrateLegacy({
    db: getFirestore(),
    appId: args.appId,
    uid: args.uid,
    dryRun: args.dryRun,
});
console.log(JSON.stringify(result, null, 2));
if (args.dryRun) {
    console.error('dry-run 이라 문서를 쓰지 않았습니다. 원본도 지우지 않습니다.');
}
