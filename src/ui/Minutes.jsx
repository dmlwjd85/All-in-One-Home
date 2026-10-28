import { useEffect, useMemo, useRef, useState } from 'react';
import { joined, removeItem, saveTextItem } from '../lib/db.js';
import { MEET_KINDS } from '../lib/msgParse.js';
import {
    MINUTES_ATTENDEES_MAX, MINUTES_TAG, MINUTES_TEXT_MAX, MINUTES_TITLE_MAX,
    minutesList, minutesProblem, minutesRow, minutesSensitive, minutesTitle,
    readMinutesDraft, writeMinutesDraft,
} from '../lib/minutes.js';
import { useUi } from './context.jsx';
import { Area, Btn, Field } from './bits.jsx';
import { DateGrid } from './pickers.jsx';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function dateLabel(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '날짜 없음';
    const [y, m, d] = ymd.split('-').map(Number);
    const day = new Date(y, m - 1, d).getDay();
    return `${y}년 ${m}월 ${d}일 (${WEEK[day]})`;
}

function firstLine(text) {
    return String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
}

/** 회의록 화면. 목록 · 보기 · 새로 쓰기 · 고치기. 본문 Enter는 줄바꿈만 하고, 저장은 저장 버튼으로만 합니다. */
export function Minutes() {
    const { data, route } = useUi();
    const mode = route.params?.mode || 'list';
    const id = route.params?.id || '';
    const all = minutesList(joined(data, 'notes'));
    const row = id ? all.find((item) => item.id === id) : null;
    if (mode === 'new') return <MinutesEditor key="new" row={null} />;
    if ((mode === 'edit' || mode === 'view') && !row) return <MinutesMissing />;
    if (mode === 'edit') return <MinutesEditor key={`edit-${row.id}`} row={row} />;
    if (mode === 'view') return <MinutesView key={row.id} row={row} />;
    return <MinutesListView rows={all} />;
}

function MinutesMissing() {
    const { go } = useUi();
    return (
        <div className="minutes" data-screen="minutes-missing">
            <p className="muted">그 회의록을 찾지 못했어요. 지워졌거나 다른 기기에만 있을 수 있어요.</p>
            <Btn className="primary-btn" onClick={() => go('#/minutes')}>회의록 목록으로</Btn>
        </div>
    );
}

function MinutesListView({ rows }) {
    const { go } = useUi();
    const draft = readMinutesDraft('new');
    return (
        <div className="minutes" data-screen="minutes-list">
            <div className="minutes-actions">
                <Btn className="primary-btn minutes-new" onClick={() => go('#/minutes/new')}>＋ 새 회의록</Btn>
            </div>
            {draft && (draft.title || draft.text) ? (
                <p className="minutes-draft-note">
                    <span>쓰다 만 회의록이 있어요{draft.title ? ` · ${draft.title}` : ''}.</span>
                    <Btn className="chip" onClick={() => go('#/minutes/new')}>이어 쓰기</Btn>
                </p>
            ) : null}
            {rows.length ? (
                <ul className="minutes-list" aria-label="회의록 목록">
                    {rows.map((item) => (
                        <li key={item.id} className="minutes-row">
                            <Btn className="minutes-item solid-card" data-id={item.id} onClick={() => go(`#/minutes/${item.id}`)}>
                                <span className="minutes-item-title">{item.localOnly ? '🔒 ' : ''}{minutesTitle(item)}</span>
                                <span className="minutes-item-meta">{dateLabel(item.date)}{item.attendees ? ` · ${item.attendees}` : ''}</span>
                                {firstLine(item.text) ? <span className="minutes-item-line">{firstLine(item.text)}</span> : null}
                            </Btn>
                            {readMinutesDraft(item.id) ? (
                                <p className="minutes-draft-note" data-draft-for={item.id}>
                                    <span>고치던 내용이 남아 있어요.</span>
                                    <Btn className="chip" onClick={() => go(`#/minutes/${item.id}/edit`)}>이어 쓰기</Btn>
                                </p>
                            ) : null}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="muted minutes-empty">아직 회의록이 없어요. 회의가 끝나면 ‘새 회의록’으로 여러 줄을 편하게 적어 두세요.</p>
            )}
        </div>
    );
}

function MinutesView({ row }) {
    const { go, showToast } = useUi();
    const [asking, setAsking] = useState(false);
    const kinds = (row.tags || []).filter((tag) => tag && tag !== MINUTES_TAG);
    async function drop() {
        const failed = await removeItem('notes', row.id);
        if (failed?.storageFailed) return;
        writeMinutesDraft(row.id, null);
        showToast('회의록을 지웠어요.', true);
        go('#/minutes');
    }
    return (
        <article className="minutes minutes-view" data-screen="minutes-view">
            <Btn className="chip minutes-back" onClick={() => go('#/minutes')}>‹ 회의록 목록</Btn>
            <h2 className="title-font minutes-view-title">{row.localOnly ? '🔒 ' : ''}{minutesTitle(row)}</h2>
            <p className="minutes-view-meta">{dateLabel(row.date)}</p>
            {row.attendees ? <p className="minutes-view-meta">참석: {row.attendees}</p> : null}
            {kinds.length ? <p className="minutes-view-meta">{kinds.join(' · ')}</p> : null}
            {row.localOnly ? <p className="muted">민감할 수 있는 낱말이 있어 이 기기에만 남겨 두었어요.</p> : null}
            <div className="minutes-body solid-card" data-role="minutes-body">{row.text}</div>
            {asking ? (
                <div className="minutes-confirm" role="alertdialog" aria-label="회의록 지우기 확인">
                    <p>이 회의록을 지울까요?</p>
                    <div className="minutes-actions">
                        <Btn className="primary-btn minutes-danger" onClick={drop}>지우기</Btn>
                        <Btn className="chip" onClick={() => setAsking(false)}>그만두기</Btn>
                    </div>
                </div>
            ) : (
                <div className="minutes-actions">
                    <Btn className="primary-btn" onClick={() => go(`#/minutes/${row.id}/edit`)}>고치기</Btn>
                    <Btn className="chip" onClick={() => setAsking(true)}>지우기</Btn>
                </div>
            )}
        </article>
    );
}

function MinutesEditor({ row }) {
    const { clock, go, showToast } = useUi();
    const key = row ? row.id : 'new';
    const initial = useMemo(() => {
        const base = {
            title: row?.title || '',
            date: row?.date || clock.ymd,
            attendees: row?.attendees || '',
            text: row?.text || '',
            tags: (row?.tags || []).filter((tag) => tag && tag !== MINUTES_TAG),
        };
        const draft = readMinutesDraft(key);
        return { base, draft: draft ? { ...base, ...draft, tags: Array.isArray(draft.tags) ? draft.tags : base.tags } : null };
    }, [key]); // eslint-disable-line react-hooks/exhaustive-deps
    const start = initial.draft || initial.base;
    const [title, setTitle] = useState(start.title);
    const [date, setDate] = useState(start.date);
    const [attendees, setAttendees] = useState(start.attendees);
    const [text, setText] = useState(start.text);
    const [tags, setTags] = useState(start.tags);
    const [keptAt, setKeptAt] = useState(initial.draft ? '불러옴' : '');
    const saving = useRef(false);
    const kind = tags.find((tag) => MEET_KINDS.includes(tag)) || '';

    useEffect(() => {
        if (initial.draft) showToast('쓰던 회의록을 불러왔어요.');
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    /* 임시 저장: 글자가 바뀌면 잠깐 뒤 이 기기에 둡니다. 저장 버튼을 누르기 전까지는 회의록이 아닙니다.
       화면을 떠나거나 앱을 닫을 때도 바로 한 번 더 둡니다. */
    const current = useRef(null);
    current.current = { title, date, attendees, text, tags };
    function keepNow() {
        if (saving.current) return false;
        const b = initial.base;
        const c = current.current;
        const same = c.title === b.title && c.date === b.date && c.attendees === b.attendees && c.text === b.text && c.tags.join('|') === b.tags.join('|');
        writeMinutesDraft(key, same ? null : c);
        return !same;
    }
    useEffect(() => {
        const flush = () => { keepNow(); };
        window.addEventListener('pagehide', flush);
        return () => {
            window.removeEventListener('pagehide', flush);
            flush();
        };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    useEffect(() => {
        const timer = setTimeout(() => {
            if (!keepNow()) return;
            const now = new Date();
            setKeptAt(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
        }, 300);
        return () => clearTimeout(timer);
    }, [title, date, attendees, text, tags]); // eslint-disable-line react-hooks/exhaustive-deps

    function pickKind(next) {
        const others = tags.filter((tag) => !MEET_KINDS.includes(tag));
        const on = kind === next;
        setTags(on ? others : [next, ...others]);
        if (!on && !title.trim()) setTitle(next);
    }

    async function save() {
        if (saving.current) return;
        const draft = { title, date, attendees, text, tags };
        const problem = minutesProblem(draft);
        if (problem) {
            showToast(problem);
            return;
        }
        saving.current = true;
        const next = minutesRow({ id: row?.id, ...draft });
        const result = await saveTextItem('notes', next, { from: row ? (row.localOnly ? 'local' : 'cloud') : undefined });
        if (result?.storageFailed) {
            saving.current = false;
            return;
        }
        writeMinutesDraft(key, null);
        showToast(result?.sensitive || minutesSensitive(draft) ? '민감할 수 있는 낱말이 있어 이 기기에만 남겼어요.' : '회의록을 저장했어요.', true);
        go(`#/minutes/${next.id}`, { replace: true });
    }

    function cancel() {
        go(row ? `#/minutes/${row.id}` : '#/minutes');
    }

    function discard() {
        writeMinutesDraft(key, null);
        saving.current = true;
        showToast('쓰던 내용을 지웠어요.');
        cancel();
    }

    return (
        <div className="minutes minutes-editor" data-screen="minutes-editor">
            <Btn className="chip minutes-back" onClick={cancel}>‹ {row ? '회의록 보기' : '회의록 목록'}</Btn>
            <h2 className="title-font minutes-view-title">{row ? '회의록 고치기' : '새 회의록'}</h2>
            <label className="minutes-label" htmlFor="minutes-title">회의 제목</label>
            <Field id="minutes-title" value={title} maxLength={MINUTES_TITLE_MAX} placeholder="예: 10월 학년 협의회" onChange={(event) => setTitle(event.target.value)} />
            <div className="minutes-label" id="minutes-kind-label">회의 종류 <span className="muted">(골라도 되고 안 골라도 돼요)</span></div>
            <div className="minutes-kinds" role="group" aria-labelledby="minutes-kind-label">
                {MEET_KINDS.map((item) => (
                    <Btn key={item} className={kind === item ? 'chip on' : 'chip'} aria-pressed={kind === item ? 'true' : 'false'} onClick={() => pickKind(item)}>{item}</Btn>
                ))}
            </div>
            <div className="minutes-label">날짜 <strong className="minutes-date-picked" data-role="minutes-date">{dateLabel(date)}</strong></div>
            <div className="minutes-date solid-card">
                <DateGrid value={date} today={clock.ymd} onPick={setDate} />
            </div>
            <label className="minutes-label" htmlFor="minutes-attendees">참석자 <span className="muted">(선택)</span></label>
            <Field id="minutes-attendees" value={attendees} maxLength={MINUTES_ATTENDEES_MAX} placeholder="예: 1학년 담임 선생님들" onChange={(event) => setAttendees(event.target.value)} />
            <label className="minutes-label" htmlFor="minutes-text">본문 <span className="muted">(Enter는 줄바꿈이에요)</span></label>
            <Area id="minutes-text" className="field minutes-text" rows={12} value={text} maxLength={MINUTES_TEXT_MAX} enterKeyHint="enter" placeholder={'안건\n- \n결정한 것\n- \n할 일\n- '} onChange={(event) => setText(event.target.value)} />
            <p className="minutes-kept muted" aria-live="polite" data-role="minutes-kept">
                {keptAt === '불러옴' ? '쓰던 내용을 불러왔어요. 저장을 눌러야 회의록이 돼요.' : keptAt ? `${keptAt} 이 기기에 임시 저장했어요. 저장을 눌러야 회의록이 돼요.` : '쓰는 동안 이 기기에 임시로 저장해 둬요.'}
                {' '}<span>{text.length.toLocaleString()} / {MINUTES_TEXT_MAX.toLocaleString()}자</span>
            </p>
            <div className="minutes-actions minutes-save-row">
                <Btn className="primary-btn minutes-save" onClick={save}>저장</Btn>
                <Btn className="chip" onClick={cancel}>나중에 쓰기</Btn>
                {keptAt ? <Btn className="chip" onClick={discard}>쓰던 내용 버리기</Btn> : null}
            </div>
        </div>
    );
}
