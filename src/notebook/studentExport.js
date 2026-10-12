import { counselPage, parentPage, whoPage } from './ssugeokModel.js';
import { readPageFields } from './fieldStore.js';
import { studentCardPage } from './nav.js';

function esc(value) {
    return String(value ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}

export function buildStudentExport(studentNo, rosterName = '') {
    const n = Number(studentNo);
    const card = readPageFields(studentCardPage(n));
    return {
        exportedAt: new Date().toISOString(),
        student: n,
        name: rosterName || card.name || '',
        card,
        who: readPageFields(whoPage(n)),
        counsel: readPageFields(counselPage(n)),
        parent: readPageFields(parentPage(n)),
    };
}

/** 학생 카드·누가·상담을 인쇄 보기로 엽니다. 팝업이 막히면 false. */
export function printStudentExport(payload) {
    const whoRows = Array.from({ length: 12 }, (_, i) => {
        const date = payload.who?.[`d${i}`];
        const area = payload.who?.[`a${i}`];
        const text = payload.who?.[`t${i}`];
        if (!date && !area && !text) return '';
        return `<tr><td>${esc(date)}</td><td>${esc(area)}</td><td>${esc(text)}</td></tr>`;
    }).filter(Boolean).join('');
    const counselRows = ['counsel', 'parent'].flatMap((key) => (
        Array.from({ length: 4 }, (_, i) => {
            const text = payload[key]?.[`t${i}`];
            if (!text) return '';
            const label = key === 'parent' ? '보호자 상담' : '상담';
            return `<tr><td>${esc(label)}</td><td>${esc(payload[key]?.[`d${i}`])}</td><td>${esc(text)}</td></tr>`;
        })
    )).filter(Boolean).join('');
    const cardRows = [
        ['이름', payload.name || payload.card?.name],
        ['생년월일', payload.card?.birth],
        ['성별', payload.card?.sex],
        ['보호자', payload.card?.guard],
        ['연락처', payload.card?.tel1],
        ['건강', payload.card?.health],
        ['성격 · 교우', payload.card?.peer],
        ['학습', payload.card?.learn],
    ].filter(([, value]) => String(value || '').trim()).map(([label, value]) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`).join('');
    const html = `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(payload.student)}번 기록</title>
<style>
body{font-family:Pretendard,sans-serif;color:#3d312b;margin:24px}
h1{font-size:22px;margin:0 0 12px}
h2{font-size:16px;margin:18px 0 6px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #c8b8a4;padding:6px 8px;font-size:14px;text-align:left;vertical-align:top}
th{width:7rem;background:#f6efe6}
</style></head><body>
<h1>${esc(payload.student)}번 ${esc(payload.name || '')} 기록</h1>
<h2>학생 카드</h2><table>${cardRows || '<tr><td>아직 적은 내용이 없습니다.</td></tr>'}</table>
<h2>누가기록</h2><table><thead><tr><th>날짜</th><th>영역</th><th>내용</th></tr></thead><tbody>${whoRows || '<tr><td colspan="3">아직 적은 내용이 없습니다.</td></tr>'}</tbody></table>
<h2>상담</h2><table><thead><tr><th>구분</th><th>날짜</th><th>내용</th></tr></thead><tbody>${counselRows || '<tr><td colspan="3">아직 적은 내용이 없습니다.</td></tr>'}</tbody></table>
</body></html>`;
    const view = window.open('', '_blank', 'noopener,noreferrer');
    if (!view) return false;
    view.document.open();
    view.document.write(html);
    view.document.close();
    view.addEventListener('load', () => view.print());
    return true;
}
