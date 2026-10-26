import { useEffect, useRef, useState } from 'react';
import { saveQuick } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Btn } from './bits.jsx';
import { playSealBurst } from './sealBurst.js';
import { quickDateLabel, textFromField } from './quickText.js';
import {
    SPEECH_CLOUD,
    SPEECH_FALLBACK,
    SPEECH_LOCAL,
    SUGGEST_WAIT,
    nameCandidates,
    quickSaveDate,
    studentNoFor,
    suggestKind,
} from './quickMatch.js';

const CHIPS = ['일정', '할 일', '관찰', '메모'];
const SPEECH_NOTE = 'ssug-gyomu-speech-notice';

export function QuickBar({ open, invite, inputRef, dateYmd, onClose }) {
    const { showToast, data } = useUi();
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
        Ctor.available({ langs: ['ko-KR'], processLocally: true }).then((status) => {
            if (!cancel) localSpeech.current = status === 'available';
        }).catch(() => {});
        return () => { cancel = true; };
    }, [open]);

    useEffect(() => () => {
        try { hearing.current?.abort(); } catch { /* 이미 끝났습니다. */ }
    }, []);

    function readText() {
        return textFromField(inputRef.current, composing.current).trim();
    }

    function publishLive() {
        setLive(textFromField(inputRef.current, composing.current));
    }

    function save(kind) {
        const text = readText();
        if (!text) {
            showToast('한 줄만 적어도 남길 수 있어요.');
            return;
        }
        const bar = barRef.current;
        if (bar) {
            bar.classList.remove('is-open');
            bar.setAttribute('aria-hidden', 'true');
        }
        document.querySelectorAll('.seal-cup').forEach((cup) => playSealBurst(cup));
        const used = kind || lastKind.current || '메모';
        lastKind.current = used;
        const date = quickSaveDate(used, text, dateYmd, new Date());
        const no = studentNoFor(text, students, picked.current);
        if (inputRef.current) inputRef.current.value = '';
        composing.current = null;
        picked.current = null;
        setLive('');
        setHint('');
        try { hearing.current?.abort(); } catch { /* 이미 끝났습니다. */ }
        setListening(false);
        onClose();
        const body = { kind: used, text, date };
        if (no) body.no = no;
        if (used === '할 일') body.due = date;
        saveQuick(body, new Date()).then((result) => {
            if (!result?.ok) {
                showToast(result?.message || '한 줄만 적어도 남길 수 있어요.');
                return;
            }
            let message = result.message;
            if (used === '일정' && date !== dateYmd) {
                const label = quickDateLabel(date);
                if (label) message = message.replace('일정에 넣었어요.', `${label} 일정에 넣었어요.`);
            }
            showToast(message, true);
        });
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
        setLive(next);
        input.focus();
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

    return (
        <form
            ref={barRef}
            className={`quick-bar${open ? ' is-open' : ''}${invite ? ' is-invite' : ''}`}
            data-quick="1"
            aria-hidden={open ? 'false' : 'true'}
            onSubmit={(event) => event.preventDefault()}
        >
            <p className="quick-date">{quickDateLabel(dateYmd)}</p>
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
            </div>
        </form>
    );
}
