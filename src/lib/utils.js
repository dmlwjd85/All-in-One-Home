/** 오늘 날짜 YYYY-MM-DD */
export const todayYmd = () => {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
};

/** 이번 달 YYYY-MM */
export const thisMonth = () => todayYmd().slice(0, 7);

export const monthLabel = (ym) => {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    return `${y}년 ${Number(m)}월`;
};

export const formatWon = (n) => `${Math.round(Number(n) || 0).toLocaleString('ko-KR')}원`;

export const parseAmount = (raw) => {
    const v = Number(String(raw).replace(/[^\d.-]/g, ''));
    return Number.isFinite(v) ? v : 0;
};

export const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

/** 이미지 파일을 JPEG로 압축해 Firestore 한도 안에서 저장 */
export const compressImage = (file, maxWidth = 900, quality = 0.7) =>
    new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('파일을 읽을 수 없습니다.'));
        reader.onload = () => {
            const img = new Image();
            img.onerror = () => reject(new Error('이미지를 열 수 없습니다. JPG/PNG를 사용해 주세요.'));
            img.onload = () => {
                const canvas = document.createElement('canvas');
                const scale = img.width > maxWidth ? maxWidth / img.width : 1;
                canvas.width = img.width * scale;
                canvas.height = img.height * scale;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
            img.src = reader.result;
        };
        reader.readAsDataURL(file);
    });

export const downloadText = (filename, text, mime = 'application/json') => {
    const blob = new Blob([text], { type: `${mime};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
};

export const WEEKDAYS = ['월', '화', '수', '목', '금'];
export const WEEKDAYS_FULL = ['월', '화', '수', '목', '금', '토', '일'];
export const PERIODS = [1, 2, 3, 4, 5, 6];

export const toYmd = (d) => {
    const x = d instanceof Date ? d : new Date(d);
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};

export const fromYmd = (s) => {
    const [y, m, d] = String(s).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
};

export const addDaysYmd = (s, n) => {
    const d = fromYmd(s);
    d.setDate(d.getDate() + n);
    return toYmd(d);
};

/** 월요일 시작 주 */
export const startOfWeekMon = (s) => {
    const d = fromYmd(s);
    const day = d.getDay();
    const diff = day === 0 ? -6 : 1 - day;
    d.setDate(d.getDate() + diff);
    return toYmd(d);
};

export const shiftMonth = (ym, delta) => {
    const [y, m] = String(ym).split('-').map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** 월간 달력 칸 (월요일 시작, 앞뒤 빈 칸 포함) */
export const monthCells = (ym) => {
    const [y, m] = String(ym).split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const startPad = (first.getDay() + 6) % 7;
    const days = new Date(y, m, 0).getDate();
    const cells = [];
    for (let i = 0; i < startPad; i++) {
        const d = new Date(y, m - 1, 1 - (startPad - i));
        cells.push({ ymd: toYmd(d), inMonth: false, day: d.getDate() });
    }
    for (let day = 1; day <= days; day++) {
        cells.push({ ymd: `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`, inMonth: true, day });
    }
    while (cells.length % 7 !== 0) {
        const last = fromYmd(cells[cells.length - 1].ymd);
        last.setDate(last.getDate() + 1);
        cells.push({ ymd: toYmd(last), inMonth: false, day: last.getDate() });
    }
    return cells;
};

export const SUBJECTS = ['국어', '수학', '사회', '과학', '영어', '도덕', '음악', '미술', '체육', '연극', '실과', '창체', '아침활동', '기타'];

export const LEDGER_INCOME = [
    { id: 'salary', label: '급여' },
    { id: 'bonus', label: '보너스' },
    { id: 'allowance', label: '용돈/기타수입' },
];

export const LEDGER_EXPENSE = [
    { id: 'food', label: '식비' },
    { id: 'home', label: '주거' },
    { id: 'util', label: '공과금' },
    { id: 'transport', label: '교통' },
    { id: 'edu', label: '교육' },
    { id: 'health', label: '의료' },
    { id: 'insure', label: '보험' },
    { id: 'telecom', label: '통신' },
    { id: 'culture', label: '문화/여가' },
    { id: 'save', label: '저축/투자' },
    { id: 'etc', label: '기타' },
];

export const allLedgerCats = [...LEDGER_INCOME, ...LEDGER_EXPENSE];

export const catLabel = (id) => allLedgerCats.find((c) => c.id === id)?.label || id;

export const CONTACT_TYPES = ['전화', '면담', '문자', '가정통신', '온라인'];
export const ATTEND_STATUS = ['출석', '지각', '결석', '조퇴'];
