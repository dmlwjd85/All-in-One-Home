import { useEffect, useMemo, useRef, useState } from 'react';
import { finishMinutesAsk, joined, registerMinutes, removeItem, saveTextItem } from '../lib/db.js';
import { allStarts } from '../lib/periodLocal.js';
import { forgetMinutesLinks, setMinutesPending } from '../lib/minutesExtract.js';
import { MEET_KINDS } from '../lib/msgParse.js';
import {
    MINUTES_ATTENDEES_MAX, MINUTES_TAG, MINUTES_TEXT_MAX, MINUTES_TITLE_MAX,
    minutesList, minutesProblem, minutesRow, minutesSensitive, minutesTitle,
    readMinutesDraft, writeMinutesDraft,
} from '../lib/minutes.js';
import { useUi } from './context.jsx';
import { Area, Btn, Field } from './bits.jsx';
import { DateGrid } from './pickers.jsx';
import { CaptureCard } from './PlusSheet.jsx';

const WIDE = '(min-width: 900px)';

/** 넓은 화면(웹)인지. 900px 이상이면 작성 칸과 목록을 나란히 둡니다. */
export function useWide() {
    const query = () => Boolean(globalThis.matchMedia?.(WIDE)?.matches);
    const [wide, setWide] = useState(query);
    useEffect(() => {
        const list = globalThis.matchMedia?.(WIDE);
        if (!list) return undefined;
        const on = () => setWide(list.matches);
        list.addEventListener?.('change', on);
        return () => list.removeEventListener?.('change', on);
    }, []);
    return wide;
}

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];

function dateLabel(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '날짜 없음';
    const [y, m, d] = ymd.split('-').map(Number);
    const day = new Date(y, m - 1, d).getDay();
    return `${y}년 ${m}월 ${d}일 (${WEEK[day]})`;
}

function shortDate(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '날짜 없음';
    const [y, m, d] = ymd.split('-').map(Number);
    return `${m}/${d}(${WEEK[new Date(y, m - 1, d).getDay()]})`;
}

function firstLine(text) {
    return String(text || '').split('\n').map((line) => line.trim()).find(Boolean) || '';
}

/** 회의록 화면. 목록 · 보기 · 새로 쓰기 · 고치기. 본문 Enter는 줄바꿈만 하고, 저장은 저장 버튼으로만 합니다. */
export function Minutes() {
    const { data, route } = useUi();
    const wide = useWide();
    const mode = route.params?.mode || 'list';
    const id = route.params?.id || '';
    const all = minutesList(joined(data, 'notes'));
    const row = id ? all.find((item) => item.id === id) : null;
    let main;
    if (mode === 'new' || (wide && mode === 'list')) main = <MinutesEditor key="new" row={null} wide={wide} />;
    else if ((mode === 'edit' || mode === 'view') && !row) main = <MinutesMissing />;
    else if (mode === 'edit') main = <MinutesEditor key={`edit-${row.id}`} row={row} wide={wide} />;
    else if (mode === 'view') main = <MinutesView key={row.id} row={row} />;
    else return <MinutesListView rows={all} />;
    if (!wide) return main;
    /* 넓은 화면: 왼쪽은 쓰기·보기, 오른쪽은 목록. 스크롤 없이 한눈에 봅니다. */
    return (
        <div className="minutes-split" data-screen="minutes-split">
            <div className="minutes-main">{main}</div>
            <aside className="minutes-side" aria-label="회의록 목록 칸">
                <MinutesListView rows={all} compact activeId={id} />
            </aside>
        </div>
    );
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

function MinutesListView({ rows, compact = false, activeId = '' }) {
    const { go } = useUi();
    const draft = readMinutesDraft('new');
    return (
        <div className={compact ? 'minutes minutes-compact' : 'minutes'} data-screen={compact ? 'minutes-side-list' : 'minutes-list'}>
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
                            <Btn className={item.id === activeId ? 'minutes-item solid-card on' : 'minutes-item solid-card'} aria-current={item.id === activeId ? 'true' : undefined} data-id={item.id} onClick={() => go(`#/minutes/${item.id}`)}>
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
        forgetMinutesLinks(row.id);
        setMinutesPending(row.id, null);
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

function MinutesEditor({ row, wide = false }) {
    const { clock, data, go, showToast } = useUi();
    const [picking, setPicking] = useState(false);
    const [asking, setAsking] = useState(null);
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
        if (!picking) return undefined;
        const onKey = (event) => { if (event.key === 'Escape') setPicking(false); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [picking]);
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
        const saidSensitive = result?.sensitive || minutesSensitive(draft);
        /* 본문에서 일정·할 일을 찾아 등록합니다. 분명한 줄은 바로, 흐린 줄은 노란 카드로 한 번 묻습니다.
           다른 기기에서 지운·정한 항목은 되살리지 않고, 오프라인이면 등록을 미뤘다가 연결되면 확인 뒤 등록합니다(registerMinutes). */
        const found = await registerMinutes({
            id: next.id, title: next.title, date: next.date, text: next.text,
            prev: row ? { text: row.text || '', date: row.date || '' } : null,
            periods: allStarts(data.profile?.periodStarts),
        });
        if (found?.storageFailed) {
            saving.current = false;
            return;
        }
        let note = saidSensitive ? '민감할 수 있는 낱말이 있어 이 기기에만 남겼어요.' : '회의록을 저장했어요.';
        if (found.count) note = `${note} 일정·할 일 ${found.count}개를 바로 등록했어요.`;
        if (found.deferred) note = `${note} 연결이 안 돼 일정·할 일 ${found.deferred}개는 연결되면 확인하고 등록할게요.`;
        if (found.tidied) note = `${note} 고친 줄의 옛 항목 ${found.tidied}개를 정리했어요.`;
        if (found.ask.length) {
            showToast(note, true);
            setAsking({ id: next.id, items: found.ask });
            return;
        }
        showToast(note, true);
        go(`#/minutes/${next.id}`, { replace: true });
    }

    function patchAsk(id, partial, keepLow = false) {
        setAsking((prev) => prev && ({
            ...prev,
            items: prev.items.map((item) => {
                if (item.id !== id) return item;
                const changed = { ...item, ...partial };
                if (!keepLow) { changed.low = false; changed.warning = ''; }
                return changed;
            }),
        }));
    }

    async function finishAsk(registerAll) {
        if (!asking) return;
        const chosen = registerAll ? asking.items.filter((item) => item.include !== false && ['일정', '할 일'].includes(item.kind)) : [];
        /* 고른 카드는 등록하고, 뺀 카드는 기억하고 다른 기기에도 알립니다(오프라인이면 대기열에 두었다가 다시 씀). */
        const put = await finishMinutesAsk(asking.id, asking.items, chosen);
        if (put?.storageFailed) return;
        if (chosen.length) showToast(put?.ok ? put.message : (put?.message || '등록하지 못했어요.'), Boolean(put?.ok));
        else showToast('확인 카드는 등록하지 않았어요.');
        go(`#/minutes/${asking.id}`, { replace: true });
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

    if (asking) {
        return (
            <div className="minutes minutes-editor minutes-ask" data-screen="minutes-ask">
                <h2 className="title-font minutes-view-title">이것도 등록할까요?</h2>
                <p className="muted" style={{ margin: 0 }}>회의록은 저장했어요. 노란 카드는 한 번만 확인해 주세요. 칩을 누르면 바로 바뀌고, 아니면 ‘빼기’를 누르세요.</p>
                <div className="minutes-ask-list">
                    {asking.items.map((item) => (
                        <CaptureCard key={item.id} item={item} students={data.students || []} today={clock.ymd} onPatch={patchAsk} />
                    ))}
                </div>
                <div className="minutes-actions minutes-save-row">
                    <Btn className="primary-btn minutes-ask-ok" onClick={() => finishAsk(true)}>{(() => { const n = asking.items.filter((item) => item.include !== false).length; return n ? `${n}개 등록` : '등록 없이 마치기'; })()}</Btn>
                    <Btn className="chip" onClick={() => finishAsk(false)}>모두 빼고 마치기</Btn>
                </div>
            </div>
        );
    }

    const kept = (
        <p className="minutes-kept muted" aria-live="polite" data-role="minutes-kept">
            {keptAt === '불러옴' ? '쓰던 내용을 불러왔어요. 저장을 눌러야 회의록이 돼요.' : keptAt ? `${keptAt} 이 기기에 임시 저장했어요. 저장을 눌러야 회의록이 돼요.` : '쓰는 동안 이 기기에 임시로 저장해 둬요.'}
            {' '}<span>{text.length.toLocaleString()} / {MINUTES_TEXT_MAX.toLocaleString()}자</span>
        </p>
    );
    const actions = (
        <div className="minutes-actions minutes-save-row">
            <Btn className="primary-btn minutes-save" onClick={save}>저장</Btn>
            <Btn className="chip" onClick={cancel}>나중에 쓰기</Btn>
            {keptAt ? <Btn className="chip" onClick={discard}>쓰던 내용 버리기</Btn> : null}
        </div>
    );
    return (
        <div className={wide ? 'minutes minutes-editor is-wide' : 'minutes minutes-editor'} data-screen="minutes-editor">
            <div className="minutes-head">
                {row || !wide ? <Btn className="chip minutes-back" onClick={cancel}>‹ {row ? '회의록 보기' : '회의록 목록'}</Btn> : null}
                <h2 className="title-font minutes-view-title">{row ? '회의록 고치기' : '새 회의록'}</h2>
            </div>
            <div className="minutes-top">
                <div className="minutes-cell minutes-cell-title">
                    <label className="minutes-label" htmlFor="minutes-title">회의 제목</label>
                    <Field id="minutes-title" value={title} maxLength={MINUTES_TITLE_MAX} placeholder="예: 10월 학년 협의회" onChange={(event) => setTitle(event.target.value)} />
                </div>
                <div className="minutes-cell minutes-cell-date">
                    <span className="minutes-label" id="minutes-date-label">날짜</span>
                    <Btn className="chip minutes-date-btn" aria-labelledby="minutes-date-label" aria-haspopup="dialog" aria-expanded={picking} data-role="minutes-date-btn" onClick={() => setPicking(true)}>
                        <span aria-hidden="true">📅</span> <strong className="minutes-date-picked" data-role="minutes-date" aria-label={dateLabel(date)}>{wide ? dateLabel(date) : shortDate(date)}</strong>
                    </Btn>
                </div>
            </div>
            <label className="minutes-label" htmlFor="minutes-text">본문 <span className="muted">(Enter는 줄바꿈{wide ? ' · 날짜가 있는 할 일·일정은 저장할 때 바로 등록돼요' : ''})</span></label>
            <Area id="minutes-text" className="field minutes-text" rows={wide ? 14 : 10} value={text} maxLength={MINUTES_TEXT_MAX} enterKeyHint="enter" placeholder={'안건\n- \n결정한 것\n- \n할 일\n- 11/12까지 보고서 제출'} onChange={(event) => setText(event.target.value)} />
            {kept}
            {actions}
            <div className="minutes-extra">
                <div className="minutes-cell">
                    <label className="minutes-label" htmlFor="minutes-attendees">참석자 <span className="muted">(선택)</span></label>
                    <Field id="minutes-attendees" value={attendees} maxLength={MINUTES_ATTENDEES_MAX} placeholder="예: 1학년 담임 선생님들" onChange={(event) => setAttendees(event.target.value)} />
                </div>
                <div className="minutes-cell">
                    <div className="minutes-label" id="minutes-kind-label">회의 종류 <span className="muted">(선택)</span></div>
                    <div className="minutes-kinds" role="group" aria-labelledby="minutes-kind-label">
                        {MEET_KINDS.map((item) => (
                            <Btn key={item} className={kind === item ? 'chip on' : 'chip'} aria-pressed={kind === item ? 'true' : 'false'} onClick={() => pickKind(item)}>{item}</Btn>
                        ))}
                    </div>
                </div>
            </div>
            {picking ? (
                <div className="sheet-back minutes-cal-back" onClick={() => setPicking(false)}>
                    <div className="sheet minutes-cal" role="dialog" aria-modal="true" aria-label="회의 날짜 고르기" data-screen="minutes-cal" onClick={(event) => event.stopPropagation()}>
                        <h3 className="title-font" style={{ margin: '4px 0 8px' }}>회의 날짜</h3>
                        <DateGrid value={date} today={clock.ymd} onPick={(ymd) => { setDate(ymd); setPicking(false); }} />
                        <div className="minutes-actions" style={{ marginTop: 8 }}>
                            <Btn className="chip" onClick={() => { setDate(clock.ymd); setPicking(false); }}>오늘로</Btn>
                            <Btn className="chip" onClick={() => setPicking(false)}>닫기</Btn>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
