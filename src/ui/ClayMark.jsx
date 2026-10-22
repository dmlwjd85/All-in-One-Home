/** 빈 화면과 저장 완료에만 쓰는 작은 클레이 장면. */
export function ClayMark({ compact = false }) {
    const width = compact ? 36 : 168;
    const height = compact ? 36 : 126;
    return (
        <svg className={compact ? 'clay-mark clay-mark-sm' : 'clay-mark'} width={width} height={height} viewBox="0 0 168 126" aria-hidden="true">
            <ellipse cx="84" cy="112" rx="58" ry="8" fill="rgba(43,51,80,.12)" />
            <ellipse cx="84" cy="108" rx="54" ry="6" fill="rgba(91,91,214,.10)" />
            <rect x="78" y="28" width="72" height="58" rx="16" fill="#C9B8F0" />
            <rect x="84" y="34" width="60" height="46" rx="12" fill="#FFF8E7" />
            <path d="M86 40c6 4 8 4 14 0M86 48c6 4 8 4 14 0M86 56c6 4 8 4 14 0" fill="none" stroke="#C9B8F0" strokeWidth="3" strokeLinecap="round" />
            <path d="M132 46c8 2 12 8 12 16" fill="none" stroke="#E38A9A" strokeWidth="4" strokeLinecap="round" />
            <path d="M130 62c6 1 10 6 10 12" fill="none" stroke="#C9B8F0" strokeWidth="4" strokeLinecap="round" />
            <rect x="28" y="36" width="70" height="64" rx="22" fill="#8EC4F0" />
            <rect x="36" y="24" width="22" height="18" rx="10" fill="#7EB6E8" />
            <rect x="40" y="48" width="46" height="28" rx="10" fill="#B9D9F6" />
            <path d="M48 62h30" stroke="#5B5BD6" strokeWidth="3" strokeLinecap="round" />
            <path d="M63 55v14" stroke="#5B5BD6" strokeWidth="3" strokeLinecap="round" />
            <path d="M63 48l5 6h-10z" fill="#F2C14E" />
            <circle cx="118" cy="78" r="22" fill="#E15D4C" />
            <ellipse cx="112" cy="72" rx="6" ry="4" fill="rgba(255,255,255,.35)" />
            <path d="M118 62c2-10 10-14 16-12" fill="none" stroke="#6FA86A" strokeWidth="4" strokeLinecap="round" />
            <ellipse cx="128" cy="52" rx="8" ry="5" transform="rotate(-30 128 52)" fill="#7FBE78" />
            <circle cx="110" cy="76" r="2" fill="#2B3350" />
            <circle cx="124" cy="76" r="2" fill="#2B3350" />
            <path d="M112 84c4 4 10 4 14 0" fill="none" stroke="#2B3350" strokeWidth="2" strokeLinecap="round" />
            <circle cx="106" cy="84" r="2.5" fill="#F3B7B4" />
            <circle cx="130" cy="84" r="2.5" fill="#F3B7B4" />
        </svg>
    );
}
