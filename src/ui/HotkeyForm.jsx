import { useState } from 'react';
import {
    HOTKEY_ACTIONS,
    assignHotkey,
    browserCombo,
    clearsHotkey,
    hotkeyFromEvent,
    hotkeyLabel,
    hotkeysAvailable,
    loadHotkeys,
    resetHotkeys,
    saveHotkeys,
} from './hotkeys.js';
import { Btn } from './bits.jsx';

export function HotkeyForm({ onShowList }) {
    const [ready] = useState(() => hotkeysAvailable());
    const [map, setMap] = useState(() => loadHotkeys());
    const [armed, setArmed] = useState('');
    const [note, setNote] = useState('');

    if (!ready) {
        return <p>키보드가 있을 때 쓸 수 있어요. 컴퓨터에서는 여기서 키를 정하고, 휴대폰에서는 기본으로 / 키가 콕을 엽니다.</p>;
    }

    function commit(id, key) {
        const result = assignHotkey(map, id, key);
        setMap(result.map);
        saveHotkeys(result.map);
        setArmed('');
        if (!key) setNote('그 키는 빼 두었어요.');
        else if (result.movedFrom) setNote(`‘${result.movedFrom}’에 있던 키를 여기로 옮겼어요.`);
        else setNote('이 기기에 저장해 두었어요.');
    }

    const groups = [];
    for (const action of HOTKEY_ACTIONS) {
        const last = groups[groups.length - 1];
        if (!last || last.name !== action.group) groups.push({ name: action.group, items: [action] });
        else last.items.push(action);
    }

    return (
        <div>
            <p>자주 가는 화면이랑 콕을 키 하나로 열 수 있어요. 칸을 누르고, 쓰고 싶은 키를 누르면 이 기기에 남습니다.</p>
            <p className="muted">글을 적는 중에는 단축키가 쉬어요. 한글을 조합하는 동안도 그렇습니다. Ctrl이나 Command, Alt가 들어간 키는 브라우저가 먼저 써서 받지 않아요. 빼려면 그 칸에서 지우기 키를 누르세요.</p>
            {groups.map((group) => (
                <div key={group.name}>
                    <p className="muted" style={{ margin: '12px 0 6px' }}>{group.name}</p>
                    <div className="hotkey-list">
                        {group.items.map((action) => (
                            <div className="hotkey-row" key={action.id}>
                                <span>{action.label}</span>
                                <Btn
                                    className="field hotkey-key"
                                    data-hotkey-capture="1"
                                    aria-pressed={armed === action.id}
                                    aria-label={`${action.label} 단축키, 지금 ${hotkeyLabel(map[action.id])}`}
                                    onClick={() => { setArmed(action.id); setNote('원하는 키를 눌러 주세요.'); }}
                                    onBlur={() => setArmed((cur) => (cur === action.id ? '' : cur))}
                                    onKeyDown={(event) => {
                                        if (armed !== action.id) return;
                                        event.preventDefault();
                                        event.stopPropagation();
                                        if (event.key === 'Escape') {
                                            setArmed('');
                                            setNote('');
                                            return;
                                        }
                                        if (browserCombo(event)) {
                                            setNote('Ctrl이나 Command, Alt가 들어간 키는 브라우저가 먼저 가져가서, 여기엔 두지 않았어요.');
                                            return;
                                        }
                                        if (clearsHotkey(event)) {
                                            commit(action.id, '');
                                            return;
                                        }
                                        const key = hotkeyFromEvent(event);
                                        if (!key) {
                                            setNote('그 키는 받기 어려워요. 글자나 숫자, 기호를 눌러 주세요.');
                                            return;
                                        }
                                        commit(action.id, key);
                                    }}
                                >{armed === action.id ? '눌러 주세요' : hotkeyLabel(map[action.id])}</Btn>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
            {note && <p role="status">{note}</p>}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                <Btn className="chip" onClick={() => { setMap(resetHotkeys()); setArmed(''); setNote('처음 키로 돌려 두었어요. 콕은 / 키예요.'); }}>기본값으로 되돌리기</Btn>
                <Btn className="chip" onClick={onShowList}>단축키 목록</Btn>
            </div>
            <p className="muted">목록은 ? 키로도 볼 수 있어요. 기본으로는 / 키가 콕을 엽니다.</p>
        </div>
    );
}
