/**
 * 학교 급식 알레르기 표시 19종과, 메뉴 이름으로 들어 있을 법한 재료를 짐작하는 낱말.
 * - 급식표에 번호가 적혀 있으면 그 번호를 '확실'로, 번호가 없으면 이름으로 '짐작'합니다.
 * - 짐작은 흔한 조리법 기준이라 틀릴 수 있습니다(화면에 '짐작'이라고 적습니다). 최종 확인은 영양 선생님 식단표로.
 */
export const ALLERGENS = [
    [1, '난류'], [2, '우유'], [3, '메밀'], [4, '땅콩'], [5, '대두'], [6, '밀'], [7, '고등어'], [8, '게'], [9, '새우'], [10, '돼지고기'],
    [11, '복숭아'], [12, '토마토'], [13, '아황산류'], [14, '호두'], [15, '닭고기'], [16, '쇠고기'], [17, '오징어'], [18, '조개류'], [19, '잣'],
];
const NAME = new Map(ALLERGENS);
export function allergenName(code) { return NAME.get(Number(code)) || ''; }

export function cleanAllergy(list) {
    const seen = new Set();
    for (const value of Array.isArray(list) ? list : []) {
        const n = Number(value);
        if (Number.isInteger(n) && n >= 1 && n <= 19) seen.add(n);
    }
    return [...seen].sort((a, b) => a - b);
}

/* 이름에 이 낱말이 있으면 그 재료가 들어 있을 법합니다. 앞쪽일수록 뚜렷한 낱말입니다. */
const GUESS = [
    [1, /계란|달걀|란찜|란말이|오믈렛|에그|스크램블|마요|타르타르|카스테라|머랭|전(?:$|[^골복])|부침|까스|가스(?:$|[^오])|튀김|커틀릿|핫도그|빵|케이크|와플|쿠키|머핀|도넛|푸딩|크로켓|고로케|볶음밥|김밥|잡채밥|오므/],
    [2, /우유|치즈|요구르트|요거트|요플레|크림|버터|라떼|피자|그라탕|까르보|아이스크림|빵|케이크|와플|쿠키|머핀|도넛|푸딩|스프|수프|밀크|카스테라|초코|쉐이크/],
    [3, /메밀|모밀|소바|냉면/],
    [4, /땅콩|피넛/],
    [5, /두부|된장|청국장|간장|콩|유부|순두부|두유|쌈장|고추장|짜장|자장|강된장|낫토|비지|춘장|불고기|갈비|조림|장국|찌개|볶음|무침|김치|찜닭|닭갈비|제육|떡볶이|어묵|만두|까스|가스(?:$|[^오])|양념|데리야끼|소스/],
    [6, /빵|면|국수|우동|라면|파스타|스파게티|짜장|자장|짬뽕|수제비|칼국수|만두|튀김|까스|가스(?:$|[^오])|커틀릿|전(?:$|[^골복])|부침|떡볶이|핫도그|피자|케이크|와플|쿠키|머핀|도넛|카스테라|토스트|샌드위치|버거|또띠아|탕수|깐풍|강정|너겟|크로켓|고로케|어묵|맛살|소시지|소세지|햄|카레|하이라이스|그라탕|춘권|유린기|크래커|시리얼/],
    [7, /고등어/],
    [8, /꽃게|대게|게살|게맛살|맛살|크래미|게장|해물탕|해물찜/],
    [9, /새우|대하|해물|짬뽕|김치|깍두기|석박지|섞박지|겉절이|젓갈|새우젓|팔보채|양장피/],
    [10, /돼지|돈육|돈까스|돈가스|제육|삼겹|목살|탕수육|수육|보쌈|족발|순대|햄|소시지|소세지|베이컨|스팸|동그랑땡|완자|만두|짜장|자장|미트볼|함박|떡갈비|두루치기|불백|감자탕|뼈해장|부대찌개|김치찌개|카레|하이라이스|핫도그|돈/],
    [11, /복숭아|황도|백도|피치/],
    [12, /토마토|케첩|케찹|스파게티|파스타|피자|나폴리|미트볼|오므라이스|하이라이스|핫도그|살사|떡볶이|돈까스|돈가스|함박/],
    [13, /건포도|건살구|와인|과일칵테일|후르츠|무말랭이|단무지|락교|피클/],
    [14, /호두/],
    [15, /닭|치킨|삼계|너겟|닭갈비|찜닭|깐풍기|유린기|라조기|백숙|초계/],
    [16, /소고기|쇠고기|한우|우육|불고기|갈비탕|갈비찜|소갈비|떡갈비|육개장|설렁탕|곰탕|장조림|미역국|떡국|무국|뭇국|함박|미트볼|사골|차돌|규동|육전|스테이크|비프|쇠/],
    [17, /오징어|한치|낙지|쭈꾸미|주꾸미|문어|해물|짬뽕|팔보채|양장피|진미채|어묵/],
    [18, /조개|바지락|홍합|굴(?:$|[^비])|전복|가리비|재첩|꼬막|모시조개|해물|짬뽕|봉골레|굴소스|팔보채/],
    [19, /잣/],
];

/** 메뉴 이름으로 짐작한 알레르기 번호. */
export function guessAllergens(name) {
    const text = String(name || '').replace(/\s+/g, '');
    if (!text) return [];
    const out = [];
    for (const [code, re] of GUESS) if (re.test(text)) out.push(code);
    return out;
}

/** 급식표에 적힌 번호('5.6.10'). */
export function writtenAllergens(codes) {
    return cleanAllergy(String(codes || '').split(/[^\d]+/).filter(Boolean));
}

/**
 * 한 메뉴에서 이 학생에게 해당하는 알레르기.
 * 돌려주는 값: [{ code, label, sure }] — sure 는 급식표에 번호가 적혀 있던 것, 아니면 이름으로 짐작한 것.
 * 급식표에 번호가 적힌 메뉴는 그 번호만 믿고, 번호가 없는 메뉴만 이름으로 짐작합니다.
 */
export function itemHits(item, allergy) {
    const mine = new Set(cleanAllergy(allergy));
    if (!mine.size || !item?.name) return [];
    const written = writtenAllergens(item.codes);
    const list = written.length ? written.map((code) => [code, true]) : guessAllergens(item.name).map((code) => [code, false]);
    return list.filter(([code]) => mine.has(code)).map(([code, sure]) => ({ code, label: allergenName(code), sure }));
}

/** 그 날 급식에서 알레르기에 걸리는 학생과 메뉴. [{ student, items: [{ name, hits }] }], 번호 순. */
export function allergyHits(students, day) {
    const out = [];
    for (const student of students || []) {
        if (student?.active === false || !cleanAllergy(student?.allergy).length) continue;
        const items = [];
        for (const item of day?.items || []) {
            const hits = itemHits(item, student.allergy);
            if (hits.length) items.push({ name: item.name, hits });
        }
        if (items.length) out.push({ student, items });
    }
    return out.sort((a, b) => (a.student.no || 0) - (b.student.no || 0));
}

/** 알림 한 줄: '3번 김하늘 — 제육볶음(돼지고기), 미역국(쇠고기·짐작)'. */
export function hitLine(hit) {
    const menus = hit.items.map((item) => `${item.name}(${item.hits.map((h) => (h.sure ? h.label : `${h.label}·짐작`)).join(', ')})`).join(', ');
    return `${hit.student.no}번 ${hit.student.name} — ${menus}`;
}
