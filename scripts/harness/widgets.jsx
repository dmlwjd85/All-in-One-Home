/* check:widgets-browser 가 띄우는 위젯판. db·구글 캘린더·할 일 효과는 가짜로 바꿔 끼웁니다(scripts/check-widgets-browser.mjs). */
import { createRoot } from 'react-dom/client';
import { Ui } from '../../src/ui/context.jsx';
import { WidgetBoard } from '../../src/ui/WidgetBoard.jsx';

const today = '2026-11-12';
const data = {
    auth: { uid: 'u1' },
    profile: { checkedDates: [today], periodStarts: [], demo: false },
    attendance: [{ id: 'a1', sid: 's1', date: today, status: '지각' }],
    students: [],
    timetable: {},
    events: [
        { id: 'e1', date: today, title: '학년 협의회', time: '15:00' },
        { id: 'e2', date: '2026-11-14', title: '학부모 공개수업' },
        { id: 'e3', date: '2026-11-18', end: '2026-11-20', title: '현장체험학습' },
        { id: 'e4', date: '2026-11-25', title: '교육과정 설명회', time: '09:30' },
        { id: 'e5', date: '2026-11-25', title: '학급 회의' },
        { id: 'e6', date: '2026-11-25', title: '안전 교육' },
        { id: 'e7', date: '2026-11-25', title: '받아쓰기' },
        { id: 'e8', date: '2026-12-24', title: '겨울방학식' },
    ],
    todos: [{ id: 't1', title: '가정통신문 걷기', done: false }, { id: 't2', title: '수행평가 입력', done: false }, { id: 't3', title: '끝난 일', done: true }],
    notices: [{ id: 'n1', date: '2026-11-13', text: '1. 체육복 입고 오기\n2. 받아쓰기 5급' }],
};
window.__go = [];
const ui = { data, clock: { ymd: today, hm: '08:42', weekday: '목' }, go: (hash) => window.__go.push(hash), showToast: () => {} };
createRoot(document.getElementById('root')).render(
    <Ui.Provider value={ui}><WidgetBoard onLeave={() => window.__go.push('leave')} /></Ui.Provider>,
);
window.__ready = true;
