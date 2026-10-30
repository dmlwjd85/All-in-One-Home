import { useEffect, useState } from 'react';
import { clockFrozen, seoulParts } from '../lib/date.js';
import { leaveProblem, workTimeProblem, workTimer } from '../lib/period.js';
import { hideWorkCard, leaveFor, patchPeriodLocal, setLeave, subscribePeriodLocal } from '../lib/periodLocal.js';
import { Btn } from './bits.jsx';

/** 서울 시각과 자정부터 지난 초. 홈 문구와 타이머가 같은 값을 씁니다. */
export function clockNow() {
    const date = new Date();
    const parts = seoulParts(date);
    return { ...parts, sec: parts.hour * 3600 + parts.minute * 60 + (clockFrozen() ? 0 : date.getSeconds()) };
}

/** 홈 시계. 1분마다, 10분 안쪽이면 1초마다 정각(초·분 경계)에 맞춰 다시 셉니다. 탭이 가려지면 멈춥니다. */
export function useWorkClock(fast) {
    const [now, setNow] = useState(() => clockNow());
    useEffect(() => {
        let timer = 0;
        const tick = () => {
            setNow(clockNow());
            const wait = fast ? 1000 - (Date.now() % 1000) : 60000 - (Date.now() % 60000);
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
    return now;
}

export function useLeave(ymd) {
    const [leave, setLeaveState] = useState(() => leaveFor(ymd));
    useEffect(() => {
        setLeaveState(leaveFor(ymd));
        return subscribePeriodLocal(() => setLeaveState(leaveFor(ymd)));
    }, [ymd]);
    return leave;
}

/* 초 단위 전환 판정은 검사할 수 있게 period.js에 둡니다. */
export { wantsFast } from '../lib/period.js';

export function WorkTimer({ ymd, local, leave, showToast, now }) {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(leave || '');
    const timer = workTimer(now.sec, { workStart: local.workStart, workEnd: local.workEnd, leave });
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
                    const problem = leaveProblem(draft, now.hm, { workStart: local.workStart, workEnd: local.workEnd });
                    if (problem) { showToast?.(problem); return; }
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

/** 출퇴근 시각이 없을 때 타이머 자리에 보이는 작은 안내 카드. 저장을 눌러야만 이 기기 설정에 씁니다. */
export function WorkSetup({ local, showToast, now }) {
    const [workStart, setWorkStart] = useState(local.workStart || '08:40');
    const [workEnd, setWorkEnd] = useState(local.workEnd || '16:40');
    /* 폰 첫 화면에서는 한 줄 띠로 접어 두고, 누르면 펼칩니다(펼침은 기억하지 않습니다). 넓은 화면은 늘 펼친 그대로입니다. */
    const [open, setOpen] = useState(false);
    return (
        <section className="glass home-leave work-setup" data-open={open ? '1' : '0'} aria-label="퇴근 타이머 설정">
            <div className="leave-head">
                <Btn className="work-setup-strip" aria-expanded={open} aria-controls="work-setup-body" onClick={() => setOpen(!open)}>
                    <span className="leave-kicker">퇴근 타이머</span>
                    <span className="work-setup-sum">{open ? '' : '시각 정하기'}</span>
                    <span className="fold-arrow" aria-hidden="true">{open ? '▴' : '▾'}</span>
                </Btn>
                <span className="leave-kicker work-setup-title">퇴근 타이머</span>
                <Btn className="chip" onClick={() => {
                    hideWorkCard();
                    showToast?.('설정의 시간표와 출퇴근에서 언제든 정할 수 있어요.');
                }}>다음에</Btn>
            </div>
            <div className="work-setup-body" id="work-setup-body">
                <p className="work-setup-text">출근·퇴근 시각을 정하면 퇴근까지 남은 시간을 보여 드려요.</p>
                <form className="work-setup-form" onSubmit={(event) => {
                    event.preventDefault();
                    const problem = workTimeProblem(workStart, workEnd);
                    if (problem) { showToast?.(problem); return; }
                    patchPeriodLocal({ workStart, workEnd });
                    /* 출근 전이면 타이머가 아직 숨어 있으니, 언제부터 보이는지 알려 줍니다. */
                    showToast?.(now && now.hm < workStart ? `출근 ${workStart}부터 퇴근까지 남은 시간을 보여 드릴게요.` : `퇴근 ${workEnd}까지 남은 시간을 홈에 보여 드릴게요.`);
                }}>
                    <label>
                        <span className="muted">출근</span>
                        <input className="field" type="time" step="60" aria-label="출근 시각" value={workStart} onChange={(event) => setWorkStart(event.target.value)} />
                    </label>
                    <label>
                        <span className="muted">퇴근</span>
                        <input className="field" type="time" step="60" aria-label="퇴근 시각" value={workEnd} onChange={(event) => setWorkEnd(event.target.value)} />
                    </label>
                    <Btn className="primary-btn" onClick={(event) => event.currentTarget.form?.requestSubmit()}>저장</Btn>
                </form>
            </div>
        </section>
    );
}
