import { createRoot } from 'react-dom/client';
import { TopWeather } from '../../src/ui/TopWeather.jsx';

/* 바깥 날씨 서비스 대신: 부른 주소를 적어 두고 정해진 예보를 돌려줍니다. */
window.__calls = [];
window.fetch = async (url) => {
    window.__calls.push(String(url));
    const body = String(url).includes('geocoding')
        ? { results: [{ name: '홍천군', latitude: 37.697, longitude: 127.889, country_code: 'KR', admin1: '강원특별자치도' }] }
        : { current: { temperature_2m: 3.4, apparent_temperature: 0.6, weather_code: 0 }, daily: { time: ['2026-11-20', '2026-11-21', '2026-11-22'], weather_code: [0, 61, 3], temperature_2m_max: [9, 7, 8], temperature_2m_min: [-1, 2, 0], precipitation_probability_max: [0, 70, 10] } };
    return { ok: true, status: 200, json: async () => body };
};
function App() {
    return (
        <header className="topbar">
            <div className="date-block has-weather">
                <span className="kicker"><span className="ky">2026년 </span>11월</span>
                <h1 className="title-font date-line"><span>20일</span><em>금요일</em></h1>
                <p className="muted">6학년 3반 · 오전 8:42</p>
                <TopWeather />
            </div>
        </header>
    );
}
createRoot(document.getElementById('root')).render(<App />);
window.__ready = true;
