/* check-attend-save 전용: 로그인한 출결 시트를 가짜 클라우드(ok·fail·hang)와 함께 띄웁니다. */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import * as db from '../../src/lib/db.js';
import { Ui } from '../../src/ui/context.jsx';
import { ReasonSheet } from '../../src/ui/Attend.jsx';

const plain = () => { const map = new Map(); return { get: async (k) => structuredClone(map.get(k)), set: async (k, v) => { map.set(k, structuredClone(v)); }, remove: async (k) => { map.delete(k); } }; };
window.__toasts = [];
window.__mode = 'ok';
const cloud = {
    available: () => true,
    push: async (uid, state, { hashes = {} } = {}) => {
        if (window.__mode === 'hang') return new Promise(() => {});
        if (window.__mode === 'fail') return { ok: false, pending: 1, hashes, rejected: [] };
        return { ok: true, pending: 0, hashes, rejected: [] };
    },
    pull: async () => ({ profile: {}, ids: {}, ats: { attendance: {} } }),
    remove: async () => ({ ok: true }),
};
function Shell() {
    const [open, setOpen] = useState(0);
    window.__open = () => setOpen((n) => n + 1);
    return (
        <Ui.Provider value={{ showToast: (t) => window.__toasts.push(t) }}>
            {open > 0 && <ReasonSheet key={open} student={{ id: 's1', no: 1, name: '가나' }} mark={null} date="2026-10-28" onClose={() => setOpen(0)} />}
        </Ui.Provider>
    );
}
(async () => {
    db.useVaultsForTest(plain(), plain(), plain());
    db.useCloudForTest(cloud);
    await db.boot('?at=08:42');
    await db.setAuth({ uid: 'u1' });
    createRoot(document.getElementById('root')).render(<Shell />);
    window.__ready = true;
})();
