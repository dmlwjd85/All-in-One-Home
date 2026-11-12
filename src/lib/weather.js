/*
 * 날씨 위젯. Open-Meteo(키 없음)에서 받습니다.
 * - 바깥에 보내는 것: 지역을 찾을 때 그 지역 이름, 예보를 받을 때 소수 둘째 자리까지 줄인 좌표뿐입니다.
 *   학급·학생 자료나 계정은 보내지 않습니다.
 * - 고른 지역과 받은 예보는 이 기기에만 둡니다(클라우드에 올리지 않음). 예보는 30분 동안 다시 받지 않습니다.
 */
export const WEATHER_PLACE_KEY = 'ssug-gyomu-weather-place';
export const WEATHER_CACHE_KEY = 'ssug-gyomu-weather';
export const WEATHER_TTL_MS = 30 * 60 * 1000;
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

/* 자주 쓰는 지역은 바깥에 묻지 않고 바로 찾습니다(이름 → 위도, 경도). */
const PLACES = {
    서울: [37.57, 126.98], 부산: [35.18, 129.08], 대구: [35.87, 128.6], 인천: [37.46, 126.71], 광주: [35.16, 126.85],
    대전: [36.35, 127.38], 울산: [35.54, 129.31], 세종: [36.48, 127.29], 수원: [37.26, 127.03], 성남: [37.42, 127.13],
    고양: [37.66, 126.83], 용인: [37.24, 127.18], 부천: [37.5, 126.78], 안산: [37.32, 126.83], 안양: [37.39, 126.92],
    화성: [37.2, 126.83], 평택: [36.99, 127.11], 의정부: [37.74, 127.03], 파주: [37.76, 126.78], 김포: [37.62, 126.72],
    남양주: [37.64, 127.22], 춘천: [37.88, 127.73], 원주: [37.34, 127.92], 강릉: [37.75, 128.88], 속초: [38.21, 128.59],
    청주: [36.64, 127.49], 충주: [36.99, 127.93], 제천: [37.13, 128.19], 천안: [36.82, 127.11], 아산: [36.79, 127.0],
    공주: [36.45, 127.12], 서산: [36.78, 126.45], 당진: [36.89, 126.65], 논산: [36.19, 127.1], 보령: [36.33, 126.61],
    홍성: [36.6, 126.66], 예산: [36.68, 126.85], 전주: [35.82, 127.15], 익산: [35.95, 126.96], 군산: [35.97, 126.74],
    목포: [34.81, 126.39], 여수: [34.76, 127.66], 순천: [34.95, 127.49], 포항: [36.02, 129.34], 경주: [35.86, 129.22],
    구미: [36.12, 128.34], 안동: [36.57, 128.73], 창원: [35.23, 128.68], 진주: [35.18, 128.11], 김해: [35.23, 128.89],
    양산: [35.34, 129.04], 거제: [34.88, 128.62], 제주: [33.5, 126.53], 서귀포: [33.25, 126.56],
};

/** '아산시', ' 아산 ' → '아산'. 이름 그대로 목록에 있으면(대구·광주) 떼지 않고, 없을 때만 끝의 시·군·구 등을 뗍니다. */
export function placeKey(name) {
    const compact = String(name || '').replace(/\s+/g, '');
    if (PLACES[compact]) return compact;
    return compact.replace(/(특별자치시|특별자치도|특별시|광역시|시|군|구)$/, '');
}

/** 이 기기 목록에서 찾습니다. 없으면 null. */
export function knownPlace(name) {
    const key = placeKey(name);
    const hit = PLACES[key];
    return hit ? { name: key, lat: hit[0], lon: hit[1] } : null;
}

function round2(n) { return Math.round(Number(n) * 100) / 100; }

async function getJson(url, fetcher, timeout = 8000) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0;
    try {
        const res = await fetcher(url, ctrl ? { signal: ctrl.signal } : undefined);
        if (!res?.ok) throw new Error(`HTTP ${res?.status}`);
        return await res.json();
    } finally {
        if (timer) clearTimeout(timer);
    }
}

/** 지역 이름으로 좌표를 찾습니다. 목록에 있으면 바깥에 묻지 않습니다. 못 찾으면 null. */
export async function findPlace(name, fetcher = globalThis.fetch) {
    const local = knownPlace(name);
    if (local) return local;
    const query = String(name || '').trim();
    if (query.length < 2 || typeof fetcher !== 'function') return null;
    const url = `${GEO_URL}?name=${encodeURIComponent(query)}&count=1&language=ko&countryCode=KR&format=json`;
    const data = await getJson(url, fetcher);
    const hit = Array.isArray(data?.results) ? data.results[0] : null;
    if (!hit || !Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) return null;
    return { name: String(hit.name || query).slice(0, 30), lat: round2(hit.latitude), lon: round2(hit.longitude) };
}

export function forecastUrl(place) {
    const params = [
        `latitude=${round2(place.lat)}`,
        `longitude=${round2(place.lon)}`,
        'current=temperature_2m,apparent_temperature,weather_code,precipitation',
        'daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
        'timezone=Asia%2FSeoul',
        'forecast_days=3',
    ];
    return `${FORECAST_URL}?${params.join('&')}`;
}

/** 날씨 코드(WMO) → 한국어와 그림 글자 */
export function weatherText(code) {
    const c = Number(code);
    if (c === 0) return { label: '맑음', icon: '☀️' };
    if (c === 1) return { label: '대체로 맑음', icon: '🌤️' };
    if (c === 2) return { label: '구름 조금', icon: '⛅' };
    if (c === 3) return { label: '흐림', icon: '☁️' };
    if (c === 45 || c === 48) return { label: '안개', icon: '🌫️' };
    if (c >= 51 && c <= 57) return { label: '이슬비', icon: '🌦️' };
    if (c >= 61 && c <= 67) return { label: '비', icon: '🌧️' };
    if ((c >= 71 && c <= 77) || c === 85 || c === 86) return { label: '눈', icon: '🌨️' };
    if (c >= 80 && c <= 82) return { label: '소나기', icon: '🌦️' };
    if (c >= 95) return { label: '뇌우', icon: '⛈️' };
    return { label: '날씨 정보 없음', icon: '🌡️' };
}

/** 받은 예보를 화면에 쓸 모양으로 줄입니다. 모양이 이상하면 null. */
export function shapeForecast(data) {
    const cur = data?.current;
    const daily = data?.daily;
    if (!cur || !Number.isFinite(cur.temperature_2m)) return null;
    const days = Array.isArray(daily?.time) ? daily.time.slice(0, 3).map((date, i) => ({
        date,
        code: daily.weather_code?.[i],
        max: daily.temperature_2m_max?.[i],
        min: daily.temperature_2m_min?.[i],
        rain: daily.precipitation_probability_max?.[i],
    })) : [];
    return {
        temp: Math.round(cur.temperature_2m),
        feels: Number.isFinite(cur.apparent_temperature) ? Math.round(cur.apparent_temperature) : null,
        code: cur.weather_code,
        days,
    };
}

function store(storage) {
    if (storage) return storage;
    try { return globalThis.localStorage || null; } catch { return null; }
}

export function readPlace(storage) {
    try {
        const p = JSON.parse(store(storage)?.getItem(WEATHER_PLACE_KEY) || 'null');
        return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? { name: String(p.name || '').slice(0, 30), lat: p.lat, lon: p.lon } : null;
    } catch {
        return null;
    }
}

export function writePlace(place, storage) {
    try {
        if (place) store(storage)?.setItem(WEATHER_PLACE_KEY, JSON.stringify({ name: place.name, lat: round2(place.lat), lon: round2(place.lon) }));
        else {
            store(storage)?.removeItem(WEATHER_PLACE_KEY);
            store(storage)?.removeItem(WEATHER_CACHE_KEY);
        }
    } catch { /* 못 적어도 이번 화면에서는 씁니다. */ }
}

function cacheKey(place) { return `${round2(place.lat)},${round2(place.lon)}`; }

export function readCachedWeather(place, now = Date.now(), storage) {
    try {
        const c = JSON.parse(store(storage)?.getItem(WEATHER_CACHE_KEY) || 'null');
        if (!c || c.key !== cacheKey(place) || !c.data) return null;
        return { data: c.data, at: c.at, fresh: now - c.at < WEATHER_TTL_MS };
    } catch {
        return null;
    }
}

/** 예보를 받습니다. 30분 안에 받은 게 있으면 그걸 씁니다. 받지 못하면 예전 값(있으면)과 error 를 돌려줍니다. */
export async function loadWeather(place, { fetcher = globalThis.fetch, now = Date.now(), storage, force = false } = {}) {
    if (!place) return { data: null, at: 0, error: '' };
    const cached = readCachedWeather(place, now, storage);
    if (cached?.fresh && !force) return { data: cached.data, at: cached.at, error: '' };
    try {
        const data = shapeForecast(await getJson(forecastUrl(place), fetcher));
        if (!data) throw new Error('shape');
        try { store(storage)?.setItem(WEATHER_CACHE_KEY, JSON.stringify({ key: cacheKey(place), at: now, data })); } catch { /* 저장 못 해도 보여 줍니다. */ }
        return { data, at: now, error: '' };
    } catch {
        return { data: cached?.data || null, at: cached?.at || 0, error: '날씨를 받지 못했어요.' };
    }
}
