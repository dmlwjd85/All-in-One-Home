import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cloudReady } from '../firebase.js';
import { GUIDE_STEPS, foldForReturning, guideDone, isReturning, markNoticeSeen, noticeFor, readOnboard, setNotice, setStep, subscribeOnboard } from '../lib/onboard.js';
import { useUi } from './context.jsx';
import { Btn } from './bits.jsx';

/* 문구 근거(과장 금지):
   ① 이 기기 저장: src/lib/db.js createVault('ssug-gyomu') — 로그인 전에는 클라우드로 보내지 않습니다.
   ② 민감 낱말: src/lib/sensitive.js SENSITIVE_WORDS, src/lib/cloudShape.js toCloudRow(민감하면 null, 학생 메모는 비움),
      민감 기록은 createVault('ssug-gyomu-local').
   ③ 로그인: src/lib/cloud.js users/{uid} 아래 명단·출결·기록·일정·할 일·메모·알림장, firestore.rules isOwner(uid).
   ④ 공용 컴퓨터: src/ui/Start.jsx·Settings.jsx — 로그인이 이 탭에만 남고 탭을 닫으면 로그아웃. */
export function noticeItems({ ready, signedIn, shared }) {
    const cloud = !ready
        ? { title: '클라우드는 아직 연결 전이에요', text: '지금은 모두 이 기기에만 저장돼요.' }
        : signedIn
            ? { title: '로그인한 내 계정 칸에만 올라가요', text: '명단·출결·기록·일정·할 일·메모·알림장이 내 구글 계정 칸에 올라가 폰과 컴퓨터에서 이어져요. 그 계정으로 로그인해야만 열 수 있어요.' }
            : { title: '로그인하면 내 계정 칸에만 올라가요', text: '지금은 이 기기에만 있어요. 구글로 로그인하면 명단·출결·기록·일정·할 일·메모·알림장이 내 계정 칸에 올라가 폰과 컴퓨터에서 이어져요.' };
    return [
        { id: 'device', title: '먼저 이 기기에 저장해요', text: '할 일·일정·출결·명단·기록은 먼저 이 브라우저 저장소에 남아요. 브라우저 데이터를 지우면 함께 사라지니 설정 › 계정·백업에서 백업 파일을 받아 두세요.', code: 'ssug-gyomu' },
        { id: 'sensitive', title: '민감한 기록은 이 기기에만 둬요', text: '학교폭력·민원·투약·알레르기·건강처럼 민감한 낱말이 든 기록은 따로 두고 클라우드에 올리지 않아요.', code: 'ssug-gyomu-local' },
        { id: 'cloud', ...cloud },
        shared
            ? { id: 'shared', title: '공용 컴퓨터 모드가 켜져 있어요', text: '로그인이 이 탭에만 남고, 탭을 닫으면 로그아웃돼요.' }
            : { id: 'shared', title: '공용 컴퓨터라면 모드를 켜 주세요', text: '설정 › 계정·백업에서 켜면 로그인이 이 탭에만 남고, 탭을 닫으면 로그아웃돼요.' },
    ];
}

export function useOnboard() {
    const [onboard, setOnboard] = useState(() => readOnboard());
    useEffect(() => subscribeOnboard(setOnboard), []);
    return onboard;
}

/** 휴대폰(900px 미만)에서 접은 머리 줄 자리. 'end' = 오늘 화면 맨 아래, 'top' = 맨 위.
    사용자 결정에 따라 이 한 줄만 바꾸면 됩니다('top'이면 check:browser 의 6교시 첫 화면 규칙을 따로 맞춰야 합니다). */
export const PHONE_FOLD_PLACE = 'end';

/** 오늘 화면 맨 위 접는 카드(시안 B). 처음엔 펼친 채로, 숨기면 설정 › 계정·백업에서 다시 엽니다.
    휴대폰(900px 미만)에서 접으면 머리 줄을 오늘 화면 맨 아래(place="end")로 내려, 첫 화면에 시간표가 그대로 보이게 합니다. */
export function StorageNotice({ place = 'top' }) {
    const { data, clock } = useUi();
    const onboard = useOnboard();
    const [guide, setGuide] = useState(false);
    const returning = isReturning(data, clock.ymd);
    const state = noticeFor(onboard, clock.ymd, returning);
    useEffect(() => {
        if (onboard.day) return;
        if (returning) foldForReturning(clock.ymd);
        else if (state === 'open') markNoticeSeen(clock.ymd);
    }, [state, clock.ymd, returning, onboard.day]);
    if (state === 'hidden') return guide ? <GuideSheet onClose={() => setGuide(false)} /> : null;
    const open = state === 'open';
    if (place === 'end' && (open || PHONE_FOLD_PLACE !== 'end')) return null;
    const phoneHide = place === 'top' && !open && PHONE_FOLD_PLACE === 'end';
    const ids = place === 'end' ? { body: 'store-notice-body-end', title: 'store-notice-title-end' } : { body: 'store-notice-body', title: 'store-notice-title' };
    const items = noticeItems({ ready: cloudReady(), signedIn: Boolean(data.auth?.uid), shared: Boolean(data.profile.sharedPc) });
    const done = guideDone(onboard);
    return (
        <section className={`glass store-notice at-${place}${open ? '' : ' is-folded'}${phoneHide ? ' phone-hide' : ''}`} data-store-notice={place === 'top' ? state : undefined} data-store-notice-end={place === 'end' ? state : undefined} aria-labelledby={ids.title}>
            <h2 className="store-notice-h">
                <Btn className="store-notice-head" aria-expanded={open} aria-controls={ids.body} onClick={() => {
                    setNotice(open ? 'folded' : 'open');
                    /* 맨 아래 머리 줄에서 펼치면 맨 위 카드로 올라가 보여 줍니다. */
                    if (place === 'end') requestAnimationFrame(() => document.querySelector('.store-notice.at-top')?.scrollIntoView({ block: 'start' }));
                }}>
                    <span className="store-badge" aria-hidden="true">보호</span>
                    <span id={ids.title} className="store-notice-title">자료 저장·보호 안내</span>
                    <span className="store-chev" aria-hidden="true">{open ? '▴' : '▾'}</span>
                </Btn>
            </h2>
            {open && (
                <div id={ids.body} className="store-notice-body">
                    <ol className="store-items">
                        {items.map((item, index) => (
                            <li key={item.id} className="store-item" data-store-item={item.id}>
                                <span className="store-num" aria-hidden="true">{index + 1}</span>
                                <div className="store-text">
                                    <h3>{item.title}</h3>
                                    <p>{item.text}{item.code && <> <span className="store-code">저장소 이름 {item.code}</span></>}</p>
                                </div>
                            </li>
                        ))}
                    </ol>
                    <div className="store-actions">
                        <Btn className="chip store-guide-btn" data-guide="open" onClick={() => setGuide(true)}>5분 시작 가이드{done ? ` ${done}/${GUIDE_STEPS.length}` : ''}</Btn>
                        <Btn className="chip" data-store-notice-hide="1" onClick={() => setNotice('hidden')}>안내 숨기기</Btn>
                    </div>
                    <p className="muted store-foot">{PHONE_FOLD_PLACE === 'end' ? '휴대폰에서 접으면 오늘 화면 맨 아래로 내려가요. ' : ''}숨겨도 설정 › 계정·백업 맨 아래에서 다시 열 수 있어요.</p>
                </div>
            )}
            {guide && <GuideSheet onClose={() => setGuide(false)} />}
        </section>
    );
}

/** 보이는 쨈 버튼(폰은 하단 가운데, 넓은 화면은 오른쪽 아래)을 그대로 누릅니다. */
function pressJjaem() {
    const list = [...document.querySelectorAll('.tabbar .fab, .desk-fab')];
    const shown = list.find((el) => el.getClientRects().length > 0 && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden');
    shown?.click();
}

/** Escape 로 시트를 닫습니다. */
export function useEscape(onClose) {
    const ref = useRef(onClose);
    ref.current = onClose;
    useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') { event.stopPropagation(); ref.current?.(); } };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, []);
}

/** 앱 안 5분 시작 가이드. 단계마다 실제 화면으로 옮겨 주고, 한 단계는 이 기기에 표시해 둡니다. */
export function GuideSheet({ onClose }) {
    const { go, clock } = useUi();
    const onboard = useOnboard();
    const done = guideDone(onboard);
    useEscape(onClose);
    function run(step) {
        setStep(step.id, true);
        onClose();
        if (step.go === 'settings') go('#/settings/account', { state: { appFrom: 'settings' } });
        if (step.go === 'attend') go(`#/attend/${clock.ymd}`);
        if (step.go === 'neis') go('#/students/neis');
        if (step.go === 'jjaem') setTimeout(pressJjaem, 0);
    }
    /* 카드·사이드 안의 쌓임 순서에 갇히지 않게 body 에 그립니다. */
    return createPortal(
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet guide-sheet" role="dialog" aria-modal="true" aria-labelledby="guide-title" data-guide="sheet" onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                <h2 id="guide-title" className="title-font" style={{ margin: 0 }}>5분 시작 가이드</h2>
                <p className="muted" style={{ marginTop: 4 }}>{GUIDE_STEPS.length}단계 중 {done}단계를 했어요. 표시는 이 기기에만 남아요.</p>
                <ol className="guide-steps">
                    {GUIDE_STEPS.map((step, index) => {
                        const on = Boolean(onboard.steps[step.id]);
                        return (
                            <li key={step.id} className="guide-step" data-guide-step={step.id} data-done={on ? '1' : '0'}>
                                <span className={on ? 'store-num is-done' : 'store-num'} aria-hidden="true">{on ? '✓' : index + 1}</span>
                                <div className="store-text">
                                    <h3>{step.title}</h3>
                                    <p>{step.text}</p>
                                    <div className="guide-actions">
                                        <Btn className="chip guide-go" data-guide-go={step.id} onClick={() => run(step)}>{step.label}</Btn>
                                        <Btn className={on ? 'chip on' : 'chip'} aria-pressed={on} data-guide-done={step.id} onClick={() => setStep(step.id, !on)}>{on ? '했어요' : '했어요 표시'}</Btn>
                                    </div>
                                </div>
                            </li>
                        );
                    })}
                </ol>
                <Btn className="chip block" onClick={onClose}>닫기</Btn>
            </div>
        </div>,
        document.body,
    );
}
