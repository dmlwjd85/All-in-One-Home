import { useMemo, useRef, useState } from 'react';
import { formatKoDate } from '../lib/date.js';
import { addHomework, joined, removeHomework, renameHomework, setHomeworkDate, submitAllHomework, toggleHomeworkSubmit } from '../lib/db.js';
import {
    homeworkOverdue, homeworkProgress, homeworkProgressLabel, homeworkRoster, homeworkTitle,
    packOf, pastHomework, visibleHomework,
} from '../lib/homework.js';
import { useUi } from './context.jsx';
import { Btn, Field } from './bits.jsx';
import { DateGrid } from './pickers.jsx';
import { tapHandlers } from './tapGuard.js';

/** 스크롤과 탭을 가리고, click만 보내는 입력도 받습니다. */
function TapBtn({ onTap, className = '', children, ...props }) {
    const latest = useRef(onTap);
    latest.current = onTap;
    const sawPointer = useRef(false);
    const tap = useMemo(() => tapHandlers({
        onTap: (event) => latest.current?.(event),
    }), []);
    const pointerDown = tap.onPointerDown;
    return (
        <Btn
            {...props}
            className={className}
            data-tap-guard="1"
            {...tap}
            onPointerDown={(event) => {
                sawPointer.current = true;
                pointerDown?.(event);
            }}
            onClick={(event) => {
                if (sawPointer.current) {
                    sawPointer.current = false;
                    return;
                }
                latest.current?.(event);
            }}
            onKeyDown={(event) => {
                if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
                event.preventDefault();
                latest.current?.(event);
            }}
        >{children}</Btn>
    );
}

function tell(showToast, result, okText, undoable = false) {
    if (result?.storageFailed) {
        showToast(result.message || '이 기기에 남기지 못했어요.');
        return false;
    }
    if (result && result.ok === false) {
        showToast(result.message || '남기지 못했어요.');
        return false;
    }
    if (okText) showToast(result?.sensitive ? '이 내용은 이 기기에만 남겨 둘게요.' : okText, undoable);
    return true;
}

export function Homework() {
    const { data, clock, route, go, showToast } = useUi();
    const notes = joined(data, 'notes');
    const id = route.params.id || '';
    const everyone = data.allStudents || data.students;
    if (id) {
        const row = notes.find((item) => item.id === id);
        return <HomeworkDetail row={row && row.id?.startsWith('hw-') ? row : null} notes={notes} students={data.students} everyone={everyone} today={clock.ymd} go={go} showToast={showToast} />;
    }
    return <HomeworkList notes={notes} students={data.students} today={clock.ymd} go={go} showToast={showToast} />;
}

function dueLine(row, today, students) {
    const when = formatKoDate(row.date, { today }) || '마감일 없음';
    const late = homeworkOverdue(row.date, today) ? ' · 지남' : '';
    return `${when}${late} · ${homeworkProgressLabel(homeworkProgress(row, students))}`;
}

function HomeworkList({ notes, students, today, go, showToast }) {
    const [title, setTitle] = useState('');
    const [date, setDate] = useState(today);
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState('');
    const [showPast, setShowPast] = useState(false);
    const rows = visibleHomework(notes, { today, query, showPast });
    const past = pastHomework(notes, today);
    async function add() {
        const roster = students.map((student) => student.id);
        const result = await addHomework(title, date, undefined, roster);
        if (!tell(showToast, result, '과제를 추가했어요.')) return;
        setTitle('');
        setDate(today);
        setOpen(false);
    }
    return (
        <div className="hw">
            <p className="muted hw-lead">과제 이름을 적고 추가한 뒤, 과제를 눌러 제출한 친구를 표시해요. 체크는 누르는 즉시 저장돼요.</p>
            <form className="solid-card hw-add" onSubmit={(event) => { event.preventDefault(); add(); }}>
                <label className="hw-label" htmlFor="hw-new-title">과제 이름</label>
                <Field id="hw-new-title" value={title} maxLength={60} placeholder="예: 독서록" aria-label="과제 이름" onChange={(event) => setTitle(event.target.value)} />
                <div className="hw-label" id="hw-new-date-label">마감일</div>
                <Btn className="chip hw-date-toggle" type="button" data-role="hw-new-date" aria-expanded={open ? 'true' : 'false'} aria-controls="hw-new-date-grid" onClick={() => setOpen((value) => !value)}>
                    <strong>{formatKoDate(date, { today })}</strong>
                    <span className="muted">{open ? '접기' : '마감일 바꾸기'}</span>
                </Btn>
                {open ? (
                    <div id="hw-new-date-grid" className="hw-date">
                        <DateGrid value={date} today={today} onPick={(ymd) => { setDate(ymd); setOpen(false); }} />
                    </div>
                ) : null}
                <Btn className="primary-btn block" data-role="hw-add" disabled={!title.trim()} onClick={add}>추가</Btn>
            </form>
            <Field className="field hw-find" aria-label="과제 찾기" placeholder="과제 이름 찾기" value={query} onChange={(event) => setQuery(event.target.value)} />
            <div className="hw-cards" role="list" aria-label="과제 목록">
                {rows.map((row) => (
                    <TapBtn key={row.id} block className="solid-card hw-card" data-role="hw-open" data-hw-id={row.id} aria-label={`${homeworkTitle(row)}, ${dueLine(row, today, students)}`} onTap={() => go(`#/homework/${row.id}`)}>
                        <span className="hw-card-title">{row.localOnly ? '🔒 ' : ''}{homeworkTitle(row)}</span>
                        <span className="hw-card-meta">{dueLine(row, today, students)}</span>
                    </TapBtn>
                ))}
            </div>
            {!query && past.length > 0 && (
                <Btn className="chip" data-role="hw-past" aria-expanded={showPast ? 'true' : 'false'} onClick={() => setShowPast((value) => !value)}>
                    {showPast ? '지난 과제 접기' : `지난 과제 ${past.length}개`}
                </Btn>
            )}
            {!rows.length && <p className="muted">{query ? '찾는 과제가 없어요.' : '아직 과제가 없어요. 이름을 적고 추가해 주세요.'}</p>}
        </div>
    );
}

function HomeworkDetail({ row, students, everyone, today, go, showToast }) {
    const [renaming, setRenaming] = useState(false);
    const [name, setName] = useState(row?.title || '');
    const [dateOpen, setDateOpen] = useState(false);
    const [onlyMissing, setOnlyMissing] = useState(false);
    if (!row) {
        return (
            <div className="hw">
                <p>그 과제를 찾지 못했어요.</p>
                <Btn className="chip" onClick={() => go('#/homework')}>과제 목록</Btn>
            </div>
        );
    }
    const progress = homeworkProgress(row, students);
    const pack = packOf(row);
    const roster = homeworkRoster(row, students);
    const active = new Set(students.map((student) => student.id));
    const ordered = roster.map((id) => {
        const found = (everyone || []).find((student) => student.id === id);
        if (found) return { ...found, past: !active.has(id) };
        return { id, no: '', name: id, past: true };
    });
    const shown = ordered.filter((student) => !onlyMissing || !pack.checks[student.id]?.on);
    async function saveName() {
        const result = await renameHomework(row.id, name);
        if (!tell(showToast, result, '이름을 바꿨어요.', true)) return;
        setRenaming(false);
    }
    async function pickDate(ymd) {
        const result = await setHomeworkDate(row.id, ymd);
        tell(showToast, result, '마감일을 바꿨어요.');
        setDateOpen(false);
    }
    async function remove() {
        if (typeof window !== 'undefined' && !window.confirm('이 과제와 제출 표시를 지울까요?')) return;
        const result = await removeHomework(row.id);
        if (!tell(showToast, result, '과제를 지웠어요.', true)) return;
        go('#/homework');
    }
    async function toggle(student) {
        const result = await toggleHomeworkSubmit(row.id, student.id);
        if (!result?.ok) {
            tell(showToast, result, '');
            return;
        }
        const label = student.no ? `${student.no}번 ${student.name}` : student.name;
        showToast(result.on ? `${label} 제출` : `${label} 미제출`);
    }
    async function all() {
        const result = await submitAllHomework(row.id, ordered.map((student) => student.id));
        tell(showToast, result, '모두 제출로 표시했어요.', true);
    }
    return (
        <div className="hw" data-hw-detail="1">
            <Btn className="chip hw-back" onClick={() => go('#/homework')}>‹ 과제 목록</Btn>
            {renaming ? (
                <form className="hw-rename" onSubmit={(event) => { event.preventDefault(); saveName(); }}>
                    <label className="hw-label" htmlFor="hw-rename">새 이름</label>
                    <Field id="hw-rename" value={name} maxLength={60} aria-label="과제 이름 바꾸기" onChange={(event) => setName(event.target.value)} />
                    <div className="hw-tools">
                        <Btn className="primary-btn" data-role="hw-rename-save" disabled={!name.trim()} onClick={saveName}>바꾸기</Btn>
                        <Btn className="chip" onClick={() => { setName(row.title || ''); setRenaming(false); }}>취소</Btn>
                    </div>
                </form>
            ) : (
                <div className="hw-head">
                    <h2 className="title-font hw-title">{row.localOnly ? '🔒 ' : ''}{homeworkTitle(row)}</h2>
                    <div className="hw-tools">
                        <Btn className="chip" data-role="hw-rename" onClick={() => { setName(row.title || ''); setRenaming(true); }}>이름 바꾸기</Btn>
                        <Btn className="chip" data-role="hw-delete" onClick={remove}>지우기</Btn>
                    </div>
                </div>
            )}
            <div className="hw-label" id="hw-date-label">마감일</div>
            <Btn className="chip hw-date-toggle" data-role="hw-date" aria-expanded={dateOpen ? 'true' : 'false'} aria-controls="hw-date-grid" onClick={() => setDateOpen((value) => !value)}>
                <strong>{formatKoDate(row.date, { today }) || '마감일 없음'}{homeworkOverdue(row.date, today) ? ' · 지남' : ''}</strong>
                <span className="muted">{dateOpen ? '접기' : '마감일 바꾸기'}</span>
            </Btn>
            {dateOpen ? (
                <div id="hw-date-grid" className="hw-date">
                    <DateGrid value={row.date} today={today} onPick={pickDate} />
                </div>
            ) : null}
            <div className="hw-status">
                <p className="hw-count" aria-live="polite" data-role="hw-count">{homeworkProgressLabel(progress)}</p>
                <div className="hw-tools">
                    <Btn className="chip" data-role="hw-all" disabled={!ordered.length || progress.submitted === progress.total} onClick={all}>모두 제출</Btn>
                    <Btn className={onlyMissing ? 'chip on' : 'chip'} data-role="hw-missing" aria-pressed={onlyMissing ? 'true' : 'false'} onClick={() => setOnlyMissing((value) => !value)}>미제출만</Btn>
                </div>
            </div>
            {!ordered.length && <p className="muted">명단이 없으면 제출을 표시할 수 없어요. 설정에서 이름을 적어 주세요.</p>}
            <div className="hw-students" role="list" aria-label="제출 명단">
                {shown.map((student) => {
                    const done = Boolean(pack.checks[student.id]?.on);
                    return (
                        <TapBtn
                            key={student.id}
                            className={done ? 'chip on hw-student' : 'chip hw-student'}
                            data-hw-student={student.id}
                            aria-pressed={done ? 'true' : 'false'}
                            aria-label={`${student.no ? `${student.no}번 ` : ''}${student.name}${student.past ? ' 지난 명단' : ''}, ${done ? '제출, 누르면 미제출로 바꿔요' : '미제출, 누르면 제출로 바꿔요'}`}
                            onTap={() => toggle(student)}
                        >
                            <span className="hw-mark" aria-hidden="true">{done ? '✓' : ''}</span>
                            <span className="hw-student-name">{student.no ? <span className="num">{student.no}</span> : null} {student.name}{student.past ? ' (지난 명단)' : ''}</span>
                            <span className="hw-student-state">{done ? '제출' : '미제출'}</span>
                        </TapBtn>
                    );
                })}
            </div>
            {onlyMissing && ordered.length > 0 && !shown.length && <p className="muted">미제출한 친구가 없어요.</p>}
        </div>
    );
}
