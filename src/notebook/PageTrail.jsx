import { formatStamp, noteStatus } from './ssugeokModel.js';

export default function PageTrail({ page, fields, sensitiveNotes, onOpenNote }) {
    const placed = (fields?.ssugeokNotes || []).filter((row) => row && !row.sensitive);
    const local = (sensitiveNotes || []).filter((note) => (
        note?.placement?.page === page && noteStatus(note) !== 'inbox'
    ));
    const rows = [
        ...local.map((note) => ({
            noteId: note.id,
            text: note.text,
            date: note.detectedDate,
            tags: note.tags,
            studentNo: note.studentNo,
            sortedAt: note.placement.sortedAt,
            localOnly: true,
        })),
        ...placed.map((row) => ({ ...row, localOnly: false })),
    ];
    if (!rows.length) return null;
    return (
        <section className="nb-trail" aria-label="쓱적에서 온 기록">
            <p className="nb-kicker">쓱적에서 온 기록</p>
            <ul>
                {rows.map((row) => (
                    <li key={row.noteId}>
                        <time>{row.date || formatStamp(row.sortedAt)}</time>
                        <span className="nb-trail-text">{row.text}</span>
                        {row.localOnly && <em>이 기기만</em>}
                        <button type="button" onClick={() => onOpenNote?.(row.noteId)}>원문</button>
                    </li>
                ))}
            </ul>
        </section>
    );
}
