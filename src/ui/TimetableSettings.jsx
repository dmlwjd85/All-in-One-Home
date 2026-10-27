import { useState } from 'react';
import { patchProfile } from '../lib/db.js';
import { LEVEL_LENGTH, MAX_PERIODS, isHm } from '../lib/period.js';
import { allLengths, allStarts, patchPeriodLocal, usedCount } from '../lib/periodLocal.js';
import { usePeriodLocal } from './usePeriodLocal.js';
import { Btn } from './bits.jsx';

const COUNTS = [5, 6, 7, 8, 9, 10];
const LEVEL_NAME = { 초: '초등학교', 중: '중학교', 고: '고등학교' };

/** 교시 수·시작 시각·수업 길이·잠금·출퇴근 시각. 1~8교시 시작 시각만 계정에 저장되고, 나머지는 이 기기에만 둡니다. */
export function TimetableSettings({ data, showToast }) {
    const local = usePeriodLocal();
    const [starts, setStarts] = useState(() => allStarts(data.profile.periodStarts, local));
    const [lengths, setLengths] = useState(() => allLengths(local).map(String));
    const [workStart, setWorkStart] = useState(local.workStart);
    const [workEnd, setWorkEnd] = useState(local.workEnd);
    /* 과목이 들어 있는 교시는 교시 수를 줄여도 숨기지 않습니다. */
    const count = usedCount(data.timetable, local);

    function pickLevel(level) {
        const next = String(LEVEL_LENGTH[level]);
        /* 저장한 길이뿐 아니라 아직 저장하지 않은 길이 수정도 묻습니다. */
        const saved = allLengths(local).map(String);
        const custom = local.lengths.some((item) => Number(item) > 0) || lengths.some((item, index) => item !== saved[index]);
        if (custom && !window.confirm('따로 고친 수업 길이가 학교급 기본값으로 바뀌어요. 바꿀까요?')) return;
        setLengths(Array.from({ length: MAX_PERIODS }, () => next));
        patchPeriodLocal({ level, lengths: [] });
        showToast(`${LEVEL_NAME[level]} 기준으로 한 교시를 ${next}분으로 맞췄어요.`);
    }

    return (
        <section className="glass tt-settings" style={{ padding: 14 }} aria-label="시간표와 출퇴근">
            <h2 className="title-font" style={{ marginTop: 0 }}>시간표와 출퇴근</h2>
            <p className="muted" style={{ marginTop: 0 }}>출근·퇴근 시각을 함께 적어 두면 출근 뒤부터 홈에 퇴근까지 남은 시간이 보여요. 비워 두면 타이머는 숨어요. 이 기기에만 저장해요.</p>
            <div className="tt-work">
                <label>
                    <span className="muted">출근</span>
                    <input className="field" type="time" aria-label="출근 시각" value={workStart} onChange={(event) => setWorkStart(event.target.value)} />
                </label>
                <label>
                    <span className="muted">퇴근</span>
                    <input className="field" type="time" aria-label="퇴근 시각" value={workEnd} onChange={(event) => setWorkEnd(event.target.value)} />
                </label>
            </div>
            <Btn className="chip" style={{ marginTop: 8 }} onClick={() => {
                if ((workStart && !isHm(workStart)) || (workEnd && !isHm(workEnd))) { showToast('시각은 08:30처럼 골라 주세요.'); return; }
                if (workEnd && !workStart) { showToast('출근 시각도 함께 골라 주세요. 타이머는 출근부터 퇴근까지 보여요.'); return; }
                if (workStart && workEnd && workEnd <= workStart) { showToast('퇴근 시각은 출근 시각보다 늦어야 해요.'); return; }
                patchPeriodLocal({ workStart: workStart || '', workEnd: workEnd || '' });
                showToast(workEnd ? `퇴근 ${workEnd}까지 남은 시간을 홈에 보여 드릴게요.` : '퇴근 시각을 비워서 타이머를 숨겼어요.');
            }}>출퇴근 시각 저장</Btn>

            <h3 style={{ margin: '18px 0 6px', fontSize: 16 }}>학교급</h3>
            <p className="muted" style={{ marginTop: 0 }}>고르면 한 교시 길이가 초 40분, 중 45분, 고 50분으로 채워져요. 아래에서 교시마다 고칠 수 있어요.</p>
            <div style={{ display: 'flex', gap: 8 }}>
                {Object.keys(LEVEL_LENGTH).map((level) => (
                    <Btn key={level} className={local.level === level ? 'chip on' : 'chip'} aria-pressed={local.level === level} onClick={() => pickLevel(level)}>{LEVEL_NAME[level]}</Btn>
                ))}
            </div>

            <h3 style={{ margin: '18px 0 6px', fontSize: 16 }}>하루 교시 수</h3>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {COUNTS.map((n) => (
                    <Btn key={n} className={local.count === n ? 'chip on' : 'chip'} aria-pressed={local.count === n} onClick={() => patchPeriodLocal({ count: n })}>{n}교시</Btn>
                ))}
            </div>

            <h3 style={{ margin: '18px 0 6px', fontSize: 16 }}>교시별 시작과 길이</h3>
            <p className="muted" style={{ marginTop: 0 }}>잠근 교시는 홈에 🔒로 보이고 시간 안내에서 빠져요. 9·10교시는 이 기기에만 저장해요.</p>
            {count > local.count && <p className="muted" style={{ marginTop: 0 }}>시간표에 {count}교시까지 과목이 있어서 {count}교시까지 보여 드려요. 과목을 지우면 정한 교시 수로 돌아가요.</p>}
            <div className="tt-rows">
                {Array.from({ length: count }, (_, index) => {
                    const n = index + 1;
                    const locked = local.locks.includes(n);
                    return (
                        <div key={n} className={locked ? 'tt-row is-locked' : 'tt-row'}>
                            <strong>{n}교시</strong>
                            <input className="field" type="time" aria-label={`${n}교시 시작`} value={starts[index]} onChange={(event) => setStarts((prev) => prev.map((item, i) => (i === index ? event.target.value : item)))} />
                            <span className="tt-len"><input className="field num" inputMode="numeric" aria-label={`${n}교시 길이(분)`} value={lengths[index]} onChange={(event) => setLengths((prev) => prev.map((item, i) => (i === index ? event.target.value.replace(/\D/g, '').slice(0, 3) : item)))} />분</span>
                            <Btn className={locked ? 'chip on' : 'chip'} aria-pressed={locked} aria-label={locked ? `${n}교시 잠금 풀기` : `${n}교시 잠그기`} onClick={() => patchPeriodLocal({ locks: locked ? local.locks.filter((item) => item !== n) : [...local.locks, n].sort((a, b) => a - b) })}>{locked ? '🔒 잠김' : '잠그기'}</Btn>
                        </div>
                    );
                })}
            </div>
            <Btn className="primary-btn block" style={{ marginTop: 10 }} onClick={async () => {
                if (starts.some((item) => !isHm(item))) { showToast('시각은 09:00처럼 적어 주세요.'); return; }
                const bad = lengths.slice(0, count).some((item) => !(Number(item) >= 10 && Number(item) <= 120));
                if (bad) { showToast('수업 길이는 10분에서 120분 사이로 적어 주세요.'); return; }
                const base = LEVEL_LENGTH[local.level];
                patchPeriodLocal({
                    extraStarts: starts.slice(8, MAX_PERIODS),
                    lengths: lengths.map((item) => (Number(item) === base ? 0 : Number(item))),
                });
                const head = starts.slice(0, 8);
                const before = allStarts(data.profile.periodStarts, local).slice(0, 8);
                if (head.join() !== before.join()) {
                    const saved = await patchProfile({ periodStarts: head });
                    if (saved?.storageFailed) return;
                }
                showToast('교시 시각과 수업 길이를 저장했어요.');
            }}>교시 저장</Btn>
        </section>
    );
}
