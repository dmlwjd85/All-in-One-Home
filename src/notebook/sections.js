/** notebook.json을 쪽 묶음으로 나눌 때의 범위. 1쪽부터 580쪽까지 빠짐없이 이어집니다. */
export const SECTION_RANGES = [
    ['front', 1, 31],
    ['year', 32, 45],
    ['week', 46, 98],
    ['day', 99, 139],
    ['klass', 140, 153],
    ['student', 154, 230],
    ['attend', 231, 255],
    ['counsel', 256, 334],
    ['lesson', 335, 403],
    ['work', 404, 494],
    ['write', 495, 558],
    ['tail', 559, 580],
];

export function sectionForPage(page) {
    const n = Number(page);
    const hit = SECTION_RANGES.find(([, from, to]) => n >= from && n <= to);
    return hit ? hit[0] : 'front';
}
