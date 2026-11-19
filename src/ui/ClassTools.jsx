import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Btn } from './bits.jsx';
import { useUi } from './context.jsx';
import {
    BOARD_BACKS, BOARD_COLORS, BOARD_INKS, BOARD_SIZES, TIMER_PRESETS, TIMER_STYLES, TOOL_IDS, TOOL_INFO, VOTE_MAX, VOTE_MIN, WHEEL_MAX, WHEEL_MIN, WHEEL_SAMPLE,
    addVote, checkVote, clampTimer, cleanWheel, drawLots, formatClock, loadTools, newVote, rosterLabels, saveTools, spinWheel, voteResult,
} from '../lib/classTools.js';
import './classTools.css';

/* ───── 소리: 작은 Web Audio. 기기 소리가 꺼져 있으면 들리지 않습니다. ───── */
let audio = null;
function tone(freqs, { type = 'triangle', gap = 0.1, len = 0.22, vol = 0.2 } = {}) {
    try {
        audio = audio || new (window.AudioContext || window.webkitAudioContext)();
        if (audio.state === 'suspended') audio.resume();
        const now = audio.currentTime;
        freqs.forEach((freq, i) => {
            const osc = audio.createOscillator();
            const gain = audio.createGain();
            const t = now + i * gap;
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t);
            gain.gain.setValueAtTime(0.0001, t);
            gain.gain.exponentialRampToValueAtTime(vol, t + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + len);
            osc.connect(gain);
            gain.connect(audio.destination);
            osc.start(t);
            osc.stop(t + len + 0.02);
        });
    } catch {
        /* 소리를 못 내도 도구는 그대로 씁니다. */
    }
}
const sfx = {
    tick: () => tone([340 + Math.random() * 120], { type: 'sine', len: 0.05, vol: 0.06 }),
    reveal: () => tone([523, 659, 784, 1047], { gap: 0.09 }),
    alarm: () => tone([880, 880, 660], { type: 'square', gap: 0.2, len: 0.14, vol: 0.18 }),
    start: () => tone([660, 990], { gap: 0.08, len: 0.12, vol: 0.12 }),
};

/* ───── 팝업 틀: 기본은 가운데 팝업, 「전체화면」을 누르면 화면을 꽉 채웁니다(되면 브라우저 전체화면까지). ───── */
function ToolShell({ id, onClose, children, wide = false }) {
    const info = TOOL_INFO[id];
    const ref = useRef(null);
    const [full, setFull] = useState(false);
    const exitNative = useCallback(() => {
        try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch { /* 없어도 됩니다 */ }
    }, []);
    const toggleFull = () => {
        if (full) { exitNative(); setFull(false); return; }
        setFull(true);
        try { ref.current?.requestFullscreen?.().catch?.(() => {}); } catch { /* 아이폰 사파리는 화면을 꽉 채우는 것으로 대신합니다 */ }
    };
    const close = useCallback(() => { exitNative(); onClose(); }, [exitNative, onClose]);
    useEffect(() => {
        const onChange = () => { if (!document.fullscreenElement) setFull(false); };
        const onKey = (event) => {
            if (event.key !== 'Escape') return;
            if (document.fullscreenElement) return; /* 브라우저가 먼저 전체화면을 풉니다 */
            event.preventDefault();
            close();
        };
        document.addEventListener('fullscreenchange', onChange);
        document.addEventListener('keydown', onKey);
        return () => { document.removeEventListener('fullscreenchange', onChange); document.removeEventListener('keydown', onKey); };
    }, [close]);
    return (
        <div className="sheet-back ct-back" onClick={close}>
            <div ref={ref} className={`ct-pop${full ? ' is-full' : ''}${wide ? ' is-wide' : ''}`} role="dialog" aria-modal="true" aria-label={info.label} data-tool={id} onClick={(event) => event.stopPropagation()}>
                <div className="ct-head">
                    <h2 className="title-font ct-title"><span aria-hidden="true">{info.icon}</span> {info.label}</h2>
                    <Btn className="chip ct-full" data-role="tool-full" aria-pressed={full} onClick={toggleFull}>{full ? '작게' : '⛶ 전체화면'}</Btn>
                    <Btn className="icon-btn ct-x" aria-label={`${info.label} 닫기`} onClick={close}>✕</Btn>
                </div>
                <div className="ct-body">{children}</div>
            </div>
        </div>
    );
}

/* ───── 타이머 ───── */
function TimerTool() {
    const saved = loadTools().timer || {};
    const [total, setTotal] = useState(clampTimer(saved.total ?? 300) || 300);
    const [left, setLeft] = useState(total);
    const [endAt, setEndAt] = useState(0);
    const [style, setStyle] = useState(TIMER_STYLES.some(([k]) => k === saved.style) ? saved.style : 'digital');
    const [done, setDone] = useState(false);
    const running = endAt > 0;
    useEffect(() => { saveTools({ timer: { total, style } }); }, [total, style]);
    useEffect(() => {
        if (!running) return undefined;
        const id = setInterval(() => {
            const sec = Math.max(0, (endAt - Date.now()) / 1000);
            setLeft(sec);
            if (sec <= 0) { setEndAt(0); setDone(true); }
        }, 200);
        return () => clearInterval(id);
    }, [running, endAt]);
    useEffect(() => {
        if (!done) return undefined;
        sfx.alarm();
        let n = 0;
        const id = setInterval(() => { n += 1; if (n >= 5) clearInterval(id); else sfx.alarm(); }, 1000);
        return () => clearInterval(id);
    }, [done]);
    const set = (sec) => { const v = clampTimer(sec); setTotal(v); setLeft(v); setEndAt(0); setDone(false); };
    const start = () => { if (left <= 0) return; setDone(false); setEndAt(Date.now() + left * 1000); sfx.start(); };
    const pause = () => { setLeft(Math.max(0, (endAt - Date.now()) / 1000)); setEndAt(0); };
    const reset = () => { setLeft(total); setEndAt(0); setDone(false); };
    const frac = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
    const urgent = running && left <= 10;
    const text = formatClock(left);
    const min = Math.floor(total / 60);
    const sec = total % 60;
    return (
        <div className={`ct-timer${urgent ? ' is-urgent' : ''}${done ? ' is-done' : ''}`} data-style={style}>
            <div className="ct-stage" aria-live="polite">
                {style === 'digital' && <div className="ct-digits num" data-role="timer-digits">{text}</div>}
                {style === 'dial' && (
                    <div className="ct-dial">
                        <svg viewBox="0 0 200 200" aria-hidden="true">
                            <circle cx="100" cy="100" r="92" className="ct-dial-face" />
                            <path className="ct-dial-wedge" d={wedge(frac)} />
                            {Array.from({ length: 60 }, (_, i) => {
                                const a = (i * 6 * Math.PI) / 180;
                                const r1 = i % 5 === 0 ? 80 : 86;
                                return <line key={i} x1={100 + r1 * Math.sin(a)} y1={100 - r1 * Math.cos(a)} x2={100 + 91 * Math.sin(a)} y2={100 - 91 * Math.cos(a)} className={i % 5 === 0 ? 'ct-tick is-major' : 'ct-tick'} />;
                            })}
                            <circle cx="100" cy="100" r="7" className="ct-dial-hub" />
                        </svg>
                        <div className="ct-dial-digits num" data-role="timer-digits">{text}</div>
                    </div>
                )}
                {style === 'sand' && (
                    <div className="ct-sand">
                        <div className="ct-glass">
                            <div className="ct-bulb is-top"><div className="ct-grain" style={{ height: `${frac * 100}%` }} /></div>
                            <div className={`ct-stream${running ? ' is-on' : ''}`} />
                            <div className="ct-bulb is-bottom"><div className="ct-grain" style={{ height: `${(1 - frac) * 100}%` }} /></div>
                        </div>
                        <div className="ct-sand-digits num" data-role="timer-digits">{text}</div>
                    </div>
                )}
                {done && <p className="ct-done-msg" role="alert">시간 끝!</p>}
            </div>
            <div className="ct-row ct-styles" role="group" aria-label="타이머 모양">
                {TIMER_STYLES.map(([key, label]) => <Btn key={key} className={style === key ? 'chip on' : 'chip'} aria-pressed={style === key} onClick={() => setStyle(key)}>{label}</Btn>)}
            </div>
            <div className="ct-row" role="group" aria-label="빠른 시간">
                {TIMER_PRESETS.map((m) => <Btn key={m} className={total === m * 60 && !running ? 'chip on' : 'chip'} onClick={() => set(m * 60)}>{m}분</Btn>)}
                <Btn className="chip" aria-label="1분 더하기" onClick={() => (running ? setEndAt(endAt + 60000) : set(left + 60))}>+1분</Btn>
            </div>
            {!running && (
                <div className="ct-row ct-set">
                    <label className="ct-num"><input className="field num" type="number" inputMode="numeric" min="0" max="180" aria-label="분" value={min} onChange={(e) => set((Number(e.target.value) || 0) * 60 + sec)} /> 분</label>
                    <label className="ct-num"><input className="field num" type="number" inputMode="numeric" min="0" max="59" aria-label="초" value={sec} onChange={(e) => set(min * 60 + Math.min(59, Number(e.target.value) || 0))} /> 초</label>
                </div>
            )}
            <div className="ct-row ct-main">
                {running
                    ? <Btn className="primary-btn" data-role="timer-pause" onClick={pause}>잠깐 멈춤</Btn>
                    : <Btn className="primary-btn" data-role="timer-start" disabled={left <= 0} onClick={start}>{left < total && left > 0 ? '이어서' : '시작'}</Btn>}
                <Btn className="chip" onClick={reset}>처음으로</Btn>
            </div>
        </div>
    );
}

/** 원판 타이머의 남은 시간 부채꼴(맨 위에서 시계 방향). */
function wedge(frac) {
    if (frac <= 0) return '';
    if (frac >= 0.9999) return 'M100 100 m0 -78 a78 78 0 1 1 0 156 a78 78 0 1 1 0 -156z';
    const a = frac * 2 * Math.PI;
    const x = 100 + 78 * Math.sin(a);
    const y = 100 - 78 * Math.cos(a);
    return `M100 100 L100 22 A78 78 0 ${frac > 0.5 ? 1 : 0} 1 ${x.toFixed(2)} ${y.toFixed(2)} Z`;
}

/* ───── 제비뽑기 ───── */
function LotteryTool({ students }) {
    const roster = useMemo(() => rosterLabels(students), [students]);
    const saved = loadTools().lottery || {};
    const [size, setSize] = useState(Math.min(40, Math.max(2, Number(saved.size) || 25)));
    const people = roster.length ? roster : Array.from({ length: size }, (_, i) => ({ id: String(i + 1), label: `${i + 1}번` }));
    const [off, setOff] = useState(() => new Set(Array.isArray(saved.off) ? saved.off : []));
    const [count, setCount] = useState(Math.max(1, Number(saved.count) || 1));
    const [mode, setMode] = useState(saved.mode === 'all' ? 'all' : 'one');
    const [remove, setRemove] = useState(saved.remove !== false);
    const [drawn, setDrawn] = useState([]);
    const [rolling, setRolling] = useState('');
    const [busy, setBusy] = useState(false);
    const [picking, setPicking] = useState(false);
    useEffect(() => { saveTools({ lottery: { size, off: [...off], count, mode, remove } }); }, [size, off, count, mode, remove]);
    const used = new Set(remove ? drawn.map((p) => p.id) : []);
    const pool = people.filter((p) => !off.has(p.id) && !used.has(p.id));
    const run = async () => {
        if (busy || !pool.length) return;
        setBusy(true);
        const picks = drawLots(pool, Math.min(count, remove ? pool.length : count), { remove });
        const roll = (ms) => new Promise((done) => {
            const until = Date.now() + ms;
            const step = () => {
                setRolling(pool[Math.floor(Math.random() * pool.length)].label);
                sfx.tick();
                if (Date.now() < until) setTimeout(step, 70 + (1 - (until - Date.now()) / ms) * 140);
                else done();
            };
            step();
        });
        if (mode === 'one') {
            for (const pick of picks) {
                await roll(1100);
                setRolling(pick.label);
                setDrawn((list) => [...list, pick]);
                sfx.reveal();
                await new Promise((r) => setTimeout(r, 900));
            }
        } else {
            await roll(1400);
            setRolling(picks.map((p) => p.label).join(' · '));
            setDrawn((list) => [...list, ...picks]);
            sfx.reveal();
        }
        setBusy(false);
    };
    if (picking) {
        return (
            <div className="ct-lottery">
                <p className="muted ct-note">{roster.length ? '빼고 싶은 친구를 눌러 끄세요.' : '명단이 없어 번호로 뽑아요. 몇 번까지 있는지 정해 주세요.'}</p>
                {!roster.length && (
                    <label className="ct-num"><input className="field num" type="number" min="2" max="40" aria-label="몇 번까지" value={size} onChange={(e) => setSize(Math.min(40, Math.max(2, Number(e.target.value) || 2)))} /> 번까지</label>
                )}
                <div className="ct-row">
                    <Btn className="chip" onClick={() => setOff(new Set())}>모두 넣기</Btn>
                    <Btn className="chip" onClick={() => setOff(new Set(people.map((p) => p.id)))}>모두 빼기</Btn>
                </div>
                <div className="ct-people" role="group" aria-label="참여할 사람">
                    {people.map((p) => <Btn key={p.id} className={off.has(p.id) ? 'chip ct-person is-off' : 'chip on ct-person'} aria-pressed={!off.has(p.id)} onClick={() => setOff((set) => { const next = new Set(set); if (next.has(p.id)) next.delete(p.id); else next.add(p.id); return next; })}>{p.label}</Btn>)}
                </div>
                <Btn className="primary-btn" onClick={() => setPicking(false)}>다 골랐어요</Btn>
            </div>
        );
    }
    return (
        <div className="ct-lottery">
            <div className={`ct-stage ct-lot-stage${busy ? ' is-rolling' : ''}`} aria-live="polite">
                <div className="ct-lot-name" data-role="lottery-name">{rolling || (pool.length ? '누가 뽑힐까요?' : '남은 사람이 없어요')}</div>
            </div>
            {drawn.length > 0 && (
                <ol className="ct-drawn" aria-label="뽑힌 순서">
                    {drawn.map((p, i) => <li key={`${p.id}-${i}`}><span className="muted num">{i + 1}</span> {p.label}</li>)}
                </ol>
            )}
            <div className="ct-row">
                <Btn className="chip" onClick={() => setPicking(true)}>참여 {people.length - [...off].filter((id) => people.some((p) => p.id === id)).length}명 ▾</Btn>
                <span className="ct-stepper" role="group" aria-label="뽑을 인원">
                    <Btn className="chip" aria-label="한 명 덜" onClick={() => setCount(Math.max(1, count - 1))}>−</Btn>
                    <span className="num">{count}명</span>
                    <Btn className="chip" aria-label="한 명 더" onClick={() => setCount(Math.min(40, count + 1))}>＋</Btn>
                </span>
            </div>
            <div className="ct-row" role="group" aria-label="뽑는 방법">
                <Btn className={mode === 'one' ? 'chip on' : 'chip'} aria-pressed={mode === 'one'} onClick={() => setMode('one')}>한 명씩</Btn>
                <Btn className={mode === 'all' ? 'chip on' : 'chip'} aria-pressed={mode === 'all'} onClick={() => setMode('all')}>한꺼번에</Btn>
                <Btn className={remove ? 'chip on' : 'chip'} aria-pressed={remove} onClick={() => setRemove(!remove)}>{remove ? '뽑힌 사람 빼기' : '다시 넣기(겹침)'}</Btn>
            </div>
            <div className="ct-row ct-main">
                <Btn className="primary-btn" data-role="lottery-draw" disabled={busy || !pool.length} onClick={run}>{busy ? '뽑는 중…' : '뽑기'}</Btn>
                <Btn className="chip" disabled={busy} onClick={() => { setDrawn([]); setRolling(''); }}>처음부터</Btn>
            </div>
        </div>
    );
}

/* ───── 돌림판 ───── */
const WHEEL_COLORS = ['#F7B5C4', '#FCE3A7', '#BFE3D3', '#C9D8F5', '#F9C9A8', '#DCCBF0', '#F4DDE6', '#D7EBB8'];
function WheelTool({ students }) {
    const saved = loadTools().wheel || {};
    const roster = useMemo(() => rosterLabels(students).map((p) => p.label).slice(0, WHEEL_MAX), [students]);
    /* 칸 고르기: 「우리 반」은 명단 전체(지금 명단을 그대로), 「직접 적기」는 선생님이 적은 것. 둘 다 이 중에서 하나를 무작위로 뽑습니다. */
    const [source, setSource] = useState(saved.source === 'custom' || !roster.length ? 'custom' : 'roster');
    const [custom, setCustom] = useState(() => { const list = cleanWheel(saved.items); return list.length >= WHEEL_MIN ? list : WHEEL_SAMPLE; });
    const [out, setOut] = useState([]);
    const [angle, setAngle] = useState(0);
    const [spinning, setSpinning] = useState(false);
    const [result, setResult] = useState(null);
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState('');
    const [dropWinner, setDropWinner] = useState(Boolean(saved.dropWinner));
    useEffect(() => { saveTools({ wheel: { items: custom, dropWinner, source } }); }, [custom, dropWinner, source]);
    const base = source === 'roster' && roster.length ? roster : custom;
    const items = base.filter((label) => !out.includes(label));
    const n = items.length;
    const seg = 360 / Math.max(1, n);
    const pickSource = (next) => { if (spinning) return; setSource(next); setOut([]); setResult(null); };
    const spin = () => {
        if (spinning) return;
        /* 「뽑힌 칸 빼기」가 켜져 있으면 지난번에 뽑힌 칸을 빼고 바로 다시 돌립니다. */
        let left = n;
        if (result != null && dropWinner) {
            setOut((list) => [...list, items[result]]);
            left = n - 1;
        }
        if (left < WHEEL_MIN) { setResult(null); return; }
        const turn = spinWheel(left, angle);
        setResult(null);
        setSpinning(true);
        setAngle(turn.angle);
        sfx.start();
        setTimeout(() => { setSpinning(false); setResult(turn.index); sfx.reveal(); }, 4300);
    };
    if (editing) {
        return (
            <div className="ct-wheel-edit">
                <p className="muted ct-note">뽑을 것을 한 줄에 하나씩 적어 주세요. {WHEEL_MIN}~{WHEEL_MAX}칸, 칸마다 14자까지. 적은 것 중에서 하나를 무작위로 뽑아요.</p>
                <textarea className="field ct-wheel-text" aria-label="돌림판 칸" value={draft} onChange={(e) => setDraft(e.target.value)} />
                <div className="ct-row">
                    <Btn className="chip" disabled={!roster.length} onClick={() => setDraft(roster.join('\n'))}>명단 가져와 고치기</Btn>
                    <Btn className="chip" onClick={() => setDraft(WHEEL_SAMPLE.join('\n'))}>예시로</Btn>
                </div>
                <div className="ct-row ct-main">
                    <Btn className="primary-btn" disabled={cleanWheel(draft.split('\n')).length < WHEEL_MIN} onClick={() => { setCustom(cleanWheel(draft.split('\n'))); setSource('custom'); setOut([]); setResult(null); setEditing(false); }}>이대로 쓰기</Btn>
                    <Btn className="chip" onClick={() => setEditing(false)}>그만두기</Btn>
                </div>
            </div>
        );
    }
    return (
        <div className="ct-wheel">
            <div className="ct-row ct-wheel-src" role="group" aria-label="돌림판 칸">
                <Btn className={source === 'roster' ? 'chip on' : 'chip'} aria-pressed={source === 'roster'} data-role="wheel-roster" disabled={!roster.length} onClick={() => pickSource('roster')}>👥 우리 반{roster.length ? ` ${roster.length}명` : ''}</Btn>
                <Btn className={source === 'custom' ? 'chip on' : 'chip'} aria-pressed={source === 'custom'} data-role="wheel-custom" onClick={() => pickSource('custom')}>✏️ 직접 적기</Btn>
                {source === 'custom' && <Btn className="chip" disabled={spinning} onClick={() => { setDraft(custom.join('\n')); setEditing(true); }}>칸 고치기</Btn>}
            </div>
            <div className="ct-stage ct-wheel-stage">
                <div className="ct-wheel-pin" aria-hidden="true" />
                <svg className="ct-wheel-disc" viewBox="0 0 200 200" style={{ transform: `rotate(${angle}deg)`, transition: spinning ? 'transform 4.2s cubic-bezier(.12,.62,.08,1)' : 'none' }} role="img" aria-label={`돌림판 ${n}칸`}>
                    {items.map((label, i) => {
                        const a0 = (i * seg * Math.PI) / 180;
                        const a1 = ((i + 1) * seg * Math.PI) / 180;
                        const mid = ((i + 0.5) * seg);
                        const path = n === 1 ? '' : `M100 100 L${100 + 96 * Math.sin(a0)} ${100 - 96 * Math.cos(a0)} A96 96 0 ${seg > 180 ? 1 : 0} 1 ${100 + 96 * Math.sin(a1)} ${100 - 96 * Math.cos(a1)} Z`;
                        const fs = n > 30 ? 4.6 : n > 24 ? 5.2 : n > 16 ? 6.2 : n > 10 ? 7.4 : 9;
                        return (
                            <g key={i}>
                                <path d={path} fill={WHEEL_COLORS[i % WHEEL_COLORS.length]} stroke="#fff" strokeWidth="1" />
                                <text x="191" y="100" transform={`rotate(${mid - 90} 100 100)`} className="ct-wheel-label" style={{ fontSize: fs }} textAnchor="end" dominantBaseline="middle">{label}</text>
                            </g>
                        );
                    })}
                    <circle cx="100" cy="100" r="13" fill="#fff" stroke="#3A2A2C" strokeWidth="1.4" />
                </svg>
            </div>
            <p className="ct-wheel-result" aria-live="polite" data-role="wheel-result">{spinning ? '돌아가는 중…' : result != null ? <>🎉 <strong>{items[result]}</strong></> : n < WHEEL_MIN ? '남은 칸이 하나뿐이에요. 「다시 채우기」를 눌러 주세요.' : `${n}칸 중에서 하나를 뽑아요.`}</p>
            <div className="ct-row ct-main">
                <Btn className="primary-btn" data-role="wheel-spin" disabled={spinning || n < WHEEL_MIN} onClick={spin}>{result != null && dropWinner ? '빼고 다시 돌리기' : '돌리기'}</Btn>
                <Btn className={dropWinner ? 'chip on' : 'chip'} aria-pressed={dropWinner} onClick={() => setDropWinner(!dropWinner)}>뽑힌 칸 빼기</Btn>
                {out.length > 0 && <Btn className="chip" disabled={spinning} onClick={() => { setOut([]); setResult(null); }}>다시 채우기 ({out.length})</Btn>}
            </div>
        </div>
    );
}

/* ───── 학급투표 ───── */
function VoteTool({ students }) {
    const [vote, setVoteRaw] = useState(() => { const v = loadTools().vote; return v && Array.isArray(v.options) && v.options.length >= VOTE_MIN ? v : newVote('', ['', '']); });
    const [cover, setCover] = useState(false);
    const [askEnd, setAskEnd] = useState(false);
    const setVote = (next) => { setVoteRaw(next); saveTools({ vote: next }); };
    const check = checkVote(vote);
    const classSize = students.filter((row) => row.name).length;
    if (vote.phase === 'setup') {
        return (
            <div className="ct-vote">
                <input className="field ct-vote-title" aria-label="투표 주제" placeholder="무엇을 정할까요? (예: 체육 시간 놀이)" maxLength={40} value={vote.title} onChange={(e) => setVote({ ...vote, title: e.target.value })} />
                <div className="ct-vote-opts">
                    {vote.options.map((text, i) => (
                        <div key={i} className="ct-vote-opt">
                            <span className="num muted">{i + 1}</span>
                            <input className="field" aria-label={`선택지 ${i + 1}`} placeholder={`선택지 ${i + 1}`} maxLength={24} value={text} onChange={(e) => { const options = [...vote.options]; options[i] = e.target.value; setVote({ ...vote, options }); }} />
                            {vote.options.length > VOTE_MIN && <Btn className="icon-btn" aria-label={`선택지 ${i + 1} 빼기`} onClick={() => setVote({ ...vote, options: vote.options.filter((_, k) => k !== i) })}>−</Btn>}
                        </div>
                    ))}
                </div>
                <div className="ct-row">
                    {vote.options.length < VOTE_MAX && <Btn className="chip" onClick={() => setVote({ ...vote, options: [...vote.options, ''] })}>＋ 선택지</Btn>}
                    <Btn className={vote.mode === 'hands' ? 'chip on' : 'chip'} aria-pressed={vote.mode === 'hands'} onClick={() => setVote({ ...vote, mode: 'hands' })}>✋ 손들기 세기</Btn>
                    <Btn className={vote.mode === 'secret' ? 'chip on' : 'chip'} aria-pressed={vote.mode === 'secret'} onClick={() => setVote({ ...vote, mode: 'secret' })}>🤫 돌려 가며 비밀 투표</Btn>
                </div>
                <p className="muted ct-note">{vote.mode === 'secret' ? '이 기기를 한 명씩 돌려 가며 누르고, 누르면 화면이 가려져요. 결과는 마감한 뒤에만 보여요.' : '손 든 사람 수를 선생님이 세어 눌러요.'}{check.ok ? '' : ` ${check.reason}`}</p>
                <div className="ct-row ct-main">
                    <Btn className="primary-btn" data-role="vote-start" disabled={!check.ok} onClick={() => setVote({ ...vote, options: check.options, counts: check.options.map(() => 0), ballots: 0, phase: 'vote' })}>투표 시작</Btn>
                </div>
            </div>
        );
    }
    if (vote.phase === 'vote' && vote.mode === 'secret') {
        if (cover) {
            return (
                <div className="ct-vote ct-cover" data-role="vote-cover">
                    <p className="ct-cover-msg">투표했어요 ✔<br /><span className="muted">다음 사람에게 넘겨 주세요</span></p>
                    <Btn className="primary-btn" onClick={() => setCover(false)}>다음 사람</Btn>
                    <p className="muted num">{vote.ballots}명 투표{classSize ? ` / ${classSize}명` : ''}</p>
                </div>
            );
        }
        return (
            <div className="ct-vote">
                <p className="ct-vote-q title-font">{vote.title || '학급 투표'}</p>
                <div className="ct-ballot" role="group" aria-label="고르기">
                    {vote.options.map((label, i) => <Btn key={i} className="solid-card ct-choice" onClick={() => { setVote(addVote(vote, i, 1)); setCover(true); sfx.start(); }}>{label}</Btn>)}
                </div>
                <div className="ct-row ct-main">
                    <span className="muted num">{vote.ballots}명 투표{classSize ? ` / ${classSize}명` : ''}</span>
                    {askEnd
                        ? <><Btn className="primary-btn" data-role="vote-close" onClick={() => { setAskEnd(false); setVote({ ...vote, phase: 'result' }); sfx.reveal(); }}>마감하고 개표</Btn><Btn className="chip" onClick={() => setAskEnd(false)}>계속</Btn></>
                        : <Btn className="chip" onClick={() => setAskEnd(true)}>마감…</Btn>}
                </div>
            </div>
        );
    }
    if (vote.phase === 'vote') {
        const total = vote.counts.reduce((a, b) => a + b, 0);
        return (
            <div className="ct-vote">
                <p className="ct-vote-q title-font">{vote.title || '학급 투표'}</p>
                <div className="ct-hands">
                    {vote.options.map((label, i) => (
                        <div key={i} className="ct-hand-row">
                            <span className="ct-hand-label">{label}</span>
                            <Btn className="chip" aria-label={`${label} 한 표 빼기`} onClick={() => setVote(addVote(vote, i, -1))}>−</Btn>
                            <span className="num ct-hand-n">{vote.counts[i]}</span>
                            <Btn className="chip on" aria-label={`${label} 한 표 더하기`} onClick={() => setVote(addVote(vote, i, 1))}>＋</Btn>
                        </div>
                    ))}
                </div>
                <div className="ct-row ct-main">
                    <span className="muted num">모두 {total}표{classSize ? ` / ${classSize}명` : ''}</span>
                    <Btn className="primary-btn" data-role="vote-close" onClick={() => { setVote({ ...vote, phase: 'result' }); sfx.reveal(); }}>결과 보기</Btn>
                </div>
            </div>
        );
    }
    const res = voteResult(vote);
    return (
        <div className="ct-vote">
            <p className="ct-vote-q title-font">{vote.title || '학급 투표'}</p>
            <div className="ct-bars" data-role="vote-result">
                {res.rows.map((row) => (
                    <div key={row.i} className={`ct-bar${res.winners.some((w) => w.i === row.i) ? ' is-win' : ''}`}>
                        <span className="ct-bar-label">{row.label}</span>
                        <span className="ct-bar-track"><span className="ct-bar-fill" style={{ width: `${Math.round(row.share * 100)}%` }} /></span>
                        <span className="num ct-bar-n">{row.count}</span>
                    </div>
                ))}
            </div>
            <p className="ct-vote-win" aria-live="polite">{!res.total ? '아직 표가 없어요.' : res.tie ? `동점이에요: ${res.winners.map((w) => w.label).join(', ')}` : `🎉 ${res.winners[0].label} (${res.winners[0].count}표)`}</p>
            <div className="ct-row ct-main">
                <Btn className="chip" onClick={() => setVote({ ...vote, counts: vote.options.map(() => 0), ballots: 0, phase: 'vote' })}>같은 선택지로 다시</Btn>
                <Btn className="primary-btn" onClick={() => setVote(newVote('', ['', '']))}>새 투표</Btn>
            </div>
        </div>
    );
}

/* ───── 판서 ───── */
/* 판서 칠판에 놓인 것들(그린 순서대로). 선: { points, tool, color, size }, 글: { kind: 'text', x, y, text, color, fs },
   그림: { kind: 'img', src, x, y, w, ar }. 자리·크기는 칠판 크기에 대한 비율이라 전체화면으로 키워도 같은 자리에 남습니다.
   앱을 닫으면 지워집니다(그림 저장으로 남깁니다). */
const boardMemory = { items: [], back: 'green' };
const TEXT_SIZES = { 3: 0.05, 6: 0.075, 12: 0.11 };
const imageCache = new Map();
function boardImage(src, onLoad) {
    let img = imageCache.get(src);
    if (!img) {
        img = new Image();
        img.onload = onLoad;
        img.src = src;
        imageCache.set(src, img);
    }
    return img.complete && img.naturalWidth ? img : null;
}
function boardFont(px) {
    const family = typeof document === 'undefined' ? 'sans-serif' : getComputedStyle(document.body).fontFamily || 'sans-serif';
    return `700 ${Math.round(px)}px ${family}`;
}
/** 그림 파일·붙여넣은 그림·화면 캡처를 1600px 안으로 줄여 dataURL 로. */
function shrinkImage(source, width, height) {
    const scale = Math.min(1, 1600 / Math.max(width, height));
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(width * scale));
    cv.height = Math.max(1, Math.round(height * scale));
    cv.getContext('2d').drawImage(source, 0, 0, cv.width, cv.height);
    return { src: cv.toDataURL('image/jpeg', 0.9), ar: cv.height / cv.width };
}
function fileToImage(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => { try { resolve(shrinkImage(img, img.naturalWidth, img.naturalHeight)); } catch (e) { reject(e); } finally { URL.revokeObjectURL(url); } };
        img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('그림을 읽지 못했어요.')); };
        img.src = url;
    });
}

function BoardTool() {
    const wrap = useRef(null);
    const canvas = useRef(null);
    const fileRef = useRef(null);
    const savedBoard = loadTools().board || {};
    const [start, setStart] = useState(savedBoard.start === 'text' ? 'text' : 'pen');
    const [back, setBack] = useState(boardMemory.back);
    const light = back === 'white';
    const palette = light ? BOARD_INKS : BOARD_COLORS;
    const [color, setColor] = useState(palette[0][0]);
    const [size, setSize] = useState(BOARD_SIZES[1][1]);
    const [tool, setTool] = useState(start);
    const [editor, setEditorState] = useState(null);
    const editorRef = useRef(null);
    const setEditor = (next) => { editorRef.current = next; setEditorState(next); };
    const [askClear, setAskClear] = useState(false);
    const [note, setNote] = useState('');
    const [, force] = useState(0);
    const drawing = useRef(null);
    const drag = useRef(null);
    const boxes = useRef(new Map());
    const items = boardMemory.items;
    const canCapture = typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia);
    useEffect(() => { saveTools({ board: { start } }); }, [start]);
    const paint = useCallback(() => {
        const cv = canvas.current;
        if (!cv) return;
        const ctx = cv.getContext('2d');
        const dpr = window.devicePixelRatio || 1;
        const w = cv.width / dpr;
        const h = cv.height / dpr;
        const isLight = boardMemory.back === 'white';
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, w, h);
        boxes.current = new Map();
        for (const item of boardMemory.items) {
            if (item.kind === 'text') boxes.current.set(item, drawText(ctx, item, w, h, isLight));
            else if (item.kind === 'img') {
                const img = boardImage(item.src, () => paint());
                const rw = item.w * w;
                const rh = rw * item.ar;
                if (img) ctx.drawImage(img, item.x * w, item.y * h, rw, rh);
                boxes.current.set(item, { x: item.x * w, y: item.y * h, w: rw, h: rh });
            } else drawStroke(ctx, item, w, h, isLight);
        }
    }, []);
    useEffect(() => { setColor((light ? BOARD_INKS : BOARD_COLORS)[0][0]); boardMemory.back = back; paint(); }, [back, light, paint]);
    useEffect(() => {
        const box = wrap.current;
        const cv = canvas.current;
        if (!box || !cv) return undefined;
        const fit = () => {
            const dpr = window.devicePixelRatio || 1;
            const r = box.getBoundingClientRect();
            cv.width = Math.max(1, Math.round(r.width * dpr));
            cv.height = Math.max(1, Math.round(r.height * dpr));
            cv.style.width = `${r.width}px`;
            cv.style.height = `${r.height}px`;
            paint();
        };
        fit();
        const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(fit);
        ro?.observe(box);
        return () => ro?.disconnect();
    }, [paint]);
    const addImage = useCallback((pic) => {
        const cv = canvas.current;
        const r = cv.getBoundingClientRect();
        /* 칠판 높이의 70% 안, 너비의 60% 안으로 가운데에 놓습니다. */
        let w = 0.6;
        if (w * r.width * pic.ar > 0.7 * r.height) w = (0.7 * r.height) / (pic.ar * r.width);
        boardMemory.items.push({ kind: 'img', src: pic.src, ar: pic.ar, w, x: (1 - w) / 2, y: Math.max(0.03, (1 - (w * r.width * pic.ar) / r.height) / 2) });
        setTool('text');
        setNote('그림을 끌어 옮기고, 오른쪽 아래 모서리를 끌어 크기를 바꿔요.');
        paint();
        force((n) => n + 1);
    }, [paint]);
    /* Ctrl+V 로 복사해 둔 그림(스크린샷)을 붙입니다. 글을 쓰는 중에는 글자를 붙입니다. */
    useEffect(() => {
        const onPaste = (event) => {
            if (event.target?.closest?.('.ct-text-editor')) return;
            const file = [...(event.clipboardData?.items || [])].find((it) => it.type.startsWith('image/'))?.getAsFile();
            if (!file) return;
            event.preventDefault();
            fileToImage(file).then(addImage).catch((e) => setNote(e.message));
        };
        document.addEventListener('paste', onPaste);
        return () => document.removeEventListener('paste', onPaste);
    }, [addImage]);
    const capture = async () => {
        let stream = null;
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
            const video = document.createElement('video');
            video.muted = true;
            video.playsInline = true;
            video.srcObject = stream;
            await video.play();
            await new Promise((r) => setTimeout(r, 250));
            addImage(shrinkImage(video, video.videoWidth, video.videoHeight));
        } catch {
            setNote('화면 캡처를 그만두었어요. 캡처할 창이나 화면을 고르면 칠판에 붙어요.');
        } finally {
            stream?.getTracks().forEach((t) => t.stop());
        }
    };
    /* 점은 0~1 비율로 둡니다: 팝업을 전체화면으로 키워도 그림이 같은 자리에 남습니다. */
    const at = (event) => { const r = canvas.current.getBoundingClientRect(); return [(event.clientX - r.left) / r.width, (event.clientY - r.top) / r.height]; };
    const hitAt = (event) => {
        const r = canvas.current.getBoundingClientRect();
        const px = event.clientX - r.left;
        const py = event.clientY - r.top;
        for (const item of [...boardMemory.items].reverse()) {
            const b = boxes.current.get(item);
            if (!b) continue;
            if (px >= b.x - 6 && px <= b.x + b.w + 6 && py >= b.y - 6 && py <= b.y + b.h + 6) {
                const corner = item.kind === 'img' && px > b.x + b.w - 28 && py > b.y + b.h - 28;
                return { item, corner, px, py, b };
            }
        }
        return null;
    };
    const openEditor = (pos, item = null) => {
        const index = item ? boardMemory.items.indexOf(item) : -1;
        if (item) { boardMemory.items.splice(index, 1); paint(); }
        setEditor({ x: pos[0], y: pos[1], text: item?.text || '', color: item?.color || color, fs: item?.fs || TEXT_SIZES[size] || TEXT_SIZES[6], index });
    };
    const commitEditor = () => {
        /* 칠판 누르기와 글칸 벗어나기가 함께 와도 한 번만 넣습니다. */
        const ed = editorRef.current;
        if (!ed) return;
        editorRef.current = null;
        const text = ed.text.replace(/\s+$/, '');
        if (text) {
            const item = { kind: 'text', x: ed.x, y: ed.y, text, color: ed.color, fs: ed.fs };
            if (ed.index >= 0) boardMemory.items.splice(ed.index, 0, item); else boardMemory.items.push(item);
        }
        setEditor(null);
        paint();
        force((n) => n + 1);
    };
    const down = (event) => {
        event.preventDefault();
        if (editor) { commitEditor(); return; }
        canvas.current.setPointerCapture?.(event.pointerId);
        if (tool === 'text') {
            const hit = hitAt(event);
            drag.current = hit ? { ...hit, start: at(event), origin: { x: hit.item.x, y: hit.item.y, w: hit.item.w }, moved: false } : { start: at(event), moved: false };
            return;
        }
        const stroke = { tool, color, dark: !light, size: tool === 'erase' ? size * 4 : tool === 'mark' ? size * 3 : size, points: [at(event)] };
        drawing.current = stroke;
        boardMemory.items.push(stroke);
        paint();
    };
    const move = (event) => {
        if (drag.current?.item) {
            const d = drag.current;
            const p = at(event);
            const dx = p[0] - d.start[0];
            const dy = p[1] - d.start[1];
            if (!d.moved && Math.hypot(dx, dy) * 400 < 4) return;
            d.moved = true;
            if (d.corner) d.item.w = Math.max(0.08, Math.min(1, d.origin.w + dx));
            else { d.item.x = d.origin.x + dx; d.item.y = d.origin.y + dy; }
            paint();
            return;
        }
        if (!drawing.current) return;
        const events = event.getCoalescedEvents?.() || [event];
        for (const e of events) drawing.current.points.push(at(e));
        paint();
    };
    const up = (event) => {
        if (drag.current) {
            const d = drag.current;
            drag.current = null;
            if (event?.type === 'pointerup' && !d.moved) {
                if (!d.item) openEditor(d.start);
                else if (d.item.kind === 'text') openEditor([d.item.x, d.item.y], d.item);
            }
            force((n) => n + 1);
            return;
        }
        if (drawing.current) { drawing.current = null; force((n) => n + 1); }
    };
    const undo = () => { boardMemory.items.pop(); paint(); force((n) => n + 1); };
    const clear = () => { boardMemory.items = []; setAskClear(false); setEditor(null); paint(); force((n) => n + 1); };
    const savePng = () => {
        const cv = canvas.current;
        const out = document.createElement('canvas');
        out.width = cv.width;
        out.height = cv.height;
        const ctx = out.getContext('2d');
        ctx.fillStyle = back === 'white' ? '#FBFBF8' : back === 'black' ? '#1D2422' : '#2F4A3C';
        ctx.fillRect(0, 0, out.width, out.height);
        ctx.drawImage(cv, 0, 0);
        const a = document.createElement('a');
        a.download = `판서-${new Date().toISOString().slice(0, 10)}.png`;
        a.href = out.toDataURL('image/png');
        a.click();
    };
    const pick = (next) => { if (editor) commitEditor(); setTool(next); setNote(next === 'text' ? '칠판을 누르면 그 자리에 글을 써요. 쓴 글을 누르면 고치고, 끌면 옮겨요.' : ''); };
    const faceH = wrap.current?.getBoundingClientRect().height || 400;
    return (
        <div className="ct-board">
            <div className="ct-board-bar" role="toolbar" aria-label="판서 도구">
                <Btn className={tool === 'text' ? 'chip on' : 'chip'} aria-pressed={tool === 'text'} data-role="board-text" onClick={() => pick('text')}>⌨️ 글쓰기</Btn>
                <Btn className={tool === 'pen' ? 'chip on' : 'chip'} aria-pressed={tool === 'pen'} data-role="board-pen" onClick={() => pick('pen')}>{light ? '🖊️ 펜' : '🖍️ 분필'}</Btn>
                <Btn className={tool === 'mark' ? 'chip on' : 'chip'} aria-pressed={tool === 'mark'} onClick={() => pick('mark')}>형광펜</Btn>
                <Btn className={tool === 'erase' ? 'chip on' : 'chip'} aria-pressed={tool === 'erase'} onClick={() => pick('erase')}>지우개</Btn>
                <Btn className="chip" data-role="board-image" onClick={() => fileRef.current?.click()}>🖼️ 그림 넣기</Btn>
                {canCapture && <Btn className="chip" data-role="board-capture" onClick={capture}>📸 화면 캡처</Btn>}
                <input ref={fileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) fileToImage(f).then(addImage).catch((err) => setNote(err.message)); }} />
                <span className="ct-swatches" role="group" aria-label="색">
                    {palette.map(([hex, name]) => <Btn key={hex} className={`ct-swatch${color === hex ? ' is-on' : ''}`} style={{ '--sw': hex }} aria-label={name} aria-pressed={color === hex} onClick={() => { setColor(hex); if (editor) setEditor({ ...editor, color: hex }); if (tool === 'erase') setTool('pen'); }} />)}
                </span>
                <span className="ct-sizes" role="group" aria-label={tool === 'text' ? '글자 크기' : '굵기'}>
                    {BOARD_SIZES.map(([name, px]) => <Btn key={px} className={`ct-size${size === px ? ' is-on' : ''}`} aria-label={tool === 'text' ? `글자 ${name === '가늘게' ? '작게' : name === '굵게' ? '크게' : '보통'}` : name} aria-pressed={size === px} onClick={() => { setSize(px); if (editor) setEditor({ ...editor, fs: TEXT_SIZES[px] }); }}>{tool === 'text' ? <b style={{ fontSize: 10 + px }}>가</b> : <i style={{ width: px + 2, height: px + 2 }} />}</Btn>)}
                </span>
                <Btn className="chip" aria-label="되돌리기" disabled={!items.length} onClick={undo}>↩︎</Btn>
                <Btn className="chip" onClick={() => setBack(BOARD_BACKS[(BOARD_BACKS.findIndex(([k]) => k === back) + 1) % BOARD_BACKS.length][0])}>{BOARD_BACKS.find(([k]) => k === back)[1]}</Btn>
                <Btn className="chip" onClick={savePng}>그림 저장</Btn>
                {askClear
                    ? <span className="ct-ask" role="group" aria-label="모두 지우기 확인"><span className="ct-ask-q">정말 다 지울까요?</span><Btn className="chip ct-danger" data-role="board-clear-yes" onClick={clear}>지우기</Btn><Btn className="chip" onClick={() => setAskClear(false)}>그만두기</Btn></span>
                    : <Btn className="chip" data-role="board-clear" disabled={!items.length} onClick={() => setAskClear(true)}>모두 지우기</Btn>}
                <Btn className="chip ct-start" data-role="board-start" aria-label={`처음 열 때 ${start === 'text' ? '글쓰기' : '펜'}로 시작, 눌러서 바꾸기`} onClick={() => setStart(start === 'text' ? 'pen' : 'text')}>처음: {start === 'text' ? '글쓰기' : '펜'}</Btn>
            </div>
            {note && <p className="muted ct-note ct-board-note" aria-live="polite">{note}</p>}
            <div ref={wrap} className="ct-board-face" data-back={back} data-tool={tool}>
                <canvas ref={canvas} className="ct-canvas" aria-label="판서 칠판" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onPointerLeave={(e) => { if (drawing.current) up(e); }} />
                {editor && (
                    <textarea
                        className="ct-text-editor"
                        data-role="board-editor"
                        aria-label="칠판에 쓸 글"
                        autoFocus
                        rows={Math.max(1, editor.text.split('\n').length)}
                        value={editor.text}
                        style={{ left: `${editor.x * 100}%`, top: `${editor.y * 100}%`, color: swapInk(editor.color, light), fontSize: `${Math.round(editor.fs * faceH)}px` }}
                        onChange={(e) => setEditor({ ...editor, text: e.target.value })}
                        onKeyDown={(e) => {
                            if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commitEditor(); }
                            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); commitEditor(); }
                        }}
                        onBlur={() => commitEditor()}
                    />
                )}
                {!items.length && !editor && <p className="ct-board-hint" aria-hidden="true">{tool === 'text' ? '눌러서 글쓰기 · Ctrl+V 로 그림 붙이기' : '손가락이나 펜으로 써 보세요'}</p>}
            </div>
        </div>
    );
}

/** 글 한 덩이를 그리고 차지한 칸(px)을 돌려줍니다. 여러 줄이면 줄마다. */
function drawText(ctx, item, w, h, light) {
    const px = Math.max(10, item.fs * h);
    const lines = String(item.text).split('\n');
    ctx.save();
    ctx.font = boardFont(px);
    ctx.textBaseline = 'top';
    ctx.fillStyle = swapInk(item.color, light);
    let width = 0;
    lines.forEach((line, i) => {
        ctx.fillText(line, item.x * w, item.y * h + i * px * 1.25);
        width = Math.max(width, ctx.measureText(line).width);
    });
    ctx.restore();
    return { x: item.x * w, y: item.y * h, w: width, h: lines.length * px * 1.25 };
}

/* 칠판을 바꿔도 글씨가 사라지지 않게: 흰 분필은 화이트보드에서 검정, 검정 펜은 칠판에서 흰 분필로 보입니다. */
function swapInk(color, light) {
    if (light && color === BOARD_COLORS[0][0]) return BOARD_INKS[0][0];
    if (!light && color === BOARD_INKS[0][0]) return BOARD_COLORS[0][0];
    return color;
}

function drawStroke(ctx, s, w, h, light = false) {
    if (!s.points.length) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = s.size;
    if (s.tool === 'erase') {
        ctx.globalCompositeOperation = 'destination-out';
        ctx.strokeStyle = '#000';
    } else {
        ctx.globalAlpha = s.tool === 'mark' ? (s.dark ? 0.5 : 0.35) : 0.95;
        ctx.strokeStyle = swapInk(s.color, light);
        ctx.fillStyle = swapInk(s.color, light);
    }
    const pts = s.points.map(([x, y]) => [x * w, y * h]);
    if (pts.length === 1) {
        ctx.beginPath();
        ctx.arc(pts[0][0], pts[0][1], s.size / 2, 0, Math.PI * 2);
        if (s.tool === 'erase') ctx.fill(); else ctx.fill();
    } else {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i < pts.length - 1; i += 1) {
            const mx = (pts[i][0] + pts[i + 1][0]) / 2;
            const my = (pts[i][1] + pts[i + 1][1]) / 2;
            ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
        }
        const last = pts[pts.length - 1];
        ctx.lineTo(last[0], last[1]);
        ctx.stroke();
    }
    ctx.restore();
}

/* ───── 수업 도구 화면 ───── */
export function ClassTools() {
    const { data, route, go } = useUi();
    const students = data?.students || [];
    const open = TOOL_IDS.includes(route?.params?.tool) ? route.params.tool : '';
    const close = () => go('#/tools');
    return (
        <div className="ct-page" data-screen="tools">
            <div className="ct-grid">
                {TOOL_IDS.map((id) => (
                    <Btn key={id} className="solid-card ct-tile" data-tool-open={id} onClick={() => go(`#/tools/${id}`)}>
                        <span className="ct-tile-icon" aria-hidden="true">{TOOL_INFO[id].icon}</span>
                        <span className="ct-tile-name title-font">{TOOL_INFO[id].label}</span>
                        <span className="ct-tile-hint muted">{TOOL_INFO[id].hint}</span>
                    </Btn>
                ))}
            </div>
            <p className="muted ct-page-note">누르면 팝업으로 열리고, 팝업 위 「⛶ 전체화면」으로 화면을 꽉 채워 TV에 띄울 수 있어요. 설정값은 이 기기에만 남아요.</p>
            {open && (
                <ToolShell id={open} onClose={close} wide={open === 'board' || open === 'wheel'}>
                    {open === 'timer' && <TimerTool />}
                    {open === 'lottery' && <LotteryTool students={students} />}
                    {open === 'wheel' && <WheelTool students={students} />}
                    {open === 'vote' && <VoteTool students={students} />}
                    {open === 'board' && <BoardTool />}
                </ToolShell>
            )}
        </div>
    );
}

export default ClassTools;
