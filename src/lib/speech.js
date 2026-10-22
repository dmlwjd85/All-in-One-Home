/** 말로 적기. 음성 원본은 어디에도 저장하지 않고, 글만 입력칸에 붙입니다. */

export const SPEECH_NOTICE_KEY = 'ssug-gyomu-speech-notice';
export const SPEECH_UNSUPPORTED_MESSAGE = '이 브라우저에서는 말로 적기를 쓸 수 없어요.';
export const SPEECH_INAPP_MESSAGE = '앱 안에서는 말로 적기를 쓸 수 없어요. 외부 브라우저로 열어 주세요.';
export const CHROME_SPEECH_NOTICE = '크롬은 말한 내용을 구글 서버로 전송해요. 음성은 저장하지 않아요.';
export const SPEECH_LISTENING_MESSAGE = '듣는 중이에요. 다시 누르면 멈춰요.';

const IN_APP_PATTERNS = [
    /KAKAOTALK/i,
    /KAKAOSTORY/i,
    /NAVER\(inapp/i,
    /Instagram/i,
    /FBAN|FBAV|FB_IAB|FB4A/i,
    /\bLine\//i,
    /DaumApps/i,
    /everytimeApp/i,
    /\bBAND\//i,
    /MicroMessenger/i,
];

const GOOGLE_SPEECH_BLOCK = /Edg\/|EdgA\/|EdgiOS\/|OPR\/|Opera|SamsungBrowser|Whale|CriOS\//i;

export function isInAppBrowser(userAgent = '') {
    const text = String(userAgent || '');
    return IN_APP_PATTERNS.some((pattern) => pattern.test(text));
}

/** 데스크톱·안드로이드 크롬만 구글 서버로 음성을 보냅니다. */
export function usesGoogleSpeech(userAgent = '') {
    const text = String(userAgent || '');
    if (!text || GOOGLE_SPEECH_BLOCK.test(text)) return false;
    return /Chrome\//.test(text);
}

export function hasSpeechRecognition(scope) {
    if (!scope) return false;
    return typeof scope.SpeechRecognition === 'function' || typeof scope.webkitSpeechRecognition === 'function';
}

export function speechRecognitionCtor(scope) {
    if (!scope) return null;
    const ctor = scope.SpeechRecognition || scope.webkitSpeechRecognition;
    return typeof ctor === 'function' ? ctor : null;
}

export function describeSpeechSupport({ userAgent = '', hasRecognition = false } = {}) {
    if (isInAppBrowser(userAgent)) {
        return {
            available: false,
            inApp: true,
            google: false,
            message: SPEECH_INAPP_MESSAGE,
        };
    }
    if (!hasRecognition) {
        return {
            available: false,
            inApp: false,
            google: false,
            message: SPEECH_UNSUPPORTED_MESSAGE,
        };
    }
    return {
        available: true,
        inApp: false,
        google: usesGoogleSpeech(userAgent),
        message: '',
    };
}

export function speechSupportFromWindow(win) {
    const scope = win || {};
    return describeSpeechSupport({
        userAgent: scope.navigator?.userAgent || '',
        hasRecognition: hasSpeechRecognition(scope),
    });
}

export function readNoticeSeen(storage) {
    try {
        return storage?.getItem?.(SPEECH_NOTICE_KEY) === '1';
    } catch {
        return false;
    }
}

export function writeNoticeSeen(storage) {
    try {
        storage?.setItem?.(SPEECH_NOTICE_KEY, '1');
        return true;
    } catch {
        return false;
    }
}

export function transcriptFromResults(results) {
    if (!results || typeof results.length !== 'number') return '';
    let text = '';
    for (let i = 0; i < results.length; i += 1) {
        const row = results[i];
        if (!row) continue;
        if (typeof row === 'string') {
            text += row;
            continue;
        }
        text += row[0]?.transcript ?? row.transcript ?? '';
    }
    return text;
}

/** 이번 세션의 받아쓰기 전체를 기존 글 뒤에 붙입니다. 중간 결과는 같은 자리에 다시 씁니다. */
export function appendSpeech(existing, spoken) {
    const left = String(existing ?? '');
    const right = String(spoken ?? '').replace(/^\s+/, '').replace(/\s+$/, '');
    if (!right) return left;
    if (!left) return right;
    if (/\s$/.test(left)) return `${left}${right}`;
    return `${left} ${right}`;
}

export function dictationText(base, results) {
    return appendSpeech(base, transcriptFromResults(results));
}

const SPEECH_ERRORS = {
    'not-allowed': '마이크 권한을 거부했어요. 주소창에서 마이크를 허용해 주세요.',
    'service-not-allowed': '이 브라우저에서 받아쓰기를 막았어요.',
    'audio-capture': '마이크를 찾지 못했어요. 연결을 확인해 주세요.',
    network: '네트워크 오류로 받아쓰기를 멈췄어요.',
    'no-speech': '소리가 없어 받아쓰기를 멈췄어요.',
    aborted: '',
    'language-not-supported': '한국어 받아쓰기를 쓸 수 없어요.',
};

export function speechErrorMessage(code) {
    if (Object.prototype.hasOwnProperty.call(SPEECH_ERRORS, code)) return SPEECH_ERRORS[code];
    return '받아쓰기를 멈추었어요. 다시 눌러 주세요.';
}

export function createRecognizer(Ctor, handlers = {}) {
    const recognition = new Ctor();
    recognition.lang = 'ko-KR';
    recognition.interimResults = true;
    recognition.continuous = true;
    recognition.onresult = (event) => {
        handlers.onTranscript?.(transcriptFromResults(event?.results));
    };
    recognition.onerror = (event) => {
        handlers.onError?.(event?.error || '');
    };
    recognition.onend = () => {
        handlers.onEnd?.();
    };
    return recognition;
}
