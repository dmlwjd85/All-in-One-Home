import { useEffect, useMemo, useRef, useState } from 'react';
import { joinedRecords, removeItem, saveQuick, saveTextItem } from '../lib/db.js';
import { isSensitiveText, MEMO_LOCAL_HINT } from '../lib/sensitive.js';
import { useUi } from './context.jsx';
import { Btn, givenName } from './bits.jsx';
import { ClayMark } from './ClayMark.jsx';
import { seoulParts, seoulYmd } from '../lib/date.js';
import { csvEscape, htmlEscape } from '../lib/neisExport.js';
import { DateChip } from './DateChip.jsx';

/** 오늘 기록 칩 옆 시각. 남긴 때(at)가 있으면 그 시각, 없으면 지금 시각입니다. */
function recordHm(row, fallback) {
    const at = row?.at ? new Date(row.at) : null;
    return at && !Number.isNaN(at.getTime()) ? seoulParts(at).hm : fallback;
}

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
                <Btn className="chip" onClick={() => go('#/students/neis')}>나이스 모아 보기</Btn>
                <Btn className="chip on" onClick={() => openQuick('관찰')}>기록 남기기</Btn>
            </div>
            <div className="student-roster-grid">
                {rows.map((student) => {
                    const mine = records.filter((row) => row.sid === student.id && row.date.startsWith(month));
                    const follow = records.find((row) => row.sid === student.id && row.follow && row.follow >= clock.ymd);
                    return (
                        <Btn key={student.id} className={mine.length ? 'glass roster-cell has-rec' : 'glass roster-cell'} onClick={() => go(`#/students/${student.no}`, { state: { appFrom: 'students' } })}>
                            <span className="roster-name"><strong className="num">{student.no}</strong> {student.name}</span>
                            <span className="muted roster-count">{mine.length ? `이번 달 ${mine.length}` : '기록 없음'}{follow ? ` · ${Number(follow.follow.slice(5, 7))}/${Number(follow.follow.slice(8))} 다시` : ''}</span>
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
    const [editingId, setEditingId] = useState('');
    const [draft, setDraft] = useState('');
    const editFieldRef = useRef(null);
    useEffect(() => {
        if (!editingId) return;
        const node = editFieldRef.current;
        if (!node) return;
        node.focus();
        const end = node.value.length;
        try { node.setSelectionRange(end, end); } catch { /* 일부 환경은 선택 구간을 막습니다 */ }
    }, [editingId]);
    const records = joinedRecords(data).filter((row) => row.sid === student?.id).sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.at || '').localeCompare(String(a.at || '')));
    const filtered = records.filter((row) => tab === '전체' || (tab === '관찰' && (row.kind === '관찰' || row.kind === '칭찬')) || row.kind === tab);
    if (!student) return <p>이 번호는 명단에 없어요. 설정에서 넣어 주세요.</p>;
    const stats = [
        ['기록', records.length],
        ['상담', records.filter((row) => row.kind === '상담').length],
        ['칭찬', records.filter((row) => row.kind === '칭찬').length],
        ['나이스 옮김', records.filter((row) => row.neis && !row.neisMoved).length],
    ];

    function focusEditButton(id) {
        requestAnimationFrame(() => {
            document.querySelector(`[data-edit-for="${CSS.escape(String(id))}"]`)?.focus();
        });
    }

    function cancelEdit(rowId) {
        setEditingId('');
        setDraft('');
        focusEditButton(rowId);
    }

    async function saveEdit(row) {
        const next = draft.trim();
        if (!next) {
            showToast('한 줄만 적어도 남길 수 있어요.');
            return;
        }
        const result = await saveTextItem('records', { ...row, text: next }, { from: row.localOnly ? 'local' : 'cloud' });
        if (result?.storageFailed) {
            showToast(result.message || '기록을 저장하지 못했어요. 쓰던 글은 그대로 있어요.');
            return;
        }
        setEditingId('');
        setDraft('');
        showToast(result.sensitive ? '이 내용은 이 기기에만 남겨 둘게요.' : '기록을 고쳤어요.', true);
        focusEditButton(row.id);
    }

    async function removeRecord(row) {
        if (!window.confirm('이 기록을 지울까요?')) return;
        const failed = await removeItem('records', row.id);
        if (failed?.storageFailed) {
            showToast(failed.message || '기록을 지우지 못했어요. 글은 그대로 있어요.');
            return;
        }
        if (editingId === row.id) {
            setEditingId('');
            setDraft('');
        }
        showToast('기록을 지웠어요.', true);
    }

    return (
        <div>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div className="symbol" style={{ width: 64, height: 64, borderRadius: 20, fontSize: 20 }}>{givenName(student.name)}</div>
                <div>
                    <h2 className="title-font font-display" style={{ margin: 0, fontSize: 26 }}>{student.name}</h2>
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
                <input className="field" placeholder={`${givenName(student.name)} 이야기 발라 두기`} aria-label="이 학생 기록" value={text} onChange={(event) => setText(event.target.value)} onKeyDown={async (event) => {
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
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                            <strong>{row.kind} · {(row.tags || []).join(' · ')}</strong>
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <DateChip ymd={row.date} today={clock.ymd} />
                                {row.date === clock.ymd ? <span className="num muted" data-role="record-hm">{recordHm(row, clock.hm)}</span> : null}
                            </span>
                        </div>
                        {editingId === row.id ? (
                            <div style={{ marginTop: 8 }}>
                                <textarea
                                    ref={editFieldRef}
                                    className="field"
                                    rows={3}
                                    aria-label="기록 고치기"
                                    value={draft}
                                    onChange={(event) => setDraft(event.target.value)}
                                    onKeyDown={(event) => {
                                        if (event.key === 'Escape') {
                                            event.preventDefault();
                                            cancelEdit(row.id);
                                            return;
                                        }
                                        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                                            event.preventDefault();
                                            saveEdit(row);
                                        }
                                    }}
                                />
                                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                    <Btn className="primary-btn" onClick={() => saveEdit(row)}>저장</Btn>
                                    <Btn className="chip" onClick={() => cancelEdit(row.id)}>취소</Btn>
                                </div>
                            </div>
                        ) : (
                            <>
                                <p style={{ marginBottom: 0 }}>{row.text}</p>
                                {row.localOnly && <p style={{ marginBottom: 0 }}>🔒 이 내용은 이 기기에만 있어요.</p>}
                                {row.neis && <p style={{ marginBottom: 0 }}>나이스에 옮길 것</p>}
                                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                    <Btn
                                        className="chip"
                                        data-edit-for={row.id}
                                        onClick={() => { setEditingId(row.id); setDraft(row.text || ''); }}
                                    >수정</Btn>
                                    <Btn className="chip" onClick={() => removeRecord(row)}>삭제</Btn>
                                </div>
                            </>
                        )}
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

function neisCsv(groups, students) {
    const lines = [['번호', '이름', '날짜', '종류', '태그', '내용'].map(csvEscape).join(',')];
    groups.forEach(([sid, rows]) => {
        const student = students.find((item) => item.id === sid);
        const no = student?.no ?? '';
        const name = student?.name || '학생 미정';
        rows.forEach((row) => {
            lines.push([
                no,
                name,
                row.date || '',
                row.kind || '',
                (row.tags || []).join(' · '),
                row.text || '',
            ].map(csvEscape).join(','));
        });
    });
    return `\uFEFF${lines.join('\n')}`;
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
        return [...map.entries()].map(([sid, rows]) => [
            sid,
            [...rows].sort((a, b) => String(a.date).localeCompare(String(b.date)) || String(a.at || '').localeCompare(String(b.at || ''))),
        ]);
    }, [records]);
    const [picked, setPicked] = useState(() => groups[0]?.[0] || '');
    const activeSid = groups.some(([sid]) => sid === picked) ? picked : (groups[0]?.[0] || '');
    const activeRows = groups.find(([sid]) => sid === activeSid)?.[1] || [];
    const activeStudent = data.students.find((item) => item.id === activeSid);

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

    function downloadCsv() {
        if (!groups.length) {
            showToast('내려받을 기록이 없어요.');
            return;
        }
        const body = neisCsv(groups, data.students);
        const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        const stamp = seoulYmd();
        link.href = url;
        link.download = `나이스모아_${stamp}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        showToast('엑셀에서 열 수 있는 표를 이 기기에만 내려받았어요.');
    }

    function printTable() {
        if (!groups.length) {
            showToast('출력할 기록이 없어요.');
            return;
        }
        const rowsHtml = groups.map(([sid, rows]) => {
            const student = data.students.find((item) => item.id === sid);
            const head = student ? `${student.no} ${student.name}` : '학생 미정';
            const body = rows.map((row) => {
                const text = htmlEscape(row.text || '').replace(/\n/g, '<br>');
                return `<tr><td>${htmlEscape(row.date || '')}</td><td>${htmlEscape(row.kind || '')}</td><td>${htmlEscape((row.tags || []).join(' · '))}</td><td>${text}</td></tr>`;
            }).join('');
            return `<h2>${htmlEscape(head)}</h2><table border="1" cellspacing="0" cellpadding="6"><thead><tr><th>날짜</th><th>종류</th><th>태그</th><th>내용</th></tr></thead><tbody>${body}</tbody></table>`;
        }).join('');
        const win = window.open('', '_blank');
        if (!win) {
            showToast('출력 창을 열지 못했어요. 먼저 「내려받기」로 받은 파일을 출력해 주세요.');
            return;
        }
        win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>나이스 모아 보기 · 쨈 교무수첩</title><style>body{padding:16px;color:#111}h1{font-size:20px;margin:0 0 4px}.brand{font-size:13px;color:#555;margin:0 0 12px}h2,table{break-inside:avoid;page-break-inside:avoid}table{border-collapse:collapse;width:100%;margin:0 0 16px;table-layout:fixed}th,td{vertical-align:top;border:1px solid #999;padding:6px;word-break:break-word;white-space:pre-wrap}th:nth-child(1),td:nth-child(1){width:6em}th:nth-child(2),td:nth-child(2){width:4em}th:nth-child(3),td:nth-child(3){width:6em}th:nth-child(4),td:nth-child(4){width:auto}td:nth-child(1){white-space:nowrap}</style></head><body><p class="brand">쨈 교무수첩</p><h1>나이스 모아 보기</h1><p>민감 기록은 이 기기에만 있어요.</p>${rowsHtml}</body></html>`);
        win.document.close();
        win.focus();
        win.print();
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
            <p>나이스에 옮기려고 표시해 둔 기록만 모았어요. 복사한 뒤, 옮겼으면 표시해 주세요. 「내려받기」는 엑셀에서 열 수 있는 표(.csv)로 이 기기에만 받습니다.</p>
            <div className="neis-tools" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn className="primary-btn fit-btn" onClick={copyAll}>전체 복사</Btn>
                <Btn className="chip" onClick={downloadCsv}>내려받기</Btn>
                <Btn className="chip" onClick={printTable}>출력</Btn>
            </div>
            {!groups.length && <p className="muted">옮길 기록이 없어요. 관찰을 남길 때 ‘나이스에 옮길 것’이 켜져 있어요.</p>}
            {groups.length > 0 && (
                <div className="neis-split" data-neis-split="1" style={{ marginTop: 12 }}>
                    <nav className="neis-list" aria-label="나이스 학생 목록">
                        {groups.map(([sid, rows]) => {
                            const student = data.students.find((item) => item.id === sid);
                            const label = student ? `${student.no} ${student.name}` : '학생을 아직 안 골랐어요';
                            return (
                                <Btn
                                    key={sid}
                                    className={sid === activeSid ? 'chip on neis-list-item is-on' : 'chip neis-list-item'}
                                    aria-current={sid === activeSid ? 'true' : undefined}
                                    onClick={() => setPicked(sid)}
                                >
                                    {label}
                                    <span className="muted neis-count">{rows.length}건</span>
                                </Btn>
                            );
                        })}
                    </nav>
                    <section className="glass neis-detail" style={{ padding: 12 }}>
                        <h3 style={{ marginTop: 0 }}>{activeStudent ? `${activeStudent.no} ${activeStudent.name}` : '학생을 아직 안 골랐어요'}</h3>
                        {activeRows.map((row) => (
                            <div key={row.id} style={{ marginBottom: 8 }}>
                                <p style={{ margin: '0 0 4px' }}>({row.date.slice(5)}) {row.text}</p>
                                <Btn className="chip" onClick={() => moved(row)}>옮겼어요</Btn>
                            </div>
                        ))}
                        {!activeRows.length && <p className="muted">이 학생 기록이 없어요.</p>}
                    </section>
                </div>
            )}
        </div>
    );
}
