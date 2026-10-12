import { holidayCaption } from '../../lib/holidays.js';
import { monthCells } from '../../lib/utils.js';
import { CellGrid, GoBtn, Ink, LinedBlock, Tick, TitleBar } from '../fields.jsx';
import { destLabel } from '../labels.js';

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

export function YearCalPage() {
    return (
        <div>
            <TitleBar title="2026학년도 연간 달력" hint="달 이름을 누르면 그 달 달력으로 가요" />
            <div className="nb-yeargrid">
                {MONTHS_26.map((m) => <MiniMonth key={m} year={2026} month={m} />)}
                <MiniMonth year={2027} month={1} />
                <MiniMonth year={2027} month={2} />
            </div>
        </div>
    );
}

export function AcademicPage({ fields, setField }) {
    return (
        <div>
            <TitleBar title="학사일정" hint="공휴일만 미리 적어 뒀어요. 우리 학교 일정은 직접 채워요" />
            <div className="nb-acad">
                {ACADEMIC.map(([mon, hol], i) => (
                    <div key={mon} className="nb-acad-row">
                        <strong>{mon}</strong>
                        <span className="nb-acad-hol">{hol}</span>
                        <Ink value={fields[`a${i}`]} onChange={(v) => setField(`a${i}`, v)} placeholder="학교 일정" />
                    </div>
                ))}
            </div>
        </div>
    );
}

export function MonthPage({ extra, fields, setField }) {
    const year = extra.year || 2026;
    const month = extra.month || 3;
    const ym = `${year}-${String(month).padStart(2, '0')}`;
    const cells = monthCells(ym);
    return (
        <div>
            <TitleBar kicker={`${year}년`} title={`${month}월`} hint="날짜 위쪽을 누르면 그 주로 가요" />
            <div className="nb-month-dow">{WEEKDAYS.map((d) => <span key={d}>{d}</span>)}</div>
            <div className="nb-month-grid">
                {cells.map((c) => {
                    const cap = c.inMonth ? holidayCaption(c.ymd) : null;
                    return (
                        <div key={c.ymd} className={`nb-month-cell ${c.inMonth ? '' : 'out'} ${cap?.isHoliday ? 'hol' : ''}`}>
                            <span className="d">{c.inMonth ? c.day : ''}</span>
                            {cap && <span className="cap">{cap.primary.short}</span>}
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
            <p className="nb-hint">날짜 칸 아래 점을 칠해서 표시해요 · 현장체험 · 생일 · 체험 · 대회</p>
        </div>
    );
}

export function WeekTocPage({ pageRec, pages, onGo }) {
    const links = pageRec.links || [];
    return (
        <div>
            <TitleBar title="주간 목차" hint="달 이름을 누르면 월간, 주를 누르면 그 주로 가요" />
            <CellGrid cols={6}>
                {links.map((l, i) => (
                    <GoBtn key={`${l.to}-${i}`} to={l.to} onGo={onGo} className="chip">
                        {l.label || destLabel(l.to, pages)}
                    </GoBtn>
                ))}
            </CellGrid>
        </div>
    );
}

const DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
const DAY_KO = ['월', '화', '수', '목', '금'];
const DAY_TINT = ['#fde2e4', '#ffe8cc', '#fff3bf', '#d8f3dc', '#cce3de'];

export function WeekPage({ extra, fields, setField }) {
    return (
        <div className="nb-week">
            <TitleBar
                title={`${extra.week || ''}주차`}
                hint={extra.range || ''}
            />
            <div className="nb-week-days">
                {DAY_KEYS.map((key, i) => (
                    <section key={key} className="nb-week-col">
                        <h3 style={{ background: DAY_TINT[i] }}>{DAY_KO[i]}</h3>
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
                    <div className="nb-split" style={{ gridTemplateColumns: '1fr 1fr' }}>
                        <div className="nb-panel"><p className="nb-kicker">토</p><Ink multiline rows={2} value={fields.sat} onChange={(v) => setField('sat', v)} /></div>
                        <div className="nb-panel"><p className="nb-kicker">일</p><Ink multiline rows={2} value={fields.sun} onChange={(v) => setField('sun', v)} /></div>
                    </div>
                    <p className="nb-kicker">주간학습안내</p>
                    <Ink multiline rows={3} value={fields.guide} onChange={(v) => setField('guide', v)} placeholder="공부할 내용 · 준비물" />
                    <p className="nb-kicker">이번 주 할 일</p>
                    <LinedBlock n={5} get={(k) => fields[k]} set={setField} prefix="todo" placeholder="할 일" />
                    <Tick checked={fields.ssugeokDone} onChange={(v) => setField('ssugeokDone', v)} label="쓱적 정리" />
                    <Ink multiline rows={2} value={fields.ssugeok} onChange={(v) => setField('ssugeok', v)} placeholder="옮길 메모" />
                </section>
            </div>
        </div>
    );
}

export function SpecialTocPage({ pageRec }) {
    return (
        <div>
            <TitleBar title="특별한 하루 일과" hint="평소와 다른 날의 하루 일과를 적어요. 번호를 누르면 그 쪽이에요." />
            <CellGrid cols={10}>
                {Array.from({ length: 40 }, (_, i) => (
                    <div key={i} className="nb-numchip">{i + 1}</div>
                ))}
            </CellGrid>
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
