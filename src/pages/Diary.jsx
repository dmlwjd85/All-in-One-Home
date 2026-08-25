import { useMemo, useState } from 'react';
import { Heart, ImagePlus, Trash2 } from 'lucide-react';
import { EmptyState, Field, Modal, SearchBox } from '../components/ui.jsx';
import { addItem, removeItem } from '../lib/store.js';
import { compressImage, todayYmd } from '../lib/utils.js';

const TAGS = ['일상', '성장', '여행', '학교', '기념일', '건강', '기타'];

export default function DiaryPage({ entries, signedIn, author, onChanged, onToast }) {
    const [q, setQ] = useState('');
    const [tag, setTag] = useState('all');
    const [show, setShow] = useState(false);
    const [view, setView] = useState(null);
    const [draft, setDraft] = useState({ date: todayYmd(), title: '', content: '', tag: '일상', image: '', visibility: 'family' });

    const list = useMemo(() => {
        const n = q.trim().toLowerCase();
        return entries
            .filter((e) => tag === 'all' || e.tag === tag)
            .filter((e) => !n || `${e.title} ${e.content} ${e.author} ${e.tag}`.toLowerCase().includes(n))
            .sort((a, b) => String(b.date).localeCompare(String(a.date)));
    }, [entries, q, tag]);

    const onFile = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const image = await compressImage(file);
            setDraft((d) => ({ ...d, image }));
        } catch (err) {
            onToast(err.message);
        }
        e.target.value = '';
    };

    const save = async () => {
        if (!draft.title.trim() && !draft.content.trim()) {
            onToast('제목이나 본문을 적어 주세요.');
            return;
        }
        await addItem('familyDiary', {
            date: draft.date,
            title: draft.title.trim() || draft.content.trim().slice(0, 18),
            content: draft.content.trim(),
            tag: draft.tag,
            image: draft.image,
            visibility: draft.visibility,
            author,
        }, signedIn);
        setShow(false);
        setDraft({ date: todayYmd(), title: '', content: '', tag: '일상', image: '', visibility: 'family' });
        onChanged();
        onToast('가족 기록을 남겼습니다.');
    };

    return (
        <div className="space-y-4">
            <section className="bg-rose-800 text-white rounded-3xl p-5 md:p-7">
                <p className="text-sm font-bold text-rose-100">가족다이어리</p>
                <h2 className="text-2xl md:text-3xl font-black mt-1">우리 이야기만 모이는 공간</h2>
                <p className="mt-2 text-rose-100">광고 없는 가족 타임라인입니다. 글·사진·태그로 나중에 다시 찾을 수 있습니다.</p>
            </section>

            <div className="flex flex-col sm:flex-row gap-2">
                <div className="flex-1"><SearchBox value={q} onChange={setQ} placeholder="제목·본문·작성자 검색" /></div>
                <button type="button" className="btn-primary" onClick={() => setShow(true)}><Heart size={18} /> 기록하기</button>
            </div>

            <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="태그 필터">
                <button type="button" className={`shrink-0 min-h-tap px-4 rounded-full font-bold border ${tag === 'all' ? 'bg-ink-900 text-white' : 'bg-white'}`} onClick={() => setTag('all')}>전체</button>
                {TAGS.map((t) => (
                    <button key={t} type="button" className={`shrink-0 min-h-tap px-4 rounded-full font-bold border ${tag === t ? 'bg-ink-900 text-white' : 'bg-white'}`} onClick={() => setTag(t)}>{t}</button>
                ))}
            </div>

            {list.length === 0 ? (
                <EmptyState title="아직 기록이 없습니다" hint="짧은 한 줄과 사진만으로도 충분합니다." />
            ) : (
                <ol className="space-y-3">
                    {list.map((e) => (
                        <li key={e.id}>
                            <button type="button" className="card w-full text-left overflow-hidden hover:border-stone-400" onClick={() => setView(e)}>
                                {e.image && <img src={e.image} alt="" className="w-full max-h-56 object-cover bg-stone-100" />}
                                <div className="p-4">
                                    <p className="text-sm text-stone-600">{e.date} · {e.tag} · {e.author}{e.visibility === 'private' ? ' · 나만' : ''}</p>
                                    <h3 className="font-black text-lg mt-1">{e.title}</h3>
                                    <p className="text-stone-700 line-clamp-3 mt-1 whitespace-pre-wrap">{e.content}</p>
                                </div>
                            </button>
                        </li>
                    ))}
                </ol>
            )}

            {show && (
                <Modal title="가족 기록" onClose={() => setShow(false)} wide>
                    <Field label="날짜"><input type="date" className="field" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} /></Field>
                    <Field label="제목"><input className="field" value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="오늘의 한 줄" /></Field>
                    <Field label="이야기">
                        <textarea className="field min-h-36 font-serif" value={draft.content} onChange={(e) => setDraft({ ...draft, content: e.target.value })} placeholder="짧게 적어도 됩니다." />
                    </Field>
                    <Field label="태그">
                        <select className="field" value={draft.tag} onChange={(e) => setDraft({ ...draft, tag: e.target.value })}>
                            {TAGS.map((t) => <option key={t}>{t}</option>)}
                        </select>
                    </Field>
                    <Field label="공개 범위" hint="‘나만’은 작성자 이름과 함께 표시되며, 가족 공유 화면에서도 구분됩니다.">
                        <select className="field" value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value })}>
                            <option value="family">가족 전체</option>
                            <option value="private">나만 보기</option>
                        </select>
                    </Field>
                    <label className="btn-secondary w-full mb-4 cursor-pointer">
                        <ImagePlus size={18} /> 사진 넣기
                        <input type="file" accept="image/*" className="sr-only" onChange={onFile} />
                    </label>
                    {draft.image && <img src={draft.image} alt="첨부 미리보기" className="w-full max-h-48 object-contain rounded-2xl mb-4 bg-stone-100" />}
                    <button type="button" className="btn-primary w-full" onClick={save}>저장</button>
                </Modal>
            )}

            {view && (
                <Modal title={view.title} onClose={() => setView(null)} wide>
                    <p className="text-sm text-stone-600 mb-3">{view.date} · {view.tag} · {view.author}</p>
                    {view.image && <img src={view.image} alt="" className="w-full max-h-[50vh] object-contain rounded-2xl bg-stone-100 mb-4" />}
                    <p className="font-serif text-lg whitespace-pre-wrap leading-relaxed">{view.content}</p>
                    <button type="button" className="btn-danger w-full mt-6" onClick={async () => {
                        if (!confirm('이 기록을 삭제할까요?')) return;
                        await removeItem('familyDiary', view.id, signedIn);
                        setView(null);
                        onChanged();
                    }}><Trash2 size={16} /> 삭제</button>
                </Modal>
            )}
        </div>
    );
}
