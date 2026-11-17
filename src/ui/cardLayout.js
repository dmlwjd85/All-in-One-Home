/* 학생카드의 묶음. 순서와 접힘은 이 기기에만 기억합니다(모든 학생에게 같은 배치). */
export const CARD_SECTIONS = [
    { id: 'basic', title: '기본 정보' },
    { id: 'allergy', title: '알레르기' },
    { id: 'contacts', title: '보호자 연락처', local: true },
    { id: 'health', title: '건강·특이사항', local: true },
    { id: 'family', title: '가정·하교·방과후', local: true },
    { id: 'etc', title: '그 밖의 메모', local: true },
    { id: 'records', title: '기록' },
];
export const CARD_LAYOUT_KEY = 'ssug-gyomu-student-card';

/** 저장된 배치를 믿을 수 있게 고칩니다. 모르는 묶음은 빼고 새 묶음은 뒤에 붙입니다. 처음에는 기본 정보·알레르기·기록만 펼칩니다. */
export function cleanCardLayout(raw) {
    const known = CARD_SECTIONS.map((s) => s.id);
    const order = [];
    for (const id of Array.isArray(raw?.order) ? raw.order : []) if (known.includes(id) && !order.includes(id)) order.push(id);
    for (const id of known) if (!order.includes(id)) order.push(id);
    const folded = Array.isArray(raw?.folded) ? raw.folded.filter((id) => known.includes(id)) : ['contacts', 'health', 'family', 'etc'];
    return { order, folded };
}
export function moveSection(layout, id, step) {
    const order = [...layout.order];
    const from = order.indexOf(id);
    const to = from + step;
    if (from < 0 || to < 0 || to >= order.length) return layout;
    [order[from], order[to]] = [order[to], order[from]];
    return { ...layout, order };
}
