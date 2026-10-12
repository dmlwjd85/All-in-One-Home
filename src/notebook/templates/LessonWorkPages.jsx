import { GoBtn, Ink, LinedBlock, Tick, TitleBar } from '../fields.jsx';
import { bodyLinks, destForStudentNumber } from '../nav.js';
import { TocCards } from './ClassStudentPages.jsx';

export { TocCards };

export function ProgressPage({ extra, fields, setField }) {
    return (
        <div>
            <TitleBar title={`진도표 ${extra.slot || ''}`} hint="단원과 차시를 적어 가요" />
            <table className="nb-table compact">
                <thead><tr><th>월일</th><th>교과</th><th>단원 · 차시</th><th>비고</th></tr></thead>
                <tbody>
                    {Array.from({ length: 14 }, (_, i) => (
                        <tr key={i}>
                            {['d', 'sub', 'u', 'n'].map((k) => (
                                <td key={k}><Ink value={fields[`${k}${i}`]} onChange={(v) => setField(`${k}${i}`, v)} /></td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function EvalAreaPage({ fields, setField }) {
    return (
        <div>
            <TitleBar title="평가 영역" />
            <table className="nb-table">
                <thead><tr><th>영역</th><th>기준</th><th>메모</th></tr></thead>
                <tbody>
                    {Array.from({ length: 10 }, (_, i) => (
                        <tr key={i}>
                            {['a', 'c', 'm'].map((k) => (
                                <td key={k}><Ink value={fields[`${k}${i}`]} onChange={(v) => setField(`${k}${i}`, v)} /></td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function UnitPage({ extra, pageRec, fields, setField, onGo }) {
    const nums = bodyLinks(pageRec);
    return (
        <div>
            <TitleBar title={`단원 ${extra.slot || ''}`} />
            <div className="nb-inline">
                <Ink value={fields.subject} onChange={(v) => setField('subject', v)} placeholder="교과" />
                <Ink value={fields.unit} onChange={(v) => setField('unit', v)} placeholder="단원" />
            </div>
            {nums.length > 0 && (
                <div className="nb-numticks">
                    {nums.map((l, i) => (
                        <GoBtn key={`${l.to}-${i}`} to={l.to} onGo={onGo} className="num" hit={`body:${l.label || i + 1}`}>
                            {l.label || i + 1}
                        </GoBtn>
                    ))}
                </div>
            )}
            <Ink multiline rows={8} value={fields.plan} onChange={(v) => setField('plan', v)} placeholder="목표 · 활동 · 평가" />
        </div>
    );
}

export function ChecklistPage({ extra, fields, setField }) {
    return (
        <div>
            <TitleBar title={`체크리스트 ${extra.slot || ''}`} hint="한 쪽에 4개 · 학생 번호에 체크" />
            <div className="nb-check4">
                {[0, 1, 2, 3].map((b) => (
                    <section key={b} className="nb-panel">
                        <Ink value={fields[`title${b}`]} onChange={(v) => setField(`title${b}`, v)} placeholder="항목" />
                        <div className="nb-numticks">
                            {Array.from({ length: 32 }, (_, i) => (
                                <Tick key={i} checked={fields[`b${b}_${i}`]} onChange={(v) => setField(`b${b}_${i}`, v)} label={String(i + 1)} />
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}

export function ScorePage({ page, pageRec, fields, setField, onGo }) {
    const start = page % 2 === 0 ? 17 : 1;
    const links = bodyLinks(pageRec);
    return (
        <div>
            <TitleBar title={`점수 체크 · ${start}~${start + 15}번`} />
            <Ink value={fields.title} onChange={(v) => setField('title', v)} placeholder="평가명" />
            <table className="nb-table compact">
                <thead><tr><th>번호</th><th>점수</th><th>번호</th><th>점수</th></tr></thead>
                <tbody>
                    {Array.from({ length: 8 }, (_, i) => {
                        const a = start + i;
                        const b = start + i + 8;
                        return (
                            <tr key={i}>
                                <th><GoBtn to={destForStudentNumber(links, a)} onGo={onGo} className="num" hit={`body:${a}`}>{a}</GoBtn></th>
                                <td><Ink value={fields[`s${a}`]} onChange={(v) => setField(`s${a}`, v)} /></td>
                                <th><GoBtn to={destForStudentNumber(links, b)} onGo={onGo} className="num" hit={`body:${b}`}>{b}</GoBtn></th>
                                <td><Ink value={fields[`s${b}`]} onChange={(v) => setField(`s${b}`, v)} /></td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

export function DeadlinePage({ extra, fields, setField }) {
    return (
        <div>
            <TitleBar title={`기한 있는 일 ${extra.slot || ''}`} hint="주간 할 일과 따로, 기한 있는 일만" />
            <table className="nb-table compact">
                <thead><tr><th>기한</th><th>내용</th><th>완료</th></tr></thead>
                <tbody>
                    {Array.from({ length: 12 }, (_, i) => (
                        <tr key={i}>
                            <td><Ink type="date" value={fields[`d${i}`]} onChange={(v) => setField(`d${i}`, v)} /></td>
                            <td><Ink value={fields[`t${i}`]} onChange={(v) => setField(`t${i}`, v)} /></td>
                            <td><Tick checked={fields[`c${i}`]} onChange={(v) => setField(`c${i}`, v)} /></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function TodoSheetPage({ extra, fields, setField }) {
    return (
        <div>
            <TitleBar title={`업무 할 일 ${extra.slot || ''}`} />
            {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="nb-inline">
                    <Tick checked={fields[`c${i}`]} onChange={(v) => setField(`c${i}`, v)} />
                    <Ink value={fields[`t${i}`]} onChange={(v) => setField(`t${i}`, v)} placeholder="할 일" />
                </div>
            ))}
        </div>
    );
}

export function MeetingPage({ extra, pageRec, fields, setField, onGo }) {
    const toc = bodyLinks(pageRec);
    if (toc.length > 0) {
        return (
            <div>
                <TitleBar title="회의록 목차" hint="번호를 누르면 그 회의 쪽이에요" />
                <div className="nb-cellgrid" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
                    {toc.map((l, i) => (
                        <GoBtn key={`${l.to}-${i}`} to={l.to} onGo={onGo} className="chip">
                            {l.label || `${i + 1}`}
                        </GoBtn>
                    ))}
                </div>
            </div>
        );
    }
    return (
        <div>
            <TitleBar title={`회의록 ${extra.slot || ''}`} />
            <div className="nb-inline">
                <span>No.</span>
                <Ink value={fields.no} onChange={(v) => setField('no', v)} placeholder="번호" />
                <Ink type="date" value={fields.date} onChange={(v) => setField('date', v)} />
                <Ink value={fields.place} onChange={(v) => setField('place', v)} placeholder="장소" />
            </div>
            <Ink value={fields.topic} onChange={(v) => setField('topic', v)} placeholder="안건" />
            <Ink multiline rows={8} value={fields.body} onChange={(v) => setField('body', v)} placeholder="결정 · 할 일" />
        </div>
    );
}

export function NoticePage({ fields, setField }) {
    return (
        <div>
            <TitleBar title="전달 사항" hint="전달 사항만 빠르게" />
            <LinedBlock n={14} get={(k) => fields[k]} set={setField} prefix="n" placeholder="전달" />
        </div>
    );
}

export function BudgetItemPage({ extra, fields, setField }) {
    return (
        <div>
            <TitleBar title={`사업 ${extra.slot || ''}`} />
            <Ink value={fields.name} onChange={(v) => setField('name', v)} placeholder="사업명" />
            <div className="nb-inline">
                <Ink value={fields.budget} onChange={(v) => setField('budget', v)} placeholder="예산" />
                <Ink value={fields.used} onChange={(v) => setField('used', v)} placeholder="집행" />
            </div>
            <Ink multiline rows={8} value={fields.note} onChange={(v) => setField('note', v)} placeholder="품의 · 집행 메모" />
        </div>
    );
}

export function BudgetMiscPage({ page, fields, setField }) {
    const titles = {
        484: '법으로 정한 날짜만 인쇄했어요',
        485: '종류',
        486: '품의 체크리스트',
        487: '연말 집행 점검',
        488: '올해 실제로 쓸 수 있는 금액',
        489: '학급운영비 1',
        490: '학급운영비 2',
        491: '업체 · 견적 메모',
        492: '기관',
        493: '연락처',
    };
    return (
        <div>
            <TitleBar title={titles[page] || '예산'} />
            {page === 486 ? (
                ['품의서', '견적', '비교', '검수', '영수증', '정산'].map((it) => (
                    <Tick key={it} checked={fields[it]} onChange={(v) => setField(it, v)} label={it} />
                ))
            ) : (
                <LinedBlock n={12} get={(k) => fields[k]} set={setField} prefix="b" placeholder="내용" />
            )}
        </div>
    );
}
