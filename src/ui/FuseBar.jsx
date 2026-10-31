import { memo, useCallback, useEffect, useId, useRef, useState } from 'react';
import { joined } from '../lib/db.js';
import { restInfo } from '../lib/daymark.js';
import { hourMinute, wantsFast, workTimer } from '../lib/period.js';
import { withUsedCount } from '../lib/periodLocal.js';
import { useUi } from './context.jsx';
import { usePeriodLocal } from './usePeriodLocal.js';
import { LeaveForm, useLeave, useWorkClock } from './WorkTimer.jsx';
import { timerWanted, todayPeriod, workLocal } from './workDay.js';
import { Btn } from './bits.jsx';
import './fuse.css';

/* 폰(640px 이하)에서만 맨 위에 얇은 '실 심지' 줄을 둡니다. 넓은 화면은 지금 타이머 카드 그대로입니다.
   남은 시간 계산·조퇴·보이는 조건은 홈 타이머와 같은 함수(workTimer, useLeave, timerWanted)를 씁니다. 모양만 다릅니다. */
export const FUSE_QUERY = '(max-width: 640px)';

function useMedia(query) {
    const read = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
    const [match, setMatch] = useState(read);
    useEffect(() => {
        if (typeof window.matchMedia !== 'function') return undefined;
        const list = window.matchMedia(query);
        const onChange = () => setMatch(list.matches);
        onChange();
        list.addEventListener?.('change', onChange);
        return () => list.removeEventListener?.('change', onChange);
    }, [query]);
    return match;
}

/** 탭이 가려지면 불꽃 움직임을 멈춥니다. 시계(useWorkClock)도 따로 멈춥니다. */
function usePageHidden() {
    const [hidden, setHidden] = useState(() => typeof document !== 'undefined' && document.hidden);
    useEffect(() => {
        const onVisible = () => setHidden(document.hidden);
        document.addEventListener('visibilitychange', onVisible);
        return () => document.removeEventListener('visibilitychange', onVisible);
    }, []);
    return hidden;
}

/** 요소 너비를 정수로 잽니다. 붙을 때와 너비가 바뀔 때만 다시 그립니다(1초마다 재지 않습니다). */
function useWidth() {
    const [width, setWidth] = useState(0);
    const observer = useRef(null);
    const ref = useCallback((el) => {
        observer.current?.disconnect();
        observer.current = null;
        if (!el) return;
        const measure = () => setWidth(el.clientWidth);
        measure();
        if (typeof ResizeObserver === 'function') {
            observer.current = new ResizeObserver(measure);
            observer.current.observe(el);
        }
    }, []);
    return [ref, width];
}

/* 불꽃 튀는 방향(도), 거리(px), 한 번 튀는 시간(초), 늦게 시작(초). 위쪽으로 많이, 옆으로 조금 튑니다. */
const SPARKS = [
    [-150, 9, 0.55, 0], [-118, 15, 0.7, 0.12], [-92, 17, 0.6, 0.3], [-64, 15, 0.5, 0.05],
    [-36, 10, 0.65, 0.4], [-168, 7, 0.45, 0.22], [-12, 8, 0.5, 0.18], [-132, 11, 0.8, 0.5],
    [-104, 18, 0.75, 0.36], [-78, 14, 0.55, 0.62], [-50, 12, 0.6, 0.27], [-140, 10, 0.5, 0.44],
];

/** 꼬인 실 심지 한 가닥. 타고 남은 자리는 재 점선으로 남고, 남은 실은 느리게 출렁이며 불씨 쪽으로 흘러듭니다. */
const Cord = memo(function Cord({ width, height, frac, big = false }) {
    const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
    if (!width) return <span className="fuse-cord" />;
    const period = big ? 44 : 30;
    const amp = big ? 3.4 : 1.6;
    const thick = big ? 6 : 3.2;
    const mid = height / 2;
    const y = (x) => mid + Math.sin((x / period) * Math.PI * 2) * amp;
    const path = (length) => {
        let d = '';
        for (let x = 0; x <= length; x += 2) d += `${x ? 'L' : 'M'}${x} ${y(x).toFixed(2)}`;
        return d;
    };
    const tipX = Math.round(width * (1 - frac) * 10) / 10;
    const live = frac > 0;
    const full = width + period;
    return (
        <span className="fuse-cord" style={{ width, height, '--p': `${period}px` }}>
            {tipX > 0 && (
                <svg className="fuse-ash" width={tipX} height={height} aria-hidden="true" focusable="false">
                    <path d={path(tipX)} fill="none" style={{ stroke: 'var(--fuse-ash)' }} strokeWidth={big ? 2.4 : 1.7} strokeLinecap="round" strokeDasharray={big ? '0.1 6' : '0.1 4'} />
                </svg>
            )}
            {live && (
                <span className="fuse-live" style={{ left: tipX, width: width - tipX }}>
                    <span className="fuse-wave" style={{ left: -tipX, width: full }}>
                        <svg width={full} height={height} aria-hidden="true" focusable="false">
                            <defs>
                                <pattern id={`${uid}t`} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-38)">
                                    <rect width="5" height="5" style={{ fill: 'var(--fuse-cord)' }} />
                                    <rect width="2" height="5" style={{ fill: 'var(--fuse-cord-hi)' }} />
                                </pattern>
                            </defs>
                            <path d={path(full)} fill="none" stroke="rgba(0,0,0,.16)" strokeWidth={thick + 1.2} strokeLinecap="round" transform="translate(0 1)" />
                            <path d={path(full)} fill="none" stroke={`url(#${uid}t)`} strokeWidth={thick} strokeLinecap="round" />
                        </svg>
                    </span>
                </span>
            )}
            {live && (
                <span className="fuse-tip" style={{ transform: `translate(${tipX}px, ${mid}px)` }}>
                    <span className="fuse-char" />
                    <span className="fuse-ember" />
                    {SPARKS.map(([angle, distance, time, wait], index) => (
                        <i key={index} className="fuse-spark" style={{ '--a': `${angle}deg`, '--d': `${distance}px`, '--t': `${time}s`, '--w': `${wait}s` }} />
                    ))}
                </span>
            )}
        </span>
    );
});

/** 다 탔을 때 폭탄 캡슐 옆에 '펑' 하고 터지는 작은 빛살. */
function Pop() {
    return (
        <svg className="fuse-pop" width="28" height="34" viewBox="0 0 28 34" aria-hidden="true" focusable="false">
            <g strokeLinecap="round" strokeWidth="2" fill="none">
                <path d="M20 9 L16 3" style={{ stroke: 'var(--fuse-gold)' }} />
                <path d="M14 13 L6 10" style={{ stroke: 'var(--seal-fill)' }} />
                <path d="M13 19 L5 20" style={{ stroke: 'var(--fuse-gold)' }} />
                <path d="M14 25 L7 30" style={{ stroke: 'var(--seal-fill)' }} />
                <path d="M20 26 L17 32" style={{ stroke: 'var(--ink-sub)' }} />
            </g>
            <circle cx="9" cy="5" r="1.4" style={{ fill: 'var(--seal-fill)' }} />
            <circle cx="4" cy="26" r="1.2" style={{ fill: 'var(--fuse-gold)' }} />
        </svg>
    );
}

/** 지금 교시 안내(periodStatus)를 자세히 보기 칸에 맞게 짧게 줄입니다. */
function phaseShort(period, label) {
    if (!period) return '';
    if (period.phase === 'during') return `${period.index + 1}교시 수업 중`;
    if (period.phase === 'before') return period.index === 0 ? '1교시 전' : '쉬는 시간';
    if (period.phase === 'lunch') return '점심시간';
    if (period.phase === 'afterschool') return '방과후';
    if (period.phase === 'off') return `${label} 뒤`;
    if (period.phase === 'early') return '출근 전';
    if (period.phase === 'nolesson') return '수업 없음';
    return '수업 끝';
}

/** 읽어 주는 이름. 10분 안쪽에서도 1초마다 바뀌지 않게 분 단위로만 말합니다. */
function spokenLabel(timer) {
    if (timer.done) return `${timer.label} 시간이 지났어요. 오늘도 수고 많으셨어요. 자세히 보기`;
    const left = timer.seconds ? `약 ${Math.max(1, Math.ceil(timer.remain / 60))}분` : timer.left;
    return `${timer.label}까지 ${left} 남았어요. ${timer.label} ${timer.target}. 자세히 보기`;
}

export function FuseBar() {
    const narrow = useMedia(FUSE_QUERY);
    return narrow ? <FuseLive /> : null;
}

function FuseLive() {
    const { data, showToast } = useUi();
    const [fast, setFast] = useState(false);
    const clock = useWorkClock(fast);
    const local = workLocal(data, withUsedCount(data.timetable, usePeriodLocal()));
    const leave = useLeave(clock.ymd);
    const todayRest = restInfo(clock.ymd, joined(data, 'events'));
    const timer = workTimer(clock.sec, { workStart: local.workStart, workEnd: local.workEnd, leave });
    const on = timerWanted(todayRest, local, leave) && timer.show;
    const wantFast = on && wantsFast(timer);
    useEffect(() => { if (wantFast !== fast) setFast(wantFast); }, [wantFast, fast]);
    const hidden = usePageHidden();
    const [open, setOpen] = useState(false);
    const [form, setForm] = useState(false);
    const [draft, setDraft] = useState(leave || '');
    const wrap = useRef(null);
    const panel = useRef(null);
    const [track, trackWidth] = useWidth();
    const [visual, visualWidth] = useWidth();
    const panelId = `fuse-panel-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;

    const close = useCallback((restore) => {
        setOpen(false);
        setForm(false);
        if (restore) wrap.current?.querySelector('.fuse-bar')?.focus({ preventScroll: true });
    }, []);
    useEffect(() => {
        if (!open) return undefined;
        panel.current?.focus({ preventScroll: true });
        const onHash = () => close(false);
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, [open, close]);
    useEffect(() => { if (!on && open) close(false); }, [on, open, close]);

    if (!on) return null;
    const frac = timer.done ? 0 : (timer.progress == null ? 1 : 1 - timer.progress);
    const percent = Math.round((1 - frac) * 100);
    const startMin = /^\d{2}:\d{2}$/.test(local.workStart || '') ? Number(local.workStart.slice(0, 2)) * 60 + Number(local.workStart.slice(3)) : null;
    const since = startMin == null ? '' : hourMinute(Math.max(0, Math.floor(clock.sec / 60) - startMin));
    const period = open ? todayPeriod(data, clock.ymd, clock.hm, local, leave).period : null;
    const state = timer.done ? 'done' : (timer.seconds ? 'soon' : 'run');

    return (
        <div
            ref={wrap}
            className={`fuse${open ? ' is-open' : ''}`}
            data-state={state}
            data-paused={hidden ? '1' : undefined}
            onKeyDown={(event) => {
                if (event.key !== 'Escape' || !open || event.nativeEvent.isComposing) return;
                event.preventDefault();
                close(true);
            }}
            onBlur={(event) => {
                if (open && event.relatedTarget && !wrap.current?.contains(event.relatedTarget)) close(false);
            }}
        >
            <Btn
                className="fuse-bar"
                data-fuse={timer.label}
                data-frac={frac.toFixed(4)}
                aria-expanded={open}
                aria-controls={panelId}
                aria-label={spokenLabel(timer)}
                onClick={() => (open ? close(false) : setOpen(true))}
            >
                <span className="fuse-face" aria-hidden="true">
                    <span className="fuse-text">
                        {timer.done ? (
                            <>
                                <strong className="fuse-v">{timer.text}</strong>
                                <span className="fuse-k">수고했어요</span>
                            </>
                        ) : (
                            <>
                                <span className="fuse-k">{timer.label}까지</span>
                                <strong className="fuse-v num">{timer.left}</strong>
                            </>
                        )}
                    </span>
                    <span className="fuse-track" ref={track}>
                        <Cord width={trackWidth} height={34} frac={frac} />
                    </span>
                    <span className="fuse-bomb num"><Pop />{timer.target}</span>
                    <span className="fuse-chev">▾</span>
                </span>
            </Btn>
            {open && <div className="fuse-scrim" aria-hidden="true" onClick={() => close(false)} />}
            {open && (
                <section id={panelId} ref={panel} tabIndex={-1} className="fuse-panel" aria-label={`${timer.label} 타이머 자세히 보기`}>
                    <div className="fuse-p-head">
                        <span className="fuse-p-kick">{timer.label === '조퇴' ? <>오늘은 <b className="num">{timer.target}</b>에 조퇴해요</> : <>오늘 퇴근 <b className="num">{timer.target}</b></>}</span>
                        <span className="fuse-p-now num">지금 {clock.hm}</span>
                    </div>
                    {timer.done ? (
                        <>
                            <p className="fuse-p-big font-display" role="timer" aria-live="off">{timer.text}</p>
                            <p className="fuse-p-sub">오늘도 수고 많으셨어요. 내일 또 만나요.</p>
                        </>
                    ) : (
                        <p className="fuse-p-big font-display" role="timer" aria-live="off"><span className="num">{timer.left}</span> <small>남았어요</small></p>
                    )}
                    <div className="fuse-p-visual" role="progressbar" aria-label={`출근부터 ${timer.label}까지`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                        <span className="fuse-p-track" ref={visual}>
                            <Cord width={visualWidth} height={56} frac={frac} big />
                        </span>
                        <span className="fuse-bomb is-big num" aria-hidden="true">{timer.target}</span>
                    </div>
                    <div className="fuse-p-ends"><span className="num">출근 {local.workStart}</span><span className="num">{timer.label} {timer.target}</span></div>
                    <dl className="fuse-p-stats">
                        <div><dt>진행률</dt><dd className="num">{percent}%</dd></div>
                        <div><dt>출근부터</dt><dd className="num">{since}</dd></div>
                        <div><dt>지금은</dt><dd>{phaseShort(period, timer.label)}</dd></div>
                    </dl>
                    <div className="fuse-p-actions">
                        <Btn className="primary-btn" aria-expanded={form} onClick={() => { setDraft(leave || ''); setForm((value) => !value); }}>{leave ? '조퇴 바꾸기' : '오늘 조퇴'}</Btn>
                        <Btn className="chip" onClick={() => close(true)}>접기</Btn>
                    </div>
                    {form && <LeaveForm inputId="fuse-leave-at" ymd={clock.ymd} local={local} leave={leave} now={clock} showToast={showToast} draft={draft} setDraft={setDraft} onDone={() => setForm(false)} />}
                    <p className="fuse-p-note">맨 위 줄은 어느 화면에서나 남아 있어요. 다시 누르면 접혀요.</p>
                </section>
            )}
        </div>
    );
}
