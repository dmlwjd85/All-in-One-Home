import { LinkGrid, TitleBar } from './fields.jsx';
import { partitionLinks } from './linkParts.js';

export function TocCards({ title, hint, page, pageRec, pages, onGo, lead, scrollLinks = false }) {
    const { body } = partitionLinks(pageRec);
    const grid = <LinkGrid links={body} pages={pages} pageNo={page} onGo={onGo} />;
    return (
        <div className={`nb-fill${scrollLinks ? ' nb-toc-scroll' : ''}`}>
            <TitleBar title={title} hint={hint} />
            {lead}
            {scrollLinks ? <div className="nb-toc-links">{grid}</div> : grid}
        </div>
    );
}
