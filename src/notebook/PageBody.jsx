import {
    AcademicPage,
    MonthPage,
    SpecialDayPage,
    SpecialTocPage,
    WeekPage,
    WeekTocPage,
    YearCalPage,
} from './templates/CalendarPages.jsx';
import {
    AttendPage,
    ConsultTimePage,
    CounselPage,
    HealthPage,
    IncidentPage,
    LinedForm,
    QuickNotePage,
    RolesPage,
    RosterPage,
    SeatingPage,
    StudentCardPage,
    SurveyPage,
    TimetablePage,
    TocCards,
    WhoRecordPage,
} from './templates/ClassStudentPages.jsx';
import {
    BudgetItemPage,
    BudgetMiscPage,
    BudgetOverview,
    ChecklistPage,
    DeadlinePage,
    EvalAreaPage,
    MeetingPage,
    NoticePage,
    ProgressPage,
    ScorePage,
    TodoSheetPage,
    UnitPage,
} from './templates/LessonWorkPages.jsx';
import { CoverPage, HomePage, HowtoPage, PrepPage } from './templates/FrontPages.jsx';
import { GoBtn } from './fields.jsx';
import {
    BoardPage,
    GenericToc,
    MemoPage,
    NotebookPaperPage,
    SsugeokPage,
    StickerSheetPage,
    StickerTocPage,
    TagIndexPage,
    TagLegendPage,
} from './templates/WritePages.jsx';
import PageTrail from './PageTrail.jsx';
import LocalOnlyBadge from './LocalOnlyBadge.jsx';
import { isLocalOnlyPage } from './localPages.js';

function renderPage(props) {
    const { pageRec } = props;
    const type = pageRec.type;
    const title = pageRec.title;

    switch (type) {
        case 'cover': return <CoverPage {...props} />;
        case 'home': return <HomePage {...props} />;
        case 'prep': return <PrepPage {...props} />;
        case 'howto': return <HowtoPage {...props} />;
        case 'tag-legend': return <TagLegendPage {...props} />;
        case 'tag-index': return <TagIndexPage {...props} />;
        case 'year-cal': return <YearCalPage {...props} />;
        case 'academic': return <AcademicPage {...props} />;
        case 'month': return <MonthPage {...props} />;
        case 'week-toc': return <WeekTocPage {...props} />;
        case 'week': return <WeekPage {...props} />;
        case 'special-toc': return <SpecialTocPage {...props} />;
        case 'special-day': return <SpecialDayPage {...props} />;
        case 'class-toc': return <TocCards title="학급 목차" hint="시간표 · 전담·특별실 · 자리 · 1인 1역 · 학급 약속" {...props} />;
        case 'timetable': return <TimetablePage {...props} />;
        case 'class-rules': return <LinedForm title="우리 반 약속" n={14} {...props} />;
        case 'roles': return <RolesPage {...props} />;
        case 'seating': return <SeatingPage {...props} />;
        case 'roster': return <RosterPage {...props} />;
        case 'survey': return <SurveyPage {...props} />;
        case 'health': return <HealthPage {...props} />;
        case 'student-card': return <StudentCardPage {...props} />;
        case 'student-who': return <WhoRecordPage {...props} />;
        case 'quick-note': return <QuickNotePage {...props} />;
        case 'attend-toc': return <TocCards title="출결 목차" hint="달마다 1~16번, 17~32번 두 쪽이에요" {...props} />;
        case 'attend': return <AttendPage {...props} />;
        case 'counsel-toc': return <TocCards title="상담 목차" hint="번호를 누르면 그 학생 쪽이에요" {...props} />;
        case 'counsel': return <CounselPage kind="counsel" {...props} />;
        case 'parent': return <CounselPage kind="parent" {...props} />;
        case 'consult-time': return <ConsultTimePage {...props} />;
        case 'incident': return <IncidentPage {...props} />;
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
                {...props}
            />
        );
        case 'budget-item': return <BudgetItemPage {...props} />;
        case 'budget-misc': return <BudgetMiscPage {...props} />;
        case 'year-prep': return <LinedForm title="2027학년도 준비 · 인수인계" n={14} {...props} />;
        case 'ssugeok-toc': return <TocCards title="쓱적·메모 목차" hint="쓱적 · 모눈 · 점 · 무지 다섯 장씩" {...props} />;
        case 'ssugeok': return <SsugeokPage {...props} />;
        case 'memo': return <MemoPage {...props} />;
        case 'notebook-toc': return <TocCards title="공책 목차" hint="이름을 누르면 1쪽, 숫자를 누르면 그 쪽으로 가요" {...props} />;
        case 'notebook-paper': return <NotebookPaperPage {...props} />;
        case 'board-toc': return <TocCards title="칠판 · 화이트보드 · 모눈" {...props} />;
        case 'chalkboard':
        case 'whiteboard':
        case 'grid-board':
            return <BoardPage {...props} />;
        case 'sticker-toc': return <StickerTocPage {...props} />;
        case 'sticker-sheet': return <StickerSheetPage {...props} />;
        default:
            return <GenericToc title={title} hint="이 쪽의 링크는 위에 그대로 연결되어 있어요" {...props} />;
    }
}

export default function PageBody(props) {
    const inner = renderPage(props);
    const type = props.pageRec.type;
    const localOnly = isLocalOnlyPage(props.page);
    if (type === 'cover' || type === 'ssugeok') {
        return localOnly ? (<><LocalOnlyBadge />{inner}</>) : inner;
    }
    return (
        <>
            {localOnly && <LocalOnlyBadge />}
            <PageTrail
                page={props.page}
                fields={props.fields}
                sensitiveNotes={props.sensitiveNotes}
                onOpenNote={props.onOpenNote}
            />
            {inner}
        </>
    );
}
