import { useEffect, useMemo, useRef, useState } from 'react';
import { normalizeCalendarItem } from '../lib/calWhen.js';
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

function readAny(text, { today, year, month, periods, lengths, meal = false, fix = false }) {
    const now = new Date(`${today}T09:00:00+09:00`);
    /* meal: 급식표로 읽으라고 고른 경우(번호가 없는 급식표도 읽습니다). fix: 사진에서 읽은 글이라 닮은 글자를 바로잡습니다. */
    if (meal || looksLikeMealTable(text)) {
        const found = parseMealTable(text, { today, year, month, now, fix });
        if (meal || found.days?.length) return { kind: 'meal', year: found.year || year, month: found.month || month, days: found.days || [], items: [] };
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

export function GridPaste({ text, image, mode = '', onBack }) {
    const { data, clock, showToast } = useUi();
    const fileRef = useRef(null);
    const cameraRef = useRef(null);
    const periods = periodsOf(data);
    const lengths = lengthsOf();
    const [asMeal, setAsMeal] = useState(mode === 'meal');
    const [fromImage, setFromImage] = useState(false);
    const first = useMemo(() => readAny(text, { today: clock.ymd, year: 0, month: 0, periods, lengths, meal: mode === 'meal' }), [text, clock.ymd, periods, lengths, mode]);
    const [year, setYear] = useState(first.year || Number(clock.ymd.slice(0, 4)));
    const [month, setMonth] = useState(first.month || Number(clock.ymd.slice(5, 7)));
    const [kind, setKind] = useState(first.kind);
    const [items, setItems] = useState(first.items);
    const [days, setDays] = useState(first.days);
    const [school, setSchool] = useState(true);
    const [busy, setBusy] = useState('');
    const [source, setSource] = useState(text);
    const [weak, setWeak] = useState(false);
    const [small, setSmall] = useState(false);
    useEffect(() => { if (image) onFile(image); }, [image]);

    function applyRead(nextText, clipped = [], { meal = asMeal, fix = fromImage } = {}) {
        const read = readAny(nextText, { today: clock.ymd, year: 0, month: 0, periods, lengths, meal, fix });
        setSource(nextText);
        setKind(read.kind);
        setYear(read.year || year);
        setMonth(read.month || month);
        setItems(markClipped(read.items, clipped));
        setDays(read.days);
        return read;
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
        setBusy('사진을 열고 있어요.');
        try {
            const found = await readImageTable(file, (message) => setBusy(message));
            setFromImage(true);
            setWeak(Boolean(found.weak));
            setSmall(Boolean(found.small));
            const read = applyRead(found.text, found.clipped, { fix: true });
            if (read.kind === 'meal' && read.days.length) showToast(`급식 ${read.days.length}일치를 읽었어요. 틀린 글자만 고쳐 주세요.`);
            else if (read.kind === 'meal') showToast('날짜를 찾지 못했어요. 표 전체가 반듯하게 나온 사진으로 다시 해 주세요.');
            else if (found.weak) showToast('칸 선을 잘 못 찾았어요. 읽은 글을 확인해 주세요.');
            else showToast('표에서 글자를 읽었어요. 맞는지만 봐 주세요.');
        } catch (error) {
            const offline = /fetch|network|Failed to fetch|언어|NetworkError/i.test(String(error?.message || error || ''));
            showToast(offline
                ? '글자 읽는 자료를 받지 못했어요. 인터넷에 연결한 뒤 다시 하거나, 표를 글자로 붙여 넣어 주세요.'
                : '이 사진을 읽지 못했어요. 화면 갈무리(PNG·JPG)로 다시 해 보거나 글을 붙여 넣어 주세요.');
        } finally {
            setBusy('');
        }
    }

    function toggleMeal() {
        const next = !asMeal;
        setAsMeal(next);
        applyRead(source, [], { meal: next });
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

    const kept = items.filter((item) => item.include !== false && normalizeCalendarItem(item).ok).length;
    const leak = encodeMeals(days);
    const mealLocal = kind === 'meal' && isSensitiveText(leak);

    return (
        <div data-screen="grid-paste">
            <p className="muted" style={{ marginTop: 0 }}>{kind === 'meal'
                ? '읽은 날짜와 메뉴를 확인하고 틀린 글자만 고쳐 주세요. 달이 다르면 아래에서 바꿀 수 있어요.'
                : '읽은 날짜·시각·제목을 고친 뒤 넣을 것만 남겨 주세요. 해와 달은 표에 없으면 요일로 짐작한 값이에요.'}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Btn className="chip" onClick={() => moveMonth(-1)}>이전 달</Btn>
                <strong>{year}년 {month}월</strong>
                <Btn className="chip" onClick={() => moveMonth(1)}>다음 달</Btn>
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <Btn className="chip" disabled={Boolean(busy)} data-role="grid-shoot" onClick={() => cameraRef.current?.click()}>📸 {asMeal ? '급식표 촬영' : '표 촬영'}</Btn>
                <Btn className="chip" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>{asMeal ? '급식표 사진 고르기' : '표 사진 고르기'}</Btn>
                <input ref={cameraRef} type="file" accept="image/*" capture="environment" aria-label="표 촬영" style={{ display: 'none' }} onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ''; }} />
                <Btn className={asMeal ? 'chip on' : 'chip'} aria-pressed={asMeal} onClick={toggleMeal}>{asMeal ? '✓ 급식표로 읽기' : '급식표로 읽기'}</Btn>
                <input ref={fileRef} type="file" accept="image/*" aria-label="표 이미지" style={{ display: 'none' }} onChange={(event) => { onFile(event.target.files?.[0]); event.target.value = ''; }} />
            </div>
            {busy && <p className="low-card" role="status" style={{ padding: 10 }}>{busy}</p>}
            {weak && !busy && <p className="low-card" role="status" style={{ padding: 10 }}>글자 인식이 약할 수 있어요. 아래 날짜와 제목·메뉴를 직접 고쳐 주세요. 표 전체가 반듯하게 나온 화면 갈무리가 가장 잘 읽히고, 자료를 못 받으면 표를 글자로 붙여 넣으면 됩니다.</p>}
            {small && !weak && !busy && <p className="low-card" style={{ padding: 10 }}>사진 속 글자가 작아 틀린 글자가 많을 수 있어요. 표를 화면에 가득 차게 가까이 찍으면 더 잘 읽힙니다.</p>}
            {fromImage && kind === 'meal' && days.length > 0 && !busy && <p className="muted" style={{ margin: '8px 0 0' }}>사진에서 읽은 알레르기 번호는 저장 전에 한 번 꼭 확인해 주세요. 메뉴판과 다르면 그 칸에서 바로 고칠 수 있어요.</p>}
            <details style={{ marginTop: 8 }}>
                <summary className="muted" style={{ minHeight: 44, display: 'flex', alignItems: 'center', cursor: 'pointer' }}>읽은 글 직접 고치기</summary>
                <textarea className="field" style={{ marginTop: 8 }} aria-label="표 글" rows={4} value={source} onChange={(event) => setSource(event.target.value)} />
                <Btn className="chip" style={{ marginTop: 8 }} onClick={() => applyRead(source)}>다시 읽기</Btn>
            </details>
            {kind !== 'meal' && (
                <Btn className={school ? 'chip on' : 'chip'} style={{ marginTop: 8 }} aria-pressed={school} onClick={() => setSchool((value) => !value)}>
                    {school ? '✓ 학교 일정(학사)으로 등록' : '학급 일정으로 등록'}
                </Btn>
            )}
            {kind === 'meal' ? (
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                    {mealLocal && <p className="low-card" style={{ padding: 10, margin: 0 }}>민감한 낱말이 있어 이 기기에만 남깁니다.</p>}
                    {!days.length && !busy && <p className="muted">아직 읽은 메뉴가 없어요. 급식표 사진을 고르거나, 표를 복사해 '읽은 글 직접 고치기'에 붙여 넣어 주세요.</p>}
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
                            {day.items.some((item) => item.read) && (
                                <p className="muted" data-meal-fixed style={{ margin: '6px 0 0', overflowWrap: 'anywhere' }}>
                                    흐리게 읽혀 고친 이름: {day.items.filter((item) => item.read).map((item) => `${item.read} → ${item.name}`).join(', ')}
                                </p>
                            )}
                        </article>
                    ))}
                    <Btn className="primary-btn block" onClick={save} disabled={!days.length || Boolean(busy)}>{days.length ? `급식 ${days.length}일치 저장` : '급식 저장'}</Btn>
                </div>
            ) : (
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                    {!items.length && <p className="muted">일정을 아직 못 나눴어요. 표나 팀즈 글을 붙여 넣어 주세요.</p>}
                    {items.map((item, index) => (
                        <article key={`${item.date}-${index}`} className={item.warning || normalizeCalendarItem(item).error ? 'msg-card low-card' : 'msg-card'} data-cal-item={item.date}>
                            <Btn className={item.include === false ? 'chip' : 'chip on'} aria-pressed={item.include !== false} onClick={() => setItems((prev) => prev.map((row) => (row === item ? { ...row, include: row.include === false } : row)))}>
                                {item.include === false ? '빼 둠' : '✓ 넣기'}
                            </Btn>
                            {(item.warning || normalizeCalendarItem(item).error) && <p style={{ fontWeight: 800, margin: '8px 0 0' }}>{[item.warning, normalizeCalendarItem(item).error].filter(Boolean).join(' ')}</p>}
                            <input className="field" style={{ marginTop: 8 }} aria-label="제목" value={item.title} onChange={(event) => setItems((prev) => prev.map((row) => (row === item ? { ...row, title: event.target.value } : row)))} />
                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                                <input className="field" style={{ flex: '1 1 140px', minWidth: 0 }} aria-label="날짜" value={item.date || ''} onChange={(event) => setItems((prev) => prev.map((row) => (row === item ? { ...row, date: event.target.value } : row)))} />
                                <input className="field" style={{ flex: '1 1 88px', minWidth: 0 }} aria-label="시작 시각" placeholder="시작" value={item.time || ''} onChange={(event) => setItems((prev) => prev.map((row) => (row === item ? { ...row, time: event.target.value } : row)))} />
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
            <p className="muted" style={{ overflowWrap: 'anywhere' }}>{kind === 'meal' ? '저장하면 오늘·하루·한 주 화면에 그날 급식이 보입니다. 사진은 저장하지 않고 이 기기 안에서만 읽습니다.' : `읽은 글 ${source.trim().split('\n').length}줄`}</p>
        </div>
    );
}
