import { useState } from 'react';
import titles from '../data/legacyTitles.json';
import { applyLegacy, finishSetup, loadDemo, previewLegacy } from '../lib/db.js';
import { cloudReady, signInGoogle } from '../firebase.js';
import { setAuth } from '../lib/db.js';
import { useUi } from './context.jsx';
import { Btn, Symbol } from './bits.jsx';

export function Start() {
    const { showToast, go } = useUi();
    const [step, setStep] = useState('choose');
    const [className, setClassName] = useState('');
    const [roster, setRoster] = useState('');
    const [plan, setPlan] = useState(null);
    const [busy, setBusy] = useState(false);

    async function afterChoice() {
        const found = previewLegacy(titles);
        if (found && found.counts.original) {
            setPlan(found);
            setStep('migrate');
            return;
        }
        setStep('class');
    }

    return (
        <div style={{ maxWidth: 480, margin: '0 auto', padding: 20 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <Symbol />
                <strong className="title-font" style={{ fontSize: 18 }}>쓱</strong>
            </div>
            <h1 className="title-font" style={{ fontSize: 32, lineHeight: '40px' }}>쓱 교무수첩</h1>
            <p style={{ fontSize: 16 }}>열자마자 쓱, 적. 담임의 하루가 한 화면에 있어요.</p>
            {step === 'choose' && (
                <div className="solid-card" style={{ padding: 16 }}>
                    <p style={{ marginTop: 0 }}>학생 기록은 선생님 자리에만 둡니다. 광고는 없어요.</p>
                    <Btn className="primary-btn block" onClick={afterChoice}>이 기기에서만 써 볼게요</Btn>
                    <Btn className="chip block" style={{ marginTop: 8 }} disabled={!cloudReady()} onClick={async () => {
                        try {
                            const cred = await signInGoogle();
                            await setAuth({ uid: cred.user.uid, name: cred.user.displayName || '', email: cred.user.email || '' });
                            await afterChoice();
                        } catch (error) {
                            showToast(error.code === 'no-config' ? '클라우드 연결은 아직 준비 중이에요.' : '로그인하지 못했어요. 잠시 후 다시 눌러 주세요.');
                        }
                    }}>구글 로그인</Btn>
                    {!cloudReady() && <p className="muted">클라우드 로그인은 연결을 기다리는 중이에요. 그때까지는 이 기기에만 남아요.</p>}
                </div>
            )}
            {step === 'migrate' && plan && (
                <div className="solid-card" style={{ padding: 16 }}>
                    <h2 className="title-font">예전 교무수첩 기록을 찾았어요</h2>
                    <p>학생 {plan.summary.students}명, 기록 {plan.summary.records}건, 할 일 {plan.summary.todos}건, 일정 {plan.summary.events}건. 옮겨도 원본은 그대로 남아요. 먼저 백업 파일을 만들게요.</p>
                    {plan.conflicts?.length > 0 && <p>두 군데 내용이 달라서 둘 다 넣었어요.</p>}
                    <Btn className="primary-btn block" disabled={busy} onClick={async () => {
                        setBusy(true);
                        await applyLegacy(plan);
                        setBusy(false);
                        setStep('done');
                    }}>옮기기</Btn>
                    <Btn className="chip block" style={{ marginTop: 8 }} onClick={() => setStep('class')}>나중에</Btn>
                </div>
            )}
            {step === 'class' && (
                <div className="solid-card" style={{ padding: 16 }}>
                    <h2 className="title-font">우리 반</h2>
                    <input className="field" aria-label="학급 이름" placeholder="6학년 3반" value={className} onChange={(event) => setClassName(event.target.value)} />
                    <textarea className="field" style={{ marginTop: 8 }} rows={6} aria-label="명단" placeholder={'한 줄에 한 명씩 적어 주세요.\n1 김하늘\n2 오지호'} value={roster} onChange={(event) => setRoster(event.target.value)} />
                    <Btn className="primary-btn block" style={{ marginTop: 8 }} onClick={async () => { await finishSetup({ className, rosterText: roster }); go('#/today'); }}>이 명단으로 시작</Btn>
                    <Btn className="chip block" style={{ marginTop: 8 }} onClick={async () => { await finishSetup({ className, rosterText: '', skip: true }); go('#/today'); }}>나중에 할게요</Btn>
                    <Btn className="chip block" style={{ marginTop: 8 }} onClick={async () => { await loadDemo(); go('#/today'); }}>예시 학급으로 둘러보기</Btn>
                </div>
            )}
            {step === 'done' && plan && (
                <div className="solid-card" style={{ padding: 16 }}>
                    <h2 className="title-font">옮겼어요</h2>
                    <p>{plan.counts.moved}칸을 새 자리에 넣었어요. 보관함 {plan.summary.legacyPages}쪽, 이 기기에만 {plan.counts.localOnly}칸.</p>
                    <p className="muted">원본 칸 {plan.counts.original} = 옮긴 {plan.counts.moved} + 보관한 {plan.counts.archived} + 이 기기에 둔 {plan.counts.localOnly}</p>
                    <Btn className="primary-btn block" onClick={() => go('#/today')}>오늘 화면으로</Btn>
                </div>
            )}
        </div>
    );
}
