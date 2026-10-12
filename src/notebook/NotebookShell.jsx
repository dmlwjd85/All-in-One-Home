import { LEFT_TABS, RIGHT_TABS, activeLeft, activeRight } from './labels.js';
import LinkOverlay from './LinkOverlay.jsx';

const PAGE_W = 1180;
const PAGE_H = 820;

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

    return (
        <div className="nb-page" style={{ width: PAGE_W, height: PAGE_H }} data-page={page}>
            {showChrome && (
                <nav className="nb-left" aria-label="구역 탭">
                    {LEFT_TABS.map((tab) => (
                        <button
                            key={tab.label}
                            type="button"
                            className={`nb-tab ${leftOn === tab.to ? 'is-on' : ''}`}
                            onClick={() => onGo(tab.to)}
                            aria-current={leftOn === tab.to ? 'page' : undefined}
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
                        >
                            {tab.label}
                        </button>
                    ))}
                </nav>
            )}

            <div className="nb-body">
                {children}
            </div>

            <LinkOverlay page={page} pageRec={pageRec} pages={pages} onGo={onGo} />

            {showChrome && (
                <p className="nb-folio">p.{page}</p>
            )}
            <p className="nb-copy">ⓒJ쌤</p>
        </div>
    );
}
