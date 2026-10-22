/** 말로 적기 지원 감지, 이어 붙이기, 오류 문구를 확인합니다. */
import { addDaysYmd, weekdayKo } from '../src/lib/date.js';
import { buildDemo, consentBefore, nextOpenWeekday } from '../src/lib/demo.js';
import { parseSchoolMessages } from '../src/lib/msgParse.js';
import {
    CHROME_SPEECH_NOTICE,
    SPEECH_INAPP_MESSAGE,
    SPEECH_NOTICE_KEY,
    SPEECH_UNSUPPORTED_MESSAGE,
    appendSpeech,
    createRecognizer,
    describeSpeechSupport,
    dictationText,
    hasSpeechRecognition,
    readNoticeSeen,
    speechErrorMessage,
    speechSupportFromWindow,
    transcriptFromResults,
    usesGoogleSpeech,
    writeNoticeSeen,
} from '../src/lib/speech.js';

const failures = [];
function check(ok, message) {
    if (!ok) failures.push(message);
}

const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const crios = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0.0.0 Mobile/15E148 Safari/604.1';
const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
const edge = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0';
const whale = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Whale/3.28.0.0 Safari/537.36';
const samsung = 'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0.0.0 Mobile Safari/537.36';
const kakao = 'Mozilla/5.0 (Linux; Android 14; SM-S928N Build/UP1A; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 KAKAOTALK/10.9.0';
const kakaoIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.9.0';
const naverInapp = 'Mozilla/5.0 (Linux; Android 14; SM-S928N) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 NAVER(inapp; search; 2000; 11.0.0)';
const instagram = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0.0.0.0';
const facebook = 'Mozilla/5.0 (Linux; Android 14; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36 FB_IAB/425.0';
const line = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Line/14.0.0';

function FakeRecognition() {}

const chromeWin = { navigator: { userAgent: chrome }, webkitSpeechRecognition: FakeRecognition };
const firefoxWin = { navigator: { userAgent: firefox } };
const edgeWin = { navigator: { userAgent: edge } };
const edgeWithApi = { navigator: { userAgent: edge }, SpeechRecognition: FakeRecognition };
const kakaoWin = { navigator: { userAgent: kakao }, webkitSpeechRecognition: FakeRecognition };

check(hasSpeechRecognition(chromeWin), '크롬 webkitSpeechRecognition 을 지원으로 보지 않습니다.');
check(hasSpeechRecognition({ SpeechRecognition: FakeRecognition }), 'SpeechRecognition 생성자를 놓쳤습니다.');
check(!hasSpeechRecognition(firefoxWin), '파이어폭스에 생성자가 없는데 지원으로 봅니다.');
check(!hasSpeechRecognition(edgeWin), '생성자가 없는 엣지를 지원으로 봅니다.');
check(!hasSpeechRecognition(null) && !hasSpeechRecognition(undefined), '빈 창을 지원으로 봅니다.');

const chromeSupport = speechSupportFromWindow(chromeWin);
check(chromeSupport.available && chromeSupport.google && !chromeSupport.inApp && chromeSupport.message === '', '크롬 지원 감지가 틀렸습니다.');
const firefoxSupport = speechSupportFromWindow(firefoxWin);
check(!firefoxSupport.available && firefoxSupport.message === SPEECH_UNSUPPORTED_MESSAGE, '파이어폭스 안내가 없습니다.');
const edgeSupport = speechSupportFromWindow(edgeWin);
check(!edgeSupport.available && !edgeSupport.google && edgeSupport.message === SPEECH_UNSUPPORTED_MESSAGE, '엣지 안내가 없습니다.');
const edgeApi = speechSupportFromWindow(edgeWithApi);
check(edgeApi.available && !edgeApi.google && edgeApi.message === '', '생성자가 있는 엣지에서 버튼을 막거나 구글 안내로 봅니다.');
const kakaoSupport = speechSupportFromWindow(kakaoWin);
check(!kakaoSupport.available && kakaoSupport.inApp && kakaoSupport.message.includes('외부 브라우저로 열어 주세요'), '카카오톡 인앱 안내가 없습니다.');
check(kakaoSupport.message === SPEECH_INAPP_MESSAGE, '인앱 안내 문구가 바뀌었습니다.');

for (const ua of [kakaoIos, naverInapp, instagram, facebook, line]) {
    const support = describeSpeechSupport({ userAgent: ua, hasRecognition: true });
    check(!support.available && support.inApp && support.message.includes('외부 브라우저로 열어 주세요'), `인앱을 놓쳤습니다: ${ua.slice(-24)}`);
}
for (const ua of [chrome, firefox, edge, whale, samsung, crios]) {
    check(!describeSpeechSupport({ userAgent: ua, hasRecognition: false }).inApp, `일반 브라우저를 인앱으로 봤습니다: ${ua.slice(-18)}`);
}
check(usesGoogleSpeech(chrome) && !usesGoogleSpeech(edge) && !usesGoogleSpeech(whale) && !usesGoogleSpeech(crios) && !usesGoogleSpeech(samsung) && !usesGoogleSpeech(firefox), '구글 전송 대상이 크롬이 아닙니다.');

const prefixed = describeSpeechSupport({ userAgent: chrome, hasRecognition: true });
check(prefixed.available && prefixed.google, 'describeSpeechSupport 가 크롬을 놓쳤습니다.');
check(!speechSupportFromWindow({ navigator: { userAgent: '' } }).available, '빈 창에서 버튼을 켭니다.');

check(appendSpeech('', '내일 5교시 공개수업') === '내일 5교시 공개수업', '빈 칸에 받아쓰기를 못 붙입니다.');
check(appendSpeech('가정통신문', '내일까지 제출') === '가정통신문\n내일까지 제출', '기존 글 뒤에 줄을 바꾸지 않습니다.');
check(appendSpeech('가정통신문 ', '내일까지') === '가정통신문 \n내일까지', '공백으로 끝나면 한 줄로 붙입니다.');
check(appendSpeech('가정통신문\n', '내일까지') === '가정통신문\n내일까지', '줄 뒤에 줄을 한 번 더 넣습니다.');
check(appendSpeech('가정통신문', '') === '가정통신문', '빈 받아쓰기가 글을 지웁니다.');
check(appendSpeech('가정통신문', '   ') === '가정통신문', '공백만 있는 받아쓰기가 글을 바꿉니다.');
check(appendSpeech('기존', ' 내일 수업 ') === '기존\n내일 수업', '받아쓰기 앞뒤 공백을 그대로 둡니다.');
const interim = appendSpeech('준비물', '내일');
const finalText = appendSpeech('준비물', '내일 5교시 공개수업');
check(interim === '준비물\n내일' && finalText === '준비물\n내일 5교시 공개수업' && !finalText.includes('내일 내일'), '중간 결과가 중복됩니다.');
const pasted = '11/4(수) 오후 3시 교직원 회의 (협의실)';
const spoken = '11월 6일까지 체험학습 동의서 제출';
const joined = appendSpeech(pasted, spoken);
const again = appendSpeech(appendSpeech(pasted, '11월 6일까지'), '체험학습 동의서 제출');
check(joined === `${pasted}\n${spoken}`, '말한 문장이 기존 글과 한 줄이 됩니다.');
check(again.startsWith(`${pasted}\n`) && again.split('\n').length === 3, '두 번 나눠 말해도 한 줄로 붙습니다.');
const read = parseSchoolMessages(joined, { now: new Date('2026-10-22T09:00:00+09:00') });
const included = read.items.filter((item) => item.include !== false);
check(included.length === 2, `받아쓴 두 문장이 ${included.length}개로 등록됩니다. ${JSON.stringify(read.items.map((item) => ({ title: item.title, include: item.include, warning: item.warning })))}`);
check(!read.items.some((item) => String(item.warning || '').includes('같은 문장')), '줄로 나눈 문장을 같은 문장으로 뺍니다.');

const results = {
    length: 2,
    0: { 0: { transcript: '내일 ' }, isFinal: true, length: 1 },
    1: { 0: { transcript: '제출합니다' }, isFinal: false, length: 1 },
};
check(transcriptFromResults(results) === '내일 제출합니다', '결과 목록을 이어 읽지 않습니다.');
check(dictationText('알림', results) === '알림\n내일 제출합니다', '결과 목록을 입력칸에 붙이지 않습니다.');
check(transcriptFromResults(null) === '' && dictationText('그대로', null) === '그대로', '결과 없음이 글을 지웁니다.');

const memory = {
    bag: new Map(),
    getItem(key) { return this.bag.has(key) ? this.bag.get(key) : null; },
    setItem(key, value) { this.bag.set(key, value); },
};
check(!readNoticeSeen(memory), '안내를 본 적 없는데 본 것으로 봅니다.');
check(writeNoticeSeen(memory) && readNoticeSeen(memory) && memory.getItem(SPEECH_NOTICE_KEY) === '1', '첫 안내 표시를 기억하지 않습니다.');
check(readNoticeSeen({ getItem() { throw new Error('막힘'); } }) === false, '저장소를 못 읽으면 예외가 납니다.');
check(writeNoticeSeen({ setItem() { throw new Error('막힘'); } }) === false, '저장소를 못 쓰면 예외가 납니다.');
check(!JSON.stringify(memory.bag).includes('음성'), '안내 기억에 음성을 넣습니다.');

check(speechErrorMessage('not-allowed').includes('마이크') && speechErrorMessage('not-allowed').includes('거부'), '권한 거부 안내가 없습니다.');
check(speechErrorMessage('network').includes('네트워크'), '네트워크 안내가 없습니다.');
check(speechErrorMessage('no-speech').includes('소리'), '무음 종료 안내가 없습니다.');
check(speechErrorMessage('aborted') === '', '중지 오류를 안내로 보여 줍니다.');
check(!/not-allowed|network|no-speech/.test(speechErrorMessage('not-allowed') + speechErrorMessage('network') + speechErrorMessage('no-speech')), '오류 코드가 화면에 나갑니다.');
check(/[가-힣]/.test(speechErrorMessage('audio-capture')) && /[가-힣]/.test(speechErrorMessage('unknown')), '오류 안내가 한국어가 아닙니다.');

let heard = '';
let failed = '';
let ended = 0;
class Fake {
    start() {
        this.onresult?.({
            results: {
                length: 2,
                0: { 0: { transcript: '내일 5교시 ' }, length: 1 },
                1: { 0: { transcript: '공개수업' }, length: 1 },
            },
        });
        this.onerror?.({ error: 'no-speech' });
        this.onend?.();
    }
}
const recognition = createRecognizer(Fake, {
    onTranscript(text) { heard = text; },
    onError(code) { failed = code; },
    onEnd() { ended += 1; },
});
check(recognition.lang === 'ko-KR', `언어가 ko-KR 이 아닙니다: ${recognition.lang}`);
check(recognition.interimResults === true, 'interimResults 를 켜지 않았습니다.');
check(recognition.continuous === true, 'continuous 를 켜지 않았습니다.');
recognition.start();
check(heard === '내일 5교시 공개수업', '인식기가 받아쓴 글을 넘기지 않습니다.');
check(failed === 'no-speech' && speechErrorMessage(failed).includes('소리'), '인식기 오류를 넘기지 않습니다.');
check(ended === 1, '인식기 종료를 넘기지 않습니다.');
check(!('audio' in recognition), '인식기에 음성 원본 칸을 만듭니다.');
check(CHROME_SPEECH_NOTICE.includes('구글 서버') && CHROME_SPEECH_NOTICE.includes('저장하지 않'), '크롬 안내가 짧지 않거나 저장 이야기가 없습니다.');

const weekStart = '2026-10-19';
for (let offset = 0; offset < 7; offset += 1) {
    const today = addDaysYmd(weekStart, offset);
    for (const hm of ['08:42', '15:00']) {
        const trip = nextOpenWeekday(today, hm, '08:50');
        const due = consentBefore(today, trip);
        const day = fromDay(today);
        check(dayName(trip) >= 1 && dayName(trip) <= 5, `${today} ${hm} 체험이 평일이 아닙니다: ${trip}`);
        check(trip > today || (trip === today && hm < '08:50'), `${today} ${hm} 체험이 기준 시각 이전이거나 당일이 아닙니다: ${trip}`);
        check(due < trip, `${today} ${hm} 동의서 마감 ${due}이 체험 ${trip}보다 앞이 아닙니다.`);
        let cursor = addDaysYmd(trip, -1);
        while (cursor >= today) {
            const open = cursor > today || hm < '08:50';
            if (open && !isWeekendYmd(cursor)) check(false, `${today} ${hm} 보다 가까운 평일 ${cursor}을 지나쳤습니다.`);
            if (cursor === today) break;
            cursor = addDaysYmd(cursor, -1);
        }
        const demo = buildDemo({ ymd: today, hm });
        const notice = demo.notices[0];
        check(demo.events.find((row) => row.id === 'demo-trip')?.date === trip, `${today} 예시 체험 날짜가 다릅니다.`);
        check(demo.todos.find((row) => row.id === 'demo-consent')?.due === due, `${today} 동의서 마감이 다릅니다.`);
        check(notice.date === addDaysYmd(today, 1), `${today} 알림장이 내일이 아닙니다.`);
        check(notice.text === `실내화 가방 챙기기, ${weekdayKo(trip)}요일 도시락 준비`, `${today} 알림장 요일이 체험과 다릅니다: ${notice.text}`);
        check(!notice.text.includes('목요일') || weekdayKo(trip) === '목', `${today} 알림장에 목요일이 그대로입니다.`);
    }
}

function fromDay(ymd) {
    return new Date(`${ymd}T00:00:00`).getDay();
}
function dayName(ymd) {
    return fromDay(ymd);
}
function isWeekendYmd(ymd) {
    const day = fromDay(ymd);
    return day === 0 || day === 6;
}

if (failures.length) {
    console.error(failures.join('\n'));
    process.exit(1);
}
console.log('말로 적기 검사를 통과했습니다.');
