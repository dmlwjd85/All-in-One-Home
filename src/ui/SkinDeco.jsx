import { useEffect, useState } from 'react';
import taegeukgiMark from './skin/taegeukgi-mark.svg';
import flagFrame from './skin/bg/flag-frame.webp';
import mottoFrame from './skin/bg/motto-frame.webp';
import wallSpeaker from './skin/bg/wall-speaker.webp';
import wallClock from './skin/bg/wall-clock.webp';
import trayChalk from './skin/bg/tray-chalk.webp';
import trayEraser from './skin/bg/tray-eraser.webp';

const WALL_PROPS = [
    ['speaker', wallSpeaker],
    ['clock', wallClock],
];

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
            <div className="skin-wall" />
            <div className="skin-flag">
                <img className="skin-flag-wood" src={flagFrame} alt="" decoding="async" />
                <img className="skin-flag-mark" src={taegeukgiMark} alt="" decoding="async" />
            </div>
            <div className="skin-motto">
                <img className="skin-motto-frame" src={mottoFrame} alt="" decoding="async" />
                <span className="skin-motto-text title-font">서로 돕고 함께 자라는 우리 반</span>
            </div>
            {WALL_PROPS.map(([id, src]) => (
                <img key={id} className="skin-prop" data-prop={id} src={src} alt="" loading="lazy" decoding="async" />
            ))}
            <div className="skin-tray">
                <img className="skin-tray-chalk" src={trayChalk} alt="" decoding="async" />
                <span className="skin-tray-mid" />
                <img className="skin-tray-eraser" src={trayEraser} alt="" decoding="async" />
            </div>
        </div>
    );
}
