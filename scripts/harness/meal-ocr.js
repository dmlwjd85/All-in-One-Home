/* 급식표 사진 읽기를 실제 크롬에서 끝까지 돌리는 시험 화면의 코드(check-meal-ocr-browser.mjs 가 묶어 씁니다). */
import { readImageTable } from '../../src/ui/tableOcr.js';
import { parseMealTable } from '../../src/lib/mealPaste.js';

window.runMealOcr = async (url, name) => {
    const blob = await (await fetch(url)).blob();
    const file = new File([blob], name, { type: 'image/png' });
    const steps = [];
    const found = await readImageTable(file, (message) => steps.push(message));
    const meal = parseMealTable(found.text, { today: '2026-11-16', now: new Date('2026-11-16T09:00:00+09:00'), meal: true, fix: true });
    return { weak: found.weak, steps, text: found.text, days: meal.days.map((day) => ({ date: day.date, items: day.items.map((item) => item.name) })) };
};
