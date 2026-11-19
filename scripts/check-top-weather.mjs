/**
 * 맨 위 날짜 칸 안의 날씨(오늘 화면)와 지역 고르기.
 * - 지역을 고르기 전에는 바깥에 아무것도 묻지 않습니다. 단추는 '날씨 · 지역 고르기'.
 * - 단추를 누르면 바로 지역 고르기 창: 자주 고르는 지역은 한 번 눌러 정해지고(바깥에 이름을 묻지 않음), 창이 닫히며 기온이 보입니다.
 * - 목록에 없는 곳은 적어서 찾기. 지역은 이 기기에만(위젯과 같은 자리), 바꾸면 위젯도 따라 바뀝니다.
 * - 휴대폰 폭에서도 날짜 칸 높이를 거의 늘리지 않고(부제 한 줄), 누르는 자리는 44px.
 * - 교실 테마: 날짜 칸·윗줄 단추·크게 누르는 단추·카드 제목은 '쨈 교무수첩' 팻말처럼 나무 테 + 칠판 속.
 */
import { build } from 'esbuild';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { QUICK_PLACES, WEATHER_PLACE_EVENT, knownPlace } from '../src/lib/weather.js';

const root = new URL('..', import.meta.url).pathname;
const src = (p) => readFileSync(join(root, p), 'utf8');
const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };

/* 정적 규칙 */
const app = src('src/App.jsx');
const ui = src('src/ui/TopWeather.jsx');
const lib = src('src/lib/weather.js');
const cork = src('src/ui/skin-cork.css');
const widget = src('src/ui/WidgetBoard.jsx');
check(/<div className="date-block has-weather">[\s\S]{0,600}<TopWeather \/>\s*<\/div>/.test(app), '오늘 화면 날짜 칸 안에 날씨가 없습니다.');
check(QUICK_PLACES.length >= 12 && QUICK_PLACES.every((name) => knownPlace(name)?.name === name), '자주 고르는 지역은 모두 이 기기 목록에 있어야 합니다(누를 때 바깥에 묻지 않게).');
check(/dispatchEvent\?\.\(new Event\(WEATHER_PLACE_EVENT\)\)/.test(lib) && /WEATHER_PLACE_EVENT/.test(widget) && WEATHER_PLACE_EVENT === 'ssug-gyomu-weather-place', '지역을 바꾸면 날씨 위젯도 따라 바뀌어야 합니다.');
check(!/<p\b/.test(ui.split('function WeatherPicker')[0]), '날짜 칸 안 날씨는 <p>가 아니어야 합니다(부제 .date-block p 검사와 겹침).');
check(!/aria-pressed/.test(ui), '날씨 단추·지역 칩에 aria-pressed 를 두지 않습니다(다른 화면 검사가 첫 눌림 단추를 잡습니다).');
check(!/ssug-gyomu-weather|open-meteo/.test(src('src/lib/db.js')), '날씨 지역이 클라우드 저장 모듈에 섞였습니다.');
const plaque = cork.slice(cork.indexOf('/* ───────── 칠판 팻말 ─────────'));
check(plaque.length > 200 && /body \.topbar \.date-block,[\s\S]*body \.topbar \.icon-btn,[\s\S]*body \.main \.hero-action,[\s\S]*body \.main \.primary-btn/.test(plaque) && /border: 3px solid #8B5E3C/.test(plaque) && /background-color: var\(--cork-chalk\)/.test(plaque), '교실 테마 윗줄·단추가 쨈 교무수첩 팻말(나무 테 + 칠판 속)이 아닙니다.');
const tags = cork.slice(cork.indexOf('/* 카드 제목: 쨈'), cork.indexOf('/* 보호 안내는 크림 카드'));
check(tags.length > 100 && /border: 3px solid #8B5E3C/.test(tags) && /--plaque-line/.test(tags) && !/background: var\(--cork-tag-/.test(tags), '카드 제목이 아직 단색 라벨입니다(팻말 + 갈래 색 분필 줄이어야 합니다).');

/* 실제 크롬 */
const chrome = [process.env.CHROME_PATH, '/usr/bin/google-chrome-stable', '/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/chromium'].find((p) => p && existsSync(p));
let puppeteer = null;
try { puppeteer = (await import('puppeteer-core')).default; } catch { puppeteer = null; }
if (!chrome || !puppeteer) {
    if (process.env.CI) failures.push('CI 인데 크롬(또는 puppeteer-core)이 없어 날씨 화면 검사를 못 했습니다.');
    else console.log('(크롬이 없어 화면 검사는 건너뜁니다)');
} else {
    const dir = mkdtempSync(join(tmpdir(), 'top-weather-'));
    await build({
        entryPoints: [join(root, 'scripts/harness/top-weather.jsx')], bundle: true, outfile: join(dir, 'app.js'), format: 'iife', jsx: 'automatic',
        define: { 'process.env.NODE_ENV': '"production"', 'import.meta.env': '{}' }, loader: { '.woff2': 'empty' }, logLevel: 'error',
    });
    const css = ['src/styles/tokens.css', 'src/index.css', 'src/ui/topWeather.css'].map((f) => src(f)).join('\n').replace(/@tailwind[^;]*;/g, '').replace(/@import[^;]*;/g, '');
    writeFileSync(join(dir, 'app.css'), css);
    writeFileSync(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="app.css"><body><div class="main" style="padding:16px"><div id="root"></div></div><script src="app.js"></script>');
    const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files', '--no-zygote'] });
    try {
        for (const width of [390, 1280]) {
            const label = `${width}px`;
            const page = await browser.newPage();
            page.on('pageerror', (e) => failures.push(`${label} 페이지 오류: ${e.message}`));
            await page.setViewport({ width, height: 800 });
            await page.goto(`file://${dir}/index.html`);
            await page.evaluate(() => localStorage.clear());
            await page.reload();
            await page.waitForFunction(() => window.__ready && document.querySelector('[data-role="top-weather"]'));
            const first = await page.evaluate(() => {
                const b = document.querySelector('[data-role="top-weather"]'); const r = b.getBoundingClientRect();
                const p = document.querySelector('.date-block p'); const lh = parseFloat(getComputedStyle(p).lineHeight) || 18;
                return { text: b.innerText.replace(/\s+/g, ' '), w: r.width, h: r.height, calls: window.__calls.length, subLines: Math.round(p.getBoundingClientRect().height / lh), block: document.querySelector('.date-block').getBoundingClientRect().height };
            });
            check(first.text.includes('지역 고르기') && first.calls === 0, `${label} 지역을 정하기 전에는 바깥에 묻지 않고 '지역 고르기'를 보여야 합니다: ${JSON.stringify(first)}`);
            check(first.w >= 43.5 && first.h >= 43.5, `${label} 날씨 단추가 44px보다 작습니다: ${JSON.stringify(first)}`);
            check(first.subLines === 1, `${label} 부제(반·시각)가 한 줄이 아닙니다: ${JSON.stringify(first)}`);
            if (width === 390) check(first.block <= 110, `${label} 날씨 때문에 날짜 칸이 너무 높아졌습니다: ${Math.round(first.block)}px`);
            await page.click('[data-role="top-weather"]');
            await page.waitForSelector('[data-role="weather-picker"]', { timeout: 3000 });
            const picker = await page.evaluate(() => ({
                chips: [...document.querySelectorAll('[data-weather-place]')].map((b) => b.dataset.weatherPlace),
                small: [...document.querySelectorAll('[data-role="weather-picker"] button')].filter((b) => { const r = b.getBoundingClientRect(); return r.width < 43.5 || r.height < 43.5; }).map((b) => b.innerText),
                focusable: Boolean(document.querySelector('[data-role="weather-picker"] input')),
                wide: document.querySelector('[data-role="weather-picker"]').scrollWidth > document.querySelector('[data-role="weather-picker"]').clientWidth + 2,
            }));
            check(picker.chips.includes('아산') && picker.chips.includes('서울') && picker.focusable, `${label} 누르자마자 지역 고르기 창이 떠야 합니다: ${JSON.stringify(picker)}`);
            check(!picker.small.length && !picker.wide, `${label} 지역 창 단추가 작거나 옆으로 넘칩니다: ${JSON.stringify(picker)}`);
            let heard = 0;
            await page.exposeFunction('__heard', () => { heard += 1; });
            await page.evaluate((name) => window.addEventListener(name, () => window.__heard()), WEATHER_PLACE_EVENT);
            await page.click('[data-weather-place="아산"]');
            await page.waitForFunction(() => !document.querySelector('[data-role="weather-picker"]') && /3°/.test(document.querySelector('[data-role="top-weather"]').innerText), { timeout: 4000 }).catch(() => {});
            const after = await page.evaluate(() => ({
                open: Boolean(document.querySelector('[data-role="weather-picker"]')),
                text: document.querySelector('[data-role="top-weather"]').innerText.replace(/\s+/g, ' '),
                label: document.querySelector('[data-role="top-weather"]').getAttribute('aria-label'),
                place: JSON.parse(localStorage.getItem('ssug-gyomu-weather-place') || 'null'),
                calls: window.__calls,
                block: document.querySelector('.date-block').getBoundingClientRect().height,
            }));
            check(!after.open && after.text.includes('3°') && /아산/.test(after.label), `${label} 지역을 누르면 창이 닫히고 기온이 보여야 합니다: ${JSON.stringify(after)}`);
            check(after.place?.name === '아산' && !after.calls.some((u) => u.includes('geocoding')) && after.calls.every((u) => !/name=|아산/.test(decodeURIComponent(u)) || u.includes('geocoding')), `${label} 목록 지역은 바깥에 이름을 묻지 않고 이 기기에 저장해야 합니다: ${JSON.stringify(after)}`);
            check(heard >= 1, `${label} 지역을 바꿔도 날씨 위젯에 알리지 않습니다.`);
            if (width === 390) check(after.block <= 110, `${label} 날씨가 보인 뒤 날짜 칸이 너무 높습니다: ${Math.round(after.block)}px`);
            /* 목록에 없는 곳: 적어서 찾기 */
            await page.click('[data-role="top-weather"]');
            await page.waitForSelector('[data-role="weather-picker"] input');
            await page.type('[data-role="weather-picker"] input', '홍천');
            await page.click('[data-role="weather-picker"] button[type="submit"]');
            await page.waitForFunction(() => !document.querySelector('[data-role="weather-picker"]'), { timeout: 4000 }).catch(() => {});
            const typed = await page.evaluate(() => ({ place: JSON.parse(localStorage.getItem('ssug-gyomu-weather-place') || 'null'), label: document.querySelector('[data-role="top-weather"]').getAttribute('aria-label') }));
            check(/홍천/.test(typed.place?.name || '') && /홍천/.test(typed.label || ''), `${label} 적어서 찾은 지역으로 바뀌지 않습니다: ${JSON.stringify(typed)}`);
            /* Esc 로 닫기 */
            await page.click('[data-role="top-weather"]');
            await page.waitForSelector('[data-role="weather-picker"]');
            await page.keyboard.press('Escape');
            check(!(await page.$('[data-role="weather-picker"]')), `${label} Esc 로 지역 창이 닫히지 않습니다.`);
            await page.close();
        }
    } finally {
        await browser.close();
    }
}

if (failures.length) { console.error(`맨 위 날씨 검사 실패 ${failures.length}건`); for (const f of failures) console.error(`- ${f}`); process.exit(1); }
console.log('맨 위 날씨 검사를 통과했습니다.');
