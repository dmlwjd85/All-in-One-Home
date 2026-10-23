import { useEffect, useState } from 'react';
import { keySoundEnabled, keyVibeEnabled, setKeySound, setKeyVibe, subscribeKeyPrefs } from './keyfeel.js';
import titles from '../data/legacyTitles.json';
import { applyLegacy, clearAll, downloadOriginal, exportFile, forgetLegacyImports, importText, loadDemo, patchProfile, previewLegacy, replaceRoster } from '../lib/db.js';
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

export function Settings() {
    const { data, showToast, go } = useUi();
    const [className, setClassName] = useState(data.profile.className || '');
    const [roster, setRoster] = useState(data.students.map((row) => `${row.no} ${row.name}`).join('\n'));
    const [periods, setPeriods] = useState(data.profile.periodStarts?.length ? data.profile.periodStarts : DEFAULT_PERIODS);
    const [phrase, setPhrase] = useState('');
    const [wipe, setWipe] = useState('');
    const [includeLocal, setIncludeLocal] = useState(false);
    const [publicInfo, setPublicInfo] = useState(null);
    const [importMode, setImportMode] = useState('merge');
    const [soundOn, setSoundOn] = useState(() => keySoundEnabled());
    const [vibeOn, setVibeOn] = useState(() => keyVibeEnabled());
    useEffect(() => subscribeKeyPrefs(() => {
        setSoundOn(keySoundEnabled());
        setVibeOn(keyVibeEnabled());
    }), []);

    return (
        <div style={{ display: 'grid', gap: 12 }}>
            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>학급</h2>
                <input className="field" aria-label="학급 이름" value={className} onChange={(event) => setClassName(event.target.value)} />
                <textarea className="field" style={{ marginTop: 8 }} rows={6} aria-label="명단" value={roster} onChange={(event) => setRoster(event.target.value)} />
                <Btn className="primary-btn block" style={{ marginTop: 8 }} onClick={async () => {
                    await patchProfile({ className: className.trim() });
                    const parsed = await replaceRoster(roster);
                    showToast(parsed.errors?.[0] || '학급 정보를 저장했어요.');
                }}>학급 저장</Btn>
                <h3>교시 시작</h3>
                {periods.map((value, index) => (
                    <input key={index} className="field" style={{ marginTop: 8 }} aria-label={`${index + 1}교시 시작`} value={value} onChange={(event) => setPeriods((prev) => prev.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} />
                ))}
                <Btn className="chip" style={{ marginTop: 8 }} onClick={async () => {
                    if (periods.some((item) => !isHm(item))) { showToast('시각은 09:00처럼 적어 주세요.'); return; }
                    await patchProfile({ periodStarts: periods });
                    showToast('교시 시각을 저장했어요.');
                }}>시각 저장</Btn>
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>화면</h2>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[['system', '기기 설정'], ['light', '밝게'], ['dark', '어둡게']].map(([id, label]) => (
                        <Btn key={id} className={data.profile.theme === id ? 'chip on' : 'chip'} onClick={() => patchProfile({ theme: id })}>{label}</Btn>
                    ))}
                </div>
                <p>아이폰 홈 화면에 예전에 꺼내 둔 이름은 자동으로 바뀌지 않아요. 아이콘을 지우고 다시 추가하면 ‘콕 교무수첩’으로 보여요.</p>
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
                <p className="muted">버튼을 누를 때 짧게 소리가 나고, 되는 기기에서는 살짝 떨립니다. 교실에서도 작게 들려요. 말로 적는 동안에는 소리를 내지 않아요.</p>
                <Btn className="chip" onClick={() => import('../lib/db.js').then(({ saveTip }) => saveTip({ hidden: [], seen: [], closes: {}, snooze: '' }).then(() => showToast('팁을 다시 보여 드릴게요.')))}>팁 다시 보기</Btn>
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>공용 컴퓨터</h2>
                <p>교실 컴퓨터라면 켜 두세요. 30분 동안 가만히 있으면 화면을 잠그고, 클라우드가 연결되면 창을 닫을 때 임시 저장만 남깁니다.</p>
                <Btn className={data.profile.sharedPc ? 'chip on' : 'chip'} onClick={() => patchProfile({ sharedPc: !data.profile.sharedPc })}>{data.profile.sharedPc ? '공용 컴퓨터 모드 켜짐' : '공용 컴퓨터 모드 끄기'}</Btn>
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>백업</h2>
                <p className="muted">파일은 이 기기 밖으로 나가지 않아요. 민감한 기록을 넣을지는 직접 고릅니다.</p>
                <Btn className={includeLocal ? 'chip on' : 'chip'} onClick={() => setIncludeLocal((value) => !value)}>이 기기 전용 기록도 넣기</Btn>
                <Btn className="primary-btn block" style={{ marginTop: 8 }} onClick={() => { exportFile(includeLocal); showToast('백업 파일을 내려받았어요.'); }}>기록 내려받기</Btn>
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
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
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>예전 교무수첩</h2>
                {data.profile.migration ? (
                    <p>원본 칸 {data.profile.migration.counts.original} = 옮긴 {data.profile.migration.counts.moved} + 보관한 {data.profile.migration.counts.archived} + 이 기기에 둔 {data.profile.migration.counts.localOnly}</p>
                ) : <p>아직 옮기지 않았어요. 원본은 이 기기에 그대로 있습니다.</p>}
                <Btn className="chip" onClick={() => { if (!downloadOriginal()) showToast('저장된 원본 백업이 없어요. 옮길 때 만들어져요.'); }}>원본 백업 다시 받기</Btn>
                <Btn className="chip" style={{ marginLeft: 8 }} onClick={() => {
                    const plan = previewLegacy(titles);
                    if (!plan || !plan.counts.original) { showToast('이 기기에서 예전 기록을 찾지 못했어요.'); return; }
                    applyLegacy(plan).then(() => showToast('예전 기록을 옮겼어요.'));
                }}>이 기기 기록 옮기기</Btn>
                <Btn className="chip block" style={{ marginTop: 8 }} onClick={() => go('#/settings/legacy')}>보관함 보기</Btn>
                <Btn className="chip block" style={{ marginTop: 8 }} onClick={() => forgetLegacyImports().then(() => showToast('옮긴 것만 지웠어요. 원본은 그대로예요.'))}>옮긴 것 지우기</Btn>
            </section>

            <section className="glass" style={{ padding: 14 }} data-screen="public-path">
                <h2 className="title-font" style={{ marginTop: 0 }}>예전 공개 경로</h2>
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
            </section>

            <section className="glass" style={{ padding: 14 }}>
                <h2 className="title-font" style={{ marginTop: 0 }}>계정과 기록</h2>
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
                <Btn className="chip" onClick={() => loadDemo().then(() => showToast('예시 학급을 불러왔어요. 설정에서 지울 수 있어요.'))}>예시 학급 불러오기</Btn>
                <p>기록을 모두 지우려면 아래 칸에 삭제 라고 적어 주세요. 예전 교무수첩 원본 키는 건드리지 않아요.</p>
                <input className="field" aria-label="삭제 확인" value={wipe} onChange={(event) => setWipe(event.target.value)} placeholder="삭제" />
                <Btn className="primary-btn block" style={{ marginTop: 8 }} disabled={wipe !== '삭제'} onClick={() => clearAll().then(() => showToast('이 앱의 기록을 지웠어요.'))}>계정과 기록 삭제</Btn>
            </section>
        </div>
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
                    <Btn key={row.id} block className="glass" style={{ padding: 12, textAlign: 'left' }} onClick={() => go(row.id.startsWith('p') ? `#/legacy/${row.id.slice(1)}` : '#/settings/legacy')}>
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
