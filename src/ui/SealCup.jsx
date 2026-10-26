import { useEffect, useId, useMemo, useState } from 'react';
import { flavorForDark } from './sealFlavor.js';
import { FOIL_IDS, FOIL_MARKUP } from './foilMarkup.js';

function withFoilIds(markup, prefix) {
    return FOIL_IDS.reduce((html, id) => html
        .replaceAll(`id="${id}"`, `id="${prefix}${id}"`)
        .replaceAll(`url(#${id})`, `url(#${prefix}${id})`), markup);
}

export function SealCup() {
    const prefix = useId().replace(/:/g, '');
    const markup = useMemo(() => withFoilIds(FOIL_MARKUP, prefix), [prefix]);
    const [flavor, setFlavor] = useState(() => flavorForDark(document.documentElement.classList.contains('dark')));

    useEffect(() => {
        const root = document.documentElement;
        const sync = () => setFlavor(flavorForDark(root.classList.contains('dark')));
        const watch = new MutationObserver(sync);
        watch.observe(root, { attributes: true, attributeFilter: ['class'] });
        sync();
        return () => watch.disconnect();
    }, []);

    return (
        <span
            className={`seal-cup fab-disc fl-${flavor}`}
            data-flavor={flavor}
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: markup }}
        />
    );
}
