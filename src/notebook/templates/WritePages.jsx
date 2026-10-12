import { Ink, LinkGrid, LinkedChip, TitleBar } from '../fields.jsx';
import { TAGS } from '../labels.js';
import { partitionLinks } from '../linkParts.js';
import PraiseBoard from '../PraiseBoard.jsx';
import SsugeokBoard from '../SsugeokBoard.jsx';
import { captureNote } from '../ssugeokStore.js';

export function TagLegendPage({ onGo }) {
    const groups = [...new Set(TAGS.map((t) => t.group))];
    return (
        <div className="nb-fill">
            <TitleBar title="태그 범례" hint="쪽 위 # 칸에 태그를 적어 표시해요. 칩을 누르면 그 태그 색인 쪽으로 가요" />
            {groups.map((g) => (
                <section key={g} className="nb-taggroup">
                    <h3>{g}</h3>
                    <div className="nb-tagrow">
                        {TAGS.filter((t) => t.group === g).map((t) => (
                            <button
                                key={t.id}
                                type="button"
                                className="nb-tagchip"
                                style={{ background: t.color }}
                                onClick={() => onGo(t.page)}
                                aria-label={`#${t.id} ${t.hint} (${t.page}쪽)`}
                            >
                                #{t.id}<small>{t.hint}</small>
                            </button>
                        ))}
                    </div>
                </section>
            ))}
            <p className="nb-hint">한 건에 태그는 세 개까지만. 학생은 이름 대신 번호로 적어요. 생기부로 옮기기 전에 대회·수상, 부모 직업, 학원 이름은 쓰지 않아요.</p>
        </div>
    );
}

export function TagIndexPage({ extra, fields, setField }) {
    return (
        <div>
            <TitleBar title={extra.tag || '#태그'} hint="색인 · 날짜 · 쪽 · 학생 · 내용" />
            <table className="nb-table compact">
                <thead><tr><th>날짜</th><th>쪽</th><th>학생</th><th>내용</th></tr></thead>
                <tbody>
                    {Array.from({ length: 14 }, (_, i) => (
                        <tr key={i}>
                            {['d', 'p', 's', 't'].map((k) => (
                                <td key={k}><Ink value={fields[`${k}${i}`]} onChange={(v) => setField(`${k}${i}`, v)} /></td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}

export function SsugeokPage({
    page,
    pageRec,
    extra,
    fields,
    setField,
    signedIn,
    author,
    onChanged,
    onToast,
    onOpenHub,
    onGo,
    pages,
    ssugeokNotes,
    focusId,
}) {
    const legacyLines = Array.from({ length: 14 }, (_, i) => i).filter((i) => String(fields[`ln${i}`] || '').trim());
    const legacyStickies = [0, 1, 2, 3].filter((i) => String(fields[`st${i}`] || '').trim());
    const keepLegacy = legacyLines.length > 0 || legacyStickies.length > 0;
    const sendLine = async (i) => {
        const text = String(fields[`ln${i}`] || '').trim();
        if (!text) {
            onToast('빈 줄은 목록에 넣을 수 없어요.');
            return;
        }
        await captureNote({ text, author, fromPage: page, signedIn });
        onChanged?.();
        onToast('목록에 남겼어요. 줄에 적어 둔 글은 그대로예요.');
    };
    return (
        <div className="nb-ssugeok nb-fill">
            <TitleBar title={`쓱적 ${extra.slot || 1}`} hint="먼저 적고, 나중에 나눕니다. 한 줄에 한 건." />
            <SsugeokBoard
                notes={ssugeokNotes || []}
                signedIn={signedIn}
                author={author}
                fromPage={page}
                onChanged={onChanged}
                onToast={onToast}
                onGo={onGo}
                focusId={focusId}
            />
            <div className="nb-tagrow nb-ssu-links">
                {partitionLinks(pageRec).body.map((l, i) => (
                    <LinkedChip key={`${l.to}-${i}`} link={l} pages={pages} pageNo={page} onGo={onGo} />
                ))}
            </div>
            {keepLegacy && (
                <details className="nb-legacy">
                    <summary>이전에 적어 둔 줄</summary>
                    {legacyLines.map((i) => (
                        <div key={i} className="nb-ssu-line">
                            <span>{i + 1}</span>
                            <Ink value={fields[`ln${i}`]} onChange={(v) => setField(`ln${i}`, v)} placeholder="한 줄" aria={`줄 ${i + 1}`} />
                            <button type="button" className="nb-mini" onClick={() => sendLine(i)}>목록에 남기기</button>
                        </div>
                    ))}
                    {legacyStickies.length > 0 && (
                        <div className="nb-stickies">
                            {legacyStickies.map((i) => (
                                <Ink key={i} multiline rows={3} className="nb-sticky" value={fields[`st${i}`]} onChange={(v) => setField(`st${i}`, v)} placeholder="붙임 메모" />
                            ))}
                        </div>
                    )}
                </details>
            )}
            <button type="button" className="nb-hubbtn" onClick={onOpenHub}>예전 분류 허브</button>
        </div>
    );
}

export function MemoPage({ extra, fields, setField }) {
    const kind = extra.slot <= 10 ? '모눈' : extra.slot <= 15 ? '점' : '무지';
    return (
        <div>
            <TitleBar title={`메모 ${extra.slot || ''}`} hint={kind} />
            <Ink multiline rows={16} className={`nb-paper-${kind === '모눈' ? 'grid' : kind === '점' ? 'dot' : 'plain'}`} value={fields.body} onChange={(v) => setField('body', v)} placeholder="메모" />
        </div>
    );
}

export function NotebookPaperPage({ extra, fields, setField }) {
    const title = extra.paper || '공책';
    const cls = /오선/.test(title) ? 'staff'
        : /받아쓰기|원고지/.test(title) ? 'square'
        : /깍두기|모눈|점/.test(title) ? 'grid'
        : /영어/.test(title) ? 'english'
        : /일기|코넬|배움|알림|독서/.test(title) ? 'lined'
        : /무지/.test(title) ? 'plain'
        : 'lined';
    return (
        <div>
            <TitleBar title={title} />
            {/그림일기/.test(title) && (
                <div className="nb-drawbox">그림</div>
            )}
            <Ink multiline rows={14} className={`nb-paper-${cls}`} value={fields.body} onChange={(v) => setField('body', v)} placeholder="여기에 적어요" />
        </div>
    );
}

export function BoardPage({ page, fields, setField }) {
    const title = page === 560 ? '칠판' : page === 561 ? '화이트보드' : '모눈';
    const cls = page === 560 ? 'chalk' : page === 561 ? 'white' : 'grid';
    return (
        <div>
            <TitleBar title={title} hint="학생 정보가 보이지 않게 주의하세요." />
            <Ink multiline rows={16} className={`nb-board nb-board-${cls}`} value={fields.body} onChange={(v) => setField('body', v)} placeholder="판서" />
        </div>
    );
}

export function StickerTocPage({ page, pageRec, pages, onGo, praiseBoard, signedIn, onChanged, onToast }) {
    const { body } = partitionLinks(pageRec);
    return (
        <div className="nb-fill">
            <TitleBar title="칭찬 스티커" hint="번호를 누르면 스티커가 하나 늘어요. 목표를 채우면 잠깐 축하해요" />
            <PraiseBoard board={praiseBoard} signedIn={signedIn} onChanged={onChanged} onToast={onToast} />
            <p className="nb-kicker">스티커 시트</p>
            <LinkGrid links={body} pages={pages} pageNo={page} onGo={onGo} className="nb-sticker-links" />
        </div>
    );
}

const STICKERS = [
    '잘했어요', '최고', '수고', '오!', '굿', '통과', '다시', '확인',
    '중요', '완료', '옮김', 'N?', '공문', '마감', '회의', '상담',
    '출결', '보건', '안전', '예산', '월', '화', '수', '목', '금',
];

export function StickerSheetPage({ page, fields, setField }) {
    return (
        <div>
            <TitleBar title={`스티커 시트 p.${page}`} hint="눌러 고른 뒤, 필요한 쪽에 글자 스티커처럼 옮겨 적어요" />
            <div className="nb-sticker-sheet">
                {STICKERS.map((s) => (
                    <button
                        key={s}
                        type="button"
                        className="nb-sticker"
                        onClick={() => setField('picked', `${fields.picked ? `${fields.picked} ` : ''}${s}`)}
                    >
                        {s}
                    </button>
                ))}
            </div>
            <Ink value={fields.picked} onChange={(v) => setField('picked', v)} placeholder="고른 스티커" />
            <Ink multiline rows={6} value={fields.note} onChange={(v) => setField('note', v)} placeholder="이 시트 메모" />
        </div>
    );
}

export function GenericToc({ title, hint, page, pageRec, pages, onGo }) {
    const { body } = partitionLinks(pageRec);
    return (
        <div className="nb-fill">
            <TitleBar title={title} hint={hint} />
            <LinkGrid links={body} pages={pages} pageNo={page} onGo={onGo} />
        </div>
    );
}
