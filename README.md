# 쓱적 다이어리

생각·있었던 일·할 일을 먼저 쏟아 넣고, 카드를 밀어 학생·출결·상담·주간·업무로 나누는 교사 다이어리입니다.

배포 주소: https://dmlwjd85.github.io/All-in-One-Home/

## 쓰는 법

1. **쓱적**에 떠오른 것을 그냥 적습니다.
2. 카드를 좌우로 밀거나 아래 칸을 눌러 **학생 / 출결 / 상담·누가 / 오늘·주간 / 업무**로 날려보냅니다.
3. 각 목적지에서 정리된 기록을 보고, 필요하면 명단·출결·상담을 바로 추가합니다.
4. **달력**은 보조 보기입니다. 한국 공휴일·기념일과 날아온 기록이 표시됩니다.

로그인하면 Firebase에 동기화되고, 이 기기에서만 쓰면 localStorage에 남습니다. JSON으로 내보낼 수 있습니다.

## 로컬 실행

```bash
npm install
npm run dev
```

## 배포

`main`에 push하면 GitHub Actions가 Pages로 빌드·배포합니다.

Google 로그인을 쓰려면 Firebase Authentication에서 Google 제공업체를 켜고, 승인된 도메인에 `localhost`와 `dmlwjd85.github.io`를 넣어야 합니다.
