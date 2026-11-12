import { useEffect, useMemo, useRef, useState } from 'react';
import { joinedRecords, removeItem, saveQuick, saveTextItem } from '../lib/db.js';
import { isSensitiveText, MEMO_LOCAL_HINT } from '../lib/sensitive.js';
import { useUi } from './context.jsx';
import { Btn, givenName } from './bits.jsx';
import { ClayMark } from './ClayMark.jsx';
import { seoulParts, seoulYmd } from '../lib/date.js';
import { htmlEscape } from '../lib/neisExport.js';
import { DateChip } from './DateChip.jsx';
import { groupMates } from '../lib/nameLink.js';
import { LOG_KINDS, LOG_PERIODS, filterLog, schoolYearOf, sortLog, studentLogText } from '../lib/studentLog.js';
import { termRange } from '../lib/semester.js';
import { RecordExport } from './ClassExport.jsx';
import { RosterPaste } from './RosterPaste.jsx';

/** 오늘 기록 칩 옆 시각. 남긴 때(at)가 있으면 그 시각, 없으면 지금 시각입니다. */
function recordHm(row, fallback) {
    const at = row?.at ? new Date(row.at) : null;
    return at && !Number.isNaN(at.getTime()) ? seoulParts(at).hm : fallback;
}

export function Students() {
    const { data, clock, go, openQuick, showToast } = useUi();
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
            {!data.students.length && (
                <section className="glass" data-empty-roster="1" style={{ padding: 14, marginBottom: 12 }}>
                    <h2 className="title-font" style={{ marginTop: 0, fontSize: 20 }}>명단이 아직 없어요</h2>
                    <p className="muted" style={{ marginTop: 0 }}>엑셀·한글 표·나이스 화면에서 번호와 이름을 복사해 붙여 넣으면 한 번에 들어가요.</p>
                    <RosterPaste data={data} showToast={showToast} />
                </section>
            )}
            {(data.students.length > 0 || joinedRecords(data).length > 0) && (
                <div style={{ margin: '0 0 12px' }}>
                    <RecordExport data={data} showToast={showToast} />
                </div>
            )}
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
                {!rows.length && data.students.length > 0 && <p className="muted">명단에 없는 이름이에요. 설정에서 명단을 붙여 넣을 수 있어요.</p>}
            </div>
        </div>
    );
}

export function Student() {
    const { data, clock, route, openQuick, showToast } = useUi();
    const student = data.students.find((row) => row.no === route.params.no);
    const [tab, setTab] = useState('전체');
    /* 모아 보기: 기간, 날짜 차례(new 최근부터 · old 오래된 것부터), 복사할 기록 고르기. */
    const [period, setPeriod] = useState('all');
    const [order, setOrder] = useState('new');
    const [chosen, setChosen] = useState(() => new Set());
    const [text, setText] = useState('');
    const [editingId, setEditingId] = useState('');
    const [draft, setDraft] = useState('');
    const editFieldRef = useRef(null);
    /* 한 줄 기록 저장 중에 Enter를 또 눌러도 한 번만 저장합니다. */
    const lineBusy = useRef(false);
    const [lineSaving, setLineSaving] = useState(false);
    useEffect(() => {
        if (!editingId) return;
        const node = editFieldRef.current;
        if (!node) return;
        node.focus();
        const end = node.value.length;
        try { node.setSelectionRange(end, end); } catch { /* 일부 환경은 선택 구간을 막습니다 */ }
    }, [editingId]);
    const allRecords = joinedRecords(data);
    const records = sortLog(allRecords.filter((row) => row.sid === student?.id), 'new');
    /* 2학기 시작일은 학사일정(설정·일정 글자)에서 읽고, 없으면 기본값입니다. */
    let secondStart = '';
    try { secondStart = termRange('second', schoolYearOf(clock.ymd), data.events).from; } catch { secondStart = ''; }
    const filtered = sortLog(filterLog(records, { kind: tab, period, today: clock.ymd, secondStart }), order);
    const periodLabel = LOG_PERIODS.find((item) => item.id === period)?.label || '';
    const pickedRows = filtered.filter((row) => chosen.has(row.id));
    /** 묶음 기록(한 기록에 여러 학생)의 다른 학생 이름. */
    const matesOf = (row) => groupMates(row, allRecords).map((sid) => data.students.find((item) => item.id === sid)?.name).filter(Boolean);
    if (!student) return <p>이 번호는 명단에 없어요. 설정에서 넣어 주세요.</p>;
    const stats = [
        ['기록', records.length],
        ['상담', records.filter((row) => row.kind === '상담').length],
        ['칭찬', records.filter((row) => row.kind === '칭찬').length],
        ['나이스 옮김', records.filter((row) => row.neis && !row.neisMoved).length],
    ];

    async function saveLine() {
        if (lineBusy.current) return;
        const sent = text;
        if (!sent.trim()) { showToast('한 줄만 적어도 남길 수 있어요.'); return; }
        lineBusy.current = true;
        setLineSaving(true);
        try {
            const result = await saveQuick({ kind: '관찰', text: sent, no: student.no, tags: ['학습'], neis: true });
            if (result?.ok) {
                /* 저장하는 동안 더 적은 글이 있으면 지우지 않습니다. */
                setText((now) => (now === sent ? '' : now));
                showToast(result.message, true);
                return;
            }
            showToast(result?.storageFailed
                ? `${result.message || '기록을 저장하지 못했어요.'} 쓰던 글은 그대로 있어요.`
                : (result?.message || '기록을 남기지 못했어요. 쓰던 글은 그대로 있어요.'));
        } catch {
            showToast('기록을 남기지 못했어요. 쓰던 글은 그대로 있어요.');
        } finally {
            lineBusy.current = false;
            setLineSaving(false);
        }
    }

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

    function toggleChosen(id) {
        setChosen((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    /** 행발·누가기록용: 고른 기록(없으면 지금 보이는 기록)을 날짜와 함께 한 덩어리로 복사합니다. 자물쇠 기록은 골랐을 때만 넣습니다. */
    async function copyLog() {
        const base = pickedRows.length ? pickedRows : filtered.filter((row) => !row.localOnly);
        const skipped = pickedRows.length ? 0 : filtered.length - base.length;
        if (!base.length) {
            showToast(skipped ? '자물쇠 기록만 있어요. 넣으려면 기록을 골라 주세요.' : '복사할 기록이 없어요.');
            return;
        }
        const body = studentLogText(student, base, { periodLabel: period === 'all' ? '' : periodLabel, kindLabel: tab, mates: matesOf });
        try {
            await navigator.clipboard.writeText(body);
            showToast(`${student.name} 기록 ${base.length}개를 날짜순으로 복사했어요.${skipped ? ` 자물쇠 기록 ${skipped}개는 뺐어요. 넣으려면 골라 주세요.` : ''}`);
        } catch {
            showToast('복사하지 못했어요. 글을 길게 눌러 선택해 주세요.');
        }
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
            <div style={{ marginTop: 8 }}>
                <RecordExport data={data} sid={student.id} showToast={showToast} />
            </div>
            <div role="group" aria-label="기록 종류" style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {LOG_KINDS.map((item) => (
                    <Btn key={item} className={tab === item ? 'chip on' : 'chip'} aria-pressed={tab === item ? 'true' : 'false'} onClick={() => setTab(item)}>{item}</Btn>
                ))}
            </div>
            <div className="solid-card" style={{ padding: 12, marginTop: 12 }}>
                <input className="field" placeholder={`${givenName(student.name)} 이야기 발라 두기`} aria-label="이 학생 기록" aria-busy={lineSaving} value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    /* 한글 조합 중 Enter(마지막 글자 확정)는 저장하지 않습니다. 빠른 입력·할 일 고치기와 같은 방식이에요. */
                    if (event.nativeEvent?.isComposing || event.keyCode === 229) return;
                    event.preventDefault();
                    saveLine();
                }} />
                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {['관찰', '상담', '칭찬', '보호자'].map((kind) => (
                        <Btn key={kind} className="chip" onClick={() => openQuick(kind, { no: student.no })}>{kind}</Btn>
                    ))}
                </div>
            </div>
            <div role="group" aria-label="기록 기간" data-log-period="1" style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                {LOG_PERIODS.map((item) => (
                    <Btn key={item.id} className={period === item.id ? 'chip on' : 'chip'} aria-pressed={period === item.id ? 'true' : 'false'} onClick={() => setPeriod(item.id)}>{item.label}</Btn>
                ))}
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Btn className="chip" data-log-order={order} onClick={() => setOrder((value) => (value === 'new' ? 'old' : 'new'))}>{order === 'new' ? '최근 것부터' : '오래된 것부터'}</Btn>
                <Btn className="primary-btn fit-btn" data-log-copy="1" onClick={copyLog}>{pickedRows.length ? `고른 ${pickedRows.length}개 복사` : '이 학생 기록 복사'}</Btn>
                {pickedRows.length > 0 && <Btn className="chip" onClick={() => setChosen(new Set())}>고르기 풀기</Btn>}
            </div>
            <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>보이는 기록 {filtered.length}개. 기록을 고르면 고른 것만, 안 고르면 보이는 기록을 날짜순으로 복사해요. 행발 쓸 때 붙여 넣으세요.</p>
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
                                {matesOf(row).length > 0 && <p className="muted" style={{ marginBottom: 0 }} data-role="record-mates">함께: {matesOf(row).join(', ')}</p>}
                                {row.localOnly && <p style={{ marginBottom: 0 }}>🔒 이 내용은 이 기기에만 있어요.</p>}
                                {row.neis && <p style={{ marginBottom: 0 }}>나이스에 옮길 것</p>}
                                <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                                    <Btn
                                        className="chip"
                                        data-edit-for={row.id}
                                        onClick={() => { setEditingId(row.id); setDraft(row.text || ''); }}
                                    >수정</Btn>
                                    <Btn className="chip" onClick={() => removeRecord(row)}>삭제</Btn>
                                    <Btn
                                        className={chosen.has(row.id) ? 'chip on' : 'chip'}
                                        aria-pressed={chosen.has(row.id) ? 'true' : 'false'}
                                        data-pick-for={row.id}
                                        onClick={() => toggleChosen(row.id)}
                                    >{chosen.has(row.id) ? '✓ 복사에 넣음' : '복사에 넣기'}</Btn>
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

export function Neis() {
    const { data, showToast } = useUi();
    /* 지난 명단 학생의 기록도 이름으로 보이게, 아이디로 찾을 때는 지난 명단까지 봅니다. */
    const everyone = data.allStudents || data.students;
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
    const activeStudent = everyone.find((item) => item.id === activeSid);
    const xlsxRef = useRef(null);
    useEffect(() => {
        /* 엑셀 만드는 코드를 화면이 열릴 때 미리 불러 둡니다(첫 화면 묶음에는 넣지 않음). */
        let alive = true;
        import('../lib/neisXlsx.js').then((mod) => { if (alive) xlsxRef.current = mod; }).catch(() => {});
        return () => { alive = false; };
    }, []);

    async function copyAll() {
        const lines = groups.map(([sid, rows]) => {
            const student = everyone.find((item) => item.id === sid);
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

    async function downloadXlsx() {
        if (!groups.length) {
            showToast('내려받을 기록이 없어요.');
            return;
        }
        let file;
        try {
            /* 미리 불러 둔 엑셀 코드가 있으면 기다리지 않아, 누른 손짓이 끊기지 않습니다(아이폰 공유·내려받기). */
            const xlsx = xlsxRef.current || await import('../lib/neisXlsx.js');
            const bytes = xlsx.neisXlsxBytes(xlsx.neisRows(groups, everyone));
            file = new File([bytes], `나이스모아_${seoulYmd()}.xlsx`, { type: xlsx.NEIS_XLSX_TYPE });
        } catch {
            showToast('엑셀 파일을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.');
            return;
        }
        /* 휴대폰(아이폰 홈 화면 앱 등)은 내려받기가 막힐 수 있어 공유 창으로 파일을 넘깁니다. 컴퓨터는 바로 내려받습니다. */
        const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        if (mobile && navigator.canShare?.({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: file.name });
                showToast('엑셀 파일(.xlsx)을 넘겼어요. 「파일에 저장」을 고르면 이 기기에 남아요.');
                return;
            } catch (error) {
                if (error?.name === 'AbortError') return;
                /* 공유가 안 되면 아래에서 내려받기로 이어 갑니다. */
            }
        }
        const url = URL.createObjectURL(file);
        const link = document.createElement('a');
        link.href = url;
        link.download = file.name;
        document.body.appendChild(link);
        link.click();
        link.remove();
        /* 휴대폰은 파일을 늦게 읽기도 해서, 주소는 1분 뒤에 풉니다. */
        setTimeout(() => URL.revokeObjectURL(url), 60000);
        showToast('엑셀 파일(.xlsx)을 이 기기에만 내려받았어요.');
    }

    function printTable() {
        if (!groups.length) {
            showToast('출력할 기록이 없어요.');
            return;
        }
        const rowsHtml = groups.map(([sid, rows]) => {
            const student = everyone.find((item) => item.id === sid);
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
            <p>나이스에 옮기려고 표시해 둔 기록만 모았어요. 복사한 뒤, 옮겼으면 표시해 주세요. 「내려받기」를 누르면 엑셀 파일(.xlsx)로 이 기기에만 받아요.</p>
            <div className="neis-tools" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <Btn className="primary-btn fit-btn" onClick={copyAll}>전체 복사</Btn>
                <Btn className="chip" onClick={downloadXlsx}>내려받기</Btn>
                <Btn className="chip" onClick={printTable}>출력</Btn>
            </div>
            {!groups.length && <p className="muted">옮길 기록이 없어요. 관찰을 남길 때 ‘나이스에 옮길 것’이 켜져 있어요.</p>}
            {groups.length > 0 && (
                <div className="neis-split" data-neis-split="1" style={{ marginTop: 12 }}>
                    <nav className="neis-list" aria-label="나이스 학생 목록">
                        {groups.map(([sid, rows]) => {
                            const student = everyone.find((item) => item.id === sid);
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
