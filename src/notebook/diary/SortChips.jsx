import { studentWhoPage } from '../nav.js';
import { VIEW_PAGES } from '../routes.js';

/** 쓱, 적 쪽에서만 탭 아래 한 줄로 보이는 나눌 곳. */
export const SORT_CHIPS = [
    { label: '학생', page: VIEW_PAGES.students },
    { label: '출결', page: VIEW_PAGES.attend },
    { label: '상담', page: VIEW_PAGES.counsel },
    { label: '누가기록', page: studentWhoPage(1) },
    { label: '할 일', page: 411 },
    { label: '기한', page: VIEW_PAGES.deadlines },
    { label: '회의', page: 417 },
    { label: '수업', page: VIEW_PAGES.lesson },
    { label: '생각', page: VIEW_PAGES.notebook },
    { label: '보관', filter: 'archived' },
];

export default function SortChips({ onGo }) {
    return (
        <nav className="dy-chips" aria-label="쓱, 적 나눌 곳">
            {SORT_CHIPS.map((chip) => (
                <button
                    key={chip.label}
                    type="button"
                    className="dy-chip"
                    onClick={() => {
                        if (chip.filter) {
                            window.dispatchEvent(new CustomEvent('nb-ssu-filter', { detail: chip.filter }));
                            document.querySelector('.nb-ssu-filters')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                        } else {
                            onGo(chip.page);
                        }
                    }}
                >
                    {chip.label}
                </button>
            ))}
        </nav>
    );
}
