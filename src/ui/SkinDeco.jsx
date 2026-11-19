import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import flagFrame from './skin/bg/flag-frame.webp';
import mottoFrame from './skin/bg/motto-frame.webp';
import wallSpeaker from './skin/bg/wall-speaker.webp';
import { MOTTO_EVENT, clockAngles, skinMotto } from './skin.js';

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

/** 급훈 글자를 액자 안쪽 판에 꽉 차게: 한 줄과 두 줄 가운데 글자가 더 커지는 쪽으로, 판에 맞는 가장 큰 크기를 찾습니다.
    판 크기가 바뀌거나(화면 폭) 글꼴이 바뀌거나(설정 › 화면) 글꼴 파일이 늦게 와도 다시 맞춥니다. */
export function fitMotto(box, inner) {
    if (!box || !inner) return null;
    const cs = getComputedStyle(box);
    const width = box.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0);
    const height = box.clientHeight;
    if (width <= 0 || height <= 0) return null;
    const fits = () => inner.scrollWidth <= width + 0.5 && inner.offsetHeight <= height + 0.5;
    const tryWrap = (wrap) => {
        inner.style.whiteSpace = wrap ? 'normal' : 'nowrap';
        let lo = 6;
        let hi = Math.max(6, Math.floor(height * (wrap ? 0.5 : 0.8)));
        while (lo < hi) {
            const mid = Math.ceil((lo + hi) / 2);
            inner.style.fontSize = `${mid}px`;
            if (fits()) lo = mid; else hi = mid - 1;
        }
        return lo;
    };
    const one = tryWrap(false);
    const two = Array.from(inner.textContent || '').length > 6 ? tryWrap(true) : 0;
    /* 두 줄은 한 줄보다 15% 넘게 커질 때만: 한 줄이 더 읽기 쉽습니다. */
    const wrap = two > one * 1.15;
    inner.style.whiteSpace = wrap ? 'normal' : 'nowrap';
    inner.style.fontSize = `${wrap ? two : one}px`;
    return { size: wrap ? two : one, wrap };
}

function MottoText({ text }) {
    const box = useRef(null);
    const inner = useRef(null);
    useLayoutEffect(() => {
        const run = () => fitMotto(box.current, inner.current);
        run();
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(run);
        if (box.current) ro?.observe(box.current);
        const mo = new MutationObserver(run);
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-font', 'class'] });
        document.fonts?.ready?.then(run).catch(() => {});
        document.fonts?.addEventListener?.('loadingdone', run);
        return () => { ro?.disconnect(); mo.disconnect(); document.fonts?.removeEventListener?.('loadingdone', run); };
    }, [text]);
    return (
        <span ref={box} className="skin-motto-text title-font">
            <span ref={inner} className="skin-motto-fit">{text}</span>
        </span>
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
    const [motto, setMotto] = useState(() => skinMotto());
    useEffect(() => {
        const sync = () => setMotto(skinMotto());
        window.addEventListener(MOTTO_EVENT, sync);
        window.addEventListener('storage', sync);
        return () => {
            window.removeEventListener(MOTTO_EVENT, sync);
            window.removeEventListener('storage', sync);
        };
    }, []);
    if (!on) return null;
    return (
        <div className="skin-deco" aria-hidden="true">
            <div className="skin-wall">
                <img className="skin-prop" data-prop="speaker" src={wallSpeaker} alt="" loading="lazy" decoding="async" />
                <img className="skin-flag skin-flag-mark" src={flagFrame} alt="" decoding="async" />
                <div className="skin-motto" style={{ '--motto-frame': `url(${mottoFrame})` }}>
                    <span className="skin-motto-frame" />
                    <MottoText text={motto} />
                </div>
                <SkinClock />
            </div>
            <div className="skin-tray" />
        </div>
    );
}
