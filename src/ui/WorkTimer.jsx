import { useEffect, useState } from 'react';
import { clockFrozen, seoulParts } from '../lib/date.js';
import { isHm, workTimer } from '../lib/period.js';
import { leaveFor, setLeave, subscribePeriodLocal } from '../lib/periodLocal.js';
import { Btn } from './bits.jsx';

function secondsNow() {
    const parts = seoulParts();
    return parts.hour * 3600 + parts.minute * 60 + (clockFrozen() ? 0 : new Date().getSeconds());
}

/** 퇴근(조퇴)까지 남은 시간. 1분마다, 10분 안쪽이면 1초마다 다시 셉니다. 탭이 가려지면 멈춥니다. */
export function useWorkClock(fast) {
    const [sec, setSec] = useState(() => secondsNow());
    useEffect(() => {
        let timer = 0;
        const tick = () => {
            setSec(secondsNow());
            const wait = fast ? 1000 : 60000 - (Date.now() % 60000);
            timer = setTimeout(tick, wait);
        };
        const start = () => {
            clearTimeout(timer);
            if (typeof document !== 'undefined' && document.hidden) return;
            tick();
        };
        const onVisible = () => {
            if (document.hidden) clearTimeout(timer);
            else start();
        };
        start();
        document.addEventListener('visibilitychange', onVisible);
        return () => {
            clearTimeout(timer);
            document.removeEventListener('visibilitychange', onVisible);
        };
    }, [fast]);
    return sec;
}

export function useLeave(ymd) {
    const [leave, setLeaveState] = useState(() => leaveFor(ymd));
    useEffect(() => {
        setLeaveState(leaveFor(ymd));
        return subscribePeriodLocal(() => setLeaveState(leaveFor(ymd)));
    }, [ymd]);
    return leave;
}

export function WorkTimer({ ymd, local, leave, showToast }) {
    const [fast, setFast] = useState(false);
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(leave || '');
    const sec = useWorkClock(fast);
    const timer = workTimer(sec, { workStart: local.workStart, workEnd: local.workEnd, leave });
    const wantFast = Boolean(timer.show && !timer.done && timer.remain <= 660);
    useEffect(() => { if (wantFast !== fast) setFast(wantFast); }, [wantFast, fast]);
    if (!timer.show) return null;
    const percent = timer.progress == null ? null : Math.round(timer.progress * 100);
    return (
        <section className={`glass home-leave${timer.done ? ' is-done' : ''}`} aria-label={`${timer.label} 타이머`} data-leave={timer.label}>
            <div className="leave-head">
                <span className="leave-kicker">{timer.label === '조퇴' ? `오늘은 ${timer.target}에 조퇴해요` : `퇴근 ${timer.target}`}</span>
                <Btn className="chip" aria-expanded={open} onClick={() => { setDraft(leave || ''); setOpen((value) => !value); }}>{leave ? '조퇴 바꾸기' : '오늘 조퇴'}</Btn>
            </div>
            <div className="leave-key" role="timer" aria-live="off">
                {timer.done ? (
                    <strong className="font-display leave-big">{timer.text}</strong>
                ) : (
                    <>
                        <span className="leave-small">{timer.label}까지</span>
                        <strong className="font-display leave-big num">{timer.left}</strong>
                    </>
                )}
            </div>
            {percent != null && (
                <div className="leave-bar" role="progressbar" aria-label={`출근부터 ${timer.label}까지`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                    <span style={{ width: `${percent}%` }} />
                </div>
            )}
            {percent != null && (
                <div className="leave-ends muted"><span>출근 {local.workStart}</span><span>{timer.label} {timer.target}</span></div>
            )}
            {open && (
                <form className="leave-form" onSubmit={(event) => {
                    event.preventDefault();
                    if (!isHm(draft)) { showToast?.('조퇴 시각은 14:30처럼 골라 주세요.'); return; }
                    setLeave(ymd, draft);
                    setOpen(false);
                    showToast?.(`오늘은 ${draft}까지 셀게요. 내일은 원래 퇴근 시각으로 돌아가요.`);
                }}>
                    <label className="muted" htmlFor="leave-at">오늘 몇 시에 나가세요? 이 기기에만, 오늘 하루만 적어 둬요.</label>
                    <div className="leave-row">
                        <input id="leave-at" className="field" type="time" aria-label="조퇴 시각" value={draft} onChange={(event) => setDraft(event.target.value)} />
                        <Btn className="primary-btn" onClick={(event) => event.currentTarget.form?.requestSubmit()}>조퇴 정하기</Btn>
                    </div>
                    {leave && (
                        <Btn className="chip" style={{ marginTop: 8 }} onClick={() => {
                            setLeave(ymd, '');
                            setOpen(false);
                            showToast?.('조퇴를 취소했어요. 원래 퇴근 시각까지 셀게요.');
                        }}>조퇴 취소</Btn>
                    )}
                </form>
            )}
        </section>
    );
}
