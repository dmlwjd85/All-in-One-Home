import { useEffect, useRef, useState } from 'react';
import { joined, joinedRecords } from '../lib/db.js';
import { seoulYmd } from '../lib/date.js';
import { schoolDays, termRange } from '../lib/semester.js';
import { isSensitiveText } from '../lib/sensitive.js';
import { Btn } from './bits.jsx';
import { deliverFile } from './fileSave.js';

/* 엑셀 만드는 코드는 첫 화면 묶음에 넣지 않고, 이 단추가 보일 때 미리 불러 둡니다(누른 손짓이 끊기지 않게). */
const LOAD_FAIL = '엑셀 만드는 코드를 불러오지 못했어요. 인터넷을 확인하고 앱을 새로 고친 뒤 다시 눌러 주세요.';
const MAKE_FAIL = '엑셀 파일을 만들지 못했어요. 잠시 뒤 다시 눌러 주세요.';

function useClassXlsx() {
    const ref = useRef(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let alive = true;
        /* 미리 불러오기가 실패해도 여기서는 알리지 않고, 누를 때 다시 불러 봅니다. */
        import('../lib/classXlsx.js').then((mod) => { if (alive) ref.current = mod; }).catch(() => {});
        return () => { alive = false; };
    }, []);
    /* 미리 불러 둔 것이 있으면 기다리지 않습니다. 없으면 이때 한 번 더 불러 봅니다. */
    async function load() {
        if (ref.current) return ref.current;
        try {
            const mod = await import('../lib/classXlsx.js');
            ref.current = mod;
            setFailed(false);
            return mod;
        } catch {
            setFailed(true);
            return null;
        }
    }
    return { load, failed };
}

async function hand(mod, sheets, name, showToast) {
    let file;
    try {
        file = new File([mod.sheetBytes(sheets)], name, { type: mod.XLSX_TYPE });
    } catch {
        showToast(MAKE_FAIL);
        return;
    }
    const how = await deliverFile(file);
    if (how === 'shared') showToast('엑셀 파일(.xlsx)을 넘겼어요. 「파일에 저장」을 고르면 이 기기에 남아요.');
    else if (how === 'saved') showToast(`엑셀 파일(.xlsx)을 이 기기에만 내려받았어요. ${name}`);
}

function allStudentsOf(data) {
    return data.allStudents || data.students || [];
}

/** 기록 엑셀: sid 가 있으면 그 학생 한 명, 없으면 반 전체. */
export function RecordExport({ data, sid = '', showToast }) {
    const xlsx = useClassXlsx();
    const [withLocal, setWithLocal] = useState(true);
    const records = joinedRecords(data).filter((row) => !sid || row.sid === sid);
    const localCount = records.filter((row) => row.localOnly).length;
    const student = sid ? allStudentsOf(data).find((row) => row.id === sid) : null;

    async function run() {
        if (!records.length) {
            showToast(sid ? '이 학생 기록이 아직 없어요.' : '내려받을 기록이 없어요.');
            return;
        }
        const mod = await xlsx.load();
        if (!mod) {
            showToast(LOAD_FAIL);
            return;
        }
        let made;
        try {
            made = mod.recordSheets({ students: allStudentsOf(data), records: joinedRecords(data), sid, includeLocal: withLocal });
        } catch {
            showToast(MAKE_FAIL);
            return;
        }
        if (!made.count) {
            showToast('넣을 기록이 없어요. 이 기기에만 둔 기록을 빼서 비었어요.');
            return;
        }
        const who = student ? `${student.no}번${mod.fileSafe(student.name)}` : '전체';
        await hand(mod, made.sheets, `기록_${who}_${seoulYmd()}.xlsx`, showToast);
    }

    return (
        <div className="class-export" data-export="records">
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <Btn className="chip" data-export-btn="records" onClick={run}>{sid ? '이 학생 기록 엑셀' : '기록 엑셀'}</Btn>
                {localCount > 0 && (
                    <Btn className={withLocal ? 'chip on' : 'chip'} aria-pressed={withLocal} onClick={() => setWithLocal((v) => !v)}>
                        {withLocal ? '🔒 이 기기 전용 기록 넣음' : '🔒 이 기기 전용 기록 뺌'}
                    </Btn>
                )}
            </div>
            {localCount > 0 && withLocal && <p className="muted" data-export-local style={{ margin: '6px 0 0' }}>이 기기에만 둔 민감 기록 {localCount}건도 엑셀 파일에 들어가요. 파일을 보낼 때 조심해 주세요.</p>}
            {xlsx.failed && <p role="alert" style={{ margin: '6px 0 0' }}>{LOAD_FAIL}</p>}
        </div>
    );
}

const SPANS = [
    { id: 'month', label: '이 달' },
    { id: 'first', label: '1학기' },
    { id: 'second', label: '2학기' },
];

function lastDayOf(ym) {
    const [y, m] = ym.split('-').map(Number);
    const d = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return `${ym}-${String(d).padStart(2, '0')}`;
}

/** 학년도: 설정 값이 먼저, 없으면 3월 전(1·2월)은 지난해입니다. */
function schoolYearOf(data, ymd) {
    const set = Number(data.profile?.schoolYear);
    if (set) return set;
    const y = Number(ymd.slice(0, 4));
    return Number(ymd.slice(5, 7)) <= 2 ? y - 1 : y;
}

/** 출결 엑셀: 이 달(보고 있는 날의 달) 또는 학기. */
export function AttendExport({ data, date, showToast }) {
    const xlsx = useClassXlsx();
    const [span, setSpan] = useState('month');
    const events = joined(data, 'events');
    const year = schoolYearOf(data, date);
    const ym = date.slice(0, 7);
    const range = span === 'month' ? { from: `${ym}-01`, to: lastDayOf(ym) } : termRange(span, year, events);
    const marks = (data.attendance || []).filter((row) => row.date >= range.from && row.date <= range.to);
    const localCount = marks.filter((row) => row.note && isSensitiveText(row.note)).length;
    const label = span === 'month' ? `${Number(ym.slice(5))}월` : `${year}학년도 ${span === 'first' ? '1' : '2'}학기`;

    async function run() {
        const mod = await xlsx.load();
        if (!mod) {
            showToast(LOAD_FAIL);
            return;
        }
        let made;
        try {
            made = mod.attendSheets({ students: allStudentsOf(data), attendance: data.attendance || [], from: range.from, to: range.to, days: schoolDays(range.from, range.to, events) });
        } catch {
            showToast(MAKE_FAIL);
            return;
        }
        if (!made.days && !made.count) {
            showToast('이 기간에는 수업일이 없어요.');
            return;
        }
        const tag = span === 'month' ? ym : `${year}_${span === 'first' ? '1' : '2'}학기`;
        await hand(mod, made.sheets, `출결_${tag}.xlsx`, showToast);
    }

    return (
        <section className="glass class-export" data-export="attend" style={{ padding: 12, marginTop: 12 }}>
            <h3 style={{ margin: '0 0 8px' }}>출결 엑셀로 받기</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} role="group" aria-label="출결 엑셀 기간">
                {SPANS.map((row) => (
                    <Btn key={row.id} className={span === row.id ? 'chip on' : 'chip'} aria-pressed={span === row.id} onClick={() => setSpan(row.id)}>{row.label}</Btn>
                ))}
            </div>
            <p className="muted" style={{ margin: '8px 0' }}>{label} · {range.from.slice(5).replace('-', '/')}~{range.to.slice(5).replace('-', '/')} · 학생×날짜 표, 학생별 결석·지각·조퇴·결과 합계, 서류 받음·아직이 들어가요.</p>
            <Btn className="primary-btn fit-btn" data-export-btn="attend" onClick={run}>출결 엑셀 받기</Btn>
            {localCount > 0 && <p className="muted" data-export-local style={{ margin: '6px 0 0' }}>🔒 이 기기에만 두는 민감한 출결 메모 {localCount}건도 엑셀 파일에 들어가요.</p>}
            {xlsx.failed && <p role="alert" style={{ margin: '6px 0 0' }}>{LOAD_FAIL}</p>}
        </section>
    );
}
