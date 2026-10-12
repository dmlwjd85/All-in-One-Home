import { Suspense, lazy } from 'react';
import PageTrail from './PageTrail.jsx';
import LocalOnlyBadge from './LocalOnlyBadge.jsx';
import { isLocalOnlyPage } from './localPages.js';

const GROUPS = [
    {
        name: 'front',
        exportName: 'FrontGroup',
        types: ['cover', 'home', 'prep', 'howto'],
        load: () => import('./templates/FrontPages.jsx'),
    },
    {
        name: 'calendar',
        exportName: 'CalendarGroup',
        types: ['year-cal', 'academic', 'month', 'week-toc', 'week', 'special-toc', 'special-day'],
        load: () => import('./templates/CalendarPages.jsx'),
    },
    {
        name: 'klass',
        exportName: 'ClassGroup',
        types: [
            'class-toc', 'timetable', 'class-rules', 'roles', 'seating', 'roster', 'survey', 'health',
            'student-card', 'student-who', 'quick-note', 'attend-toc', 'attend', 'counsel-toc',
            'counsel', 'parent', 'consult-time', 'incident', 'year-prep',
        ],
        load: () => import('./templates/ClassStudentPages.jsx'),
    },
    {
        name: 'lesson',
        exportName: 'LessonGroup',
        types: [
            'lesson-toc', 'progress', 'eval-area', 'unit', 'checklist', 'score', 'work-toc',
            'deadline', 'todo', 'meeting', 'notice', 'budget-toc', 'budget-item', 'budget-misc',
        ],
        load: () => import('./templates/LessonWorkPages.jsx'),
    },
    {
        name: 'write',
        exportName: 'WriteGroup',
        types: [
            'tag-legend', 'tag-index', 'ssugeok-toc', 'ssugeok', 'memo', 'notebook-toc', 'notebook-paper',
            'board-toc', 'chalkboard', 'whiteboard', 'grid-board', 'sticker-toc', 'sticker-sheet',
        ],
        load: () => import('./templates/WritePages.jsx'),
    },
];

const byType = new Map(GROUPS.flatMap((group) => group.types.map((type) => [type, group])));
const lazyGroups = new Map();

function groupComponent(type) {
    const group = byType.get(type) || GROUPS[GROUPS.length - 1];
    if (!lazyGroups.has(group.name)) {
        lazyGroups.set(group.name, lazy(() => group.load().then((mod) => ({ default: mod[group.exportName] }))));
    }
    return lazyGroups.get(group.name);
}

export default function PageBody(props) {
    const type = props.pageRec.type;
    const localOnly = isLocalOnlyPage(props.page);
    const Group = groupComponent(type);
    const inner = (
        <Suspense fallback={<p className="nb-hint">쪽을 열고 있습니다…</p>}>
            <Group {...props} />
        </Suspense>
    );
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
