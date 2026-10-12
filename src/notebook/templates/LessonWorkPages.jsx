import { useEffect, useState } from 'react';
import DdayBoard, { UpcomingStrip } from '../DdayBoard.jsx';
import SubmissionBoard from '../SubmissionBoard.jsx';
import { sumBudget } from '../budget.js';
import { GoBtn, Ink, LinedBlock, LinkGrid, Tick, TitleBar } from '../fields.jsx';
import { numberedLinks, partitionLinks } from '../linkParts.js';
import { formatWon, parseAmount } from '../../lib/utils.js';
import { TocCards } from '../TocCards.jsx';

export function ProgressPage({ extra, fields, setField }) {
    return (
        <div>
            <TitleBar title={`진도표 ${extra.slot || ''}`} hint="단원과 차시를 적어 가요" />
            <table className="nb-table nb-table-text compact">
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
            <table className="nb-table nb-table-text">
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

export function UnitPage({ pageRec, extra, fields, setField, onGo }) {
    const nums = numberedLinks(partitionLinks(pageRec).body);
    return (
        <div>
            <TitleBar title={`단원 ${extra.slot || ''}`} hint="번호를 누르면 그 학생 누가기록으로 가요" />
            <div className="nb-inline">
                <Ink value={fields.subject} onChange={(v) => setField('subject', v)} placeholder="교과" />
                <Ink value={fields.unit} onChange={(v) => setField('unit', v)} placeholder="단원" />
            </div>
            {nums.length > 0 && (
                <div className="nb-numticks">
                    {nums.map((l) => (
                        <GoBtn key={l.label} to={l.to} onGo={onGo} className="num" aria={`${l.label}번 누가기록`}>{l.label}</GoBtn>
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

export function ScorePage({ pageRec, fields, setField, onGo }) {
    const items = numberedLinks(partitionLinks(pageRec).body);
    const mid = Math.ceil(items.length / 2) || 8;
    const left = items.slice(0, mid);
    const right = items.slice(mid);
    const first = left[0]?.label || '1';
    const last = (right[right.length - 1] || left[left.length - 1])?.label || '16';
    return (
        <div>
            <TitleBar title={`점수 체크 · ${first}~${last}번`} hint="번호를 누르면 학생 카드로 가요" />
            <Ink value={fields.title} onChange={(v) => setField('title', v)} placeholder="평가명" />
            <table className="nb-table nb-table-text compact">
                <thead><tr><th>번호</th><th>점수</th><th>번호</th><th>점수</th></tr></thead>
                <tbody>
                    {left.map((a, i) => {
                        const b = right[i];
                        return (
                            <tr key={a.label}>
                                <th><GoBtn to={a.to} onGo={onGo} className="num" aria={`${a.label}번 학생 카드`}>{a.label}</GoBtn></th>
                                <td><Ink value={fields[`s${a.label}`]} onChange={(v) => setField(`s${a.label}`, v)} /></td>
                                <th>{b ? <GoBtn to={b.to} onGo={onGo} className="num" aria={`${b.label}번 학생 카드`}>{b.label}</GoBtn> : null}</th>
                                <td>{b ? <Ink value={fields[`s${b.label}`]} onChange={(v) => setField(`s${b.label}`, v)} /> : null}</td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function DeadlineLines({ fields, setField }) {
    return (
            <table className="nb-table nb-table-text compact">
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
    );
}

export function DeadlinePage({ extra, fields, setField, ddayCards, signedIn, onChanged, onToast, onGo }) {
    const hasLines = Array.from({ length: 12 }, (_, i) => fields[`d${i}`] || fields[`t${i}`]).some(Boolean);
    if (Number(extra.slot) === 1) {
        return (
            <div className="nb-fill">
                <TitleBar title="기한 있는 일" hint="공문번호와 기한을 올리면 D-3, D-day가 붙고 달력에도 보여요" />
                <DdayBoard cards={ddayCards} signedIn={signedIn} onChanged={onChanged} onToast={onToast} onGo={onGo} />
                {hasLines && (
                    <details className="nb-legacy">
                        <summary>줄로 적어 둔 기한</summary>
                        <DeadlineLines fields={fields} setField={setField} />
                    </details>
                )}
            </div>
        );
    }
    return (
        <div>
            <TitleBar title={`기한 있는 일 ${extra.slot || ''}`} hint="주간 할 일과 따로, 기한 있는 일만" />
            <UpcomingStrip cards={ddayCards} onGo={onGo} />
            <DeadlineLines fields={fields} setField={setField} />
        </div>
    );
}

export function TodoSheetPage({ extra, fields, setField, ddayCards, onGo }) {
    return (
        <div>
            <TitleBar title={`업무 할 일 ${extra.slot || ''}`} />
            <UpcomingStrip cards={ddayCards} onGo={onGo} />
            {Array.from({ length: 12 }, (_, i) => (
                <div key={i} className="nb-inline">
                    <Tick checked={fields[`c${i}`]} onChange={(v) => setField(`c${i}`, v)} />
                    <Ink value={fields[`t${i}`]} onChange={(v) => setField(`t${i}`, v)} placeholder="할 일" />
                </div>
            ))}
        </div>
    );
}

export function MeetingPage({ page, pageRec, pages, extra, fields, setField, onGo }) {
    const { body } = partitionLinks(pageRec);
    return (
        <div className="nb-fill">
            <TitleBar title={`회의록 ${extra.slot || ''}`} hint={body.length ? '번호를 누르면 그 회의록으로 가요' : undefined} />
            {body.length > 0 && (
                <LinkGrid links={body} pages={pages} pageNo={page} onGo={onGo} className="dense" />
            )}
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

export function NoticePage({ page, fields, setField, submissionSheets, signedIn, onChanged, onToast, onGo }) {
    const hasLines = Array.from({ length: 14 }, (_, i) => fields[`n${i}`]).some(Boolean);
    if (page !== 458) {
        return (
            <div>
                <TitleBar title="전달 사항" hint="전달 사항만 빠르게" />
                <GoBtn to={458} onGo={onGo} className="tone-mint">제출물 체크표</GoBtn>
                <LinedBlock n={14} get={(k) => fields[k]} set={setField} prefix="n" placeholder="전달" />
            </div>
        );
    }
    return (
        <div className="nb-fill">
            <TitleBar title="제출물 체크" hint="번호를 한 번 누르면 냄, 다시 누르면 아직이에요. 이름은 명렬표에서 옵니다" />
            <SubmissionBoard sheets={submissionSheets} signedIn={signedIn} onChanged={onChanged} onToast={onToast} />
            {hasLines && (
                <details className="nb-legacy">
                    <summary>적어 둔 전달</summary>
                    <LinedBlock n={14} get={(k) => fields[k]} set={setField} prefix="n" placeholder="전달" />
                </details>
            )}
        </div>
    );
}

export function BudgetOverview({ onGo }) {
    const [sum, setSum] = useState(() => sumBudget());
    useEffect(() => {
        const refresh = (event) => {
            const page = Number(event.detail?.page);
            if (page !== 0 && (page < 470 || page > 483)) return;
            setSum(sumBudget());
        };
        window.addEventListener('nb-page-fields', refresh);
        return () => window.removeEventListener('nb-page-fields', refresh);
    }, []);
    return (
        <section className="nb-budget" aria-label="예산 합계">
            <p className="nb-budget-total">예산 {formatWon(sum.budget)} · 집행 {formatWon(sum.used)} · 남음 {formatWon(sum.left)}</p>
            <table className="nb-table nb-table-text compact">
                <thead><tr><th>사업</th><th>예산</th><th>집행</th><th>남음</th></tr></thead>
                <tbody>
                    {sum.rows.map((row) => (
                        <tr key={row.page}>
                            <th><GoBtn to={row.page} onGo={onGo} className="text" aria={row.name}>{row.name}</GoBtn></th>
                            <td>{formatWon(row.budget)}</td>
                            <td>{formatWon(row.used)}</td>
                            <td>{formatWon(row.left)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </section>
    );
}

export function BudgetItemPage({ extra, fields, setField }) {
    const budget = parseAmount(fields.budget);
    const used = parseAmount(fields.used);
    return (
        <div>
            <TitleBar title={`사업 ${extra.slot || ''}`} hint={`이 사업 남음 ${formatWon(budget - used)} · 전체 합계는 468쪽`} />
            <Ink value={fields.name} onChange={(v) => setField('name', v)} placeholder="사업명" aria="사업명" />
            <div className="nb-inline">
                <Ink value={fields.budget} onChange={(v) => setField('budget', v)} placeholder="예산" aria="예산" />
                <Ink value={fields.used} onChange={(v) => setField('used', v)} placeholder="집행" aria="집행" />
            </div>
            <p className="nb-budget-left">남음 {formatWon(budget - used)}</p>
            <Ink multiline rows={8} value={fields.note} onChange={(v) => setField('note', v)} placeholder="품의 · 집행 메모" aria="품의 집행 메모" />
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

export function LessonGroup(props) {
    const type = props.pageRec.type;
    switch (type) {
        case 'lesson-toc': return <TocCards title="수업 목차" hint="진도표 · 단원 · 체크리스트 · 점수" {...props} />;
        case 'progress': return <ProgressPage {...props} />;
        case 'eval-area': return <EvalAreaPage {...props} />;
        case 'unit': return <UnitPage {...props} />;
        case 'checklist': return <ChecklistPage {...props} />;
        case 'score': return <ScorePage {...props} />;
        case 'work-toc': return (
            <TocCards
                title="업무 목차"
                hint="기한 보드, 제출물 체크, 칭찬 스티커"
                lead={(
                    <div className="nb-monthrow">
                        <GoBtn to={405} onGo={props.onGo} className="tone-lavender">기한 보드</GoBtn>
                        <GoBtn to={458} onGo={props.onGo} className="tone-mint">제출물 체크</GoBtn>
                        <GoBtn to={563} onGo={props.onGo} className="tone-butter">칭찬 스티커</GoBtn>
                    </div>
                )}
                {...props}
            />
        );
        case 'deadline': return <DeadlinePage {...props} />;
        case 'todo': return <TodoSheetPage {...props} />;
        case 'meeting': return <MeetingPage {...props} />;
        case 'notice': return <NoticePage {...props} />;
        case 'budget-toc': return (
            <TocCards
                title="예산"
                hint="사업명을 누르면 그 사업 쪽으로 가요. 합계는 470–483쪽 예산·집행을 더합니다."
                lead={<BudgetOverview onGo={props.onGo} />}
                scrollLinks
                {...props}
            />
        );
        case 'budget-item': return <BudgetItemPage {...props} />;
        case 'budget-misc': return <BudgetMiscPage {...props} />;
        default: return null;
    }
}
