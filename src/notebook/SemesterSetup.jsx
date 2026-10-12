import { GoBtn, Tick } from './fields.jsx';

const STEPS = [
    { id: 'roster', label: '명렬표에 이름을 적어요', to: 154 },
    { id: 'card', label: '학생 카드에서 이어진 이름을 확인해요', to: 159 },
    { id: 'attend', label: '출결 쪽을 열어요', to: 231 },
    { id: 'time', label: '시간표를 적어요', to: 141 },
    { id: 'seat', label: '자리 배치를 정해요', to: 148 },
    { id: 'health', label: '건강 특이사항을 확인해요', to: 157 },
    { id: 'backup', label: '백업 파일을 받아 둬요', to: null },
];

export default function SemesterSetup({ fields, setField, onGo, rosterCount = 0 }) {
    const doneTicks = STEPS.filter((step) => fields?.[`setup_${step.id}`]).length;
    return (
        <section className="nb-setup" aria-label="새 학기 설정">
            <header className="nb-titlebar">
                <p className="nb-kicker">새 학기 설정</p>
                <h2 className="nb-pagetitle">시작 전에 체크</h2>
                <p className="nb-hint">명렬에 적은 이름은 학생 카드와 출결 번호 옆에 이어집니다. {doneTicks}/{STEPS.length}</p>
            </header>
            <p className="nb-setup-count">명렬 이름 {rosterCount}/32</p>
            <ul className="nb-setup-list">
                {STEPS.map((step) => (
                    <li key={step.id}>
                        <Tick
                            checked={!!fields?.[`setup_${step.id}`]}
                            onChange={(value) => setField(`setup_${step.id}`, value)}
                            label={step.label}
                        />
                        {step.to ? (
                            <GoBtn to={step.to} onGo={onGo} className="slim">{step.to}쪽</GoBtn>
                        ) : null}
                    </li>
                ))}
            </ul>
        </section>
    );
}
