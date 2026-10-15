import { useState } from 'react';
import { ConfirmDialog } from '../components/ui.jsx';
import { addItem, patchItem, removeItem } from '../lib/store.js';
import { readPageFields } from './fieldStore.js';
import { daysUntil, ddayBadge } from './boardsModel.js';

const COLUMNS = [
    ['todo', '할 일'],
    ['doing', '진행'],
    ['done', '완료'],
];

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

function formatKoDate(value) {
    const [year, month, day] = String(value || '').split('-');
    if (!year || !month || !day) return '';
    return `${year}년 ${Number(month)}월 ${Number(day)}일`;
}

function KoDateField({ value, onChange }) {
    const shown = formatKoDate(value);
    return (
        <label className={`nb-ko-date${shown ? '' : ' is-empty'}`}>
            <input type="date" lang="ko" value={value} onChange={(e) => onChange(e.target.value)} aria-label="기한" />
            <span aria-hidden="true">{shown || '연도. 월. 일'}</span>
        </label>
    );
}

function Badge({ deadline, status }) {
    if (status === 'done') return null;
    const badge = ddayBadge(daysUntil(deadline));
    if (!badge || (badge.kind !== 'day' && badge.kind !== 'soon')) return null;
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
            <p className="nb-hint">{item.deadline || '날짜 없음'}{item.line ? ' · 줄 기록' : ''}</p>
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
                        {badge && (badge.kind === 'day' || badge.kind === 'soon') ? `${badge.text} ` : ''}
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
        if (!title.trim() || !deadline) {
            onToast?.('제목과 기한을 적어 주세요.');
            return;
        }
        await addItem('ddayCards', {
            docNo: docNo.trim(),
            title: title.trim(),
            deadline,
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
                <button type="submit">올리기</button>
                <button type="button" onClick={() => onGo?.(411)}>업무 할 일</button>
            </form>
            <div className="nb-kanban">
                {COLUMNS.map(([status, label]) => (
                    <section key={status} className={`is-${status}`}>
                        <h3>{label}</h3>
                        <ul>
                            {items.filter((item) => (item.status || 'todo') === status).map((item) => (
                                <Card key={item.id} item={item} signedIn={signedIn} onChanged={onChanged} onGo={onGo} />
                            ))}
                        </ul>
                    </section>
                ))}
            </div>
        </div>
    );
}
