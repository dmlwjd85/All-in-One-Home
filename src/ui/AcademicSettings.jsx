import { useEffect, useState } from 'react';
import { saveAcademicYear } from '../lib/db.js';
import { ACADEMIC_FIELDS, OFF_FIELD, academicProblem, academicYear, cleanYear } from '../lib/academic.js';
import { monthCells, monthTitle } from '../lib/date.js';
import { Btn } from './bits.jsx';

const FIELDS = [...ACADEMIC_FIELDS, OFF_FIELD];
const MARK = { firstStart: '개학', firstEnd: '방학식', secondStart: '개학', secondEnd: '종업', offDays: '휴업' };
const WEEK = ['월', '화', '수', '목', '금', '토', '일'];

function shiftYm(ym, n) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(y, m - 1 + n, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function short(ymd) {
    return ymd ? `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8))}` : '고르기';
}

/** 학교마다 다른 학사일정. 위에서 무엇을 넣을지 고르고, 달력에서 날짜를 한 번 누르면 들어갑니다(드롭다운·돌림판 없음). */
export function AcademicSettings({ data, showToast }) {
    const year = Number(data.profile.schoolYear) || 2026;
    const saved = academicYear(year, data.profile.academic);
    const [row, setRow] = useState(saved);
    const [field, setField] = useState('firstStart');
    const [ym, setYm] = useState(`${year}-03`);
    const savedKey = JSON.stringify(saved);
    useEffect(() => { setRow(JSON.parse(savedKey)); }, [savedKey]);
    const dirty = JSON.stringify(cleanYear(row)) !== savedKey;
    const problem = academicProblem(row);

    function tapDay(ymd) {
        if (field === 'offDays') {
            const list = new Set(row.offDays || []);
            if (list.has(ymd)) list.delete(ymd); else list.add(ymd);
            setRow({ ...row, offDays: [...list].sort() });
            return;
        }
        if (row[field] === ymd) {
            const next = { ...row };
            delete next[field];
            setRow(next);
            return;
        }
        setRow({ ...row, [field]: ymd });
        /* 다음 칸으로 넘어가고, 그 날짜가 있을 법한 달을 보여 줍니다. */
        const index = ACADEMIC_FIELDS.findIndex((item) => item.id === field);
        const next = ACADEMIC_FIELDS[index + 1];
        if (next && !row[next.id]) {
            setField(next.id);
            setYm({ firstEnd: `${year}-07`, secondStart: `${year}-08`, secondEnd: `${year + 1}-02` }[next.id]);
        }
    }

    async function save() {
        if (problem) { showToast(problem); return; }
        const result = await saveAcademicYear(year, cleanYear(row));
        if (result?.storageFailed) return;
        showToast(`${year}학년도 학사일정을 저장했어요. 학기 타일·수업일·휴일에 바로 반영돼요.`, true);
    }

    const marks = {};
    for (const item of ACADEMIC_FIELDS) if (row[item.id]) marks[row[item.id]] = item.id;
    for (const day of row.offDays || []) marks[day] = 'offDays';
    const summer = row.firstEnd && row.secondStart ? `${short(row.firstEnd)} 방학식 뒤부터 ${short(row.secondStart)} 개학 전까지 여름방학` : '';

    return (
        <section className="glass academic" style={{ padding: 14 }} aria-label="학사일정" data-screen="academic">
            <h2 className="title-font" style={{ marginTop: 0 }}>학사일정 ({year}학년도)</h2>
            <p className="muted" style={{ marginTop: 0 }}>학교마다 개학·방학 날이 달라요. 넣을 칸을 고른 뒤 달력에서 날짜를 한 번 누르세요. 다시 누르면 지워져요.</p>
            <div className="acad-fields" role="group" aria-label="넣을 날">
                {FIELDS.map((item) => (
                    <Btn
                        key={item.id}
                        className={`choice-tile acad-field${field === item.id ? ' on' : ''}`}
                        data-acad-field={item.id}
                        aria-pressed={field === item.id ? 'true' : 'false'}
                        onClick={() => {
                            setField(item.id);
                            const day = item.id === 'offDays' ? (row.offDays || [])[0] : row[item.id];
                            if (day) setYm(day.slice(0, 7));
                        }}
                    >
                        <strong>{item.label}</strong>
                        <span className="num">{item.id === 'offDays' ? `${(row.offDays || []).length}일` : short(row[item.id])}</span>
                    </Btn>
                ))}
            </div>
            <div className="acad-month">
                <Btn className="icon-btn acad-nav" aria-label="앞 달" onClick={() => setYm(shiftYm(ym, -1))}>‹</Btn>
                <strong className="num">{monthTitle(ym)}</strong>
                <Btn className="icon-btn acad-nav" aria-label="다음 달" onClick={() => setYm(shiftYm(ym, 1))}>›</Btn>
            </div>
            <div className="acad-grid" role="grid" aria-label={`${monthTitle(ym)} 달력`}>
                {WEEK.map((name) => <span key={name} className="acad-week muted" aria-hidden="true">{name}</span>)}
                {monthCells(ym).map((cell) => {
                    const mark = marks[cell.ymd];
                    const label = mark ? FIELDS.find((item) => item.id === mark)?.label : '';
                    return (
                        <Btn
                            key={cell.ymd}
                            className={`acad-day${cell.inMonth ? '' : ' is-out'}${mark ? ` is-${mark}` : ''}`}
                            data-ymd={cell.ymd}
                            aria-label={`${Number(cell.ymd.slice(5, 7))}월 ${cell.day}일${label ? ` ${label}` : ''}`}
                            aria-pressed={mark ? 'true' : 'false'}
                            onClick={() => tapDay(cell.ymd)}
                        >
                            <span className="num">{cell.day}</span>
                            {mark && <span className="acad-mark">{MARK[mark]}</span>}
                        </Btn>
                    );
                })}
            </div>
            {summer && <p className="muted" style={{ margin: '8px 0 0' }}>{summer}으로 봐요.</p>}
            {problem && <p className="acad-problem" role="alert">{problem}</p>}
            <Btn className="primary-btn block" style={{ marginTop: 8 }} data-acad-save="1" disabled={!dirty} onClick={save}>{dirty ? '학사일정 저장' : '저장됨'}</Btn>
        </section>
    );
}
