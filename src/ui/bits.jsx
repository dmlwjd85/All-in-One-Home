import { forwardRef, useId } from 'react';
import { JJAEM_D, JJAEM_PLACE, JJAEM_STOPS } from './jjaemMark.js';

export function Btn({ className = '', block = false, ...props }) {
    return <button type="button" className={`tap ${block ? 'block' : ''} ${className}`} {...props} />;
}

export function Field(props) {
    return <input className="field" {...props} />;
}

export const Area = forwardRef(function Area(props, ref) {
    return <textarea ref={ref} className="field" {...props} />;
});

/** 헤더·잠금·시작 화면의 로고. 앱 아이콘과 같은 라일락 판, 같은 쨈 외곽선입니다. */
export function Symbol() {
    const id = `jjaem${useId().replace(/:/g, '')}`;
    return (
        <svg className="brand-symbol" viewBox="0 0 512 512" aria-hidden="true" focusable="false">
            <defs>
                <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
                    {JJAEM_STOPS.map((color, index) => <stop key={color} offset={index === 0 ? '0' : index === 1 ? '0.55' : '1'} stopColor={color} />)}
                </linearGradient>
            </defs>
            <rect width="512" height="512" rx="114" fill={`url(#${id})`} />
            <g transform={JJAEM_PLACE}>
                <g transform="translate(-13 1638) scale(1 -1)">
                    <path fill="#fff" d={JJAEM_D} />
                </g>
            </g>
        </svg>
    );
}

/** 하단 버튼 '콕'. 가계부와 같은 윤곽입니다.
    Pretendard Bold 1.3.9 U+CF55, x' = x − 58, y' = 1596 − y.
    Copyright (c) 2021, Kil Hyung-jin (https://github.com/orioncactus/pretendard),
    with Reserved Font Name Pretendard.
    SIL Open Font License 1.1. 전문은 public/fonts/OFL-Pretendard.txt
    글꼴 파일을 더 받지 않고 패스만 넣어 오프라인에서도 같습니다. */
export function KokMark() {
    return (
        <svg className="kok-mark" viewBox="0 0 1652 1774" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M1466 0H186V206H1214L1212 326L136 350L168 558L1198 514C1191 581 1179 654 1162 734L1414 750C1466 518 1466 340 1466 170ZM1652 826H874V622H618V826H0V1028H1652ZM1454 1166H168V1366H1200V1774H1454Z" />
        </svg>
    );
}

export function IconMenu() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
    );
}

export function IconSearch() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
        </svg>
    );
}

export function IconMoon() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">
            <path d="M16.5 2.5a9 9 0 1 0 5 12.5 7.5 7.5 0 0 1-5-12.5z" />
        </svg>
    );
}

export function IconSettings() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
        </svg>
    );
}

export function IconTrash() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16" />
            <path d="M9 7V5h6v2" />
            <path d="M7 7l1 13h8l1-13" />
        </svg>
    );
}

export function IconSun() {
    return (
        <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" />
        </svg>
    );
}

export const KINDS = [
    { id: '관찰', emoji: '👀', label: '관찰' },
    { id: '상담', emoji: '💬', label: '상담' },
    { id: '할 일', emoji: '✅', label: '할 일' },
    { id: '일정', emoji: '📅', label: '일정' },
    { id: '알림장', emoji: '📢', label: '알림장' },
    { id: '메모', emoji: '📝', label: '메모' },
    { id: '칭찬', emoji: '🌟', label: '칭찬' },
    { id: '보호자', emoji: '👪', label: '보호자' },
];

export const HOME_KINDS = KINDS.slice(0, 6);

export const TAGS = {
    관찰: ['학습', '교우', '칭찬', '생활', '진로'],
    상담: ['교우', '학습', '가정', '진로', '마음'],
    보호자: ['전화', '방문', '문자'],
    칭찬: ['학습', '생활', '교우'],
};

export function HoldToggle({ held, onToggle }) {
    return (
        <div>
            <p className="muted" style={{ margin: '8px 0 0' }}>
                {held ? '정리함에 둡니다. 할 일 화면에서 다시 등록하거나 지울 수 있어요.' : '이번 저장에 넣어요.'}
            </p>
            <Btn className={held ? 'chip block' : 'chip on block'} style={{ marginTop: 8 }} onClick={onToggle}>{held ? '지금 저장' : '나중에 정리'}</Btn>
        </div>
    );
}

export function studentName(students, sid) {
    return students.find((row) => row.id === sid)?.name || '';
}

export function givenName(name) {
    const text = String(name || '');
    const two = ['남궁', '황보', '제갈', '사공', '선우', '독고'];
    if (two.some((item) => text.startsWith(item))) return text.slice(2) || text;
    return text.length > 2 ? text.slice(1) : text;
}

export function statusColor(status) {
    if (status === '결석') return 'var(--st-absent)';
    if (status === '지각') return 'var(--st-late)';
    if (status === '조퇴') return 'var(--st-early)';
    if (status === '결과') return 'var(--st-out)';
    return 'var(--st-present)';
}

export function statusBg(status) {
    if (status === '결석') return 'var(--st-absent-bg)';
    if (status === '지각') return 'var(--st-late-bg)';
    if (status === '조퇴') return 'var(--st-early-bg)';
    if (status === '결과') return 'var(--st-out-bg)';
    return 'transparent';
}
