import { forwardRef } from 'react';

export function Btn({ className = '', block = false, ...props }) {
    return <button type="button" className={`tap ${block ? 'block' : ''} ${className}`} {...props} />;
}

export function Field(props) {
    return <input className="field" {...props} />;
}

export const Area = forwardRef(function Area(props, ref) {
    return <textarea ref={ref} className="field" {...props} />;
});

export function Symbol({ label = '메뉴' }) {
    return <span className="symbol" aria-hidden="true">{label === '메뉴' ? '콕' : label}</span>;
}

/** 하단 버튼 '콕'. Pretendard Bold(굵기 700) U+CF55 윤곽을 패스로 옮겼습니다.
    Copyright (c) 2021, Kil Hyung-jin (https://github.com/orioncactus/pretendard),
    with Reserved Font Name Pretendard.
    SIL Open Font License 1.1. 전문은 public/fonts/OFL-Pretendard.txt
    글꼴 파일을 더 받지 않고 패스만 넣어 오프라인에서도 같습니다. */
export function KokMark() {
    return (
        <svg className="kok-mark" viewBox="0 0 1669 1790" aria-hidden="true" focusable="false">
            <path fill="currentColor" d="M1356 213H194V8H1356ZM1661 1036H8V834H1661ZM882 979H625V629H882ZM1423 759 1171 743Q1194 636 1205 541Q1216 446 1218.5 371Q1221 296 1221 178V8H1474V178Q1474 296 1471.5 374.5Q1469 453 1457.5 552Q1446 651 1423 759ZM1462 1782H1208V1373H177V1174H1462ZM175 565 144 358 1297 333V518Z" />
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
