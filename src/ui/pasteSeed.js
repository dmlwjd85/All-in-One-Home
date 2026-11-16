/** 빠른 입력에서 여러 일정을 표 확인 화면으로 넘길 때 잠깐 들고 있는 글. 저장소에는 쓰지 않습니다. */
let seed = '';

export function setPasteSeed(text) {
    seed = String(text || '');
}

export function takePasteSeed() {
    const text = seed;
    seed = '';
    return text;
}
