import { useMemo } from 'react';
import { downloadText } from '../../lib/utils.js';
import { ATTEND_STATUS } from '../../lib/utils.js';
import { GoBtn, Ink, LinedBlock, Pick, Tick, TitleBar } from '../fields.jsx';
import { TocCards } from '../TocCards.jsx';
import { linkText } from '../labels.js';
import { numberedLinks, partitionLinks } from '../linkParts.js';
import { linkRosterValue, readPageFields, useRosterNames } from '../fieldStore.js';
import { buildStudentExport, printStudentExport } from '../studentExport.js';
import { quietStudents, whoPage } from '../ssugeokModel.js';

export function TimetablePage({ extra, fields, setField, page }) {
    const days = ['월', '화', '수', '목', '금'];
    return (
        <div>
            <TitleBar title={page === 141 ? '1학기 시간표' : page === 142 ? '1학기 전담 · 특별실 시간표' : page === 143 ? '2학기 시간표' : '2학기 전담 · 특별실 시간표'} />
            <table className="nb-table nb-table-text">
                <thead>
                    <tr>
                        <th>교시</th>
                        {days.map((d) => <th key={d}>{d}</th>)}
                    </tr>
                </thead>
                <tbody>
                    {[1, 2, 3, 4, 5, 6].map((p) => (
                        <tr key={p}>
                            <th>{p}</th>
                            {days.map((d, i) => (
                                <td key={d}>
                                    <Ink value={fields[`t${p}_${i}`]} onChange={(v) => setField(`t${p}_${i}`, v)} aria={`${d} ${p}교시`} />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function LinedForm({ title, hint, n = 12, fields, setField, prefix = 'ln' }) {
    return (
        <div>
            <TitleBar title={title} hint={hint} />
            <LinedBlock n={n} get={(k) => fields[k]} set={setField} prefix={prefix} placeholder="내용" />
        </div>
    );
}

export function RolesPage({ page, fields, setField }) {
    return (
        <div>
            <TitleBar title={page === 146 ? '1인 1역 1' : '1인 1역 2'} hint="역할과 번호를 적어 두세요" />
            <table className="nb-table nb-table-text">
                <thead><tr><th>역할</th><th>번호</th><th>이름</th><th>메모</th></tr></thead>
                <tbody>
                    {Array.from({ length: 12 }, (_, i) => (
                        <tr key={i}>
                            {['role', 'no', 'name', 'memo'].map((k) => (
                                <td key={k}><Ink value={fields[`${k}${i}`]} onChange={(v) => setField(`${k}${i}`, v)} aria={`${k} ${i + 1}`} /></td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function SeatingPage({ page, fields, setField }) {
    return (
        <div>
            <TitleBar title={`자리 배치 ${page - 147}`} hint="칠판이 위쪽이에요. 칸에 번호를 적어요" />
            <p className="nb-boardbar">칠판</p>
            <div className="nb-seats">
                {Array.from({ length: 36 }, (_, i) => (
                    <Ink key={i} value={fields[`s${i}`]} onChange={(v) => setField(`s${i}`, v)} placeholder={`${i + 1}`} aria={`자리 ${i + 1}`} />
                ))}
            </div>
        </div>
    );
}

function quietNumbers(notes) {
    const pageNotesByStudent = {};
    for (let n = 1; n <= 32; n += 1) {
        const pageFields = readPageFields(whoPage(n));
        const list = [];
        for (let i = 0; i < 12; i += 1) {
            if (pageFields[`d${i}`]) list.push({ date: pageFields[`d${i}`], sortedAt: pageFields[`d${i}`] });
        }
        for (const item of pageFields.ssugeokNotes || []) {
            if (!item?.sensitive) list.push(item);
        }
        if (list.length) pageNotesByStudent[n] = list;
    }
    return quietStudents(notes, pageNotesByStudent);
}

function StudentExportButton({ n, rosterName, onToast }) {
    return (
        <div className="nb-export-row">
        <button
            type="button"
            className="nb-export-student"
            data-action="export-student"
            onClick={() => {
                const payload = buildStudentExport(n, rosterName);
                downloadText(`학생-${n}-누가기록-상담.json`, JSON.stringify(payload, null, 2));
                onToast?.(`${n}번 누가기록·상담 파일을 내려받았습니다.`);
            }}
        >
            이 학생 누가기록·상담 내보내기
        </button>
        <button
            type="button"
            className="nb-export-student nb-export-print"
            data-action="print-student"
            onClick={() => {
                const payload = buildStudentExport(n, rosterName);
                const opened = printStudentExport(payload);
                if (!opened) onToast?.('인쇄 창이 막혀 있습니다. 브라우저에서 팝업을 허용해 주세요.');
            }}
        >
            이 학생 기록 인쇄
        </button>
        </div>
    );
}

export function RosterPage({ fields, setField, onGo, ssugeokNotes, signedIn }) {
    const quiet = useMemo(() => quietNumbers(ssugeokNotes || []), [ssugeokNotes]);
    const shown = quiet.slice(0, 16);
    const named = Array.from({ length: 32 }, (_, i) => fields[`name${i + 1}`]).filter(Boolean).length;
    const setRoster = (n, key, value) => {
        const previous = fields[`${key}${n}`] || '';
        setField(`${key}${n}`, value);
        linkRosterValue(n, key, value, previous, signedIn);
    };
    const jumpTo = (n) => {
        const row = document.getElementById(`roster-${n}`);
        row?.scrollIntoView({ block: 'center', inline: 'nearest' });
        row?.querySelector('input')?.focus({ preventScroll: true });
    };
    return (
        <div className="nb-roster-page">
            <TitleBar title="명렬표" hint="번호를 누르면 학생 카드, '누가'를 누르면 누가기록이에요" />
            <div className="nb-roster-jump" role="navigation" aria-label="번호로 이동">
                {Array.from({ length: 32 }, (_, i) => (
                    <button key={i + 1} type="button" onClick={() => jumpTo(i + 1)} aria-label={`${i + 1}번 줄로 이동`}>
                        {i + 1}
                    </button>
                ))}
            </div>
            <p className="nb-roster-link">이름 {named}/32 · 적는 즉시 학생 카드와 출결 번호 옆에 이어집니다. 새 학기 준비는 3쪽입니다.</p>
            {shown.length > 0 && (
                <div className="nb-quiet">
                    <span>최근 3주 누가기록이 없어요</span>
                    {shown.map((n) => (
                        <button key={n} type="button" onClick={() => onGo(whoPage(n))}>{n}</button>
                    ))}
                    {quiet.length > shown.length && <span>외 {quiet.length - shown.length}명</span>}
                </div>
            )}
            <div className="nb-roster">
                {[0, 16].map((off) => (
                    <table key={off} className="nb-table nb-table-text compact">
                        <thead><tr><th>번호</th><th>이름</th><th>성별</th><th>생년월일</th><th>비고</th><th>누가</th></tr></thead>
                        <tbody>
                            {Array.from({ length: 16 }, (_, i) => {
                                const n = off + i + 1;
                                return (
                                    <tr key={n} id={`roster-${n}`}>
                                        <th><GoBtn to={157 + n * 2} onGo={onGo} className="num" aria={`${n}번 학생 카드`}>{n}</GoBtn></th>
                                        <td><Ink value={fields[`name${n}`]} onChange={(v) => setRoster(n, 'name', v)} aria={`${n}번 이름`} /></td>
                                        <td><Ink value={fields[`sex${n}`]} onChange={(v) => setRoster(n, 'sex', v)} aria={`${n}번 성별`} /></td>
                                        <td><Ink value={fields[`birth${n}`]} onChange={(v) => setRoster(n, 'birth', v)} aria={`${n}번 생년월일`} /></td>
                                        <td><Ink value={fields[`note${n}`]} onChange={(v) => setField(`note${n}`, v)} aria={`${n}번 비고`} /></td>
                                        <td><GoBtn to={158 + n * 2} onGo={onGo} className="who" aria={`${n}번 누가기록`}>누가</GoBtn></td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                ))}
            </div>
        </div>
    );
}

export function SurveyPage({ page, pageRec, fields, setField, onGo }) {
    const start = page === 155 ? 1 : 17;
    const byNum = new Map(numberedLinks(partitionLinks(pageRec).body).map((l) => [Number(l.label), l.to]));
    return (
        <div>
            <TitleBar title={page === 155 ? '기초조사 1 · 1~16번' : '기초조사 2 · 17~32번'} />
            <table className="nb-table nb-table-text compact">
                <thead><tr><th>번호</th><th>보호자</th><th>연락처</th><th>주소 · 메모</th></tr></thead>
                <tbody>
                    {Array.from({ length: 16 }, (_, i) => {
                        const n = start + i;
                        return (
                            <tr key={n}>
                                <th><NumLink n={n} to={byNum.get(n)} onGo={onGo} /></th>
                                <td><Ink value={fields[`g${n}`]} onChange={(v) => setField(`g${n}`, v)} aria={`${n}번 보호자`} /></td>
                                <td><Ink value={fields[`p${n}`]} onChange={(v) => setField(`p${n}`, v)} aria={`${n}번 연락처`} /></td>
                                <td><Ink value={fields[`a${n}`]} onChange={(v) => setField(`a${n}`, v)} aria={`${n}번 주소`} /></td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export function HealthPage({ page, pageRec, fields, setField, onGo }) {
    const start = page === 157 ? 1 : 17;
    const byNum = new Map(numberedLinks(partitionLinks(pageRec).body).map((l) => [Number(l.label), l.to]));
    return (
        <div>
            <TitleBar title={page === 157 ? '건강 · 특이사항 1 · 1~16번' : '건강 · 특이사항 2 · 17~32번'} />
            <table className="nb-table nb-table-text compact">
                <thead><tr><th>번호</th><th>알레르기 · 복약</th><th>분리 급식</th><th>메모</th></tr></thead>
                <tbody>
                    {Array.from({ length: 16 }, (_, i) => {
                        const n = start + i;
                        return (
                            <tr key={n}>
                                <th><NumLink n={n} to={byNum.get(n)} onGo={onGo} /></th>
                                <td><Ink value={fields[`h${n}`]} onChange={(v) => setField(`h${n}`, v)} aria={`${n}번 알레르기`} /></td>
                                <td><Tick checked={fields[`m${n}`]} onChange={(v) => setField(`m${n}`, v)} label={`${n}번 분리 급식`} /></td>
                                <td><Ink value={fields[`n${n}`]} onChange={(v) => setField(`n${n}`, v)} aria={`${n}번 건강 메모`} /></td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function NumLink({ n, to, onGo }) {
    if (!to) return n;
    return <GoBtn to={to} onGo={onGo} className="num" aria={`${n}번`}>{n}</GoBtn>;
}

export function StudentCardPage({ page, pageRec, pages, extra, fields, setField, onGo, onToast }) {
    const n = extra.student || 1;
    const rosterNames = useRosterNames();
    const rosterName = rosterNames[n] || '';
    const shownName = fields.name || rosterName;
    return (
        <div>
            <TitleBar title={`학생 카드 · ${n}번${shownName ? ` ${shownName}` : ''}`} hint={rosterName ? '이름은 명렬표에서 이어집니다.' : '이름은 명렬표 154쪽에 적어도 됩니다.'} />
            <StudentExportButton n={n} rosterName={rosterName || fields.name || ''} onToast={onToast} />
            <div className="nb-scard">
                <div className="nb-scard-top">
                    <div className="nb-photo">사진</div>
                    <div className="nb-scard-meta">
                        {[['이름', 'name'], ['생년월일', 'birth'], ['성별', 'sex'], ['보호자 (관계)', 'guard'], ['연락처 (주)', 'tel1'], ['연락처 (보조)', 'tel2'], ['형제자매', 'sib'], ['하교 방법', 'home']].map(([lab, k]) => (
                            <label key={k}>{lab}<Ink value={fields[k]} onChange={(v) => setField(k, v)} /></label>
                        ))}
                    </div>
                </div>
                <label>건강 · 알레르기<Ink multiline rows={2} value={fields.health} onChange={(v) => setField('health', v)} /></label>
                <label>성격 · 교우관계<Ink multiline rows={2} value={fields.peer} onChange={(v) => setField('peer', v)} /></label>
                <label>학습 특성 · 기초학력<Ink multiline rows={2} value={fields.learn} onChange={(v) => setField('learn', v)} /></label>
                <label>좋아하는 것 · 잘하는 것<Ink multiline rows={2} value={fields.like} onChange={(v) => setField('like', v)} /></label>
                <label>지도 계획 · 칭찬할 점<Ink multiline rows={2} value={fields.plan} onChange={(v) => setField('plan', v)} /></label>
                <p className="nb-kicker">바로가기</p>
                <div className="nb-tagrow">
                    {partitionLinks(pageRec).body.map((l, i) => (
                        <GoBtn key={`${l.to}-${i}`} to={l.to} onGo={onGo}>{linkText(l, pages, page)}</GoBtn>
                    ))}
                </div>
            </div>
        </div>
    );
}

export function WhoRecordPage({ extra, fields, setField, onToast }) {
    const n = extra.student || 1;
    const rosterNames = useRosterNames();
    return (
        <div>
            <TitleBar title={`${n}번 누가기록${rosterNames[n] ? ` · ${rosterNames[n]}` : ''}`} hint="짧게 적고, 생기부나 누가기록에 옮기면 체크해요" />
            <StudentExportButton n={n} rosterName={rosterNames[n] || ''} onToast={onToast} />
            <table className="nb-table nb-table-text compact">
                <thead><tr><th>날짜</th><th>영역</th><th>내용</th><th>NEIS</th></tr></thead>
                <tbody>
                    {Array.from({ length: 12 }, (_, i) => (
                        <tr key={i}>
                            <td><Ink type="date" value={fields[`d${i}`]} onChange={(v) => setField(`d${i}`, v)} aria={`${i + 1}행 날짜`} /></td>
                            <td><Pick value={fields[`a${i}`]} onChange={(v) => setField(`a${i}`, v)} options={['행', '교', '창']} aria={`${i + 1}행 영역`} /></td>
                            <td><Ink value={fields[`t${i}`]} onChange={(v) => setField(`t${i}`, v)} aria={`${i + 1}행 내용`} /></td>
                            <td><Tick checked={fields[`n${i}`]} onChange={(v) => setField(`n${i}`, v)} label={`${i + 1}행 NEIS`} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function QuickNotePage({ fields, setField }) {
    return (
        <div>
            <TitleBar title="짧은 기록" hint="짧게 적고, 생기부나 누가기록에 옮기면 체크해요" />
            <table className="nb-table nb-table-text compact">
                <thead><tr><th>날짜</th><th>번호</th><th>내용</th><th>옮김</th></tr></thead>
                <tbody>
                    {Array.from({ length: 14 }, (_, i) => (
                        <tr key={i}>
                            <td><Ink type="date" value={fields[`d${i}`]} onChange={(v) => setField(`d${i}`, v)} /></td>
                            <td><Ink value={fields[`no${i}`]} onChange={(v) => setField(`no${i}`, v)} /></td>
                            <td><Ink value={fields[`t${i}`]} onChange={(v) => setField(`t${i}`, v)} /></td>
                            <td><Tick checked={fields[`m${i}`]} onChange={(v) => setField(`m${i}`, v)} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function AttendPage({ pageRec, extra, fields, setField, onGo }) {
    const start = extra.half === '17-32' ? 17 : 1;
    const rosterNames = useRosterNames();
    const byNum = new Map(numberedLinks(partitionLinks(pageRec).body).map((l) => [Number(l.label), l.to]));
    return (
        <div>
            <TitleBar title="출석부" hint={`월말 출석부 대조 확인 · ${extra.half || '1-16'} · 이름은 명렬표에서 옵니다`} />
            <div className="nb-attend-head">
                <label>월 <Ink value={fields.month} onChange={(v) => setField('month', v)} placeholder="월" /></label>
                <Tick checked={fields.checked} onChange={(v) => setField('checked', v)} label="월말 출석부 대조 확인" />
            </div>
            <table className="nb-table nb-table-text compact">
                <thead>
                    <tr>
                        <th>번호</th>
                        {Array.from({ length: 10 }, (_, i) => <th key={i}>{i + 1}주</th>)}
                    </tr>
                </thead>
                <tbody>
                    {Array.from({ length: 16 }, (_, i) => {
                        const n = start + i;
                        return (
                            <tr key={n}>
                                <th>
                                    <NumLink n={n} to={byNum.get(n)} onGo={onGo} />
                                    {rosterNames[n] ? <span className="nb-roster-name">{rosterNames[n]}</span> : null}
                                </th>
                                {Array.from({ length: 10 }, (_, w) => (
                                    <td key={w}>
                                        <Pick value={fields[`s${n}_${w}`]} onChange={(v) => setField(`s${n}_${w}`, v)} options={ATTEND_STATUS} aria={`${n}번 ${w + 1}주`} />
                                    </td>
                                ))}
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export function CounselPage({ extra, fields, setField, kind, onToast }) {
    const n = extra.student || 1;
    const rosterNames = useRosterNames();
    const title = kind === 'parent' ? `보호자 상담 · ${n}번` : `상담 · ${n}번`;
    const hint = kind === 'parent' ? '보호자 말씀은 들은 그대로 적어 둬요' : '그날 바로, 짧게 적어도 충분해요';
    return (
        <div>
            <TitleBar title={`${title}${rosterNames[n] ? ` · ${rosterNames[n]}` : ''}`} hint={hint} />
            <StudentExportButton n={n} rosterName={rosterNames[n] || ''} onToast={onToast} />
            {Array.from({ length: 4 }, (_, i) => (
                <section key={i} className="nb-panel">
                    <div className="nb-inline">
                        <Ink type="date" value={fields[`d${i}`]} onChange={(v) => setField(`d${i}`, v)} aria="날짜" />
                        <Ink value={fields[`who${i}`]} onChange={(v) => setField(`who${i}`, v)} placeholder={kind === 'parent' ? '보호자' : '대상'} />
                    </div>
                    <Ink multiline rows={3} value={fields[`t${i}`]} onChange={(v) => setField(`t${i}`, v)} placeholder="내용" />
                </section>
            ))}
        </div>
    );
}

export function ConsultTimePage({ fields, setField }) {
    return (
        <div>
            <TitleBar title="상담 시간" hint="신청 받은 시간을 칸에 적어요" />
            <table className="nb-table nb-table-text">
                <thead><tr><th></th>{['월', '화', '수', '목', '금'].map((d) => <th key={d}>{d}</th>)}</tr></thead>
                <tbody>
                    {['1교시 전', '점심', '방과후', '저녁'].map((slot, r) => (
                        <tr key={slot}>
                            <th>{slot}</th>
                            {[0, 1, 2, 3, 4].map((c) => (
                                <td key={c}><Ink value={fields[`c${r}${c}`]} onChange={(v) => setField(`c${r}${c}`, v)} /></td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function ClassGroup(props) {
    const type = props.pageRec.type;
    switch (type) {
        case 'class-toc': return <TocCards title="학급 목차" hint="시간표 · 전담·특별실 · 자리 · 1인 1역 · 학급 약속" {...props} />;
        case 'timetable': return <TimetablePage {...props} />;
        case 'class-rules': return <LinedForm title="우리 반 약속" n={14} {...props} />;
        case 'roles': return <RolesPage {...props} />;
        case 'seating': return <SeatingPage {...props} />;
        case 'roster': return <RosterPage {...props} />;
        case 'survey': return <SurveyPage {...props} />;
        case 'health': return <HealthPage {...props} />;
        case 'student-card': return <StudentCardPage {...props} />;
        case 'student-who': return <WhoRecordPage {...props} />;
        case 'quick-note': return <QuickNotePage {...props} />;
        case 'attend-toc': return <TocCards title="출결 목차" hint="달마다 1~16번, 17~32번 두 쪽이에요" {...props} />;
        case 'attend': return <AttendPage {...props} />;
        case 'counsel-toc': return <TocCards title="상담 목차" hint="번호를 누르면 그 학생 쪽이에요" {...props} />;
        case 'counsel': return <CounselPage kind="counsel" {...props} />;
        case 'parent': return <CounselPage kind="parent" {...props} />;
        case 'consult-time': return <ConsultTimePage {...props} />;
        case 'incident': return <IncidentPage {...props} />;
        case 'year-prep': return <LinedForm title="2027학년도 준비 · 인수인계" n={14} {...props} />;
        default: return null;
    }
}

export function IncidentPage({ fields, setField }) {
    return (
        <div>
            <TitleBar title="생활 · 사고 기록" hint="본 사실과 한 조치만 적어요" />
            {Array.from({ length: 3 }, (_, i) => (
                <section key={i} className="nb-panel">
                    <div className="nb-inline">
                        <Ink type="date" value={fields[`d${i}`]} onChange={(v) => setField(`d${i}`, v)} />
                        <Ink value={fields[`no${i}`]} onChange={(v) => setField(`no${i}`, v)} placeholder="번호" />
                    </div>
                    <Ink multiline rows={3} value={fields[`t${i}`]} onChange={(v) => setField(`t${i}`, v)} placeholder="사실 · 조치" />
                </section>
            ))}
        </div>
    );
}
