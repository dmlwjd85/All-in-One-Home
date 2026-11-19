import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { weekdayKo } from '../lib/date.js';
import { QUICK_PLACES, WEATHER_PLACE_EVENT, findPlace, knownPlace, loadWeather, readPlace, weatherText, writePlace } from '../lib/weather.js';
import { Btn, Field } from './bits.jsx';
import './topWeather.css';

/** 오늘 화면 맨 위 날짜 칸 안의 날씨. 누르면 바로 지역 고르기 창이 뜹니다.
    지역·예보는 이 기기에만 둡니다(날씨 위젯과 같은 자리). 지역을 정하기 전에는 바깥에 아무것도 묻지 않습니다. */
export function TopWeather() {
    const [place, setPlace] = useState(() => readPlace());
    const [state, setState] = useState({ data: null, error: '', busy: false });
    const [open, setOpen] = useState(false);
    const placeId = place ? `${place.lat},${place.lon}` : '';

    useEffect(() => {
        const sync = () => setPlace(readPlace());
        window.addEventListener(WEATHER_PLACE_EVENT, sync);
        return () => window.removeEventListener(WEATHER_PLACE_EVENT, sync);
    }, []);

    useEffect(() => {
        if (!place) { setState({ data: null, error: '', busy: false }); return undefined; }
        let alive = true;
        const run = () => {
            setState((s) => ({ ...s, busy: true }));
            loadWeather(place).then((res) => { if (alive) setState({ data: res.data, error: res.error, busy: false }); });
        };
        run();
        /* 화면을 띄워 둔 동안 30분마다(그 사이에는 이 기기에 둔 값) */
        const timer = setInterval(run, 30 * 60 * 1000);
        return () => { alive = false; clearInterval(timer); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [placeId]);

    const now = state.data ? weatherText(state.data.code) : null;
    const label = !place ? '날씨, 지역 고르기'
        : now ? `${place.name} 날씨 ${now.label} ${state.data.temp}도, 지역 바꾸기`
            : `${place.name} 날씨, 지역 바꾸기`;
    return (
        <>
            <Btn className="top-weather" data-role="top-weather" aria-label={label} aria-haspopup="dialog" onClick={() => setOpen(true)}>
                <span className="tw-pill">
                    <span className="tw-ico" aria-hidden="true">{now ? now.icon : '🌤️'}</span>
                    {place && now ? (
                        <span className="tw-text"><b className="tw-temp num">{state.data.temp}°</b><span className="tw-place">{place.name}<span className="tw-label"> · {now.label}</span></span></span>
                    ) : (
                        <span className="tw-text"><b className="tw-temp">날씨</b><span className="tw-place">{place ? (state.busy ? `${place.name} 받는 중` : place.name) : '지역 고르기'}</span></span>
                    )}
                </span>
            </Btn>
            {open && createPortal(<WeatherPicker place={place} data={state.data} error={state.error} onPick={(next) => { writePlace(next); setPlace(next); setOpen(false); }} onOff={() => { writePlace(null); setPlace(null); setOpen(false); }} onClose={() => setOpen(false)} />, document.body)}
        </>
    );
}

function WeatherPicker({ place, data, error, onPick, onOff, onClose }) {
    const [draft, setDraft] = useState('');
    const [asking, setAsking] = useState(false);
    const [note, setNote] = useState('');
    useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose(); };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [onClose]);

    async function search(event) {
        event.preventDefault();
        const name = draft.trim();
        if (!name) return;
        setAsking(true);
        setNote('');
        let found = null;
        try { found = await findPlace(name); } catch { found = null; }
        setAsking(false);
        if (found) onPick(found);
        else setNote(`'${name}'을(를) 찾지 못했어요. 시·군 이름으로 적어 주세요.`);
    }

    const now = data ? weatherText(data.code) : null;
    return (
        <div className="sheet-back tw-back" onClick={onClose}>
            <div className="sheet tw-sheet" role="dialog" aria-modal="true" aria-labelledby="tw-title" data-role="weather-picker" onClick={(event) => event.stopPropagation()}>
                <div className="tw-head">
                    <h2 id="tw-title" className="title-font">날씨 지역</h2>
                    <Btn className="icon-btn" aria-label="닫기" onClick={onClose}>✕</Btn>
                </div>
                {place && data && (
                    <div className="tw-now" data-role="weather-now">
                        <p className="tw-now-line"><span aria-hidden="true">{now.icon}</span> <b className="num">{data.temp}°</b> {now.label}{data.feels !== null ? <span className="muted"> · 체감 {data.feels}°</span> : null}<span className="muted"> · {place.name}</span></p>
                        <div className="tw-days">
                            {data.days.slice(0, 3).map((day, i) => {
                                const w = weatherText(day.code);
                                return (
                                    <span key={day.date} className="tw-day">
                                        <span className="tw-day-name">{i === 0 ? '오늘' : i === 1 ? '내일' : weekdayKo(day.date)}</span>
                                        <span aria-label={w.label}>{w.icon}</span>
                                        <span className="num">{Math.round(day.min)}°/{Math.round(day.max)}°</span>
                                        {Number.isFinite(day.rain) && <span className="muted num">☔{day.rain}%</span>}
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                )}
                {place && !data && <p className="muted" role="status">{error || '날씨를 받는 중이에요…'}</p>}
                <p className="tw-ask">{place ? '다른 지역을 누르면 바로 바뀌어요.' : '어느 지역 날씨를 볼까요? 누르면 바로 정해져요.'}</p>
                <div className="tw-places" role="group" aria-label="자주 고르는 지역">
                    {QUICK_PLACES.map((name) => {
                        const hit = knownPlace(name);
                        const on = place?.name === name;
                        return <Btn key={name} className={on ? 'chip on' : 'chip'} data-weather-place={name} onClick={() => hit && onPick(hit)}>{on ? `✓ ${name}` : name}</Btn>;
                    })}
                </div>
                <form className="tw-search" onSubmit={search}>
                    <Field id="tw-search" aria-label="지역 이름" value={draft} maxLength={30} placeholder="목록에 없으면 적어요. 예: 홍천" onChange={(event) => setDraft(event.target.value)} />
                    <Btn className="primary-btn" type="submit" disabled={asking || !draft.trim()}>{asking ? '찾는 중…' : '찾기'}</Btn>
                </form>
                {note && <p className="muted" role="status">{note}</p>}
                <div className="tw-foot">
                    <span className="muted">지역 이름과 좌표만 날씨 서비스(Open-Meteo)에 보내요. 고른 지역은 이 기기에만 둬요.</span>
                    {place && <Btn className="chip" data-role="weather-off" onClick={onOff}>지역 지우기</Btn>}
                </div>
            </div>
        </div>
    );
}
