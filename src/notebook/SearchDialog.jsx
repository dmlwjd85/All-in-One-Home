import { useEffect, useId, useMemo, useState } from 'react';
import { searchNotebook } from './searchNotebook.js';

export default function SearchDialog({ pages, onGo, onClose }) {
    const [query, setQuery] = useState('');
    const [debounced, setDebounced] = useState('');
    const titleId = useId();
    const inputId = useId();

    useEffect(() => {
        const timer = window.setTimeout(() => setDebounced(query), 200);
        return () => window.clearTimeout(timer);
    }, [query]);

    const hits = useMemo(() => searchNotebook(debounced, pages), [debounced, pages]);

    useEffect(() => {
        const onKey = (event) => {
            if (event.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="nb-search-backdrop" role="presentation" onClick={onClose}>
            <div
                className="nb-search"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                onClick={(event) => event.stopPropagation()}
            >
                <div className="nb-search-head">
                    <h2 id={titleId}>수첩 찾기</h2>
                    <button type="button" className="btn-secondary" onClick={onClose}>닫기</button>
                </div>
                <label htmlFor={inputId}>쪽 제목이나 적어 둔 기록</label>
                <input
                    id={inputId}
                    type="search"
                    className="field"
                    autoFocus
                    value={query}
                    placeholder="예: 명렬, 민지, 상담"
                    onChange={(event) => setQuery(event.target.value)}
                />
                <ul className="nb-search-list" aria-label="검색 결과">
                    {debounced && hits.length === 0 && <li className="nb-hint">해당하는 쪽이나 기록이 없습니다.</li>}
                    {hits.map((hit) => (
                        <li key={`${hit.page}-${hit.kind}`}>
                            <button
                                type="button"
                                onClick={() => {
                                    onGo(hit.page);
                                    onClose();
                                }}
                            >
                                <span>{hit.title}</span>
                                <small>{hit.kind} · {hit.page}쪽</small>
                            </button>
                        </li>
                    ))}
                </ul>
            </div>
        </div>
    );
}
