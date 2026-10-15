import { useRef, useState } from 'react';
import { Inbox, Pencil, PenLine, Send, Trash2 } from 'lucide-react';
import { EmptyState, Field, Modal } from './ui.jsx';
import { addItem, patchItem, removeItem } from '../lib/store.js';
import {
    destById,
    dest조사,
    destsOn,
    guessAttendStatus,
    guessStudent,
    sendSsugeokItem,
    SSUGEOK_DESTS,
    SSUGEOK_HINTS,
    suggestedDest,
} from '../lib/ssugeok.js';
import { ATTEND_STATUS, todayYmd } from '../lib/utils.js';

const emptySend = (item, destId, names) => ({
    destId,
    item,
    student: guessStudent(item?.text, names),
    date: todayYmd(),
    status: guessAttendStatus(item?.text),
    kind: '상담',
    planKind: destId === 'plan' && item?.typeHint === '일' ? 'week' : 'today',
    newStudent: '',
});

export default function SsugeokInbox({
    inbox,
    roster,
    signedIn,
    author,
    onChanged,
    onToast,
    onView,
}) {
    const names = roster.map((r) => r.name).filter(Boolean);
    const [draft, setDraft] = useState('');
    const [hint, setHint] = useState('생각');
    const [customHint, setCustomHint] = useState('');
    const [editing, setEditing] = useState(null);
    const [send, setSend] = useState(null);
    const [flickSide, setFlickSide] = useState(null);
    const [flickItem, setFlickItem] = useState(null);

    const pending = inbox.filter((row) => row.text);
    const typeHint = hint === '' ? customHint.trim() : hint;

    const addDraft = async () => {
        const text = draft.trim();
        if (!text) {
            onToast('쓱, 적에 넣을 내용을 적어 주세요.');
            return;
        }
        await addItem('ssugeokInbox', { text, typeHint, author }, signedIn);
        setDraft('');
        onChanged();
        onToast('쓱, 적에 넣었습니다. 옆으로 날려보내 보세요.');
    };

    const saveEdit = async () => {
        if (!editing?.id) return;
        const text = String(editing.text || '').trim();
        if (!text) {
            onToast('내용을 비울 수 없습니다.');
            return;
        }
        await patchItem('ssugeokInbox', editing.id, { text, typeHint: editing.typeHint || '' }, signedIn);
        setEditing(null);
        onChanged();
        onToast('쓱, 적을 고쳤습니다.');
    };

    const removeInbox = async (item) => {
        if (!confirm('이 쓱, 적을 삭제할까요?')) return;
        await removeItem('ssugeokInbox', item.id, signedIn);
        onChanged();
    };

    const openSend = (item, destId) => {
        setFlickSide(null);
        setFlickItem(null);
        setSend(emptySend(item, destId, names));
    };

    const confirmSend = async () => {
        if (!send?.item || !send.destId) return;
        const student = (send.newStudent.trim() || send.student).trim();
        try {
            const dest = await sendSsugeokItem({
                destId: send.destId,
                item: send.item,
                extras: {
                    student,
                    date: send.date,
                    status: send.status,
                    kind: send.kind,
                    planKind: send.planKind,
                },
                roster,
                signedIn,
                author,
            });
            setSend(null);
            onChanged();
            onToast(`${dest.label}${dest조사(dest.label)} 날려보냈습니다.`);
            onView(dest.id);
        } catch (err) {
            console.error(err);
            onToast(err.message || '보내기에 실패했습니다.');
        }
    };

    return (
        <div className="space-y-3">
            <section className="card p-4 md:p-5 space-y-3 bg-[#fffaf0]/85">
                <div className="flex items-center gap-3">
                    <span className="w-11 h-11 rounded-2xl bg-amber-900 text-[#fffaf0] flex items-center justify-center">
                        <PenLine size={20} aria-hidden="true" />
                    </span>
                    <div>
                        <h2 className="font-black text-xl leading-tight">쓱, 적에 쏟아 넣기</h2>
                        <p className="text-sm text-stone-600">생각·있었던 일·할 일을 먼저 적고, 카드를 밀어 제자리로 나눕니다.</p>
                    </div>
                </div>
                <div className="flex flex-wrap gap-1" role="group" aria-label="쓱, 적 종류">
                    {SSUGEOK_HINTS.map((h) => (
                        <button
                            key={h}
                            type="button"
                            className={`min-h-tap px-3 rounded-xl font-extrabold border ${hint === h ? 'bg-amber-900 text-white border-amber-900' : 'bg-white border-amber-900/20'}`}
                            onClick={() => setHint(h)}
                        >
                            {h}
                        </button>
                    ))}
                    <button
                        type="button"
                        className={`min-h-tap px-3 rounded-xl font-extrabold border ${hint === '' ? 'bg-amber-900 text-white border-amber-900' : 'bg-white border-amber-900/20'}`}
                        onClick={() => setHint('')}
                    >
                        직접
                    </button>
                </div>
                {hint === '' && (
                    <input
                        className="field"
                        value={customHint}
                        onChange={(e) => setCustomHint(e.target.value)}
                        placeholder="예: 관찰, 가정연락, 준비물"
                        aria-label="직접 적은 종류"
                    />
                )}
                <textarea
                    className="field min-h-32 text-lg"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addDraft();
                    }}
                    placeholder="오늘 있었던 일, 떠오른 생각, 해야 할 일을 그냥 적으세요"
                    aria-label="쓱, 적 내용"
                />
                <button type="button" className="btn-primary w-full" onClick={addDraft}>
                    <Inbox size={18} /> 쓱, 적에 넣기
                </button>
            </section>

            {pending.length === 0 ? (
                <EmptyState title="쓱, 적이 비어 있습니다" hint="위에 한 줄을 적으면 받은함에 쌓입니다. 카드를 좌우로 밀어 학생·출결·상담·주간·업무로 날려보내세요." />
            ) : (
                <ul className="space-y-3">
                    {pending.map((item) => (
                        <li key={item.id}>
                            <FlickCard
                                item={item}
                                onFlick={(side) => {
                                    setFlickItem(item);
                                    setFlickSide(side);
                                }}
                                onSend={(destId) => openSend(item, destId)}
                                onEdit={() => setEditing({ ...item, typeHint: item.typeHint || '' })}
                                onDelete={() => removeInbox(item)}
                            />
                        </li>
                    ))}
                </ul>
            )}

            {flickSide && flickItem && (
                <Modal title="날려보내기" onClose={() => { setFlickSide(null); setFlickItem(null); }}>
                    <p className="text-sm text-stone-600 mb-3 whitespace-pre-wrap">“{flickItem.text}”</p>
                    <div className="grid grid-cols-1 gap-2">
                        {destsOn(flickSide).map((d) => {
                            const suggest = suggestedDest(flickItem.typeHint) === d.id;
                            return (
                                <button
                                    key={d.id}
                                    type="button"
                                    className={`hub-tile min-h-[4.6rem] ${suggest ? 'ring-2 ring-amber-800' : ''}`}
                                    onClick={() => openSend(flickItem, d.id)}
                                >
                                    <span className={`px-3 py-1 rounded-full text-sm font-black ${d.cls}`}>{d.label}</span>
                                    <span className="text-sm font-bold text-stone-600">{d.hint}{suggest ? ' · 추천' : ''}</span>
                                </button>
                            );
                        })}
                    </div>
                </Modal>
            )}

            {editing && (
                <Modal title="쓱, 적 고치기" onClose={() => setEditing(null)}>
                    <Field label="종류">
                        <input className="field" value={editing.typeHint} onChange={(e) => setEditing({ ...editing, typeHint: e.target.value })} placeholder="생각 / 일 / 할일" />
                    </Field>
                    <Field label="내용">
                        <textarea className="field min-h-28" value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                    </Field>
                    <button type="button" className="btn-primary w-full" onClick={saveEdit}>저장</button>
                </Modal>
            )}

            {send && (
                <SendSheet
                    send={send}
                    names={names}
                    onChange={setSend}
                    onClose={() => setSend(null)}
                    onConfirm={confirmSend}
                />
            )}
        </div>
    );
}

function FlickCard({ item, onFlick, onSend, onEdit, onDelete }) {
    const [x, setX] = useState(0);
    const start = useRef(null);
    const locked = useRef(false);
    const suggest = suggestedDest(item.typeHint);

    const reset = () => {
        start.current = null;
        locked.current = false;
        setX(0);
    };

    const onPointerDown = (e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        start.current = { x: e.clientX, y: e.clientY };
        locked.current = false;
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e) => {
        if (!start.current) return;
        const dx = e.clientX - start.current.x;
        const dy = e.clientY - start.current.y;
        if (!locked.current) {
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            if (Math.abs(dy) > Math.abs(dx)) {
                start.current = null;
                return;
            }
            locked.current = true;
        }
        setX(Math.max(-140, Math.min(140, dx)));
    };

    const onPointerUp = () => {
        if (!start.current) {
            reset();
            return;
        }
        const side = x <= -72 ? 'left' : x >= 72 ? 'right' : null;
        reset();
        if (side) onFlick(side);
    };

    return (
        <div className="relative overflow-hidden rounded-3xl">
            <div className="absolute inset-y-0 left-0 w-1/2 bg-sky-100/90 flex items-center pl-3 text-sky-900 font-black text-sm pointer-events-none">
                주간 · 업무
            </div>
            <div className="absolute inset-y-0 right-0 w-1/2 bg-rose-100/90 flex items-center justify-end pr-3 text-rose-900 font-black text-sm pointer-events-none">
                학생 · 출결 · 상담
            </div>
            <article
                className={`flick-card relative card p-4 bg-[#fffdf8] border-amber-900/15 ${x !== 0 ? 'flick-card-dragging' : ''}`}
                style={{ transform: `translateX(${x}px)` }}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={reset}
            >
                <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-extrabold text-amber-900/70">{item.typeHint || '메모'}</p>
                    <div className="flex gap-1" onPointerDown={(e) => e.stopPropagation()}>
                        <button type="button" className="min-h-tap min-w-tap text-stone-600" aria-label="고치기" onClick={onEdit}><Pencil size={16} /></button>
                        <button type="button" className="min-h-tap min-w-tap text-rose-700" aria-label="삭제" onClick={onDelete}><Trash2 size={16} /></button>
                    </div>
                </div>
                <p className="font-black text-lg whitespace-pre-wrap mt-1">{item.text}</p>
                <p className="text-xs text-stone-500 mt-2">카드를 좌우로 밀거나, 아래 칸을 눌러 날려보내세요.</p>
                <div className="flex flex-wrap gap-1 mt-3" onPointerDown={(e) => e.stopPropagation()}>
                    {SSUGEOK_DESTS.map((d) => (
                        <button
                            key={d.id}
                            type="button"
                            className={`min-h-tap px-3 rounded-xl text-sm font-extrabold border border-amber-900/15 ${d.cls} ${suggest === d.id ? 'ring-2 ring-amber-800' : ''}`}
                            onClick={() => onSend(d.id)}
                        >
                            {d.short}
                        </button>
                    ))}
                </div>
            </article>
        </div>
    );
}

function SendSheet({ send, names, onChange, onClose, onConfirm }) {
    const dest = destById(send.destId);
    const needsStudent = dest?.id === 'student' || dest?.id === 'attend' || dest?.id === 'counsel';

    return (
        <Modal title={`${dest?.label || '목적지'}${dest조사(dest?.label)} 날려보내기`} onClose={onClose}>
            <p className="text-sm whitespace-pre-wrap bg-amber-50 border border-amber-900/15 rounded-2xl p-3 mb-3">{send.item.text}</p>
            {needsStudent && (
                <>
                    {names.length > 0 && (
                        <Field label="학생">
                            <select className="field" value={send.student} onChange={(e) => onChange({ ...send, student: e.target.value })}>
                                <option value="">선택</option>
                                {names.map((n) => <option key={n} value={n}>{n}</option>)}
                            </select>
                        </Field>
                    )}
                    <Field label={names.length ? '또는 새 학생' : '학생 이름'} hint="명단에 없으면 최소 명단에 함께 넣습니다.">
                        <input className="field" value={send.newStudent} onChange={(e) => onChange({ ...send, newStudent: e.target.value })} placeholder="이름" />
                    </Field>
                </>
            )}
            {dest?.id === 'attend' && (
                <>
                    <Field label="날짜">
                        <input type="date" className="field" value={send.date} onChange={(e) => onChange({ ...send, date: e.target.value })} />
                    </Field>
                    <Field label="상태">
                        <select className="field" value={send.status} onChange={(e) => onChange({ ...send, status: e.target.value })}>
                            {ATTEND_STATUS.map((s) => <option key={s}>{s}</option>)}
                        </select>
                    </Field>
                </>
            )}
            {dest?.id === 'counsel' && (
                <Field label="기록 종류">
                    <div className="flex gap-2">
                        {['상담', '누가'].map((k) => (
                            <button
                                key={k}
                                type="button"
                                className={`btn flex-1 ${send.kind === k ? 'btn-primary' : 'btn-secondary'}`}
                                onClick={() => onChange({ ...send, kind: k })}
                            >
                                {k}
                            </button>
                        ))}
                    </div>
                </Field>
            )}
            {dest?.id === 'plan' && (
                <>
                    <Field label="어디에 둘까요">
                        <div className="flex gap-2">
                            <button type="button" className={`btn flex-1 ${send.planKind === 'today' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => onChange({ ...send, planKind: 'today' })}>오늘</button>
                            <button type="button" className={`btn flex-1 ${send.planKind === 'week' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => onChange({ ...send, planKind: 'week' })}>이번 주</button>
                        </div>
                    </Field>
                    <Field label="날짜">
                        <input type="date" className="field" value={send.date} onChange={(e) => onChange({ ...send, date: e.target.value })} />
                    </Field>
                </>
            )}
            {dest?.id === 'task' && (
                <Field label="할 날">
                    <input type="date" className="field" value={send.date} onChange={(e) => onChange({ ...send, date: e.target.value })} />
                </Field>
            )}
            {dest?.id === 'student' && (
                <Field label="날짜">
                    <input type="date" className="field" value={send.date} onChange={(e) => onChange({ ...send, date: e.target.value })} />
                </Field>
            )}
            <button type="button" className="btn-primary w-full" onClick={onConfirm}>
                <Send size={18} /> {dest?.label}로 보내기
            </button>
        </Modal>
    );
}
