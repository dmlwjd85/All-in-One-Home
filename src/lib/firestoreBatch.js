import { writeBatch } from 'firebase/firestore';
import { db } from '../firebase';

const CHUNK = 400;

export async function runBatchOps(ops) {
    for (let i = 0; i < ops.length; i += CHUNK) {
        const slice = ops.slice(i, i + CHUNK);
        if (!slice.length) continue;
        const batch = writeBatch(db);
        for (const op of slice) op(batch);
        await batch.commit();
    }
}
