/**
 * main(483e43c) src/ui/typesound.js 의 "어떤 입력에 글자 소리를 내는가" 판단을 그대로 얼려 둔 사본입니다. 고치지 마세요.
 * check-keyfeel 이 예전 소리(뽁·띵·물방울·방귀)의 울림 횟수가 main과 같은지 같은 이벤트 줄로 비교합니다.
 * 바뀐 곳은 두 군데뿐입니다: 켜짐 확인(typeSoundEnabled)을 빼고, 상태를 처음으로 되돌리는 resetMainTypeInput 을 더했습니다.
 */
const SAME_TURN_MS = 12;
let lastInputAt = -1000;

function attr(el, name) {
    if (!el) return '';
    try {
        if (typeof el.getAttribute === 'function') return el.getAttribute(name) || '';
    } catch {
        /* 가짜 요소는 속성 가방만 봅니다. */
    }
    const value = el[name];
    return value == null ? '' : String(value);
}

function hasAttr(el, name) {
    if (!el) return false;
    if (typeof el.hasAttribute === 'function') return el.hasAttribute(name);
    return Object.prototype.hasOwnProperty.call(el, name);
}

export function isTextControl(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable) return true;
    const tag = String(el.tagName).toUpperCase();
    if (tag === 'TEXTAREA') return true;
    if (tag !== 'INPUT') return false;
    const type = attr(el, 'type').toLowerCase();
    return ['', 'text', 'search', 'email', 'url', 'tel', 'number', 'password'].includes(type);
}

/** 비밀번호와 카드 번호처럼 소리로 길이가 드러나면 곤란한 칸. */
export function isSensitiveControl(el) {
    if (!el || !el.tagName) return false;
    const tag = String(el.tagName).toUpperCase();
    if (tag === 'INPUT') {
        const type = attr(el, 'type').toLowerCase();
        if (type === 'password' || type === 'hidden') return true;
    }
    if (hasAttr(el, 'data-sensitive')) return true;
    const blob = [
        attr(el, 'autocomplete'),
        attr(el, 'aria-label'),
        attr(el, 'name'),
        attr(el, 'placeholder'),
        attr(el, 'id'),
    ].join(' ');
    return /password|cc-number|cc-csc|current-password|new-password|one-time-code|\botp\b|비밀번호|암호|패스워드|인증/i.test(blob);
}

/** 조합이 끝난 뒤 브라우저가 같은 글자를 한 번 더 알려 주는 이벤트. 타수로 치지 않습니다. */
let skipCompositionEcho = false;

export function noteCompositionEnd() {
    skipCompositionEcho = true;
}

function compositionEcho(event) {
    const inputType = String(event?.inputType || '');
    if (inputType === 'insertFromComposition') {
        skipCompositionEcho = false;
        return true;
    }
    if (!skipCompositionEcho) return false;
    skipCompositionEcho = false;
    if (inputType === 'insertText' || event?.isComposing === true) return false;
    return true;
}

const SKIP_INPUT = new Set([
    'insertFromPaste',
    'insertFromDrop',
    'insertFromYank',
    'insertReplacementText',
    'insertFromPasteAsQuotation',
]);

export function shouldTypeSound(event) {
    const el = event?.target;
    if (!isTextControl(el) || isSensitiveControl(el)) return false;
    const inputType = String(event?.inputType || '');
    if (inputType.startsWith('delete') || inputType.startsWith('format') || inputType.startsWith('history')) return false;
    if (SKIP_INPUT.has(inputType)) return false;
    if (inputType && inputType !== 'insertText' && inputType !== 'insertCompositionText' && inputType !== 'insertFromComposition') return false;
    if (compositionEcho(event)) return false;
    return true;
}

/** 같은 순간 두 번 오는 조합 이벤트만 건너뜁니다. 다음 글자는 바로 울립니다. */
function mainNoteTypeInputRaw(event, now = (typeof performance !== 'undefined' ? performance.now() : Date.now())) {
    if (!shouldTypeSound(event)) return false;
    if (now - lastInputAt < SAME_TURN_MS) return false;
    lastInputAt = now;
    return true;
}

export function resetMainTypeInput() {
    lastInputAt = -1000;
    skipCompositionEcho = false;
}

export const mainNoteTypeInput = mainNoteTypeInputRaw;
export { noteCompositionEnd as mainNoteCompositionEnd };
