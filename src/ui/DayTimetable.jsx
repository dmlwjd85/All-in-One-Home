import { useState } from 'react';
import { resetDayTimetable, setDayTimetable } from '../lib/db.js';
import { Btn } from './bits.jsx';

/** 그날만 시간표 고치기. 고친 날은 기본 시간표를 다시 넣어도 그대로 남습니다(묻고 덮어쓸 수 있음). */
export function DayTimetable({ data, date, table, count = 6, hidden = () => false }) {
    const [edit, setEdit] = useState(null);
    const [specialOn, setSpecialOn] = useState(false);
    const edited = (data.profile.ttEdited || []).includes(date);
    return (
        <div className="day-tt" data-screen="day-tt">
            <p className="muted" style={{ margin: 0 }}>{edited ? '이 날은 따로 고친 시간표예요.' : '교시를 누르면 이 날만 고칠 수 있어요.'}</p>
            {Array.from({ length: count }, (_, index) => {
                if (hidden(index + 1)) return null;
                const subject = table[`p${index + 1}`] || '';
                const special = table[`s${index + 1}`];
                return (
                    <Btn key={index} className={edit?.period === index + 1 ? 'solid-card day-tt-cell neo-in' : 'solid-card day-tt-cell'} data-day-period={index + 1} onClick={() => {
                        setEdit({ period: index + 1, subject });
                        setSpecialOn(Boolean(special));
                    }}>
                        <span><strong className="num">{index + 1}교시</strong> {subject || '비어 있음'}</span>
                        <span className="muted">{special ? '전담' : ''}</span>
                    </Btn>
                );
            })}
            {edit && (
                <form key={edit.period} className="solid-card" style={{ padding: 12 }} onSubmit={async (event) => {
                    event.preventDefault();
                    const form = new FormData(event.currentTarget);
                    const saved = await setDayTimetable(date, edit.period, String(form.get('subject') || '').trim(), specialOn ? '전담' : '');
                    if (saved?.storageFailed) return;
                    setEdit(null);
                }}>
                    <strong>이 날 {edit.period}교시</strong>
                    <input className="field" name="subject" aria-label="이 날 과목" defaultValue={edit.subject} maxLength={20} style={{ marginTop: 8 }} />
                    <div className="term-tiles" style={{ marginTop: 8 }}>
                        <Btn className={specialOn ? 'chip on' : 'chip'} onClick={() => setSpecialOn((value) => !value)}>{specialOn ? '전담 시간이에요' : '전담 아님'}</Btn>
                        <Btn className="chip" onClick={() => setEdit(null)}>그만두기</Btn>
                    </div>
                    <Btn className="primary-btn block" style={{ marginTop: 8 }} data-day-save="1" onClick={(event) => event.currentTarget.form?.requestSubmit()}>이 날만 저장</Btn>
                </form>
            )}
            {edited && <Btn className="chip" onClick={() => resetDayTimetable(date)}>기본 시간표로 되돌리기</Btn>}
        </div>
    );
}
