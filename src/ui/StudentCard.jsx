import { useEffect, useMemo, useState } from 'react';
import { ALLERGENS, allergenName, allergyHits, cleanAllergy, hitLine } from '../lib/allergy.js';
import { joined, saveStudentCard, studentCardLocal, studentLegacyFields } from '../lib/db.js';
import { mealsFromNotes } from '../lib/mealPaste.js';
import { CARD_LAYOUT_KEY, CARD_SECTIONS, cleanCardLayout, moveSection } from './cardLayout.js';
import { useUi } from './context.jsx';
import { Btn } from './bits.jsx';

function readLayout() { try { return cleanCardLayout(JSON.parse(localStorage.getItem(CARD_LAYOUT_KEY) || 'null')); } catch { return cleanCardLayout(null); } }
function writeLayout(layout) { try { localStorage.setItem(CARD_LAYOUT_KEY, JSON.stringify(layout)); } catch { /* 이번에만 */ } }

function telHref(phone) {
    const digits = String(phone || '').replace(/[^\d+]/g, '');
    return digits.length >= 7 ? `tel:${digits}` : '';
}

function Section({ meta, layout, index, summary, onToggle, onMove, children }) {
    const open = !layout.folded.includes(meta.id);
    const bodyId = `card-sec-${meta.id}`;
    return (
        <section className="solid-card card-sec" data-card-sec={meta.id} data-open={open ? '1' : '0'}>
            <div className="card-sec-top">
                <h3 className="card-sec-h">
                    <Btn className="card-sec-head" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(meta.id)}>
                        <span className="card-sec-text">
                            <span className="card-sec-title">{meta.local ? '🔒 ' : ''}{meta.title}</span>
                            {!open && summary ? <span className="card-sec-sum muted clip1">{summary}</span> : null}
                        </span>
                        <span aria-hidden="true">{open ? '▴' : '▾'}</span>
                    </Btn>
                </h3>
                <Btn className="chip card-sec-move" aria-label={`${meta.title} 위로`} disabled={index === 0} onClick={() => onMove(meta.id, -1)}>▲</Btn>
                <Btn className="chip card-sec-move" aria-label={`${meta.title} 아래로`} disabled={index === layout.order.length - 1} onClick={() => onMove(meta.id, 1)}>▼</Btn>
            </div>
            {open ? <div className="card-sec-body" id={bodyId}>{children}</div> : null}
        </section>
    );
}

/** 학생 한 명의 카드. children 은 '기록' 묶음에 들어갈 기존 기록 화면입니다. */
export function StudentCard({ student, recordSummary = '', children }) {
    const { data, clock, showToast } = useUi();
    const [layout, setLayout] = useState(readLayout);
    const savedLocal = useMemo(() => studentCardLocal(data, student.id), [data, student.id]);
    const legacy = useMemo(() => studentLegacyFields(data, student.id), [data, student.id]);
    const [form, setForm] = useState(null);
    /* 다른 학생으로 넘어가면 쓰던 칸을 비웁니다. */
    useEffect(() => { setForm(null); }, [student.id]);
    const base = {
        birthday: student.birthday || '', sex: student.sex || '', memo: student.memo || '', allergy: cleanAllergy(student.allergy),
        contacts: savedLocal.contacts.length ? savedLocal.contacts : [{ who: '', phone: '', note: '' }],
        allergyNote: savedLocal.allergyNote, health: savedLocal.health, family: savedLocal.family, etc: savedLocal.etc,
    };
    const now = form || base;
    const dirty = Boolean(form);
    const patch = (next) => setForm({ ...now, ...next });
    const change = (next) => { setLayout(next); writeLayout(next); };
    const toggle = (id) => change({ ...layout, folded: layout.folded.includes(id) ? layout.folded.filter((x) => x !== id) : [...layout.folded, id] });
    const move = (id, step) => change(moveSection(layout, id, step));

    async function save() {
        const result = await saveStudentCard(student.id, { birthday: now.birthday, sex: now.sex, memo: now.memo, allergy: now.allergy }, { contacts: now.contacts, allergyNote: now.allergyNote, health: now.health, family: now.family, etc: now.etc });
        if (!result.ok) { if (result.message) showToast(result.message); return; }
        setForm(null);
        showToast(result.message, true);
    }

    const todayMeal = mealsFromNotes(joined(data, 'notes'))[clock.ymd];
    const todayHit = allergyHits([{ ...student, allergy: now.allergy }], todayMeal)[0];
    const phones = now.contacts.filter((c) => c.who || c.phone);
    const summary = {
        basic: [now.birthday ? `생일 ${Number(now.birthday.slice(0, 2))}/${Number(now.birthday.slice(3))}` : '', now.sex, now.memo].filter(Boolean).join(' · ') || '아직 비어 있어요',
        allergy: now.allergy.length ? now.allergy.map(allergenName).join(', ') : '없음',
        contacts: phones.length ? phones.map((c) => c.who || c.phone).join(', ') : '아직 비어 있어요',
        health: now.health.split('\n')[0] || '아직 비어 있어요',
        family: now.family.split('\n')[0] || '아직 비어 있어요',
        etc: now.etc.split('\n')[0] || (legacy.length ? `예전 수첩 ${legacy.length}칸` : '아직 비어 있어요'),
        records: recordSummary,
    };
    const body = {
        basic: (
            <div className="card-grid">
                <label className="card-field">생일(월-일)
                    <input className="field" inputMode="numeric" placeholder="03-15" aria-label="생일 월-일" value={now.birthday} onChange={(event) => patch({ birthday: event.target.value.replace(/[^\d-]/g, '').slice(0, 5) })} />
                </label>
                <div className="card-field">성별
                    <div className="card-chips" role="group" aria-label="성별">
                        {['남', '여'].map((sex) => <Btn key={sex} className={now.sex === sex ? 'chip on' : 'chip'} aria-pressed={now.sex === sex} onClick={() => patch({ sex: now.sex === sex ? '' : sex })}>{sex}</Btn>)}
                    </div>
                </div>
                <label className="card-field card-wide">한 줄 메모
                    <input className="field" maxLength={200} placeholder="자리, 역할, 좋아하는 것" aria-label="한 줄 메모" value={now.memo} onChange={(event) => patch({ memo: event.target.value })} />
                </label>
            </div>
        ),
        allergy: (
            <>
                <p className="muted card-note">해당하는 것을 눌러 주세요. 급식에 나오는 날 오늘 화면에 알려 드려요. 번호만 계정에 올라가 폰과 컴퓨터에서 같이 보여요.</p>
                <div className="card-chips" role="group" aria-label="알레르기">
                    {ALLERGENS.map(([code, label]) => {
                        const on = now.allergy.includes(code);
                        return <Btn key={code} className={on ? 'chip on' : 'chip'} data-allergy={code} aria-pressed={on} onClick={() => patch({ allergy: on ? now.allergy.filter((c) => c !== code) : cleanAllergy([...now.allergy, code]) })}>{code}. {label}</Btn>;
                    })}
                </div>
                {todayHit ? <p className="low-card card-hit" role="status">오늘 급식: {todayHit.items.map((item) => `${item.name}(${item.hits.map((h) => (h.sure ? h.label : `${h.label}·짐작`)).join(', ')})`).join(', ')}</p> : null}
                <label className="card-field">🔒 자세한 내용(이 기기에만)
                    <textarea className="field" rows={2} maxLength={1000} placeholder="증상, 대체식, 약 보관 위치" aria-label="알레르기 자세한 내용" value={now.allergyNote} onChange={(event) => patch({ allergyNote: event.target.value })} />
                </label>
            </>
        ),
        contacts: (
            <>
                {now.contacts.map((c, index) => (
                    <div key={index} className="card-contact" data-contact={index}>
                        <input className="field" placeholder="관계(어머니)" aria-label={`보호자 ${index + 1} 관계`} maxLength={12} value={c.who} onChange={(event) => patch({ contacts: now.contacts.map((row, i) => (i === index ? { ...row, who: event.target.value } : row)) })} />
                        <input className="field" type="tel" inputMode="tel" placeholder="전화번호" aria-label={`보호자 ${index + 1} 전화번호`} maxLength={20} value={c.phone} onChange={(event) => patch({ contacts: now.contacts.map((row, i) => (i === index ? { ...row, phone: event.target.value } : row)) })} />
                        {telHref(c.phone) ? <a className="tap chip card-call" href={telHref(c.phone)} aria-label={`${c.who || '보호자'}에게 전화`}>전화</a> : <span className="card-call" aria-hidden="true" />}
                    </div>
                ))}
                {now.contacts.length < 6 ? <Btn className="chip" data-role="contact-add" onClick={() => patch({ contacts: [...now.contacts, { who: '', phone: '', note: '' }] })}>+ 연락처 더하기</Btn> : null}
            </>
        ),
        health: <textarea className="field" rows={3} maxLength={1000} placeholder="복용 약, 보건실 이용, 시력·청력, 배려할 점" aria-label="건강·특이사항" value={now.health} onChange={(event) => patch({ health: event.target.value })} />,
        family: <textarea className="field" rows={3} maxLength={1000} placeholder="하교 방법, 방과후·돌봄·학원, 형제자매" aria-label="가정·하교·방과후" value={now.family} onChange={(event) => patch({ family: event.target.value })} />,
        etc: (
            <>
                <textarea className="field" rows={3} maxLength={1000} placeholder="그 밖에 적어 둘 것" aria-label="그 밖의 메모" value={now.etc} onChange={(event) => patch({ etc: event.target.value })} />
                {legacy.length ? (
                    <div className="card-legacy">
                        <p className="muted card-note">예전 수첩에서 옮겨 온 칸</p>
                        {legacy.map((row) => <p key={row.id} className="card-note"><b>{row.label}</b> {row.value}</p>)}
                    </div>
                ) : null}
            </>
        ),
        records: children,
    };
    return (
        <div className="student-card" data-role="student-card">
            {layout.order.map((id, index) => {
                const meta = CARD_SECTIONS.find((s) => s.id === id);
                return (
                    <Section key={id} meta={meta} layout={layout} index={index} summary={summary[id]} onToggle={toggle} onMove={move}>
                        {meta.local ? <p className="muted card-note">🔒 이 칸은 이 기기에만 저장돼요. 다른 기기에서는 보이지 않아요.</p> : null}
                        {body[id]}
                    </Section>
                );
            })}
            {dirty ? (
                <div className="card-save" role="region" aria-label="학생카드 저장">
                    <span>고친 내용이 있어요.</span>
                    <Btn className="chip" onClick={() => setForm(null)}>되돌리기</Btn>
                    <Btn className="primary-btn" data-role="card-save" onClick={save}>저장</Btn>
                </div>
            ) : null}
        </div>
    );
}

/** 오늘 급식에 알레르기가 걸리는 학생 알림. 오늘 화면 맨 위에 둡니다. 하루에 한 번 기기 알림도 띄웁니다(허용했을 때). */
export function AllergyBanner() {
    const { data, clock, go } = useUi();
    const day = mealsFromNotes(joined(data, 'notes'))[clock.ymd];
    const hits = useMemo(() => allergyHits(data.students, day), [data.students, day]);
    const lines = hits.map(hitLine);
    const text = lines.join('\n');
    useEffect(() => {
        if (!text) return;
        const key = 'ssug-gyomu-allergy-noti';
        try {
            if (localStorage.getItem(key) === `${clock.ymd}:${text.length}`) return;
            if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
            new Notification('오늘 급식 알레르기 확인', { body: text, tag: 'ssug-gyomu-allergy', icon: 'apple-touch-icon.png' });
            localStorage.setItem(key, `${clock.ymd}:${text.length}`);
        } catch { /* 알림을 못 띄워도 화면 띠는 보입니다. */ }
    }, [text, clock.ymd]);
    if (!hits.length) return null;
    return (
        <section className="low-card allergy-banner" role="alert" data-role="allergy-banner">
            <strong>오늘 급식 알레르기 확인 · {hits.length}명</strong>
            <ul>
                {hits.map((hit) => (
                    <li key={hit.student.id}>
                        <Btn className="chip allergy-who" onClick={() => go(`#/students/${hit.student.no}`)}>{hit.student.no}번 {hit.student.name}</Btn>
                        <span>{hit.items.map((item) => `${item.name}(${item.hits.map((h) => (h.sure ? h.label : `${h.label}·짐작`)).join(', ')})`).join(', ')}</span>
                    </li>
                ))}
            </ul>
            <p className="muted">‘짐작’은 메뉴 이름으로 미루어 본 것이라 틀릴 수 있어요. 영양 선생님 식단표로 한 번 더 확인해 주세요.</p>
        </section>
    );
}
