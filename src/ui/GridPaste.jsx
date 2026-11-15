import { useEffect, useMemo, useRef, useState } from 'react';
import { saveCalendarEvents, saveMealMonth } from '../lib/db.js';
import { parseCalGrid, shiftCalEvents } from '../lib/calGrid.js';
import { encodeMeals, looksLikeMealTable, parseMealTable, shiftMealDays } from '../lib/mealPaste.js';
import { isSensitiveText } from '../lib/sensitive.js';
import { readPasteSchedule } from '../lib/teamsPaste.js';
import { allStarts, readPeriodLocal } from '../lib/periodLocal.js';
import { useUi } from './context.jsx';
import { Btn } from './bits.jsx';
import { readImageTable } from './tableOcr.js';

function periodsOf(data) {
    return allStarts(data?.profile?.periodStarts);
}

function lengthsOf() {
    const local = readPeriodLocal();
    return local.lengths || [];
}

function readAny(text, { today, year, month, periods, lengths }) {
    const now = new Date(`${today}T09:00:00+09:00`);
    if (looksLikeMealTable(text)) {
        const meal = parseMealTable(text, { today, year, month, now });
        return { kind: 'meal', year: meal.year || year, month: meal.month || month, days: meal.days || [], items: [] };
    }
    const schedule = readPasteSchedule(text, { now, periods, lengths, year, month });
    if (schedule.mode === 'calendar') {
        return { kind: 'calendar', year: schedule.year, month: schedule.month, items: schedule.items, days: [] };
    }
    if (schedule.items?.length) {
        return { kind: 'list', year: schedule.year || Number(today.slice(0, 4)), month: schedule.month || Number(today.slice(5, 7)), items: schedule.items, days: [] };
    }
    const grid = parseCalGrid(text, { today, year, month, periods, lengths });
    if (grid.events.length) return { kind: 'calendar', year: grid.year, month: grid.month, items: grid.events, days: [] };
    return { kind: 'empty', year, month, items: [], days: [] };
}

function markClipped(items, clipped) {
    if (!clipped?.length) return items;
    return items.map((item) => {
        const hit = clipped.some((cell) => cell.text && (cell.text.includes(item.title) || (item.raw && cell.text.includes(String(item.raw).slice(0, 12)))));
        return hit ? { ...item, clipped: true, warning: [item.warning, '글자가 잘렸을 수 있음'].filter(Boolean).join(' ') } : item;
    });
}

export function GridPaste({ text, image, onBack }) {
    const { data, clock, showToast } = useUi();
    const fileRef = useRef(null);
    const periods = periodsOf(data);
    const lengths = lengthsOf();
    const first = useMemo(() => readAny(text, { today: clock.ymd, year: 0, month: 0, periods, lengths }), [text, clock.ymd, periods, lengths]);
    const [year, setYear] = useState(first.year || Number(clock.ymd.slice(0, 4)));
    const [month, setMonth] = useState(first.month || Number(clock.ymd.slice(5, 7)));
    const [kind, setKind] = useState(first.kind);
    const [items, setItems] = useState(first.items);
    const [days, setDays] = useState(first.days);
    const [school, setSchool] = useState(true);
    const [busy, setBusy] = useState('');
    const [source, setSource] = useState(text);
    useEffect(() => { if (image) onFile(image); }, [image]);

    function applyRead(nextText, clipped = []) {
        const read = readAny(nextText, { today: clock.ymd, year: 0, month: 0, periods, lengths });
        setSource(nextText);
        setKind(read.kind);
        setYear(read.year || year);
        setMonth(read.month || month);
        setItems(markClipped(read.items, clipped));
        setDays(read.days);
    }

    function moveMonth(delta) {
        let y = year;
        let m = month + delta;
        if (m < 1) { m = 12; y -= 1; }
        if (m > 12) { m = 1; y += 1; }
        setYear(y);
        setMonth(m);
        if (kind === 'meal') setDays(shiftMealDays(days, y, m));
        else setItems(shiftCalEvents(items, y, m));
    }

    async function onFile(file) {
        if (!file) return;
        setBusy('표의 글자를 읽고 있어요. 처음에는 언어 자료를 한 번 받습니다.');
        try {
            const found = await readImageTable(file);
            applyRead(found.text, found.clipped);
            if (found.weak) showToast('칸 선을 잘 못 찾았어요. 읽은 글을 확인해 주세요.');
            else showToast('표에서 글자를 읽었어요. 맞는지만 봐 주세요.');
        } catch {
            showToast('이 사진에서 글자를 읽지 못했어요. 글을 붙여 넣어 주세요.');
        } finally {
            setBusy('');
        }
    }

    async function save() {
        if (kind === 'meal') {
            const result = await saveMealMonth(year, month, days);
            showToast(result.message || '저장하지 못했어요.', Boolean(result.ok));
            if (result.ok) onBack();
            return;
        }
        const chosen = items.map((item) => ({ ...item, eventKind: school ? '학교' : (item.eventKind || '학급') }));
        const result = await saveCalendarEvents(chosen);
        showToast(result.message || '저장하지 못했어요.', Boolean(result.ok));
        if (result.ok) onBack();
    }

    const kept = items.filter((item) => item.include !== false).length;
    const leak = encodeMeals(days);
    const mealLocal = kind === 'meal' && isSensitiveText(leak);

    return (
        <div data-screen="grid-paste">
            <p className="muted" style={{ marginTop: 0 }}>읽은 날짜·시각·제목을 고친 뒤 넣을 것만 남겨 주세요. 해와 달은 표에 없으면 요일로 짐작한 값이에요.</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Btn className="chip" onClick={() => moveMonth(-1)}>이전 달</Btn>
                <strong>{year}년 {month}월</strong>
                <Btn className="chip" onClick={() => moveMonth(1)}>다음 달</Btn>
            </div>
            <textarea className="field" style={{ marginTop: 8 }} aria-label="표 글" rows={4} value={source} onChange={(event) => setSource(event.target.value)} />
            <Btn className="chip" style={{ marginTop: 8 }} onClick={() => applyRead(source)}>다시 읽기</Btn>
            {kind !== 'meal' && (
                <Btn className={school ? 'chip on' : 'chip'} style={{ marginTop: 8 }} aria-pressed={school} onClick={() => setSchool((value) => !value)}>
                    {school ? '✓ 학교 일정(학사)으로 등록' : '학급 일정으로 등록'}
                </Btn>
            )}
            {busy && <p className="low-card" role="status" style={{ padding: 10 }}>{busy}</p>}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <Btn className="chip" onClick={() => fileRef.current?.click()}>표 이미지</Btn>
                <input ref={fileRef} type="file" accept="image/*" aria-label="표 이미지" style={{ display: 'none' }} onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ''; }} />
            </div>
            {kind === 'meal' ? (
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                    {mealLocal && <p className="low-card" style={{ padding: 10, margin: 0 }}>민감한 낱말이 있어 이 기기에만 남깁니다.</p>}
                    {!days.length && <p className="muted">날짜별 메뉴를 아직 못 나눴어요. 표를 다시 붙여 넣어 주세요.</p>}
                    {days.map((day) => (
                        <article key={day.date} className={day.clipped ? 'msg-card low-card' : 'msg-card'} data-meal-day={day.date}>
                            <p style={{ margin: '0 0 6px', fontWeight: 800 }}>{Number(day.date.slice(5, 7))}월 {Number(day.date.slice(8, 10))}일{day.clipped ? ' · 글자가 잘렸을 수 있음' : ''}</p>
                            <textarea className="field" aria-label={`${day.date} 메뉴`} rows={Math.min(8, Math.max(3, day.items.length + 1))} value={day.items.map((item) => (item.codes ? `${item.name} ${item.codes}` : item.name)).join('\n')} onChange={(event) => {
                                const itemsNext = event.target.value.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
                                    const match = line.match(/^(.*?)(?:\s+(\d{1,2}(?:\.\d{1,2})+|\d{1,2}))?$/);
                                    return { name: (match?.[1] || line).trim(), codes: match?.[2] || '' };
                                });
                                setDays((prev) => prev.map((row) => (row.date === day.date ? { ...row, items: itemsNext } : row)));
                            }} />
                        </article>
                    ))}
                    <Btn className="primary-btn block" onClick={save} disabled={!days.length}>급식 저장</Btn>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                    {!items.length && <p className="muted">일정을 아직 못 나눴어요. 표나 팀즈 글을 붙여 넣어 주세요.</p>}
                    {items.map((item) => (
                        <article key={item.id || `${item.date}-${item.title}`} className={item.warning ? 'msg-card low-card' : 'msg-card'} data-cal-item={item.date}>
                            <Btn className={item.include === false ? 'chip' : 'chip on'} aria-pressed={item.include !== false} onClick={() => setItems((prev) => prev.map((row) => (row === item ? { ...row, include: row.include === false } : row)))}>
                                {item.include === false ? '빼 둠' : '✓ 넣기'}
                            </Btn>
                            {item.warning && <p style={{ fontWeight: 800, margin: '8px 0 0' }}>{item.warning}</p>}
                            <input className="field" style={{ marginTop: 8 }} aria-label="제목" value={item.title} onChange={(event) => setItems((prev) => prev.map((row) => (row === item ? { ...row, title: event.target.value } : row)))} />
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                                <input className="field" style={{ flex: '1 1 140px', minWidth: 0 }} aria-label="날짜" value={item.date || ''} onChange={(event) => setItems((prev) => prev.map((row) => (row === item ? { ...row, date: event.target.value } : row)))} />
                                <input className="field" style={{ flex: '1 1 88px', minWidth: 0 }} aria-label="시작 시각" placeholder="시작" value={item.time || ''} onChange={(event) => setItems((prev) => prev.map((row) => (row === item ? { ...row, time: event.target.value, allDay: !event.target.value } : row)))} />
                                <input className="field" style={{ flex: '1 1 88px', minWidth: 0 }} aria-label="끝나는 시각" placeholder="끝" value={item.endTime || ''} onChange={(event) => setItems((prev) => prev.map((row) => (row === item ? { ...row, endTime: event.target.value } : row)))} />
                            </div>
                            <input className="field" style={{ marginTop: 8 }} aria-label="장소" placeholder="장소" value={item.place || ''} onChange={(event) => setItems((prev) => prev.map((row) => (row === item ? { ...row, place: event.target.value } : row)))} />
                            {item.allDay && !item.time ? <p className="muted" style={{ margin: '6px 0 0' }}>시각이 없어 종일 일정으로 둡니다.</p> : null}
                            {item.memo ? <p className="muted" style={{ margin: '6px 0 0', overflowWrap: 'anywhere' }}>{item.memo}</p> : null}
                        </article>
                    ))}
                    <Btn className="primary-btn block" onClick={save} disabled={!kept}>{kept ? `${kept}개 등록` : '등록할 일정 없음'}</Btn>
                </div>
            )}
            <Btn className="chip block" style={{ marginTop: 8 }} onClick={onBack}>돌아가기</Btn>
            <p className="muted" style={{ overflowWrap: 'anywhere' }}>{kind === 'meal' ? '급식은 메모와 같은 길로 다른 기기와 맞춥니다.' : `읽은 글 ${source.trim().split('\n').length}줄`}</p>
        </div>
    );
}
