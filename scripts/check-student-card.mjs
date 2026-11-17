/* 학생카드·급식 알레르기 알림: 번호 고르기, 메뉴 이름으로 짐작, 배치(접기·순서), 화면·규칙 연결을 봅니다. */
import { readFileSync } from 'node:fs';
import { ALLERGENS, ALLERGEN_GROUPS, ALLERGEN_MAX, allergenName, allergyHits, cleanAllergy, guessAllergens, hitLine, itemHits, ownWords } from '../src/lib/allergy.js';
import { toCloudRow, fromCloudRow } from '../src/lib/cloudShape.js';

const failures = [];
const ok = (cond, msg) => { if (!cond) failures.push(msg); };

ok(ALLERGENS.length === 19 && ALLERGENS[0][1] === '난류' && ALLERGENS[9][1] === '돼지고기' && ALLERGENS[18][1] === '잣', '알레르기 19종 번호가 급식 표시와 다릅니다.');
ok(cleanAllergy([10, '5', 5, 0, 20, 'x', 1.5, 71, 999]).join() === '5,10,20', '알레르기 번호 거르기');
{
    const all = ALLERGEN_GROUPS.flatMap((g) => g.items);
    const codes = all.map(([code]) => code);
    ok(new Set(codes).size === codes.length && Math.max(...codes) === ALLERGEN_MAX && codes.every((c) => c >= 1) && all.length >= 60, `꼼꼼한 목록 번호가 겹치거나 범위를 벗어납니다: ${all.length}개`);
    ok(new Set(all.map(([, label]) => label)).size === all.length, '꼼꼼한 목록에 같은 이름이 둘 있습니다.');
    const rulesText = readFileSync('firestore.rules', 'utf8');
    ok(rulesText.includes(`hasOnly([${Array.from({ length: ALLERGEN_MAX }, (_, i) => i + 1).join(', ')}])`), '보안 규칙의 알레르기 번호 범위가 앱 목록과 다릅니다.');
    const more = { 키위주스: 20, 딸기잼: 21, 파인애플: 25, 참외: 26, 아몬드멸치볶음: 31, 깨소금: 36, 들깨미역국: 37, 연어스테이크: 40, 참치마요: 41, 코다리조림: 44, 어묵볶음: 50, 김구이: 68, 당근라페: 51, 오이무침: 52, 버섯볶음: 54, 콘샐러드: 57, 초코우유: 61, 허니브레드: 62, 배추김치: 0, 사과: 23, 시금치나물: 70, 고구마맛탕: 69 };
    for (const [name, want] of Object.entries(more)) {
        const got = guessAllergens(name);
        if (want) ok(got.includes(want), `「${name}」에서 ${allergenName(want)}(${want})을 못 찾습니다: ${got.join('.')}`);
    }
    ok(!guessAllergens('배추김치').includes(66) && !guessAllergens('파인애플').includes(23) && !guessAllergens('들깨무침').includes(36) && !guessAllergens('김치찌개').includes(68) && !guessAllergens('감자조림').includes(67), '배추·파인애플·들깨·김치·감자를 엉뚱한 것으로 봅니다.');
    /* 20번부터는 급식표에 번호가 적혀 있어도 이름으로 봅니다. */
    ok(JSON.stringify(itemHits({ name: '키위샐러드', codes: '1.5' }, [20])) === JSON.stringify([{ code: 20, label: '키위', sure: false }]), '급식표에 번호가 있는 메뉴에서 꼼꼼한 목록(20번~)을 못 찾습니다.');
    ok(ownWords('파프리카, 깻잎\n파프리카 , 가, ').join() === '파프리카,깻잎', '직접 적은 낱말 나누기');
    const own = allergyHits([{ id: 's9', no: 9, name: '윤서', allergyWords: '파프리카' }], { items: [{ name: '파프리카 볶음', codes: '5' }, { name: '밥', codes: '' }] });
    ok(own.length === 1 && own[0].items[0].hits[0].label === '파프리카' && own[0].items[0].hits[0].sure === true, `직접 적은 낱말 알림: ${JSON.stringify(own)}`);
}

/* 이름으로 짐작 */
const guess = { 제육볶음: [5, 10], 돈까스: [1, 5, 6, 10, 12], 미역국: [16], 새우튀김: [1, 6, 9], 달걀찜: [1], 우유: [2], 치킨너겟: [6, 15], 오징어볶음: [5, 17], 바지락칼국수: [6, 18], 고등어구이: [7], 호두멸치볶음: [5, 14], 메밀전병: [1, 3, 6], 땅콩조림: [4, 5], 기장밥: [59], 귤: [29], 전복죽: [18], 물: [] };
for (const [name, want] of Object.entries(guess)) {
    const got = guessAllergens(name);
    ok(want.every((code) => got.includes(code)) && (want.length || !got.length), `「${name}」 짐작: ${got.join('.')} (바람: ${want.join('.')} 포함)`);
}
ok(!guessAllergens('전복죽').includes(1) && !guessAllergens('굴비구이').includes(18) && !guessAllergens('전골').includes(1), '전복·굴비·전골을 잘못 짐작합니다.');

/* 급식표에 번호가 있으면 그 번호만 믿습니다. */
ok(JSON.stringify(itemHits({ name: '제육볶음', codes: '5.6.10' }, [10, 13])) === JSON.stringify([{ code: 10, label: '돼지고기', sure: true }]), '적힌 번호로 확실한 알림');
ok(itemHits({ name: '제육볶음', codes: '5.6' }, [10]).length === 0, '번호가 적힌 메뉴는 짐작으로 알리지 않습니다(적힌 번호가 기준).');
ok(JSON.stringify(itemHits({ name: '제육볶음', codes: '' }, [10])) === JSON.stringify([{ code: 10, label: '돼지고기', sure: false }]), '번호 없는 메뉴는 짐작으로 알림');
ok(itemHits({ name: '제육볶음', codes: '' }, []).length === 0, '알레르기가 없는 학생에게 알립니다.');

const students = [
    { id: 's3', no: 3, name: '김하늘', allergy: [10, 16] },
    { id: 's1', no: 1, name: '강민서', allergy: [4] },
    { id: 's5', no: 5, name: '박서준', allergy: [2], active: false },
    { id: 's2', no: 2, name: '나은우' },
];
const day = { date: '2026-11-17', items: [{ name: '기장밥', codes: '' }, { name: '미역국', codes: '' }, { name: '제육볶음', codes: '5.6.10' }, { name: '우유', codes: '2' }] };
const hits = allergyHits(students, day);
ok(hits.length === 1 && hits[0].student.id === 's3' && hits[0].items.length === 2, `알림 대상: ${JSON.stringify(hits.map((h) => [h.student.name, h.items.map((i) => i.name)]))}`);
ok(hitLine(hits[0]) === '3번 김하늘 — 미역국(쇠고기·짐작), 제육볶음(돼지고기)', `알림 글: ${hits[0] && hitLine(hits[0])}`);
ok(allergyHits(students, null).length === 0 && allergyHits([], day).length === 0, '급식이나 학생이 없을 때');

/* 번호만 클라우드로, 글은 올리지 않습니다. */
const up = toCloudRow('students', { id: 's3', no: 3, name: '김하늘', allergy: [10, 16, 99], allergyWords: '파프리카', memo: '' });
ok(JSON.stringify(up?.body?.allergy) === '[10,16]' && !('contacts' in up.body) && !('health' in up.body) && !('allergyWords' in up.body), `학생 문서에 올리는 알레르기: ${JSON.stringify(up?.body)}`);
ok(toCloudRow('students', { id: 's3', no: 3, name: '김하늘', allergy: [] }).clear.includes('allergy'), '알레르기를 모두 풀면 클라우드에서도 지워야 합니다.');
ok(!('allergy' in toCloudRow('students', { id: 's3', no: 3, name: '김하늘' }).body), '알레르기를 안 넣은 학생 문서에 빈 칸을 올립니다.');
{
    const back = fromCloudRow('students', 's3', { no: 3, name: '김하늘', allergy: [16, 10, 'x'] });
    ok(JSON.stringify(back?.allergy) === '[10,16]', `받은 알레르기: ${JSON.stringify(back)}`);
    ok(!('allergy' in fromCloudRow('students', 's3', { no: 3, name: '김하늘' })), '알레르기 칸이 없는 옛 문서');
}

/* 배치: 접기·순서 */
const { CARD_SECTIONS, cleanCardLayout, moveSection } = await import('../src/ui/cardLayout.js');
const first = cleanCardLayout(null);
ok(first.order.join() === CARD_SECTIONS.map((s) => s.id).join() && first.folded.includes('contacts') && !first.folded.includes('allergy'), '처음 배치');
const odd = cleanCardLayout({ order: ['records', 'records', '없는것', 'allergy'], folded: ['basic', '없는것'] });
ok(odd.order[0] === 'records' && odd.order[1] === 'allergy' && odd.order.length === CARD_SECTIONS.length && odd.folded.join() === 'basic', `깨진 배치 고치기: ${JSON.stringify(odd)}`);
ok(moveSection(first, 'records', -1).order.indexOf('records') === first.order.length - 2 && moveSection(first, 'basic', -1) === first, '위아래 옮기기');

const read = (p) => readFileSync(p, 'utf8');
const card = read('src/ui/StudentCard.jsx');
const rules = read('firestore.rules');
ok(/<StudentCard student=\{student\}/.test(read('src/ui/Students.jsx')) && /aria-expanded=\{open\}/.test(card) && /위로/.test(card) && /아래로/.test(card), '학생 화면에 접고 옮기는 학생카드가 없습니다.');
ok(/<AllergyBanner \/>/.test(read('src/ui/Home.jsx')) && /<AllergyBanner \/>/.test(read('src/ui/WidgetBoard.jsx')) && /role="alert"/.test(card) && /짐작/.test(card), '오늘 화면에 알레르기 알림이 없습니다.');
ok(/'allergy', 'createdAt'/.test(rules) && /d\(\)\.allergy\.hasOnly\(\[1, 2, 3/.test(rules) && /data-role="allergy-find"/.test(card) && /ALLERGEN_GROUPS\.map/.test(card), '보안 규칙에 알레르기 번호 칸이 없거나, 꼼꼼한 목록·찾기가 화면에 없습니다.');
ok(/card-\$\{sid\}/.test(read('src/lib/db.js')) && /draft\.local\.contacts = list/.test(read('src/lib/db.js')), '연락처·건강 정보는 이 기기 전용 칸에 두어야 합니다.');
ok(/check:student-card/.test(read('.github/workflows/deploy-pages.yml')), 'CI에 check:student-card 가 없습니다.');

if (failures.length) { console.error(`학생카드 검사 실패 ${failures.length}개\n- ${failures.join('\n- ')}`); process.exit(1); }
console.log('학생카드 검사를 통과했습니다.');
