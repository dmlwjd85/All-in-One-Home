import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useEscape } from './StorageNotice.jsx';
import { DEFAULT_LINKS, MAX_LINKS, MAX_TITLE, MAX_URL, addLink, linkHost, moveLink, readLinks, removeLink, restoreDefaults, subscribeLinks, updateLink } from '../lib/eduLinks.js';
import { readFold, writeFold } from './Fold.jsx';
import { Btn } from './bits.jsx';

/* 교육 사이트 바로가기(G1, 시안 C). 넓은 화면은 왼쪽 메뉴 아래 묶음, 좁은 화면은 오늘 화면의 접는 블록.
   링크는 새 탭(rel=noopener noreferrer)으로 열고, 아이디·비밀번호 칸은 어디에도 없습니다. */

export function useEduLinks() {
    const [items, setItems] = useState(() => readLinks());
    useEffect(() => subscribeLinks(setItems), []);
    return items;
}

function LinkA({ row, className }) {
    return (
        <a className={className} href={row.url} target="_blank" rel="noopener noreferrer" data-edu-link={row.id} aria-label={`${row.title}, 새 탭에서 열기`}>
            <span className="edu-name">{row.title}</span>
            <span className="edu-ext muted" aria-hidden="true">새 탭</span>
        </a>
    );
}

/** 왼쪽 메뉴 아래 묶음(900px 이상에서만 보입니다). */
export function SideLinks() {
    const items = useEduLinks();
    const [edit, setEdit] = useState(false);
    return (
        <section className="side-links" aria-labelledby="side-links-title">
            <h2 id="side-links-title" className="side-links-title">교육 사이트</h2>
            <div className="side-links-list">
                {items.map((row) => <LinkA key={row.id} row={row} className="tap chip block side-link" />)}
                <Btn block className="chip side-link side-link-edit" data-edu-edit="side" onClick={() => setEdit(true)}>사이트 고치기</Btn>
            </div>
            <p className="muted side-links-note">비밀번호는 저장하지 않아요.</p>
            {edit && <LinksSheet onClose={() => setEdit(false)} />}
        </section>
    );
}

/** 좁은 화면의 접는 블록. 처음엔 접혀 있고 이름 목록만 보입니다. */
export function HomeLinks() {
    const items = useEduLinks();
    const [open, setOpen] = useState(() => readFold().links === true);
    const [edit, setEdit] = useState(false);
    const toggle = () => { const next = !open; setOpen(next); writeFold('links', next); };
    return (
        <section className="glass home-links" data-open={open ? '1' : '0'} aria-labelledby="home-links-title">
            <h2 className="home-links-h">
                <Btn className="home-links-head" aria-expanded={open} aria-controls="home-links-body" onClick={toggle}>
                    <span className="home-links-text">
                        <span id="home-links-title" className="home-links-title">교육 사이트 바로가기</span>
                        {!open && <span className="home-links-sum muted">{items.length ? items.map((row) => row.title).join(' · ') : '아직 없어요. 펼쳐서 더해요.'}</span>}
                    </span>
                    <span className="store-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
                </Btn>
            </h2>
            {open && (
                <div id="home-links-body">
                    <div className="edu-chips">
                        {items.map((row) => <LinkA key={row.id} row={row} className="tap chip edu-chip" />)}
                        <Btn className="chip edu-chip edu-chip-edit" data-edu-edit="home" onClick={() => setEdit(true)}>고치기</Btn>
                    </div>
                    <p className="muted edu-note">새 탭으로 열려요. 비밀번호는 저장하지 않아요.</p>
                </div>
            )}
            {edit && <LinksSheet onClose={() => setEdit(false)} />}
        </section>
    );
}

/** 더하기·이름 고치기·순서·지우기. 이름과 주소 두 칸뿐입니다. */
export function LinksSheet({ onClose }) {
    const items = useEduLinks();
    const [form, setForm] = useState(null);
    const [ask, setAsk] = useState('');
    const [message, setMessage] = useState('');
    const missing = DEFAULT_LINKS.some((row) => !items.some((item) => item.id === row.id));
    useEscape(onClose);
    function save(event) {
        event.preventDefault();
        const result = form.id ? updateLink(items, form.id, form) : addLink(items, form);
        if (!result.ok) { setMessage(result.message); return; }
        setMessage(form.id ? '고쳤어요.' : '더했어요.');
        setForm(null);
    }
    /* 사이드바(sticky) 쌓임 순서에 갇히면 오른쪽 아래 쨈 버튼(z 30)이 시트를 가립니다. body 에 바로 그립니다. */
    return createPortal(
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet links-sheet" role="dialog" aria-modal="true" aria-labelledby="links-sheet-title" data-edu-sheet="1" onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                <h2 id="links-sheet-title" className="title-font" style={{ margin: 0 }}>교육 사이트 바로가기</h2>
                <p className="muted" style={{ marginTop: 4 }}>이름과 주소만 이 브라우저에 두고, 계정·백업의 '기록 내려받기' 파일에도 함께 넣어요. 아이디·비밀번호는 적는 칸이 없어요. 로그인은 사이트에서 직접 해 주세요.</p>
                <ul className="links-rows">
                    {items.map((row, index) => (
                        <li key={row.id} className="links-row" data-edu-row={row.id}>
                            <div className="links-row-text">
                                <strong className="links-name">{row.title}</strong>
                                <span className="muted links-host">{linkHost(row.url)}</span>
                            </div>
                            {ask === row.id ? (
                                <div className="links-row-btns" role="group" aria-label={`${row.title} 지우기 확인`}>
                                    <Btn className="chip" data-edu-del-yes={row.id} onClick={() => { removeLink(items, row.id); setAsk(''); setMessage(`${row.title}을(를) 지웠어요.`); }}>지우기</Btn>
                                    <Btn className="chip" onClick={() => setAsk('')}>취소</Btn>
                                </div>
                            ) : (
                                <div className="links-row-btns">
                                    <Btn className="icon-btn" aria-label={`${row.title} 위로`} disabled={index === 0} onClick={() => moveLink(items, row.id, -1)}>↑</Btn>
                                    <Btn className="icon-btn" aria-label={`${row.title} 아래로`} disabled={index === items.length - 1} onClick={() => moveLink(items, row.id, 1)}>↓</Btn>
                                    <Btn className="chip" data-edu-fix={row.id} onClick={() => { setForm({ id: row.id, title: row.title, url: row.url }); setMessage(''); }}>고치기</Btn>
                                    <Btn className="chip" data-edu-del={row.id} onClick={() => setAsk(row.id)}>지우기</Btn>
                                </div>
                            )}
                        </li>
                    ))}
                    {!items.length && <li className="muted">바로가기가 없어요.</li>}
                </ul>
                {form ? (
                    <form className="links-form" onSubmit={save} autoComplete="off" noValidate data-edu-form="1">
                        <label className="links-label" htmlFor="edu-title">이름</label>
                        <input id="edu-title" className="field" type="text" autoComplete="off" maxLength={MAX_TITLE} placeholder="예: 우리 학교 홈페이지" value={form.title} onChange={(event) => setForm({ ...form, title: event.target.value })} />
                        <label className="links-label" htmlFor="edu-url">주소</label>
                        <input id="edu-url" className="field" type="url" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} maxLength={MAX_URL} placeholder="https://" value={form.url} onChange={(event) => setForm({ ...form, url: event.target.value })} />
                        <div className="links-form-btns">
                            <Btn type="submit" className="primary-btn" data-edu-save="1">{form.id ? '고친 대로 두기' : '더하기'}</Btn>
                            <Btn className="chip" onClick={() => { setForm(null); setMessage(''); }}>취소</Btn>
                        </div>
                    </form>
                ) : (
                    <div className="links-form-btns">
                        <Btn className="chip" data-edu-add="1" disabled={items.length >= MAX_LINKS} onClick={() => { setForm({ id: '', title: '', url: '' }); setMessage(''); }}>{items.length >= MAX_LINKS ? `${MAX_LINKS}개까지 넣었어요` : '사이트 더하기'}</Btn>
                        {missing && <Btn className="chip" data-edu-restore="1" onClick={() => { restoreDefaults(items); setMessage('기본 사이트를 다시 넣었어요.'); }}>기본 사이트 되돌리기</Btn>}
                    </div>
                )}
                {message && <p role="status" className="links-msg">{message}</p>}
                <Btn className="chip block" style={{ marginTop: 12 }} onClick={onClose}>닫기</Btn>
            </div>
        </div>,
        document.body,
    );
}
