import { useEffect, useRef } from 'react';
import { saveQuick } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Btn } from './bits.jsx';
import { playSealBurst } from './sealBurst.js';
import { quickDateLabel, textFromField } from './quickText.js';

const CHIPS = ['일정', '할 일', '관찰', '메모'];

export function QuickBar({ open, inputRef, dateYmd, onClose }) {
    const { showToast } = useUi();
    const barRef = useRef(null);
    const lastKind = useRef('메모');
    const composing = useRef(null);
    const savedAt = useRef(0);

    useEffect(() => {
        const node = barRef.current;
        const view = window.visualViewport;
        if (!node || !view) return undefined;
        const place = () => {
            const lift = Math.max(0, window.innerHeight - view.height - view.offsetTop);
            const value = `${Math.round(lift)}px`;
            node.style.setProperty('--quick-lift', value);
            document.documentElement.style.setProperty('--quick-lift', value);
        };
        place();
        view.addEventListener('resize', place);
        view.addEventListener('scroll', place);
        return () => {
            view.removeEventListener('resize', place);
            view.removeEventListener('scroll', place);
            document.documentElement.style.removeProperty('--quick-lift');
        };
    }, []);

    function readText() {
        return textFromField(inputRef.current, composing.current).trim();
    }

    function save(kind) {
        const text = readText();
        if (!text) {
            showToast('한 줄만 적어도 남길 수 있어요.');
            return;
        }
        const bar = barRef.current;
        if (bar) {
            bar.classList.remove('is-open');
            bar.setAttribute('aria-hidden', 'true');
        }
        document.querySelectorAll('.seal-cup').forEach((cup) => playSealBurst(cup));
        const used = kind || lastKind.current || '메모';
        lastKind.current = used;
        const date = dateYmd;
        if (inputRef.current) inputRef.current.value = '';
        composing.current = null;
        onClose();
        const body = { kind: used, text, date };
        if (used === '할 일') body.due = date;
        saveQuick(body, new Date()).then((result) => {
            if (!result?.ok) showToast(result?.message || '한 줄만 적어도 남길 수 있어요.');
            else showToast(result.message, true);
        });
    }

    function saveChip(kind, event) {
        if (event?.type === 'click' && performance.now() - savedAt.current < 400) return;
        savedAt.current = performance.now();
        save(kind);
    }

    function onKeyDown(event) {
        if (event.key === 'Escape') {
            onClose();
            return;
        }
        if (event.key !== 'Enter' || event.shiftKey) return;
        if (event.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        save(lastKind.current || '메모');
    }

    return (
        <form
            ref={barRef}
            className={open ? 'quick-bar is-open' : 'quick-bar'}
            data-quick="1"
            aria-hidden={open ? 'false' : 'true'}
            onSubmit={(event) => event.preventDefault()}
        >
            <p className="quick-date">{quickDateLabel(dateYmd)}</p>
            <input
                ref={inputRef}
                className="field quick-field"
                aria-label="한 줄"
                tabIndex={open ? 0 : -1}
                placeholder="한 줄만 적어도 돼요"
                enterKeyHint="done"
                autoComplete="off"
                onKeyDown={onKeyDown}
                onCompositionStart={() => { composing.current = { data: '' }; }}
                onCompositionUpdate={(event) => { composing.current = { data: event.data || '' }; }}
                onCompositionEnd={() => { composing.current = null; }}
            />
            <div className="quick-chips" role="group" aria-label="분류">
                {CHIPS.map((kind) => (
                    <Btn
                        key={kind}
                        className="quick-chip"
                        data-kind={kind}
                        onPointerDown={(event) => {
                            event.preventDefault();
                            saveChip(kind, event);
                        }}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => saveChip(kind, event)}
                    >{kind}</Btn>
                ))}
            </div>
        </form>
    );
}
