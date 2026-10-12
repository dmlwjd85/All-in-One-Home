export default function LocalOnlyBadge() {
    return (
        <p className="nb-local-badge" role="note">
            <strong>이 기기에만 저장</strong>
            <span>다른 기기와 동기화하지 않습니다. 상단 내보내기로 백업해 두세요.</span>
        </p>
    );
}
