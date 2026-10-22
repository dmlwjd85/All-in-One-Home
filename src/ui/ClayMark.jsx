/** 빈 화면과 저장 순간에만 쓰는 클레이 일러스트. 글자는 넣지 않습니다. */
export function ClayMark({ size = 96 }) {
    return (
        <svg className="clay-mark" width={size} height={size} viewBox="0 0 160 160" aria-hidden="true">
            <rect x="8" y="8" width="144" height="144" rx="36" fill="#E7F2FC" />
            <rect x="78" y="28" width="62" height="74" rx="16" fill="#FFF8E7" stroke="#C9B8F0" strokeWidth="4" />
            <path d="M86 36c2 8 2 14 0 22M96 34c2 8 2 14 0 22M106 36c2 8 2 14 0 22" fill="none" stroke="#C9B8F0" strokeWidth="3" strokeLinecap="round" />
            <path d="M112 48c4 2 8 8 6 14 4 1 8 6 6 12" fill="none" stroke="#C9B8F0" strokeWidth="3" strokeLinecap="round" />
            <circle cx="118" cy="72" r="4" fill="#C9B8F0" />
            <rect x="28" y="48" width="70" height="82" rx="22" fill="#8EB6E8" />
            <rect x="40" y="78" width="46" height="36" rx="12" fill="#D7E8F8" />
            <path d="M52 62h22a12 12 0 0 1 0 24H52a8 8 0 0 1 0-16z" fill="#7AA6DC" />
            <path d="M63 58c0-10 8-16 14-16 4 8 4 16 2 22" fill="none" stroke="#6E98D0" strokeWidth="5" strokeLinecap="round" />
            <polygon points="63,84 66,92 75,92 68,97 71,106 63,100 55,106 58,97 51,92 60,92" fill="#E2B84A" />
            <circle cx="124" cy="112" r="22" fill="#E25B4A" />
            <path d="M124 90c2-8 10-12 16-8" fill="none" stroke="#6E9A52" strokeWidth="4" strokeLinecap="round" />
            <ellipse cx="132" cy="84" rx="8" ry="5" fill="#8FBF6A" transform="rotate(-28 132 84)" />
            <circle cx="116" cy="110" r="2.2" fill="#2B3350" />
            <circle cx="130" cy="110" r="2.2" fill="#2B3350" />
            <path d="M116 118c4 5 12 5 16 0" fill="none" stroke="#2B3350" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}
