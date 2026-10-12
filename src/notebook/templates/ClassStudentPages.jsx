import { ATTEND_STATUS } from '../../lib/utils.js';
import { CellGrid, GoBtn, Ink, LinedBlock, Pick, Tick, TitleBar } from '../fields.jsx';
import { destLabel } from '../labels.js';

export function TocCards({ title, hint, pageRec, pages, onGo }) {
    return (
        <div>
            <TitleBar title={title} hint={hint} />
            <CellGrid cols={4}>
                {(pageRec.links || []).map((l, i) => (
                    <GoBtn key={`${l.to}-${i}`} to={l.to} onGo={onGo} className="chip">
                        {l.label || destLabel(l.to, pages)}
                    </GoBtn>
                ))}
            </CellGrid>
        </div>
    );
}

export function TimetablePage({ extra, fields, setField, page }) {
    const days = ['월', '화', '수', '목', '금'];
    return (
        <div>
            <TitleBar title={page === 141 ? '1학기 시간표' : page === 142 ? '1학기 전담 · 특별실 시간표' : page === 143 ? '2학기 시간표' : '2학기 전담 · 특별실 시간표'} />
            <table className="nb-table">
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
            <table className="nb-table">
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

export function RosterPage({ fields, setField, onGo }) {
    return (
        <div>
            <TitleBar title="명렬표" hint="번호를 누르면 학생 카드, '누가'를 누르면 누가기록이에요" />
            <div className="nb-roster">
                {[0, 16].map((off) => (
                    <table key={off} className="nb-table compact">
                        <thead><tr><th>번호</th><th>이름</th><th>성별</th><th>생년월일</th><th>비고</th><th>누가</th></tr></thead>
                        <tbody>
                            {Array.from({ length: 16 }, (_, i) => {
                                const n = off + i + 1;
                                return (
                                    <tr key={n}>
                                        <th><GoBtn to={157 + n * 2} onGo={onGo} className="num" aria={`${n}번 학생 카드`}>{n}</GoBtn></th>
                                        <td><Ink value={fields[`name${n}`]} onChange={(v) => setField(`name${n}`, v)} aria={`${n}번 이름`} /></td>
                                        <td><Ink value={fields[`sex${n}`]} onChange={(v) => setField(`sex${n}`, v)} aria={`${n}번 성별`} /></td>
                                        <td><Ink value={fields[`birth${n}`]} onChange={(v) => setField(`birth${n}`, v)} aria={`${n}번 생년월일`} /></td>
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

export function SurveyPage({ page, fields, setField }) {
    const start = page === 155 ? 1 : 17;
    return (
        <div>
            <TitleBar title={page === 155 ? '기초조사 1 · 1~16번' : '기초조사 2 · 17~32번'} />
            <table className="nb-table compact">
                <thead><tr><th>번호</th><th>보호자</th><th>연락처</th><th>주소 · 메모</th></tr></thead>
                <tbody>
                    {Array.from({ length: 16 }, (_, i) => {
                        const n = start + i;
                        return (
                            <tr key={n}>
                                <th>{n}</th>
                                <td><Ink value={fields[`g${n}`]} onChange={(v) => setField(`g${n}`, v)} /></td>
                                <td><Ink value={fields[`p${n}`]} onChange={(v) => setField(`p${n}`, v)} /></td>
                                <td><Ink value={fields[`a${n}`]} onChange={(v) => setField(`a${n}`, v)} /></td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export function HealthPage({ page, fields, setField }) {
    const start = page === 157 ? 1 : 17;
    return (
        <div>
            <TitleBar title={page === 157 ? '건강 · 특이사항 1 · 1~16번' : '건강 · 특이사항 2 · 17~32번'} />
            <table className="nb-table compact">
                <thead><tr><th>번호</th><th>알레르기 · 복약</th><th>분리 급식</th><th>메모</th></tr></thead>
                <tbody>
                    {Array.from({ length: 16 }, (_, i) => {
                        const n = start + i;
                        return (
                            <tr key={n}>
                                <th>{n}</th>
                                <td><Ink value={fields[`h${n}`]} onChange={(v) => setField(`h${n}`, v)} /></td>
                                <td><Tick checked={fields[`m${n}`]} onChange={(v) => setField(`m${n}`, v)} /></td>
                                <td><Ink value={fields[`n${n}`]} onChange={(v) => setField(`n${n}`, v)} /></td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export function StudentCardPage({ extra, fields, setField }) {
    const n = extra.student || 1;
    return (
        <div>
            <TitleBar title={`학생 카드 · ${n}번`} />
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
            </div>
        </div>
    );
}

export function WhoRecordPage({ extra, fields, setField }) {
    const n = extra.student || 1;
    return (
        <div>
            <TitleBar title={`${n}번 누가기록`} hint="짧게 적고, 생기부나 누가기록에 옮기면 체크해요" />
            <table className="nb-table compact">
                <thead><tr><th>날짜</th><th>영역</th><th>내용</th><th>NEIS</th></tr></thead>
                <tbody>
                    {Array.from({ length: 12 }, (_, i) => (
                        <tr key={i}>
                            <td><Ink type="date" value={fields[`d${i}`]} onChange={(v) => setField(`d${i}`, v)} /></td>
                            <td><Pick value={fields[`a${i}`]} onChange={(v) => setField(`a${i}`, v)} options={['행', '교', '창']} aria="영역" /></td>
                            <td><Ink value={fields[`t${i}`]} onChange={(v) => setField(`t${i}`, v)} /></td>
                            <td><Tick checked={fields[`n${i}`]} onChange={(v) => setField(`n${i}`, v)} /></td>
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
            <table className="nb-table compact">
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

export function AttendPage({ extra, fields, setField }) {
    const start = extra.half === '17-32' ? 17 : 1;
    return (
        <div>
            <TitleBar title="출석부" hint={`월말 출석부 대조 확인 · ${extra.half || '1-16'}`} />
            <div className="nb-attend-head">
                <label>월 <Ink value={fields.month} onChange={(v) => setField('month', v)} placeholder="월" /></label>
                <Tick checked={fields.checked} onChange={(v) => setField('checked', v)} label="월말 출석부 대조 확인" />
            </div>
            <table className="nb-table compact">
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
                                <th>{n}</th>
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

export function CounselPage({ extra, fields, setField, kind }) {
    const n = extra.student || 1;
    const title = kind === 'parent' ? `보호자 상담 · ${n}번` : `상담 · ${n}번`;
    const hint = kind === 'parent' ? '보호자 말씀은 들은 그대로 적어 둬요' : '그날 바로, 짧게 적어도 충분해요';
    return (
        <div>
            <TitleBar title={title} hint={hint} />
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
            <table className="nb-table">
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
