import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
    BookMarked,
    BookOpen,
    Briefcase,
    Calendar,
    CalendarClock,
    CalendarDays,
    CalendarRange,
    ClipboardCheck,
    House,
    LayoutGrid,
    MessageCircle,
    NotebookPen,
    PenLine,
    Presentation,
    School,
    Search,
    Sparkles,
    StickyNote,
    Sun,
    Tags,
    Users,
} from 'lucide-react';
import { Modal } from '../components/ui.jsx';
import { monthPage } from './nav.js';
import { MENU_ITEMS, VIEW_PAGES, menuDestination, menuKeyForPage } from './routes.js';

const ICONS = {
    cover: BookMarked,
    home: House,
    year: CalendarRange,
    month: CalendarDays,
    week: CalendarClock,
    schedule: Calendar,
    day: Sun,
    class: School,
    students: Users,
    attend: ClipboardCheck,
    counsel: MessageCircle,
    lesson: BookOpen,
    work: Briefcase,
    write: PenLine,
    notebook: NotebookPen,
    board: Presentation,
    stickers: StickyNote,
    tags: Tags,
};

const MONTHS = [
    [2026, 3], [2026, 4], [2026, 5], [2026, 6], [2026, 7], [2026, 8],
    [2026, 9], [2026, 10], [2026, 11], [2026, 12], [2027, 1], [2027, 2],
];

const PINS = [
    { key: 'timetable', label: '시간표', page: VIEW_PAGES.timetable },
    { key: 'cards', label: '학생카드', page: VIEW_PAGES.cards },
    { key: 'budget', label: '예산', page: VIEW_PAGES.budget },
];

const MORE = [
    {
        title: '달력',
        hint: '연간 · 월간 · 주간 · 학사 · 하루는 서로 바로 이어집니다.',
        items: [
            { label: '연간', page: VIEW_PAGES.year },
            { label: '학사', page: VIEW_PAGES.schedule },
            { label: '주간', page: VIEW_PAGES.weeks },
            { label: '하루', page: VIEW_PAGES.days },
            ...MONTHS.map(([year, month]) => ({
                label: `${year === 2027 ? '2027 ' : ''}${month}월`,
                page: monthPage(month, year),
            })),
        ],
    },
    {
        title: '수첩',
        items: [
            { label: '표지', page: VIEW_PAGES.cover },
            { label: '홈', page: VIEW_PAGES.home },
            { label: '새 학기', page: VIEW_PAGES.prep },
            { label: '사용법', page: VIEW_PAGES.guide },
            { label: '태그', page: VIEW_PAGES.tags },
            { label: '학급', page: VIEW_PAGES.class },
            { label: '시간표', page: VIEW_PAGES.timetable },
            { label: '학생', page: VIEW_PAGES.students },
            { label: '학생카드', page: VIEW_PAGES.cards },
            { label: '출결', page: VIEW_PAGES.attend },
            { label: '상담', page: VIEW_PAGES.counsel },
            { label: '수업', page: VIEW_PAGES.lesson },
            { label: '업무', page: VIEW_PAGES.work },
            { label: '기한', page: VIEW_PAGES.deadlines },
            { label: '예산', page: VIEW_PAGES.budget },
            { label: '쓱적', page: VIEW_PAGES.write },
            { label: '공책', page: VIEW_PAGES.notebook },
            { label: '칠판', page: VIEW_PAGES.board },
            { label: '스티커', page: VIEW_PAGES.stickers },
        ],
    },
];

function pinOn(key, page, pages) {
    const rec = pages?.[page - 1];
    if (key === 'timetable') return rec?.type === 'timetable';
    if (key === 'cards') return rec?.type === 'student-card';
    if (key === 'budget') return rec?.type === 'budget-toc' || rec?.type === 'budget-item' || rec?.type === 'budget-misc';
    return false;
}

export default function AppMenu({ page, pages, onGo, onOpenSearch, closeSignal = 0 }) {
    const [open, setOpen] = useState(false);
    const [canPrev, setCanPrev] = useState(false);
    const [canNext, setCanNext] = useState(false);
    const scrollRef = useRef(null);
    const followRef = useRef(true);
    const active = menuKeyForPage(page);

    useEffect(() => {
        setOpen(false);
    }, [closeSignal]);

    useLayoutEffect(() => {
        const nav = scrollRef.current;
        if (!nav) return undefined;
        let centering = false;
        followRef.current = true;
        const edges = () => {
            const host = nav.getBoundingClientRect();
            for (const btn of nav.querySelectorAll('.nb-navbtn')) {
                const box = btn.getBoundingClientRect();
                const visible = Math.min(box.right, host.right) - Math.max(box.left, host.left);
                const full = visible >= box.width - 0.5;
                const currentBtn = btn.getAttribute('aria-current') === 'page';
                btn.classList.toggle('is-clip', !currentBtn && !full && visible > 0.5);
            }
            const max = Math.max(0, nav.scrollWidth - nav.clientWidth);
            const nextPrev = nav.scrollLeft > 2;
            const nextNext = max > 2 && nav.scrollLeft < max - 2;
            setCanPrev((prev) => (prev === nextPrev ? prev : nextPrev));
            setCanNext((prev) => (prev === nextNext ? prev : nextNext));
        };
        const center = () => {
            const current = nav.querySelector('[aria-current="page"]');
            if (current) {
                const max = Math.max(0, nav.scrollWidth - nav.clientWidth);
                const ideal = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
                const next = Math.max(0, Math.min(max, ideal));
                centering = true;
                if (Math.abs(nav.scrollLeft - next) > 1) nav.scrollLeft = next;
                centering = false;
            }
            edges();
        };
        const onScroll = () => {
            if (!centering) followRef.current = false;
            edges();
        };
        const onResize = () => {
            if (followRef.current) center();
            else edges();
        };
        center();
        const later = requestAnimationFrame(() => onResize());
        nav.addEventListener('scroll', onScroll, { passive: true });
        const observer = new ResizeObserver(onResize);
        observer.observe(nav);
        document.fonts?.ready?.then(() => onResize());
        return () => {
            cancelAnimationFrame(later);
            nav.removeEventListener('scroll', onScroll);
            observer.disconnect();
        };
    }, [page, active]);

    const goPage = (dest) => {
        setOpen(false);
        onGo?.(dest);
    };

    const nudge = (dir) => {
        const nav = scrollRef.current;
        if (!nav) return;
        followRef.current = false;
        const chunk = Math.max(160, Math.round(nav.clientWidth * 0.7));
        const max = Math.max(0, nav.scrollWidth - nav.clientWidth);
        nav.scrollLeft = Math.max(0, Math.min(max, nav.scrollLeft + dir * chunk));
    };

    let lastGroup = '';

    return (
        <nav className="nb-appnav" aria-label="수첩 메뉴">
            <button
                type="button"
                className="nb-navbtn nb-nav-all"
                aria-haspopup="dialog"
                aria-expanded={open}
                onClick={() => setOpen(true)}
                data-nav="all"
            >
                <LayoutGrid size={15} aria-hidden="true" />
                전체
            </button>
            <div className="nb-nav-pins">
                {PINS.map((item) => (
                    <button
                        key={item.key}
                        type="button"
                        className={`nb-navbtn nb-nav-pin ${pinOn(item.key, page, pages) ? 'is-on' : ''}`}
                        data-nav-pin={item.key}
                        onClick={() => goPage(item.page)}
                    >
                        {item.label}
                    </button>
                ))}
            </div>
            <button
                type="button"
                className="nb-nav-chev"
                data-nav-scroll="prev"
                aria-label="앞쪽 메뉴"
                disabled={!canPrev}
                onClick={() => nudge(-1)}
            >
                ‹
            </button>
            <div className="nb-appnav-scroll" ref={scrollRef}>
                {MENU_ITEMS.map((item) => {
                    const Icon = ICONS[item.key];
                    const on = item.key === active;
                    const dest = menuDestination(item.key, page, pages);
                    const gap = lastGroup && lastGroup !== item.group;
                    lastGroup = item.group;
                    return (
                        <span key={item.key} className="nb-navslot">
                            {gap && <span className="nb-nav-gap" aria-hidden="true" />}
                            <button
                                type="button"
                                className={`nb-navbtn ${on ? 'is-on' : ''}`}
                                aria-current={on ? 'page' : undefined}
                                data-nav={item.key}
                                onClick={() => goPage(dest)}
                            >
                                <Icon size={15} aria-hidden="true" />
                                {item.label}
                            </button>
                        </span>
                    );
                })}
            </div>
            <button
                type="button"
                className="nb-nav-chev"
                data-nav-scroll="next"
                aria-label="뒤쪽 메뉴"
                disabled={!canNext}
                onClick={() => nudge(1)}
            >
                ›
            </button>
            {open && (
                <Modal title="전체 메뉴" onClose={() => setOpen(false)} wide>
                    <p className="nb-nav-lead">
                        <Sparkles size={16} aria-hidden="true" />
                        자주 가는 곳은 위 막대에서 한 번에, 나머지는 여기서 고릅니다.
                    </p>
                    {MORE.map((group) => (
                        <section key={group.title} className="nb-nav-group" aria-label={group.title}>
                            <h3>{group.title}</h3>
                            {group.hint && <p>{group.hint}</p>}
                            <div className="nb-nav-chips">
                                {group.items.map((item) => (
                                    <button key={item.label} type="button" className="nb-nav-chip" onClick={() => goPage(item.page)}>
                                        {item.label}
                                    </button>
                                ))}
                            </div>
                        </section>
                    ))}
                    <button
                        type="button"
                        className="nb-nav-chip nb-nav-search"
                        onClick={() => {
                            setOpen(false);
                            onOpenSearch?.();
                        }}
                    >
                        <Search size={15} aria-hidden="true" />
                        찾기
                    </button>
                </Modal>
            )}
        </nav>
    );
}
