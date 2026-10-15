import { holidayCaption } from '../../lib/holidays.js';
import { monthCells } from '../../lib/utils.js';
import { calendarMarks, daysUntil, ddayBadge, deadlinesInRange } from '../boardsModel.js';
import { allDeadlines } from '../DdayBoard.jsx';
import { GoBtn, Ink, LinedBlock, LinkGrid, Tick, TitleBar } from '../fields.jsx';
import { linkText } from '../labels.js';
import { monthDayMap, partitionLinks } from '../linkParts.js';
import { parseRange } from '../routes.js';

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const MONTHS_26 = [3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const ACADEMIC = [
    ['3월', '3.1 3·1절 · 3.2 대체공휴일(3·1절)'],
    ['4월', ''],
    ['5월', '5.1 노동절 · 5.5 어린이날 · 5.24 부처님 오신 날 · 5.25 대체'],
    ['6월', '6.3 제9회 전국동시지방선거 · 6.6 현충일'],
    ['7월', '7.17 제헌절'],
    ['8월', '8.15 광복절 · 8.17 대체공휴일(광복절)'],
    ['9월', '9.24 추석 연휴 · 9.25 추석 · 9.26 추석 연휴'],
    ['10월', '10.3 개천절 · 10.5 대체 · 10.9 한글날'],
    ['11월', ''],
    ['12월', '12.25 기독탄신일'],
    ['1월', '1.1 신정'],
    ['2월', '2.6 설 연휴 · 2.7 설날 · 2.8 설 연휴 · 2.9 대체'],
];

function MiniMonth({ year, month }) {
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const cells = monthCells(ym);
    return (
        <div className="nb-minimonth">
            <p className="nb-minimonth-title">{year === 2026 ? '' : '2027 '}{month}월</p>
            <div className="nb-minimonth-dow">{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}</div>
            <div className="nb-minimonth-grid">
                {cells.map((c) => {
                    const cap = c.inMonth ? holidayCaption(c.ymd) : null;
                    return (
                        <span key={c.ymd} className={`${c.inMonth ? '' : 'out'} ${cap?.isHoliday ? 'hol' : ''}`}>
                            {c.inMonth ? c.day : ''}
                        </span>
                    );
                })}
            </div>
        </div>
    );
}

export function YearCalPage({ pageRec, pages, onGo }) {
    const { body } = partitionLinks(pageRec);
    const toByMonth = new Map();
    for (const link of body) {
        const dest = pages?.[link.to - 1];
        if (dest?.type === 'month' && dest.extra?.month) {
            toByMonth.set(`${dest.extra.year}-${dest.extra.month}`, link.to);
        }
    }
    const months = [
        ...MONTHS_26.map((m) => ({ year: 2026, month: m })),
        { year: 2027, month: 1 },
        { year: 2027, month: 2 },
    ];
    return (
        <div className="nb-fill">
            <TitleBar title="2026학년도 연간 달력" hint="달력을 누르면 그 달로 가요" />
            <div className="nb-yeargrid">
                {months.map(({ year, month }) => {
                    const to = toByMonth.get(`${year}-${month}`);
                    const label = `${year === 2027 ? '2027 ' : ''}${month}월`;
                    return (
                        <button
                            key={`${year}-${month}`}
                            type="button"
                            className="nb-monthlink"
                            onClick={() => to && onGo(to)}
                            disabled={!to}
                            aria-label={`${label} 달력 (${to || ''}쪽)`}
                        >
                            <MiniMonth year={year} month={month} />
                        </button>
                    );
                })}
            </div>
        </div>
    );
}

export function AcademicPage({ pageRec, fields, setField, onGo }) {
    const { body } = partitionLinks(pageRec);
    return (
        <div className="nb-fill">
            <TitleBar title="학사일정" hint="달 이름을 누르면 그 달 달력으로 가요. 공휴일만 미리 적어 뒀어요." />
            <div className="nb-acad">
                {ACADEMIC.map(([mon, hol], i) => {
                    const link = body[i];
                    return (
                        <div key={mon} className="nb-acad-row">
                            {link ? (
                                <GoBtn to={link.to} onGo={onGo} className="text" aria={`${mon} 달력`}>{mon}</GoBtn>
                            ) : <strong>{mon}</strong>}
                            <span className="nb-acad-hol">{hol}</span>
                            <Ink value={fields[`a${i}`]} onChange={(v) => setField(`a${i}`, v)} placeholder="학교 일정" />
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

export function MonthPage({ page, pageRec, pages, extra, fields, setField, onGo, ddayCards }) {
    const year = extra.year || 2026;
    const month = extra.month || 3;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const cells = monthCells(ym);
    const { body } = partitionLinks(pageRec);
    const { days, extras } = monthDayMap(body);
    const deadlines = allDeadlines(ddayCards);
    return (
        <div className="nb-fill">
            <TitleBar kicker={`${year}년`} title={`${month}월`} hint="날짜를 누르면 그 주 주간 쪽으로 가요" />
            <div className="nb-month-dow">{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}</div>
            <div className="nb-month-grid">
                {cells.map((c) => {
                    const cap = c.inMonth ? holidayCaption(c.ymd) : null;
                    const to = c.inMonth ? days.get(c.day) : null;
                    const marks = c.inMonth ? calendarMarks(c.ymd, deadlines) : [];
                    const badge = marks[0] ? ddayBadge(daysUntil(marks[0].deadline)) : null;
                    const hot = badge && (badge.kind === 'day' || badge.kind === 'soon') ? `${badge.text} ` : '';
                    return (
                        <div key={c.ymd} className={`nb-month-cell ${c.inMonth ? '' : 'out'} ${cap?.isHoliday ? 'hol' : ''}`}>
                            {to ? (
                                <button type="button" className="nb-daylink" onClick={() => onGo(to, { hash: `#/date/${c.ymd}` })} aria-label={`${month}월 ${c.day}일, ${to}쪽`}>
                                    {c.day}
                                </button>
                            ) : <span className="d">{c.inMonth ? c.day : ''}</span>}
                            {cap && <span className="cap">{cap.primary.short}</span>}
                            {marks.length > 0 && (
                                <button type="button" className={`nb-dday-mark is-${badge?.kind || 'later'}`} onClick={() => onGo(405)}>
                                    {hot}{marks[0].title}{marks.length > 1 ? ` +${marks.length - 1}` : ''}
                                </button>
                            )}
                            {c.inMonth && (
                                <Ink
                                    value={fields[`d${c.day}`]}
                                    onChange={(v) => setField(`d${c.day}`, v)}
                                    placeholder=""
                                    aria={`${month}월 ${c.day}일 메모`}
                                />
                            )}
                        </div>
                    );
                })}
            </div>
            {extras.length > 0 && (
                <div className="nb-monthrow">
                    {extras.map((l) => (
                        <GoBtn key={`${l.to}-${l.rect[0]}`} to={l.to} onGo={onGo}>{linkText(l, pages, page)}</GoBtn>
                    ))}
                </div>
            )}
            <p className="nb-hint">날짜 칸 아래 점을 칠해서 표시해요 · 현장체험 · 생일 · 체험 · 대회</p>
        </div>
    );
}

export function WeekTocPage({ page, pageRec, pages, onGo }) {
    const { body } = partitionLinks(pageRec);
    return (
        <div className="nb-fill">
            <TitleBar title="주간 목차" hint="달 이름을 누르면 월간, 주를 누르면 그 주로 가요" />
            <LinkGrid links={body} pages={pages} pageNo={page} onGo={onGo} className="nb-weektoc" />
        </div>
    );
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const DAY_KO = ['월', '화', '수', '목', '금'];
/** 주 첫날(월)부터 i일 뒤가 오늘(서울)이면 true */
function dayIsToday(span, i) {
    if (!span?.start) return false;
    const [y, m, d] = span.start.split('-').map(Number);
    const ymd = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    return ymd === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul' }).format(new Date());
}

export function WeekPage({ pageRec, extra, fields, setField, onGo, ddayCards }) {
    const { body } = partitionLinks(pageRec);
    const dayLinks = [...body].sort((a, b) => a.rect[0] - b.rect[0]);
    const span = parseRange(extra.range);
    const due = deadlinesInRange(allDeadlines(ddayCards), span?.start, span?.end);
    const head = (i, label, tint) => {
        const link = dayLinks[i];
        return (
            <h3 className={`nb-dayh${tint === 'today' ? ' is-today' : ''}`}>
                {link ? (
                    <button type="button" className="nb-dayhead" onClick={() => onGo(link.to)} aria-label={`${label}, ${link.to}쪽`}>
                        {label}
                    </button>
                ) : label}
            </h3>
        );
    };
    return (
        <div className="nb-week nb-fill">
            <TitleBar
                title={`${extra.week || ''}주차`}
                hint={extra.range || '요일을 누르면 특별한 하루 일과로 가요'}
            />
            <div className="nb-week-days">
                {DAY_KEYS.map((key, i) => (
                    <section key={key} className="nb-week-col">
                        {head(i, DAY_KO[i], dayIsToday(span, i) ? 'today' : '')}
                        {[1, 2, 3, 4, 5, 6].map((p) => (
                            <label key={p} className="nb-period">
                                <span>{p}</span>
                                <Tick checked={fields[`${key}_j${p}`]} onChange={(v) => setField(`${key}_j${p}`, v)} label="전담" />
                                <Ink value={fields[`${key}_p${p}`]} onChange={(v) => setField(`${key}_p${p}`, v)} aria={`${DAY_KO[i]} ${p}교시`} />
                            </label>
                        ))}
                        <div className="nb-panel">
                            <p className="nb-kicker">알림장 초안</p>
                            {['전달', '준비물', '숙제'].map((lab) => (
                                <Ink key={lab} value={fields[`${key}_${lab}`]} onChange={(v) => setField(`${key}_${lab}`, v)} placeholder={lab} />
                            ))}
                            <Tick checked={fields[`${key}_letter`]} onChange={(v) => setField(`${key}_letter`, v)} label="가정통신문 발송" />
                        </div>
                        <Ink multiline rows={2} value={fields[`${key}_memo`]} onChange={(v) => setField(`${key}_memo`, v)} placeholder="메모" />
                    </section>
                ))}
                <section className="nb-week-side">
                    {due.length > 0 && (
                        <div className="nb-week-due" aria-label="이번 주 기한">
                            <p className="nb-kicker">기한 · 마감</p>
                            {due.map((item) => (
                                <button
                                    key={item.id}
                                    type="button"
                                    className={`nb-week-due-item${item.status === 'done' ? ' is-done' : ''}`}
                                    data-to={item.page || 405}
                                    onClick={() => onGo(item.page || 405)}
                                >
                                    {String(item.deadline).slice(5).replace('-', '.')} {item.title}
                                    {item.status === 'done' ? ' 완료' : ''}
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="nb-split" style={{ gridTemplateColumns: '1fr 1fr' }}>
                        <div className="nb-panel">{head(5, '토', dayIsToday(span, 5) ? 'today' : '')}<Ink multiline rows={2} value={fields.sat} onChange={(v) => setField('sat', v)} /></div>
                        <div className="nb-panel">{head(6, '일', dayIsToday(span, 6) ? 'today' : '')}<Ink multiline rows={2} value={fields.sun} onChange={(v) => setField('sun', v)} /></div>
                    </div>
                    <p className="nb-kicker">주간학습안내</p>
                    <Ink multiline rows={3} value={fields.guide} onChange={(v) => setField('guide', v)} placeholder="공부할 내용 · 준비물" />
                    <p className="nb-kicker">이번 주 할 일</p>
                    <LinedBlock n={5} get={(k) => fields[k]} set={setField} prefix="todo" placeholder="할 일" />
                    <Tick checked={fields.ssugeokDone} onChange={(v) => setField('ssugeokDone', v)} label="쓱, 적 정리" />
                    <Ink multiline rows={2} value={fields.ssugeok} onChange={(v) => setField('ssugeok', v)} placeholder="옮길 메모" />
                </section>
            </div>
        </div>
    );
}

export function SpecialTocPage({ page, pageRec, pages, onGo }) {
    const { body } = partitionLinks(pageRec);
    return (
        <div className="nb-fill">
            <TitleBar title="특별한 하루 일과" hint="평소와 다른 날의 하루 일과를 적어요. 번호를 누르면 그 쪽이에요." />
            <LinkGrid links={body} pages={pages} pageNo={page} onGo={onGo} className="nb-specialgrid" />
        </div>
    );
}

export function SpecialDayPage({ extra, fields, setField }) {
    return (
        <div>
            <TitleBar title={`특별한 하루 일과${String(extra.slot || '').padStart(2, '0')}`} hint="평소와 다른 날, 빈 쪽에 날짜를 적어 쓰면 돼요" />
            <div className="nb-special-head">
                <label>날짜 <Ink type="date" value={fields.date} onChange={(v) => setField('date', v)} /></label>
                <label>요일 <Ink value={fields.dow} onChange={(v) => setField('dow', v)} placeholder="요일" /></label>
                <label>날씨 <Ink value={fields.weather} onChange={(v) => setField('weather', v)} placeholder="날씨" /></label>
                <label>행사 <Ink value={fields.event} onChange={(v) => setField('event', v)} placeholder="행사명" /></label>
            </div>
            <div className="nb-special-grid">
                {[1, 2, 3, 4, 5, 6].map((p) => (
                    <label key={p} className="nb-period">
                        <span>{p}</span>
                        <Ink value={fields[`p${p}`]} onChange={(v) => setField(`p${p}`, v)} placeholder={`${p}교시`} />
                    </label>
                ))}
            </div>
            <Ink multiline rows={6} value={fields.note} onChange={(v) => setField('note', v)} placeholder="일과 · 메모" />
        </div>
    );
}

export function CalendarGroup(props) {
    switch (props.pageRec.type) {
        case 'year-cal': return <YearCalPage {...props} />;
        case 'academic': return <AcademicPage {...props} />;
        case 'month': return <MonthPage {...props} />;
        case 'week-toc': return <WeekTocPage {...props} />;
        case 'week': return <WeekPage {...props} />;
        case 'special-toc': return <SpecialTocPage {...props} />;
        case 'special-day': return <SpecialDayPage {...props} />;
        default: return null;
    }
}
