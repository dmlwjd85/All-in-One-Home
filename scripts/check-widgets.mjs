/**
 * 넓은 화면 '오늘' 위젯판과 날씨 검사(화면 없이).
 * - 배치: 기본값, 깨진 저장값 고치기, 켜기·순서·크기, 새 위젯은 꺼진 채로 붙음, 이 기기 저장
 * - 날짜 계산: 여러 날 일정, 다가오는 일정 순서, 올해 남은 날, 달별 일정 수, 오늘·내일 알림장
 * - 날씨: 자주 쓰는 지역은 바깥에 묻지 않음, 좌표는 소수 둘째 자리까지만 보냄, 30분 캐시, 실패하면 예전 값
 * - 연결: 앱이 넓은 화면에서만 위젯판을 고르고, 위젯 설정·날씨는 클라우드 모듈에 들어가지 않음
 */
import { readFileSync } from 'node:fs';
import {
    WIDGETS, cleanLayout, defaultLayout, dropWidget, eventOn, eventsByDay, nextSize, titlesByMonth, eventsByMonth, moveWidget, noticesNear, readWidgetLayout, readWidgetMode,
    setWidgetSize, shownWidgets, toggleWidget, upcomingEvents, writeWidgetLayout, writeWidgetMode, yearProgress,
} from '../src/lib/widgets.js';
import { findPlace, forecastUrl, knownPlace, loadWeather, readPlace, shapeForecast, weatherText, writePlace, WEATHER_TTL_MS } from '../src/lib/weather.js';

const failures = [];
const check = (ok, msg) => { if (!ok) failures.push(msg); };
const memory = () => { const map = new Map(); return { map, getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) }; };

/* 1) 배치 */
{
    const ids = WIDGETS.map((w) => w.id);
    for (const want of ['weather', 'day', 'week', 'month', 'year', 'todo', 'events', 'notice']) check(ids.includes(want), `위젯 목록에 ${want}가 없습니다.`);
    check(defaultLayout().every((w) => w.on), '처음에는 모든 위젯이 켜져 있어야 합니다.');
    check(cleanLayout('깨짐').length === WIDGETS.length && cleanLayout(null).length === WIDGETS.length, '깨진 배치를 기본값으로 돌리지 않습니다.');
    const odd = cleanLayout([{ id: 'month', on: true, size: 'zz' }, { id: 'month', on: false }, { id: '없는것' }, { id: 'todo', on: false, size: 'l' }]);
    check(odd[0].id === 'month' && odd[0].size === WIDGETS.find((w) => w.id === 'month').size && odd[1].id === 'todo' && odd[1].on === false && odd[1].size === 'l', `저장된 배치 고치기가 이상합니다: ${JSON.stringify(odd.slice(0, 2))}`);
    check(odd.length === WIDGETS.length && odd.slice(2).every((w) => w.on === false), '새로 생긴 위젯은 꺼진 채로 뒤에 붙어야 합니다.');
    const base = defaultLayout();
    const up = moveWidget(base, base[1].id, -1);
    check(up[0].id === base[1].id && up[1].id === base[0].id, '위로 옮기기가 안 됩니다.');
    check(moveWidget(base, base[0].id, -1)[0].id === base[0].id, '맨 위에서 더 올리면 그대로여야 합니다.');
    check(moveWidget(base, base.at(-1).id, 1).at(-1).id === base.at(-1).id, '맨 아래에서 더 내리면 그대로여야 합니다.');
    check(WIDGETS.find((w) => w.id === 'month').size === 'l', '한 달 위젯은 처음부터 크게(일정 제목이 보이게) 둡니다.');
    check(WIDGETS.every((w) => w.icon && w.hint), '꾸미기에 보일 그림 글자나 설명이 없는 위젯이 있습니다.');
    check(nextSize('s') === 'm' && nextSize('m') === 'l' && nextSize('l') === 's', '크기 단추 순서가 작게→넓게→크게→작게가 아닙니다.');
    const dropped = dropWidget(base, base[4].id, base[1].id).map((w) => w.id);
    check(dropped[1] === base[4].id && dropped[2] === base[1].id && dropped.length === base.length, `끌어다 놓기 순서가 이상합니다: ${dropped}`);
    check(dropWidget(base, 'day', '없는것').map((w) => w.id).join() === base.map((w) => w.id).join(), '없는 자리에 놓으면 그대로여야 합니다.');
    const skip = moveWidget(toggleWidget(base, base[1].id, false), base[0].id, 1).map((w) => w.id);
    check(skip[2] === base[0].id && skip[0] === base[2].id, `옮기기가 숨긴 위젯을 건너뛰지 않습니다: ${skip}`);
    check(setWidgetSize(base, 'todo', 'l').find((w) => w.id === 'todo').size === 'l', '크기 바꾸기가 안 됩니다.');
    check(setWidgetSize(base, 'todo', 'xl').find((w) => w.id === 'todo').size === WIDGETS.find((w) => w.id === 'todo').size, '없는 크기를 받아들입니다.');
    const off = toggleWidget(base, 'year');
    check(!off.find((w) => w.id === 'year').on && !shownWidgets(off).some((w) => w.id === 'year'), '끄기가 안 됩니다.');
    check(toggleWidget(off, 'year').find((w) => w.id === 'year').on, '다시 켜기가 안 됩니다.');
    const store = memory();
    writeWidgetLayout(off, store);
    check(JSON.stringify(readWidgetLayout(store)) === JSON.stringify(off), '배치를 이 기기에 저장하고 다시 읽지 못합니다.');
    check([...store.map.keys()].every((k) => k.startsWith('ssug-gyomu')), '위젯 저장 키가 ssug-gyomu 로 시작하지 않습니다.');
    check(readWidgetMode(store) === false, '위젯판은 처음에 꺼져 있어야 합니다(기본 화면).');
    writeWidgetMode(true, store);
    check(readWidgetMode(store) === true, '위젯판 켜기를 기억하지 못합니다.');
    const broken = { getItem() { throw new Error('막힘'); }, setItem() { throw new Error('막힘'); } };
    check(readWidgetLayout(broken).length === WIDGETS.length && readWidgetMode(broken) === false, '저장소가 막히면 멈춥니다.');
    writeWidgetLayout(base, broken);
}

/* 2) 위젯 날짜 계산 */
{
    const trip = { id: 'e1', date: '2026-11-18', end: '2026-11-20', title: '체험학습' };
    check(eventOn(trip, '2026-11-19') && !eventOn(trip, '2026-11-21') && eventOn({ date: '2026-11-12' }, '2026-11-12'), '여러 날 일정이 날짜에 걸치는지 잘못 셉니다.');
    check(eventOn({ date: '2026-11-12', end: '2026-11-01' }, '2026-11-12'), '끝이 시작보다 앞선 일정을 하루짜리로 보지 않습니다.');
    const rows = [
        { id: 'a', date: '2026-11-20', title: '뒤' },
        { id: 'b', date: '2026-11-12', time: '15:00', title: '오후' },
        { id: 'c', date: '2026-11-12', time: '09:00', title: '오전' },
        { id: 'd', date: '2026-11-01', title: '지난 일' },
        { id: 'e', date: '2026-11-10', end: '2026-11-13', title: '걸침' },
    ];
    const up = upcomingEvents(rows, '2026-11-12', 3).map((r) => r.id);
    check(up.join() === 'e,c,b', `다가오는 일정 순서가 이상합니다: ${up.join()}`);
    const y = yearProgress('2026-11-12');
    check(y.day === 316 && y.total === 365 && y.left === 49, `올해 날짜 계산이 이상합니다: ${JSON.stringify(y)}`);
    check(yearProgress('2028-12-31').day === 366 && yearProgress('2028-12-31').left === 0, '윤년 마지막 날 계산이 이상합니다.');
    const months = eventsByMonth([...rows, { date: '2025-11-03' }, { date: '' }], 2026);
    check(months[10] === 5 && months.reduce((a, b) => a + b, 0) === 5, `달별 일정 수가 이상합니다: ${months}`);
    const byDay = eventsByDay([...rows, { id: 'f', date: '2026-11-12', title: '종일' }], ['2026-11-12', '2026-11-13', '2026-11-14']);
    check(byDay.get('2026-11-12').map((r) => r.id).join() === 'c,b,e,f' && byDay.get('2026-11-13').map((r) => r.id).join() === 'e' && byDay.get('2026-11-14').length === 0, `달력 칸 일정 순서가 이상합니다: ${byDay.get('2026-11-12').map((r) => r.id)}`);
    const titled = titlesByMonth(rows, 2026, 2);
    check(titled[10].count === 5 && titled[10].top.map((r) => r.id).join() === 'd,e' && titled[0].count === 0, '일 년 위젯 달별 제목이 이상합니다.');
    const near = noticesNear([{ date: '2026-11-12', text: '  ' }, { date: '2026-11-13', text: '체육복' }], '2026-11-12', '2026-11-13');
    check(near.today === null && near.tomorrow?.text === '체육복', '빈 알림장을 오늘 알림장으로 보여 줍니다.');
}

/* 3) 날씨 */
{
    const asked = [];
    const fake = (body, ok = true) => async (url) => { asked.push(url); return { ok, status: ok ? 200 : 500, json: async () => body }; };
    check(knownPlace('아산시')?.name === '아산' && knownPlace('대구')?.name === '대구' && knownPlace('대구광역시')?.name === '대구', '자주 쓰는 지역 이름을 못 찾습니다(대구의 구를 떼면 안 됨).');
    const local = await findPlace('천안시', fake({}));
    check(local?.name === '천안' && asked.length === 0, '목록에 있는 지역을 바깥에 묻습니다.');
    const far = await findPlace('울릉', fake({ results: [{ name: '울릉', latitude: 37.48456, longitude: 130.90571 }] }));
    check(far?.lat === 37.48 && far?.lon === 130.91 && asked.length === 1, `지역 찾기 결과가 이상합니다: ${JSON.stringify(far)}`);
    check(asked[0].startsWith('https://geocoding-api.open-meteo.com/') && asked[0].includes('countryCode=KR') && asked[0].includes(encodeURIComponent('울릉')), `지역 찾기 주소가 이상합니다: ${asked[0]}`);
    check(await findPlace('없는곳', fake({ results: [] })) === null && await findPlace('가', fake({})) === null, '못 찾은 지역을 돌려줍니다.');
    const url = forecastUrl({ lat: 36.789123, lon: 127.001234 });
    check(url.startsWith('https://api.open-meteo.com/v1/forecast?') && url.includes('latitude=36.79') && url.includes('longitude=127') && !url.includes('36.789'), `예보 주소에 좌표를 그대로 보냅니다: ${url}`);
    check(url.includes('timezone=Asia%2FSeoul') && url.includes('forecast_days=3'), '예보 주소에 시간대·날 수가 없습니다.');
    check(weatherText(0).label === '맑음' && weatherText(63).label === '비' && weatherText(73).label === '눈' && weatherText(95).label === '뇌우' && weatherText(null).label, '날씨 코드 글이 이상합니다.');
    check(shapeForecast({}) === null && shapeForecast({ current: { temperature_2m: 'x' } }) === null, '모양이 이상한 예보를 받아들입니다.');
    const body = { current: { temperature_2m: 9.4, apparent_temperature: 6.6, weather_code: 2 }, daily: { time: ['2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15'], weather_code: [2, 61, 0, 0], temperature_2m_max: [14, 11, 13, 1], temperature_2m_min: [3, 5, 1, 0], precipitation_probability_max: [10, 80, 0, 0] } };
    const store = memory();
    const place = { name: '아산', lat: 36.79, lon: 127 };
    writePlace(place, store);
    check(readPlace(store)?.name === '아산', '고른 지역을 기억하지 못합니다.');
    const t0 = 1_800_000_000_000;
    asked.length = 0;
    const first = await loadWeather(place, { fetcher: fake(body), now: t0, storage: store });
    check(first.data?.temp === 9 && first.data.feels === 7 && first.data.days.length === 3 && asked.length === 1, `예보를 줄이는 모양이 이상합니다: ${JSON.stringify(first.data)}`);
    await loadWeather(place, { fetcher: fake(body), now: t0 + WEATHER_TTL_MS - 1000, storage: store });
    check(asked.length === 1, '30분 안에 다시 받습니다.');
    await loadWeather(place, { fetcher: fake(body), now: t0 + WEATHER_TTL_MS + 1000, storage: store });
    check(asked.length === 2, '30분이 지나도 새로 받지 않습니다.');
    const failed = await loadWeather(place, { fetcher: fake({}, false), now: t0 + 3 * WEATHER_TTL_MS, storage: store });
    check(failed.error && failed.data?.temp === 9, '받지 못했을 때 예전 값을 보여 주지 않습니다.');
    const other = await loadWeather({ name: '제주', lat: 33.5, lon: 126.53 }, { fetcher: fake({}, false), now: t0, storage: store });
    check(other.data === null && other.error, '다른 지역에 예전 지역 날씨를 보여 줍니다.');
    writePlace(null, store);
    check(readPlace(store) === null && !store.map.has('ssug-gyomu-weather'), '지역을 지워도 받은 날씨가 남습니다.');
    check([...store.map.keys()].every((k) => k.startsWith('ssug-gyomu')), '날씨 저장 키가 ssug-gyomu 로 시작하지 않습니다.');
}

/* 4) 연결 */
{
    const app = readFileSync('src/App.jsx', 'utf8');
    check(/matchMedia\('\(min-width: 900px\)'\)/.test(app) && app.includes('const showBoard = wideScreen && boardOn;'), '위젯판이 넓은 화면에서만 열리지 않습니다.');
    check(app.includes("route.name === 'today' && wideScreen") && app.includes('data-role="widget-toggle"'), '오늘 화면 위쪽에 위젯 전환 단추가 없습니다.');
    const cloud = ['src/lib/cloud.js', 'src/lib/cloudShape.js', 'src/lib/db.js', 'firestore.rules'].map((f) => readFileSync(f, 'utf8')).join('\n');
    check(!/ssug-gyomu-widget|ssug-gyomu-weather|open-meteo/.test(cloud), '위젯 설정이나 날씨가 클라우드·저장 모듈에 섞였습니다.');
    const board = readFileSync('src/ui/WidgetBoard.jsx', 'utf8');
    check(!/<select|type="checkbox"/.test(board), '위젯 꾸미기에 드롭다운이나 체크박스가 있습니다.');
    check(board.includes('Open-Meteo') && board.includes('지역 이름과 좌표만'), '날씨가 무엇을 보내는지 화면에 적혀 있지 않습니다.');
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('위젯판·날씨 검사를 통과했습니다.');
