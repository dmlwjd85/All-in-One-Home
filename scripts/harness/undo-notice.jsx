import { createElement, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { finishUndoToast } from '../../src/ui/undoToast.js';
import {
    addHomework, resetClockForTest, setHomeworkDate, snapshot, subscribeStorageIssue, undo, update, useAuthForTest, useVaultsForTest,
} from '../../src/lib/db.js';

const vault = () => {
    const map = new Map();
    return { get: async (key) => map.get(key), set: async (key, value) => { map.set(key, value); }, remove: async (key) => { map.delete(key); } };
};
useVaultsForTest(vault(), vault(), vault());
resetClockForTest({ measured: true });
useAuthForTest('teacher-undo');

function App() {
    const [toast, setToast] = useState(null);
    useEffect(() => subscribeStorageIssue((message) => setToast({ message })), []);
    return createElement('div', null,
        createElement('button', {
            'data-role': 'setup',
            onClick: async () => {
                await addHomework('날짜 과제', '2026-11-16', 'hw-date', ['s1']);
                await setHomeworkDate('hw-date', '2026-11-20');
                const row = snapshot().homework.find((item) => item.id === 'hw-date');
                await update((draft) => {
                    const item = draft.homework.find((entry) => entry.id === 'hw-date');
                    item.title = '다른 이름';
                    item.metaAt = Number(row.metaAt) + 80;
                    return draft;
                });
                setToast({ message: '마감일을 바꿨어요.', undoable: true });
            },
        }, '준비'),
        toast ? createElement('div', { className: 'toast', role: 'status' },
            createElement('span', { 'data-role': 'toast-text' }, toast.message),
            toast.undoable ? createElement('button', {
                'data-role': 'undo',
                onClick: () => { undo().then((ok) => finishUndoToast(ok, () => setToast(null))); },
            }, '되돌리기') : null,
        ) : null,
    );
}

createRoot(document.getElementById('root')).render(createElement(App));
