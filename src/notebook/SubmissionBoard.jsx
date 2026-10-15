import { useEffect, useState } from 'react';
import { ConfirmDialog } from '../components/ui.jsx';
import { addItem, patchItem, removeItem } from '../lib/store.js';
import { readPageFields } from './fieldStore.js';
import { alimSentence, missingNumbers } from './boardsModel.js';

function rosterNames() {
    const fields = readPageFields(154);
    return Array.from({ length: 32 }, (_, i) => ({
        no: i + 1,
        name: String(fields[`name${i + 1}`] || '').trim(),
    }));
}

function useRosterNames() {
    const [rows, setRows] = useState(rosterNames);
    useEffect(() => {
        const onRefresh = (event) => {
            if (Number(event.detail?.page) !== 154) return;
            setRows(rosterNames());
        };
        window.addEventListener('nb-page-fields', onRefresh);
        return () => window.removeEventListener('nb-page-fields', onRefresh);
    }, []);
    return rows;
}

export default function SubmissionBoard({ sheets, signedIn, onChanged, onToast }) {
    const students = useRosterNames();
    const [title, setTitle] = useState('');
    const [activeId, setActiveId] = useState(null);
    const [pending, setPending] = useState(false);
    const active = (sheets || []).find((sheet) => sheet.id === activeId) || sheets?.[0] || null;
    const missing = active ? missingNumbers(active.submitted) : [];
    const sentence = active ? alimSentence(active.title, missing) : '';

    const add = async (event) => {
        event.preventDefault();
        if (!title.trim()) return;
        const id = await addItem('submissionSheets', { title: title.trim(), submitted: [] }, signedIn);
        setTitle('');
        setActiveId(id);
        onChanged?.();
    };

    const toggle = async (sheet, no) => {
        const have = new Set(sheet.submitted || []);
        if (have.has(no)) have.delete(no);
        else have.add(no);
        await patchItem('submissionSheets', sheet.id, {
            submitted: [...have].sort((a, b) => a - b),
        }, signedIn);
        onChanged?.();
    };

    const copy = async () => {
        if (!sentence) return;
        try {
            await navigator.clipboard.writeText(sentence);
            onToast?.('알림장 문장을 복사했어요.');
        } catch {
            onToast?.('복사하지 못했어요. 문장을 길게 눌러 선택해 주세요.');
        }
    };

    return (
        <div className="nb-submit">
            <form className="nb-dday-form" onSubmit={add}>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제출물 이름" aria-label="제출물 이름" />
                <button type="submit">칸 추가</button>
            </form>
            {(sheets || []).length === 0 && <p className="nb-hint">제출물을 하나 올리면 번호 칸이 생겨요. 이름은 명렬표에서 가져와요.</p>}
            {active && (
                <>
                    <div className="nb-submit-tabs">
                        {(sheets || []).map((sheet) => (
                            <button
                                key={sheet.id}
                                type="button"
                                className={sheet.id === active.id ? 'is-on' : ''}
                                onClick={() => setActiveId(sheet.id)}
                            >
                                {sheet.title}
                            </button>
                        ))}
                    </div>
                    <div className="nb-submit-grid" role="grid" aria-label={`${active.title} 제출`}>
                        {students.map((student) => {
                            const on = (active.submitted || []).includes(student.no);
                            return (
                                <button
                                    key={student.no}
                                    type="button"
                                    role="gridcell"
                                    aria-pressed={on}
                                    className={on ? 'is-on' : ''}
                                    onClick={() => toggle(active, student.no)}
                                >
                                    <b>{student.no}</b>
                                    {student.name ? <small>{student.name}</small> : null}
                                </button>
                            );
                        })}
                    </div>
                    <div className="nb-submit-copy">
                        <p>{sentence}</p>
                        <button type="button" onClick={copy}>알림장 복사</button>
                        <button type="button" onClick={() => setPending(true)}>이 칸 지우기</button>
                    </div>
                    {pending && (
                        <ConfirmDialog
                            title="이 칸을 지울까요?"
                            body={active.title}
                            onClose={() => setPending(false)}
                            onConfirm={async () => {
                                const id = active.id;
                                setPending(false);
                                await removeItem('submissionSheets', id, signedIn);
                                onChanged?.();
                            }}
                        />
                    )}
                </>
            )}
        </div>
    );
}
