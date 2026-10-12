import { useState } from 'react';
import { LEFT_TABS, RIGHT_TABS, activeLeft, activeRight, navLabel } from './labels.js';
import { partitionLinks } from './linkParts.js';
import { toneForPage, toneForType } from './tones.js';

function TabBar({ side, label, children }) {
    const [showHint, setShowHint] = useState(true);
    return (
        <div className={`nb-tabbar nb-tabbar-${side}`}>
            <nav
                className={side === 'left' ? 'nb-left' : 'nb-right'}
                aria-label={label}
                onScroll={(e) => {
                    if (e.currentTarget.scrollLeft > 8) setShowHint(false);
                }}
            >
                {children}
            </nav>
            <span className={`nb-tab-hint ${showHint ? '' : 'is-gone'}`}>옆으로</span>
        </div>
    );
}

export default function NotebookShell({
    page,
    pageRec,
    pages,
    onGo,
    children,
    showChrome,
    style,
}) {
    const leftOn = activeLeft(page);
    const rightOn = activeRight(page);
    const { header } = partitionLinks(pageRec);
    const tone = toneForType(pageRec?.type);

    return (
        <div className={`nb-page ${showChrome ? 'has-chrome' : 'is-cover'}`} data-page={page} data-tone={tone} style={style}>
            {showChrome && (
                <TabBar side="left" label="구역 탭">
                    {LEFT_TABS.map((tab) => (
                        <button
                            key={tab.label}
                            type="button"
                            className={`nb-tab tone-${toneForPage(tab.to, pages)} ${leftOn === tab.to ? 'is-on' : ''}`}
                            onClick={() => onGo(tab.to)}
                            aria-current={leftOn === tab.to ? 'page' : undefined}
                            data-hit={`left:${tab.label}`}
                            data-to={tab.to}
                        >
                            {tab.label}
                        </button>
                    ))}
                </TabBar>
            )}

            <div className="nb-main">
                {header.length > 0 && (
                    <nav className="nb-topnav" aria-label="쪽 이동">
                        {header.map((link) => (
                            <button
                                key={`${link.to}-${link.rect[0]}`}
                                type="button"
                                className={`nb-topbtn ${link.to === page ? 'is-on' : ''}`}
                                onClick={() => onGo(link.to)}
                                aria-current={link.to === page ? 'page' : undefined}
                                aria-label={`${navLabel(link.to, pages, page)} (${link.to}쪽)`}
                                data-hit={`top:${navLabel(link.to, pages, page)}`}
                                data-to={link.to}
                            >
                                {navLabel(link.to, pages, page)}
                            </button>
                        ))}
                    </nav>
                )}
                <div className="nb-body">
                    {children}
                </div>
                <footer className="nb-foot">
                    {showChrome && <p className="nb-folio">p.{page}</p>}
                    <p className="nb-copy">ⓒJ쌤</p>
                </footer>
            </div>

            {showChrome && (
                <TabBar side="right" label="달 · 스티커 탭">
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
                </TabBar>
            )}
        </div>
    );
}
