import { destLabel, topNavLabel } from './labels.js';

/**
 * PDF에서 뽑은 내부 링크를 같은 좌표에 올립니다.
 * 입력칸(z-index 더 높음) 위는 가리지 않아 타이핑이 됩니다.
 */
export default function LinkOverlay({ page, pageRec, pages, onGo, includeTop = true }) {
    const items = [
        ...(includeTop ? (pageRec.topNav || []).map((l, i) => ({ ...l, kind: 'top', key: `t${i}` })) : []),
        ...(pageRec.links || []).map((l, i) => ({ ...l, kind: 'content', key: `c${i}` })),
    ];
    return (
        <div className="nb-links" aria-hidden={false}>
            {items.map((link) => {
                const [x0, y0, x1, y1] = link.rect;
                const label = link.kind === 'top'
                    ? topNavLabel(link, page)
                    : (link.label || destLabel(link.to, pages));
                return (
                    <button
                        key={link.key}
                        type="button"
                        className={`nb-hotspot ${link.kind === 'top' ? 'nb-hotspot-top' : ''}`}
                        style={{ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }}
                        onClick={() => onGo(link.to)}
                        aria-label={`${label} (${link.to}쪽)`}
                        title={`${label} · ${link.to}쪽`}
                    />
                );
            })}
        </div>
    );
}
