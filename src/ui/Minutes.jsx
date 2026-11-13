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
import { timeContext } from './timeContext.js';
import { Area, Btn, Field } from './bits.jsx';
import { DateGrid } from './pickers.jsx';
import { addDaysYmd, startOfWeekMon } from '../lib/date.js';

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

/* ── 회의록 저장 뒤 확인 카드(시안 A, 2026-11-14) ──
   카드마다 왜 묻는지 한 줄, 그 자리에서 고칠 것(날짜·오전/오후·종류)만 칩으로, 그리고 '등록 / 빼기' 두 단추.
   펼치는 편집기·학생 번호판은 두지 않습니다. 회의록 카드는 임시보관함에 가지 않고, 빼면 그냥 빠집니다. */
const ASK_KINDS = ['일정', '할 일'];

/** 왜 묻는지: 배지 글자와 한 줄 설명. 메시지 붙여넣기용 문구(임시보관함 등)는 쓰지 않습니다. */
export function askReason(item) {
    const warn = String(item?.warning || '');
    const quoted = /「([^」]+)」/.exec(warn)?.[1] || '';
    if (/읽었어요/.test(warn)) return { id: 'ampm', badge: '🕒 오전·오후 확인', text: `「${quoted}」을 ${ampmLabel(item.time)}으로 읽었어요. 맞는 쪽을 골라 주세요.` };
    if (/시각으로 넣지 않았어요/.test(warn)) return { id: 'colon', badge: '🔢 시각이 아닐 수 있어요', text: `「${quoted}」은 시각으로 넣지 않았어요. 제목 그대로 둘지 정해 주세요.` };
    if (/짧은 줄/.test(warn)) return { id: 'short', badge: '✏️ 할 일이 맞나요?', text: '날짜 없는 짧은 줄이에요. 할 일로 둘지 정해 주세요.' };
    if (!item?.date) return { id: 'date', badge: '📅 날짜가 없어요', text: item?.kind === '일정' ? '일정은 날짜를 고르면 등록할 수 있어요.' : '날짜 없이도 할 일로 넣을 수 있어요.' };
    return { id: 'other', badge: '확인해 주세요', text: '맞으면 등록, 아니면 빼 주세요.' };
}

function shortDate(ymd) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd || '')) return '날짜 없음';
    const [y, m, d] = ymd.split('-').map(Number);
    return `${m}/${d}(${WEEK[new Date(y, m - 1, d).getDay()]})`;
}

function ampmLabel(hm) {
    const [h, m] = String(hm || '').split(':').map(Number);
    if (!Number.isFinite(h)) return '';
    return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(m || 0).padStart(2, '0')}`;
}

function flipHalf(hm, pm) {
    const [h, m] = String(hm || '').split(':').map(Number);
    if (!Number.isFinite(h)) return hm;
    const hour = pm ? (h < 12 ? h + 12 : h) : (h >= 12 ? h - 12 : h);
    return `${String(hour).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}`;
}

/** 등록할 수 있는지: 일정은 날짜가 있어야 합니다. */
export function askReady(item) {
    return ASK_KINDS.includes(item?.kind) && (item.kind !== '일정' || Boolean(item.date));
}

export function MinutesAskCard({ item, today, onPatch }) {
    const [cal, setCal] = useState(false);
    const reason = askReason(item);
    const on = item.include !== false && askReady(item);
    const off = item.include === false && item.decided;
    const tomorrow = addDaysYmd(today, 1);
    const nextMon = addDaysYmd(startOfWeekMon(today), 7);
    const dates = [['오늘', today], ['내일', tomorrow], [`다음 주 월 ${Number(nextMon.slice(5, 7))}/${Number(nextMon.slice(8))}`, nextMon]];
    const pickDate = (ymd) => { onPatch(item.id, { date: ymd, include: true, decided: true }); setCal(false); };
    const cls = ['msg-card', 'ask-card', item.low && !item.decided ? 'low-card' : '', on && item.decided ? 'is-on' : '', off ? 'is-off' : ''].filter(Boolean).join(' ');
    const pm = Number(String(item.time || '').slice(0, 2)) >= 12;
    return (
        <article className={cls} aria-label={`확인 카드: ${item.title}`} data-ask={item.id} data-ask-reason={reason.id}>
            <span className="ask-badge">{off ? '✕ 뺐어요' : (on && item.decided ? '✓ 등록할게요' : reason.badge)}</span>
            <p className="ask-title">{item.title}</p>
            <p className="ask-meta">
                {item.kind}{item.date ? ` · ${shortDate(item.date)}` : ''}{item.time ? ` · ${ampmLabel(item.time)}` : ''}
            </p>
            {!off && <p className="ask-why">{reason.text}{!item.decided ? <span className="ask-default"> 그대로 두면 {on ? '등록돼요' : '빠져요'}.</span> : null}</p>}
            {!off && (
                <>
                    <div className="ask-chips" role="group" aria-label="종류">
                        {ASK_KINDS.map((kind) => (
                            <Btn key={kind} className={item.kind === kind ? 'chip on' : 'chip'} aria-pressed={item.kind === kind ? 'true' : 'false'} onClick={() => onPatch(item.id, { kind, decided: true })}>{kind}</Btn>
                        ))}
                    </div>
                    {reason.id === 'ampm' && item.time ? (
                        <div className="ask-chips" role="group" aria-label="오전 오후">
                            <Btn className={!pm ? 'chip on' : 'chip'} aria-pressed={!pm ? 'true' : 'false'} onClick={() => onPatch(item.id, { time: flipHalf(item.time, false), include: true, decided: true })}>{ampmLabel(flipHalf(item.time, false))}</Btn>
                            <Btn className={pm ? 'chip on' : 'chip'} aria-pressed={pm ? 'true' : 'false'} onClick={() => onPatch(item.id, { time: flipHalf(item.time, true), include: true, decided: true })}>{ampmLabel(flipHalf(item.time, true))}</Btn>
                        </div>
                    ) : null}
                    {reason.id === 'date' || item.kind === '일정' || item.date ? (
                        <div className="ask-chips" role="group" aria-label="날짜">
                            {dates.map(([label, ymd]) => (
                                <Btn key={label} className={item.date === ymd ? 'chip on' : 'chip'} aria-pressed={item.date === ymd ? 'true' : 'false'} onClick={() => pickDate(ymd)}>{label}</Btn>
                            ))}
                            <Btn className={cal ? 'chip on' : 'chip'} aria-expanded={cal ? 'true' : 'false'} onClick={() => setCal((v) => !v)}>📅 달력</Btn>
                            {item.kind === '할 일' && item.date ? <Btn className="chip" onClick={() => onPatch(item.id, { date: '', decided: true })}>날짜 없이</Btn> : null}
                        </div>
                    ) : null}
                    {cal ? <div className="ask-cal"><DateGrid value={item.date} today={today} onPick={pickDate} /></div> : null}
                </>
            )}
            <div className="ask-two">
                <Btn
                    className={on && item.decided ? 'chip on ask-yes' : 'primary-btn ask-yes'}
                    aria-pressed={on && item.decided ? 'true' : 'false'}
                    onClick={() => (askReady(item) ? onPatch(item.id, { include: true, decided: true }) : setCal(true))}
                >{off ? '다시 넣기' : (on && item.decided ? '✓ 등록' : (askReady(item) ? '등록' : '날짜 고르고 등록'))}</Btn>
                {!off ? <Btn className="chip ask-no" onClick={() => onPatch(item.id, { include: false, decided: true })}>빼기</Btn> : null}
            </div>
        </article>
    );
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
        forgetMinutesLinks(row.id);
        setMinutesPending(row.id, null);
        showToast('회의록을 지웠어요.', true);
        go('#/minutes');
    }
    return (
        <article className="minutes minutes-view" data-screen="minutes-view">
            {/* 긴 회의록도 내리지 않고 바로 고칠 수 있게 고치기는 맨 위 줄에 둡니다. */}
            <div className="minutes-view-top">
                <Btn className="chip minutes-back" onClick={() => go('#/minutes')}>‹ 회의록 목록</Btn>
                <Btn className="primary-btn minutes-edit-top" data-role="minutes-edit" onClick={() => go(`#/minutes/${row.id}/edit`)}>고치기</Btn>
            </div>
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
                    <Btn className="chip" onClick={() => setAsking(true)}>지우기</Btn>
                </div>
            )}
        </article>
    );
}

function MinutesEditor({ row }) {
    const { clock, data, go, showToast } = useUi();
    /* 저장 뒤 흐린 줄(노란 카드)을 한 번 묻는 동안의 후보 목록 */
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
    /* 날짜 달력은 접어 두고, 날짜 줄을 누르면 펼칩니다. 날짜를 고르면 다시 접습니다. */
    const [dateOpen, setDateOpen] = useState(false);
    /* 회의 종류 칩도 접어 두어, 폰에서 본문 칸이 첫 화면 안에서 시작하게 합니다. 고르면 다시 접힙니다(2026-11-14). */
    const [kindOpen, setKindOpen] = useState(false);
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
        setKindOpen(false);
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
        /* 본문에서 일정·할 일을 찾아 등록합니다(PR #64). 분명한 줄은 바로, 흐린 줄은 노란 카드로 한 번 묻습니다.
           다른 기기에서 지운·정한 항목은 되살리지 않고, 오프라인이면 등록을 미뤘다가 연결되면 확인 뒤 등록합니다(registerMinutes). */
        const found = await registerMinutes({
            id: next.id, title: next.title, date: next.date, text: next.text,
            prev: row ? { text: row.text || '', date: row.date || '' } : null,
            periods: allStarts(data.profile?.periodStarts),
            /* '퇴근 전까지' 같은 시간구는 쨈 빠른 입력과 같은 기준으로 시각을 채웁니다. */
            timeCtx: (() => { try { return timeContext(data); } catch { return null; } })(),
        });
        if (found?.storageFailed) {
            saving.current = false;
            return;
        }
        let note = saidSensitive ? '민감할 수 있는 낱말이 있어 이 기기에만 남겼어요.' : '회의록을 저장했어요.';
        if (found.count) note = `${note} 일정·할 일 ${found.count}개를 바로 등록했어요.`;
        if (found.deferred) note = `${note} 연결이 안 돼 일정·할 일 ${found.deferred}개는 연결되면 확인하고 등록할게요.`;
        if (found.tidied) note = `${note} 고친 줄의 옛 항목 ${found.tidied}개를 정리했어요.`;
        showToast(note, true);
        if (found.ask.length) {
            setAsking({ id: next.id, items: found.ask });
            return;
        }
        go(`#/minutes/${next.id}`, { replace: true });
    }

    /* 카드 하나를 고칩니다. 왜 묻는지(warning)는 남겨 두고, 사용자가 정했는지는 decided 로 봅니다. */
    function patchAsk(id, partial) {
        setAsking((prev) => prev && ({ ...prev, items: prev.items.map((item) => (item.id === id ? { ...item, ...partial } : item)) }));
    }

    async function finishAsk(registerAll) {
        if (!asking) return;
        /* 날짜 없는 일정은 등록하지 않습니다(카드에서 '날짜 고르고 등록'으로 안내). */
        const chosen = registerAll ? asking.items.filter((item) => item.include !== false && askReady(item)).map(({ decided, ...rest }) => rest) : [];
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
        const n = asking.items.filter((item) => item.include !== false && askReady(item)).length;
        return (
            <div className="minutes minutes-editor minutes-ask" data-screen="minutes-ask">
                <h2 className="title-font minutes-view-title">이것도 등록할까요?</h2>
                <p className="muted" style={{ margin: 0 }}>회의록은 저장했어요. 아래 {asking.items.length}줄만 정해 주세요. 빼면 그냥 빠지고, 다시 묻지 않아요.</p>
                <div className="minutes-ask-list">
                    {asking.items.map((item) => (
                        <MinutesAskCard key={item.id} item={item} today={clock.ymd} onPatch={patchAsk} />
                    ))}
                </div>
                <div className="minutes-actions minutes-save-row">
                    <Btn className="primary-btn minutes-ask-ok" onClick={() => finishAsk(true)}>{n ? `${n}개 등록하고 마치기` : '등록 없이 마치기'}</Btn>
                    {n ? <Btn className="chip" onClick={() => finishAsk(false)}>모두 빼고 마치기</Btn> : null}
                </div>
            </div>
        );
    }

    return (
        <div className="minutes minutes-editor" data-screen="minutes-editor">
            <Btn className="chip minutes-back" onClick={cancel}>‹ {row ? '회의록 보기' : '회의록 목록'}</Btn>
            <h2 className="title-font minutes-view-title">{row ? '회의록 고치기' : '새 회의록'}</h2>
            <label className="minutes-label" htmlFor="minutes-title">회의 제목</label>
            <Field id="minutes-title" value={title} maxLength={MINUTES_TITLE_MAX} placeholder="예: 10월 학년 협의회" onChange={(event) => setTitle(event.target.value)} />
            <div className="minutes-label" id="minutes-kind-label">회의 종류 <span className="muted">(골라도 되고 안 골라도 돼요)</span></div>
            <Btn
                className="chip minutes-date-toggle minutes-kind-toggle"
                data-role="minutes-kind-toggle"
                aria-expanded={kindOpen ? 'true' : 'false'}
                aria-controls="minutes-kind-list"
                aria-describedby="minutes-kind-label"
                onClick={() => setKindOpen((open) => !open)}
            >
                <strong className={kind ? 'minutes-date-picked' : 'muted'} data-role="minutes-kind">{kind || '고르지 않음'}</strong>
                <span className="minutes-date-hint muted">{kindOpen ? '접기' : (kind ? '바꾸기' : '고르기')}</span>
                <span className="minutes-date-caret" aria-hidden="true">{kindOpen ? '▴' : '▾'}</span>
            </Btn>
            {kindOpen ? (
                <div className="minutes-kinds" id="minutes-kind-list" role="group" aria-labelledby="minutes-kind-label">
                    {MEET_KINDS.map((item) => (
                        <Btn key={item} className={kind === item ? 'chip on' : 'chip'} aria-pressed={kind === item ? 'true' : 'false'} onClick={() => pickKind(item)}>{item}</Btn>
                    ))}
                </div>
            ) : null}
            <div className="minutes-label" id="minutes-date-label">날짜</div>
            <Btn
                className="chip minutes-date-toggle"
                data-role="minutes-date-toggle"
                aria-expanded={dateOpen ? 'true' : 'false'}
                aria-controls="minutes-date-grid"
                aria-describedby="minutes-date-label"
                onClick={() => setDateOpen((open) => !open)}
            >
                <strong className="minutes-date-picked" data-role="minutes-date">{dateLabel(date)}</strong>
                <span className="minutes-date-hint muted">{dateOpen ? '접기' : '바꾸기'}</span>
                <span className="minutes-date-caret" aria-hidden="true">{dateOpen ? '▴' : '▾'}</span>
            </Btn>
            {dateOpen ? (
                <div className="minutes-date solid-card" id="minutes-date-grid">
                    <DateGrid value={date} today={clock.ymd} onPick={(ymd) => { setDate(ymd); setDateOpen(false); }} />
                </div>
            ) : null}
            <label className="minutes-label" htmlFor="minutes-attendees">참석자 <span className="muted">(선택)</span></label>
            <Field id="minutes-attendees" value={attendees} maxLength={MINUTES_ATTENDEES_MAX} placeholder="예: 1학년 담임 선생님들" onChange={(event) => setAttendees(event.target.value)} />
            <label className="minutes-label" htmlFor="minutes-text">본문 <span className="muted">(Enter는 줄바꿈 · 날짜가 있는 할 일·일정은 저장할 때 바로 등록돼요)</span></label>
            <Area id="minutes-text" className="field minutes-text" rows={12} value={text} maxLength={MINUTES_TEXT_MAX} enterKeyHint="enter" placeholder={'안건\n- \n결정한 것\n- \n할 일\n- 11/20까지 보고서 제출'} onChange={(event) => setText(event.target.value)} />
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
