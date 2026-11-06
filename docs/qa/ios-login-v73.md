# 아이폰 설치 앱 로그인 재개 수정 (SW v73)

2026-11-06 KST. 원 조사: `/workspace/qa/ios-login/보고.md`를 읽고 작업했습니다.

## 고친 한 줄
팝업 반환값이 없어도 인증 observer로 복원된 계정의 온보딩을 재개하고, 원격 학급 확인 전에는 새 명단으로 진행하지 않습니다.

## 변경
- Start가 uid 복원을 구독해 초기 동기화 성공 후 온보딩을 재개합니다.
- 동기화 지연(20초)/실패는 자료 보호 안내와 재시도를 표시합니다. 실패한 초기 연결 task는 재시도할 수 있게 비웁니다.
- popup은 30초 대기 제한과 Safari 안내를 표시하고 중복 클릭을 막습니다.
- redirect 결과와 observer 등록을 분리하고 redirect 오류를 숨기지 않습니다.
- 같은 도메인의 auth helper가 없는 상태에서 popup 차단을 교차 도메인 redirect로 바꾸지 않습니다.
- authDomain 설정, Firestore 규칙, #76, Pages 배포는 변경하지 않습니다.

## 자체 전수 검증
기존 package.json의 check 36종 모두 실행을 시도했습니다: 28 통과, Java 없는 환경 때문에 Firestore emulator 검사 7종 미실행, browser는 실행기 240초 제한으로 중단됐습니다. 전체 통과가 아닙니다.
Java 설치도 시도했지만 패키지 저장소 HTTP 500/서명 오류로 실패하여 보안 검사를 끄거나 다른 경로로 우회하지 않았습니다.
추가 `check:ioslogin` 통과: 실제 Start 컴포넌트 + 가짜 인증/동기화로 credential 없는 observer 복원, sync pending/실패/거절, 저장 실패 시 이동 금지, popup timeout, popup 차단의 교차 도메인 redirect 금지, redirect 저장소 오류 전파를 확인했습니다.
최종 build, check:quality, check:ioslogin, git diff --check 통과. 기존 check:syncchip도 수정 후 통과했습니다.

| 검사 | 결과 |
|---|---|
| check:links | 통과 |
| check:hits | 통과 |
| check:storage | 통과 |
| check:quality | 통과 |
| check:msg | 통과 |
| check:speech | 통과 |
| check:keyfeel | 통과 |
| check:kbtheme | 통과 |
| check:brand | 통과 |
| check:icons | 통과 |
| check:seal | 통과 |
| check:quickbar | 통과 |
| check:gcal | 통과 |
| check:period | 통과 |
| check:five | 통과 |
| check:rules | Java 없음 |
| check:browser | 240초 제한 |
| check:sync | 통과 |
| check:syncchip | 통과 |
| check:academic | 통과 |
| check:attendcloud | Java 없음 |
| check:cloudpull | Java 없음 |
| check:attendsave | 통과 |
| check:todosync | Java 없음 |
| check:leavesync | Java 없음 |
| check:twodevice | Java 없음 |
| check:locknote | 통과 |
| check:hlc | 통과 |
| check:alarm | 통과 |
| check:swreload | 통과 |
| check:datechip | 통과 |
| check:jjaem-paste | 통과 |
| check:tabbar | 통과 |
| check:ui-a | 통과 |
| check:side-hotkey | 통과 |
| check:tabbarsync | Java 없음 |

## 남은 확인 — 머지 금지
실제 아이폰 홈 화면 설치 앱에서 Google OAuth 왕복은 확인하지 않았습니다. GitHub Pages의 교차 도메인 인증 저장소 문제 자체를 reverse proxy/같은 도메인 hosting으로 해결한 PR이 아닙니다. 인증 결과가 전혀 전달되지 않는 기기는 안내만 가능하며 완전 해결로 주장하지 않습니다.
실기기에서 기존 계정 복원·신규 계정·취소·팝업 차단·오프라인·저장 실패를 확인하고 CI 전체 SUCCESS 및 선생님 머지 승인을 받기 전에는 머지/배포하지 않습니다.
로컬 검사 로그: `/tmp/aioh-ios-checks.log`, 집계: `/tmp/aioh-ios-results.json`.
