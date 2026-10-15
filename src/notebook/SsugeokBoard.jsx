import { useEffect, useMemo, useRef, useState } from 'react';
import { readPageFields } from './fieldStore.js';
import {
    destinationFor,
    formatStamp,
    placeSuggestion,
    quietStudents,
    whoPage,
} from './ssugeokModel.js';
import { archiveNotes, sortNote } from './ssugeokStore.js';
import { TONE_MARK } from './tones.js';
import CaptureBox from './diary/CaptureBox.jsx';

const FILTERS = [
    ['inbox', '미분류'],
    ['sorted', '분류됨'],
    ['archived', '보관'],
];

const DEST_OPTIONS = [
    ['', '제안대로'],
    ['who', '누가기록'],
    ['counsel', '상담'],
    ['parent', '보호자'],
    ['attend', '출결'],
    ['todo', '할 일'],
    ['deadline', '기한'],
    ['meeting', '회의'],
    ['progress', '수업'],
    ['budget', '예산'],
    ['special', '특별한 하루'],
];

function whoActivity() {
    const pageNotesByStudent = {};
    for (let n = 1; n <= 32; n += 1) {
        const fields = readPageFields(whoPage(n));
        const list = [];
        for (let i = 0; i < 12; i += 1) {
            if (fields[`d${i}`]) list.push({ date: fields[`d${i}`], sortedAt: fields[`d${i}`] });
        }
        for (const item of fields.ssugeokNotes || []) {
            if (!item?.sensitive) list.push(item);
        }
        if (list.length) pageNotesByStudent[n] = list;
    }
    return pageNotesByStudent;
}

function readyNote(note, draft) {
    const studentNo = draft?.studentNo || note.studentNo || null;
    const parsed = {
        tags: note.tags,
        studentNo,
        detectedDate: note.detectedDate,
        sensitive: note.sensitive,
    };
    let suggestion = draft?.destId ? destinationFor(draft.destId, parsed) : note.suggestion;
    suggestion = placeSuggestion(suggestion, studentNo);
    return { ...note, studentNo, suggestion };
}

export function useQuietNumbers(notes) {
    return useMemo(() => quietStudents(notes, whoActivity()), [notes]);
}

export default function SsugeokBoard({
    notes,
    signedIn,
    author,
    fromPage,
    onChanged,
    onToast,
    onGo,
    focusId,
}) {
    const [filter, setFilter] = useState('inbox');
    const [picked, setPicked] = useState({});
    const [drafts, setDrafts] = useState({});
    const quiet = useQuietNumbers(notes);
    const shownQuiet = quiet.slice(0, 16);
    const counts = {
        inbox: notes.filter((n) => n.status === 'inbox').length,
        sorted: notes.filter((n) => n.status === 'sorted').length,
        archived: notes.filter((n) => n.status === 'archived').length,
    };
    const shown = notes.filter((n) => n.status === filter);

    useEffect(() => {
        const onFilter = (e) => setFilter(e.detail);
        window.addEventListener('nb-ssu-filter', onFilter);
        return () => window.removeEventListener('nb-ssu-filter', onFilter);
    }, []);

    const notesRef = useRef(notes);
    notesRef.current = notes;
    useEffect(() => {
        if (!focusId) return;
        const note = notesRef.current.find((n) => n.id === focusId);
        if (note) setFilter(note.status);
    }, [focusId]);

    useEffect(() => {
        if (!focusId) return;
        document.getElementById(`ssu-note-${focusId}`)?.scrollIntoView({ block: 'nearest' });
    }, [focusId, shown.length, filter]);

    const setDraft = (id, patch) => {
        setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    };

    const sortOne = async (note) => {
        const ready = readyNote(note, drafts[note.id]);
        if (ready.suggestion?.needsStudent && !ready.studentNo) {
            onToast?.('아이 번호를 고르거나 @번호 로 적어 주세요.');
            return false;
        }
        const placement = await sortNote(ready, ready.suggestion, signedIn);
        onChanged?.();
        onToast?.(`${placement.label}으로 옮겼어요. 원문은 여기 남아요.`);
        return true;
    };

    const archiveSome = async (list) => {
        if (!list.length) return;
        await archiveNotes(list, signedIn);
        setPicked({});
        onChanged?.();
        onToast?.(list.length > 1 ? `${list.length}개를 보관했어요.` : '보관했어요.');
    };

    const sortPicked = async () => {
        const list = shown.filter((n) => picked[n.id]);
        let moved = 0;
        let skipped = 0;
        for (const note of list) {
            const ready = readyNote(note, drafts[note.id]);
            if (ready.suggestion?.needsStudent && !ready.studentNo) {
                skipped += 1;
                continue;
            }
            await sortNote(ready, ready.suggestion, signedIn);
            moved += 1;
        }
        if (moved) {
            setPicked({});
            onChanged?.();
            onToast?.(skipped ? `${moved}개를 옮겼어요. 번호가 없는 ${skipped}개는 남겨 두었어요.` : `${moved}개를 옮겼어요.`);
        } else if (skipped) {
            onToast?.('아이 번호를 고르거나 @번호 로 적어 주세요.');
        }
    };

    return (
        <div className="nb-ssu-board">
            <CaptureBox
                big
                autoFocus
                author={author}
                signedIn={signedIn}
                fromPage={fromPage}
                onChanged={onChanged}
                onToast={onToast}
                onSaved={() => setFilter('inbox')}
            />
            <p className="dy-muted dy-note">적기만 하세요. 아래 제안을 누를 때만 옮겨지고, 원문은 여기 남아요.</p>

            <div className="nb-ssu-filters" role="tablist" aria-label="메모 상태">
                {FILTERS.map(([id, label]) => (
                    <button
                        key={id}
                        type="button"
                        role="tab"
                        aria-selected={filter === id}
                        className={filter === id ? 'is-on' : ''}
                        onClick={() => setFilter(id)}
                    >
                        {label} {counts[id]}
                    </button>
                ))}
            </div>

            {shownQuiet.length > 0 && (
                <div className="nb-quiet">
                    <span>최근 3주 누가기록이 없어요</span>
                    {shownQuiet.map((n) => (
                        <button key={n} type="button" onClick={() => onGo?.(whoPage(n))}>{n}</button>
                    ))}
                    {quiet.length > shownQuiet.length && <span>외 {quiet.length - shownQuiet.length}명</span>}
                </div>
            )}

            {filter === 'inbox' && shown.some((n) => picked[n.id]) && (
                <div className="nb-ssu-bulk">
                    <button type="button" onClick={sortPicked}>고른 메모 옮기기</button>
                    <button type="button" onClick={() => archiveSome(shown.filter((n) => picked[n.id]))}>보관</button>
                </div>
            )}

            <ul className="nb-ssu-list">
                {shown.length === 0 && <li className="nb-ssu-empty">이 칸은 비어 있어요. 한 줄 적고 Enter.</li>}
                {shown.map((note) => {
                    const draft = drafts[note.id] || {};
                    const ready = readyNote(note, draft);
                    const suggestion = ready.suggestion;
                    const mark = TONE_MARK[suggestion?.tone] || '✦';
                    return (
                        <li key={note.id} id={`ssu-note-${note.id}`} className={focusId === note.id ? 'is-focus' : ''}>
                            <label className="nb-ssu-check">
                                <input
                                    type="checkbox"
                                    checked={!!picked[note.id]}
                                    onChange={(e) => setPicked((prev) => ({ ...prev, [note.id]: e.target.checked }))}
                                    aria-label="메모 선택"
                                />
                            </label>
                            <div className="nb-ssu-body">
                                <p className="nb-ssu-meta">
                                    <time>{formatStamp(note.createdAt)}</time>
                                    {note.studentNo ? <span>@{note.studentNo}</span> : null}
                                    {(note.tags || []).map((tag) => <span key={tag}>#{tag}</span>)}
                                    {note.detectedDate ? <span>{note.detectedDate}</span> : null}
                                    {note.sensitive ? <em>이 기기만</em> : null}
                                </p>
                                <p className="nb-ssu-text">{note.text}</p>
                                {note.status !== 'archived' && (
                                    <div className="nb-ssu-actions">
                                        <select
                                            value={draft.destId || ''}
                                            onChange={(e) => setDraft(note.id, { destId: e.target.value })}
                                            aria-label="옮길 곳"
                                        >
                                            {DEST_OPTIONS.map(([id, label]) => <option key={id || 'auto'} value={id}>{label}</option>)}
                                        </select>
                                        {suggestion?.needsStudent && (
                                            <select
                                                value={draft.studentNo || note.studentNo || ''}
                                                onChange={(e) => setDraft(note.id, { studentNo: Number(e.target.value) || null })}
                                                aria-label="학생 번호"
                                            >
                                                <option value="">번호</option>
                                                {Array.from({ length: 32 }, (_, i) => (
                                                    <option key={i + 1} value={i + 1}>{i + 1}번</option>
                                                ))}
                                            </select>
                                        )}
                                        <button type="button" className={`tone-${suggestion?.tone || 'sand'}`} onClick={() => sortOne(note)}>
                                            {mark} {suggestion?.label || '옮기기'}
                                        </button>
                                        {note.placement?.page && (
                                            <button type="button" onClick={() => onGo?.(note.placement.page)}>쪽 열기</button>
                                        )}
                                        <button type="button" onClick={() => archiveSome([note])}>보관</button>
                                    </div>
                                )}
                                {note.status === 'archived' && note.placement?.page && (
                                    <button type="button" onClick={() => onGo?.(note.placement.page)}>나눠 둔 쪽</button>
                                )}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
