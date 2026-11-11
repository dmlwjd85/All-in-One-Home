import { Btn } from './bits.jsx';

/**
 * 입력창 바로 아래 실시간 날짜·시각 칩.
 * 칩을 누르면 빼고 글에 두고, 애매한 오전·오후는 옆 단추로 고칩니다.
 * saved: 실제로 저장될 목록(+ 화면·메시지 붙여넣기). 주면 칩 대신 그 값을 '저장될 제목·저장값'으로 보입니다.
 *   여러 건이면 칩 고침이 반영되지 않으므로 칩 줄을 숨기고 건마다 미리보기에서 고치라고 알립니다.
 * dateOnly: 날짜만 저장하는 칸(메모). 시각 칩과 시각 저장값을 보이지 않습니다.
 * title: 칩을 건드리지 않았을 때 저장될 제목(빠른 입력·할 일의 파서 제목). 칩을 뺐으면 칩 미리보기 제목이 저장됩니다.
 * ampmOnly: 메시지 붙여넣기(평점관 r4 P2-2). 제목·날짜는 메시지 파서 값 그대로라 칩은 보여 주기만 하고 오전↔오후만 고칩니다.
 */
export function LiveEventChips({ chipRead, chipOff, onToggleOff, ampmFlip, onToggleAmpm, saved, dateOnly = false, title: parsedTitle = null, ampmOnly = false }) {
    if (!chipRead || !chipRead.chips.length) return null;
    if (Array.isArray(saved) && saved.length > 1) {
        return (
            <div className="date-chips" data-date-chips="1" data-live-chips="1" data-live-multi={saved.length}>
                <p className="muted date-chip-note">{saved.length}건으로 읽었어요. 날짜·시각은 다음 화면에서 건마다 고쳐요.</p>
            </div>
        );
    }
    const one = Array.isArray(saved) ? saved[0] : null;
    const shownChips = dateOnly ? chipRead.chips.filter((chip) => chip.type === 'date') : chipRead.chips;
    if (!shownChips.length) return null;
    const offAny = (chipOff || []).some((id) => chipRead.chips.some((chip) => chip.id === id));
    const title = one ? one.title : (offAny || parsedTitle == null ? chipRead.title : parsedTitle);
    const values = one
        ? [one.end && one.end !== one.date ? `${one.date}~${one.end}` : one.date, one.time]
        : [chipRead.date, dateOnly ? '' : chipRead.time];
    const savedValue = values.filter(Boolean).join(' ');
    if (Array.isArray(saved) && !one) return null;
    return (
        <div className="date-chips" data-date-chips="1" data-live-chips="1">
            <div className="date-chip-row">
                {shownChips.map((chip) => {
                    const isOff = !ampmOnly && chipOff.includes(chip.id);
                    return (
                        <span key={chip.id} className="date-chip-wrap">
                            {ampmOnly ? (
                                <span className="chip on date-chip is-static" data-chip-type={chip.type} data-chip-ambiguous={chip.ambiguous ? '1' : undefined}>
                                    {chip.label}
                                </span>
                            ) : <Btn
                                className={isOff ? 'chip date-chip is-off' : 'chip on date-chip'}
                                aria-pressed={!isOff}
                                data-chip-type={chip.type}
                                data-chip-ambiguous={chip.ambiguous ? '1' : undefined}
                                aria-label={isOff ? `'${chip.word}' 다시 ${chip.type === 'date' ? '날짜' : '시각'}로 쓰기` : `${chip.label.replace(/^📅 |^⏰ /, '')} 칩 빼고 '${chip.word}'를 글에 두기`}
                                onClick={() => onToggleOff(chip.id)}
                            >
                                {isOff ? `↩ ${chip.word}` : chip.label}
                            </Btn>}
                            {!isOff && chip.ambiguous && (
                                <Btn
                                    className="chip date-chip-ampm"
                                    data-ampm-flip={chip.id}
                                    aria-label={`${chip.label.includes('오전') ? '오후' : '오전'}로 바꾸기`}
                                    onClick={() => onToggleAmpm(chip.id)}
                                >
                                    오전↔오후
                                </Btn>
                            )}
                        </span>
                    );
                })}
            </div>
            <p className="muted date-chip-note">
                {dateOnly ? '저장될 글' : '저장될 제목'}: <strong data-live-title="1">{title}</strong>
                {savedValue ? <> · 저장값 <span data-live-value="1">{savedValue}</span></> : null}
                {' '}· {ampmOnly ? '여기서는 오전↔오후만 고쳐요. 제목·날짜는 메시지에서 읽은 그대로예요.' : (one ? '칩을 누르면 빼요.' : '칩을 누르면 빼고 글에 그대로 둬요.')}
            </p>
            {chipRead.warning && <p className="msg-card low-card date-chip-warn" role="status">{chipRead.warning}</p>}
        </div>
    );
}
