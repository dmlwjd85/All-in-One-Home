import { useMemo, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { VIEW_PAGES } from '../routes.js';
import { sortNote, archiveNotes } from '../ssugeokStore.js';
import CaptureBox from './CaptureBox.jsx';
import NoteEdit from './NoteEdit.jsx';
import { captureShortcutHere } from './shortcut.js';
import {
    DOW, dow, holidayName, monthGrid, monthPageFor, noteDay, parts, shiftYm, today, weekOf, weekPageFor,
} from './dates.js';

function byDay(notes) {
    const map = {};
    for (const note of notes || []) {
        if (note.status === 'archived') continue;
        const day = noteDay(note);
        if (!day) continue;
        (map[day] ||= []).push(note);
    }
    return map;
}

function MiniMonth({ selected, onPick, onOpenMonth, marks }) {
    const sp = parts(selected);
    const [ym, setYm] = useState({ y: sp.y, m: sp.m });
    const now = today();
    const cells = monthGrid(ym.y, ym.m);
    const week = new Set(weekOf(selected));
    const move = (d) => setYm((v) => shiftYm(v.y, v.m, d));
    return (
        <section className="dy-card dy-mini" aria-label="이달 달력">
            <div className="dy-mini-head">
                <button type="button" className="dy-arrow" onClick={() => move(-1)} aria-label="이전 달"><ChevronLeft size={18} /></button>
                <button type="button" className="dy-h dy-mini-title" onClick={() => onOpenMonth(ym.y, ym.m)} disabled={!monthPageFor(ym.y, ym.m)}>
                    {ym.y}. {ym.m}
                </button>
                <button type="button" className="dy-arrow" onClick={() => move(1)} aria-label="다음 달"><ChevronRight size={18} /></button>
            </div>
            <div className="dy-mini-grid" role="grid">
                {['월', '화', '수', '목', '금', '토', '일'].map((d) => <span key={d} className="dy-mini-dow">{d}</span>)}
                {cells.map((ymd) => {
                    const p = parts(ymd);
                    const out = p.m !== ym.m;
                    const hol = holidayName(ymd);
                    const wd = dow(ymd);
                    return (
                        <button
                            key={ymd}
                            type="button"
                            className={[
                                'dy-mini-day',
                                out ? 'is-out' : '',
                                ymd === now ? 'is-today' : '',
                                week.has(ymd) ? 'is-week' : '',
                                ymd === selected ? 'is-sel' : '',
                                hol || wd === 0 ? 'is-red' : '',
                            ].join(' ')}
                            onClick={() => onPick(ymd)}
                            aria-label={`${p.m}월 ${p.d}일${hol ? ` ${hol}` : ''}${ymd === now ? ' 오늘' : ''}`}
                            title={hol || undefined}
                        >
                            {p.d}
                            {marks[ymd] ? <i className="dy-dot" aria-hidden="true" /> : null}
                        </button>
                    );
                })}
            </div>
            <button type="button" className="dy-today-btn" onClick={() => { const t = parts(now); setYm({ y: t.y, m: t.m }); onPick(now); }}>오늘</button>
        </section>
    );
}

function DayCard({ ymd, items, onOpen }) {
    const now = today();
    const p = parts(ymd);
    const wd = dow(ymd);
    const hol = holidayName(ymd);
    const isToday = ymd === now;
    return (
        <button
            type="button"
            className={`dy-day ${isToday ? 'is-today' : ''} ${wd === 0 || hol ? 'is-red' : ''} ${wd === 6 ? 'is-sat' : ''} ${wd === 0 ? 'is-sun' : ''} ${ymd < now ? 'is-past' : ''}`}
            onClick={() => onOpen(ymd)}
            aria-label={`${p.m}월 ${p.d}일 ${DOW[wd]}요일${isToday ? ', 오늘' : ''} 주간 쪽 열기`}
        >
            <span className="dy-day-head">
                <span className="dy-day-num">{p.d}</span>
                <span className="dy-day-dow">{DOW[wd]}</span>
                {isToday && <span className="dy-pill">오늘</span>}
            </span>
            {hol && <span className="dy-day-hol">{hol}</span>}
            <span className={`dy-day-items ${items.length === 0 ? 'is-blank' : ''}`}>
                {items.length === 0 && (
                    <span className="dy-day-empty">{isToday ? '오늘 한 줄' : wd === 0 || wd === 6 ? '쉬는 날' : '한 줄 여유'}</span>
                )}
                {items.length === 0 && <span className="dy-day-sheet" aria-hidden="true" />}
                {items.slice(0, 2).map((n) => (
                    <span key={n.id} className={`dy-day-item is-${n.suggestion?.tone || 'sand'}`}>{n.text}</span>
                ))}
                {items.length > 2 && <span className="dy-day-more">+{items.length - 2}</span>}
            </span>
        </button>
    );
}

function Inbox({ notes, signedIn, onChanged, onToast, onGo, big }) {
    const list = notes.filter((n) => n.status === 'inbox').slice(0, big ? 3 : 5);
    const sortOne = async (note) => {
        const s = note.suggestion;
        if (!s || (s.needsStudent && !note.studentNo)) {
            onGo(VIEW_PAGES.write);
            return;
        }
        const placed = await sortNote(note, s, signedIn);
        onChanged?.();
        onToast?.(`${placed.label}에 옮겼어요. 원문은 쓱, 적에 남아요.`);
    };
    const archive = async (note) => {
        await archiveNotes([note], signedIn);
        onChanged?.();
        onToast?.('보관했어요.');
    };
    if (!list.length) {
        return (
            <div className="dy-empty">
                <p className="dy-muted">나눌 메모가 없어요. 적기만 하면 돼요.</p>
                <p className="dy-example">예: @12 #행발 발표를 또렷하게</p>
                <p className="dy-example">예: 내일 회의 자료 인쇄</p>
            </div>
        );
    }
    return (
        <ul className={`dy-inbox ${big ? 'is-big' : ''}`}>
            {list.map((note) => (
                <li key={note.id}>
                    <NoteEdit
                        note={note}
                        variant="inbox"
                        signedIn={signedIn}
                        onChanged={onChanged}
                        onToast={onToast}
                        extra={(
                            <>
                                <button type="button" className="dy-btn-soft dy-act-main" onClick={() => sortOne(note)}>
                                    <span className="dy-ellip">{note.suggestion?.label ? `제안: ${note.suggestion.label}` : '나누기'}</span>
                                    <ArrowRight size={14} aria-hidden="true" />
                                </button>
                                <button type="button" className="dy-btn-ghost" onClick={() => archive(note)}>보관</button>
                            </>
                        )}
                    />
                </li>
            ))}
        </ul>
    );
}

export default function TodayBoard({
    pages, onGo, notes, signedIn, author, onChanged, onToast, fields, setField, phone,
}) {
    const now = today();
    const [selected, setSelected] = useState(now);
    const marks = useMemo(() => byDay(notes), [notes]);
    const days = weekOf(selected);
    const openDay = (ymd) => {
        const dest = weekPageFor(ymd, pages);
        if (dest) onGo(dest, { hash: `#/date/${ymd}` });
        else onToast?.('그날은 수첩 주간 쪽 밖이에요.');
    };
    const sp = parts(selected);
    const inboxCount = notes.filter((n) => n.status === 'inbox').length;
    const shortcut = captureShortcutHere();
    const weekMemos = days.reduce((sum, ymd) => sum + (marks[ymd]?.length || 0), 0);
    const emptyDays = days.filter((ymd) => !(marks[ymd]?.length)).length;
    const capProps = { author, signedIn, fromPage: VIEW_PAGES.home, onChanged, onToast };

    if (phone) {
        const items = marks[selected] || [];
        const wd = dow(selected);
        return (
            <div className="dy-m">
                <CaptureBox big {...capProps} />
                <div className="dy-strip" role="tablist" aria-label="이번 주">
                    {days.map((ymd) => {
                        const p = parts(ymd);
                        const d = dow(ymd);
                        return (
                            <button
                                key={ymd}
                                type="button"
                                role="tab"
                                aria-selected={ymd === selected}
                                className={`dy-strip-day ${ymd === selected ? 'is-sel' : ''} ${ymd === now ? 'is-today' : ''} ${d === 6 ? 'is-sat' : ''} ${d === 0 || holidayName(ymd) ? 'is-red' : ''}`}
                                onClick={() => setSelected(ymd)}
                            >
                                <span>{DOW[d]}</span>
                                <b>{p.d}</b>
                                {marks[ymd] ? <i className="dy-dot" aria-hidden="true" /> : <i className="dy-dot is-none" aria-hidden="true" />}
                            </button>
                        );
                    })}
                </div>
                <section className="dy-card">
                    <div className="dy-sec-head">
                        <h2 className="dy-h dy-day-title">{sp.m}월 {sp.d}일 {DOW[wd]}요일{selected === now ? <span className="dy-today-mark"> · 오늘</span> : null}</h2>
                        <button type="button" className="dy-link" onClick={() => openDay(selected)}>주간 쪽 <ArrowRight size={14} /></button>
                    </div>
                    {holidayName(selected) && <p className="dy-hol">{holidayName(selected)}</p>}
                    {items.length ? (
                        <ul className="dy-list">
                            {items.map((n) => (
                                <li key={n.id}>
                                    <NoteEdit note={n} signedIn={signedIn} onChanged={onChanged} onToast={onToast} />
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="dy-empty">
                            <p className="dy-muted">이날 적은 것이 없어요.</p>
                            <p className="dy-example">위에서 쓱, 적어 두거나 주간 쪽에서 교시를 적어요.</p>
                        </div>
                    )}
                </section>
                <section className="dy-card">
                    <div className="dy-sec-head">
                        <h2 className="dy-h">나누기 {inboxCount ? <span className="dy-count">{inboxCount}</span> : null}</h2>
                        <button type="button" className="dy-link" onClick={() => onGo(VIEW_PAGES.write)}>모두 보기 <ArrowRight size={14} /></button>
                    </div>
                    <Inbox notes={notes} big signedIn={signedIn} onChanged={onChanged} onToast={onToast} onGo={onGo} />
                </section>
            </div>
        );
    }

    return (
        <div className="dy-board">
            <aside className="dy-col-left">
                <MiniMonth
                    selected={selected}
                    onPick={setSelected}
                    marks={marks}
                    onOpenMonth={(y, m) => { const d = monthPageFor(y, m); if (d) onGo(d); }}
                />
                <label className="dy-card dy-goal">
                    <span className="dy-label">올해 우리 반 한 줄 목표</span>
                    <input value={fields?.goal || ''} onChange={(e) => setField('goal', e.target.value)} placeholder="한 줄로 적어 두세요" />
                    <span className="dy-example">학기 동안 이 칸에 한 줄만 남겨 두세요.</span>
                </label>
            </aside>
            <section className="dy-col-center" aria-label="이번 주">
                <div className="dy-week-head">
                    <div>
                        <p className="dy-kicker">{selected === now ? '오늘' : '고른 날'} · {sp.m}월 {sp.d}일 {DOW[dow(selected)]}요일</p>
                        <h1 className="dy-title">이번 주</h1>
                        <p className="dy-week-stats">일곱 날 · 메모 {weekMemos} · 빈 날 {emptyDays}</p>
                    </div>
                    <div className="dy-week-nav">
                        <button type="button" className="dy-arrow" onClick={() => setSelected((s) => addWeek(s, -1))} aria-label="지난주"><ChevronLeft size={18} /></button>
                        <button type="button" className="dy-btn-ghost" onClick={() => setSelected(now)}>오늘</button>
                        <button type="button" className="dy-arrow" onClick={() => setSelected((s) => addWeek(s, 1))} aria-label="다음 주"><ChevronRight size={18} /></button>
                    </div>
                </div>
                <ul className="dy-legend" aria-label="색 안내">
                    <li><i className="is-today" aria-hidden="true" />오늘</li>
                    <li><i className="is-weekend" aria-hidden="true" />주말</li>
                    <li><i className="is-work" aria-hidden="true" />업무</li>
                </ul>
                <div className="dy-week">
                    {days.map((ymd) => (
                        <DayCard key={ymd} ymd={ymd} items={marks[ymd] || []} onOpen={openDay} />
                    ))}
                </div>
            </section>
            <aside className="dy-col-right dy-card dy-ssu-panel" aria-label="쓱, 적">
                <div className="dy-sec-head">
                    <h2 className="dy-h">쓱, 적</h2>
                    <kbd className="dy-kbd" title={`${shortcut}로 어디서나`}>{shortcut}</kbd>
                </div>
                <CaptureBox {...capProps} />
                <div className="dy-sec-head dy-gap">
                    <h3 className="dy-h3">나눌 메모 {inboxCount ? <span className="dy-count">{inboxCount}</span> : null}</h3>
                    <button type="button" className="dy-link" onClick={() => onGo(VIEW_PAGES.write)}>모두 <ArrowRight size={14} /></button>
                </div>
                <Inbox notes={notes} signedIn={signedIn} onChanged={onChanged} onToast={onToast} onGo={onGo} />
                <p className="dy-muted dy-note">제안만 보여요. 누르기 전에는 아무 데도 옮기지 않아요.</p>
            </aside>
        </div>
    );
}

function addWeek(ymd, n) {
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + 7 * n)).toISOString().slice(0, 10);
}
