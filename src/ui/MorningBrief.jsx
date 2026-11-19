import { useEffect, useMemo, useState } from 'react';
import { addDaysYmd, dayKeyFromYmd, weekdayKo } from '../lib/date.js';
import { restInfo } from '../lib/daymark.js';
import { joined, joinedRecords, studentCardLocal } from '../lib/db.js';
import { allergyHits } from '../lib/allergy.js';
import { mealsFromNotes } from '../lib/mealPaste.js';
import { homeworkAssignments, homeworkProgress, homeworkTitle } from '../lib/homework.js';
import { allLengths, allStarts, isLocked, withUsedCount } from '../lib/periodLocal.js';
import { tableForDateWithLocal } from '../lib/semester.js';
import { DEMO_WORK } from '../lib/demo.js';
import { buildBriefing, markBriefSeen, shouldShowBrief } from '../lib/briefing.js';
import { usePeriodLocal } from './usePeriodLocal.js';
import { useWorkClock } from './WorkTimer.jsx';
import { useUi } from './context.jsx';
import { Btn } from './bits.jsx';
import './brief.css';

export const BRIEF_EVENT = 'ssug-gyomu-brief-open';
/** 어디서든 오늘 브리핑을 다시 엽니다(단축키·설정의 「지금 보기」). */
export function openBrief() {
    try { window.dispatchEvent(new Event(BRIEF_EVENT)); } catch { /* 창이 없으면 넘어갑니다 */ }
}

/** 자동 화면 검사(브라우저 자동 조작)에서는 저절로 뜨지 않게 합니다: 팝업이 다른 검사의 누르기를 가립니다.
    주소에 ?brief=1 을 붙이면 검사에서도 뜹니다. */
function autoAllowed() {
    try {
        const q = new URLSearchParams(window.location.search);
        if (q.get('brief') === '1') return true;
        if (q.get('brief') === '0') return false;
        return !navigator.webdriver;
    } catch {
        return true;
    }
}

function useBriefing(data, clock) {
    const saved = withUsedCount(data.timetable, usePeriodLocal());
    return useMemo(() => {
        const ymd = clock.ymd;
        const tomorrow = addDaysYmd(ymd, 1);
        const day = dayKeyFromYmd(ymd);
        const local = data.profile.demo && !saved.workStart && !saved.workEnd ? { ...saved, ...DEMO_WORK } : saved;
        const table = tableForDateWithLocal(data, ymd, local);
        const starts = allStarts(data.profile.periodStarts, local);
        const lengths = allLengths(local);
        const events = joined(data, 'events');
        const rest = restInfo(ymd, events);
        const covers = (row, date) => { const end = row.end && row.end >= row.date ? row.end : row.date; return row.date <= date && end >= date; };
        const periods = rest.off ? [] : Array.from({ length: local.count }, (_, i) => ({ n: i + 1, label: table[`p${i + 1}`] || '', start: starts[i], length: lengths[i], specialist: table[`s${i + 1}`] || '', locked: isLocked(local, day, i + 1) }));
        const nameOf = (sid) => data.students.find((s) => s.id === sid);
        const meal = mealsFromNotes(joined(data, 'notes'))[ymd];
        const hits = allergyHits((data.students || []).map((student) => ({ ...student, allergyWords: studentCardLocal(data, student.id).allergyWords })), meal);
        const who = (student) => ({ no: student.no, name: student.name });
        const brief = buildBriefing({
            ymd,
            tomorrow,
            hm: clock.hm,
            weekday: weekdayKo(ymd),
            checked: data.profile.checkedDates.includes(ymd),
            periods,
            events: events.filter((row) => covers(row, ymd)),
            tomorrowEvents: events.filter((row) => covers(row, tomorrow)),
            todos: joined(data, 'todos'),
            homework: homeworkAssignments(joined(data, 'homework')).map((row) => ({ id: row.id, title: homeworkTitle(row), date: row.date, ...homeworkProgress(row, data.students) })),
            allergy: hits.map((hit) => who(hit.student)),
            follows: joinedRecords(data).filter((row) => row.follow === ymd).map((row) => nameOf(row.sid)).filter(Boolean).map(who),
            birthdays: data.students.filter((row) => row.birthday && row.birthday === ymd.slice(5)).map(who),
            absent: data.attendance.filter((row) => row.date === ymd).map((row) => ({ ...(nameOf(row.sid) || {}), status: row.status })).filter((row) => row.name),
            noticeTomorrow: joined(data, 'notices').some((row) => row.date === tomorrow && String(row.text || '').trim()),
        });
        return { brief, rest: rest.off };
    }, [data, clock.ymd, clock.hm, saved]);
}

/** 아침 8시 뒤 그날 처음 앱을 열면 한 번 뜹니다. 다른 창(대화상자·쨈 입력)이 떠 있으면 닫힐 때까지 기다립니다. */
export function MorningBrief({ busy = false }) {
    const { data, go } = useUi();
    const clock = useWorkClock(false);
    const { brief, rest } = useBriefing(data, clock);
    const [open, setOpen] = useState(false);
    const started = Boolean(data?.profile?.started);
    useEffect(() => {
        if (open || busy || !autoAllowed()) return;
        if (!shouldShowBrief({ ymd: clock.ymd, hm: clock.hm, rest, started })) return;
        if (document.querySelector('[aria-modal="true"], .sheet-back, .quick-bar.is-open')) return;
        markBriefSeen(clock.ymd);
        setOpen(true);
    }, [open, busy, clock.ymd, clock.hm, rest, started]);
    useEffect(() => {
        const show = () => { markBriefSeen(clock.ymd); setOpen(true); };
        window.addEventListener(BRIEF_EVENT, show);
        return () => window.removeEventListener(BRIEF_EVENT, show);
    }, [clock.ymd]);
    useEffect(() => {
        if (!open) return undefined;
        const onKey = (event) => { if (event.key === 'Escape') setOpen(false); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [open]);
    if (!open) return null;
    const close = () => setOpen(false);
    const jump = (href) => { close(); go(href); };
    return (
        <div className="sheet-back brief-back" onClick={close}>
            <div className="brief-pop" role="dialog" aria-modal="true" aria-label="오늘 브리핑" data-role="brief" onClick={(event) => event.stopPropagation()}>
                <div className="brief-head">
                    <div className="brief-hello">
                        <h2 className="title-font">{clock.hm < '12:00' ? '☀️' : clock.hm < '17:00' ? '🌤️' : '🌙'} {brief.hello}</h2>
                        <p className="muted" data-role="brief-summary">{`${Number(clock.ymd.slice(5, 7))}월 ${Number(clock.ymd.slice(8))}일 · ${brief.summary}`}</p>
                    </div>
                    <Btn className="icon-btn" aria-label="브리핑 닫기" onClick={close}>✕</Btn>
                </div>
                {brief.calm ? (
                    <p className="brief-calm">급한 일이 없어요. 오늘은 수업에 마음 편히 집중하셔도 돼요.</p>
                ) : (
                    <>
                        <p className="brief-lead">오늘은 이 차례로 해 보시면 어때요?</p>
                        <ol className="brief-steps">
                            {brief.steps.map((step, i) => (
                                <li key={step.id}>
                                    <Btn block className="brief-step" data-brief-step={step.id} onClick={() => jump(step.href)}>
                                        <span className="brief-n num" aria-hidden="true">{i + 1}</span>
                                        <span className="brief-ico" aria-hidden="true">{step.icon}</span>
                                        <span className="brief-text"><strong>{step.title}</strong>{step.sub && <span className="muted">{step.sub}</span>}</span>
                                        <span className="brief-go" aria-hidden="true">›</span>
                                    </Btn>
                                </li>
                            ))}
                        </ol>
                        {brief.more > 0 && <p className="muted brief-more">이 밖에 {brief.more}가지는 오늘 화면에서 볼 수 있어요.</p>}
                    </>
                )}
                {brief.agenda.length > 0 && (
                    <div className="brief-agenda" aria-label="오늘 흐름">
                        {brief.agenda.map((row, i) => (
                            <span key={i} className={`brief-slot${row.now ? ' is-now' : ''}${row.past ? ' is-past' : ''}${row.kind === 'event' ? ' is-event' : ''}`}>
                                <span className="num">{row.time}</span> {row.text}
                            </span>
                        ))}
                    </div>
                )}
                <div className="brief-foot">
                    <span className="muted">하루 한 번, 아침 8시 뒤 처음 열 때 떠요. 설정 › 할 일에서 끌 수 있어요.</span>
                    <Btn className="primary-btn" data-role="brief-close" onClick={close}>시작할게요</Btn>
                </div>
            </div>
        </div>
    );
}
