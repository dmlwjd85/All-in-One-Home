import { useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ui.jsx';
import { addItem, patchItem, removeItem } from '../lib/store.js';
import { readPageFields } from './fieldStore.js';
import { daysUntil, ddayBadge, formatCardDate, parseKoDate } from './boardsModel.js';

const COLUMNS = [
    ['todo', '할 일'],
    ['doing', '진행'],
    ['done', '완료'],
];

const EMPTY_HINT = {
    doing: '진행으로 옮기면 여기에 보여요',
    done: '끝낸 일은 여기에 모여요',
};

export function lineDeadlines() {
    const items = [];
    for (let page = 405; page <= 410; page += 1) {
        const fields = readPageFields(page);
        for (let i = 0; i < 12; i += 1) {
            const title = String(fields[`t${i}`] || '').trim();
            const deadline = String(fields[`d${i}`] || '').trim();
            if (!title && !deadline) continue;
            items.push({
                id: `line-${page}-${i}`,
                docNo: '',
                title: title || '기한',
                deadline,
                status: fields[`c${i}`] ? 'done' : 'todo',
                line: true,
                page,
            });
        }
    }
    return items;
}

export function allDeadlines(cards) {
    return [...(cards || []), ...lineDeadlines()];
}

function KoDateField({ value, onChange }) {
    const nativeRef = useRef(null);
    const [draft, setDraft] = useState(null);
    const open = () => {
        const el = nativeRef.current;
        if (!el) return;
        if (typeof el.showPicker === 'function') {
            try { el.showPicker(); return; } catch { /* 막히면 날짜 칸에 직접 적습니다. */ }
        }
    };
    return (
        <span className="nb-ko-date">
            <input
                type="text"
                inputMode="numeric"
                value={draft ?? (value ? formatCardDate(value) : '')}
                placeholder="연도. 월. 일"
                aria-label="기한"
                onFocus={() => setDraft(value || '')}
                onChange={(event) => {
                    const next = event.target.value;
                    setDraft(next);
                    const parsed = parseKoDate(next);
                    if (parsed || !next.trim()) onChange(parsed || '');
                }}
                onBlur={() => setDraft(null)}
            />
            <button type="button" className="nb-ko-date-open" aria-label="달력 열기" onClick={open}>
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <rect x="3.5" y="5" width="17" height="15" rx="2" />
                    <path d="M8 3.5v3M16 3.5v3M3.5 10h17" />
                </svg>
            </button>
            <input
                ref={nativeRef}
                className="nb-ko-date-native"
                type="date"
                tabIndex={-1}
                aria-hidden="true"
                value={value}
                onChange={(event) => {
                    setDraft(null);
                    onChange(event.target.value);
                }}
            />
        </span>
    );
}

function Badge({ deadline, status }) {
    if (status === 'done') return null;
    const badge = ddayBadge(daysUntil(deadline));
    if (!badge || badge.kind === 'later') return null;
    return <em className={`nb-dday-badge is-${badge.kind}`}>{badge.text}</em>;
}

function Card({ item, signedIn, onChanged, onGo }) {
    const [pending, setPending] = useState(false);
    const move = async (status) => {
        await patchItem('ddayCards', item.id, { status }, signedIn);
        onChanged?.();
    };
    return (
        <li className="nb-dday-card">
            <p>
                <Badge deadline={item.deadline} status={item.status} />
                {item.docNo ? <span className="nb-dday-no">{item.docNo}</span> : null}
                <strong>{item.title}</strong>
            </p>
            <p className="nb-hint">{formatCardDate(item.deadline)}{item.line ? ' · 줄 기록' : ''}</p>
            <div className="nb-dday-actions">
                {item.line ? (
                    <button type="button" onClick={() => onGo?.(item.page)}>줄 열기</button>
                ) : (
                    <>
                        {item.status !== 'todo' && <button type="button" onClick={() => move('todo')}>할 일</button>}
                        {item.status !== 'doing' && <button type="button" onClick={() => move('doing')}>진행</button>}
                        {item.status !== 'done' && <button type="button" onClick={() => move('done')}>완료</button>}
                        <button type="button" onClick={() => setPending(true)}>지우기</button>
                    </>
                )}
            </div>
            {pending && (
                <ConfirmDialog
                    title="이 기한을 지울까요?"
                    body={item.title}
                    onClose={() => setPending(false)}
                    onConfirm={async () => {
                        setPending(false);
                        await removeItem('ddayCards', item.id, signedIn);
                        onChanged?.();
                    }}
                />
            )}
        </li>
    );
}

export function UpcomingStrip({ cards, onGo }) {
    const soon = allDeadlines(cards)
        .filter((item) => item.status !== 'done' && item.deadline)
        .sort((a, b) => String(a.deadline).localeCompare(String(b.deadline)))
        .slice(0, 5);
    if (!soon.length) return null;
    return (
        <div className="nb-dday-strip">
            <span>다가오는 기한</span>
            {soon.map((item) => {
                const badge = ddayBadge(daysUntil(item.deadline));
                return (
                    <button key={item.id} type="button" onClick={() => onGo?.(item.page || 405)}>
                        {badge && badge.kind !== 'later' ? `${badge.text} ` : ''}
                        {item.title}
                    </button>
                );
            })}
        </div>
    );
}

export default function DdayBoard({ cards, signedIn, onChanged, onToast, onGo }) {
    const [docNo, setDocNo] = useState('');
    const [title, setTitle] = useState('');
    const [deadline, setDeadline] = useState('');
    const items = allDeadlines(cards);

    const add = async (event) => {
        event.preventDefault();
        const typed = event.currentTarget.querySelector('[aria-label="기한"]')?.value || '';
        const native = event.currentTarget.querySelector('.nb-ko-date-native')?.value || '';
        const parsed = parseKoDate(typed);
        const due = /^\d{4}/.test(typed.trim()) ? (parsed || native) : (native || parsed || '');
        if (!title.trim() || !due) {
            onToast?.('제목과 기한을 적어 주세요.');
            return;
        }
        await addItem('ddayCards', {
            docNo: docNo.trim(),
            title: title.trim(),
            deadline: due,
            status: 'todo',
        }, signedIn);
        setDocNo('');
        setTitle('');
        setDeadline('');
        onChanged?.();
        onToast?.('기한 보드에 올렸어요.');
    };

    return (
        <div className="nb-dday nb-fill">
            <form className="nb-dday-form" onSubmit={add}>
                <input value={docNo} onChange={(e) => setDocNo(e.target.value)} placeholder="공문번호" aria-label="공문번호" />
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="제목" aria-label="제목" />
                <KoDateField value={deadline} onChange={setDeadline} />
                <div className="nb-dday-submit">
                    <button type="submit">올리기</button>
                    <button type="button" onClick={() => onGo?.(411)}>업무 할 일</button>
                </div>
            </form>
            <div className="nb-kanban">
                {COLUMNS.map(([status, label]) => {
                    const columnItems = items.filter((item) => (item.status || 'todo') === status);
                    return (
                        <section key={status} className={`is-${status}`}>
                            <h3>{label}</h3>
                            <ul>
                                {columnItems.map((item) => (
                                    <Card key={item.id} item={item} signedIn={signedIn} onChanged={onChanged} onGo={onGo} />
                                ))}
                            </ul>
                            {!columnItems.length && EMPTY_HINT[status] ? <p className="nb-dday-empty">{EMPTY_HINT[status]}</p> : null}
                        </section>
                    );
                })}
            </div>
        </div>
    );
}
