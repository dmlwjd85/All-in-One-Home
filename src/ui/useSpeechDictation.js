import { useEffect, useMemo, useRef, useState } from 'react';
import { setKeyMuted } from './keyfeel.js';
import {
    CHROME_SPEECH_NOTICE,
    SPEECH_LISTENING_MESSAGE,
    appendSpeech,
    createRecognizer,
    readNoticeSeen,
    speechErrorMessage,
    speechRecognitionCtor,
    speechSupportFromWindow,
    writeNoticeSeen,
} from '../lib/speech.js';

function browserStorage() {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}

export function useSpeechDictation(raw, setRaw) {
    const support = useMemo(() => speechSupportFromWindow(typeof window === 'undefined' ? undefined : window), []);
    const [listening, setListening] = useState(false);
    const [note, setNote] = useState(support.message);
    const [needConfirm, setNeedConfirm] = useState(false);
    const rawRef = useRef(raw);
    const baseRef = useRef('');
    const sessionRef = useRef(0);
    const listeningRef = useRef(false);
    const recognitionRef = useRef(null);
    const noticeOkRef = useRef(false);
    rawRef.current = raw;

    useEffect(() => {
        setKeyMuted(listening);
        return () => setKeyMuted(false);
    }, [listening]);

    function dropRecognizer() {
        const rec = recognitionRef.current;
        recognitionRef.current = null;
        try {
            rec?.abort();
        } catch {
            /* 이미 끝난 세션입니다. */
        }
    }

    function stop() {
        sessionRef.current += 1;
        listeningRef.current = false;
        setListening(false);
        setNeedConfirm(false);
        setNote(support.message);
        dropRecognizer();
    }

    function begin() {
        const Ctor = speechRecognitionCtor(window);
        if (!Ctor) {
            setNote(support.message || '이 브라우저에서는 말로 적기를 쓸 수 없어요.');
            return;
        }
        const session = sessionRef.current + 1;
        sessionRef.current = session;
        dropRecognizer();
        baseRef.current = rawRef.current;
        let recognition;
        try {
            recognition = createRecognizer(Ctor, {
                onTranscript(spoken) {
                    if (sessionRef.current !== session) return;
                    setRaw(appendSpeech(baseRef.current, spoken));
                },
                onError(code) {
                    if (sessionRef.current !== session) return;
                    const message = speechErrorMessage(code);
                    if (message) setNote(message);
                    listeningRef.current = false;
                    setListening(false);
                },
                onEnd() {
                    if (sessionRef.current !== session) return;
                    listeningRef.current = false;
                    setListening(false);
                    setNote((current) => (current === SPEECH_LISTENING_MESSAGE ? support.message : current));
                },
            });
        } catch {
            setNote('받아쓰기를 시작하지 못했어요. 다시 눌러 주세요.');
            return;
        }
        recognitionRef.current = recognition;
        listeningRef.current = true;
        setListening(true);
        setNeedConfirm(false);
        setNote(SPEECH_LISTENING_MESSAGE);
        try {
            recognition.start();
        } catch {
            if (sessionRef.current === session) {
                listeningRef.current = false;
                setListening(false);
                setNote('받아쓰기를 시작하지 못했어요. 다시 눌러 주세요.');
            }
            recognitionRef.current = null;
        }
    }

    function toggle() {
        if (!support.available) return;
        if (listeningRef.current) {
            stop();
            return;
        }
        const seen = noticeOkRef.current || readNoticeSeen(browserStorage());
        if (support.google && !seen) {
            setNeedConfirm(true);
            setNote(CHROME_SPEECH_NOTICE);
            return;
        }
        begin();
    }

    function confirm() {
        noticeOkRef.current = true;
        writeNoticeSeen(browserStorage());
        setNeedConfirm(false);
        begin();
    }

    function onEdit(value) {
        rawRef.current = value;
        setRaw(value);
        if (!listeningRef.current) return;
        stop();
    }

    useEffect(() => () => {
        sessionRef.current += 1;
        listeningRef.current = false;
        try {
            recognitionRef.current?.abort();
        } catch {
            /* 시트가 닫힐 때 이미 없을 수 있습니다. */
        }
        recognitionRef.current = null;
    }, []);

    return {
        available: support.available,
        listening,
        note,
        needConfirm,
        toggle,
        confirm,
        onEdit,
        stop,
    };
}
