/** PDF 쪽 번호 → 짧은 이름. 링크 라벨이 비었을 때 씁니다. */
export const DEST_LABEL = {
    1: '표지',
    2: '홈',
    3: '새 학년 준비',
    5: '사용법',
    9: '태그 색인',
    32: '연간 달력',
    33: '학사일정',
    34: '3월',
    35: '4월',
    36: '5월',
    37: '6월',
    38: '7월',
    39: '8월',
    40: '9월',
    41: '10월',
    42: '11월',
    43: '12월',
    44: '1월',
    45: '2월',
    46: '주간 목차',
    99: '특별한 하루',
    140: '학급',
    141: '시간표',
    146: '1인 1역',
    148: '자리 배치',
    154: '명렬표',
    155: '기초조사',
    157: '건강',
    231: '출결',
    256: '상담',
    335: '수업',
    350: '단원',
    380: '체크리스트',
    396: '점수 체크',
    404: '업무',
    405: '기한 있는 일',
    411: '업무 할 일',
    417: '회의록',
    458: '전달 사항',
    468: '예산',
    469: '예산 사업',
    493: '연락처',
    494: '2027 준비',
    495: '쓱, 적 · 메모',
    496: '쓱, 적',
    516: '공책',
    559: '칠판',
    560: '칠판',
    561: '화이트보드',
    562: '모눈',
    563: '스티커',
};

export const TAGS = [
    { id: '관찰', page: 10, group: '학생 기록', hint: '누가기록·관찰', color: '#f6c1c6' },
    { id: '출결', page: 11, group: '학생 기록', hint: '결석·지각·서류', color: '#f8d39a' },
    { id: '교과', page: 12, group: '학생 기록', hint: '교과 성취·특기', color: '#f6e08a' },
    { id: '창체', page: 13, group: '학생 기록', hint: '자율·자치·동아리', color: '#c8e6b3' },
    { id: '진로', page: 14, group: '학생 기록', hint: '진로활동', color: '#b7e4d6' },
    { id: '행특', page: 15, group: '학생 기록', hint: '행동특성·종합의견', color: '#b9d4f6' },
    { id: '상담', page: 16, group: '소통', hint: '학생 상담', color: '#cbb8f0' },
    { id: '학부모', page: 17, group: '소통', hint: '보호자 상담·연락', color: '#f0c3e4' },
    { id: '생활', page: 18, group: '보호·안전', hint: '생활지도', color: '#f5c6a8' },
    { id: '학폭', page: 19, group: '보호·안전', hint: '학교폭력 관련', color: '#e8a0a0' },
    { id: '보건', page: 20, group: '보호·안전', hint: '건강·투약·응급', color: '#f7b7c9' },
    { id: '안전', page: 21, group: '보호·안전', hint: '안전사고·교육', color: '#f3d27a' },
    { id: '민원', page: 22, group: '보호·안전', hint: '민원·교육활동 침해', color: '#d7c4b0' },
    { id: '수업', page: 23, group: '수업·평가', hint: '수업 아이디어·성찰', color: '#a8d5c2' },
    { id: '평가', page: 24, group: '수업·평가', hint: '평가 계획·결과', color: '#9ec9e8' },
    { id: '학습지원', page: 25, group: '수업·평가', hint: '기초학력·보정', color: '#c5d68a' },
    { id: '마감', page: 26, group: '업무·행사', hint: '공문·제출 마감', color: '#e8b4a0' },
    { id: '회의', page: 27, group: '업무·행사', hint: '회의 결정·할 일', color: '#b8c4e8' },
    { id: '행사', page: 28, group: '업무·행사', hint: '행사·체험학습', color: '#f0d08a' },
    { id: '예산', page: 29, group: '업무·행사', hint: '예산·품의·구입', color: '#c8e0c0' },
    { id: '연수', page: 30, group: '업무·행사', hint: '연수·출장', color: '#d0c4f0' },
    { id: '개인', page: 31, group: '개인', hint: '개인 일정·마음', color: '#ead7c4' },
];

export function destLabel(to, pages) {
    if (DEST_LABEL[to]) return DEST_LABEL[to];
    const page = pages?.[to - 1];
    return page?.title || `${to}쪽`;
}

export function topNavLabel(link, pageNo) {
    if (link.label) return link.label;
    if (link.to === pageNo + 1) return '다음';
    if (link.to === pageNo - 1) return '이전';
    if (link.to === 2) return '홈';
    return destLabel(link.to);
}

const TYPE_LABEL = {
    cover: '표지',
    home: '홈',
    prep: '새 학년 준비',
    howto: '사용법',
    'tag-legend': '태그 범례',
    'tag-index': '태그',
    'year-cal': '연간 달력',
    academic: '학사일정',
    month: '달력',
    'week-toc': '주간 목차',
    week: '주간',
    'special-toc': '특별한 하루',
    'special-day': '특별한 하루',
    'class-toc': '학급',
    timetable: '시간표',
    'class-rules': '우리 반 약속',
    roles: '1인 1역',
    seating: '자리 배치',
    roster: '명렬표',
    survey: '기초조사',
    health: '건강',
    'student-card': '학생 카드',
    'student-who': '누가기록',
    'quick-note': '짧은 기록',
    'attend-toc': '출결',
    attend: '출결',
    'counsel-toc': '상담',
    counsel: '상담',
    parent: '보호자 상담',
    'consult-time': '상담 시간',
    incident: '생활 · 사고',
    'lesson-toc': '수업',
    progress: '진도표',
    'eval-area': '평가 영역',
    unit: '단원',
    checklist: '체크리스트',
    score: '점수 체크',
    'work-toc': '업무',
    deadline: '기한 있는 일',
    todo: '업무 할 일',
    meeting: '회의록',
    notice: '전달 사항',
    'budget-toc': '예산',
    'budget-item': '예산 사업',
    'budget-misc': '예산',
    'year-prep': '2027 준비',
    'ssugeok-toc': '쓱, 적 · 메모',
    ssugeok: '쓱, 적',
    memo: '메모',
    'notebook-toc': '공책',
    'notebook-paper': '공책',
    'board-toc': '칠판',
    chalkboard: '칠판',
    whiteboard: '화이트보드',
    'grid-board': '모눈',
    'sticker-toc': '스티커',
    'sticker-sheet': '스티커',
};

/** 공책 용지 이름 → 화면에 보일 제목. PDF 원문 '월'처럼 한 글자인 이름은 풀어 씁니다. */
export function paperFace(raw) {
    const name = String(raw || '').replace(/\s+/g, ' ').trim();
    if (name === '월') {
        return {
            title: '월간 노트',
            hint: '한 달의 주를 나눠 적는 공책입니다.',
            face: 'month',
        };
    }
    const blank = name.match(/^무지\s*(.*)$/);
    if (blank) {
        const n = (blank[1] || '').trim();
        return {
            title: n ? `무지 노트 ${n}` : '무지 노트',
            hint: '줄이 없는 공책입니다. 빈칸에 자유롭게 적어요.',
            face: 'plain',
        };
    }
    return { title: name || '공책', hint: '이 공책에 바로 적어요.', face: 'sheet' };
}

/** 헤더·바로가기 버튼에 쓰는 짧은 이름. 옆 쪽이면 다음/이전. */
export function navLabel(to, pages, pageNo) {
    if (pageNo && to === pageNo + 1) return '다음';
    if (pageNo && to === pageNo - 1) return '이전';
    if (DEST_LABEL[to]) return DEST_LABEL[to];
    const dest = pages?.[to - 1];
    if (!dest) return `${to}쪽`;
    if (dest.type === 'attend') {
        const half = dest.extra?.half === '17-32' ? '17~32번' : '1~16번';
        const mon = dest.extra?.month ? `${dest.extra.month}월 ` : '';
        return `출결 ${mon}${half}`;
    }
    if (dest.type === 'month' && dest.extra?.month) return `${dest.extra.month}월`;
    if (dest.type === 'week' && dest.extra?.week) return `${dest.extra.week}주차`;
    const title = String(dest.title || '').replace(/\s+/g, ' ').trim();
    if (dest.type === 'notebook-paper') return paperFace(dest.extra?.paper || title).title;
    const usable = title && title.length >= 2 && title.length <= 18 && !/누르면|충분|적고|인쇄|체크하면|옮겨/.test(title);
    if (usable) return title;
    const base = TYPE_LABEL[dest.type] || `${to}쪽`;
    const n = dest.extra?.student;
    if (n && (dest.type === 'student-card' || dest.type === 'student-who' || dest.type === 'counsel' || dest.type === 'parent')) {
        return `${base} ${n}번`;
    }
    if (dest.type === 'ssugeok' && dest.extra?.slot) return `쓱, 적 ${dest.extra.slot}`;
    if (dest.type === 'meeting' && dest.extra?.slot) return `회의록 ${dest.extra.slot}`;
    return base;
}

/** 본문 버튼 글자. PDF에서 읽은 짧은 라벨을 우선합니다. */
export function linkText(link, pages, pageNo) {
    const raw = String(link?.label || '').replace(/\s+/g, ' ').trim();
    if (raw.startsWith('#')) return raw.split(/\s/)[0];
    if (raw && raw.length <= 24) return raw;
    return navLabel(link.to, pages, pageNo);
}
