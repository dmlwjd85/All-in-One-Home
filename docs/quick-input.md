# 빠른 입력 추가

하단 쨈 버튼의 한 줄 입력에 이름 후보, 말 입력, 분류 강조, 홈 화면 바로가기를 더했습니다. 명단 검색과 분류 규칙은 기기 안에서만 돕니다.

## 이름 후보

글 끝의 한글이 명단 이름의 앞부분이거나, 초성(ㅁㅈ → 민준)이면 후보를 칩 위에 한 줄로 둡니다. 후보를 고르면 그 이름이 들어가고, 관찰로 저장할 때 기존처럼 학생 번호로 `sid`를 붙입니다. 이름을 직접 다 적고 그 학생이 한 명이면 고르지 않아도 연결합니다. 이름이 둘이면 고른 학생만 연결합니다. 학생 화면은 이 `sid`로 기록을 모읍니다.

민감한 글은 학생과 연결해도 기존 규칙대로 이 기기에만 남습니다.

## 분류 강조

저장하지 않고 칩만 표시합니다. 글이 바뀐 뒤 150ms가 지나야 강조가 바뀌고, 색은 180ms에 걸쳐 변합니다. 움직임 줄이기에서는 전환 시간이 거의 없습니다.

우선순위는 학생 이름, 그다음 날짜·시간, 그다음 할 일 말입니다.

- 명단 이름이 글에 있으면 관찰입니다.
- 내일, 모레, 글피, 금요일, 3시, 10/30, 3교시, 10월 30일처럼 날짜나 시간이 있으면 일정입니다.
- 하기, 제출, 보내기가 있으면 할 일입니다.

Enter는 강조된 칩으로 저장합니다. 강조가 없으면 직전에 저장한 분류, 그것도 없으면 메모입니다. 토스트에는 분류와 되돌리기가 있습니다.

일정으로 저장할 때 글에서 날짜를 읽으면 그 날짜를 쓰고, 토스트에 `10월 27일 일정에 넣었어요.`처럼 보여 줍니다. 내일·모레·글피는 일지 날짜가 아니라 한국 시각의 오늘을 기준으로 합니다. 3시나 3교시만 있으면 일정으로 강조만 하고, 날짜는 오늘 또는 일지에서 연 날짜 그대로입니다. 날짜 읽기는 앱에 있던 `detectDate`를 그대로 씁니다.

## 말로 입력

`SpeechRecognition` 또는 `webkitSpeechRecognition`이 있을 때만 듣기를 시작합니다. `lang`은 `ko-KR`입니다. 없을 때 마이크를 누르면 `키보드의 마이크 버튼으로 받아쓰기를 할 수 있어요.`를 보여 줍니다.

`processLocally`와 `available({ langs: ['ko-KR'], processLocally: true })`가 있고 상태가 `available`이면 기기 안 인식을 켭니다. 그렇지 않으면 브라우저 기본 경로입니다. 처음 한 번, 기기 안 인식이면 `이 기기 안에서 음성을 글자로 바꿉니다.`, 아니면 `음성은 브라우저가 Apple이나 Google 서버로 보낼 수 있어요.`를 알립니다. 이 표시는 `ssug-gyomu-speech-notice`에만 남고, 수첩 저장 키는 바꾸지 않습니다.

듣기는 버튼 클릭 안에서 `start()`를 바로 부릅니다. `await` 뒤에 시작하면 아이폰이 사용자 동작을 놓칠 수 있어서, 기기 안 인식이 가능한지는 입력칸이 열린 뒤에 미리 물어 둡니다.

## 주소

`#/quick`와 `?quick=1`은 입력칸을 바로 엽니다. 주소로 연 경우에는 `focus()`를 부르지 않습니다. 칸을 키우고, 안내 문구는 `한 번 누르면 키보드가 올라와요`입니다. 매니페스트 바로가기 주소는 `./?quick=1`입니다.

## 말로 입력, 어디서 되나

아래는 2026-10-26에 문서를 본 결과입니다. 아이폰, 안드로이드 폰, 맥 Safari는 이 자리에서 실행하지 못했습니다. 이 VM의 Chrome에서 API가 있는지만 따로 확인합니다.

| 자리 | 말로 입력 | 홈 화면 길게 누르기 |
| --- | --- | --- |
| 아이폰 Safari | 문서상 부분 지원. Safari 14.1부터 `webkitSpeechRecognition`이 있고, 받아쓰기(Siri)를 켜야 합니다. 사용자 동작 없이 시작하지 않습니다. 권한 창이 몇 번 뜨는지는 세지 못했습니다. | 탭에는 홈 화면 길게 누르기가 없습니다. 단축어의 URL 열기는 Safari로 연다는 안내가 있습니다. |
| 아이폰 홈 화면 앱 | 2021-05-04 WebKit은 홈 화면 웹앱과 SafariViewController에서 인식을 제공하지 않는다고 답했습니다. 2026-08 버그 보고는 iOS 26.6 홈 화면 앱에서도 인식이 시작된다고 적었습니다. 버전에 따라 다를 수 있고, 여기서는 확인하지 못했습니다. | 문서상 미지원. Can I Use는 iOS Safari 27.2까지 `shortcuts`가 없다고 합니다. |
| 안드로이드 Chrome | 문서상 음성 인식은 됩니다. `processLocally`는 데스크톱 Chrome만 해당하고 안드로이드는 빠집니다. 소리는 Google 서버로 갈 수 있습니다. 폰에서 직접 말하지 못했습니다. | 문서상 지원. 매니페스트에 `빠른 입력`을 넣었습니다. 폰에서 길게 누르지는 못했습니다. |
| PC Chrome | 데스크톱은 음성 인식을 지원합니다. 기기 안 인식(`processLocally`)은 Chrome 데스크톱 문서에 있고, 언어 팩이 있어야 `available`입니다. 이 VM에서 API가 있는지는 실행 기록에 적습니다. | 설치한 앱의 점프 목록은 문서상 가능합니다. 이 VM에는 홈 화면 아이콘이 없어 길게 누르지 못했습니다. |
| Mac Safari | 문서상 Safari 17.4부터 Dock에 둔 웹앱의 shortcuts를 지원합니다. 음성은 Safari 14.1 이후 부분 지원입니다. 여기서는 실행하지 못했습니다. | 문서상 macOS Safari 17.4부터 shortcuts를 지원합니다. |

권한은 이렇게만 말할 수 있습니다. Chrome 계열은 사이트 마이크 권한을 묻는 것이 보통이고, 한 번 허용하면 같은 주소에서는 다시 묻지 않는 쪽이 일반적입니다. 아이폰은 받아쓰기가 꺼져 있으면 인식 서비스가 없다는 오류가 난다는 버그 답변이 있습니다. 창이 정확히 몇 번인지는 기기마다 달라 여기서 확정하지 않습니다.

단축어로 `https` 주소를 열면 Safari(또는 기본 브라우저)로 열리고, 홈 화면 앱 안의 기록과는 자리가 다를 수 있습니다. iOS 17.2부터 홈 화면에 넣을 때 Safari 쿠키를 복사한다는 기록이 있으나, 그 뒤로는 나뉜다는 설명이 있고 이 수첩의 기록은 쿠키가 아니라 이 기기의 저장소입니다. `webapp://`로 설치한 웹앱을 연다는 사용자 보고가 있으나 Apple 문서가 아니고 주소가 조금만 달라도 다른 앱이 열린다고 해서, 도움말의 기본 방법에는 넣지 않았습니다.

## 출처

- 음성 인식 지원 표: [Can I use Speech Recognition API](https://caniuse.com/speech-recognition)
- 홈 화면 웹앱에서 인식을 빼 둔 WebKit 답변 (2021-05-04): [Bug 225298](https://bugs.webkit.org/show_bug.cgi?id=225298)
- iOS 26.6에서 홈 화면 앱의 인식이 멈춘다는 보고 (2026-08): [Bug 321436](https://bugs.webkit.org/show_bug.cgi?id=321436)
- 기기 안 인식: [MDN processLocally](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition/processLocally), [온디바이스 설명](https://github.com/WebAudio/web-speech-api/blob/main/explainers/on-device-speech-recognition.md), [Chrome 상태](https://chromestatus.com/feature/6090916291674112)
- shortcuts 지원 표: [Can I use webapp shortcuts](https://caniuse.com/mdn-manifests_webapp_shortcuts). iOS는 27.2까지 없음. macOS Safari는 17.4부터.
- WebKit shortcuts 버그. macOS 17.4에 실렸고 iOS는 그 표에 없음: [Bug 201964](https://bugs.webkit.org/show_bug.cgi?id=201964)
- 매니페스트 shortcuts: [W3C App Manifest](https://www.w3.org/TR/appmanifest/#shortcuts-member)
- 다른 앱의 링크는 웹앱이 아니라 브라우저로 열린다는 정리: [PWAs on iOS](https://progressivewebapps.com/platforms/ios-safari/)
- 단축어에서 `webapp://`로 연다는 사용자 보고: [Ask Different](https://apple.stackexchange.com/questions/352980/opening-homescreen-web-app-with-a-shortcut)
- 홈 화면 웹앱과 Safari의 저장 자리가 나뉜다는 설명: [goulet.dev](https://goulet.dev/posts/qr-code-pwa-link-with-token/)
