/** 키보드 테마 목록과 테마 소리 파일. 모양(kbtheme.js)과 소리(keyfeel.js)가 같은 목록을 씁니다.
    소리 파일은 public/sounds/kb/ 에 있고, 고를 때 처음 한 번만 받아 옵니다. 출처는 docs/keyboard-themes.md */
export const KB_THEMES = [
    { id: 'mx', label: 'MX 미니', hint: '기본', down: 4, up: 2 },
    { id: 'retro', label: '기계식 레트로', hint: '도톰한 키', down: 3, up: 2 },
    { id: 'slim', label: '노트북 슬림', hint: '얕은 키', down: 3, up: 2 },
    { id: 'puff', label: '파스텔 마시멜로', hint: '말랑한 키', down: 3, up: 2 },
    { id: 'jelly', label: '젤리 투명 키', hint: '맑은 키', down: 3, up: 1 },
    { id: 'type', label: '타자기', hint: '둥근 키', down: 2, up: 1 },
];

export const DEFAULT_KB_THEME = 'mx';
export const KB_VOICE_PREFIX = 'kb-';

export function normalizeKbTheme(id) {
    return KB_THEMES.some((item) => item.id === id) ? id : DEFAULT_KB_THEME;
}

/** 소리 목록에 들어가는 테마 소리. 고르는 값은 kb-테마 입니다. */
export const KB_VOICES = KB_THEMES.map((item) => ({ id: `${KB_VOICE_PREFIX}${item.id}`, label: item.label, hint: '테마 소리', theme: item.id }));

export function isKbVoice(id) {
    return KB_VOICES.some((item) => item.id === id);
}

export function kbVoiceTheme(id) {
    return KB_VOICES.find((item) => item.id === id)?.theme || null;
}

/** 테마 소리 파일 이름. 누름 d0…, 뗌 u0… */
export function kbSoundFiles(theme) {
    const item = KB_THEMES.find((row) => row.id === theme);
    if (!item) return { down: [], up: [] };
    const list = (part, count) => Array.from({ length: count }, (_, index) => `sounds/kb/${item.id}-${part}${index}.wav`);
    return { down: list('d', item.down), up: list('u', item.up) };
}
