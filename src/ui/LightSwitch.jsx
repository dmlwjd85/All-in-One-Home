import { Btn } from './bits.jsx';
import './lightSwitch.css';

/** 밝게·어둡게 단추를 교실 벽 전등 스위치로. 밝은 화면 = 불 켬(스위치 위로), 어두운 화면 = 불 끔(아래로, 꺼진 스위치의 주황 표시등).
    누르면 형광등이 켜지듯 깜빡이거나(켤 때) 스르르 어두워집니다(끌 때). 움직임 줄이기 설정이면 효과 없이 바로 바뀝니다. */
export function LightSwitch({ dark, onToggle }) {
    const label = dark ? '교실 불 켜기(밝게)' : '교실 불 끄기(어둡게)';
    return (
        <Btn
            className={`icon-btn light-switch${dark ? ' is-off' : ' is-on'}`}
            aria-label={label}
            title={label}
            data-on={dark ? '0' : '1'}
            data-role="light-switch"
            onClick={() => { roomFx(dark ? 'on' : 'off'); onToggle(); }}
        >
            <svg className="ls-svg" viewBox="0 0 28 36" aria-hidden="true">
                <rect className="ls-plate" x="1" y="1" width="26" height="34" rx="5" />
                <rect className="ls-well" x="7" y="6" width="14" height="24" rx="3" />
                <g className="ls-lever">
                    <rect className="ls-key" x="8.2" y="7.2" width="11.6" height="21.6" rx="2.4" />
                    <rect className="ls-key-hi" x="8.2" y="7.2" width="11.6" height="10.8" rx="2.4" />
                </g>
                <circle className="ls-led" cx="14" cy="32.2" r="1.3" />
            </svg>
        </Btn>
    );
}

/** 방 전체에 잠깐 덮는 빛 효과. 화면 바뀜 자체는 테마가 합니다. */
function roomFx(kind) {
    try {
        if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
        const old = document.querySelector('.room-fx');
        old?.remove();
        const el = document.createElement('div');
        el.className = `room-fx is-${kind}`;
        el.setAttribute('aria-hidden', 'true');
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 900);
    } catch { /* 효과가 없어도 밝기는 바뀝니다 */ }
}
