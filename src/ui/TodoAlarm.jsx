import { useEffect, useRef, useState } from 'react';
import { joined, toggleTodo } from '../lib/db.js';
import { seoulParts } from '../lib/date.js';
import { dueAlarms, markFired, readFired, splitAlarms } from '../lib/todoAlarm.js';
import { useUi } from './context.jsx';
import { Btn } from './bits.jsx';

/* 짧은 알림음 세 번. 파일 없이 WebAudio로 만듭니다. 브라우저가 소리를 막으면 팝업만 뜹니다. */
let audioCtx = null;
export function playAlarm() {
    try {
        const Ctx = window.AudioContext || window.webkitAudioContext;
        if (!Ctx) return false;
        audioCtx = audioCtx || new Ctx();
        if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
        const t0 = audioCtx.currentTime + 0.02;
        [0, 0.35, 0.7].forEach((offset) => {
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.type = 'sine';
            osc.frequency.value = 880;
            gain.gain.setValueAtTime(0.0001, t0 + offset);
            gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.02);
            gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.25);
            osc.connect(gain).connect(audioCtx.destination);
            osc.start(t0 + offset);
            osc.stop(t0 + offset + 0.27);
        });
        window.__todoAlarmPlayed = (window.__todoAlarmPlayed || 0) + 1;
        return true;
    } catch {
        return false;
    }
}

function notify(rows) {
    try {
        if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
        const body = rows.map((row) => `${row.time} ${row.title}`).join('\n').slice(0, 300);
        new Notification('쨈 교무수첩 할 일 알림', { body, tag: 'ssug-gyomu-todo-alarm', icon: 'apple-touch-icon.png' });
    } catch { /* 일부 휴대폰 브라우저는 페이지에서 바로 알림을 못 띄웁니다. 앱 안 팝업은 그대로 뜹니다. */ }
}

/**
 * 할 일 알림(PR #60). 앱이 열려 있는 동안 20초마다 확인해 마감 날짜·시각이 된 할 일을 팝업·소리·브라우저 알림으로 알립니다.
 * 앱이 닫혀 있을 때는 울리지 않습니다(docs/todo-alarm.md). 다시 열면 오늘 지난 알림은 소리 없이 '놓친 알림'으로만 보여 줍니다.
 */
export function TodoAlarm() {
    const { data, go } = useUi();
    const [ringing, setRinging] = useState([]);
    const [perm, setPerm] = useState(() => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission));
    const todosRef = useRef([]);
    todosRef.current = data ? joined(data, 'todos') : [];

    const checkRef = useRef(() => {});
    const todoSig = todosRef.current.map((row) => `${row.id}|${row.due || ''}|${row.time || ''}|${row.done ? 1 : 0}`).join(',');
    useEffect(() => {
        let first = true;
        const check = () => {
            const clock = seoulParts(new Date());
            const due = dueAlarms(todosRef.current, clock.ymd, clock.hm, readFired());
            const wasFirst = first;
            if (todosRef.current.length) first = false;
            if (!due.length) return;
            markFired(due, clock.ymd);
            const { ring, missed } = splitAlarms(due, clock.hm, { first: wasFirst });
            const tagged = [...ring.map((row) => ({ ...row, missed: false })), ...missed.map((row) => ({ ...row, missed: true }))];
            setRinging((prev) => [...prev, ...tagged.filter((row) => !prev.some((item) => item.id === row.id))]);
            // 앱을 열자마자 지난 알림이 한꺼번에 울리지 않게, 소리·브라우저 알림은 제때 알아챈 것만 냅니다.
            if (ring.length) { playAlarm(); notify(ring); }
        };
        checkRef.current = check;
        check();
        const timer = setInterval(check, 20000);
        const onVisible = () => { if (document.visibilityState === 'visible') check(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => { clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); };
    }, []);
    // 할 일을 고치거나 새로 받으면 20초를 기다리지 않고 바로 봅니다(이미 지난 시각이면 곧 울림).
    useEffect(() => { checkRef.current(); }, [todoSig]);

    if (!ringing.length) return null;
    const close = () => setRinging([]);
    const live = ringing.map((row) => ({ ...(todosRef.current.find((item) => item.id === row.id) || row), missed: row.missed }));
    const allMissed = live.every((row) => row.missed);
    return (
        <div className="sheet-back todo-alarm-back" onClick={close}>
            <div className="sheet todo-alarm" role="alertdialog" aria-modal="true" aria-label="할 일 알림" data-screen="todo-alarm" data-missed={allMissed ? "1" : "0"} onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                <div className="todo-alarm-head">
                    <div className="todo-alarm-bell" aria-hidden="true">⏰</div>
                    <div>
                        <h2 className="title-font" style={{ margin: 0, fontSize: 18 }}>{allMissed ? '놓친 할 일 알림이 있어요' : '할 일 알림'}</h2>
                        <p className="todo-alarm-sub">{allMissed ? '앱을 여는 사이 지난 알림이에요' : '지금 울렸어요'}</p>
                    </div>
                </div>
                <ul className="todo-alarm-list">
                    {live.map((row) => (
                        <li key={row.id} className="todo-alarm-item">
                            <span className="num todo-alarm-time">{row.time}</span>
                            <span className="todo-alarm-title">
                                <strong>{row.time ? `${Number(String(row.time).slice(0, 2)) % 12 || 12}시 할 일 알림` : '할 일 알림'}</strong>
                                <div className="todo-alarm-sub">{row.title}{row.missed ? ' · 놓침' : ' · 지금 울렸어요'}</div>
                            </span>
                            <Btn className="chip" aria-label={`${row.title} 끝냄 표시`} disabled={row.done} onClick={() => toggleTodo(row.id)}>{row.done ? '끝냄' : '끝냄 표시'}</Btn>
                        </li>
                    ))}
                </ul>
                {perm === 'default' ? (
                    <Btn className="chip" style={{ marginTop: 8 }} onClick={async () => {
                        try { setPerm(await Notification.requestPermission()); } catch { setPerm('denied'); }
                    }}>브라우저 알림도 받기</Btn>
                ) : null}
                <div className="detail-actions" style={{ marginTop: 12 }}>
                    <Btn className="choice-tile on" data-role="todo-alarm-open" onClick={() => { close(); go?.('#/todo'); }}>할 일 보기</Btn>
                    <Btn className="choice-tile" data-role="todo-alarm-close" onClick={close}>확인</Btn>
                </div>
            </div>
        </div>
    );
}
