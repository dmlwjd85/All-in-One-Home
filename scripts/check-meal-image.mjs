/*
 * 급식표 사진 읽기 검사(글자 인식 프로그램 없이 도는 부분).
 * 1. 표 그림에서 칸 찾기: PR 견본, 가상 주간표·월간표(곧은 표). PNG 는 node 의 zlib 로 직접 풉니다.
 * 2. 실제 학교 급식표 사진을 읽은 칸 글(사진은 담지 않음)로 날짜·메뉴·알레르기 번호 나누기.
 *    보통 사진, 2.5도 돌린 사진, 많이 눌러 담은(JPEG 40) 사진을 읽은 글 세 가지입니다.
 * 3. 닮은 글자 바로잡기: 고칠 것은 고치고, 목록 밖 실제 메뉴 이름은 건드리지 않기.
 */
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { prepareTable } from '../src/lib/tableImage.js';
import { cellsToTable } from '../src/lib/gridDetect.js';
import { looksLikeMealTable, parseMealTable } from '../src/lib/mealPaste.js';
import { fixMenuName } from '../src/lib/hangulFix.js';

let bad = 0;
const check = (ok, msg) => { if (!ok) { bad += 1; console.error(`✗ ${msg}`); } };
const fixture = (name) => new URL(`./fixtures/${name}`, import.meta.url);

/** 8비트, 섞어 쓰지 않은(interlace 없음) PNG 만 풉니다. 돌려줌: { rgba, width, height } */
function decodePng(buf) {
    let pos = 8;
    let width = 0;
    let height = 0;
    let type = 0;
    const parts = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const kind = buf.toString('ascii', pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (kind === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            if (data[8] !== 8 || data[12] !== 0) throw new Error('8비트·비섞음 PNG 만 풉니다');
            type = data[9];
        } else if (kind === 'IDAT') parts.push(data);
        else if (kind === 'IEND') break;
        pos += 12 + len;
    }
    const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
    const raw = inflateSync(Buffer.concat(parts));
    const stride = width * channels;
    const out = new Uint8Array(stride * height);
    for (let y = 0; y < height; y += 1) {
        const filter = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        for (let x = 0; x < stride; x += 1) {
            const a = x >= channels ? out[y * stride + x - channels] : 0;
            const b = y ? out[(y - 1) * stride + x] : 0;
            const c = x >= channels && y ? out[(y - 1) * stride + x - channels] : 0;
            let v = line[x];
            if (filter === 1) v += a;
            else if (filter === 2) v += b;
            else if (filter === 3) v += (a + b) >> 1;
            else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            out[y * stride + x] = v & 255;
        }
    }
    const rgba = new Uint8Array(width * height * 4);
    for (let i = 0; i < width * height; i += 1) {
        const s = i * channels;
        const g = out[s];
        rgba[i * 4] = channels >= 3 ? out[s] : g;
        rgba[i * 4 + 1] = channels >= 3 ? out[s + 1] : g;
        rgba[i * 4 + 2] = channels >= 3 ? out[s + 2] : g;
        rgba[i * 4 + 3] = channels === 4 ? out[s + 3] : channels === 2 ? out[s + 1] : 255;
    }
    return { rgba, width, height };
}

/* 1. 칸 찾기 */
for (const [name, rows, cols] of [['sample-meal-example.png', 2, 5], ['meal-week-synthetic.png', 2, 5], ['meal-month-synthetic.png', 3, 5]]) {
    const { rgba, width, height } = decodePng(readFileSync(fixture(name)));
    const prep = prepareTable(rgba, width, height);
    check(prep.ok, `${name} 칸을 못 찾음`);
    check(prep.cells?.length >= rows && prep.cells?.[0]?.length === cols, `${name} 칸 ${prep.cells?.length}×${prep.cells?.[0]?.length} (바람 ${rows}줄 이상 × ${cols}칸)`);
    const strips = (prep.strips || []).reduce((sum, strip) => sum + strip.bands.length, 0);
    check(strips >= cols, `${name} 글자 띠에 넣은 칸 ${strips}`);
}

/* 2. 실제 사진에서 읽은 글 → 날짜별 메뉴 */
const photo = JSON.parse(readFileSync(fixture('meal-photo-cells.json'), 'utf8'));
const minimum = { normal: 112, rotated: 108, jpeg40: 110 };
for (const [tag, cells] of Object.entries(photo.cells)) {
    const text = cellsToTable(cells.map((row) => row.map((value) => ({ text: value }))));
    /* '달력·급식 표'로 사진을 넣어도(급식표로 읽기를 안 골라도) 급식표로 알아봐야 합니다. */
    check(looksLikeMealTable(text), `${tag} 사진 글을 급식표로 못 알아봄`);
    const got = parseMealTable(text, { today: '2026-11-16', now: new Date('2026-11-16T09:00:00+09:00'), fix: true });
    check(got.year === 2026 && got.month === 11, `${tag} 연월 ${got.year}-${got.month}`);
    const map = Object.fromEntries(got.days.map((day) => [day.date, day]));
    const dates = Object.keys(photo.truth);
    check(dates.every((date) => map[date]), `${tag} 빠진 날짜 ${dates.filter((date) => !map[date]).join(',')}`);
    check(got.days.every((day) => photo.truth[day.date]), `${tag} 없는 날짜 ${got.days.filter((day) => !photo.truth[day.date]).map((day) => day.date).join(',')}`);
    let hit = 0;
    let total = 0;
    const wrongCodes = [];
    for (const [date, items] of Object.entries(photo.truth)) {
        for (const name of items) {
            total += 1;
            const item = map[date]?.items.find((row) => row.name === name);
            if (!item) continue;
            hit += 1;
            const want = photo.codes[`${name}@${date.slice(8)}`];
            if (want !== undefined && item.codes !== want) wrongCodes.push(`${date.slice(8)} ${name} ${item.codes || '-'}≠${want || '-'}`);
        }
    }
    check(hit >= minimum[tag], `${tag} 메뉴 ${hit}/${total} (바람 ${minimum[tag]} 이상)`);
    /* 알레르기 번호는 틀리면 위험하므로, 이름을 맞게 읽은 메뉴의 번호는 모두 맞아야 합니다. */
    check(wrongCodes.length === 0, `${tag} 알레르기 번호 틀림 ${wrongCodes.join(' | ')}`);
    console.log(`  사진 글(${tag}): 날짜 ${got.days.length}/${dates.length}, 메뉴 ${hit}/${total}`);
}

check(!looksLikeMealTable(readFileSync(fixture('sample-calendar.tsv'), 'utf8')), '학교 달력 표를 급식표로 봄');

/* 3. 닮은 글자 바로잡기 */
for (const [from, to] of [['짝두기', '깍두기'], ['새우묶음밥', '새우볶음밥'], ['머묵국', '어묵국'], ['종각김치', '총각김치'], ['흑미발', '흑미밥'], ['보쌍김치', '보쌈김치'], ['사인머스켓', '샤인머스캣']]) {
    check(fixMenuName(from).name === to, `${from} → ${fixMenuName(from).name} (바람 ${to})`);
}
const outside = `차수수밥 기장찰밥 흑미찰밥 클로렐라밥 녹두밥 차돌박이된장찌개 얼큰김칫국 들깨무채국 건새우아욱국 맑은순두부국 근대국 얼갈이된장국 시래기된장국 우거지해장국 뼈해장국
쇠고기버섯국 닭온반 부추달걀국 팽이장국 물만둣국 매생이굴국 홍합미역국 들깨시래기국 올갱이국 대구탕 알탕 꽃게탕 순살감자탕 쇠고기육개장 버섯육개장 닭칼국수 바지락칼국수
들깨칼국수 메밀국수 볼로네제스파게티 크림파스타 로제파스타 토마토스파게티 나가사키짬뽕 쌀국수 팟타이 나시고랭 치킨마요덮밥 규동 가츠동 장어덮밥 회덮밥 낙지덮밥 중화비빔밥
전주비빔밥 열무비빔밥 산채비빔밥 돌솥비빔밥 충무김밥 참치김밥 소고기김밥 삼각김밥 고기만두 김치만두 새우만두 갈비만두 매운돼지갈비찜 안심돈가스 등심돈가스 고구마치즈돈가스
닭다리살구이 순살치킨 간장치킨 파닭 치킨샐러드 닭가슴살샐러드 연어샐러드 훈제연어 연어구이 장어구이 메로구이 볼락구이 열기구이 이면수구이 병어조림 가오리찜 아귀찜 해물찜
꽃게찜 오징어숙회 문어숙회 골뱅이소면 쟁반국수 막국수 비빔냉면 물냉면 콩국수 열무국수 김치말이국수 도토리묵밥 묵사발 강된장 우렁된장 우렁쌈밥 제육쌈밥 보리비빔밥 꼬막비빔밥
꼬막무침 굴무침 굴전 육전 김치부침개 감자채전 메밀전병 수수부꾸미 화전 호박고지 가지찜 가지탕수 고추튀김 깻잎튀김 쑥튀김 연근튀김 연근전 우엉튀김 우엉잡채 버섯잡채 콩나물잡채
꽃빵 팔보채 라조기 깐풍만두 꿔바로우 마라샹궈 짜사이 락교 초생강 석류 망고 리치 용과 천혜향 레드향 황금향 금귤 무화과 살구 체리 자몽 라임 아보카도 코코넛 망고주스 쥬시쿨 쿨피스
영양찰떡 쑥떡 쑥개떡 개피떡 바람떡 증편 술빵 옥수수빵 마늘빵 바게트 베이글 스콘 크로플 콘도그 타코 부리또 퀘사디아 나초 팝콘치킨 언양불고기 뚝배기불고기 차돌박이 우삼겹
대패삼겹 항정살 갈매기살 간장게장 양념게장 새우장 명란젓 낙지젓 오징어젓 창란젓 조개젓 어리굴젓 갈치속젓 깻잎김치 고들빼기 부추김치 얼갈이김치 양배추김치 가지김치
무김치 알타리김치 보쌈김치 열무물김치 돌산갓김치 순살갈치감자조림 소머리곰탕`.split(/\s+/);
const changed = outside.filter((name) => fixMenuName(name).fixed).map((name) => `${name}→${fixMenuName(name).name}`);
check(changed.length === 0, `목록 밖 실제 메뉴 이름을 바꿈: ${changed.join(', ')}`);

if (bad) {
    console.error(`급식표 사진 읽기 검사 실패 ${bad}`);
    process.exit(1);
}
console.log('급식표 사진 읽기 검사를 통과했습니다.');
