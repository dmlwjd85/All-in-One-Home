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
    return <span className="symbol" aria-hidden="true">{label === '메뉴' ? '쓱' : label}</span>;
}

/** 파스텔 하늘 클레이 앱 아이콘에는 글자가 없습니다.
    쓱 가계부 앱 아이콘(favicon)의 '쓱' 획을 그대로 둡니다. 글꼴 파일 없이 보여서 오프라인에서도 같습니다. */
export function SsugMark() {
    return (
        <svg className="ssug-mark" viewBox="-18.75 -14.5 139.5 139.5" aria-hidden="true" focusable="false">
            <path d="M15 28 Q22.5 10 28 7 Q33.5 10 41 28 M61 28 Q68.5 10 74 7 Q79.5 10 87 28" fill="none" stroke="currentColor" strokeWidth="16" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 49 Q51 63 93 49" fill="none" stroke="currentColor" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M21 78 H70 Q81 78 81 89 V103" fill="none" stroke="currentColor" strokeWidth="17" strokeLinecap="round" strokeLinejoin="round" />
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
