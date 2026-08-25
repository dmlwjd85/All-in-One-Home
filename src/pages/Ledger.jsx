import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { EmptyState, Field, Modal, SearchBox } from '../components/ui.jsx';
import { addItem, patchItem, removeItem } from '../lib/store.js';
import { LEDGER_EXPENSE, LEDGER_INCOME, catLabel, formatWon, parseAmount, thisMonth, todayYmd } from '../lib/utils.js';

export default function LedgerPage({ items, budgets, signedIn, author, onChanged, onToast }) {
    const [month, setMonth] = useState(thisMonth());
    const [q, setQ] = useState('');
    const [showAdd, setShowAdd] = useState(false);
    const [showBudget, setShowBudget] = useState(false);
    const [draft, setDraft] = useState({
        type: 'expense',
        category: 'food',
        amount: '',
        memo: '',
        date: todayYmd(),
        recurring: false,
    });

    const monthItems = useMemo(() => {
        const needle = q.trim().toLowerCase();
        return items
            .filter((row) => String(row.date || '').startsWith(month))
            .filter((row) => {
                if (!needle) return true;
                const hay = `${row.memo || ''} ${catLabel(row.category)} ${row.author || ''}`.toLowerCase();
                return hay.includes(needle);
            })
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }, [items, month, q]);

    const stats = useMemo(() => {
        let income = 0;
        let expense = 0;
        const byCat = {};
        monthItems.forEach((row) => {
            const amt = Number(row.amount) || 0;
            if (row.type === 'income') income += amt;
            else {
                expense += amt;
                byCat[row.category] = (byCat[row.category] || 0) + amt;
            }
        });
        return { income, expense, net: income - expense, byCat };
    }, [monthItems]);

    const daysInMonth = Number(new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0).getDate());
    const dayNow = month === thisMonth() ? Number(todayYmd().slice(-2)) : daysInMonth;
    const pace = dayNow / daysInMonth;

    const saveTx = async () => {
        const amount = parseAmount(draft.amount);
        if (amount <= 0) {
            onToast('금액을 입력해 주세요.');
            return;
        }
        await addItem('ledgerTx', {
            type: draft.type,
            category: draft.category,
            amount,
            memo: draft.memo.trim(),
            date: draft.date,
            recurring: draft.recurring,
            author,
        }, signedIn);
        setShowAdd(false);
        setDraft({ type: 'expense', category: 'food', amount: '', memo: '', date: todayYmd(), recurring: false });
        onChanged();
        onToast('내역을 저장했습니다.');
    };

    const saveBudget = async (category, raw) => {
        const amount = parseAmount(raw);
        const existing = budgets.find((b) => b.month === month && b.category === category);
        if (existing) {
            await patchItem('ledgerBudgets', existing.id, { amount, month, category }, signedIn);
        } else {
            await addItem('ledgerBudgets', { amount, month, category, author }, signedIn);
        }
        onChanged();
    };

    return (
        <div className="space-y-4">
            <section className="bg-ink-900 text-white rounded-3xl p-5 md:p-7">
                <div className="flex flex-wrap items-end justify-between gap-3">
                    <div>
                        <p className="text-sm font-bold text-teal-200">가계부</p>
                        <h2 className="text-2xl md:text-3xl font-black mt-1">이번 달 흐름을 한눈에</h2>
                    </div>
                    <label className="text-sm font-bold">
                        <span className="sr-only">조회 월</span>
                        <input type="month" className="rounded-xl bg-white/10 border border-white/20 px-3 py-2 text-white" value={month} onChange={(e) => setMonth(e.target.value)} />
                    </label>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-5">
                    <div className="rounded-2xl bg-white/10 p-4">
                        <dt className="text-sm text-teal-100">수입</dt>
                        <dd className="text-xl font-black mt-1">{formatWon(stats.income)}</dd>
                    </div>
                    <div className="rounded-2xl bg-white/10 p-4">
                        <dt className="text-sm text-rose-100">지출</dt>
                        <dd className="text-xl font-black mt-1">{formatWon(stats.expense)}</dd>
                    </div>
                    <div className="rounded-2xl bg-white/10 p-4">
                        <dt className="text-sm text-amber-100">남는 돈</dt>
                        <dd className={`text-xl font-black mt-1 ${stats.net < 0 ? 'text-rose-200' : ''}`}>{formatWon(stats.net)}</dd>
                    </div>
                </dl>
            </section>

            <div className="flex flex-col sm:flex-row gap-2">
                <button type="button" className="btn-primary flex-1" onClick={() => setShowAdd(true)}><Plus size={18} /> 수입·지출 추가</button>
                <button type="button" className="btn-secondary flex-1" onClick={() => setShowBudget(true)}>카테고리 예산</button>
            </div>

            <section className="card p-4 md:p-5" aria-labelledby="budget-heading">
                <h3 id="budget-heading" className="font-black text-lg mb-3">카테고리별 지출 페이스</h3>
                <ul className="space-y-3">
                    {LEDGER_EXPENSE.map((cat) => {
                        const spent = stats.byCat[cat.id] || 0;
                        const cap = Number(budgets.find((b) => b.month === month && b.category === cat.id)?.amount) || 0;
                        const ratio = cap > 0 ? Math.min(100, (spent / cap) * 100) : 0;
                        const overPace = cap > 0 && spent > cap * pace;
                        return (
                            <li key={cat.id}>
                                <div className="flex justify-between text-sm font-bold">
                                    <span>{cat.label}</span>
                                    <span>{formatWon(spent)}{cap > 0 ? ` / ${formatWon(cap)}` : ''}</span>
                                </div>
                                <div className="h-3 rounded-full bg-stone-200 mt-1 overflow-hidden" aria-hidden="true">
                                    <div className={`h-full ${overPace || (cap > 0 && spent > cap) ? 'bg-rose-600' : 'bg-teal-700'}`} style={{ width: `${cap > 0 ? ratio : Math.min(100, spent / Math.max(stats.expense, 1) * 100)}%` }} />
                                </div>
                                {cap > 0 && overPace && <p className="text-xs text-rose-700 mt-1">월말 기준으로 보면 예산을 넘길 속도입니다.</p>}
                            </li>
                        );
                    })}
                </ul>
            </section>

            <section aria-labelledby="tx-heading">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                    <h3 id="tx-heading" className="font-black text-lg">내역</h3>
                    <div className="sm:w-72"><SearchBox value={q} onChange={setQ} placeholder="메모·카테고리·작성자 검색" /></div>
                </div>
                {monthItems.length === 0 ? (
                    <EmptyState title="이달 내역이 없습니다" hint="오른쪽 아래처럼 큰 버튼으로 바로 추가할 수 있습니다." />
                ) : (
                    <ul className="space-y-2">
                        {monthItems.map((row) => (
                            <li key={row.id} className="card p-4 flex items-start justify-between gap-3">
                                <div>
                                    <p className="font-black">{row.memo || catLabel(row.category)}</p>
                                    <p className="text-sm text-stone-600">{row.date} · {catLabel(row.category)}{row.recurring ? ' · 고정' : ''} · {row.author || '가족'}</p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className={`font-black ${row.type === 'income' ? 'text-teal-800' : 'text-rose-800'}`}>
                                        {row.type === 'income' ? '+' : '-'}{formatWon(row.amount)}
                                    </p>
                                    <button type="button" className="text-sm text-stone-500 mt-1 underline" onClick={async () => {
                                        if (!confirm('이 내역을 삭제할까요?')) return;
                                        await removeItem('ledgerTx', row.id, signedIn);
                                        onChanged();
                                    }}><Trash2 size={14} className="inline" /> 삭제</button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </section>

            {showAdd && (
                <Modal title="수입·지출 추가" onClose={() => setShowAdd(false)}>
                    <fieldset className="mb-3">
                        <legend className="text-sm font-extrabold mb-2">구분</legend>
                        <div className="flex gap-2">
                            <button type="button" className={draft.type === 'expense' ? 'btn-primary flex-1' : 'btn-secondary flex-1'} onClick={() => setDraft({ ...draft, type: 'expense', category: 'food' })}>지출</button>
                            <button type="button" className={draft.type === 'income' ? 'btn-primary flex-1' : 'btn-secondary flex-1'} onClick={() => setDraft({ ...draft, type: 'income', category: 'salary' })}>수입</button>
                        </div>
                    </fieldset>
                    <Field label="날짜">
                        <input type="date" className="field" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} />
                    </Field>
                    <Field label="카테고리">
                        <select className="field" value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                            {(draft.type === 'income' ? LEDGER_INCOME : LEDGER_EXPENSE).map((c) => (
                                <option key={c.id} value={c.id}>{c.label}</option>
                            ))}
                        </select>
                    </Field>
                    <Field label="금액(원)" hint="숫자만 입력하면 됩니다.">
                        <input inputMode="numeric" className="field" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} placeholder="예: 12500" />
                    </Field>
                    <Field label="메모">
                        <input className="field" value={draft.memo} onChange={(e) => setDraft({ ...draft, memo: e.target.value })} placeholder="어디서, 무엇을" />
                    </Field>
                    <label className="flex items-center gap-2 mb-4 min-h-tap">
                        <input type="checkbox" checked={draft.recurring} onChange={(e) => setDraft({ ...draft, recurring: e.target.checked })} />
                        <span className="font-bold">매달 반복되는 고정 항목</span>
                    </label>
                    <button type="button" className="btn-primary w-full" onClick={saveTx}>저장</button>
                </Modal>
            )}

            {showBudget && (
                <Modal title={`${month} 카테고리 예산`} onClose={() => setShowBudget(false)}>
                    <p className="text-sm text-stone-600 mb-3">월 한도를 넣으면 지출 속도가 예산보다 빠를 때 알려 줍니다.</p>
                    {LEDGER_EXPENSE.map((cat) => {
                        const current = budgets.find((b) => b.month === month && b.category === cat.id)?.amount || '';
                        return (
                            <Field key={cat.id} label={cat.label}>
                                <input
                                    inputMode="numeric"
                                    className="field"
                                    defaultValue={current || ''}
                                    placeholder="예산 없음"
                                    onBlur={(e) => saveBudget(cat.id, e.target.value)}
                                />
                            </Field>
                        );
                    })}
                    <p className="text-xs text-stone-500">칸 밖을 누르면 자동 저장됩니다.</p>
                </Modal>
            )}
        </div>
    );
}
