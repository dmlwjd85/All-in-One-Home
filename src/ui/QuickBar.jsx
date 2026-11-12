import { useEffect, useRef, useState } from 'react';
import { saveQuick } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Btn } from './bits.jsx';
import { playSealBurst } from './sealBurst.js';
import { quickDateLabel, textFromField } from './quickText.js';
import { MINUTES_TITLE_MAX, readMinutesDraft, writeMinutesDraft } from '../lib/minutes.js';
import { alarmTimeLabel, readJjaemPaste } from '../lib/jjaemPaste.js';
import { phraseAskText, resolveTimePhrase } from '../lib/timePhrase.js';
import { timeContext } from './timeContext.js';
import { chipSave, readEventChips } from '../lib/dateChips.js';
import { allStarts } from '../lib/periodLocal.js';
import { LiveEventChips } from './LiveEventChips.jsx';
import { findStudentNames, whyLabel } from '../lib/nameLink.js';
import {
    SPEECH_CLOUD,
    SPEECH_FALLBACK,
    SPEECH_LOCAL,
    SUGGEST_WAIT,
    linkedNosFor,
    nameCandidates,
    quickSaveDate,
    suggestKind,
} from './quickMatch.js';

const CHIPS = ['일정', '할 일', '관찰', '메모'];
/** '회의'는 저장하지 않고 회의록 화면을 엽니다. 적던 글은 회의 제목이 됩니다. */
const MEET_CHIP = '회의';
const SPEECH_NOTE = 'ssug-gyomu-speech-notice';
/** 저장이 안 됐을 때. 적던 글은 입력칸에 되돌려 둡니다. */
const KEPT_NOTE = '적던 글은 쨈 버튼을 다시 누르면 그대로 있어요.';
/** 학생과 이어지는 분류. 이때만 연결한 학생을 기록에 붙입니다. */
const RECORD_KINDS = ['관찰', '상담', '칭찬', '보호자'];

export function QuickBar({ open, invite, inputRef, dateYmd, onClose }) {
    const { showToast, data, openPlus, go } = useUi();
    const students = data?.students || [];
    const barRef = useRef(null);
    const lastKind = useRef('메모');
    const composing = useRef(null);
    const savedAt = useRef(0);
    const picked = useRef(null);
    const hearing = useRef(null);
    const localSpeech = useRef(false);
    const [live, setLive] = useState('');
    const [hint, setHint] = useState('');
    const [listening, setListening] = useState(false);
    /* 시간구('퇴근 전까지' 등)를 설정으로 못 정했거나 이미 지났을 때 띄우는 노란 확인 카드. */
    const [ask, setAsk] = useState(null);
    const [chipOff, setChipOff] = useState([]);
    const [ampmFlip, setAmpmFlip] = useState([]);
    /* 본문 속 이름 칩을 눌러 정한 연결. { [학생 id]: true(연결) | false(해제) }. 누르지 않은 칩은 자동 규칙을 따릅니다. */
    const [linkChoice, setLinkChoice] = useState({});

    useEffect(() => {
        const node = barRef.current;
        const view = window.visualViewport;
        if (!node || !view) return undefined;
        const place = () => {
            const lift = Math.max(0, window.innerHeight - view.height - view.offsetTop);
            const value = `${Math.round(lift)}px`;
            node.style.setProperty('--quick-lift', value);
            document.documentElement.style.setProperty('--quick-lift', value);
        };
        place();
        view.addEventListener('resize', place);
        view.addEventListener('scroll', place);
        return () => {
            view.removeEventListener('resize', place);
            view.removeEventListener('scroll', place);
            document.documentElement.style.removeProperty('--quick-lift');
        };
    }, []);

    useEffect(() => {
        if (!String(live || '').trim()) {
            setHint('');
            setChipOff([]);
            setAmpmFlip([]);
            setLinkChoice({});
            return undefined;
        }
        const timer = setTimeout(() => setHint(suggestKind(live, students)), SUGGEST_WAIT);
        return () => clearTimeout(timer);
    }, [live, students]);

    useEffect(() => {
        if (!open) return undefined;
        const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Ctor || typeof Ctor.available !== 'function') return undefined;
        let cancel = false;
        /* 브라우저마다 available 이 없거나, 던지거나, 약속(Promise)이 아닌 값을 돌려줍니다. 어느 쪽이든 팝업은 그대로 엽니다. */
        try {
            const asked = Ctor.available({ langs: ['ko-KR'], processLocally: true });
            Promise.resolve(asked).then((status) => {
                if (!cancel) localSpeech.current = status === 'available';
            }).catch(() => {});
        } catch {
            localSpeech.current = false;
        }
        return () => { cancel = true; };
    }, [open]);

    useEffect(() => () => {
        try { hearing.current?.abort(); } catch { /* 이미 끝났습니다. */ }
    }, []);

    /* 창을 닫으면 노란 확인 카드도 접습니다. 적던 글은 그대로 남습니다. */
    useEffect(() => { if (!open) setAsk(null); }, [open]);

    function readText() {
        return textFromField(inputRef.current, composing.current).trim();
    }

    function publishLive() {
        setLive(textFromField(inputRef.current, composing.current));
        setAsk(null);
    }

    /**
     * 할 일·일정에서 시간구를 시각으로 바꿉니다. 시계 시각('3시')이 적혀 있으면 그쪽이 이깁니다.
     * 돌려줌: null(시간구 없음) · { ask } (노란 카드로 확인) · { time, date, basis }.
     */
    function phraseFor(used, text) {
        if (used !== '할 일' && used !== '일정') return null;
        const now = new Date();
        const pre = readJjaemPaste(text, { now, stripTime: true, future: true });
        /* 날짜 칩을 뺐으면 글의 날짜 낱말이 아니라 고른 날을 기준으로 합니다(평점관 r4 P2-1). */
        const offDate = chipSave(readEventChips(text, { now, periods: allStarts(data?.profile?.periodStarts), off: chipOff, ampmFlip, future: true }), chipOff, dateYmd, ampmFlip);
        const baseDate = offDate?.dateOff ? offDate.date
            : (used === '일정' ? (pre.date || quickSaveDate(used, text, dateYmd, now)) : (pre.date || dateYmd));
        /* 「오전 12시」는 낮·밤이 갈려 노란 카드에서 고르게 합니다. */
        if (pre.ask === 'am12') {
            const min = pre.time.slice(3);
            return { ask: { missing: 'am12', word: pre.timeWord, date: baseDate, time: '', suggestTime: '', choices: [`12:${min}`, `00:${min}`] } };
        }
        if (pre.time) return null;
        let res = null;
        try { res = resolveTimePhrase(text, timeContext(data, now), { date: baseDate }); } catch { res = null; }
        if (!res) return null;
        if (res.missing || res.late) return { ask: res };
        return { time: res.time, date: res.date, basis: res.basis };
    }

    /** override: 노란 카드에서 고른 { time, date }. 그때는 다시 묻지 않습니다. */
    function save(kind, override) {
        const text = readText();
        if (!text) {
            showToast('한 줄만 적어도 남길 수 있어요.');
            return;
        }
        const usedKind = kind || lastKind.current || '메모';
        const phrase = override || phraseFor(usedKind, text);
        if (phrase?.ask) {
            lastKind.current = usedKind;
            setAsk({ kind: usedKind, res: phrase.ask });
            return;
        }
        setAsk(null);
        const bar = barRef.current;
        if (bar) {
            bar.classList.remove('is-open');
            bar.setAttribute('aria-hidden', 'true');
        }
        document.querySelectorAll('.seal-cup').forEach((cup) => playSealBurst(cup));
        const used = kind || lastKind.current || '메모';
        lastKind.current = used;
        const ahead = used === '할 일' || used === '일정';
        const now = new Date();
        const periods = allStarts(data?.profile?.periodStarts);
        const chip = readEventChips(text, { now, periods, off: chipOff, ampmFlip, future: ahead });
        /* saveQuick과 같은 규칙으로 날짜를 읽습니다. 「3일 동안」처럼 날짜가 아닌 말은 고른 날(dateYmd)을 그대로 씁니다. */
        const paste = readJjaemPaste(text, { now, stripTime: ahead, future: ahead, ampmFlip });
        /* 칩 = 저장값: 날짜 칩을 뺐으면 「내일」로 돌아가지 않고 고른 날(dateYmd)에 넣고, 제목은 칩 미리보기 그대로입니다. */
        const saved = ahead ? chipSave(chip, chipOff, dateYmd, ampmFlip) : null;
        const date = phrase?.date || saved?.date || (used === '일정'
            ? (paste.date || quickSaveDate(used, text, dateYmd, now))
            : (paste.date || dateYmd));
        const nos = RECORD_KINDS.includes(used) ? linkedNosFor(text, students, linkChoice, picked.current) : [];
        const pickedBefore = picked.current;
        const choiceBefore = linkChoice;
        if (inputRef.current) inputRef.current.value = '';
        composing.current = null;
        picked.current = null;
        setLive('');
        setHint('');
        setChipOff([]);
        setAmpmFlip([]);
        setLinkChoice({});
        try { hearing.current?.abort(); } catch { /* 이미 끝났습니다. */ }
        setListening(false);
        onClose();
        const body = { kind: used, text, date };
        /* 한 명이면 예전처럼 no, 둘 이상이면 nos로 넘겨 학생마다 기록을 하나씩 만듭니다. */
        if (nos.length) body.no = nos[0];
        if (nos.length > 1) body.nos = nos;
        if (used === '할 일') body.due = date;
        if (saved?.title) {
            body.title = saved.title;
            if (used === '일정' && saved.raw !== saved.title) body.raw = saved.raw;
        }
        /* 시간구로 정한 시각(빈 값이면 '시각 없이')을 넘깁니다. 노란 카드에서 고른 값도 여기로 옵니다. */
        if (phrase && typeof phrase.time === 'string') body.time = phrase.time;
        /* 그 밖에는 칩에 보이는 시각이 곧 저장값입니다(시안 A). 시각 칩을 눌러 뺐으면 시각 없이 넣습니다. */
        else if (ahead && chip.time) body.time = chip.time;
        else if (ahead && chip.timeOff) body.time = '';
        /* 저장이 안 되면 적던 글을 입력칸에 돌려 둡니다. 그 사이 새로 적은 글이 있으면 건드리지 않습니다. */
        const keepText = (message) => {
            const input = inputRef.current;
            if (input && !input.value) {
                input.value = text;
                picked.current = pickedBefore;
                setLinkChoice(choiceBefore);
                setLive(text);
            }
            showToast(`${message} ${KEPT_NOTE}`);
        };
        saveQuick(body, new Date()).then((result) => {
            if (!result?.ok) {
                keepText(result?.message || '저장하지 못했어요.');
                return;
            }
            let message = result.message;
            if (phrase?.basis && phrase.time) message = `${message} (${phrase.basis} 기준)`;
            if (used === '일정' && date !== dateYmd) {
                const label = quickDateLabel(date);
                if (label) message = message.replace('일정에 넣었어요.', `${label} 일정에 넣었어요.`);
            }
            showToast(message, true);
        }).catch(() => keepText('저장하지 못했어요.'));
    }

    /* 휴대폰에서 + 화면(메시지·회의록 붙여넣기)으로 가는 길. 빠른 입력을 닫고 더보기를 펼친 채 엽니다(쨈 → 붙여넣기 → 칸, 세 번). */
    function openPaste() {
        try { hearing.current?.abort(); } catch { /* 이미 끝났습니다. */ }
        setListening(false);
        onClose();
        openPlus?.({ more: true });
    }

    /* '회의': 저장하지 않고 회의록 화면을 엽니다. 적던 한 줄은 새 회의록의 제목(임시 저장)으로 옮깁니다. */
    function openMinutes() {
        const input = inputRef.current;
        const text = input ? textFromField(input, composing.current).trim() : '';
        if (text) {
            const prev = readMinutesDraft('new') || {};
            if (!String(prev.title || '').trim()) writeMinutesDraft('new', { ...prev, title: text.slice(0, MINUTES_TITLE_MAX) });
        }
        if (input) input.value = '';
        composing.current = null;
        picked.current = null;
        setLive('');
        setHint('');
        try { hearing.current?.abort(); } catch { /* 이미 끝났습니다. */ }
        setListening(false);
        onClose();
        go?.('#/minutes/new');
    }

    function saveChip(kind, event) {
        if (event?.type === 'click' && performance.now() - savedAt.current < 400) return;
        savedAt.current = performance.now();
        save(kind);
    }

    function pickStudent(student, event) {
        event.preventDefault();
        const input = inputRef.current;
        if (!input) return;
        const text = textFromField(input, composing.current);
        const next = /[가-힣ㄱ-ㅎㅏ-ㅣ]+$/.test(text)
            ? text.replace(/[가-힣ㄱ-ㅎㅏ-ㅣ]+$/, student.name)
            : `${text}${student.name}`;
        input.value = next;
        composing.current = null;
        picked.current = student;
        /* 후보에서 고른 학생은 바로 연결합니다(같은 이름이 둘이어도 고른 쪽만). */
        if (student.id) setLinkChoice((prev) => ({ ...prev, [student.id]: true }));
        setLive(next);
        input.focus();
    }

    /** 이름 칩 한 번 누르기: 연결 ↔ 해제. */
    function toggleLink(hit, on, event) {
        event?.preventDefault();
        setLinkChoice((prev) => ({ ...prev, [hit.sid]: !on }));
    }

    function onMic() {
        const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (!Ctor) {
            showToast(SPEECH_FALLBACK);
            return;
        }
        if (hearing.current) {
            try { hearing.current.abort(); } catch { /* 이미 끝났습니다. */ }
            hearing.current = null;
            setListening(false);
            return;
        }
        try {
            if (localStorage.getItem(SPEECH_NOTE) !== '1') {
                showToast(localSpeech.current ? SPEECH_LOCAL : SPEECH_CLOUD);
                localStorage.setItem(SPEECH_NOTE, '1');
            }
        } catch { /* 안내를 못 남겨도 듣기는 시작합니다. */ }
        const rec = new Ctor();
        rec.lang = 'ko-KR';
        rec.interimResults = true;
        rec.continuous = false;
        if (localSpeech.current && 'processLocally' in rec) rec.processLocally = true;
        const base = readText();
        rec.onresult = (event) => {
            let finalText = '';
            let interim = '';
            for (const result of event.results) {
                const said = result[0]?.transcript || '';
                if (result.isFinal) finalText += said;
                else interim += said;
            }
            const spoken = `${finalText}${interim}`.replace(/\s+/g, ' ').trim();
            const input = inputRef.current;
            if (!input || !spoken) return;
            input.value = base ? `${base} ${spoken}` : spoken;
            composing.current = null;
            setLive(input.value);
        };
        rec.onerror = (event) => {
            setListening(false);
            hearing.current = null;
            if (event?.error === 'not-allowed' || event?.error === 'service-not-allowed') {
                showToast('마이크를 허용하지 않으면 받아쓰기를 쓸 수 없어요. 키보드의 마이크 버튼도 있어요.');
            }
        };
        rec.onend = () => {
            if (hearing.current === rec) hearing.current = null;
            setListening(false);
        };
        try {
            rec.start();
        } catch {
            showToast(SPEECH_FALLBACK);
            return;
        }
        hearing.current = rec;
        setListening(true);
    }

    function onKeyDown(event) {
        if (event.key === 'Escape') {
            onClose();
            return;
        }
        if (event.key !== 'Enter' || event.shiftKey) return;
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        save(hint || lastKind.current || '메모');
    }

    const candidates = nameCandidates(live, students);
    /* 본문에 나온 학생(성 포함·성 뺀 이름·'하윤이가' 같은 호칭). 칩을 눌러 연결을 정합니다. */
    const linkHits = live.trim() ? findStudentNames(live, students) : [];
    for (const [sid, on] of Object.entries(linkChoice)) {
        if (on !== true || linkHits.some((hit) => hit.sid === sid)) continue;
        const row = students.find((item) => item.id === sid);
        if (row) linkHits.push({ sid, no: row.no, name: row.name, label: row.name, auto: false, why: '' });
    }
    const linkOn = (hit) => linkChoice[hit.sid] === true || (linkChoice[hit.sid] !== false && hit.auto);
    const periods = allStarts(data?.profile?.periodStarts);
    /* 칩은 엔터로 저장될 분류(추천 칩·지난번 분류)와 같은 규칙으로 읽습니다. 할 일·일정은 다가오는 날로 봅니다. */
    const liveKind = hint || lastKind.current || '메모';
    const chipRead = live.trim()
        ? readEventChips(live, { now: new Date(), periods, off: chipOff, ampmFlip, future: liveKind === '할 일' || liveKind === '일정' })
        : null;
    /* 칩을 건드리지 않은 할 일·일정은 저장(saveQuick)이 읽는 제목을 그대로 보여 줍니다. */
    const parsedTitle = chipRead && (liveKind === '할 일' || liveKind === '일정')
        ? (readJjaemPaste(live.trim(), { now: new Date(), stripTime: true, future: true }).body || live.trim()).replace(/\s+/g, ' ').trim()
        : null;

    return (
        <>
        <div
            className={`quick-scrim${open ? ' is-open' : ''}`}
            aria-hidden="true"
            data-quick-scrim="1"
            onClick={() => onClose()}
        />
        <form
            ref={barRef}
            className={`quick-bar${open ? ' is-open' : ''}${invite ? ' is-invite' : ''}`}
            data-quick="1"
            aria-hidden={open ? 'false' : 'true'}
            onSubmit={(event) => event.preventDefault()}
        >
            <div className="quick-head">
                <p className="quick-date">{quickDateLabel(dateYmd)}</p>
                <Btn
                    className="quick-paste"
                    tabIndex={open ? 0 : -1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={openPaste}
                >메시지·회의록 붙여넣기</Btn>
                <Btn
                    className="quick-close"
                    aria-label="쨈 빠른 입력 닫기"
                    tabIndex={open ? 0 : -1}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => onClose()}
                >✕</Btn>
            </div>
            {candidates.length > 0 && (
                <div className="quick-names" role="listbox" aria-label="이름 후보">
                    {candidates.map((student) => (
                        <Btn
                            key={student.id || student.no}
                            className="quick-name"
                            role="option"
                            onPointerDown={(event) => pickStudent(student, event)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={(event) => pickStudent(student, event)}
                        >{student.name}</Btn>
                    ))}
                </div>
            )}
            {linkHits.length > 0 && (
                <div className="quick-names quick-links" role="group" aria-label="연결할 학생" data-quick-links="1">
                    <span className="quick-links-label muted">연결</span>
                    {linkHits.map((hit) => {
                        const on = linkOn(hit);
                        const why = on ? '' : whyLabel(hit.why);
                        return (
                            <Btn
                                key={hit.sid}
                                className={on ? 'chip on quick-link' : 'chip quick-link'}
                                aria-pressed={on ? 'true' : 'false'}
                                aria-label={`${hit.label} ${on ? '연결됨, 누르면 해제' : '연결 안 됨, 누르면 연결'}${why ? ` (${why})` : ''}`}
                                data-link-sid={hit.sid}
                                data-link-auto={hit.auto ? '1' : '0'}
                                onPointerDown={(event) => event.preventDefault()}
                                onMouseDown={(event) => event.preventDefault()}
                                onClick={(event) => toggleLink(hit, on, event)}
                            >{on ? '✓ ' : '+ '}{hit.label}{why ? <span className="quick-link-why"> · {why}</span> : null}</Btn>
                        );
                    })}
                </div>
            )}
            <div className="quick-row">
                <input
                    ref={inputRef}
                    className="field quick-field"
                    aria-label="한 줄"
                    tabIndex={open ? 0 : -1}
                    placeholder={invite ? '한 번 누르면 키보드가 올라와요' : '한 줄만 적어도 돼요'}
                    enterKeyHint="done"
                    autoComplete="off"
                    onKeyDown={onKeyDown}
                    onInput={publishLive}
                    onCompositionStart={() => { composing.current = { data: '' }; }}
                    onCompositionUpdate={(event) => { composing.current = { data: event.data || '' }; publishLive(); }}
                    onCompositionEnd={() => { composing.current = null; publishLive(); }}
                />
                <Btn
                    className="quick-mic"
                    aria-label="말로 입력"
                    aria-pressed={listening ? 'true' : 'false'}
                    onClick={onMic}
                >{listening ? '듣는 중' : '마이크'}</Btn>
            </div>
            {ask && (
                <div className="quick-ask low-card" role="group" aria-label="시각 확인" data-quick-ask={ask.res.missing || 'late'}>
                    <p className="quick-ask-text">{phraseAskText(ask.res)}</p>
                    <div className="quick-ask-chips">
                        {(ask.res.choices || []).map((hm) => (
                            <Btn key={hm} className="chip" data-choice={hm} onMouseDown={(event) => event.preventDefault()} onClick={() => save(ask.kind, { time: hm, date: ask.res.date })}>
                                {hm.startsWith('12') ? '낮' : '밤'} 12시{hm.slice(3) === '00' ? '' : ` ${Number(hm.slice(3))}분`} 알림
                            </Btn>
                        ))}
                        {ask.res.suggestTime && (
                            <Btn className="chip" onMouseDown={(event) => event.preventDefault()} onClick={() => save(ask.kind, { time: ask.res.suggestTime, date: ask.res.date })}>
                                추천값으로 {alarmTimeLabel(ask.res.suggestTime)} 알림
                            </Btn>
                        )}
                        {ask.res.late && ask.res.time && (
                            <Btn className="chip" onMouseDown={(event) => event.preventDefault()} onClick={() => save(ask.kind, { time: ask.res.time, date: ask.res.date })}>
                                그래도 {alarmTimeLabel(ask.res.time)}
                            </Btn>
                        )}
                        <Btn className="chip" onMouseDown={(event) => event.preventDefault()} onClick={() => save(ask.kind, { time: '', date: ask.res.date })}>시각 없이 넣기</Btn>
                        {(ask.res.missing === 'workEnd' || ask.res.missing === 'workStart') && (
                            <Btn className="chip" onMouseDown={(event) => event.preventDefault()} onClick={() => { setAsk(null); onClose(); go?.('#/settings/calendar'); }}>설정에서 정하기</Btn>
                        )}
                    </div>
                </div>
            )}
            {chipRead ? (
                <LiveEventChips
                    title={parsedTitle}
                    chipRead={chipRead}
                    chipOff={chipOff}
                    ampmFlip={ampmFlip}
                    onToggleOff={(id) => setChipOff((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))}
                    onToggleAmpm={(id) => setAmpmFlip((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))}
                />
            ) : null}
            <div className="quick-chips" role="group" aria-label="분류">
                {CHIPS.map((kind) => (
                    <Btn
                        key={kind}
                        className={hint === kind ? 'quick-chip is-suggested' : 'quick-chip'}
                        data-kind={kind}
                        data-suggested={hint === kind ? '1' : '0'}
                        aria-label={hint === kind ? `${kind} 추천` : `${kind} 저장`}
                        onPointerDown={(event) => {
                            event.preventDefault();
                            saveChip(kind, event);
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => saveChip(kind, event)}
                    >{kind}</Btn>
                ))}
                <Btn
                    className="quick-chip quick-chip-meet"
                    data-kind={MEET_CHIP}
                    aria-label="회의록 작성"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={openMinutes}
                >회의록 작성</Btn>
            </div>
        </form>
        </>
    );
}
