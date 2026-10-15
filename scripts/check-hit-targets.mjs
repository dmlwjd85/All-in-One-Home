/**
 * 보이는 크롬·바로가기의 목적지 매핑을 검사합니다.
 * PDF 픽셀 오버레이가 아니라 layout/nav 규칙을 기준으로 합니다.
 */
import { readFileSync } from 'node:fs';

const notebook = JSON.parse(readFileSync(new URL('../src/notebook/data/notebook.json', import.meta.url), 'utf8'));
import { TAGS } from '../src/notebook/labels.js';
import { PAGE_H, TAB_MIN, TAB_W } from '../src/notebook/layout.js';
import {
    bodyLinks,
    destForStudentNumber,
    monthPage,
    studentCardPage,
    studentWhoPage,
    topLinks,
    weekPageForDay,
} from '../src/notebook/nav.js';
import { monthCells } from '../src/lib/utils.js';

const errors = [];
const notes = [];
const ok = (cond, msg) => { if (!cond) errors.push(msg); };

ok(TAB_W >= TAB_MIN, `탭 너비 ${TAB_W} < ${TAB_MIN}`);
ok(PAGE_H === 820, `용지 높이 ${PAGE_H}`);

for (let n = 1; n <= 32; n++) {
    ok(studentCardPage(n) === 157 + n * 2, `카드 ${n} → ${studentCardPage(n)}`);
    ok(studentWhoPage(n) === 158 + n * 2, `누가 ${n} → ${studentWhoPage(n)}`);
}
ok(studentCardPage(1) === 159 && studentWhoPage(1) === 160, '1번 카드 159 · 누가 160');

const monthExpect = { 3: 34, 4: 35, 5: 36, 6: 37, 7: 38, 8: 39, 9: 40, 10: 41, 11: 42, 12: 43, 1: 44, 2: 45 };
for (const [m, p] of Object.entries(monthExpect)) {
    const year = Number(m) <= 2 ? 2027 : 2026;
    ok(monthPage(Number(m), year) === p, `${year}.${m} → ${monthPage(Number(m), year)} ≠ ${p}`);
}

TAGS.forEach((t, i) => {
    ok(t.page === 10 + i, `태그 #${t.id} → ${t.page}`);
});

const BODY_RENDERED = new Set([
    'cover', 'home', 'howto', 'tag-legend', 'year-cal', 'academic', 'month',
    'week-toc', 'week', 'special-toc', 'class-toc', 'roster', 'survey', 'health',
    'student-card', 'attend-toc', 'attend', 'counsel-toc', 'lesson-toc', 'unit',
    'score', 'work-toc', 'meeting', 'budget-toc', 'ssugeok-toc', 'ssugeok',
    'notebook-toc', 'board-toc', 'sticker-toc',
]);

let topCovered = 0;
let bodyCovered = 0;
let bodyKnown = 0;
let bodyUnknown = 0;
const unknownTypes = new Set();
const monthGaps = [];

for (const page of notebook.pages) {
    const top = topLinks(page);
    topCovered += top.length;
    const body = bodyLinks(page);
    bodyCovered += body.length;
    if (body.length === 0) continue;
    if (BODY_RENDERED.has(page.type)) bodyKnown += body.length;
    else {
        bodyUnknown += body.length;
        unknownTypes.add(page.type);
    }

    if (page.type === 'month') {
        const year = page.extra.year || 2026;
        const month = page.extra.month || 3;
        const cells = monthCells(`${year}-${String(month).padStart(2, '0')}`);
        for (const cell of cells.filter((c) => c.inMonth)) {
            const dest = weekPageForDay(body, cell.day);
            if (!dest) monthGaps.push(`${page.n}:${month}/${cell.day}`);
        }
    }

    if (page.type === 'roster') {
        for (let n = 1; n <= 32; n++) {
            const dest = destForStudentNumber(body, n);
            ok(dest === studentCardPage(n), `명렬 ${n}: ${dest} ≠ ${studentCardPage(n)}`);
        }
    }
}

ok(bodyUnknown === 0, `본문 링크를 그리지 않는 쪽 유형: ${[...unknownTypes].join(', ') || '없음'} (${bodyUnknown})`);

const home = notebook.pages[1];
const homeBody = bodyLinks(home);
ok(homeBody.some((l) => l.to === 154), '홈에 명렬표');
ok(homeBody.some((l) => l.to === 46), '홈에 주간 목차');
ok(homeBody.filter((l) => l.to >= 34 && l.to <= 45).length === 12, '홈 달 칩 12개');

const weekToc = bodyLinks(notebook.pages[45]);
ok(weekToc.length === 64, `주간 목차 ${weekToc.length}`);

const special = bodyLinks(notebook.pages[98]);
ok(special.length === 40 && special[0].to === 100, `하루 목차 ${special.length} 첫 목적지 ${special[0]?.to}`);

if (monthGaps.length) {
    notes.push(`월간 날짜→주 매핑 빈칸 ${monthGaps.length}개: ${monthGaps.slice(0, 8).join(', ')}`);
}

const report = {
    tabW: TAB_W,
    topLinksCollected: topCovered,
    bodyLinksRendered: bodyKnown,
    bodyLinksUnknown: bodyUnknown,
    monthDayGaps: monthGaps.length,
    roster1: { card: studentCardPage(1), who: studentWhoPage(1) },
    notes,
    errors,
};

console.log(JSON.stringify(report, null, 2));
if (errors.length) {
    console.error(`hit-target 검사 실패 ${errors.length}건`);
    process.exit(1);
}
console.log('hit-target 검사 통과');
