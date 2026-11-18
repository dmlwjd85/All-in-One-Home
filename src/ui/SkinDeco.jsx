import { useEffect, useState } from 'react';
import flagFrame from './skin/bg/flag-frame.webp';
import mottoFrame from './skin/bg/motto-frame.webp';
import wallSpeaker from './skin/bg/wall-speaker.webp';
import { clockAngles } from './skin.js';

const TICKS = Array.from({ length: 12 }, (_, i) => i);

/** 실제로 가는 벽시계. 기기 시각을 따라 1초마다 바늘을 옮깁니다(화면이 가려져 있으면 쉬고, 다시 보이면 바로 맞춥니다). */
function SkinClock() {
    const [now, setNow] = useState(() => new Date());
    useEffect(() => {
        let timer = 0;
        const tick = () => {
            setNow(new Date());
            timer = window.setTimeout(tick, 1000 - (Date.now() % 1000) + 5);
        };
        const onVisible = () => {
            window.clearTimeout(timer);
            if (!document.hidden) tick();
        };
        tick();
        document.addEventListener('visibilitychange', onVisible);
        return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', onVisible); };
    }, []);
    const angle = clockAngles(now);
    return (
        <svg className="skin-prop skin-clock" data-prop="clock" viewBox="0 0 100 100" focusable="false">
            <defs>
                <radialGradient id="skinClockRim" cx="35%" cy="28%" r="80%">
                    <stop offset="0" stopColor="#A9743F" />
                    <stop offset="0.6" stopColor="#7A4B22" />
                    <stop offset="1" stopColor="#4E2E14" />
                </radialGradient>
                <radialGradient id="skinClockFace" cx="42%" cy="34%" r="75%">
                    <stop offset="0" stopColor="#FFFDF4" />
                    <stop offset="0.7" stopColor="#F3E8CF" />
                    <stop offset="1" stopColor="#DCCBA6" />
                </radialGradient>
            </defs>
            <circle cx="50" cy="50" r="48" fill="url(#skinClockRim)" />
            <circle cx="50" cy="50" r="48" fill="none" stroke="#3A2210" strokeWidth="1.5" />
            <circle cx="50" cy="50" r="39.5" fill="url(#skinClockFace)" stroke="#3F2610" strokeWidth="2" />
            <path d="M22 34a32 32 0 0 1 30-18" fill="none" stroke="#FFFFFF" strokeOpacity="0.55" strokeWidth="2.5" strokeLinecap="round" />
            {TICKS.map((i) => (
                <line key={i} x1="50" y1={i % 3 === 0 ? 15 : 16.5} x2="50" y2={i % 3 === 0 ? 22 : 20} stroke="#2B2118" strokeWidth={i % 3 === 0 ? 2.6 : 1.4} strokeLinecap="round" transform={`rotate(${i * 30} 50 50)`} />
            ))}
            <line data-hand="hour" x1="50" y1="55" x2="50" y2="30" stroke="#2B2118" strokeWidth="4.2" strokeLinecap="round" transform={`rotate(${angle.hour} 50 50)`} />
            <line data-hand="minute" x1="50" y1="57" x2="50" y2="19" stroke="#2B2118" strokeWidth="2.8" strokeLinecap="round" transform={`rotate(${angle.minute} 50 50)`} />
            <line data-hand="second" x1="50" y1="61" x2="50" y2="16" stroke="#B4233A" strokeWidth="1.3" strokeLinecap="round" transform={`rotate(${angle.second} 50 50)`} />
            <circle cx="50" cy="50" r="3.2" fill="#B4233A" stroke="#2B2118" strokeWidth="1" />
        </svg>
    );
}

/** 교실 소품. data-skin="cork" 일 때만 붙습니다. 클릭은 통과합니다. */
export function SkinDeco() {
    const [on, setOn] = useState(() => typeof document !== 'undefined' && document.documentElement.getAttribute('data-skin') === 'cork');
    useEffect(() => {
        const root = document.documentElement;
        const sync = () => setOn(root.getAttribute('data-skin') === 'cork');
        const obs = new MutationObserver(sync);
        obs.observe(root, { attributes: true, attributeFilter: ['data-skin'] });
        sync();
        return () => obs.disconnect();
    }, []);
    if (!on) return null;
    return (
        <div className="skin-deco" aria-hidden="true">
            <div className="skin-wall">
                <img className="skin-prop" data-prop="speaker" src={wallSpeaker} alt="" loading="lazy" decoding="async" />
                <img className="skin-flag skin-flag-mark" src={flagFrame} alt="" decoding="async" />
                <div className="skin-motto">
                    <img className="skin-motto-frame" src={mottoFrame} alt="" decoding="async" />
                    <span className="skin-motto-text title-font">서로 돕고 함께 자라는 우리 반</span>
                </div>
                <SkinClock />
            </div>
            <div className="skin-tray" />
        </div>
    );
}
