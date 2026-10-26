# 쨈 교무수첩 아이콘

앱 아이콘과 화면 로고의 글자 쨈은 글꼴을 그대로 붙이지 않고, 굵은 글자의 외곽선만 옮긴 것입니다. 그래서 글꼴이 없는 기기에서도 같은 모양입니다.

## 글꼴

- 이름: Pretendard Bold 1.3.9
- 글자: U+CA08
- 저작권: Copyright (c) 2021, Kil Hyung-jin (https://github.com/orioncactus/pretendard)
- 라이선스: SIL Open Font License 1.1
- 라이선스 전문: `public/fonts/OFL-Pretendard.txt`
- Reserved Font Name Pretendard 는 아이콘 이름으로 쓰지 않습니다.
- 아이콘 파일 안에는 글꼴 파일을 넣지 않습니다. 외곽선은 `src/ui/jjaemMark.js` 와 `public/icon-jjaem.svg` 에 있습니다.

## 그림

바탕은 라일락 그라데이션 `#5E468C` → `#7A56A8` → `#8A62B0` 입니다. 가계부 아이콘의 보라·장미·갈색과 나란히 두어도 차가워 보이게 골랐습니다. 흰 글자 대비는 가장 밝은 멈춤에서도 4.7입니다.

- 원본: `public/icon-jjaem.svg`
- 파비콘: `public/favicon.svg`, `public/favicon.ico`(16·32), `public/favicon-16.png`, `public/favicon-32.png`
- 홈 화면: `public/pwa-192.png`, `public/pwa-512.png`
- 애플: `public/apple-touch-icon.png` 180, 배경은 불투명
- 마스크: `public/maskable-512.svg`, `public/maskable-512.png`. 글자는 가운데 지름 80% 원 안에 있습니다.
- 16·32px 파비콘은 같은 외곽선을 줄이지 않습니다. 획이 붙지 않도록 두껍고 단순한 쨈을 따로 그렸고, 받침 ㅁ의 구멍을 남겼습니다. 180·512px과 마스크 아이콘은 자세한 외곽선을 그대로 둡니다.

주소에는 `?v=17` 를 붙였고, 서비스 워커 캐시는 `ssug-gyomu-shell-v17` 입니다. 다시 만들 때는 `node scripts/make-jjaem-icon.mjs` 입니다.
