/** 단축키. 기본은 예전과 같이 / 키가 콕을 엽니다. 나머지는 비어 있고, ? 는 목록입니다.
    값은 이 기기에만 둡니다. Ctrl·Command·Alt 조합은 브라우저 몫이라 받지 않습니다. */

const STORAGE_KEY = 'ssug-gyomu-hotkeys';

export const HOTKEY_ACTIONS = [
    { id: 'plus', label: '콕 열기', group: '동작', fallback: '/' },
    { id: 'help', label: '단축키 목록', group: '동작', fallback: '?' },
    { id: 'search', label: '찾기', group: '동작', fallback: '' },
    { id: 'today', label: '오늘', group: '이동', fallback: '' },
    { id: 'attend', label: '출결', group: '이동', fallback: '' },
    { id: 'students', label: '학생 기록', group: '이동', fallback: '' },
    { id: 'schedule', label: '일정·시간표', group: '이동', fallback: '' },
    { id: 'todo', label: '할 일·메모', group: '이동', fallback: '' },
    { id: 'notice', label: '알림장', group: '이동', fallback: '' },
    { id: 'neis', label: '나이스 모아 보기', group: '이동', fallback: '' },
    { id: 'settings', label: '설정', group: '이동', fallback: '' },
    { id: 'quick:상담', label: '상담 적기', group: '자주 쓰는 일', fallback: '' },
    { id: 'quick:할 일', label: '할 일 적기', group: '자주 쓰는 일', fallback: '' },
    { id: 'quick:일정', label: '일정 적기', group: '자주 쓰는 일', fallback: '' },
    { id: 'message', label: '메시지 붙여넣기', group: '자주 쓰는 일', fallback: '' },
    { id: 'minutes', label: '회의록 적기', group: '자주 쓰는 일', fallback: '' },
];

const LABELS = {
    ArrowUp: '위',
    ArrowDown: '아래',
    ArrowLeft: '왼쪽',
    ArrowRight: '오른쪽',
};

function liveStorage() {
    try {
        if (typeof localStorage === 'undefined') return null;
        return localStorage;
    } catch {
        return null;
    }
}

function readStore(storage) {
    return storage || liveStorage();
}

function dedupeHotkeys(map, explicit) {
    const next = {};
    const owner = new Map();
    for (const action of HOTKEY_ACTIONS) {
        const key = typeof map?.[action.id] === 'string' ? map[action.id] : '';
        next[action.id] = key;
        if (!key) continue;
        if (!owner.has(key)) {
            owner.set(key, action.id);
            continue;
        }
        const prev = owner.get(key);
        if (explicit?.has(action.id) && !explicit?.has(prev)) {
            next[prev] = '';
            owner.set(key, action.id);
        } else {
            next[action.id] = '';
        }
    }
    return next;
}

export function defaultHotkeys() {
    const map = {};
    for (const action of HOTKEY_ACTIONS) map[action.id] = action.fallback;
    return dedupeHotkeys(map);
}

export function isStoredHotkey(value) {
    if (value === '') return true;
    if (typeof value !== 'string') return false;
    if (value.length === 1) return value !== ' ' && value !== '\n' && value !== '\t';
    if (/^Arrow(Up|Down|Left|Right)$/.test(value)) return true;
    if (/^F(?:2|4|8|9)$/.test(value)) return true;
    return false;
}

export function loadHotkeys(storage) {
    const base = defaultHotkeys();
    let saved = null;
    try {
        const raw = readStore(storage)?.getItem?.(STORAGE_KEY);
        if (raw) saved = JSON.parse(raw);
    } catch {
        saved = null;
    }
    if (!saved || typeof saved !== 'object') return base;
    const explicit = new Set();
    for (const action of HOTKEY_ACTIONS) {
        if (Object.prototype.hasOwnProperty.call(saved, action.id) && isStoredHotkey(saved[action.id])) {
            base[action.id] = saved[action.id];
            explicit.add(action.id);
        }
    }
    return dedupeHotkeys(base, explicit);
}

function notifyHotkeys() {
    try {
        if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
            window.dispatchEvent(new Event('ssug-gyomu-hotkeys-changed'));
        }
    } catch { /* 창이 없는 시험에서는 저장만 확인합니다. */ }
}

export function saveHotkeys(map, storage) {
    const out = {};
    for (const action of HOTKEY_ACTIONS) {
        const value = map?.[action.id];
        out[action.id] = isStoredHotkey(value) ? value : '';
    }
    try {
        readStore(storage)?.setItem?.(STORAGE_KEY, JSON.stringify(out));
        notifyHotkeys();
        return true;
    } catch {
        return false;
    }
}

export function resetHotkeys(storage) {
    try { readStore(storage)?.removeItem?.(STORAGE_KEY); } catch { /* 지워지지 않아도 화면은 기본으로 돌립니다. */ }
    notifyHotkeys();
    return defaultHotkeys();
}

/** 사이드바 안내. 저장된 콕 키를 따르고, 키가 없으면 기본 빗금을 말하지 않습니다. */
export function kokHotkeyHint(map = loadHotkeys()) {
    const key = map?.plus || '';
    if (!key) return '콕 여는 키는 아직 없어요. 설정에서 정해 주시면 돼요.';
    if (key === '/') return '기본으로 / 키를 누르면 콕이 열려요. 설정에서 바꿀 수 있어요.';
    return `${hotkeyLabel(key)} 키를 누르면 콕이 열려요. 설정에서 바꿀 수 있어요.`;
}

/** 단축키 설정 아래 안내. 목록 키와 콕 키 모두 지금 저장된 값을 말합니다. */
export function hotkeyFootnote(map = loadHotkeys()) {
    const help = map?.help || '';
    const plus = map?.plus || '';
    const helpText = help ? `${hotkeyLabel(help)} 키` : '';
    const plusText = plus ? `${hotkeyLabel(plus)} 키` : '';
    if (!plus && !help) return '콕과 목록 키는 아직 없어요. 위에서 정해 주시면 돼요.';
    if (!plus) return `목록은 ${helpText}로도 볼 수 있어요. 콕 여는 키는 아직 없어요.`;
    if (!help) return `콕은 ${plusText}로 열려요. 목록 키는 아직 없어요.`;
    if (plus === '/' && help === '?') return '목록은 ? 키로도 볼 수 있어요. 기본으로는 / 키가 콕을 엽니다.';
    return `목록은 ${helpText}로도 볼 수 있어요. 콕은 ${plusText}로 열려요.`;
}

/** 키보드가 없는 화면. 휴대폰에서 열릴 키도 저장된 값을 따릅니다. */
export function hotkeyPhoneNote(map = loadHotkeys()) {
    const plus = map?.plus || '';
    if (!plus) return '키보드가 있을 때 쓸 수 있어요. 컴퓨터에서는 여기서 키를 정하고, 휴대폰에서는 콕 여는 키가 아직 없어요.';
    if (plus === '/') return '키보드가 있을 때 쓸 수 있어요. 컴퓨터에서는 여기서 키를 정하고, 휴대폰에서는 기본으로 / 키가 콕을 엽니다.';
    return `키보드가 있을 때 쓸 수 있어요. 컴퓨터에서는 여기서 키를 정하고, 휴대폰에서는 ${hotkeyLabel(plus)} 키가 콕을 엽니다.`;
}

export function assignHotkey(map, id, key) {
    const next = { ...defaultHotkeys(), ...map, [id]: key };
    let movedFrom = '';
    if (key) {
        for (const action of HOTKEY_ACTIONS) {
            if (action.id !== id && next[action.id] === key) {
                next[action.id] = '';
                movedFrom = action.label;
            }
        }
    }
    return { map: next, movedFrom };
}

export function hotkeyLabel(key) {
    if (!key) return '없음';
    if (LABELS[key]) return LABELS[key];
    if (/^[a-z]$/.test(key)) return key.toUpperCase();
    return key;
}

/** 브라우저가 먼저 가져가는 기능키. 찾기, 주소창, 새로고침, 전체화면 같은 키입니다. */
const BROWSER_FN = new Set(['F1', 'F3', 'F5', 'F6', 'F7', 'F10', 'F11', 'F12']);

export function browserFunctionKey(event) {
    return BROWSER_FN.has(event?.key);
}

/** 키를 기다리는 칸에서도 Tab과 Shift+Tab, 수정 키 단독은 그대로 둡니다. */
export function passesThroughCapture(event) {
    if (!event) return false;
    if (event.key === 'Tab') return true;
    return event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta';
}

export function hotkeyFromEvent(event) {
    if (!event || event.ctrlKey || event.metaKey || event.altKey) return '';
    if (event.isComposing || event.key === 'Process' || event.key === 'Unidentified' || event.key === 'Dead') return '';
    const key = event.key;
    if (!key) return '';
    if (['Shift', 'Control', 'Alt', 'Meta', 'CapsLock', 'NumLock', 'ScrollLock', 'Escape', 'Tab', 'Enter', ' '].includes(key)) return '';
    if (key === 'Backspace' || key === 'Delete') return '';
    if (browserFunctionKey(event)) return '';
    if (/^[a-zA-Z]$/.test(key)) return key.toLowerCase();
    if (key.length === 1) return key;
    if (/^Arrow(Up|Down|Left|Right)$/.test(key)) return key;
    if (/^F(?:2|4|8|9)$/.test(key)) return key;
    return '';
}

export function browserCombo(event) {
    return Boolean(event && (event.ctrlKey || event.metaKey || event.altKey) && event.key && !['Control', 'Meta', 'Alt', 'Shift'].includes(event.key));
}

export function clearsHotkey(event) {
    const key = event?.key;
    return key === 'Backspace' || key === 'Delete';
}

function typingElement(el) {
    if (!el || !el.tagName) return false;
    if (el.isContentEditable) return true;
    const tag = String(el.tagName).toUpperCase();
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag !== 'INPUT') return false;
    const type = String((typeof el.getAttribute === 'function' ? el.getAttribute('type') : el.type) || 'text').toLowerCase();
    return ['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number'].includes(type);
}

/** 글자 칸과 한글 조합 중에는 단축키를 쉬게 합니다. */
export function shortcutBlocked(event) {
    if (!event || event.repeat) return true;
    if (event.isComposing || event.key === 'Process' || event.keyCode === 229) return true;
    const target = event.target;
    if (target && typeof target.closest === 'function' && target.closest('[data-hotkey-capture]')) return true;
    if (typingElement(target)) return true;
    return false;
}

export function matchHotkey(event, map = loadHotkeys()) {
    if (shortcutBlocked(event)) return '';
    const key = hotkeyFromEvent(event);
    if (!key) return '';
    for (const action of HOTKEY_ACTIONS) {
        if (map?.[action.id] === key) return action.id;
    }
    return '';
}

export function hotkeysAvailable() {
    if (typeof window === 'undefined') return true;
    try {
        if (typeof window.matchMedia === 'function' && window.matchMedia('(any-pointer: fine), (hover: hover)').matches) return true;
    } catch { /* 미디어를 못 물으면 너비로 가릅니다. */ }
    // 마우스가 없다고 나오는 브라우저라도, 넓고 긴 화면이면 키보드가 있는 쪽으로 봅니다.
    const width = window.innerWidth || 0;
    const height = window.innerHeight || 0;
    return width >= 900 && height >= 700;
}
