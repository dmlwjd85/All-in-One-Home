import { setTimetable, joined } from '../lib/db.js';
import { tableRow, usedCount } from '../lib/periodLocal.js';
import { usePeriodLocal } from './usePeriodLocal.js';
import { TermFill } from './TermFill.jsx';
import { Btn } from './bits.jsx';
import { useUi } from './context.jsx';
import { ELEMENTARY_SAMPLE, sampleFillCells, timetableEmpty } from '../lib/schoolDefaults.js';

const DAYS = [['mon', '월'], ['tue', '화'], ['wed', '수'], ['thu', '목'], ['fri', '금']];

/** 설정에서 요일 기본 시간표를 적고, 아래 타일로 1학기·2학기·1년에 한 번에 넣습니다. 시간표 화면의 같은 표와 같은 저장소를 씁니다. */
export function DefaultTimetable({ data }) {
    const local = usePeriodLocal();
    const { showToast } = useUi();
    const empty = timetableEmpty(data.timetable, local.extra);

    async function fillSample() {
        /* 비어 있는 칸만 채웁니다. 이미 적은 과목은 절대 바꾸지 않습니다. */
        const cells = sampleFillCells(data.timetable, ELEMENTARY_SAMPLE);
        if (!cells.length) { showToast?.('이미 적어 둔 시간표가 있어서 그대로 둘게요.'); return; }
        if (!window.confirm('초등 시간표 예시를 빈 칸에 넣을까요? 학교·학년마다 다르니 넣은 뒤 칸을 눌러 고쳐 주세요.')) return;
        for (const cell of cells) await setTimetable(cell.day, cell.period, cell.subject, null);
        showToast?.(`예시 과목 ${cells.length}칸을 넣었어요. 칸을 눌러 우리 반에 맞게 고쳐 주세요.`);
    }

    const count = usedCount(data.timetable, local);
    const periods = Array.from({ length: count }, (_, i) => i + 1);

    function commit(day, period, value, before) {
        const next = String(value || '').trim().slice(0, 20);
        if (next === (before || '')) return;
        setTimetable(day, period, next, null);
    }

    return (
        <section className="glass default-tt" style={{ padding: 14 }} aria-label="기본 시간표" data-screen="default-tt">
            <h2 className="title-font" style={{ marginTop: 0 }}>기본 시간표</h2>
            <p className="muted" style={{ marginTop: 0 }}>요일마다 과목을 적으면 바로 저장돼요. 다 적은 뒤 아래에서 1학기·2학기·1년 중 하나를 누르면 그 기간 수업일에 들어가요.</p>
            {empty && (
                <div className="suggest-card" role="group" aria-label="시간표 예시" data-suggest="timetable">
                    <p className="suggest-text">시간표가 비어 있어요. 초등 시간표 예시(월~금 5·6교시)를 빈 칸에 넣고 고쳐 쓸 수 있어요.</p>
                    <Btn className="chip" onClick={fillSample}>예시 시간표 넣기</Btn>
                </div>
            )}
            <div className="dtt-grid" role="grid" aria-label="요일별 기본 시간표" style={{ gridTemplateColumns: `34px repeat(${DAYS.length}, minmax(0, 1fr))` }}>
                <span aria-hidden="true" />
                {DAYS.map(([, name]) => <strong key={name} className="dtt-head">{name}</strong>)}
                {periods.map((period) => (
                    <div key={period} className="dtt-row" role="row" style={{ display: 'contents' }}>
                        <span className="dtt-period num muted">{period}</span>
                        {DAYS.map(([day, name]) => {
                            const before = tableRow(data.timetable, day, local)[`p${period}`] || '';
                            return (
                                <input
                                    key={`${day}-${period}-${before}`}
                                    className="field dtt-cell"
                                    aria-label={`${name}요일 ${period}교시`}
                                    defaultValue={before}
                                    maxLength={20}
                                    enterKeyHint="next"
                                    data-dtt={`${day}-${period}`}
                                    onBlur={(event) => commit(day, period, event.target.value, before)}
                                    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }}
                                />
                            );
                        })}
                    </div>
                ))}
            </div>
            <TermFill data={data} events={joined(data, 'events')} />
        </section>
    );
}
