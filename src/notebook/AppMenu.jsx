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
            { label: '쓱, 적', page: VIEW_PAGES.write },
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

export default function AppMenu({ page, pages, onGo, onOpenSearch, closeSignal = 0, capture = null }) {
    const [open, setOpen] = useState(false);
    const [canPrev, setCanPrev] = useState(false);
    const [canNext, setCanNext] = useState(false);
    const [overflow, setOverflow] = useState(false);
    const scrollRef = useRef(null);
    const followRef = useRef(true);
    const active = menuKeyForPage(page);

    useEffect(() => {
        setOpen(false);
    }, [closeSignal]);

    useLayoutEffect(() => {
        const nav = scrollRef.current;
        if (!nav) return undefined;
        let framing = false;
        let fromUs = false;
        followRef.current = true;
        const buttonList = () => [...nav.querySelectorAll('.nb-navbtn')];
        const clearSpread = () => {
            for (const btn of buttonList()) btn.style.marginRight = '';
        };
        const contentMax = () => {
            const buttons = buttonList();
            const last = buttons[buttons.length - 1];
            if (!last) return 0;
            return Math.max(0, last.offsetLeft + last.offsetWidth - nav.clientWidth);
        };
        const edges = () => {
            const max = contentMax();
            const nextPrev = nav.scrollLeft > 2;
            const nextNext = max > 2 && nav.scrollLeft < max - 2;
            setCanPrev((prev) => (prev === nextPrev ? prev : nextPrev));
            setCanNext((prev) => (prev === nextNext ? prev : nextNext));
        };
        const snapTo = (prefer) => {
            const buttons = buttonList();
            const last = buttons[buttons.length - 1];
            const limit = last ? Math.max(0, last.offsetLeft + last.offsetWidth - nav.clientWidth) : 0;
            const preferC = Math.max(0, Math.min(limit, prefer));
            const current = nav.querySelector('[aria-current="page"]');
            const client = nav.clientWidth;
            const fits = (left) => {
                if (!current) return true;
                const start = current.offsetLeft;
                const end = start + current.offsetWidth;
                return start >= left - 1 && end <= left + client + 1;
            };
            const starts = [0, ...buttons.map((btn) => btn.offsetLeft)];
            let best = null;
            let bestDist = Infinity;
            for (const left of starts) {
                if (left < -1 || left > limit + 1 || !fits(left)) continue;
                const dist = Math.abs(left - preferC);
                if (dist < bestDist - 0.01) {
                    best = left;
                    bestDist = dist;
                }
            }
            if (best != null) return best;
            const later = starts.filter((left) => left > limit && fits(left)).sort((a, b) => a - b);
            return later[0] ?? preferC;
        };
        const spread = () => {
            clearSpread();
            const start = nav.scrollLeft;
            const right = start + nav.clientWidth;
            const full = [];
            let partial = null;
            for (const btn of buttonList()) {
                const a = btn.offsetLeft;
                const b = a + btn.offsetWidth;
                if (b <= start + 0.5) continue;
                if (a >= right - 0.5) break;
                if (a >= start - 1 && b <= right + 1) full.push(btn);
                else {
                    partial = btn;
                    break;
                }
            }
            if (!partial || full.length < 1) return;
            const need = right - partial.offsetLeft;
            if (need <= 0.5) return;
            const current = nav.querySelector('[aria-current="page"]');
            const anchor = current ? current.offsetLeft : 0;
            const receivers = full.filter((btn) => btn.offsetLeft >= anchor - 1);
            if (!receivers.length) return;
            const each = need / receivers.length;
            for (const btn of receivers) btn.style.marginRight = `${each}px`;
        };
        const reserveChevrons = () => {
            const host = nav.parentElement;
            if (!host) return;
            const last = buttonList()[buttonList().length - 1];
            const end = last ? last.offsetLeft + last.offsetWidth : 0;
            const fitsNow = end <= nav.clientWidth + 2;
            if (!fitsNow) {
                if (!host.classList.contains('is-overflow')) {
                    host.classList.add('is-overflow');
                    setOverflow(true);
                }
                return;
            }
            if (!host.classList.contains('is-overflow')) return;
            host.classList.remove('is-overflow');
            setOverflow(false);
            if (end > nav.clientWidth + 2) {
                host.classList.add('is-overflow');
                setOverflow(true);
            }
        };
        const center = () => {
            if (framing) return;
            framing = true;
            try {
                clearSpread();
                reserveChevrons();
                const spacer = nav.querySelector('.nb-nav-spacer');
                if (spacer) spacer.style.width = `${nav.clientWidth}px`;
                if (followRef.current) {
                    const current = nav.querySelector('[aria-current="page"]');
                    if (current) {
                        const ideal = current.offsetLeft - (nav.clientWidth - current.offsetWidth) / 2;
                        const next = snapTo(ideal);
                        if (Math.abs(nav.scrollLeft - next) > 1) {
                            fromUs = true;
                            nav.scrollLeft = next;
                        }
                    }
                }
                spread();
                edges();
            } finally {
                framing = false;
            }
        };
        const onScroll = () => {
            if (fromUs || framing) {
                fromUs = false;
                edges();
                return;
            }
            edges();
        };
        const markUserScroll = () => {
            followRef.current = false;
        };
        const onResize = () => {
            if (followRef.current) center();
            else {
                clearSpread();
                reserveChevrons();
                spread();
                edges();
            }
        };
        center();
        const later = requestAnimationFrame(() => onResize());
        nav.addEventListener('scroll', onScroll, { passive: true });
        nav.addEventListener('wheel', markUserScroll, { passive: true });
        nav.addEventListener('touchmove', markUserScroll, { passive: true });
        const observer = new ResizeObserver(onResize);
        observer.observe(nav);
        document.fonts?.ready?.then(() => onResize());
        return () => {
            cancelAnimationFrame(later);
            nav.removeEventListener('scroll', onScroll);
            nav.removeEventListener('wheel', markUserScroll);
            nav.removeEventListener('touchmove', markUserScroll);
            observer.disconnect();
            clearSpread();
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
        const chunk = Math.round(nav.clientWidth * 0.7);
        const buttons = [...nav.querySelectorAll('.nb-navbtn')];
        const last = buttons[buttons.length - 1];
        const max = last ? Math.max(0, last.offsetLeft + last.offsetWidth - nav.clientWidth) : 0;
        nav.scrollLeft = Math.max(0, Math.min(max, nav.scrollLeft + dir * chunk));
    };

    let lastGroup = '';

    return (
        <nav className={`nb-appnav${overflow ? ' is-overflow' : ''}`} aria-label="수첩 메뉴">
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
                <span className="nb-nav-spacer" aria-hidden="true" />
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
            {capture}
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
