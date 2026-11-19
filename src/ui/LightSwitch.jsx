import { Btn } from './bits.jsx';
import './lightSwitch.css';

/** 밝게·어둡게 단추를 교실 벽 전등 스위치로(그림 아래 작은 ON/OFF). 밝은 화면 = 불 켬(스위치 위로), 어두운 화면 = 불 끔(아래로, 꺼진 스위치의 주황 표시등).
    누르면 형광등이 켜지듯 깜빡이거나(켤 때) 스르르 어두워집니다(끌 때). 움직임 줄이기 설정이면 효과 없이 바로 바뀝니다. */
export function LightSwitch({ dark, onToggle }) {
    const label = dark ? '교실 불 켜기(밝게)' : '교실 불 끄기(어둡게)';
    return (
        <Btn
            className={`icon-btn light-switch${dark ? ' ls-off' : ' ls-on'}`}
            aria-label={label}
            title={label}
            data-on={dark ? '0' : '1'}
            data-role="light-switch"
            onClick={() => { roomFx(dark ? 'on' : 'off'); onToggle(); }}
        >
            {/* 옆 단추(찾기·설정)와 같은 선 그림: 20px, 선 굵기 2, 글자색(currentColor). 누름쇠가 위면 켬, 아래면 끔. */}
            <svg className="ls-svg" width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="5" y="2" width="14" height="20" rx="3" />
                <rect className="ls-lever" x="9" y={dark ? 12 : 6} width="6" height="6" rx="1.5" fill="currentColor" />
                {dark && <circle className="ls-led" cx="12" cy="7.5" r="1.2" stroke="none" />}
            </svg>
            <span className="ls-word" aria-hidden="true">{dark ? 'OFF' : 'ON'}</span>
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
