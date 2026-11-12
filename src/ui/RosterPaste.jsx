import { useState } from 'react';
import { replaceRoster } from '../lib/db.js';
import { CLOUD_MAX_NO, MAX_STUDENTS, planRoster, readRosterText, suggestKeep } from '../lib/roster.js';
import { Btn } from './bits.jsx';

const KIND_LABEL = {
    same: '그대로',
    renamed: '이름만 고침',
    new: '새로',
    changed: '새 학생',
    back: '지난 명단에서 다시',
};

function allOf(data) {
    return data.allStudents || data.students || [];
}

/** 미리보기에 쓸 계획: 겹친 번호는 빼고 맞춰 봅니다(겹치면 넣기를 막습니다). */
export function previewPlan(data, read) {
    const rows = read.rows.filter((row) => !row.dup);
    const plan = planRoster(allOf(data), rows, { makeId: (no, n) => `preview-${no}-${n}` });
    return { rows, plan, keep: suggestKeep(plan.changes) };
}

/** 넣기 전에 바로 저장해도 되는지: 이름이 바뀌거나 빠지는 학생, 읽기 문제가 없을 때만. */
export function quietSave(data, read) {
    if (read.blocking || read.problems.length) return false;
    const { plan } = previewPlan(data, read);
    return plan.changes.every((c) => c.kind === 'same' || c.kind === 'new' || c.kind === 'back');
}

/**
 * '이렇게 넣을게요' 미리보기와 확인. read 는 readRosterText 결과입니다.
 * 같은 번호에 다른 이름이 오면 새 학생으로 넣고, '이름만 고친 같은 학생'을 고르면 기록을 이어 갑니다.
 */
export function RosterPreview({ data, read, onCancel, onSaved, showToast }) {
    const { rows, plan, keep: suggested } = previewPlan(data, read);
    const [keep, setKeep] = useState(() => new Set(suggested));
    const [saving, setSaving] = useState(false);
    const changes = plan.changes.filter((c) => c.kind !== 'gone');
    const gone = plan.changes.filter((c) => c.kind === 'gone');
    const changed = changes.filter((c) => c.kind === 'changed');
    const dupRows = read.rows.filter((row) => row.dup);
    const overCloud = rows.some((row) => row.no > CLOUD_MAX_NO);
    const nos = rows.map((row) => row.no);

    async function save() {
        if (saving || read.blocking) return;
        if (gone.length && !window.confirm(`${gone.length}명은 지금 명단에서 빠지고 지난 명단으로 옮겨요. 기록·출결은 지우지 않아요. 이대로 넣을까요?`)) return;
        setSaving(true);
        try {
            const result = await replaceRoster(rows.map(({ no, name, sex }) => ({ no, name, sex })), { keep: [...keep] });
            if (result?.storageFailed) return;
            showToast(`명단에 ${rows.length}명을 넣었어요.`);
            onSaved?.();
        } finally {
            setSaving(false);
        }
    }

    return (
        <div className="solid-card roster-preview" data-roster-preview="1" style={{ padding: 12, marginTop: 8 }}>
            <h3 style={{ margin: '0 0 4px' }}>이렇게 넣을게요</h3>
            <p className="muted" style={{ margin: '0 0 8px' }}>
                {rows.length ? `${rows.length}명 · ${Math.min(...nos)}번~${Math.max(...nos)}번` : '넣을 학생이 없어요.'}
                {rows.length > 0 && ` · 한 반은 ${MAX_STUDENTS}명까지`}
            </p>
            {read.problems.length > 0 && (
                <ul className="roster-problems" style={{ margin: '0 0 8px', paddingLeft: 18 }}>
                    {read.problems.map((p, i) => (
                        <li key={`${p.kind}-${i}`} data-problem={p.kind} style={{ color: p.kind === 'dup' || p.kind === 'many' ? 'var(--st-absent)' : 'inherit' }}>{p.text}</li>
                    ))}
                </ul>
            )}
            {changed.length > 0 && <p style={{ margin: '0 0 8px' }}>같은 번호라도 이름이 다르면 새 학생으로 넣어요. 그 번호의 예전 기록·출결·메모는 이어지지 않고, 예전 학생 이름으로 남아요. 이름만 고친 거라면 그 줄에서 ‘같은 학생’을 눌러 주세요.</p>}
            <div role="table" aria-label="넣을 명단" style={{ display: 'grid', gap: 4, maxHeight: 360, overflowY: 'auto' }}>
                {dupRows.map((row) => (
                    <div key={`dup-${row.line}`} role="row" className="roster-preview-row is-dup" style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--st-absent)' }}>
                        <strong className="num" style={{ minWidth: 32 }}>{row.no}</strong>
                        <span style={{ flex: 1, minWidth: 0 }}>{row.name}</span>
                        <span>번호 겹침</span>
                    </div>
                ))}
                {changes.map((c) => {
                    const row = rows.find((item) => item.no === c.no);
                    const kept = keep.has(c.no);
                    return (
                        <div key={`row-${c.no}`} role="row" className="roster-preview-row" data-kind={c.kind} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', minHeight: 32 }}>
                            <strong className="num" style={{ minWidth: 32 }}>{c.no}</strong>
                            <span style={{ flex: '1 1 120px', minWidth: 0, overflowWrap: 'anywhere' }}>{c.name}{row?.sex ? ` · ${row.sex}` : ''}</span>
                            <span className="muted">{c.kind === 'changed' ? (kept ? `이름만 고침(예전 ${c.before})` : `새 학생 · 예전 ${c.before}`) : KIND_LABEL[c.kind]}</span>
                            {c.kind === 'changed' && (
                                <Btn className={kept ? 'chip on' : 'chip'} aria-pressed={kept} aria-label={`${c.no}번 ${c.name}은 ${c.before}와 같은 학생`} onClick={() => setKeep((prev) => { const next = new Set(prev); if (next.has(c.no)) next.delete(c.no); else next.add(c.no); return next; })}>같은 학생</Btn>
                            )}
                        </div>
                    );
                })}
            </div>
            {gone.length > 0 && <p style={{ margin: '8px 0 0' }}>명단에서 빠지는 학생 {gone.length}명: {gone.slice(0, 8).map((c) => `${c.no} ${c.name}`).join(', ')}{gone.length > 8 ? ' …' : ''}. 지우지 않고 지난 명단으로 옮겨요. 기록·출결은 그대로 남아요.</p>}
            {overCloud && <p className="muted" style={{ margin: '8px 0 0' }}>{CLOUD_MAX_NO + 1}번 이상 학생은 지금은 이 기기에만 저장돼요. 클라우드는 {CLOUD_MAX_NO}번까지 올라가요.</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                <Btn className="primary-btn" data-roster-save="1" disabled={read.blocking || saving} onClick={save}>{saving ? '넣는 중…' : '이대로 넣기'}</Btn>
                <Btn className="chip" onClick={onCancel}>다시 고치기</Btn>
            </div>
            {read.blocking && rows.length > 0 && <p style={{ margin: '8px 0 0' }}>겹친 번호나 인원을 고친 뒤에 넣을 수 있어요.</p>}
        </div>
    );
}

/** 명렬 붙여넣기: 엑셀·한글 표·나이스 화면에서 복사한 명단을 그대로 붙입니다. */
export function RosterPaste({ data, showToast, onSaved, autoFocus = false }) {
    const [text, setText] = useState('');
    const [read, setRead] = useState(null);
    return (
        <div className="roster-paste" data-roster-paste="1">
            <textarea
                className="field"
                rows={6}
                autoFocus={autoFocus}
                aria-label="명렬 붙여넣기"
                placeholder={'엑셀·한글 표·나이스 화면에서 번호와 이름 칸을 복사해 붙여 넣으세요.\n1 김가나\n2. 이다라\n51 박마바 여'}
                value={text}
                onChange={(event) => { setText(event.target.value); setRead(null); }}
            />
            <Btn className="chip block" style={{ marginTop: 8 }} data-roster-preview-btn="1" onClick={() => {
                if (!text.trim()) {
                    showToast('붙여 넣은 명단이 없어요.');
                    return;
                }
                setRead(readRosterText(text));
            }}>미리 보기</Btn>
            {read && (
                <RosterPreview
                    data={data}
                    read={read}
                    showToast={showToast}
                    onCancel={() => setRead(null)}
                    onSaved={() => { setText(''); setRead(null); onSaved?.(); }}
                />
            )}
        </div>
    );
}
