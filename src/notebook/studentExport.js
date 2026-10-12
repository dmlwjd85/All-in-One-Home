import { counselPage, parentPage, whoPage } from './ssugeokModel.js';
import { readPageFields } from './fieldStore.js';
import { studentCardPage } from './nav.js';

export function buildStudentExport(studentNo, rosterName = '') {
    const n = Number(studentNo);
    const card = readPageFields(studentCardPage(n));
    return {
        exportedAt: new Date().toISOString(),
        student: n,
        name: rosterName || card.name || '',
        card,
        who: readPageFields(whoPage(n)),
        counsel: readPageFields(counselPage(n)),
        parent: readPageFields(parentPage(n)),
    };
}
