import { useEffect, useState } from 'react';
import flagFrame from './skin/bg/flag-frame.webp';
import mottoFrame from './skin/bg/motto-frame.webp';
import wallSpeaker from './skin/bg/wall-speaker.webp';
import wallClock from './skin/bg/wall-clock.webp';

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
                <img className="skin-prop" data-prop="clock" src={wallClock} alt="" loading="lazy" decoding="async" />
            </div>
            <div className="skin-tray" />
        </div>
    );
}
