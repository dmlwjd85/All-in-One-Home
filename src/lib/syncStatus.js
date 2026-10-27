/**
 * 동기화 칩이 보는 작은 상태 저장소입니다.
 * db.js가 올리기·받아오기를 시작하고 끝낼 때 알려 주고, 칩은 구독해서 글만 바꿉니다.
 */

let status = { busy: 0, pending: 0, queued: 0, lastOkAt: 0, failed: false, authKnown: false };
const listeners = new Set();

function emit() {
    status = { ...status };
    listeners.forEach((fn) => fn(status));
}

export function syncStatus() {
    return status;
}

export function subscribeSync(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
}

export function syncBegin() {
    status.busy += 1;
    emit();
}

/** ok면 마지막 동기화 시각을 바꿉니다. pending은 다시 올려야 할 개수입니다. */
export function syncEnd({ ok = false, pending = 0, skipped = false, at = Date.now() } = {}) {
    status.busy = Math.max(0, status.busy - 1);
    if (!skipped) {
        status.pending = Math.max(0, Number(pending) || 0);
        status.failed = !ok;
        if (ok) status.lastOkAt = at;
    }
    emit();
}

export function syncQueued(count) {
    const next = Math.max(0, Number(count) || 0);
    if (next === status.queued) return;
    status.queued = next;
    emit();
}

export function syncAuthKnown() {
    if (status.authKnown) return;
    status.authKnown = true;
    emit();
}

/** 검사용: 처음 상태로 돌립니다. */
export function resetSyncStatusForTest() {
    status = { busy: 0, pending: 0, queued: 0, lastOkAt: 0, failed: false, authKnown: false };
    emit();
}

/** 마지막 동기화가 언제였는지 사람 말로 적습니다. */
export function agoLabel(at, now = Date.now()) {
    if (!at) return '';
    const sec = Math.max(0, Math.round((now - at) / 1000));
    if (sec < 60) return '방금';
    const min = Math.round(sec / 60);
    if (min < 60) return `${min}분 전`;
    const hour = Math.round(min / 60);
    if (hour < 24) return `${hour}시간 전`;
    return `${Math.round(hour / 24)}일 전`;
}

/**
 * 칩에 보일 상태를 고릅니다. 화면에 안 보일 때는 null.
 * 순서: 연결 설정 없음(숨김) → 오프라인 → 로그인 필요 → 동기화 중 → 동기화됨
 */
export function chipState({ cloudReady = false, signedIn = false, online = true, status: s = status, now = Date.now() } = {}) {
    if (!cloudReady) return null;
    if (!online) {
        return {
            kind: 'offline',
            label: '오프라인',
            hint: '인터넷이 돌아오면 적어 둔 걸 바로 올릴게요.',
        };
    }
    if (!signedIn) {
        if (!s.authKnown) return null;
        return {
            kind: 'login',
            label: '로그인이 필요해요',
            hint: '설정에서 구글로 로그인하면 폰과 컴퓨터에서 같은 기록을 볼 수 있어요.',
        };
    }
    if (s.busy > 0 || s.pending > 0 || s.queued > 0 || s.failed) {
        return {
            kind: 'syncing',
            label: '동기화 중',
            hint: s.failed ? '잠깐 연결이 고르지 않아요. 조금 뒤에 다시 올려 볼게요.' : '다른 기기와 기록을 맞추고 있어요.',
        };
    }
    const ago = agoLabel(s.lastOkAt, now);
    return {
        kind: 'synced',
        label: '동기화됨',
        hint: !ago ? '다른 기기와 기록이 같아요.' : ago === '방금' ? '방금 다른 기기와 맞췄어요.' : `${ago}에 다른 기기와 맞췄어요.`,
    };
}
