import { useEffect, useId, useState } from 'react';
import { flavorForDark } from './sealFlavor.js';

export function SealCup() {
    const rawId = useId().replace(/:/g, '');
    const foilId = `foil${rawId}`;
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
        <span className="seal-cup" data-flavor={flavor} aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => <span key={index} className="seal-splat" />)}
            <svg className="seal-svg" viewBox="0 0 64 72">
                <defs>
                    <linearGradient id={foilId} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" stopColor="#F8F9FB" />
                        <stop offset="0.42" stopColor="#D7DDE6" />
                        <stop offset="1" stopColor="#A8B1BE" />
                    </linearGradient>
                </defs>
                <g className="seal-body">
                    <ellipse cx="32" cy="67" rx="15" ry="2.4" fill="#000" opacity="0.18" />
                    <path d="M22 40h20l-3 20.4c-.5 3-3 5-7 5s-6.5-2-7-5L22 40z" style={{ fill: 'var(--seal-fill)' }} />
                    <ellipse cx="30" cy="48" rx="6" ry="3.2" style={{ fill: 'var(--seal-gloss)', opacity: 0.55 }} />
                    <circle cx="28" cy="52" r="1.2" style={{ fill: 'var(--seal-seed)', opacity: 0.7 }} />
                    <circle cx="35" cy="56" r="1" style={{ fill: 'var(--seal-seed)', opacity: 0.55 }} />
                    <path d="M16 29.5h32c.8 0 .2 3.4-.8 5.4L41.4 62c-1 4.2-4.6 6.8-9.4 6.8s-8.4-2.6-9.4-6.8L16.8 34.9c-1-2-.8-5.4-.8-5.4z" style={{ fill: 'var(--seal-wall)', stroke: 'var(--seal-rim)' }} strokeWidth="1.35" />
                    <path d="M21 36c.5 8 1.8 18 3.4 24" fill="none" stroke="#fff" strokeOpacity="0.85" strokeWidth="1.8" strokeLinecap="round" />
                    <ellipse cx="32" cy="30.6" rx="15.4" ry="3.5" fill="none" stroke="var(--seal-rim)" strokeWidth="1.1" />
                </g>
                <g className="seal-foil">
                    <ellipse cx="32" cy="27.5" rx="17" ry="5.6" fill={`url(#${foilId})`} />
                    <ellipse cx="25" cy="26" rx="6" ry="1.7" fill="#fff" opacity="0.78" />
                    <text x="32" y="29.4" textAnchor="middle" fontSize="6.2" fontWeight="800" fontFamily="var(--font-title)" fill="#4C5562">쨈</text>
                </g>
            </svg>
        </span>
    );
}
