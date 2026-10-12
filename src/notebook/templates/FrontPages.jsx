import { CellGrid, GoBtn, Ink, LinedBlock, Tick, TitleBar } from '../fields.jsx';
import { destLabel } from '../labels.js';
import { bodyLinks } from '../nav.js';

export function CoverPage({ fields, setField, onGo }) {
    return (
        <div className="nb-cover">
            <div
                className="nb-cover-card"
                role="link"
                tabIndex={0}
                onClick={() => onGo?.(2)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onGo?.(2); } }}
                data-hit="body:표지"
                data-to={2}
            >
                <p className="nb-cover-kicker">초등 담임 전용</p>
                <h2 className="nb-cover-title">2026학년도 교무수첩</h2>
                <p className="nb-cover-range">2026. 3. 1 ~ 2027. 2. 28</p>
                <p className="nb-cover-stars" aria-hidden="true">★ ★ ★</p>
                <div className="nb-cover-fields">
                    <label onClick={(e) => e.stopPropagation()}>학교 <Ink value={fields.school} onChange={(v) => setField('school', v)} placeholder="학교 이름" /></label>
                    <label onClick={(e) => e.stopPropagation()}>학년 · 반 <Ink value={fields.klass} onChange={(v) => setField('klass', v)} placeholder="예: 3학년 2반" /></label>
                    <label onClick={(e) => e.stopPropagation()}>선생님 <Ink value={fields.teacher} onChange={(v) => setField('teacher', v)} placeholder="성함" /></label>
                </div>
                <p className="nb-hint">표지를 누르면 홈으로 가요</p>
            </div>
        </div>
    );
}

const HOME_FALLBACK = {
    231: '출결',
    256: '상담',
    350: '단원',
    405: '기한 있는 일',
    417: '회의록',
    469: '예산',
};

export function HomePage({ pageRec, pages, fields, setField, onGo }) {
    const links = bodyLinks(pageRec);
    const cards = links.filter((l) => l.rect[3] - l.rect[1] > 40 && l.rect[2] - l.rect[0] > 140);
    const months = links.filter((l) => l.to >= 34 && l.to <= 45);
    const bottom = links.filter((l) => l.rect[1] >= 560 && !(l.to >= 34 && l.to <= 45));
    return (
        <div className="nb-home">
            <TitleBar kicker="홈" title="자주 가는 곳 모음" hint="버튼을 누르면 PDF와 같은 쪽으로 가요" />
            <label className="nb-goal">
                <span>올해 우리 반 한 줄 목표</span>
                <Ink value={fields.goal} onChange={(v) => setField('goal', v)} placeholder="한 줄로 적어 두세요" />
            </label>
            <CellGrid cols={4} className="nb-home-cards">
                {cards.filter((l) => l.rect[1] < 500).map((l) => (
                    <GoBtn key={`${l.to}-${l.rect[0]}`} to={l.to} onGo={onGo} className="chip">
                        {l.label || HOME_FALLBACK[l.to] || destLabel(l.to, pages)}
                    </GoBtn>
                ))}
            </CellGrid>
            <p className="nb-kicker">달력 바로 가기</p>
            <div className="nb-monthrow">
                {months.map((l) => (
                    <GoBtn key={l.to} to={l.to} onGo={onGo}>{l.label || destLabel(l.to, pages)}</GoBtn>
                ))}
            </div>
            <div className="nb-home-bottom">
                {bottom.map((l) => (
                    <GoBtn key={l.to} to={l.to} onGo={onGo} className="chip">
                        {l.label || destLabel(l.to, pages)}
                    </GoBtn>
                ))}
            </div>
        </div>
    );
}

const PREP_ITEMS = [
    ['인수인계 받기', ['교실 열쇠·비품 목록 받기', '명렬(학생 명단)과 전입·전출 확인', '건강 관련 안내 받기 (알레르기·복약·분리 급식)', '특별히 살필 학생 이야기 듣기']],
    ['교실 준비', ['책상·사물함 번호 붙이기', '게시판·학급 문고 정리', 'TV·컴퓨터·프린터 확인', '청소 도구·분리수거함 점검']],
    ['서류·계획', ['학급 교육과정·시간표 받기', '기초조사서·가정통신문 준비', '학급 규칙 초안 쓰기', '1인 1역 초안 만들기', '첫날 할 말 정리하기']],
    ['첫 주 챙길 것', ['자리 배치 정하기', '비상 연락 방법 안내', '급식·하교 동선 알려 주기']],
];

export function PrepPage({ page, fields, setField }) {
    if (page === 4) {
        return (
            <div>
                <TitleBar kicker="2026학년도 새 학년 준비" title="2026년 2월" hint="첫날 할 말과 준비 주간 메모" />
                <div className="nb-split">
                    <div>
                        <p className="nb-kicker">첫날 할 말</p>
                        <Ink multiline rows={8} value={fields.firstDay} onChange={(v) => setField('firstDay', v)} placeholder="첫날 할 말" />
                    </div>
                    <div>
                        <p className="nb-kicker">준비 주간 메모</p>
                        <LinedBlock n={10} get={(k) => fields[k]} set={setField} prefix="prepMemo" placeholder="메모" />
                    </div>
                </div>
            </div>
        );
    }
    return (
        <div>
            <TitleBar kicker="2026학년도 새 학년 준비" title="2026년 2월 · 인수인계와 첫 주 준비" />
            <div className="nb-prep-grid">
                {PREP_ITEMS.map(([head, items]) => (
                    <section key={head} className="nb-panel">
                        <h3>{head}</h3>
                        {items.map((it) => (
                            <Tick key={it} checked={fields[`c_${it}`]} onChange={(v) => setField(`c_${it}`, v)} label={it} />
                        ))}
                    </section>
                ))}
            </div>
            <p className="nb-hint">설 연휴(2.16~2.18)가 끼어 있어요. 연휴 전에 교실 열쇠부터 받아 두면 편해요.</p>
        </div>
    );
}

const HOWTO = {
    5: {
        title: '사용법 ① 둘러보기',
        hint: '처음 한 번만 읽어 보세요',
        body: [
            '왼쪽 탭은 구역이에요. 홈·쓰·연간·주간·하루·학급·학생·출결·상담·수업·업무·태그·공책·칠판 순입니다.',
            '오른쪽 탭은 달이에요. 3월부터 다음 해 2월까지 있어요.',
            '오른쪽 맨 아래 \'스티커\'를 누르면 스티커 쪽으로 가요.',
            '가로로 두고 쓰는 게 제일 편해요. 세로로 들면 버튼이 작아져요.',
            '월간 달력에서 날짜 위쪽을 누르면 그 주 주간 쪽으로 넘어가요.',
            '주간 쪽 요일 이름을 누르면 특별한 하루 일과로 가요.',
            '명렬표에서 번호를 누르면 그 학생 카드가 열려요. \'누가\' 버튼은 누가기록 쪽이에요.',
            '여러 쪽짜리 모음은 맨 앞에 목차가 있어요. 번호를 누르면 바로 그 쪽이에요.',
            '학생은 이름보다 번호로 적어 두면 찾기 쉽고 안심돼요.',
        ],
    },
    6: {
        title: '사용법 ② 앱에서 쓰기',
        hint: '링크 · 쪽 추가 · 스티커 — 웹에서는 칸에 바로 타이핑하면 됩니다',
        body: [
            '이 웹 수첩은 GoodNotes 전용이 아닙니다. 마우스와 키보드로 칸을 채울 수 있어요.',
            '왼쪽 맨 위 \'홈\' 탭 바로 아래 \'쓰\' 탭이 쓱적입니다. 한 줄에 한 건, 붙임 메모에는 한 장에 하나씩 적어요.',
            '쓱적 쪽에서 \'받은함으로 나누기\'를 누르면 학생·출결·상담·주간·업무로 카드를 날려보낼 수 있어요.',
            '로그인하면 Firebase에 동기화되고, 이 기기에서만 쓰면 localStorage에 남습니다.',
        ],
    },
    7: {
        title: '필요한 쪽만 뽑을 때 쪽 번호를 보세요',
        hint: '한 부분만 인쇄할 때 (쪽 번호)',
        body: [
            '명렬표 154쪽 · 기초조사·건강 155-158쪽 · 주간 47-98쪽',
            '특별한 하루 일과 100-139쪽 · 상담 257-288쪽 · 보호자 289-320쪽',
            '학생 한 명만: 카드 159쪽부터 두 쪽씩 (1번 159-160 … 32번 221-222)',
            '기기 잠금은 꼭 켜 두세요. 클라우드로 내보내면 학생 정보도 같이 나가요.',
            '공휴일: 2026년은 우주항공청·한국천문연구원 월력요항 기준. 노동절(5.1)·제헌절(7.17)·6.3 지방선거일도 공휴일이에요.',
        ],
    },
    8: {
        title: '공책 속지가 더 필요할 때',
        hint: '사용 폰트 · 저작권',
        body: [
            '이 PDF에는 학교안심 둥근미소·그림일기(KERIS, OFL), 나눔스퀘어라운드(네이버, SIL OFL 1.1)를 썼어요.',
            '웹 수첩도 같은 계열 폰트를 불러 글꼴을 맞춥니다.',
            '팔면 안 돼요. 폰트 파일은 팔거나 나눠 주지 않아요.',
            '학생 정보가 보이지 않게 주의하세요.',
        ],
    },
};

export function HowtoPage({ page, pageRec, pages, onGo }) {
    const rec = HOWTO[page] || HOWTO[5];
    const extras = bodyLinks(pageRec);
    return (
        <div>
            <TitleBar title={rec.title} hint={rec.hint} />
            <ol className="nb-howto">
                {rec.body.map((line) => <li key={line}>{line}</li>)}
            </ol>
            {extras.map((l, i) => (
                <GoBtn key={`${l.to}-${i}`} to={l.to} onGo={onGo} className="chip">
                    {l.label || destLabel(l.to, pages)}
                </GoBtn>
            ))}
        </div>
    );
}
