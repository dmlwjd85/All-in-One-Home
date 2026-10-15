import { toneForType } from './tones.js';

/** 쪽 틀. PDF 쪽 번호·좌우 색 탭·위쪽 링크 줄은 두지 않습니다. */
export default function NotebookShell({ page, pageRec, children, showChrome }) {
    const tone = toneForType(pageRec?.type);
    return (
        <div className={`nb-page dy-page ${showChrome ? 'has-chrome' : 'is-cover'}`} data-page={page} data-tone={tone} data-type={pageRec?.type}>
            <div className="nb-main">
                <div className="nb-body">
                    {children}
                </div>
            </div>
        </div>
    );
}
