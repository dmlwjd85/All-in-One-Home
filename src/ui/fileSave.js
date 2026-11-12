/**
 * 만든 파일을 이 기기에 넘깁니다. 나이스 모아 보기 내려받기와 같은 방식입니다.
 * 휴대폰(아이폰 홈 화면 앱 등)은 내려받기가 막힐 수 있어 공유 창으로 넘기고, 컴퓨터는 바로 내려받습니다.
 * 돌려주는 값: 'shared' | 'saved' | 'cancel'
 */
export async function deliverFile(file) {
    const mobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    if (mobile && navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: file.name });
            return 'shared';
        } catch (error) {
            if (error?.name === 'AbortError') return 'cancel';
            /* 공유가 안 되면 아래에서 내려받기로 이어 갑니다. */
        }
    }
    const url = URL.createObjectURL(file);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    /* 휴대폰은 파일을 늦게 읽기도 해서, 주소는 1분 뒤에 풉니다. */
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return 'saved';
}
