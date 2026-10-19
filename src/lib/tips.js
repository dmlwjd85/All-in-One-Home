/** 구석 팁. 하루에 하나, 8초 뒤 접힘, 같은 팁을 두 번 닫으면 다시 안 봅니다. */
export const TIPS = [
    { id: 'attend-tap', text: '출결은 안 온 친구만 누르면 끝이에요.' },
    { id: 'attend-hold', text: '출결 칸을 길게 누르면 사유를 적을 수 있어요.' },
    { id: 'at-number', text: '@12처럼 번호를 붙이면 그 친구 기록으로 바로 들어가요.' },
    { id: 'hash-tag', text: '#교우처럼 태그를 달면 나중에 모아 보기 쉬워요.' },
    { id: 'date-words', text: "'내일', '10/22'라고 쓰면 그날 일정으로 알아서 넣어 둘게요." },
    { id: 'follow', text: '상담 기록에 다시 볼 날을 달아 두면, 그날 할 일에 올려 드려요.' },
    { id: 'neis', text: "관찰 기록은 '나이스에 옮길 것'이 켜져 있어요. 학기 말에 한 번에 모아 볼 수 있어요." },
    { id: 'mic', text: '휴대폰 자판의 마이크로 말해도 그대로 적혀요.' },
    { id: 'lock', text: '건강·민원 같은 내용은 이 기기에만 남고, 클라우드로 가지 않아요.' },
    { id: 'notice', text: '알림장은 복사 한 번이면 다른 앱에 그대로 붙어요.' },
    { id: 'special', text: '전담 시간은 상담 일정 잡기 좋은 시간이에요.' },
    { id: 'slash', text: '컴퓨터에서는 어디서든 / 키를 누르면 바로 적을 수 있어요.' },
    { id: 'offline', text: '인터넷이 끊겨도 괜찮아요. 연결되면 알아서 올려요.' },
    { id: 'shared', text: "교실 공용 컴퓨터라면 설정에서 '공용 컴퓨터 모드'를 켜 주세요." },
    { id: 'install', text: '홈 화면에 추가하면 앱처럼 바로 열려요.' },
    { id: 'dark', text: '밤에는 오른쪽 위 달을 눌러 보세요. 눈이 편해요.' },
    { id: 'walk', text: "걷을 게 있으면 할 일에 '걷기'를 켜 보세요. 안 낸 친구만 남아요." },
    { id: 'backup', text: '설정에서 기록을 백업 파일 하나로 통째로 내려받을 수 있어요.' },
    { id: 'undo', text: '저장하고 5초 안에는 되돌리기로 없던 일로 할 수 있어요.' },
    { id: 'legacy', text: '예전 교무수첩 기록은 원본 그대로 이 기기에 남아 있어요.' },
];

export function tipForToday(ymd, state = {}) {
    const hidden = new Set(state.hidden || []);
    const order = TIPS.filter((tip) => !hidden.has(tip.id));
    if (!order.length) return null;
    if (state.snooze === ymd) return null;
    const seed = Number(String(ymd).replaceAll('-', '')) || 0;
    const start = seed % order.length;
    const seen = new Set(state.seen || []);
    for (let i = 0; i < order.length; i += 1) {
        const tip = order[(start + i) % order.length];
        if (!seen.has(tip.id)) return tip;
    }
    return order[start];
}

export function nextTipState(state, action, ymd) {
    const base = {
        hidden: [...(state?.hidden || [])],
        seen: [...(state?.seen || [])],
        closes: { ...(state?.closes || {}) },
        snooze: state?.snooze || '',
    };
    if (action === 'seen' && action) return base;
    return base;
}

export function closeTip(state, id, ymd) {
    const closes = { ...(state?.closes || {}) };
    closes[id] = (closes[id] || 0) + 1;
    const hidden = new Set(state?.hidden || []);
    if (closes[id] >= 2) hidden.add(id);
    const seen = new Set(state?.seen || []);
    seen.add(id);
    return {
        hidden: [...hidden],
        seen: [...seen],
        closes,
        snooze: ymd,
    };
}

export function markTipSeen(state, id) {
    const seen = new Set(state?.seen || []);
    seen.add(id);
    return {
        hidden: [...(state?.hidden || [])],
        seen: [...seen],
        closes: { ...(state?.closes || {}) },
        snooze: state?.snooze || '',
    };
}
