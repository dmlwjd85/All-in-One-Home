import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { joined } from '../lib/db.js';
import { PHOTO_MAX_PER_OWNER, addPhoto, listPhotos, photoCounts, photoData, photoUrl, removePhoto, subscribePhotos, syncPhotos, usePhotoMemory } from '../lib/photos.js';
import { useUi } from './context.jsx';
import { Btn } from './bits.jsx';

/** 올려도 되는 글인지: true · false(이 기기 전용) · null(이 기기가 아직 모르는 글). */
export function photoEligible(data) {
    const map = new Map();
    for (const bucket of ['notes', 'records']) {
        for (const row of joined(data, bucket)) map.set(`${bucket}-${row.id}`, !row.localOnly);
    }
    return (owner) => (map.has(owner) ? map.get(owner) : null);
}

function useWho() {
    const { data } = useUi();
    const uid = data.auth?.uid || '';
    const shared = Boolean(data.profile?.sharedPc);
    usePhotoMemory(shared);
    return useMemo(() => ({ uid, memoryOnly: shared }), [uid, shared]);
}

/** 글마다 붙은 사진 수. 목록의 '📷 2' 표시에 씁니다. */
export function usePhotoCounts() {
    const { data } = useUi();
    const who = useWho();
    const [counts, setCounts] = useState({});
    const eligibleRef = useRef(null);
    eligibleRef.current = photoEligible(data);
    useEffect(() => {
        let alive = true;
        const read = () => photoCounts().then((next) => { if (alive) setCounts(next); }).catch(() => {});
        read();
        const stop = subscribePhotos(read);
        /* 다른 기기에서 붙인 사진의 표지를 받습니다(1분에 한 번까지). */
        if (who.uid) syncPhotos(who, (key) => eligibleRef.current(key)).catch(() => {});
        return () => { alive = false; stop(); };
    }, [who]);
    return counts;
}

function Thumb({ photo, who, n, onOpen }) {
    const [url, setUrl] = useState('');
    const [missing, setMissing] = useState(false);
    useEffect(() => {
        let alive = true;
        photoData(photo.id, who).then((data) => {
            if (!alive) return;
            setUrl(photoUrl(data));
            setMissing(!data);
        });
        return () => { alive = false; };
    }, [photo.id, who]);
    return (
        <li>
            <Btn className="photo-thumb" data-photo={photo.id} aria-label={`사진 ${n} 크게 보기`} onClick={() => onOpen({ ...photo, url, n })}>
                {url ? <img src={url} alt="" loading="lazy" /> : <span className="photo-wait">{missing ? '받지 못했어요' : '받는 중'}</span>}
            </Btn>
        </li>
    );
}

function Viewer({ photo, onClose, onRemove }) {
    const [asking, setAsking] = useState(false);
    const [zoom, setZoom] = useState(false);
    useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);
    return createPortal(
        <div className="photo-view" role="dialog" aria-modal="true" aria-label={`사진 ${photo.n}`} data-role="photo-view" onClick={onClose}>
            {/* 사진을 누르면 원래 크기로 키워 글씨를 읽고, 다시 누르면 화면에 맞춥니다. */}
            <div className={zoom ? 'photo-view-img is-zoom' : 'photo-view-img'} onClick={(event) => event.stopPropagation()}>
                {photo.url ? <img src={photo.url} alt={`붙인 사진 ${photo.n}`} data-zoom={zoom ? '1' : '0'} onClick={() => setZoom((on) => !on)} /> : <p>사진을 받지 못했어요. 인터넷에 이어진 뒤 다시 열어 주세요.</p>}
            </div>
            <div className="photo-view-bar" onClick={(event) => event.stopPropagation()}>
                {asking ? (
                    <>
                        <span className="photo-view-ask">이 사진을 지울까요?</span>
                        <Btn className="primary-btn minutes-danger" data-role="photo-remove-yes" onClick={() => onRemove(photo.id)}>지우기</Btn>
                        <Btn className="chip" onClick={() => setAsking(false)}>그만두기</Btn>
                    </>
                ) : (
                    <>
                        <Btn className="primary-btn" data-role="photo-close" onClick={onClose}>닫기</Btn>
                        {photo.url ? <Btn className="chip" data-role="photo-zoom" aria-pressed={zoom} onClick={() => setZoom((on) => !on)}>{zoom ? '화면에 맞추기' : '크게'}</Btn> : null}
                        {photo.url ? <a className="tap chip photo-save" href={photo.url} download={`사진-${photo.id}.jpg`}>내려받기</a> : null}
                        <Btn className="chip" data-role="photo-remove" onClick={() => setAsking(true)}>지우기</Btn>
                    </>
                )}
            </div>
        </div>,
        document.body,
    );
}

const WHY = {
    full: `사진은 한 글에 ${PHOTO_MAX_PER_OWNER}장까지 붙일 수 있어요.`,
    read: '이 파일은 사진으로 읽지 못했어요.',
    storage: '이 기기에 남은 공간이 없어 사진을 붙이지 못했어요.',
};

/** 회의록·학생 기록 아래의 사진 줄. owner 는 photoOwner('notes'|'records', id). */
export function PhotoStrip({ owner, localOnly = false }) {
    const { data, showToast } = useUi();
    const who = useWho();
    const [photos, setPhotos] = useState([]);
    const [open, setOpen] = useState(null);
    const [busy, setBusy] = useState(false);
    const input = useRef(null);
    const eligible = useMemo(() => photoEligible(data), [data]);
    const eligibleRef = useRef(eligible);
    eligibleRef.current = eligible;

    useEffect(() => {
        let alive = true;
        const read = () => listPhotos(owner).then((next) => { if (alive) setPhotos(next); }).catch(() => {});
        read();
        const stop = subscribePhotos(read);
        if (who.uid) syncPhotos(who, (key) => eligibleRef.current(key)).catch(() => {});
        return () => { alive = false; stop(); };
    }, [owner, who]);

    async function pick(event) {
        const files = [...(event.target.files || [])];
        event.target.value = '';
        if (!files.length || busy) return;
        setBusy(true);
        let added = 0;
        let why = '';
        for (const file of files) {
            const result = await addPhoto(owner, file);
            if (result.ok) added += 1;
            else { why = result.why; if (why !== 'read') break; }
        }
        setBusy(false);
        if (added) showToast(localOnly || !who.uid ? `사진 ${added}장을 이 기기에 붙였어요.` : `사진 ${added}장을 붙였어요.`, true);
        if (why) showToast(WHY[why] || WHY.read);
        if (added && who.uid) syncPhotos(who, (key) => eligibleRef.current(key), { force: true }).catch(() => {});
    }

    async function drop(id) {
        await removePhoto(id);
        setOpen(null);
        showToast('사진을 지웠어요.', true);
        if (who.uid) syncPhotos(who, (key) => eligibleRef.current(key), { force: true }).catch(() => {});
    }

    const full = photos.length >= PHOTO_MAX_PER_OWNER;
    return (
        <section className="photo-strip" data-role="photos" data-owner={owner} aria-label="붙인 사진">
            {photos.length ? (
                <ul className="photo-list">
                    {photos.map((photo, i) => <Thumb key={photo.id} photo={photo} who={who} n={i + 1} onOpen={setOpen} />)}
                </ul>
            ) : null}
            <div className="photo-row">
                <Btn className="chip photo-add" data-role="photo-add" aria-busy={busy} disabled={full || busy} onClick={() => input.current?.click()}>📷 {busy ? '줄이는 중' : '사진 붙이기'}</Btn>
                <span className="muted photo-count">{photos.length}/{PHOTO_MAX_PER_OWNER}장{localOnly ? ' · 🔒 이 기기에만 있어요' : ''}</span>
                <input ref={input} type="file" accept="image/*" multiple aria-label="붙일 사진" style={{ display: 'none' }} data-role="photo-input" onChange={pick} />
            </div>
            {open ? <Viewer photo={open} onClose={() => setOpen(null)} onRemove={drop} /> : null}
        </section>
    );
}
