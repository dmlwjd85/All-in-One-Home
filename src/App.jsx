import { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithCustomToken, signInAnonymously, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, doc, setDoc, addDoc, onSnapshot, serverTimestamp, deleteDoc, updateDoc } from 'firebase/firestore';
import {
    Home,
    Calendar as CalendarIcon,
    Wallet,
    CheckSquare,
    BookOpen,
    User,
    Heart,
    Bell,
    Plus,
    TrendingUp,
    TrendingDown,
    Droplets,
    Activity,
    Scale,
    ChevronLeft,
    X,
    Trash2,
    ClipboardCheck,
    Calculator,
    Check,
    ImagePlus,
    Download,
    Lock,
    FileText,
    Pencil,
    Camera,
    Mic,
    PieChart,
    Layers,
    Search,
    Info,
    Target as TargetIcon,
    Car,
    House,
    Laptop,
    Plane,
    Gift,
} from 'lucide-react';

        const fallbackConfig = {
            apiKey: "AIzaSyAsih-sfnIZ_gX_1l7SAVZHCAhk3KzmiP8",
            authDomain: "sambong-world-2026.firebaseapp.com",
            projectId: "sambong-world-2026",
            storageBucket: "sambong-world-2026.firebasestorage.app",
            messagingSenderId: "",
            appId: "1:728320769100:web:7510c9a77cca6b87a788e9",
            measurementId: "G-H1RGMJHGTV"
        };

        const firebaseConfig = import.meta.env.VITE_FIREBASE_CONFIG ? JSON.parse(import.meta.env.VITE_FIREBASE_CONFIG) : fallbackConfig;
        const appId = import.meta.env.VITE_APP_ID || 'home-note-app';

        const app = initializeApp(firebaseConfig);
        const auth = getAuth(app);
        const db = getFirestore(app);

        /** Finnhub API 키 (앱 내 고정) */
        const FINNHUB_API_KEY = 'd7782dhr01qp6afkis3gd7782dhr01qp6afkis40';

        /** 단기 목표: 월 키 목록 생성 (YYYY-MM) */
        const genYearMonths = (start, count) => {
            const out = [];
            const d = new Date(start.getFullYear(), start.getMonth(), 1);
            for (let i = 0; i < count; i++) {
                out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
                d.setMonth(d.getMonth() + 1);
            }
            return out;
        };

        const sumMonthlyMap = (m) => {
            if (!m || typeof m !== 'object') return 0;
            return Object.values(m).reduce((a, v) => a + (Number(v) || 0), 0);
        };

        const SHORT_GOAL_KINDS = [
            { id: 'car', label: '자동차', Icon: Car, stroke: '#0ea5e9' },
            { id: 'house', label: '집', Icon: House, stroke: '#a855f7' },
            { id: 'pc', label: '컴퓨터', Icon: Laptop, stroke: '#6366f1' },
            { id: 'travel', label: '여행', Icon: Plane, stroke: '#14b8a6' },
            { id: 'wedding', label: '결혼/예식', Icon: Heart, stroke: '#f43f5e' },
            { id: 'other', label: '기타', Icon: Gift, stroke: '#64748b' },
        ];

        const CHORE_MASTER_LIST = [
            { id: 1, task: "세탁조" }, { id: 2, task: "식세기-후드" }, { id: 3, task: "냉장고 1" }, 
            { id: 4, task: "전자레인지" }, { id: 5, task: "에프" }, { id: 6, task: "안방 변기" }, 
            { id: 7, task: "재활용 1" }, { id: 8, task: "침구 1" }, { id: 9, task: "쇼파 1" }, { id: 10, task: "집안 정비" },
            { id: 11, task: "버리기" }, { id: 12, task: "현관" }, { id: 13, task: "다이슨 1" }, 
            { id: 14, task: "재활용 2" }, { id: 15, task: "펜트리" }, { id: 16, task: "거실 변기" }, 
            { id: 17, task: "로이 청소" }, { id: 18, task: "침구 2" }, { id: 19, task: "냉장고 2" }, { id: 20, task: "집안 정비" },
            { id: 21, task: "재활용 3" }, { id: 22, task: "시하 책장" }, { id: 23, task: "카페트" }, 
            { id: 24, task: "쇼파 2" }, { id: 25, task: "유리창" }, { id: 26, task: "세면대" }, 
            { id: 27, task: "다이슨 2" }, { id: 28, task: "침구 3" }, { id: 29, task: "재활용 4" }, { id: 30, task: "집안 정비" }
        ];

        // API 재시도용 유틸 (카메라 일정 스캔)
        const fetchWithRetry = async (url, options, retries = 5) => {
            let delay = 1000;
            for (let i = 0; i < retries; i++) {
                try {
                    const response = await fetch(url, options);
                    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                    return await response.json();
                } catch (e) {
                    if (i === retries - 1) throw e;
                    await new Promise(resolve => setTimeout(resolve, delay));
                    delay *= 2;
                }
            }
        };

        /** Finnhub 시세 (브라우저에서 CORS 허용) */
        const fetchFinnhubQuotesForSymbols = async (symbols, token = FINNHUB_API_KEY) => {
            if (!token || !symbols.length) return { ok: false, quotes: [], error: null };
            try {
                const quotes = await Promise.all(
                    symbols.map(async (sym) => {
                        const res = await fetch(
                            `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(sym)}&token=${encodeURIComponent(token)}`
                        );
                        if (!res.ok) throw new Error(String(res.status));
                        const j = await res.json();
                        if (j.error) throw new Error(j.error);
                        return {
                            symbol: sym,
                            regularMarketPrice: j.c != null ? j.c : null,
                            regularMarketChangePercent: j.dp != null ? j.dp : null,
                            regularMarketPreviousClose: j.pc != null ? j.pc : null,
                            currency: 'USD',
                            shortName: sym,
                        };
                    })
                );
                return { ok: true, quotes, error: null };
            } catch (e) {
                console.warn('Finnhub 시세 실패', e);
                return { ok: false, quotes: [], error: 'Finnhub 토큰이 잘못되었거나 호출 한도를 초과했을 수 있습니다.' };
            }
        };

        /** 야후 파이낸스 v7 (프록시·GET 래핑 등 복수 경로) */
        const fetchYahooQuotesForSymbols = async (symbols) => {
            if (!symbols.length) return { ok: true, quotes: [], error: null };
            const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
            const tryParseJson = (data) => {
                if (data.quoteResponse && Array.isArray(data.quoteResponse.result)) return data.quoteResponse.result;
                return null;
            };
            const proxyUrls = [
                `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
                `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
                `https://corsproxy.io/?${encodeURIComponent(url)}`,
            ];
            for (const purl of proxyUrls) {
                try {
                    const res = await fetch(purl);
                    if (!res.ok) continue;
                    const raw = await res.json();
                    const data = raw.contents != null ? JSON.parse(raw.contents) : raw;
                    const result = tryParseJson(data);
                    if (result) return { ok: true, quotes: result, error: null };
                } catch (e) {
                    console.warn('야후 시세 조회 실패', e);
                }
            }
            return {
                ok: false,
                quotes: [],
                error: '야후 시세(프록시)도 불가할 수 있습니다. 네트워크를 확인해 주세요.',
            };
        };

        /** Finnhub 심볼 검색 (티커·이름) */
        const fetchFinnhubSymbolSearch = async (query, token = FINNHUB_API_KEY) => {
            if (!token || !query || String(query).trim().length < 1) return { ok: false, result: [], error: null };
            try {
                const res = await fetch(
                    `https://finnhub.io/api/v1/search?q=${encodeURIComponent(String(query).trim())}&token=${encodeURIComponent(token)}`
                );
                const j = await res.json();
                if (j.error) return { ok: false, result: [], error: j.error };
                return { ok: true, result: Array.isArray(j.result) ? j.result : [], error: null };
            } catch (e) {
                console.warn('Finnhub 검색 실패', e);
                return { ok: false, result: [], error: '검색 요청에 실패했습니다.' };
            }
        };

        const isLikelyEtfSymbolResult = (r) => {
            const t = (r.type || '').toUpperCase();
            if (t === 'ETF' || t === 'ETP' || t === 'ETN') return true;
            const d = (r.description || '').toUpperCase();
            return d.includes(' ETF') || d.includes(' ETN') || d.startsWith('ETF ');
        };

        /** 미국 상장 ETF 10종 고정 카탈로그 (추천 시 비중만 성향에 따라 조정) */
        const INVEST_ETF_TEN = [
            {
                symbol: 'BND',
                nameKo: 'Vanguard Total Bond Market ETF',
                bucket: '채권·안정',
                descKo: '미국 투자등급 회사채·국채 등을 넓게 담아 이자 수익과 분산에 초점을 둔 대표 채권 ETF입니다. 주식 변동을 완충하는 역할을 기대할 수 있습니다.',
            },
            {
                symbol: 'AGG',
                nameKo: 'iShares Core U.S. Aggregate Bond ETF',
                bucket: '채권·안정',
                descKo: '미국 투자등급 채권 시장 전체를 넓게 추종하는 코어 채권 ETF로, BND와 유사하게 포트폴리오 안정층으로 자주 쓰입니다.',
            },
            {
                symbol: 'VGIT',
                nameKo: 'Vanguard Intermediate-Term Treasury ETF',
                bucket: '국채·금리',
                descKo: '미국 국채(중기 만기) 위주로 금리 방향에 상대적으로 덜 민감한 국채 노출을 제공합니다. 안정·현금성에 가까운 채권층으로 쓰기 좋습니다.',
            },
            {
                symbol: 'VTI',
                nameKo: 'Vanguard Total Stock Market ETF',
                bucket: '미국 주식',
                descKo: '미국 전체 시장(대·중·소형)을 시가총액 가중으로 추종하는 대표 주식 ETF입니다. 장기 성장을 노릴 때 코어 자산으로 자주 쓰입니다.',
            },
            {
                symbol: 'SCHD',
                nameKo: 'Schwab U.S. Dividend Equity ETF',
                bucket: '배당·퀄리티',
                descKo: '배당 성향이 있는 미국 우량주에 투자해 현금흐름·방어에 도움을 줄 수 있는 ETF입니다. 장기·중기 성향과 함께 고려하기 좋습니다.',
            },
            {
                symbol: 'VXUS',
                nameKo: 'Vanguard Total International Stock ETF',
                bucket: '해외 주식',
                descKo: '미국 외 선진·신흥국 주식에 분산 투자해 지역·통화 리스크를 나눕니다. 국내(미국) 주식만 가질 때의 집중도를 낮추는 데 도움이 됩니다.',
            },
            {
                symbol: 'VEA',
                nameKo: 'Vanguard FTSE Developed Markets ETF',
                bucket: '선진국 주식',
                descKo: '미국을 제외한 선진국 시장에 투자해 글로벌 분산을 넓힙니다. VXUS와 함께 해외 비중을 나눌 때 참고할 수 있습니다.',
            },
            {
                symbol: 'IEMG',
                nameKo: 'iShares Core MSCI Emerging Markets ETF',
                bucket: '신흥국',
                descKo: '신흥국 주식에 투자해 성장 잠재와 분산을 동시에 노릴 수 있습니다. 변동성이 크므로 비중은 성향에 맞게 조절하는 편이 좋습니다.',
            },
            {
                symbol: 'VNQ',
                nameKo: 'Vanguard Real Estate ETF',
                bucket: '리츠·부동산',
                descKo: '미국 상장 리츠(REITs) 위주로 부동산·인컴 특성을 일부 반영합니다. 주식·채권과 상관이 다를 수 있어 분산에 참고됩니다.',
            },
            {
                symbol: 'SGOV',
                nameKo: 'iShares 0-3 Month Treasury Bond ETF',
                bucket: '초단기·유동성',
                descKo: '만기가 매우 짧은 미국 국채에 투자해 현금에 가까운 유동성과 단기 금리 수익을 노리는 ETF입니다. 단기 목표·비상금 성격에 맞춥니다.',
            },
        ];

        /** 캔들 배열에서 최근 유효 종가·약 1년·5년 전 수익률 계산 */
        const calcReturnsFromCandles = (t, c) => {
            if (!t || !c || t.length < 2 || c.length < 2) return { ret1y: null, ret5y: null };
            const now = Math.floor(Date.now() / 1000);
            const day = 86400;
            const t1y = now - 365 * day;
            const t5y = now - 5 * 365 * day;
            let last = c[c.length - 1];
            let li = c.length - 1;
            while ((last == null || last === 0) && li > 0) last = c[--li];
            if (last == null || last <= 0) return { ret1y: null, ret5y: null };
            let idx1y = -1;
            for (let i = t.length - 1; i >= 0; i--) {
                if (t[i] <= t1y && c[i] != null && c[i] > 0) {
                    idx1y = i;
                    break;
                }
            }
            let idx5y = -1;
            for (let i = t.length - 1; i >= 0; i--) {
                if (t[i] <= t5y && c[i] != null && c[i] > 0) {
                    idx5y = i;
                    break;
                }
            }
            const ret1y = idx1y >= 0 ? ((last / c[idx1y]) - 1) * 100 : null;
            const ret5y = idx5y >= 0 ? ((last / c[idx5y]) - 1) * 100 : null;
            return { ret1y, ret5y };
        };

        /** Finnhub 캔들 (주봉 → 실패 시 일봉) */
        const fetchEtfHistoricalReturnsFinnhub = async (symbol, token = FINNHUB_API_KEY) => {
            if (!token) return { ret1y: null, ret5y: null };
            const now = Math.floor(Date.now() / 1000);
            const day = 86400;
            const from = now - 6 * 365 * day;
            const tryRes = async (resolution) => {
                const url = `https://finnhub.io/api/v1/stock/candle?symbol=${encodeURIComponent(symbol)}&resolution=${resolution}&from=${from}&to=${now}&token=${encodeURIComponent(token)}`;
                const res = await fetch(url);
                const data = await res.json();
                if (data.error) return null;
                if (data.s !== 'ok' || !data.c || !data.t || data.c.length < 2) return null;
                return calcReturnsFromCandles(data.t, data.c);
            };
            try {
                let out = await tryRes('W');
                if (out && (out.ret1y != null || out.ret5y != null)) return out;
                out = await tryRes('D');
                if (out) return out;
                return { ret1y: null, ret5y: null };
            } catch (e) {
                console.warn('Finnhub 캔들 실패', symbol, e);
                return { ret1y: null, ret5y: null };
            }
        };

        /** 야후 차트 응답 파싱 (allorigins·직접 JSON 등 혼합) */
        const parseYahooChartJson = async (res) => {
            const ct = (res.headers.get('content-type') || '').toLowerCase();
            let root;
            if (ct.includes('application/json')) {
                root = await res.json();
            } else {
                const text = await res.text();
                try {
                    root = JSON.parse(text);
                } catch {
                    return null;
                }
            }
            if (root && typeof root.contents === 'string') {
                try {
                    return JSON.parse(root.contents);
                } catch {
                    return null;
                }
            }
            return root;
        };

        /** 야후 차트 v8 (프록시) — Finnhub 실패 시 폴백 */
        const fetchYahooHistoricalReturns = async (symbol) => {
            const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1wk`;
            const proxyUrls = [
                `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`,
                `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
                `https://corsproxy.io/?${encodeURIComponent(url)}`,
            ];
            for (const purl of proxyUrls) {
                try {
                    const res = await fetch(purl);
                    if (!res.ok) continue;
                    const data = await parseYahooChartJson(res);
                    if (!data) continue;
                    const r = data?.chart?.result?.[0];
                    if (!r) continue;
                    const ts = r.timestamp;
                    const closes = r.indicators?.quote?.[0]?.close;
                    if (!ts || !closes || ts.length < 2) continue;
                    const { ret1y, ret5y } = calcReturnsFromCandles(ts, closes);
                    if (ret1y != null || ret5y != null) return { ret1y, ret5y };
                } catch (e) {
                    console.warn('야후 차트 수익률 실패', symbol, e);
                }
            }
            return { ret1y: null, ret5y: null };
        };

        /** 1년·5년 수익률: Finnhub(주·일) 후 부족분만 야후로 보완 */
        const fetchEtfHistoricalReturnsCombined = async (symbol, token = FINNHUB_API_KEY) => {
            const fh = await fetchEtfHistoricalReturnsFinnhub(symbol, token);
            if (fh.ret1y != null && fh.ret5y != null) return fh;
            const yh = await fetchYahooHistoricalReturns(symbol);
            return {
                ret1y: fh.ret1y != null ? fh.ret1y : yh.ret1y,
                ret5y: fh.ret5y != null ? fh.ret5y : yh.ret5y,
            };
        };

        /** 투자 성향 비율 → 위 ETF 10종 추천 (가중치 합 100%, 참고용) */
        const buildInvestEtfPlan = (pctPension, pctLong, pctMid, pctShort) => {
            const sum = pctPension + pctLong + pctMid + pctShort;
            const s = sum > 0 ? sum : 1;
            const p = pctPension / s, l = pctLong / s, m = pctMid / s, sh = pctShort / s;
            const raw = [
                0.28 * p + 0.1 * m + 0.03 * sh + 0.02 * l,
                0.14 * p + 0.08 * m + 0.02 * sh,
                0.26 * p + 0.1 * m + 0.05 * sh,
                0.38 * l + 0.22 * m + 0.05 * p + 0.03 * sh,
                0.12 * l + 0.14 * m + 0.03 * p,
                0.16 * l + 0.12 * m + 0.04 * p,
                0.1 * l + 0.1 * m + 0.03 * p,
                0.06 * l + 0.06 * m + 0.02 * p,
                0.05 * l + 0.05 * m + 0.02 * p,
                0.48 * sh + 0.06 * m + 0.03 * l + 0.02 * p,
            ];
            const rw = raw.map((w) => Math.max(0.0001, w));
            const tot = rw.reduce((a, b) => a + b, 0);
            return INVEST_ETF_TEN.map((meta, i) => ({
                symbol: meta.symbol,
                nameKo: meta.nameKo,
                bucket: meta.bucket,
                descKo: meta.descKo,
                kind: 'ETF',
                weight: rw[i] / tot,
                weightPct: ((rw[i] / tot) * 100).toFixed(1),
            }));
        };

        /** 만 원 단위: 복리 예상·목표 현재가치·연도별 경로 (연 단위 복리) */
        const computeInvestTargetPlan = (principalMan, years, targetMan, annualRatePct) => {
            const parseNum = (v) => {
                if (v === '' || v == null) return 0;
                const n = Number(String(v).replace(/,/g, '').trim());
                return Number.isFinite(n) ? n : 0;
            };
            const W = Math.max(0, parseNum(principalMan));
            const nRaw = parseNum(years);
            const n = Math.max(0, nRaw);
            const T = Math.max(0, parseNum(targetMan));
            const rPct = parseNum(annualRatePct);
            const rAnnual = rPct / 100;
            const months = Math.max(0, Math.round(n * 12));

            let fvLump = W * Math.pow(1 + rAnnual, n);
            if (rAnnual === 0) fvLump = W;

            let pvNeeded = 0;
            if (T <= 0) pvNeeded = 0;
            else if (rAnnual === 0) pvNeeded = T;
            else pvNeeded = T / Math.pow(1 + rAnnual, n);

            const gapLumpToday = Math.max(0, pvNeeded - W);
            const shortfallAtEnd = Math.max(0, T - fvLump);

            let monthlyExtra = 0;
            if (shortfallAtEnd > 0 && months > 0) {
                if (rAnnual === 0) {
                    monthlyExtra = shortfallAtEnd / months;
                } else {
                    const rm = Math.pow(1 + rAnnual, 1 / 12) - 1;
                    if (rm > 0) monthlyExtra = shortfallAtEnd * rm / (Math.pow(1 + rm, months) - 1);
                }
            }

            const yearlyPath = [];
            const maxYearIdx = Math.min(30, Math.max(0, Math.ceil(n)));
            for (let y = 0; y <= maxYearIdx; y++) {
                const bal = rAnnual === 0 ? W : W * Math.pow(1 + rAnnual, y);
                yearlyPath.push({ year: y, balance: bal });
            }

            return {
                fvLump,
                pvNeeded,
                gapLumpToday,
                shortfallAtEnd,
                monthlyExtra,
                yearlyPath,
                W,
                n,
                T,
                rPct,
                rAnnual,
                months,
            };
        };

export default function App() {
            // Auth & Security States (로컬스토리지 활용으로 자동 로그인)
            const [isAuthenticated, setIsAuthenticated] = useState(() => localStorage.getItem('isAuth') === 'true');
            const [loginSelectedUser, setLoginSelectedUser] = useState(() => localStorage.getItem('loginUser') || null);
            const [pinCode, setPinCode] = useState("");
            const [userPins, setUserPins] = useState({ jaeyoon: null, uijeong: null });

            // Navigation & Mode
            const [user, setUser] = useState(null);
            const [activeTab, setActiveTab] = useState('home');
            const [currentUserMode, setCurrentUserMode] = useState(() => localStorage.getItem('loginUser') || 'uijeong'); 
            const [isMenuOpen, setIsMenuOpen] = useState(true);

            // Touch Swipe States (모바일 개선)
            const [touchStartPos, setTouchStartPos] = useState(null);
            const [touchEndPos, setTouchEndPos] = useState(null);

            // Data States
            const [familyTasks, setFamilyTasks] = useState([]);
            const [sihaMemories, setSihaMemories] = useState([]);
            const [weightLogs, setWeightLogs] = useState([]);
            const [periodLogs, setPeriodLogs] = useState([]);
            const [calendarEvents, setCalendarEvents] = useState([]);
            const [monthlyChores, setMonthlyChores] = useState({});
            const [ledgerItems, setLedgerItems] = useState([]);
            const [personalDiaries, setPersonalDiaries] = useState([]);
            const [monthlyMaintenance, setMonthlyMaintenance] = useState({}); 
            
            // 교무수첩 할 일, 회의록, 시간표 States
            const [teacherTodos, setTeacherTodos] = useState([]);
            const [newTeacherTodo, setNewTeacherTodo] = useState("");
            const [meetingMinutes, setMeetingMinutes] = useState([]);
            const [showMinuteModal, setShowMinuteModal] = useState(false);
            const [newMinuteContent, setNewMinuteContent] = useState("");
            const [minuteDate, setMinuteDate] = useState(null);
            const [editingMinuteId, setEditingMinuteId] = useState(null);
            const [timetable, setTimetable] = useState({});

            // 카메라/음성 스캔 State
            const [isScanning, setIsScanning] = useState(false);
            const [isListening, setIsListening] = useState(false); // 음성 인식 상태
            const scanInputRef = useRef(null);
            
            // AI 스캔 일정 관리용 State 추가
            const [scannedEvents, setScannedEvents] = useState(null);
            const [scannedEventType, setScannedEventType] = useState('general');
            const [selectedScannedIndices, setSelectedScannedIndices] = useState([]);

            // UI Input States
            const [newMemoryText, setNewMemoryText] = useState("");
            const [uploadedImageBase64, setUploadedImageBase64] = useState(null);
            const [editingMemory, setEditingMemory] = useState(null); 
            const [viewingMemory, setViewingMemory] = useState(null); 
            // 가족 앨범 상세 → 사진만 전체 화면 + 핀치/드래그 확대
            const [memoryPhotoFullscreen, setMemoryPhotoFullscreen] = useState(false);
            const [fsScale, setFsScale] = useState(1);
            const [fsTx, setFsTx] = useState(0);
            const [fsTy, setFsTy] = useState(0);
            const fsScaleRef = useRef(1);
            const fsTxRef = useRef(0);
            const fsTyRef = useRef(0);
            const fsPinchRef = useRef(null);
            const fsPanRef = useRef(null);
            const memoryFsLayerRef = useRef(null);
            
            const [selectedEvent, setSelectedEvent] = useState(null); 

            const [inputWeight, setInputWeight] = useState("");
            const [viewDate, setViewDate] = useState(() => {
                const n = new Date();
                return new Date(n.getFullYear(), n.getMonth(), 1);
            });
            const [schoolViewDate, setSchoolViewDate] = useState(() => {
                const n = new Date();
                return new Date(n.getFullYear(), n.getMonth(), 1);
            });
            const [selectedDate, setSelectedDate] = useState(null);
            const [showEventModal, setShowEventModal] = useState(false);
            const [newEventTitle, setNewEventTitle] = useState("");
            const [newEventTime, setNewEventTime] = useState("");
            const [newEventMemo, setNewEventMemo] = useState("");
            const [newDiaryTitle, setNewDiaryTitle] = useState("");
            const [newDiaryContent, setNewDiaryContent] = useState("");
            
            // 캘린더 포인터(드래그) 상태
            const touchTimerRef = useRef(null);
            const touchStartCoordsRef = useRef({x: 0, y: 0}); // ★손가락 떨림 오차 범위를 계산하기 위한 좌표 저장
            const [pressingDate, setPressingDate] = useState(null);
            const [dragStart, setDragStart] = useState(null);
            const [dragEnd, setDragEnd] = useState(null);
            const [isDragging, setIsDragging] = useState(false);

            // Ledger Edit States
            const [showLedgerAddModal, setShowLedgerAddModal] = useState(false);
            const [newLedgerItem, setNewLedgerItem] = useState({ category: 'income_reg', title: '', amount: 0 });
            const [editingLedgerId, setEditingLedgerId] = useState(null);
            const [editAmount, setEditAmount] = useState("");

            // AI 버핏 (만 원 단위 입력)
            const [invPrincipal, setInvPrincipal] = useState("");
            const [invPctPension, setInvPctPension] = useState(25);
            const [invPctLong, setInvPctLong] = useState(35);
            const [invPctMid, setInvPctMid] = useState(25);
            const [invPctShort, setInvPctShort] = useState(15);
            const [invYears, setInvYears] = useState(10);
            const [invTarget, setInvTarget] = useState("");
            const [invTargetReturn, setInvTargetReturn] = useState(5);
            const [invEtfLoading, setInvEtfLoading] = useState(false);
            const [invEtfRows, setInvEtfRows] = useState([]);
            const [invEtfError, setInvEtfError] = useState(null);
            const [invLastFetchAt, setInvLastFetchAt] = useState(null);

            /** ETF 포트폴리오 시뮬: 검색·비중·시세 연동 */
            const [pfRows, setPfRows] = useState(() => {
                try {
                    const s = localStorage.getItem('pfPortfolioV1');
                    if (s) {
                        const p = JSON.parse(s);
                        if (Array.isArray(p) && p.length) {
                            return p.map((row, i) => ({
                                id: row.id || `pf-${i}-${row.symbol}`,
                                symbol: String(row.symbol || '').toUpperCase(),
                                description: row.description || '',
                                weightPct: typeof row.weightPct === 'number' ? row.weightPct : Number(row.weightPct) || 0,
                            }));
                        }
                    }
                } catch (e) {}
                return [];
            });
            const [pfSearch, setPfSearch] = useState('');
            const [pfSearchHits, setPfSearchHits] = useState([]);
            const [pfSearchLoading, setPfSearchLoading] = useState(false);
            const [pfSearchErr, setPfSearchErr] = useState(null);
            const [pfEtfOnly, setPfEtfOnly] = useState(true);
            const [pfManualTicker, setPfManualTicker] = useState('');
            const [pfPrincipal, setPfPrincipal] = useState('');
            const [pfYears, setPfYears] = useState(10);
            const [pfTarget, setPfTarget] = useState('');
            const [pfAnnualRate, setPfAnnualRate] = useState(5);
            const [pfAutoRateOnFetch, setPfAutoRateOnFetch] = useState(true);
            const [pfDataLoading, setPfDataLoading] = useState(false);
            const [pfDataErr, setPfDataErr] = useState(null);
            const [pfLastFetchAt, setPfLastFetchAt] = useState(null);

            // 단기 목표 프로젝트 (만 원 단위)
            const [shortTermGoals, setShortTermGoals] = useState([]);
            const [sgTitle, setSgTitle] = useState('');
            const [sgKind, setSgKind] = useState('car');
            const [sgTarget, setSgTarget] = useState('');
            const [sgSeed, setSgSeed] = useState('');

            const fileInputRef = useRef(null);
            const todayDate = new Date().getDate();
            const todayChore = CHORE_MASTER_LIST.find(c => c.id === todayDate);

            const tabOrder = ['home', 'calendar', 'chores', 'ledger', 'invest', 'portfolioSim', 'shortGoals', 'teacher', 'siha'];

            // 모바일 스와이프 핸들러 (캘린더 영역 예외 처리 추가)
            const handleTouchStart = (e) => {
                if (e.target.closest('.overflow-x-auto') || e.target.closest('input') || e.target.closest('textarea') || e.target.closest('.calendar-grid')) {
                    setTouchStartPos(null);
                    return;
                }
                setTouchEndPos(null);
                setTouchStartPos({ x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY });
            };

            const handleTouchMove = (e) => {
                if (!touchStartPos) return;
                setTouchEndPos({ x: e.targetTouches[0].clientX, y: e.targetTouches[0].clientY });
            };

            const handleTouchEnd = () => {
                if (!touchStartPos || !touchEndPos) return;
                const distanceX = touchStartPos.x - touchEndPos.x;
                const distanceY = touchStartPos.y - touchEndPos.y;
                
                if (Math.abs(distanceY) > Math.abs(distanceX)) return;

                const minSwipeDistance = 50;
                const isLeftSwipe = distanceX > minSwipeDistance;
                const isRightSwipe = distanceX < -minSwipeDistance;

                if (isLeftSwipe || isRightSwipe) {
                    const currentIndex = tabOrder.indexOf(activeTab);
                    if (isLeftSwipe && currentIndex < tabOrder.length - 1) {
                        setActiveTab(tabOrder[currentIndex + 1]);
                    }
                    if (isRightSwipe && currentIndex > 0) {
                        setActiveTab(tabOrder[currentIndex - 1]);
                    }
                }
            };

            // Firebase Auth Setup
            useEffect(() => {
                const initAuth = async () => {
                    try {
                        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                            await signInWithCustomToken(auth, __initial_auth_token);
                        } else {
                            await signInAnonymously(auth);
                        }
                    } catch (error) { console.error("Auth Error:", error); }
                };
                initAuth();
                const unsubscribe = onAuthStateChanged(auth, setUser);
                return () => unsubscribe();
            }, []);

            // 포트폴리오 시뮬: 티커·비중만 로컬 저장 (시세 캐시는 제외)
            useEffect(() => {
                try {
                    const slim = pfRows.map(({ id, symbol, description, weightPct }) => ({
                        id,
                        symbol,
                        description,
                        weightPct: Number(weightPct) || 0,
                    }));
                    localStorage.setItem('pfPortfolioV1', JSON.stringify(slim));
                } catch (e) {}
            }, [pfRows]);

            // Data Sync (에러 콜백 필수 적용)
            useEffect(() => {
                if (!user) return;
                const errCb = (err) => console.error("Snapshot Error:", err);

                const unsubTasks = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'familyTasks'), (snap) => setFamilyTasks(snap.docs.map(d => ({ id: d.id, ...d.data() }))), errCb);
                const unsubMemories = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'sihaMemories'), (snap) => setSihaMemories(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(b.date) - new Date(a.date))), errCb);
                const unsubEvents = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'calendarEvents'), (snap) => setCalendarEvents(snap.docs.map(d => ({ id: d.id, ...d.data() }))), errCb);
                const unsubChores = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'monthlyChores'), (snap) => {
                    const choresMap = {};
                    snap.docs.forEach(doc => { choresMap[doc.id] = doc.data().done; });
                    setMonthlyChores(choresMap);
                }, errCb);
                const unsubLedger = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'ledgerItems'), (snap) => {
                    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    if (items.length === 0) initializeLedger(); else setLedgerItems(items);
                }, errCb);
                const unsubWeight = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'weightLogs'), (snap) => setWeightLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(a.date) - new Date(b.date))), errCb);
                const unsubPeriod = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'periodLogs'), (snap) => setPeriodLogs(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(b.date) - new Date(a.date))), errCb);
                const unsubDiaries = onSnapshot(collection(db, 'artifacts', appId, 'users', user.uid, 'diaries'), (snap) => setPersonalDiaries(snap.docs.map(d => ({ id: d.id, ...d.data() })).sort((a,b) => new Date(b.date) - new Date(a.date))), errCb);

                const unsubPins = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'pins_v2'), (snap) => {
                    if (snap.exists()) setUserPins(snap.data());
                }, errCb);

                const unsubMaintenance = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'monthlyMaintenance'), (snap) => {
                    if (snap.exists()) setMonthlyMaintenance(snap.data());
                }, errCb);

                const unsubTeacherTodos = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'teacherTodos'), (snap) => {
                    const allTodos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    setTeacherTodos(allTodos.filter(t => t.owner === currentUserMode).sort((a,b) => (b.createdAt?.toMillis() || 0) - (a.createdAt?.toMillis() || 0)));
                }, errCb);
                
                const unsubMinutes = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'meetingMinutes'), (snap) => {
                    const allMins = snap.docs.map(d => ({ id: d.id, ...d.data() }));
                    setMeetingMinutes(allMins.filter(m => m.owner === currentUserMode).sort((a,b) => new Date(b.date) - new Date(a.date)));
                }, errCb);
                
                const unsubTimetable = onSnapshot(doc(db, 'artifacts', appId, 'public', 'data', 'timetables', currentUserMode), (snap) => {
                    if (snap.exists()) setTimetable(snap.data());
                    else setTimetable({});
                }, errCb);

                const unsubShortGoals = onSnapshot(collection(db, 'artifacts', appId, 'public', 'data', 'shortTermGoals'), (snap) => {
                    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
                    list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
                    setShortTermGoals(list);
                }, errCb);

                return () => { unsubTasks(); unsubMemories(); unsubEvents(); unsubChores(); unsubLedger(); unsubWeight(); unsubPeriod(); unsubDiaries(); unsubPins(); unsubMaintenance(); unsubTeacherTodos(); unsubMinutes(); unsubTimetable(); unsubShortGoals(); };
            }, [user, currentUserMode]);

            const initializeLedger = async () => {
                const currentMonth = new Date().getMonth() + 1;
                const initialItems = [
                    { category: 'income_reg', title: `${currentMonth}월 17일 살뜰 의정 월급`, amount: 330 },
                    { category: 'income_reg', title: `${currentMonth}월 17일 알뜰 재윤 월급`, amount: 320 },
                    { category: 'income_irr', title: '살뜰 의정 보너스', amount: 1419 },
                    { category: 'income_irr', title: '알뜰 재윤 보너스', amount: 1300 },
                    { category: 'expense_non', title: '교직원 공제회', amount: 75 },
                    { category: 'expense_non', title: '하나손해보험', amount: 30 },
                    { category: 'expense_non', title: 'KCGI 시하', amount: 36 },
                    { category: 'expense_non', title: '적금 시하', amount: 15 },
                    { category: 'expense_non', title: '보장성 보험(자녀)', amount: 24 },
                    { category: 'expense_non', title: 'KCGI 연금저축', amount: 50 },
                    { category: 'expense_non', title: '미래에셋 IRP', amount: 25 },
                    { category: 'expense_fix', title: '대출이자', amount: 106 },
                    { category: 'expense_fix', title: '교통/통신비', amount: 25 },
                    { category: 'expense_fix', title: '주식비(장보기)', amount: 70 },
                    { category: 'expense_var', title: '문화생활비', amount: 9 },
                    { category: 'expense_var', title: '경조사비', amount: 5 }
                ];
                for (const item of initialItems) {
                    try { await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'ledgerItems'), item); } catch(e){}
                }
            };

            const ledgerStats = useMemo(() => {
                const res = { incReg: 0, incIrr: 0, expNon: 0, expFix: 0, expVar: 0 };
                ledgerItems.forEach(item => {
                    if (item.category === 'income_reg') res.incReg += item.amount;
                    if (item.category === 'income_irr') res.incIrr += item.amount;
                    if (item.category === 'expense_non') res.expNon += item.amount;
                    if (item.category === 'expense_fix') res.expFix += item.amount;
                    if (item.category === 'expense_var') res.expVar += item.amount;
                });
                
                const round1 = (num) => Math.round(num * 10) / 10;
                res.incReg = round1(res.incReg);
                res.incIrr = round1(res.incIrr);
                res.expNon = round1(res.expNon);
                res.expFix = round1(res.expFix);
                res.expVar = round1(res.expVar);
                
                res.totalExp = round1(res.expNon + res.expFix + res.expVar);
                res.irrMonthly = Math.round(res.incIrr / 12); 
                res.netCashFlow = round1(res.incReg - res.totalExp);
                res.expRatio = res.incReg > 0 ? Math.min(100, round1((res.totalExp / res.incReg) * 100)) : 0; 
                return res;
            }, [ledgerItems]);

            const calendarDays = useMemo(() => {
                const year = viewDate.getFullYear(); const month = viewDate.getMonth();
                const days = []; const daysInMonth = new Date(year, month + 1, 0).getDate(); const firstDay = new Date(year, month, 1).getDay();
                for (let i = 0; i < firstDay; i++) days.push({ day: null, fullDate: null });
                for (let i = 1; i <= daysInMonth; i++) days.push({ day: i, fullDate: `${year}-${String(month+1).padStart(2,'0')}-${String(i).padStart(2,'0')}` });
                return days;
            }, [viewDate]);

            const schoolCalendarDays = useMemo(() => {
                const year = schoolViewDate.getFullYear(); const month = schoolViewDate.getMonth();
                const days = []; const daysInMonth = new Date(year, month + 1, 0).getDate(); const firstDay = new Date(year, month, 1).getDay();
                for (let i = 0; i < firstDay; i++) days.push({ day: null, fullDate: null });
                for (let i = 1; i <= daysInMonth; i++) days.push({ day: i, fullDate: `${year}-${String(month+1).padStart(2,'0')}-${String(i).padStart(2,'0')}` });
                return days;
            }, [schoolViewDate]);

            // ★ 캘린더 Pointer Events 수정됨 (터치/클릭 반응성 극대화)
            const handleCalendarPointerDown = (e) => {
                if (e.pointerType === 'mouse' && e.button !== 0) return; // 좌클릭만 허용
                const cell = e.target.closest('[data-date]');
                if (!cell) return;
                const date = cell.getAttribute('data-date');
                if (!date) return;

                if (e.pointerType === 'mouse') {
                    setIsDragging(true);
                    setDragStart(date);
                    setDragEnd(date);
                } else {
                    // 터치인 경우: 시작 좌표 저장 (오차범위 계산용)
                    touchStartCoordsRef.current = { x: e.clientX, y: e.clientY };
                    setPressingDate(date);
                    
                    touchTimerRef.current = setTimeout(() => {
                        setIsDragging(true);
                        setDragStart(date);
                        setDragEnd(date);
                        setPressingDate(null);
                        if (window.navigator?.vibrate) window.navigator.vibrate(50);
                    }, 600); // 0.6초로 단축하여 길게 누르기(드래그) 접근성 향상
                }
            };

            const handleCalendarPointerMove = (e) => {
                if (isDragging) {
                    const elem = document.elementFromPoint(e.clientX, e.clientY);
                    if (elem) {
                        const cell = elem.closest('[data-date]');
                        if (cell) {
                            const dateStr = cell.getAttribute('data-date');
                            if (dateStr && dragEnd !== dateStr) {
                                setDragEnd(dateStr);
                            }
                        }
                    }
                } else if (pressingDate && touchTimerRef.current) {
                    // ★ 터치 중 미세한 손가락 떨림 허용 (오차 범위 15px)
                    const dx = Math.abs(e.clientX - touchStartCoordsRef.current.x);
                    const dy = Math.abs(e.clientY - touchStartCoordsRef.current.y);
                    if (dx > 15 || dy > 15) {
                        clearTimeout(touchTimerRef.current);
                        touchTimerRef.current = null;
                        setPressingDate(null);
                    }
                }
            };

            const handleCalendarPointerUp = (e) => {
                if (touchTimerRef.current) {
                    clearTimeout(touchTimerRef.current);
                    touchTimerRef.current = null;
                }
                
                // 짧은 터치(클릭) 판별: 드래그가 아니고 pressingDate가 살아있을 때 즉시 모달 오픈
                if (pressingDate && !isDragging) {
                    setSelectedDate(pressingDate);
                    setShowEventModal(true);
                    setPressingDate(null);
                }
                
                if (isDragging) {
                    setIsDragging(false);
                    if (dragStart && dragEnd) {
                        const d1 = new Date(dragStart); const d2 = new Date(dragEnd);
                        const start = d1 <= d2 ? dragStart : dragEnd;
                        const end = d1 <= d2 ? dragEnd : dragStart;
                        setSelectedDate(start === end ? start : `${start} ~ ${end}`);
                        setShowEventModal(true);
                    }
                    // 모달 창이 뜬 후 상태를 리셋해줍니다.
                    setDragStart(null);
                    setDragEnd(null);
                }
            };

            const handleLoginSubmit = async () => {
                if (!pinCode) return;
                const currentPin = userPins[loginSelectedUser];
                if (!currentPin) {
                    try {
                        await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'pins_v2'), {
                            [loginSelectedUser]: pinCode
                        }, { merge: true });
                        
                        localStorage.setItem('isAuth', 'true');
                        localStorage.setItem('loginUser', loginSelectedUser);
                        setCurrentUserMode(loginSelectedUser);
                        setIsAuthenticated(true);
                        setPinCode("");
                    } catch (err) { console.error(err); }
                } else {
                    if (pinCode === currentPin) {
                        localStorage.setItem('isAuth', 'true');
                        localStorage.setItem('loginUser', loginSelectedUser);
                        setCurrentUserMode(loginSelectedUser);
                        setIsAuthenticated(true);
                        setPinCode("");
                    } else {
                        alert("비밀번호가 일치하지 않습니다.");
                        setPinCode("");
                    }
                }
            };

            const handleLogout = () => {
                localStorage.removeItem('isAuth');
                localStorage.removeItem('loginUser');
                setIsAuthenticated(false);
                setLoginSelectedUser(null);
                setPinCode("");
            };

            const handleImageUpload = (e) => {
                const file = e.target.files[0];
                if (!file) return;

                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (event) => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const MAX_WIDTH = 600;
                        const scaleSize = MAX_WIDTH / img.width;
                        canvas.width = MAX_WIDTH;
                        canvas.height = img.height * scaleSize;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        const compressedBase64 = canvas.toDataURL('image/jpeg', 0.6);
                        setUploadedImageBase64(compressedBase64);
                    };
                };
            };

            const handleEditImageUpload = (e) => {
                const file = e.target.files[0];
                if (!file) return;
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (event) => {
                    const img = new Image();
                    img.src = event.target.result;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        const MAX_WIDTH = 600;
                        const scaleSize = MAX_WIDTH / img.width;
                        canvas.width = MAX_WIDTH;
                        canvas.height = img.height * scaleSize;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                        setEditingMemory({...editingMemory, image: canvas.toDataURL('image/jpeg', 0.6)});
                    };
                };
            };

            const downloadImage = async (url, filename) => {
                try {
                    if (typeof url === 'string' && url.startsWith('data:')) {
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = filename;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        return;
                    }

                    const response = await fetch(url, { mode: 'cors' });
                    if (!response.ok) throw new Error(`이미지 다운로드 실패 (${response.status})`);
                    const blob = await response.blob();
                    const objectUrl = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = objectUrl;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                    URL.revokeObjectURL(objectUrl);
                } catch (err) {
                    console.error(err);
                    alert("다운로드 중 오류가 발생했습니다. (외부 이미지의 경우 브라우저 정책으로 제한될 수 있어요)");
                }
            };

            useEffect(() => {
                fsScaleRef.current = fsScale;
                fsTxRef.current = fsTx;
                fsTyRef.current = fsTy;
            }, [fsScale, fsTx, fsTy]);

            useEffect(() => {
                // 상세 모달을 바꿀 때마다 전체 화면 사진 뷰 초기화
                setMemoryPhotoFullscreen(false);
                setFsScale(1);
                setFsTx(0);
                setFsTy(0);
            }, [viewingMemory?.id]);

            useEffect(() => {
                // 상세 모달이 닫히면 전체 화면 사진 상태도 함께 정리 (같은 항목 재오픈 시 id 동일해도 안전)
                if (!viewingMemory) {
                    setMemoryPhotoFullscreen(false);
                    setFsScale(1);
                    setFsTx(0);
                    setFsTy(0);
                    fsPinchRef.current = null;
                    fsPanRef.current = null;
                }
            }, [viewingMemory]);

            // iOS 등에서 전체 화면 핀치 중 뒤로 스크롤·바운스 방지
            useEffect(() => {
                const el = memoryFsLayerRef.current;
                if (!el || !memoryPhotoFullscreen) return;
                const preventScroll = (e) => { e.preventDefault(); };
                el.addEventListener('touchmove', preventScroll, { passive: false });
                return () => el.removeEventListener('touchmove', preventScroll);
            }, [memoryPhotoFullscreen]);

            const closeMemoryPhotoFullscreen = () => {
                setMemoryPhotoFullscreen(false);
                setFsScale(1);
                setFsTx(0);
                setFsTy(0);
                fsPinchRef.current = null;
                fsPanRef.current = null;
            };

            const openMemoryPhotoFullscreen = () => {
                setMemoryPhotoFullscreen(true);
                setFsScale(1);
                setFsTx(0);
                setFsTy(0);
                fsPinchRef.current = null;
                fsPanRef.current = null;
            };

            /** 가족 앨범 전체 화면 사진: 두 손가락 핀치로 확대/축소, 확대 시 한 손가락으로 이동 */
            const handleMemoryFsTouchStart = (e) => {
                if (e.touches.length === 2) {
                    const t0 = e.touches[0], t1 = e.touches[1];
                    const d0 = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
                    fsPinchRef.current = { d0, scale0: fsScaleRef.current };
                    fsPanRef.current = null;
                } else if (e.touches.length === 1 && fsScaleRef.current > 1.01) {
                    const t = e.touches[0];
                    fsPanRef.current = {
                        x0: t.clientX,
                        y0: t.clientY,
                        tx0: fsTxRef.current,
                        ty0: fsTyRef.current
                    };
                }
            };

            const handleMemoryFsTouchMove = (e) => {
                if (e.touches.length >= 2 && fsPinchRef.current) {
                    const t0 = e.touches[0], t1 = e.touches[1];
                    const d = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
                    const { d0, scale0 } = fsPinchRef.current;
                    let newScale = scale0 * (d / d0);
                    newScale = Math.min(6, Math.max(1, newScale));
                    setFsScale(newScale);
                    if (newScale <= 1.01) {
                        setFsTx(0);
                        setFsTy(0);
                    }
                } else if (e.touches.length === 1 && fsPanRef.current) {
                    const t = e.touches[0];
                    const p = fsPanRef.current;
                    setFsTx(p.tx0 + (t.clientX - p.x0));
                    setFsTy(p.ty0 + (t.clientY - p.y0));
                }
            };

            const handleMemoryFsTouchEnd = (e) => {
                if (e.touches.length < 2) fsPinchRef.current = null;
                if (e.touches.length === 1 && fsScaleRef.current > 1.01) {
                    const t = e.touches[0];
                    fsPanRef.current = {
                        x0: t.clientX,
                        y0: t.clientY,
                        tx0: fsTxRef.current,
                        ty0: fsTyRef.current
                    };
                }
                if (e.touches.length === 0) fsPanRef.current = null;
            };

            const handleMemoryFsWheel = (e) => {
                e.preventDefault();
                e.stopPropagation();
                const factor = e.deltaY > 0 ? 0.9 : 1.1;
                setFsScale((s) => {
                    const n = Math.min(6, Math.max(1, s * factor));
                    if (n <= 1.01) {
                        setFsTx(0);
                        setFsTy(0);
                    }
                    return n;
                });
            };

            const handleUpdateAmount = async (id) => { if (!user) return; try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'ledgerItems', id), { amount: parseFloat(editAmount) || 0 }); setEditingLedgerId(null); } catch (err) { console.error(err); } };
            const handleAddLedger = async () => { if (!newLedgerItem.title || !user) return; try { await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'ledgerItems'), { ...newLedgerItem, amount: parseFloat(newLedgerItem.amount) || 0, createdAt: serverTimestamp() }); setNewLedgerItem({ category: 'income_reg', title: '', amount: 0 }); setShowLedgerAddModal(false); } catch (err) { console.error(err); } };
            const deleteLedgerItem = async (id) => { if (!user) return; try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'ledgerItems', id)); } catch (err) { console.error(err); } };
            const toggleMonthlyChore = async (day) => { if (!user) return; const currentStatus = monthlyChores[day] || false; try { await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'monthlyChores', day.toString()), { done: !currentStatus, updatedAt: serverTimestamp() }); } catch (err) { console.error(err); } };
            const handleAddWeight = async () => { if (!inputWeight || !user) return; try { await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'weightLogs'), { date: new Date().toISOString().split('T')[0], weight: parseFloat(inputWeight), createdAt: serverTimestamp() }); setInputWeight(""); } catch (err) { console.error(err); } };
            const handleAddPeriod = async () => { if (!user) return; try { await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'periodLogs'), { startDate: new Date().toISOString().split('T')[0], createdAt: serverTimestamp() }); } catch (err) { console.error(err); } };
            
            const handleMaintenanceChange = async (month, value) => {
                if (!user) return;
                const val = value === '' ? '' : Number(value);
                const newMaintenance = { ...monthlyMaintenance, [month]: val };
                setMonthlyMaintenance(newMaintenance);
                try {
                    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'appSettings', 'monthlyMaintenance'), { [month]: val }, { merge: true });
                } catch (err) { console.error(err); }
            };

            const handleAddMemory = async () => { 
                if (!newMemoryText.trim() || !user) return; 
                const newEntry = { 
                    date: new Date().toISOString().split('T')[0], 
                    title: newMemoryText.substring(0, 15), 
                    content: newMemoryText, 
                    author: currentUserMode === 'uijeong' ? '살뜰 의정' : '알뜰 재윤', 
                    image: uploadedImageBase64 || "https://images.unsplash.com/photo-1519331379826-f10be5486c6f?w=800&q=80", 
                    tags: ["일상"], 
                    createdAt: serverTimestamp() 
                }; 
                try { 
                    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'sihaMemories'), newEntry); 
                    setNewMemoryText(""); setUploadedImageBase64(null);
                } catch (err) { console.error(err); } 
            };

            const deleteMemory = async (id) => {
                if (!user) return;
                try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'sihaMemories', id)); } 
                catch (err) { console.error(err); }
            };

            const handleDeleteEvent = async (id) => {
                if (!user) return;
                try {
                    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'calendarEvents', id));
                    setSelectedEvent(null);
                } catch (err) { console.error(err); }
            };

            const handleUpdateMemory = async () => {
                if (!editingMemory || !user) return;
                try {
                    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'sihaMemories', editingMemory.id), {
                        title: editingMemory.content.substring(0, 15),
                        content: editingMemory.content,
                        image: editingMemory.image,
                        updatedAt: serverTimestamp()
                    });
                    setEditingMemory(null);
                } catch (err) { console.error(err); }
            };
            
            const handleAddEvent = async () => { 
                if (!newEventTitle.trim()) {
                    alert("일정 제목을 입력해주세요.");
                    return;
                }
                if (!selectedDate || !user) {
                    alert(!selectedDate ? "날짜가 선택되지 않았습니다." : "사용자 정보가 없습니다.");
                    return; 
                }
                
                const eventType = activeTab === 'teacher' ? 'school' : 'general';
                const baseEvent = {
                    title: newEventTitle, 
                    time: newEventTime, 
                    memo: newEventMemo, 
                    type: eventType, 
                    author: currentUserMode === 'uijeong' ? '살뜰 의정' : '알뜰 재윤',
                    owner: currentUserMode, 
                    createdAt: serverTimestamp() 
                };
                const dateToSave = selectedDate;

                // UI를 즉각적으로 닫아 대기 현상(먹통 현상) 방지
                setNewEventTitle(""); setNewEventTime(""); setNewEventMemo(""); 
                setShowEventModal(false); setDragStart(null); setDragEnd(null); setIsDragging(false);

                try { 
                    if (dateToSave.includes('~')) {
                        const [startDateStr, endDateStr] = dateToSave.split(' ~ ');
                        const start = new Date(startDateStr);
                        const end = new Date(endDateStr);
                        let current = new Date(start);
                        
                        while (current <= end) {
                            const pad = (n) => String(n).padStart(2, '0');
                            const dateStr = `${current.getFullYear()}-${pad(current.getMonth()+1)}-${pad(current.getDate())}`;
                            await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'calendarEvents'), { 
                                ...baseEvent, date: dateStr 
                            });
                            current.setDate(current.getDate() + 1);
                        }
                    } else {
                        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'calendarEvents'), { 
                            ...baseEvent, date: dateToSave
                        }); 
                    }
                } catch (err) { 
                    console.error(err); 
                    alert("일정 등록 중 오류가 발생했습니다: " + err.message);
                } 
            };

            const handleAddTeacherTodo = async () => {
                if (!newTeacherTodo.trim() || !user) return;
                try {
                    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'teacherTodos'), {
                        task: newTeacherTodo, isDone: false, owner: currentUserMode, createdAt: serverTimestamp()
                    });
                    setNewTeacherTodo("");
                } catch (err) { console.error(err); }
            };

            const toggleTeacherTodo = async (id, currentStatus) => {
                if (!user) return;
                try { await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'teacherTodos', id), { isDone: !currentStatus, updatedAt: serverTimestamp() }); } catch (err) { console.error(err); }
            };

            const deleteTeacherTodo = async (id) => {
                if (!user) return;
                try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'teacherTodos', id)); } catch (err) { console.error(err); }
            };

            const handleAddMinute = async () => {
                if (!newMinuteContent.trim() || !minuteDate || !user) return;
                try {
                    if (editingMinuteId) {
                        await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'meetingMinutes', editingMinuteId), {
                            content: newMinuteContent,
                            updatedAt: serverTimestamp()
                        });
                    } else {
                        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'meetingMinutes'), {
                            date: minuteDate, content: newMinuteContent, owner: currentUserMode, createdAt: serverTimestamp()
                        });
                    }
                    setNewMinuteContent(""); setShowMinuteModal(false); setMinuteDate(null); setEditingMinuteId(null);
                } catch (err) { console.error(err); }
            };

            const deleteMinute = async (id) => {
                if (!user) return;
                try { await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'meetingMinutes', id)); } catch (err) { console.error(err); }
            };
            
            const handleAddDiary = async () => {
                if (!newDiaryTitle.trim() || !user) return;
                try {
                    await addDoc(collection(db, 'artifacts', appId, 'users', user.uid, 'diaries'), {
                        date: new Date().toISOString().split('T')[0],
                        title: newDiaryTitle,
                        content: newDiaryContent,
                        owner: currentUserMode,
                        createdAt: serverTimestamp()
                    });
                    setNewDiaryTitle(""); setNewDiaryContent("");
                } catch (err) { console.error(err); }
            };

            const handleTimetableChange = async (day, period, value) => {
                if (!user) return;
                const newTimetable = { ...timetable, [`${day}-${period}`]: value };
                setTimetable(newTimetable);
                try {
                    await setDoc(doc(db, 'artifacts', appId, 'public', 'data', 'timetables', currentUserMode), newTimetable, { merge: true });
                } catch (err) { console.error(err); }
            };

            // ★ 완벽하게 재구성된 AI 일정 스캔 로직 (스키마 강제 적용 + 에러 원인 상세 출력 + API Key 연동 엄격화)
            const handleScanImage = (e, targetType = 'school') => {
                const file = e.target.files[0];
                if (!file || !user) return;

                setIsScanning(true);
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = async () => {
                        try {
                            const canvas = document.createElement('canvas');
                            const MAX_WIDTH = 1024;
                            let scaleSize = 1;
                            if (img.width > MAX_WIDTH) scaleSize = MAX_WIDTH / img.width;
                            canvas.width = img.width * scaleSize;
                            canvas.height = img.height * scaleSize;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                            
                            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
                            const base64Data = dataUrl.split(',')[1];
                            
                            // 👇 깃허브 유출 방지를 위해 팝업창으로 입력받아 안전하게 기기에만 저장하는 방식
                            let apiKey = localStorage.getItem('gemini_api_key');
                            if (!apiKey) {
                                apiKey = window.prompt("보안을 위해 Gemini API 키를 직접 입력해주세요.\n(최초 1회만 입력하면 현재 기기에 안전하게 자동 저장됩니다.)");
                                if (!apiKey) {
                                    alert("API 키가 없으면 일정을 스캔할 수 없습니다.");
                                    setIsScanning(false);
                                    e.target.value = "";
                                    return;
                                }
                                localStorage.setItem('gemini_api_key', apiKey.trim());
                            }
                            
                            const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
                            
                            const promptText = `주어진 이미지에서 일정을 추출하세요. 기준 연/월: ${targetType === 'school' ? schoolViewDate.getFullYear() : viewDate.getFullYear()}년 ${targetType === 'school' ? schoolViewDate.getMonth() + 1 : viewDate.getMonth() + 1}월. 날짜는 YYYY-MM-DD 형식으로 작성하세요. 카테고리는 무조건 ${targetType === 'school' ? "'school_general', 'deadline', 'field_trip', 'lecture' 중 하나만" : "'general'만"} 작성하세요.`;

                            const payload = {
                                contents: [{
                                    role: "user",
                                    parts: [
                                        { text: promptText },
                                        { inlineData: { mimeType: "image/jpeg", data: base64Data } }
                                    ]
                                }],
                                generationConfig: {
                                    responseMimeType: "application/json",
                                    responseSchema: {
                                        type: "OBJECT",
                                        properties: {
                                            events: {
                                                type: "ARRAY",
                                                items: {
                                                    type: "OBJECT",
                                                    properties: {
                                                        title: { type: "STRING" },
                                                        date: { type: "STRING" },
                                                        time: { type: "STRING" },
                                                        memo: { type: "STRING" },
                                                        category: { type: "STRING" }
                                                    },
                                                    required: ["title", "date", "time", "memo", "category"]
                                                }
                                            }
                                        },
                                        required: ["events"]
                                    }
                                }
                            };

                            const response = await fetch(url, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(payload)
                            });

                            if (!response.ok) {
                                // 👇 404 에러(잘못된 키/모델) 발생 시에도 브라우저에 저장된 키를 강제 삭제
                                if (response.status === 400 || response.status === 403 || response.status === 404) {
                                    localStorage.removeItem('gemini_api_key');
                                    alert("API 키가 올바르지 않거나 만료되었습니다.\n확인을 누르시고 다시 스캔 버튼을 눌러 '새 API 키'를 정확히 입력해주세요.");
                                }
                                const errData = await response.text();
                                throw new Error(`API 통신 에러 (${response.status}): ${errData.substring(0, 150)}`);
                            }

                            const result = await response.json();
                            const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
                            if (!text) throw new Error("AI가 아무런 결과를 반환하지 않았습니다.");
                            
                            const parsedData = JSON.parse(text);
                            const events = parsedData.events || [];
                            
                            if (events.length === 0) {
                                alert("이미지에서 텍스트(일정)를 찾지 못했습니다. 화질이 선명한 사진인지 확인해주세요.");
                                setIsScanning(false);
                                return;
                            }

                            setScannedEvents(events);
                            setScannedEventType(targetType);
                            setSelectedScannedIndices(events.map((_, i) => i)); 
                        } catch (err) {
                            console.error(err);
                            alert("일정 추출 중 오류가 발생했습니다: \n" + err.message);
                        } finally {
                            setIsScanning(false);
                            e.target.value = ""; // 초기화
                        }
                    };
                    img.onerror = () => {
                        alert("이미지를 정상적으로 불러올 수 없습니다.\n아이폰(HEIC 형식)의 경우 화면 캡처 후 업로드하시거나, 일반 JPG/PNG 사진을 사용해주세요.");
                        setIsScanning(false);
                        e.target.value = "";
                    };
                    img.src = event.target.result;
                };
            };

            // ★ 새 기능: 음성 인식 (STT) + AI 분석 연동
            const handleVoiceInput = (targetType = 'school') => {
                const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
                if (!SpeechRecognition) {
                    alert("현재 브라우저에서는 음성 인식을 지원하지 않습니다. (크롬, 사파리, 엣지 최신 버전을 사용해주세요)");
                    return;
                }

                const recognition = new SpeechRecognition();
                recognition.lang = 'ko-KR';
                recognition.interimResults = false;
                recognition.maxAlternatives = 1;

                recognition.onstart = () => {
                    setIsListening(true);
                };

                recognition.onresult = async (event) => {
                    const transcript = event.results[0][0].transcript;
                    setIsListening(false);
                    setIsScanning(true); // AI 분석 중 로딩 표시 재사용
                    
                    try {
                        // 👇 음성 인식 부분도 팝업창으로 입력받아 안전하게 기기에만 저장하는 방식
                        let apiKey = localStorage.getItem('gemini_api_key');
                        if (!apiKey) {
                            apiKey = window.prompt("보안을 위해 Gemini API 키를 직접 입력해주세요.\n(최초 1회만 입력하면 현재 기기에 안전하게 자동 저장됩니다.)");
                            if (!apiKey) {
                                alert("API 키가 없으면 일정을 등록할 수 없습니다.");
                                setIsScanning(false);
                                return;
                            }
                            localStorage.setItem('gemini_api_key', apiKey.trim());
                        }
                        
                        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
                        
                        const promptText = `사용자의 음성 기록을 분석해서 일정을 추출하세요. 기준 연/월: ${targetType === 'school' ? schoolViewDate.getFullYear() : viewDate.getFullYear()}년 ${targetType === 'school' ? schoolViewDate.getMonth() + 1 : viewDate.getMonth() + 1}월. 날짜는 YYYY-MM-DD 형식으로 작성하세요. 카테고리는 무조건 ${targetType === 'school' ? "'school_general', 'deadline', 'field_trip', 'lecture' 중 하나만" : "'general'만"} 작성하세요. 음성 기록: "${transcript}"`;

                        const payload = {
                            contents: [{ role: "user", parts: [{ text: promptText }] }],
                            generationConfig: {
                                responseMimeType: "application/json",
                                responseSchema: {
                                    type: "OBJECT",
                                    properties: {
                                        events: {
                                            type: "ARRAY",
                                            items: {
                                                type: "OBJECT",
                                                properties: {
                                                    title: { type: "STRING" },
                                                    date: { type: "STRING" },
                                                    time: { type: "STRING" },
                                                    memo: { type: "STRING" },
                                                    category: { type: "STRING" }
                                                },
                                                required: ["title", "date", "time", "memo", "category"]
                                            }
                                        }
                                    },
                                    required: ["events"]
                                }
                            }
                        };

                        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
                        if (!response.ok) {
                            // 👇 음성 인식 쪽도 동일하게 404 조건 추가
                            if (response.status === 400 || response.status === 403 || response.status === 404) {
                                localStorage.removeItem('gemini_api_key');
                                alert("API 키가 올바르지 않거나 만료되었습니다.\n확인을 누르시고 다시 음성 버튼을 눌러 '새 API 키'를 정확히 입력해주세요.");
                            }
                            const errData = await response.text();
                            throw new Error(`API 통신 에러 (${response.status}): ${errData.substring(0, 150)}`);
                        }
                        
                        const result = await response.json();
                        const text = result.candidates?.[0]?.content?.parts?.[0]?.text;
                        const parsedData = JSON.parse(text);
                        const events = parsedData.events || [];
                        
                        if (events.length === 0) {
                            alert("음성에서 명확한 일정 정보를 찾지 못했습니다. 다시 말씀해주세요.");
                            return;
                        }

                        // 분석된 결과를 기존 스캔 모달로 전달하여 확인 후 등록하도록 처리
                        setScannedEvents(events);
                        setScannedEventType(targetType);
                        setSelectedScannedIndices(events.map((_, i) => i)); 
                    } catch (err) {
                        console.error(err);
                        alert("음성 분석 중 오류가 발생했습니다: " + err.message);
                    } finally {
                        setIsScanning(false);
                    }
                };

                recognition.onerror = (event) => {
                    setIsListening(false);
                    alert("음성 인식 오류가 발생했습니다: " + event.error);
                };

                recognition.onend = () => {
                    setIsListening(false);
                };

                recognition.start();
            };

            const todayYmd = (() => {
                const n = new Date();
                return `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;
            })();

            const menuItems = [
                { id: 'home', icon: Home, label: '홈' },
                { id: 'calendar', icon: CalendarIcon, label: '공용 일정' },
                { id: 'chores', icon: ClipboardCheck, label: '집안일' },
                { id: 'ledger', icon: Wallet, label: '가계부' },
                { id: 'invest', icon: PieChart, label: 'AI 버핏' },
                { id: 'portfolioSim', icon: Layers, label: '포트폴리오 시뮬' },
                { id: 'shortGoals', icon: TargetIcon, label: '단기 목표' },
                { id: 'teacher', icon: BookOpen, label: '교무수첩' },
                { id: 'siha', icon: Heart, label: '우리 가족 일기' },
            ];

            const invPctSum = invPctPension + invPctLong + invPctMid + invPctShort;
            const invPctOk = Math.abs(invPctSum - 100) < 0.01;

            const pfWeightSum = useMemo(() => pfRows.reduce((a, r) => a + (Number(r.weightPct) || 0), 0), [pfRows]);
            const pfPctOk = Math.abs(pfWeightSum - 100) < 0.05;
            const pfBlended1y = useMemo(() => {
                let b = 0;
                let has = false;
                pfRows.forEach((r) => {
                    if (r.ret1y != null && Number.isFinite(r.ret1y)) {
                        b += ((Number(r.weightPct) || 0) / 100) * r.ret1y;
                        has = true;
                    }
                });
                return has ? Math.round(b * 10) / 10 : null;
            }, [pfRows]);

            const genPfId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

            const equalizePfWeights = (rows) => {
                const n = rows.length;
                if (n === 0) return [];
                const each = Math.floor(1000 / n) / 10;
                let acc = 0;
                return rows.map((r, i) => {
                    if (i === n - 1) return { ...r, weightPct: Math.round((100 - acc) * 10) / 10 };
                    acc += each;
                    return { ...r, weightPct: each };
                });
            };

            /** 포트폴리오 시뮬: ETF 검색 */
            const runPfSearch = async () => {
                setPfSearchLoading(true);
                setPfSearchErr(null);
                setPfSearchHits([]);
                try {
                    const fr = await fetchFinnhubSymbolSearch(pfSearch, FINNHUB_API_KEY);
                    if (!fr.ok) {
                        setPfSearchErr(fr.error || '검색에 실패했습니다.');
                        return;
                    }
                    let list = fr.result || [];
                    if (pfEtfOnly) list = list.filter(isLikelyEtfSymbolResult);
                    setPfSearchHits(list.slice(0, 50));
                } catch (e) {
                    setPfSearchErr('검색 중 오류가 났습니다.');
                } finally {
                    setPfSearchLoading(false);
                }
            };

            const addPfRow = (symbol, description) => {
                let sym = String(symbol || '').toUpperCase().replace(/\s+/g, '');
                if (sym.includes(':')) sym = sym.split(':').pop() || sym;
                if (!sym) return;
                setPfRows((prev) => {
                    if (prev.some((r) => r.symbol === sym)) return prev;
                    const next = [...prev, { id: genPfId(), symbol: sym, description: description || '', weightPct: 0 }];
                    return equalizePfWeights(next);
                });
            };

            const removePfRow = (id) => {
                setPfRows((prev) => equalizePfWeights(prev.filter((r) => r.id !== id)));
            };

            const updatePfWeight = (id, raw) => {
                const v = parseFloat(String(raw).replace(/,/g, ''));
                const w = Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
                setPfRows((prev) => prev.map((r) => (r.id === id ? { ...r, weightPct: w } : r)));
            };

            /** 포트폴리오 시뮬: 시세·과거 수익률 (AI 버핏과 동일 파이프라인) */
            const runPortfolioDataFetch = async () => {
                if (!pfRows.length) {
                    alert('포트폴리오에 종목을 추가해 주세요.');
                    return;
                }
                if (!pfPctOk) {
                    alert('비중 합계가 100%가 되도록 맞춰 주세요.');
                    return;
                }
                const snapshot = pfRows.map((r) => ({ ...r }));
                const syms = snapshot.map((r) => r.symbol);
                setPfDataLoading(true);
                setPfDataErr(null);
                try {
                    let quotes = [];
                    let ok = false;
                    let errMsg = null;
                    const fr = await fetchFinnhubQuotesForSymbols(syms, FINNHUB_API_KEY);
                    if (fr.ok && fr.quotes && fr.quotes.length) {
                        quotes = fr.quotes;
                        ok = true;
                    } else if (fr.error) errMsg = fr.error;
                    if (!ok) {
                        const yh = await fetchYahooQuotesForSymbols(syms);
                        if (yh.ok && yh.quotes && yh.quotes.length) {
                            quotes = yh.quotes;
                            ok = true;
                        }
                        if (!ok && yh.error) errMsg = errMsg ? `${errMsg} ${yh.error}` : yh.error;
                    }
                    const qMap = {};
                    (quotes || []).forEach((q) => {
                        const s = q.symbol || '';
                        qMap[s] = q;
                        const base = s.split('.')[0];
                        if (base && base !== s) qMap[base] = q;
                    });
                    const retList = await Promise.all(syms.map((s) => fetchEtfHistoricalReturnsCombined(s, FINNHUB_API_KEY)));

                    let blended = 0;
                    let hasBlend = false;
                    const merged = snapshot.map((row, idx) => {
                        const q = qMap[row.symbol] || qMap[row.symbol.split('.')[0]] || {};
                        const hist = retList[idx] || { ret1y: null, ret5y: null };
                        const w = (Number(row.weightPct) || 0) / 100;
                        if (hist.ret1y != null && Number.isFinite(hist.ret1y)) {
                            blended += w * hist.ret1y;
                            hasBlend = true;
                        }
                        return {
                            ...row,
                            ret1y: hist.ret1y,
                            ret5y: hist.ret5y,
                            price: q.regularMarketPrice ?? q.regularMarketPreviousClose ?? null,
                            chgPct: q.regularMarketChangePercent ?? null,
                            nameEn: q.shortName || q.longName || row.symbol,
                            currency: q.currency || 'USD',
                        };
                    });
                    setPfRows(merged);
                    if (pfAutoRateOnFetch && hasBlend) setPfAnnualRate(Math.round(blended * 10) / 10);
                    setPfDataErr(ok ? null : (errMsg || '일부 시세를 가져오지 못했을 수 있습니다.'));
                    setPfLastFetchAt(new Date());
                } catch (e) {
                    console.error(e);
                    setPfDataErr('시세·수익률 조회 중 오류가 났습니다.');
                } finally {
                    setPfDataLoading(false);
                }
            };

            /** 포트폴리오 시뮬: 저장된 1년 수익률로 가중 평균만 다시 반영 */
            const applyPfBlendedRateFromRows = () => {
                let blended = 0;
                let hasBlend = false;
                pfRows.forEach((r) => {
                    if (r.ret1y != null && Number.isFinite(r.ret1y)) {
                        blended += ((Number(r.weightPct) || 0) / 100) * r.ret1y;
                        hasBlend = true;
                    }
                });
                if (hasBlend) setPfAnnualRate(Math.round(blended * 10) / 10);
                else alert('먼저 시세·수익률을 불러오거나, 연 수익률을 직접 입력해 주세요.');
            };

            /** 포트폴리오 추천 + 시세 (Finnhub 우선 → 야후 프록시) */
            const runInvestAnalysis = async () => {
                if (!invPctOk) {
                    alert('투자 목표 비율 합계가 100%가 되도록 맞춰 주세요.');
                    return;
                }
                const plan = buildInvestEtfPlan(invPctPension, invPctLong, invPctMid, invPctShort);
                const syms = plan.map((r) => r.symbol);
                setInvEtfLoading(true);
                setInvEtfError(null);
                try {
                    let quotes = [];
                    let ok = false;
                    let errMsg = null;
                    const fr = await fetchFinnhubQuotesForSymbols(syms, FINNHUB_API_KEY);
                    if (fr.ok && fr.quotes && fr.quotes.length) {
                        quotes = fr.quotes;
                        ok = true;
                    } else if (fr.error) errMsg = fr.error;
                    if (!ok) {
                        const yh = await fetchYahooQuotesForSymbols(syms);
                        if (yh.ok && yh.quotes && yh.quotes.length) {
                            quotes = yh.quotes;
                            ok = true;
                        }
                        if (!ok && yh.error) errMsg = errMsg ? `${errMsg} ${yh.error}` : yh.error;
                    }
                    const qMap = {};
                    (quotes || []).forEach((q) => { qMap[q.symbol] = q; });
                    const retList = await Promise.all(
                        plan.map((row) => fetchEtfHistoricalReturnsCombined(row.symbol, FINNHUB_API_KEY))
                    );
                    const merged = plan.map((row, idx) => {
                        const q = qMap[row.symbol];
                        const hist = retList[idx] || { ret1y: null, ret5y: null };
                        return {
                            ...row,
                            price: q?.regularMarketPrice ?? q?.regularMarketPreviousClose ?? null,
                            chgPct: q?.regularMarketChangePercent ?? null,
                            nameEn: q?.shortName || q?.longName || row.symbol,
                            currency: q?.currency || 'USD',
                            ret1y: hist.ret1y,
                            ret5y: hist.ret5y,
                        };
                    });
                    setInvEtfRows(merged);
                    setInvEtfError(ok ? null : (errMsg || '시세를 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.'));
                    setInvLastFetchAt(new Date());
                } catch (e) {
                    console.error(e);
                    setInvEtfError('시세 조회 중 오류가 났습니다.');
                    setInvEtfRows(plan.map((row) => ({ ...row, price: null, chgPct: null, nameEn: row.symbol, currency: 'USD', ret1y: null, ret5y: null })));
                } finally {
                    setInvEtfLoading(false);
                }
            };

            /** 단기 목표: 추가 */
            const handleAddShortGoal = async () => {
                if (!user || !sgTitle.trim()) {
                    alert('목표 이름을 입력해 주세요.');
                    return;
                }
                const target = parseFloat(String(sgTarget).replace(/,/g, '')) || 0;
                if (target <= 0) {
                    alert('필요 금액(만 원)을 올바르게 입력해 주세요.');
                    return;
                }
                try {
                    await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'shortTermGoals'), {
                        title: sgTitle.trim(),
                        kind: sgKind,
                        targetMan: target,
                        seedMan: parseFloat(String(sgSeed).replace(/,/g, '')) || 0,
                        monthly: {},
                        createdAt: serverTimestamp(),
                        author: currentUserMode === 'uijeong' ? '살뜰 의정' : '알뜰 재윤',
                    });
                    setSgTitle('');
                    setSgTarget('');
                    setSgSeed('');
                    setSgKind('car');
                } catch (err) {
                    console.error(err);
                    alert('목표 저장에 실패했습니다.');
                }
            };

            /** 단기 목표: 월 납입액 갱신 */
            const handleShortGoalMonth = async (goalId, ym, rawVal) => {
                if (!user) return;
                const v = rawVal === '' ? 0 : parseFloat(String(rawVal).replace(/,/g, '')) || 0;
                try {
                    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shortTermGoals', goalId), {
                        [`monthly.${ym}`]: v,
                    });
                } catch (err) {
                    console.error(err);
                    alert('납입 금액 저장에 실패했습니다.');
                }
            };

            /** 단기 목표: 초기/목표 금액 수정 */
            const handleShortGoalMeta = async (goalId, field, rawVal) => {
                if (!user) return;
                const v = parseFloat(String(rawVal).replace(/,/g, '')) || 0;
                try {
                    await updateDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shortTermGoals', goalId), { [field]: v });
                } catch (err) {
                    console.error(err);
                }
            };

            /** 단기 목표: 삭제 */
            const handleDeleteShortGoal = async (goalId) => {
                if (!user || !confirm('이 목표를 삭제할까요?')) return;
                try {
                    await deleteDoc(doc(db, 'artifacts', appId, 'public', 'data', 'shortTermGoals', goalId));
                } catch (err) {
                    console.error(err);
                    alert('삭제에 실패했습니다.');
                }
            };

            if (!isAuthenticated) {
                return (
                    <div className="flex h-[100dvh] bg-paper-100 items-center justify-center p-4">
                        <div className="bg-paper-50 p-6 md:p-10 rounded-[2rem] shadow-xl w-full max-w-md text-center border border-stone-200">
                            <div className="w-16 h-16 bg-stone-700 text-white rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-md"><Home size={32}/></div>
                            <h1 className="text-2xl md:text-3xl font-black mb-8 text-paper-800 tracking-tight">우리집 홈노트</h1>
                            
                            {!loginSelectedUser ? (
                                <div className="space-y-4">
                                    <p className="text-stone-500 font-bold mb-4">접속할 계정을 선택하세요.</p>
                                    <button onClick={() => setLoginSelectedUser('uijeong')} className="w-full py-4 px-6 bg-white border border-stone-200 rounded-2xl flex items-center gap-4 hover:border-stone-400 hover:shadow-md transition-all">
                                        <div className="w-10 h-10 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center font-black">U</div>
                                        <div className="text-left"><p className="font-bold text-stone-800">살뜰 의정</p><p className="text-xs text-stone-400">삼봉초등학교</p></div>
                                    </button>
                                    <button onClick={() => setLoginSelectedUser('jaeyoon')} className="w-full py-4 px-6 bg-white border border-stone-200 rounded-2xl flex items-center gap-4 hover:border-stone-400 hover:shadow-md transition-all">
                                        <div className="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-black">J</div>
                                        <div className="text-left"><p className="font-bold text-stone-800">알뜰 재윤</p><p className="text-xs text-stone-400">성연초등학교</p></div>
                                    </button>
                                </div>
                            ) : (
                                <div className="space-y-6 animate-in fade-in zoom-in duration-300">
                                    <button onClick={() => setLoginSelectedUser(null)} className="text-sm text-stone-400 hover:text-stone-600 flex items-center justify-center mx-auto gap-1"><ChevronLeft size={16}/> 뒤로가기</button>
                                    <div className="w-16 h-16 rounded-full bg-stone-200 text-stone-700 flex items-center justify-center mx-auto font-black text-2xl mb-2">
                                        {loginSelectedUser === 'uijeong' ? 'U' : 'J'}
                                    </div>
                                    <h2 className="text-xl font-bold text-stone-800 mb-6">{loginSelectedUser === 'uijeong' ? '살뜰 의정' : '알뜰 재윤'}</h2>
                                    <div className="relative">
                                        <Lock size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-stone-400" />
                                        <input 
                                            type="password" 
                                            value={pinCode} 
                                            onChange={(e) => setPinCode(e.target.value)}
                                            onKeyPress={(e) => e.key === 'Enter' && handleLoginSubmit()}
                                            placeholder={userPins[loginSelectedUser] ? "비밀번호 4자리 입력" : "초기 비밀번호 4자리 설정"} 
                                            className="w-full bg-slate-100 border border-slate-400 rounded-2xl pl-12 pr-4 py-4 text-center tracking-[0.5em] font-black text-slate-900 placeholder:text-slate-500 focus:ring-2 focus:ring-slate-500 outline-none"
                                            maxLength={4}
                                        />
                                    </div>
                                    <button onClick={handleLoginSubmit} className="w-full py-4 bg-stone-800 text-white rounded-2xl font-black hover:bg-stone-900 transition-colors shadow-lg shadow-stone-200">입장하기</button>
                                </div>
                            )}
                        </div>
                    </div>
                );
            }

            return (
                <div className="flex h-[100dvh] bg-paper-100 text-paper-800 overflow-hidden font-sans relative antialiased">
                    {/* 데스크탑 사이드바 (모바일에서는 숨김) */}
                    <nav className={`hidden md:flex bg-paper-50 border-r border-stone-200 transition-all duration-300 ${isMenuOpen ? 'w-64' : 'w-20'} flex-col shrink-0 shadow-sm z-20`}>
                        <div className="p-6 flex items-center gap-3">
                            <div className="bg-stone-800 p-2 rounded-lg text-white"><Home size={24} /></div>
                            {isMenuOpen && <span className="font-bold text-xl tracking-tight text-stone-800">우리집</span>}
                        </div>
                        <div className="flex-1 px-3 space-y-1 overflow-y-auto">
                            {menuItems.map((item) => (
                                <button key={item.id} onClick={() => setActiveTab(item.id)} className={`w-full flex items-center gap-3 px-3 py-3 rounded-xl transition-all text-[15px] ${activeTab === item.id ? 'bg-stone-200 text-stone-800 font-bold shadow-sm' : 'text-stone-400 hover:bg-stone-100 hover:text-stone-700 font-semibold'}`}>
                                    <item.icon size={20} className={activeTab === item.id ? 'text-stone-800' : 'text-stone-400'} />
                                    {isMenuOpen && <span>{item.label}</span>}
                                </button>
                            ))}
                        </div>
                        <div className="p-4 border-t border-stone-200">
                            <button onClick={handleLogout} className="w-full flex items-center gap-3 p-3 bg-paper-100 rounded-xl hover:bg-stone-200 transition-colors border border-stone-200">
                                <div className="w-8 h-8 rounded-full bg-stone-300 flex items-center justify-center text-stone-700 font-bold">
                                    {currentUserMode === 'uijeong' ? 'U' : 'J'}
                                </div>
                                {isMenuOpen && (
                                    <div className="text-left">
                                        <p className="text-[10px] text-stone-500 font-bold uppercase tracking-widest">Logged In</p>
                                        <p className="text-sm font-semibold truncate text-stone-700">
                                            {currentUserMode === 'uijeong' ? '살뜰 의정 (삼봉초)' : '알뜰 재윤 (성연초)'}
                                        </p>
                                    </div>
                                )}
                            </button>
                        </div>
                    </nav>

                    <main className="flex-1 flex flex-col overflow-hidden bg-paper-100 relative">
                        <header className="h-16 bg-paper-50 border-b border-stone-200 px-4 md:px-8 flex items-center justify-between shrink-0 shadow-sm z-10">
                            <h2 className="text-xl md:text-2xl font-black text-stone-800 tracking-tight">{menuItems.find(i => i.id === activeTab)?.label}</h2>
                            <div className="flex items-center gap-2 md:gap-4">
                                <button className="p-2 text-stone-400 hover:text-stone-600 relative"><Bell size={20} /></button>
                                <button onClick={() => activeTab === 'ledger' ? setShowLedgerAddModal(true) : {}} className="bg-stone-800 text-white px-3 md:px-4 py-2 rounded-xl font-bold hover:bg-stone-900 transition-all flex items-center gap-2 shadow-sm text-sm md:text-base">
                                    <Plus size={18} /> <span className="hidden md:inline">항목 추가</span>
                                </button>
                            </div>
                        </header>

                        <div 
                            className="app-main-scroll flex-1 overflow-y-auto p-4 md:p-8 pb-24 md:pb-8 text-stone-800"
                            onTouchStart={handleTouchStart}
                            onTouchMove={handleTouchMove}
                            onTouchEnd={handleTouchEnd}
                        >
                            {/* 🏠 홈 탭 */}
                            {activeTab === 'home' && (
                                <div className="max-w-5xl mx-auto space-y-6">
                                    <section className="bg-stone-800 rounded-3xl p-6 md:p-8 text-white shadow-md relative overflow-hidden">
                                        <div className="absolute top-[-20px] right-[-20px] text-white opacity-5"><Calculator size={200}/></div>
                                        <h1 className="text-2xl md:text-3xl font-black mb-2 tracking-tighter">안녕하세요, {currentUserMode === 'uijeong' ? '살뜰 의정' : '알뜰 재윤'}! 👋</h1>
                                        <p className="opacity-90 text-sm md:text-lg text-stone-200">이번 달 현금흐름 요약: <span className="font-bold underline decoration-stone-400 decoration-4 text-white">월 소득 {ledgerStats.incReg}만 원</span></p>
                                        <p className="mt-4 text-xs md:text-sm opacity-90 font-medium flex items-center gap-2 text-stone-300">
                                           <ClipboardCheck size={16}/> 오늘의 집안일: {todayChore ? todayChore.task : "오늘의 정비"}
                                        </p>
                                    </section>

                                    {/* 각 메뉴 썸네일(카드)로 한눈에 보기 */}
                                    <section className="bg-paper-50 p-5 md:p-6 rounded-3xl border border-stone-200 shadow-sm">
                                        <div className="flex items-end justify-between gap-3 mb-4">
                                            <div>
                                                <h3 className="text-base md:text-lg font-black text-stone-800 tracking-tight">메뉴 한눈에 보기</h3>
                                                <p className="text-xs md:text-sm text-stone-500 font-semibold mt-1">하단 탭 없이도 썸네일을 눌러 바로 이동할 수 있어요.</p>
                                            </div>
                                            <div className="hidden md:flex items-center gap-1 text-[11px] font-bold text-stone-400">
                                                <span className="px-2 py-1 rounded-full bg-stone-100 border border-stone-200">클릭 → 탭 이동</span>
                                            </div>
                                        </div>

                                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                                            {[
                                                {
                                                    id: 'calendar',
                                                    icon: CalendarIcon,
                                                    label: '공용 일정',
                                                    desc: '가족 일정 등록/확인',
                                                    grad: 'from-indigo-50 to-slate-100',
                                                    accent: 'text-indigo-600'
                                                },
                                                {
                                                    id: 'chores',
                                                    icon: ClipboardCheck,
                                                    label: '집안일',
                                                    desc: '월간 루틴 체크',
                                                    grad: 'from-amber-50 to-slate-100',
                                                    accent: 'text-amber-600'
                                                },
                                                {
                                                    id: 'ledger',
                                                    icon: Wallet,
                                                    label: '가계부',
                                                    desc: '소득/지출 요약',
                                                    grad: 'from-emerald-50 to-slate-100',
                                                    accent: 'text-emerald-700'
                                                },
                                                {
                                                    id: 'invest',
                                                    icon: PieChart,
                                                    label: 'AI 버핏',
                                                    desc: '성향·목표·ETF 시세',
                                                    grad: 'from-teal-50 to-slate-100',
                                                    accent: 'text-teal-700'
                                                },
                                                {
                                                    id: 'portfolioSim',
                                                    icon: Layers,
                                                    label: '포트폴리오 시뮬',
                                                    desc: 'ETF 검색·비중·시뮬',
                                                    grad: 'from-cyan-50 to-slate-100',
                                                    accent: 'text-cyan-800'
                                                },
                                                {
                                                    id: 'shortGoals',
                                                    icon: TargetIcon,
                                                    label: '단기 목표',
                                                    desc: '저축·납입·진행률',
                                                    grad: 'from-violet-50 to-slate-100',
                                                    accent: 'text-violet-700'
                                                },
                                                {
                                                    id: 'teacher',
                                                    icon: BookOpen,
                                                    label: '교무수첩',
                                                    desc: '업무/회의록/시간표',
                                                    grad: 'from-sky-50 to-slate-100',
                                                    accent: 'text-sky-700'
                                                },
                                                {
                                                    id: 'siha',
                                                    icon: Heart,
                                                    label: '우리 가족 앨범',
                                                    desc: `${sihaMemories.length > 0 ? `최근 ${sihaMemories[0]?.date}` : '사진/글로 추억 저장'}`,
                                                    grad: 'from-rose-50 to-slate-100',
                                                    accent: 'text-rose-600'
                                                },
                                            ].map(card => (
                                                <button
                                                    key={card.id}
                                                    onClick={() => setActiveTab(card.id)}
                                                    type="button"
                                                    className={`home-menu-card group text-left bg-gradient-to-br ${card.grad} border border-slate-200/90 rounded-3xl p-4 md:p-5 shadow-sm hover:shadow-md transition-all`}
                                                >
                                                    <div className="flex items-start justify-between gap-3">
                                                        <div className="home-menu-icon-wrap w-11 h-11 md:w-12 md:h-12 rounded-2xl flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform">
                                                            <card.icon size={22} className={card.accent} />
                                                        </div>
                                                        <div className="home-menu-badge text-[11px] font-black px-2 py-1 rounded-full border">
                                                            바로가기
                                                        </div>
                                                    </div>
                                                    <div className="mt-3">
                                                        <p className="home-menu-title text-[15px] md:text-base tracking-tight">{card.label}</p>
                                                        <p className="home-menu-desc text-[13px] md:text-sm mt-1 line-clamp-2 leading-snug">{card.desc}</p>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </section>

                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-6">
                                        <div className="bg-paper-50 p-6 rounded-3xl shadow-sm border border-stone-200">
                                            <h3 className="font-bold flex items-center gap-2 mb-4 text-stone-800"><Wallet size={18} />가계부 현황</h3>
                                            <div className="flex justify-between items-center mb-2">
                                                <span className="text-stone-500 text-sm">정기소득 대비 지출</span>
                                                <span className={`text-sm font-bold ${ledgerStats.netCashFlow < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{ledgerStats.netCashFlow}만 원</span>
                                            </div>
                                            <div className="w-full bg-stone-200 h-2 rounded-full overflow-hidden">
                                                <div className="bg-stone-600 h-full" style={{ width: `${ledgerStats.expRatio}%` }}></div>
                                            </div>
                                        </div>
                                        <div className="bg-paper-50 p-6 rounded-3xl shadow-sm border border-stone-200">
                                            <h3 className="font-bold flex items-center gap-2 mb-4 text-stone-800"><Heart size={18} className="text-rose-400" />우리 가족 일기</h3>
                                            {sihaMemories[0] && <p className="text-sm font-bold truncate text-stone-700">{sihaMemories[0].title}</p>}
                                            {!sihaMemories[0] && <p className="text-xs text-stone-400 italic text-center py-2">최근 기록이 없습니다.</p>}
                                        </div>
                                        <div className="bg-paper-50 p-6 rounded-3xl shadow-sm border border-stone-200">
                                            <h3 className="font-bold flex items-center gap-2 mb-4 text-stone-800"><Activity size={18} className="text-emerald-600" />건강 관리</h3>
                                            <p className="text-2xl font-black text-stone-800">{weightLogs.length > 0 ? weightLogs[weightLogs.length-1].weight : '--'} <span className="text-sm font-normal">kg</span></p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 💰 가계부 탭 (집약형 디자인 적용) */}
                            {activeTab === 'ledger' && (
                                <div className="max-w-6xl mx-auto space-y-6">
                                    {/* 상단 통합 대시보드 */}
                                    <div className="bg-stone-800 p-6 md:p-8 rounded-3xl shadow-md text-white flex flex-col md:flex-row items-center justify-between gap-6 relative overflow-hidden">
                                        <div className="absolute top-[-20px] right-[-20px] text-white opacity-5"><Wallet size={150}/></div>
                                        <div className="flex-1 w-full text-center md:text-left z-10">
                                            <p className="text-stone-400 text-sm font-bold mb-1">매달 남는 돈 (순수익)</p>
                                            <p className={`text-3xl md:text-4xl font-black ${ledgerStats.netCashFlow < 0 ? 'text-rose-400' : 'text-emerald-400'}`}>{ledgerStats.netCashFlow} <span className="text-lg font-bold">만 원</span></p>
                                            <p className="text-xs mt-2 opacity-60">보너스 월 평균 {ledgerStats.irrMonthly}만 별도</p>
                                        </div>
                                        <div className="flex w-full md:w-auto gap-4 bg-stone-900/50 p-4 rounded-2xl border border-stone-700 z-10">
                                            <div className="flex-1 text-center px-2">
                                                <p className="text-stone-500 text-xs font-bold mb-1">정기 소득 (A)</p>
                                                <p className="text-xl font-black text-stone-200">{ledgerStats.incReg}만</p>
                                            </div>
                                            <div className="w-px bg-stone-700"></div>
                                            <div className="flex-1 text-center px-2">
                                                <p className="text-stone-500 text-xs font-bold mb-1">총 지출 (B)</p>
                                                <p className="text-xl font-black text-rose-400">{ledgerStats.totalExp}만</p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* 1~12월 관리비 그래프 영역 (높이 조절) */}
                                    <div className="bg-paper-50 p-4 rounded-3xl border border-stone-200 shadow-sm overflow-x-auto">
                                        <h3 className="font-bold text-sm flex items-center gap-2 mb-2 text-stone-800 min-w-max"><TrendingDown className="text-sky-600" size={16}/> 1년치 공과금 추이</h3>
                                        <div className="flex items-end gap-1 h-24 md:h-28 mt-2 min-w-[400px]">
                                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map(month => {
                                                const amount = monthlyMaintenance[month] || 0;
                                                const barHeight = Math.min(100, (amount / 50) * 100); 
                                                return (
                                                    <div key={month} className="flex-1 flex flex-col items-center justify-end gap-1 h-full group">
                                                        <div className="w-full bg-sky-100 rounded-t relative hover:bg-sky-200 transition-colors" style={{ height: `${barHeight}%`, minHeight: amount > 0 ? '4px' : '0' }}>
                                                            <div className="absolute -top-5 left-1/2 -translate-x-1/2 text-[9px] font-bold text-stone-600 opacity-0 group-hover:opacity-100 whitespace-nowrap z-10">
                                                                {amount > 0 ? `${amount}` : ''}
                                                            </div>
                                                        </div>
                                                        <span className="text-[9px] font-bold text-stone-500">{month}월</span>
                                                        <input
                                                            type="number"
                                                            step="0.1"
                                                            value={monthlyMaintenance[month] === undefined ? '' : monthlyMaintenance[month]}
                                                            onChange={(e) => handleMaintenanceChange(month, e.target.value)}
                                                            className="w-full bg-white border border-stone-200 rounded p-0.5 text-center text-[9px] outline-none focus:border-sky-400 focus:ring-1 focus:ring-sky-400 font-bold text-stone-700"
                                                            placeholder="입력"
                                                        />
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </div>

                                    {/* 리스트 영역 (압축형) */}
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6">
                                        <div className="bg-paper-50 rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
                                            <div className="bg-stone-100 px-4 py-3 border-b border-stone-200 flex items-center gap-2 font-black text-emerald-700">
                                                <TrendingUp size={18}/> 소득 내역
                                            </div>
                                            <div className="flex-1 overflow-y-auto">
                                                {['income_reg', 'income_irr'].map(cat => {
                                                    const items = ledgerItems.filter(i => i.category === cat);
                                                    if (items.length === 0) return null;
                                                    return (
                                                    <div key={cat}>
                                                        <div className="bg-stone-50 px-3 py-1 text-[10px] font-black text-stone-500 uppercase border-y border-stone-100 first:border-t-0">{cat === 'income_reg' ? '정기 소득' : '비정기 소득'}</div>
                                                        {items.map(item => (
                                                        <div key={item.id} className="py-2 px-3 md:px-4 flex justify-between items-center group hover:bg-stone-100 border-b border-stone-100 last:border-0 transition-colors">
                                                            <span className="text-xs md:text-sm font-semibold text-stone-800 truncate pr-2">{item.title}</span>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                            {editingLedgerId === item.id ? (
                                                                <div className="flex items-center gap-1">
                                                                    <input type="number" step="0.1" autoFocus value={editAmount} onChange={(e) => setEditAmount(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleUpdateAmount(item.id)} className="w-16 bg-white border border-stone-300 rounded px-1 text-xs font-bold text-stone-800"/>
                                                                    <button onClick={() => handleUpdateAmount(item.id)} className="p-1 bg-stone-700 text-white rounded"><Check size={12}/></button>
                                                                </div>
                                                            ) : (
                                                                <span onClick={() => { setEditingLedgerId(item.id); setEditAmount(item.amount); }} className="font-bold text-stone-800 text-xs md:text-sm cursor-pointer hover:text-stone-600 hover:underline">{item.amount}만</span>
                                                            )}
                                                            <button onClick={() => deleteLedgerItem(item.id)} className="text-stone-300 hover:text-rose-500 opacity-0 lg:opacity-0 group-hover:opacity-100 transition-opacity p-1"><Trash2 size={14}/></button>
                                                            </div>
                                                        </div>
                                                        ))}
                                                    </div>
                                                )})}
                                            </div>
                                        </div>

                                        <div className="bg-paper-50 rounded-3xl border border-stone-200 shadow-sm overflow-hidden flex flex-col">
                                            <div className="bg-stone-100 px-4 py-3 border-b border-stone-200 flex items-center gap-2 font-black text-rose-700">
                                                <TrendingDown size={18}/> 지출 내역
                                            </div>
                                            <div className="flex-1 overflow-y-auto">
                                                {['expense_non', 'expense_fix', 'expense_var'].map(cat => {
                                                    const items = ledgerItems.filter(i => i.category === cat);
                                                    if (items.length === 0) return null;
                                                    return (
                                                    <div key={cat}>
                                                        <div className="bg-stone-50 px-3 py-1 text-[10px] font-black text-rose-400 uppercase border-y border-stone-100 first:border-t-0">{cat === 'expense_non' ? '비소비성' : cat === 'expense_fix' ? '소비성 (고정)' : '소비성 (변동)'}</div>
                                                        {items.map(item => (
                                                        <div key={item.id} className="py-2 px-3 md:px-4 flex justify-between items-center group hover:bg-stone-100 border-b border-stone-100 last:border-0 transition-colors">
                                                            <span className="text-xs md:text-sm font-semibold text-stone-800 truncate pr-2">{item.title}</span>
                                                            <div className="flex items-center gap-2 shrink-0">
                                                            {editingLedgerId === item.id ? (
                                                                <div className="flex items-center gap-1">
                                                                    <input type="number" step="0.1" autoFocus value={editAmount} onChange={(e) => setEditAmount(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleUpdateAmount(item.id)} className="w-16 bg-white border border-rose-300 rounded px-1 text-xs font-bold text-stone-800"/>
                                                                    <button onClick={() => handleUpdateAmount(item.id)} className="p-1 bg-rose-600 text-white rounded"><Check size={12}/></button>
                                                                </div>
                                                            ) : (
                                                                <span onClick={() => { setEditingLedgerId(item.id); setEditAmount(item.amount); }} className="font-bold text-stone-800 text-xs md:text-sm cursor-pointer hover:text-rose-600 hover:underline">{item.amount}만</span>
                                                            )}
                                                            <button onClick={() => deleteLedgerItem(item.id)} className="text-stone-300 hover:text-rose-500 opacity-0 lg:opacity-0 group-hover:opacity-100 transition-opacity p-1"><Trash2 size={14}/></button>
                                                            </div>
                                                        </div>
                                                        ))}
                                                    </div>
                                                )})}
                                            </div>
                                        </div>
                                    </div>

                                    {showLedgerAddModal && (
                                        <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                                            <div className="bg-paper-50 rounded-3xl w-full max-w-md shadow-2xl p-6 md:p-8 border border-stone-200">
                                                <h3 className="text-xl md:text-2xl font-black mb-6 flex items-center gap-2 text-stone-800"><Plus className="text-stone-600"/> 항목 추가</h3>
                                                <div className="space-y-4">
                                                    <select value={newLedgerItem.category} onChange={(e) => setNewLedgerItem({...newLedgerItem, category: e.target.value})} className="w-full bg-white border border-stone-300 rounded-2xl px-4 py-3 text-sm focus:ring-2 focus:ring-stone-400 outline-none text-stone-800">
                                                        <option value="income_reg">정기 소득</option><option value="income_irr">비정기 소득</option><option value="expense_non">비소비성 지출</option><option value="expense_fix">소비성 지출 (고정)</option><option value="expense_var">소비성 지출 (변동)</option>
                                                    </select>
                                                    <input type="text" value={newLedgerItem.title} onChange={(e) => setNewLedgerItem({...newLedgerItem, title: e.target.value})} className="w-full bg-white border border-stone-300 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-stone-400 text-stone-800" placeholder={newLedgerItem.category === 'income_reg' ? `${new Date().getMonth() + 1}월 17일 월급` : "항목명 (예: 관리비/공과금)"} />
                                                    <input type="number" step="0.1" value={newLedgerItem.amount} onChange={(e) => setNewLedgerItem({...newLedgerItem, amount: e.target.value})} className="w-full bg-white border border-stone-300 rounded-2xl px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-stone-400 text-stone-800" placeholder="금액 (만원)" />
                                                    <div className="flex gap-3 pt-4">
                                                        <button onClick={() => setShowLedgerAddModal(false)} className="flex-1 py-4 bg-stone-200 text-stone-700 rounded-2xl font-bold hover:bg-stone-300 transition-colors">취소</button>
                                                        <button onClick={handleAddLedger} className="flex-1 py-4 bg-stone-800 text-white rounded-2xl font-bold hover:bg-stone-900 transition-colors">저장하기</button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 🧹 집안일 탭 */}
                            {activeTab === 'chores' && (
                                <div className="max-w-6xl mx-auto space-y-6">
                                    <div className="flex items-center justify-between">
                                        <div><h1 className="text-xl md:text-2xl font-bold flex items-center gap-2 text-stone-800"><ClipboardCheck className="text-stone-600" size={24} />월간 집안일 루틴</h1><p className="text-stone-500 text-xs md:text-sm mt-1">매월 1일부터 30일까지 정해진 집안일을 체크하세요.</p></div>
                                    </div>
                                    <div className="bg-paper-50 rounded-3xl border border-stone-200 overflow-hidden shadow-sm p-2 md:p-6">
                                        <div className="grid grid-cols-3 gap-2 md:gap-6">
                                            {[0, 1, 2].map(colIdx => (
                                            <div key={colIdx} className="flex flex-col border border-stone-200 rounded-xl overflow-hidden">
                                                <div className="p-2 md:p-4 bg-stone-100 border-b border-stone-200 font-bold text-[10px] md:text-xs text-stone-500 text-center">{colIdx * 10 + 1}일~{(colIdx + 1) * 10}일</div>
                                                {CHORE_MASTER_LIST.slice(colIdx * 10, (colIdx + 1) * 10).map((item) => {
                                                const isDone = monthlyChores[item.id] || false;
                                                const isToday = item.id === todayDate;
                                                return (
                                                    <div key={item.id} onClick={() => toggleMonthlyChore(item.id)} className={`flex items-center gap-1 md:gap-4 px-2 py-2 md:px-5 md:py-4 cursor-pointer hover:bg-stone-100 border-b border-stone-100 last:border-0 ${isToday ? 'bg-amber-50/50' : ''}`}>
                                                    <span className={`text-[9px] md:text-xs font-black ${isToday ? 'text-amber-600' : 'text-stone-400'}`}>{String(item.id).padStart(2, '0')}</span>
                                                    <span className={`flex-1 text-[10px] md:text-sm font-bold truncate ${isDone ? 'text-stone-400 line-through' : 'text-stone-700'}`}>{item.task}</span>
                                                    <div className={`w-3 h-3 md:w-6 md:h-6 rounded border md:border-2 flex items-center justify-center shrink-0 ${isDone ? 'bg-stone-600 border-stone-600 text-white' : isToday ? 'border-amber-400' : 'border-stone-300'}`}>{isDone && <Check size={10} />}</div>
                                                    </div>
                                                );
                                                })}
                                            </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 📅 일정 탭 */}
                            {activeTab === 'calendar' && (
                                <div className="max-w-6xl mx-auto space-y-6">
                                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                                        <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4">
                                            <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2 text-stone-800 shrink-0"><CalendarIcon className="text-stone-600"/> 공용 일정 ({viewDate.getFullYear()})</h1>
                                            {/* AI 일정 스캔 및 음성 인식 버튼 */}
                                            <div className="flex items-center gap-2">
                                                <div className="relative flex items-center">
                                                    <input type="file" accept="image/*" capture="environment" onChange={(e) => handleScanImage(e, 'general')} className="hidden" id="scan-calendar-general" />
                                                    <label htmlFor="scan-calendar-general" className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold border border-indigo-200 cursor-pointer hover:bg-indigo-100 transition-colors shadow-sm whitespace-nowrap">
                                                        <Camera size={14} /> AI 사진
                                                    </label>
                                                </div>
                                                <button onClick={() => handleVoiceInput('general')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors shadow-sm whitespace-nowrap ${isListening ? 'bg-rose-50 text-rose-600 border-rose-200 animate-pulse' : 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'}`}>
                                                    <Mic size={14} /> {isListening ? '듣는 중...' : '음성 등록'}
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2 md:gap-3 bg-paper-50 p-2 rounded-2xl border border-stone-200 shadow-sm self-start flex-wrap">
                                            <button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()-1, 1))} className="p-1 hover:bg-stone-200 rounded-lg text-stone-600"><ChevronLeft/></button>
                                            <span className="font-bold text-sm min-w-[100px] text-center text-stone-800">{viewDate.getFullYear()}년 {viewDate.getMonth() + 1}월</span>
                                            <button type="button" onClick={() => setViewDate(new Date(viewDate.getFullYear(), viewDate.getMonth()+1, 1))} className="p-1 hover:bg-stone-200 rounded-lg rotate-180 text-stone-600"><ChevronLeft/></button>
                                            <button
                                                type="button"
                                                onClick={() => { const n = new Date(); setViewDate(new Date(n.getFullYear(), n.getMonth(), 1)); }}
                                                className="text-[11px] font-black px-2.5 py-1 rounded-lg bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200"
                                            >
                                                오늘
                                            </button>
                                        </div>
                                    </div>
                                    <div className="bg-paper-50 rounded-3xl border border-stone-200 overflow-hidden shadow-sm">
                                        <div className="grid grid-cols-7 bg-stone-100 border-b border-stone-200 font-black text-[10px] text-stone-500 uppercase tracking-widest py-3">
                                            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => <div key={d} className={`text-center ${i===0?'text-rose-500':i===6?'text-blue-500':''}`}>{d}</div>)}
                                        </div>
                                        {/* 캘린더 그리드 영역: 포인터 이벤트 적용 */}
                                        <div 
                                            className="grid grid-cols-7 calendar-grid" 
                                            onPointerDown={handleCalendarPointerDown} 
                                            onPointerMove={handleCalendarPointerMove} 
                                            onPointerUp={handleCalendarPointerUp}
                                            onPointerCancel={handleCalendarPointerUp}
                                        >
                                            {calendarDays.map((d, i) => {
                                                let isSelected = false;
                                                if (isDragging && dragStart && dragEnd && d.fullDate) {
                                                    const current = new Date(d.fullDate);
                                                    const start = new Date(dragStart <= dragEnd ? dragStart : dragEnd);
                                                    const end = new Date(dragStart <= dragEnd ? dragEnd : dragStart);
                                                    isSelected = current >= start && current <= end;
                                                }
                                                const isTodayCell = Boolean(d.fullDate && d.fullDate === todayYmd);
                                                return (
                                                <div 
                                                    key={i} 
                                                    data-date={d.fullDate}
                                                    className={`min-h-[80px] md:min-h-[120px] border-r border-b border-stone-200 p-1 md:p-2 cursor-pointer transition-colors select-none ${!d.day ? 'bg-stone-100/30' : 'hover:bg-stone-100/50'} ${isTodayCell ? 'ring-2 ring-amber-400 ring-inset bg-amber-50/70 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)]' : ''} ${isSelected ? 'bg-indigo-500/20' : ''} ${pressingDate === d.fullDate ? 'bg-indigo-100 scale-[0.98]' : ''}`}
                                                >
                                                    <span className={`text-xs font-bold pl-1 md:pl-0 ${isTodayCell ? 'inline-flex items-center justify-center min-w-[1.35rem] h-6 rounded-full bg-amber-500 text-white shadow-sm' : i%7===0?'text-rose-500':i%7===6?'text-blue-500':'text-stone-500'}`}>{d.day}</span>
                                                    <div className="mt-1 space-y-1">
                                                        {calendarEvents.filter(e => e.date === d.fullDate && (!e.type || e.type === 'general')).map(e => (
                                                            <div key={e.id} onClick={(ev) => { ev.stopPropagation(); setSelectedEvent(e); }} className="text-[9px] md:text-[10px] bg-stone-200 hover:bg-stone-300 text-stone-800 p-1 md:p-1.5 rounded font-bold truncate flex justify-between group shadow-sm border border-stone-300 cursor-pointer transition-colors" title={e.memo ? `${e.time||''} ${e.memo}` : e.title}>
                                                                <span className="truncate">{e.time && <span className="mr-1 opacity-60">[{e.time}]</span>}{e.title}</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                                );
                                            })}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 🏫 교무수첩 탭 */}
                            {activeTab === 'teacher' && (
                                <div className="max-w-7xl mx-auto space-y-6 flex flex-col relative">
                                    {/* 로딩 모달 (스캔/음성 진행 중) */}
                                    {isScanning && (
                                        <div className="absolute inset-0 bg-stone-900/60 backdrop-blur-sm z-[100] flex flex-col items-center justify-center p-4 rounded-3xl">
                                            <div className="w-16 h-16 border-4 border-stone-200 border-t-indigo-500 rounded-full animate-spin mb-4"></div>
                                            <p className="text-white font-bold text-lg text-center">AI가 일정을 분석하고 있습니다...</p>
                                            <p className="text-stone-300 text-sm mt-2 text-center">잠시만 기다려주세요 (최대 10~20초 소요)</p>
                                        </div>
                                    )}

                                    <div className="flex flex-col md:flex-row md:items-center justify-between mb-2 shrink-0 gap-2">
                                        <h1 className="text-xl md:text-2xl font-black text-stone-800">
                                            {currentUserMode === 'uijeong' ? '삼봉초 교무수첩' : '성연초 6학년 학급 운영'}
                                        </h1>
                                        <span className="px-4 py-1 bg-stone-200 text-stone-800 rounded-full text-xs font-bold self-start md:self-auto">2026학년도</span>
                                    </div>
                                    
                                    {/* 상단: 달력(2칸) + 할 일(1칸) */}
                                    <div className="grid grid-cols-1 xl:grid-cols-3 gap-6 min-h-[500px]">
                                        <div className="xl:col-span-2 bg-paper-50 rounded-3xl border border-stone-200 shadow-sm flex flex-col overflow-hidden">
                                            <div className="p-4 flex flex-col md:flex-row md:items-center justify-between border-b border-stone-200 bg-stone-100 shrink-0 gap-4">
                                                <div className="flex flex-col md:flex-row md:items-center gap-2 md:gap-3">
                                                    <h3 className="font-bold flex items-center gap-2 text-stone-800 shrink-0"><CalendarIcon size={20} className="text-indigo-500"/> 월간 학사 일정표</h3>
                                                    {/* 일정 스캔 및 음성 인식 버튼 */}
                                                    <div className="flex items-center gap-2">
                                                        <div className="relative flex items-center">
                                                            <input type="file" accept="image/*" capture="environment" onChange={(e) => handleScanImage(e, 'school')} className="hidden" id="scan-calendar-school" />
                                                            <label htmlFor="scan-calendar-school" className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg text-xs font-bold border border-indigo-200 cursor-pointer hover:bg-indigo-100 transition-colors shadow-sm whitespace-nowrap">
                                                                <Camera size={14} /> AI 사진
                                                            </label>
                                                        </div>
                                                        <button onClick={() => handleVoiceInput('school')} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors shadow-sm whitespace-nowrap ${isListening ? 'bg-rose-50 text-rose-600 border-rose-200 animate-pulse' : 'bg-emerald-50 text-emerald-600 border-emerald-200 hover:bg-emerald-100'}`}>
                                                            <Mic size={14} /> {isListening ? '듣는 중...' : '음성 등록'}
                                                        </button>
                                                    </div>
                                                </div>
                                                <div className="flex items-center gap-2 bg-white p-1.5 rounded-xl border border-stone-200 shadow-sm self-start md:self-auto shrink-0 flex-wrap">
                                                    <button type="button" onClick={() => setSchoolViewDate(new Date(schoolViewDate.getFullYear(), schoolViewDate.getMonth()-1, 1))} className="p-1 hover:bg-stone-100 rounded-lg text-stone-600"><ChevronLeft size={16}/></button>
                                                    <span className="font-bold text-sm min-w-[80px] text-center text-stone-800">{schoolViewDate.getFullYear()}년 {schoolViewDate.getMonth() + 1}월</span>
                                                    <button type="button" onClick={() => setSchoolViewDate(new Date(schoolViewDate.getFullYear(), schoolViewDate.getMonth()+1, 1))} className="p-1 hover:bg-stone-100 rounded-lg rotate-180 text-stone-600"><ChevronLeft size={16}/></button>
                                                    <button
                                                        type="button"
                                                        onClick={() => { const n = new Date(); setSchoolViewDate(new Date(n.getFullYear(), n.getMonth(), 1)); }}
                                                        className="text-[10px] font-black px-2 py-1 rounded-lg bg-amber-100 text-amber-900 border border-amber-300 hover:bg-amber-200"
                                                    >
                                                        오늘
                                                    </button>
                                                </div>
                                            </div>
                                            <div className="grid grid-cols-7 bg-white border-b border-stone-100 font-black text-[10px] text-stone-400 uppercase tracking-widest py-2 shrink-0">
                                                {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d, i) => <div key={d} className={`text-center ${i===0?'text-rose-400':i===6?'text-blue-400':''}`}>{d}</div>)}
                                            </div>
                                            {/* 학사 일정 달력에도 Pointer Events 적용 */}
                                            <div 
                                                className="flex-1 grid grid-cols-7 bg-stone-50/30 calendar-grid"
                                                onPointerDown={handleCalendarPointerDown} 
                                                onPointerMove={handleCalendarPointerMove} 
                                                onPointerUp={handleCalendarPointerUp}
                                                onPointerCancel={handleCalendarPointerUp}
                                            >
                                                {schoolCalendarDays.map((d, i) => {
                                                    let isSelected = false;
                                                    if (isDragging && dragStart && dragEnd && d.fullDate) {
                                                        const current = new Date(d.fullDate);
                                                        const start = new Date(dragStart <= dragEnd ? dragStart : dragEnd);
                                                        const end = new Date(dragStart <= dragEnd ? dragEnd : dragStart);
                                                        isSelected = current >= start && current <= end;
                                                    }
                                                    const isTodayCell = Boolean(d.fullDate && d.fullDate === todayYmd);
                                                    return (
                                                    <div 
                                                        key={i} 
                                                        data-date={d.fullDate}
                                                        className={`min-h-[60px] md:min-h-[80px] border-r border-b border-stone-100 p-1 md:p-1.5 cursor-pointer transition-colors select-none ${!d.day ? 'bg-stone-50/80' : 'bg-white hover:bg-stone-100/50'} ${isTodayCell ? 'ring-2 ring-amber-400 ring-inset bg-amber-50/80 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.35)]' : ''} ${isSelected ? 'bg-indigo-500/20' : ''} ${pressingDate === d.fullDate ? 'bg-indigo-100 scale-[0.98]' : ''}`}
                                                    >
                                                        <span className={`text-[10px] font-bold pl-1 ${isTodayCell ? 'inline-flex items-center justify-center min-w-[1.2rem] h-5 rounded-full bg-amber-500 text-white shadow-sm' : i%7===0?'text-rose-400':i%7===6?'text-blue-400':'text-stone-500'}`}>{d.day}</span>
                                                        <div className="mt-1 flex flex-col gap-1">
                                                            {calendarEvents.filter(e => e.date === d.fullDate && e.type === 'school' && e.owner === currentUserMode).map(e => {
                                                                let bgClass = "bg-stone-100 text-stone-700 border-stone-200";
                                                                let icon = null;
                                                                if (e.category === 'deadline') { bgClass = "bg-rose-100 text-rose-700 border-rose-200"; icon = "🚨"; }
                                                                else if (e.category === 'field_trip') { bgClass = "bg-emerald-100 text-emerald-700 border-emerald-200"; icon = "🚌"; }
                                                                else if (e.category === 'lecture') { bgClass = "bg-purple-100 text-purple-700 border-purple-200"; icon = "👩‍🏫"; }
                                                                else { bgClass = "bg-indigo-50 text-indigo-700 border-indigo-100"; }
                                                                
                                                                return (
                                                                <div key={e.id} onClick={(ev) => { ev.stopPropagation(); setSelectedEvent(e); }} className={`text-[9px] p-1 rounded font-bold truncate border shadow-sm cursor-pointer hover:brightness-95 transition-all ${bgClass}`} title={e.memo ? `${e.time||''} ${e.memo}` : e.title}>
                                                                    <span className="hidden md:inline">{icon}</span> {e.time && <span className="mr-0.5 opacity-70 hidden md:inline">[{e.time}]</span>}{e.title}
                                                                </div>
                                                                );
                                                            })}
                                                        </div>
                                                    </div>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* 할 일 영역 */}
                                        <div className="bg-paper-50 p-6 rounded-3xl border border-stone-200 shadow-sm flex flex-col h-[400px] xl:h-full">
                                            <h3 className="font-bold flex items-center gap-2 text-stone-800 mb-4"><CheckSquare size={18} className="text-emerald-500"/> 교무수첩 할 일</h3>
                                            <div className="flex gap-2 mb-4 shrink-0">
                                                <input type="text" value={newTeacherTodo} onChange={e=>setNewTeacherTodo(e.target.value)} onKeyPress={e=>e.key==='Enter'&&handleAddTeacherTodo()} className="flex-1 bg-white border border-stone-300 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400 text-stone-800" placeholder="할 일 입력..."/>
                                                <button onClick={handleAddTeacherTodo} className="bg-stone-800 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-stone-900">추가</button>
                                            </div>
                                            <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                                                {teacherTodos.map(todo => (
                                                    <div key={todo.id} className="flex items-center gap-3 p-2 hover:bg-stone-100 rounded-lg group transition-colors">
                                                        <button onClick={()=>toggleTeacherTodo(todo.id, todo.isDone)}>
                                                            {todo.isDone ? <CheckSquare size={18} className="text-emerald-500"/> : <div className="w-[18px] h-[18px] border-2 border-stone-300 rounded"/>}
                                                        </button>
                                                        <span className={`flex-1 text-sm ${todo.isDone ? 'line-through text-stone-400' : 'text-stone-700'}`}>{todo.task}</span>
                                                        <button onClick={()=>deleteTeacherTodo(todo.id)} className="opacity-100 md:opacity-0 group-hover:opacity-100 text-stone-400 hover:text-rose-500 transition-opacity"><Trash2 size={14}/></button>
                                                    </div>
                                                ))}
                                                {teacherTodos.length === 0 && <p className="text-xs text-stone-400 text-center py-4">등록된 할 일 없습니다.</p>}
                                            </div>
                                        </div>
                                    </div>

                                    {/* 하단: 회의록 영역 */}
                                    <div className="bg-paper-50 p-6 rounded-3xl border border-stone-200 shadow-sm flex flex-col shrink-0 min-h-[300px]">
                                        <h3 className="font-bold flex items-center gap-2 text-stone-800 mb-4"><FileText size={18} className="text-blue-500"/> 회의록 보관함</h3>
                                        <div className="flex-1 overflow-y-auto grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 pr-1 content-start">
                                            {meetingMinutes.map(min => (
                                                <div key={min.id} className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm flex flex-col gap-2 hover:shadow-md transition-shadow h-fit group">
                                                    <div className="flex justify-between items-start">
                                                        <span className="text-xs font-black text-blue-500 bg-blue-50 w-fit px-2 py-1 rounded">{min.date}</span>
                                                        <div className="flex gap-2 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                                                            <button onClick={() => { setEditingMinuteId(min.id); setMinuteDate(min.date); setNewMinuteContent(min.content); setShowMinuteModal(true); }} className="text-stone-300 hover:text-blue-500"><Pencil size={16}/></button>
                                                            <button onClick={() => deleteMinute(min.id)} className="text-stone-300 hover:text-rose-500"><Trash2 size={16}/></button>
                                                        </div>
                                                    </div>
                                                    <p className="text-sm text-stone-700 whitespace-pre-wrap leading-relaxed line-clamp-6">{min.content}</p>
                                                </div>
                                            ))}
                                            {meetingMinutes.length === 0 && <p className="text-sm text-stone-400 col-span-full py-4 text-center mt-10">등록된 회의록이 없습니다.<br/>위 달력에서 날짜를 클릭해 작성해보세요.</p>}
                                        </div>
                                    </div>

                                    {/* 하단: 시간표 영역 */}
                                    <div className="bg-paper-50 p-4 md:p-6 rounded-3xl border border-stone-200 shadow-sm flex flex-col shrink-0">
                                        <h3 className="font-bold flex items-center gap-2 text-stone-800 mb-4"><BookOpen size={18} className="text-orange-500"/> 우리 반 주간 시간표</h3>
                                        <div className="w-full">
                                            <table className="w-full border-collapse bg-white rounded-xl overflow-hidden shadow-sm table-fixed">
                                                <thead>
                                                    <tr className="bg-stone-100 text-stone-600 text-[10px] md:text-sm">
                                                        <th className="border-b border-r border-stone-200 p-1 md:p-3 w-8 md:w-16">교시</th>
                                                        {['월', '화', '수', '목', '금'].map(day => <th key={day} className="border-b border-r border-stone-200 p-1 md:p-3 last:border-r-0 w-[18%]">{day}</th>)}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {[1, 2, 3, 4, 5, 6].map(period => (
                                                        <tr key={period} className="border-b border-stone-200 last:border-b-0">
                                                            <td className="border-r border-stone-200 p-1 md:p-2 text-center font-bold text-stone-500 bg-stone-50 text-[10px] md:text-xs">{period}</td>
                                                            {['월', '화', '수', '목', '금'].map(day => (
                                                                <td key={day} className="border-r border-stone-200 p-0 last:border-r-0">
                                                                    <input
                                                                        type="text"
                                                                        value={timetable[`${day}-${period}`] || ''}
                                                                        onChange={(e) => handleTimetableChange(day, period, e.target.value)}
                                                                        className="w-full h-full p-1 md:p-3 outline-none text-center text-[10px] md:text-sm focus:bg-orange-50 focus:ring-2 focus:ring-orange-400 font-bold text-black transition-colors"
                                                                        placeholder="과목"
                                                                    />
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* ❤️ 우리 가족 일기 탭 */}
                            {activeTab === 'siha' && (
                                <div className="max-w-5xl mx-auto space-y-6">
                                    <div className="flex items-center justify-between mb-2">
                                        <div><h1 className="text-xl md:text-2xl font-black flex items-center gap-2 tracking-tight text-stone-800"><Heart className="text-rose-400 fill-rose-400" />우리 가족 일기</h1><p className="text-stone-500 text-xs md:text-sm mt-1">우리 가족의 소중한 순간들을 기록하세요.</p></div>
                                    </div>
                                    <div className="bg-paper-50 p-4 rounded-3xl border border-stone-200 shadow-sm flex flex-col gap-4 relative">
                                        {uploadedImageBase64 && (
                                            <div className="w-full h-40 rounded-2xl overflow-hidden relative border border-stone-200 bg-stone-100 flex items-center justify-center">
                                                <img src={uploadedImageBase64} alt="preview" className="max-w-full max-h-full object-contain" />
                                                <button onClick={() => setUploadedImageBase64(null)} className="absolute top-2 right-2 p-1 bg-stone-900/50 hover:bg-stone-900 transition-colors text-white rounded-full"><X size={16}/></button>
                                            </div>
                                        )}
                                        <div className="flex flex-col md:flex-row items-center gap-3">
                                            <div className="flex w-full md:w-auto gap-3">
                                                <input type="file" accept="image/*" onChange={handleImageUpload} className="hidden" id="photo-upload" ref={fileInputRef} />
                                                <label htmlFor="photo-upload" className="p-3 bg-rose-50 text-rose-500 rounded-2xl cursor-pointer hover:bg-rose-100 transition-colors flex shrink-0">
                                                    <ImagePlus size={24}/>
                                                </label>
                                                <input type="text" value={newMemoryText} onChange={(e) => setNewMemoryText(e.target.value)} onKeyPress={(e) => e.key === 'Enter' && handleAddMemory()} placeholder="오늘 우리 가족에게 어떤 일이 있었나요?" className="flex-1 bg-white border border-stone-300 rounded-2xl px-5 py-3 text-sm outline-none focus:ring-2 focus:ring-rose-200 text-stone-800" />
                                            </div>
                                            <button onClick={handleAddMemory} className="w-full md:w-auto bg-stone-800 text-white px-6 py-3 rounded-2xl font-black hover:bg-stone-900 transition-colors shrink-0">저장</button>
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 md:gap-8">
                                        {sihaMemories.map(m => (
                                            <div key={m.id} onClick={() => setViewingMemory(m)} className="bg-paper-50 rounded-[2rem] md:rounded-[2.5rem] overflow-hidden shadow-sm border border-stone-200 group hover:shadow-md transition-all duration-300 relative cursor-pointer">
                                                
                                                {/* 수정 및 삭제 버튼 (카드에서는 이벤트 전파 중단으로 상세조회와 분리) */}
                                                <div className="absolute top-4 md:top-6 right-4 md:right-6 flex gap-2 z-10 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button onClick={(e) => { e.stopPropagation(); setEditingMemory(m); }} className="p-2 bg-white/90 backdrop-blur text-stone-600 rounded-full shadow-sm hover:bg-stone-100 transition-colors"><Pencil size={14}/></button>
                                                    <button onClick={(e) => { e.stopPropagation(); deleteMemory(m.id); }} className="p-2 bg-white/90 backdrop-blur text-rose-500 rounded-full shadow-sm hover:bg-rose-50 transition-colors"><Trash2 size={14}/></button>
                                                </div>

                                                <div className="h-40 md:h-48 overflow-hidden relative bg-stone-100 border-b border-stone-200 flex items-center justify-center p-2">
                                                    <img src={m.image} className="max-w-full max-h-full object-contain group-hover:scale-105 transition-transform duration-500 rounded" />
                                                    <div className="absolute top-4 left-4 md:top-6 md:left-6 bg-white/90 backdrop-blur px-3 py-1 rounded-full text-[10px] font-black shadow-sm text-stone-700">{m.date}</div>
                                                </div>
                                                <div className="p-6 md:p-8">
                                                    <h3 className="text-lg md:text-xl font-black mb-3 text-stone-800">{m.title}</h3>
                                                    <p className="text-stone-600 text-sm leading-relaxed mb-6 line-clamp-3">{m.content}</p>
                                                    <div className="pt-4 md:pt-6 border-t border-stone-200 flex justify-between items-center text-[10px] font-bold text-stone-400">
                                                        <span className="flex items-center gap-1 uppercase tracking-widest"><User size={12}/> Written by {m.author}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 📈 AI 버핏 탭 */}
                            {activeTab === 'invest' && (() => {
                                const invPlan = computeInvestTargetPlan(invPrincipal, invYears, invTarget, invTargetReturn);
                                const fmtMan = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('ko-KR') : '—');
                                const fmtRetPct = (v) => (v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
                                const invInp = 'w-full rounded-xl border border-slate-400 bg-slate-100 text-slate-900 placeholder:text-slate-500 font-bold outline-none focus:ring-2 focus:ring-teal-500/50';
                                const fvFormula = invPlan.rAnnual === 0
                                    ? `투입 ${fmtMan(invPlan.W)}만 원 × 1 = ${fmtMan(invPlan.fvLump)}만 원 (수익률 0%)`
                                    : `투입 ${fmtMan(invPlan.W)}만 원 × (1 + ${invPlan.rPct} ÷ 100)^${invPlan.n} ≈ ${fmtMan(invPlan.fvLump)}만 원 (연 복리·만 원 반올림)`;
                                const profileNote = (() => {
                                    const a = invPctPension, b = invPctLong, c = invPctMid, d = invPctShort;
                                    const max = Math.max(a, b, c, d);
                                    if (max === a) return '연금형 비중이 높아 채권·초단기 비중이 큰 ETF 조합을 제안합니다.';
                                    if (max === b) return '장기 비중이 높아 글로벌 주식 ETF 비중을 크게 제안합니다.';
                                    if (max === c) return '중기 비중이 높아 자산배분형 ETF 비중을 제안합니다.';
                                    return '단기·유동성 비중이 높아 초단기 국채 ETF 비중을 크게 제안합니다.';
                                })();
                                return (
                                <div className="max-w-4xl mx-auto space-y-6 pb-4">
                                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                                        <div>
                                            <h1 className="text-xl md:text-2xl font-black flex items-center gap-2 tracking-tight text-stone-800"><PieChart className="text-teal-600" />AI 버핏</h1>
                                            <p className="text-stone-500 text-xs md:text-sm mt-1">성향 비율에 맞춘 <span className="font-black text-stone-700">ETF</span>만 추천하고, 목표 기간·목표액 달성을 숫자로 풀어 드립니다.</p>
                                        </div>
                                        <p className="text-[10px] text-stone-400 flex items-start gap-1 max-w-md"><Info size={14} className="shrink-0 mt-0.5" /> 시세는 <span className="font-bold text-stone-500">Finnhub</span> API로 조회하고, 실패 시 야후 프록시를 시도합니다. 참고용이며 투자 권유가 아닙니다.</p>
                                    </div>

                                    <div className="bg-paper-50 rounded-3xl border border-stone-200 shadow-sm p-5 md:p-6 space-y-5">
                                        <h3 className="text-sm font-black text-stone-800 flex items-center gap-2">① 투입 자산 · 투자 목표 비율 (%)</h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-stone-500 mb-1">투입 자산 (만 원)</label>
                                                <input type="number" min="0" inputMode="decimal" value={invPrincipal} onChange={(e) => setInvPrincipal(e.target.value)} className={`${invInp} px-4 py-3 text-base`} placeholder="예: 5000" />
                                            </div>
                                            <div className="flex items-end">
                                                <div className={`w-full rounded-xl px-4 py-3 text-sm font-bold border ${invPctOk ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                                                    비율 합계: {invPctSum.toFixed(1)}% {invPctOk ? '(OK)' : '→ 합계 100%로 맞춰 주세요'}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                            {[
                                                { v: invPctPension, set: setInvPctPension, label: '연금형\n(현금화 최소)', sub: '안정·분산' },
                                                { v: invPctLong, set: setInvPctLong, label: '장기 투자', sub: '성장' },
                                                { v: invPctMid, set: setInvPctMid, label: '중기 투자', sub: '균형' },
                                                { v: invPctShort, set: setInvPctShort, label: '단기 투자', sub: '유동성' },
                                            ].map((row, i) => (
                                                <div key={i} className="bg-white border border-stone-200 rounded-2xl p-3">
                                                    <label className="text-[10px] font-black text-slate-600 whitespace-pre-line leading-tight">{row.label}</label>
                                                    <p className="text-[10px] text-slate-500 mb-2">{row.sub}</p>
                                                    <div className="flex items-center gap-1">
                                                        <input type="number" step="0.1" className={`${invInp} px-2 py-2 text-sm w-full`} value={row.v} onChange={(e) => row.set(parseFloat(e.target.value) || 0)} />
                                                        <span className="text-slate-600 font-bold">%</span>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>

                                    <div className="bg-paper-50 rounded-3xl border border-stone-200 shadow-sm p-5 md:p-6 space-y-4">
                                        <h3 className="text-sm font-black text-stone-800">② 거치 기간 · 목표 금액 · 목표 수익률</h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-stone-500 mb-1">거치 기간 (년)</label>
                                                <input type="number" min="0" step="0.5" value={invYears} onChange={(e) => setInvYears(parseFloat(e.target.value) || 0)} className={`${invInp} px-4 py-3`} />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-stone-500 mb-1">목표 금액 (만 원)</label>
                                                <input type="number" min="0" value={invTarget} onChange={(e) => setInvTarget(e.target.value)} className={`${invInp} px-4 py-3`} placeholder="예: 10000" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-stone-500 mb-1">목표 수익률 (연 %, 복리 가정)</label>
                                                <input type="number" step="0.1" value={invTargetReturn} onChange={(e) => setInvTargetReturn(parseFloat(e.target.value) || 0)} className={`${invInp} px-4 py-3`} />
                                            </div>
                                        </div>
                                        <button
                                            type="button"
                                            disabled={invEtfLoading || !invPctOk}
                                            onClick={runInvestAnalysis}
                                            className="w-full sm:w-auto px-6 py-3.5 rounded-2xl bg-teal-700 text-white font-black hover:bg-teal-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                        >
                                            {invEtfLoading ? '시세·과거 수익률 불러오는 중…' : <><TrendingUp size={18} /> ETF 10종 추천 · 시세 반영</>}
                                        </button>
                                    </div>

                                    <div className="bg-stone-800 text-white rounded-3xl p-5 md:p-8 shadow-md space-y-4">
                                        <h3 className="text-sm font-black text-teal-200 flex items-center gap-2">③ 목표 기간 안에서의 달성 과정 (만 원, 연 복리·세전)</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                            <div className="bg-stone-900/50 rounded-2xl p-4 border border-stone-700">
                                                <p className="text-stone-400 text-xs font-bold mb-1">투입액만 굴릴 때 {invPlan.n}년 후 예상 잔고</p>
                                                <p className="text-2xl font-black text-white">{fmtMan(invPlan.fvLump)} <span className="text-sm font-bold text-stone-400">만 원</span></p>
                                                <p className="text-[11px] text-stone-500 mt-2 leading-relaxed">{fvFormula}</p>
                                            </div>
                                            <div className="bg-stone-900/50 rounded-2xl p-4 border border-stone-700">
                                                <p className="text-stone-400 text-xs font-bold mb-1">{invPlan.n}년 후 목표 {fmtMan(invPlan.T)}만 원의 &quot;오늘 기준 필요 원금&quot;(현재가치)</p>
                                                <p className="text-2xl font-black text-emerald-300">{fmtMan(invPlan.pvNeeded)} <span className="text-sm font-bold text-stone-400">만 원</span></p>
                                                <p className="text-[11px] text-stone-500 mt-2 leading-relaxed">할인: 목표액 ÷ (1 + {invPlan.rPct} ÷ 100)<sup>{invPlan.n}</sup> (연 복리)</p>
                                            </div>
                                        </div>

                                        <div className="bg-stone-900/80 rounded-2xl p-4 border border-stone-600 text-sm leading-relaxed text-stone-200 space-y-3">
                                            <p className="font-bold text-white">목표까지의 단계 안내</p>
                                            <ol className="list-decimal list-inside space-y-2 text-[13px]">
                                                <li><span className="text-white font-bold">입력 정리</span>: 투입 {fmtMan(invPlan.W)}만 원, 기간 {invPlan.n}년, 목표 수익률 연 {invPlan.rPct}%를 기준으로 합니다.</li>
                                                <li><span className="text-white font-bold">미래 가치</span>: 추가 납입 없이 연 복리로만 불릴 때 {invPlan.n}년 뒤 잔고는 약 {fmtMan(invPlan.fvLump)}만 원으로 계산됩니다.</li>
                                                <li><span className="text-white font-bold">목표와 비교</span>: 목표액 {fmtMan(invPlan.T)}만 원과 비교하면, 그때 필요한 금액 대비 {invPlan.shortfallAtEnd > 0 ? `약 ${fmtMan(invPlan.shortfallAtEnd)}만 원 부족` : '목표 이상으로 도달하는 시나리오'}입니다.</li>
                                                <li><span className="text-white font-bold">오늘 기준 보완</span>: 목표를 지금 시점 원금으로 환산하면 약 {fmtMan(invPlan.pvNeeded)}만 원이 필요하고, 현재 투입액과의 차이(추가 일시 원금)는 약 {fmtMan(invPlan.gapLumpToday)}만 원입니다.</li>
                                                {invPlan.shortfallAtEnd > 0 && invPlan.monthlyExtra > 0 && (
                                                    <li><span className="text-white font-bold">월 적립 시나리오</span>: 일시금 없이 메우려면 매월 약 {fmtMan(invPlan.monthlyExtra)}만 원(말일 납입·세전 참고)을 {invPlan.months}개월 동안 넣는 것과 비슷한 규모입니다.</li>
                                                )}
                                            </ol>
                                            <p className="text-[11px] text-stone-500 pt-2 border-t border-stone-700">{profileNote}</p>
                                        </div>

                                        {invPlan.yearlyPath.length > 0 && (
                                            <div className="rounded-2xl border border-stone-600 overflow-hidden">
                                                <p className="px-4 py-2 bg-stone-900 text-xs font-bold text-teal-200">연도별 예상 잔고 (추가 납입 없음, 투입액만 복리)</p>
                                                <div className="max-h-48 overflow-y-auto">
                                                    <table className="w-full text-xs text-left">
                                                        <thead className="bg-stone-900/80 text-stone-400 sticky top-0">
                                                            <tr>
                                                                <th className="px-3 py-2">연차</th>
                                                                <th className="px-3 py-2">예상 잔고 (만 원)</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {invPlan.yearlyPath.map((row) => (
                                                                <tr key={row.year} className="border-t border-stone-700/80">
                                                                    <td className="px-3 py-1.5 text-stone-300">{row.year}년 후</td>
                                                                    <td className="px-3 py-1.5 font-mono text-white">{fmtMan(row.balance)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {(invEtfRows.length > 0 || invEtfError) && (
                                        <div className="bg-paper-50 rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                                            <div className="px-5 py-4 border-b border-stone-200 flex flex-wrap items-center justify-between gap-2">
                                                <h3 className="text-sm font-black text-stone-800">추천 ETF 10종 · 시세·과거 수익률 (참고)</h3>
                                                {invLastFetchAt && <span className="text-[10px] text-stone-400">조회: {invLastFetchAt.toLocaleString('ko-KR')}</span>}
                                            </div>
                                            {invEtfError && (
                                                <div className="px-5 py-3 bg-amber-50 text-amber-900 text-xs font-semibold border-b border-amber-100">{invEtfError}</div>
                                            )}
                                            {/* 모바일: 카드형으로 가로 스크롤 최소화 */}
                                            <div className="md:hidden space-y-2.5 px-3 py-3">
                                                {invEtfRows.map((row) => (
                                                    <div key={row.symbol} className="rounded-2xl border border-stone-200 bg-white shadow-sm p-3 text-[12px]">
                                                        <div className="flex justify-between gap-2 border-b border-stone-100 pb-2 mb-2">
                                                            <div className="min-w-0">
                                                                <span className="text-[10px] font-bold text-slate-500">{row.bucket}</span>
                                                                <p className="font-bold text-slate-900 leading-tight text-[13px]">{row.nameKo}</p>
                                                                <p className="font-mono font-black text-teal-700 text-[11px] mt-0.5">{row.symbol}</p>
                                                            </div>
                                                            <span className="shrink-0 font-black text-slate-900">{row.weightPct}%</span>
                                                        </div>
                                                        <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-[11px] mb-2">
                                                            <span className="text-slate-500">1년</span>
                                                            <span className={`font-bold text-right ${row.ret1y == null ? 'text-slate-400' : row.ret1y >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{fmtRetPct(row.ret1y)}</span>
                                                            <span className="text-slate-500">5년</span>
                                                            <span className={`font-bold text-right ${row.ret5y == null ? 'text-slate-400' : row.ret5y >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{fmtRetPct(row.ret5y)}</span>
                                                            <span className="text-slate-500">가격</span>
                                                            <span className="font-semibold text-slate-800 text-right">{row.price != null ? `${Number(row.price).toFixed(2)} ${row.currency || ''}` : '—'}</span>
                                                            <span className="text-slate-500">당일</span>
                                                            <span className={`font-bold text-right ${row.chgPct == null ? 'text-slate-400' : row.chgPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                                {row.chgPct != null ? `${row.chgPct >= 0 ? '+' : ''}${row.chgPct.toFixed(2)}%` : '—'}
                                                            </span>
                                                        </div>
                                                        <p className="text-[10px] text-slate-600 leading-snug line-clamp-3">{row.descKo || '—'}</p>
                                                    </div>
                                                ))}
                                            </div>
                                            {/* 데스크톱: 전체 표 */}
                                            <div className="hidden md:block overflow-x-auto">
                                                <table className="w-full text-sm">
                                                    <thead>
                                                        <tr className="bg-slate-800 text-white text-left text-xs border-b border-slate-900">
                                                            <th className="px-2.5 py-2.5 font-black w-[5.5rem] text-white">구분</th>
                                                            <th className="px-2.5 py-2.5 font-black min-w-[8rem] text-white">ETF명 · 티커</th>
                                                            <th className="px-2.5 py-2.5 font-black min-w-[10rem] text-white">상품 설명</th>
                                                            <th className="px-2.5 py-2.5 font-black whitespace-nowrap text-white">비중</th>
                                                            <th className="px-2.5 py-2.5 font-black whitespace-nowrap text-white">1년 수익률</th>
                                                            <th className="px-2.5 py-2.5 font-black whitespace-nowrap text-white">5년 수익률</th>
                                                            <th className="px-2.5 py-2.5 font-black whitespace-nowrap text-white">가격(USD)</th>
                                                            <th className="px-2.5 py-2.5 font-black whitespace-nowrap text-white">당일</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {invEtfRows.map((row) => (
                                                            <tr key={row.symbol} className="border-t border-stone-100 hover:bg-slate-50/90 align-top">
                                                                <td className="px-2.5 py-2.5 text-xs text-slate-700 font-semibold whitespace-nowrap">{row.bucket}</td>
                                                                <td className="px-2.5 py-2.5">
                                                                    <p className="font-bold text-slate-900">{row.nameKo}</p>
                                                                    <p className="text-[11px] font-mono font-black text-teal-700 mt-0.5">{row.symbol}</p>
                                                                    {row.nameEn && <p className="text-[10px] text-slate-500 mt-0.5">{row.nameEn}</p>}
                                                                </td>
                                                                <td className="px-2.5 py-2.5 text-[11px] text-slate-600 leading-relaxed">{row.descKo || '—'}</td>
                                                                <td className="px-2.5 py-2.5 font-black text-slate-800 whitespace-nowrap">{row.weightPct}%</td>
                                                                <td className={`px-2.5 py-2.5 text-sm font-bold whitespace-nowrap ${row.ret1y == null ? 'text-slate-400' : row.ret1y >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{fmtRetPct(row.ret1y)}</td>
                                                                <td className={`px-2.5 py-2.5 text-sm font-bold whitespace-nowrap ${row.ret5y == null ? 'text-slate-400' : row.ret5y >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{fmtRetPct(row.ret5y)}</td>
                                                                <td className="px-2.5 py-2.5 text-slate-800 whitespace-nowrap text-sm">{row.price != null ? `${Number(row.price).toFixed(2)} ${row.currency || ''}` : '—'}</td>
                                                                <td className={`px-2.5 py-2.5 font-bold whitespace-nowrap text-sm ${row.chgPct == null ? 'text-slate-400' : row.chgPct >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                                                                    {row.chgPct != null ? `${row.chgPct >= 0 ? '+' : ''}${row.chgPct.toFixed(2)}%` : '—'}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                            <p className="px-5 py-3 text-[11px] text-slate-500 leading-relaxed border-t border-stone-100 bg-slate-50/50">
                                                추천 종목은 <span className="font-bold text-slate-700">미국 상장 ETF 10종</span>으로 고정되며, 비중만 성향 비율에 따라 달라집니다. <span className="font-semibold text-slate-600">1년·5년 수익률</span>은 Finnhub 캔들(주봉·일봉) 종가 기준으로 대략 계산하고, 데이터가 없으면 야후 차트로 보완합니다. 상장 이력이 짧으면 표시가 없을 수 있습니다. 과거 실적은 미래 수익을 보장하지 않으며, 세금·환율·수수료는 반영되지 않습니다.
                                            </p>
                                        </div>
                                    )}
                                </div>
                                );
                            })()}

                            {/* 📑 ETF 포트폴리오 시뮬레이션 */}
                            {activeTab === 'portfolioSim' && (() => {
                                const pfPlan = computeInvestTargetPlan(pfPrincipal, pfYears, pfTarget, pfAnnualRate);
                                const fmtMan = (v) => (Number.isFinite(v) ? Math.round(v).toLocaleString('ko-KR') : '—');
                                const fmtRetPct = (v) => (v == null || Number.isNaN(v) ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`);
                                const pfInp = 'w-full rounded-xl border border-slate-400 bg-slate-100 text-slate-900 placeholder:text-slate-500 font-bold outline-none focus:ring-2 focus:ring-cyan-500/50';
                                const fvFormula = pfPlan.rAnnual === 0
                                    ? `투입 ${fmtMan(pfPlan.W)}만 원 × 1 = ${fmtMan(pfPlan.fvLump)}만 원 (수익률 0%)`
                                    : `투입 ${fmtMan(pfPlan.W)}만 원 × (1 + ${pfPlan.rPct} ÷ 100)^${pfPlan.n} ≈ ${fmtMan(pfPlan.fvLump)}만 원 (연 복리·만 원 반올림)`;
                                return (
                                <div className="max-w-4xl mx-auto space-y-6 pb-4">
                                    <div className="flex flex-col md:flex-row md:items-end justify-between gap-3">
                                        <div>
                                            <h1 className="text-xl md:text-2xl font-black flex items-center gap-2 tracking-tight text-stone-800"><Layers className="text-cyan-600" />포트폴리오 시뮬</h1>
                                            <p className="text-stone-500 text-xs md:text-sm mt-1">티커를 검색해 담고 비중을 맞춘 뒤, 투입·기간·목표로 <span className="font-black text-stone-700">복리 시나리오</span>를 확인합니다.</p>
                                        </div>
                                        <p className="text-[10px] text-stone-400 flex items-start gap-1 max-w-md"><Info size={14} className="shrink-0 mt-0.5" /> 검색·시세는 Finnhub를 쓰며, 과거 수익률 가중 평균은 참고용 가정일 뿐입니다. 투자 권유가 아닙니다.</p>
                                    </div>

                                    <div className="bg-paper-50 rounded-3xl border border-stone-200 shadow-sm p-5 md:p-6 space-y-4">
                                        <h3 className="text-sm font-black text-stone-800 flex items-center gap-2"><Search size={16} className="text-cyan-600" />① ETF 검색 · 추가</h3>
                                        <div className="flex flex-col sm:flex-row gap-2">
                                            <input
                                                value={pfSearch}
                                                onChange={(e) => setPfSearch(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), runPfSearch())}
                                                className={`${pfInp} px-4 py-3 flex-1`}
                                                placeholder="티커 또는 이름 (예: VTI, bond)"
                                            />
                                            <button type="button" onClick={runPfSearch} disabled={pfSearchLoading} className="px-5 py-3 rounded-xl bg-slate-800 text-white font-black hover:bg-slate-900 disabled:opacity-50 shrink-0">
                                                {pfSearchLoading ? '검색 중…' : '검색'}
                                            </button>
                                        </div>
                                        <label className="flex items-center gap-2 text-xs font-bold text-stone-500 cursor-pointer">
                                            <input type="checkbox" checked={pfEtfOnly} onChange={(e) => setPfEtfOnly(e.target.checked)} className="rounded border-stone-400" />
                                            ETF·ETP·ETN 위주로 결과 좁히기 (해제 시 일반 주식도 표시)
                                        </label>
                                        {pfSearchErr && <p className="text-xs font-bold text-amber-700">{pfSearchErr}</p>}
                                        {pfSearchHits.length > 0 && (
                                            <div className="max-h-48 overflow-y-auto rounded-xl border border-stone-200 bg-white divide-y divide-stone-100">
                                                {pfSearchHits.map((h, i) => (
                                                    <button
                                                        type="button"
                                                        key={`${h.symbol}-${i}`}
                                                        onClick={() => addPfRow(h.displaySymbol || h.symbol, h.description)}
                                                        className="w-full text-left px-3 py-2.5 hover:bg-cyan-50/80 text-sm flex justify-between gap-2"
                                                    >
                                                        <span className="font-mono font-black text-teal-700">{h.displaySymbol || h.symbol}</span>
                                                        <span className="text-stone-600 text-xs truncate flex-1">{h.description}</span>
                                                        <span className="text-[10px] text-stone-400 shrink-0">{h.type || '—'}</span>
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex flex-col sm:flex-row gap-2 items-stretch sm:items-center pt-2 border-t border-stone-200">
                                            <span className="text-xs font-bold text-stone-500 shrink-0">티커 직접 입력 (미국 상장)</span>
                                            <input
                                                value={pfManualTicker}
                                                onChange={(e) => setPfManualTicker(e.target.value.toUpperCase())}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter') {
                                                        e.preventDefault();
                                                        const t = String(pfManualTicker || '').replace(/[^A-Za-z0-9.-]/g, '').split('.')[0];
                                                        if (t) { addPfRow(t, ''); setPfManualTicker(''); }
                                                    }
                                                }}
                                                className={`${pfInp} px-3 py-2 flex-1 text-sm`}
                                                placeholder="예: QQQ"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    const t = String(pfManualTicker || '').replace(/[^A-Za-z0-9.-]/g, '').split('.')[0];
                                                    if (t) { addPfRow(t, ''); setPfManualTicker(''); }
                                                }}
                                                className="px-4 py-2 rounded-xl bg-cyan-800 text-white font-black text-sm hover:bg-cyan-900 shrink-0"
                                            >
                                                추가
                                            </button>
                                        </div>
                                    </div>

                                    <div className="bg-paper-50 rounded-3xl border border-stone-200 shadow-sm p-5 md:p-6 space-y-4">
                                        <div className="flex flex-wrap items-center justify-between gap-2">
                                            <h3 className="text-sm font-black text-stone-800">② 포트폴리오 · 비중 (%)</h3>
                                            <div className="flex flex-wrap gap-2">
                                                <button type="button" onClick={() => setPfRows((prev) => equalizePfWeights(prev))} className="text-xs font-black px-3 py-1.5 rounded-lg bg-stone-200 text-stone-800 hover:bg-stone-300">균등 배분</button>
                                                <button type="button" onClick={() => { if (pfRows.length && window.confirm('포트폴리오를 비울까요?')) setPfRows([]); }} className="text-xs font-black px-3 py-1.5 rounded-lg border border-rose-200 text-rose-700 hover:bg-rose-50">전체 비우기</button>
                                            </div>
                                        </div>
                                        <div className={`rounded-xl px-3 py-2 text-sm font-bold border ${pfPctOk ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-200 text-amber-900'}`}>
                                            비중 합계: {pfWeightSum.toFixed(1)}% {pfPctOk ? '(OK)' : '→ 합계 100%로 맞춰 주세요'}
                                        </div>
                                        {pfRows.length === 0 ? (
                                            <p className="text-center text-stone-500 text-sm py-8 border border-dashed border-stone-300 rounded-2xl">검색 또는 티커 입력으로 종목을 추가하세요.</p>
                                        ) : (
                                            <div className="space-y-2">
                                                {pfRows.map((row) => (
                                                    <div key={row.id} className="flex flex-wrap items-center gap-2 rounded-2xl border border-stone-200 bg-white p-3">
                                                        <div className="min-w-0 flex-1">
                                                            <p className="font-mono font-black text-teal-700">{row.symbol}</p>
                                                            {row.description ? <p className="text-[11px] text-stone-500 truncate">{row.description}</p> : null}
                                                            {row.nameEn && row.nameEn !== row.symbol ? <p className="text-[10px] text-slate-500">{row.nameEn}</p> : null}
                                                        </div>
                                                        <div className="flex items-center gap-1">
                                                            <input
                                                                type="number"
                                                                min="0"
                                                                max="100"
                                                                step="0.1"
                                                                value={row.weightPct}
                                                                onChange={(e) => updatePfWeight(row.id, e.target.value)}
                                                                className={`${pfInp} w-20 px-2 py-1.5 text-sm text-center`}
                                                            />
                                                            <span className="text-stone-600 font-bold">%</span>
                                                        </div>
                                                        <button type="button" onClick={() => removePfRow(row.id)} className="p-2 rounded-lg text-rose-600 hover:bg-rose-50" aria-label="삭제"><Trash2 size={18} /></button>
                                                        <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-stone-500">
                                                            {row.ret1y != null && <span>1년 {fmtRetPct(row.ret1y)}</span>}
                                                            {row.ret5y != null && <span>5년 {fmtRetPct(row.ret5y)}</span>}
                                                            {row.price != null && <span>{Number(row.price).toFixed(2)} {row.currency || 'USD'}</span>}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                        <div className="flex flex-col sm:flex-row flex-wrap gap-3 items-start sm:items-center">
                                            <button
                                                type="button"
                                                disabled={pfDataLoading || !pfPctOk || pfRows.length === 0}
                                                onClick={runPortfolioDataFetch}
                                                className="px-6 py-3 rounded-2xl bg-cyan-700 text-white font-black hover:bg-cyan-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                {pfDataLoading ? '불러오는 중…' : <><TrendingUp size={18} /> 시세·과거 수익률 불러오기</>}
                                            </button>
                                            {pfLastFetchAt && <span className="text-[10px] text-stone-400">조회: {pfLastFetchAt.toLocaleString('ko-KR')}</span>}
                                        </div>
                                        <label className="flex items-center gap-2 text-xs font-bold text-stone-500 cursor-pointer">
                                            <input type="checkbox" checked={pfAutoRateOnFetch} onChange={(e) => setPfAutoRateOnFetch(e.target.checked)} className="rounded border-stone-400" />
                                            불러오기 성공 시 &quot;참고 연 수익률&quot; 입력란에 1년 가중 평균을 넣기
                                        </label>
                                        {pfBlended1y != null && (
                                            <p className="text-xs text-stone-600">
                                                현재 포트폴리오 기준 <span className="font-black text-stone-800">1년 가중 평균(참고): {fmtRetPct(pfBlended1y)}</span>
                                                {' '}
                                                <button type="button" onClick={applyPfBlendedRateFromRows} className="underline font-bold text-cyan-800">이 값을 연 수익률에 반영</button>
                                            </p>
                                        )}
                                        {pfDataErr && <p className="text-xs font-semibold text-amber-800">{pfDataErr}</p>}
                                    </div>

                                    <div className="bg-paper-50 rounded-3xl border border-stone-200 shadow-sm p-5 md:p-6 space-y-4">
                                        <h3 className="text-sm font-black text-stone-800">③ 시뮬레이션 입력 (만 원 · 연 복리 · 세전)</h3>
                                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                            <div>
                                                <label className="block text-xs font-bold text-stone-500 mb-1">투입 자산 (만 원)</label>
                                                <input type="number" min="0" inputMode="decimal" value={pfPrincipal} onChange={(e) => setPfPrincipal(e.target.value)} className={`${pfInp} px-4 py-3`} placeholder="예: 3000" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-stone-500 mb-1">거치 기간 (년)</label>
                                                <input type="number" min="0" step="0.5" value={pfYears} onChange={(e) => setPfYears(parseFloat(e.target.value) || 0)} className={`${pfInp} px-4 py-3`} />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-stone-500 mb-1">목표 금액 (만 원)</label>
                                                <input type="number" min="0" value={pfTarget} onChange={(e) => setPfTarget(e.target.value)} className={`${pfInp} px-4 py-3`} placeholder="예: 8000" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-stone-500 mb-1">가정 연 수익률 (%, 복리)</label>
                                                <input
                                                    type="number"
                                                    step="0.1"
                                                    value={pfAnnualRate}
                                                    onChange={(e) => { setPfAnnualRate(parseFloat(e.target.value) || 0); setPfAutoRateOnFetch(false); }}
                                                    className={`${pfInp} px-4 py-3`}
                                                />
                                            </div>
                                        </div>
                                        <p className="text-[11px] text-stone-500 leading-relaxed">연 수익률은 직접 바꿀 수 있습니다. 수동으로 수정하면 &quot;불러올 때 자동 입력&quot; 체크가 꺼집니다.</p>
                                    </div>

                                    <div className="bg-stone-800 text-white rounded-3xl p-5 md:p-8 shadow-md space-y-4">
                                        <h3 className="text-sm font-black text-cyan-200 flex items-center gap-2">④ 시뮬레이션 결과</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                            <div className="bg-stone-900/50 rounded-2xl p-4 border border-stone-700">
                                                <p className="text-stone-400 text-xs font-bold mb-1">투입액만 굴릴 때 {pfPlan.n}년 후 예상 잔고</p>
                                                <p className="text-2xl font-black text-white">{fmtMan(pfPlan.fvLump)} <span className="text-sm font-bold text-stone-400">만 원</span></p>
                                                <p className="text-[11px] text-stone-500 mt-2 leading-relaxed">{fvFormula}</p>
                                            </div>
                                            <div className="bg-stone-900/50 rounded-2xl p-4 border border-stone-700">
                                                <p className="text-stone-400 text-xs font-bold mb-1">{pfPlan.n}년 후 목표 {fmtMan(pfPlan.T)}만 원의 &quot;오늘 기준 필요 원금&quot;(현재가치)</p>
                                                <p className="text-2xl font-black text-emerald-300">{fmtMan(pfPlan.pvNeeded)} <span className="text-sm font-bold text-stone-400">만 원</span></p>
                                                <p className="text-[11px] text-stone-500 mt-2 leading-relaxed">할인: 목표액 ÷ (1 + {pfPlan.rPct} ÷ 100)<sup>{pfPlan.n}</sup> (연 복리)</p>
                                            </div>
                                        </div>
                                        <div className="bg-stone-900/80 rounded-2xl p-4 border border-stone-600 text-sm leading-relaxed text-stone-200 space-y-3">
                                            <p className="font-bold text-white">요약</p>
                                            <ol className="list-decimal list-inside space-y-2 text-[13px]">
                                                <li>투입 {fmtMan(pfPlan.W)}만 원, 연 {pfPlan.rPct}%, 기간 {pfPlan.n}년을 가정했습니다.</li>
                                                <li>추가 납입 없이 복리만 적용하면 약 {fmtMan(pfPlan.fvLump)}만 원으로 계산됩니다.</li>
                                                <li>목표 대비 {pfPlan.shortfallAtEnd > 0 ? `약 ${fmtMan(pfPlan.shortfallAtEnd)}만 원 부족` : '목표 이상으로 도달하는 시나리오'}입니다.</li>
                                                <li>오늘 기준 목표의 현재가치는 약 {fmtMan(pfPlan.pvNeeded)}만 원이며, 투입액과의 차이(추가 일시 원금)는 약 {fmtMan(pfPlan.gapLumpToday)}만 원입니다.</li>
                                                {pfPlan.shortfallAtEnd > 0 && pfPlan.monthlyExtra > 0 && (
                                                    <li>부족분을 월 적립으로만 메우려면 매월 약 {fmtMan(pfPlan.monthlyExtra)}만 원(말일·세전 참고) 규모입니다.</li>
                                                )}
                                            </ol>
                                        </div>
                                        {pfPlan.yearlyPath.length > 0 && (
                                            <div className="rounded-2xl border border-stone-600 overflow-hidden">
                                                <p className="px-4 py-2 bg-stone-900 text-xs font-bold text-cyan-200">연도별 예상 잔고 (추가 납입 없음)</p>
                                                <div className="max-h-48 overflow-y-auto">
                                                    <table className="w-full text-xs text-left">
                                                        <thead className="bg-stone-900/80 text-stone-400 sticky top-0">
                                                            <tr>
                                                                <th className="px-3 py-2">연차</th>
                                                                <th className="px-3 py-2">예상 잔고 (만 원)</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {pfPlan.yearlyPath.map((row) => (
                                                                <tr key={row.year} className="border-t border-stone-700/80">
                                                                    <td className="px-3 py-1.5 text-stone-300">{row.year}년 후</td>
                                                                    <td className="px-3 py-1.5 font-mono text-white">{fmtMan(row.balance)}</td>
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                                );
                            })()}

                            {/* 🎯 단기 목표 프로젝트 */}
                            {activeTab === 'shortGoals' && (() => {
                                const sgInp = 'w-full rounded-xl border border-slate-400 bg-slate-100 text-slate-900 placeholder:text-slate-500 font-bold outline-none focus:ring-2 focus:ring-violet-500/50 px-3 py-2 text-sm';
                                const monthKeys = genYearMonths(new Date(), 18);
                                const fmtM = (n) => (Number.isFinite(n) ? Math.round(n).toLocaleString('ko-KR') : '0');
                                return (
                                <div className="max-w-4xl mx-auto space-y-6 pb-4">
                                    <div>
                                        <h1 className="text-xl md:text-2xl font-black flex items-center gap-2 tracking-tight text-stone-800"><TargetIcon className="text-violet-600" />단기 목표 프로젝트</h1>
                                        <p className="text-stone-500 text-xs md:text-sm mt-1">물건 종류를 고르면 그림이 모이듯 진행됩니다. 금액은 <span className="font-black text-stone-700">만 원</span> 단위입니다.</p>
                                    </div>

                                    <div className="bg-paper-50 rounded-3xl border border-stone-200 shadow-sm p-5 md:p-6 space-y-4">
                                        <h3 className="text-sm font-black text-stone-800">새 목표 추가</h3>
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                            <div>
                                                <label className="block text-xs font-bold text-stone-500 mb-1">목표 이름</label>
                                                <input value={sgTitle} onChange={(e) => setSgTitle(e.target.value)} className={`${sgInp} px-4 py-3`} placeholder="예: 가족 차 바꾸기" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-stone-500 mb-1">종류 (그림 선택)</label>
                                                <select value={sgKind} onChange={(e) => setSgKind(e.target.value)} className={`${sgInp} px-4 py-3`}>
                                                    {SHORT_GOAL_KINDS.map((k) => (
                                                        <option key={k.id} value={k.id}>{k.label}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-stone-500 mb-1">필요 금액 (만 원)</label>
                                                <input type="number" min="0" value={sgTarget} onChange={(e) => setSgTarget(e.target.value)} className={`${sgInp} px-4 py-3`} placeholder="3000" />
                                            </div>
                                            <div>
                                                <label className="block text-xs font-bold text-stone-500 mb-1">현재 모은 금 (만 원, 선택)</label>
                                                <input type="number" min="0" value={sgSeed} onChange={(e) => setSgSeed(e.target.value)} className={`${sgInp} px-4 py-3`} placeholder="0" />
                                            </div>
                                        </div>
                                        <button type="button" onClick={handleAddShortGoal} className="w-full md:w-auto px-6 py-3 rounded-2xl bg-violet-700 text-white font-black hover:bg-violet-800">목표 등록</button>
                                    </div>

                                    <div className="space-y-6">
                                        {shortTermGoals.length === 0 && (
                                            <p className="text-center text-stone-500 text-sm py-12 bg-paper-50 rounded-3xl border border-dashed border-stone-300">등록된 목표가 없습니다. 위에서 추가해 보세요.</p>
                                        )}
                                        {shortTermGoals.map((g) => {
                                            const target = Number(g.targetMan) || 0;
                                            const seed = Number(g.seedMan) || 0;
                                            const monthSum = sumMonthlyMap(g.monthly);
                                            const current = seed + monthSum;
                                            const remaining = Math.max(0, target - current);
                                            const progress = target > 0 ? Math.min(100, (current / target) * 100) : 0;
                                            const kindMeta = SHORT_GOAL_KINDS.find((k) => k.id === g.kind) || SHORT_GOAL_KINDS[SHORT_GOAL_KINDS.length - 1];
                                            const IconDraw = kindMeta.Icon;
                                            return (
                                                <div key={g.id} className="bg-paper-50 rounded-3xl border border-stone-200 shadow-sm overflow-hidden">
                                                    <div className="p-4 md:p-6 flex flex-col lg:flex-row gap-6">
                                                        <div className="shrink-0 lg:w-[260px]">
                                                            <div className="relative mx-auto w-full max-w-[260px] aspect-[4/3] rounded-3xl border-4 border-slate-400 bg-slate-200/90 overflow-hidden shadow-inner">
                                                                <div className="absolute inset-0 flex items-center justify-center text-slate-400 pointer-events-none" aria-hidden>
                                                                    <IconDraw size={130} strokeWidth={1} />
                                                                </div>
                                                                <div
                                                                    className="absolute inset-0 flex items-center justify-center transition-[clip-path] duration-700 ease-out pointer-events-none"
                                                                    style={{ clipPath: `inset(${100 - progress}% 0 0 0)` }}
                                                                >
                                                                    <IconDraw size={130} strokeWidth={2} color={kindMeta.stroke} className="drop-shadow-md" />
                                                                </div>
                                                                <div className="absolute bottom-0 left-0 right-0 h-3 bg-slate-500/40">
                                                                    <div className="h-full bg-gradient-to-r from-violet-500 to-cyan-400 transition-all duration-500" style={{ width: `${progress}%` }} />
                                                                </div>
                                                                <div className="absolute top-2 right-2 text-[11px] font-black bg-white/95 px-2 py-1 rounded-lg text-slate-900 shadow">{progress.toFixed(1)}%</div>
                                                            </div>
                                                            <p className="text-center text-xs font-bold text-stone-500 mt-2">{kindMeta.label} 그림이 진행률에 맞춰 위에서 아래로 채워집니다.</p>
                                                        </div>
                                                        <div className="flex-1 min-w-0 space-y-4">
                                                            <div className="flex flex-wrap items-start justify-between gap-2">
                                                                <div>
                                                                    <h3 className="text-lg font-black text-stone-800">{g.title}</h3>
                                                                    <p className="text-[10px] text-stone-500">작성: {g.author || '—'}</p>
                                                                </div>
                                                                <button type="button" onClick={() => handleDeleteShortGoal(g.id)} className="text-xs font-bold text-rose-600 px-3 py-1.5 rounded-lg border border-rose-200 hover:bg-rose-50">삭제</button>
                                                            </div>
                                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-sm">
                                                                <div className="rounded-2xl bg-stone-800 text-white p-3">
                                                                    <p className="text-[10px] font-bold text-stone-400">필요 금액</p>
                                                                    <p className="font-black">{fmtM(target)}<span className="text-xs font-bold ml-0.5">만</span></p>
                                                                </div>
                                                                <div className="rounded-2xl bg-emerald-900/90 text-white p-3">
                                                                    <p className="text-[10px] font-bold text-emerald-300">현재 합계</p>
                                                                    <p className="font-black">{fmtM(current)}<span className="text-xs font-bold ml-0.5">만</span></p>
                                                                </div>
                                                                <div className="rounded-2xl bg-amber-900/85 text-white p-3">
                                                                    <p className="text-[10px] font-bold text-amber-200">남은 금액</p>
                                                                    <p className="font-black">{fmtM(remaining)}<span className="text-xs font-bold ml-0.5">만</span></p>
                                                                </div>
                                                                <div className="rounded-2xl bg-violet-900/85 text-white p-3">
                                                                    <p className="text-[10px] font-bold text-violet-200">진행률</p>
                                                                    <p className="font-black">{progress.toFixed(1)}%</p>
                                                                </div>
                                                            </div>
                                                            <div className="h-4 rounded-full bg-stone-200 overflow-hidden border border-stone-300">
                                                                <div className="h-full bg-gradient-to-r from-violet-500 to-teal-400 transition-all duration-500" style={{ width: `${progress}%` }} />
                                                            </div>
                                                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                                                <div>
                                                                    <label className="text-[10px] font-bold text-stone-500">필요 금액 수정 (만 원)</label>
                                                                    <input type="number" min="0" defaultValue={target} key={`t-${g.id}-${target}`} onBlur={(e) => handleShortGoalMeta(g.id, 'targetMan', e.target.value)} className={`${sgInp} mt-1`} />
                                                                </div>
                                                                <div>
                                                                    <label className="text-[10px] font-bold text-stone-500">처음 모은 금·시드 (만 원)</label>
                                                                    <input type="number" min="0" defaultValue={seed} key={`s-${g.id}-${seed}`} onBlur={(e) => handleShortGoalMeta(g.id, 'seedMan', e.target.value)} className={`${sgInp} mt-1`} />
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <p className="text-xs font-black text-stone-700 mb-2">월별 납입 (만 원) · 입력 후 칸 밖을 누르면 저장</p>
                                                                <div className="max-h-56 overflow-y-auto rounded-xl border border-stone-200 bg-white/50 divide-y divide-stone-100">
                                                                    {monthKeys.map((ym) => (
                                                                        <div key={ym} className="flex items-center gap-2 px-3 py-2 text-xs">
                                                                            <span className="w-[4.5rem] shrink-0 font-mono font-bold text-slate-700">{ym}</span>
                                                                            <input
                                                                                type="number"
                                                                                min="0"
                                                                                className={`${sgInp} flex-1 py-1.5`}
                                                                                placeholder="0"
                                                                                defaultValue={g.monthly?.[ym] ?? ''}
                                                                                key={`${g.id}-${ym}-${g.monthly?.[ym] ?? ''}`}
                                                                                onBlur={(e) => handleShortGoalMonth(g.id, ym, e.target.value)}
                                                                            />
                                                                            <span className="text-stone-400 shrink-0">만 원</span>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                                <p className="text-[10px] text-stone-500 mt-1">현재 합계 = 시드 + 위 월별 납입의 합입니다.</p>
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                                );
                            })()}

                            {/* 공통 모달 영역 (일정 추가, 회의록 추가) */}
                            {showEventModal && (
                                <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                                    <div className="bg-paper-50 rounded-3xl w-full max-w-sm p-6 shadow-2xl border border-stone-200">
                                        <h3 className="text-lg font-bold mb-4 text-stone-800">{selectedDate} {activeTab === 'teacher' ? '학사 일정' : '공용 일정'} 추가</h3>
                                        <div className="mb-3">
                                            <label className="block text-xs font-bold text-stone-500 mb-1">일정 헤드라인 (제목)</label>
                                            <input type="text" autoFocus value={newEventTitle} onChange={(e) => setNewEventTitle(e.target.value)} className="w-full bg-white border border-stone-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-stone-400 text-stone-800" placeholder="일정 제목 (예: 학년 회의)" />
                                        </div>
                                        <div className="flex gap-2 mb-4">
                                            <input type="time" value={newEventTime} onChange={(e) => setNewEventTime(e.target.value)} className="w-1/3 bg-white border border-stone-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-stone-400 text-stone-800" />
                                            <input type="text" value={newEventMemo} onChange={(e) => setNewEventMemo(e.target.value)} className="w-2/3 bg-white border border-stone-300 rounded-xl p-3 text-sm outline-none focus:ring-2 focus:ring-stone-400 text-stone-800" placeholder="장소/메모" />
                                        </div>
                                        <div className="flex gap-2 mb-2">
                                            <button onClick={() => { setShowEventModal(false); setDragStart(null); setDragEnd(null); setIsDragging(false); setNewEventTime(""); setNewEventMemo(""); }} className="flex-1 py-3 bg-stone-200 text-stone-700 rounded-xl font-bold hover:bg-stone-300 transition-colors">취소</button>
                                            <button onClick={handleAddEvent} className="flex-1 py-3 bg-stone-800 text-white rounded-xl font-bold hover:bg-stone-900 transition-colors">저장하기</button>
                                        </div>
                                        {activeTab === 'teacher' && (
                                            <button onClick={() => { setShowEventModal(false); setMinuteDate(selectedDate); setEditingMinuteId(null); setNewMinuteContent(""); setShowMinuteModal(true); }} className="w-full mt-1 py-3 bg-indigo-50 text-indigo-600 rounded-xl font-bold border border-indigo-200 hover:bg-indigo-100 transition-colors">📝 이 날짜에 회의록 작성하기</button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* AI 스캔/음성 일정 선택 모달 (체크리스트) */}
                            {scannedEvents && (
                                <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-[110] flex items-center justify-center p-4">
                                    <div className="bg-paper-50 rounded-3xl w-full max-w-lg p-6 shadow-2xl border border-stone-200 flex flex-col max-h-[80vh]">
                                        <h3 className="text-xl font-black mb-2 flex items-center gap-2 text-stone-800"><Camera className="text-indigo-500"/> AI 분석 일정 등록</h3>
                                        <p className="text-sm text-stone-500 mb-4">사진 또는 음성에서 추출된 일정입니다. 등록할 일정을 선택해주세요.</p>
                                        <div className="flex-1 overflow-y-auto space-y-2 mb-4 pr-2">
                                            {scannedEvents.map((ev, index) => (
                                                <div key={index} className="flex items-start gap-3 p-3 bg-white border border-stone-200 rounded-xl hover:bg-stone-50 transition-colors cursor-pointer" onClick={() => {
                                                    setSelectedScannedIndices(prev => prev.includes(index) ? prev.filter(i => i !== index) : [...prev, index]);
                                                }}>
                                                    <div className="mt-0.5">
                                                        {selectedScannedIndices.includes(index) ? <CheckSquare size={18} className="text-indigo-500"/> : <div className="w-[18px] h-[18px] border-2 border-stone-300 rounded"/>}
                                                    </div>
                                                    <div className="flex-1">
                                                        <p className="text-sm font-bold text-stone-800">{ev.title}</p>
                                                        <p className="text-xs font-semibold text-stone-500">{ev.date} {ev.time && `| ${ev.time}`}</p>
                                                        {ev.memo && <p className="text-[10px] text-stone-600 mt-1 bg-stone-100 p-1.5 rounded">{ev.memo}</p>}
                                                    </div>
                                                </div>
                                            ))}
                                            {scannedEvents.length === 0 && <p className="text-center text-stone-500 text-sm py-8">추출된 일정이 없습니다.</p>}
                                        </div>
                                        <div className="flex gap-2 shrink-0">
                                            <button onClick={() => { setScannedEvents(null); setSelectedScannedIndices([]); }} className="flex-1 py-3 bg-stone-200 text-stone-700 rounded-xl font-bold hover:bg-stone-300 transition-colors">취소</button>
                                            <button onClick={async () => {
                                                const selectedEvents = scannedEvents.filter((_, i) => selectedScannedIndices.includes(i));
                                                if (selectedEvents.length === 0) return;

                                                // UI 대기 현상 방지를 위해 모달을 즉시 닫고 백그라운드에서 저장
                                                setScannedEvents(null);
                                                setSelectedScannedIndices([]);

                                                try {
                                                    for (const ev of selectedEvents) {
                                                        await addDoc(collection(db, 'artifacts', appId, 'public', 'data', 'calendarEvents'), {
                                                            title: ev.title,
                                                            date: ev.date,
                                                            time: ev.time || "",
                                                            memo: ev.memo || "",
                                                            category: ev.category || (scannedEventType === 'school' ? "school_general" : "general"),
                                                            type: scannedEventType,
                                                            author: currentUserMode === 'uijeong' ? '살뜰 의정' : '알뜰 재윤',
                                                            owner: currentUserMode,
                                                            createdAt: serverTimestamp()
                                                        });
                                                    }
                                                } catch (err) {
                                                    console.error(err);
                                                    alert("AI 일정 등록 중 오류가 발생했습니다: " + err.message);
                                                }
                                            }} className="flex-1 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-colors disabled:opacity-50" disabled={selectedScannedIndices.length === 0}>
                                                선택 항목 등록 ({selectedScannedIndices.length}건)
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {showMinuteModal && (
                                <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                                    <div className="bg-paper-50 rounded-3xl w-full max-w-2xl p-6 shadow-2xl border border-stone-200 flex flex-col max-h-[90vh]">
                                        <h3 className="text-xl font-black mb-4 flex items-center gap-2 text-stone-800"><FileText className="text-blue-500"/> {minuteDate} 회의록 {editingMinuteId ? '수정' : '작성'}</h3>
                                        
                                        <div className="bg-emerald-50 border border-emerald-100 rounded-2xl p-4 mb-4 shrink-0">
                                            <h4 className="text-sm font-bold text-emerald-800 flex items-center gap-1 mb-2"><CheckSquare size={16}/> 회의 중 할 일 추가 (교무수첩 자동 연동)</h4>
                                            <div className="flex gap-2">
                                                <input type="text" value={newTeacherTodo} onChange={e=>setNewTeacherTodo(e.target.value)} onKeyPress={e=>e.key==='Enter'&&handleAddTeacherTodo()} className="flex-1 bg-white border border-emerald-200 rounded-xl px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-400 text-stone-800" placeholder="회의에서 결정된 할 일 입력..."/>
                                                <button onClick={handleAddTeacherTodo} className="bg-emerald-600 text-white px-4 py-2 rounded-xl font-bold text-sm hover:bg-emerald-700 transition-colors shrink-0">할 일 등록</button>
                                            </div>
                                        </div>

                                        <textarea value={newMinuteContent} onChange={(e) => setNewMinuteContent(e.target.value)} placeholder="회의 내용을 상세히 기록하세요..." className="w-full flex-1 min-h-[150px] md:min-h-[300px] bg-white border border-stone-300 rounded-2xl p-4 text-sm outline-none focus:ring-2 focus:ring-blue-400 text-stone-800 resize-none mb-4" />
                                        <div className="flex gap-2 shrink-0">
                                            <button onClick={() => { setShowMinuteModal(false); setNewMinuteContent(""); setMinuteDate(null); setEditingMinuteId(null); }} className="flex-1 py-3 bg-stone-200 text-stone-700 rounded-xl font-bold hover:bg-stone-300 transition-colors">취소</button>
                                            <button onClick={handleAddMinute} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-700 transition-colors">회의록 저장</button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 우리 가족 일기 수정 모달 */}
                            {editingMemory && (
                                <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
                                    <div className="bg-paper-50 rounded-3xl w-full max-w-md p-6 shadow-2xl border border-stone-200 flex flex-col gap-4">
                                        <h3 className="text-xl font-black flex items-center gap-2 text-stone-800"><Heart className="text-rose-400 fill-rose-400"/> 기록 수정</h3>
                                        
                                        <div className="w-full h-40 rounded-2xl overflow-hidden relative border border-stone-200 bg-stone-100 flex items-center justify-center">
                                            <img src={editingMemory.image} className="max-w-full max-h-full object-contain" />
                                            <label className="absolute inset-0 bg-stone-900/40 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity cursor-pointer">
                                                <span className="text-white font-bold bg-stone-900/60 px-4 py-2 rounded-xl flex items-center gap-2"><ImagePlus size={16}/> 사진 변경</span>
                                                <input type="file" accept="image/*" onChange={handleEditImageUpload} className="hidden" />
                                            </label>
                                        </div>

                                        <textarea 
                                            value={editingMemory.content} 
                                            onChange={(e) => setEditingMemory({...editingMemory, content: e.target.value})} 
                                            className="w-full min-h-[120px] bg-white border border-stone-300 rounded-2xl p-4 text-sm outline-none focus:ring-2 focus:ring-rose-200 text-stone-800 resize-none"
                                            placeholder="수정할 내용을 입력하세요."
                                        />

                                        <div className="flex gap-2 shrink-0 pt-2">
                                            <button onClick={() => setEditingMemory(null)} className="flex-1 py-3 bg-stone-200 text-stone-700 rounded-xl font-bold hover:bg-stone-300 transition-colors">취소</button>
                                            <button onClick={handleUpdateMemory} className="flex-1 py-3 bg-stone-800 text-white rounded-xl font-bold hover:bg-stone-900 transition-colors">수정 완료</button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 우리 가족 일기 상세 조회 모달 */}
                            {viewingMemory && (
                                <div className="fixed inset-0 bg-stone-900/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4" onClick={() => { closeMemoryPhotoFullscreen(); setViewingMemory(null); }}>
                                    <div className="bg-paper-50 rounded-3xl w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
                                        <div className="relative bg-stone-100 flex items-center justify-center shrink-0 border-b border-stone-200 p-2">
                                            <img
                                                src={viewingMemory.image}
                                                className="max-w-full max-h-[45vh] object-contain rounded cursor-pointer active:opacity-90"
                                                onClick={(e) => { e.stopPropagation(); openMemoryPhotoFullscreen(); }}
                                                title="탭하면 화면 꽉 차게 보기 · 핀치로 확대"
                                            />
                                            <button onClick={() => { closeMemoryPhotoFullscreen(); setViewingMemory(null); }} className="absolute top-4 right-4 p-2 bg-stone-900/50 hover:bg-stone-900 text-white rounded-full transition-colors backdrop-blur"><X size={20}/></button>
                                            <div className="absolute top-4 left-4 flex gap-2">
                                                <button
                                                    type="button"
                                                    onClick={(e) => { e.stopPropagation(); openMemoryPhotoFullscreen(); }}
                                                    className="px-3 py-2 bg-white/90 hover:bg-white text-stone-700 rounded-xl text-xs font-black border border-stone-200 shadow-sm transition-colors"
                                                >
                                                    크게 보기
                                                </button>
                                                <button
                                                    onClick={() => downloadImage(viewingMemory.image, `우리-가족-앨범_${viewingMemory.date || 'photo'}.jpg`)}
                                                    className="px-3 py-2 bg-white/90 hover:bg-white text-stone-700 rounded-xl text-xs font-black border border-stone-200 shadow-sm transition-colors flex items-center gap-1.5"
                                                >
                                                    <Download size={16}/> 다운로드
                                                </button>
                                            </div>
                                        </div>
                                        <div className="p-6 md:p-8 overflow-y-auto">
                                            <div className="flex items-center gap-2 mb-2">
                                                <span className="bg-rose-100 text-rose-600 px-2 py-0.5 rounded text-[10px] font-black">{viewingMemory.date}</span>
                                                <span className="text-[10px] font-bold text-stone-400"><User size={12} className="inline mr-1 -mt-0.5"/>{viewingMemory.author}</span>
                                            </div>
                                            <h3 className="text-xl md:text-2xl font-black mb-4 text-stone-800">{viewingMemory.title}</h3>
                                            <p className="text-stone-700 text-sm md:text-base leading-relaxed whitespace-pre-wrap">{viewingMemory.content}</p>
                                            
                                            <div className="mt-8 flex gap-2 justify-end border-t border-stone-200 pt-4">
                                                <button onClick={() => { setEditingMemory(viewingMemory); setViewingMemory(null); }} className="px-5 py-2.5 bg-stone-200 text-stone-700 rounded-xl text-xs font-bold hover:bg-stone-300 flex items-center gap-1.5"><Pencil size={14}/> 수정</button>
                                                <button onClick={() => { deleteMemory(viewingMemory.id); setViewingMemory(null); }} className="px-5 py-2.5 bg-rose-50 text-rose-600 rounded-xl text-xs font-bold hover:bg-rose-100 flex items-center gap-1.5"><Trash2 size={14}/> 삭제</button>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* 가족 앨범: 상세에서 사진 탭 시 전체 화면 + 핀치/드래그 확대 */}
                            {viewingMemory && memoryPhotoFullscreen && (
                                <div
                                    className="fixed inset-0 z-[70] bg-black touch-none select-none"
                                    role="dialog"
                                    aria-label="사진 전체 화면"
                                    onClick={closeMemoryPhotoFullscreen}
                                >
                                    <div
                                        ref={memoryFsLayerRef}
                                        className="absolute inset-0 flex items-center justify-center overflow-hidden"
                                        onTouchStart={handleMemoryFsTouchStart}
                                        onTouchMove={handleMemoryFsTouchMove}
                                        onTouchEnd={handleMemoryFsTouchEnd}
                                        onWheel={handleMemoryFsWheel}
                                    >
                                        <img
                                            alt="가족 앨범 사진"
                                            src={viewingMemory.image}
                                            draggable={false}
                                            onClick={(e) => e.stopPropagation()}
                                            className="max-h-full max-w-full object-contain"
                                            style={{
                                                transform: `translate(${fsTx}px, ${fsTy}px) scale(${fsScale})`,
                                                transformOrigin: 'center center',
                                                willChange: 'transform',
                                            }}
                                        />
                                    </div>
                                    <button
                                        type="button"
                                        className="absolute top-4 right-4 p-2.5 bg-white/15 hover:bg-white/25 text-white rounded-full z-10 backdrop-blur-sm"
                                        onClick={(e) => { e.stopPropagation(); closeMemoryPhotoFullscreen(); }}
                                        aria-label="전체 화면 닫기"
                                    >
                                        <X size={22} />
                                    </button>
                                    <p className="absolute bottom-6 left-0 right-0 text-center text-white/55 text-[11px] pointer-events-none px-4">
                                        두 손가락으로 확대·축소 · 확대 후 한 손가락으로 이동 · 빈 곳 탭하면 닫기
                                    </p>
                                </div>
                            )}

                            {/* 일정 상세 및 삭제 모달 */}
                            {selectedEvent && (
                                <div className="fixed inset-0 bg-stone-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                                    <div className="bg-paper-50 rounded-3xl w-full max-w-sm p-6 shadow-2xl border border-stone-200">
                                        <div className="flex justify-between items-start mb-4">
                                            <h3 className="text-lg font-black text-stone-800 flex items-center gap-2"><CalendarIcon size={20} className="text-indigo-500"/> 일정 상세</h3>
                                            <button onClick={() => setSelectedEvent(null)} className="text-stone-400 hover:text-stone-600"><X size={20}/></button>
                                        </div>
                                        <div className="space-y-3 mb-6">
                                            <div>
                                                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">날짜</p>
                                                <p className="font-semibold text-stone-800">{selectedEvent.date}</p>
                                            </div>
                                            <div>
                                                <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">제목</p>
                                                <p className="font-semibold text-stone-800">{selectedEvent.title}</p>
                                            </div>
                                            {selectedEvent.time && (
                                                <div>
                                                    <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">시간</p>
                                                    <p className="font-semibold text-stone-800">{selectedEvent.time}</p>
                                                </div>
                                            )}
                                            {selectedEvent.memo && (
                                                <div>
                                                    <p className="text-xs font-bold text-stone-400 uppercase tracking-wider mb-1">장소/메모</p>
                                                    <p className="font-semibold text-stone-800 bg-stone-100 p-3 rounded-xl mt-1">{selectedEvent.memo}</p>
                                                </div>
                                            )}
                                            <div className="pt-2 border-t border-stone-200 mt-4 flex items-center gap-1 text-[10px] font-bold text-stone-400">
                                                <User size={12}/> 등록자: {selectedEvent.author}
                                            </div>
                                        </div>
                                        <div className="flex gap-2">
                                            <button onClick={() => handleDeleteEvent(selectedEvent.id)} className="flex-1 py-3 bg-rose-50 text-rose-600 border border-rose-200 rounded-xl font-bold hover:bg-rose-100 transition-colors flex items-center justify-center gap-2"><Trash2 size={16}/> 삭제하기</button>
                                            <button onClick={() => setSelectedEvent(null)} className="flex-1 py-3 bg-stone-800 text-white rounded-xl font-bold hover:bg-stone-900 transition-colors">닫기</button>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>
                    </main>

                    {/* 모바일 전용 하단 네비게이션 탭 */}
                    {isAuthenticated && (
                        <nav className="md:hidden fixed bottom-0 left-0 w-full bg-paper-50 border-t border-stone-200 flex justify-around items-center min-h-[72px] z-50 shadow-[0_-4px_12px_rgba(0,0,0,0.25)] pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-1">
                            {menuItems.map((item) => (
                                <button key={item.id} onClick={() => setActiveTab(item.id)} type="button" className={`flex flex-col items-center justify-center w-full h-full gap-0.5 py-1 transition-colors ${activeTab === item.id ? 'text-stone-800' : 'text-stone-500'}`}>
                                    <item.icon size={24} className={activeTab === item.id ? 'text-stone-800' : 'text-stone-500'} strokeWidth={activeTab === item.id ? 2.25 : 2} />
                                    <span className={`text-[11px] font-bold leading-tight text-center px-0.5 ${activeTab === item.id ? 'text-stone-800' : 'text-stone-500'}`}>{item.label.split(' ')[0]}</span>
                                </button>
                            ))}
                        </nav>
                    )}
                </div>
            );
}


