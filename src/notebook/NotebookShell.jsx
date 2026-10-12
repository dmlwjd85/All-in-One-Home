import { LEFT_TABS, RIGHT_TABS, activeLeft, activeRight } from './labels.js';
import { PAGE_H, PAGE_W, layoutVars } from './layout.js';
import { chromeTopLabel, topLinks } from './nav.js';

export default function NotebookShell({
    page,
    pageRec,
    pages,
    onGo,
    children,
    showChrome,
}) {
    const leftOn = activeLeft(page);
    const rightOn = activeRight(page);
    const top = showChrome ? topLinks(pageRec) : [];

    return (
        <div
            className="nb-page"
            style={{ width: PAGE_W, height: PAGE_H, ...layoutVars() }}
            data-page={page}
        >
            {showChrome && (
                <nav className="nb-left" aria-label="구역 탭">
                    {LEFT_TABS.map((tab) => (
                        <button
                            key={tab.label}
                            type="button"
                            className={`nb-tab ${leftOn === tab.to ? 'is-on' : ''}`}
                            onClick={() => onGo(tab.to)}
                            aria-current={leftOn === tab.to ? 'page' : undefined}
                            data-hit={`left:${tab.label}`}
                            data-to={tab.to}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>
            )}

            {showChrome && (
                <nav className="nb-right" aria-label="달 · 스티커 탭">
                    {RIGHT_TABS.map((tab) => (
                        <button
                            key={tab.label}
                            type="button"
                            className={`nb-tab ${rightOn === tab.to ? 'is-on' : ''}`}
                            onClick={() => onGo(tab.to)}
                            aria-current={rightOn === tab.to ? 'page' : undefined}
                            data-hit={`right:${tab.label}`}
                            data-to={tab.to}
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>
            )}

            {showChrome && top.length > 0 && (
                <nav className="nb-topnav" aria-label="이전 · 목차 · 다음">
                    {top.map((link, i) => {
                        const label = chromeTopLabel(link, page, pages);
                        return (
                            <button
                                key={`top-${link.to}-${i}`}
                                type="button"
                                className="nb-topbtn"
                                onClick={() => onGo(link.to)}
                                aria-label={`${label} (${link.to}쪽)`}
                                title={`${label} · ${link.to}쪽`}
                                data-hit={`top:${label}`}
                                data-to={link.to}
                            >
                                {label}
                            </button>
                        );
                    })}
                </nav>
            )}

            <div className="nb-body">
                {children}
            </div>

            {showChrome && (
                <p className="nb-folio">p.{page}</p>
            )}
            <p className="nb-copy">ⓒJ쌤</p>
        </div>
    );
}
