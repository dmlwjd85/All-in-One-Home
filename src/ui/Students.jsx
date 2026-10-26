import { useMemo, useState } from 'react';
import { joinedRecords, saveQuick } from '../lib/db.js';
import { isSensitiveText, MEMO_LOCAL_HINT } from '../lib/sensitive.js';
import { useUi } from './context.jsx';
import { Btn, givenName } from './bits.jsx';
import { ClayMark } from './ClayMark.jsx';

export function Students() {
    const { data, clock, go, openQuick } = useUi();
    const [q, setQ] = useState('');
    const records = joinedRecords(data);
    const month = clock.ymd.slice(0, 7);
    const rows = data.students.filter((row) => !q.trim() || `${row.no} ${row.name}`.includes(q.trim()));
    return (
        <div>
            <input className="field" placeholder="이름이나 번호" aria-label="학생 찾기" value={q} onChange={(event) => setQ(event.target.value)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', margin: '12px 0' }}>
                <Btn className="chip" onClick={() => go('#/students/neis')}>나이스에 옮길 것</Btn>
                <Btn className="chip on" onClick={() => openQuick('관찰')}>기록 남기기</Btn>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
                {rows.map((student) => {
                    const mine = records.filter((row) => row.sid === student.id && row.date.startsWith(month));
                    const follow = records.find((row) => row.sid === student.id && row.follow && row.follow >= clock.ymd);
                    return (
                        <Btn key={student.id} block className="glass" style={{ justifyContent: 'space-between', display: 'flex', padding: '8px 12px' }} onClick={() => go(`#/students/${student.no}`)}>
                            <span><strong className="num">{student.no}</strong> {student.name}</span>
                            <span className="muted">{mine.length ? `이번 달 ${mine.length}` : '이번 달 기록 없음'}{follow ? ` · ${Number(follow.follow.slice(5, 7))}/${Number(follow.follow.slice(8))} 다시` : ''}</span>
                        </Btn>
                    );
                })}
                {!rows.length && <p className="muted">명단에 없는 이름이에요. 설정에서 명단을 붙여 넣을 수 있어요.</p>}
            </div>
        </div>
    );
}

export function Student() {
    const { data, clock, route, openQuick, showToast } = useUi();
    const student = data.students.find((row) => row.no === route.params.no);
    const [tab, setTab] = useState('전체');
    const [text, setText] = useState('');
    const records = joinedRecords(data).filter((row) => row.sid === student?.id).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.at || '').localeCompare(String(a.at || '')));
    const filtered = records.filter((row) => tab === '전체' || (tab === '관찰' && (row.kind === '관찰' || row.kind === '칭찬')) || row.kind === tab);
    if (!student) return <p>이 번호는 명단에 없어요. 설정에서 넣어 주세요.</p>;
    const stats = [
        ['기록', records.length],
        ['상담', records.filter((row) => row.kind === '상담').length],
        ['칭찬', records.filter((row) => row.kind === '칭찬').length],
        ['나이스 옮김', records.filter((row) => row.neis && !row.neisMoved).length],
    ];
    return (
        <div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="symbol" style={{ width: 64, height: 64, borderRadius: 20, fontSize: 20 }}>{givenName(student.name)}</div>
                <div>
                    <h2 className="title-font" style={{ margin: 0, fontSize: 26 }}>{student.name}</h2>
                    <p className="muted" style={{ margin: 0 }}>{student.no}번 · {data.profile.className}</p>
                </div>
            </div>
            {student.memo ? (
                <div className="solid-card" style={{ padding: 12, marginTop: 12 }}>
                    <p style={{ margin: 0 }}>{student.memo}</p>
                    {isSensitiveText(student.memo) && <p style={{ margin: '6px 0 0' }}>{MEMO_LOCAL_HINT}</p>}
                </div>
            ) : null}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {stats.map(([label, value]) => <span key={label} className="chip">{label} {value}</span>)}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {['전체', '관찰', '상담', '보호자'].map((item) => (
                    <Btn key={item} className={tab === item ? 'chip on' : 'chip'} onClick={() => setTab(item)}>{item}</Btn>
                ))}
            </div>
            <div className="solid-card" style={{ padding: 12, marginTop: 12 }}>
                <input className="field" placeholder={`${givenName(student.name)}이 이야기 쨈, 적기`} aria-label="이 학생 기록" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={async (event) => {
                    if (event.key === 'Enter') {
                        const result = await saveQuick({ kind: '관찰', text, no: student.no, tags: ['학습'], neis: true });
                        if (result.ok) { setText(''); showToast(result.message, true); }
                    }
                }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {['관찰', '상담', '칭찬', '보호자'].map((kind) => (
                        <Btn key={kind} className="chip" onClick={() => openQuick(kind, { no: student.no })}>{kind}</Btn>
                    ))}
                </div>
            </div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                {filtered.map((row) => (
                    <article key={row.id} className="solid-card" style={{ padding: 12, background: row.kind === '상담' ? 'var(--k-counsel)' : row.kind === '보호자' ? 'var(--k-parent)' : row.kind === '칭찬' ? 'var(--k-praise)' : 'var(--k-observe)', color: 'var(--ink)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                            <strong>{row.kind} · {(row.tags || []).join(' · ')}</strong>
                            <span className="num">{row.date === clock.ymd ? clock.hm : row.date.slice(5)}</span>
                        </div>
                        <p style={{ marginBottom: 0 }}>{row.text}</p>
                        {row.localOnly && <p style={{ marginBottom: 0 }}>🔒 이 내용은 이 기기에만 있어요.</p>}
                        {row.neis && <p style={{ marginBottom: 0 }}>나이스에 옮길 것</p>}
                    </article>
                ))}
                {!filtered.length && (
                    <div>
                        <ClayMark />
                        <p className="muted" style={{ textAlign: 'center' }}>이 칸에는 아직 기록이 없어요.</p>
                    </div>
                )}
            </div>
            <p className="muted">건강·민원처럼 민감한 내용은 자물쇠가 붙고, 클라우드로 보내지 않아요.</p>
        </div>
    );
}

export function Neis() {
    const { data, showToast } = useUi();
    const records = joinedRecords(data).filter((row) => row.neis && !row.neisMoved && !row.localOnly);
    const groups = useMemo(() => {
        const map = new Map();
        records.forEach((row) => {
            const key = row.sid || 'none';
            if (!map.has(key)) map.set(key, []);
            map.get(key).push(row);
        });
        return [...map.entries()];
    }, [records]);

    async function copyAll() {
        const lines = groups.map(([sid, rows]) => {
            const student = data.students.find((item) => item.id === sid);
            const head = student ? `${student.no} ${student.name}` : '학생 미정';
            return `${head}\n${rows.map((row) => `- (${row.date}) ${row.text}`).join('\n')}`;
        }).join('\n\n');
        try {
            await navigator.clipboard.writeText(lines);
            showToast('나이스에 붙일 글을 복사했어요.');
        } catch {
            showToast('복사하지 못했어요. 글을 길게 눌러 선택해 주세요.');
        }
    }

    async function moved(row) {
        const { update } = await import('../lib/db.js');
        const saved = await update((draft) => {
            const list = row.localOnly ? draft.local.records : draft.records;
            const found = list.find((item) => item.id === row.id);
            if (found) found.neisMoved = true;
            return draft;
        }, { undoable: true });
        if (saved?.storageFailed) return;
        showToast('옮긴 것으로 표시했어요.', true);
    }

    return (
        <div>
            <p>나이스에 옮기려고 표시해 둔 기록만 모았어요. 복사한 뒤, 옮겼으면 표시해 주세요.</p>
            <Btn className="primary-btn block" onClick={copyAll}>전체 복사</Btn>
            {groups.map(([sid, rows]) => {
                const student = data.students.find((item) => item.id === sid);
                return (
                    <section key={sid} className="glass" style={{ padding: 12, marginTop: 12 }}>
                        <h3 style={{ marginTop: 0 }}>{student ? `${student.no} ${student.name}` : '학생을 아직 안 골랐어요'}</h3>
                        {rows.map((row) => (
                            <div key={row.id} style={{ marginBottom: 8 }}>
                                <p style={{ margin: '0 0 4px' }}>({row.date.slice(5)}) {row.text}</p>
                                <Btn className="chip" onClick={() => moved(row)}>옮겼어요</Btn>
                            </div>
                        ))}
                    </section>
                );
            })}
            {!groups.length && <p className="muted">옮길 기록이 없어요. 관찰을 남길 때 ‘나이스에 옮길 것’이 켜져 있어요.</p>}
        </div>
    );
}
