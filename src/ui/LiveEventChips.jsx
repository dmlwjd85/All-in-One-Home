import { Btn } from './bits.jsx';

/**
 * 입력창 바로 아래 실시간 날짜·시각 칩.
 * 칩을 누르면 빼고 글에 두고, 애매한 오전·오후는 옆 단추로 고칩니다.
 */
export function LiveEventChips({ chipRead, chipOff, onToggleOff, ampmFlip, onToggleAmpm }) {
    if (!chipRead || !chipRead.chips.length) return null;
    return (
        <div className="date-chips" data-date-chips="1" data-live-chips="1">
            <div className="date-chip-row">
                {chipRead.chips.map((chip) => {
                    const isOff = chipOff.includes(chip.id);
                    return (
                        <span key={chip.id} className="date-chip-wrap">
                            <Btn
                                className={isOff ? 'chip date-chip is-off' : 'chip on date-chip'}
                                aria-pressed={!isOff}
                                data-chip-type={chip.type}
                                data-chip-ambiguous={chip.ambiguous ? '1' : undefined}
                                aria-label={isOff ? `'${chip.word}' 다시 ${chip.type === 'date' ? '날짜' : '시각'}로 쓰기` : `${chip.label.replace(/^📅 |^⏰ /, '')} 칩 빼고 '${chip.word}'를 글에 두기`}
                                onClick={() => onToggleOff(chip.id)}
                            >
                                {isOff ? `↩ ${chip.word}` : chip.label}
                            </Btn>
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
                저장될 제목: <strong>{chipRead.title}</strong>
                {chipRead.date || chipRead.time ? <> · 저장값 { [chipRead.date, chipRead.time].filter(Boolean).join(' ') }</> : null}
                {' '}· 칩을 누르면 빼고 글에 그대로 둬요.
            </p>
            {chipRead.warning && <p className="msg-card low-card date-chip-warn" role="status">{chipRead.warning}</p>}
        </div>
    );
}
