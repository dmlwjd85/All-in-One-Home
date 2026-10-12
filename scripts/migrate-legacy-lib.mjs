import {
    LIST_COLLECTIONS,
    NOTEBOOK_COLLECTION,
    RECORD_COLLECTIONS,
} from '../src/lib/collections.js';

export const DEFAULT_APP_ID = 'home-note-app';

export const MIGRATE_COLLECTIONS = [
    ...LIST_COLLECTIONS,
    NOTEBOOK_COLLECTION,
    ...RECORD_COLLECTIONS.map((row) => row.name),
];

export function parseMigrateArgs(argv) {
    const out = {
        dryRun: false,
        uid: '',
        appId: DEFAULT_APP_ID,
        project: '',
    };
    const args = argv || [];
    for (let i = 0; i < args.length; i += 1) {
        const arg = args[i];
        if (arg === '--dry-run') out.dryRun = true;
        else if (arg === '--uid') out.uid = args[i + 1] || '';
        else if (arg.startsWith('--uid=')) out.uid = arg.slice('--uid='.length);
        else if (arg === '--app-id') out.appId = args[++i] || out.appId;
        else if (arg.startsWith('--app-id=')) out.appId = arg.slice('--app-id='.length);
        else if (arg === '--project') out.project = args[++i] || '';
        else if (arg.startsWith('--project=')) out.project = arg.slice('--project='.length);
        if (arg === '--uid') i += 1;
    }
    return out;
}

function legacyCollection(db, appId, name) {
    return db.collection('artifacts').doc(appId).collection('public').doc('data').collection(name);
}

function userCollection(db, appId, uid, name) {
    return db.collection('artifacts').doc(appId).collection('users').doc(uid).collection(name);
}

/**
 * 예전 공개 경로를 지정한 계정으로 복사만 합니다. 원본은 지우지 않습니다.
 * db 는 firebase-admin Firestore 입니다.
 */
export async function migrateLegacy({ db, appId = DEFAULT_APP_ID, uid, dryRun = false }) {
    if (!uid || typeof uid !== 'string') {
        throw new Error('대상 uid 가 필요합니다.');
    }
    const counts = {};
    for (const name of MIGRATE_COLLECTIONS) {
        const snap = await legacyCollection(db, appId, name).get();
        let copied = 0;
        let skipped = 0;
        for (const item of snap.docs) {
            const dest = userCollection(db, appId, uid, name).doc(item.id);
            const existing = await dest.get();
            if (existing.exists) {
                skipped += 1;
                continue;
            }
            if (!dryRun) await dest.set(item.data());
            copied += 1;
        }
        counts[name] = { found: snap.size, copied, skipped };
    }
    return { uid, appId, dryRun, counts, deletedSource: false };
}
