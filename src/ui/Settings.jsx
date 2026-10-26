import { useEffect, useState } from 'react';
import { KEY_VOICES, KEY_VOLUMES, keySoundEnabled, keyVibeEnabled, keyVoiceId, keyVolumeId, previewKeyVoice, setKeySound, setKeyVibe, setKeyVoice, setKeyVolume, subscribeKeyPrefs } from './keyfeel.js';
import { TYPE_VOICES, previewTypeVoice, setTypeSound, setTypeVoice, typeSoundEnabled, typeVoiceId } from './typesound.js';
import { jamFeelEnabled, previewJam, setJamFeel } from './pressFeel.js';
import { HotkeyForm } from './HotkeyForm.jsx';
import { FONT_CHOICES, fontId, setFont } from './fontpick.js';
import { fillSlotsFromText, RosterSlots, rosterTextFromSlots, slotsFromStudents } from './RosterSlots.jsx';
import titles from '../data/legacyTitles.json';
import { applyLegacy, clearAll, downloadOriginal, exportFile, forgetLegacyImports, importText, loadDemo, patchProfile, previewLegacy, replaceRoster } from '../lib/db.js';
import { planRecordWipe } from '../lib/gcalCore.js';
import { disconnectGcal, forgetGcalLocal, settleGcalQueue } from '../lib/gcalLive.js';
import { useGcal } from './useGcal.js';
import { GcalSettings } from './GcalSettings.jsx';
import { cloudReady, loginHint, signInGoogle, signOutFirebase } from '../firebase.js';
import { setAuth } from '../lib/db.js';
import { CONFIRM_PHRASE, deleteLegacyPublic, legacyCloudReady, listLegacyPublic } from '../lib/legacyPublic.js';
import { DEFAULT_PERIODS, isHm } from '../lib/period.js';
import { useUi } from './context.jsx';
import { Btn } from './bits.jsx';

const PUBLIC_LABELS = {
    ssugeokInbox: '받은 기록',
    studentNotes: '학생 기록',
    counselNotes: '상담 기록',
    teacherPlans: '계획',
    teacherTodos: '할 일',
    teacherAttend: '출결',
    classRoster: '명단',
    ledgerTx: '학급 회계',
    ledgerBudgets: '예산',
    teacherLessons: '수업',
    teacherMeets: '회의',
    teacherContacts: '연락처',
    teacherTimetable: '시간표',
    familyDiary: '일기',
    ddayCards: '디데이',
    submissionSheets: '제출물',
    notebookFields: '쪽 기록',
};

function publicLabel(name) {
    return PUBLIC_LABELS[name] || '기록';
}

function KeyPick({ pressed, label, ariaLabel, onPick }) {
    return (
        <Btn
            className={pressed ? 'chip on' : 'chip'}
            aria-pressed={pressed}
            aria-label={ariaLabel}
            data-key-preview="1"
            onPointerDown={(event) => {
                if (event.button !== 0) return;
                onPick();
            }}
            onKeyDown={(event) => {
                if (event.repeat || (event.key !== 'Enter' && event.key !== ' ')) return;
                onPick();
            }}
        >{label}</Btn>
    );
}

export function Settings() {
    const { data, showToast, go, openHotkeyHelp } = useUi();
    const [className, setClassName] = useState(data.profile.className || '');
    const [font, setFontId] = useState(() => fontId());
    const [periodsOpen, setPeriodsOpen] = useState(false);
    const [oldOpen, setOldOpen] = useState(false);
    const [publicOpen, setPublicOpen] = useState(false);
    const [periods, setPeriods] = useState(data.profile.periodStarts?.length ? data.profile.periodStarts : DEFAULT_PERIODS);
    const [phrase, setPhrase] = useState('');
    const [wipe, setWipe] = useState('');
    const [gcalWipe, setGcalWipe] = useState('keep');
    const gcal = useGcal();
    const [includeLocal, setIncludeLocal] = useState(false);
    const [publicInfo, setPublicInfo] = useState(null);
    const [importMode, setImportMode] = useState('merge');
    const [soundOn, setSoundOn] = useState(() => keySoundEnabled());
    const [vibeOn, setVibeOn] = useState(() => keyVibeEnabled());
    const [voiceId, setVoiceId] = useState(() => keyVoiceId());
    const [volumeId, setVolumeId] = useState(() => keyVolumeId());
    const [typeOn, setTypeOn] = useState(() => typeSoundEnabled());
    const [typeId, setTypeId] = useState(() => typeVoiceId());
    const [jamOn, setJamOn] = useState(() => jamFeelEnabled());
    useEffect(() => subscribeKeyPrefs(() => {
        setSoundOn(keySoundEnabled());
        setVibeOn(keyVibeEnabled());
        setVoiceId(keyVoiceId());
        setVolumeId(keyVolumeId());
    }), []);

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>학급</h2>
                <input className="field" aria-label="학급 이름" value={className} onChange={(event) => setClassName(event.target.value)} />
                <p className="muted">{data.students.filter((row) => row.name).length}명이 명단에 있어요. 이름은 명단 화면에서 고쳐요.</p>
                <Btn className="chip block" onClick={() => go('#/settings/roster', { state: { rosterFrom: 'settings' } })}>명단 고치기</Btn>
                <Btn className="primary-btn block" style={{ marginTop: 8 }} onClick={async () => {
                    const saved = await patchProfile({ className: className.trim() });
                    if (saved?.storageFailed) return;
                    showToast('학급 이름을 저장했어요.');
                }}>학급 저장</Btn>
                <Btn className="chip" style={{ marginTop: 8 }} aria-expanded={periodsOpen} onClick={() => setPeriodsOpen((open) => !open)}>{periodsOpen ? '교시 시각 접기' : '교시 시각 펼치기'}</Btn>
                {periodsOpen && (
                    <div>
                        {periods.map((value, index) => (
                            <input key={index} className="field" style={{ marginTop: 8 }} aria-label={`${index + 1}교시 시작`} value={value} onChange={(event) => setPeriods((prev) => prev.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
                        ))}
                        <Btn className="chip" style={{ marginTop: 8 }} onClick={async () => {
                            if (periods.some((item) => !isHm(item))) { showToast('시각은 09:00처럼 적어 주세요.'); return; }
                            const saved = await patchProfile({ periodStarts: periods });
                            if (saved?.storageFailed) return;
                            showToast('교시 시각을 저장했어요.');
                        }}>시각 저장</Btn>
                    </div>
                )}
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>화면</h2>
                <p className="muted" style={{ marginTop: 0 }}>작은 글자는 쨈 본문, 24px부터는 쨈 제목 평면이에요. 본문 Bold는 14px부터 씁니다.</p>
                <p className="muted">글꼴: 쨈 제목 — (c) 2026 쨈 폰트 팀. 글꼴: 쨈 본문 — Resource Han Rounded(Cyano Hao, SIL OFL 1.1) 바탕.</p>
                <div className="font-grid" role="group" aria-label="글꼴">
                    {FONT_CHOICES.map((item) => (
                        <Btn key={item.id} className={font === item.id ? 'choice-tile on' : 'choice-tile'} data-font-sample={item.id} aria-pressed={font === item.id} onClick={() => { setFont(item.id); setFontId(item.id); }}>
                            <span>{item.label}</span>
                            <span style={{ fontWeight: 500, fontSize: 12 }}>{item.hint}</span>
                        </Btn>
                    ))}
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    {[['system', '기기 설정'], ['light', '밝게'], ['dark', '어둡게']].map(([id, label]) => (
                        <Btn key={id} className={data.profile.theme === id ? 'chip on' : 'chip'} onClick={() => patchProfile({ theme: id })}>{label}</Btn>
                    ))}
                </div>
                <p>아이폰 홈 화면에 예전에 꺼내 둔 이름은 자동으로 바뀌지 않아요. 아이콘을 지우고 다시 추가하면 ‘쨈 교무수첩’으로 보여요.</p>
                <Btn className="chip" onClick={() => import('../lib/db.js').then(({ saveTip }) => saveTip({ hidden: [], seen: [], closes: {}, snooze: '' }).then((saved) => { if (!saved?.storageFailed) showToast('팁을 다시 보여 드릴게요.'); }))}>팁 다시 보기</Btn>
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>소리</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Btn className={soundOn ? 'chip on' : 'chip'} aria-pressed={soundOn} onClick={() => {
                        const next = !soundOn;
                        setKeySound(next);
                        setSoundOn(next);
                    }}>{soundOn ? '누를 때 소리 켜짐' : '누를 때 소리 꺼짐'}</Btn>
                    <Btn className={vibeOn ? 'chip on' : 'chip'} aria-pressed={vibeOn} onClick={() => {
                        const next = !vibeOn;
                        setKeyVibe(next);
                        setVibeOn(next);
                    }}>{vibeOn ? '진동 켜짐' : '진동 꺼짐'}</Btn>
                </div>
                <p className="muted" style={{ margin: '10px 0 0' }}>소리 종류</p>
                <div className="key-picks" role="group" aria-label="누를 때 소리 종류">
                    {KEY_VOICES.map((voice) => (
                        <KeyPick
                            key={voice.id}
                            pressed={voiceId === voice.id}
                            label={voice.label}
                            ariaLabel={`${voice.label} ${voice.hint}`}
                            onPick={() => {
                                setKeyVoice(voice.id);
                                previewKeyVoice(voice.id);
                            }}
                        />
                    ))}
                </div>
                <p className="muted" style={{ margin: '10px 0 0' }}>소리 크기</p>
                <div className="key-picks" role="group" aria-label="누를 때 소리 크기">
                    {KEY_VOLUMES.map((volume) => (
                        <KeyPick
                            key={volume.id}
                            pressed={volumeId === volume.id}
                            label={volume.label}
                            ariaLabel={volume.label}
                            onPick={() => {
                                setKeyVolume(volume.id);
                                previewKeyVoice();
                            }}
                        />
                    ))}
                </div>
                <p className="muted">꺼 두어도 여기서는 미리 들어 볼 수 있어요.</p>
                <p className="muted">누를 때 소리가 나요. 버튼을 누를 때와 뗄 때 짧게 소리가 나고, 되는 기기에서는 살짝 떨립니다. 기본은 몽글, 작게입니다. 교실에서도 작게 들려요. 말로 적는 동안에는 소리를 내지 않아요.</p>
                <p className="muted" style={{ margin: '14px 0 0' }}>하단 쨈</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Btn className={jamOn ? 'chip on' : 'chip'} aria-pressed={jamOn} onClick={() => {
                        const next = !jamOn;
                        setJamFeel(next);
                        setJamOn(next);
                        if (next) previewJam();
                    }}>{jamOn ? '쨈 손맛 켜짐' : '쨈 손맛 꺼짐'}</Btn>
                    <Btn className="chip" data-key-preview="press" onClick={() => previewJam()}>뽁톡 들어 보기</Btn>
                </div>
                <p className="muted">기본은 꺼져 있어요. 켜 두면 하단 쨈이 살짝 눌렸다가 통 튀면서 뽁, 톡 소리가 나요. 진동은 안드로이드 크롬처럼 되는 기기에서만 12밀리초로 울려요. 아이폰 Safari는 웹에서 진동을 주지 않고, 무음이면 소리도 나지 않아요. 소리를 끄면 진동도 같이 꺼져요.</p>
                <p className="muted" style={{ margin: '14px 0 0' }}>글자를 적을 때</p>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Btn className={typeOn ? 'chip on' : 'chip'} aria-pressed={typeOn} onClick={() => {
                        const next = !typeOn;
                        setTypeSound(next);
                        setTypeOn(next);
                    }}>{typeOn ? '글자 소리 켜짐' : '글자 소리 꺼짐'}</Btn>
                </div>
                <p className="muted">기본은 꺼져 있어요. 켜 두면 누르는 소리와 떼는 소리가 따로 나고, 글자마다 높이가 조금씩 달라요. 스페이스, 엔터, 시프트, 탭은 더 크고 안정 막대 소리가 섞여요. 지우기는 더 짧아요. 비밀번호나 인증 번호 칸에서는 내지 않아요. 처음 소리는 빨간 직선이고, 크기는 작게 고정해 두었어요.</p>
                <div className="type-picks" role="group" aria-label="글자 소리">
                    {TYPE_VOICES.filter((voice) => !voice.playful).map((voice) => (
                        <KeyPick
                            key={voice.id}
                            pressed={typeId === voice.id}
                            label={voice.label}
                            ariaLabel={`${voice.label} ${voice.hint}`}
                            onPick={() => {
                                setTypeVoice(voice.id);
                                setTypeId(voice.id);
                                previewTypeVoice(voice.id);
                            }}
                        />
                    ))}
                </div>
                <p className="muted" style={{ margin: '12px 0 0' }}>장난 소리</p>
                <div className="type-picks" role="group" aria-label="장난 소리">
                    {TYPE_VOICES.filter((voice) => voice.playful).map((voice) => (
                        <KeyPick
                            key={voice.id}
                            pressed={typeId === voice.id}
                            label={voice.label}
                            ariaLabel={`${voice.label} ${voice.hint}`}
                            onPick={() => {
                                setTypeVoice(voice.id);
                                setTypeId(voice.id);
                                previewTypeVoice(voice.id);
                            }}
                        />
                    ))}
                </div>
                <p className="muted">칸을 누르면 미리 들려 드려요. 소리를 꺼 두어도 여기서는 들을 수 있고, 고른 소리는 이 기기에 남아요.</p>
            </section>

            <section className="glass" style={{ padding: 14 }} data-screen="hotkeys">
                <h2 className="title-font" style={{ marginTop: 0 }}>단축키</h2>
                <HotkeyForm onShowList={openHotkeyHelp} />
            </section>

            <section className="glass" style={{ padding: 14 }} data-screen="quick-help">
                <h2 className="title-font" style={{ marginTop: 0 }}>홈 화면에서 바로 적기</h2>
                <p>안드로이드에서는 홈 화면의 쨈 아이콘을 길게 누르면 빠른 입력이 나옵니다.</p>
                <p>아이폰은 아이콘을 길게 눌러도 빠른 입력이 나오지 않아요. 단축어 앱에서 새 단축어를 만들고, 동작은 URL 열기를 고르세요. 주소는 아래를 붙여 넣습니다. 공유에서 홈 화면에 추가하면 아이콘이 생깁니다. 잠금 화면, 제어 센터, 뒷면 탭에도 같은 단축어를 넣을 수 있어요.</p>
                <p className="muted" style={{ wordBreak: 'break-all' }}>{typeof location === 'undefined' ? '' : `${location.origin}${location.pathname}?quick=1`}</p>
                <p>이 주소는 Safari로 열립니다. 홈 화면에 넣어 둔 쨈 교무수첩 안의 기록과는 따로일 수 있어요. 그 앱에서 적으려면 아이콘을 연 다음 하단 쨈을 누르세요.</p>
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>계정</h2>
                <h3 style={{ marginBottom: 8 }}>공용 컴퓨터</h3>
                <p>교실 컴퓨터라면 켜 두세요. 30분 동안 가만히 있으면 화면을 잠그고, 클라우드가 연결되면 창을 닫을 때 임시 저장만 남깁니다.</p>
                <Btn className={data.profile.sharedPc ? 'chip on' : 'chip'} aria-pressed={data.profile.sharedPc} onClick={() => patchProfile({ sharedPc: !data.profile.sharedPc })}>{data.profile.sharedPc ? '공용 컴퓨터 모드 켜짐' : '공용 컴퓨터 모드 꺼짐'}</Btn>
                <h3>백업</h3>
                <p className="muted">파일은 이 기기 밖으로 나가지 않아요. 민감한 기록을 넣을지는 직접 고릅니다.</p>
                <Btn className={includeLocal ? 'chip on' : 'chip'} onClick={() => setIncludeLocal((value) => !value)}>이 기기 전용 기록도 넣기</Btn>
                <Btn className="primary-btn block" style={{ marginTop: 8 }} onClick={() => { exportFile(includeLocal); showToast('백업 파일을 내려받았어요.'); }}>기록 내려받기</Btn>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                    <Btn className={importMode === 'merge' ? 'chip on' : 'chip'} onClick={() => setImportMode('merge')}>합치기</Btn>
                    <Btn className={importMode === 'replace' ? 'chip on' : 'chip'} onClick={() => setImportMode('replace')}>바꾸기</Btn>
                </div>
                <Btn className="chip block" style={{ marginTop: 8 }} onClick={() => document.getElementById('backup-file')?.click()}>백업 파일 고르기</Btn>
                <input id="backup-file" type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={async (event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const text = await file.text();
                    const result = await importText(text, importMode);
                    showToast(result.ok ? '기록을 가져왔어요.' : (result.errors || []).join(' '));
                }} />
                <h3>로그인</h3>
                {!cloudReady() && <p>아직 클라우드 연결 전이에요. 이 기기에는 저장돼요.</p>}
                {cloudReady() && !data.auth?.uid && <Btn className="chip" onClick={async () => {
                    try {
                        const cred = await signInGoogle();
                        if (!cred?.user) return;
                        await setAuth({ uid: cred.user.uid, name: cred.user.displayName || '', email: cred.user.email || '' });
                        showToast('구글 계정으로 연결했어요. 기록은 선생님 자리에만 올라가요.');
                    } catch (error) {
                        showToast(loginHint(error));
                    }
                }}>구글 로그인</Btn>}
                {data.auth?.uid && <p>{data.auth.name ? `${data.auth.name} 선생님으로 연결됐어요.` : '구글 계정으로 연결됐어요.'}</p>}
                {data.auth?.uid && <Btn className="chip" onClick={() => signOutFirebase().then(() => showToast('로그아웃했어요. 이 기기 기록은 남아 있어요.'))}>로그아웃</Btn>}
                <Btn className="chip" onClick={() => loadDemo().then((saved) => { if (!saved?.storageFailed) showToast('예시 학급을 불러왔어요. 설정에서 지울 수 있어요.'); })}>예시 학급 불러오기</Btn>
                <p>기록을 모두 지우려면 아래 칸에 삭제 라고 적어 주세요. 예전 교무수첩 원본 키는 건드리지 않아요.</p>
                {gcal.enabled && gcal.mode === 'write' && (
                    <>
                        <p className="muted">구글에 올려 둔 일정을 지울지 골라 주세요.</p>
                        <div className="gcal-modes" role="group" aria-label="구글에 올려 둔 일정">
                            <Btn
                                className={gcalWipe === 'keep' ? 'choice-tile on' : 'choice-tile'}
                                aria-pressed={gcalWipe === 'keep'}
                                onClick={() => setGcalWipe('keep')}
                            >구글 일정은 남기기</Btn>
                            <Btn
                                className={gcalWipe === 'drop' ? 'choice-tile on' : 'choice-tile'}
                                aria-pressed={gcalWipe === 'drop'}
                                onClick={() => setGcalWipe('drop')}
                            >구글에서도 지우기</Btn>
                        </div>
                    </>
                )}
                <input className="field" aria-label="삭제 확인" value={wipe} onChange={(event) => setWipe(event.target.value)} placeholder="삭제" />
                <Btn className="primary-btn block" style={{ marginTop: 8 }} disabled={wipe !== '삭제'} onClick={() => {
                    const plan = planRecordWipe(gcal, gcalWipe);
                    (async () => {
                        await settleGcalQueue();
                        if (plan.releaseBeforeClear) await disconnectGcal();
                        const saved = await clearAll();
                        if (saved?.storageFailed) return;
                        await settleGcalQueue();
                        if (plan.dropRemote) await disconnectGcal();
                        await forgetGcalLocal();
                        showToast('이 앱의 기록을 지웠어요.');
                    })();
                }}>계정과 기록 삭제</Btn>
                <Btn className="chip block" style={{ marginTop: 12 }} aria-expanded={oldOpen} onClick={() => setOldOpen((open) => !open)}>{oldOpen ? '예전 교무수첩 접기' : '예전 교무수첩 펼치기'}</Btn>
                {oldOpen && (
                    <div>
                        {data.profile.migration ? (
                            <p>원본 칸 {data.profile.migration.counts.original} = 옮긴 {data.profile.migration.counts.moved} + 보관한 {data.profile.migration.counts.archived} + 이 기기에 둔 {data.profile.migration.counts.localOnly}</p>
                        ) : <p>아직 옮기지 않았어요. 원본은 이 기기에 그대로 있습니다.</p>}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <Btn className="chip" onClick={() => { if (!downloadOriginal()) showToast('저장된 원본 백업이 없어요. 옮길 때 만들어져요.'); }}>원본 백업 다시 받기</Btn>
                            <Btn className="chip" onClick={() => {
                                const plan = previewLegacy(titles);
                                if (!plan || !plan.counts.original) { showToast('이 기기에서 예전 기록을 찾지 못했어요.'); return; }
                                applyLegacy(plan).then((saved) => { if (!saved?.storageFailed) showToast('예전 기록을 옮겼어요.'); });
                            }}>이 기기 기록 옮기기</Btn>
                        </div>
                        <Btn className="chip block" style={{ marginTop: 8 }} onClick={() => go('#/settings/legacy')}>보관함 보기</Btn>
                        <Btn className="chip block" style={{ marginTop: 8 }} onClick={() => forgetLegacyImports().then((saved) => { if (!saved?.storageFailed) showToast('옮긴 것만 지웠어요. 원본은 그대로예요.'); })}>옮긴 것 지우기</Btn>
                    </div>
                )}
                <div data-screen="public-path">
                    <Btn className="chip block" style={{ marginTop: 8 }} aria-expanded={publicOpen} onClick={() => setPublicOpen((open) => !open)}>{publicOpen ? '예전 공개 경로 접기' : '예전 공개 경로 펼치기'}</Btn>
                    {publicOpen && (
                        <div>
                            <p>예전 앱이 기록을 올려 둔 곳이 있어요. 로그인하지 않아도 열릴 수 있어서, 새 앱은 그곳에 쓰지 않아요.</p>
                            <p>옮긴 뒤에, 선생님이 확인하면 그 기록을 지울 수 있어요. 확인 전에는 아무것도 지우지 않아요.</p>
                            {!legacyCloudReady() && <p className="muted">지금 연결 설정이 없어서 목록을 열 수는 없어요. 설정이 오면 이 자리에서 개수를 보고, ‘지우기’라고 적은 뒤에만 지웁니다.</p>}
                            {legacyCloudReady() && (
                                <>
                                    <Btn className="chip" onClick={async () => {
                                        try { setPublicInfo(await listLegacyPublic()); }
                                        catch { showToast('목록을 열지 못했어요. 로그인 상태를 봐 주세요.'); }
                                    }}>목록 불러오기</Btn>
                                    {publicInfo?.groups && (
                                        <ul>
                                            {publicInfo.groups.map((group) => <li key={group.name}>{publicLabel(group.name)} {group.count}개</li>)}
                                        </ul>
                                    )}
                                    <input className="field" aria-label="확인 문장" placeholder="지우기" value={phrase} onChange={(event) => setPhrase(event.target.value)} />
                                    <Btn className="primary-btn block" style={{ marginTop: 8 }} disabled={phrase !== CONFIRM_PHRASE} onClick={async () => {
                                        try {
                                            const result = await deleteLegacyPublic(phrase);
                                            showToast(`${result.removed}개를 지웠어요.`);
                                            setPhrase('');
                                        } catch (error) {
                                            showToast(error.message || '지우지 않았어요.');
                                        }
                                    }}>공개 경로 기록 지우기</Btn>
                                </>
                            )}
                        </div>
                    )}
                </div>
            </section>

            <GcalSettings />
        </div>
    );
}

export function RosterSettings() {
    const { data, showToast } = useUi();
    const [names, setNames] = useState(() => slotsFromStudents(data.students));
    const [paste, setPaste] = useState('');
    return (
        <section className="glass" style={{ padding: 14 }}>
            <h2 className="title-font" style={{ marginTop: 0 }}>명단</h2>
            <p className="muted">1번부터 32번까지 칸이 열려 있어요. 있는 이름은 그 번호에 채워 두었습니다.</p>
            <RosterSlots names={names} onChange={setNames} />
            <textarea className="field" style={{ marginTop: 8 }} rows={3} aria-label="명단 붙여 넣기" placeholder={'한 줄에 한 명. 빈 칸은 그대로 둡니다.\n12 이하은'} value={paste} onChange={(event) => setPaste(event.target.value)} />
            <Btn className="chip block" style={{ marginTop: 8 }} onClick={() => {
                const filled = fillSlotsFromText(names, paste);
                setNames(filled.names);
                showToast(filled.errors?.[0] || '번호 칸에 채웠어요.');
            }}>칸에 채우기</Btn>
            <Btn className="primary-btn block" style={{ marginTop: 8 }} onClick={async () => {
                const parsed = await replaceRoster(rosterTextFromSlots(names));
                if (parsed?.storageFailed) return;
                showToast(parsed.errors?.[0] || '명단을 저장했어요.');
                if (history.state?.rosterFrom === 'settings') history.back();
                else location.replace('#/settings');
            }}>명단 저장</Btn>
        </section>
    );
}

export function Legacy() {
    const { data, route, go } = useUi();
    const pages = [...data.legacyPages, ...data.local.pages];
    const current = pages.find((row) => row.id === `p${route.params.page}` || row.id === route.params.page);
    if (!route.params.page) {
        return (
            <div style={{ display: 'grid', gap: 8 }}>
                <p>새 화면으로 옮기지 못한 쪽이에요. 읽기만 되고, 고치지는 않아요.</p>
                {pages.map((row) => (
                    <Btn key={row.id} block className="glass" style={{ padding: 12, textAlign: 'left' }} onClick={() => go(row.id.startsWith('p') ? `#/legacy/${row.id.slice(1)}` : '#/settings/legacy', { state: { appFrom: 'legacy' } })}>
                        {titles[row.id.replace('p', '')] || row.title || row.id}
                    </Btn>
                ))}
                {!pages.length && <p className="muted">보관함에 넣은 쪽이 없어요.</p>}
            </div>
        );
    }
    return (
        <div>
            <h2 className="title-font">{current?.title || titles[route.params.page] || `${route.params.page}쪽`}</h2>
            {!current && <p>이 쪽은 보관함에 없어요. 비어 있었거나, 새 화면으로 이미 옮겨졌어요.</p>}
            {current && Object.entries(current.raw || {}).map(([key, value]) => (
                <p key={key}><strong>{key}</strong> {typeof value === 'string' ? value : JSON.stringify(value)}</p>
            ))}
        </div>
    );
}
