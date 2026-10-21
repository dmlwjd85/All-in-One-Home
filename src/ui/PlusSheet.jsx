import { PLUS_ACTIONS } from './actions.js';
import { Btn } from './bits.jsx';
import { ChoiceGrid } from './pickers.jsx';

export function PlusSheet({ onClose, onPick }) {
    return (
        <div className="sheet-back" onClick={onClose}>
            <div className="sheet" role="dialog" aria-modal="true" aria-label="할 일 고르기" data-screen="plus" onClick={(event) => event.stopPropagation()}>
                <div style={{ width: 40, height: 4, borderRadius: 99, background: 'var(--line)', margin: '8px auto 12px' }} />
                <h2 className="title-font" style={{ fontSize: 22, margin: '0 0 12px' }}>무엇을 할까요?</h2>
                <ChoiceGrid label="할 일" options={PLUS_ACTIONS.map((item) => ({ id: item.id, label: item.label, emoji: item.emoji }))} onPick={(id) => onPick(PLUS_ACTIONS.find((item) => item.id === id))} />
                <Btn className="chip block" style={{ marginTop: 12 }} onClick={onClose}>닫기</Btn>
            </div>
        </div>
    );
}
