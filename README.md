# 올인원 홈노트 (all-in-one-home)

`All-in-One-Home.html` 단일 파일 앱을 **Vite + React**로 옮긴 버전입니다.

- **작성자:** dmlwjd85 &lt;dmlwjd85@gmail.com&gt;
- **참고 배포 URL (다른 저장소 예시):** [sambong-FC](https://dmlwjd85.github.io/sambong-FC/)
- 이 저장소를 GitHub에 `all-in-one-home` 이름으로 올리면 Pages 주소는 `https://dmlwjd85.github.io/all-in-one-home/` 가 됩니다.

## 개발

```bash
npm install
npm run dev
```

## 프로덕션 빌드

```bash
npm run build
npm run preview
```

## GitHub Pages

1. GitHub에서 이 폴더를 저장소로 push합니다 (예: `dmlwjd85/all-in-one-home`).
2. 저장소 **Settings → Pages → Build and deployment → GitHub Actions** 로 설정합니다.
3. 워크플로 `.github/workflows/deploy-pages.yml` 가 `main`/`master` push 시 빌드·배포합니다.
4. `VITE_BASE` 는 CI에서 자동으로 `/<저장소이름>/` 로 설정됩니다. 로컬에서는 `.env`에 `VITE_BASE=/` 를 두면 됩니다.

## 환경 변수 (선택)

| 변수 | 설명 |
|------|------|
| `VITE_BASE` | 배포 경로 (Pages: `/<repo>/`, 로컬: `/`) |
| `VITE_FIREBASE_CONFIG` | Firebase 설정 JSON 문자열 (미설정 시 코드 내 기본값) |
| `VITE_APP_ID` | Firestore 문서 앱 ID (기본 `home-note-app`) |

`.env.example` 을 참고해 `.env` 를 만드세요.

## 원본

상위 폴더의 `All-in-One-Home.html` 과 동작을 맞추는 것이 목표입니다.
