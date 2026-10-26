import { useMemo, useId } from 'react';
import { CUP_SVG } from './cupD.js';
import { flavorForDark } from './sealFlavor.js';

const CUP_IDS = ['cupd-g', 'cupd-gl', 'cupdjam', 'cupd-pulp', 'cupd-sh', 'cupd-foil', 'cupd-glare', 'cupd-wall', 'cupd-rimside', 'cupd-dots'];

function withCupIds(markup, prefix) {
    let html = markup.replaceAll('class="cup-pulp', 'fill="url(#cupd-pulp)" class="cup-pulp');
    for (const id of CUP_IDS) {
        html = html
            .replaceAll(`id="${id}"`, `id="${prefix}${id}"`)
            .replaceAll(`url(#${id})`, `url(#${prefix}${id})`)
            .replaceAll(`href="#${id}"`, `href="#${prefix}${id}"`);
    }
    return html;
}

export function SealCup() {
    const prefix = useId().replace(/:/g, '');
    const markup = useMemo(() => withCupIds(CUP_SVG, prefix), [prefix]);
    const flavor = flavorForDark(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'));
    return (
        <span className={`fab-disc seal-cup fl-${flavor}`} data-flavor={flavor} aria-hidden="true">
            <span className="cup-squish" dangerouslySetInnerHTML={{ __html: markup }} />
        </span>
    );
}
