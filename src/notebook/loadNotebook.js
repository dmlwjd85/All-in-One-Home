import { sectionForPage } from './sections.js';

const LOADERS = {
    front: () => import('virtual:notebook-section/front'),
    year: () => import('virtual:notebook-section/year'),
    week: () => import('virtual:notebook-section/week'),
    day: () => import('virtual:notebook-section/day'),
    klass: () => import('virtual:notebook-section/klass'),
    student: () => import('virtual:notebook-section/student'),
    attend: () => import('virtual:notebook-section/attend'),
    counsel: () => import('virtual:notebook-section/counsel'),
    lesson: () => import('virtual:notebook-section/lesson'),
    work: () => import('virtual:notebook-section/work'),
    write: () => import('virtual:notebook-section/write'),
    tail: () => import('virtual:notebook-section/tail'),
};

const cache = new Map();

export { sectionForPage };

export function loadSection(name) {
    if (!cache.has(name)) {
        const load = LOADERS[name];
        if (!load) return Promise.reject(new Error(`없는 구역입니다: ${name}`));
        const pending = load()
            .then((mod) => mod.default)
            .catch((err) => {
                cache.delete(name);
                throw err;
            });
        cache.set(name, pending);
    }
    return cache.get(name);
}

export function dropSection(name) {
    cache.delete(name);
}
