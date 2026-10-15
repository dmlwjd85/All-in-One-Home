import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronLeft, ChevronRight, Search, Settings } from 'lucide-react';
import { VIEW_PAGES, menuKeyForPage } from '../routes.js';
import { hasMonthPage, monthPageFor, parts, shiftYm, today, weekPageFor, ymLabel } from './dates.js';
import SortChips from './SortChips.jsx';

const MORE = [
    { label: '표지', page: VIEW_PAGES.cover },
    { label: '새 학기 준비', page: VIEW_PAGES.prep },
    { label: '사용법', page: VIEW_PAGES.guide },
    { label: '태그', page: VIEW_PAGES.tags },
    { label: '학사 일정', page: VIEW_PAGES.schedule },
    { label: '시간표', page: VIEW_PAGES.timetable },
    { label: '학생 카드', page: VIEW_PAGES.cards },
    { label: '예산', page: VIEW_PAGES.budget },
];

/** 위쪽 한 줄 탭. 자주 가는 곳 줄은 두지 않습니다. */
export function tabsFor(pages) {
    const now = today();
    const { y, m } = parts(now);
    return [
        { key: 'home', label: '오늘', page: VIEW_PAGES.home },
        { key: 'month', label: '월간', page: monthPageFor(y, m) || VIEW_PAGES.year },
        { key: 'week', label: '주간', page: weekPageFor(now, pages) || VIEW_PAGES.weeks },
        { key: 'year', label: '연간', page: VIEW_PAGES.year },
        { key: 'day', label: '하루', page: VIEW_PAGES.days },
        { key: 'class', label: '학급', page: VIEW_PAGES.class },
        { key: 'students', label: '학생', page: VIEW_PAGES.students },
        { key: 'attend', label: '출결', page: VIEW_PAGES.attend },
        { key: 'counsel', label: '상담', page: VIEW_PAGES.counsel },
        { key: 'lesson', label: '수업', page: VIEW_PAGES.lesson },
        { key: 'work', label: '업무', page: VIEW_PAGES.work },
        { key: 'write', label: '쓱, 적', page: VIEW_PAGES.write },
        { key: 'notebook', label: '공책', page: VIEW_PAGES.notebook },
        { key: 'board', label: '칠판', page: VIEW_PAGES.board },
        { key: 'stickers', label: '스티커', page: VIEW_PAGES.stickers },
    ];
}

export function activeTab(page) {
    if (page === VIEW_PAGES.home) return 'home';
    const key = menuKeyForPage(page);
    if (['cover', 'home', 'tags', 'schedule'].includes(key)) return 'more';
    if (key === 'class' && page === VIEW_PAGES.timetable) return 'more';
    return key;
}

/** 지금 쪽이 가리키는 달. 달·주 쪽이 아니면 오늘의 달. */
export function monthOfPage(rec) {
    if (rec?.type === 'month' && rec.extra?.year) return { y: Number(rec.extra.year), m: Number(rec.extra.month) };
    if (rec?.type === 'week') {
        const hit = String(rec.extra?.range || '').match(/(\d{4})\.\s*(\d{1,2})\./);
        if (hit) return { y: Number(hit[1]), m: Number(hit[2]) };
    }
    const { y, m } = parts(today());
    return { y, m };
}

export default function DiaryTop({ page, pages, onGo, onSearch, onSettings, signedIn }) {
    const rec = pages?.[page - 1];
    const ym = monthOfPage(rec);
    const prev = shiftYm(ym.y, ym.m, -1);
    const next = shiftYm(ym.y, ym.m, 1);
    const tabs = tabsFor(pages);
    const on = activeTab(page);
    const [moreOpen, setMoreOpen] = useState(false);
    const navRef = useRef(null);
    const moreRef = useRef(null);
    const popRef = useRef(null);

    useLayoutEffect(() => {
        const nav = navRef.current;
        if (!nav) return undefined;
        // 더보기는 한 겹 더 감싸여 있어 offsetLeft가 탭 줄 기준이 아닙니다.
        const center = () => {
            const cur = nav.querySelector('[aria-current="page"]');
            if (!cur) return;
            const navRect = nav.getBoundingClientRect();
            const curRect = cur.getBoundingClientRect();
            const desired = navRect.left + (nav.clientWidth - curRect.width) / 2;
            const max = Math.max(0, nav.scrollWidth - nav.clientWidth);
            const next = Math.max(0, Math.min(max, nav.scrollLeft + (curRect.left - desired)));
            if (Math.abs(next - nav.scrollLeft) > 1) nav.scrollLeft = next;
        };
        center();
        const watch = new ResizeObserver(center);
        watch.observe(nav);
        const cur = nav.querySelector('[aria-current="page"]');
        if (cur) watch.observe(cur);
        return () => watch.disconnect();
    }, [on]);

    useEffect(() => { setMoreOpen(false); }, [page]);
    useEffect(() => {
        if (!moreOpen) return undefined;
        const close = (e) => {
            if (moreRef.current?.contains(e.target) || popRef.current?.contains(e.target)) return;
            setMoreOpen(false);
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [moreOpen]);

    const goMonth = (t) => {
        const dest = monthPageFor(t.y, t.m);
        if (dest) onGo(dest);
    };

    return (
        <header className="dy-top">
            <div className="dy-bar">
                <button type="button" className="dy-brand" onClick={() => onGo(VIEW_PAGES.home)} aria-label="오늘로">
                    <span className="dy-brand-dot" aria-hidden="true" />
                    <span>교무수첩</span>
                </button>
                <div className="dy-month" role="group" aria-label="달 이동">
                    <button type="button" className="dy-arrow" onClick={() => goMonth(prev)} disabled={!hasMonthPage(prev.y, prev.m)} aria-label="이전 달">
                        <ChevronLeft size={20} strokeWidth={1.8} />
                    </button>
                    <button type="button" className="dy-month-label" onClick={() => goMonth(ym)} aria-label={`${ym.y}년 ${ym.m}월 월간 보기`}>
                        {ymLabel(ym.y, ym.m)}
                    </button>
                    <button type="button" className="dy-arrow" onClick={() => goMonth(next)} disabled={!hasMonthPage(next.y, next.m)} aria-label="다음 달">
                        <ChevronRight size={20} strokeWidth={1.8} />
                    </button>
                </div>
                <div className="dy-actions">
                    <button type="button" className="dy-icon" onClick={onSearch} aria-label="수첩 찾기">
                        <Search size={18} strokeWidth={1.8} />
                    </button>
                    <button type="button" className="dy-icon" onClick={onSettings} aria-label="설정">
                        <Settings size={18} strokeWidth={1.8} />
                        <span className={`dy-sync ${signedIn ? 'is-on' : ''}`} aria-hidden="true" />
                    </button>
                </div>
            </div>
            <div className="dy-tabs-wrap">
                <nav ref={navRef} className="dy-tabs" aria-label="수첩 구역">
                    {tabs.map((tab) => (
                        <button
                            key={tab.key}
                            type="button"
                            className={`dy-tab ${on === tab.key ? 'is-on' : ''} ${tab.key === 'write' ? 'is-ssu' : ''}`}
                            aria-current={on === tab.key ? 'page' : undefined}
                            onClick={() => onGo(tab.page)}
                        >
                            {tab.label}
                        </button>
                    ))}
                    <div className="dy-more" ref={moreRef}>
                        <button
                            type="button"
                            className={`dy-tab ${on === 'more' ? 'is-on' : ''}`}
                            aria-current={on === 'more' ? 'page' : undefined}
                            aria-expanded={moreOpen}
                            onClick={() => setMoreOpen((v) => !v)}
                        >
                            더보기 <ChevronDown size={14} aria-hidden="true" />
                        </button>
                    </div>
                </nav>
                {moreOpen && (
                    <div className="dy-more-pop" role="menu" ref={popRef}>
                        {MORE.map((item) => (
                            <button key={item.label} type="button" role="menuitem" onClick={() => onGo(item.page)}>{item.label}</button>
                        ))}
                    </div>
                )}
            </div>
            {on === 'write' && <SortChips onGo={onGo} />}
        </header>
    );
}
