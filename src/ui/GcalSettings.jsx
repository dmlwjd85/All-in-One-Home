import { useEffect, useState } from 'react';
import { GCAL_MODE_HINT, GCAL_SHARED_ERROR, googleClientId } from '../lib/gcalCore.js';
import {
    answerGcalUpload,
    connectGcal,
    disconnectGcal,
    gcalReady,
    pauseGcalForSharedPc,
    prepareCalendarScript,
    reconnectGcal,
    switchGcalMode,
} from '../lib/gcalLive.js';
import { useUi } from './context.jsx';
import { useGcal } from './useGcal.js';
import { Btn } from './bits.jsx';

export function GcalSettings() {
    const { data, showToast } = useUi();
    const gcal = useGcal();
    const clientId = googleClientId();
    const [busy, setBusy] = useState(false);
    const signedIn = Boolean(data.auth?.uid);
    const shared = Boolean(data.profile.sharedPc);
    const mode = gcal.mode === 'write' ? 'write' : 'readonly';

    useEffect(() => {
        if (clientId) prepareCalendarScript().catch(() => {});
    }, [clientId]);

    useEffect(() => {
        if (!shared) return undefined;
        let alive = true;
        gcalReady().then(() => { if (alive) pauseGcalForSharedPc(); });
        return () => { alive = false; };
    }, [shared]);

    async function run(task) {
        if (busy) return;
        setBusy(true);
        try {
            const result = await task();
            if (result && result.ok === false && !result.redirected && result.message) showToast(result.message);
            return result;
        } finally {
            setBusy(false);
        }
    }

    return (
        <section className="glass" style={{ padding: 14 }} aria-label="구글 캘린더">
            <h2 className="title-font" style={{ marginTop: 0 }}>구글 캘린더</h2>
            {!clientId && <p>구글 캘린더 연동은 준비 중이에요. 연결 값이 오면 여기서 켤 수 있어요.</p>}
            {clientId && shared && <p>{GCAL_SHARED_ERROR}</p>}
            {clientId && !shared && (
                <>
                    <p className="muted" style={{ marginTop: 0 }}>{GCAL_MODE_HINT}</p>
                    <div className="gcal-modes" role="group" aria-label="구글 캘린더 연동 방식">
                        <Btn
                            className={mode === 'readonly' ? 'choice-tile on' : 'choice-tile'}
                            aria-pressed={mode === 'readonly'}
                            onClick={() => run(() => switchGcalMode('readonly'))}
                        >구글 일정 보기만</Btn>
                        <Btn
                            className={mode === 'write' ? 'choice-tile on' : 'choice-tile'}
                            aria-pressed={mode === 'write'}
                            onClick={() => run(() => switchGcalMode('write'))}
                        >만든 일정도 구글에 넣기</Btn>
                    </div>
                    {!signedIn && <p>구글 로그인 후 캘린더를 연결할 수 있어요.</p>}
                    {signedIn && !gcal.enabled && (
                        <Btn className="primary-btn block" style={{ marginTop: 8 }} aria-busy={busy} onClick={() => run(() => connectGcal(mode))}>구글 캘린더 연동 켜기</Btn>
                    )}
                    {signedIn && gcal.enabled && (
                        <p>{mode === 'write' ? '만든 일정을 구글에도 넣고 있어요.' : '구글 일정을 보는 중이에요.'}</p>
                    )}
                    {signedIn && gcal.enabled && gcal.needsUploadAsk && mode === 'write' && (
                        <div className="gcal-ask" role="group" aria-label="이미 적어 둔 일정 올리기">
                            <p>이미 적어 둔 일정을 구글 캘린더에 한꺼번에 올릴까요? 민감한 일정은 이 기기에만 두고 구글로 보내지 않아요.</p>
                            <Btn className="primary-btn block" aria-busy={busy} onClick={() => run(async () => {
                                const result = await answerGcalUpload(true);
                                if (result?.ok) showToast('적어 둔 일정을 구글 캘린더에 올렸어요.');
                                return result?.ok ? { ok: true } : { ok: false };
                            })}>한꺼번에 올리기</Btn>
                            <Btn className="chip block" aria-busy={busy} onClick={() => run(async () => {
                                await answerGcalUpload(false);
                                showToast('앞으로 만든 일정만 구글에 넣을게요.');
                                return { ok: true };
                            })}>앞으로 만든 것만</Btn>
                        </div>
                    )}
                    {signedIn && gcal.enabled && (
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                            <Btn className="chip" aria-busy={busy} onClick={() => run(() => reconnectGcal())}>다시 연결</Btn>
                            <Btn className="chip" aria-busy={busy} onClick={() => run(async () => {
                                await disconnectGcal();
                                showToast('연동을 껐어요. 여기에 적어 둔 일정과 구글에 이미 올라간 일정은 그대로예요.');
                                return { ok: true };
                            })}>연동 끄기</Btn>
                        </div>
                    )}
                    {gcal.lastError && <p className="gcal-error" role="status">{gcal.lastError}</p>}
                    <p className="muted">아이폰 홈 화면 앱은 이 창이 구글로 갔다가 돌아와요. 연결이 만료되면 다시 연결해 주세요.</p>
                </>
            )}
        </section>
    );
}
