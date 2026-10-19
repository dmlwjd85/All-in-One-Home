import { useEffect, useMemo, useRef, useState } from 'react';
import { parseNote } from '../lib/parse.js';
import { isSensitiveText, SENSITIVE_HINT } from '../lib/sensitive.js';
import { saveQuick } from '../lib/db.js';
import { joinedRecords } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Area, Btn, KINDS, TAGS } from './bits.jsx';

export function QuickSheet({ initial, onClose }) {
    const { data, clock, showToast } = useUi();
    const [kind, setKind] = useState(initial?.kind || '관찰');
    const [text, setText] = useState('');
    const [no, setNo] = useState(initial?.no || 0);
    const [pad, setPad] = useState(false);
    const [neis, setNeis] = useState(kind === '관찰' || kind === '칭찬');
    const [tags, setTags] = useState(TAGS[kind]?.[0] ? [TAGS[kind][0]] : []);
    const box = useRef(null);
    const parsed = useMemo(() => parseNote(text), [text]);
    const chosenNo = parsed.studentNo || no;
    const student = data.students.find((row) => row.no === Number(chosenNo));
    const sensitive = parsed.sensitive || isSensitiveText(text, tags);
    const recent = useMemo(() => {
        const records = joinedRecords(data);
        const last = new Map();
        records.forEach((row) => {
            if (row.sid && (!last.has(row.sid) || String(row.at || row.date) > last.get(row.sid))) last.set(row.sid, String(row.at || row.date));
        });
        return [...data.students].sort((a, b) => String(last.get(b.id) || '').localeCompare(String(last.get(a.id) || '')) || a.no - b.no).slice(0, 4);
    }, [data]);

    useEffect(() => { box.current?.focus(); }, []);
    useEffect(() => {
        setNeis(kind === '관찰' || kind === '칭찬');
        setTags(TAGS[kind]?.[0] ? [TAGS[kind][0]] : []);
    }, [kind]);

    async function save() {
        const result = await saveQuick({ kind, text, no: chosenNo, tags, neis }, new Date());
        if (!result.ok) {
            showToast(result.message, false);
            return;
        }
        showToast(result.message, true);
        onClose();
    }

    function onKey(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            save();
        }
    }

    const needsStudent = ['관찰', '상담', '보호자', '칭찬'].includes(kind);

    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="쓱, 적" onClick={(event) => event.stopPropagation()} data-screen="quick">
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                <h2 className="title-font" style={{ fontSize: 22, margin: '0 0 8px' }}>쓱, 적</h2>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                    {KINDS.map((item) => (
                        <Btn key={item.id} className={kind === item.id ? 'chip on' : 'chip'} onClick={() => setKind(item.id)}>{item.emoji} {item.label}</Btn>
                    ))}
                </div>
                {needsStudent && (
                    <>
                        <p style={{ fontWeight: 800 }}>누구 이야기예요? 최근에 적은 친구부터 보여 드려요.</p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {recent.map((row) => (
                                <Btn key={row.id} className={student?.id === row.id ? 'chip on' : 'chip'} onClick={() => { setNo(row.no); setPad(false); }}>{row.no} {row.name}</Btn>
                            ))}
                            <Btn className="chip" onClick={() => setPad((value) => !value)}>번호로</Btn>
                        </div>
                        {pad && (
                            <div className="cell-grid" style={{ marginTop: 8 }}>
                                {data.students.map((row) => (
                                    <Btn key={row.id} className={student?.id === row.id ? 'chip on block' : 'chip block'} onClick={() => { setNo(row.no); setPad(false); }}>{row.no}</Btn>
                                ))}
                            </div>
                        )}
                    </>
                )}
                <Area ref={box} rows={4} aria-label="내용" placeholder="한 줄로 적어도 충분해요" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={onKey} style={{ marginTop: 12 }} />
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 10 }}>
                    {(TAGS[kind] || []).map((tag) => (
                        <Btn key={tag} className={tags.includes(tag) ? 'chip on' : 'chip'} onClick={() => setTags((prev) => prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag])}>#{tag}</Btn>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                    <span className="chip" style={{ display: 'inline-flex', alignItems: 'center' }}>오늘 {clock.hm}</span>
                    {needsStudent && (
                        <Btn className={neis ? 'chip on' : 'chip'} onClick={() => setNeis((value) => !value)}>나이스에 옮길 것</Btn>
                    )}
                </div>
                {sensitive && <p style={{ fontWeight: 800 }}>🔒 {SENSITIVE_HINT}</p>}
                <Btn className="primary-btn block" style={{ marginTop: 12 }} onClick={save}>{student ? `${student.name} ${kind} 남기기` : `${kind} 남기기`}</Btn>
            </div>
        </div>
    );
}
